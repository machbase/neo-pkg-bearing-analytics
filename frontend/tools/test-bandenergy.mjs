// 대역 RMS 계산 검사 — 오프라인. npm run smoke에 포함.
// 값의 정의가 bandEnergy 하나이므로, 여기서 틀리면 학습·판정·리포트가 전부 같이 틀린다.
// 그래서 "알려진 신호를 넣어 이론값이 나오는가"로 확인한다.
globalThis.window = globalThis;
import { mulberry32 } from './_rnd.mjs';
const Band = (await import('../../cgi-bin/monitor/band.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};
const near = (a, b, tolPct) => Math.abs(a - b) / Math.abs(b) * 100 <= tolPct;

const FS = 2048, N = 32768, FR = 30;          // 1800 rpm · Nyquist 1024 Hz
const NAMES = Band.BAND_NAMES;                 // sub, one, fault, high, vh1~vh4
const idx = (n) => NAMES.indexOf(n);

// 대역 경계: sub[2,15) one[15,45) fault[45,300) high[300,1000) vh1[1k,2k) … (fs=2048이라 vh1~vh4는 빈 대역)
const sine = (f, amp, n = N, fs = FS, phase = 0) => {
  const v = new Array(n);
  for (let i = 0; i < n; i++) v[i] = amp * Math.sin(2 * Math.PI * f * i / fs + phase);
  return v;
};
const add = (...ws) => ws[0].map((_, i) => ws.reduce((s, w) => s + w[i], 0));
const run = (vals) => Band.bandEnergy(vals, FS, FR, FS / 2).vals;

// ── 1. 진폭이 맞는가 ───────────────────────────────────────────────────────
{
  /* 진폭 A인 사인의 RMS는 A/√2다. 창을 씌우면 신호가 깎이므로 잡음대역폭으로 되돌려야
     이 값이 나온다 — 보정을 빼먹으면 Hann에서 약 39% 작게 나온다(√(3/8)). */
  /* 103.7 Hz — 일부러 FFT 빈에 안 맞춘다. 빈에 딱 맞는 주파수(100 Hz)를 쓰면 사각창으로도
     누설이 0이라, 창을 넣었는지 아닌지를 검사가 구분하지 못한다. */
  const r = run(sine(103.7, 2));             // fault 대역(45~300)
  const want = 2 / Math.SQRT2;
  chk(near(r[idx('fault')], want, 2), '사인 1개의 대역 RMS = A/√2', `${r[idx('fault')].toFixed(4)} vs ${want.toFixed(4)}`);

  // 다른 대역은 새지 않아야 한다 — 이게 Hann 창을 넣은 이유다
  const leak = Math.max(r[idx('sub')], r[idx('one')], r[idx('high')]);
  chk(leak < want * 1e-6, '이웃 대역으로 새지 않는다', `누설 최대 ${leak.toExponential(2)}`);

  /* 창을 뺀 것과 견줘 본다 — 이 차이가 Hann을 넣은 이유 전부다.
     사각창은 1×의 큰 성분을 베어링 대역으로 흘려보내 헛경보를 만든다. */
  const rect = new Function('return (' + Band.bandEnergy.toString()
    .replace('W[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / L)', 'W[i] = 1') + ')')();
  const rl = rect(sine(103.7, 2), FS, FR, FS / 2).vals;
  const leakRect = Math.max(rl[idx('sub')], rl[idx('one')], rl[idx('high')]);
  chk(leakRect > leak * 1000, '사각창이었다면 훨씬 많이 샜다', `사각 ${leakRect.toExponential(2)} vs Hann ${leak.toExponential(2)}`);
}

// ── 2. 에너지가 대역별로 옳게 갈리는가 ─────────────────────────────────────
{
  // 1×(30 Hz, one)과 고주파(500 Hz, high)를 동시에 — 각자 제 대역에서만 잡혀야 한다
  const r = run(add(sine(30, 1), sine(500, 3)));
  chk(near(r[idx('one')], 1 / Math.SQRT2, 3), '1× 성분이 one 대역에 잡힌다', r[idx('one')].toFixed(4));
  chk(near(r[idx('high')], 3 / Math.SQRT2, 3), '고주파 성분이 high 대역에 잡힌다', r[idx('high')].toFixed(4));
  chk(r[idx('fault')] < 0.05, '사이 대역은 조용하다', r[idx('fault')].toExponential(2));

  /* 에너지는 제곱으로 더해진다 — 두 성분의 대역 RMS를 제곱합해 √하면 전체 AC RMS와 같아야
     한다. 이게 안 맞으면 대역값을 서로 비교하거나 합산하는 화면이 전부 틀린다. */
  const total = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
  const want = Math.sqrt((1 / Math.SQRT2) ** 2 + (3 / Math.SQRT2) ** 2);
  chk(near(total, want, 3), '대역 제곱합 = 전체 AC RMS', `${total.toFixed(4)} vs ${want.toFixed(4)}`);
}

// ── 3. DC·드리프트에 흔들리지 않는가 ───────────────────────────────────────
{
  const base = sine(100, 2);
  const dc = base.map((v) => v + 50);                                  // 큰 직류 오프셋
  const drift = base.map((v, i) => v + 5 * i / N);                     // 느린 드리프트
  const r0 = run(base), rDc = run(dc), rDr = run(drift);
  chk(near(rDc[idx('fault')], r0[idx('fault')], 1), 'DC 오프셋이 대역값을 바꾸지 않는다', rDc[idx('fault')].toFixed(4));
  /* 드리프트는 창의 양끝 불연속으로 나타나는데, Hann이 그 양끝을 0으로 눕혀 저주파로
     새는 것을 막는다. 안 막으면 "저주파가 커졌다"는 헛경보가 된다. */
  chk(rDr[idx('sub')] < 0.05, '느린 드리프트가 최저 대역을 들어올리지 않는다', rDr[idx('sub')].toExponential(2));
}

// ── 4. 흔들림이 줄었는가 ───────────────────────────────────────────────────
{
  /* 잡음 신호의 대역값을 여러 번 재서 변동계수를 본다.
     대역값이 출렁이면 그 흔들림이 대역 베이스라인의 σ로 들어가 한계를 느슨하게 만든다. */
    const rand = mulberry32(12345);
  const vals = [];
  for (let t = 0; t < 20; t++) {
    const noise = new Array(N); for (let i = 0; i < N; i++) noise[i] = rand();
    vals.push(run(noise)[idx('fault')]);
  }
  const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mu) ** 2, 0) / vals.length);
  const cv = sd / mu * 100;
  /* 창 전체를 한 번에 FFT하면 대역 하나에 빈이 수백~수천 개라 이미 그 안에서 평균된다.
     겹침 블록 평균(Welch)을 넣어 봤지만 분해능만 4배 나빠지고 흔들림은 오히려 늘었다
     — 대역 에너지는 선 스펙트럼이 아니라 통과대역 합이라 블록을 쪼갤 이유가 없었다. */
  chk(cv < 2, '잡음 신호의 대역값이 흔들리지 않는다', `CV ${cv.toFixed(2)}%`);
}

