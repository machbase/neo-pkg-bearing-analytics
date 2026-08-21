// 최종 판정 규칙 후보의 검증 — 하이브리드 대역 + 측대역 빗, 그리고 임계의 홀드아웃.
//
// 두 가지를 동시에 답한다:
//  1) 대역을 커토그램 하나로 두지 말고 저역(1~5 kHz)과 **둘 다** 보면 오탐이 얼마나 느는가.
//     (이 검증 풀에 대형 설비가 없어 저역 고정으로 갈아타는 것은 위험하다 — 고주파 공진 기계를 놓친다)
//  2) 빗 임계를 평가셋에 맞추면 그건 과적합이다. **데이터셋 하나를 빼고 임계를 정한 뒤
//     그 셋으로만 평가**해서(leave-one-dataset-out) 임계가 옮겨 가는지 본다.
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const MAX_N = 65536;
const M = 3;
const LOW = { loHz: 1000, hiHz: 5000 };
const TARGET_FP = 0.03;
if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }

const readF64 = (p, cap) => {
  const buf = fs.readFileSync(p);
  const n = Math.min(cap, buf.byteLength / 8);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
};
const peakNear = (sp, f, tol) => {
  let best = 0;
  for (let i = 0; i < sp.freqs.length; i++) if (Math.abs(sp.freqs[i] - f) <= tol && sp.mags[i] > best) best = sp.mags[i];
  return best;
};
function combRatio(sp, f, delta, med, res) {
  if (!(f > 0) || !(med > 0)) return 0;
  let sum = 0, n = 0;
  for (let m = -M; m <= M; m++) {
    const t = f + m * delta;
    if (t < 2 || t > sp.freqs[sp.freqs.length - 1]) continue;
    if (m !== 0 && Math.abs(delta) < 2 * res) continue;
    sum += peakNear(sp, t, Math.max(1.5 * res, t * 0.01));
    n++;
  }
  return n ? (sum / n) / med : 0;
}

/** 한 대역에서 단일피크 매칭과 빗 비율을 모두 뽑는다 */
function evalBand(v, fsHz, fr, bf, band) {
  const env = VC.envelopeSpectrum(v, fsHz, Math.max(500, 12 * fr), band);
  if (!env.freqs.length) return null;
  const res = env.resTrue || env.res;
  const sorted = env.mags.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 0;
  const envQ = VC.envelopeQuant(env.freqs, env.mags, fr);
  const bm = VC.bearingMatch(envQ, bf, fr, res);
  const cands = [
    { key: 'BPFO', f: bf.BPFO, d: 0 },
    { key: 'BPFI', f: bf.BPFI, d: fr },
    { key: 'BSF', f: bf.BSF, d: bf.FTF },
    { key: 'BSF', f: 2 * bf.BSF, d: bf.FTF },
  ];
  let top = { key: '', r: 0 };
  for (const c of cands) {
    const r = combRatio(env, c.f, c.d, med, res);
    if (r > top.r) top = { key: c.key, r };
  }
  return { single: bm.hit ? bm.hit.key : '', combKey: top.key, combR: top.r };
}

const datasets = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.json')));
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
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo), nyq = c.fs / 2;
    const kg = VC.kurtogram(v, c.fs, nyq * VC.KG_NYQ_FRAC);
    const kgBand = kg && kg.best ? { loHz: kg.best.loHz, hiHz: kg.best.hiHz } : null;
    const a = evalBand(v, c.fs, fr, bf, kgBand);
    const b = LOW.hiHz < nyq * 0.95 ? evalBand(v, c.fs, fr, bf, LOW) : null;
    recs.push({ ds, name, label: c.label, a, b });
  }
  console.log(`  ${ds} 끝`);
}

