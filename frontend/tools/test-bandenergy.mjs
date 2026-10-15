// 대역 RMS 계산(bandEnergy) — 알려진 신호를 넣어 이론값 확인(학습·판정·리포트 공통의 단일 정의)
// · 진폭·대역 분리·DC/드리프트·흔들림·단독 실행·1× 실측 경계(입력 ±5%·계통주파수 거부, calc.measuredOneX와 같은 규칙)·포락선 복조·TQL 적재
// 오프라인(Neo 불필요) · npm run smoke 포함
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

// ── 1. 진폭 정확도 ─────────────────────────────────────────────────────────
{
  /* 진폭 A 사인의 RMS = A/√2 — 창으로 깎인 만큼 잡음대역폭으로 보정(누락 시 Hann에서 √(3/8)배) */
  /* 103.7 Hz — 일부러 FFT 빈에서 벗어난 주파수(빈에 맞으면 사각창도 누설 0이라 창 유무 구분 불가) */
  const r = run(sine(103.7, 2));             // fault 대역(45~300)
  const want = 2 / Math.SQRT2;
  chk(near(r[idx('fault')], want, 2), '사인 1개의 대역 RMS = A/√2', `${r[idx('fault')].toFixed(4)} vs ${want.toFixed(4)}`);

  // 이웃 대역 누설 없음(Hann 창의 목적)
  const leak = Math.max(r[idx('sub')], r[idx('one')], r[idx('high')]);
  chk(leak < want * 1e-6, '이웃 대역으로 새지 않는다', `누설 최대 ${leak.toExponential(2)}`);

  /* 사각창 대조 — 사각창은 1× 큰 성분을 베어링 대역으로 흘려 헛경보 유발 */
  const rect = new Function('return (' + Band.bandEnergy.toString()
    .replace('W[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / L)', 'W[i] = 1') + ')')();
  const rl = rect(sine(103.7, 2), FS, FR, FS / 2).vals;
  const leakRect = Math.max(rl[idx('sub')], rl[idx('one')], rl[idx('high')]);
  chk(leakRect > leak * 1000, '사각창이었다면 훨씬 많이 샜다', `사각 ${leakRect.toExponential(2)} vs Hann ${leak.toExponential(2)}`);
}

// ── 2. 대역별 에너지 분리 ──────────────────────────────────────────────────
{
  // 1×(30 Hz, one) + 고주파(500 Hz, high) 동시 — 각자 제 대역에서만 잡힘
  const r = run(add(sine(30, 1), sine(500, 3)));
  chk(near(r[idx('one')], 1 / Math.SQRT2, 3), '1× 성분이 one 대역에 잡힌다', r[idx('one')].toFixed(4));
  chk(near(r[idx('high')], 3 / Math.SQRT2, 3), '고주파 성분이 high 대역에 잡힌다', r[idx('high')].toFixed(4));
  chk(r[idx('fault')] < 0.05, '사이 대역은 조용하다', r[idx('fault')].toExponential(2));

  /* 에너지는 제곱으로 합산 — 대역 RMS 제곱합의 √ = 전체 AC RMS */
  const total = Math.sqrt(r.reduce((s, v) => s + v * v, 0));
  const want = Math.sqrt((1 / Math.SQRT2) ** 2 + (3 / Math.SQRT2) ** 2);
  chk(near(total, want, 3), '대역 제곱합 = 전체 AC RMS', `${total.toFixed(4)} vs ${want.toFixed(4)}`);
}

// ── 3. DC·드리프트 내성 ────────────────────────────────────────────────────
{
  const base = sine(100, 2);
  const dc = base.map((v) => v + 50);                                  // 큰 직류 오프셋
  const drift = base.map((v, i) => v + 5 * i / N);                     // 느린 드리프트
  const r0 = run(base), rDc = run(dc), rDr = run(drift);
  chk(near(rDc[idx('fault')], r0[idx('fault')], 1), 'DC 오프셋이 대역값을 바꾸지 않는다', rDc[idx('fault')].toFixed(4));
  /* 드리프트는 창 양끝 불연속으로 나타남 — Hann이 양끝을 0으로 눕혀 저주파 누설(헛경보) 차단 */
  chk(rDr[idx('sub')] < 0.05, '느린 드리프트가 최저 대역을 들어올리지 않는다', rDr[idx('sub')].toExponential(2));
}

