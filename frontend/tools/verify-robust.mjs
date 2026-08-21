// 상수 민감도 + 하이브리드 재실험 — "지금 숫자가 이 데이터에 맞춰진 것인가"를 두 방향으로 본다.
//
// ① 민감도: 상수를 흔들었을 때 성적이 칼날처럼 무너지면 그 값은 이 풀에 맞춰진 것이고,
//    평평하면 물리에서 온 것이다. 폴드마다 상수를 다시 최적화하는 전면 LODO보다 싸면서
//    "과적합인가"라는 질문에는 같은 답을 준다.
// ② 하이브리드: 커토그램 대역과 저역을 둘 다 보면 검정을 두 번 하는 셈이라 오탐도 두 배가 된다.
//    앞서 3%→6%로 기각했는데 그건 1−(1−0.03)²=5.91%의 재현일 뿐 물리가 아니었다.
//    각 대역 임계를 조여 **합쳐서 같은 오탐**이 되게 맞춘 뒤 비교해야 공정하다(Šidák).
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
const datasets = fs.readdirSync(ROOT)
  .filter((d) => d !== 'xjtu_seq' && fs.existsSync(path.join(ROOT, d, 'index.json')));

// 케이스를 한 번만 읽고 두 대역의 포락선을 미리 만들어 둔다 (상수를 흔들 때마다 다시 읽으면 느리다)
const prep = [];
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
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo), nyq = c.fs / 2;
    const eMax = VC.envMaxFor(bf, fr, c.fs);
    const low = VC.demodFixed(c.fs);
    const envLow = low ? VC.envelopeSpectrum(v, c.fs, eMax, low) : null;
    const kg = VC.kurtogram(v, c.fs, nyq * VC.KG_NYQ_FRAC);
    const envKg = kg && kg.best ? VC.envelopeSpectrum(v, c.fs, eMax, kg.best) : null;
    prep.push({ ds, label: c.label, fr, bf, envLow, envKg });
  }
  console.log(`  ${ds} 준비`);
}
console.log('');

/** 주어진 포락선에서 표적 격자 최대 점수 — TGT의 상수를 밖에서 바꿔 넣을 수 있게 재구현 */
function tgtScore(env, bf, fr, H, S, tolRel) {
  if (!env || !env.freqs.length) return { key: '', r: 0 };
  const res = env.resTrue || env.res;
  const sorted = env.mags.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 0;
  if (!(med > 0)) return { key: '', r: 0 };
  const top = env.freqs[env.freqs.length - 1];
  const cands = [
    { k: 'BPFO', f: bf.BPFO, d: 0 }, { k: 'BPFI', f: bf.BPFI, d: fr }, { k: 'BSF', f: 2 * bf.BSF, d: bf.FTF },
  ];
  let best = { key: '', r: 0 };
  for (const c of cands) {
    if (!(c.f > 0)) continue;
    let sum = 0, n = 0;
    for (let h = 1; h <= H; h++) {
      for (let m = -S; m <= S; m++) {
        if (m !== 0 && (!(c.d > 0) || Math.abs(c.d) < 2 * res)) continue;
        const t = h * c.f + m * c.d;
        if (t < 2 || t > top) continue;
        const tol = Math.max(1.5 * res, t * tolRel);
        let p = 0;
        for (let j = 0; j < env.freqs.length; j++) if (Math.abs(env.freqs[j] - t) <= tol && env.mags[j] > p) p = env.mags[j];
        sum += p; n++;
      }
    }
    const r = n ? (sum / n) / med : 0;
    if (r > best.r) best = { key: c.k, r };
  }
  return best;
}

