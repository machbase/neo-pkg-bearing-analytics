// 서버 판정 TQL 생성기 — 라이브(Neo 필요, NEO_TOKEN 없거나 VIBE_TEST 시드 없거나 정지면 건너뜀) · npm run smoke:live 포함
// · dryRun(실테이블 무변경)으로 SCRIPT 컨텍스트에서 judgeTick 임베드+DB조회+판정 순회 확인
globalThis.window = globalThis;
const NEO = process.env.NEO_URL || 'http://127.0.0.1:5654';
// 앱과 같은 신원 — 토큰 계정으로 조회·실행(헤더 없는 요청은 서버 설정에 따라 401 또는 기본 신원)
const TOKEN = (process.env.NEO_TOKEN || '').trim();
if (!TOKEN) { console.log('건너뜀 — 라이브 Neo API 토큰 필요: NEO_TOKEN 환경변수'); process.exit(0); }
const AUTH = { Authorization: 'Bearer ' + TOKEN };
const who = await fetch(NEO + '/db/token/validate', { method: 'POST', headers: AUTH })
  .then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.valid ? String(j.user).toUpperCase() : '')).catch(() => '');
if (!who) { console.log('건너뜀 — 토큰 무효이거나 Neo 미기동(' + NEO + ')'); process.exit(0); }
const { judgeTick } = await import('../src/app.js');
const { buildMonitorTql } = (await import('../../cgi-bin/monitor/monitor.js')).default;

const Z = [1.12, 2.8, 7.1]; // Class II 기본 존
const spec = {
  judgeSrc: judgeTick.toString(),
  cfg: { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 3600000, 3: 1800000 } },
  tags: [
    { tbl: 'VIBE_TEST', tag: 'SENSOR_NORMAL', zones: Z, bl: null },
    { tbl: 'VIBE_TEST', tag: 'SENSOR_SPIKE', zones: Z, bl: null },
    { tbl: 'VIBE_TEST', tag: 'SENSOR_TREND', zones: Z, bl: { mu: 0.5, sigma: 0.1, k: 3 } },
  ],
  dryRun: true,
};
// 앱과 같은 저장소 표 위치·행 키 접두·데이터 표 수식 이름 — 없으면 기본 DB·자기 스키마에서 찾아 ERR-2025
const SQL = (await import('../../cgi-bin/db/sql.js')).default;
SQL.setScope('NEO_BEARING_STORE', who);
spec.tblPrefix = SQL.sharedScope();
spec.keyPrefix = SQL.userPrefix();
spec.srcMap = { VIBE_TEST: 'SYS.VIBE_TEST' };
/* 시드 태그 없으면 건너뜀(사유 출력) — 데이터 부재를 코드 회귀로 오독 방지 */
const seeded = await fetch(NEO + '/db/query?format=csv&q='
  + encodeURIComponent("select count(*) from SYS.VIBE_TEST where NAME in ('" + spec.tags.map((t) => t.tag).join("','") + "')"), { headers: AUTH })
  .then((r) => r.text()).then((t) => Number((t.trim().split(String.fromCharCode(10))[1] || '0')) > 0).catch(() => false);
if (!seeded) {
  console.log('건너뜀 — VIBE_TEST에 시드 태그(' + spec.tags.map((t) => t.tag).join(', ') + ')가 없습니다.');
  console.log('monitor-tql live: 건너뜀(픽스처 없음)');
  process.exit(0);
}
/* 데이터가 오래돼도 건너뜀 — 판정 TQL은 now 기준 창만 조회해 시드 생성기 정지 시 순회 0건 */
const lastMs = await fetch(NEO + '/db/query?format=csv&timeformat=ns&q='
  + encodeURIComponent("select max(TIME) from SYS.VIBE_TEST where NAME in ('" + spec.tags.map((t) => t.tag).join("','") + "')"), { headers: AUTH })
  .then((r) => r.text()).then((t) => Number((t.trim().split(String.fromCharCode(10))[1] || '0')) / 1e6).catch(() => 0);
const staleMs = Date.now() - lastMs;
if (!(lastMs > 0) || staleMs > 5 * 60000) {
  console.log('건너뜀 — VIBE_TEST 최신 데이터가 ' + Math.round(staleMs / 60000) + '분 전입니다(시드 생성기 정지).');
  console.log('monitor-tql live: 건너뜀(데이터 정지)');
  process.exit(0);
}

const tql = buildMonitorTql(spec);
console.log('--- 생성 TQL 길이:', tql.length, '자 · judgeTick 임베드:', tql.includes('function judgeTick'));

const res = await fetch(NEO + '/db/tql', { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain' }, AUTH), body: tql });
const text = await res.text();
console.log('--- HTTP', res.status);
console.log(text.trim());

let pass = 0, fail = 0;
const check = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n); } };
check('HTTP 200', res.status === 200);
check('goja/SQL 오류 없음', !/error|ERR-|panic|undefined is not/i.test(text));
check('done 행 방출(태그 순회 완료)', /(^|\n)done,/.test(text));
const doneRow = (text.match(/(?:^|\n)done,(\d+),(\d+)/) || []);
check('순회 태그 수 = 3', doneRow[2] === '3');
check('state 행 방출(판정 상태)', /(^|\n)state,/.test(text));
// evt 행은 참고 출력 — 검사 대상 아님
console.log('\n(참고) evt 행:', (text.match(/(?:^|\n)evt,[^\n]*/g) || []).join(' | ') || '없음(직전상태와 동일이면 정상)');

console.log(`\nmonitor-tql live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
