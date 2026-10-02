// sql.js — 패키지 SQL/TQL 문자열 단일 소스(순수 문자열 빌더, 실행은 db/db.js)
// 앱 저장소: 공용 EVENTS·BAND(TAG)·MONSTATE·BASELINE(LOOKUP) + 계정 전용 CONFIG(LOOKUP), KV VAL은 encodeURIComponent(JSON)+('→%27)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeSQL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 문자열 리터럴 이스케이프(' → '') — 태그명/사용자명 방어
  function esc(s) { return String(s).replace(/'/g, "''"); }
  // 식별자(테이블명)는 따옴표 없이 쓰므로 영숫자·_·$만 통과
  function ident(s) { return String(s).replace(/[^A-Za-z0-9_$]/g, ''); }

  /* 이름 수식은 이 파일에서만 — 접두 없는 이름은 접속 계정 스키마에서 찾아 빈 결과·ERR-2025(부속 _meta·V$_STAT 포함)
     소유자는 카탈로그에서 받아 조립 때만 붙임, ident가 점을 지워 세 부분 이름은 직접 이음 */
  var _owners = {};
  function setOwners(m) {
    _owners = {};
    Object.keys(m || {}).forEach(function (k) { _owners[String(k).toUpperCase()] = m[k]; });
  }
  function ownerOf(table) { return _owners[String(table).toUpperCase().replace(/[^A-Z0-9_$]/g, '')] || null; }
  /* 데이터 테이블 이름 = db.user.table — user.table은 현재 DB에서만 찾음(카탈로그는 DB를 가로질러 보임).
     소유자를 모르면 짧은 이름 */
  function dataTable(table) {
    var n = ident(table), o = ownerOf(n);
    if (!o) return n;
    return (o.db ? ident(o.db) + '.' : '') + ident(o.user) + '.' + n;
  }
  // 부속 객체(_meta·V$_STAT)에도 같은 접두
  function dataSub(table, build) {
    var n = ident(table), o = ownerOf(n);
    var pfx = o ? ((o.db ? ident(o.db) + '.' : '') + ident(o.user) + '.') : '';
    return pfx + build(n);
  }

  // 앱 저장소 테이블 목록 — 이름만으론 사용자 테이블과 구분 불가라 명시. 표를 늘리면 여기도 추가
  var APP_TABLES = { CONFIG: 1, EVENTS: 1, BASELINE: 1, BAND: 1, MONSTATE: 1 };
  /* 저장소 두 갈래 — 공용(BAND·EVENTS·BASELINE·MONSTATE): SYS 소유 한 벌, 행 키 '<계정>:'로 구분
     · 전용(CONFIG): 계정 스키마(API 키·웹훅 보관, 행 단위 권한 없음) ⚠ 공용 표는 반드시 수식 */
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
  // 공용 표의 행 키 — 조립은 전부 ukey, 해체는 전부 unkey
  function userPrefix() { return _upfx; }
  function ukey(k) { return _upfx + String(k); }
  function unkey(k) {
    var v = String(k);
    return (_upfx && v.indexOf(_upfx) === 0) ? v.slice(_upfx.length) : v;
  }
  function ukeyList(keys) {
    return (keys || []).map(function (k) { return "'" + esc(ukey(k)) + "'"; }).join(',');
  }
  /* 공용 표에서 '내 행만' 고르는 조건 — 접두가 없으면(계정 미확정) 조건 없음(부팅 게이트가 차단).
     LIKE 대신 문자열 범위 [<계정>:, <계정>;):
       · LOOKUP 표·TAG 메타 표는 '_' 없는 접두 LIKE가 0건
       · LIKE의 '_'는 임의 한 글자인데 Machbase LIKE는 이스케이프 불가 */
  function mine(col) {
    if (!_upfx) return '';
    var c = ident(col), hi = _upfx.slice(0, -1) + String.fromCharCode(_upfx.charCodeAt(_upfx.length - 1) + 1);
    return c + " >= '" + esc(_upfx) + "' and " + c + " < '" + esc(hi) + "'";
  }
  function andMine(col) { var w = mine(col); return w ? ' and ' + w : ''; }
  function whereMine(col) { var w = mine(col); return w ? ' where ' + w : ''; }
  // CONFIG는 표 자체가 계정 것이라 키 접두 없음
  function sharedKv(table) { return !PRIVATE_TABLES[ident(table).toUpperCase()]; }

  /* 시각 → 에포크 나노초 — 브라우저·서버 시간대와 무관하게 같은 순간
     밀리초에 '000000'을 글자로 붙임(곱셈은 2^53 초과로 정밀도 손실) */
  function sqlDate(ms) {
    return 'from_timestamp(' + Math.round(Number(ms) || 0) + '000000)';
  }

  /* 실행 계정 조회 — 난수를 심은 쿼리가 V$STMT에 남아 자기 세션 특정(V$SESSION 단독은 전역 뷰라 불가).
     난수는 영숫자만 */
  function sessionUser(nonce) {
    return 'SELECT s.USER_NAME FROM V$STMT t, V$SESSION s'
      + " WHERE t.SESS_ID = s.ID AND t.QUERY LIKE '%" + String(nonce).replace(/[^A-Za-z0-9]/g, '') + "%'";
  }



  /* 소유자·DB도 함께 받음(조회 접두용). 소유자 조건 없음 — M$SYS_TABLES가 세션 계정 기준으로 이미 거름
     (GRANT 받은 남의 표 포함) */
  function catalogTables() {
    return 'SELECT su.NAME, st.NAME, st.DATABASE_NAME FROM M$SYS_TABLES st, M$SYS_USERS su'
      + ' WHERE st.USER_ID = su.USER_ID AND st.FLAG = 0 AND st.TYPE = 6 ORDER BY st.NAME';
  }

  function catalogCount() {
    return 'SELECT count(*) FROM M$SYS_TABLES st WHERE st.FLAG = 0 AND st.TYPE = 6';
  }

  /* TAG table의 앞 세 컬럼 이름 — TAG 컬럼은 역할 키워드로 정해져 이름이 자유.
     앱 조회는 NAME·TIME·VALUE 고정이라 다른 이름의 table을 선택 목록에서 거르는 용도.
     ⚠ 명시적 JOIN 3단은 'TK_ID is not resolved' → 콤마 조인 */
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

  // SUM은 DC 제거용(ISO는 AC 성분 기준). toBucket이 인덱스로 읽으므로 컬럼은 뒤에만 추가
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

  /* 앵커 이하로 표본이 있는 마지막 '초' — 간헐 수집에서 분석 창 끝을 실데이터에 맞추는 용도.
     원본 역방향 스캔은 스캔 폭에 비례해 느려 초 롤업에서 찾음. COUNT는 폴백 경로의 빈 버킷 거르기용 */
  function lastSampleAt(table, tag, fromMs, toMs, useTrunc) {
    return 'select ' + bucketExpr('sec', useTrunc) + ' RT, COUNT(VALUE) CNT from ' + dataTable(table)
      + " where NAME='" + esc(tag) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by RT order by RT desc limit 1';
  }

  // 샘플레이트 추정용 연속 표본 시각 — LIMIT으로 비용 고정
  function sampleTimes(table, tag, fromMs, toMs, limit) {
    return 'select TIME from ' + dataTable(table) + " where NAME='" + esc(tag) + "' and TIME between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME limit ' + (Number(limit) || 2000);
  }

  /* SQL을 TQL 큰따옴표 JSON 문자열로 넣음 — TQL 백틱 문자열은 이스케이프 불가라 태그명의 백틱이 TQL 주입이 됨 */
  function fftTql(table, tag, fromMs, toMs, minHz, maxHz) {
    var sql = 'select time, value from ' + dataTable(table) + " where name = '" + esc(tag) + "' and time between "
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by time';
    return 'SQL(' + JSON.stringify(sql) + ')\n'
      + "MAPKEY('fft')\nGROUPBYKEY()\nFFT(minHz(" + Number(minHz) + '), maxHz(' + Number(maxHz) + '))\nCSV(precision(6))';
  }

  /* ---- 상시감시 ---- */
  // 공용 4표 — SYS 스키마에 한 벌, 계정 구분은 행 키 접두. SYS만 생성 가능
  function sharedCreateTables() {
    return [
      /* EVENTS(TAG) — NAME='<테이블>:<태그>', TIME=이벤트 시각(태그·기간 단위 삭제 가능).
         집계 대상 아니라 SUMMARIZED 없음 */
      'CREATE TAG TABLE ' + appTable('EVENTS') + ' (NAME VARCHAR(200) PRIMARY KEY, TIME DATETIME BASETIME, VALUE DOUBLE, ETYPE VARCHAR(16), GRADE VARCHAR(8), LIM DOUBLE, DETAIL VARCHAR(400), EID VARCHAR(120))',
      /* VAL 폭 — 한글은 URI 인코딩 시 글자당 9자. 넘치면 잘린 채 저장돼 dec()가 null(그 태그 상태 조용히 소실).
         폭을 바꾸면 db.js MONSTATE_VAL_MIN도 같이 변경 */
      'CREATE LOOKUP TABLE ' + appTable('MONSTATE') + ' (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(4000))',
      'CREATE LOOKUP TABLE ' + appTable('BASELINE') + ' (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(1000))',
      /* 대역 추세(TAG) — NAME = "<테이블>:<태그>:<계열>"(예: BEARING:C1:fault).
         계열 = 대역 에너지·fr(경계를 정한 회전주파수)·포락선 지표·패턴 점수.
         ⚠ fr 필수 — 대역 경계가 1× 상대라 fr 없으면 저장값의 주파수 구간 복원 불가 */
      'CREATE TAG TABLE ' + appTable('BAND') + ' (NAME VARCHAR(200) PRIMARY KEY, TIME DATETIME BASETIME, VALUE DOUBLE SUMMARIZED)',
    ];
  }
  /* 설정 — 유일하게 계정 스키마에 두는 표(LLM 키·웹훅 URL 보관, 행 단위 권한 없음).
     값은 영역 단위 JSON 조각(한 행 한도 초과 시 잘려 영역 소실) */
  function configCreateTable() {
    return ['CREATE LOOKUP TABLE ' + appTable('CONFIG') + ' (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(4000))'];
  }
  function monCreateTables() { return sharedCreateTables().concat(configCreateTable()); }
  /* 대역 추세용 롤업 — SUMMARIZED만으론 롤업 객체가 안 생김. 분 롤업 위에 시간 롤업.
     ⚠ 롤업 '이름'엔 DB·스키마 수식 불가(ERR-2010), ON/FROM 대상엔 가능 */
  function bandRollups() {
    // ⚠ FROM의 소스 롤업도 수식 필수 — 빠지면 ERR-2025(폴백에 먹혀 추세가 조용히 원본 스캔)
    return [
      'CREATE ROLLUP IF NOT EXISTS BAND_MIN ON ' + appTable('BAND') + ' (VALUE) INTERVAL 1 MIN',
      'CREATE ROLLUP IF NOT EXISTS BAND_HOUR FROM ' + _shared + 'BAND_MIN INTERVAL 1 HOUR',
    ];
  }


  // 계정 목록 — 권한 부여 대상 선택지(손 입력 오타 방지)
  function userList() { return 'SELECT NAME FROM M$SYS_USERS ORDER BY NAME'; }
  // 앱 저장소 판별(데이터 소스 목록에서 제외) — 전용 DB 안의 것 전부 + NEO_VIBE_*·NEO_BEARING_* 옛 이름 잔재
  function isAppOwned(name, db, appDb) {
    var d = String(db || '').toUpperCase();
    if (d && appDb && d === String(appDb).toUpperCase()) return true;
    return /^NEO_(VIBE|BEARING)_/.test(String(name || '').toUpperCase());
  }
  // 한 계정에 필요한 권한 전부 — DB 단위 DML 권한 구문·ROLE이 없어 공용 표마다 한 문장
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
  /* 전용 DB 사용 가능 여부 — CAN_USE는 계정별로 걸러져 0건이면 DB 없음 또는 CONNECT 권한 없음(구분 불가) */
  function dbUsable(db) {
    return "SELECT NAME, CAN_USE FROM V$DATABASES WHERE NAME = '" + esc(String(db).toUpperCase()) + "'";
  }

  // 대역 추세 조회 — rollupTrend와 같은 모양(초/분/시 롤업)
  function bandTrend(key, unit, fromMs, toMs) {
    return 'select ROLLUP(\'' + (unit || 'min') + '\', 1, TIME) rt, AVG(VALUE) av from ' + appTable('BAND') + ''
      + " where NAME='" + esc(ukey(key)) + "' and TIME between " + sqlDate(fromMs) + ' and ' + sqlDate(toMs)
      + ' group by rt order by rt';
  }
  /* 채움 현황 — 여러 계열의 시각만 조회. TAG 표는 같은 NAME+TIME 중복 삽입을 막지 않아 재채움 전 확인용 */
  function bandTimes(keys, fromMs, toMs) {
    var ks = ukeyList(keys);
    return 'select NAME, TIME from ' + appTable('BAND') + ' where NAME in (' + ks + ') and TIME between '
      + sqlDate(fromMs) + ' and ' + sqlDate(toMs) + ' order by TIME';
  }
  // 여러 계열의 최신값을 한 문장으로 — 시각 오름차순, 호출측이 NAME별 마지막 행을 취함
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
  // 이벤트 컬럼 순서(TAG 규약상 NAME·TIME·VALUE 먼저) — db.js evRow가 인덱스로 읽음
  var EV_COLS = 'NAME, TIME, VALUE, ETYPE, GRADE, LIM, DETAIL, EID';
  function eventsSelect(limit) {
    return 'select ' + EV_COLS + ' from ' + appTable('EVENTS') + whereMine('NAME')
      + ' order by TIME desc limit ' + (Number(limit) || 300);
  }
  /* 이벤트 조회 조건 — 기간 + 필터 f { etype: 유형, keys: 'table:tag' 목록 }
     · keys 있으면 그 태그만(키에 계정 접두 포함 — 내 행 범위 겸함), 빈 목록은 없는 키로 0건('' 비교는 NULL 오류 ERR-2284)
     · keys 없으면 내 행 전체(내보내기 — 선택 해제한 테이블 포함) */
  function evWhere(fromMs, toMs, f) {
    f = f || {};
    var w = 'TIME between ' + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
    if (f.keys) w += ' and NAME in (' + ukeyList(f.keys.length ? f.keys : [':']) + ')';
    else w += andMine('NAME');
    if (f.etype) w += " and ETYPE='" + esc(f.etype) + "'";
    return w;
  }
  // 기간 조회 — 최신순
  function eventsRange(fromMs, toMs, limit, f) {
    return 'select ' + EV_COLS + ' from ' + appTable('EVENTS') + ' where ' + evWhere(fromMs, toMs, f)
      + ' order by TIME desc limit ' + (Number(limit) || 100000);
  }
  // 기간·필터 내 총 건수(목록은 최근 N건만) — 목록과 같은 조건
  function eventsCount(fromMs, toMs, f) {
    return 'select count(*) from ' + appTable('EVENTS') + ' where ' + evWhere(fromMs, toMs, f);
  }
  function eventInsert(e) {
    // GRADE는 단어(양호/주의/위험/심각)로 저장, 앱이 로드 시 인덱스로 역매핑
    return 'insert into ' + appTable('EVENTS') + ' values(' +
      "'" + esc(ukey(e.tbl + ':' + e.tag)) + "', " + sqlDate(e.ts) + ', ' + Number(e.val) + ", '" + esc(e.etype) + "', '" +
      esc(e.grade) + "', " + Number(e.lim) + ", '" + esc(e.detail || '') + "', '" + esc(e.eid) + "')";
  }
  // 태그 단위 삭제
  function eventsDeleteTag(tbl, tag) {
    return 'delete from ' + appTable('EVENTS') + " where NAME='" + esc(ukey(tbl + ':' + tag)) + "'";
  }
  /* 기간 삭제 — 공용 표라 내 이름마다 한 문장(문장 배열 반환).
     TAG 표 DELETE는 NAME 정확일치 [+ 시간범위]만 받음(LIKE는 ERR-2073), 시간 범위 삭제는 8.0.50+ 확장 구문 */
  function eventsDeleteRange(keys, fromMs, toMs) {
    return (keys || []).map(function (k) {
      return 'delete from ' + appTable('EVENTS') + " where NAME='" + esc(ukey(k)) + "' and TIME between "
        + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
    });
  }
  // 대역 데이터 기간 삭제 — 이벤트와 같은 규칙(TAG 표)
  function bandDeleteRange(keys, fromMs, toMs) {
    return (keys || []).map(function (k) {
      return 'delete from ' + appTable('BAND') + " where NAME='" + esc(ukey(k)) + "' and TIME between "
        + sqlDate(fromMs) + ' and ' + sqlDate(toMs);
    });
  }
  // 계열 한 점 저장(앱의 격자 점수 기록용) — 타이머 TQL은 같은 표·키 규칙으로 직접 INSERT
  function bandInsert(key, ms, v) {
    return 'insert into ' + appTable('BAND') + " values('" + esc(ukey(key)) + "', " + sqlDate(ms) + ', ' + (+v || 0) + ')';
  }
  function bandDeleteKey(key) { return 'delete from ' + appTable('BAND') + " where NAME='" + esc(ukey(key)) + "'"; }
  // 데이터 없는 이름을 메타에서 삭제(행을 지워도 이름은 남음) — INSERT가 이름을 자동 재등록해 무해
  function metaPurgeOrphans(table) {
    var t = appTable(table);
    return 'delete from ' + t + ' metadata where NAME not in (select NAME from ' + t + ' group by NAME)'
      + andMine('NAME');
  }
  // 옛 LOG 테이블에서 옮겨 담기 위한 전체 조회 — 마이그레이션 전용
  function eventsLegacySelect() {
    return 'select EID, TS, TBL, TAG, ETYPE, GRADE, VAL, LIM, DETAIL from ' + appTable('EVENTS') + ' order by TS';
  }
  // 전용 DB 안에 이미 있는 표 — CREATE 전 확인용("이미 있음"과 "권한 없음"이 같은 500)
  function appTablesPresent() {
    var d = _shared ? _shared.split('.')[0] : '';
    // 소유자까지 — 계정별 CONFIG가 같은 이름
    return 'select su.NAME, st.NAME from M$SYS_TABLES st, M$SYS_USERS su'
      + " where st.USER_ID = su.USER_ID and st.DATABASE_NAME = '" + esc(d) + "'";
  }
  function tableTypeOf(name) {
    return "select TYPE from M$SYS_TABLES where NAME = '" + esc(String(name).toUpperCase()) + "'";
  }
  function dropTable(name) { return 'DROP TABLE ' + appTable(name); }
  // 컬럼 폭 — 기존 설치 스키마가 현재 DDL과 같은지 판단용
  function colLength(table, col) {
    return "select c.LENGTH from M$SYS_COLUMNS c, M$SYS_TABLES t where c.TABLE_ID = t.ID and t.NAME = '"
      + esc(String(table).toUpperCase()) + "' and c.NAME = '" + esc(String(col).toUpperCase()) + "'";
  }
  /* ---- 데이터 관리(설정) ----
     패키지 표 현황 조회. 삭제 가능 범위:
      · EVENTS/BAND(TAG)          — 태그별·기간별
      · MONSTATE/BASELINE(LOOKUP) — 키 단위 */
  // 키 컬럼 — TAG는 NAME, LOOKUP은 K
  function keyCol(table) { var u = ident(table).toUpperCase(); return (u === 'EVENTS' || u === 'BAND') ? 'NAME' : 'K'; }
  function usageCount(table) {
    return 'select count(*) from ' + appTable(table) + (sharedKv(table) ? whereMine(keyCol(table)) : '');
  }
  // 이벤트 보관 범위(표시용) — TIME은 timeformat=ms라 숫자
  function eventsSpan() { return 'select min(TIME), max(TIME) from ' + appTable('EVENTS') + whereMine('NAME'); }
  // 대역 데이터 보관 범위 — TAG 테이블이라 시각 컬럼(TIME) 기준
  function bandSpan() { return 'select min(TIME), max(TIME) from ' + appTable('BAND') + whereMine('NAME'); }
  function bandKeyCount() {
    return 'select count(*) from (select NAME from ' + appTable('BAND') + whereMine('NAME') + ' group by NAME)';
  }
  // 이름별 보유량 — BAND NAME은 '테이블:태그:계열'이라 태그 단위 묶기는 호출측 몫
  function bandNameCounts() {
    return 'select NAME, count(*) from ' + appTable('BAND') + whereMine('NAME') + ' group by NAME';
  }
  function eventNameCounts() {
    return 'select NAME, count(*) from ' + appTable('EVENTS') + whereMine('NAME') + ' group by NAME';
  }
  /* 구간 건수(삭제 전 확인용) */
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