// ── 4. 대역값 흔들림(변동계수) ─────────────────────────────────────────────
{
  /* 잡음 신호 대역값을 반복 측정해 변동계수 확인 — 출렁이면 대역 베이스라인 σ가 커져 한계가 느슨해짐 */
    const rand = mulberry32(12345);
  const vals = [];
  for (let t = 0; t < 20; t++) {
    const noise = new Array(N); for (let i = 0; i < N; i++) noise[i] = rand();
    vals.push(run(noise)[idx('fault')]);
  }
  const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mu) ** 2, 0) / vals.length);
  const cv = sd / mu * 100;
  /* 창 전체 단일 FFT — 대역 하나에 빈이 수백~수천 개라 이미 평균됨(Welch 블록 분할 불필요) */
  chk(cv < 2, '잡음 신호의 대역값이 흔들리지 않는다', `CV ${cv.toFixed(2)}%`);
}

// ── 5. 단독 실행(소스만으로) ───────────────────────────────────────────────
{
  /* TQL엔 이 파일의 다른 이름이 없음 — 바깥 이름 참조 시 타이머 첫 회차 ReferenceError(등록은 성공해 화면엔 무표시) */
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
  // 짧은 창도 정의는 같음 — 분해능만 거칠어짐
  const r = Band.bandEnergy(sine(100, 2, 2048), FS, FR, FS / 2);
  chk(r && near(r.vals[idx('fault')], 2 / Math.SQRT2, 5), '짧은 창도 진폭은 맞다', r ? r.vals[idx('fault')].toFixed(4) : 'null');
}

// 대역 계산은 한 벌뿐 ───────────────────────────────────────────────────────
{
  /* 두 번째 구현(VC.bandEnergies) 부재 확인 — 같은 이름의 값이 두 벌이면 차트와 알람이 어긋남 */
  chk(typeof VC.bandEnergies === 'undefined', '대역 계산의 두 번째 구현이 없다');
  chk(typeof Band.bandEnergy === 'function', '대역 계산은 bandEnergy 하나로 정의된다');
  /* 계산 결과 = 주파수 대역(BAND_FREQ), 판정 목록(BAND_ORDER)은 포락선 계열까지 포함해 더 김
     · 혼용하면 인덱스로 경계를 읽는 곳이 어긋남 */
  chk(Band.bandEnergy(sine(100, 2), FS, FR, FS / 2).vals.length === VC.BAND_FREQ.length,
    '계산 결과 개수와 주파수 대역 목록이 같다', String(VC.BAND_FREQ.length));
  chk(VC.BAND_ORDER.slice(0, VC.BAND_FREQ.length).join() === VC.BAND_FREQ.join(),
    '판정 목록은 주파수 대역으로 시작한다 — 인덱스 앞부분이 대역 경계와 1:1', VC.BAND_ORDER.join(','));
  chk(VC.BAND_ORDER.length > VC.BAND_FREQ.length, '판정 목록에 포락선 계열이 붙어 있다',
    VC.BAND_ORDER.slice(VC.BAND_FREQ.length).join(','));
  // 저장 전용 계열(BAND_CTX)은 판정 목록 제외 — "몇 Hz인가"를 이탈로 판정하지 않게
  chk(VC.BAND_CTX.every((bn) => VC.BAND_ORDER.indexOf(bn) < 0), '저장 전용 계열은 판정하지 않는다', VC.BAND_CTX.join(','));
  chk(VC.BAND_ORDER.concat(VC.BAND_CTX).every((bn) => !!VC.BAND_KO[bn]), '모든 계열에 한글 라벨이 있다');
}

