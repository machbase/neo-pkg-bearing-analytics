// 커토그램이 복조 대역을 고르는 방식 비교 — 첨도를 무엇에 거는가로 갈린다.
//
// 'real'(현행)은 **실수** 대역통과 신호의 첨도다. Antoni의 SK는 해석 신호(복소 포락선)의 것이라
// 이건 SK가 아니다. 순수 정현파의 실수 첨도는 1.5라, 이산 톤이 있는 대역(=찾으려는 구조 공진)이
// 목적함수에서 구조적으로 불리하고 톤 없는 잡음 대역이 유리하다.
// "커토그램은 11%로 진다"가 방법의 성적인지 이 구현의 성적인지 여기서 갈린다.
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
const VARIANTS = [
  { key: 'fix', label: '고정 1–5 kHz(현행)' },
  { key: 'real', label: '커토그램 real(옛 구현)' },
  { key: 'env', label: '커토그램 |z| 첨도' },
  { key: 'ck', label: '커토그램 복소 SK' },
];
// 시퀀스(run-to-failure)는 스냅샷 풀이 아니다 — 한 시험대가 표본을 지배해 비교가 기운다
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
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo);
    const eMax = VC.envMaxFor(bf, fr, c.fs), cap = c.fs / 2 * VC.KG_NYQ_FRAC;
    const r = { ds, label: c.label };
    for (const va of VARIANTS) {
      let band = null;
      if (va.key === 'fix') band = VC.demodFixed(c.fs);
      else {
        const kg = VC.kurtogram(v, c.fs, cap, va.key);
        band = kg && kg.best ? { loHz: kg.best.loHz, hiHz: kg.best.hiHz } : null;
      }
      if (!band) { r[va.key] = { r: 0, k: '', c: 0 }; continue; }
      const env = VC.envelopeSpectrum(v, c.fs, eMax, band);
      const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
      r[va.key] = { r: t ? t.r || 0 : 0, k: t ? t.key || '' : '', c: (band.loHz + band.hiHz) / 2 };
    }
    rows.push(r);
  }
  console.log(`  ${ds} 완료`);
}
console.log('');

const FP = 4 / 124;   // 현행 오탐률에 고정
console.log(`오탐을 ${(FP * 100).toFixed(1)}%(현행)에 고정하고 비교 · 케이스 ${rows.length}건\n`);
console.log('방식                     임계     오탐        검출          종류적중  선택대역 중앙값');
for (const va of VARIANTS) {
  const get = (r) => r[va.key].r;
  const hv = rows.filter((r) => r.label === 'none').map(get).sort((a, b) => b - a);
  const T = hv[Math.max(0, Math.floor(hv.length * FP) - 1)] + 1e-9;
  const h = rows.filter((r) => r.label === 'none'), f = rows.filter((r) => r.label !== 'none');
  const s = rows.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
  const det = f.filter((r) => get(r) >= T).length;
  const fired = s.filter((r) => get(r) >= T);
  const ok = fired.filter((r) => KEYMAP[r[va.key].k] === r.label).length;
  const cs = rows.map((r) => r[va.key].c).filter((x) => x > 0).sort((a, b) => a - b);
  console.log(va.label.padEnd(24) + T.toFixed(2).padStart(5) + '   '
    + `${h.filter((r) => get(r) >= T).length}/${h.length}`.padEnd(9) + '  '
    + `${det}/${f.length}`.padEnd(9) + String(Math.round(det / f.length * 100)).padStart(4) + '%   '
    + `${ok}/${fired.length}`.padEnd(9)
    + (cs.length ? Math.round(cs[Math.floor(cs.length / 2)]) + ' Hz' : '-'));
}
