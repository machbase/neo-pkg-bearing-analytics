// "이상이 있다는 것 자체"는 잡히는가 — 부위를 묻지 않고 유무만.
//
// 지금까지의 성적표는 전부 **베어링 축**(결함주파수 대조)이었다. 그런데 제품은 4축 최댓값이고,
// 그중 둘(베이스라인·대역)은 "평소 대비"라 스냅샷 데이터셋으로는 잴 수 없었다.
// 전 수명 시퀀스는 **같은 베어링의 초기 구간**을 평소로 쓸 수 있어 그 축을 처음으로 잰다.
//
// 축 세 개를 각각, 그리고 합집합으로 본다:
//   ① 진폭  — 광대역 RMS가 자기 베이스라인 한계를 넘는가
//   ② 충격성 — 첨도가 자기 베이스라인 한계를 넘는가
//   ③ 결함주파수 — 표적 격자 채택 (지금까지 재던 축)
// 합집합은 검정을 세 번 하는 셈이라 오탐도 늘어난다 → **각 축을 조여 합쳐서 같은 오탐**이 되게 맞춘다.
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const DIR = path.join(ROOT, 'xjtu_seq');
const LEARN = 0.2;    // 앞 20%를 평소로 학습 (가속시험이라 더 뒤로 가면 이미 열화가 섞인다)
const GUARD = 0.3;    // 학습 직후 ~30%까지는 오탐 계산에서 뺀다 — 열화 시작 시점을 모르기 때문

if (!fs.existsSync(DIR)) { console.log(`데이터 없음 (${DIR}) — 건너뜀`); process.exit(0); }

const readF64 = (p) => {
  const buf = fs.readFileSync(p);
  const n = buf.byteLength / 8, out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
};

const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const byBrg = {};
for (const [name, c] of Object.entries(meta.cases)) (byBrg[c.bearing] = byBrg[c.bearing] || []).push({ name, ...c });

const seqs = {};
for (const brg of Object.keys(byBrg).sort()) {
  const rows = byBrg[brg].sort((a, b) => a.minute - b.minute);
  const rms = [], kurt = [], hit = [];
  for (const r of rows) {
    const f = path.join(DIR, r.name + '.f64');
    const v = readF64(f);
    let mean = 0; for (let i = 0; i < v.length; i++) mean += v[i]; mean /= v.length;
    let s2 = 0, s4 = 0;
    for (let i = 0; i < v.length; i++) { const d = v[i] - mean; s2 += d * d; s4 += d * d * d * d; }
    rms.push(Math.sqrt(s2 / v.length));
    kurt.push(s4 / v.length / ((s2 / v.length) ** 2));
    const fr = r.rpm / 60, bf = VC.bearingFreqs(r.rpm, r.geo);
    const env = VC.envelopeSpectrum(v, r.fs, VC.envMaxFor(bf, fr, r.fs), VC.demodFixed(r.fs));
    const tg = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
    hit.push(!!(tg && tg.adopted));
  }
  seqs[brg] = { rows, rms, kurt, hit, fault: rows[0].fault, N: rows.length };
  console.log(`  ${brg} ${rows.length}분`);
}

/** 자기 초기 구간을 평소로 학습해 한계를 낸다. k를 키우면 조여진다 */
function limitOf(vals, learnEnd, k) {
  const bl = VC.baselineFit(vals.slice(0, learnEnd));
  if (!bl) return Infinity;
  bl.k = k;
  return VC.baselineLimit(bl);
}
const firstAt = (flags, esc) => {
  let hot = 0;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) { hot++; if (hot >= esc) return i - esc + 1; } else hot = 0;
  }
  return -1;
};
const alarmsIn = (flags, from, to, esc, rec) => {
  let st = 0, hot = 0, cool = 0, n = 0;
  for (let i = from; i < to; i++) {
    if (flags[i]) { hot++; cool = 0; } else { cool++; hot = 0; }
    if (!st && hot >= esc) { st = 1; n++; } else if (st && cool >= rec) st = 0;
  }
  return n;
};

