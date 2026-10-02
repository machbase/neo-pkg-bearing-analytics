/* 근거표(_evidence)의 벨트 항목 — 벨트 제원이 있는데 벨트 주파수 피크가 없어도 근거표 생성
   · mk(라벨, [[조건, 점수, 근거문구]…])는 세 요소를 먼저 계산 → 근거문구는 조건이 확인한 값만 참조해야 함
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// 1× = 30 Hz 스펙트럼 — 벨트 통과주파수(π·d1·fr/L)·종동축(fr·d1/d2) 근처엔 일부러 피크 없음
const RPM = 1800, FR = RPM / 60;
const mkSpec = () => {
  const freqs = [], mags = [];
  for (let i = 0; i < 400; i++) {
    const f = i * 0.5;
    freqs.push(f);
    // 1×·2×에만 성분 — 저주파(벨트·종동축 대역)는 잡음 바닥
    mags.push(Math.abs(f - FR) < 0.3 ? 1.0 : Math.abs(f - 2 * FR) < 0.3 ? 0.4 : 0.001);
  }
  return { freqs, mags, res: 0.5, resTrue: 0.5, markers: [] };
};
const mkEq = (meta) => ({
  id: 'T:BELT', table: 'T', name: 'BELT', alias: 'belt', unit: 'mm/s', cls: 'II', rpm: RPM, fs: 25600,
  grade: 1, rms: 2.0, zones: [1.12, 2.8, 7.1], bearing: { model: '', n: 0, Bd: 0, Pd: 0, phi: 0 },
  meta, rollup: [], lastSeen: Date.now(),
});
const mkDet = () => {
  const sp = mkSpec();
  return {
    fft: sp, ordSpec: sp, frMeas: null, quality: {}, envQ: null, bearMatch: null,
    envelope: { freqs: [], mags: [], markers: [], hint: '' },
    cepstrum: { freqs: [], mags: [], markers: [], note: '' },
    spectral: { notes: [], cause: null }, bandKurt: null,
    indics: [], raw: { times_ms: [], values: [], fs: 25600 },
    acq: {}, dispUnit: 'mm/s', natUnit: 'mm/s',
  };
};
const mkApp = () => {
  const a = new App({ seed: 1, equipmentCount: 1 });
  a.setState = function (s) { Object.assign(this.state, s); };
  a._scheduleDraw = () => {}; a._toast = () => {};
  a.E = CH; a.live = true; a.forceUpdate = () => {};
  a.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  return a;
};

// ── 1. 벨트 제원 전부 입력 + 벨트 주파수에 피크 없음 ────────────────────────────
{
  const app = mkApp();
  const eq = mkEq({ mount: 'stud', drive: 'belt', vanes: 10, belt: { d1: 12, d2: 34, len: 565 } });
  let ev = null, err = null;
  try { ev = app._evidence(eq, mkDet()); } catch (e) { err = e; }
  chk(!err, '벨트 제원이 있는데 대조 피크가 없어도 근거표가 만들어진다', err ? String(err.message || err) : '');
  if (ev) {
    const belt = ev.conf.filter((c) => /^벨트·풀리/.test(c.f))[0];
    chk(!!belt, '벨트 후보가 목록에 있다');
    chk(belt && !belt.tags.length, '피크가 없으면 벨트 근거를 붙이지 않는다', belt ? JSON.stringify(belt.tags) : '');
    chk(belt && belt.score === 0, '근거가 없으면 점수도 0', belt ? String(belt.score) : '');
  }
}
// ── 2. 길이만 빠진 경우 — 대조 불가 사유 기록 ──────────────────────────────────
{
  const app = mkApp();
  const eq = mkEq({ mount: 'stud', drive: 'belt', belt: { d1: 12, d2: 34 } });
  let ev = null, err = null;
  try { ev = app._evidence(eq, mkDet()); } catch (e) { err = e; }
  chk(!err, '벨트길이 미입력에서도 죽지 않는다', err ? String(err.message || err) : '');
  const belt = ev && ev.conf.filter((c) => /^벨트·풀리/.test(c.f))[0];
  chk(belt && /벨트길이 미입력/.test(belt.caveat || ''), '길이 미입력을 사유로 남긴다', belt ? belt.caveat : '');
}
// ── 3. 벨트 구동이 아니면 후보 제외 ────────────────────────────────────────────
{
  const app = mkApp();
  const eq = mkEq({ mount: 'stud', drive: 'direct' });
  let ev = null, err = null;
  try { ev = app._evidence(eq, mkDet()); } catch (e) { err = e; }
  chk(!err, '직결 구동에서도 죽지 않는다', err ? String(err.message || err) : '');
  chk(ev && !ev.conf.some((c) => /^벨트·풀리/.test(c.f)), '벨트 구동이 아니면 벨트 후보를 내지 않는다');
}
// ── 4. 벨트 근거문구가 beltHit을 함께 확인하는지 소스 검사 ────────────────────
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const line = (src.split('\n').find((l) => l.includes("mk('벨트·풀리(Belt)'")) || '');
  chk(/\(beltHit && hasBeltLen\)/.test(line), '벨트 근거문구는 beltHit을 함께 확인한다', line.trim().slice(0, 90));
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
