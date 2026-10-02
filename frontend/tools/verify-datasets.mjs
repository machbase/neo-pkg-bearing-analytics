// 공개 데이터셋 교차검증 — 베어링 축(포락선 → 결함주파수 대조)의 정상 오탐·결함 검출·종류 적중 측정
// · 계산 정확성은 합성 신호 검사(test-dsp), 여기는 실제 결함 검출 여부
// · 로컬 데이터셋 필요(변환된 .f64 + index.json, 기본 D:/vibe-datasets/conv, 없으면 건너뜀) · smoke 미포함
//   node tools/verify-datasets.mjs [데이터루트] [데이터셋…] [--band=lo:hi] [--rev=N]
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = argv[0] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const ONLY = argv.slice(1);
// --band=1000:5000으로 복조 대역 고정(커토그램 대조용)
const bandArg = process.argv.find((a) => a.startsWith('--band='));
const FIXED_BAND = bandArg
  ? { loHz: +bandArg.slice(7).split(':')[0], hiHz: +bandArg.slice(7).split(':')[1] }
  : null;
/* 분석 창 — 샘플 수 아닌 회전수 기준(샘플 고정이면 데이터셋마다 회전수가 달라 측대역 분해 불균일)
   --rev=N으로 목표 회전수 지정(기본 100, 0이면 샘플 고정) */
const HARD_CAP = 262144;
const revArg = process.argv.find((a) => a.startsWith('--rev='));
const REV = revArg ? +revArg.slice(6) : 100;   // 제품(live.js REV_TARGET)과 같은 값
const MAX_N = 65536;
const winFor = (fs_, rpm, avail) => {
  if (!REV) return Math.min(MAX_N, avail);
  const need = Math.round(fs_ * REV / (rpm / 60));
  return Math.min(HARD_CAP, avail, Math.max(16384, need));
};

if (!fs.existsSync(ROOT)) {
  console.log(`데이터 없음 (${ROOT}) — 건너뜀`);
  process.exit(0);
}

const readF64 = (p, cap) => {
  const buf = fs.readFileSync(p);
  const n = Math.min(cap, buf.byteLength / 8);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
};

/** 베어링 축 분석: 복조 대역(고정 대역, 불성립 시 커토그램) → 포락선 → 결함주파수 대조 */
function analyze(v, fs_, rpm, geo, mount) {
  const rpmUse = rpm;   // 명판 회전수 그대로(1× 실측 보정 미적용)
  const fr = rpmUse / 60;
  const bf = VC.bearingFreqs(rpmUse, geo);
  // 커토그램 상한: 마운팅 상한과 별개로 Nyquist 상한 항상 적용(롤오프 구간은 첨도 폭발로 늘 선택됨)
  const nyq = fs_ / 2;
  // 고정 대역 성립 시 그것, 아니면 커토그램(제품은 전대역 복조)
  let kg = null, band = FIXED_BAND || VC.demodFixed(fs_);
  if (!band) {
    const caps = [nyq * VC.KG_NYQ_FRAC];
    const mf = VC.mountFmax ? VC.mountFmax(mount) : 0;
    if (mf > 0) caps.push(mf);
    kg = VC.kurtogram(v, fs_, Math.min(...caps));
    band = kg && kg.best ? { loHz: kg.best.loHz, hiHz: kg.best.hiHz } : null;
  } else if (band.hiHz > nyq * 0.95) {
    band = null;
  }
  const env = VC.envelopeSpectrum(v, fs_, VC.envMaxFor(bf, fr, fs_), band);   // 앱과 같은 식(envMaxFor = 최고 후보 × 6)
  const envQ = VC.envelopeQuant(env.freqs, env.mags, fr);
  const sb = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
  const bm = VC.bearingMatch(envQ, bf, fr, env.resTrue || env.res, sb);
  return { kg, env, envQ, bm, sb };
}

