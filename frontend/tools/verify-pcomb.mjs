// 격자 점수 통계량 비교 — 같은 오탐률(4/124)에서 검출·종류 적중·내륜 검출 측정
//   mean  — 자리별 최댓값 평균 ÷ 전역 중앙값(무정보 자리가 점수를 끌어내려 자리 많은 내륜에 불리, 분모가 envMaxFor 상한에 좌우)
//   local — 자리별 국소 잡음층(주변 ±64빈 중앙값) 대비 비의 평균
//   fisher— 자리별 p값(국소 잡음층 지수분포 가정) Fisher 결합 → −2Σln p
//   stouf — 자리별 z Stouffer 결합 → Σz/√n
// · 로컬 데이터셋 필요(D:/vibe-datasets/conv, 없으면 건너뜀)
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
const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };
const H = 4, S = 1, TOL = 0.01, LOCAL_BINS = 64;

/* 정규분포 상측 꼬리 근사 역함수(p→z) — Acklam 유사, 이 용도엔 꼬리 정확도 충분 */
function pToZ(p) {
  if (p <= 0) return 8; if (p >= 1) return -8;
  const a = [-39.696830, 220.946098, -275.928510, 138.357751, -30.664798, 2.506628];
  const b = [-54.476098, 161.585836, -155.698979, 66.801311, -13.280681];
  const c = [-0.007784894, -0.32239645, -2.400758, -2.549732, 4.374664, 2.938163];
  const d = [0.007784695, 0.32246712, 2.445134, 3.754408];
  const pl = 0.02425; let q, r, x;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  else if (p <= 1 - pl) { q = p - 0.5; r = q * q;
    x = (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
  else { q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  return -x;   // 상측 꼬리
}

/** 한 후보(중심 f, 측대역 간격 delta)의 자리별 (피크, 국소 잡음층) 수집 */
function sites(sp, f, delta, res) {
  const top = sp.freqs[sp.freqs.length - 1], out = [];
  for (let h = 1; h <= H; h++) {
    for (let m = -S; m <= S; m++) {
      if (m !== 0 && (!(delta > 0) || Math.abs(delta) < 2 * res)) continue;
      const t = h * f + m * delta;
      if (t < 2 || t > top) continue;
      const tol = Math.max(1.5 * res, t * TOL);
      let peak = 0, ci = -1;
      for (let j = 0; j < sp.freqs.length; j++) {
        if (Math.abs(sp.freqs[j] - t) <= tol && sp.mags[j] > peak) { peak = sp.mags[j]; ci = j; }
      }
      if (ci < 0) { out.push({ peak: 0, loc: 0 }); continue; }
      // 국소 잡음층 — 표적 주변 창의 중앙값(표적 자신 제외로 잡음층 부풀림 방지)
      const lo = Math.max(0, ci - LOCAL_BINS), hi = Math.min(sp.mags.length - 1, ci + LOCAL_BINS);
      const w = [];
      for (let j = lo; j <= hi; j++) if (Math.abs(sp.freqs[j] - t) > tol) w.push(sp.mags[j]);
      w.sort((a, b) => a - b);
      out.push({ peak, loc: w.length ? w[Math.floor(w.length / 2)] : 0 });
    }
  }
  return out;
}

const STATS = {
  // 전역 중앙값 대비 자리별 최댓값의 평균
  mean: (st, gmed) => st.length ? st.reduce((a, s) => a + s.peak, 0) / st.length / Math.max(gmed, 1e-12) : 0,
  local: (st) => { const v = st.filter((s) => s.loc > 0); return v.length ? v.reduce((a, s) => a + s.peak / s.loc, 0) / v.length : 0; },
  /* 포락선 잡음층 진폭은 대략 지수분포 → P(peak > x) ≈ exp(-x/μ), μ = 국소 중앙값/ln2
     무정보 자리는 p≈0.5 → −2ln p ≈ 1.4로 중립(평균처럼 끌어내리지 않음) */
  fisher: (st) => {
    const v = st.filter((s) => s.loc > 0); if (!v.length) return 0;
    let sum = 0;
    for (const s of v) { const mu = s.loc / Math.LN2; sum += -2 * Math.log(Math.max(1e-12, Math.exp(-s.peak / mu))); }
    return sum / v.length;   // 자리 수로 나눠 H에 안 끌리게
  },
  stouf: (st) => {
    const v = st.filter((s) => s.loc > 0); if (!v.length) return 0;
    let sz = 0;
    for (const s of v) { const mu = s.loc / Math.LN2; sz += pToZ(Math.min(1 - 1e-12, Math.max(1e-12, Math.exp(-s.peak / mu)))); }
    return sz / Math.sqrt(v.length);
  },
};

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
    const band = VC.demodFixed(c.fs); if (!band) continue;
    const env = VC.envelopeSpectrum(v, c.fs, VC.envMaxFor(bf, fr, c.fs), band);
    if (!env.freqs.length) continue;
    const res = env.resTrue || env.res;
    const sorted = env.mags.slice().sort((a, b) => a - b);
    const gmed = sorted[Math.floor(sorted.length / 2)] || 1e-12;
    const cands = [
      { k: 'BPFO', f: bf.BPFO, d: 0 }, { k: 'BPFI', f: bf.BPFI, d: fr }, { k: 'BSF', f: 2 * bf.BSF, d: bf.FTF },
    ];
    const r = { ds, label: c.label };
    for (const sk of Object.keys(STATS)) r[sk] = { r: -Infinity, k: '' };
    for (const cd of cands) {
      if (!(cd.f > 0)) continue;
      const st = sites(env, cd.f, cd.d, res);
      for (const sk of Object.keys(STATS)) {
        const val = STATS[sk](st, gmed);
        if (val > r[sk].r) r[sk] = { r: val, k: cd.k };
      }
    }
    rows.push(r);
  }
  console.log(`  ${ds} 완료`);
}
console.log('');

const FP = 4 / 124;
console.log(`오탐을 ${(FP * 100).toFixed(1)}%(현행)에 고정 · 케이스 ${rows.length}건\n`);
console.log('통계량                        임계     오탐        검출          종류적중   내륜만');
const IR = rows.filter((r) => r.label === 'IR');
for (const sk of Object.keys(STATS)) {
  const get = (r) => r[sk].r;
  const hv = rows.filter((r) => r.label === 'none').map(get).sort((a, b) => b - a);
  const T = hv[Math.max(0, Math.floor(hv.length * FP) - 1)] + 1e-12;
  const h = rows.filter((r) => r.label === 'none'), f = rows.filter((r) => r.label !== 'none');
  const s = rows.filter((r) => ['OR', 'IR', 'BALL'].includes(r.label));
  const det = f.filter((r) => get(r) >= T).length;
  const fired = s.filter((r) => get(r) >= T);
  const ok = fired.filter((r) => KEYMAP[r[sk].k] === r.label).length;
  const irDet = IR.filter((r) => get(r) >= T).length;
  const LBL = { mean: '평균 ÷ 전역중앙값(현행)', local: '평균 ÷ 국소잡음층', fisher: 'Fisher p값 결합', stouf: 'Stouffer z 결합' };
  console.log(LBL[sk].padEnd(29) + T.toFixed(2).padStart(6) + '   '
    + `${h.filter((r) => get(r) >= T).length}/${h.length}`.padEnd(9) + '  '
    + `${det}/${f.length}`.padEnd(9) + String(Math.round(det / f.length * 100)).padStart(4) + '%   '
    + `${ok}/${fired.length}`.padEnd(10) + `${irDet}/${IR.length}`);
}
