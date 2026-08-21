// 표적 우선 대조 시험 — "지배 피크 하나를 후보와 대조"에서 "후보 자리를 각각 보러 간다"로.
//
// 근거: 미검출 231건 중 43%가 포락선 지배 성분이 축 관련(1× 29%·2× 8%·서브동기 6%)이었다.
// 지배 피크만 보는 구조에서는 결함주파수를 **한 번도 쳐다보지 않고** 떨어진다.
//
// 후보마다 다른 통계를 쓰면 순위 비교가 물리가 아니라 귀무분포 모양을 재게 되므로,
// 셋을 같은 구조로 맞춘다 — 하모닉 열 × 측대역(변조가 있는 계열만):
//   외륜   BPFO  h=1..H, 측대역 없음   (결함이 하중대에 고정 → 변조 없음)
//   내륜   BPFI  h=1..H, ±1×           (결함이 축과 함께 하중대를 드나듦)
//   구름체 2×BSF h=1..H, ±FTF          (결함이 케이지와 함께 드나듦)
//
// 다중비교: 후보를 넷 놓고 최댓값을 취하는 구조라 임계를 결함에서 맞추면 함정이다.
// **정상 오탐률을 현행과 같은 값에 고정**하고 그때의 검출률만 비교한다. LODO도 같이 낸다.
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const REV = 100, HARD_CAP = 262144;
const H = 3;          // 하모닉 차수
const S = 1;          // 측대역 차수 ±1 — 하모닉과 곱해지므로 넓히면 자리 수가 급증한다
const TARGET_FP = 0.024;   // 현행 실측 오탐 3/124

if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }

const readF64 = (p, n) => {
  const buf = fs.readFileSync(p);
  const k = Math.min(n, buf.byteLength / 8);
  const out = new Array(k);
  for (let i = 0; i < k; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
};
const peakNear = (sp, f, tol) => {
  let b = 0;
  for (let i = 0; i < sp.freqs.length; i++) if (Math.abs(sp.freqs[i] - f) <= tol && sp.mags[i] > b) b = sp.mags[i];
  return b;
};

/** 하모닉 × 측대역 격자의 진폭 평균 ÷ 중앙값. 자리 수를 함께 돌려 계열 간 비교가 되게 한다 */
function gridScore(sp, f, delta, med, res) {
  if (!(f > 0) || !(med > 0)) return { r: 0, n: 0, lines: 0 };
  const top = sp.freqs[sp.freqs.length - 1];
  let sum = 0, n = 0, lines = 0;
  for (let h = 1; h <= H; h++) {
    for (let m = -S; m <= S; m++) {
      if (m !== 0 && (!(delta > 0) || Math.abs(delta) < 2 * res)) continue;
      const t = h * f + m * delta;
      if (t < 2 || t > top) continue;
      const p = peakNear(sp, t, Math.max(1.5 * res, t * 0.01));
      sum += p; n++;
      if (p > med * 2) lines++;
    }
  }
  return { r: n ? (sum / n) / med : 0, n, lines };
}

const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };
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
    const avail = fs.statSync(f).size / 8;
    const need = Math.round(c.fs * REV / (c.rpm / 60));
    const v = readF64(f, Math.min(HARD_CAP, avail, Math.max(16384, need)));
    if (v.length < 4096) continue;

    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo);
    // 격자가 하모닉 3차까지 가므로 상한도 그만큼 필요하다
    const env = VC.envelopeSpectrum(v, c.fs, Math.max(VC.envMaxFor(bf, fr, c.fs), 3 * bf.BPFI + 2 * fr), VC.demodFixed(c.fs));
    if (!env.freqs.length) continue;
    const res = env.resTrue || env.res;
    const sorted = env.mags.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 0;

    // 현행 제품 판정(비교 기준)
    const envQ = VC.envelopeQuant(env.freqs, env.mags, fr);
    const sb = VC.sidebandMatch(env, bf, fr, res);
    const cur = VC.bearingMatch(envQ, bf, fr, res, sb);

    // 표적 우선
    const cands = [
      { k: 'BPFO', f: bf.BPFO, d: 0 },
      { k: 'BPFI', f: bf.BPFI, d: fr },
      { k: 'BSF', f: 2 * bf.BSF, d: bf.FTF },
    ];
    let top = { k: '', r: 0, lines: 0 };
    for (const cd of cands) {
      const g = gridScore(env, cd.f, cd.d, med, res);
      if (g.r > top.r) top = { k: cd.k, r: g.r, lines: g.lines };
    }
    // BSF를 후보에서 뺀 변형도 같이 잰다 — 구름체 적중이 0이라 후보로 두는 것이 손해인지 확인
    let top2 = { k: '', r: 0 };
    for (const cd of cands) {
      if (cd.k === 'BSF') continue;
      const g = gridScore(env, cd.f, cd.d, med, res);
      if (g.r > top2.r) top2 = { k: cd.k, r: g.r };
    }
    recs.push({ ds, label: c.label, curHit: cur.hit ? cur.hit.key : '', tgt: top.k, tgtR: top.r, tgtLines: top.lines, nb: top2.k, nbR: top2.r });
  }
  console.log(`  ${ds} 끝`);
}

const healthy = recs.filter((r) => r.label === 'none');
const single = recs.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
const faults = recs.filter((r) => r.label !== 'none');