// 압축된 이름 함정 ────────────────────────────────────────────────────────
{
  /* 계산부 소스를 문자열로 TQL에 삽입 — 번들 압축으로 함수 이름이 바뀌므로 고정 별칭(__bandEnergy)으로 선언·호출
     · 어긋나면 TQL 첫 태그에서 ReferenceError, 타이머는 RUNNING인 채 표만 빔 */
  const tql = Band.buildBandTql({ tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 2048 }], nowMs: 1 });
  chk(tql.includes('var __bandEnergy=function'), '고정 별칭으로 선언한다');
  chk(tql.includes('var vv=__bandEnergy('), '호출도 같은 별칭을 쓴다');
  /* 핵심 검사 — 생성 코드에 실제 함수 이름이 없어야 함(node에선 이름이 안 바뀌어 결과 비교로는 못 잡음) */
  // 별칭(__bandEnergy)이 이름을 포함 — 앞 글자가 식별자가 아닐 때만 호출로 판정
  const body = tql.slice(tql.indexOf('var __bandEnergy=') + 60);
  const calls = new RegExp('(^|[^A-Za-z0-9_$])' + Band.bandEnergy.name + '\\(');
  chk(!calls.test(body), '생성된 코드가 실제 함수 이름을 부르지 않는다', Band.bandEnergy.name);
}

