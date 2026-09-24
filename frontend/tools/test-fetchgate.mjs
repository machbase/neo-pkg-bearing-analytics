// db.js 의 모든 서버 호출이 request() 하나를 지나고, 그 관문이 콘솔 세션(JWT)을 제대로 싣는지 지킨다.
// 관문 밖에서 fetch 를 부르면 헤더가 빠지고, 서버는 그런 요청을 기본 신원(SYS)으로 통과시킨다
// — 실패가 아니라 권한이 넓어진 성공이라 화면에도 로그에도 안 드러난다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../../cgi-bin/db/db.js');
const src = fs.readFileSync(SRC, 'utf8');

// 콘솔이 둔 세션 토큰을 흉내낸다 — db.js 는 요청마다 여기서 새로 읽어야 한다
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mkJwt = (sub) => `h.${b64({ sub })}.sig`;
const store = { accessToken: mkJwt('joy') };
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
console.log('db.js 인증 관문 (JWT)');

/* ---- 정적: 관문이 새지 않는가 ---- */
const calls = [];
src.split('\n').forEach((l, i) => { if (/(^|[^.\w])fetch\s*\(/.test(l)) calls.push({ n: i + 1, text: l.trim() }); });
chk(calls.length === 1, `fetch 호출 ${calls.length}건 (관문 1건만 허용)`,
  calls.length > 1 ? calls.map((c) => `${c.n}: ${c.text.slice(0, 60)}`).join(' | ') : '');
chk(!/['"]\/db\//.test(src), 'API 토큰 전용 경로(/db/*)가 남아 있지 않다');

/* ---- 동작 ---- */
let seen = [];
let reply = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' });
globalThis.fetch = async (p, init) => { seen.push({ path: p, init: init || {} }); return reply(); };
const hdr = (i, k) => ((seen[i] && seen[i].init.headers) || {})[k];
const reset = () => { seen = []; };

reset();
await DB.q('select 1');
chk(seen[0] && /^\/web\/machbase\?/.test(seen[0].path), 'SQL 은 /web/machbase 로 나간다', seen[0] && seen[0].path.slice(0, 40));
chk(hdr(0, 'Authorization') === 'Bearer ' + store.accessToken, '콘솔 세션이 Bearer 로 붙는다', hdr(0, 'Authorization'));

// 5분 수명이라 캐시하면 만료된 값을 계속 보낸다 — 요청마다 다시 읽어야 한다
reset();
store.accessToken = mkJwt('sys');
await DB.q('select 1');
chk(hdr(0, 'Authorization') === 'Bearer ' + store.accessToken, '토큰이 바뀌면 다음 요청에 즉시 반영된다');
store.accessToken = mkJwt('joy');

reset();
await DB.tql('FAKE(linspace(0,0,1))\nCSV()');
chk(seen[0] && seen[0].path === '/web/api/tql', 'TQL 은 /web/api/tql 로 나간다', seen[0] && seen[0].path);
/* 이 헤더가 빠지면 구버전 Neo 는 TQL 을 서버 커넥션(SYS)으로 돌린다 — 응답은 정상이라
   화면으로는 알 수 없고, 권한 밖 테이블까지 읽힌다. */
chk(/neo-pkg-bearing-analytics/.test(hdr(0, 'X-Console-Id') || ''), 'TQL 에 X-Console-Id 가 붙는다', hdr(0, 'X-Console-Id'));
chk(hdr(0, 'X-Console-Log-Level') === 'NONE', 'TQL 에 X-Console-Log-Level 이 붙는다', hdr(0, 'X-Console-Log-Level'));

// 원시 파형·표본시각은 CSV 직통이라 경로 교체를 빠뜨리기 쉬운 자리다
reset();
reply = () => ({ ok: true, status: 200, text: async () => '' });
await DB.rawWindow('T', 'tag', 0, 1000, 0);
chk(seen[0] && /^\/web\/machbase\?/.test(seen[0].path) && hdr(0, 'Authorization'), 'rawWindow 도 관문을 지난다', seen[0] && seen[0].path.slice(0, 32));
reset();
await DB.sampleTimes('T', 'tag', 0, 1000, 10);
chk(seen[0] && /^\/web\/machbase\?/.test(seen[0].path) && hdr(0, 'Authorization'), 'sampleTimes 도 관문을 지난다');

// 파일 API — 리포트·TQL 저장이 조회와 같은 신원으로 가야 한다
reset();
reply = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { children: [] } }), text: async () => '{}' });
await DB.listDir('/x').catch(() => {});
chk(seen[0] && seen[0].path === '/web/api/files/x' && hdr(0, 'Authorization'), '파일 API 도 세션으로 나간다', seen[0] && seen[0].path);

