// 복조 저역 경계 스윕(50~1000 Hz, 상한 5 kHz) — 같은 오탐률(4·8/124)에 임계를 맞춘 뒤 검출·종류 적중 비교
// · 경계마다 정상 케이스로 임계 재산정(임계 고정이면 검출·오탐 동반 상승), leave-one-dataset-out 포함
// · 로컬 데이터셋 필요(D:/vibe-datasets/conv, 없으면 건너뜀)
import fs from 'node:fs';
import path from 'node:path';
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const REV = 100, HARD_CAP = 262144;
if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }
const readF64 = (p, n) => {
  const b = fs.readFileSync(p); const k = Math.min(n, b.byteLength / 8);
  const o = new Array(k); for (let i = 0; i < k; i++) o[i] = b.readDoubleLE(i * 8); return o;
};
const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };
const LOS = [1000, 750, 500, 350, 200, 100, 50];
const DATASETS = fs.readdirSync(ROOT).filter((d) => !/_seq$/.test(d) && fs.existsSync(path.join(ROOT, d, 'index.json')));

const rows = [];
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
    if (5000 > c.fs / 2 * 0.95) continue;      // 고정 상한이 성립하는 태그만(제품과 같은 조건)
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo), eMax = VC.envMaxFor(bf, fr, c.fs);
    const r = { ds, label: c.label };
    for (const lo of LOS) {
      const env = VC.envelopeSpectrum(v, c.fs, eMax, { loHz: lo, hiHz: 5000 });
      const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
      r[lo] = { r: t ? t.r || 0 : 0, k: t ? t.key || '' : '' };
    }
    rows.push(r);
  }
  console.log(`  ${ds} 완료`);
}
console.log('');

const H = rows.filter((r) => r.label === 'none'), F = rows.filter((r) => r.label !== 'none');
const S = rows.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
const dsList = [...new Set(rows.map((r) => r.ds))];

const at = (lo, FP) => {
  const v = H.map((r) => r[lo].r).sort((a, b) => b - a);
  const T = v[Math.max(0, Math.floor(v.length * FP) - 1)] + 1e-12;
  const det = F.filter((r) => r[lo].r >= T).length;
  const fired = S.filter((r) => r[lo].r >= T);
  return { T, fp: H.filter((r) => r[lo].r >= T).length,
    det, ok: fired.filter((r) => KEYMAP[r[lo].k] === r.label).length, tn: fired.length };
};

console.log(`정상 ${H.length}건 · 결함 ${F.length}건 (상한 5 kHz가 성립하는 태그만)\n`);
for (const FP of [4 / 124, 8 / 124]) {
  console.log(`── 오탐을 ${Math.round(FP * 124)}/124 (${(FP * 100).toFixed(1)}%)에 고정 ──`);
  console.log('저역경계   임계     오탐      검출          종류적중');
  for (const lo of LOS) {
    const a = at(lo, FP);
    console.log(String(lo).padStart(6) + ' Hz' + a.T.toFixed(2).padStart(7) + '   '
      + `${a.fp}/${H.length}`.padEnd(9) + `${a.det}/${F.length}`.padEnd(9)
      + String(Math.round(a.det / F.length * 100)).padStart(4) + '%   ' + `${a.ok}/${a.tn}`);
  }
  console.log('');
}

/* 데이터셋 하나를 빼고 나머지에서 경계 선택 후 뺀 셋으로 평가 — 이득의 풀 과적합 여부 확인 */
console.log('── leave-one-dataset-out (오탐 4/124 고정) ──');
console.log('빼낸 셋           고른 경계   그 셋 검출(1000 Hz 대비)');
for (const out of dsList) {
  const tr = rows.filter((r) => r.ds !== out), te = rows.filter((r) => r.ds === out);
  const trH = tr.filter((r) => r.label === 'none'), trF = tr.filter((r) => r.label !== 'none');
  let best = null;
  for (const lo of LOS) {
    const v = trH.map((r) => r[lo].r).sort((a, b) => b - a);
    const T = v[Math.max(0, Math.floor(v.length * (4 / 124)) - 1)] + 1e-12;
    const d = trF.filter((r) => r[lo].r >= T).length;
    if (!best || d > best.d) best = { lo, T, d };
  }
  const teF = te.filter((r) => r.label !== 'none');
  if (!teF.length) { console.log(out.padEnd(18) + String(best.lo).padStart(6) + ' Hz   (결함 없음)'); continue; }
  const hit = teF.filter((r) => r[best.lo].r >= best.T).length;
  const base = teF.filter((r) => r[1000].r >= (function () {
    const v = trH.map((r) => r[1000].r).sort((a, b) => b - a);
    return v[Math.max(0, Math.floor(v.length * (4 / 124)) - 1)] + 1e-12;
  })()).length;
  console.log(out.padEnd(18) + String(best.lo).padStart(6) + ' Hz   '
    + `${hit}/${teF.length}`.padEnd(9) + '(' + base + '/' + teF.length + ')'
    + (hit > base ? '  ↑' : hit < base ? '  ↓' : '  ='));
}