const fitT = (rows, key, fp) => {
  const v = rows.filter((r) => r.label === 'none').map((r) => r[key]).sort((a, b) => b - a);
  const k = Math.max(0, Math.floor(v.length * fp) - 1);
  return v[k] != null ? v[k] + 1e-9 : Infinity;
};
const evalAt = (rows, key, T) => {
  const h = rows.filter((r) => r.label === 'none');
  const f = rows.filter((r) => r.label !== 'none');
  const s = rows.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
  const det = f.filter((r) => r[key] >= T).length;
  const fired = s.filter((r) => r[key] >= T);
  return {
    fp: h.filter((r) => r[key] >= T).length, hN: h.length, det, fN: f.length,
    ok: fired.filter((r) => KEYMAP[r[key.replace('R', 'K')]] === r.label).length, tN: fired.length,
  };
};

// ── ① 민감도 ────────────────────────────────────────────────────────────────
console.log('=== ① 상수 민감도 — 흔들면 무너지는가 (오탐을 2.4%에 고정) ===');
console.log('설정                    검출          오탐      종류적중');
const FP = 0.024;
for (const [H, S, tol, tag] of [
  [3, 1, 0.01, '기본 (H=3, ±1, tol 1%)'],
  [2, 1, 0.01, 'H=2 (하모닉 줄임)'],
  [4, 1, 0.01, 'H=4 (하모닉 늘림)'],
  [3, 0, 0.01, '측대역 없음 (S=0)'],
  [3, 2, 0.01, '측대역 ±2'],
  [3, 1, 0.005, 'tol 0.5% (좁힘)'],
  [3, 1, 0.02, 'tol 2% (넓힘)'],
  [3, 1, 0.03, 'tol 3% (더 넓힘)'],
  [4, 0, 0.01, 'H=4 + 측대역 없음'],
  [5, 0, 0.01, 'H=5 + 측대역 없음'],
  [6, 0, 0.01, 'H=6 + 측대역 없음'],
  [4, 1, 0.01, 'H=4 + ±1'],
  [5, 1, 0.01, 'H=5 + ±1'],
]) {
  for (const r of prep) { const g = tgtScore(r.envLow, r.bf, r.fr, H, S, tol); r.aR = g.r; r.aK = g.key; }
  const T = fitT(prep, 'aR', FP);
  const q = evalAt(prep, 'aR', T);
  console.log(`${tag.padEnd(24)}${`${q.det}/${q.fN}`.padEnd(9)}${String(Math.round(q.det / q.fN * 100)).padStart(3)}%   ${`${q.fp}/${q.hN}`.padEnd(8)}  ${q.ok}/${q.tN}`);
}

// ── ② 하이브리드 (족단위 보정) ──────────────────────────────────────────────
console.log('');
console.log('=== ② 하이브리드 — 두 대역을 보되 합쳐서 같은 오탐이 되게 ===');
for (const r of prep) {
  const a = tgtScore(r.envLow, r.bf, r.fr, 3, 1, 0.01); r.aR = a.r; r.aK = a.key;
  const b = tgtScore(r.envKg, r.bf, r.fr, 3, 1, 0.01); r.bR = b.r; r.bK = b.key;
}
const Tlow = fitT(prep, 'aR', FP);
console.log(`저역만 (임계 ${Tlow.toFixed(2)})`.padEnd(34) + (() => {
  const q = evalAt(prep, 'aR', Tlow);
  return `${`${q.det}/${q.fN}`.padEnd(9)}${String(Math.round(q.det / q.fN * 100)).padStart(3)}%   ${`${q.fp}/${q.hN}`.padEnd(8)}  ${q.ok}/${q.tN}`;
})());
/* Šidák — 대역 K개를 각각 오탐 p로 보면 합쳐서 1−(1−p)^K.
   합쳐서 FP가 되게 하려면 대역당 p = 1−(1−FP)^(1/K) 로 조여야 한다. */
