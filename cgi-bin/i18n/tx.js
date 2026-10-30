// i18n/tx.js — 한국어 원문 키 사전 하나에 묶인 번역기. 화면(frontend i18n.js)·서버 감시 알림(TQL 임베드) 공용
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeTx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* dict: { 한국어 원문: 번역 } · en: 영어(이름(설명) 괄호 앞 띄움)
     반환 { T(키, …인자) 고정 문구, tx(문자열) 이미 만든 한국어 문구, has(키) }
     ⚠ 서버 TQL 임베드(toString) — 바깥 이름 참조 금지, 도움 함수·상수는 전부 안에 */
  function makeTx(dict, en) {
    var HAN = /[가-힣]/;
    var NUM = /-?\d+(?:,\d{3})*(?:\.\d+)?/g;
    var CTX = /\{#[^}]*\}/g;
    var SEP = /\n| · | — |: | → /;
    var SEP_END = /^(?:\n| · | — |: | → )|(?:\n| · | — |: | → )$/g;
    var cache = {}, cacheN = 0, tpls = null;
    dict = dict || {};

    function has(k) { return Object.prototype.hasOwnProperty.call(dict, k); }
    function lookup(k) { return has(k) ? dict[k] : null; }
    function fill(s, args) {
      return s.replace(/\{(\d+)\}/g, function (m, i) { return i < args.length ? String(args[i]) : m; });
    }
    function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    /* 자리표시 키 → 정규식 — 고정부 한글이 2자 미만인 키('{0} ({1})' 등)는 아무 문장에나 맞아 제외
       고정부가 긴 키부터 시도, anchor(가장 긴 고정부)로 먼저 거름
       edge = 키 맨 앞·맨 끝 자리표시의 캡처 번호 — 이어 붙인 문구의 앞뒤 조각을 삼키지 않게 구분자 금지(txOne) */
    function templates() {
      if (tpls) return tpls;
      var list = [];
      Object.keys(dict).forEach(function (key) {
        if (key.indexOf('{') < 0) return;
        var parts = key.split(/\{(\d+)\}/);
        if (parts.length < 3) return;
        var lit = parts.filter(function (p, i) { return i % 2 === 0; });
        if (lit.join('').replace(/[^가-힣]/g, '').length < 2) return;
        var re = '^', order = [];
        parts.forEach(function (p, i) {
          if (i % 2 === 0) re += escRe(p);
          else { re += '([\\s\\S]*?)'; order.push(+p); }
        });
        var anchor = lit.reduce(function (a, b) { return b.length > a.length ? b : a; }, '');
        var edge = [];
        if (parts[0] === '') edge.push(0);
        if (parts[parts.length - 1] === '') edge.push(order.length - 1);
        list.push({ key: key, re: new RegExp(re + '$'), order: order, anchor: anchor, len: lit.join('').length, edge: edge });
      });
      list.sort(function (a, b) { return b.len - a.len; });
      return (tpls = list);
    }

    // 사전 그대로 — 정확 일치 또는 숫자만 {n}으로 바꾼 일치(문형 역매칭 없음)
    function exact(s) {
      var hit = lookup(s);
      if (hit != null) return hit;
      var nums = [];
      var tpl = s.replace(NUM, function (m) { nums.push(m); return '{' + (nums.length - 1) + '}'; });
      if (nums.length) { hit = lookup(tpl); if (hit != null) return fill(hit, nums); }
      return null;
    }

    // strict — 조각 묶음(spans)용: 가장자리 자리표시 값에 구분자가 하나라도 있으면 그 문형 거름
    function txOne(s, strict) {
      var hit = exact(s);
      if (hit != null) return hit;
      var list = templates();
      for (var i = 0; i < list.length; i++) {
        var tp = list[i];
        if (s.indexOf(tp.anchor) < 0) continue;
        var m = tp.re.exec(s);
        if (!m) continue;
        /* '{0} 만에 복귀'가 '격자 3.2 · 외륜 · 1시간 만에 복귀' 전체를 먹는 것 방지 — 조각 묶음(spans)이 원래 단위로 다시 맞춤
           양끝 구분자는 허용(' — 지금은 …'처럼 구분자로 시작하는 꼬리 조각), 가운데 있으면 그 값이 통째로 사전 키일 때만
           ('{0}구간 중 {1}' + '이곳만 · 단발 가능성'). 묶음(strict)은 양끝 구분자도 그 규칙으로 */
        if (tp.edge.some(function (j) {
          var a = strict ? m[j + 1] : m[j + 1].replace(SEP_END, '');
          return SEP.test(a) && exact(a) == null;
        })) continue;
        var args = [];
        tp.order.forEach(function (idx, j) { args[idx] = tx(m[j + 1]); });
        return fill(lookup(tp.key), args);
      }
      return null;
    }

    function balanced(p) { return p.split('(').length === p.split(')').length; }

    /* 조각 묶음 — parts = [글, 구분자, 글, …]. 왼쪽부터 사전에 맞는 가장 긴 연속 구간을 한 단위로 번역
       이어 붙인 문구('플랫라인' + ' — ' + 'σ … — 값이 거의 …')의 원래 키 단위 복원, 안 맞으면 그 조각만 tx
       묶음은 strict — 'ISO {0} 구간{1}'이 'ISO 주의 구간 · 1회차'로 묶여 '1회차 — 확정 전'을 가르는 것 방지 */
    function spans(parts) {
      var out = '', i = 0, n = parts.length, sep = '';
      while (i < n) {
        var j, hit = null;
        // 앞 구분자째 키(' · 정지 의심 {0}구간 제외' 같은 꼬리 문구)부터 — 맞으면 구분자도 번역문에 포함
        if (sep) {
          for (j = n - 1; j >= i; j -= 2) { hit = txOne(sep + parts.slice(i, j + 1).join(''), true); if (hit != null) break; }
          if (hit != null) { out += hit; i = j + 1; sep = i < n ? parts[i++] : ''; continue; }
          out += sep;
        }
        j = i === 0 ? n - 3 : n - 1;   // 전체(0~n-1)는 txOne에서 이미 시도
        for (; j > i; j -= 2) { hit = txOne(parts.slice(i, j + 1).join(''), true); if (hit != null) break; }
        if (hit == null) { j = i; hit = tx(parts[i]); }
        out += hit;
        i = j + 1;
        sep = i < n ? parts[i++] : '';
      }
      return out + sep;
    }

    /* 이미 만들어진 문구 번역 — 진단 엔진 결과·저장된 이벤트 사유·공유 모듈(calc 등)처럼 T()를 못 거친 값
       정확 일치 → 숫자를 {n}으로 바꿔 재조회 → 자리표시 키 역매칭(인자도 tx) → ' · '·' — '·' → '·줄바꿈 조각(사전에 맞는 가장 긴 구간 단위) → 이름(설명) 괄호 앞뒤 */
    function tx(s) {
      if (typeof s !== 'string' || !s || !HAN.test(s)) return s;
      if (cacheN > 5000) { cache = {}; cacheN = 0; }
      if (Object.prototype.hasOwnProperty.call(cache, s)) return cache[s];
      var out = txOne(s);
      if (out == null) {
        var parts = s.split(/(\n+| · | — |: | → |^→ )/);
        // 이름(설명) — 괄호 앞뒤 따로(미입력 정보 '구동방식(직결/벨트/기어 → …)' 등 이어 붙인 문구), 괄호 안에서는 조각 안 자름 · 영어는 괄호 앞 띄움
        var pm = /^([^()]*?[가-힣][^()]*?)(\s*)\((.*[가-힣].*)\)$/.exec(s);
        out = parts.length > 1 && parts.every(balanced) ? spans(parts)
          : pm ? tx(pm[1]) + (pm[2] || (en ? ' ' : '')) + '(' + tx(pm[3]) + ')'
            : parts.length > 1 ? spans(parts) : s;
      }
      cacheN++;
      cache[s] = out;
      return out;
    }

    /* 고정 문구 — 키가 사전에 없으면 원문({#문맥} 꼬리표 제거)
       인자도 tx — 엔진·공유 모듈이 만든 한국어 값(계측 사유·등급어·대역명 등)이 번역 문장 안에 섞이지 않게 */
    function T(key) {
      var args = Array.prototype.slice.call(arguments, 1).map(tx);
      var hit = lookup(key);
      var s = hit != null ? hit : key.replace(CTX, '');
      return args.length ? fill(s, args) : s;
    }

    return { T: T, tx: tx, has: has };
  }

  /* 사전에서 이 소스에 나오는 문구의 키만 — 서버 TQL에 실을 부분 사전(전체는 언어당 200KB)
     키의 한글 고정부가 모두 src 안에 있으면 포함(그 소스가 만들 수 있는 문구의 상위 집합) */
  function pickFor(dict, src) {
    var out = {};
    Object.keys(dict || {}).forEach(function (k) {
      var lits = k.replace(/\{#[^}]*\}/g, '').split(/\{\d+\}/).filter(function (p) { return /[가-힣]/.test(p); });
      if (lits.length && lits.every(function (p) { return src.indexOf(p) >= 0; })) out[k] = dict[k];
    });
    return out;
  }

  return { makeTx: makeTx, pickFor: pickFor };
});
