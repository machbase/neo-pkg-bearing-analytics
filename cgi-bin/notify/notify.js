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
    if (/discord(app)?\.com\/api\/webhooks/i.test(u)) {
      /* embed — 제목·본문·심각도 색 막대. 평문 5줄이 연달아 쌓이면 등급이 눈에 안 들어온다.
         색은 앱 팔레트와 같게(주의 호박 · 위험 주황 · 심각 적색 · 복귀 녹색). */
      var g = (msg.event || {}).gradeKo || '';
      var color = g === '심각' ? 0xe5484d : g === '위험' ? 0xe07b39 : g === '주의' ? 0xd99a2b : 0x3aa76d;
      var body = String(msg.text || '').split('\n').slice(1).join('\n');   // 첫 줄(제목)은 title로 가므로 뺀다
      return { embeds: [{ title: msg.subject, description: body, color: color }] };
    }
    if (/webhook\.office\.com|office\.com\/webhookb2|logic\.azure\.com/i.test(u)) return { text: msg.text };
    // Google Chat은 text만 — protobuf 기반이라 모르는 필드(content 등)가 있으면 400으로 거부한다
    if (/chat\.googleapis\.com/i.test(u)) return { text: msg.text };
    return {
      text: msg.text, content: msg.text,      // 범용 메시지 필드
      subject: msg.subject, body: msg.html,   // 메일형(Apps Script 등)
      event: msg.event || null,               // 구조화 데이터 — 자체 엔드포인트용
    };
  }

  /* 이벤트 → 사람이 읽는 문구. ev: {alias, tag, table, typeKo, gradeKo, val, lim, unit, etype, detail, timeText}
     제목 한 줄에 판정의 전부(등급·설비·유형)를 담고 본문은 값과 시각만 — 같은 정보를 두 번 적지 않는다.
     값 줄은 유형마다 다르다. 유형과 무관하게 측정값/기준 틀로 찍으면 계측 이상이 "측정값 0.000"으로
     나가는데(0은 자리 채움이지 측정이 아니다), 받는 쪽은 그걸 측정값으로 읽는다. */
  function eventMessage(ev) {
    var when = ev.timeText || '';
    var et = ev.etype || '';
    var name = (ev.alias || ev.tag) + (ev.tag && ev.alias && ev.alias !== ev.tag ? ' (' + ev.tag + ')' : '');
    var subject = '[' + (ev.gradeKo || '알람') + '] ' + name + ' · ' + (ev.typeKo || '');
    var vline;
    if (et === 'sensor_fault' || et === 'sensor_ok' || et === 'signal_lost') {
      vline = ev.detail || '';   // 지표값이 없는 유형 — 사유만 (없으면 제목이 전부다)
    } else if (et === 'band' || et === 'bandrec') {
      // 대역은 val이 이미 알람 기준 대비 비율이다(lim=1) — "측정값 3.120 / 기준 1.000"은 오독을 만든다
      vline = '알람 기준 대비 ×' + Number(ev.val || 0).toFixed(2) + (ev.detail ? '\n' + ev.detail : '');
    } else {
      var val = (ev.val == null ? '-' : Number(ev.val).toFixed(3)) + (ev.unit ? ' ' + ev.unit : '');
      var lim = (ev.lim == null ? '' : Number(ev.lim).toFixed(3));
      var ratio = (ev.val > 0 && ev.lim > 0) ? '  (기준의 ×' + (ev.val / ev.lim).toFixed(2) + ')' : '';
      // 기준 숫자가 없는 행(원본 단위 표기)은 등급 근거를 말로 붙인다
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
  /* 원본 단위로 적는 등급 이벤트의 근거 문구 — 예: "ISO 위험 구간 · 결함 패턴 외륜(BPFO)".
     가속도·변위 태그는 등급을 속도 ISO로 매기므로 원본 단위의 "기준" 숫자가 없다. 그래서 판정기가
     DETAIL 머리에 'ISO <존> 구간'을 적고, 결함 부위는 judgeDetail의 '격자 r · 부위' 순서에서 읽는다.
     화면(이벤트 목록·내보내기)과 알림 문구가 이 함수 하나로 같은 말을 한다. */
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

  // 이 이벤트를 이 채널로 보낼 것인가 — 앱·서버 공통 규칙(서버 TQL도 이 소스를 임베드).
  //  cfg: { channels:{webhook:{on,to}}, routes:{주의|위험|심각: {timing}} }
  //  판정은 timing 하나: '즉시'만 발송, '알림 안 함'(옛 저장본의 '무시' 포함)은 미발송.
  //  긍정 나열이 아니라 부정 나열인 이유: 나중에 '묶음'이 생겨도 이 함수를 안 고치게.
  function shouldNotify(gradeKo, etype, ch, cfg) {
    cfg = cfg || {};
    /* ⚠ 함수 안에 둔다 — 이 함수는 서버 TQL에 문자열로 임베드되어 바깥 이름을 볼 수 없다
       (gateFromRaw의 BLOCK 배열과 같은 이유). 앱 쪽 ROUTE_ORDER와 문자열이 일치해야 한다. */
    var HEALTH_KEY = '감시 이상';
    var c = (cfg.channels || {})[ch];
    if (!c || !c.on || !c.to) return false;
    /* 조짐(observe)은 발송하지 않는다 — 1회차라 아직 확정이 아니다.
       내보내면 2회차 확정 규칙이 알림 건수를 하나도 줄이지 못한다: 단발도 그대로 나가고,
       진짜 이탈은 조짐+확정 2건이 되며, 경계에서 깜빡이는 태그는 스칠 때마다 나간다
       (sustained와 달리 재알림 주기 제한도 없다). 이력·화면에는 그대로 남는다. */
    if (etype === 'observe') return false;
    var routes = cfg.routes || {};
    var routed = function (k) { var r = routes[k]; return !!(r && r.timing !== '무시' && r.timing !== '알림 안 함'); };
    /* 감시 건강은 **설비 등급이 아니다** — "이 설비가 얼마나 나쁜가"가 아니라 "이 값을 믿을 수 있는가"다.
       두절·계측 이상에 붙은 gi는 이벤트 구조에 등급 칸이 있어서 채운 값이지 심각도가 아닌데,
       그게 등급 라우팅을 타는 바람에 기본값(주의=알림 안 함)에 걸려 **한 건도 발송되지 않았다**
       (실측: 이력 271건 · 발송 0건). 감시가 눈을 감아도 아무도 모르는 상태가 최악의 실패 모드다. */
    if (etype === 'signal_lost' || etype === 'sensor_fault' || etype === 'sensor_ok') return routed(HEALTH_KEY);
    /* 해제 통지는 등급이 '양호'라 라우팅 표에 행이 없다 — 예외를 두지 않으면 이탈 알림만 가고
       해제는 영영 안 간다. */
    if (etype === 'recovery' || etype === 'bandrec') return routed('주의') || routed('위험') || routed('심각');
    return routed(gradeKo);
  }

  /* 한 판정 회차에서 발송할 것을 정한다 — 거르고(shouldNotify), 필요하면 묶는다.

     묶는 이유는 빈도가 아니라 **동시성**이다. 수집이 끊기면 전 태그가 같은 회차에 두절을 내는데
     (실측: 09:27에 91건 · 12:07에 60건), 그걸 하나씩 보내면 채널 한도에 걸려 임의의 일부만 도착한다
     (Slack 초당 1건 · Discord 2초 5건). "91대 두절"이 "무작위 8대 두절"로 도착하면
     나머지는 멀쩡한 줄 알게 되므로, 전부 안 오는 것보다 나쁘다.

     BUNDLE_MIN 이하는 개별로 보낸다 — 설비 두세 대는 태그·값·기준까지 보이는 쪽이 쓸모 있다.
     ⚠ 이력은 항상 개별로 저장된다. 묶음은 **발송 형태**일 뿐 이벤트를 합치지 않는다. */
  function planNotifications(evs, cfg, ch, timeText) {
    /* ⚠ 함수 안에 둔다 — 이 함수는 서버 TQL에 문자열로 임베드되어 바깥 이름을 볼 수 없다.
       밖에 두면 서버에서만 ReferenceError가 나고 앱·테스트는 멀쩡해 발견이 늦다. */
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

  /* 묶음 메시지 — 규모(몇 대)와 분포(어느 테이블)를 먼저 준다. 태그 이름을 다 나열하면
     채널에서 잘리고, 잘린 목록은 "이게 전부"로 읽혀 규모를 오독하게 한다. */
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
    if (g[0].detail) lines.push(g[0].detail);      // 같은 유형이라 사유가 같다(예: "6분 무수신")
    if (timeText) lines.push(timeText);
    return { subject: subject, text: lines.join('\n'), event: { etype: g[0].etype, gradeKo: g[0].gradeKo, n: g.length } };
  }

  /* 저장된 알림 설정(monitor 도메인 원본: notifCh·notifTo·routes) → 발송 판정용 cfg.
     앱(_notifyCfg)과 서버(발송 때 계정 설정 표에서 읽은 값)가 이 함수 하나로 만든다 —
     따로 만들면 라우팅 기본값이 한쪽에서만 바뀌어 화면 체크 상태와 실제 발송이 갈린다.
     defs: { order:[행 이름…], timing:{행: 기본 timing} } — 미설정 행은 기본값으로 채운다. */
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

  /* 설정 표(CONFIG)의 조각 행 → 한 도메인의 객체. rows: [[K, VAL], …]
     저장 형식은 db.js writeDomain — 키 'cfg:<도메인>#<순번>', 값은 URI 인코딩 문자열을 순번대로 자른 조각.
     행이 없으면 저장한 적이 없는 것이라 빈 객체(오류 아님)다. 조각이 빠졌거나 해독이 안 되면
     오류로 돌려준다 — 빈 설정으로 읽으면 "알림 꺼짐"과 구별되지 않아 미발송이 조용히 묻힌다. */
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
  //  · esc·row는 eventMessage의 의존이라 함께 넣는다(toString은 모듈 스코프를 포함하지 않으므로).
  //  · IIFE로 감싸는 이유: 내부 esc가 호출측(monitor의 SQL용 esc)과 이름이 겹쳐 덮어쓰는 사고를 막는다.
  //  · f.name으로 재노출하는 이유: 빌드 시 미니파이로 함수명이 바뀌어도 호출측이 쓰는 고정 이름에 바인딩되도록.
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
    // 테스트·화면 표시용 사본 — 함수 안 값(임베드 대상)과 같아야 한다. test-notifyroute가 일치를 검사한다.
    BUNDLE_MIN: 5,
    buildWebhookTql: buildWebhookTql, serverSrc: serverSrc,
  };
});
