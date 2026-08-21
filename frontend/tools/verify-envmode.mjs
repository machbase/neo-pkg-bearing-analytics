// 포락선 산출 방식 3종 비교 — 정류(현행) vs 해석신호 |z| vs 제곱 포락선 |z|².
// 문서엔 오래 "힐베르트"라 적혀 있었지만 구현은 정류였다. 무엇이 실제로 나은지 같은 오탐률에서 잰다.
import fs from 'node:fs';
import path from 'node:path';
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const REV = 100, HARD_CAP = 262144;
if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }

const readF64 = (p, n) => {
  const buf = fs.readFileSync(p);
  const k = Math.min(n, buf.byteLength / 8);
  const out = new Array(k);
  for (let i = 0; i < k; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
};
const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };
const MODES = ['rect', 'env', 'sq'];
const HS = [2, 3, 4, 5];

const rows = [];
// 시퀀스(run-to-failure)는 스냅샷 풀이 아니다 — 한 시험대가 표본을 지배해 비교가 기운다
const DATASETS = fs.readdirSync(ROOT).filter((d) => !/_seq$/.test(d) && fs.existsSync(path.join(ROOT, d, 'index.json')));
for (const ds of DATASETS) {
  const dir = path.join(ROOT, ds);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const name of Object.keys(meta.cases)) {
    const c = meta.cases[name];
    if (!c.geo || !c.rpm || !c.fs) continue;
    const fp = path.join(dir, name + '.f64');
    if (!fs.existsSync(fp)) continue;
    const need = Math.round(c.fs * REV / (c.rpm / 60));
    const v = readF64(fp, Math.min(HARD_CAP, fs.statSync(fp).size / 8, Math.max(16384, need)));
    if (v.length < 4096) continue;
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo);
    const band = VC.demodFixed(c.fs), eMax = VC.envMaxFor(bf, fr, c.fs);
    const r = { ds, label: c.label };
    for (const m of MODES) {
      const env = band ? VC.envelopeSpectrum(v, c.fs, eMax, band, m) : null;
      r[m] = {};
      for (const H of HS) {
        const t = env ? VC.targetedMatch(env, bf, fr, env.resTrue || env.res, H) : null;
        r[m][H] = { r: t ? t.r || 0 : 0, k: t ? t.key || '' : '' };
      }
    }
    rows.push(r);
  }
  console.log(`  ${ds} 완료`);
}
console.log('');

const FP = 5 / 124;   // 현행 오탐률에 고정
const fit = (get) => {
  const v = rows.filter((r) => r.label === 'none').map(get).sort((a, b) => b - a);
  const k = Math.max(0, Math.floor(v.length * FP) - 1);
  return v[k] != null ? v[k] + 1e-9 : Infinity;
};
console.log(`오탐을 ${(FP * 100).toFixed(1)}%(현행)에 고정하고 비교\n`);
console.log('방식   H   임계     오탐        검출          종류적중');
for (const m of MODES) {
  for (const H of HS) {
    const get = (r) => r[m][H].r;
    const T = fit(get);
    const h = rows.filter((r) => r.label === 'none'), f = rows.filter((r) => r.label !== 'none');
    const s = rows.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
    const det = f.filter((r) => get(r) >= T).length;
    const fired = s.filter((r) => get(r) >= T);
    const ok = fired.filter((r) => KEYMAP[r[m][H].k] === r.label).length;
    console.log(`${m.padEnd(6)} ${H}   ${T.toFixed(2).padStart(5)}   ${`${h.filter((r) => get(r) >= T).length}/${h.length}`.padEnd(9)}  `
      + `${`${det}/${f.length}`.padEnd(9)}${String(Math.round(det / f.length * 100)).padStart(4)}%   ${ok}/${fired.length}`);
  }
  console.log('');
}
