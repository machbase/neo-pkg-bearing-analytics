/* 라이브 테스트 신원 — 앱과 같은 API 토큰·같은 경로(/db/*)로 조회
   · 토큰은 환경변수 NEO_TOKEN(코드에 토큰 없음), 주소는 NEO_URL(기본 http://127.0.0.1:5654)
   · 토큰 없음·Neo 미기동·토큰 무효면 건너뜀(종료 코드 0) — 인증 없이 빈 데이터로 통과하지 않게
   사용: 테스트 맨 위 `const { DB, who } = await import('./_liveauth.mjs');` — 앱 모듈은 그 뒤에 import */
globalThis.window = globalThis;
const NEO = process.env.NEO_URL || 'http://127.0.0.1:5654';
const skip = (why) => { console.log('건너뜀 — ' + why); process.exit(0); };

const token = (process.env.NEO_TOKEN || '').trim();
if (!token) skip('라이브 Neo API 토큰 필요: NEO_TOKEN 환경변수');

const _fetch = globalThis.fetch;
globalThis.fetch = (u, o) => _fetch(typeof u === 'string' && u.startsWith('/') ? NEO + u : u, o);

// 앱이 읽는 자리(localStorage) — 토큰 확인 뒤 콘솔 계정·그 계정 토큰 칸을 채움
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const DB = (await import('../../cgi-bin/db/db.js')).default;
let user = null;
try { user = await DB.validateToken(token); } catch (e) { skip('토큰 확인 불가(' + NEO + ') — ' + ((e && e.message) || e)); }
if (!user) skip('토큰 무효(폐기·만료)');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
store.accessToken = 'h.' + b64({ sub: user }) + '.s';
store['neo-pkg-bearing-analytics.token.' + user] = token;

// 앱 부팅과 같은 신원 확인 — 토큰 계정 = 실제 실행 계정
const who = await DB.whoami();
if (who !== user) skip('토큰 계정(' + user + ')과 실행 계정(' + who + ')이 다름');
DB.setUser(who);

export { DB, NEO, who };