// ── 7. 1× 실측과 대역 경계 ─────────────────────────────────────────────────
/* 대역 경계는 1× 상대(0.5×·1.5×·10×) — fr이 어긋나면 대역이 통째로 밀림
   · 명판(동기속도)은 슬립·가변속만큼 어긋나므로 창 안의 1×를 실측 */
{
  const be = (vals, frNom = FR) => Band.bandEnergy(vals, FS, frNom, FS / 2);

  // 슬립 — 명판 30인데 실제 28.8 Hz(4% 느림)
  let r = be(sine(28.8, 2));
  chk(r.meas, '입력 ±5% 안의 1×를 찾는다');
  chk(near(r.fr, 28.8, 0.5), '실측 1× = 28.8 Hz', r.fr.toFixed(3));

  /* 경계 추종 확인 — 44 Hz는 명판 30 기준이면 1×대역(15~45), 실측 28.8 기준이면 결함대역(43.2~288)
     · 결함 대역으로 가면 경계가 실측을 따라간 것 */
  r = be(add(sine(28.8, 1), sine(44, 1)));
  chk(near(r.fr, 28.8, 0.5), '다른 성분이 있어도 창 안의 1×를 고른다', r.fr.toFixed(3));
  chk(near(r.vals[idx('fault')], 1 / Math.SQRT2, 3), '44 Hz가 결함 대역으로 간다(경계가 따라감)', r.vals[idx('fault')].toFixed(4));
  chk(near(r.vals[idx('one')], 1 / Math.SQRT2, 3), '1× 대역에는 28.8 Hz만 남는다', r.vals[idx('one')].toFixed(4));

  /* 다른 회전체 — 실제 1×(30, 약함) 옆 −11%의 더 큰 봉우리(벨트로 이어진 모터 등)는 1×로 잡지 않음 */
  r = be(add(sine(26.7, 3), sine(30, 0.5)));
  chk(r.meas && near(r.fr, 30, 0.5), '±5% 밖의 다른 회전체 봉우리는 1×로 잡지 않는다(예전: 26.7)', r.fr.toFixed(3));

  /* 2극 전동기 — 명판 59.5 Hz, 60 Hz 전기 성분이 실제 1×(59.2)보다 큼
     · 계통주파수를 주면 거부하고 입력 RPM, 안 주면 60 Hz를 1×로 */
  const two = add(sine(60, 3), sine(59.2, 0.3));
  r = Band.bandEnergy(two, FS, 59.5, FS / 2, { lineHz: 60 });
  chk(!r.meas && r.fr === 59.5, '계통주파수(60 Hz) 봉우리는 1×로 잡지 않는다 — 입력 RPM 사용', r.fr.toFixed(2));
  chk(Band.bandEnergy(two, FS, 59.5, FS / 2).fr === 60 || near(Band.bandEnergy(two, FS, 59.5, FS / 2).fr, 60, 0.2), '(계통주파수를 안 주면 60 Hz를 1×로 — 거부는 lineHz로만)');

  // 입력이 5% 넘게 틀리면 실제 1×(8% 위)를 따라가지 않음 — 입력 RPM 사용(대가: RPM은 바로 입력해야 함)
  r = be(sine(32.4, 2));
  chk(!r.meas && r.fr === FR, '입력이 8% 틀리면 따라가지 않고 입력 RPM(예전: 32.4 실측)', r.fr.toFixed(2));

  // 잡음만 있으면 실측 안 함 — 잡음 봉우리를 물면 앵커마다 경계가 흔들림
    const rand = mulberry32(987654);
  const noise = new Array(N); for (let i = 0; i < N; i++) noise[i] = rand();
  r = be(noise);
  chk(!r.meas, '잡음만 있으면 실측하지 않는다');
  chk(r.fr === FR, '못 찾으면 명판을 그대로 쓴다', String(r.fr));

  // 20회 반복 중 한 번도 물지 않아야 함(가끔 물면 회차마다 경계가 달라짐)
  let bit = 0;
  for (let t = 0; t < 20; t++) {
    const nz = new Array(N); for (let i = 0; i < N; i++) nz[i] = rand();
    if (be(nz).meas) bit++;
  }
  chk(bit === 0, '잡음 20회에서 한 번도 물지 않는다', bit + '/20');

  // 명판이 크게 틀리면 창 밖이라 못 찾음 — 명판으로 폴백
  r = be(sine(60, 2), 30);
  chk(!r.meas && r.fr === 30, '명판이 크게 틀리면 못 찾고 명판을 쓴다', r.fr.toFixed(1));

  // 1× 없는 설비(잘 정렬된 기계)도 명판으로 폴백
  r = be(sine(500, 2));
  chk(!r.meas && r.fr === FR, '1× 성분이 없으면 명판', r.fr.toFixed(1));

  /* 포물선 보간 — 빈 간격 오차(30 Hz 근처 수 %)가 보정하려는 슬립과 같은 크기라 빈보다 세밀하게 추정 */
  r = Band.bandEnergy(sine(28.6, 2, 2048), FS, FR, FS / 2);   // 창 2048 → 빈 간격 1 Hz
  chk(r.meas && near(r.fr, 28.6, 2), '빈 간격보다 세밀하게 잡는다', r.fr.toFixed(3));

  // 저장 fr = 이 앵커의 경계를 정한 값(명판 아님)
  const tql = Band.buildBandTql({ tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 2048 }], nowMs: 1, dryRun: true });
  chk(/var fr=vv\.fr;/.test(tql), '저장하는 fr은 경계를 정한 값(명판 아님)');
  chk(!/var fr=t\.fr;/.test(tql), '명판을 그대로 저장하지 않는다');
  chk(/lineHz:t\.lineHz/.test(tql), '서버 대역 추출에도 계통주파수 전달');

  // 호출측 — 서버 타이머 스펙(앱)·상세분석 추이(live) 모두 설정의 계통주파수를 넘김
  const { App } = await import('../src/app.js');
  const app = new App({ seed: 7, equipmentCount: 1 });
  app._applied = Object.assign({}, app.state, { lineHz: '50' });
  app._activeEqs = () => [{ id: 'T:A', table: 'T', name: 'A', fs: 25600, rpm: 1500, meta: {} }];
  const bt = app._bandTags().tags[0];
  chk(bt && bt.lineHz === 50, '서버 타이머 스펙에 설정의 계통주파수(50 Hz)', JSON.stringify(bt && bt.lineHz));
  // 스펙 → 생성 TQL의 태그 목록까지 — 호출문만 보면 TAGS에서 빠져도 통과(서버에선 undefined로 거부 미적용)
  const tq = Band.buildBandTql({ tags: [bt], nowMs: 1, dryRun: true });
  const tagsJs = (/var TAGS=(\[.*?\]);/.exec(tq) || [])[1];
  chk(tagsJs && JSON.parse(tagsJs)[0].lineHz === 50, '생성 TQL의 태그 목록에도 계통주파수(50 Hz)', tagsJs && tagsJs.slice(0, 120));
  const DB = (await import('../../cgi-bin/db/db.js')).default;
  const { loadTrendChunks } = await import('../src/data/live.js');
  const keep = { rawWindow: DB.rawWindow, bandTrend: DB.bandTrend, be: Band.bandEnergy };
  let seenOpt = null;
  DB.rawWindow = () => Promise.resolve({ values: sine(25, 1, 4096) });
  DB.bandTrend = () => Promise.resolve([]);
  Band.bandEnergy = (v, f, r, n, o) => { seenOpt = o; return keep.be(v, f, r, n, o); };
  const CHs = (await import('../../cgi-bin/chart/chart.js')).default;
  await loadTrendChunks(CHs, { table: 'T', name: 'A', fs: FS, rpm: 1500, meta: { lineHz: 50 } }, [{ ms: 1e12 }, { ms: 1e12 + 60000 }]);
  Object.assign(DB, { rawWindow: keep.rawWindow, bandTrend: keep.bandTrend }); Band.bandEnergy = keep.be;
  chk(seenOpt && seenOpt.lineHz === 50, '상세분석 대역 추이도 같은 계통주파수로 계산', JSON.stringify(seenOpt));
}

