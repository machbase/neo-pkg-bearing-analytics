// 계정별 폴더가 실제로 격리되는지 — 남의 설정을 읽을 수 있으면 그 격리는 "실수 방지"이지
// 권한 경계가 아니다. 특히 토큰을 서버에 두려면 이 결과가 먼저 나와야 한다:
// 남의 user.json 이 읽히면 토큰 보관은 곧 권한 상승 경로가 된다.
//   VIBE_TOKEN=nt_... node frontend/tools/probe-isolation.mjs
const B = (process.env.VIBE_BASE || 'http://127.0.0.1:5654').replace(/\/$/, '');
const TOK = process.env.VIBE_TOKEN || '';
const PKG = process.env.VIBE_PKG || '/public/neo-pkg-bearing-analytics';
const H = TOK ? { Authorization: 'Bearer ' + TOK } : {};
const nonce = 'p' + Math.random().toString(36).slice(2, 12) + 'z';
if (!TOK) { console.log('VIBE_TOKEN 이 없습니다 — 비-SYS 계정의 토큰을 넣고 실행하세요.'); process.exit(2); }

const rows = [];
const add = (n, v, note) => rows.push({ n, v, note });
async function q(sql) {
  const r = await fetch(`${B}/db/query?q=${encodeURIComponent(sql)}&format=json`, { headers: H });
  const j = await r.json().catch(() => ({ success: false, reason: `HTTP ${r.status}` }));
  return { ok: r.ok && j.success !== false, reason: j.reason || '', rows: (j.data && j.data.rows) || [] };
}
async function files(p, opts) {
  const r = await fetch(`${B}/db/files${p}`, { ...opts, headers: { ...H, ...(opts && opts.headers) } });
  const t = await r.text();
  return { ok: r.ok, status: r.status, text: t };
}

const who = await q(`SELECT s.USER_NAME FROM V$STMT t, V$SESSION s WHERE t.SESS_ID=s.ID AND t.QUERY LIKE '%${nonce}%'`);
const names = [...new Set(who.rows.map((x) => String(x[0])))];
if (names.length !== 1 || names[0] === 'SYS') { console.log(`비-SYS 토큰이 필요합니다 (${names.join() || '특정 실패'})`); process.exit(1); }
const U = names[0];

// 남의 것을 만들어 두고 내 토큰으로 읽어 본다. SYS 폴더는 이미 있을 수 있으니 전용 대상을 쓴다.
const victim = `${PKG}/cgi-bin/config/PROBE_OTHER_${nonce.slice(1, 6).toUpperCase()}`;
const secret = JSON.stringify({ token: 'nt_secret_of_another_user', note: 'probe' });
const mk = await fetch(`${B}/db/files${victim}/`, { method: 'POST' });          // 헤더 없음 = 기본 신원(SYS)
await fetch(`${B}/db/files${victim}/user.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: secret });
add('남의 폴더 생성(SYS)', mk.ok ? 'PASS' : 'FAIL', mk.ok ? victim.split('/').pop() : `HTTP ${mk.status}`);

const rd = await files(`${victim}/user.json`);
add('파일 API 로 남의 토큰 읽기', rd.ok && rd.text.includes('nt_secret') ? 'FAIL' : 'PASS',
  rd.ok && rd.text.includes('nt_secret') ? `${U} 가 남의 user.json 을 읽음 — 격리 아님` : `차단됨 (HTTP ${rd.status})`);

const ls = await files(`${PKG}/cgi-bin/config/`);
add('파일 API 로 계정 폴더 목록', ls.ok && ls.text.includes('PROBE_OTHER') ? 'FAIL' : 'PASS',
  ls.ok && ls.text.includes('PROBE_OTHER') ? '남의 폴더가 목록에 보임' : `안 보임 (HTTP ${ls.status})`);

const script = ['FAKE(linspace(0,0,1))', 'SCRIPT({', '  var ok = 0;',
  `  try { var t = String(require("@jsh/fs").readFile("/work${victim}/user.json")); ok = t.indexOf("nt_secret") >= 0 ? 1 : 0; } catch (e) { ok = 0; }`,
  '  $.yield(ok);', '})', 'CSV()'].join('\n');
const tr = await fetch(`${B}/db/tql`, { method: 'POST', headers: { ...H, 'Content-Type': 'text/plain' }, body: script });
const tt = (await tr.text()).trim();
add('TQL 로 남의 토큰 읽기', /^1\b/.test(tt) ? 'FAIL' : 'PASS',
  /^1\b/.test(tt) ? `${U} 가 TQL 로 남의 user.json 을 읽음 — 서버 토큰 보관은 권한 상승` : `차단됨 (${tt.slice(0, 40)})`);

await fetch(`${B}/db/files${victim}/user.json`, { method: 'DELETE' });
const rm = await fetch(`${B}/db/files${victim}`, { method: 'DELETE' });
add('정리', rm.ok ? 'PASS' : 'FAIL', rm.ok ? '삭제됨' : `수동 삭제 필요: ${victim}`);

const W = Math.max(...rows.map((r) => r.n.length));
console.log(`\n계정 격리 프로브 — ${B} / 계정 ${U}\n`);
for (const r of rows) console.log(`${r.n.padEnd(W)}  ${r.v.padEnd(4)}  ${r.note}`);
