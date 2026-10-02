// Claude 단발 completion 클라이언트(도구 호출·스트리밍 없음)
// 브라우저 직접 호출 — anthropic-dangerous-direct-browser-access 헤더로 CORS 허용
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VibeLLM = root.VibeLLM || {}).claude = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE_URL = 'https://api.anthropic.com';
  var DEFAULT_MODEL = 'claude-sonnet-4-5';

  function complete(cfg, prompt, opts) {
    opts = opts || {}; // opts.signal — 호출자 중단용(리포트 생성 중단)
    var body = JSON.stringify({
      model: cfg.model || DEFAULT_MODEL,
      max_tokens: 2048,
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
        return out.trim();
      });
    });
  }

  return { complete: complete, DEFAULT_MODEL: DEFAULT_MODEL };
});
