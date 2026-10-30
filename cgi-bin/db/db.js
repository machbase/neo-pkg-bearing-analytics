// db/db.js — Machbase Neo DB 연동 실행층. SQL 문자열은 ./sql.js, 계산은 ../calc
// fetch 기반 same-origin(앱이 Neo /public에서 서빙). 시간값은 전부 ms(timeformat=ms)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sql.js'), require('../calc/calc.js'));
  } else {
    root.VibeDB = factory(root.VibeSQL, root.VibeCalc);
  }
})(typeof self !== 'undefined' ? self : this, function (SQL, VC) {
  'use strict';

  /* ---------------- REST ----------------
     · 인증 헤더는 여기서만 붙임 — 헤더 없는 /db/* 요청은 서버 설정에 따라 기본 신원(SYS)으로 통과(권한 확대)
     · 신원 = 계정별 API 토큰(nt_), 토큰 없으면 요청 자체를 보내지 않음
     · 콘솔 로그인(JWT)은 계정 이름만 읽음 — 토큰 칸 구분·계정 불일치 차단용, 인증엔 안 씀 */
  var TOKEN_KEY = 'neo-pkg-bearing-analytics.token.';   // + 계정명(대문자)
  function jwtPayload(tok) {
    try {
      var parts = String(tok || '').split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) { return null; }
  }
  // Neo 콘솔 로그인 계정 — JWT payload의 sub(서명 검증 없음, 식별용)
  function consoleUser() {
    var jwt = '';
    try { jwt = localStorage.getItem('accessToken') || ''; } catch (e) { jwt = ''; }
    var o = jwtPayload(jwt);
    return String((o && (o.sub || o.username || o.name)) || '').toUpperCase();
  }

  /* 토큰 칸 — 계정별(공용 브라우저에서 앞사람 토큰 재사용 방지)
     · 부팅 뒤엔 이 탭의 계정 칸 고정, 부팅 전엔 콘솔 계정 칸 */
  function tokenSlot() {
    var u = _user || consoleUser();
    return u ? TOKEN_KEY + u : '';
  }
  // 캐시 안 함 — 다른 탭의 교체·삭제를 다음 요청에 반영
  function apiToken() {
    var k = tokenSlot();
    if (!k) return '';
    try { return (localStorage.getItem(k) || '').trim(); } catch (e) { return ''; }
  }
  function setApiToken(tok) {
    var k = tokenSlot();
    if (!k) return false;
    try { localStorage.setItem(k, String(tok || '').trim()); return true; } catch (e) { return false; }
  }
  function clearApiToken() {
    var k = tokenSlot();
    if (!k) return;
    try { localStorage.removeItem(k); } catch (e) { /* 저장소 차단 환경 */ }
  }
  // 화면 표시용 — 앞 형식부·끝 4자만
  function tokenHint() {
    var t = apiToken();
    if (!t) return '';
    var m = /^(nt_[^_]*_)/.exec(t);
    return (m ? m[1] : '') + '…' + t.slice(-4);
  }

  // 인증 끊김(401·토큰 사라짐) 통지 — 호출측이 실패를 삼키면 "데이터 없음"으로 보임
  var _onAuthFail = null;
  function onAuthFail(fn) { _onAuthFail = fn; }

  // 모든 fetch의 단일 통로(토큰 확인 요청 포함)
  function send(path, init) { return fetch(path, init); }

  /* 토큰 → 계정명(대문자) — 무효면 null, 서버·네트워크 오류는 throw
     · 이 토큰 하나만 실어 보냄(저장된 토큰과 무관) */
  function validateToken(tok) {
    tok = String(tok || '').trim();
    if (!tok) return Promise.resolve(null);
    return send('/db/token/validate', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })
      .then(function (r) {
        if (r.status === 401) return null;
        if (r.status === 404) throw new Error('이 Neo에는 토큰 확인 API가 없습니다 — Neo 8.7.3 이상이 필요합니다');
        if (!r.ok) throw new Error('토큰 확인 실패 HTTP ' + r.status);
        return r.json().then(function (j) {
          return (j && j.valid === true && j.user) ? String(j.user).toUpperCase() : null;
        });
      });
  }

  function request(path, opts) {
    opts = opts || {};
    // 이 탭을 연 계정과 콘솔 로그인 계정이 다르면 보내지 않음 — 옛 계정 화면의 작업이 섞이지 않게
    var who = consoleUser();
    if (_user && who && who !== _user) {
      var err = new Error('다른 계정(' + who + ')으로 로그인되어 요청을 보내지 않았습니다 — 새로고침하세요');
      err.idSwitch = who;
      return Promise.reject(err);
    }
    var tok = apiToken();
    if (!tok) {
      var none = new Error('API 토큰이 없어 요청을 보내지 않았습니다');
      none.noToken = true;
      if (_user && _onAuthFail) _onAuthFail(path);
      return Promise.reject(none);
    }
    var init = { method: opts.method || 'GET', headers: Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + tok }) };
    if (opts.body !== undefined) init.body = opts.body;
    if (opts.cache) init.cache = opts.cache;
    return send(path, init).then(function (r) {
      // 401 = 토큰 무효·폐기
      if (r.status === 401 && _onAuthFail) _onAuthFail(path);
      return r;
    });
  }

  /* 실제 실행 계정 — 토큰 계정 대조용(다른 계정으로 실행돼도 응답은 정상).
     난수를 심은 쿼리가 자기 자신을 V$STMT에 남기는 점 이용 */
  function whoami() {
    var nonce = 'v' + Math.random().toString(36).slice(2, 12) + 'z';
    return q(SQL.sessionUser(nonce)).then(function (rows) {
      var seen = {}, list = [];
      rows.forEach(function (r) { var n = String(r[0]); if (!seen[n]) { seen[n] = 1; list.push(n); } });
      if (list.length !== 1) throw new Error('실행 계정을 특정하지 못했습니다 (' + list.length + '건)');
      return list[0].toUpperCase();
    });
  }

  function q(sql, opts) {
    opts = opts || {};
    var p = 'q=' + encodeURIComponent(sql) + '&format=json&timeformat=' + (opts.timeformat || 'ms');
    return request('/db/query?' + p).then(function (r) {
      // HTTP 500도 본문 reason 유지 — 호출측 폴백 판정(ROLLUP 미지원 등)용
      return r.json().catch(function () { throw new Error('조회 실패 HTTP ' + r.status); });
    }).then(function (j) {
      if (!j.success) throw new Error(j.reason || 'query failed');
      return (j.data && j.data.rows) || [];
    });
  }

  function tql(script) {
    return request('/db/tql', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: script })
      .then(function (r) {
        return r.text().then(function (text) {
          if (!r.ok) throw new Error('TQL 실패 HTTP ' + r.status + ': ' + text.slice(0, 160));
          return text;
        });
      });
  }

  /* ---------------- 카탈로그 ---------------- */
  // { 테이블: [태그컬럼, 시간컬럼, 값컬럼] } — 표준 컬럼 구성 판정용
  function tagSchemas() {
    return q(SQL.tagSchemas()).then(function (rows) {
      var out = {};
      rows.forEach(function (r) { var t = r[0]; (out[t] = out[t] || []).push(r[1]); });
      return out;
    });
  }
  /* 소유자도 기억 — 접두 없는 이름은 접속 계정 스키마에서 찾아
     GRANT 받은 표도 "없는 테이블"이 됨 */
  function listTagTables() {
    return q(SQL.catalogTables()).then(function (rows) {
      var owners = {}, names = [];
      rows.forEach(function (r) {
        var t = String(r[1]);
        if (t.charAt(0) === '_') return;   // '_' 접두 내부 표 제외
        // 기본 DB(MACHBASEDB)는 DB 이름 생략
        var db = r[2] == null ? '' : String(r[2]);
        if (SQL.isAppOwned(t, db, APP_DB)) return;   // 앱 저장소 — 분석 대상 아님
        owners[t] = { user: String(r[0]), db: (db && db !== 'MACHBASEDB') ? db : '' };
        names.push(t);
      });
      SQL.setOwners(owners);
      return names;
    });
  }

  function listTags(table, cap) {
    return q(SQL.tagList(table))
      .then(function (rows) { return rows.map(function (r) { return r[0]; }).slice(0, cap || 20); });
  }

  function tagStats(table) {
    return q(SQL.tagStats(table)).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { m[r[0]] = { count: r[1], minMs: r[2], maxMs: r[3] }; });
      return m;
    });
  }

  /* ---------------- 시계열 조회 ----------------
     rollup 미지원 테이블(ERR-2264)은 DATE_TRUNC 원본 집계로 폴백, 테이블별 기억 */
  var _noRollup = {};
  function isRollupErr(e) { return /ROLLUP/i.test((e && e.message) || ''); }
  // ROLLUP 미지원으로 기억된 테이블 여부
  function isNoRollup(table) { return !!_noRollup[table]; }
  /* 롤업 유무 사전 확인 — 없는 태그로 조회해 스캔 없이 판정(롤업 없으면 ERR-2264 즉시 반환)
     true=있음 / false=없음 / null=판정 불가(다른 오류). 결과는 테이블별 기억 */
  var _rollKnown = {};
  function probeRollup(table) {
    if (table in _rollKnown) return Promise.resolve(_rollKnown[table]);
    return q(SQL.rollupTrend(table, '__rollup_probe__', 'sec', 0, 0, false))
      .then(function () { return true; }, function (e) { return isRollupErr(e) ? false : null; })
      .then(function (ok) {
        if (ok === null) return null;
        _rollKnown[table] = ok;
        if (!ok) _noRollup[table] = true;
        return ok;
      });
  }

  // DATE_TRUNC 폴백은 원본 전체 스캔 → 폴백 시 opts.truncCapMs(기본 2시간)로 구간 캡
  function rollupTrend(table, tag, unit, fromMs, toMs, opts) {
    opts = opts || {};
    function run(useTrunc) {
      var f = fromMs;
      if (useTrunc) f = Math.max(fromMs, toMs - (opts.truncCapMs || 2 * 3600e3));
      return q(SQL.rollupTrend(table, tag, unit, f, toMs, useTrunc))
        .then(function (rows) { return rows.map(VC.toBucket).filter(Boolean); });
    }
    if (_noRollup[table]) return run(true);
    return run(false).catch(function (e) {
      if (!isRollupErr(e)) throw e;
      _noRollup[table] = true;
      return run(true);
    });
  }

  function rollupBatch(table, tags, unit, fromMs, toMs, opts) {
    opts = opts || {};
    function parse(rows) {
      var out = {};
      rows.forEach(function (r) {
        var b = VC.toBucket(r.slice(1));
        if (b) (out[r[0]] = out[r[0]] || []).push(b);
      });
      return out;
    }
    // rollupTrend와 같은 규약 — 폴백 시 truncCapMs로 구간 캡
    function run(useTrunc) {
      var f = fromMs;
      if (useTrunc && opts.truncCapMs) f = Math.max(fromMs, toMs - opts.truncCapMs);
      return q(SQL.rollupBatch(table, tags, unit, f, toMs, useTrunc)).then(parse);
    }
    if (_noRollup[table]) return run(true);
    return run(false).catch(function (e) {
      if (!isRollupErr(e)) throw e;
      _noRollup[table] = true;
      return run(true);
    });
  }

  /* 원시 파형 구간 — maxPts=0이면 전체 해상도(스펙트럼용), 지정 시 다운샘플(표시용).
     대량 행이라 JSON 대신 CSV */
  function rawWindow(table, tag, fromMs, toMs, maxPts) {
    var sql = SQL.rawWindow(table, tag, fromMs, toMs);
    var url = '/db/query?q=' + encodeURIComponent(sql) + '&format=csv&timeformat=ms&heading=false';
    return request(url).then(function (r) {
      if (!r.ok) throw new Error('조회 실패 HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      // JSON 에러 본문(구문 오류 등)이면 사유를 그대로 던짐
      if (txt.charAt(0) === '{') { var j = JSON.parse(txt); throw new Error(j.reason || 'query failed'); }
      var lines = txt.split('\n');
      var n = lines.length;
      while (n > 0 && !lines[n - 1]) n--;              // 끝 빈 줄 제거
      var stride = 1;
      if (maxPts && n > maxPts) stride = Math.ceil(n / maxPts);
      var times_ms = [], values = [], t0 = 0, first = true;
      for (var i = 0; i < n; i += stride) {
        var l = lines[i];
        if (!l) continue;
        var c = l.indexOf(',');
        if (c < 0) continue;
        var t = +l.slice(0, c);
        if (first) { t0 = t; first = false; }
        times_ms.push(t - t0);
        values.push(+l.slice(c + 1));
      }
      return { times_ms: times_ms, values: values, n: n };
    });
  }

  /* 앵커(toMs) 이하로 표본이 있는 마지막 '초'의 시작 ms, 없으면 null.
     폴백 규약은 rollupTrend와 같음 — DATE_TRUNC 경로는 구간 캡(기본 1시간, 더 긴 공백은 null) */
  function lastSampleMs(table, tag, fromMs, toMs, opts) {
    opts = opts || {};
    function run(useTrunc) {
      var f = fromMs;
      if (useTrunc) f = Math.max(fromMs, toMs - (opts.truncCapMs || 3600e3));
      if (f > toMs) return Promise.resolve(null);
      return q(SQL.lastSampleAt(table, tag, f, toMs, useTrunc)).then(function (rows) {
        if (!rows.length) return null;
        var ms = +rows[0][0];
        return (isFinite(ms) && +rows[0][1] > 0) ? ms : null;
      });
    }
    if (_noRollup[table]) return run(true);
    return run(false).catch(function (e) {
      if (!isRollupErr(e)) throw e;
      _noRollup[table] = true;
      return run(true);
    });
  }

  /* 샘플레이트 추정용 표본 시각(μs 정수 배열) — ms는 고주파 간격이 0으로 뭉개지고 ns는 JS 안전 정수 초과.
     실패 시 빈 배열 */
  function sampleTimes(table, tag, fromMs, toMs, limit) {
    var sql = SQL.sampleTimes(table, tag, fromMs, toMs, limit);
    var url = '/db/query?q=' + encodeURIComponent(sql) + '&format=csv&timeformat=us&heading=false';
    return request(url).then(function (r) {
      if (!r.ok) throw new Error('조회 실패 HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      if (txt.charAt(0) === '{') return [];
      var out = [];
      txt.split('\n').forEach(function (l) {
        if (!l) return;
        var v = +l;
        if (isFinite(v) && v > 0) out.push(v);
      });
      return out;
    }).catch(function () { return []; });
  }

  // 서버측 FFT (Neo TQL 내장 FFT)
  function fftSpectrum(table, tag, fromMs, toMs, minHz, maxHz) {
    return tql(SQL.fftTql(table, tag, fromMs, toMs, minHz, maxHz)).then(function (csv) {
      var freqs = [], mags = [];
      csv.split('\n').forEach(function (line) {
        var c = line.split(',');
        if (c.length < 2) return;
        var f = parseFloat(c[0]), m = parseFloat(c[1]);
        if (isFinite(f) && isFinite(m)) { freqs.push(f); mags.push(m); }
      });
      return { freqs: freqs, mags: mags, res: freqs.length > 1 ? freqs[1] - freqs[0] : 1 };
    });
  }

  /* ---------------- 설정 영속화 ----------------
     · 전용 DB NEO_BEARING_STORE.<계정>.CONFIG 표에 영역별 조각 KV(cfg:<영역>#N)로 저장
     · 옛 cgi-bin/config/*.json 파일은 migrateConfigToDb의 1회 이관 원본으로 읽기만 함 */

  // 영역(옛 파일 이름) → state 키 목록. 영역 이름(.json 뗀 것)이 조각 키 cfg:<영역>#N의 <영역>
  var CONFIG_FILES = {
    'source.json': ['srcSel', 'displayTz'], // 접속 토큰은 설정이 아닌 브라우저 토큰 칸에 둠
    'equipment.json': ['equipCls', 'equipRpm', 'equipBearing', 'equipGeo', 'equipUnit', 'equipMeta', 'lineHz', 'aliases', 'cardOrder', 'knownTags', 'revived'],
    'criteria.json': ['machineClass', 'classThresh', 'unitThresh'],
    'monitor.json': ['monitorOn', 'evalWindow', 'notifCh', 'notifTo', 'notifLang', 'routes', 'monitorInterval', 'monMode', 'renotify', 'bandOn', 'bandInterval', 'bandWin'],
    'llm.json': ['llmProvider', 'llmKeys', 'llmModels', 'ollamaUrl', 'genLLM'],
  };
  // 현재 계정 — whoami()로 서버 확인된 값만 받고 형식 재검사(표 이름·키 접두·경로에 쓰임)
  var _user = '';
  var APP_DB = 'NEO_BEARING_STORE';
  // 공용 표 스키마 — 여기선 판정용(이름 조립은 sql.js)
  var SHARED_OWNER = SQL.SHARED_OWNER;
  function setUser(u) {
    var n = String(u || '').toUpperCase();
    if (n && !/^[A-Z][A-Z0-9_]*$/.test(n)) throw new Error('계정명 형식이 올바르지 않습니다: ' + u);
    _user = n;
    SQL.setScope(n ? APP_DB : '', n);   // sql.js 이름 조립 범위도 함께 전환
  }
  function appDb() { return APP_DB; }
  // 전용 DB 사용 가능 여부 — 불가하면 앱이 준비 SQL을 안내
  function checkAppDb() {
    return q(SQL.dbUsable(APP_DB)).then(function (rows) {
      return !!(rows.length && Number(rows[0][1]) === 1);
    }).catch(function () { return false; });
  }
  // 전용 DB 생성 — DB 생성·권한 부여는 SYS만 가능(그 외 ERR-2829), 거부 사유는 그대로 올림
  function createAppDb() {
    return q('CREATE DATABASE ' + APP_DB).then(function () { return true; });
  }
  // 권한 부여 대상 계정 목록(SYS 화면 전용)
  function listUsers() {
    return q(SQL.userList()).then(function (rows) {
      return rows.map(function (r) { return String(r[0]); }).filter(function (u) { return u !== SHARED_OWNER; });
    });
  }
  /* 권한 구문 일괄 실행 — 개별 실패는 사유만 수집(재실행 무해), 전부 실패면 throw */
  function runGrantList(list) {
    if (!list.length) return Promise.reject(new Error('계정명이 올바르지 않습니다'));
    var errs = [];
    return list.reduce(function (p2, sql) {
      return p2.then(function () {
        return q(sql).catch(function (e) { errs.push((e && e.message) || String(e)); });
      });
    }, Promise.resolve()).then(function () {
      if (errs.length === list.length) throw new Error(errs[0]);
      return { total: list.length, failed: errs.length, reasons: errs };
    });
  }
  // 한 계정에 필요한 권한 일괄 부여 — DB 단위 DML 권한 구문·ROLE이 없어 표마다 한 문장
  function grantTo(user) { return runGrantList(SQL.grantStatements(user)); }
  // 한 계정 권한 일괄 회수 — 부여의 역순, 데이터(설정·이벤트·학습값)는 그대로
  function revokeFrom(user) { return runGrantList(SQL.revokeStatements(user)); }
  /* 계정별 권한 상태(SYS 화면 전용) — 타이머 목록을 못 읽어도 권한 상태는 표시 */
  function accessStatus() {
    return Promise.all([
      q(SQL.storeAccess()),
      q(SQL.pkgTimers()).catch(function () { return null; }),
    ]).then(function (r) {
      var m = SQL.accessSummary(r[0], r[1] || []);
      if (!r[1]) Object.keys(m).forEach(function (u) { m[u].timers = null; });
      return m;
    });
  }

  // 관리자 = 공용 표 소유자(공용 표 생성·권한 부여 가능)
  function isAdmin() { return getUser() === SHARED_OWNER; }
  function setupSql() {
    var d = APP_DB, sh = d + '.' + SHARED_OWNER + '.';
    return {
      db: d,
      create: 'CREATE DATABASE ' + d + ';',
      /* CONNECT·CREATE는 DB 단위(CREATE = 자기 CONFIG 표 생성용).
         공용 4표는 표마다 DML 권한 필요(행 단위 권한 없음) */
      grant: ['GRANT CONNECT ON DATABASE ' + d + ' TO <계정>;',
        'GRANT CREATE  ON DATABASE ' + d + ' TO <계정>;',
        'GRANT SELECT, INSERT, DELETE ON ' + sh + 'EVENTS TO <계정>;',
        'GRANT SELECT, INSERT, DELETE ON ' + sh + 'BAND TO <계정>;',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ' + sh + 'BASELINE TO <계정>;',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ' + sh + 'MONSTATE TO <계정>;'].join('\n'),
      // 회수 — 부여의 역순, 데이터는 그대로
      revoke: ['REVOKE SELECT, INSERT, UPDATE, DELETE ON ' + sh + 'MONSTATE FROM <계정>;',
        'REVOKE SELECT, INSERT, UPDATE, DELETE ON ' + sh + 'BASELINE FROM <계정>;',
        'REVOKE SELECT, INSERT, DELETE ON ' + sh + 'BAND FROM <계정>;',
        'REVOKE SELECT, INSERT, DELETE ON ' + sh + 'EVENTS FROM <계정>;',
        'REVOKE CREATE  ON DATABASE ' + d + ' FROM <계정>;',
        'REVOKE CONNECT ON DATABASE ' + d + ' FROM <계정>;'].join('\n'),
      // 확인 — TABLE_NAME 비어 있는 행 = DB 범위 권한
      check: "SELECT USER_NAME, TABLE_NAME FROM M$SYS_USER_ACCESS WHERE DB_NAME = '" + d + "' ORDER BY USER_NAME, TABLE_NAME;",
    };
  }



  function getUser() { return _user; }
  // 서버 TQL용 두 접두 — 표 위치(공용 스키마)·행 키(계정). 조립은 sql.js에서만
  function storePrefix() { return SQL.sharedScope(); }
  /* 짧은 이름 → db.user.table 대응표 — 비-SYS 타이머는 접두 없는 이름이
     자기 스키마에서 조용히 0건 */
  function srcMapOf(tables) {
    var m = {};
    (tables || []).forEach(function (t) { m[t] = SQL.dataTable(t); });
    return m;
  }
  function userKeyPrefix() { return SQL.userPrefix(); }
  /* 계정 설정 표 전체 이름 — 서버 감시가 발송 회차에 알림 설정(웹훅 URL)을 여기서 읽음.
     파일 API는 계정 격리가 없어 URL을 스크립트 파일에 싣지 않음 */
  function configTable() { return SQL.appTable('CONFIG'); }
  // 옛 설정 파일 루트·계정 폴더 — migrateConfigToDb 이관 원본
  function configRoot() { return pkgBase() + '/cgi-bin/config'; }
  function configDir() {
    if (!_user) throw new Error('계정이 확인되지 않았습니다');
    return configRoot() + '/' + _user;
  }

  // 앱이 서빙되는 패키지 경로(/public/<폴더>) — 폴더명이 바뀌어도 동작
  function pkgBase() {
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
      var m = /^(\/public\/[^/]+)\//.exec(window.location.pathname);
      if (m) return m[1];
    }
    return '/public/neo-pkg-bearing-analytics'; // node 스모크·폴백용 — 실제 설치 폴더명과 같아야 타이머 TQL 경로가 맞음
  }

  /* 파일 API — ⚠ 계정 격리 없음(남의 폴더·워크스페이스 루트가 보임).
     계정별 경로는 덮어쓰기 방지용일 뿐 권한 경계 아님 → 설정·시크릿은 계정 소유 표에 둠 */
  function authedFetch(path, opts) {
    opts = opts || {};
    return Promise.resolve(request('/db/files' + path, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      cache: opts.cache,
    }));
  }

  /* ---- 설정 저장소 (전용 DB, 계정 스키마) ----
     · 표 소유자가 본인이라 남은 조회 불가(API 키·웹훅 URL 보관)
     · 영역(=옛 파일) 단위 JSON을 조각내 저장 — 한 행(VAL 4000자)을 넘으면 잘린 채 저장돼 영역 전체가 조용히 소실 */
  // 인코딩 값은 전부 ASCII(%XX)라 VAL 한도를 문자 수로 적용. INSERT는 단일 행이라 조각 수 = 왕복 수
  var CFG_CHUNK = 3800;
  function cfgKey(domain, i) { return 'cfg:' + domain.replace(/\.json$/, '') + '#' + i; }
  // 조각 경계에서 퍼센트 시퀀스(%XX)를 쪼개지 않음
  function chunkEnc(enc, size) {
    var out = [], i = 0;
    while (i < enc.length) {
      var n = Math.min(size, enc.length - i);
      if (n === size) {
        if (enc.charAt(i + n - 1) === '%') n -= 1;
        else if (enc.charAt(i + n - 2) === '%') n -= 2;
      }
      out.push(enc.slice(i, i + n));
      i += n;
    }
    return out;
  }

  /* 설정 읽기 — 실패를 "없음"으로 삼키지 않음(기본값 화면의 저장이 실제 설정을 덮음)
       · 설정 객체 — 읽음
       · null      — 저장한 적 없음(설정 행 0개)
       · 거부      — err.kind 'query'(조회 실패, 재시도 가능) | 'broken'(조각 손상, err.domains)
     opts.allowBroken: 손상 영역만 빼고 반환 */
  function loadConfig(opts) {
    opts = opts || {};
    return q(SQL.kvSelect('CONFIG')).catch(function (e) {
      var err = new Error('설정 조회 실패 — ' + ((e && e.message) || e));
      err.kind = 'query';
      throw err;
    }).then(function (rows) {
      var parts = {};
      rows.forEach(function (r) {
        var m = /^cfg:(.+)#(\d+)$/.exec(String(r[0]));
        if (!m) return;
        (parts[m[1]] = parts[m[1]] || [])[+m[2]] = String(r[1] || '');
      });
      var cfg = {}, any = false, broken = [];
      Object.keys(parts).forEach(function (d) {
        var ps = parts[d], i;
        for (i = 0; i < ps.length; i++) if (ps[i] == null) { broken.push(d); return; }   // 조각 누락
        try {
          var o = JSON.parse(decodeURIComponent(ps.join('')));
          if (o && typeof o === 'object') { Object.assign(cfg, o); any = true; } else broken.push(d);
        } catch (e) { broken.push(d); }
      });
      if (broken.length && !opts.allowBroken) {
        var err = new Error('설정 일부가 손상됐습니다 — ' + broken.join(', '));
        err.kind = 'broken';
        err.domains = broken;
        throw err;
      }
      if (!any && !broken.length) return null;
      return cfg;
    });
  }

  // 영역 하나를 조각으로 저장 + 남는 옛 조각 삭제(안 지우면 다음 읽기에 덧붙음)
  function writeDomain(domain, obj) {
    var chunks = chunkEnc(encVal(obj), CFG_CHUNK);   // encVal = URI 인코딩 + 따옴표 치환(SQL 안전)
    if (!chunks.length) chunks.push(encVal({}));
    return chunks.reduce(function (p, c, i) {
      return p.then(function () { return kvUpsert('CONFIG', cfgKey(domain, i), null, c); });
    }, Promise.resolve()).then(function () {
      return q(SQL.kvSelect('CONFIG')).then(function (rows) {
        var stale = rows.map(function (r) { return String(r[0]); }).filter(function (k) {
          var m = /^cfg:(.+)#(\d+)$/.exec(k);
          return m && m[1] === domain.replace(/\.json$/, '') && +m[2] >= chunks.length;
        });
        return stale.reduce(function (p, k) {
          return p.then(function () { return q(SQL.kvDelete('CONFIG', k)); });
        }, Promise.resolve());
      });
    });
  }

  function saveConfig(cfg) {
    return Object.keys(CONFIG_FILES).reduce(function (p, n) {
      var part = {};
      CONFIG_FILES[n].forEach(function (k) { if (cfg[k] !== undefined) part[k] = cfg[k]; });
      return p.then(function () { return writeDomain(n, part); });
    }, Promise.resolve()).then(function () { return true; });
  }

  // 일부 키만 저장 — 해당 영역만 다시 쓰고 나머지 값은 저장본 유지(state의 미저장 편집이 섞이지 않게)
  function saveConfigPartial(cfg, keys) {
    var names = Object.keys(CONFIG_FILES).filter(function (n) {
      return CONFIG_FILES[n].some(function (k) { return keys.indexOf(k) >= 0; });
    });
    // 읽기 실패 시 쓰지 않음(빈 설정 기준으로 쓰면 영역의 다른 값 소실). 손상 영역은 허용
    return loadConfig({ allowBroken: true }).then(function (cur) {
      cur = cur || {};
      return names.reduce(function (p, n) {
        var part = {};
        CONFIG_FILES[n].forEach(function (k) { if (cur[k] !== undefined) part[k] = cur[k]; });
        keys.forEach(function (k) {
          if (CONFIG_FILES[n].indexOf(k) >= 0 && cfg[k] !== undefined) part[k] = cfg[k];
        });
        return p.then(function () { return writeDomain(n, part); });
      }, Promise.resolve());
    }).then(function () { return true; });
  }

  // 옛 설정 파일 → DB 1회 이관. 옛 파일은 지우지 않음(롤백 경로), DB에 설정이 있으면 건너뜀
  function migrateConfigToDb() {
    // DB가 비어 있음이 확인될 때만 이관 — 조회 실패·손상이면 건너뜀
    return loadConfig().catch(function () { return 'unreadable'; }).then(function (inDb) {
      if (inDb === 'unreadable') return 'skipped';
      if (inDb) return 'already';
      var names = Object.keys(CONFIG_FILES);
      return Promise.all(names.map(function (n) {
        return authedFetch(configDir() + '/' + n, { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
          .then(function (o) {
            if (o) return { n: n, o: o };
            // 계정 폴더에 없으면 옛 공용 파일 — SYS만(남의 시크릿 상속 방지)
            if (getUser() !== 'SYS') return null;
            return authedFetch(configRoot() + '/' + n, { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
              .then(function (o2) { return o2 ? { n: n, o: o2 } : null; });
          });
      })).then(function (got) {
        var found = got.filter(Boolean);
        if (!found.length) return 'none';
        return found.reduce(function (p, g) {
          return p.then(function () { return writeDomain(g.n, g.o); });
        }, Promise.resolve()).then(function () { return 'copied:' + found.length; });
      });
    });
  }

  /* ---------------- 파일 유틸 (리포트 저장/목록/미리보기 — 워크스페이스 루트 기준 경로) ---------------- */
  /* 파일 API: 경로 끝 '/' POST = 디렉터리 생성. 제약:
      · mkdir 비재귀 — 상위 폴더 없으면 실패(파일 쓰기도 부모 미생성)
      · 이미 있는 경로에 POST하면 500
     → 한 단계씩 "있으면 두고 없으면 생성". 약속을 캐시(생성 완료 전 resolve 방지), 실패 경로는 캐시에서 제거 */
  var _dirTried = {}, _dirOk = {};
  function ensureDir(path) {
    var full = path.replace(/\/?$/, '/');
    if (_dirTried[full]) return _dirTried[full];
    var segs = full.split('/').filter(Boolean);
    var pr = segs.reduce(function (chain, seg, i) {
      var sub = '/' + segs.slice(0, i + 1).join('/') + '/';
      return chain.then(function () {
        if (_dirOk[sub]) return true;
        return authedFetch(sub).then(function (r) {
          if (r.ok) { _dirOk[sub] = 1; return true; }
          return authedFetch(sub, { method: 'POST' }).then(function (r2) {
            if (!r2.ok) throw new Error('디렉터리 생성 실패 HTTP ' + r2.status + ' — ' + sub);
            _dirOk[sub] = 1;
            return true;
          });
        });
      });
    }, Promise.resolve());
    _dirTried[full] = pr.catch(function (e) { delete _dirTried[full]; throw e; });
    return _dirTried[full];
  }
  function saveFile(path, content, contentType) {
    return authedFetch(path, { method: 'POST', headers: { 'Content-Type': contentType || 'text/html' }, body: content })
      .then(function (r) {
        return r.json().catch(function () { return { success: r.ok }; }).then(function (j) {
          if (!r.ok || j.success === false) throw new Error('파일 저장 실패: ' + (j.reason || 'HTTP ' + r.status));
          return true;
        });
      });
  }
  function listDir(path) {
    return authedFetch(path).then(function (r) {
      if (!r.ok) throw new Error('목록 조회 실패 HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j.success === false) throw new Error(j.reason || 'listDir failed');
      return (j.data && j.data.children) || [];
    });
  }
  function deleteFile(path) {
    return authedFetch(path, { method: 'DELETE' }).then(function (r) {
      return r.json().catch(function () { return { success: r.ok }; }).then(function (j) {
        if (!r.ok || j.success === false) throw new Error('삭제 실패: ' + (j.reason || 'HTTP ' + r.status));
        return true;
      });
    });
  }
  function readFileBlob(path) {
    return authedFetch(path).then(function (r) {
      if (!r.ok) throw new Error('파일 읽기 실패 HTTP ' + r.status);
      return r.blob();
    });
  }

  /* ---------------- 상시감시 저장소 ----------------
     이벤트(TAG)·판정 상태·베이스라인(LOOKUP) 영속화. KV 값은 URI 인코딩 JSON */
  function encVal(o) { return encodeURIComponent(JSON.stringify(o)).replace(/'/g, '%27'); }
  function decVal(s) { try { return JSON.parse(decodeURIComponent(s)); } catch (e) { return null; } }

  /* 표 마련 — 공용 4표·롤업은 SYS만 생성, CONFIG는 계정마다 자기 스키마에.
     이미 있는 표는 CREATE 생략(부팅마다 500이 쌓여 권한 부족 실패를 가림), 카탈로그를 못 읽으면 전부 시도 */
  function presentTables() {
    return q(SQL.appTablesPresent()).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { m[(String(r[0]) + '.' + String(r[1])).toUpperCase()] = 1; });
      return m;
    }).catch(function () { return null; });
  }
  // DDL에서 <소유자>.<표> 추출 — 이름만으론 계정별 CONFIG 구분 불가
  function ddlTarget(sql) {
    var m = /CREATE\s+\w+\s+TABLE\s+([^\s(]+)/i.exec(sql);
    var parts = m ? m[1].split('.') : [];
    return parts.length >= 2 ? (parts[parts.length - 2] + '.' + parts[parts.length - 1]).toUpperCase() : '';
  }
  function createMissing(stmts, present) {
    var todo = stmts.filter(function (sql) {
      var t = ddlTarget(sql);
      return !present || !t || !present[t];
    });
    return Promise.all(todo.map(function (sql) { return q(sql).catch(function () { }); }));
  }
  function ensureMonTables() {
    var _present = null;
    return presentTables().then(function (m) { _present = m; })
      .then(function () {
        if (!isAdmin()) return null;
        // 옛 LOG 이벤트 표를 CREATE보다 먼저 TAG로 이관(이름 충돌)
        return migrateEventsToTag()
          // CREATE 실패는 삼킴(멱등 취급)
          .then(function () { return createMissing(SQL.sharedCreateTables(), _present); })
          // 대역 추세용 롤업 — 표 생성 뒤 순서대로(시간 롤업의 소스가 분 롤업)
          .then(function () {
            return SQL.bandRollups().reduce(function (p, sql) {
              return p.then(function () {
                return q(sql).catch(function (e) {
                  // 롤업 없어도 원본 집계로 폴백 → 부팅은 계속, 사유만 경고
                  if (typeof console !== 'undefined' && console.warn) console.warn('[vibe] rollup: ' + ((e && e.message) || e));
                });
              });
            }, Promise.resolve());
          })
          .then(widenMonState);
      })
      .then(function () { return createMissing(SQL.configCreateTable(), _present); })
      /* 끝에 실제 조회로 확인 — CREATE 실패를 삼켜 "이미 있음"과 "권한 없음"이 구분 안 됨.
         설정 표·공용 표 둘 다 확인 */
      .then(function () { return q(SQL.kvSelect('CONFIG')); })
      .then(function () { return q(SQL.usageCount('MONSTATE')); });
  }
  /* MONSTATE.VAL 폭이 MONSTATE_VAL_MIN보다 좁은 기존 설치면 표 재생성(CREATE는 이미 있으면 무시돼 폭 불변)
     · 판정 상태는 다음 회차에 다시 쌓이는 값이라 버림 가능(BASELINE은 학습값이라 불가)
     · ⚠ 재생성 시 확정 등급·에피소드를 처음부터 다시 셈
     · 폭을 못 읽으면 아무것도 안 함 */
  var MONSTATE_VAL_MIN = 4000;
  function widenMonState() {
    return q(SQL.colLength('MONSTATE', 'VAL')).then(function (rows) {
      var w = rows.length ? Number(rows[0][0]) : 0;
      if (!(w > 0) || w >= MONSTATE_VAL_MIN) return null;
      var ddl = SQL.sharedCreateTables().filter(function (s) { return s.indexOf('MONSTATE') >= 0; })[0];
      if (!ddl) return null;
      return q(SQL.dropTable('MONSTATE')).then(function () { return q(ddl); });
    }).catch(function () { return null; });   // 메타 조회 실패는 무시 — 다음 부팅에 재확인
  }
  // 이벤트 표 LOG → TAG 이관(1회성, 멱등) — 전부 읽은 뒤에만 DROP. 표가 없거나 이미 TAG면 통과
  var EV_TYPE_LOG = 0;
  function migrateEventsToTag() {
    return q(SQL.tableTypeOf('EVENTS')).then(function (rows) {
      if (!rows.length || Number(rows[0][0]) !== EV_TYPE_LOG) return null;   // 없거나 이미 TAG
      return q(SQL.eventsLegacySelect()).then(function (old) {
        return q(SQL.dropTable('EVENTS'))
          .then(function () { return q(SQL.monCreateTables()[0]); })
          .then(function () {
            // Machbase INSERT는 단일 행 — 한 건씩
            return old.reduce(function (p, r) {
              return p.then(function () {
                return q(SQL.eventInsert({
                  eid: r[0], ts: Number(r[1]), tbl: r[2], tag: r[3], etype: r[4],
                  grade: r[5], val: Number(r[6]), lim: Number(r[7]), detail: r[8] || '',
                })).catch(function () { });   // 한 건 실패해도 계속
              });
            }, Promise.resolve());
          })
          .then(function () { return { migrated: old.length }; });
      });
    }).catch(function () { return null; });   // 이관 실패가 부팅을 막지 않음
  }
  // TAG 행 → 이벤트 객체. NAME('<테이블>:<태그>')을 첫 콜론에서 분리(태그명엔 콜론이 있을 수 있음)
  function evRow(r) {
    var nm = SQL.unkey(r[0] || ''), i = nm.indexOf(':');
    return {
      eid: r[7], ts: Number(r[1]), tbl: i < 0 ? nm : nm.slice(0, i), tag: i < 0 ? '' : nm.slice(i + 1),
      etype: r[3], grade: r[4], val: Number(r[2]), lim: Number(r[5]), detail: r[6] || '',
    };
  }
  function loadEvents(limit) {
    return q(SQL.eventsSelect(limit)).then(function (rows) { return rows.map(evRow); });
  }
  // 행 삭제 뒤 데이터 없는 이름(메타) 정리 — 이름 정리 실패는 무시
  function purgeNames(table) { return q(SQL.metaPurgeOrphans(table)).catch(function () { return null; }); }
  function deleteEventsOfTag(tbl, tag) {
    return q(SQL.eventsDeleteTag(tbl, tag)).then(function (r) { return purgeNames('EVENTS').then(function () { return r; }); });
  }
  /* 내 이름 목록(접두 뗀 키) — TAG 표 DELETE는 NAME 정확일치만 받아 이름 열거 필요
     · 메타 표에서 읽음(행 스캔 없음), 실패 시 원본 집계 */
  function ownKeys(kind) {
    return q(SQL.metaNames(kind === 'band' ? 'BAND' : 'EVENTS'))
      .catch(function () { return q(kind === 'band' ? SQL.bandNameCounts() : SQL.eventNameCounts()); })
      .then(function (rows) { return rows.map(function (r) { return SQL.unkey(r[0]); }); })
      .catch(function () { return []; });
  }
  // 문장 순차 실행, 개별 실패는 건너뜀 — 성공 건수 반환
  function runAll(list) {
    return (list || []).reduce(function (p, sql) {
      return p.then(function (acc) { return q(sql).then(function () { return acc + 1; }).catch(function () { return acc; }); });
    }, Promise.resolve(0));
  }
  function deleteEventsRange(fromMs, toMs) {
    return ownKeys('events')
      .then(function (keys) { return runAll(SQL.eventsDeleteRange(keys, fromMs, toMs)); })
      .then(function (r) { return purgeNames('EVENTS').then(function () { return r; }); });
  }
  function deleteBandRange(fromMs, toMs) {
    return ownKeys('band')
      .then(function (keys) { return runAll(SQL.bandDeleteRange(keys, fromMs, toMs)); })
      .then(function (r) { return purgeNames('BAND').then(function () { return r; }); });
  }
  /* 태그 하나의 대역 데이터 삭제 — 계열 키는 calc 목록(판정 계열 + 저장 전용 + 옛 이름),
     개별 실패는 건너뜀 */
  var BAND_KEYS = VC.BAND_ORDER.concat(VC.BAND_CTX, VC.BAND_LEGACY || []);
  function deleteBandOfTag(tbl, tag) {
    return BAND_KEYS.reduce(function (p, b) {
      return p.then(function () { return q(SQL.bandDeleteKey(tbl + ':' + tag + ':' + b)).catch(function () { }); });
    }, Promise.resolve()).then(function () { return purgeNames('BAND'); });
  }
  /* EVENTS·BAND 이름별 집계 — 기본 V$_STAT(행 스캔 없음)
     · exact(삭제 직후 — V$_STAT 반영 지연)·V$_STAT 실패면 원본 집계 */
  function tagRows(exact, scanSql, statSql) {
    return exact ? q(scanSql) : q(statSql).catch(function () { return q(scanSql); });
  }
  /* 태그별 보유량 { '테이블:태그': { band, events } } — BAND는 앞 두 마디로 묶음.
     한쪽 조회가 실패해도 나머지 반환 */
  function tagUsage(exact) {
    var acc = {};
    var add = function (kind) {
      return function (rows) {
        rows.forEach(function (r) {
          var key = SQL.unkey(r[0]).split(':').slice(0, 2).join(':');
          if (!key) return;
          acc[key] = acc[key] || { band: 0, events: 0 };
          acc[key][kind] += Number(r[1]) || 0;
        });
      };
    };
    return Promise.all([
      tagRows(exact, SQL.bandNameCounts(), SQL.statNameCounts('BAND')).then(add('band')).catch(function () { return null; }),
      tagRows(exact, SQL.eventNameCounts(), SQL.statNameCounts('EVENTS')).then(add('events')).catch(function () { return null; }),
    ]).then(function () { return acc; });
  }
  // 판정 상태 삭제 — LOOKUP이라 키 단위
  function deleteMonState(key) { return q(SQL.kvDelete('MONSTATE', key)); }
  /* 데이터 관리 현황(설정 화면) — 개별 조회 실패는 null, 나머지는 유지
     · EVENTS·BAND는 기본 V$_STAT 한 줄, exact(삭제 직후)·V$_STAT 실패면 원본 집계 */
  function usageStats(exact) {
    var one = function (sql, pick) {
      return q(sql).then(function (rows) { return rows.length ? pick(rows[0]) : null; }).catch(function () { return null; });
    };
    var num = function (r) { return Number(r[0]); };
    // TIME은 timeformat=ms라 밀리초 숫자(Date.parse 금지 — NaN)
    var span = function (r) { return { from: Number(r[0]), to: Number(r[1]) }; };
    var scan = function (table) {
      var band = table === 'BAND';
      return Promise.all([
        one(SQL.usageCount(table), num),
        one(band ? SQL.bandSpan() : SQL.eventsSpan(), span),
        band ? one(SQL.bandKeyCount(), num) : null,
      ]).then(function (r) { return { rows: r[0], span: r[1], keys: r[2] }; });
    };
    var tagTable = function (table) {
      if (exact) return scan(table);
      return q(SQL.statSummary(table)).then(function (rows) {
        var r = rows[0] || [];
        return { rows: Number(r[1]) || 0, span: span([r[2], r[3]]), keys: Number(r[0]) || 0 };
      }, function () { return scan(table); });
    };
    return Promise.all([
      tagTable('EVENTS'),
      tagTable('BAND'),
      one(SQL.usageCount('MONSTATE'), num),
      one(SQL.usageCount('BASELINE'), num),
    ]).then(function (r) {
      return {
        events: { rows: r[0].rows, span: r[0].span },
        band: r[1],
        monstate: { rows: r[2] },
        baseline: { rows: r[3] },
      };
    });
  }
  // 삭제 전 확인용 구간 건수
  function countRange(kind, fromMs, toMs) {
    var sql = kind === 'band' ? SQL.bandCountRange(fromMs, toMs) : SQL.eventsCountRange(fromMs, toMs);
    return q(sql).then(function (rows) { return rows.length ? Number(rows[0][0]) : 0; });
  }
  function kvUpsert(table, key, obj, raw) {
    var val = raw != null ? String(raw) : encVal(obj);
    return q(SQL.kvExists(table, key)).then(function (rows) {
      var n = rows.length ? Number(rows[0][0]) : 0;
      return q(n > 0 ? SQL.kvUpdate(table, key, val) : SQL.kvInsert(table, key, val));
    });
  }
  function loadBaselines() {
    return q(SQL.kvSelect('BASELINE')).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { var v = decVal(r[1]); if (v) m[SQL.unkey(r[0])] = v; });
      return m;
    });
  }
  function saveBaseline(key, obj) { return kvUpsert('BASELINE', key, obj); }
  function deleteBaseline(key) { return q(SQL.kvDelete('BASELINE', key)); }
  function insertEvent(e) { return q(SQL.eventInsert(e)); }
  function insertBandPoint(key, ms, v) { return q(SQL.bandInsert(key, ms, v)); }
  function loadMonState() {
    return q(SQL.kvSelect('MONSTATE')).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { var v = decVal(r[1]); if (v) m[SQL.unkey(r[0])] = v; });
      return m;
    });
  }
  function saveMonState(key, obj) { return kvUpsert('MONSTATE', key, obj); }
  // 기간·필터 내 총 건수(목록은 최근 N건 캡) — f: SQL.eventsRange와 같은 필터
  function countEvents(fromMs, toMs, f) {
    return q(SQL.eventsCount(fromMs, toMs, f))
      .then(function (rows) { return rows.length ? Number(rows[0][0]) : 0; });
  }
  // 기간 이벤트 조회 — f 없으면 내 이벤트 전체(내보내기), 있으면 유형·태그 필터
  function loadEventsRange(fromMs, toMs, limit, f) {
    return q(SQL.eventsRange(fromMs, toMs, limit, f)).then(function (rows) { return rows.map(evRow); });
  }

  // 타이머 이름·TQL 경로는 계정별(공유하면 서로 덮어씀). 계정 미확정이면 옛 이름(기존 설치 정리용)
  function timerName(base) { return _user ? base + '_' + _user : base; }
  function userTqlPath(name) {
    return pkgBase() + '/cgi-bin/' + (_user ? 'tql/' + _user + '/' : '') + name + '.tql';
  }

  /* ---------------- 서버 상시감시 타이머 (Neo JSON-RPC) ----------------
     · 앱이 판정 TQL을 패키지 파일로 저장, Neo 타이머가 주기 실행(앱 없이도 감시)
     · 타이머 command 경로 = 파일 API 경로(pkgBase/cgi-bin/tql/<계정>/<이름>.tql)
     · 타이머는 등록한 토큰 계정 권한으로 실행, 남의 타이머는 id를 알아도 not found */
  var MON_TIMER = 'NEO_BEARING_MONITOR';
  function monTimer() { return timerName(MON_TIMER); }
  function monTqlPath() { return userTqlPath('monitor'); }
  /* Neo 타이머 API = JSON-RPC 2.0(POST /db/rpc).
     ⚠ params는 배열(객체면 Parse error) · 필드명 spec(스케줄)·command(경로) · stop/delete는 이름이 아닌 id(int) */
  var _rpcId = 0;
  function rpc(method, params) {
    return request('/db/rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++_rpcId, method: method, params: params || [] }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.error) throw new Error(method + ': ' + (j.error.message || ('code ' + j.error.code)));
      return j ? j.result : null;
    });
  }

  /* 타이머 상태 { 이름: { state, schedule, task, id, ids } } — state는 'RUNNING' 또는 'STOP, <사유>'.
     조회 실패는 null(빈 목록과 구분). 목록은 계정별로 걸러짐(남의 타이머 안 보임) */
  function timerStates() {
    return rpc('timer.list', []).then(function (list) {
      if (!list) return null;
      // Neo는 같은 이름 타이머 중복 허용 — id는 첫 항목, 전체는 ids(전부 지우기용)
      var m = {};
      list.forEach(function (t) {
        if (!t || !t.name) return;
        var e = m[t.name];
        if (!e) { m[t.name] = { state: t.state || '', schedule: t.schedule || '', task: t.task || '', id: t.id, ids: [t.id] }; return; }
        e.ids.push(t.id);
      });
      return m;
    }).catch(function () { return null; });
  }

  /* 같은 이름 타이머 전부 stop → delete(삭제만으론 실행 중 회차가 멎는다는 보장 없음).
     반환 = 이 이름으로 남은 것이 없는지(삭제 후 목록 재확인). 목록 조회 실패만 true */
  function deleteTimer(name) {
    return timerStates().then(function (m) {
      if (!m) return true;                 // 목록 조회 실패 — 판단 불가, 등록 진행
      var t = m[name];
      if (!t) return true;
      var ids = (t.ids || []).filter(function (x) { return x != null; });
      // id가 없으면 이름으로 시도
      var keys = ids.length ? ids : [name];
      return keys.reduce(function (p, k) {
        return p.then(function () {
          return rpc('timer.stop', [k]).catch(function () { })
            .then(function () { return rpc('timer.delete', [k]); })
            .catch(function () { return null; });
        });
      }, Promise.resolve())
        // 실제로 사라졌는지 재확인(못 지운 채 재생성하면 중복 증식)
        .then(function () { return timerStates(); })
        .then(function (m2) { return !m2 || !m2[name]; });
    });
  }

  // TQL 계정 폴더 — 파일 API는 상위 폴더를 만들지 않아 쓰기 직전에 보장
  function ensureTqlDir() {
    if (!_user) return Promise.resolve();
    var base = pkgBase() + '/cgi-bin/tql';
    return ensureDir(base).then(function () { return ensureDir(base + '/' + _user); });
  }
  /* 타이머 등록 — TQL 파일 저장 → 같은 이름 전부 삭제 → 생성(autoStart라 등록이 곧 실행).
     실행 중 타이머는 수정 불가(500) → 삭제 후 재생성 */
  function putTimer(name, path, tqlSource, schedule) {
    return ensureTqlDir()
      .then(function () { return saveFile(path, tqlSource, 'text/plain'); })
      // 호출측 '없음 확인'과 무관하게 항상 삭제 — Neo는 이름 중복을 막지 않음
      .then(function () { return deleteTimer(name); })
      .then(function (gone) {
        // 못 지웠으면 생성 중단(중복 방지), 사유를 올림
        if (!gone) throw new Error(name + ' — 기존 타이머를 지우지 못해 등록을 중단했습니다(중복 방지). Neo 타이머 목록에서 직접 지운 뒤 다시 시도하세요');
        return rpc('timer.add', [{ name: name, spec: schedule, command: path, autoStart: true }]);
      })
      .then(function () { return true; });
  }
  function deleteMonitorTimer() { return deleteTimer(monTimer()); }
  // 감시자(WD) 타이머 이름 — 옛 설치에 남은 타이머 삭제용
  var WD_TIMER = 'NEO_BEARING_WD';
  function wdTimer() { return timerName(WD_TIMER); }
  function deleteWdTimer() { return deleteTimer(wdTimer()); }
  // 대역 추출 타이머 — 판정 타이머와 이름·파일·주기 분리(한쪽 실패가 다른 쪽을 멈추지 않게)
  var BAND_TIMER = 'NEO_BEARING_BAND';
  function bandTimer() { return timerName(BAND_TIMER); }
  function bandTqlPath() { return userTqlPath('band'); }
  function deleteBandTimer() { return deleteTimer(bandTimer()); }
  function createBandTimer(tqlSource, schedule) {
    return putTimer(bandTimer(), bandTqlPath(), tqlSource, schedule);
  }
  /* 백필 한 청크 즉시 실행(타이머 없이 앵커 몇 개 계산·저장) — 청크 분할은 호출측 몫(한 요청이면 타임아웃).
     응답 CSV "done,<now>,<성공 앵커 수>"에서 성공 앵커 수 반환 */
  function bandBackfill(tqlSource) {
    return tql(tqlSource).then(function (text) {
      var m = /done,\d+,(\d+)/.exec(text || '');
      return m ? +m[1] : 0;
    });
  }
  // 시리즈별 보유 시각 목록 — 채움 현황 계산·중복 방지용
  function bandTimes(keys, fromMs, toMs) {
    if (!keys || !keys.length) return Promise.resolve({});
    return q(SQL.bandTimes(keys, fromMs, toMs)).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { (m[r[0]] = m[r[0]] || []).push(r[1]); });
      return m;
    });
  }
  // 계열 여러 개의 최신값 { 계열이름: 값 }
  function bandLatest(keys, fromMs, toMs) {
    if (!keys || !keys.length) return Promise.resolve({});
    return q(SQL.bandLatest(keys, fromMs, toMs)).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { m[String(r[0])] = r[1]; });   // 시각 오름차순 → 마지막이 최신
      return m;
    });
  }
  // 대역 추세/원본 조회 — NAME은 "<테이블>:<태그>:<대역>"
  function bandTrend(key, unit, fromMs, toMs) {
    return q(SQL.bandTrend(key, unit, fromMs, toMs)).then(function (rows) {
      return rows.map(function (r) { return { ms: r[0], v: r[1] }; });
    });
  }
  function bandRaw(key, fromMs, toMs) {
    return q(SQL.bandRaw(key, fromMs, toMs)).then(function (rows) {
      return rows.map(function (r) { return { ms: r[0], v: r[1] }; });
    });
  }
  function createMonitorTimer(tqlSource, schedule) {
    return putTimer(monTimer(), monTqlPath(), tqlSource, schedule);
  }

  return {
    q: q, tql: tql, SQL: SQL, pkgBase: pkgBase, rpc: rpc,
    consoleUser: consoleUser, apiToken: apiToken, setApiToken: setApiToken, clearApiToken: clearApiToken, tokenHint: tokenHint,
    validateToken: validateToken, whoami: whoami, onAuthFail: onAuthFail,
    setUser: setUser, getUser: getUser, configDir: configDir, configRoot: configRoot,
    createMonitorTimer: createMonitorTimer, deleteMonitorTimer: deleteMonitorTimer,
    timerStates: timerStates, monTimer: monTimer, bandTimer: bandTimer, wdTimer: wdTimer,
    timerName: timerName, deleteWdTimer: deleteWdTimer,
    createBandTimer: createBandTimer, deleteBandTimer: deleteBandTimer, bandTrend: bandTrend, bandRaw: bandRaw, bandBackfill: bandBackfill, bandTimes: bandTimes, bandLatest: bandLatest,
    ensureDir: ensureDir, saveFile: saveFile, listDir: listDir, deleteFile: deleteFile, readFileBlob: readFileBlob,
    listTagTables: listTagTables, tagSchemas: tagSchemas, listTags: listTags, tagStats: tagStats, isNoRollup: isNoRollup, probeRollup: probeRollup,
    rollupTrend: rollupTrend, rollupBatch: rollupBatch, rawWindow: rawWindow, lastSampleMs: lastSampleMs, sampleTimes: sampleTimes, fftSpectrum: fftSpectrum,
    loadConfig: loadConfig, saveConfig: saveConfig, saveConfigPartial: saveConfigPartial,
    migrateConfigToDb: migrateConfigToDb, checkAppDb: checkAppDb, setupSql: setupSql, createAppDb: createAppDb, appDb: appDb,
    storePrefix: storePrefix, userKeyPrefix: userKeyPrefix, configTable: configTable, srcMapOf: srcMapOf, listUsers: listUsers, grantTo: grantTo, revokeFrom: revokeFrom, accessStatus: accessStatus,
    ensureMonTables: ensureMonTables, loadEvents: loadEvents, loadEventsRange: loadEventsRange, countEvents: countEvents,
    loadBaselines: loadBaselines, saveBaseline: saveBaseline, deleteBaseline: deleteBaseline,
    insertEvent: insertEvent,
    insertBandPoint: insertBandPoint, loadMonState: loadMonState, saveMonState: saveMonState,
    usageStats: usageStats, countRange: countRange, tagUsage: tagUsage,
    deleteEventsOfTag: deleteEventsOfTag, deleteEventsRange: deleteEventsRange, migrateEventsToTag: migrateEventsToTag,
    deleteBandRange: deleteBandRange, deleteBandOfTag: deleteBandOfTag, deleteMonState: deleteMonState
  };
});
