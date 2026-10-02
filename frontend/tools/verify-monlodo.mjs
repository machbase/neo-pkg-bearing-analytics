// 감시 임계(MON_ADOPT) 풀 과적합 여부 — leave-one-dataset-out(하나 빼고 오탐 4% 임계 산정 → 뺀 셋으로 평가)
// · 폴드별 임계 범위·홀드아웃 성적과 현재 MON_ADOPT 포함 여부 출력
// · 로컬 데이터셋 필요(D:/vibe-datasets/conv, 없으면 건너뜀)
import fs from 'node:fs';
import path from 'node:path';
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const HARD = 262144;
if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }
const readF64 = (p, n) => {
  const b = fs.readFileSync(p); const k = Math.min(n, b.byteLength / 8);
  const o = new Array(k); for (let i = 0; i < k; i++) o[i] = b.readDoubleLE(i * 8); return o;
};
const KEY = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };
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
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo);
    const band = VC.demodFixed(c.fs); if (!band) continue;
    /* 감시와 같은 창(MON_REV 회전) — 상세분석과 창이 달라 임계도 별도 산정 */
    const want = Math.round(c.fs * VC.MON_REV / fr);
    const v = readF64(fp, Math.min(HARD, fs.statSync(fp).size / 8, Math.max(4096, want)));
    if (v.length < 4096) continue;
    const env = VC.envelopeSpectrum(v, c.fs, VC.envMaxFor(bf, fr, c.fs), band);
    const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
    rows.push({ ds, label: c.label, r: t ? t.r || 0 : 0, k: t ? t.key || '' : '' });
  }
  console.log(`  ${ds} 완료`);
}
console.log('');

const FP = 4 / 100;
const fit = (rs) => {
  const v = rs.filter((r) => r.label === 'none').map((r) => r.r).sort((a, b) => b - a);
  if (!v.length) return Infinity;
  return v[Math.max(0, Math.floor(v.length * FP) - 1)] + 1e-12;
};
const evalAt = (rs, T) => {
  const h = rs.filter((r) => r.label === 'none'), f = rs.filter((r) => r.label !== 'none');
  const s = rs.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
  const fired = s.filter((r) => r.r >= T);
  return { fp: h.filter((r) => r.r >= T).length, hN: h.length,
    det: f.filter((r) => r.r >= T).length, fN: f.length,
    ok: fired.filter((r) => KEY[r.k] === r.label).length, tN: fired.length };
};

const Tall = fit(rows);
const all = evalAt(rows, Tall);
console.log(`전체 풀에서 오탐 ${Math.round(FP * 100)}%에 맞춘 임계: ${Tall.toFixed(2)}  (현재 MON_ADOPT = ${VC.MON_ADOPT})`);
console.log(`  → 오탐 ${all.fp}/${all.hN} · 검출 ${all.det}/${all.fN} (${Math.round(all.det / all.fN * 100)}%) · 종류 ${all.ok}/${all.tN}\n`);

console.log('── leave-one-dataset-out ──');
console.log('빼낸 셋           고른 임계   그 셋 오탐    그 셋 검출        종류');
const dsL = [...new Set(rows.map((r) => r.ds))];
let sFp = 0, sHn = 0, sDet = 0, sFn = 0, sOk = 0, sTn = 0;
const Ts = [];
for (const out of dsL) {
  const tr = rows.filter((r) => r.ds !== out), te = rows.filter((r) => r.ds === out);
  const T = fit(tr); Ts.push(T);
  const e = evalAt(te, T);
  sFp += e.fp; sHn += e.hN; sDet += e.det; sFn += e.fN; sOk += e.ok; sTn += e.tN;
  console.log(out.padEnd(18) + T.toFixed(2).padStart(8) + '   '
    + `${e.fp}/${e.hN}`.padEnd(11) + `${e.det}/${e.fN}`.padEnd(10)
    + (e.fN ? String(Math.round(e.det / e.fN * 100)).padStart(4) + '%' : '    -') + '   ' + `${e.ok}/${e.tN}`);
}
console.log('─────────────────────────────────────────────────────────');
console.log('홀드아웃 합계'.padEnd(18) + '        ' + '   '
  + `${sFp}/${sHn}`.padEnd(11) + `${sDet}/${sFn}`.padEnd(10)
  + String(Math.round(sDet / sFn * 100)).padStart(4) + '%   ' + `${sOk}/${sTn}`);
const lo = Math.min(...Ts), hi = Math.max(...Ts);
console.log('');
console.log(`폴드별 임계 범위 ${lo.toFixed(2)} ~ ${hi.toFixed(2)} (폭 ${((hi - lo) / ((hi + lo) / 2) * 100).toFixed(0)}%)`);
console.log(`현재 값 ${VC.MON_ADOPT}이 그 범위 ${lo <= VC.MON_ADOPT && VC.MON_ADOPT <= hi ? '안에 있음' : '밖에 있음 ← 재검토 필요'}`);
