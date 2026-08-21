// 무알림 병행운전 — 새 감시 규칙을 전 수명 시계열에 그대로 돌려 이벤트를 센다.
//
// 실기 설비가 없으므로 NASA IMS(끝까지 건전한 베어링이 같은 시험대에 함께 돎)로 대신한다.
// 알림을 켜지 않고 이벤트만 세는 것이 "섀도 모드"이고, 여기서는 그 계산을 오프라인으로 재현한다.
// 나오는 숫자: 자산·월당 오경보 · 결함 첫 경보 리드타임.
globalThis.window = globalThis;
const _f = globalThis.fetch;
globalThis.fetch = (u, o) => _f(typeof u === 'string' && u.startsWith('/') ? 'http://127.0.0.1:5654' + u : u, o);
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { judgeTick } = await import('../src/app.js');
const q = async (s) => (await (await fetch('/db/query?q=' + encodeURIComponent(s) + '&format=csv&timeformat=ms')).text()).trim().split('\n').slice(1);

const GEO = { n: 16, Bd: 8.4, Pd: 71.5, phi: 15.17 }, FS = 20480, RPM = 2000, ZONES = [0.71, 1.8, 4.5];
/* 인자로 태그를 골라 나눠 돌릴 수 있게 — 전 수명 14태그를 한 번에 돌면 조회가 수천 건이라
   한 번에 안 끝난다. 나눠 돌리고 합계는 사람이 더한다. */
const ONLY = process.argv.slice(2).filter(function (a) { return /^s[0-9]+-c[0-9]+$/.test(a); });
const ALL_TAGS = [
  ['s1-c1', '정상'], ['s1-c2', '정상'], ['s1-c3', '정상'], ['s1-c4', '정상'],
  ['s1-c5', '내륜'], ['s1-c7', '구름체'],
  ['s2-c1', '외륜'], ['s2-c2', '정상'], ['s2-c3', '정상'], ['s2-c4', '정상'],
  ['s3-c1', '정상'], ['s3-c2', '정상'], ['s3-c3', '외륜'], ['s3-c4', '정상'],
];
const TAGS = ONLY.length ? ALL_TAGS.filter((t) => ONLY.includes(t[0])) : ALL_TAGS;
/* 판정 시각은 **실제 수집 시각**에서 뽑는다 — NASA는 10~23분 간격이라 10분 격자로 훑으면
   대부분이 수집 공백에 떨어져 조회만 낭비된다(감시의 되짚기가 하는 일을 여기서는 미리 한다).
   그리고 시간 단위로 성글게 잡는다: 14태그 전 수명을 10분마다 돌면 조회가 7만 건이다.
   베어링 열화는 며칠 단위라 시간 단위로도 에피소드 수는 같게 세어진다 —
   다만 escHold(2회 연속)가 20분이 아니라 2시간이 되므로 단발성 경보는 덜 잡힌다(보수적). */
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
  // 수집이 실제로 있는 분 버킷만 — 그중 1시간에 하나씩
  const snapRows = await q(`select ROLLUP('min',1,TIME) rt from NASA_BEARING where NAME='${tag}' group by rt order by rt`);
  const snaps = [];
  let lastTaken = -Infinity;
  for (const l of snapRows) {
    const ms = +l.split(',')[0];
    if (ms - lastTaken >= 3 * HOUR) { snaps.push(ms + 60000); lastTaken = ms; }
  }
  /* 필요한 표본 수로 잡는다 — NASA는 적재 시 타임스탬프가 1분에 퍼져 있어(20,480/60초 = 341/초)
     0.75초 창엔 256개뿐이다. 제품 코드(monPattern)도 같은 이유로 창을 넓혀 다시 읽는다. */
  const need = Math.max(4096, Math.round(FS * VC.MON_REV / fr));
  for (const at of snaps) {
    let v = [];
    for (const sec of [secs, 60, 180]) {
      const lo = BigInt(Math.round(at - sec * 1000)) * 1000000n, hi = BigInt(at) * 1000000n;
      const rows = await q(`select VALUE from NASA_BEARING where NAME='${tag}' and TIME between ${lo} and ${hi} limit 262144`);
      v = rows.map(Number).filter(isFinite);
      if (v.length >= need) break;
    }
    if (v.length < 4096) continue;         // 수집 공백 — 감시도 되짚기 실패 시 이 틱을 건너뛴다
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
