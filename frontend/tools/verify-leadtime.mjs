// 리드타임·오경보율 측정(전 수명 시퀀스) — ① 고장까지 남은 수명 대비 첫 경보 시점 ② 자산당 헛경보 빈도·발화 궤적
// · 오경보 분모: 끝까지 건전한 베어링(NASA IMS), 건전 대조군 없는 세트(XJTU)는 수명 앞 50% 건전 가정
// · 로컬 데이터셋 필요(D:/vibe-datasets/conv, 세트 없으면 건너뜀)
//   node tools/verify-leadtime.mjs [데이터루트] [세트…]
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = argv[0] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const SETS = argv.length > 1 ? argv.slice(1) : ['xjtu_seq', 'nasa_seq'];
const ESC = 2, REC = 5;        // 진입 확인 · 복귀 유지 (연속 판정 횟수)
const HEALTHY_FRAC = 0.5;      // 건전 대조군이 없는 세트에서만 쓰는 폴백

const readF64 = (p) => {
  const buf = fs.readFileSync(p);
  const n = buf.byteLength / 8, out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
};
const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };

const firstAt = (F, esc) => {
  let hot = 0;
  for (let i = 0; i < F.length; i++) { if (F[i]) { hot++; if (hot >= esc) return i - esc + 1; } else hot = 0; }
  return -1;
};
/* 알람 상태기 — esc회 연속 발화 시 1건, rec회 연속 정상 전까지 재알림 없음(지속 발화 = 알람 1건) */
const notifs = (F, from, to, esc, rec) => {
  let st = 0, hot = 0, cool = 0, n = 0;
  for (let i = from; i < to; i++) {
    if (F[i]) { hot++; cool = 0; } else { cool++; hot = 0; }
    if (!st && hot >= esc) { st = 1; n++; } else if (st && cool >= rec) st = 0;
  }
  return n;
};
const dur = (min) => (min >= 1440 ? (min / 1440).toFixed(1) + '일' : (min / 60).toFixed(1) + '시간');

for (const ds of SETS) {
  const dir = path.join(ROOT, ds);
  if (!fs.existsSync(path.join(dir, 'index.json'))) { console.log(`${ds}: 없음 — 건너뜀`); continue; }
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const byBrg = {};
  for (const [name, c] of Object.entries(meta.cases)) {
    (byBrg[c.bearing || 'unknown'] = byBrg[c.bearing || 'unknown'] || []).push({ name, ...c });
  }

  console.log('');
  console.log(`########  ${ds}  ########`);
  const seqs = {};
  for (const brg of Object.keys(byBrg).sort()) {
    const rows = byBrg[brg].sort((a, b) => (a.minute ?? a.idx) - (b.minute ?? b.idx));
    const hit = [];
    for (const r of rows) {
      const f = path.join(dir, r.name + '.f64');
      if (!fs.existsSync(f)) { hit.push(''); continue; }
      const v = readF64(f);
      // 결함주파수는 명판 RPM 기준(live.js와 동일)
      const fr = r.rpm / 60, bf = VC.bearingFreqs(r.rpm, r.geo);
      const env = VC.envelopeSpectrum(v, r.fs, VC.envMaxFor(bf, fr, r.fs), VC.demodFixed(r.fs));
      const res = env.resTrue || env.res;
      const tg = VC.targetedMatch(env, bf, fr, res);
      const bm = VC.bearingMatch(VC.envelopeQuant(env.freqs, env.mags, fr), bf, fr, res, tg);
      hit.push(bm.hit ? (KEYMAP[bm.hit.key] || bm.hit.key) : '');
    }
    const label = rows[0].fault || rows[0].label || '?';
    const spanMin = (rows[rows.length - 1].minute ?? 0) - (rows[0].minute ?? 0);
    seqs[brg] = { rows, hit, label, N: rows.length, spanMin };
    console.log(`  ${brg.padEnd(8)} ${String(rows.length).padStart(4)}점 ${dur(spanMin).padStart(8)} ${label}`);
  }

  const faulty = Object.keys(seqs).filter((b) => seqs[b].label !== 'none' && seqs[b].label !== '?');
  const healthy = Object.keys(seqs).filter((b) => seqs[b].label === 'none');

  console.log('');
  console.log('── ① 리드타임 ──');
  for (const brg of faulty) {
    const s = seqs[brg];
    const at = firstAt(s.hit, ESC);
    console.log(`  ${brg.padEnd(8)} ${s.label.padEnd(5)} ${at < 0 ? '미검출'
      : `잔여 ${String(Math.round((s.N - at) / s.N * 100)).padStart(3)}% = ${dur(Math.round(s.spanMin * (s.N - at) / s.N))}`}`);
  }

  console.log('');
  if (healthy.length) {
    console.log('── ② 오경보 — 끝까지 건전했던 베어링 (제대로 된 분모) ──');
    let a = 0, totDays = 0;
    for (const brg of healthy) {
      const s = seqs[brg], days = s.spanMin / 1440;
      const k = notifs(s.hit, 0, s.N, ESC, REC);
      a += k; totDays += days;
      console.log(`  ${brg.padEnd(8)} ${String(s.N).padStart(4)}점 ${days.toFixed(1).padStart(5)}일 → 알람 ${k}건  (${(k / days * 30).toFixed(1)}건/월)`);
    }
    console.log(`  ${'합계'.padEnd(8)}      ${totDays.toFixed(1).padStart(5)}일 → ${a}건 = ${(a / totDays * 30).toFixed(2)}건/자산·월`);
  } else {
    console.log('── ② 오경보 — 건전 대조군 없음, 수명 앞 50%로 대체(가정이 흔들림) ──');
    let a = 0, d = 0;
    for (const brg of faulty) {
      const s = seqs[brg], end = Math.floor(s.N * HEALTHY_FRAC);
      a += notifs(s.hit, 0, end, ESC, REC); d += s.spanMin * HEALTHY_FRAC / 1440;
    }
    console.log(`  ${a}건 / ${d.toFixed(2)}일 = ${(a / d * 30).toFixed(1)}건/자산·월 (분모 신뢰 낮음)`);
  }

  console.log('');
  console.log('── 발화 궤적 ──');
  for (const brg of Object.keys(seqs).sort()) {
    const s = seqs[brg], W = 56;
    let o = '';
    for (let i = 0; i < W; i++) {
      const a2 = Math.floor(i * s.N / W), b2 = Math.max(a2 + 1, Math.floor((i + 1) * s.N / W));
      const f = s.hit.slice(a2, b2).filter(Boolean).length / (b2 - a2);
      o += f === 0 ? '·' : f < 0.5 ? '▪' : '█';
    }
    console.log(`  ${brg.padEnd(8)} ${s.label.padEnd(5)} ${o}`);
  }
}
