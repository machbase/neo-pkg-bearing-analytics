// JWT 인증으로 갈아타기 전 전제를 찍는다. 특히 X-Console-Id 가 없을 때 TQL 이 누구로 실행되는지 —
// 여기서 SYS 가 나오면 헤더 누락이 곧 권한 누수이므로 관문에서 자동으로 붙여야 한다.
//   $env:VIBE_JWT="<localStorage.accessToken>"; node frontend/tools/probe-jwt.mjs
const B = (process.env.VIBE_BASE || 'http://127.0.0.1:5654').replace(/\/$/, '');
const JWT = (process.env.VIBE_JWT || '').trim();
const PKG = process.env.VIBE_PKG || '/public/neo-pkg-bearing-analytics';
if (!JWT) {
  console.log('VIBE_JWT 가 없습니다 — Neo 콘솔에 로그인한 브라우저에서 아래를 복사해 넣으세요:');
  console.log("  localStorage.accessToken");
  process.exit(2);
}
const H = { Authorization: 'Bearer ' + JWT };
const CONSOLE_H = {
  'X-Console-Id': 'neo-pkg-bearing-analytics, console-log-level=NONE',
  'X-Console-Log-Level': 'NONE',
};
const nonce = () => 'p' + Math.random().toString(36).slice(2, 12) + 'z';
const userSql = (n) => `SELECT s.USER_NAME FROM V$STMT t, V$SESSION s WHERE t.SESS_ID = s.ID AND t.QUERY LIKE '%${n}%'`;

const rows = [];
const add = (n, v, note) => rows.push({ n, v, note });

// JWT payload 의 sub — 앱이 신원으로 쓸 값
let sub = '';
try { sub = JSON.parse(Buffer.from(JWT.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub || ''; } catch { /* 형식 불명 */ }
add('JWT sub', sub ? 'PASS' : 'FAIL', sub || '파싱 실패');

// ① /web/machbase 가 이 계정으로 실행되는가
{
  const n = nonce();
  const r = await fetch(`${B}/web/machbase?q=${encodeURIComponent(userSql(n))}&format=json`, { headers: H });
  const j = await r.json().catch(() => ({}));
  const got = [...new Set(((j.data && j.data.rows) || []).map((x) => String(x[0])))];
  add('/web/machbase 실행 계정', got.length === 1 ? (got[0] === sub.toUpperCase() ? 'PASS' : 'INFO') : 'FAIL',
    got.join() || `HTTP ${r.status} ${j.reason || ''}`);
}

// CSV 포맷 — rawWindow·sampleTimes 가 이 형식을 쓴다
{
  const r = await fetch(`${B}/web/machbase?q=${encodeURIComponent('SELECT 1')}&format=csv&heading=false`, { headers: H });
  const t = (await r.text()).trim();
  add('/web/machbase CSV', r.ok && /^1/.test(t) ? 'PASS' : 'FAIL', r.ok ? JSON.stringify(t.slice(0, 20)) : `HTTP ${r.status}`);
}

// ② TQL — 콘솔 헤더가 있을 때 / 없을 때 각각 누구로 도는가
async function tqlUser(headers, label) {
  const n = nonce();
  const script = 'SQL(`' + userSql(n) + '`)\nCSV(heading(false))';
  const r = await fetch(`${B}/web/api/tql`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: script });
  const t = (await r.text()).trim();
  const names = [...new Set(t.split('\n').map((x) => x.trim()).filter(Boolean))];
  return { ok: r.ok, names, raw: t.slice(0, 60), status: r.status };
}
{
  const withH = await tqlUser({ ...H, ...CONSOLE_H });
  add('/web/api/tql + 콘솔헤더', withH.names.length === 1 && withH.names[0] === sub.toUpperCase() ? 'PASS' : 'FAIL',
    withH.ok ? withH.names.join() || withH.raw : `HTTP ${withH.status} ${withH.raw}`);

  const noH = await tqlUser(H);
  const leaked = noH.names.length === 1 && noH.names[0] === 'SYS' && sub.toUpperCase() !== 'SYS';
  add('/web/api/tql 헤더 없이', leaked ? 'LEAK' : (noH.names[0] === sub.toUpperCase() ? 'SAFE' : 'INFO'),
    leaked ? 'SYS 로 실행됨 — 관문 자동 부착 필수' : (noH.ok ? noH.names.join() || noH.raw : `HTTP ${noH.status}`));
}

// ③ 파일 API 가 계정별로 걸러지는가 — 설정을 DB 에 둘지 파일로 되돌릴지가 여기서 갈린다
{
  const r = await fetch(`${B}/web/api/files${PKG}/cgi-bin/config/`, { headers: H });
  const t = await r.text();
  let names = [];
  try { names = (JSON.parse(t).data.children || []).map((c) => c.name); } catch { /* 형식 불명 */ }
  add('/web/api/files 목록', r.ok ? 'PASS' : 'FAIL', r.ok ? names.join(' ') || '비어 있음' : `HTTP ${r.status}`);

  // 워크스페이스 루트가 통째로 보이면 격리가 아니라는 뜻이다
  const root = await fetch(`${B}/web/api/files/`, { headers: H });
  const rt = await root.text();
  let rootNames = [];
  try { rootNames = (JSON.parse(rt).data.children || []).map((c) => c.name); } catch { /* 형식 불명 */ }
  add('/web/api/files 루트', rootNames.length > 3 ? 'NO-ISOLATION' : 'INFO',
    rootNames.slice(0, 8).join(' ') || `HTTP ${root.status}`);
}

const W = Math.max(...rows.map((r) => r.n.length));
console.log(`\nJWT 프로브 — ${B}${sub ? ` / sub=${sub}` : ''}\n`);
for (const r of rows) console.log(`${r.n.padEnd(W)}  ${r.v.padEnd(13)}  ${r.note}`);
