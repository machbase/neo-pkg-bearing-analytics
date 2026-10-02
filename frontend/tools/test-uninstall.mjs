/* 패키지 제거 스크립트(scripts/uninstall.js) — 제거를 실행한 사용자의 세션으로 이 패키지 타이머만 멈춘 뒤 삭제
   · 코드에 계정·비밀번호 없음(기본 계정 폴백 없음)
   · 세션 없음·로그인 실패·목록 실패·어떤 오류든 삭제 없이 안내, 제거 자체는 막지 않음
   jsh 모듈(@jsh/session·@jsh/http)을 가짜로 주입해 실행 · 오프라인(Neo 불필요) · npm run smoke 포함 */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../../scripts/uninstall.js', import.meta.url), 'utf8');
let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};

/* 가짜 Neo — 로그인·타이머 RPC 응답, 호출 기록 */
function fakeNeo(o) {
  const calls = [];
  const timers = o.timers || [];
  const http = {
    NewClient: () => {
      if (o.clientThrows) throw new Error('client boom');
      return {
        do(r) {
          calls.push(r);
          let body = {};
          if (/\/web\/api\/login$/.test(r.url)) {
            const b = JSON.parse(r.body);
            body = (b.loginName === o.user && b.password === o.password) ? { success: true, accessToken: 'TOK-' + b.loginName } : { success: false, reason: 'invalid' };
          } else if (/\/web\/api\/rpc$/.test(r.url)) {
            const b = JSON.parse(r.body);
            if (b.method === 'timer.list') body = o.listError ? { error: { message: 'denied' } } : { result: timers };
            else if (b.method === 'timer.delete' && (o.deleteFails || []).includes(b.params[0])) body = { error: { message: 'busy' } };
            else body = { result: true };
          }
          return { string: () => JSON.stringify(body) };
        },
      };
    },
    NewRequest: (method, url) => {
      const r = { method, url, headers: {}, body: '' };
      r.header = { set: (k, v) => { r.headers[k] = v; } };
      r.writeString = (s) => { r.body += s; };
      return r;
    },
  };
  const session = o.noSession ? null : {
    getHttpConfig: () => Object.assign({ protocol: 'http', host: '0.0.0.0', port: 5654, user: o.sessUser, password: o.sessPass }, o.cfg || {}),
    getHttpAccessToken: () => o.token || '',
  };
  return { calls, mods: { '@jsh/http': http, '@jsh/session': session } };
}
function run(o) {
  const neo = fakeNeo(o), out = [];
  const req = (n) => { if (!neo.mods[n]) throw new Error('module not found: ' + n); return neo.mods[n]; };
  new Function('require', 'console', SRC)(req, { println: (s) => out.push(String(s)) });
  const rpc = neo.calls.filter((c) => /rpc$/.test(c.url)).map((c) => { const b = JSON.parse(c.body); return b.method + (b.params.length ? ':' + b.params[0] : ''); });
  return { out: out.join('\n'), calls: neo.calls, rpc };
}
const TIMERS = [
  { id: 't1', name: 'NEO_BEARING_MONITOR_SYS' }, { id: 't2', name: 'NEO_BEARING_BAND_SYS' },
  { id: 't3', name: 'NASA_REPLAY' }, { id: 't4', name: 'NEO_VIBE_WD' },
];

// ── 코드에 계정 없음 ──────────────────────────────────────────────────
chk(!/MANAGER/i.test(SRC) && !/'SYS'/.test(SRC) && !/neo-auth/.test(SRC) && !/password\s*=\s*'/.test(SRC),
  '코드에 기본 계정·비밀번호·계정 파일 없음(예전: SYS/MANAGER 폴백)');

