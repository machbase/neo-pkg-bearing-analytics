// Gemini 단발 completion 클라이언트
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VibeLLM = root.VibeLLM || {}).gemini = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE_URL = 'https://generativelanguage.googleapis.com';
  var DEFAULT_MODEL = 'gemini-2.5-flash';

  function complete(cfg, prompt, opts) {
    opts = opts || {}; // opts.signal — 호출자 중단용(리포트 생성 중단)
    var model = cfg.model || DEFAULT_MODEL;
    var body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    return fetch(BASE_URL + '/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(cfg.apiKey || ''), {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json' },
      body: body,
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error('[Gemini] HTTP ' + r.status + ': ' + (j.error && j.error.message ? j.error.message : ''));
        var cand = j.candidates && j.candidates[0];
        var out = '';
        if (cand && cand.content && cand.content.parts) cand.content.parts.forEach(function (p) { if (p.text) out += p.text; });
        return out.trim();
      });
    });
  }

  return { complete: complete, DEFAULT_MODEL: DEFAULT_MODEL };
});
