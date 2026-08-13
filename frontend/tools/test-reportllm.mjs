/* 리포트 LLM 소견의 네 가지 결말 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   "소견 포함을 켰는데 지표만으로 나온다"가 실제로 있었다. 원인은 실패 경로가 전부 조용히
   소견 없음으로 수렴한 것이다 — 리포트에는 결정론 소견(종합 소견·근거표·권고)이 그대로 실리므로
   LLM이 쓴 것처럼 보이고, 보관함만 '지표만'으로 남아 이유를 알 수 없었다.
   실패한 셋(미설정·호출 실패·빈 응답)은 반드시 사유를 남겨야 한다. */
globalThis.window = globalThis;

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// Claude 응답 흉내 — complete()가 실제로 타는 경로(fetch → json → content[].text)를 그대로 쓴다
const stubFetch = (mode, text) => {
  globalThis.fetch = async () => {
    if (mode === 'http') return { ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) };
    if (mode === 'net') throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: text }] }) };
  };
};

const mk = (st) => {
  const a = new App({ seed: 1, equipmentCount: 1 });
  a.setState = function (s) { Object.assign(this.state, s); };
  a._scheduleDraw = () => {}; a._toast = () => {};
  a.E = CH; a.live = true; a.forceUpdate = () => {};
  a._opinionPrompt = () => 'PROMPT'; // 프롬프트 조립은 여기 관심사가 아니다
  a.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  Object.assign(a.state, {
    ready: true, genLLM: true, llmProvider: 'claude',
    llmKeys: { claude: 'sk-test' }, llmModels: { claude: 'claude-sonnet-4-5' },
  }, st || {});
  a._genLlmErr = null;
  return a;
};
const run = (a) => a._reportOpinion({}, {}, {}, null, '2026-08-01', '2026-08-02');

// ── 1. 성공 — 소견이 그대로 돌아오고 사유는 남지 않는다 ────────────────────
{
  stubFetch('ok', '  ## 진동상태요약\n정상입니다.  ');
  const a = mk();
  const op = await run(a);
  chk(op === '## 진동상태요약\n정상입니다.', '성공하면 소견 본문이 돌아온다', JSON.stringify(op));
  chk(a._genLlmErr === null, '성공했으면 실패 사유가 없다');
}
// ── 2. 소견 끔 — 호출도 없고 사유도 없다(정상적인 '지표만') ────────────────
{
  let called = 0;
  globalThis.fetch = async () => { called++; throw new Error('불려서는 안 된다'); };
  const a = mk({ genLLM: false });
  const op = await run(a);
  chk(op === null && a._genLlmErr === null, '소견을 끄면 조용히 지표만 — 이것만이 사유 없는 정상 경로');
  chk(called === 0, '끈 상태에서는 호출하지 않는다');
}
// ── 3. 미설정 — createLLM이 null이라 호출이 없다. 여기가 조용했던 구멍이다 ──
{
  let called = 0;
  globalThis.fetch = async () => { called++; throw new Error('불려서는 안 된다'); };
  const a = mk({ llmKeys: {} }); // 프로바이더는 골랐는데 그 프로바이더의 키가 비었다
  const op = await run(a);
  chk(op === null, '키가 없으면 소견은 없다');
  chk(called === 0, '키가 없으면 호출 자체를 하지 않는다');
  chk(!!a._genLlmErr && /미설정/.test(a._genLlmErr), '이유를 남긴다 — 켰는데 지표만이면 반드시 사유가 있어야 한다', a._genLlmErr);
}
// ── 4. 호출 실패(HTTP) — 사유에 원문이 실려야 고칠 수 있다 ─────────────────
{
  stubFetch('http');
  const a = mk();
  const op = await run(a);
  chk(op === null, 'HTTP 오류면 소견 없음');
  chk(!!a._genLlmErr && /invalid x-api-key/.test(a._genLlmErr), '서버가 준 사유를 그대로 남긴다', a._genLlmErr);
}
// ── 5. 네트워크·CORS 차단 ──────────────────────────────────────────────────
{
  stubFetch('net');
  const a = mk();
  await run(a);
  chk(!!a._genLlmErr, '네트워크 차단도 사유를 남긴다', a._genLlmErr);
}
// ── 6. 빈 응답 — 어느 프로바이더도 예외로 던지지 않는 조용한 경로 ──────────
{
  stubFetch('ok', '   \n  ');
  const a = mk();
  const op = await run(a);
  chk(op === null, '공백만 온 응답은 소견으로 치지 않는다');
  chk(!!a._genLlmErr && /빈 응답/.test(a._genLlmErr), '빈 응답도 사유를 남긴다', a._genLlmErr);
}
// ── 7. 중단(사용자 취소)은 실패가 아니다 ───────────────────────────────────
{
  globalThis.fetch = async () => { const e = new Error('aborted'); e.__abort = true; throw e; };
  const a = mk();
  await run(a);
  chk(a._genLlmErr === null, '사용자가 중단한 것은 실패로 알리지 않는다', String(a._genLlmErr));
}

// ── 8. 재현성 도장은 소견이 실제로 나왔을 때만 모델명을 적는다 ─────────────
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/build: self\._reportBuild\(eq, det, docNo,\s*\n\s*opinion \?/.test(src),
    '모델명은 opinion이 있을 때만 — 실패했는데 적으면 없는 근거를 주장하게 된다');
  chk(/llm: !!opinion/.test(src), '보관함 유형도 실제 소견 유무로 정한다');
  // 생성 끝에서 사용자에게 도달하는지 — 사유를 담아두기만 하고 안 알리면 고친 것이 아니다
  chk(/if \(self\._genLlmErr\) self\._toast\(/.test(src), '수집한 사유를 생성 완료 시 알린다');
  chk(/this\._genLlmErr = null;/.test(src), '생성 시작 때 이전 실행의 사유를 지운다');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