// 세션이 없으면 헤더를 지어내지 않는다 — 그대로 보내면 서버가 기본 신원으로 받는다
reset();
delete store.accessToken;
await DB.q('select 1').catch(() => {});
chk(hdr(0, 'Authorization') === undefined, '세션이 없으면 Authorization 을 안 붙인다', hdr(0, 'Authorization'));
chk(DB.jwtUser() === '', '세션이 없으면 신원도 비어 있다', DB.jwtUser());
store.accessToken = mkJwt('joy');
chk(DB.jwtUser() === 'JOY', 'JWT sub 에서 계정을 읽는다(대문자 정규화)', DB.jwtUser());

/* ---- 401 을 한 곳에서 잡는가 ---- */
reset();
let failedPath = null;
DB.onAuthFail((p) => { failedPath = p; });
reply = () => ({ ok: false, status: 401, json: async () => ({ success: false, reason: 'unauthorized' }), text: async () => '' });
await DB.q('select 1').catch(() => {});
chk(failedPath && /\/web\/machbase/.test(failedPath), '401 이면 인증실패 콜백이 불린다', failedPath);

reset(); failedPath = null;
reply = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }) });
await DB.q('select 1');
chk(failedPath === null, '정상 응답은 콜백을 부르지 않는다');


/* ---- 세션 갱신 ----
   accessToken 은 5분이고 콘솔이 갱신해 주기를 기대할 수 없다 — 앱만 띄워 둔 탭에서는
   5분 뒤 모든 요청이 401 이 되고 화면이 멈춘다. 그래서 앱이 직접 relogin 을 친다. */
const mkExpJwt = (sub, secFromNow) =>
  `h.${b64({ sub, exp: Math.floor(Date.now() / 1000) + secFromNow })}.sig`;
const okJson = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => '' });

// 만료가 멀면 갱신하지 않는다 — 멀쩡한 토큰을 매번 바꾸면 relogin 이 조회만큼 잦아진다
reset();
store.accessToken = mkExpJwt('joy', 600);
store.refreshToken = 'rt-1';
reply = () => okJson({ success: true, data: { rows: [] } });
await DB.q('select 1');
chk(seen.length === 1 && !/relogin/.test(seen[0].path), '만료가 멀면 갱신을 안 친다', seen.map((s) => s.path).join(','));

// 만료 1분 안쪽이면 요청 전에 먼저 갱신한다 — 요청 도중 만료되는 창을 없앤다
reset();
store.accessToken = mkExpJwt('joy', 30);
reply = (p) => (/relogin/.test(p) ? okJson({ success: true, accessToken: mkExpJwt('joy', 300), refreshToken: 'rt-2' })
  : okJson({ success: true, data: { rows: [] } }));
globalThis.fetch = async (p, init) => { seen.push({ path: p, init: init || {} }); return reply(p); };
await DB.q('select 1');
chk(seen.length === 2 && seen[0].path === '/web/api/relogin', '만료 임박이면 먼저 갱신한다', seen.map((s) => s.path).join(' → '));
chk(store.refreshToken === 'rt-2', '새 refreshToken 을 저장한다', store.refreshToken);
chk(hdr(1, 'Authorization') === 'Bearer ' + store.accessToken, '갱신된 토큰으로 요청이 나간다');