/* 전 수명 시퀀스는 초반 건전 파일이 최종 고장 부위로 라벨돼 분모 오염 → 제외(verify-leadtime 담당) */
const SEQ_ONLY = ['xjtu_seq', 'nasa_seq'];
const datasets = fs.readdirSync(ROOT).filter((d) => {
  if (ONLY.length) return ONLY.includes(d);
  if (SEQ_ONLY.includes(d)) return false;
  return fs.existsSync(path.join(ROOT, d, 'index.json'));
});

const KEYMAP = { BPFO: 'OR', BPFI: 'IR', BSF: 'BALL' };
const rows = [];
const perCase = [];

for (const ds of datasets) {
  const dir = path.join(ROOT, ds);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const names = Object.keys(meta.cases);
  let healthyHit = 0, healthyN = 0, faultHit = 0, faultN = 0, typeOk = 0, typeN = 0;

  for (const name of names) {
    const c = meta.cases[name];
    if (!c.geo || !c.rpm || !c.fs) continue;              // 기하 없으면 대조 자체가 불가
    const f = path.join(dir, name + '.f64');
    if (!fs.existsSync(f)) continue;
    const avail = fs.statSync(f).size / 8;
    const v = readF64(f, winFor(c.fs, c.rpm, avail));
    if (v.length < 4096) continue;
    const r = analyze(v, c.fs, c.rpm, c.geo, meta.mount);
    const hit = r.bm && r.bm.hit;
    const healthy = c.label === 'none';
    if (healthy) { healthyN++; if (hit) healthyHit++; }
    else {
      faultN++;
      if (hit) {
        faultHit++;
        // 종류 적중은 단일 라벨만 — MIX는 어느 쪽을 집어도 맞아 성적 과대
        if (c.label === 'OR' || c.label === 'IR' || c.label === 'BALL') {
          typeN++;
          if (KEYMAP[hit.key] === c.label) typeOk++;
        }
      }
    }
    perCase.push({
      ds, name, label: c.label, origin: c.origin,
      hit: hit ? hit.key : '', ord: hit ? hit.ord : 0,
      harm: r.envQ ? r.envQ.harm : 0,
      envOrder: r.envQ && r.envQ.order ? +r.envQ.order.toFixed(2) : 0,
      kgLo: r.kg && r.kg.best ? Math.round(r.kg.best.loHz) : 0,
      kgHi: r.kg && r.kg.best ? Math.round(r.kg.best.hiHz) : 0,
      capped: !!(r.kg && r.kg.capped),
    });
  }
  rows.push({ ds, healthyN, healthyHit, faultN, faultHit, typeN, typeOk });
  const pc = (a, b) => (b ? ((a / b) * 100).toFixed(0) + '%' : '-');
  console.log(
    `${ds.padEnd(10)} 정상 ${String(healthyN).padStart(3)}건 중 오탐 ${String(healthyHit).padStart(3)} (${pc(healthyHit, healthyN)})`
    + ` · 결함 ${String(faultN).padStart(3)}건 중 검출 ${String(faultHit).padStart(3)} (${pc(faultHit, faultN)})`
    + ` · 종류 ${typeOk}/${typeN} (${pc(typeOk, typeN)})`);
}

const sum = rows.reduce((a, r) => ({
  healthyN: a.healthyN + r.healthyN, healthyHit: a.healthyHit + r.healthyHit,
  faultN: a.faultN + r.faultN, faultHit: a.faultHit + r.faultHit,
  typeN: a.typeN + r.typeN, typeOk: a.typeOk + r.typeOk,
}), { healthyN: 0, healthyHit: 0, faultN: 0, faultHit: 0, typeN: 0, typeOk: 0 });

console.log('');
console.log(`합계  정상 오탐 ${sum.healthyHit}/${sum.healthyN}`
  + ` · 결함 검출 ${sum.faultHit}/${sum.faultN}`
  + ` · 종류 적중 ${sum.typeOk}/${sum.typeN}`);

const outPath = path.join(ROOT, 'verify-cases.json');
fs.writeFileSync(outPath, JSON.stringify(perCase, null, 1));
console.log(`케이스별 결과 → ${outPath}`);
