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
  /* 밀리초까지 넣는다 — 초 단위로 자르면 1초 미만 구간 요청이 통째로 어긋난다.
     예: 표시 FFT는 0.64초(16,384샘플)를 요청하는데 초 단위로 자르면 1초(25,600샘플)가 와서
     "16,384 샘플 관례"가 실제로는 지켜지지 않았다. 25.6 kHz에서 1초 오차 = 25,600 샘플이다.
     Machbase to_date는 'YYYY-MM-DD HH:MI:SS mmm' 형식으로 밀리초를 받는다(실측 확인). */
  function sqlDate(ms) {
    var d = new Date(ms);
    function z(n) { return n < 10 ? '0' + n : '' + n; }
    function z3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }
    return "to_date('" + d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())
      + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds())
      + ' ' + z3(d.getMilliseconds()) + "')";
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

  /* SUM은 평균(DC)을 빼기 위해 받는다 — RMS를 √(Σx²/N)로만 내면 오프셋이 그대로 판정값을
     부풀린다. ISO는 AC 성분 기준이다. 컬럼 순서는 toBucket이 인덱스로 읽으므로 뒤에만 붙인다. */
  var ROLLUP_COLS = 'SUMSQ(VALUE) SS, COUNT(VALUE) CNT, MIN(VALUE) MN, MAX(VALUE) MX, SUM(VALUE) SM';

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
      'CREATE TABLE NEO_VIBE_EVENTS (EID VARCHAR(120), TS LONG, TBL VARCHAR(80), TAG VARCHAR(100), ETYPE VARCHAR(16), GRADE VARCHAR(8), VAL DOUBLE, LIM DOUBLE, DETAIL VARCHAR(400))',
      'CREATE LOOKUP TABLE NEO_VIBE_MONSTATE (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(1000))',
      'CREATE LOOKUP TABLE NEO_VIBE_BASELINE (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(1000))',
      /* 대역 에너지 추세 — TAG 테이블로 만든다. 전용 스키마를 새로 짜지 않는 이유:
         롤업·추세조회·차트·베이스라인 학습 코드가 전부 "TAG 시계열"을 전제로 이미 돌아간다.
         NAME = "<테이블>:<태그>:<대역>" (예: BEARING:C1:fault)
         대역: sub / one / fault / high / vhigh, 그리고 fr(실측 회전주파수)을 같은 방식으로 저장.
         ⚠fr을 반드시 함께 남긴다 — 대역 경계가 1× 상대라 fr을 모르면 저장된 값이
           어느 주파수 구간이었는지 나중에 복원할 수 없다(인버터 설비에서 특히). */
      'CREATE TAG TABLE NEO_VIBE_BAND (NAME VARCHAR(200) PRIMARY KEY, TIME DATETIME BASETIME, VALUE DOUBLE SUMMARIZED)',
    ];
  }
  // 대역 추세 조회 — 기존 rollupTrend와 같은 모양(초/분/시 롤업)으로 쓴다
  function bandTrend(key, unit, fromMs, toMs) {
    return 'select ROLLUP(\'' + (unit || 'min') + '\', 1, TIME) rt, AVG(VALUE) av from NEO_VIBE_BAND'
      + " where NAME='" + esc(key) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by rt order by rt';
  }
  /* 채움 현황 — 여러 시리즈의 시각만 한 번에 가져온다(값은 필요 없다).
     TAG 테이블은 같은 NAME+TIME 중복 삽입을 막지 않으므로, 다시 채우기 전에
     이미 있는 시각을 알아야 중복이 쌓이지 않는다. */
  function bandTimes(keys, fromMs, toMs) {
    var ks = (keys || []).map(function (k) { return "'" + esc(k) + "'"; }).join(',');
    return 'select NAME, TIME from NEO_VIBE_BAND where NAME in (' + ks + ') and TIME between '
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME';
  }
  // 대역 원본 조회(베이스라인 학습용 — 롤업 없이 저장된 그대로)
  function bandRaw(key, fromMs, toMs) {
    return 'select TIME, VALUE from NEO_VIBE_BAND'
      + " where NAME='" + esc(key) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' order by TIME';
  }
  // 기존 설치 마이그레이션 — 이미 있으면 에러가 나지만 호출측이 삼킨다(멱등 취급)
  function eventsAddDetail() { return 'ALTER TABLE NEO_VIBE_EVENTS ADD COLUMN (DETAIL VARCHAR(400))'; }
  function eventsSelect(limit) {
    return 'select EID, TS, TBL, TAG, ETYPE, GRADE, VAL, LIM, DETAIL from NEO_VIBE_EVENTS order by TS desc limit ' + (Number(limit) || 300);
  }
  // 기간 지정 조회(CSV/JSON 내보내기용) — TS(ms) 범위, 최신순
  function eventsRange(fromMs, toMs, limit) {
    return 'select EID, TS, TBL, TAG, ETYPE, GRADE, VAL, LIM, DETAIL from NEO_VIBE_EVENTS where TS between ' +
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
      esc(e.grade) + "', " + Number(e.val) + ', ' + Number(e.lim) + ", '" + esc(e.detail || '') + "')";
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
    monCreateTables: monCreateTables, bandTrend: bandTrend, bandRaw: bandRaw, bandTimes: bandTimes, eventsSelect: eventsSelect, eventsRange: eventsRange,
    eventsCount: eventsCount, eventInsert: eventInsert, eventsAddDetail: eventsAddDetail,
    kvSelect: kvSelect, kvExists: kvExists, kvInsert: kvInsert, kvUpdate: kvUpdate, kvDelete: kvDelete
  };
});
