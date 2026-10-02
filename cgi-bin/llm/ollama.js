// Ollama 단발 completion 클라이언트
// think:false — 네이티브 thinking 모델(qwen3 등)의 사고 토큰 차단
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VibeLLM = root.VibeLLM || {}).ollama = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_MODEL = 'llama3.1:8b';

  function complete(cfg, prompt, opts) {
    opts = opts || {}; // opts.signal — 호출자 중단용(리포트 생성 중단)
    var base = (cfg.baseURL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    var body = JSON.stringify({
      model: cfg.model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 2048 },
    });
    return fetch(base + '/api/chat', {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json' },
      body: body,
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error('[Ollama] HTTP ' + r.status + ': ' + (j.error || ''));
        if (j.error) throw new Error('[Ollama] ' + j.error);
        return (j.message && j.message.content || '').trim();
      });
    }).catch(function (e) {
      if (e instanceof TypeError) throw new Error('[Ollama] 연결 실패 — Ollama 실행 여부와 OLLAMA_ORIGINS(CORS) 설정을 확인하세요');
      throw e;
    });
  }

  return { complete: complete, DEFAULT_MODEL: DEFAULT_MODEL };
});