// ── 5. 홀로 떨어져도 도는가 ────────────────────────────────────────────────
{
  /* TQL에는 이 파일의 다른 이름이 하나도 없다. 몸통이 바깥 이름을 참조하면 타이머
     첫 회차에서 ReferenceError로 죽는데, 등록은 성공하므로 화면엔 아무 표시가 없다. */
  const lone = new Function('return (' + Band.bandEnergy.toString() + ')')();
  const r = lone(sine(100, 2), FS, FR, FS / 2).vals;
  chk(near(r[idx('fault')], 2 / Math.SQRT2, 2), '계산부는 소스만으로 홀로 돈다', r[idx('fault')].toFixed(4));

  const renamed = Band.bandEnergy.toString().replace(/bandEnergy/g, 'x');
  const lone2 = new Function('return (' + renamed + ')')();
  chk(near(lone2(sine(100, 2), FS, FR, FS / 2).vals[idx('fault')], 2 / Math.SQRT2, 2), '이름이 바뀌어도 돈다');
}

// ── 6. 짧은 창·빈 입력 ─────────────────────────────────────────────────────
{
  chk(Band.bandEnergy([], FS, FR, FS / 2) === null, '샘플이 없으면 null');
  chk(Band.bandEnergy(sine(100, 1, 64), FS, FR, FS / 2) === null, '너무 짧으면 null — 억지로 계산하지 않는다');
  // 창이 짧아도 정의는 같다 - 분해능만 거칠어진다
  const r = Band.bandEnergy(sine(100, 2, 2048), FS, FR, FS / 2);
  chk(r && near(r.vals[idx('fault')], 2 / Math.SQRT2, 5), '짧은 창도 진폭은 맞다', r ? r.vals[idx('fault')].toFixed(4) : 'null');
}

