// db/db.js — Machbase Neo DB 연동 실행층. SQL 문자열은 전부 ./sql.js, 계산은 ../calc.
// fetch 기반 — 앱이 Neo(/public)에서 서빙되므로 same-origin. 시간값은 전부 ms(timeformat=ms).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sql.js'), require('../calc/calc.js'));
  } else {
    root.VibeDB = factory(root.VibeSQL, root.VibeCalc);
  }
})(typeof self !== 'undefined' ? self : this, function (SQL, VC) {
  'use strict';

  /* ---------------- REST ----------------
     모든 서버 호출이 지나는 한 곳. 인증 헤더는 여기서만 붙인다 — 호출 지점이 흩어지면
     하나만 빠뜨려도 서버가 기본 신원(SYS)으로 조용히 통과시킨다. 그건 실패가 아니라
     "권한이 넓어진 성공"이라 화면에도 로그에도 드러나지 않는다.

     신원은 Neo 콘솔 로그인 세션(JWT)에서 온다. 앱이 따로 자격증명을 만들지 않으므로
     "콘솔에 로그인한 사람"과 "앱이 보는 데이터"가 어긋날 수 없다.
     auth: 'jwt'(기본) 콘솔 세션 / 'service' 호출측이 만든 Bearer 그대로(타이머용) / 'none' 없음. */
  var JWT_STORE_KEY = 'accessToken';       // Neo 콘솔이 여기에 둔다
  var REFRESH_STORE_KEY = 'refreshToken';  // 로그인 때 함께 발급되는 갱신용 토큰
  /* 토큰을 캐시하지 않는다 — 수명이 5분이라 붙잡아 두면 만료된 값을 계속 보낸다.
     콘솔이 갱신해 두면 다음 요청부터 자동으로 새 토큰이 실린다. */
  function sessionJwt() {
    try { return (localStorage.getItem(JWT_STORE_KEY) || '').trim(); } catch (e) { return ''; }
  }
  function jwtPayload(tok) {
    try {
      var parts = String(tok || '').split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) { return null; }
  }
  /* JWT payload 의 sub — 서버에 묻지 않고 신원을 알 수 있는 값.
     검증이 아니라 식별이다. 위조 토큰은 서버가 401 로 막고, 실제 실행 계정은 whoami() 로 대조한다. */
  function jwtUser() {
    var o = jwtPayload(sessionJwt());
    return String((o && (o.sub || o.username || o.name)) || '').toUpperCase();
  }

  /* TQL 은 이 헤더가 있어야 호출자의 계정으로 실행된다. 이 빌드에서는 없어도 계정이 유지되지만,
     구버전 Neo 는 서버 자체 커넥션(SYS)으로 돌려 권한 밖 테이블까지 읽힌다 — 붙이는 비용이 0이고
     빠뜨렸을 때의 실패가 "조용한 권한 확대"라서 항상 붙인다. */
  var CONSOLE_HEADERS = {
    'X-Console-Id': 'neo-pkg-bearing-analytics, console-log-level=NONE',
    'X-Console-Log-Level': 'NONE',
  };

  /* 인증이 끊긴 순간을 한 곳에서 잡는다 — 401을 호출측이 각자 삼키면 "세션이 만료됐다"가
     "데이터가 없다"로 번역되고(빈 테이블 목록), 3초 판정 루프가 그 상태로 계속 서버를 때린다. */
  var _onAuthFail = null;
  function onAuthFail(fn) { _onAuthFail = fn; }

  // 모든 fetch 가 지나는 유일한 지점 — 갱신 요청도 여기를 지난다
  function send(path, init) { return fetch(path, init); }

  /* 세션 갱신. accessToken 은 5분이고 콘솔이 갱신해 주기를 기대할 수 없다 —
     앱만 띄워 둔 탭에서는 5분 뒤 전부 401 이 되고 화면이 "다시 로그인하세요"로 멈춘다.
     그래서 앱이 직접 relogin 을 친다. 겹친 요청이 동시에 갱신하지 않도록 진행 중인 약속을 공유한다. */
  var REFRESH_SKEW_MS = 60000;   // 만료 1분 전부터 미리 바꾼다 — 요청 도중 만료되는 창을 없앤다
  var _refreshing = null;
  /* 갱신이 거부된 토큰을 기억한다 — 안 그러면 폴링이 3초마다 401 을 만들고 그때마다 relogin 을
     쳐서 실패 요청이 눈덩이처럼 불어난다(실측: 한 화면에 relogin 401 이 열 건). 토큰이 바뀌면 푼다. */
  var _refreshDeadFor = '';
  function refreshSession() {
    if (_refreshing) return _refreshing;
    var cur = sessionJwt();
    if (_refreshDeadFor && _refreshDeadFor === cur) return Promise.resolve(false);
    var rt = '';
    try { rt = (localStorage.getItem(REFRESH_STORE_KEY) || '').trim(); } catch (e) { rt = ''; }
    if (!rt) return Promise.resolve(false);
    _refreshing = send('/web/api/relogin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || j.success === false || !j.accessToken) return false;
      try {
        localStorage.setItem(JWT_STORE_KEY, j.accessToken);
        if (j.refreshToken) localStorage.setItem(REFRESH_STORE_KEY, j.refreshToken);
      } catch (e) { return false; }
      return true;
    }).catch(function () { return false; })
      .then(function (ok) { _refreshing = null; _refreshDeadFor = ok ? '' : cur; return ok; });
    return _refreshing;
  }
  // 곧 만료되는가 — exp 를 못 읽으면 건드리지 않는다(멀쩡한 토큰을 버리는 쪽이 더 나쁘다)
  function expiringSoon() {
    var o = jwtPayload(sessionJwt());
    if (!o || !o.exp) return false;
    return (o.exp * 1000) - Date.now() < REFRESH_SKEW_MS;
  }

  function request(path, opts) {
    opts = opts || {};
    var mode = opts.auth || 'jwt';
    function fire() {
      var h = Object.assign({}, opts.headers || {});
      if (mode === 'jwt') {
        var tok = sessionJwt();
        if (tok) h.Authorization = 'Bearer ' + tok;
        if (path.indexOf('/web/api/tql') === 0) Object.assign(h, CONSOLE_HEADERS);
      }
      var init = { method: opts.method || 'GET' };
      for (var k in h) { init.headers = h; break; }
      if (opts.body !== undefined) init.body = opts.body;
      if (opts.cache) init.cache = opts.cache;
      return send(path, init);
    }
    var pre = (mode === 'jwt' && expiringSoon()) ? refreshSession() : Promise.resolve(false);
    return pre.then(fire).then(function (r) {
      /* 미리 갱신했는데도 401 이면 마지막으로 한 번 더 시도한다 — 시계가 어긋났거나
         다른 탭이 토큰을 바꾼 경우다. 그래도 안 되면 그때 세션 만료로 올린다. */
      if (r.status !== 401 || mode !== 'jwt') return r;
      return refreshSession().then(function (ok) {
        if (ok) return fire();
        if (_onAuthFail) _onAuthFail(path);
        return r;
      });
    });
  }

  /* 실제 실행 계정. JWT 의 sub 가 곧 실행 계정이라는 보장은 없다 — 헤더가 빠지거나 서버가
     다른 커넥션으로 돌리면 SYS 로 실행되면서도 응답은 정상으로 온다. 부팅 때 한 번 대조해
     어긋나면 막는다. 난수를 심은 쿼리가 자기 자신을 V$STMT 에 남기는 것을 이용한다. */
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
    return request('/web/machbase?' + p).then(function (r) {
      // 에러(HTTP 500 등)도 본문의 reason을 살린다 — 호출측 폴백 판정(예: ROLLUP 미지원)에 필요
      return r.json().catch(function () { throw new Error('조회 실패 HTTP ' + r.status); });
    }).then(function (j) {
      if (!j.success) throw new Error(j.reason || 'query failed');
      return (j.data && j.data.rows) || [];
    });
  }

  function tql(script) {
    return request('/web/api/tql', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: script })
      .then(function (r) {
        return r.text().then(function (text) {
          if (!r.ok) throw new Error('TQL 실패 HTTP ' + r.status + ': ' + text.slice(0, 160));
          return text;
        });
      });
  }

  /* ---------------- 카탈로그 ---------------- */
  // { 테이블: [태그컬럼, 시간컬럼, 값컬럼] } — 컬럼 구성이 표준인지 판정하는 용도
  function tagSchemas() {
    return q(SQL.tagSchemas()).then(function (rows) {
      var out = {};
      rows.forEach(function (r) { var t = r[0]; (out[t] = out[t] || []).push(r[1]); });
      return out;
    });
  }
  /* 목록과 함께 소유자를 기억해 둔다 — 조회할 때 접두를 붙이지 않으면 GRANT 를 받았어도
     "없는 테이블"이 된다(접두 없는 이름은 접속 계정 스키마에서 찾는다). */
  function listTagTables() {
    return q(SQL.catalogTables()).then(function (rows) {
      var owners = {}, names = [];
      rows.forEach(function (r) {
        var t = String(r[1]);
        if (t.charAt(0) === '_') return;   // 카탈로그가 TYPE=6(TAG)만 반환 — LOOKUP/메타 자동 제외
        // 현재 DB 것은 DB 이름을 붙이지 않는다 — 짧을수록 옛 저장값·로그와 대조하기 쉽다
        var db = r[2] == null ? '' : String(r[2]);
        if (SQL.isAppOwned(t, db, APP_DB)) return;   // 앱 저장소 — 분석 대상이 아니다
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
     rollup 미지원 테이블(ERR-2264)은 DATE_TRUNC 원본 집계로 자동 폴백하고 테이블별로 기억한다. */
  var _noRollup = {};
  function isRollupErr(e) { return /ROLLUP/i.test((e && e.message) || ''); }
  // DATE_TRUNC 폴백은 원본 전체 스캔이라 대용량 테이블에서 매우 느리다.
  // 폴백일 때는 opts.truncCapMs(호출측이 샘플레이트 기반 행 예산으로 산정)로 구간을 캡한다. 기본 2시간.
  function isNoRollup(table) { return !!_noRollup[table]; }

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
    // rollupTrend와 같은 규약 — DATE_TRUNC 폴백은 원본 전체 스캔이라 구간을 캡해야 한다
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

  /* 원시 파형 구간 조회 — maxPts=0이면 전체 해상도(스펙트럼 계산용), 지정 시 다운샘플(표시용).
     수십만 행이 오가는 유일한 경로라 JSON 대신 CSV로 받는다(크기 절반 이하, split+Number 파싱).
     다른 조회는 행 수가 작아 JSON 유지 — 에러 본문의 reason을 살리는 이점이 크다. */
  function rawWindow(table, tag, fromMs, toMs, maxPts) {
    var sql = SQL.rawWindow(table, tag, fromMs, toMs);
    var url = '/web/machbase?q=' + encodeURIComponent(sql) + '&format=csv&timeformat=ms&heading=false';
    return request(url).then(function (r) {
      if (!r.ok) throw new Error('조회 실패 HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      // CSV가 아니라 JSON 에러 본문이 오는 경우(구문 오류 등) — 사유를 그대로 올린다
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

  /* 앵커(toMs) 이하로 표본이 있는 마지막 '초'의 시작 ms — 없으면 null.
     rollupTrend와 같은 폴백 규약을 따른다: 롤업 미지원 테이블은 DATE_TRUNC로 내려가고,
     그 경로는 원본 전체 스캔이라 구간을 캡한다(기본 1시간 — 그보다 긴 수집 공백은 포기하고 null). */
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

  /* 샘플레이트 추정용 표본 시각 — 마이크로초 정수 배열.
     ms는 고주파 간격이 0으로 뭉개지고 ns는 JS 안전 정수를 넘는다 — μs만 두 조건을 만족한다.
     실패하면 빈 배열 — 호출측이 다른 추정으로 넘어간다. */
  function sampleTimes(table, tag, fromMs, toMs, limit) {
    var sql = SQL.sampleTimes(table, tag, fromMs, toMs, limit);
    var url = '/web/machbase?q=' + encodeURIComponent(sql) + '&format=csv&timeformat=us&heading=false';
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

  /* ---------------- 설정 영속화 (cgi-bin/config/*.json — 설정탭 카드별 분할 저장) ----------------
     source.json(DB연결+데이터소스) · equipment.json(설비정보) · criteria.json(판정기준) ·
     monitor.json(알람) · llm.json(LLM 연동 — API 키 격리)
     저장: Neo 파일 API POST /web/api/files/<pkg>/cgi-bin/config/<파일> (JWT 로그인)
     읽기: 인증 파일 API GET 후 병합. */

  // 설정 도메인 → 파일 매핑 (state 키와 1:1)
  var CONFIG_FILES = {
    'source.json': ['srcSel'], // 접속 정보는 설정이 아니라 콘솔 로그인 세션에서 온다
    'equipment.json': ['equipCls', 'equipRpm', 'equipBearing', 'equipGeo', 'equipUnit', 'equipMeta', 'lineHz', 'aliases', 'cardOrder', 'knownTags', 'revived'],
    'criteria.json': ['machineClass', 'classThresh', 'unitThresh'],
    'monitor.json': ['monitorOn', 'evalWindow', 'notifCh', 'notifTo', 'routes', 'monitorInterval', 'monMode', 'renotify', 'bandOn', 'bandInterval', 'bandWin'],
    'llm.json': ['llmProvider', 'llmKeys', 'llmModels', 'ollamaUrl', 'genLLM'],
  };
  /* 설정은 계정별로 따로 둔다. 유저명은 whoami()가 서버에서 확인한 값만 들어오고,
     경로로 쓰기 전에 형식을 다시 본다 — 확인 못 한 이름으로 폴더를 열면 남의 설정을 덮어쓴다.
     계정이 없으면 폴더를 고르지 못하므로 아예 실패한다(공용 폴더로 폴백하면 전부 섞인다). */
  var _user = '';
  var APP_DB = 'NEO_BEARING_STORE';
  // 공용 표가 놓이는 스키마 — 이름 조립은 sql.js 가 하므로 여기서는 판정에만 쓴다
  var SHARED_OWNER = SQL.SHARED_OWNER;
  function setUser(u) {
    var n = String(u || '').toUpperCase();
    if (n && !/^[A-Z][A-Z0-9_]*$/.test(n)) throw new Error('계정명 형식이 올바르지 않습니다: ' + u);
    _user = n;
    SQL.setScope(n ? APP_DB : '', n);   // 이름 조립 범위를 같이 옮긴다
  }
  function appDb() { return APP_DB; }
  /* 전용 DB 를 쓸 수 있는지. 못 쓰면 앱이 뜰 수 없으므로 관리자가 실행할 SQL 을 그대로 보여준다. */
  function checkAppDb() {
    return q(SQL.dbUsable(APP_DB)).then(function (rows) {
      return !!(rows.length && Number(rows[0][1]) === 1);
    }).catch(function () { return false; });
  }
  /* 저장소를 마련하는 SQL. 관리자(SYS)만 실행할 수 있다 — 그 외 계정은 DB 를 못 만들고
     (ERR-2829) 남에게 권한을 줄 수도 없다. 그래서 화면도 갈린다: SYS 에게는 쿼리를,
     나머지에게는 무엇을 요청해야 하는지를 보여준다.
     권한 부여는 계정마다 반복되므로 자리표시자로 둔다 — SYS 가 보는 것은 남을 위한 쿼리다. */
  /* 저장소를 직접 만든다 — 관리자로 접속해 있으면 SQL 을 복사해 다른 창에서 실행할 이유가 없다.
     권한이 없으면 서버가 거부하므로(ERR-2829) 여기서 따로 막지 않고 사유를 그대로 올린다. */
  function createAppDb() {
    return q('CREATE DATABASE ' + APP_DB).then(function () { return true; });
  }
  // 권한을 줄 수 있는 계정 목록 — SYS 만 읽는다(이 화면이 SYS 전용이다)
  function listUsers() {
    return q(SQL.userList()).then(function (rows) {
      return rows.map(function (r) { return String(r[0]); }).filter(function (u) { return u !== SHARED_OWNER; });
    });
  }
  /* 한 계정에 필요한 권한을 전부 준다. 문장이 여섯인 이유는 DB 단위 DML 권한 구문도 역할도
     없기 때문이다 — 그래서 사람이 옮겨 적는 대신 여기서 돌린다.
     이미 준 권한은 다시 줘도 무해하므로 개별 실패는 사유만 모아 올린다(전부 실패면 던진다). */
  function grantTo(user) {
    var list = SQL.grantStatements(user);
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

  // 공용 표를 만들고 남에게 권한을 줄 수 있는 계정 — 저장소 DB 의 소유자
  function isAdmin() { return getUser() === SHARED_OWNER; }
  function setupSql() {
    var d = APP_DB, sh = d + '.' + SHARED_OWNER + '.';
    return {
      db: d,
      create: 'CREATE DATABASE ' + d + ';',
      /* CONNECT·CREATE 는 DB 단위 — CREATE 는 계정이 자기 설정 표(CONFIG)를 만들기 위해 필요하다.
         나머지 넷은 SYS 스키마의 공용 표라 표마다 DML 권한을 줘야 한다(행 단위 권한이 없다). */
      grant: ['GRANT CONNECT ON DATABASE ' + d + ' TO <계정>;',
        'GRANT CREATE  ON DATABASE ' + d + ' TO <계정>;',
        'GRANT SELECT, INSERT, DELETE ON ' + sh + 'EVENTS TO <계정>;',
        'GRANT SELECT, INSERT, DELETE ON ' + sh + 'BAND TO <계정>;',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ' + sh + 'BASELINE TO <계정>;',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ' + sh + 'MONSTATE TO <계정>;'].join('\n'),
    };
  }



  function getUser() { return _user; }
  /* 서버 TQL 이 쓸 두 접두. 표 위치(공용 스키마)와 행 키(계정)로 역할이 다르다 —
     둘 중 하나만 틀려도 남의 행을 읽거나 쓰게 되므로 조립은 sql.js 한 곳에서만 한다. */
  function storePrefix() { return SQL.sharedScope(); }
  /* 선택한 데이터 표의 수식된 이름 — 서버 타이머가 SYS 가 아니면 접두 없는 이름으로는
     자기 스키마를 뒤지다 조용히 0건으로 끝난다. 짧은 이름 → db.user.table 대응표를 실어 보낸다. */
  function srcMapOf(tables) {
    var m = {};
    (tables || []).forEach(function (t) { m[t] = SQL.dataTable(t); });
    return m;
  }
  function userKeyPrefix() { return SQL.userPrefix(); }
  /* 계정 설정 표의 전체 이름 — 서버 감시가 발송하는 회차에 알림 설정(웹훅 URL 포함)을 여기서 읽는다.
     URL을 감시 스크립트 파일에 싣지 않기 위한 경로다(파일 API는 계정 구분 없이 로그인한 누구나 연다). */
  function configTable() { return SQL.appTable('CONFIG'); }
  // 공용 — 서비스 계정·포트처럼 계정과 무관한 것들이 여기 남는다(uninstall·감시자 TQL이 고정 경로로 읽는다)
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
    return '/public/neo-pkg-bearing-analytics'; // node 스모크/폴백 — 이 이름이 틀리면 설정·타이머 TQL이 없는 경로를 가리킨다
  }

  /* 서버 상시감시는 예전에 전용 서비스 계정(neo-auth.json)으로 타이머를 등록했다.
     Neo 타이머가 **등록한 계정으로 실행된다**(timer.list 의 execUser, 실측)는 것이 확인돼
     그 계층을 걷어냈다 — 로그인한 사람이 자기 세션으로 등록하면 그 계정으로 돌고,
     자기 소유 테이블을 읽고 쓰므로 별도 권한 부여도 필요 없다.
     login() 은 남겨 둔다: 서버에서 도는 TQL(워치독)이 자기 자격으로 붙을 때 쓴다. */

  /* 파일 API — 콘솔 세션(JWT)으로 쓴다. 리포트·TQL 파일이 조회와 같은 신원으로 오간다.
     ⚠ 이 API 에는 계정 격리가 없다(실측: 다른 계정의 폴더와 워크스페이스 루트가 그대로 보인다).
     계정별 경로는 서로 덮어쓰지 않게 하는 정리 규칙이지 권한 경계가 아니다 —
     그래서 설정과 시크릿은 파일이 아니라 계정 소유 테이블에 둔다. */
  function authedFetch(path, opts) {
    opts = opts || {};
    return Promise.resolve(request('/web/api/files' + path, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      cache: opts.cache,
    }));
  }

  /* ---- 설정 저장소 (전용 DB, 계정 스키마) ----
     파일에서 DB 로 옮긴 이유: /db/files 에는 계정 격리가 없어 토큰만 있으면 남의 설정이
     읽힌다(라이브 확인). llm.json 의 API 키와 monitor.json 의 웹훅 URL 이 거기 있었다.
     이 테이블은 소유자가 본인이라 남이 조회 자체를 못 한다.

     값은 도메인(=옛 파일) 단위 JSON 을 조각내 담는다. 한 행(VAL 4000자)에 다 넣으면
     설비 정보처럼 큰 도메인이 잘린 채 저장되고, 읽을 때 파싱이 깨져 그 도메인이 통째로
     사라진다 — 에러도 없이. */
  // 인코딩 후 값은 전부 ASCII(%XX)라 VAL(4000자) 한도를 문자 수로 그대로 쓸 수 있다.
  // 작게 잡으면 조각 수만큼 왕복이 늘어난다 — Machbase INSERT 는 한 번에 한 행이다.
  var CFG_CHUNK = 3800;
  function cfgKey(domain, i) { return 'cfg:' + domain.replace(/\.json$/, '') + '#' + i; }
  /* 퍼센트 시퀀스(%XX)가 조각 경계에서 쪼개지면 이어 붙여도 디코딩이 깨진다 — 통째로 넘긴다.
     깨진 도메인은 조용히 기본값으로 떨어지므로 여기서 막지 않으면 원인을 못 찾는다. */
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

  /* 설정 읽기 — 결과를 셋으로 가른다. 실패를 "없음"으로 삼키면 기본값으로 뜬 화면의 저장 한 번이
     실제 설정을 덮는다(알람 토글 = 전 영역 덮어쓰기, 카드 순서 = 설비 정보 소실).
       · 설정 객체 — 읽음
       · null      — 저장한 적 없음(설정 행 0개). 신규 설치라 기본값으로 시작해도 잃을 것이 없다
       · 거부      — err.kind 'query'(조회 실패 — 설정은 DB에 그대로 있다, 다시 시도)
                     | 'broken'(조각 손상 — err.domains, 다시 읽어도 안 풀린다)
     opts.allowBroken: 손상된 영역만 빼고 나머지를 돌려준다(사용자가 그 영역을 기본값으로 열기로 한 뒤). */
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

  // 도메인 하나를 조각으로 저장하고, 줄어든 만큼의 옛 조각을 지운다(안 지우면 다음 읽기에 덧붙는다)
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

  /* 일부 키만 저장 — 그 키가 속한 도메인만 다시 쓴다. 도메인의 나머지 값은 저장된 것을 읽어
     보존한다(설정 탭에 아직 저장 안 한 편집이 state 에 남아 있을 수 있어 전체 저장을 쓰면
     그 편집까지 같이 나간다). */
  function saveConfigPartial(cfg, keys) {
    var names = Object.keys(CONFIG_FILES).filter(function (n) {
      return CONFIG_FILES[n].some(function (k) { return keys.indexOf(k) >= 0; });
    });
    /* 읽기에 실패하면 쓰지 않는다 — 빈 설정 기준으로 다시 쓰면 그 영역의 다른 값이 사라진다.
       손상된 영역은 이미 못 읽는 값이라 허용한다(그 영역을 기본값으로 연 뒤에만 여기 온다). */
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

  /* 파일 → DB 1회 이관. 옛 파일은 지우지 않는다 — 유일한 롤백 경로다.
     DB 에 이미 설정이 있으면 손대지 않는다(덮어쓰면 그 사이 저장한 값을 잃는다). */
  function migrateConfigToDb() {
    /* "비어 있다"가 확인될 때만 옮긴다 — 못 읽은 것(조회 실패·손상)을 빈 것으로 보면
       옛 파일이 DB의 실제 설정을 덮는다. 못 읽었으면 건너뛰고, 부팅의 설정 읽기가 사유를 띄운다. */
    return loadConfig().catch(function () { return 'unreadable'; }).then(function (inDb) {
      if (inDb === 'unreadable') return 'skipped';
      if (inDb) return 'already';
      var names = Object.keys(CONFIG_FILES);
      return Promise.all(names.map(function (n) {
        return authedFetch(configDir() + '/' + n, { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
          .then(function (o) {
            if (o) return { n: n, o: o };
            // 계정 폴더에 없으면 옛 공용 파일에서 — SYS 만 물려받는다(남의 시크릿을 상속하지 않게)
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
  /* 파일 API: 경로 끝 '/' POST = 디렉터리 생성. 두 가지 제약이 있다.
      · mkdir 이 **재귀가 아니다** — 상위 폴더가 없으면 실패한다. 파일 쓰기도 부모를 안 만든다.
        워크스페이스에서 폴더를 지우면 루트부터 없어지므로 마지막 단계만 만들어서는 계속 실패한다.
      · 이미 있는 경로에 POST 하면 500 이라, 부를 때마다 그 500 이 콘솔을 덮는다.
     그래서 한 단계씩 "있으면 두고 없으면 만든다". 캐시하는 것은 **약속**이다 —
     "시도함"만 기억하면 아직 만들어지지 않은 폴더에 즉시 resolve 해, 기다리던 쪽이 파일부터
     쓰고 "경로를 찾을 수 없음"으로 실패한다. 실패한 경로는 기억에서 지워 다음에 다시 시도한다. */
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

  /* ---------------- 상시감시(P6) — LOOKUP 저장소 ----------------
     판정은 앱이 열려 있는 동안 앱(app._judgeLive)이 수행. 여기는 이벤트/판정상태/베이스라인의
     영속화만 담당 — LOOKUP이라 세션 간 연속(앱 재시작 시 마지막 상태와 비교해 따라잡기 판정). */
  function encVal(o) { return encodeURIComponent(JSON.stringify(o)).replace(/'/g, '%27'); }
  function decVal(s) { try { return JSON.parse(decodeURIComponent(s)); } catch (e) { return null; } }

  /* 표를 마련한다. 공용 4표와 롤업은 SYS 스키마의 것이라 SYS 만 만들 수 있고,
     설정 표(CONFIG)는 계정마다 자기 스키마에 만든다. 비-SYS 계정이 GRANT 를 못 받았으면
     끝의 확인에서 걸려 "저장소 준비 안 됨"으로 올라간다. */
  /* 이미 있는 표는 만들지 않는다. "있으면 실패"에 기대면 부팅마다 500 이 여러 건 나고,
     그 소음이 진짜 실패("권한이 없어 못 만듦")를 덮는다.
     카탈로그를 못 읽으면 예전처럼 전부 시도한다 — 모른다고 안 만들면 신규 설치가 안 뜬다. */
  function presentTables() {
    return q(SQL.appTablesPresent()).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { m[(String(r[0]) + '.' + String(r[1])).toUpperCase()] = 1; });
      return m;
    }).catch(function () { return null; });
  }
  // DDL 문장에서 <소유자>.<표> 를 뽑는다 — 이름만 보면 계정마다 같은 CONFIG 를 구분하지 못한다
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
        // 옛 LOG 이벤트 표를 먼저 TAG로 옮긴다 — 옮기기 전에 CREATE를 돌리면 이름이 겹쳐 실패한다
        return migrateEventsToTag()
          // CREATE는 이미 있으면 실패하는 게 정상이라 전부 삼킨다(멱등하게 취급)
          .then(function () { return createMissing(SQL.sharedCreateTables(), _present); })
          /* 대역 추세용 롤업 — 테이블이 생긴 뒤에만 만들 수 있다. 순서대로 걸어야 한다(시간 롤업이
             분 롤업을 소스로 쓴다). 이미 있으면 IF NOT EXISTS 가 삼킨다. */
          .then(function () {
            return SQL.bandRollups().reduce(function (p, sql) {
              return p.then(function () {
                return q(sql).catch(function (e) {
                  /* 롤업이 없어도 추세 조회는 원본 집계로 폴백하므로 부팅을 막지 않는다.
                     다만 조용히 넘기면 왜 느린지 아무도 모른다 — 사유를 남긴다. */
                  if (typeof console !== 'undefined' && console.warn) console.warn('[vibe] rollup: ' + ((e && e.message) || e));
                });
              });
            }, Promise.resolve());
          })
          .then(widenMonState);
      })
      .then(function () { return createMissing(SQL.configCreateTable(), _present); })
      /* CREATE 실패를 삼키면 "이미 있음"과 "권한이 없어 못 만듦"이 구분되지 않는다.
         끝에 실제로 읽어 보고, 안 되면 저장소가 준비되지 않은 것으로 올린다.
         공용 표까지 확인한다 — 설정만 읽히고 공용 권한이 없으면 화면은 뜨는데 판정이 전부 빈다. */
      .then(function () { return q(SQL.kvSelect('CONFIG')); })
      .then(function () { return q(SQL.usageCount('MONSTATE')); });
  }
  /* 판정 상태 저장소의 VAL 폭 맞추기 — CREATE가 삼켜지므로 DDL만 넓혀서는 기존 설치가 안 바뀐다.
     좁으면 갈아끼운다: 판정 상태는 다음 회차에 다시 쌓이므로 버려도 되는 값이다
     (학습값이 든 BASELINE은 이렇게 못 한다 — 지우면 그건 진짜 손실이다).
     신규 설치는 CREATE가 성공해 이미 넓으므로 여기서 아무 일도 일어나지 않는다.
     ⚠ 갈아끼우는 순간 서버 타이머가 쓰던 상태 한 회차가 헛돈다(putState가 try/catch라 조용히
        지나가고 다음 회차에 다시 쓴다). 확정 등급·에피소드도 처음부터 다시 센다.
     ⚠ 폭을 못 읽으면 아무것도 하지 않는다 — 모르는 상태에서 DROP하는 것이 더 나쁘다. */
  var MONSTATE_VAL_MIN = 4000;
  function widenMonState() {
    return q(SQL.colLength('MONSTATE', 'VAL')).then(function (rows) {
      var w = rows.length ? Number(rows[0][0]) : 0;
      if (!(w > 0) || w >= MONSTATE_VAL_MIN) return null;
      var ddl = SQL.sharedCreateTables().filter(function (s) { return s.indexOf('MONSTATE') >= 0; })[0];
      if (!ddl) return null;
      return q(SQL.dropTable('MONSTATE')).then(function () { return q(ddl); });
    }).catch(function () { return null; });   // 메타 조회 실패는 치명적이지 않다 — 다음 부팅에 다시 본다
  }
  /* 이벤트 표 LOG → TAG 이관 (1회성, 멱등) — TAG는 NAME='<테이블>:<태그>' 단위 삭제가 가능하다.
     다 읽어서 손에 쥔 뒤에만 DROP한다(읽기 실패 시 아무것도 하지 않음). 표가 없거나 이미 TAG면 조용히 지나간다. */
  var EV_TYPE_LOG = 0;
  function migrateEventsToTag() {
    return q(SQL.tableTypeOf('EVENTS')).then(function (rows) {
      if (!rows.length || Number(rows[0][0]) !== EV_TYPE_LOG) return null;   // 없거나 이미 TAG
      return q(SQL.eventsLegacySelect()).then(function (old) {
        return q(SQL.dropTable('EVENTS'))
          .then(function () { return q(SQL.monCreateTables()[0]); })
          .then(function () {
            // 한 건씩 넣는다 — Machbase INSERT는 단일 행이고, 이관 건수는 이력 규모라 크지 않다
            return old.reduce(function (p, r) {
              return p.then(function () {
                return q(SQL.eventInsert({
                  eid: r[0], ts: Number(r[1]), tbl: r[2], tag: r[3], etype: r[4],
                  grade: r[5], val: Number(r[6]), lim: Number(r[7]), detail: r[8] || '',
                })).catch(function () { });   // 한 건이 깨져도 나머지는 옮긴다
              });
            }, Promise.resolve());
          })
          .then(function () { return { migrated: old.length }; });
      });
    }).catch(function () { return null; });   // 이관 실패로 앱이 못 뜨게 하지 않는다
  }
  /* TAG 행 → 앱이 쓰는 이벤트 객체. NAME('<테이블>:<태그>')을 첫 콜론에서 가른다 —
     테이블명에는 콜론이 없고 태그명에는 있을 수 있으므로 뒤쪽을 통째로 태그로 본다. */
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
  /* 태그 단위 이벤트 삭제 — 행을 지운 뒤 데이터가 안 남은 이름(메타)까지 정리한다.
     이름 정리 실패는 무시하고 행 삭제는 성공으로 둔다(남은 이름은 다음 삭제 때 다시 걸린다). */
  function purgeNames(table) { return q(SQL.metaPurgeOrphans(table)).catch(function () { return null; }); }
  function deleteEventsOfTag(tbl, tag) {
    return q(SQL.eventsDeleteTag(tbl, tag)).then(function (r) { return purgeNames('EVENTS').then(function () { return r; }); });
  }
  /* 공용 표에서 내 것만 지우려면 이름이 필요하다 — TAG 표의 DELETE 는 NAME 정확일치만 받는다.
     이름 목록 조회는 이미 접두로 걸러져 오므로 여기서는 접두만 떼어 원래 키로 되돌린다. */
  function ownKeys(kind) {
    return q(kind === 'band' ? SQL.bandNameCounts() : SQL.eventNameCounts())
      .then(function (rows) { return rows.map(function (r) { return SQL.unkey(r[0]); }); })
      .catch(function () { return []; });
  }
  // 문장을 차례로 돌린다 — 한 이름이 실패해도 나머지는 지운다(중간에 멈추면 절반만 지워진 채 끝난다)
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
  /* 태그 하나의 대역 데이터 삭제 — 계열 키를 차례로 지우고, 한 키가 실패해도 나머지는 지운다.
     계열 목록은 여기 따로 적지 않고 calc의 목록(판정 계열 + 저장 전용 + 옛 이름)을 그대로 쓴다. */
  var BAND_KEYS = VC.BAND_ORDER.concat(VC.BAND_CTX, VC.BAND_LEGACY || []);
  function deleteBandOfTag(tbl, tag) {
    return BAND_KEYS.reduce(function (p, b) {
      return p.then(function () { return q(SQL.bandDeleteKey(tbl + ':' + tag + ':' + b)).catch(function () { }); });
    }, Promise.resolve()).then(function () { return purgeNames('BAND'); });
  }
  /* 태그별 보유량 — { '테이블:태그': { band, events } }. 정리 화면이 "무엇을 지울지" 고르는 근거다.
     BAND는 계열이 여러 개라 앞 두 마디로 묶는다. 한쪽 조회가 실패해도 다른 쪽은 보여준다 —
     정리 화면이 통째로 안 열리는 것보다 반쪽이라도 열리는 편이 낫다. */
  function tagUsage() {
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
      q(SQL.bandNameCounts()).then(add('band')).catch(function () { return null; }),
      q(SQL.eventNameCounts()).then(add('events')).catch(function () { return null; }),
    ]).then(function () { return acc; });
  }
  // 판정 상태·학습값 — LOOKUP이라 키 단위. 되살릴 수 있는 것(상태)과 아닌 것(학습값)을 부르는 쪽이 구분한다
  function deleteMonState(key) { return q(SQL.kvDelete('MONSTATE', key)); }
  /* 데이터 관리 현황 — 설정 화면이 "지금 얼마나 쌓였나"를 보여주기 위한 조회.
     한 번에 다 받는다(테이블 4개 · 조회 7건 · 전부 count/min/max라 가볍다).
     한 테이블이 없거나 조회에 실패해도 나머지는 살린다 — 화면이 통째로 비면 원인을 알 수 없다. */
  function usageStats() {
    var one = function (sql, pick) {
      return q(sql).then(function (rows) { return rows.length ? pick(rows[0]) : null; }).catch(function () { return null; });
    };
    var num = function (r) { return Number(r[0]); };
    return Promise.all([
      one(SQL.usageCount('EVENTS'), num),
      one(SQL.eventsSpan(), function (r) { return { from: Number(r[0]), to: Number(r[1]) }; }),
      one(SQL.usageCount('BAND'), num),
      // TIME은 timeformat=ms라 이미 밀리초 숫자로 온다 — Date.parse를 태우면 NaN이 된다
      one(SQL.bandSpan(), function (r) { return { from: Number(r[0]), to: Number(r[1]) }; }),
      one(SQL.bandKeyCount(), num),
      one(SQL.usageCount('MONSTATE'), num),
      one(SQL.usageCount('BASELINE'), num),
    ]).then(function (r) {
      return {
        events: { rows: r[0], span: r[1] },
        band: { rows: r[2], span: r[3], keys: r[4] },
        monstate: { rows: r[5] },
        baseline: { rows: r[6] },
      };
    });
  }
  // 삭제 전 건수 — "몇 건이 지워지는지" 세어 보여준 뒤 확인받기 위한 조회
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
  // 기간·필터 내 총 건수 (목록은 최근 N건 캡이라 개수는 이걸로 정확히 표시)
  function countEvents(fromMs, toMs, etype, tbl, tag) {
    return q(SQL.eventsCount(fromMs, toMs, etype, tbl, tag))
      .then(function (rows) { return rows.length ? Number(rows[0][0]) : 0; });
  }
  // 기간 지정 이벤트 조회 (CSV/JSON 내보내기용)
  function loadEventsRange(fromMs, toMs, limit) {
    return q(SQL.eventsRange(fromMs, toMs, limit)).then(function (rows) { return rows.map(evRow); });
  }

  /* 타이머와 그 TQL 은 계정별로 나뉜다. 이름을 공유하면 마지막에 저장한 사람의 설정으로
     전원이 감시받고, 파일을 공유하면 덮이는 순간 남의 태그를 보게 된다.
     계정을 모르면(부팅 전) 옛 이름을 그대로 쓴다 — 기존 설치의 타이머를 찾아 정리해야 한다. */
  function timerName(base) { return _user ? base + '_' + _user : base; }
  function userTqlPath(name) {
    return pkgBase() + '/cgi-bin/' + (_user ? 'tql/' + _user + '/' : '') + name + '.tql';
  }

  /* ---------------- 서버 상시감시 타이머 (Neo JSON-RPC) ----------------
     앱이 판정 TQL을 패키지 파일로 저장하고, 그 파일을 Neo 타이머가 주기 실행(앱 없이도 감시).
     타이머 task 경로 = 파일 API 경로와 동일 문자열(pkgBase/cgi-bin/monitor.tql). */
  var MON_TIMER = 'NEO_BEARING_MONITOR';
  function monTimer() { return timerName(MON_TIMER); }
  function monTqlPath() { return userTqlPath('monitor'); }
  /* Neo 타이머 API 는 JSON-RPC 2.0 이다(`POST /web/api/rpc`). 예전 REST 경로
     `/web/api/timers` 는 이 빌드에 없다 — 404 가 오고, 그 404 를 조회 실패로 삼키면
     "타이머가 하나도 없다"로 보여 앱이 매번 새로 만들려 든다.
     ⚠ params 는 반드시 **배열**이다(객체면 JSON-RPC Parse error).
     ⚠ 필드 이름도 REST 와 다르다: schedule → spec, path → command.
     ⚠ stop/delete 는 이름이 아니라 **id(int)** 를 받는다 — 목록에서 찾아 쓴다. */
  var _rpcId = 0;
  function rpc(method, params) {
    return request('/web/api/rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++_rpcId, method: method, params: params || [] }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.error) throw new Error(method + ': ' + (j.error.message || ('code ' + j.error.code)));
      return j ? j.result : null;
    });
  }

  /* 타이머 상태 조회 — { 이름: { state, schedule, task, id } }. state 는 'RUNNING' 또는 'STOP, <사유>'.
     조회 실패는 null(상태 모름) — 빈 목록으로 접으면 부르는 쪽이 남아 도는 타이머를 없는 것으로 기억한다.
     목록은 **계정별로 걸러져서** 온다(실측: 남의 타이머는 보이지 않는다). */
  function timerStates() {
    return rpc('timer.list', []).then(function (list) {
      if (!list) return null;
      /* Neo 는 같은 이름의 타이머를 여럿 허용한다 — 이름을 키로 덮어쓰면 마지막 하나만 남아
         나머지를 못 지운다. 중복이 쌓이면 같은 TQL 이 여러 벌 돌며 잠금을 서로 뺏는다.
         id 는 첫 항목을 그대로 두고(기존 사용처 호환), 전부는 ids 로 들고 있는다. */
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

  /* 타이머는 반드시 멈춘 뒤에 지운다 — 삭제만으로는 실행 중인 회차가 멎는다는 보장이 없어
     옛 스펙 인스턴스가 남아 돌 수 있다. 없는 타이머면 지울 것도 없다. */
  /* 이름으로 걸린 타이머를 전부 멈추고 지운다. 돌려주는 값은 "지금 이 이름으로 남은 것이 없다".
     ⚠ 실패를 삼키면 안 된다 — 부르는 쪽이 곧바로 같은 이름을 다시 만들기 때문에,
     지우지 못한 채 만들면 한 벌씩 늘어난다(실제로 다섯 벌까지 늘었다).
     목록 자체를 못 읽은 경우만 true 로 둔다: 모른다고 등록을 막으면 Neo 가 잠시 흔들릴 때
     감시가 통째로 안 걸린다. */
  function deleteTimer(name) {
    return timerStates().then(function (m) {
      if (!m) return true;                 // 목록 조회 실패 — 판단 불가, 등록은 진행한다
      var t = m[name];
      if (!t) return true;                 // 없다 = 지울 것도 없다
      var ids = (t.ids || []).filter(function (x) { return x != null; });
      // id 를 못 얻으면 이름으로라도 지워 본다 — 서버 응답 모양이 다를 때의 마지막 수단
      var keys = ids.length ? ids : [name];
      return keys.reduce(function (p, k) {
        return p.then(function () {
          return rpc('timer.stop', [k]).catch(function () { })
            .then(function () { return rpc('timer.delete', [k]); })
            .catch(function () { return null; });
        });
      }, Promise.resolve())
        // 정말 사라졌는지 확인한다 — 여기서 확인하지 않으면 실패가 증식으로 나타난다
        .then(function () { return timerStates(); })
        .then(function (m2) { return !m2 || !m2[name]; });
    });
  }

  /* 타이머 등록 — TQL 파일을 쓰고, 같은 이름을 전부 지운 뒤 만든다(autoStart라 등록이 곧 실행).
     실행 중인 타이머는 PUT 수정이 500이라 delete→create가 유일한 교체 수단이다. */
  /* TQL 이 들어갈 계정 폴더 — 파일 API 는 상위 폴더를 자동으로 만들지 않는다. 쓰기 직전에
     보장한다(부팅 때 한 번만 만들면 계정을 바꿔 들어온 경로에서 빠진다). */
  function ensureTqlDir() {
    if (!_user) return Promise.resolve();
    var base = pkgBase() + '/cgi-bin/tql';
    return ensureDir(base).then(function () { return ensureDir(base + '/' + _user); });
  }
  function putTimer(name, path, tqlSource, schedule) {
    return ensureTqlDir()
      .then(function () { return saveFile(path, tqlSource, 'text/plain'); })
      /* 실행 중인 타이머는 수정이 안 되므로 지우고 다시 만든다. 부르는 쪽의 '없음 확인'을
         믿고 건너뛰지 않는다 — 그 판단이 한 번만 틀려도 같은 이름이 한 벌 더 생기고,
         Neo 가 이름 중복을 막지 않으므로 그대로 쌓인다(실제로 세 벌까지 쌓였다).
         목록 조회 한 번이 아깝지 않다: 이 경로는 스펙이 바뀔 때만 돈다. */
      .then(function () { return deleteTimer(name); })
      .then(function (gone) {
        /* 못 지웠으면 만들지 않는다 — Neo 가 이름 중복을 막지 않으므로, 여기서 그냥 만들면
           같은 타이머가 한 벌 더 돌기 시작하고 다음 회차에 또 늘어난다. 사유를 올려 화면이 말하게 한다. */
        if (!gone) throw new Error(name + ' — 기존 타이머를 지우지 못해 등록을 중단했습니다(중복 방지). Neo 타이머 목록에서 직접 지운 뒤 다시 시도하세요');
        return rpc('timer.add', [{ name: name, spec: schedule, command: path, autoStart: true }]);
      })
      .then(function () { return true; });
  }
  function deleteMonitorTimer() { return deleteTimer(monTimer()); }
  /* 대역 추출 타이머 — 판정 타이머와 이름·파일·주기 분리(주기 특성이 다르고, 한쪽 실패가 다른 쪽을 멈추지 않게).
     감시자(WD) 타이머도 별개 — 감시 생존 확인이 선택 기능의 on/off에 걸리지 않게 한다. */
  var WD_TIMER = 'NEO_BEARING_WD';
  function wdTimer() { return timerName(WD_TIMER); }
  function wdTqlPath() { return userTqlPath('watchdog'); }
  function deleteWdTimer() { return deleteTimer(wdTimer()); }
  function createWdTimer(tqlSource, schedule) {
    return putTimer(wdTimer(), wdTqlPath(), tqlSource, schedule);
  }
  var BAND_TIMER = 'NEO_BEARING_BAND';
  function bandTimer() { return timerName(BAND_TIMER); }
  function bandTqlPath() { return userTqlPath('band'); }
  function deleteBandTimer() { return deleteTimer(bandTimer()); }
  function createBandTimer(tqlSource, schedule) {
    return putTimer(bandTimer(), bandTqlPath(), tqlSource, schedule);
  }
  /* 백필 한 청크 즉시 실행 — 타이머 등록 없이 그 자리에서 앵커 몇 개를 계산·저장한다.
     청크로 쪼개는 것은 호출측 책임이다. 한 요청에 전부 넣으면 길게는 몇 시간이라
     타임아웃으로 죽고, 진행률도 취소도 못 준다. 반환은 "done,<now>,<성공 앵커 수>" CSV. */
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
  /* 계열 여러 개의 최신값 — { 계열이름: 값 }. 판정이 태그마다 부른다. */
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
    jwtUser: jwtUser, sessionJwt: sessionJwt, whoami: whoami, onAuthFail: onAuthFail,
    setUser: setUser, getUser: getUser, configDir: configDir, configRoot: configRoot,
    createMonitorTimer: createMonitorTimer, deleteMonitorTimer: deleteMonitorTimer,
    timerStates: timerStates, monTimer: monTimer, bandTimer: bandTimer, wdTimer: wdTimer,
    timerName: timerName, createWdTimer: createWdTimer, deleteWdTimer: deleteWdTimer,
    createBandTimer: createBandTimer, deleteBandTimer: deleteBandTimer, bandTrend: bandTrend, bandRaw: bandRaw, bandBackfill: bandBackfill, bandTimes: bandTimes, bandLatest: bandLatest,
    ensureDir: ensureDir, saveFile: saveFile, listDir: listDir, deleteFile: deleteFile, readFileBlob: readFileBlob,
    listTagTables: listTagTables, tagSchemas: tagSchemas, listTags: listTags, tagStats: tagStats, isNoRollup: isNoRollup,
    rollupTrend: rollupTrend, rollupBatch: rollupBatch, rawWindow: rawWindow, lastSampleMs: lastSampleMs, sampleTimes: sampleTimes, fftSpectrum: fftSpectrum,
    loadConfig: loadConfig, saveConfig: saveConfig, saveConfigPartial: saveConfigPartial,
    migrateConfigToDb: migrateConfigToDb, checkAppDb: checkAppDb, setupSql: setupSql, createAppDb: createAppDb, appDb: appDb,
    storePrefix: storePrefix, userKeyPrefix: userKeyPrefix, configTable: configTable, srcMapOf: srcMapOf, listUsers: listUsers, grantTo: grantTo,
    ensureMonTables: ensureMonTables, loadEvents: loadEvents, loadEventsRange: loadEventsRange, countEvents: countEvents,
    loadBaselines: loadBaselines, saveBaseline: saveBaseline, deleteBaseline: deleteBaseline,
    insertEvent: insertEvent,
    insertBandPoint: insertBandPoint, loadMonState: loadMonState, saveMonState: saveMonState,
    usageStats: usageStats, countRange: countRange, tagUsage: tagUsage,
    deleteEventsOfTag: deleteEventsOfTag, deleteEventsRange: deleteEventsRange, migrateEventsToTag: migrateEventsToTag,
    deleteBandRange: deleteBandRange, deleteBandOfTag: deleteBandOfTag, deleteMonState: deleteMonState
  };
});
