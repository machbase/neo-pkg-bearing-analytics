// notify/notify.js — 알림 발송(웹훅) 페이로드·TQL 생성기
// 발송은 항상 서버에서: 앱 모드는 브라우저 → TQL $.request, 서버 모드는 타이머 TQL이 직접
// (브라우저 직접 POST는 CORS 차단·웹훅 URL 노출)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeNotify = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 대상별 페이로드 — URL로 서비스 판별(Slack·Teams·Google Chat = text, Discord = embeds), 그 외는 전 필드 포함
  function payloadFor(msg, url) {
    var u = String(url || '');
    if (/hooks\.slack\.com/i.test(u)) return { text: msg.text };
    if (/discord(app)?\.com\/api\/webhooks/i.test(u)) {
      // embed — 제목·본문·심각도 색 막대(앱 팔레트: 주의 호박·위험 주황·심각 적색·그 외 녹색)
      var g = (msg.event || {}).gradeKo || '';
      var color = g === '심각' ? 0xe5484d : g === '위험' ? 0xe07b39 : g === '주의' ? 0xd99a2b : 0x3aa76d;
      var body = String(msg.text || '').split('\n').slice(1).join('\n');   // 첫 줄(제목)은 title로
      return { embeds: [{ title: msg.subject, description: body, color: color }] };
    }
    if (/webhook\.office\.com|office\.com\/webhookb2|logic\.azure\.com/i.test(u)) return { text: msg.text };
    // Google Chat은 text만 — 모르는 필드(content 등)가 있으면 400
    if (/chat\.googleapis\.com/i.test(u)) return { text: msg.text };
    return {
      text: msg.text, content: msg.text,      // 범용 메시지 필드
      subject: msg.subject, body: msg.html,   // 메일형(Apps Script 등)
      event: msg.event || null,               // 구조화 데이터 — 자체 엔드포인트용
    };
  }

  /* 이벤트 → 사람이 읽는 문구. ev: {alias, tag, table, typeKo, gradeKo, val, lim, unit, etype, detail, timeText}
     제목 = 등급·설비·유형, 본문 = 값 줄·시각. 값 줄은 유형별(지표값 없는 유형은 사유만) */
  function eventMessage(ev) {
    var when = ev.timeText || '';
    var et = ev.etype || '';
    var name = (ev.alias || ev.tag) + (ev.tag && ev.alias && ev.alias !== ev.tag ? ' (' + ev.tag + ')' : '');
    var subject = '[' + (ev.gradeKo || '알람') + '] ' + name + ' · ' + (ev.typeKo || '');
    var vline;
    if (et === 'sensor_fault' || et === 'sensor_ok' || et === 'signal_lost') {
      vline = ev.detail || '';   // 지표값이 없는 유형 — 사유만
    } else if (et === 'band' || et === 'bandrec') {
      // 대역은 val이 알람 기준 대비 비율(lim=1)
      vline = '알람 기준 대비 ×' + Number(ev.val || 0).toFixed(2) + (ev.detail ? '\n' + ev.detail : '');
    } else {
      var val = (ev.val == null ? '-' : Number(ev.val).toFixed(3)) + (ev.unit ? ' ' + ev.unit : '');
      var lim = (ev.lim == null ? '' : Number(ev.lim).toFixed(3));
      var ratio = (ev.val > 0 && ev.lim > 0) ? '  (기준의 ×' + (ev.val / ev.lim).toFixed(2) + ')' : '';
      // 기준 숫자 없는 행(원본 단위 표기)은 등급 근거를 문구로
      var basis = ev.lim == null ? basisText(ev.detail) : '';
      vline = val + (lim ? ' / 기준 ' + lim : '') + ratio + (basis ? ' · ' + basis : '');
    }
    var text = subject + (vline ? '\n' + vline : '') + '\n' + when;
    var html = '<div style="font-family:sans-serif">'
      + '<h3 style="margin:0 0 8px">' + esc(subject) + '</h3>'
      + '<table cellpadding="4" style="border-collapse:collapse;font-size:14px">'
      + (vline ? row(et === 'band' || et === 'bandrec' ? '판정' : (et === 'sensor_fault' || et === 'sensor_ok' || et === 'signal_lost') ? '사유' : '측정값', vline.replace(/\n/g, ' · ')) : '')
      + row('발생', when)
      + '</table></div>';
    return { subject: subject, text: text, html: html, event: ev };
  }
  /* 원본 단위 등급 이벤트의 근거 문구(예: "ISO 위험 구간 · 결함 패턴 외륜(BPFO)") —
     DETAIL의 'ISO <존> 구간'과 '격자 r · 부위' 순서에서 추출. 화면·알림 공용 */
  function basisText(detail) {
    var segs = String(detail || '').split(' · '), zone = '', key = '', i;
    for (i = 0; i < segs.length; i++) {
      if (!zone && /^ISO .+ 구간$/.test(segs[i])) zone = segs[i];
      if (!key && /^격자 /.test(segs[i]) && segs[i + 1] && !/회차|확정|재알림|복귀|판정 창/.test(segs[i + 1])) key = segs[i + 1];
    }
    return zone + (key ? (zone ? ' · ' : '') + '결함 패턴 ' + key : '');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function row(k, v) { return '<tr><td style="color:#666">' + esc(k) + '</td><td><b>' + esc(v) + '</b></td></tr>'; }

  // 이 이벤트를 이 채널로 보낼지 — 앱·서버 공통 규칙(서버 TQL에 임베드)
  //  cfg: { channels:{webhook:{on,to}}, routes:{주의|위험|심각|감시 이상: {timing}} }
  //  timing이 '알림 안 함'(옛 저장본 '무시' 포함)이 아니면 발송
  function shouldNotify(gradeKo, etype, ch, cfg) {
    cfg = cfg || {};
    // ⚠ 함수 안에 둠(임베드 소스라 바깥 이름 참조 불가). 앱 ROUTE_ORDER와 문자열 일치 필요
    var HEALTH_KEY = '감시 이상';
    var c = (cfg.channels || {})[ch];
    if (!c || !c.on || !c.to) return false;
    // 조짐(observe)은 미확정(1회차)이라 미발송 — 이력·화면에는 남음
    if (etype === 'observe') return false;
    var routes = cfg.routes || {};
    var routed = function (k) { var r = routes[k]; return !!(r && r.timing !== '무시' && r.timing !== '알림 안 함'); };
    // 감시 건강(두절·계측 이상)은 설비 등급이 아님 — gi와 무관하게 '감시 이상' 행으로 라우팅
    if (etype === 'signal_lost' || etype === 'sensor_fault' || etype === 'sensor_ok') return routed(HEALTH_KEY);
    // 해제 통지는 등급이 '양호'라 행이 없음 — 등급 행 중 하나라도 켜져 있으면 발송
    if (etype === 'recovery' || etype === 'bandrec') return routed('주의') || routed('위험') || routed('심각');
    return routed(gradeKo);
  }

  /* 한 판정 회차의 발송 목록 — 거르고(shouldNotify) 같은 유형·등급을 묶음.
     동시 다발 이벤트를 개별 발송하면 채널 한도(Slack 초당 1건·Discord 2초 5건)에 걸려 일부만 도착.
     BUNDLE_MIN 미만은 개별. ⚠ 묶음은 발송 형태일 뿐, 이력은 항상 개별 저장 */
  function planNotifications(evs, cfg, ch, timeText) {
    // ⚠ 함수 안에 둠 — 임베드 소스라 바깥 이름은 서버에서만 ReferenceError
    var BUNDLE_MIN = 5;
    var out = [], groups = {}, order = [], i;
    for (i = 0; i < (evs || []).length; i++) {
      var e = evs[i];
      if (!shouldNotify(e.gradeKo, e.etype, ch, cfg)) continue;
      var k = e.etype + '|' + (e.gradeKo || '');
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(e);
    }
    for (i = 0; i < order.length; i++) {
      var g = groups[order[i]];
      if (g.length < BUNDLE_MIN) {
        for (var j = 0; j < g.length; j++) out.push(eventMessage(g[j]));
      } else out.push(bundleMessage(g, timeText));
    }
    return out;
  }

  // 묶음 메시지 — 규모(몇 대)·분포(테이블별 상위 3 + 나머지), 태그 이름은 나열 안 함(잘리면 규모 오독)
  function bundleMessage(g, timeText) {
    var byTbl = {}, tbls = [], i;
    for (i = 0; i < g.length; i++) {
      var t = g[i].table || '(미상)';
      if (byTbl[t] == null) { byTbl[t] = 0; tbls.push(t); }
      byTbl[t]++;
    }
    tbls.sort(function (a, b) { return byTbl[b] - byTbl[a]; });
    var head = tbls.slice(0, 3).map(function (t) { return t + ' ' + byTbl[t]; });
    var rest = 0;
    for (i = 3; i < tbls.length; i++) rest += byTbl[tbls[i]];
    if (rest) head.push('외 ' + rest);
    var ko = g[0].typeKo || g[0].etype || '';
    var subject = '[' + (g[0].gradeKo || '알람') + '] ' + ko + ' ' + g.length + '대';
    var lines = [subject, head.join(' · ')];
    if (g[0].detail) lines.push(g[0].detail);      // 같은 유형이라 사유 공통(예: "6분 무수신")
    if (timeText) lines.push(timeText);
    return { subject: subject, text: lines.join('\n'), event: { etype: g[0].etype, gradeKo: g[0].gradeKo, n: g.length } };
  }

  /* 저장된 알림 설정(monitor 영역: notifCh·notifTo·routes) → 발송 판정용 cfg. 앱·서버 공용
     defs: { order:[행 이름…], timing:{행: 기본 timing} } — 미설정 행은 기본값 */
  function notifyCfgFrom(raw, defs) {
    raw = raw || {}; defs = defs || {};
    var ch = raw.notifCh || {}, to = raw.notifTo || {}, routes = raw.routes || {};
    var order = defs.order || [], timing = defs.timing || {}, out = {};
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      out[k] = routes[k] ? routes[k] : { timing: timing[k] };
    }
    return { channels: { webhook: { on: !!ch.webhook, to: to.webhook || '' } }, routes: out };
  }

  /* 설정 표(CONFIG) 조각 행 → 한 영역의 객체. rows: [[K, VAL], …]
     형식은 db.js writeDomain — 키 'cfg:<영역>#<순번>', 값은 URI 인코딩 문자열 조각.
     행 없음 = 빈 객체(오류 아님), 조각 누락·해독 실패 = 오류(빈 설정과 구분) */
  function configFromRows(rows, domain) {
    var re = /^cfg:(.+)#(\d+)$/, parts = [], n = 0, i;
    for (i = 0; i < (rows || []).length; i++) {
      var m = re.exec(String(rows[i][0]));
      if (!m || m[1] !== domain) continue;
      parts[+m[2]] = String(rows[i][1] == null ? '' : rows[i][1]);
      n++;
    }
    if (!n) return { obj: {}, err: '' };
    for (i = 0; i < parts.length; i++) {
      if (parts[i] == null) return { obj: null, err: '설정 조각 누락(' + i + '번)' };
    }
    try {
      var o = JSON.parse(decodeURIComponent(parts.join('')));
      return (o && typeof o === 'object') ? { obj: o, err: '' } : { obj: null, err: '설정 형식 오류' };
    } catch (e) { return { obj: null, err: '설정 해독 실패' }; }
  }

  // 웹훅 POST TQL — url·body는 JSON.stringify로 JS 문자열 리터럴화
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

  // 서버(타이머 TQL)에 인라인할 소스 — 앱과 같은 함수를 그대로 심음
  //  · 의존 함수(basisText·esc·row 등)도 함께(toString은 모듈 스코프 미포함)
  //  · IIFE — 내부 esc와 호출측(monitor의 SQL용 esc) 이름 충돌 방지
  //  · f.name으로 재노출 — 미니파이로 함수명이 바뀌어도 고정 이름에 바인딩
  function serverSrc() {
    var decls = [basisText, esc, row, eventMessage, payloadFor, shouldNotify, bundleMessage, planNotifications,
      notifyCfgFrom, configFromRows]
      .map(function (f) { return f.toString(); }).join('\n');
    return 'var __NF=(function(){\n' + decls + '\n'
      + 'return {em:' + eventMessage.name + ',pf:' + payloadFor.name + ',sn:' + shouldNotify.name
      + ',pn:' + planNotifications.name + ',bm:' + bundleMessage.name
      + ',nc:' + notifyCfgFrom.name + ',cr:' + configFromRows.name + '};\n'
      + '})();\n'
      + 'var eventMessage=__NF.em, payloadFor=__NF.pf, shouldNotify=__NF.sn,'
      + ' planNotifications=__NF.pn, bundleMessage=__NF.bm, notifyCfgFrom=__NF.nc, configFromRows=__NF.cr;';
  }

  return {
    payloadFor: payloadFor, eventMessage: eventMessage, shouldNotify: shouldNotify,
    planNotifications: planNotifications, bundleMessage: bundleMessage,
    notifyCfgFrom: notifyCfgFrom, configFromRows: configFromRows, basisText: basisText,
    // 테스트·화면 표시용 사본 — planNotifications 안 값과 일치 필요
    BUNDLE_MIN: 5,
    buildWebhookTql: buildWebhookTql, serverSrc: serverSrc,
  };
});
