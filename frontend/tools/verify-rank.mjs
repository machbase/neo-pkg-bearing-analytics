// 결함 검출 두 질문 분리 측정 — 로컬 데이터셋 필요(D:/vibe-datasets/conv, 없으면 건너뜀)
//  Q1 이상 자체: 데이터셋별 정상 최댓값을 넘는 결함 비율(RMS·첨도·결함주파수 순위 1위)
//  Q2 결함 종류 순위: 1위·1~2위·3위 비율(후보 셋뿐이라 3위 = 배제 불가), 라벨별 순위
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
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const KEY = { OR: 'BPFO', IR: 'BPFI', BALL: 'BSF' };
const datasets = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.json')));
const all = [];

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

    // ── 진폭·충격성 (종류와 무관한 "이상 자체" 지표) ──
    let mean = 0; for (let i = 0; i < v.length; i++) mean += v[i]; mean /= v.length;
    let s2 = 0, s4 = 0;
    for (let i = 0; i < v.length; i++) { const d = v[i] - mean; s2 += d * d; s4 += d * d * d * d; }
    const rms = Math.sqrt(s2 / v.length);
    const kurt = s4 / v.length / (s2 / v.length) ** 2;

    // ── 결함주파수 후보별 근거 세기 (순위용) ──
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo);
    const env = VC.envelopeSpectrum(v, c.fs, Math.max(500, 12 * fr), VC.demodFixed(c.fs));
    const res = env.resTrue || env.res;
    const mm = med(env.mags);
    const cand = [
      { L: 'OR', r: VC.combRatio(env, bf.BPFO, 0, mm, res).r },
      { L: 'IR', r: VC.combRatio(env, bf.BPFI, fr, mm, res).r },
      { L: 'BALL', r: Math.max(VC.combRatio(env, bf.BSF, bf.FTF, mm, res).r, VC.combRatio(env, 2 * bf.BSF, bf.FTF, mm, res).r) },
    ].sort((a, b) => b.r - a.r);
    const rank = cand.findIndex((x) => x.L === c.label) + 1;   // 0 = 라벨이 단일 종류가 아님
    all.push({ ds, label: c.label, rms, kurt, rank, top: cand[0].L, sep: cand.map((x) => `${x.L}:${x.r.toFixed(1)}`).join(' ') });
  }
  console.log(`  ${ds} 끝`);
}

console.log('');
console.log('=== Q1. 이상이 있다는 것 자체가 잡히는가 (정상 대비 분리) ===');
console.log('%s', '정상 상위값을 넘는 결함 비율 — 넘지 못하면 그 지표로는 정상과 구분이 안 된다는 뜻');
console.log('데이터셋        정상n 결함n   RMS로 분리        첨도로 분리       결함주파수로 분리');
for (const ds of datasets) {
  const h = all.filter((r) => r.ds === ds && r.label === 'none');
  const f = all.filter((r) => r.ds === ds && r.label !== 'none');
  if (!h.length || !f.length) continue;
  const hiR = Math.max(...h.map((r) => r.rms));
  const hiK = Math.max(...h.map((r) => r.kurt));
  const overR = f.filter((r) => r.rms > hiR).length;
  const overK = f.filter((r) => r.kurt > hiK).length;
  // 결함주파수는 빗 비율 순위 1위 근거가 라벨과 일치하는 비율
  const overF = f.filter((r) => r.rank === 1).length;
  const pc = (a, b) => String(Math.round(a / b * 100)).padStart(3) + '%';
  console.log(`${ds.padEnd(15)} ${String(h.length).padStart(4)} ${String(f.length).padStart(5)}`
    + `   ${`${overR}/${f.length}`.padEnd(8)}${pc(overR, f.length)}`
    + `   ${`${overK}/${f.length}`.padEnd(8)}${pc(overK, f.length)}`
    + `   ${`${overF}/${f.length}`.padEnd(8)}${pc(overF, f.length)}`);
}

console.log('');
console.log('=== Q2. 결함 종류가 순위 안에 있는가 (단일 라벨 케이스만) ===');
console.log('데이터셋        건수    1위        1~2위       3위(=배제 못 함)');
const tot = [0, 0, 0, 0];
for (const ds of datasets) {
  const f = all.filter((r) => r.ds === ds && r.rank > 0);
  if (!f.length) continue;
  const r1 = f.filter((r) => r.rank === 1).length;
  const r2 = f.filter((r) => r.rank <= 2).length;
  const r3 = f.filter((r) => r.rank === 3).length;
  tot[0] += f.length; tot[1] += r1; tot[2] += r2; tot[3] += r3;
  const pc = (a) => String(Math.round(a / f.length * 100)).padStart(3) + '%';
  console.log(`${ds.padEnd(15)} ${String(f.length).padStart(4)}   ${`${r1}`.padEnd(5)}${pc(r1)}   ${`${r2}`.padEnd(5)}${pc(r2)}   ${`${r3}`.padEnd(5)}${pc(r3)}`);
}
const pt = (a) => String(Math.round(a / tot[0] * 100)).padStart(3) + '%';
console.log(`${'합계'.padEnd(15)} ${String(tot[0]).padStart(4)}   ${`${tot[1]}`.padEnd(5)}${pt(tot[1])}   ${`${tot[2]}`.padEnd(5)}${pt(tot[2])}   ${`${tot[3]}`.padEnd(5)}${pt(tot[3])}`);

console.log('');
console.log('라벨별 순위:');
for (const L of ['OR', 'IR', 'BALL']) {
  const f = all.filter((r) => r.label === L);
  if (!f.length) continue;
  const r1 = f.filter((r) => r.rank === 1).length, r2 = f.filter((r) => r.rank <= 2).length;
  console.log(`  ${L.padEnd(5)} ${String(f.length).padStart(4)}건   1위 ${String(r1).padStart(3)} (${Math.round(r1 / f.length * 100)}%)`
    + `   1~2위 ${String(r2).padStart(3)} (${Math.round(r2 / f.length * 100)}%)`);
}
