// LLM 팩토리 — llm-chat llm/factory.js 대응. 단발 completion 전용(채팅 루프 없음).
// cfg: { provider: 'claude'|'openai'|'gemini'|'ollama', apiKey, model, baseURL(ollama) }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./claude'), require('./openai'), require('./gemini'), require('./ollama'));
  } else {
    var L = root.VibeLLM || {};
    root.VibeLLM = Object.assign(L, factory(L.claude, L.openai, L.gemini, L.ollama));
  }
})(typeof self !== 'undefined' ? self : this, function (claude, openai, gemini, ollama) {
  'use strict';

  var PROVIDERS = { claude: claude, openai: openai, gemini: gemini, ollama: ollama };

  function createLLM(cfg) {
    var p = PROVIDERS[cfg.provider];
    if (!p) return null;
    if (cfg.provider !== 'ollama' && !cfg.apiKey) return null; // ollama는 키 불필요
    return {
      provider: cfg.provider,
      complete: function (prompt, opts) { return p.complete(cfg, prompt, opts); }, // opts.signal로 중단 가능
    };
  }

  // 실제 호출에 쓰일 모델명 — 모델 미입력 시 프로바이더 기본값으로 해석됨
  function activeModel(cfg) {
    var p = PROVIDERS[cfg.provider];
    return p ? (cfg.model || p.DEFAULT_MODEL) : '';
  }

  function testConnection(cfg) {
    var c = createLLM(cfg);
    if (!c) return Promise.reject(new Error('API 키(또는 프로바이더)가 설정되지 않았습니다'));
    var t0 = Date.now();
    return c.complete('연결 테스트입니다. "OK" 한 단어로만 답하세요.').then(function (txt) {
      return { ok: true, ms: Date.now() - t0, sample: String(txt).slice(0, 40) };
    });
  }

  return { createLLM: createLLM, testConnection: testConnection, activeModel: activeModel, PROVIDERS: PROVIDERS };
});