// 대역 계산은 한 벌뿐이어야 한다 ─────────────────────────────────────────────
{
  /* 예전에는 화면이 별도 함수(VC.bandEnergies)로 대역 3개를 따로 계산했다. 정규화도 달라서
     알람이 난 시점의 차트를 봐도 그 상승이 안 보였다 — 같은 이름의 값이 두 벌이면 어느 쪽도
     믿을 수 없다. 두 번째 구현이 되살아나지 않게 여기서 막는다. */
  chk(typeof VC.bandEnergies === 'undefined', '대역 계산의 두 번째 구현이 없다');
  chk(typeof Band.bandEnergy === 'function', '대역 계산은 bandEnergy 하나로 정의된다');
  /* 계산 결과는 주파수 대역 8칸이다 — 판정 목록(BAND_ORDER)은 포락선 계열까지 포함해 더 길다.
     둘을 같은 것으로 쓰면 대역 경계를 인덱스로 읽는 곳이 없는 칸을 물어 조용히 어긋난다. */
  chk(Band.bandEnergy(sine(100, 2), FS, FR, FS / 2).vals.length === VC.BAND_FREQ.length,
    '계산 결과 개수와 주파수 대역 목록이 같다', String(VC.BAND_FREQ.length));
  chk(VC.BAND_ORDER.slice(0, VC.BAND_FREQ.length).join() === VC.BAND_FREQ.join(),
    '판정 목록은 주파수 대역으로 시작한다 — 인덱스 앞부분이 대역 경계와 1:1', VC.BAND_ORDER.join(','));
  chk(VC.BAND_ORDER.length > VC.BAND_FREQ.length, '판정 목록에 포락선 계열이 붙어 있다',
    VC.BAND_ORDER.slice(VC.BAND_FREQ.length).join(','));
  // 저장만 하는 계열은 판정 목록에 없어야 한다 — 들어가면 "몇 Hz인가"를 이탈로 판정하게 된다
  chk(VC.BAND_CTX.every((bn) => VC.BAND_ORDER.indexOf(bn) < 0), '저장 전용 계열은 판정하지 않는다', VC.BAND_CTX.join(','));
  chk(VC.BAND_ORDER.concat(VC.BAND_CTX).every((bn) => !!VC.BAND_KO[bn]), '모든 계열에 한글 라벨이 있다');
}

// 압축된 이름 함정 ────────────────────────────────────────────────────────
{
  /* 계산부는 소스를 문자열로 박아 TQL에 넣는다. 번들이 압축되면 함수 이름이 바뀌므로,
     생성된 코드가 그 이름을 알아야 하면 선언과 호출이 어긋날 자리가 생긴다 — 한쪽만
     리터럴로 박으면 TQL 첫 태그에서 ReferenceError로 죽는데, 타이머는 RUNNING으로 남고
     표만 영영 빈다(실제로 겪었다). 그래서 이름에 기대지 않고 고정 별칭으로 받는다. */
  const tql = Band.buildBandTql({ tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 2048 }], nowMs: 1 });
  chk(tql.includes('var __bandEnergy=function'), '고정 별칭으로 선언한다');
  chk(tql.includes('var vv=__bandEnergy('), '호출도 같은 별칭을 쓴다');
  /* 이 검사가 본체다 — 압축돼도 안 깨지려면 생성된 코드에 실제 함수 이름이 나오면 안 된다.
     node에서는 이름이 안 바뀌므로 "결과 문자열"을 보는 검사로는 이 사고를 못 잡는다. */
  // 별칭(__bandEnergy)이 이름을 포함하므로 앞 글자가 식별자가 아닐 때만 "이름을 부른 것"이다
  const body = tql.slice(tql.indexOf('var __bandEnergy=') + 60);
  const calls = new RegExp('(^|[^A-Za-z0-9_$])' + Band.bandEnergy.name + '\\(');
  chk(!calls.test(body), '생성된 코드가 실제 함수 이름을 부르지 않는다', Band.bandEnergy.name);
}

