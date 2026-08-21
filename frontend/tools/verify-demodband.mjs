// 복조 대역 선택 방식 비교 — 커토그램이 고른 대역 vs 고정 대역들.
//
// 베이스라인에서 검출률이 데이터셋마다 1%~82%로 갈렸는데, 갈림의 방향이 커토그램이 고른
// 대역과 나란했다: 낮은 대역(<5 kHz)을 고른 셋은 잘 잡고, 높은 대역(>10 kHz)을 고른 셋은 못 잡았다.
// 그것이 원인인지 상관인지는 대역을 강제로 바꿔 봐야 갈린다.
//
// 함정 주의: 대역을 여러 개 놓고 결함에서 최댓값을 고르면 그것이 다중비교다.
// 그래서 모든 대역을 모든 데이터셋에 대해 "결함 검출 / 정상 오탐" 쌍으로 같이 인쇄한다.
// 하나의 규칙이 여러 데이터셋에서 동시에 나아지고 오탐이 안 늘 때만 채택 후보다.
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const MAX_N = 65536;
if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }

const readF64 = (p, cap) => {
  const buf = fs.readFileSync(p);
  const n = Math.min(cap, buf.byteLength / 8);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
};

// 후보 대역 — 절대 주파수 고정(kHz)과 Nyquist 비율 두 갈래.
// MFPT 참조 구현이 2~4 kHz를 쓰는 것이 고정 대역 쪽의 근거다.
const FIXED = [
  { key: 'kg', label: '커토그램(현행)' },
  { key: 'f1-5', label: '1~5 kHz', lo: 1000, hi: 5000 },
  { key: 'f2-4', label: '2~4 kHz(MFPT식)', lo: 2000, hi: 4000 },
  { key: 'f3-10', label: '3~10 kHz', lo: 3000, hi: 10000 },
  { key: 'kgLow', label: '커토그램(≤6kHz 한정)', cap: 6000 },
];
const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };

function run(v, fs_, rpm, geo, variant) {
  const fr = rpm / 60;
  const bf = VC.bearingFreqs(rpm, geo);
  const nyq = fs_ / 2;
  let band = null;
  if (variant.key === 'kg' || variant.key === 'kgLow') {
    const cap = Math.min(nyq * VC.KG_NYQ_FRAC, variant.cap || Infinity);
    const kg = VC.kurtogram(v, fs_, cap);
    band = kg && kg.best ? { loHz: kg.best.loHz, hiHz: kg.best.hiHz } : null;
  } else {
    if (variant.hi > nyq * 0.95) return null;   // 이 샘플링에선 성립 안 하는 대역
    band = { loHz: variant.lo, hiHz: variant.hi };
  }
  const env = VC.envelopeSpectrum(v, fs_, Math.max(500, 12 * fr), band);
  const envQ = VC.envelopeQuant(env.freqs, env.mags, fr);
  const bm = VC.bearingMatch(envQ, bf, fr, env.resTrue || env.res);
  return bm;
}

const datasets = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.json')));
const tally = {};
for (const v of FIXED) tally[v.key] = {};

for (const ds of datasets) {
  const dir = path.join(ROOT, ds);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const v of FIXED) tally[v.key][ds] = { hN: 0, hHit: 0, fN: 0, fHit: 0, tN: 0, tOk: 0, na: 0 };

  for (const name of Object.keys(meta.cases)) {
    const c = meta.cases[name];
    if (!c.geo || !c.rpm || !c.fs) continue;
    const f = path.join(dir, name + '.f64');
    if (!fs.existsSync(f)) continue;
    const sig = readF64(f, MAX_N);
    if (sig.length < 4096) continue;
    const healthy = c.label === 'none';
    for (const variant of FIXED) {
      const t = tally[variant.key][ds];
      const bm = run(sig, c.fs, c.rpm, c.geo, variant);
      if (!bm) { t.na++; continue; }
      const hit = bm.hit;
      if (healthy) { t.hN++; if (hit) t.hHit++; }
      else {
        t.fN++;
        if (hit) {
          t.fHit++;
          if (c.label === 'OR' || c.label === 'IR' || c.label === 'BALL') {
            t.tN++; if (KEYMAP[hit.key] === c.label) t.tOk++;
          }
        }
      }
    }
  }
  console.log(`  ${ds} 끝`);
}

const pc = (a, b) => (b ? String(Math.round((a / b) * 100)).padStart(3) + '%' : '  -');
console.log('');
console.log('결함 검출률 (괄호는 정상 오탐)');
console.log(''.padEnd(22) + datasets.map((d) => d.padStart(16)).join(''));
for (const v of FIXED) {
  let line = v.label.padEnd(22);
  for (const ds of datasets) {
    const t = tally[v.key][ds];
    line += (t.fN ? `${pc(t.fHit, t.fN)} (${pc(t.hHit, t.hN)})` : (t.na ? '     대역불가' : '')).padStart(16);
  }
  console.log(line);
}
console.log('');
console.log('전체 합계');
console.log('%-22s %-14s %-14s %s', '방식', '결함 검출', '정상 오탐', '종류 적중');
for (const v of FIXED) {
  const s = datasets.reduce((a, ds) => {
    const t = tally[v.key][ds];
    return { hN: a.hN + t.hN, hHit: a.hHit + t.hHit, fN: a.fN + t.fN, fHit: a.fHit + t.fHit, tN: a.tN + t.tN, tOk: a.tOk + t.tOk, na: a.na + t.na };
  }, { hN: 0, hHit: 0, fN: 0, fHit: 0, tN: 0, tOk: 0, na: 0 });
  console.log(`${v.label.padEnd(22)} ${`${s.fHit}/${s.fN}`.padEnd(9)}${pc(s.fHit, s.fN)}   ${`${s.hHit}/${s.hN}`.padEnd(8)}${pc(s.hHit, s.hN)}   ${`${s.tOk}/${s.tN}`.padEnd(8)}${pc(s.tOk, s.tN)}${s.na ? `   (대역불가 ${s.na})` : ''}`);
}
