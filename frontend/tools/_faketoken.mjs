/* 오프라인 테스트용 신원 — 콘솔 계정 = 앱 계정(정상 상태), 어느 계정 칸이든 고정 토큰
   · db.js 관문이 토큰 없는 요청을 막으므로 가짜 fetch를 쓰는 테스트는 맨 위에서 import
   · 콘솔 계정은 db.js 현재 계정(setUser 전엔 TESTER)을 따라감 — 계정 전환 차단에 걸리지 않게
   · 이미 localStorage가 있으면 그대로 둠 */
import { createRequire } from 'node:module';

export const TOKEN = 'nt_t_' + 'T'.repeat(43);
const PREFIX = 'neo-pkg-bearing-analytics.token.';
const req = createRequire(import.meta.url);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function consoleJwt() {
  const user = req('../../cgi-bin/db/db.js').getUser() || 'TESTER';
  return 'h.' + b64({ sub: user.toLowerCase() }) + '.s';
}
if (!globalThis.localStorage) {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => {
      if (k in store) return store[k];
      if (k === 'accessToken') return consoleJwt();
      return String(k).indexOf(PREFIX) === 0 ? TOKEN : null;
    },
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}
if (!globalThis.atob) globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
