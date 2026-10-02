/* 헤드라인 등급 불일치 건수 측정 — ISO 존 단독 등급 vs 패턴 게이트 등급(patternGate(patOn, isoGi), 앱 카드)
 * · Class I~III별 일치·과대(ISO가 더 나쁨 = 헛출동)·과소(더 좋음 = 놓침), 주요 전이 분포
 * · 로컬 데이터셋 필요(D:/vibe-datasets/conv, 없으면 건너뜀)
 */
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const REV = 100, HARD_CAP = 262144;
if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }

const readF64 = (p, n) => {
  const buf = fs.readFileSync(p); const k = Math.min(n, buf.byteLength / 8);
  const out = new Array(k); for (let i = 0; i < k; i++) out[i] = buf.readDoubleLE(i * 8); return out;
};

const rows = [];
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

    const band = VC.demodFixed(c.fs);
    let patR = 0;
    if (band) {
      const env = VC.envelopeSpectrum(v, c.fs, VC.envMaxFor(bf, fr, c.fs), band);
      const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
      patR = t ? t.r || 0 : 0;
    }
    const vel = c.unit === 'mm/s' ? v : VC.convertDomain(v, c.fs, 'g', 'mm/s', fr);
    const iso = VC.bandRmsAveraged(vel, c.fs, 10, 1000, 8).rms;
    rows.push({ ds, label: c.label, patOn: patR >= VC.TGT_ADOPT, iso });
  }
  console.log(`  ${ds} 완료`);
}

const G = ['양호', '주의', '위험', '심각'];
const CLASSES = { I: [0.71, 1.8, 4.5], II: [1.12, 2.8, 7.1], III: [1.8, 4.5, 11.2] };

for (const [CLS, Z] of Object.entries(CLASSES)) {
  let n = 0, same = 0, over = 0, under = 0;
  const cell = {}; // 'ISO등급→게이트등급' 분포
  let hOver = 0, hN = 0, fUnder = 0, fN = 0;
  for (const r of rows) {
    const isoG = VC.gradeFor(r.iso, Z);          // ISO 존 단독 등급
    const gate = VC.patternGate(r.patOn, isoG);  // 패턴 게이트 등급(앱 카드)
    n++;
    const healthy = r.label === 'none';
    if (healthy) hN++; else fN++;
    if (isoG === gate) { same++; continue; }
    const k = `${G[isoG]} → ${G[gate]}`;
    cell[k] = (cell[k] || 0) + 1;
    if (isoG > gate) { over++; if (healthy) hOver++; }
    else { under++; if (!healthy) fUnder++; }
  }
  console.log(`\n━━ Class ${CLS} — 전체 ${n}건 ━━`);
  console.log(`  두 문서가 같은 등급        ${same}건 (${(same / n * 100).toFixed(0)}%)`);
  console.log(`  리포트가 더 나쁘게 부름    ${over}건 (${(over / n * 100).toFixed(0)}%)  ← 헛출동`);
  console.log(`    그중 실제 정상 설비      ${hOver}/${hN}건 (정상의 ${(hOver / hN * 100).toFixed(0)}%)`);
  console.log(`  리포트가 더 좋게 부름      ${under}건 (${(under / n * 100).toFixed(0)}%)  ← 놓침`);
  console.log(`    그중 실제 결함 설비      ${fUnder}/${fN}건 (결함의 ${(fUnder / fN * 100).toFixed(0)}%)`);
  const top = Object.entries(cell).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) console.log('  주요 전이: ' + top.map(([k, v]) => `${k} ${v}건`).join(' · '));
}
