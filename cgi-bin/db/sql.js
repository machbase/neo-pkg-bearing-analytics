// sql.js — 이 패키지가 사용하는 SQL/TQL 문자열의 단일 소스 (순수 문자열 빌더 · fetch 없음)
// 실행은 db/db.js가 담당. 쿼리를 바꿀 땐 여기만 수정한다.
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
// 9. 상시감시(P6) : NEO_VIBE_EVENTS(TAG — 이벤트 이력, NAME='<테이블>:<태그>'라 설비 단위 삭제 가능) +
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

  /* 서버 로컬 TZ 기준 to_date 문자열 (브라우저와 서버가 같은 호스트 전제).
     밀리초까지 넣는다 — 초 단위로 자르면 1초 미만 구간 요청이 어긋난다.
     Machbase to_date는 'YYYY-MM-DD HH:MI:SS mmm' 형식으로 밀리초를 받는다. */
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

  /* 샘플레이트 추정용 — 값은 필요 없고 연속한 표본의 시각만 있으면 된다.
     LIMIT으로 건수를 묶어 25.6 kHz 태그라도 비용이 고정된다(간격은 표본 수보다 하나 적다). */
  function sampleTimes(table, tag, fromMs, toMs, limit) {
    return 'select TIME from ' + ident(table) + " where NAME='" + esc(tag) + "' and TIME between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME limit ' + (Number(limit) || 2000);
  }

  function fftTql(table, tag, fromMs, toMs, minHz, maxHz) {
    return 'SQL(`select time, value from ' + ident(table) + " where name = '" + esc(tag) + "' and time between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by time`)\n'
      + "MAPKEY('fft')\nGROUPBYKEY()\nFFT(minHz(" + Number(minHz) + '), maxHz(' + Number(maxHz) + '))\nCSV(precision(6))';
  }

  /* ---- 상시감시(P6) ---- */
  function monCreateTables() {
    return [
      /* EVENTS는 TAG 테이블 — NAME='<테이블>:<태그>', TIME=이벤트 시각(태그·기간 단위 삭제 가능).
         SUMMARIZED를 붙이지 않아 롤업·통계는 만들지 않는다 — 이벤트는 집계 대상이 아니다. */
      'CREATE TAG TABLE NEO_VIBE_EVENTS (NAME VARCHAR(200) PRIMARY KEY, TIME DATETIME BASETIME, VALUE DOUBLE, ETYPE VARCHAR(16), GRADE VARCHAR(8), LIM DOUBLE, DETAIL VARCHAR(400), EID VARCHAR(120))',
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
  /* 여러 계열의 최신값을 한 번에 — 판정은 태그마다 계열 전부의 "지금 값"이 필요하다.
     계열마다 따로 물으면 문장 수가 태그수 × 계열수가 되어, 계열이 늘 때마다 그만큼 늘어난다.
     시각 오름차순으로 받아 부르는 쪽이 NAME별 마지막 행을 취한다(창이 좁아 행 수가 적다). */
  function bandLatest(keys, fromMs, toMs) {
    var ks = (keys || []).map(function (k) { return "'" + esc(k) + "'"; }).join(',');
    return 'select NAME, VALUE from NEO_VIBE_BAND where NAME in (' + ks + ') and TIME between '
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME';
  }
  // 대역 원본 조회(베이스라인 학습용 — 롤업 없이 저장된 그대로)
  function bandRaw(key, fromMs, toMs) {
    return 'select TIME, VALUE from NEO_VIBE_BAND'
      + " where NAME='" + esc(key) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' order by TIME';
  }
  // 기존 설치 마이그레이션 — 이미 있으면 에러가 나지만 호출측이 삼킨다(멱등 취급)
  /* 컬럼 순서는 TAG 테이블 규약(NAME·TIME·VALUE 먼저) — 읽는 쪽이 인덱스로 집으므로 여기서만 정한다.
     앱이 보는 객체 모양({eid, ts, tbl, tag, …})은 db.js가 맞춰 주므로 화면 코드는 이 순서를 모른다. */
  var EV_COLS = 'NAME, TIME, VALUE, ETYPE, GRADE, LIM, DETAIL, EID';
  function eventsSelect(limit) {
    return 'select ' + EV_COLS + ' from NEO_VIBE_EVENTS order by TIME desc limit ' + (Number(limit) || 300);
  }
  // 기간 지정 조회(CSV/JSON 내보내기용) — 최신순
  function eventsRange(fromMs, toMs, limit) {
    return 'select ' + EV_COLS + ' from NEO_VIBE_EVENTS where TIME between ' +
      sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME desc limit ' + (Number(limit) || 100000);
  }
  // 기간·필터 내 총 건수 — 목록은 최근 N건만 렌더하므로 개수는 별도 COUNT로 정확히 센다
  function eventsCount(fromMs, toMs, etype, tbl, tag) {
    var w = 'TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
    if (tbl && tag) w += " and NAME='" + esc(tbl + ':' + tag) + "'";
    if (etype) w += " and ETYPE='" + esc(etype) + "'";
    return 'select count(*) from NEO_VIBE_EVENTS where ' + w;
  }
  function eventInsert(e) {
    // GRADE는 단어(양호/주의/위험/심각) 저장 — raw 테이블 가독성. 앱은 로드 시 인덱스로 역매핑.
    return 'insert into NEO_VIBE_EVENTS values(' +
      "'" + esc(e.tbl + ':' + e.tag) + "', " + sqlDate(e.ts) + ', ' + Number(e.val) + ", '" + esc(e.etype) + "', '" +
      esc(e.grade) + "', " + Number(e.lim) + ", '" + esc(e.detail || '') + "', '" + esc(e.eid) + "')";
  }
  // 삭제 — TAG 테이블이라 태그별·기간별로 지울 수 있다.
  function eventsDeleteTag(tbl, tag) {
    return "delete from NEO_VIBE_EVENTS where NAME='" + esc(tbl + ':' + tag) + "'";
  }
  function eventsDeleteRange(fromMs, toMs) {
    return 'delete from NEO_VIBE_EVENTS where TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
  }
  /* 대역 데이터 삭제 — 이벤트와 같은 규칙(TAG 표).
     한 태그는 6키(대역 5 + fr)라 태그 단위 삭제는 부르는 쪽이 키마다 한 번씩 돈다. */
  function bandDeleteRange(fromMs, toMs) {
    return 'delete from NEO_VIBE_BAND where TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
  }
  function bandDeleteKey(key) { return "delete from NEO_VIBE_BAND where NAME='" + esc(key) + "'"; }
  /* 데이터가 하나도 안 남은 태그의 이름을 메타에서 지운다 — 행을 다 지워도 이름은 메타에 남는다.
     이름을 지워도 무해하다: INSERT가 없는 이름을 자동 재등록하므로 살아 있는 태그는 저절로 돌아온다. */
  function metaPurgeOrphans(table) {
    var t = ident(table);
    return 'delete from ' + t + ' metadata where NAME not in (select NAME from ' + t + ' group by NAME)';
  }
  // 옛 LOG 테이블에서 옮겨 담기 위한 전체 조회 — 마이그레이션 전용
  function eventsLegacySelect() {
    return 'select EID, TS, TBL, TAG, ETYPE, GRADE, VAL, LIM, DETAIL from NEO_VIBE_EVENTS order by TS';
  }
  function tableTypeOf(name) {
    return "select TYPE from M$SYS_TABLES where NAME = '" + esc(String(name).toUpperCase()) + "'";
  }
  function dropTable(name) { return 'DROP TABLE ' + ident(name); }
  /* ---- 데이터 관리(설정) ----
     패키지가 만든 테이블의 현황을 읽는다. 삭제는 유형마다 되는 범위가 다르다:
      · EVENTS/BAND(TAG)          — 태그별·기간별 자유롭게
      · MONSTATE/BASELINE(LOOKUP) — 키 단위
     화면 버튼은 이 제약을 그대로 따른다(안 되는 걸 내놓으면 눌렀을 때 에러가 난다). */
  function usageCount(table) { return 'select count(*) from ' + ident(table); }
  // 이벤트 보관 범위 — 표시용. TIME은 timeformat=ms라 숫자로 온다(대역 표와 같은 규약)
  function eventsSpan() { return 'select min(TIME), max(TIME) from NEO_VIBE_EVENTS'; }
  // 대역 데이터 보관 범위 — TAG 테이블이라 시각 컬럼(TIME) 기준
  function bandSpan() { return 'select min(TIME), max(TIME) from NEO_VIBE_BAND'; }
  function bandKeyCount() { return 'select count(*) from (select NAME from NEO_VIBE_BAND group by NAME)'; }
  /* 태그별 보유량 — "어느 태그가 얼마나 차지하나". 총계(usageCount)로는 정리할 대상을 못 고른다.
     NEO_VIBE_BAND의 NAME은 '테이블:태그:계열'이라 태그 하나가 계열 십여 개를 갖는다 —
     묶는 것은 부르는 쪽 몫이다(여기서 쪼개면 SQL이 문자열 함수에 의존하게 된다). */
  function bandNameCounts() { return 'select NAME, count(*) from NEO_VIBE_BAND group by NAME'; }
  function eventNameCounts() { return 'select NAME, count(*) from NEO_VIBE_EVENTS group by NAME'; }
  /* 구간 건수 — 삭제 전에 "몇 건이 지워지는지" 세어 보여주기 위한 조회.
     시간 범위 지정 삭제는 8.0.50+ 확장 구문(문서의 "시간 범위 삭제 미지원"은 레거시 BEFORE 구문 기준). */
  function eventsCountRange(fromMs, toMs) {
    return 'select count(*) from NEO_VIBE_EVENTS where TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
  }
  function bandCountRange(fromMs, toMs) {
    return 'select count(*) from NEO_VIBE_BAND where TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
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
    rollupTrend: rollupTrend, rollupBatch: rollupBatch, rawWindow: rawWindow, sampleTimes: sampleTimes, fftTql: fftTql,
    monCreateTables: monCreateTables, bandTrend: bandTrend, bandRaw: bandRaw, bandTimes: bandTimes, bandLatest: bandLatest, eventsSelect: eventsSelect, eventsRange: eventsRange,
    eventsCount: eventsCount, eventInsert: eventInsert,
    eventsDeleteTag: eventsDeleteTag, eventsDeleteRange: eventsDeleteRange,
    bandDeleteRange: bandDeleteRange, bandDeleteKey: bandDeleteKey,
    metaPurgeOrphans: metaPurgeOrphans,
    eventsLegacySelect: eventsLegacySelect, tableTypeOf: tableTypeOf, dropTable: dropTable,
    kvSelect: kvSelect, kvExists: kvExists, kvInsert: kvInsert, kvUpdate: kvUpdate, kvDelete: kvDelete,
    usageCount: usageCount, eventsSpan: eventsSpan, bandSpan: bandSpan, bandKeyCount: bandKeyCount, bandNameCounts: bandNameCounts, eventNameCounts: eventNameCounts,
    eventsCountRange: eventsCountRange, bandCountRange: bandCountRange
  };
});
