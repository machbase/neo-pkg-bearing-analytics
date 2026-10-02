/* 시간축 지속성 — "K회차 연속 발화 시 확정"(escHold)이 오탐을 줄이는지 실제 10분 주기로 측정
 * · 오탐이 회차를 건너 지속(연속 요구 무효)인지 무작위(유효)인지 — 발화 연속 길이 분포 + K=1·2·3 건전 경보·결함 검출
 * · 대상: NASA IMS Set 2(기본) 또는 Set 1(인자 s1) · 라이브(Neo 필요, NASA_BEARING 테이블)
 * · 회차별 발화 계열을 persist-<set>.json으로 저장해 사후 분석
 *   node tools/verify-persist.mjs [s2|s1]
 */
globalThis.window = globalThis;
const _f = globalThis.fetch;
globalThis.fetch = (u, o) => _f(typeof u === 'string' && u.startsWith('/') ? 'http://127.0.0.1:5654' + u : u, o);
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const q = async (s) => (await (await fetch('/db/query?q=' + encodeURIComponent(s) + '&format=csv&timeformat=ms')).text()).trim().split('\n').slice(1);

const GEO = { n: 16, Bd: 8.4, Pd: 71.5, phi: 15.17 }, FS = 20480, RPM = 2000, ZONES = [0.71, 1.8, 4.5];
/* 인자로 세트 선택 — Set 2는 옆 베어링 파손 중인 최악 조건, Set 1은 건전 구간이 길고 실행이 오래 걸림 */
const SET = process.argv[2] || 's2';
const ALL = {
  s2: [['s2-c1', '외륜'], ['s2-c2', '정상'], ['s2-c3', '정상'], ['s2-c4', '정상']],
  s1: [['s1-c1', '정상'], ['s1-c2', '정상'], ['s1-c3', '정상'], ['s1-c4', '정상'],
       ['s1-c5', '내륜'], ['s1-c7', '구름체']],
};
const TAGS = ALL[SET] || ALL.s2;
const STEP = 10 * 60000;   // 실제 감시 주기

const bf = VC.bearingFreqs(RPM, GEO), fr = RPM / 60;
const band = VC.demodFixed(FS), eMax = VC.envMaxFor(bf, fr, FS);
const secs = Math.min(22, VC.MON_REV / fr);
const need = Math.max(4096, Math.round(FS * VC.MON_REV / fr));

console.log(`시간축 지속성 — 10분 주기 · 창 ${VC.MON_REV}회전 · 임계 ${VC.MON_ADOPT}\n`);

const series = {};   // tag -> {truth, t0, t1, ticks: [{at, r, fired}]}
for (const [tag, truth] of TAGS) {
  const st = (await q(`select MIN_TIME, MAX_TIME from V$NASA_BEARING_STAT where NAME='${tag}'`))[0].split(',');
  const t0 = +st[0], t1 = +st[1];
  const snapRows = await q(`select ROLLUP('min',1,TIME) rt from NASA_BEARING where NAME='${tag}' group by rt order by rt`);
  const snaps = [];
  let last = -Infinity;
  for (const l of snapRows) {
    const ms = +l.split(',')[0];
    if (ms - last >= STEP) { snaps.push(ms + 60000); last = ms; }
  }
  const out = [];
  for (const at of snaps) {
    let v = [];
    for (const sec of [secs, 60, 180]) {
      const lo = BigInt(Math.round(at - sec * 1000)) * 1000000n, hi = BigInt(at) * 1000000n;
      const rows = await q(`select VALUE from NASA_BEARING where NAME='${tag}' and TIME between ${lo} and ${hi} limit 262144`);
      v = rows.map(Number).filter(isFinite);
      if (v.length >= need) break;
    }
    if (v.length < 4096) continue;
    if (v.length > need) v = v.slice(v.length - need);
    const env = VC.envelopeSpectrum(v, FS, eMax, band);
    const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
    const r = t ? t.r || 0 : 0;
    out.push({ at: at, r: r, fired: r >= VC.MON_ADOPT });
  }
  series[tag] = { truth: truth, t0: t0, t1: t1, ticks: out };
  const nf = out.filter((x) => x.fired).length;
  console.log(`  ${tag} (${truth}) — 회차 ${out.length} · 발화 ${nf} (${(nf / out.length * 100).toFixed(0)}%)`);
}

/* 회차별 발화 계열 파일 저장 — 조회가 수천 건이라 정책(K·첫알람 예외 등) 재분석 시 재조회 생략용 */
{
  const fs = await import('node:fs');
  const dump = {};
  for (const [tag, s] of Object.entries(series)) {
    dump[tag] = { truth: s.truth, t0: s.t0, t1: s.t1, at: s.ticks.map((x) => x.at), r: s.ticks.map((x) => +x.r.toFixed(3)) };
  }
  const out = new URL('./persist-' + SET + '.json', import.meta.url);
  fs.writeFileSync(out, JSON.stringify(dump));
  console.log(`
계열 저장 — ${out.pathname.split('/').pop()}`);
}

// ── 발화 분포(몰림/흩어짐) ────────────────────────────────────────
console.log('\n━━ 발화 연속 길이 분포 ━━');
console.log('  (연속 길이 1이 많으면 무작위 → 연속 요구가 유효 · 길면 지속 → 소용없음)\n');
for (const [tag, s] of Object.entries(series)) {
  const runs = [];
  let cur = 0;
  for (const x of s.ticks) { if (x.fired) cur++; else if (cur) { runs.push(cur); cur = 0; } }
  if (cur) runs.push(cur);
  if (!runs.length) { console.log(`  ${tag} (${s.truth}) — 발화 없음`); continue; }
  const one = runs.filter((n) => n === 1).length;
  const mx = Math.max(...runs);
  const med = runs.slice().sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  console.log(`  ${tag} (${s.truth}) — 구간 ${runs.length}개 · 길이1 ${one}개 · 중앙 ${med} · 최대 ${mx}`);
}

// ── K회차 연속 요구 ────────────────────────────────────────────────
console.log('\n━━ K회차 연속 요구 ━━\n');
console.log('K   건전 경보  결함 검출  결함 첫 경보(잔여%)');
for (const K of [1, 2, 3]) {
  let hAlarm = 0, fHit = 0, fN = 0, remTxt = '없음';
  for (const [, s] of Object.entries(series)) {
    /* 확정 = K회차 연속 발화, 에피소드당 1건(재알림은 별도 주기 담당이라 제외) */
    let run = 0, on = false, alarms = 0, firstAt = null;
    for (const x of s.ticks) {
      if (x.fired) { run++; if (!on && run >= K) { on = true; alarms++; if (firstAt == null) firstAt = x.at; } }
      else { run = 0; on = false; }
    }
    if (s.truth === '정상') hAlarm += alarms;
    else { fN++; if (firstAt != null) { fHit++; remTxt = Math.round((s.t1 - firstAt) / (s.t1 - s.t0) * 100) + '%'; } }
  }
  console.log(`${K}   ${String(hAlarm).padStart(8)}  ${String(fHit + '/' + fN).padStart(9)}  ${remTxt.padStart(18)}`);
}
