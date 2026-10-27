// Claude 단발 completion 클라이언트(도구 호출·스트리밍 없음)
// 브라우저 직접 호출 — anthropic-dangerous-direct-browser-access 헤더로 CORS 허용
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VibeLLM = root.VibeLLM || {}).claude = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE_URL = 'https://api.anthropic.com';
  var DEFAULT_MODEL = 'claude-sonnet-4-5';
  /* 출력 한도 — 사고가 기본으로 켜진 모델(Claude 5 세대)은 사고 토큰도 이 한도에서 씀
     · 낮으면 사고만 하다 본문 없이 끝남 · 사고 설정은 모델마다 허용값이 달라 보내지 않음 */
  var MAX_TOKENS = 16000;

  function complete(cfg, prompt, opts) {
    opts = opts || {}; // opts.signal — 호출자 중단용(리포트 생성 중단)
    var body = JSON.stringify({
      model: cfg.model || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
    return fetch(BASE_URL + '/v1/messages', {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: body,
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error('[Claude] HTTP ' + r.status + ': ' + (j.error && j.error.message ? j.error.message : ''));
        var out = '';
        (j.content || []).forEach(function (c) { if (c.type === 'text') out += c.text; });
        out = out.trim();
        // 본문 없이 끝난 사유를 오류로 — 빈 문자열은 호출자가 모델명 문제로 안내함
        if (!out) {
          throw new Error('[Claude] 본문 없이 응답이 끝났습니다 — '
            + (j.stop_reason === 'max_tokens' ? '출력 한도(' + MAX_TOKENS + ' 토큰)를 사고 단계에서 모두 썼습니다'
              : j.stop_reason === 'refusal' ? '모델이 응답을 거절했습니다' + (j.stop_details && j.stop_details.category ? '(' + j.stop_details.category + ')' : '')
                : 'stop_reason ' + (j.stop_reason || '없음')));
        }
        return out;
      });
    });
  }

  return { complete: complete, DEFAULT_MODEL: DEFAULT_MODEL, MAX_TOKENS: MAX_TOKENS };
});