const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };
/** 판정 규칙 — mode: 'kg' | 'low' | 'both', comb: 임계(없으면 단일피크만) */
function decide(r, mode, T) {
  const sides = mode === 'kg' ? [r.a] : mode === 'low' ? [r.b] : [r.a, r.b];
  let hit = '', best = 0;
  for (const s of sides) {
    if (!s) continue;
    if (s.single && !hit) hit = s.single;                 // 단일피크 매칭은 그대로 채택
    if (T != null && s.combR >= T && s.combR > best) { best = s.combR; if (!hit) hit = s.combKey; }
  }
  return hit;
}
function score(rows, mode, T) {
  const h = rows.filter((r) => r.label === 'none');
  const f = rows.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
  const fp = h.filter((r) => decide(r, mode, T)).length;
  const det = f.filter((r) => decide(r, mode, T));
  const ok = det.filter((r) => KEYMAP[decide(r, mode, T)] === r.label);
  const per = (L) => {
    const a = f.filter((r) => r.label === L), b = a.filter((r) => decide(r, mode, T));
    const c = b.filter((r) => KEYMAP[decide(r, mode, T)] === L);
    return `${b.length}/${a.length}(적중 ${c.length})`;
  };
  return { fp, hN: h.length, det: det.length, fN: f.length, ok: ok.length, per };
}
/** 정상 오탐률이 목표치가 되는 빗 임계 — 단일피크로 이미 뜬 정상은 빼고 센다 */
function fitT(rows, mode, fpRate) {
  const h = rows.filter((r) => r.label === 'none');
  const vals = h.map((r) => {
    const sides = mode === 'kg' ? [r.a] : mode === 'low' ? [r.b] : [r.a, r.b];
    return Math.max(...sides.filter(Boolean).map((s) => s.combR), 0);
  }).sort((x, y) => y - x);
  const k = Math.max(0, Math.floor(vals.length * fpRate) - 1);
  return vals[k] != null ? vals[k] + 1e-9 : Infinity;
}

const line = (tag, s) => console.log(
  `${tag.padEnd(30)} 검출 ${`${s.det}/${s.fN}`.padEnd(9)}${String(Math.round(s.det / s.fN * 100)).padStart(3)}%`
  + ` · 오탐 ${`${s.fp}/${s.hN}`.padEnd(8)}${String(Math.round(s.fp / s.hN * 100)).padStart(3)}%`
  + ` · 종류 ${`${s.ok}/${s.det}`.padEnd(9)}`
  + ` | 내륜 ${s.per('IR').padEnd(15)} 외륜 ${s.per('OR').padEnd(16)} 구름체 ${s.per('BALL')}`);

console.log('');
console.log('=== 대역 전략 (단일피크만) ===');
line('커토그램만 (현행)', score(recs, 'kg', null));
line('저역 1~5kHz만', score(recs, 'low', null));
line('둘 다 (하이브리드)', score(recs, 'both', null));

const T_all = fitT(recs, 'both', TARGET_FP);
console.log('');
console.log(`=== 빗 추가 (임계 ${T_all.toFixed(2)}, 전체 풀에서 오탐 ${Math.round(TARGET_FP * 100)}% 목표) ===`);
line('저역만 + 빗', score(recs, 'low', fitT(recs, 'low', TARGET_FP)));
line('둘 다 + 빗', score(recs, 'both', T_all));

console.log('');
console.log('=== 홀드아웃: 한 셋을 빼고 임계를 정한 뒤 그 셋으로만 평가 ===');
console.log('%s', '(임계가 셋마다 크게 옮겨 가면 그 값은 풀에 과적합된 것이다)');
let hDet = 0, hFN = 0, hFp = 0, hHN = 0, hOk = 0;
for (const ds of datasets) {
  const train = recs.filter((r) => r.ds !== ds);
  const test = recs.filter((r) => r.ds === ds);
  const T = fitT(train, 'low', TARGET_FP);
  const s = score(test, 'low', T);
  hDet += s.det; hFN += s.fN; hFp += s.fp; hHN += s.hN; hOk += s.ok;
  console.log(`  ${ds.padEnd(14)} 임계 ${T.toFixed(2).padStart(6)}  검출 ${`${s.det}/${s.fN}`.padEnd(9)}`
    + `${String(s.fN ? Math.round(s.det / s.fN * 100) : 0).padStart(3)}%  오탐 ${`${s.fp}/${s.hN}`.padEnd(8)} 종류 ${s.ok}/${s.det}`);
}
console.log(`  ${'합계'.padEnd(14)}          검출 ${`${hDet}/${hFN}`.padEnd(9)}${String(Math.round(hDet / hFN * 100)).padStart(3)}%`
  + `  오탐 ${`${hFp}/${hHN}`.padEnd(8)} 종류 ${hOk}/${hDet}`);

fs.writeFileSync(path.join(ROOT, 'verify-hybrid.json'), JSON.stringify(recs, null, 1));