function fitT(rows, fpRate) {
  const vals = rows.filter((r) => r.label === 'none').map((r) => r.tgtR).sort((a, b) => b - a);
  const k = Math.max(0, Math.floor(vals.length * fpRate) - 1);
  return vals[k] != null ? vals[k] + 1e-9 : Infinity;
}
function score(rows, T) {
  const h = rows.filter((r) => r.label === 'none');
  const f = rows.filter((r) => r.label !== 'none');
  const s = rows.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
  const fp = h.filter((r) => r.tgtR >= T).length;
  const det = f.filter((r) => r.tgtR >= T).length;
  const tN = s.filter((r) => r.tgtR >= T);
  const ok = tN.filter((r) => KEYMAP[r.tgt] === r.label).length;
  return { fp, hN: h.length, det, fN: f.length, ok, tN: tN.length };
}
const per = (rows, T, L) => {
  const a = rows.filter((r) => r.label === L), b = a.filter((r) => r.tgtR >= T);
  const c = b.filter((r) => KEYMAP[r.tgt] === L);
  return `${b.length}/${a.length} ${a.length ? Math.round(b.length / a.length * 100) : 0}%(적중 ${c.length})`;
};

const T = fitT(recs, TARGET_FP);
const s = score(recs, T);
const curFp = healthy.filter((r) => r.curHit).length;
const curDet = faults.filter((r) => r.curHit).length;
const curOk = single.filter((r) => r.curHit && KEYMAP[r.curHit] === r.label).length;
const curTn = single.filter((r) => r.curHit).length;

console.log('');
console.log(`현행(지배피크+빗)   오탐 ${curFp}/${healthy.length} · 검출 ${curDet}/${faults.length} (${Math.round(curDet / faults.length * 100)}%) · 종류 ${curOk}/${curTn}`);
console.log(`표적우선(임계 ${T.toFixed(2)})  오탐 ${s.fp}/${s.hN} · 검출 ${s.det}/${s.fN} (${Math.round(s.det / s.fN * 100)}%) · 종류 ${s.ok}/${s.tN}`);
console.log('');
console.log('표적우선 라벨별:', ['OR', 'IR', 'BALL'].map((L) => `${L} ${per(recs, T, L)}`).join(' · '));

// BSF 제외 변형
{
  const vals = healthy.map((r) => r.nbR).sort((a, b) => b - a);
  const T2 = vals[Math.max(0, Math.floor(vals.length * TARGET_FP) - 1)] + 1e-9;
  const h2 = healthy.filter((r) => r.nbR >= T2).length;
  const f2 = faults.filter((r) => r.nbR >= T2).length;
  const s2 = single.filter((r) => r.nbR >= T2);
  const ok2 = s2.filter((r) => KEYMAP[r.nb] === r.label).length;
  console.log(`BSF 후보 제외(임계 ${T2.toFixed(2)}) 오탐 ${h2}/${healthy.length} · 검출 ${f2}/${faults.length} (${Math.round(f2 / faults.length * 100)}%) · 종류 ${ok2}/${s2.length}`);
  const perL = (L) => {
    const a = recs.filter((r) => r.label === L), b = a.filter((r) => r.nbR >= T2);
    const c = b.filter((r) => KEYMAP[r.nb] === L);
    return `${L} ${b.length}/${a.length} ${a.length ? Math.round(b.length / a.length * 100) : 0}%(적중 ${c.length})`;
  };
  console.log('  라벨별:', ['OR', 'IR', 'BALL'].map(perL).join(' · '));
}

// 오귀속 내역
{
  const wrong = single.filter((r) => r.tgtR >= T && KEYMAP[r.tgt] !== r.label);
  const cnt = {};
  for (const w of wrong) { const k = `${w.label}→${KEYMAP[w.tgt] || w.tgt}`; cnt[k] = (cnt[k] || 0) + 1; }
  console.log('');
  console.log('오귀속 %d건:', wrong.length, Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
}

console.log('');
console.log('데이터셋별 (표적우선):');
for (const ds of datasets) {
  const r = recs.filter((x) => x.ds === ds);
  const q = score(r, T);
  console.log(`  ${ds.padEnd(15)} 오탐 ${`${q.fp}/${q.hN}`.padEnd(8)} 검출 ${`${q.det}/${q.fN}`.padEnd(9)}${String(q.fN ? Math.round(q.det / q.fN * 100) : 0).padStart(3)}%  종류 ${q.ok}/${q.tN}`);
}

console.log('');
console.log('LODO — 한 셋을 빼고 임계를 정한 뒤 그 셋으로만 평가:');
let a = { fp: 0, hN: 0, det: 0, fN: 0, ok: 0, tN: 0 };
for (const ds of datasets) {
  const Tl = fitT(recs.filter((r) => r.ds !== ds), TARGET_FP);
  const q = score(recs.filter((r) => r.ds === ds), Tl);
  for (const k of Object.keys(a)) a[k] += q[k];
  console.log(`  ${ds.padEnd(15)} 임계 ${Tl.toFixed(2).padStart(6)}  오탐 ${`${q.fp}/${q.hN}`.padEnd(8)} 검출 ${`${q.det}/${q.fN}`.padEnd(9)} 종류 ${q.ok}/${q.tN}`);
}
console.log(`  ${'합계'.padEnd(15)}          오탐 ${`${a.fp}/${a.hN}`.padEnd(8)} 검출 ${`${a.det}/${a.fN}`.padEnd(9)}${Math.round(a.det / a.fN * 100)}%  종류 ${a.ok}/${a.tN}`);