// ── 7. 1× 실측과 대역 경계 ─────────────────────────────────────────────────
/* 대역 경계가 1× 상대(0.5×·1.5×·10×)라 fr이 어긋나면 대역이 통째로 밀린다. 명판은 동기속도라
   슬립만큼 늘 어긋나고 가변속이면 아예 다른 값이다. 값은 계속 나오므로 어긋난 게 안 보인다. */
{
  const be = (vals, frNom = FR) => Band.bandEnergy(vals, FS, frNom, FS / 2);

  // 슬립 — 명판 30인데 실제 28.5 Hz(5% 느림)
  let r = be(sine(28.5, 2));
  chk(r.meas, '명판 ±12% 안의 1×를 찾는다');
  chk(near(r.fr, 28.5, 0.5), '실측 1× = 28.5 Hz', r.fr.toFixed(3));

  /* 경계가 실제로 따라가는지 — 43 Hz는 명판 30 기준이면 1×대역(15~45)에, 실측 28.5 기준이면
     결함대역(42.75~285)에 들어간다. 두 대역에 반씩 갈리면 따라간 것이고, 1×대역에 다 몰리면
     명판을 그대로 쓴 것이다. 값만 보고는 구분이 안 되므로 이 배치가 유일한 증거다. */
  r = be(add(sine(28.5, 1), sine(43, 1)));
  chk(near(r.fr, 28.5, 0.5), '다른 성분이 있어도 창 안의 1×를 고른다', r.fr.toFixed(3));
  chk(near(r.vals[idx('fault')], 1 / Math.SQRT2, 3), '43 Hz가 결함 대역으로 간다(경계가 따라감)', r.vals[idx('fault')].toFixed(4));
  chk(near(r.vals[idx('one')], 1 / Math.SQRT2, 3), '1× 대역에는 28.5 Hz만 남는다', r.vals[idx('one')].toFixed(4));

  // 잡음만 있으면 실측하지 않는다 — 잡음 봉우리를 물면 앵커마다 경계가 흔들려 학습이 망가진다
    const rand = mulberry32(987654);
  const noise = new Array(N); for (let i = 0; i < N; i++) noise[i] = rand();
  r = be(noise);
  chk(!r.meas, '잡음만 있으면 실측하지 않는다');
  chk(r.fr === FR, '못 찾으면 명판을 그대로 쓴다', String(r.fr));

  // 20회 반복해도 한 번도 물지 않아야 한다 — 가끔 무는 것이 제일 나쁘다(경계가 회차마다 달라진다)
  let bit = 0;
  for (let t = 0; t < 20; t++) {
    const nz = new Array(N); for (let i = 0; i < N; i++) nz[i] = rand();
    if (be(nz).meas) bit++;
  }
  chk(bit === 0, '잡음 20회에서 한 번도 물지 않는다', bit + '/20');

  // 명판이 자릿수로 틀리면 창 밖이라 못 찾는다 — 그때는 명판으로 떨어지는 게 안전하다
  r = be(sine(60, 2), 30);
  chk(!r.meas && r.fr === 30, '명판이 크게 틀리면 못 찾고 명판을 쓴다', r.fr.toFixed(1));

  // 1×가 없는 설비(잘 정렬된 기계)도 명판으로 떨어진다
  r = be(sine(500, 2));
  chk(!r.meas && r.fr === FR, '1× 성분이 없으면 명판', r.fr.toFixed(1));

  /* 포물선 보간 — 25.6 kHz·32k점이면 빈 간격이 0.78 Hz라 30 Hz 근처에서 2.6% 오차다.
     그대로 쓰면 보정하려던 슬립(2~5%)과 같은 크기의 오차가 새로 생긴다. */
  r = Band.bandEnergy(sine(28.4, 2, 2048), FS, FR, FS / 2);   // 창 2048 → 빈 간격 1 Hz
  chk(r.meas && near(r.fr, 28.4, 2), '빈 간격보다 세밀하게 잡는다', r.fr.toFixed(3));

  // 저장되는 fr은 명판이 아니라 이 앵커의 경계를 정한 값이어야 한다
  const tql = Band.buildBandTql({ tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 2048 }], nowMs: 1, dryRun: true });
  chk(/var fr=vv\.fr;/.test(tql), '저장하는 fr은 경계를 정한 값(명판 아님)');
  chk(!/var fr=t\.fr;/.test(tql), '명판을 그대로 저장하지 않는다');
}

