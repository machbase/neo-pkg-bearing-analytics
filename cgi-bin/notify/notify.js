// notify/notify.js — 알림 발송(웹훅) 페이로드·TQL 생성기.
// 발송은 항상 서버에서 실행한다: 앱 모드는 브라우저 → /db/tql → $.request, 서버 모드는 타이머 TQL이 직접.
// (브라우저가 웹훅으로 직접 POST하면 CORS에 막히고 URL(=시크릿)이 노출된다.)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeNotify = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 대상별 페이로드 — Slack(text)·Discord(content)는 서로 배타적이라 URL로 판별해 맞춰 보낸다.
  // 그 외(자체 엔드포인트·Apps Script 등)는 골라 쓸 수 있게 전부 담는다.
  function payloadFor(msg, url) {
    var u = String(url || '');
    if (/hooks\.slack\.com/i.test(u)) return { text: msg.text };
    if (/discord(app)?\.com\/api\/webhooks/i.test(u)) return { content: msg.text };
    if (/webhook\.office\.com|office\.com\/webhookb2|logic\.azure\.com/i.test(u)) return { text: msg.text };
    return {
      text: msg.text, content: msg.text,      // 범용 메시지 필드
      subject: msg.subject, body: msg.html,   // 메일형(Apps Script 등)
      event: msg.event || null,               // 구조화 데이터 — 자체 엔드포인트용
    };
  }

  // 이벤트 → 사람이 읽는 문구. ev: {alias, tag, table, typeKo, gradeKo, val, lim, unit, ts}
  function eventMessage(ev) {
    var when = ev.timeText || '';
    var val = (ev.val == null ? '' : Number(ev.val).toFixed(3)) + (ev.unit ? ' ' + ev.unit : '');
    var lim = (ev.lim == null ? '' : Number(ev.lim).toFixed(3));
    var subject = '[' + (ev.gradeKo || '알람') + '] ' + (ev.alias || ev.tag) + ' · ' + (ev.typeKo || '');
    var text = subject + '\n'
      + '설비/태그: ' + (ev.alias || ev.tag) + (ev.tag && ev.alias && ev.alias !== ev.tag ? ' (' + ev.tag + ')' : '') + '\n'
      + '등급: ' + (ev.gradeKo || '-') + '   유형: ' + (ev.typeKo || '-') + '\n'
      + '측정값: ' + val + '   기준: ' + lim + '\n'
      + '발생: ' + when;
    var html = '<div style="font-family:sans-serif">'
      + '<h3 style="margin:0 0 8px">' + esc(subject) + '</h3>'
      + '<table cellpadding="4" style="border-collapse:collapse;font-size:14px">'
      + row('설비/태그', (ev.alias || ev.tag) + (ev.tag && ev.alias && ev.alias !== ev.tag ? ' (' + ev.tag + ')' : ''))
      + row('등급', ev.gradeKo || '-') + row('유형', ev.typeKo || '-')
      + row('측정값', val) + row('기준', lim) + row('발생', when)
      + '</table></div>';
    return { subject: subject, text: text, html: html, event: ev };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function row(k, v) { return '<tr><td style="color:#666">' + esc(k) + '</td><td><b>' + esc(v) + '</b></td></tr>'; }

  // 이 이벤트를 이 채널로 보낼 것인가 — 앱·서버 공통 규칙(서버 TQL도 이 소스를 임베드).
  //  cfg: { channels:{webhook:{on,to}}, routes:{주의|위험|심각: {webhook:bool, timing}} }
  //  timing '무시'면 미발송. recovery(정상 복귀)는 어느 심각도든 그 채널로 라우팅돼 있으면 발송
  //  — 알람을 받았으면 해제도 알아야 하므로.
  function shouldNotify(gradeKo, etype, ch, cfg) {
    cfg = cfg || {};
    var c = (cfg.channels || {})[ch];
    if (!c || !c.on || !c.to) return false;
    var routes = cfg.routes || {};
    var routed = function (k) { var r = routes[k]; return !!(r && r[ch] && r.timing !== '무시'); };
    if (etype === 'recovery') return routed('주의') || routed('위험') || routed('심각');
    return routed(gradeKo);
  }

  // 웹훅 POST를 수행하는 TQL. url·body는 JSON.stringify로 JS 문자열 리터럴화해 이스케이프 문제를 없앤다.
  function buildWebhookTql(url, payload) {
    return 'SCRIPT({\n'
      + '  var url = ' + JSON.stringify(String(url)) + ';\n'
      + '  var body = ' + JSON.stringify(JSON.stringify(payload)) + ';\n'
      + '  var out = "no-response";\n'
      + '  $.request(url, {method:"POST", headers:{"Content-Type":"application/json"}, body: body})\n'
      + '    .do(function(r){ out = (r.ok ? "OK " : "FAIL ") + r.status; });\n'
      + '  $.yield(out);\n'
      + '})\nCSV()';
  }

  // 서버(타이머 TQL)에 인라인할 소스 — 앱이 쓰는 바로 그 함수를 그대로 심는다(규칙 드리프트 0).
  // esc·row는 eventMessage의 의존이라 함께 넣어야 한다(toString은 모듈 스코프를 포함하지 않으므로).
  function serverSrc() {
    return [esc, row, eventMessage, payloadFor, shouldNotify]
      .map(function (f) { return f.toString(); }).join('\n');
  }

  return {
    payloadFor: payloadFor, eventMessage: eventMessage, shouldNotify: shouldNotify,
    buildWebhookTql: buildWebhookTql, serverSrc: serverSrc,
  };
});
