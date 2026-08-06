// 대역 RMS 계산 검사 — 오프라인. npm run smoke에 포함.
// 값의 정의가 bandEnergy 하나이므로, 여기서 틀리면 학습·판정·리포트가 전부 같이 틀린다.
// 그래서 "알려진 신호를 넣어 이론값이 나오는가"로 확인한다.
globalThis.window = globalThis;
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
const run = (vals) => Band.bandEnergy(vals, FS, FR, FS / 2);

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
  const rl = rect(sine(103.7, 2), FS, FR, FS / 2);
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
  let rnd = 12345;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff * 2 - 1; };
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
  const r = lone(sine(100, 2), FS, FR, FS / 2);
  chk(near(r[idx('fault')], 2 / Math.SQRT2, 2), '계산부는 소스만으로 홀로 돈다', r[idx('fault')].toFixed(4));

  const renamed = Band.bandEnergy.toString().replace(/bandEnergy/g, 'x');
  const lone2 = new Function('return (' + renamed + ')')();
  chk(near(lone2(sine(100, 2), FS, FR, FS / 2)[idx('fault')], 2 / Math.SQRT2, 2), '이름이 바뀌어도 돈다');
}

// ── 6. 짧은 창·빈 입력 ─────────────────────────────────────────────────────
{
  chk(Band.bandEnergy([], FS, FR, FS / 2) === null, '샘플이 없으면 null');
  chk(Band.bandEnergy(sine(100, 1, 64), FS, FR, FS / 2) === null, '너무 짧으면 null — 억지로 계산하지 않는다');
  // 창이 짧아도 정의는 같다 - 분해능만 거칠어진다
  const r = Band.bandEnergy(sine(100, 2, 2048), FS, FR, FS / 2);
  chk(r && near(r[idx('fault')], 2 / Math.SQRT2, 5), '짧은 창도 진폭은 맞다', r ? r[idx('fault')].toFixed(4) : 'null');
}

// 대역 계산은 한 벌뿐이어야 한다 ─────────────────────────────────────────────
{
  /* 예전에는 화면이 별도 함수(VC.bandEnergies)로 대역 3개를 따로 계산했다. 정규화도 달라서
     알람이 난 시점의 차트를 봐도 그 상승이 안 보였다 — 같은 이름의 값이 두 벌이면 어느 쪽도
     믿을 수 없다. 두 번째 구현이 되살아나지 않게 여기서 막는다. */
  chk(typeof VC.bandEnergies === 'undefined', '대역 계산의 두 번째 구현이 없다');
  chk(typeof Band.bandEnergy === 'function', '대역 계산은 bandEnergy 하나로 정의된다');
  chk(Band.bandEnergy(sine(100, 2), FS, FR, FS / 2).length === VC.BAND_ORDER.length,
    '계산 결과 개수와 판정 순서 목록이 같다', String(VC.BAND_ORDER.length));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