// ── 세션 계정으로 로그인 → 이 패키지 타이머만 멈춘 뒤 삭제 ─────────────────
{
  const r = run({ user: 'SYS', password: 's3cret', sessUser: 'SYS', sessPass: 's3cret', timers: TIMERS });
  const login = r.calls.find((c) => /login$/.test(c.url));
  chk(login && login.url === 'http://127.0.0.1:5654/web/api/login' && JSON.parse(login.body).loginName === 'SYS',
    '제거를 실행한 사용자의 세션 계정으로 로그인(0.0.0.0 → 같은 호스트)', login && login.url);
  chk(r.rpc.join(' ') === 'timer.list timer.stop:t1 timer.delete:t1 timer.stop:t2 timer.delete:t2 timer.stop:t4 timer.delete:t4',
    '이 패키지 타이머(옛 이름 포함)만 멈춘 뒤 삭제 — 다른 타이머는 그대로', r.rpc.join(' '));
  chk(/SYS 계정 타이머 3개 삭제: NEO_BEARING_MONITOR_SYS, NEO_BEARING_BAND_SYS, NEO_VIBE_WD/.test(r.out) && /다른 계정이 등록한/.test(r.out),
    '지운 목록과 다른 계정 타이머 안내 출력');
  chk(/uninstalled/.test(r.out), '제거 완료 문구');
  const rpcCall = r.calls.find((c) => /rpc$/.test(c.url));
  chk(rpcCall.headers.Authorization === 'Bearer TOK-SYS', 'RPC는 그 세션의 토큰으로');
}
// 세션에 토큰이 이미 있으면 로그인 생략
{
  const r = run({ token: 'SESSION-TOK', sessUser: 'JOY', timers: TIMERS.slice(0, 1) });
  chk(!r.calls.some((c) => /login$/.test(c.url)) && r.calls[0].headers.Authorization === 'Bearer SESSION-TOK',
    '세션 토큰이 있으면 그대로 사용(로그인 생략)');
}
// 비밀번호를 바꾼 환경 — 세션 비밀번호가 곧 현재 비밀번호
{
  const r = run({ user: 'SYS', password: 'changed!', sessUser: 'SYS', sessPass: 'changed!', timers: TIMERS.slice(0, 1) });
  chk(r.rpc.includes('timer.delete:t1'), '기본 비밀번호를 바꿔도 동작(예전: 로그인 실패로 타이머 잔존)');
}
// host:port 한 칸
{
  const r = run({ user: 'SYS', password: 'p', sessUser: 'SYS', sessPass: 'p', cfg: { host: '0.0.0.0:6654', port: undefined }, timers: [] });
  chk(r.calls[0] && r.calls[0].url === 'http://127.0.0.1:6654/web/api/login', '주소가 host:port 한 칸이어도 실제 포트로', r.calls[0] && r.calls[0].url);
  chk(/SYS 계정 타이머 없음/.test(r.out), '지울 타이머가 없으면 없음으로 표시');
}

// ── 안 되면 안내만 ────────────────────────────────────────────────────
{
  const r = run({ noSession: true });
  chk(r.calls.length === 0 && /자동으로 지우지 못했습니다\(실행 세션 정보 없음\)/.test(r.out) && /Neo 타이머 화면에서 멈춘 뒤 삭제/.test(r.out) && /uninstalled/.test(r.out),
    '세션 모듈·정보 없음 — 요청 없이 안내, 제거는 계속');
}
{
  const r = run({ user: 'SYS', password: 'right', sessUser: 'SYS', sessPass: 'wrong', timers: TIMERS });
  chk(r.rpc.length === 0 && /로그인 실패/.test(r.out), '로그인 실패 — 삭제 없이 안내');
}
{
  const r = run({ user: 'SYS', password: 'p', sessUser: 'SYS', sessPass: 'p', listError: true, timers: TIMERS });
  chk(r.rpc.join(' ') === 'timer.list' && /목록을 읽지 못했습니다\(denied\)/.test(r.out), '목록 실패 — 삭제 없이 안내');
}
{
  const r = run({ user: 'SYS', password: 'p', sessUser: 'SYS', sessPass: 'p', deleteFails: ['t2'], timers: TIMERS.slice(0, 2) });
  chk(/1개 삭제: NEO_BEARING_MONITOR_SYS · 삭제 실패: NEO_BEARING_BAND_SYS/.test(r.out), '일부 삭제 실패는 이름으로 알림', r.out.split('\n')[0]);
}
{
  const r = run({ clientThrows: true, sessUser: 'SYS', sessPass: 'p' });
  chk(/타이머 정리 중 오류\(client boom\)/.test(r.out) && /uninstalled/.test(r.out), '예상 못 한 오류도 안내로 끝나고 제거는 계속');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
