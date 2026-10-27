/* Claude 단발 호출 — 오프라인(fetch 대체, 키·네트워크 불필요) · npm run smoke 포함
 * · 출력 한도는 사고 토큰까지 담을 만큼(16000), 사고·샘플링 파라미터는 보내지 않음
 * · 본문 없이 끝나면 빈 문자열 대신 사유(출력 한도·거절)로 실패 · 본문 있으면 text 블록만 이어 붙임
 */
import Claude from '../../cgi-bin/llm/claude.js';

let pass = 0, fail = 0;
const chk = (ok, msg, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (got ? ' — ' + got : '')); ok ? pass++ : fail++; };

let sent = null;
const reply = (status, json) => { globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return { ok: status === 200, status, json: async () => json }; }; };
const cfg = { apiKey: 'k', model: 'claude-haiku-5-5' };
const fails = async (p) => { try { await p; return null; } catch (e) { return String(e.message || e); } };

// 정상 — 사고 블록 뒤 본문
reply(200, { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: ' 소견 본문 ' }] });
chk(await Claude.complete(cfg, 'p') === '소견 본문', '사고 블록은 건너뛰고 본문만 돌려준다');
chk(sent.max_tokens === 16000 && sent.max_tokens === Claude.MAX_TOKENS, '출력 한도 16000', String(sent.max_tokens));
chk(!('thinking' in sent) && !('temperature' in sent) && !('output_config' in sent), '사고·샘플링·effort 파라미터를 보내지 않는다', Object.keys(sent).join(','));

// 사고만 하다 한도 도달 — 빈 문자열이 아니라 사유
reply(200, { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }] });
const e1 = await fails(Claude.complete(cfg, 'p'));
chk(!!e1 && /출력 한도\(16000 토큰\)를 사고 단계에서 모두 썼습니다/.test(e1), '사고로 한도를 다 쓰면 그 사유로 실패', e1);

// 거절 — 범주 포함
reply(200, { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] });
const e2 = await fails(Claude.complete(cfg, 'p'));
chk(!!e2 && /거절했습니다\(cyber\)/.test(e2), '거절이면 범주와 함께 실패', e2);

// HTTP 오류 — 상태 코드·서버 메시지를 담은 예외
reply(404, { error: { type: 'not_found_error', message: 'model: nope' } });
const e3 = await fails(Claude.complete(cfg, 'p'));
chk(!!e3 && /HTTP 404: model: nope/.test(e3), '모델명 오류는 HTTP 오류로', e3);

console.log(`\nclaude llm: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