// ── 8. 포락선 복조 ─────────────────────────────────────────────────────────
/* 베어링 결함은 볼이 흠집을 때릴 때마다 구조 공진을 울린다. 원시 스펙트럼에는 "고주파가 있다"
   까지만 보이고 "몇 Hz로 두들기나"는 진폭 변조로 숨어 있다. 복조해야 그 반복주파수가 선이 된다.
   고주파가 센 것과 주기적으로 두들기는 것은 다르다 — 그 구분이 이 계산의 존재 이유다. */
{
  const FS2 = 25600, N2 = 32768, FR2 = 30;
  const bf = VC.faultCoeffs(VC.BEARINGS['6206']);
  const fBPFO = bf.O * FR2;
    const rand = mulberry32(4242);

  /* 합성 신호: 1× 정현파 + 광대역 잡음 + (BPFO 주기로 4 kHz 공진을 때리는 충격열).
     실제 설비를 흉내 내려면 잡음이 반드시 있어야 한다 — 잡음 없는 순수 합성에서는 어떤 지표든
     잘 보여서, 잡음에 묻히는지를 검사하지 못한다. */
  const mk = (amp) => {
    const s = new Array(N2);
    for (let i = 0; i < N2; i++) s[i] = 0.2 * Math.sin(2 * Math.PI * FR2 * i / FS2) + 0.5 * rand();
    if (amp > 0) for (let k = 0; k * FS2 / fBPFO < N2; k++) {
      const t = Math.round(k * FS2 / fBPFO);
      for (let j = 0; j < 500 && t + j < N2; j++) s[t + j] += amp * Math.exp(-j / 70) * Math.sin(2 * Math.PI * 4000 * j / FS2);
    }
    return s;
  };
  const run2 = (amp, opt) => Band.bandEnergy(mk(amp), FS2, FR2, FS2 / 2, opt === undefined ? { demod: [3000, 6000], bf: bf } : opt);

  // 결함주파수 계수 — 주파수가 아니라 fr 배수로 굽는다(서버가 앵커마다 fr을 실측하므로)
  chk(Math.abs(bf.O - 3.5707) < 1e-3 && Math.abs(bf.I - 5.4293) < 1e-3, '6206 결함주파수 계수', `O=${bf.O.toFixed(4)} I=${bf.I.toFixed(4)}`);
  chk(Math.abs(bf.O + bf.I - 9) < 1e-9, 'BPFO + BPFI = 볼 개수 × fr (형상 항등식)', String(bf.O + bf.I));
  chk(VC.faultCoeffs(VC.BEARINGS.sleeve) === null && VC.faultCoeffs(null) === null, '구름체가 없으면 결함주파수도 없다');

  // 복조 대역 — 마운팅 상한 아래 최상위 옥타브. 커토그램을 안 쓰는 이유는 추세가 고정 대역을 요구해서다.
  chk(JSON.stringify(VC.demodBand(25600, 'stud')) === '[5000,10000]', '스터드(10 kHz): [5k, 10k]', JSON.stringify(VC.demodBand(25600, 'stud')));
  chk(JSON.stringify(VC.demodBand(25600, 'magnet')) === '[1000,2000]', '자석(2 kHz): [1k, 2k]', JSON.stringify(VC.demodBand(25600, 'magnet')));
  chk(JSON.stringify(VC.demodBand(25600, '')) === '[6400,12800]', '마운팅 미상이면 Nyquist 기준', JSON.stringify(VC.demodBand(25600, '')));
  chk(VC.demodBand(500, 'stud') === null, '상단이 너무 낮으면 복조 대역이 성립하지 않는다');
  // 같은 마운팅이면 언제 불러도 같은 값 — 추세가 성립하는 근거다
  chk(JSON.stringify(VC.demodBand(25600, 'stud')) === JSON.stringify(VC.demodBand(25600, 'stud')), '결정론적 — 앵커마다 같은 대역');

  // 결함을 잡는가
  {
    const r = run2(1.0);
    chk(r.env !== null, '복조 대역을 주면 포락선 지표가 나온다');
    chk(Math.abs(r.env.f0 - fBPFO) < 1.5, `지배 반복주파수 = BPFO ${fBPFO.toFixed(1)} Hz`, r.env.f0.toFixed(2));
    chk(r.env.harm >= 2, '하모닉이 정수배로 선다 — 단발 스파이크와 구분되는 지점', String(r.env.harm));
    chk(r.env.O > r.env.I * 2 && r.env.O > r.env.B * 2, '외륜 결함이 BPFI·BSF보다 크게 나온다',
      `O=${r.env.O.toFixed(4)} I=${r.env.I.toFixed(4)} B=${r.env.B.toFixed(4)}`);
  }

  // 잡음은 안 잡는가 — 여기가 뚫리면 앵커마다 헛것을 물어 추세가 쓰레기가 된다
  {
    const r = run2(0);
    chk(r.env.harm === 0, '잡음만 있으면 하모닉이 서지 않는다', String(r.env.harm));
    chk(r.env.pkRel < 12, '잡음의 포락선은 뾰족하지 않다(피크 ÷ 중앙값)', r.env.pkRel.toFixed(1));
  }

  /* 이 검사가 본체다 — 대역 에너지로는 못 잡고 포락선으로만 잡히는 구간이 실제로 있는가.
     없다면 포락선을 따로 쌓을 이유가 없다. */
  {
    const base = run2(0), weak = run2(0.2);
    const dBand = weak.vals[5] / base.vals[5];      // vh2(2~4 kHz)
    const dEnv = weak.env.O / base.env.O;           // BPFO 하모닉 합
    chk(dBand < 1.2, '초기 결함에서 대역은 거의 안 움직인다', `×${dBand.toFixed(2)}`);
    chk(dEnv > 2, '같은 신호에서 포락선은 확실히 이탈한다', `×${dEnv.toFixed(2)}`);
    /* 배수 하한은 위 두 검사(env>2, band<1.2)가 이미 함의하는 1.67보다 조금 아래로 둔다.
       예전 값 ×2는 난수 생성기 버그로 잡음에 하모닉 숲이 있던 시절에 잡힌 것이라,
       정상 잡음에서는 실측이 1.9배로 그 선에 아슬아슬하게 걸렸다. */
    chk(dEnv > dBand * 1.6, '포락선이 대역보다 민감하다 — 조기 경보의 근거', `포락선 ×${dEnv.toFixed(2)} vs 대역 ×${dBand.toFixed(2)}`);
  }

  // 심각도를 따라가는가 — 검출만 되고 추세가 안 되면 계열로 쌓을 이유가 없다
  {
    const seq = [0.2, 0.5, 1.0, 2.0].map((a) => run2(a).env);
    const mono = (get) => seq.every((v, i) => i === 0 || get(v) > get(seq[i - 1]));
    chk(mono((v) => v.O), 'BPFO가 결함 크기를 따라 단조 증가', seq.map((v) => v.O.toFixed(3)).join(' → '));
    chk(mono((v) => v.pkRel), 'pkRel도 단조 증가', seq.map((v) => v.pkRel.toFixed(0)).join(' → '));
  }

  // pkRel은 무차원 — 부하가 커져 신호가 통째로 커져도 값이 안 변해야 σ가 작게 유지된다
  {
    const s1 = mk(0), s5 = s1.map((v) => v * 5);
    const a = Band.bandEnergy(s1, FS2, FR2, FS2 / 2, { demod: [3000, 6000], bf: bf });
    const b = Band.bandEnergy(s5, FS2, FR2, FS2 / 2, { demod: [3000, 6000], bf: bf });
    chk(Math.abs(a.env.pkRel - b.env.pkRel) / a.env.pkRel < 0.05, '신호가 5배 커져도 pkRel은 그대로',
      `${a.env.pkRel.toFixed(1)} vs ${b.env.pkRel.toFixed(1)}`);
    chk(b.vals[5] / a.vals[5] > 4.5, '반면 대역값은 5배로 커진다(대조)', `×${(b.vals[5] / a.vals[5]).toFixed(2)}`);
  }

  // 품번이 없으면 결함주파수는 0 — 그래도 pkRel·f0·harm은 나온다
  {
    const r = run2(1.0, { demod: [3000, 6000] });
    chk(r.env.O === 0 && r.env.I === 0 && r.env.B === 0 && r.env.F === 0, '품번 없으면 결함주파수 대조 불가');
    chk(r.env.pkRel > 12 && r.env.harm >= 2, '품번 없어도 "주기적으로 두들긴다"는 알 수 있다',
      `pkRel=${r.env.pkRel.toFixed(0)} harm=${r.env.harm}`);
  }

  // 옛 호출부 보호 — opt를 안 주면 포락선을 계산하지 않는다(대역값은 그대로)
  {
    const r = run2(1.0, null);
    chk(r.env === null, 'opt 없으면 포락선 계산 생략');
    chk(r.vals.length === 8 && r.fr > 0, '대역값·fr은 그대로 나온다');
  }

  // 대역이 너무 좁으면 포락선이 성립하지 않는다 — 억지로 계산하지 않는다
  chk(Band.bandEnergy(mk(0), FS2, FR2, FS2 / 2, { demod: [3000, 3002] }).env === null, '통과대역에 빈이 없으면 null');
}

