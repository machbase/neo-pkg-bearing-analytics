'use strict';

// pkg run uninstall — 패키지 파일 삭제는 Neo가 수행, 사용자 데이터(전용 DB NEO_BEARING_STORE)는 건드리지 않음
// 타이머(감시·대역 추출·감시자)는 패키지 밖(Neo 등록부)에 남고 실행할 TQL은 패키지 안이라 여기서 제거(고아 타이머 방지)
// 로그인은 제거를 실행한 사용자의 세션(@jsh/session) — 계정·비밀번호를 코드에 두지 않음
// 세션을 못 얻거나 로그인 실패면 삭제 없이 안내만. 상주 서비스가 없어 start/stop 훅 없음
var PREFIXES = ['NEO_BEARING_MONITOR', 'NEO_BEARING_BAND', 'NEO_BEARING_WD',
  'NEO_VIBE_MONITOR', 'NEO_VIBE_BAND', 'NEO_VIBE_WD'];   // 옛 이름 포함
var GUIDE = '다른 계정이 등록한 NEO_BEARING_* 타이머는 그 계정으로 앱에서 알람을 끄거나, Neo 타이머 화면에서 멈춘 뒤 삭제하세요';
var GUIDE_ALL = '남은 NEO_BEARING_* 타이머는 각 계정으로 앱에서 알람을 끄거나, Neo 타이머 화면에서 멈춘 뒤 삭제하세요';

// 정리 실패가 제거를 막지 않음 — 어떤 오류든 안내로 끝냄
(function () {
  try { removeTimers(); } catch (e) { console.println('  타이머 정리 중 오류(' + (e && e.message || e) + ') — ' + GUIDE_ALL); }
})();

function removeTimers() {
  var http, sess, cfg;
  try {
    http = require('@jsh/http');
    sess = require('@jsh/session');
    cfg = sess.getHttpConfig ? sess.getHttpConfig() : null;
  } catch (e) { cfg = null; }
  // 세션 주소 — host:port 한 칸으로 오면 나눔, 모든 인터페이스(0.0.0.0)로 떠 있으면 같은 호스트로 접속
  var host = String((cfg && cfg.host) || ''), port = cfg && cfg.port;
  var hp = /^(.*):(\d+)$/.exec(host);
  if (hp && !port) { host = hp[1]; port = hp[2]; }
  if (!cfg || !port) {
    console.println('  타이머를 자동으로 지우지 못했습니다(실행 세션 정보 없음) — ' + GUIDE_ALL);
    return;
  }
  if (host === '0.0.0.0' || host === '::' || host === '') host = '127.0.0.1';
  var base = (cfg.protocol || 'http') + '://' + host + ':' + port;
  var client = http.NewClient();
  function req(method, url, headers, body) {
    var r = http.NewRequest(method, url);
    if (headers) Object.keys(headers).forEach(function (k) { r.header.set(k, headers[k]); });
    if (body) r.writeString(body);
    var resp = client.do(r);
    var t = ''; try { t = resp.string(); } catch (e) { /* 빈 응답 */ }
    return t;
  }

  // 세션 토큰이 있으면 그대로, 없으면 세션 계정으로 로그인
  var token = '';
  try { token = (sess.getHttpAccessToken && sess.getHttpAccessToken()) || ''; } catch (e) { token = ''; }
  if (!token && cfg.user) {
    try {
      var lg = JSON.parse(req('POST', base + '/web/api/login', { 'Content-Type': 'application/json' },
        JSON.stringify({ loginName: cfg.user, password: cfg.password })));
      token = (lg && lg.accessToken) || '';
    } catch (e) { token = ''; }
  }
  if (!token) {
    console.println('  타이머를 자동으로 지우지 못했습니다(로그인 실패) — ' + GUIDE_ALL);
    return;
  }

  /* 타이머 API = JSON-RPC(POST /web/api/rpc) — params는 배열, stop/delete는 이름이 아닌 id
     목록은 로그인 계정의 것만 보임 */
  var rpcId = 0;
  function rpc(method, params) {
    var out = req('POST', base + '/web/api/rpc', { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: method, params: params || [] }));
    var j = JSON.parse(out);
    if (j && j.error) throw new Error(j.error.message || 'rpc error');
    return j ? j.result : null;
  }
  var targets = [];
  try {
    var list = rpc('timer.list', []) || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t || !t.name) continue;
      for (var p = 0; p < PREFIXES.length; p++) {
        if (String(t.name).indexOf(PREFIXES[p]) === 0) { targets.push(t); break; }
      }
    }
  } catch (e) {
    console.println('  타이머 목록을 읽지 못했습니다(' + e.message + ') — ' + GUIDE_ALL);
    return;
  }
  var done = [], failed = [];
  for (var k = 0; k < targets.length; k++) {
    // 멈춘 뒤 삭제 — 삭제만으론 실행 중인 회차가 멎는다는 보장 없음
    try { rpc('timer.stop', [targets[k].id]); } catch (e) { /* 정지 실패해도 삭제 시도 */ }
    try { rpc('timer.delete', [targets[k].id]); done.push(targets[k].name); } catch (e) { failed.push(targets[k].name); }
  }
  var who = cfg.user ? String(cfg.user).toUpperCase() : '현재 계정';
  console.println('  ' + who + ' 계정 타이머 ' + (done.length ? done.length + '개 삭제: ' + done.join(', ') : '없음')
    + (failed.length ? ' · 삭제 실패: ' + failed.join(', ') : ''));
  console.println('  ' + GUIDE);
}

console.println('neo-pkg-bearing-analytics uninstalled. data/ 디렉터리는 보존됩니다.');
