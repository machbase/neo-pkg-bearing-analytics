/* 리포트 LLM 소견의 결말별 처리 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 성공·끔은 사유 없음, 실패(미설정·호출 실패·네트워크·빈 응답)는 사유(_genLlmErr) 필수, 사용자 중단은 실패 아님
   · 재현성 도장·보관함 유형은 실제 소견 유무 기준, 사유는 생성 완료 시 알림 */
globalThis.window = globalThis;

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// Claude 응답 흉내 — complete()의 실제 경로(fetch → json → content[].text) 사용
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
  a._opinionPrompt = () => 'PROMPT'; // 프롬프트 조립은 검사 대상 아님
  a.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  Object.assign(a.state, {
    ready: true, genLLM: true, llmProvider: 'claude',
    llmKeys: { claude: 'sk-test' }, llmModels: { claude: 'claude-sonnet-4-5' },
  }, st || {});
  a._genLlmErr = null;
  return a;
};
const run = (a) => a._reportOpinion({}, {}, {}, null, '2026-08-01', '2026-08-02');

// ── 1. 성공 — 소견 반환, 사유 없음 ────────────────────
{
  stubFetch('ok', '  ## 진동상태요약\n정상입니다.  ');
  const a = mk();
  const op = await run(a);
  chk(op === '## 진동상태요약\n정상입니다.', '성공하면 소견 본문이 돌아온다', JSON.stringify(op));
  chk(a._genLlmErr === null, '성공했으면 실패 사유가 없다');
}
// ── 2. 소견 끔 — 호출·사유 없음(정상적인 '지표만') ────────────────
{
  let called = 0;
  globalThis.fetch = async () => { called++; throw new Error('불려서는 안 된다'); };
  const a = mk({ genLLM: false });
  const op = await run(a);
  chk(op === null && a._genLlmErr === null, '소견을 끄면 조용히 지표만 — 이것만이 사유 없는 정상 경로');
  chk(called === 0, '끈 상태에서는 호출하지 않는다');
}
// ── 3. 미설정 — createLLM이 null이라 호출 없음, 사유는 기록 ──
{
  let called = 0;
  globalThis.fetch = async () => { called++; throw new Error('불려서는 안 된다'); };
  const a = mk({ llmKeys: {} }); // 프로바이더는 골랐는데 키가 빔
  const op = await run(a);
  chk(op === null, '키가 없으면 소견은 없다');
  chk(called === 0, '키가 없으면 호출 자체를 하지 않는다');
  chk(!!a._genLlmErr && /미설정/.test(a._genLlmErr), '이유를 남긴다 — 켰는데 지표만이면 반드시 사유가 있어야 한다', a._genLlmErr);
}
// ── 4. 호출 실패(HTTP) — 사유에 서버 원문 포함 ─────────────────
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
// ── 6. 빈 응답 — Claude는 클라이언트가 사유로 실패, 다른 공급자는 예외 없이 지나가는 조용한 경로 ──────────
{
  stubFetch('ok', '   \n  ');
  const a = mk();
  const op = await run(a);
  chk(op === null, '공백만 온 응답은 소견으로 치지 않는다');
  chk(!!a._genLlmErr && /본문 없이 응답이 끝났습니다/.test(a._genLlmErr), 'Claude 빈 응답은 끝난 사유를 남긴다', a._genLlmErr);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '  ' } }] }) });
  const b = mk({ llmProvider: 'openai', llmKeys: { openai: 'sk-test' }, llmModels: { openai: 'gpt-test' } });
  chk(await run(b) === null && !!b._genLlmErr && /빈 응답/.test(b._genLlmErr), '예외 없는 빈 응답도 사유를 남긴다', b._genLlmErr);
}
// ── 7. 중단(사용자 취소)은 실패 아님 ───────────────────────────────────
{
  globalThis.fetch = async () => { const e = new Error('aborted'); e.__abort = true; throw e; };
  const a = mk();
  await run(a);
  chk(a._genLlmErr === null, '사용자가 중단한 것은 실패로 알리지 않는다', String(a._genLlmErr));
}

// ── 8. 재현성 도장은 소견이 실제로 나왔을 때만 모델명 기재 ─────────────
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/var llmName = opinion \?/.test(src) && /build: self\._reportBuild\(eq, det, docNo, llmName\)/.test(src) && /opinionModel: llmName \|\| null/.test(src),
    '모델명은 opinion이 있을 때만(측정 정보·LLM 소견 절 공용) — 실패했는데 적으면 없는 근거를 주장하게 된다');
  chk(/llm: !!opinion/.test(src), '보관함 유형도 실제 소견 유무로 정한다');
  // 수집한 사유가 생성 끝에 사용자에게 도달하는지
  chk(/if \(self\._genLlmErr\) self\._toast\(/.test(src), '수집한 사유를 생성 완료 시 알린다');
  chk(/this\._genLlmErr = null;/.test(src), '생성 시작 때 이전 실행의 사유를 지운다');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