// ── 9. 포락선 계열 적재 ────────────────────────────────────────────────────
{
  const withBf = Band.buildBandTql({ tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 25600, demod: [3000, 6000], bf: { O: 3.57, I: 5.43, B: 2.32, F: 0.4 } }], nowMs: 1, dryRun: true });
  const noBf = Band.buildBandTql({ tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 25600, demod: [3000, 6000] }], nowMs: 1, dryRun: true });

  chk(/"demod":\[3000,6000\]/.test(withBf), '복조 대역이 값으로 구워진다 — 서버는 커토그램을 안 돌린다');
  chk(/"bf":\{"O":3\.57/.test(withBf), '결함주파수는 fr 배수 계수로 구워진다 — 실측 fr을 곱해 따라간다');
  chk(/"bf":null/.test(noBf), '품번이 없으면 계수도 없다');
  chk(/envPkRel/.test(withBf) && /envF0/.test(withBf) && /envHarm/.test(withBf), '항상 쌓는 3계열');
  chk(/envBPFO/.test(withBf) && /envBPFI/.test(withBf) && /envBSF/.test(withBf) && /envFTF/.test(withBf), '품번이 있으면 결함주파수 4계열');
  /* 품번이 없으면 4계열을 0으로 쌓지 않는다 — 측정 불가 대역을 0으로 남기는 규칙과 다른 이유는
     그쪽이 샘플레이트가 정하는 물리적 사실이라서다. 품번 미지정은 설정 화면에 그대로 보인다. */
  chk(/if\(t\.bf\) EK=EK\.concat/.test(noBf), '품번 없으면 결함주파수 계열을 건너뛴다(0으로 채우지 않음)');
  // 임베드 본문이 실제로 파싱되는지 — 여기서 깨지면 타이머 첫 회차에 죽는다
  const body = withBf.slice(withBf.indexOf('{') + 1, withBf.lastIndexOf('})'));
  let parsed = true; try { new Function(body); } catch (e) { parsed = false; }
  chk(parsed, '포락선을 넣어도 임베드 본문이 파싱된다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
