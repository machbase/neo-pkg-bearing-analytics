// db.js 인증 관문 — 모든 서버 호출이 request() 하나를 지나고 계정별 API 토큰을 싣는지 확인
// · 관문 밖 fetch·토큰 없는 /db/* 요청은 서버 설정에 따라 기본 신원(SYS)으로 통과(권한이 넓어진 성공이라 드러나지 않음)
// · 토큰 칸 계정별·토큰 확인(/db/token/validate)·401 통지·계정 전환 차단
// 오프라인(Neo 불필요) · npm run smoke 포함
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../../cgi-bin/db/db.js');
const src = fs.readFileSync(SRC, 'utf8');

// 콘솔 로그인(JWT)과 토큰 칸 흉내 — db.js는 요청마다 새로 읽어야 함
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mkJwt = (sub) => `h.${b64({ sub })}.sig`;
const KEY = 'neo-pkg-bearing-analytics.token.';
const TOK_A = 'nt_a_' + 'A'.repeat(39) + 'tail', TOK_A2 = 'nt_b_' + 'B'.repeat(43);
const store = { accessToken: mkJwt('alpha'), [KEY + 'ALPHA']: TOK_A };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
const DB = createRequire(import.meta.url)(SRC);

let pass = 0, fail = 0;
const chk = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
};
console.log('db.js 인증 관문 (API 토큰)');

/* ---- 정적: fetch 호출은 관문 한 곳, 콘솔 전용 경로 없음 ---- */
const calls = [];
src.split('\n').forEach((l, i) => { if (/(^|[^.\w])fetch\s*\(/.test(l)) calls.push({ n: i + 1, text: l.trim() }); });
chk(calls.length === 1, `fetch 호출 ${calls.length}건 (관문 1건만 허용)`,
  calls.length > 1 ? calls.map((c) => `${c.n}: ${c.text.slice(0, 60)}`).join(' | ') : '');
chk(!/['"]\/web\//.test(src), '콘솔 세션 전용 경로(/web/*)가 남아 있지 않다');
chk(!/X-Console/.test(src) && !/relogin|refreshToken/.test(src), '콘솔 헤더·세션 갱신 코드가 남아 있지 않다');

/* ---- 동작 ---- */
let seen = [];
let reply = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' });
globalThis.fetch = async (p, init) => { seen.push({ path: p, init: init || {} }); return reply(p, init); };
const hdr = (i, k) => ((seen[i] && seen[i].init.headers) || {})[k];
const reset = () => { seen = []; };

reset();
await DB.q('select 1');
chk(seen[0] && /^\/db\/query\?/.test(seen[0].path), 'SQL 은 /db/query 로 나간다', seen[0] && seen[0].path.slice(0, 40));
chk(hdr(0, 'Authorization') === 'Bearer ' + TOK_A, '콘솔 계정 칸의 토큰이 Bearer 로 붙는다', hdr(0, 'Authorization'));

// 캐시 금지 — 다른 탭의 교체가 다음 요청에 반영
reset();
store[KEY + 'ALPHA'] = TOK_A2;
await DB.q('select 1');
chk(hdr(0, 'Authorization') === 'Bearer ' + TOK_A2, '토큰이 바뀌면 다음 요청에 즉시 반영된다');
store[KEY + 'ALPHA'] = TOK_A;

reset();
await DB.tql('FAKE(linspace(0,0,1))\nCSV()');
chk(seen[0] && seen[0].path === '/db/tql' && seen[0].init.method === 'POST', 'TQL 은 /db/tql 로 나간다', seen[0] && seen[0].path);
chk(hdr(0, 'Authorization') === 'Bearer ' + TOK_A && hdr(0, 'X-Console-Id') === undefined, 'TQL 도 토큰만 싣는다(콘솔 헤더 없음)');

// 원시 파형·표본시각은 CSV 직통 경로 — 관문 경유 확인
reset();
reply = () => ({ ok: true, status: 200, text: async () => '' });
await DB.rawWindow('T', 'tag', 0, 1000, 0);
chk(seen[0] && /^\/db\/query\?.*format=csv/.test(seen[0].path) && hdr(0, 'Authorization'), 'rawWindow 도 관문을 지난다', seen[0] && seen[0].path.slice(0, 32));
reset();
await DB.sampleTimes('T', 'tag', 0, 1000, 10);
chk(seen[0] && /^\/db\/query\?.*timeformat=us/.test(seen[0].path) && hdr(0, 'Authorization'), 'sampleTimes 도 관문을 지난다');

// 파일 API·타이머 RPC — 조회와 같은 신원
reset();
reply = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { children: [] } }), text: async () => '{}' });
await DB.listDir('/x').catch(() => {});
chk(seen[0] && seen[0].path === '/db/files/x' && hdr(0, 'Authorization') === 'Bearer ' + TOK_A, '파일 API 는 /db/files 로 토큰과 함께', seen[0] && seen[0].path);
reset();
reply = () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: [] }) });
await DB.timerStates();
chk(seen[0] && seen[0].path === '/db/rpc' && hdr(0, 'Authorization') === 'Bearer ' + TOK_A, '타이머 RPC 는 /db/rpc 로 토큰과 함께', seen[0] && seen[0].path);

