// 공개 데이터셋 교차검증 — 베어링 축(포락선 → 결함주파수 대조)의 실측 성적을 낸다.
// 합성 신호 검사(test-dsp)가 "계산이 맞는가"를 보는 자리라면, 여기는 "실제 결함을 잡는가"를 본다.
//
// 원본 아카이브를 변환한 .f64 + index.json이 있어야 한다(변환 스크립트는 데이터 옆에 둔다).
// 데이터가 없으면 조용히 건너뛴다 — 이 검사는 smoke에 넣지 않는다(수백 MB 원본이 전제).
//   node tools/verify-datasets.mjs [데이터루트] [데이터셋…]
//
// 기억할 것: 판별자를 고치기 전에 정상/결함 양쪽에서 먼저 잰다. 결함만 보고 임계를 맞추면
// 다중비교 함정에 빠진다 — 이 프로젝트에서 이미 세 번 기각당한 경로다.
import fs from 'node:fs';
import path from 'node:path';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = argv[0] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const ONLY = argv.slice(1);
// --band=1000:5000 으로 복조 대역을 고정해 커토그램과 대조할 수 있다(verify-demodband의 후속 확인용)
const bandArg = process.argv.find((a) => a.startsWith('--band='));
const FIXED_BAND = bandArg
  ? { loHz: +bandArg.slice(7).split(':')[0], hiHz: +bandArg.slice(7).split(':')[1] }
  : null;
/* 분석 창 — 샘플 수를 고정하면 데이터셋마다 **회전수**가 달라진다.
   64 kHz·1500 rpm이면 1.02 s = 26회전인데 같은 샘플로 900 rpm이면 15회전뿐이다.
   측대역 하나를 분해하려면 충분한 회전이 필요하므로, 회전수를 기준으로 잡는다.
   --rev=N 으로 목표 회전수를 바꿔 가며 잴 수 있다(기본 0 = 예전처럼 샘플 고정). */
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

/** 앱의 베어링 축과 같은 순서로 돌린다: 커토그램 → 대역통과 포락선 → 결함주파수 대조 */
function analyze(v, fs_, rpm, geo, mount) {
  /* 앱과 같은 순서 — 1×를 실측해 결함주파수를 그 위에 세운다(명판 RPM은 슬립을 반영 못 한다) */
  /* 1×를 실측해 결함주파수를 그 위에 세운다 — 명판 RPM은 슬립을 반영하지 못한다.
     단 **분해능보다 큰 차이일 때만** 채택한다. 구분되지 않는 차이로 축을 옮기면
     결함주파수가 잡음만큼 흔들려 오탐이 는다(가드 없이 MaFaulDa 오탐 1/24 → 10/24). */
  const rpmUse = rpm;   // 명판 그대로 — 실측 1×는 같은 오탐에서 검출을 54%→31%로 떨어뜨렸다
  const fr = rpmUse / 60;
  const bf = VC.bearingFreqs(rpmUse, geo);
  // 커토그램 상한: 마운팅 상한과 별개로 Nyquist 상한을 항상 건다.
  // 안티에일리어싱 롤오프 구간은 에너지가 죽어 첨도가 폭발하므로 늘 그쪽이 뽑힌다.
  const nyq = fs_ / 2;
  // 제품과 같은 순서를 쓴다: 저역 고정 대역이 성립하면 그것, 아니면 커토그램
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
  const env = VC.envelopeSpectrum(v, fs_, VC.envMaxFor(bf, fr, fs_), band);   // 앱과 같은 식(envMaxFor가 4×최고후보)
  const envQ = VC.envelopeQuant(env.freqs, env.mags, fr);
  const sb = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
  const bm = VC.bearingMatch(envQ, bf, fr, env.resTrue || env.res, sb);
  return { kg, env, envQ, bm, sb };
}

/* xjtu_seq는 전 수명 시퀀스라 초반 파일이 실제로는 건전한데 최종 고장 부위로 라벨돼 있다.
   스냅샷 성적에 섞으면 분모가 오염되므로 뺀다 — 그쪽은 verify-leadtime이 시간축으로 본다. */
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
        // 종류 적중은 단일 라벨에만 매긴다 — MIX는 어느 쪽을 집어도 맞아서 성적을 부풀린다
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