// ── 8. 포락선 복조 ─────────────────────────────────────────────────────────
/* 베어링 결함 충격은 구조 공진을 진폭 변조 — 복조해야 반복주파수가 선으로 드러남
   · "고주파가 셈"과 "주기적으로 두들김"의 구분이 목적 */
{
  const FS2 = 25600, N2 = 32768, FR2 = 30;
  const bf = VC.faultCoeffs(VC.BEARINGS['6206']);
  const fBPFO = bf.O * FR2;
    const rand = mulberry32(4242);

  /* 합성 신호: 1× 정현파 + 광대역 잡음 + BPFO 주기 4 kHz 공진 충격열
     · 잡음 필수(순수 합성은 어떤 지표든 잘 보여 잡음에 묻히는지 검사 불가) */
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

  // 결함주파수 계수 — fr 배수로 굽기(서버가 앵커마다 fr 실측)
  chk(Math.abs(bf.O - 3.5707) < 1e-3 && Math.abs(bf.I - 5.4293) < 1e-3, '6206 결함주파수 계수', `O=${bf.O.toFixed(4)} I=${bf.I.toFixed(4)}`);
  chk(Math.abs(bf.O + bf.I - 9) < 1e-9, 'BPFO + BPFI = 볼 개수 × fr (형상 항등식)', String(bf.O + bf.I));
  chk(VC.faultCoeffs(VC.BEARINGS.sleeve) === null && VC.faultCoeffs(null) === null, '구름체가 없으면 결함주파수도 없다');

  // 복조 대역 — 마운팅 상한 아래 최상위 옥타브(추세엔 고정 대역이 필요해 커토그램 미사용)
  chk(JSON.stringify(VC.demodBand(25600, 'stud')) === '[5000,10000]', '스터드(10 kHz): [5k, 10k]', JSON.stringify(VC.demodBand(25600, 'stud')));
  chk(JSON.stringify(VC.demodBand(25600, 'magnet')) === '[1000,2000]', '자석(2 kHz): [1k, 2k]', JSON.stringify(VC.demodBand(25600, 'magnet')));
  chk(JSON.stringify(VC.demodBand(25600, '')) === '[6400,12800]', '마운팅 미상이면 Nyquist 기준', JSON.stringify(VC.demodBand(25600, '')));
  chk(VC.demodBand(500, 'stud') === null, '상단이 너무 낮으면 복조 대역이 성립하지 않는다');
  // 같은 마운팅이면 항상 같은 값 — 추세 성립 근거
  chk(JSON.stringify(VC.demodBand(25600, 'stud')) === JSON.stringify(VC.demodBand(25600, 'stud')), '결정론적 — 앵커마다 같은 대역');

  // 결함 검출
  {
    const r = run2(1.0);
    chk(r.env !== null, '복조 대역을 주면 포락선 지표가 나온다');
    chk(Math.abs(r.env.f0 - fBPFO) < 1.5, `지배 반복주파수 = BPFO ${fBPFO.toFixed(1)} Hz`, r.env.f0.toFixed(2));
    chk(r.env.harm >= 2, '하모닉이 정수배로 선다 — 단발 스파이크와 구분되는 지점', String(r.env.harm));
    chk(r.env.O > r.env.I * 2 && r.env.O > r.env.B * 2, '외륜 결함이 BPFI·BSF보다 크게 나온다',
      `O=${r.env.O.toFixed(4)} I=${r.env.I.toFixed(4)} B=${r.env.B.toFixed(4)}`);
  }

  // 잡음 무검출 — 뚫리면 앵커마다 헛것을 물어 추세 붕괴
  {
    const r = run2(0);
    chk(r.env.harm === 0, '잡음만 있으면 하모닉이 서지 않는다', String(r.env.harm));
    chk(r.env.pkRel < 12, '잡음의 포락선은 뾰족하지 않다(피크 ÷ 중앙값)', r.env.pkRel.toFixed(1));
  }

  /* 핵심 검사 — 대역 에너지로는 못 잡고 포락선으로만 잡히는 구간 존재 확인(포락선을 따로 쌓는 근거) */
  {
    const base = run2(0), weak = run2(0.2);
    const dBand = weak.vals[5] / base.vals[5];      // vh2(2~4 kHz)
    const dEnv = weak.env.O / base.env.O;           // BPFO 하모닉 합
    chk(dBand < 1.2, '초기 결함에서 대역은 거의 안 움직인다', `×${dBand.toFixed(2)}`);
    chk(dEnv > 2, '같은 신호에서 포락선은 확실히 이탈한다', `×${dEnv.toFixed(2)}`);
    /* 배수 하한 1.6 — 위 두 검사(env>2, band<1.2)가 함의하는 1.67보다 조금 아래 */
    chk(dEnv > dBand * 1.6, '포락선이 대역보다 민감하다 — 조기 경보의 근거', `포락선 ×${dEnv.toFixed(2)} vs 대역 ×${dBand.toFixed(2)}`);
  }

  // 심각도 추종 — 결함 크기에 따라 단조 증가해야 계열로 쌓을 의미가 있음
  {
    const seq = [0.2, 0.5, 1.0, 2.0].map((a) => run2(a).env);
    const mono = (get) => seq.every((v, i) => i === 0 || get(v) > get(seq[i - 1]));
    chk(mono((v) => v.O), 'BPFO가 결함 크기를 따라 단조 증가', seq.map((v) => v.O.toFixed(3)).join(' → '));
    chk(mono((v) => v.pkRel), 'pkRel도 단조 증가', seq.map((v) => v.pkRel.toFixed(0)).join(' → '));
  }

  // pkRel은 무차원 — 신호가 통째로 커져도 불변(σ 작게 유지)
  {
    const s1 = mk(0), s5 = s1.map((v) => v * 5);
    const a = Band.bandEnergy(s1, FS2, FR2, FS2 / 2, { demod: [3000, 6000], bf: bf });
    const b = Band.bandEnergy(s5, FS2, FR2, FS2 / 2, { demod: [3000, 6000], bf: bf });
    chk(Math.abs(a.env.pkRel - b.env.pkRel) / a.env.pkRel < 0.05, '신호가 5배 커져도 pkRel은 그대로',
      `${a.env.pkRel.toFixed(1)} vs ${b.env.pkRel.toFixed(1)}`);
    chk(b.vals[5] / a.vals[5] > 4.5, '반면 대역값은 5배로 커진다(대조)', `×${(b.vals[5] / a.vals[5]).toFixed(2)}`);
  }

  // 품번 없으면 결함주파수 0 — pkRel·f0·harm은 산출
  {
    const r = run2(1.0, { demod: [3000, 6000] });
    chk(r.env.O === 0 && r.env.I === 0 && r.env.B === 0 && r.env.F === 0, '품번 없으면 결함주파수 대조 불가');
    chk(r.env.pkRel > 12 && r.env.harm >= 2, '품번 없어도 "주기적으로 두들긴다"는 알 수 있다',
      `pkRel=${r.env.pkRel.toFixed(0)} harm=${r.env.harm}`);
  }

  // opt 없는 호출 — 포락선 계산 생략(대역값은 그대로)
  {
    const r = run2(1.0, null);
    chk(r.env === null, 'opt 없으면 포락선 계산 생략');
    chk(r.vals.length === 8 && r.fr > 0, '대역값·fr은 그대로 나온다');
  }

  // 대역이 너무 좁으면 포락선 불성립 — null
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
  /* 품번 없으면 결함주파수 4계열을 0으로 쌓지 않음(측정 불가 대역의 0 기록은 샘플레이트가 정하는 물리적 사실이라 별개) */
  chk(/if\(t\.bf\) EK=EK\.concat/.test(noBf), '품번 없으면 결함주파수 계열을 건너뛴다(0으로 채우지 않음)');
  // 임베드 본문 파싱 확인 — 깨지면 타이머 첫 회차에 죽음
  const body = withBf.slice(withBf.indexOf('{') + 1, withBf.lastIndexOf('})'));
  let parsed = true; try { new Function(body); } catch (e) { parsed = false; }
  chk(parsed, '포락선을 넣어도 임베드 본문이 파싱된다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