const ESC = 2, REC = 5;
const AXES = [
  { key: 'rms', ko: '진폭(RMS)' },
  { key: 'kurt', ko: '충격성(첨도)' },
  { key: 'freq', ko: '결함주파수' },
  { key: 'any', ko: '합집합(어느 축이든)' },
];

/** k(σ 배수)를 주면 각 베어링의 축별 플래그를 만든다 */
function flagsFor(s, k) {
  const le = Math.max(VC.BASELINE_MIN_N, Math.floor(s.N * LEARN));
  const lr = limitOf(s.rms, le, k), lk = limitOf(s.kurt, le, k);
  const fr_ = s.rms.map((v, i) => i >= le && v > lr);
  const fk = s.kurt.map((v, i) => i >= le && v > lk);
  const ff = s.hit.map((v, i) => i >= le && v);
  return { rms: fr_, kurt: fk, freq: ff, any: fr_.map((_, i) => fr_[i] || fk[i] || ff[i]) };
}

console.log('');
console.log('=== 축별 — 자기 초기 20%를 평소로 학습 (k=3σ) ===');
console.log('축                  검출한 베어링   첫 경보(수명 대비 남은 %)             건전구간 오경보');
for (const ax of AXES) {
  const lead = [], fp = [];
  let det = 0;
  for (const brg of Object.keys(seqs).sort()) {
    const s = seqs[brg];
    const F = flagsFor(s, 3)[ax.key];
    const at = firstAt(F, ESC);
    if (at >= 0) det++;
    lead.push(`${brg.replace('Bearing', '')}${at < 0 ? '—' : Math.round((s.N - at) / s.N * 100) + '%'}`);
    const g = Math.floor(s.N * GUARD);
    fp.push(alarmsIn(F, 0, g, ESC, REC));
  }
  console.log(`${ax.ko.padEnd(20)}${String(det).padStart(3)}/6         ${lead.join(' ').padEnd(38)}${fp.reduce((a, b) => a + b, 0)}건`);
}

console.log('');
console.log('=== 합집합의 k를 조여 오경보를 맞췄을 때 ===');
console.log('k(σ)   검출   첫 경보(남은 %)                        건전구간 오경보   자산·월당');
for (const k of [3, 4, 5, 6, 8]) {
  const lead = []; let det = 0, fpN = 0, mins = 0;
  for (const brg of Object.keys(seqs).sort()) {
    const s = seqs[brg];
    const F = flagsFor(s, k).any;
    const at = firstAt(F, ESC);
    if (at >= 0) det++;
    lead.push(`${brg.replace('Bearing', '')}${at < 0 ? '—' : Math.round((s.N - at) / s.N * 100) + '%'}`);
    const g = Math.floor(s.N * GUARD);
    fpN += alarmsIn(F, 0, g, ESC, REC); mins += g;
  }
  console.log(`  ${String(k).padStart(2)}   ${det}/6    ${lead.join(' ').padEnd(38)}${String(fpN).padStart(3)}/${String(mins).padEnd(5)}      ${(fpN / mins * 30 * 24 * 6).toFixed(1)}건/월`);
}

console.log('');
console.log('=== 축별 궤적 (k=3, 학습 20% 이후만) ===');
for (const brg of Object.keys(seqs).sort()) {
  const s = seqs[brg], f = flagsFor(s, 3), W = 50;
  const draw = (F) => {
    let o = '';
    for (let i = 0; i < W; i++) {
      const a = Math.floor(i * s.N / W), b = Math.max(a + 1, Math.floor((i + 1) * s.N / W));
      const fr_ = F.slice(a, b).filter(Boolean).length / (b - a);
      o += fr_ === 0 ? '·' : fr_ < 0.5 ? '▪' : '█';
    }
    return o;
  };
  console.log(`  ${brg.replace('Bearing', '')} ${s.fault.padEnd(5)} 진폭 ${draw(f.rms)}`);
  console.log(`  ${''.padEnd(9)} 주파수 ${draw(f.freq)}`);
}