// 401 이면 갱신 후 한 번만 재시도 — 다른 탭이 토큰을 바꿨거나 시계가 어긋난 경우
reset();
store.accessToken = mkExpJwt('joy', 600);
store.refreshToken = 'rt-2';
let first = true;
reply = (p) => {
  if (/relogin/.test(p)) return okJson({ success: true, accessToken: mkExpJwt('joy', 300), refreshToken: 'rt-3' });
  if (first) { first = false; return { ok: false, status: 401, json: async () => ({ success: false }), text: async () => '' }; }
  return okJson({ success: true, data: { rows: [] } });
};
let lost = null;
DB.onAuthFail((p) => { lost = p; });
await DB.q('select 1');
chk(seen.length === 3 && /relogin/.test(seen[1].path), '401 이면 갱신하고 재시도한다', seen.map((s) => s.path.slice(0, 18)).join(' → '));
chk(lost === null, '갱신에 성공하면 세션 만료로 올리지 않는다');

// 갱신할 수단이 없으면(refreshToken 없음) 그때는 만료로 올린다
reset(); lost = null;
delete store.refreshToken;
first = true;
reply = () => ({ ok: false, status: 401, json: async () => ({ success: false }), text: async () => '' });
await DB.q('select 1').catch(() => {});
chk(lost && /machbase/.test(lost), '갱신 수단이 없으면 세션 만료를 알린다', String(lost));
chk(!seen.some((s) => /relogin/.test(s.path)), 'refreshToken 이 없으면 relogin 을 치지 않는다');

// 동시에 여러 요청이 만료를 만나도 갱신은 한 번만 — N개 요청이 N번 relogin 하면 서버를 때린다
reset();
store.accessToken = mkExpJwt('joy', 10);
store.refreshToken = 'rt-3';
reply = (p) => (/relogin/.test(p) ? okJson({ success: true, accessToken: mkExpJwt('joy', 300), refreshToken: 'rt-4' })
  : okJson({ success: true, data: { rows: [] } }));
await Promise.all([DB.q('select 1'), DB.q('select 2'), DB.q('select 3')]);
chk(seen.filter((s) => /relogin/.test(s.path)).length === 1, '겹친 요청도 갱신은 한 번',
  String(seen.filter((s) => /relogin/.test(s.path)).length));
DB.onAuthFail(null);
store.accessToken = mkJwt('joy');

/* 갱신이 거부되면 그 토큰으로는 다시 치지 않는다 — 3초 폴링이 401 을 만들 때마다 relogin 을
   치면 실패 요청이 눈덩이처럼 불어난다(실측: 한 화면에 relogin 401 열 건). 토큰이 바뀌면 다시 시도한다. */
reset();
store.accessToken = mkExpJwt('joy', 600);
store.refreshToken = 'rt-bad';
const dead401 = () => ({ ok: false, status: 401, json: async () => ({ success: false }), text: async () => '' });
reply = () => dead401();
await DB.q('select 1').catch(() => {});
await DB.q('select 2').catch(() => {});
await DB.q('select 3').catch(() => {});
chk(seen.filter((s) => /relogin/.test(s.path)).length === 1, '갱신이 거부되면 같은 토큰으로 다시 치지 않는다',
  seen.filter((s) => /relogin/.test(s.path)).length + '회');

// 토큰이 바뀌면(콘솔이 다시 로그인했다) 다시 시도한다 — 영영 포기하면 복구가 안 된다
reset();
store.accessToken = mkExpJwt('joy', 601);
await DB.q('select 4').catch(() => {});
chk(seen.some((s) => /relogin/.test(s.path)), '토큰이 바뀌면 갱신을 다시 시도한다');
store.accessToken = mkJwt('joy');
DB.onAuthFail(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
