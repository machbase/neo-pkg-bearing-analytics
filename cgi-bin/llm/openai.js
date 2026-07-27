// OpenAI 단발 completion 클라이언트 — llm-chat llm/chatgpt.js의 요청 형태 이식.
// 주의: OpenAI API는 브라우저 직접 호출(CORS)이 차단될 수 있음 — 실패 시 안내 메시지로 표면화.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VibeLLM = root.VibeLLM || {}).openai = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE_URL = 'https://api.openai.com';
  var DEFAULT_MODEL = 'gpt-4o';

  function complete(cfg, prompt, opts) {
    opts = opts || {}; // signal: 호출자가 중단할 수 있게 (리포트 생성 중단)
    var body = JSON.stringify({
      model: cfg.model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
    });
    return fetch(BASE_URL + '/v1/chat/completions', {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (cfg.apiKey || '') },
      body: body,
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error('[OpenAI] HTTP ' + r.status + ': ' + (j.error && j.error.message ? j.error.message : ''));
        if (j.error) throw new Error('[OpenAI] ' + j.error.message);
        return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
      });
    }).catch(function (e) {
      if (e instanceof TypeError) throw new Error('[OpenAI] 브라우저에서 직접 호출이 차단되었습니다(CORS) — 백엔드 프록시가 필요합니다');
      throw e;
    });
  }

  return { complete: complete, DEFAULT_MODEL: DEFAULT_MODEL };
});
