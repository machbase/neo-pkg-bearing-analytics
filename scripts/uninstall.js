'use strict';

// pkg run uninstall — 사용자 데이터(data/)는 보존한다. 패키지 파일 삭제는 Neo가 수행.
// 이 패키지가 만드는 타이머 셋(감시·대역 추출·감시자)은 패키지 밖(~/.config/machbase/schedules)에
// 있어 Neo의 패키지 파일 삭제로는 안 지워진다 → 여기서 제거(고아 타이머 방지). best-effort·실패 무시.
// 하나라도 빠뜨리면 실행할 TQL이 사라진 채로 목록에 남아 주기마다 실패한다.
// (1차 정리는 앱: 알람이나 대역 추출을 끄면 앱이 삭제. 여기는 앱을 안 거치고 제거한 경우의 안전망.)
// 이 패키지는 상주 서비스가 없어 start/stop 훅을 두지 않는다 — 타이머 정리는 uninstall에서만 한다.
(function removeTimers() {
  try {
    var http = require('@jsh/http');
    var fs = require('fs');
    var path = require('path');
    var process = require('process');

    var cfgDir = path.join(path.resolve(path.dirname(process.argv[1]), '..'), 'cgi-bin', 'config');

    var user = 'SYS', pass = 'MANAGER';
    try {
      var authPath = path.join(cfgDir, 'neo-auth.json');
      if (fs.existsSync(authPath)) {
        var a = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        if (a && a.user) user = a.user;
        if (a && a.password != null) pass = a.password;
      }
    } catch (e) { /* 기본 계정 사용 */ }

    /* 포트는 감시자가 확정해 남긴 값을 쓴다 — 여기서는 알아낼 방법이 없다(jsh에 env가 없고
       psutil도 listening 포트를 열거하지 않는다). 감시자는 서버 안에서 127.0.0.1에 실제로
       붙어 보고 성공한 포트만 적으므로, 프록시 뒤라 브라우저가 본 포트가 달랐어도 맞는 값이다.
       파일이 없으면 기본 포트로 시도한다 — 감시자가 돈 적이 없다는 뜻이고, 그러면 지울 타이머도
       대개 없다(타이머를 만든 적이 있어야 감시자가 생긴다). */
    var port = '5654';   // watchdog.js DEFAULT_PORT와 같아야 한다
    try {
      var epPath = path.join(cfgDir, 'neo-endpoint.json');
      if (fs.existsSync(epPath)) {
        var ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
        if (ep && ep.ok && ep.port) port = String(ep.port);
      }
    } catch (e) { /* 기본 포트 사용 */ }

    var base = 'http://127.0.0.1:' + port;
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
    // 이름은 cgi-bin/db/db.js의 MON_TIMER·BAND_TIMER·WD_TIMER와 같아야 한다
    if (token) {
      ['NEO_VIBE_MONITOR', 'NEO_VIBE_BAND', 'NEO_VIBE_WD'].forEach(function (name) {
        /* 멈추고 지운다 — db.js의 deleteTimer와 같은 규칙이다. 삭제만으로 실행 중인 회차가
           멎는다는 보장이 없는데, 여기는 곧 TQL 파일까지 사라지는 자리라 남아 돌면 주기마다 실패한다.
           없는 타이머에 보내면 500이지만 응답을 보지 않는다 — 지울 것이 남지 않는 쪽이 중요하다. */
        try {
          req('POST', base + '/web/api/timers/' + name + '/state',
            { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, JSON.stringify({ state: 'stop' }));
        } catch (e) { /* 정지 실패해도 삭제는 시도한다 */ }
        try { req('DELETE', base + '/web/api/timers/' + name, { 'Authorization': 'Bearer ' + token }); } catch (e) { /* 다음 것을 계속 지운다 */ }
      });
    }
  } catch (e) { /* 안전망 — 정리 실패가 uninstall을 막지 않는다 */ }
})();

console.println('neo-pkg-vibe-analytics uninstalled. data/ 디렉터리는 보존됩니다.');
