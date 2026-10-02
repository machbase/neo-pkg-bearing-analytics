// 감시용 창 길이별 검출 — 같은 오탐률(4%)에서 창(회전수 기준·표본 고정)별 검출·종류 적중·goja 소요 추정
// · 서버 감시(goja)는 느려 창 길이 = 회차 소요, 감시는 트리거(확정은 상세분석)라 검출 유지 여부만 확인
// · 로컬 데이터셋 필요(D:/vibe-datasets/conv, 없으면 건너뜀)
import fs from 'node:fs';
import path from 'node:path';
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const HARD = 262144;
if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }
const readF64 = (p, n) => {
  const b = fs.readFileSync(p); const k = Math.min(n, b.byteLength / 8);
  const o = new Array(k); for (let i = 0; i < k; i++) o[i] = b.readDoubleLE(i * 8); return o;
};
const KEY = { BPFO:'OR', BPFI:'IR', BSF:'BALL' };
/* 창 후보 — rev는 회전수 기준(제품 방식), n은 표본 고정(대역 방식) */
const WINS = [
  { k:'rev100', ko:'100회전 (현행)', rev:100 },
  { k:'rev50',  ko:'50회전',  rev:50 },
  { k:'rev25',  ko:'25회전',  rev:25 },
  { k:'n32768', ko:'32,768 표본 고정', n:32768 },
  { k:'n16384', ko:'16,384 표본 고정', n:16384 },
  { k:'n8192',  ko:'8,192 표본 고정',  n:8192 },
  { k:'n4096',  ko:'4,096 표본 고정',  n:4096 },
];
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
    const avail = fs.statSync(fp).size / 8;
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo);
    const band = VC.demodFixed(c.fs); if (!band) continue;
    const eMax = VC.envMaxFor(bf, fr, c.fs);
    const r = { ds, label: c.label, fs: c.fs, rpm: c.rpm };
    for (const w of WINS) {
      const want = w.rev ? Math.round(c.fs * w.rev / fr) : w.n;
      const v = readF64(fp, Math.min(HARD, avail, Math.max(4096, want)));
      if (v.length < 4096) { r[w.k] = { r: 0, k: '', n: 0 }; continue; }
      const env = VC.envelopeSpectrum(v, c.fs, eMax, band);
      const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
      let m = 1; while (m * 2 <= v.length) m *= 2;
      r[w.k] = { r: t ? t.r || 0 : 0, k: t ? t.key || '' : '', n: m };
    }
    rows.push(r);
  }
  console.log(`  ${ds} 완료`);
}
console.log('');

const H = rows.filter((r) => r.label === 'none'), F = rows.filter((r) => r.label !== 'none');
const S = rows.filter((r) => ['OR','IR','BALL'].includes(r.label));
const FP = 4 / 100;
console.log(`오탐을 ${Math.round(FP*100)}%에 고정 · 정상 ${H.length} · 결함 ${F.length}\n`);
console.log('창                     실제 N 중앙   임계    오탐      검출          종류적중   goja 추정');
for (const w of WINS) {
  const get = (r) => r[w.k].r;
  const hv = H.map(get).sort((a,b) => b-a);
  const T = hv[Math.max(0, Math.floor(hv.length*FP)-1)] + 1e-12;
  const det = F.filter((r) => get(r) >= T).length;
  const fired = S.filter((r) => get(r) >= T);
  const ok = fired.filter((r) => KEY[r[w.k].k] === r.label).length;
  const ns = rows.map((r) => r[w.k].n).filter((x) => x > 0).sort((a,b) => a-b);
  const nm = ns[Math.floor(ns.length/2)] || 0;
  /* goja 기준값(16,384 표본 855 ms)을 FFT N log N 비로 환산 */
  const ms = nm > 0 ? 855 * (nm * Math.log2(nm)) / (16384 * 14) : 0;
  console.log(w.ko.padEnd(22) + String(nm).padStart(9) + T.toFixed(2).padStart(8)
    + `${H.filter((r)=>get(r)>=T).length}/${H.length}`.padEnd(9) + '  '
    + `${det}/${F.length}`.padEnd(9) + String(Math.round(det/F.length*100)).padStart(4) + '%   '
    + `${ok}/${fired.length}`.padEnd(10) + Math.round(ms) + ' ms');
}
console.log('');
console.log('(goja 추정 = 16,384 표본 실측 855 ms를 N log N으로 환산 · 91태그 10분 주기 점유율)');
for (const w of WINS) {
  const ns = rows.map((r) => r[w.k].n).filter((x)=>x>0).sort((a,b)=>a-b);
  const nm = ns[Math.floor(ns.length/2)] || 0;
  const ms = nm > 0 ? 855 * (nm*Math.log2(nm)) / (16384*14) : 0;
  console.log('  ' + w.ko.padEnd(22) + (ms*91/1000).toFixed(0).padStart(5) + '초 / 600초 = ' + Math.round(ms*91/6000) + '%');
}
