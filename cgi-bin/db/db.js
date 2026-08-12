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
    var url = '/db/query?q=' + encodeURIComponent(sql) + '&format=csv&timeformat=ms&heading=false';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('db/query HTTP ' + r.status);
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

  /* 샘플레이트 추정용 표본 시각 — 마이크로초 정수 배열.
     ms는 고주파 간격이 0으로 뭉개지고 ns는 JS 안전 정수를 넘는다 — μs만 두 조건을 만족한다.
     실패하면 빈 배열 — 호출측이 다른 추정으로 넘어간다. */
  function sampleTimes(table, tag, fromMs, toMs, limit) {
    var sql = SQL.sampleTimes(table, tag, fromMs, toMs, limit);
    var url = '/db/query?q=' + encodeURIComponent(sql) + '&format=csv&timeformat=us&heading=false';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('db/query HTTP ' + r.status);
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
    'source.json': ['srcSel'], // DB 접속 정보는 UI가 아니라 cgi-bin/config/neo-auth.json으로 관리
    'equipment.json': ['equipCls', 'equipRpm', 'equipBearing', 'equipGeo', 'equipUnit', 'equipMeta', 'lineHz', 'aliases', 'cardOrder', 'knownTags', 'revived'],
    'criteria.json': ['machineClass', 'classThresh', 'unitThresh'],
    'monitor.json': ['monitorOn', 'evalWindow', 'notifCh', 'notifTo', 'routes', 'monitorInterval', 'monMode', 'escHold', 'recHold', 'renotify', 'bandOn', 'bandInterval', 'bandWin'],
    'llm.json': ['llmProvider', 'llmKeys', 'llmModels', 'ollamaUrl'],
  };
  function configDir() { return pkgBase() + '/cgi-bin/config'; }

  // 앱이 서빙되는 패키지 경로(/public/<폴더>) — 폴더명이 바뀌어도 동작
  function pkgBase() {
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
      var m = /^(\/public\/[^/]+)\//.exec(window.location.pathname);
      if (m) return m[1];
    }
    return '/public/neo-pkg-vibe-analytics'; // node 스모크/폴백 — 이 이름이 틀리면 설정·타이머 TQL이 없는 경로를 가리킨다
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
      // cache: no-store — 브라우저가 옛 GET 응답을 캐시로 주면 저장한 설정이 되돌아간다
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
  // cgi-bin/*은 정적 서빙에서 제외되므로 설정 읽기/쓰기 모두 인증 파일 API를 쓴다.
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
  /* 일부 키만 저장 — 해당 키가 든 파일만, 파일에 이미 있는 값은 보존하고 덮어쓴다.
     설정 탭에서 아직 저장 안 한 편집이 state에 남아 있을 수 있으므로(카드 순서는 모니터링 탭에서
     즉시 저장된다) 전체 저장을 쓰면 그 편집까지 같이 나가버린다. */
  function saveConfigPartial(cfg, keys) {
    var names = Object.keys(CONFIG_FILES).filter(function (n) {
      return CONFIG_FILES[n].some(function (k) { return keys.indexOf(k) >= 0; });
    });
    return Promise.all(names.map(function (n) {
      return authedFetch(configDir() + '/' + n, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
        .then(function (cur) {
          var part = Object.assign({}, cur || {});
          keys.forEach(function (k) {
            if (CONFIG_FILES[n].indexOf(k) >= 0 && cfg[k] !== undefined) part[k] = cfg[k];
          });
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
    })).then(function () { return true; });
  }

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
    // 옛 LOG 이벤트 표를 먼저 TAG로 옮긴다 — 옮기기 전에 CREATE를 돌리면 이름이 겹쳐 실패한다
    return migrateEventsToTag()
      // CREATE는 이미 있으면 실패하는 게 정상이라 전부 삼킨다(멱등하게 취급)
      .then(function () { return Promise.all(SQL.monCreateTables().map(function (s) { return q(s).catch(function () { }); })); });
  }
  /* 이벤트 표 LOG → TAG 이관 (1회성, 멱등) — TAG는 NAME='<테이블>:<태그>' 단위 삭제가 가능하다.
     다 읽어서 손에 쥔 뒤에만 DROP한다(읽기 실패 시 아무것도 하지 않음). 표가 없거나 이미 TAG면 조용히 지나간다. */
  var EV_TYPE_LOG = 0;
  function migrateEventsToTag() {
    return q(SQL.tableTypeOf('NEO_VIBE_EVENTS')).then(function (rows) {
      if (!rows.length || Number(rows[0][0]) !== EV_TYPE_LOG) return null;   // 없거나 이미 TAG
      return q(SQL.eventsLegacySelect()).then(function (old) {
        return q(SQL.dropTable('NEO_VIBE_EVENTS'))
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
    var nm = String(r[0] || ''), i = nm.indexOf(':');
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
    return q(SQL.eventsDeleteTag(tbl, tag)).then(function (r) { return purgeNames('NEO_VIBE_EVENTS').then(function () { return r; }); });
  }
  function deleteEventsRange(fromMs, toMs) {
    return q(SQL.eventsDeleteRange(fromMs, toMs)).then(function (r) { return purgeNames('NEO_VIBE_EVENTS').then(function () { return r; }); });
  }
  function deleteBandRange(fromMs, toMs) {
    return q(SQL.bandDeleteRange(fromMs, toMs)).then(function (r) { return purgeNames('NEO_VIBE_BAND').then(function () { return r; }); });
  }
  /* 태그 하나의 대역 데이터 삭제 — 계열 키를 차례로 지우고, 한 키가 실패해도 나머지는 지운다.
     계열 목록은 여기 따로 적지 않고 calc의 목록(판정 계열 + 저장 전용 + 옛 이름)을 그대로 쓴다. */
  var BAND_KEYS = VC.BAND_ORDER.concat(VC.BAND_CTX, VC.BAND_LEGACY || []);
  function deleteBandOfTag(tbl, tag) {
    return BAND_KEYS.reduce(function (p, b) {
      return p.then(function () { return q(SQL.bandDeleteKey(tbl + ':' + tag + ':' + b)).catch(function () { }); });
    }, Promise.resolve()).then(function () { return purgeNames('NEO_VIBE_BAND'); });
  }
  /* 태그별 보유량 — { '테이블:태그': { band, events } }. 정리 화면이 "무엇을 지울지" 고르는 근거다.
     BAND는 계열이 여러 개라 앞 두 마디로 묶는다. 한쪽 조회가 실패해도 다른 쪽은 보여준다 —
     정리 화면이 통째로 안 열리는 것보다 반쪽이라도 열리는 편이 낫다. */
  function tagUsage() {
    var acc = {};
    var add = function (kind) {
      return function (rows) {
        rows.forEach(function (r) {
          var key = String(r[0]).split(':').slice(0, 2).join(':');
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
  function deleteMonState(key) { return q(SQL.kvDelete('NEO_VIBE_MONSTATE', key)); }
  /* 데이터 관리 현황 — 설정 화면이 "지금 얼마나 쌓였나"를 보여주기 위한 조회.
     한 번에 다 받는다(테이블 4개 · 조회 7건 · 전부 count/min/max라 가볍다).
     한 테이블이 없거나 조회에 실패해도 나머지는 살린다 — 화면이 통째로 비면 원인을 알 수 없다. */
  function usageStats() {
    var one = function (sql, pick) {
      return q(sql).then(function (rows) { return rows.length ? pick(rows[0]) : null; }).catch(function () { return null; });
    };
    var num = function (r) { return Number(r[0]); };
    return Promise.all([
      one(SQL.usageCount('NEO_VIBE_EVENTS'), num),
      one(SQL.eventsSpan(), function (r) { return { from: Number(r[0]), to: Number(r[1]) }; }),
      one(SQL.usageCount('NEO_VIBE_BAND'), num),
      // TIME은 timeformat=ms라 이미 밀리초 숫자로 온다 — Date.parse를 태우면 NaN이 된다
      one(SQL.bandSpan(), function (r) { return { from: Number(r[0]), to: Number(r[1]) }; }),
      one(SQL.bandKeyCount(), num),
      one(SQL.usageCount('NEO_VIBE_MONSTATE'), num),
      one(SQL.usageCount('NEO_VIBE_BASELINE'), num),
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
    return q(SQL.eventsRange(fromMs, toMs, limit)).then(function (rows) { return rows.map(evRow); });
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
  /* 타이머 상태 조회 — { 이름: { state, schedule, task } }. state는 'RUNNING' 또는 'STOP, <에러문구>'.
     조회 실패는 null(상태 모름) — 빈 목록으로 접으면 부르는 쪽이 남아 도는 타이머를 없는 것으로 기억한다. */
  function timerStates() {
    return authedTimer('', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return null;
        var m = {};
        (j.data || []).forEach(function (t) {
          if (t && t.name) m[t.name] = { state: t.state || '', schedule: t.schedule || '', task: t.task || '' };
        });
        return m;
      })
      .catch(function () { return null; });   // 조회 실패는 "상태 모름" — 없다고 단정하지 않는다
  }
  /* 타이머는 반드시 멈춘 뒤에 지운다 — 삭제만으로는 실행 중인 회차가 멎는다는 보장이 없어
     옛 스펙 인스턴스가 남아 돌 수 있다. 없는·이미 멈춘 타이머에 보내도 무해하므로 결과를 보지 않는다. */
  function stopTimer(name) {
    return authedTimer('/' + name + '/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'stop' }),
    }).then(function () { return true; }).catch(function () { return true; });
  }
  function deleteTimer(name) {
    return stopTimer(name)
      .then(function () { return authedTimer('/' + name, { method: 'DELETE' }); })
      .then(function () { return true; }).catch(function () { return true; });
  }
  /* 타이머 등록 — TQL 파일을 쓰고, 있으면 지운 뒤 만든다(autoStart라 등록이 곧 실행).
     실행 중인 타이머는 PUT 수정이 500이라 delete→create가 유일한 교체 수단.
     known: 부르는 쪽이 이미 확인해 둔 존재 여부 —
       'absent'  없음 확인됨 → 삭제 건너뜀 · 'present' 있음 확인됨 → 바로 삭제 · 그 외 → 목록을 한 번 읽는다.
     읽지 못했으면 지워 본다. known이 틀렸으면 생성이 실패하고 호출측이 다음 회차에 '모름' 경로로 돌아온다. */
  function putTimer(name, path, tqlSource, schedule, known) {
    return saveFile(path, tqlSource, 'text/plain')
      .then(function () {
        if (known === 'absent') return true;
        if (known === 'present') return deleteTimer(name);
        return timerStates().then(function (m) { return (m && !m[name]) ? true : deleteTimer(name); });
      })
      .then(function () {
        return authedTimer('', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, autoStart: true, schedule: schedule, path: path }),
        });
      })
      .then(function (r) { return r.json().catch(function () { return { success: r.ok }; }); })
      .then(function (j) { if (j.success === false) throw new Error(name + ' 타이머 생성 실패: ' + (j.reason || '')); return true; });
  }
  function deleteMonitorTimer() { return deleteTimer(MON_TIMER); }
  /* 대역 추출 타이머 — 판정 타이머와 이름·파일·주기 분리(주기 특성이 다르고, 한쪽 실패가 다른 쪽을 멈추지 않게).
     감시자(WD) 타이머도 별개 — 감시 생존 확인이 선택 기능의 on/off에 걸리지 않게 한다. */
  var WD_TIMER = 'NEO_VIBE_WD';
  function wdTqlPath() { return pkgBase() + '/cgi-bin/watchdog.tql'; }
  function deleteWdTimer() { return deleteTimer(WD_TIMER); }
  function createWdTimer(tqlSource, schedule, known) {
    return putTimer(WD_TIMER, wdTqlPath(), tqlSource, schedule, known);
  }
  var BAND_TIMER = 'NEO_VIBE_BAND';
  function bandTqlPath() { return pkgBase() + '/cgi-bin/band.tql'; }
  function deleteBandTimer() { return deleteTimer(BAND_TIMER); }
  function createBandTimer(tqlSource, schedule, known) {
    return putTimer(BAND_TIMER, bandTqlPath(), tqlSource, schedule, known);
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
  function createMonitorTimer(tqlSource, schedule, known) {
    return putTimer(MON_TIMER, monTqlPath(), tqlSource, schedule, known);
  }

  return {
    q: q, tql: tql, SQL: SQL, pkgBase: pkgBase, login: login,
    createMonitorTimer: createMonitorTimer, deleteMonitorTimer: deleteMonitorTimer,
    timerStates: timerStates, MON_TIMER: MON_TIMER, BAND_TIMER: BAND_TIMER,
    WD_TIMER: WD_TIMER, createWdTimer: createWdTimer, deleteWdTimer: deleteWdTimer,
    createBandTimer: createBandTimer, deleteBandTimer: deleteBandTimer, bandTrend: bandTrend, bandRaw: bandRaw, bandBackfill: bandBackfill, bandTimes: bandTimes, bandLatest: bandLatest,
    ensureDir: ensureDir, saveFile: saveFile, listDir: listDir, deleteFile: deleteFile, readFileBlob: readFileBlob,
    listTagTables: listTagTables, listTags: listTags, tagStats: tagStats, isNoRollup: isNoRollup,
    rollupTrend: rollupTrend, rollupBatch: rollupBatch, rawWindow: rawWindow, sampleTimes: sampleTimes, fftSpectrum: fftSpectrum,
    loadConfig: loadConfig, saveConfig: saveConfig, saveConfigPartial: saveConfigPartial,
    ensureMonTables: ensureMonTables, loadEvents: loadEvents, loadEventsRange: loadEventsRange, countEvents: countEvents,
    loadBaselines: loadBaselines, saveBaseline: saveBaseline, deleteBaseline: deleteBaseline,
    insertEvent: insertEvent, loadMonState: loadMonState, saveMonState: saveMonState,
    usageStats: usageStats, countRange: countRange, tagUsage: tagUsage,
    deleteEventsOfTag: deleteEventsOfTag, deleteEventsRange: deleteEventsRange, migrateEventsToTag: migrateEventsToTag,
    deleteBandRange: deleteBandRange, deleteBandOfTag: deleteBandOfTag, deleteMonState: deleteMonState
  };
});
