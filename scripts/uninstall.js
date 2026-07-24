'use strict';

// pkg run uninstall — 사용자 데이터(data/)는 보존한다. 패키지 파일 삭제는 Neo가 수행.
// 서버 상시감시 타이머(NEO_VIBE_MONITOR)는 패키지 밖(~/.config/machbase/schedules)에 있어
// Neo의 패키지 파일 삭제로는 안 지워진다 → 여기서 제거(고아 타이머 방지). best-effort·실패 무시.
// (1차 정리는 앱: 서버 모드를 끄면 앱이 삭제. 여기는 앱을 안 거치고 제거한 경우의 안전망.)
// 주의: stop.js에는 넣지 않는다 — 스톱이 Neo 재시작 시 불리면 상시감시가 꺼져야 할 이유가 없다.
(function removeMonitorTimer() {
  try {
    var http = require('@jsh/http');
    var fs = require('fs');
    var path = require('path');
    var process = require('process');

    var user = 'SYS', pass = 'MANAGER';
    try {
      var authPath = path.join(path.resolve(path.dirname(process.argv[1]), '..'), 'cgi-bin', 'config', 'neo-auth.json');
      if (fs.existsSync(authPath)) {
        var a = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        if (a && a.user) user = a.user;
        if (a && a.password != null) pass = a.password;
      }
    } catch (e) { /* 기본 계정 사용 */ }

    var base = 'http://127.0.0.1:5654'; // 로컬 Neo(기본 포트) — 안전망이라 비기본 포트면 무동작
    var client = http.NewClient();
    function req(method, url, headers, body) {
      var r = http.NewRequest(method, url);
      if (headers) Object.keys(headers).forEach(function (k) { r.header.set(k, headers[k]); });
      if (body) r.writeString(body);
      var resp = client.do(r);
      var t = ''; try { t = resp.string(); } catch (e) { /* empty */ }
      return t;
    }
    var loginResp = req('POST', base + '/web/api/login', { 'Content-Type': 'application/json' },
      JSON.stringify({ loginName: user, password: pass }));
    var token = '';
    try { token = JSON.parse(loginResp).accessToken || ''; } catch (e) { /* empty */ }
    if (token) req('DELETE', base + '/web/api/timers/NEO_VIBE_MONITOR', { 'Authorization': 'Bearer ' + token });
  } catch (e) { /* 안전망 — 정리 실패가 uninstall을 막지 않는다 */ }
})();

console.println('neo-pkg-vibe-analytics uninstalled. data/ 디렉터리는 보존됩니다.');