const K = 2, pEach = 1 - Math.pow(1 - FP, 1 / K);
for (const r of prep) r.uR = Math.max(r.aR || 0, r.bR || 0);
const Ta = fitT(prep, 'aR', pEach), Tb = fitT(prep, 'bR', pEach);
for (const r of prep) {
  const okA = (r.aR || 0) >= Ta, okB = (r.bR || 0) >= Tb;
  r.hR = okA || okB ? 1 : 0;
  r.hK = okA ? r.aK : (okB ? r.bK : '');
}
{
  const h = prep.filter((r) => r.label === 'none'), f = prep.filter((r) => r.label !== 'none');
  const s = prep.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
  const fired = s.filter((r) => r.hR);
  console.log(`하이브리드 (각 대역 ${(pEach * 100).toFixed(1)}%로 조임)`.padEnd(34)
    + `${`${f.filter((r) => r.hR).length}/${f.length}`.padEnd(9)}${String(Math.round(f.filter((r) => r.hR).length / f.length * 100)).padStart(3)}%   `
    + `${`${h.filter((r) => r.hR).length}/${h.length}`.padEnd(8)}  ${fired.filter((r) => KEYMAP[r.hK] === r.label).length}/${fired.length}`);
}
console.log('');
console.log(`대역별 임계 — 저역 ${Ta.toFixed(2)} · 커토그램 ${Tb.toFixed(2)} (보정 없이 합치면 오탐이 ${(FP * 2 * 100).toFixed(1)}%로 뜬다)`);


// ── ③ 하모닉 차수 선택의 홀드아웃 ────────────────────────────────────────────
/* 13개 설정 중 최고를 고르는 것 자체가 다중비교다. 데이터셋 하나를 빼고 **거기서 H를 고른 뒤**
   뺀 셋으로 평가한다. 매번 같은 H가 뽑히고 성적이 유지되면 그 선택은 풀에 붙은 것이 아니다. */
console.log('');
console.log('=== ③ H 선택의 홀드아웃 (S=1, tol 1% 고정) ===');
const HS = [2, 3, 4, 5, 6];
const cache = {};
for (const H of HS) {
  cache[H] = prep.map((r) => { const g = tgtScore(r.envLow, r.bf, r.fr, H, 1, 0.01); return { r: g.r, k: g.key }; });
}
const dsList = [...new Set(prep.map((r) => r.ds))];
let hd = 0, hf = 0, hp = 0, hh = 0;
console.log('빼낸 셋           나머지에서 고른 H   그 셋 성적');
for (const ds of dsList) {
  const trIdx = prep.map((r, i) => [r, i]).filter(([r]) => r.ds !== ds).map(([, i]) => i);
  const teIdx = prep.map((r, i) => [r, i]).filter(([r]) => r.ds === ds).map(([, i]) => i);
  let bestH = 0, bestDet = -1;
  for (const H of HS) {
    const tr = trIdx.map((i) => ({ label: prep[i].label, aR: cache[H][i].r, aK: cache[H][i].k }));
    const T = fitT(tr, 'aR', FP);
    const q = evalAt(tr, 'aR', T);
    if (q.det > bestDet) { bestDet = q.det; bestH = H; }
  }
  const tr = trIdx.map((i) => ({ label: prep[i].label, aR: cache[bestH][i].r, aK: cache[bestH][i].k }));
  const T = fitT(tr, 'aR', FP);
  const te = teIdx.map((i) => ({ label: prep[i].label, aR: cache[bestH][i].r, aK: cache[bestH][i].k }));
  const q = evalAt(te, 'aR', T);
  hd += q.det; hf += q.fN; hp += q.fp; hh += q.hN;
  console.log(`  ${ds.padEnd(16)} H=${bestH} (임계 ${T.toFixed(2)})     검출 ${`${q.det}/${q.fN}`.padEnd(9)}${String(q.fN ? Math.round(q.det / q.fN * 100) : 0).padStart(3)}%  오탐 ${q.fp}/${q.hN}`);
}
console.log(`  ${'합계'.padEnd(16)}                    검출 ${`${hd}/${hf}`.padEnd(9)}${Math.round(hd / hf * 100)}%  오탐 ${hp}/${hh}`);