/* ---- 토큰 없음·계정 칸 ---- */
// 부팅 전 — 토큰 없으면 요청 0건(헤더 없이 보내지 않음)
reset();
reply = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }) });
delete store[KEY + 'ALPHA'];
let err = null;
await DB.q('select 1').catch((e) => { err = e; });
chk(seen.length === 0, '토큰이 없으면 요청을 보내지 않는다', String(seen.length));
chk(err && err.noToken === true, '토큰 없음은 noToken 오류로 거부', err && err.message);
store[KEY + 'ALPHA'] = TOK_A;

// 콘솔 계정이 바뀌면 그 계정 칸 — 앞사람 토큰을 싣지 않음
reset();
store.accessToken = mkJwt('beta');
await DB.q('select 1').catch(() => {});
chk(seen.length === 0, '다른 콘솔 계정이면 그 계정 칸(빈 칸)을 보고 요청 0건');
chk(DB.consoleUser() === 'BETA', 'JWT sub 에서 콘솔 계정을 읽는다(대문자 정규화)', DB.consoleUser());
delete store.accessToken;
chk(DB.consoleUser() === '', '콘솔 로그인이 없으면 콘솔 계정도 비어 있다');
store.accessToken = mkJwt('alpha');

// 부팅 뒤 — 이 탭 계정 칸 고정 + 콘솔 계정 전환 시 차단
DB.setUser('ALPHA');
reset();
store.accessToken = mkJwt('beta');
store[KEY + 'BETA'] = 'nt_c_' + 'C'.repeat(43);
err = null;
await DB.q('select 1').catch((e) => { err = e; });
chk(seen.length === 0 && err && err.idSwitch === 'BETA', '부팅 뒤 콘솔 계정이 바뀌면 요청을 보내지 않는다', err && err.message);
delete store[KEY + 'BETA'];
store.accessToken = mkJwt('alpha');

// 부팅 뒤 토큰이 사라지면 요청 0건 + 인증 끊김 통지
reset();
let lost = null;
DB.onAuthFail((p) => { lost = p; });
delete store[KEY + 'ALPHA'];
await DB.q('select 1').catch(() => {});
chk(seen.length === 0 && lost && /\/db\/query/.test(lost), '부팅 뒤 토큰이 지워지면 요청 없이 인증 끊김을 알린다', String(lost));
store[KEY + 'ALPHA'] = TOK_A;

/* ---- 401 처리 ---- */
reset(); lost = null;
reply = () => ({ ok: false, status: 401, json: async () => ({ success: false, reason: 'missing valid token' }), text: async () => '' });
await DB.q('select 1').catch(() => {});
chk(lost && /\/db\/query/.test(lost), '401 이면 인증실패 콜백이 불린다', lost);
chk(seen.length === 1, '401 은 재시도하지 않는다', String(seen.length));

reset(); lost = null;
reply = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }) });
await DB.q('select 1');
chk(lost === null, '정상 응답은 콜백을 부르지 않는다');
DB.onAuthFail(null);
DB.setUser('');

/* ---- 토큰 확인(/db/token/validate) ---- */
reset();
reply = () => ({ ok: true, status: 200, json: async () => ({ user: 'alpha', valid: true }) });
const v1 = await DB.validateToken('  ' + TOK_A2 + ' ');
chk(v1 === 'ALPHA', '유효하면 계정명(대문자)', v1);
chk(seen[0] && seen[0].path === '/db/token/validate' && seen[0].init.method === 'POST', 'POST /db/token/validate 로 확인');
chk(hdr(0, 'Authorization') === 'Bearer ' + TOK_A2, '확인할 토큰만 싣는다(저장된 토큰과 무관, 앞뒤 공백 제거)', hdr(0, 'Authorization'));
reset();
reply = () => ({ ok: false, status: 401, json: async () => ({ valid: false }) });
chk(await DB.validateToken(TOK_A) === null, '401 이면 null(무효·폐기·만료)');
reply = () => ({ ok: true, status: 200, json: async () => ({ user: 'alpha', valid: false }) });
chk(await DB.validateToken(TOK_A) === null, 'valid:false 면 null');
reply = () => ({ ok: false, status: 404, json: async () => ({}) });
let e404 = null;
await DB.validateToken(TOK_A).catch((e) => { e404 = e; });
chk(e404 && /8\.7\.3/.test(e404.message), '404(구버전 Neo)면 버전 안내와 함께 거부', e404 && e404.message);
reset();
chk(await DB.validateToken('') === null && seen.length === 0, '빈 토큰은 요청 없이 null');

/* ---- 저장·표시 ---- */
delete store[KEY + 'ALPHA'];
chk(DB.setApiToken(' ' + TOK_A + ' ') === true && store[KEY + 'ALPHA'] === TOK_A, '콘솔 계정 칸에 저장(공백 제거)');
const hint = DB.tokenHint();
chk(hint === 'nt_a_…tail' && hint.indexOf('A'.repeat(10)) < 0, '화면 표시는 앞 형식부·끝 4자만', hint);
DB.clearApiToken();
chk(!(KEY + 'ALPHA' in store) && DB.tokenHint() === '', '지우면 칸이 비고 표시도 빈 값');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
