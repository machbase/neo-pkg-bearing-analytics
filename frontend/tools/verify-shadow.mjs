// 무알림 병행운전(섀도 모드) 재현 — 감시 규칙(패턴 게이트 + judgeTick)을 NASA IMS 전 수명 시계열에 돌려 이벤트 집계
// · 출력: 건전 베어링 자산·월당 오경보, 결함 베어링 검출·첫 경보 리드타임
// · 라이브(Neo 필요, NASA_BEARING 테이블) · 인자로 태그(s1-c1 …) 지정 시 분할 실행
globalThis.window = globalThis;
const _f = globalThis.fetch;
globalThis.fetch = (u, o) => _f(typeof u === 'string' && u.startsWith('/') ? 'http://127.0.0.1:5654' + u : u, o);
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { judgeTick } = await import('../src/app.js');
const q = async (s) => (await (await fetch('/db/query?q=' + encodeURIComponent(s) + '&format=csv&timeformat=ms')).text()).trim().split('\n').slice(1);

const GEO = { n: 16, Bd: 8.4, Pd: 71.5, phi: 15.17 }, FS = 20480, RPM = 2000, ZONES = [0.71, 1.8, 4.5];
/* 인자로 태그 분할 실행 — 전 태그 일괄은 조회가 수천 건, 분할 시 합계는 수동 합산 */
const ONLY = process.argv.slice(2).filter(function (a) { return /^s[0-9]+-c[0-9]+$/.test(a); });
const ALL_TAGS = [
  ['s1-c1', '정상'], ['s1-c2', '정상'], ['s1-c3', '정상'], ['s1-c4', '정상'],
  ['s1-c5', '내륜'], ['s1-c7', '구름체'],
  ['s2-c1', '외륜'], ['s2-c2', '정상'], ['s2-c3', '정상'], ['s2-c4', '정상'],
  ['s3-c1', '정상'], ['s3-c2', '정상'], ['s3-c3', '외륜'], ['s3-c4', '정상'],
];
const TAGS = ONLY.length ? ALL_TAGS.filter((t) => ONLY.includes(t[0])) : ALL_TAGS;
/* 판정 시각은 실제 수집 시각에서 추출(NASA는 10~23분 간격이라 10분 격자면 대부분 수집 공백)
   조회 과다 방지로 3시간 간격 — 열화는 며칠 단위라 에피소드 수는 유지, 연속 판정 간격이 길어 단발성 경보는 덜 잡힘(보수적) */
const HOUR = 3600000;
const CFG = { escHold: 60000, recHold: 300000, reno: {} };
const bf = VC.bearingFreqs(RPM, GEO), fr = RPM / 60;
const band = VC.demodFixed(FS), eMax = VC.envMaxFor(bf, fr, FS);
const secs = Math.min(22, VC.MON_REV / fr);

console.log(`무알림 병행운전 — 3시간 간격 판정 · 창 ${VC.MON_REV}회전(${secs.toFixed(2)}초) · 임계 ${VC.MON_ADOPT}\n`);
console.log('태그      정답     기간(일)  판정회차  경보  첫 경보(잔여%)  이벤트');

let hDays = 0, hAlarm = 0, fN = 0, fHit = 0;
for (const [tag, truth] of TAGS) {
  const st = (await q(`select MIN_TIME, MAX_TIME from V$NASA_BEARING_STAT where NAME='${tag}'`))[0].split(',');
  const t0 = +st[0], t1 = +st[1], days = (t1 - t0) / 864e5;
  let prev = null, ticks = 0, alarms = 0, firstAt = null;
  const kinds = {};
  // 수집이 실제로 있는 분 버킷만 — 그중 3시간에 하나씩
  const snapRows = await q(`select ROLLUP('min',1,TIME) rt from NASA_BEARING where NAME='${tag}' group by rt order by rt`);
  const snaps = [];
  let lastTaken = -Infinity;
  for (const l of snapRows) {
    const ms = +l.split(',')[0];
    if (ms - lastTaken >= 3 * HOUR) { snaps.push(ms + 60000); lastTaken = ms; }
  }
  /* 필요 표본 수 기준 — NASA는 타임스탬프가 1분에 퍼져(341/초) 짧은 창엔 표본 부족 → 제품(monPattern)처럼 창을 넓혀 재조회 */
  const need = Math.max(4096, Math.round(FS * VC.MON_REV / fr));
  for (const at of snaps) {
    let v = [];
    for (const sec of [secs, 60, 180]) {
      const lo = BigInt(Math.round(at - sec * 1000)) * 1000000n, hi = BigInt(at) * 1000000n;
      const rows = await q(`select VALUE from NASA_BEARING where NAME='${tag}' and TIME between ${lo} and ${hi} limit 262144`);
      v = rows.map(Number).filter(isFinite);
      if (v.length >= need) break;
    }
    if (v.length < 4096) continue;         // 수집 공백 — 감시도 되짚기 실패 시 이 틱 건너뜀
    if (v.length > need) v = v.slice(v.length - need);
    ticks++;
    const env = VC.envelopeSpectrum(v, FS, eMax, band);
    const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
    const r = t ? t.r || 0 : 0;
    let m = 0; for (const x of v) m += x; m /= v.length;
    let ss = 0; for (const x of v) { const d = x - m; ss += d * d; }
    const iso = VC.bandRmsAveraged(VC.convertDomain(v, FS, 'g', 'mm/s', fr), FS, 10, 1000, 8).rms;
    const rg = VC.patternGate(r >= VC.MON_ADOPT, VC.gradeFor(iso, ZONES));
    const res = judgeTick(prev, rg, false, at, CFG, null, true);
    prev = res.next;
    for (const e of res.events) {
      kinds[e.etype] = (kinds[e.etype] || 0) + 1;
      if (e.etype === 'threshold') { alarms++; if (firstAt == null) firstAt = at; }
    }
  }
  const rem = firstAt != null ? Math.round((t1 - firstAt) / (t1 - t0) * 100) : null;
  if (truth === '정상') { hDays += days; hAlarm += alarms; }
  else { fN++; if (firstAt != null) fHit++; }
  console.log(tag.padEnd(10) + truth.padEnd(8) + days.toFixed(1).padStart(7) + String(ticks).padStart(10)
    + String(alarms).padStart(6) + (rem != null ? (rem + '%').padStart(14) : '없음'.padStart(14)) + '   '
    + Object.keys(kinds).map((k) => k + '×' + kinds[k]).join(' '));
}
console.log('');
console.log('─────────────────────────────────────────────────────');
console.log(`건전 베어링 ${hDays.toFixed(0)}일 · 오경보 ${hAlarm}건 = 자산·월당 ${(hAlarm / (hDays / 30)).toFixed(2)}건`);
console.log(`결함 베어링 ${fHit}/${fN} 검출`);
