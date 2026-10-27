/* 앱 부팅·토큰 입력 흐름 — 콘솔 계정 = 토큰 계정 = 실제 실행 계정일 때만 부팅
   · 콘솔 로그인 없음·토큰 없음·무효·계정 불일치·실행 계정 불일치는 조회 없이 차단
   · 토큰 확인·저장(첫 부팅·교체·끊김 뒤), 지우기, 다른 탭 삭제·401 감지, 입력 화면 렌더
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mkJwt = (sub) => `h.${b64({ sub })}.sig`;
const KEY = 'neo-pkg-bearing-analytics.token.';
const TOK_A = 'nt_a_' + 'A'.repeat(39) + 'aaaa', TOK_A2 = 'nt_d_' + 'D'.repeat(39) + 'dddd', TOK_B = 'nt_b_' + 'B'.repeat(43);
const ls = {};
globalThis.localStorage = {
  getItem: (k) => (k in ls ? ls[k] : null),
  setItem: (k, v) => { ls[k] = String(v); },
  removeItem: (k) => { delete ls[k]; },
};
let reloaded = 0;
globalThis.location = { reload: () => { reloaded++; } };

// 가짜 Neo — 토큰별 계정, 실행 계정, 401 강제
const OWNER = { [TOK_A]: 'alpha', [TOK_A2]: 'alpha', [TOK_B]: 'beta' };
let execAs = 'ALPHA', force401 = false, sent = [];
const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o, text: async () => JSON.stringify(o) });
globalThis.fetch = async (p, init) => {
  const auth = ((init && init.headers) || {}).Authorization || '';
  const tok = auth.replace(/^Bearer /, '');
  sent.push({ path: String(p), auth });
  if (p === '/db/token/validate') return OWNER[tok] ? json({ user: OWNER[tok], valid: true }) : json({ valid: false }, 401);
  if (force401 || !OWNER[tok]) return json({ success: false, reason: 'missing valid token' }, 401);
  const sql = decodeURIComponent(String(p));
  if (/V\$STMT/.test(sql)) return json({ success: true, data: { rows: [[execAs]] } });
  return json({ success: true, data: { rows: [] } });   // 저장소 확인 0건 → 저장소 안내 분기
};

const { App } = await import('../src/app.js');
const { view } = await import('../src/view.js');
const DB = (await import('../../cgi-bin/db/db.js')).default;
import renderToString from 'preact-render-to-string';

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5)); };

function mkApp() {
  DB.setUser('');
  const app = new App({});
  app.setState = function (st) { Object.assign(this.state, st); };
  app.forceUpdate = function () {};
  app._toasts = [];
  app._toast = function (m, k) { this._toasts.push((k || '') + ':' + m); };
  app._needsDbCalls = 0;
  const nd = app._initNeedsDb;
  app._initNeedsDb = function (...a) { this._needsDbCalls++; return nd.apply(this, a); };
  return app;
}
const reset = (o) => { Object.keys(ls).forEach((k) => delete ls[k]); Object.assign(ls, o || {}); sent = []; execAs = 'ALPHA'; force401 = false; };
const html = (app) => renderToString(view(app.renderVals()));

// ── 부팅 차단 ────────────────────────────────────────────────────────
{
  reset();
  const a = mkApp(); a._poll(); await settle();
  chk(/Neo 콘솔에 로그인되어 있지 않습니다/.test(a.state.authMsg) && !a.state.needsToken && sent.length === 0, '콘솔 로그인 없음 — 요청 0건으로 차단', a.state.authMsg);
}
{
  reset({ accessToken: mkJwt('alpha') });
  const a = mkApp(); a._poll(); await settle();
  chk(/토큰이 없습니다/.test(a.state.authMsg) && a.state.needsToken && sent.length === 0, '토큰 없음 — 요청 0건, 입력칸 표시', a.state.authMsg);
  const h = html(a);
  chk(/type="password"/.test(h) && /New token/.test(h) && /ALPHA 계정/.test(h), '입력 화면이 그려짐(발급 안내·대상 계정)');
}
{
  reset({ accessToken: mkJwt('alpha'), [KEY + 'ALPHA']: 'nt_z_' + 'Z'.repeat(43) });
  const a = mkApp(); a._poll(); await settle();
  chk(/유효하지 않습니다/.test(a.state.authMsg) && a.state.needsToken, '무효 토큰 — 입력칸으로', a.state.authMsg);
  chk(!(KEY + 'ALPHA' in ls), '무효 토큰은 칸에서 지움');
  chk(sent.length === 1 && sent[0].path === '/db/token/validate', '확인 요청 외 조회 없음', sent.map((s) => s.path).join(','));
}
{
  reset({ accessToken: mkJwt('alpha'), [KEY + 'ALPHA']: TOK_B });
  const a = mkApp(); a._poll(); await settle();
  chk(/토큰 계정\(BETA\)이 콘솔 로그인 계정\(ALPHA\)과 다릅니다/.test(a.state.authMsg) && a.state.needsToken, '토큰 계정 ≠ 콘솔 계정 — 차단', a.state.authMsg);
  chk(!sent.some((s) => /\/db\/query/.test(s.path)), '불일치면 조회 없음');
}
{
  reset({ accessToken: mkJwt('alpha'), [KEY + 'ALPHA']: TOK_A });
  execAs = 'SYS';
  const a = mkApp(); a._poll(); await settle();
  chk(/실제 실행 계정\(SYS\)/.test(a.state.authMsg) && !a.state.user, '토큰 계정 ≠ 실제 실행 계정 — 차단', a.state.authMsg);
}

// ── 정상 부팅 ────────────────────────────────────────────────────────
let booted;
{
  reset({ accessToken: mkJwt('alpha'), [KEY + 'ALPHA']: TOK_A });
  booted = mkApp(); booted._poll(); await settle();
  chk(booted.state.user === 'ALPHA' && booted.user === 'ALPHA' && !booted.state.authMsg && !booted.state.needsToken, '세 계정 일치 — 부팅', booted.state.authMsg);
  chk(booted._needsDbCalls === 1, '이후 흐름은 기존과 같음(저장소 확인 → 안내 분기)');
  chk(sent.length > 1 && sent.every((s) => s.auth === 'Bearer ' + TOK_A), '모든 요청에 그 계정 토큰', String(sent.length));
  const h = html(booted);
  chk(/접속 계정/.test(h) && /nt_a_…aaaa/.test(h) && />토큰 변경</.test(h) && h.indexOf('A'.repeat(20)) < 0, '부팅 뒤 계정·가린 토큰·변경 버튼 표시');
}

// ── 토큰 입력(첫 부팅 전) ─────────────────────────────────────────────
{
  reset({ accessToken: mkJwt('alpha') });
  const a = mkApp(); a._poll(); await settle();
  a._tokenSubmit(); await settle();
  chk(a.state.tokenMsg === '토큰을 입력하세요', '빈 입력 — 안내');
  a.setState({ tokenInput: 'nt_z_' + 'Z'.repeat(43) }); a._tokenSubmit(); await settle();
  chk(/유효하지 않은 토큰/.test(a.state.tokenMsg) && !(KEY + 'ALPHA' in ls), '무효 토큰 — 저장 안 함', a.state.tokenMsg);
  a.setState({ tokenInput: TOK_B }); a._tokenSubmit(); await settle();
  chk(/BETA 계정의 토큰입니다 — ALPHA 계정의 토큰을 입력하세요/.test(a.state.tokenMsg) && !(KEY + 'ALPHA' in ls), '다른 계정 토큰 — 저장 안 함', a.state.tokenMsg);
  sent = [];
  a.setState({ tokenInput: '  ' + TOK_A + ' ' }); a._tokenSubmit(); await settle();
  chk(ls[KEY + 'ALPHA'] === TOK_A && a.state.user === 'ALPHA' && !a.state.authMsg && a.state.tokenInput === '', '맞는 토큰 — 저장 후 바로 부팅', a.state.authMsg);
  chk(reloaded === 0, '첫 부팅은 새로고침 없이');
}

// ── 부팅 뒤 교체·지우기·끊김 ──────────────────────────────────────────
{
  const a = booted;
  a.setState({ tokenEdit: true, tokenInput: TOK_A2 }); a._tokenSubmit(); await settle();
  chk(ls[KEY + 'ALPHA'] === TOK_A2 && a._toasts.some((t) => /토큰을 바꿨습니다/.test(t)) && reloaded === 0 && !a.state.tokenEdit, '같은 계정 토큰으로 교체 — 새로고침 없이 적용');
  a.setState({ tokenEdit: true, tokenInput: TOK_B }); a._tokenSubmit(); await settle();
  chk(/BETA 계정의 토큰입니다/.test(a.state.tokenMsg) && ls[KEY + 'ALPHA'] === TOK_A2, '부팅 뒤 다른 계정 토큰 — 거부');
  a.setState({ tokenEdit: false, tokenMsg: '' });

  // 다른 탭에서 삭제 → 감지
  delete ls[KEY + 'ALPHA'];
  a._onStorage();
  chk(/유효하지 않거나 지워졌습니다/.test(a.state.authMsg) && a.state.needsToken && !a.state.user, '다른 탭의 토큰 삭제 감지 — 입력 화면으로', a.state.authMsg);
  a.setState({ tokenInput: TOK_A }); a._tokenSubmit(); await settle();
  chk(ls[KEY + 'ALPHA'] === TOK_A && reloaded === 1, '끊김 뒤 다시 입력 — 저장 후 새로고침(재기동 한 경로)');
}
{
  reset({ accessToken: mkJwt('alpha'), [KEY + 'ALPHA']: TOK_A });
  const a = mkApp(); a._poll(); await settle();
  a._tokenClear();
  chk(!(KEY + 'ALPHA' in ls) && /유효하지 않거나 지워졌습니다/.test(a.state.authMsg) && a.state.needsToken, '토큰 지우기 — 칸 비우고 입력 화면으로');
}
{
  reset({ accessToken: mkJwt('alpha'), [KEY + 'ALPHA']: TOK_A });
  const a = mkApp(); a._poll(); await settle();
  force401 = true;
  await DB.q('select 1').catch(() => {});
  chk(/유효하지 않거나 지워졌습니다/.test(a.state.authMsg) && a.state.needsToken, '사용 중 401(폐기·만료) — 입력 화면으로', a.state.authMsg);
}

// ── 준비 전 화면 — 유저 정보만(데이터 소스·다른 설정·탭·알람·저장 없음) ──
{
  const gated = (h) => ({
    userCard: />유저 정보</.test(h),
    tz: />표시 시간대</.test(h),
    src: />데이터 소스</.test(h),
    tabs: />모니터링</.test(h) || />상세분석</.test(h),
    alarm: />알람 (ON|OFF)/.test(h) || /알람 <!-- -->(ON|OFF)/.test(h),
    save: />저장<\/button>/.test(h),
  });
  reset({ accessToken: mkJwt('alpha') });
  const a = mkApp(); a._poll(); await settle();
  let g = gated(html(a));
  chk(g.userCard && !g.tz && !g.src && !g.tabs && !g.alarm && !g.save, '토큰 없음 — 유저 정보만 표시', JSON.stringify(g));
  reset({ accessToken: mkJwt('alpha'), [KEY + 'ALPHA']: TOK_A });
  const b = mkApp(); b._poll(); await settle();
  g = gated(html(b));
  chk(b.state.needsDb && g.userCard && !g.tz && !g.src && !g.tabs && !g.save, '저장소 안내 상태 — 유저 정보만 표시', JSON.stringify(g));
  b.setState({ needsDb: false });
  g = gated(html(b));
  chk(g.tz && g.src && g.tabs && g.save, '준비되면 데이터 소스·탭·저장 표시', JSON.stringify(g));
  b.liveTables = ['T_PREV'];
  b._onAuthLost();
  chk(b.liveTables.length === 0 && !/T_PREV/.test(html(b)), '토큰 끊김 — 이전 계정 테이블 목록 비움');
}

// ── 입력칸 이벤트 — compat에서 입력칸 onChange는 input 이벤트라 같은 칸의 onInput을 덮어씀 ──
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/view.js', import.meta.url), 'utf8');
  const tag = (src.match(/<input[^>]*onInput=\$\{onTokenInput\}[^>]*>/) || [''])[0];
  chk(tag && !/onChange=/.test(tag), '토큰 입력칸은 onInput 하나만(onChange 없음)', tag.slice(0, 80));
  chk(/<div onChange=\$\{onTokenChange\}/.test(src), '저장 안 한 변경 제외는 감싼 div의 change에서');
}

DB.setUser('');
console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
