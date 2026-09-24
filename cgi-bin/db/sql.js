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
// 8. lastSampleAt  : 앵커 이하 마지막 표본이 있는 초 — 초 롤업 역순 1건(간헐 수집 데이터 대응)
// 9. fftTql        : 서버 FFT — TQL: SQL(raw)→MAPKEY('fft')→GROUPBYKEY()→FFT(minHz,maxHz)→CSV
// 10. 상시감시(P6) : EVENTS(TAG — 이벤트 이력, NAME='<테이블>:<태그>'라 설비 단위 삭제 가능) +
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

  /* 앱 저장소 테이블은 전용 DB 의 유저 스키마에 둔다 — 소유자가 본인이라 남이 조회 자체를 못 한다.
     이름을 만드는 곳은 여기 하나다: 접두가 빠진 문장이 하나라도 남으면 그 쿼리만 조용히
     접속 계정 스키마(=없는 테이블)를 보게 되고, 그건 에러가 아니라 빈 결과로 나타난다.
     사용자 데이터 테이블은 남의 소유라 손대지 않는다 — 이름으로 가른다.
     ident 가 점을 지우므로 세 부분 이름은 여기서 직접 잇는다. */
  /* 사용자 데이터 테이블은 대개 남(보통 SYS)의 소유다. GRANT 를 받아도 **접두 없는 이름은
     접속 계정 스키마에서 찾으므로** 그대로 조회하면 "없는 테이블"이 된다(실측: GRANT 후에도
     `FROM VIBE_TEST` 는 ERR-2025, `FROM SYS.VIBE_TEST` 는 정상). 부속 객체도 같다 —
     `_<t>_meta`·`V$<T>_STAT` 모두 접두가 필요하다.

     앱은 짧은 이름을 그대로 들고 다닌다(설정의 선택 목록과 이벤트 키가 그 이름을 쓴다).
     소유자는 카탈로그에서 함께 받아 여기에 담아 두고, SQL 을 만들 때만 붙인다. */
  var _owners = {};
  function setOwners(m) {
    _owners = {};
    Object.keys(m || {}).forEach(function (k) { _owners[String(k).toUpperCase()] = m[k]; });
  }
  function ownerOf(table) { return _owners[String(table).toUpperCase().replace(/[^A-Z0-9_$]/g, '')] || null; }
  /* 데이터 테이블 이름은 `db.user.table` 세 부분으로 만든다.
     소유자만 붙이면(`user.table`) 현재 DB 에서만 찾으므로 다른 DB 의 테이블이 안 읽힌다 —
     카탈로그(M$SYS_TABLES)는 DB 를 가로질러 보여주기 때문에 목록엔 뜨는데 조회만 실패한다.
     소유자를 모르면 짧은 이름을 그대로 쓴다(자기 소유면 그게 맞다). */
  function dataTable(table) {
    var n = ident(table), o = ownerOf(n);
    if (!o) return n;
    return (o.db ? ident(o.db) + '.' : '') + ident(o.user) + '.' + n;
  }
  // 부속 객체(_meta·V$_STAT)도 같은 접두를 앞에 붙인다
  function dataSub(table, build) {
    var n = ident(table), o = ownerOf(n);
    var pfx = o ? ((o.db ? ident(o.db) + '.' : '') + ident(o.user) + '.') : '';
    return pfx + build(n);
  }

  /* 앱 저장소 테이블 목록. 전용 DB 안에만 있으므로 접두 없이 짧게 쓴다 —
     접두로 판별하던 것을 목록으로 바꾼 이유가 이것이다: 이름만으로는 사용자 테이블과
     구분할 수 없으니, 무엇이 우리 것인지 여기 적어 둔다. 테이블을 늘리면 여기도 늘린다. */
  var APP_TABLES = { CONFIG: 1, EVENTS: 1, BASELINE: 1, BAND: 1, MONSTATE: 1 };
  /* 저장소는 두 갈래다.
      · 공용(SHARED)  — BAND·EVENTS·BASELINE·MONSTATE. 표 하나를 전 계정이 나눠 쓰고,
                        행의 키(TAG 의 NAME, LOOKUP 의 K)에 '<계정>:' 접두로 가른다.
                        계정마다 표를 만들면 TAG 표 하나가 내부 6개로 펼쳐지고 롤업까지
                        계정 수만큼 돌아 객체가 계정당 17개씩 늘어난다.
      · 전용(PRIVATE) — CONFIG. LLM API 키·웹훅이 들어 있어 행 접두로는 못 막는다.
                        Machbase 의 권한 최소 단위가 '표'라, 남이 조회 자체를 못 하게 하려면
                        표가 계정 스키마에 있어야 한다(행 단위 권한은 없다).
     ⚠ 공용 표는 SYS 소유다 — 접두 없는 이름은 접속 계정 스키마에서 찾으므로 반드시 수식한다. */
  var SHARED_OWNER = 'SYS';
  var PRIVATE_TABLES = { CONFIG: 1 };
  var _scope = '', _shared = '', _upfx = '';
  function setScope(db, user) {
    _scope = (db && user) ? (ident(db) + '.' + ident(user) + '.') : '';
    _shared = db ? (ident(db) + '.' + SHARED_OWNER + '.') : '';
    _upfx = user ? ident(user) + ':' : '';
  }
  function scope() { return _scope; }
  function sharedScope() { return _shared; }
  function appTable(name) {
    var n = ident(name), u = n.toUpperCase();
    if (!APP_TABLES[u]) return n;
    if (PRIVATE_TABLES[u]) return _scope ? _scope + n : n;
    return _shared ? _shared + n : n;
  }
  /* 공용 표의 행 키. 붙이는 곳과 떼는 곳이 갈라지면 남의 행을 읽거나 자기 행을 못 찾는다
     — 조립은 전부 ukey, 해체는 전부 unkey 를 지난다. */
  function userPrefix() { return _upfx; }
  function ukey(k) { return _upfx + String(k); }
  function unkey(k) {
    var v = String(k);
    return (_upfx && v.indexOf(_upfx) === 0) ? v.slice(_upfx.length) : v;
  }
  function ukeyList(keys) {
    return (keys || []).map(function (k) { return "'" + esc(ukey(k)) + "'"; }).join(',');
  }
  /* 공용 표에서 '내 행만' 고르는 조건. 접두가 없으면(계정 미확정) 조건을 안 건다 —
     그 상태로 쿼리가 나가는 경우는 부팅 게이트가 막는다.
     접두 일치를 LIKE가 아니라 문자열 범위 [<계정>:, <계정>;)로 건다(':' 다음 문자가 ';'). 이유 둘(실측):
       · LOOKUP 표(BASELINE·MONSTATE)와 TAG 메타 표에서 '_' 없는 접두 LIKE('SYS:%')가 0건을 돌려준다 —
         학습값·판정 상태를 하나도 못 읽는다(TAG 데이터 표는 정상이라 드러나지 않는다)
       · LIKE의 '_'는 아무 한 글자라 A_B 계정이 AXB의 행까지 잡는데, Machbase LIKE는 백슬래시·ESCAPE로
         이를 막을 수 없다 */
  function mine(col) {
    if (!_upfx) return '';
    var c = ident(col), hi = _upfx.slice(0, -1) + String.fromCharCode(_upfx.charCodeAt(_upfx.length - 1) + 1);
    return c + " >= '" + esc(_upfx) + "' and " + c + " < '" + esc(hi) + "'";
  }
  function andMine(col) { var w = mine(col); return w ? ' and ' + w : ''; }
  function whereMine(col) { var w = mine(col); return w ? ' where ' + w : ''; }
  // CONFIG 는 표 자체가 계정 것이라 접두를 붙이지 않는다 — 붙이면 키가 두 번 갈린다
  function sharedKv(table) { return !PRIVATE_TABLES[ident(table).toUpperCase()]; }

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

  /* 실행 계정 조회 — 토큰 문자열만으로는 어느 계정인지 알 수 없어 서버에 묻는다.
     난수를 심은 쿼리가 자기 자신을 V$STMT에 남기므로 그 세션을 특정할 수 있다.
     V$SESSION 단독으로는 안 된다 — 전역 뷰라 누가 물어도 같은 행이 나온다.
     난수는 영숫자만 남겨 따옴표가 섞일 여지를 없앤다. */
  function sessionUser(nonce) {
    return 'SELECT s.USER_NAME FROM V$STMT t, V$SESSION s'
      + " WHERE t.SESS_ID = s.ID AND t.QUERY LIKE '%" + String(nonce).replace(/[^A-Za-z0-9]/g, '') + "%'";
  }



  /* 소유자도 함께 받는다 — 조회할 때 접두를 붙여야 하는데, 그 정보는 여기 말고는 알 곳이 없다.
     소유자 조건을 걸지 않는다: M$SYS_TABLES 가 세션 계정 기준으로 이미 걸러 주므로(GRANT 받은
     남의 테이블도 함께 나온다) 조건을 걸면 오히려 접근 가능한 테이블이 목록에서 빠진다. */
  function catalogTables() {
    return 'SELECT su.NAME, st.NAME, st.DATABASE_NAME FROM M$SYS_TABLES st, M$SYS_USERS su'
      + ' WHERE st.USER_ID = su.USER_ID AND st.FLAG = 0 AND st.TYPE = 6 ORDER BY st.NAME';
  }

  function catalogCount() {
    return 'SELECT count(*) FROM M$SYS_TABLES st WHERE st.FLAG = 0 AND st.TYPE = 6';
  }

  /* TAG table의 앞 세 컬럼. TAG table은 컬럼 '이름'이 아니라 역할 키워드(PRIMARY KEY·BASETIME·SUMMARIZED)로
     정해지므로 이름은 만드는 쪽 마음이다. 이 앱의 조회는 전부 NAME·TIME·VALUE를 그대로 쓰기 때문에,
     다른 이름을 쓰는 table은 태그 목록(_<t>_meta)부터 실패한다 — 선택 목록에서 미리 걸러내려고 읽는다.
     ⚠명시적 JOIN 3단은 이 빌드에서 'TK_ID is not resolved'로 깨진다 — 콤마 조인으로 쓴다. */
  function tagSchemas() {
    return 'SELECT st.NAME TBL, c.NAME COL FROM M$SYS_TABLES st, M$SYS_COLUMNS c'
      + ' WHERE st.ID = c.TABLE_ID'
      + ' AND st.FLAG = 0 AND st.TYPE = 6 AND c.ID < 3 ORDER BY st.NAME, c.ID';
  }

  function tagList(table) {
    return 'SELECT NAME FROM ' + dataSub(table, function (n) { return '_' + n.toLowerCase() + '_meta'; }) + ' ORDER BY NAME';
  }

  function tagStats(table) {
    return 'select NAME, ROW_COUNT, MIN_TIME, MAX_TIME from ' + dataSub(table, function (n) { return 'V$' + n + '_STAT'; });
  }

  /* SUM은 평균(DC)을 빼기 위해 받는다 — RMS를 √(Σx²/N)로만 내면 오프셋이 그대로 판정값을
     부풀린다. ISO는 AC 성분 기준이다. 컬럼 순서는 toBucket이 인덱스로 읽으므로 뒤에만 붙인다. */
  var ROLLUP_COLS = 'SUMSQ(VALUE) SS, COUNT(VALUE) CNT, MIN(VALUE) MN, MAX(VALUE) MX, SUM(VALUE) SM';

  // 버킷 표현식: 기본 ROLLUP(고속·사전집계), rollup 미지원 테이블은 DATE_TRUNC 원본 집계 폴백
  function bucketExpr(unit, useTrunc) {
    return useTrunc ? "DATE_TRUNC('" + unit + "', TIME)" : "ROLLUP('" + unit + "', 1, TIME)";
  }

  function rollupTrend(table, tag, unit, fromMs, toMs, useTrunc) {
    return 'select ' + bucketExpr(unit, useTrunc) + ' RT, ' + ROLLUP_COLS + ' from ' + dataTable(table)
      + " where NAME='" + esc(tag) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by RT order by RT';
  }

  function rollupBatch(table, tags, unit, fromMs, toMs, useTrunc) {
    var names = tags.map(function (t) { return "'" + esc(t) + "'"; }).join(',');
    return 'select NAME, ' + bucketExpr(unit, useTrunc) + ' RT, ' + ROLLUP_COLS + ' from ' + dataTable(table)
      + ' where NAME in (' + names + ') and TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by NAME, RT order by NAME, RT';
  }

  function rawWindow(table, tag, fromMs, toMs) {
    return 'select TIME, VALUE from ' + dataTable(table) + " where NAME='" + esc(tag) + "' and TIME between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME';
  }

  /* 앵커 이하로 표본이 실제로 있는 마지막 '초'. 간헐 수집(예: 10분마다 1초)에서는 분석 창을
     앵커에 그대로 붙이면 수집 공백에 떨어져 통째로 빈다 — 창 끝을 실데이터에 맞추기 위한 조회다.
     원본을 역방향으로 훑는 방식(MAX(TIME)·ORDER BY TIME DESC)은 스캔 폭에 비례해 느려지므로
     초 롤업에서 찾는다. 롤업은 사전 집계라 데이터 기간이 길어져도 비용이 사실상 일정하다.
     COUNT는 폴백(DATE_TRUNC) 경로에서 빈 버킷을 거르려고 함께 받는다. */
  function lastSampleAt(table, tag, fromMs, toMs, useTrunc) {
    return 'select ' + bucketExpr('sec', useTrunc) + ' RT, COUNT(VALUE) CNT from ' + dataTable(table)
      + " where NAME='" + esc(tag) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by RT order by RT desc limit 1';
  }

  /* 샘플레이트 추정용 — 값은 필요 없고 연속한 표본의 시각만 있으면 된다.
     LIMIT으로 건수를 묶어 25.6 kHz 태그라도 비용이 고정된다(간격은 표본 수보다 하나 적다). */
  function sampleTimes(table, tag, fromMs, toMs, limit) {
    return 'select TIME from ' + dataTable(table) + " where NAME='" + esc(tag) + "' and TIME between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME limit ' + (Number(limit) || 2000);
  }

  /* SQL 문장을 TQL 큰따옴표 문자열로 넣는다(JSON.stringify가 \"·\\·개행을 이스케이프한다).
     백틱 원시 문자열에는 이스케이프가 없어, 태그 이름에 백틱이 있으면 문자열이 거기서 끊기고 뒤가 TQL로
     해석된다 — 상세분석을 여는 사람의 권한으로 실행된다. 태그는 SQL 층에서 esc가 따옴표를 한 번 더 막는다. */
  function fftTql(table, tag, fromMs, toMs, minHz, maxHz) {
    var sql = 'select time, value from ' + dataTable(table) + " where name = '" + esc(tag) + "' and time between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by time';
    return 'SQL(' + JSON.stringify(sql) + ')\n'
      + "MAPKEY('fft')\nGROUPBYKEY()\nFFT(minHz(" + Number(minHz) + '), maxHz(' + Number(maxHz) + '))\nCSV(precision(6))';
  }

  /* ---- 상시감시(P6) ---- */
  /* 공용 4표 — SYS 스키마에 한 벌만 둔다. 계정 구분은 행의 키 접두가 한다.
     SYS 가 아니면 만들 수 없으므로(남의 스키마), 없을 때는 앱이 안내를 띄운다. */
  function sharedCreateTables() {
    return [
      /* EVENTS는 TAG 테이블 — NAME='<테이블>:<태그>', TIME=이벤트 시각(태그·기간 단위 삭제 가능).
         SUMMARIZED를 붙이지 않아 롤업·통계는 만들지 않는다 — 이벤트는 집계 대상이 아니다. */
      'CREATE TAG TABLE ' + appTable('EVENTS') + ' (NAME VARCHAR(200) PRIMARY KEY, TIME DATETIME BASETIME, VALUE DOUBLE, ETYPE VARCHAR(16), GRADE VARCHAR(8), LIM DOUBLE, DETAIL VARCHAR(400), EID VARCHAR(120))',
      /* VAL 폭 — 한글은 encodeURIComponent에서 글자당 9자를 먹어 사유 문장 하나가 260자다.
         계측 게이트·충격성·패턴·포락선 이력이 한 태그에 다 실리면 1000자로는 넘친다.
         넘치면 잘린 채 저장되고 dec()가 null로 떨어뜨려 그 태그만 직전 상태를 영영 못 쌓는다
         — 에러도 로그도 없다. 폭을 바꾸면 db.js의 MONSTATE_VAL_MIN도 같이 올릴 것. */
      'CREATE LOOKUP TABLE ' + appTable('MONSTATE') + ' (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(4000))',
      'CREATE LOOKUP TABLE ' + appTable('BASELINE') + ' (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(1000))',
      /* 대역 에너지 추세 — TAG 테이블로 만든다. 전용 스키마를 새로 짜지 않는 이유:
         롤업·추세조회·차트·베이스라인 학습 코드가 전부 "TAG 시계열"을 전제로 이미 돌아간다.
         NAME = "<테이블>:<태그>:<대역>" (예: BEARING:C1:fault)
         대역: sub / one / fault / high / vhigh, 그리고 fr(실측 회전주파수)을 같은 방식으로 저장.
         ⚠fr을 반드시 함께 남긴다 — 대역 경계가 1× 상대라 fr을 모르면 저장된 값이
           어느 주파수 구간이었는지 나중에 복원할 수 없다(인버터 설비에서 특히). */
      'CREATE TAG TABLE ' + appTable('BAND') + ' (NAME VARCHAR(200) PRIMARY KEY, TIME DATETIME BASETIME, VALUE DOUBLE SUMMARIZED)',
    ];
  }
  /* 설정 — 유일하게 계정 스키마에 두는 표. 파일은 토큰만 있으면 누구나 읽히고(라이브 확인),
     공용 표에 두면 같은 GRANT 를 받은 계정끼리 서로 읽는다(행 단위 권한이 없다).
     LLM 키·웹훅 URL 이 여기 들어오므로 표 자체를 계정 것으로 둔다.
     값은 도메인 단위 JSON 을 조각내 담는다 — 설비 정보가 41KB 인 설치가 실제로 있고
     한 행에 넣으면 잘린 채 저장돼 그 도메인이 통째로 사라진다. */
  function configCreateTable() {
    return ['CREATE LOOKUP TABLE ' + appTable('CONFIG') + ' (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(4000))'];
  }
  function monCreateTables() { return sharedCreateTables().concat(configCreateTable()); }
  /* 대역 추세용 롤업 — SUMMARIZED 만으로는 롤업 객체가 생기지 않는다(실측: 이 테이블에
     _ROLLUP_* 이 없어 추세 조회가 줄곧 원본 전체 스캔으로 폴백하고 있었다).
     대역은 10분에 한 점이라 초 단위는 의미가 없다 — 분부터 세우고 시간은 그 위에 얹는다.
     ⚠ 롤업 '이름'에는 DB·스키마 수식을 못 쓴다(ERR-2010 구문 오류). ON/FROM 대상에는 쓸 수 있다. */
  function bandRollups() {
    /* 롤업 '이름'에는 DB·스키마 수식을 못 쓴다(ERR-2010). ON/FROM 대상에는 쓸 수 있고,
       ⚠ FROM 의 소스 롤업도 수식해야 한다 — 빼면 접속 계정의 기본 DB 에서 찾다가
       ERR-2025("does not exist")로 떨어진다. 실패는 폴백에 먹혀 추세가 조용히 원본 스캔이 된다.
       대역 표가 공용 한 벌이라 롤업도 두 개로 고정이다(계정마다 돌지 않는다). */
    return [
      'CREATE ROLLUP IF NOT EXISTS BAND_MIN ON ' + appTable('BAND') + ' (VALUE) INTERVAL 1 MIN',
      'CREATE ROLLUP IF NOT EXISTS BAND_HOUR FROM ' + _shared + 'BAND_MIN INTERVAL 1 HOUR',
    ];
  }


  /* 전용 DB 를 쓸 수 있는지 — CAN_USE 는 계정별로 걸러지므로 0건이면 DB 가 없거나 CONNECT 권한이 없다.
     조회로는 둘을 못 가르므로 안내는 두 경우를 함께 다룬다. */
  /* 이 인스턴스의 계정 목록 — 권한을 줄 대상을 고르게 한다. 손으로 치면 오타가 나고,
     오타는 "권한을 줬는데 안 된다"로 나타나 원인을 찾기 어렵다. */
  function userList() { return 'SELECT NAME FROM M$SYS_USERS ORDER BY NAME'; }
  /* 앱 저장소는 진동 데이터가 아니다 — 카탈로그에서 빼지 않으면 데이터 소스 목록에 섞여
     자기 이벤트 표를 분석 대상으로 고르게 된다. 공용 표가 되면서 권한을 받은 전 계정에게
     보이므로 더 눈에 띈다. 전용 DB 안의 것은 전부 우리 것이고, NEO_VIBE_*·NEO_BEARING_* 은
     옛 이름 잔재라 어디 있든 제외한다. */
  function isAppOwned(name, db, appDb) {
    var d = String(db || '').toUpperCase();
    if (d && appDb && d === String(appDb).toUpperCase()) return true;
    return /^NEO_(VIBE|BEARING)_/.test(String(name || '').toUpperCase());
  }
  /* 한 계정에 필요한 권한 전부. DB 단위로 DML 을 주는 구문이 없고 역할(ROLE)도 없어서
     공용 표마다 한 문장씩 나온다 — 화면이 이걸 대신 실행한다. */
  function grantStatements(user) {
    var u = ident(user);
    if (!u) return [];
    var d = _shared ? _shared.split('.')[0] : '';
    if (!d) return [];
    return ['GRANT CONNECT ON DATABASE ' + d + ' TO ' + u,
      'GRANT CREATE ON DATABASE ' + d + ' TO ' + u]
      .concat(['EVENTS', 'BAND'].map(function (t) {
        return 'GRANT SELECT, INSERT, DELETE ON ' + _shared + t + ' TO ' + u;
      }))
      .concat(['BASELINE', 'MONSTATE'].map(function (t) {
        return 'GRANT SELECT, INSERT, UPDATE, DELETE ON ' + _shared + t + ' TO ' + u;
      }));
  }
  function dbUsable(db) {
    return "SELECT NAME, CAN_USE FROM V$DATABASES WHERE NAME = '" + esc(String(db).toUpperCase()) + "'";
  }

  // 대역 추세 조회 — 기존 rollupTrend와 같은 모양(초/분/시 롤업)으로 쓴다
  function bandTrend(key, unit, fromMs, toMs) {
    return 'select ROLLUP(\'' + (unit || 'min') + '\', 1, TIME) rt, AVG(VALUE) av from ' + appTable('BAND') + ''
      + " where NAME='" + esc(ukey(key)) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by rt order by rt';
  }
  /* 채움 현황 — 여러 시리즈의 시각만 한 번에 가져온다(값은 필요 없다).
     TAG 테이블은 같은 NAME+TIME 중복 삽입을 막지 않으므로, 다시 채우기 전에
     이미 있는 시각을 알아야 중복이 쌓이지 않는다. */
  function bandTimes(keys, fromMs, toMs) {
    var ks = ukeyList(keys);
    return 'select NAME, TIME from ' + appTable('BAND') + ' where NAME in (' + ks + ') and TIME between '
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME';
  }
  /* 여러 계열의 최신값을 한 번에 — 판정은 태그마다 계열 전부의 "지금 값"이 필요하다.
     계열마다 따로 물으면 문장 수가 태그수 × 계열수가 되어, 계열이 늘 때마다 그만큼 늘어난다.
     시각 오름차순으로 받아 부르는 쪽이 NAME별 마지막 행을 취한다(창이 좁아 행 수가 적다). */
  function bandLatest(keys, fromMs, toMs) {
    var ks = ukeyList(keys);
    return 'select NAME, VALUE from ' + appTable('BAND') + ' where NAME in (' + ks + ') and TIME between '
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME';
  }
  // 대역 원본 조회(베이스라인 학습용 — 롤업 없이 저장된 그대로)
  function bandRaw(key, fromMs, toMs) {
    return 'select TIME, VALUE from ' + appTable('BAND') + ''
      + " where NAME='" + esc(ukey(key)) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' order by TIME';
  }
  // 기존 설치 마이그레이션 — 이미 있으면 에러가 나지만 호출측이 삼킨다(멱등 취급)
  /* 컬럼 순서는 TAG 테이블 규약(NAME·TIME·VALUE 먼저) — 읽는 쪽이 인덱스로 집으므로 여기서만 정한다.
     앱이 보는 객체 모양({eid, ts, tbl, tag, …})은 db.js가 맞춰 주므로 화면 코드는 이 순서를 모른다. */
  var EV_COLS = 'NAME, TIME, VALUE, ETYPE, GRADE, LIM, DETAIL, EID';
  function eventsSelect(limit) {
    return 'select ' + EV_COLS + ' from ' + appTable('EVENTS') + whereMine('NAME')
      + ' order by TIME desc limit ' + (Number(limit) || 300);
  }
  // 기간 지정 조회(CSV/JSON 내보내기용) — 최신순
  function eventsRange(fromMs, toMs, limit) {
    return 'select ' + EV_COLS + ' from ' + appTable('EVENTS') + ' where TIME between ' +
      sqlDate(fromMs) + ' and ' + sqlDate(toMs) + andMine('NAME')
      + ' order by TIME desc limit ' + (Number(limit) || 100000);
  }
  // 기간·필터 내 총 건수 — 목록은 최근 N건만 렌더하므로 개수는 별도 COUNT로 정확히 센다
  function eventsCount(fromMs, toMs, etype, tbl, tag) {
    var w = 'TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
    if (tbl && tag) w += " and NAME='" + esc(ukey(tbl + ':' + tag)) + "'";
    else w += andMine('NAME');
    if (etype) w += " and ETYPE='" + esc(etype) + "'";
    return 'select count(*) from ' + appTable('EVENTS') + ' where ' + w;
  }
  function eventInsert(e) {
    // GRADE는 단어(양호/주의/위험/심각) 저장 — raw 테이블 가독성. 앱은 로드 시 인덱스로 역매핑.
    return 'insert into ' + appTable('EVENTS') + ' values(' +
      "'" + esc(ukey(e.tbl + ':' + e.tag)) + "', " + sqlDate(e.ts) + ', ' + Number(e.val) + ", '" + esc(e.etype) + "', '" +
      esc(e.grade) + "', " + Number(e.lim) + ", '" + esc(e.detail || '') + "', '" + esc(e.eid) + "')";
  }
  // 삭제 — TAG 테이블이라 태그별·기간별로 지울 수 있다.
  function eventsDeleteTag(tbl, tag) {
    return 'delete from ' + appTable('EVENTS') + " where NAME='" + esc(ukey(tbl + ':' + tag)) + "'";
  }
