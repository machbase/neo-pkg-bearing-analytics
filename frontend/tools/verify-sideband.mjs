// 측대역 빗 판독 비교 — 지배 피크 대조 vs 빗 에너지 비, 정상 오탐률 고정 시 검출·종류 적중 측정(후보 BPFO·BPFI·BSF·2BSF)
// · 로컬 데이터셋 필요(D:/vibe-datasets/conv, 없으면 건너뜀), --band=lo:hi로 복조 대역 고정
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = argv[0] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const bandArg = process.argv.find((a) => a.startsWith('--band='));
const FIXED_BAND = bandArg
  ? { loHz: +bandArg.slice(7).split(':')[0], hiHz: +bandArg.slice(7).split(':')[1] }
  : null;
const MAX_N = 65536;
const M = 3;            // 측대역 차수 ±3까지 — 더 넓히면 배경까지 긁어 비율 부풂

if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }

const readF64 = (p, cap) => {
  const buf = fs.readFileSync(p);
  const n = Math.min(cap, buf.byteLength / 8);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
};

/** f 근처(허용오차 tol)의 최대 진폭 — 0이면 성분 없음 */
function peakNear(sp, f, tol) {
  if (!(f > 0)) return 0;
  let best = 0;
  for (let i = 0; i < sp.freqs.length; i++) {
    if (Math.abs(sp.freqs[i] - f) <= tol && sp.mags[i] > best) best = sp.mags[i];
  }
  return best;
}

/** 빗 에너지 비 — {f, f±Δ … f±MΔ} 진폭 평균 ÷ 스펙트럼 중앙값 */
function combRatio(sp, f, delta, med, res) {
  if (!(f > 0) || !(med > 0)) return 0;
  const tol = Math.max(1.5 * res, f * 0.01);
  let sum = 0, nUsed = 0;
  for (let m = -M; m <= M; m++) {
    const t = f + m * delta;
    if (t < 2 || t > sp.freqs[sp.freqs.length - 1]) continue;
    // 측대역 간격이 분해능보다 좁으면 이웃끼리 같은 빈을 집음 — 제외
    if (m !== 0 && Math.abs(delta) < 2 * res) continue;
    sum += peakNear(sp, t, m === 0 ? tol : Math.max(1.5 * res, Math.abs(t) * 0.01));
    nUsed++;
  }
  return nUsed ? (sum / nUsed) / med : 0;
}

const datasets = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.json')));
const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };
const recs = [];

for (const ds of datasets) {
  const dir = path.join(ROOT, ds);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const name of Object.keys(meta.cases)) {
    const c = meta.cases[name];
    if (!c.geo || !c.rpm || !c.fs) continue;
    const f = path.join(dir, name + '.f64');
    if (!fs.existsSync(f)) continue;
    const v = readF64(f, MAX_N);
    if (v.length < 4096) continue;

    const fr = c.rpm / 60;
    const bf = VC.bearingFreqs(c.rpm, c.geo);
    const nyq = c.fs / 2;
    let band = FIXED_BAND;
    if (!band) {
      const kg = VC.kurtogram(v, c.fs, nyq * VC.KG_NYQ_FRAC);
      band = kg && kg.best ? { loHz: kg.best.loHz, hiHz: kg.best.hiHz } : null;
    } else if (band.hiHz > nyq * 0.95) band = null;

    const env = VC.envelopeSpectrum(v, c.fs, Math.max(500, 12 * fr), band);
    if (!env.freqs.length) continue;
    const res = env.resTrue || env.res;
    const sorted = env.mags.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 0;

    // 지배 피크 대조도 같은 포락선에서 계산해 나란히 비교
    const envQ = VC.envelopeQuant(env.freqs, env.mags, fr);
    const bm = VC.bearingMatch(envQ, bf, fr, res);

    // 빗 후보 — 변조 간격은 물리로 결정(내륜=1×, 구름체=FTF, 외륜=변조 없음)
    const cands = [
      { key: 'BPFO', f: bf.BPFO, d: 0 },
      { key: 'BPFI', f: bf.BPFI, d: fr },
      { key: 'BSF', f: bf.BSF, d: bf.FTF },
      { key: 'BSF', f: 2 * bf.BSF, d: bf.FTF },
    ];
    let top = { key: '', r: 0 };
    for (const cd of cands) {
      const r = combRatio(env, cd.f, cd.d, med, res);
      if (r > top.r) top = { key: cd.key, r };
    }
    recs.push({ ds, name, label: c.label, single: bm.hit ? bm.hit.key : '', comb: top.key, combR: top.r });
  }
  console.log(`  ${ds} 끝`);
}

const healthy = recs.filter((r) => r.label === 'none');
const faults = recs.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));

// 정상 오탐률 고정 시 검출률 비교 — 임계를 결함 쪽에 맞추면 다중비교
const hSorted = healthy.map((r) => r.combR).sort((a, b) => b - a);
const thrFor = (fpRate) => hSorted[Math.max(0, Math.floor(hSorted.length * fpRate) - 1)] || Infinity;

console.log('');
console.log(`정상 ${healthy.length}건 · 단일라벨 결함 ${faults.length}건`);
console.log('');
console.log('%s', '빗 에너지 방식 — 정상 오탐률을 고정했을 때');
console.log('오탐목표  임계     검출         종류적중      (내륜)        (구름체)      (외륜)');
for (const fp of [0.02, 0.03, 0.05, 0.10]) {
  const T = thrFor(fp);
  const fired = faults.filter((r) => r.combR >= T);
  const ok = fired.filter((r) => KEYMAP[r.comb] === r.label);
  const per = (L) => {
    const a = faults.filter((r) => r.label === L);
    const b = a.filter((r) => r.combR >= T);
    const c = b.filter((r) => KEYMAP[r.comb] === L);
    return `${b.length}/${a.length} ${a.length ? Math.round(b.length / a.length * 100) : 0}%(적중 ${c.length})`;
  };
  const realFp = healthy.filter((r) => r.combR >= T).length;
  console.log(`${String(Math.round(fp * 100)).padStart(6)}%  ${T.toFixed(2).padStart(6)}  `
    + `${`${fired.length}/${faults.length}`.padEnd(9)}${String(Math.round(fired.length / faults.length * 100)).padStart(3)}%   `
    + `${`${ok.length}/${fired.length}`.padEnd(9)}  ${per('IR').padEnd(14)}${per('BALL').padEnd(14)}${per('OR')}`
    + `   [실제오탐 ${realFp}/${healthy.length}]`);
}

const sFired = faults.filter((r) => r.single);
const sOk = sFired.filter((r) => KEYMAP[r.single] === r.label);
const sFp = healthy.filter((r) => r.single).length;
const perS = (L) => {
  const a = faults.filter((r) => r.label === L);
  const b = a.filter((r) => r.single);
  return `${b.length}/${a.length} ${a.length ? Math.round(b.length / a.length * 100) : 0}%`;
};
console.log('');
console.log(`현행(지배 피크)  검출 ${sFired.length}/${faults.length} ${Math.round(sFired.length / faults.length * 100)}%`
  + ` · 종류 ${sOk.length}/${sFired.length} · 오탐 ${sFp}/${healthy.length}`
  + ` · 내륜 ${perS('IR')} · 구름체 ${perS('BALL')} · 외륜 ${perS('OR')}`);

fs.writeFileSync(path.join(ROOT, 'verify-sideband.json'), JSON.stringify(recs, null, 1));
