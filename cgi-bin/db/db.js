// db/index.js — Machbase Neo DB 연동 실행층. SQL 문자열은 전부 ./sql.js, 계산은 ../calc.
// fetch 기반 — 앱이 Neo(/public)에서 서빙되므로 same-origin. 시간값은 전부 ms(timeformat=ms).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sql.js'), require('../calc/calc.js'));
  } else {
    root.VibeDB = factory(root.VibeSQL, root.VibeCalc);
  }
})(typeof self !== 'undefined' ? self : this, function (SQL, VC) {
  'use strict';

  /* ---------------- REST ---------------- */
  function q(sql, opts) {
    opts = opts || {};
    var p = 'q=' + encodeURIComponent(sql) + '&format=json&timeformat=' + (opts.timeformat || 'ms');
    return fetch('/db/query?' + p).then(function (r) {
      // 에러(HTTP 500 등)도 본문의 reason을 살린다 — 호출측 폴백 판정(예: ROLLUP 미지원)에 필요
      return r.json().catch(function () { throw new Error('db/query HTTP ' + r.status); });
    }).then(function (j) {
      if (!j.success) throw new Error(j.reason || 'query failed');
      return (j.data && j.data.rows) || [];
    });
  }

  function tql(script) {
    return fetch('/db/tql', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: script })
      .then(function (r) {
        return r.text().then(function (text) {
          if (!r.ok) throw new Error('db/tql HTTP ' + r.status + ': ' + text.slice(0, 160));
          return text;
        });
      });
  }

  /* ---------------- 카탈로그 ---------------- */
  function listTagTables(owner) {
    return q(SQL.catalogTables(owner)).then(function (rows) {
      return rows.map(function (r) { return r[0]; })
        .filter(function (n) { return n[0] !== '_'; }); // 카탈로그가 TYPE=6(TAG)만 반환 — LOOKUP/메타 자동 제외
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
  // DATE_TRUNC 폴백은 원본 전체 스캔이라 대용량 테이블에서 매우 느리다(실측: 5,600만 행 시간집계 90초+).
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

  function rollupBatch(table, tags, unit, fromMs, toMs) {
    function parse(rows) {
      var out = {};
      rows.forEach(function (r) {
        var b = VC.toBucket(r.slice(1));
        if (b) (out[r[0]] = out[r[0]] || []).push(b);
      });
      return out;
    }
    function run(useTrunc) { return q(SQL.rollupBatch(table, tags, unit, fromMs, toMs, useTrunc)).then(parse); }
    if (_noRollup[table]) return run(true);
    return run(false).catch(function (e) {
      if (!isRollupErr(e)) throw e;
      _noRollup[table] = true;
      return run(true);
    });
  }

  // 원시 파형 구간 — maxPts=0이면 전체 해상도(스펙트럼 계산용), 지정 시 다운샘플(표시용)
  function rawWindow(table, tag, fromMs, toMs, maxPts) {
    return q(SQL.rawWindow(table, tag, fromMs, toMs)).then(function (rows) {
      var stride = 1;
      if (maxPts && rows.length > maxPts) stride = Math.ceil(rows.length / maxPts);
      var times_ms = [], values = [];
      var t0 = rows.length ? rows[0][0] : 0;
      for (var i = 0; i < rows.length; i += stride) {
        times_ms.push(rows[i][0] - t0);
        values.push(rows[i][1]);
      }
      return { times_ms: times_ms, values: values, n: rows.length };
    });
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
    'source.json': ['srcSel'], // DB 접속 정보는 UI가 아니라 cgi-bin/config/neo-auth.json으로 관리
    'equipment.json': ['equipCls', 'equipRpm', 'equipBearing', 'equipGeo', 'equipUnit', 'aliases'],
    'criteria.json': ['machineClass', 'classThresh', 'unitThresh'],
    'monitor.json': ['monitorOn', 'evalWindow', 'evalAgg', 'notifCh', 'notifTo', 'routes', 'monitorInterval', 'monMode', 'escHold', 'recHold', 'renotify'],
    'llm.json': ['llmProvider', 'llmKeys', 'llmModels', 'ollamaUrl'],
  };
  function configDir() { return pkgBase() + '/cgi-bin/config'; }

  // 앱이 서빙되는 패키지 경로(/public/<폴더>) — 폴더명이 바뀌어도 동작
  function pkgBase() {
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
      var m = /^(\/public\/[^/]+)\//.exec(window.location.pathname);
      if (m) return m[1];
    }
    return '/public/neo-pkg-replication'; // node 스모크/폴백
  }

  var _jwt = { token: '', exp: 0 };
  function login(user, pass) {
    if (_jwt.token && Date.now() < _jwt.exp) return Promise.resolve(_jwt.token);
    return fetch('/web/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: user || 'SYS', password: pass || '' }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.success || !j.accessToken) throw new Error('Neo 로그인 실패 — DB 연결 카드의 사용자/비밀번호를 확인하세요');
      _jwt = { token: j.accessToken, exp: Date.now() + 5 * 60 * 1000 };
      return _jwt.token;
    });
  }

  function loadConfig() {
    var names = Object.keys(CONFIG_FILES);
    return Promise.all(names.map(function (n) {
      // cache: no-store — 저장(POST) 후 재접속 시 브라우저가 옛 GET 응답을 캐시로 주면 설정이 되돌아감(알람 자동 꺼짐 버그)
      return authedFetch(configDir() + '/' + n, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('missing'); return r.json(); })
        .catch(function () { return null; });
    })).then(function (parts) {
      var cfg = {};
      parts.forEach(function (p) { if (p) Object.assign(cfg, p); });
      return parts.some(function (p) { return p; }) ? cfg : null;
    });
  }

  // ── 파일 API 인증 ──
  // cgi-bin/*은 정적 서빙에서 제외되므로(검증: 404) 설정 읽기/쓰기 모두 인증 파일 API를 쓴다.
  // 계정 우선순위: setAuth 지정(설정 저장 시 전달) > cgi-bin/config/neo-auth.json > 기본 SYS/MANAGER
  var _auth = null;
  function setAuth(a) { if (a && (a.user || a.password)) { _auth = a; _jwt = { token: '', exp: 0 }; } }
  function ensureLogin() {
    if (_jwt.token && Date.now() < _jwt.exp) return Promise.resolve(_jwt.token);
    var first = _auth || { user: 'SYS', password: 'MANAGER' };
    return login(first.user, first.password).then(function (token) {
      if (_auth) return token;
      // 기본 계정으로 로그인됐다면 neo-auth.json이 있는지 확인해 이후 재로그인용으로 기억
      return fetch('/web/api/files' + configDir() + '/neo-auth.json', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (a) { if (a && a.user) _auth = a; return token; });
    });
  }
  function authedFetch(path, opts) {
    return ensureLogin().then(function (token) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
      return fetch('/web/api/files' + path, opts);
    });
  }

  // flat 설정 객체를 도메인별 파일로 나눠 저장 (app은 통짜 cfg만 넘기면 된다)
  function saveConfig(cfg, auth) {
    setAuth(auth);
    var jobs = Object.keys(CONFIG_FILES).map(function (n) {
      var part = {};
      CONFIG_FILES[n].forEach(function (k) { if (cfg[k] !== undefined) part[k] = cfg[k]; });
      return authedFetch(configDir() + '/' + n, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(part, null, 2),
      }).then(function (r) {
        return r.json().catch(function () { return { success: r.ok }; }).then(function (j) {
          if (!r.ok || j.success === false) throw new Error(n + ' 저장 실패: ' + (j.reason || 'HTTP ' + r.status));
        });
      });
    });
    return Promise.all(jobs).then(function () { return true; });
  }

  /* ---------------- 파일 유틸 (리포트 저장/목록/미리보기 — 워크스페이스 루트 기준 경로) ---------------- */
  function ensureDir(path) {
    // 파일 API: 경로 끝 '/' POST = 디렉터리 생성 (이미 있으면 실패해도 무시)
    return authedFetch(path.replace(/\/?$/, '/'), { method: 'POST' }).catch(function () {});
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

  function ensureMonTables() {
    return Promise.all(SQL.monCreateTables().map(function (s) { return q(s).catch(function () { }); }));
  }
  function loadEvents(limit) {
    return q(SQL.eventsSelect(limit)).then(function (rows) {
      return rows.map(function (r) {
        return { eid: r[0], ts: Number(r[1]), tbl: r[2], tag: r[3], etype: r[4], grade: r[5], val: Number(r[6]), lim: Number(r[7]) };
      });
    });
  }
  function kvUpsert(table, key, obj) {
    var val = encVal(obj);
    return q(SQL.kvExists(table, key)).then(function (rows) {
      var n = rows.length ? Number(rows[0][0]) : 0;
      return q(n > 0 ? SQL.kvUpdate(table, key, val) : SQL.kvInsert(table, key, val));
    });
  }
  function loadBaselines() {
    return q(SQL.kvSelect('NEO_VIBE_BASELINE')).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { var v = decVal(r[1]); if (v) m[r[0]] = v; });
      return m;
    });
  }
  function saveBaseline(key, obj) { return kvUpsert('NEO_VIBE_BASELINE', key, obj); }
  function deleteBaseline(key) { return q(SQL.kvDelete('NEO_VIBE_BASELINE', key)); }
  function insertEvent(e) { return q(SQL.eventInsert(e)); }
  function loadMonState() {
    return q(SQL.kvSelect('NEO_VIBE_MONSTATE')).then(function (rows) {
      var m = {};
      rows.forEach(function (r) { var v = decVal(r[1]); if (v) m[r[0]] = v; });
      return m;
    });
  }
  function saveMonState(key, obj) { return kvUpsert('NEO_VIBE_MONSTATE', key, obj); }
  // 기간·필터 내 총 건수 (목록은 최근 N건 캡이라 개수는 이걸로 정확히 표시)
  function countEvents(fromMs, toMs, etype, tbl, tag) {
    return q(SQL.eventsCount(fromMs, toMs, etype, tbl, tag))
      .then(function (rows) { return rows.length ? Number(rows[0][0]) : 0; });
  }
  // 기간 지정 이벤트 조회 (CSV/JSON 내보내기용)
  function loadEventsRange(fromMs, toMs, limit) {
    return q(SQL.eventsRange(fromMs, toMs, limit)).then(function (rows) {
      return rows.map(function (r) {
        return { eid: r[0], ts: Number(r[1]), tbl: r[2], tag: r[3], etype: r[4], grade: r[5], val: Number(r[6]), lim: Number(r[7]) };
      });
    });
  }

  /* ---------------- 서버 상시감시 타이머 (Neo /web/api/timers) ----------------
     앱이 판정 TQL을 패키지 파일로 저장하고, 그 파일을 Neo 타이머가 주기 실행(앱 없이도 감시).
     타이머 task 경로 = 파일 API 경로와 동일 문자열(pkgBase/cgi-bin/monitor.tql). */
  var MON_TIMER = 'NEO_VIBE_MONITOR';
  function monTqlPath() { return pkgBase() + '/cgi-bin/monitor.tql'; }
  function authedTimer(sub, opts) {
    return ensureLogin().then(function (token) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
      return fetch('/web/api/timers' + (sub || ''), opts);
    });
  }
  // 없는 타이머 삭제는 조용히 통과 (idempotent — 서버 모드 한 번도 안 켰으면 없음)
  function deleteMonitorTimer() {
    return authedTimer('/' + MON_TIMER, { method: 'DELETE' }).then(function () { return true; }).catch(function () { return true; });
  }
  // 판정 TQL 저장 → 기존 타이머 삭제(실행 중 PUT 수정=500이라 delete→create) → 생성(autoStart)
  function createMonitorTimer(tqlSource, schedule) {
    return saveFile(monTqlPath(), tqlSource, 'text/plain')
      .then(function () { return deleteMonitorTimer(); })
      .then(function () {
        return authedTimer('', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: MON_TIMER, autoStart: true, schedule: schedule, path: monTqlPath() }),
        });
      })
      .then(function (r) { return r.json().catch(function () { return { success: r.ok }; }); })
      .then(function (j) { if (j.success === false) throw new Error('타이머 생성 실패: ' + (j.reason || '')); return true; });
  }

  return {
    q: q, tql: tql, SQL: SQL, pkgBase: pkgBase, login: login,
    createMonitorTimer: createMonitorTimer, deleteMonitorTimer: deleteMonitorTimer,
    ensureDir: ensureDir, saveFile: saveFile, listDir: listDir, deleteFile: deleteFile, readFileBlob: readFileBlob,
    listTagTables: listTagTables, listTags: listTags, tagStats: tagStats, isNoRollup: isNoRollup,
    rollupTrend: rollupTrend, rollupBatch: rollupBatch, rawWindow: rawWindow, fftSpectrum: fftSpectrum,
    loadConfig: loadConfig, saveConfig: saveConfig,
    ensureMonTables: ensureMonTables, loadEvents: loadEvents, loadEventsRange: loadEventsRange, countEvents: countEvents,
    loadBaselines: loadBaselines, saveBaseline: saveBaseline, deleteBaseline: deleteBaseline,
    insertEvent: insertEvent, loadMonState: loadMonState, saveMonState: saveMonState
  };
});
