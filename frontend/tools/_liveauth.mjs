/* 라이브 테스트 로그인 — 앱과 같은 세션(콘솔 JWT)·같은 경로로 조회
   · 계정은 환경변수 NEO_USER·NEO_PASSWORD(코드에 비밀번호 없음), 주소는 NEO_URL(기본 http://127.0.0.1:5654)
   · 로그인 정보 없음·Neo 미기동·로그인 실패면 건너뜀(종료 코드 0) — 인증 없이 빈 데이터로 통과하지 않게
   · 토큰 갱신(5분 수명)은 앱과 같이 db.js가 refreshToken으로 처리
   사용: 테스트 맨 위 `const { DB, who } = await import('./_liveauth.mjs');` — 앱 모듈은 그 뒤에 import */
globalThis.window = globalThis;
const NEO = process.env.NEO_URL || 'http://127.0.0.1:5654';
const skip = (why) => { console.log('건너뜀 — ' + why); process.exit(0); };

const user = process.env.NEO_USER, pass = process.env.NEO_PASSWORD;
if (!user || pass == null) skip('라이브 Neo 로그인 정보 필요: NEO_USER·NEO_PASSWORD 환경변수');

const _fetch = globalThis.fetch;
globalThis.fetch = (u, o) => _fetch(typeof u === 'string' && u.startsWith('/') ? NEO + u : u, o);

let login = null;
try {
  login = await _fetch(NEO + '/web/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginName: user, password: pass }),
  }).then((r) => r.json());
} catch (e) { skip('Neo 미기동(' + NEO + ')'); }
if (!login || !login.accessToken) skip('로그인 실패 — ' + ((login && login.reason) || '응답 없음'));

// 앱이 읽는 콘솔 세션 자리(localStorage)에 토큰
const store = { accessToken: login.accessToken, refreshToken: login.refreshToken || '' };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

// 앱 부팅과 같은 신원 확인 — 세션 계정 = 실제 실행 계정
const DB = (await import('../../cgi-bin/db/db.js')).default;
const who = await DB.whoami();
if (who !== String(user).toUpperCase()) skip('로그인 계정(' + user + ')과 실행 계정(' + who + ')이 다름');
DB.setUser(who);

export { DB, NEO, who };