/* 기간 삭제 — 공용 표라 시간만으로 지우면 남의 행까지 지워진다. 그렇다고 접두로 좁힐 수도
     없다: TAG 표의 DELETE 조건은 `NAME= 정확일치 [+ 시간범위]` 만 받는다(LIKE 는 ERR-2073).
     그래서 내 이름을 열거해 이름마다 한 문장씩 낸다 — 문장 배열을 돌려준다. */
  function eventsDeleteRange(keys, fromMs, toMs) {
    return (keys || []).map(function (k) {
      return 'delete from ' + appTable('EVENTS') + " where NAME='" + esc(ukey(k)) + "' and TIME between "
        + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
    });
  }
  /* 대역 데이터 삭제 — 이벤트와 같은 규칙(TAG 표).
     한 태그는 6키(대역 5 + fr)라 태그 단위 삭제는 부르는 쪽이 키마다 한 번씩 돈다. */
  function bandDeleteRange(keys, fromMs, toMs) {
    return (keys || []).map(function (k) {
      return 'delete from ' + appTable('BAND') + " where NAME='" + esc(ukey(k)) + "' and TIME between "
        + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
    });
  }
  /* 계열 한 점 저장 — 대역 타이머는 자기 TQL 안에서 직접 INSERT를 만들지만,
     앱이 매 회차 격자 점수를 남길 때는 이 문장을 쓴다(같은 표·같은 키 규칙). */
  function bandInsert(key, ms, v) {
    return 'insert into ' + appTable('BAND') + " values('" + esc(ukey(key)) + "', " + sqlDate(ms) + ', ' + (+v || 0) + ')';
  }
  function bandDeleteKey(key) { return 'delete from ' + appTable('BAND') + " where NAME='" + esc(ukey(key)) + "'"; }
  /* 데이터가 하나도 안 남은 태그의 이름을 메타에서 지운다 — 행을 다 지워도 이름은 메타에 남는다.
     이름을 지워도 무해하다: INSERT가 없는 이름을 자동 재등록하므로 살아 있는 태그는 저절로 돌아온다. */
  function metaPurgeOrphans(table) {
    var t = appTable(table);
    return 'delete from ' + t + ' metadata where NAME not in (select NAME from ' + t + ' group by NAME)'
      + andMine('NAME');
  }
  // 옛 LOG 테이블에서 옮겨 담기 위한 전체 조회 — 마이그레이션 전용
  function eventsLegacySelect() {
    return 'select EID, TS, TBL, TAG, ETYPE, GRADE, VAL, LIM, DETAIL from ' + appTable('EVENTS') + ' order by TS';
  }
  /* 전용 DB 안에 이미 있는 표 이름 — CREATE 를 실패로 확인하는 대신 먼저 본다.
     "있으면 실패"에 기대면 부팅마다 500 이 여러 건 쌓여 진짜 에러가 묻히고,
     "이미 있음"과 "권한이 없어 못 만듦"이 같은 500 이라 구분도 안 된다. */
  function appTablesPresent() {
    var d = _shared ? _shared.split('.')[0] : '';
    /* 소유자까지 받는다 — 설정 표는 계정마다 같은 이름(CONFIG)이라 이름만 보면
       남의 것을 보고 "이미 있다"고 판단해 자기 표를 안 만든다. */
    return 'select su.NAME, st.NAME from M$SYS_TABLES st, M$SYS_USERS su'
      + " where st.USER_ID = su.USER_ID and st.DATABASE_NAME = '" + esc(d) + "'";
  }
  function tableTypeOf(name) {
    return "select TYPE from M$SYS_TABLES where NAME = '" + esc(String(name).toUpperCase()) + "'";
  }
  function dropTable(name) { return 'DROP TABLE ' + appTable(name); }
  // 컬럼 폭 — 기존 설치의 스키마가 지금 DDL과 같은지 판단할 때 쓴다(CREATE는 이미 있으면 삼켜진다)
  function colLength(table, col) {
    return "select c.LENGTH from M$SYS_COLUMNS c, M$SYS_TABLES t where c.TABLE_ID = t.ID and t.NAME = '"
      + esc(String(table).toUpperCase()) + "' and c.NAME = '" + esc(String(col).toUpperCase()) + "'";
  }
  /* ---- 데이터 관리(설정) ----
     패키지가 만든 테이블의 현황을 읽는다. 삭제는 유형마다 되는 범위가 다르다:
      · EVENTS/BAND(TAG)          — 태그별·기간별 자유롭게
      · MONSTATE/BASELINE(LOOKUP) — 키 단위
     화면 버튼은 이 제약을 그대로 따른다(안 되는 걸 내놓으면 눌렀을 때 에러가 난다). */
  // 표마다 키 컬럼이 다르다 — TAG 는 NAME, LOOKUP 은 K
  function keyCol(table) { var u = ident(table).toUpperCase(); return (u === 'EVENTS' || u === 'BAND') ? 'NAME' : 'K'; }
  function usageCount(table) {
    return 'select count(*) from ' + appTable(table) + (sharedKv(table) ? whereMine(keyCol(table)) : '');
  }
  // 이벤트 보관 범위 — 표시용. TIME은 timeformat=ms라 숫자로 온다(대역 표와 같은 규약)
  function eventsSpan() { return 'select min(TIME), max(TIME) from ' + appTable('EVENTS') + whereMine('NAME'); }
  // 대역 데이터 보관 범위 — TAG 테이블이라 시각 컬럼(TIME) 기준
  function bandSpan() { return 'select min(TIME), max(TIME) from ' + appTable('BAND') + whereMine('NAME'); }
  function bandKeyCount() {
    return 'select count(*) from (select NAME from ' + appTable('BAND') + whereMine('NAME') + ' group by NAME)';
  }
  /* 태그별 보유량 — "어느 태그가 얼마나 차지하나". 총계(usageCount)로는 정리할 대상을 못 고른다.
     ' + appTable('BAND') + '의 NAME은 '테이블:태그:계열'이라 태그 하나가 계열 십여 개를 갖는다 —
     묶는 것은 부르는 쪽 몫이다(여기서 쪼개면 SQL이 문자열 함수에 의존하게 된다). */
  function bandNameCounts() {
    return 'select NAME, count(*) from ' + appTable('BAND') + whereMine('NAME') + ' group by NAME';
  }
  function eventNameCounts() {
    return 'select NAME, count(*) from ' + appTable('EVENTS') + whereMine('NAME') + ' group by NAME';
  }
  /* 구간 건수 — 삭제 전에 "몇 건이 지워지는지" 세어 보여주기 위한 조회.
     시간 범위 지정 삭제는 8.0.50+ 확장 구문(문서의 "시간 범위 삭제 미지원"은 레거시 BEFORE 구문 기준). */
  function eventsCountRange(fromMs, toMs) {
    return 'select count(*) from ' + appTable('EVENTS') + ' where TIME between ' + sqlDate(fromMs) + ' and '
      + sqlDate(toMs) + andMine('NAME');
  }
  function bandCountRange(fromMs, toMs) {
    return 'select count(*) from ' + appTable('BAND') + ' where TIME between ' + sqlDate(fromMs) + ' and '
      + sqlDate(toMs) + andMine('NAME');
  }

  function kvKey(table, key) { return sharedKv(table) ? ukey(key) : String(key); }
  function kvSelect(table) {
    return 'select K, VAL from ' + appTable(table) + (sharedKv(table) ? whereMine('K') : '');
  }
  function kvExists(table, key) { return 'select count(*) from ' + appTable(table) + " where K='" + esc(kvKey(table, key)) + "'"; }
  function kvInsert(table, key, val) { return 'insert into ' + appTable(table) + " values('" + esc(kvKey(table, key)) + "', '" + val + "')"; }
  function kvUpdate(table, key, val) { return 'update ' + appTable(table) + " set VAL='" + val + "' where K='" + esc(kvKey(table, key)) + "'"; }
  function kvDelete(table, key) { return 'delete from ' + appTable(table) + " where K='" + esc(kvKey(table, key)) + "'"; }

  return {
    esc: esc, ident: ident, sqlDate: sqlDate, sessionUser: sessionUser, SHARED_OWNER: SHARED_OWNER,
    setScope: setScope, scope: scope, sharedScope: sharedScope, appTable: appTable,
    userList: userList, grantStatements: grantStatements, isAppOwned: isAppOwned, appTablesPresent: appTablesPresent,
    userPrefix: userPrefix, ukey: ukey, unkey: unkey,
    sharedCreateTables: sharedCreateTables, configCreateTable: configCreateTable,
    setOwners: setOwners, ownerOf: ownerOf, dataTable: dataTable, bandRollups: bandRollups, dbUsable: dbUsable,
    catalogTables: catalogTables, catalogCount: catalogCount, tagSchemas: tagSchemas,
    tagList: tagList, tagStats: tagStats,
    rollupTrend: rollupTrend, rollupBatch: rollupBatch, rawWindow: rawWindow, lastSampleAt: lastSampleAt, sampleTimes: sampleTimes, fftTql: fftTql,
    monCreateTables: monCreateTables, bandTrend: bandTrend, bandRaw: bandRaw, bandTimes: bandTimes, bandLatest: bandLatest, eventsSelect: eventsSelect, eventsRange: eventsRange,
    eventsCount: eventsCount, eventInsert: eventInsert,
    eventsDeleteTag: eventsDeleteTag, eventsDeleteRange: eventsDeleteRange,
    bandInsert: bandInsert, bandDeleteRange: bandDeleteRange, bandDeleteKey: bandDeleteKey,
    metaPurgeOrphans: metaPurgeOrphans,
    eventsLegacySelect: eventsLegacySelect, tableTypeOf: tableTypeOf, dropTable: dropTable, colLength: colLength,
    kvSelect: kvSelect, kvExists: kvExists, kvInsert: kvInsert, kvUpdate: kvUpdate, kvDelete: kvDelete,
    usageCount: usageCount, eventsSpan: eventsSpan, bandSpan: bandSpan, bandKeyCount: bandKeyCount, bandNameCounts: bandNameCounts, eventNameCounts: eventNameCounts,
    eventsCountRange: eventsCountRange, bandCountRange: bandCountRange
  };
});
