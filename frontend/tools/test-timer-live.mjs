// 타이머가 패키지 경로의 .tql 파일을 실제로 실행하는지 종단 검증.
// 무해한 프로브(MONSTATE 마커만 갱신, 이벤트 무기록) → 생성 → 발화 대기 → 확인 → 정리.
const NEO = 'http://127.0.0.1:5654';
const PKG = '/public/neo-pkg-replication';
const PROBE_PATH = PKG + '/cgi-bin/_timerprobe.tql';
const TIMER = 'NEO_VIBE_TIMERPROBE';
const KEY = '__timer_probe__';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tok = await fetch(NEO + '/web/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'SYS', password: 'manager' }) }).then((r) => r.json()).then((j) => j.accessToken);
const H = { Authorization: 'Bearer ' + tok };
const jget = (u, o) => fetch(NEO + u, o).then((r) => r.text());

// 프로브 tql — 현재 ms를 MONSTATE 마커에 upsert (이벤트 무관, LOOKUP PK 삭제 가능해 정리 쉬움)
const probeTql = 'SCRIPT({\n'
  + '  var db=$.db(), t=Date.now();\n'
  + "  db.exec(\"delete from MONSTATE where K='" + KEY + "'\");\n"
  + "  db.exec(\"insert into MONSTATE values('" + KEY + "','\"+t+\"')\");\n"
  + '  $.yield(t);\n'
  + '})\nCSV()';

let pass = 0, fail = 0;
const check = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n); } };
async function readMarker() {
  const sql = "select VAL from MONSTATE where K='" + KEY + "'";
  const t = await jget('/db/query?q=' + encodeURIComponent(sql) + '&format=json&timeformat=ms');
  try { const j = JSON.parse(t); return (j.data && j.data.rows && j.data.rows[0]) ? Number(j.data.rows[0][0]) : 0; } catch (e) { return 0; }
}

try {
  // 1) 프로브 파일 저장
  const w = await fetch(NEO + '/web/api/files' + PROBE_PATH, { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain' }, H), body: probeTql }).then((r) => r.text());
  check('프로브 tql 파일 저장', /success|true/i.test(w) || w === '');
  // 2) 기존 프로브 타이머 삭제 후 생성 (@every 2s, autoStart)
  await fetch(NEO + '/web/api/timers/' + TIMER, { method: 'DELETE', headers: H }).then((r) => r.text()).catch(() => {});
  const c = await fetch(NEO + '/web/api/timers', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ name: TIMER, autoStart: true, schedule: '@every 2s', path: PROBE_PATH }) }).then((r) => r.json());
  check('타이머 생성 성공', c.success !== false);
  // 3) 발화 대기 (약 6초) — 그 사이 마커가 최신 ms로 갱신돼야 함
  const t0 = Date.now();
  await sleep(6500);
  const marker = await readMarker();
  console.log('  마커 ms:', marker, '| 테스트 시작 ms:', t0, '| 차이(s):', ((marker - t0) / 1000).toFixed(1));
  check('타이머가 파일을 실행해 마커 갱신됨(최근 8초 내)', marker > 0 && Math.abs(Date.now() - marker) < 8000);
} finally {
  // 4) 정리 — 타이머·프로브파일·마커행 제거
  await fetch(NEO + '/web/api/timers/' + TIMER, { method: 'DELETE', headers: H }).then((r) => r.text()).catch(() => {});
  await fetch(NEO + '/web/api/files' + PROBE_PATH, { method: 'DELETE', headers: H }).then((r) => r.text()).catch(() => {});
  await jget('/db/query?q=' + encodeURIComponent("delete from MONSTATE where K='" + KEY + "'"));
  const gone = await jget('/web/api/timers', { headers: H });
  check('정리 후 프로브 타이머 없음', !gone.includes(TIMER));
}
console.log(`\ntimer live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
