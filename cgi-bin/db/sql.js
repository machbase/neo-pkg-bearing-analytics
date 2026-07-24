// sql.js — 이 패키지가 사용하는 SQL/TQL 문자열의 단일 소스 (순수 문자열 빌더 · fetch 없음)
// 실행은 db/index.js가 담당. 쿼리를 바꿀 땐 여기만 수정한다.
//
// ── SQL 인벤토리 ──────────────────────────────────────────────
// 1. catalogTables : TAG 테이블 목록 — llm-chat sql.js와 동일(M$SYS_TABLES ⋈ M$SYS_USERS,
//                    owner + FLAG=0) + TYPE=6(TAG 한정, LOOKUP/LOG 제외)
// 2. catalogCount  : 위와 같은 조건의 개수 (DB 연결 테스트 표시용)
// 3. tagList       : 태그 목록 — _<table>_meta
// 4. tagStats      : 태그별 통계 — V$<TABLE>_STAT (ROW_COUNT/MIN_TIME/MAX_TIME)
// 5. rollupTrend   : 태그 1개 롤업 — ROLLUP('sec|min|hour',1,TIME) + SUMSQ/COUNT/MIN/MAX
//                    (RMS=√(SS/CNT), P2P=MX-MN, Crest=max|·|/RMS 는 calc가 계산)
// 6. rollupBatch   : 테이블 단위 다태그 롤업 — GROUP BY NAME, RT (모니터링 5초 갱신용)
// 7. rawWindow     : 원시 파형 구간 — TIME BETWEEN to_date(초 단위)
// 8. fftTql        : 서버 FFT — TQL: SQL(raw)→MAPKEY('fft')→GROUPBYKEY()→FFT(minHz,maxHz)→CSV
// 9. 상시감시(P6) : NEO_VIBE_EVENTS(LOG — 이벤트 이력, append 전용·무한증가) +
//                    MONSTATE/BASELINE(LOOKUP — 직전 판정/μ·σ, UPSERT 필요).
//                    판정은 앱이 열려 있는 동안 앱(app._judgeLive)이 수행 — 타이머/서버 상주 없음.
//                    KV류(MONSTATE/BASELINE) VAL은 encodeURIComponent(JSON)+('→%27) 관례.
// ────────────────────────────────────────────────────────────
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeSQL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 문자열 리터럴 이스케이프(' → '') — 태그명/사용자명 방어
  function esc(s) { return String(s).replace(/'/g, "''"); }
  // 식별자(테이블명)는 따옴표 없이 쓰므로 영숫자·_ 만 통과
  function ident(s) { return String(s).replace(/[^A-Za-z0-9_$]/g, ''); }

  // 서버 로컬 TZ 기준 to_date 문자열 (브라우저와 서버가 같은 호스트 전제, 초 단위)
  function sqlDate(ms) {
    var d = new Date(ms);
    function z(n) { return n < 10 ? '0' + n : '' + n; }
    return "to_date('" + d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())
      + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()) + "')";
  }

  function catalogWhere(owner) {
    return " WHERE su.NAME = '" + esc(String(owner || 'SYS').toUpperCase()) + "' AND st.FLAG = 0 AND st.TYPE = 6";
  }

  function catalogTables(owner) {
    return 'SELECT st.NAME FROM M$SYS_TABLES st JOIN M$SYS_USERS su ON st.USER_ID = su.USER_ID'
      + catalogWhere(owner) + ' ORDER BY st.NAME';
  }

  function catalogCount(owner) {
    return 'SELECT count(*) FROM M$SYS_TABLES st JOIN M$SYS_USERS su ON st.USER_ID = su.USER_ID'
      + catalogWhere(owner);
  }

  function tagList(table) {
    return 'SELECT NAME FROM _' + ident(table).toLowerCase() + '_meta ORDER BY NAME';
  }

  function tagStats(table) {
    return 'select NAME, ROW_COUNT, MIN_TIME, MAX_TIME from V$' + ident(table) + '_STAT';
  }

  var ROLLUP_COLS = 'SUMSQ(VALUE) SS, COUNT(VALUE) CNT, MIN(VALUE) MN, MAX(VALUE) MX';

  // 버킷 표현식: 기본 ROLLUP(고속·사전집계), rollup 미지원 테이블은 DATE_TRUNC 원본 집계 폴백
  function bucketExpr(unit, useTrunc) {
    return useTrunc ? "DATE_TRUNC('" + unit + "', TIME)" : "ROLLUP('" + unit + "', 1, TIME)";
  }

  function rollupTrend(table, tag, unit, fromMs, toMs, useTrunc) {
    return 'select ' + bucketExpr(unit, useTrunc) + ' RT, ' + ROLLUP_COLS + ' from ' + ident(table)
      + " where NAME='" + esc(tag) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by RT order by RT';
  }

  function rollupBatch(table, tags, unit, fromMs, toMs, useTrunc) {
    var names = tags.map(function (t) { return "'" + esc(t) + "'"; }).join(',');
    return 'select NAME, ' + bucketExpr(unit, useTrunc) + ' RT, ' + ROLLUP_COLS + ' from ' + ident(table)
      + ' where NAME in (' + names + ') and TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by NAME, RT order by NAME, RT';
  }

  function rawWindow(table, tag, fromMs, toMs) {
    return 'select TIME, VALUE from ' + ident(table) + " where NAME='" + esc(tag) + "' and TIME between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME';
  }

  function fftTql(table, tag, fromMs, toMs, minHz, maxHz) {
    return 'SQL(`select time, value from ' + ident(table) + " where name = '" + esc(tag) + "' and time between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by time`)\n'
      + "MAPKEY('fft')\nGROUPBYKEY()\nFFT(minHz(" + Number(minHz) + '), maxHz(' + Number(maxHz) + '))\nCSV(precision(6))';
  }

  /* ---- 상시감시(P6) ---- */
  function monCreateTables() {
    return [
      // EVENTS는 LOG 테이블(디스크·append 전용·무한증가 친화) — 이벤트는 확인/삭제가 없는 순수 이력이라 LOOKUP(메모리) 부적합
      'CREATE TABLE NEO_VIBE_EVENTS (EID VARCHAR(120), TS LONG, TBL VARCHAR(80), TAG VARCHAR(100), ETYPE VARCHAR(16), GRADE VARCHAR(8), VAL DOUBLE, LIM DOUBLE)',
      'CREATE LOOKUP TABLE NEO_VIBE_MONSTATE (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(1000))',
      'CREATE LOOKUP TABLE NEO_VIBE_BASELINE (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(1000))',
    ];
  }
  function eventsSelect(limit) {
    return 'select EID, TS, TBL, TAG, ETYPE, GRADE, VAL, LIM from NEO_VIBE_EVENTS order by TS desc limit ' + (Number(limit) || 300);
  }
  // 기간 지정 조회(CSV/JSON 내보내기용) — TS(ms) 범위, 최신순
  function eventsRange(fromMs, toMs, limit) {
    return 'select EID, TS, TBL, TAG, ETYPE, GRADE, VAL, LIM from NEO_VIBE_EVENTS where TS between ' +
      Number(fromMs) + ' and ' + Number(toMs) + ' order by TS desc limit ' + (Number(limit) || 100000);
  }
  // 기간·필터 내 총 건수 — 목록은 최근 N건만 렌더하므로 개수는 별도 COUNT로 정확히 센다
  function eventsCount(fromMs, toMs, etype, tbl, tag) {
    var w = 'TS between ' + Number(fromMs) + ' and ' + Number(toMs);
    if (etype) w += " and ETYPE='" + esc(etype) + "'";
    if (tbl && tag) w += " and TBL='" + esc(tbl) + "' and TAG='" + esc(tag) + "'";
    return 'select count(*) from NEO_VIBE_EVENTS where ' + w;
  }
  function eventInsert(e) {
    // GRADE는 단어(양호/주의/위험/심각) 저장 — raw 테이블 가독성. 앱은 로드 시 인덱스로 역매핑.
    return 'insert into NEO_VIBE_EVENTS values(' +
      "'" + esc(e.eid) + "', " + Number(e.ts) + ", '" + esc(e.tbl) + "', '" + esc(e.tag) + "', '" + esc(e.etype) + "', '" +
      esc(e.grade) + "', " + Number(e.val) + ', ' + Number(e.lim) + ')';
  }
  function kvSelect(table) { return 'select K, VAL from ' + ident(table); }
  function kvExists(table, key) { return 'select count(*) from ' + ident(table) + " where K='" + esc(key) + "'"; }
  function kvInsert(table, key, val) { return 'insert into ' + ident(table) + " values('" + esc(key) + "', '" + val + "')"; }
  function kvUpdate(table, key, val) { return 'update ' + ident(table) + " set VAL='" + val + "' where K='" + esc(key) + "'"; }
  function kvDelete(table, key) { return 'delete from ' + ident(table) + " where K='" + esc(key) + "'"; }

  return {
    esc: esc, ident: ident, sqlDate: sqlDate,
    catalogTables: catalogTables, catalogCount: catalogCount,
    tagList: tagList, tagStats: tagStats,
    rollupTrend: rollupTrend, rollupBatch: rollupBatch, rawWindow: rawWindow, fftTql: fftTql,
    monCreateTables: monCreateTables, eventsSelect: eventsSelect, eventsRange: eventsRange,
    eventsCount: eventsCount, eventInsert: eventInsert,
    kvSelect: kvSelect, kvExists: kvExists, kvInsert: kvInsert, kvUpdate: kvUpdate, kvDelete: kvDelete
  };
});
