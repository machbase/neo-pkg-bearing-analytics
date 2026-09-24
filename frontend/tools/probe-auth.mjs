// 유저별 토큰 전환의 전제를 서버에 직접 찍는다 — 코드를 고치기 전에 무엇이 실제로 허용되는지 본다.
// 비-SYS 계정의 API 토큰이 있어야 판정이 성립한다. 토큰 없이는 전부 기본 신원(SYS)으로 통과해
// "되는 것처럼" 보이기 때문이다.
//   VIBE_TOKEN=nt_... node frontend/tools/probe-auth.mjs
const B = (process.env.VIBE_BASE || 'http://127.0.0.1:5654').replace(/\/$/, '');
const TOK = process.env.VIBE_TOKEN || '';
const PKG = process.env.VIBE_PKG || '/public/neo-pkg-bearing-analytics';
const H = TOK ? { Authorization: 'Bearer ' + TOK } : {};
const nonce = 'p' + Math.random().toString(36).slice(2, 12) + 'z';

if (!TOK) {
  console.log('VIBE_TOKEN 이 없습니다 — 비-SYS 계정의 API 토큰(nt_...)을 넣고 다시 실행하세요.');
  console.log('토큰 없이 돌리면 서버가 기본 신원으로 통과시켜 모든 항목이 거짓 PASS 가 됩니다.');
  process.exit(2);
}

const rows = [];
const add = (id, name, verdict, note) => rows.push({ id, name, verdict, note });

async function q(sql, headers) {
  const url = `${B}/db/query?q=${encodeURIComponent(sql)}&format=json`;
  const r = await fetch(url, { headers: headers ?? H });
  const j = await r.json().catch(() => ({ success: false, reason: `HTTP ${r.status}` }));
  return { ok: r.ok && j.success !== false, status: r.status, reason: j.reason || '', rows: (j.data && j.data.rows) || [] };
}
async function files(path, opts) {
  const r = await fetch(`${B}/db/files${path}`, { ...opts, headers: { ...H, ...(opts && opts.headers) } });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* 본문이 JSON이 아닐 수 있다 */ }
  return { ok: r.ok, status: r.status, json: j, text };
}

/* 0a — 신원 확정. 난수를 심은 쿼리가 자기 자신을 V$STMT 에 남기므로 세션을 특정할 수 있다.
   커넥션 풀링으로 항상 SYS 가 나오면 이름 기반 격리 자체가 불가능하다. */
let user = '';
{
  const r = await q(`SELECT s.USER_NAME FROM V$STMT t, V$SESSION s WHERE t.SESS_ID=s.ID AND t.QUERY LIKE '%${nonce}%'`);
  const names = [...new Set(r.rows.map((x) => String(x[0])))];
  if (!r.ok) add('0a', '신원 확정', 'FAIL', `프로브 실패 — ${r.reason || r.status}`);
  else if (names.length !== 1) add('0a', '신원 확정', 'FAIL', `세션 특정 불가 (${names.length}건: ${names.join()})`);
  else if (names[0] === 'SYS') add('0a', '신원 확정', 'FAIL', '토큰을 보냈는데 SYS — 토큰이 무시되거나 SYS 토큰');
  else { user = names[0]; add('0a', '신원 확정', 'PASS', `토큰 계정 = ${user}`); }
}

/* 0b — /db/files 가 /web/api/files 와 같은 루트·같은 응답 모양인가. listDir 이 data.children 을 직접 판다. */
{
  const r = await files(`${PKG}/cgi-bin/`);
  const kids = r.json && r.json.data && r.json.data.children;
  if (!r.ok) add('0b', '파일 API 동형', 'FAIL', `패키지 경로 읽기 실패 — HTTP ${r.status}`);
  else if (!Array.isArray(kids)) add('0b', '파일 API 동형', 'FAIL', 'data.children 배열이 없음 — 응답 모양이 다름');
  else add('0b', '파일 API 동형', 'PASS', `children ${kids.length}건, 경로 규칙 동일`);
}

/* 0c — 유저 폴더를 만들고 쓸 수 있는가. 못 하면 config/{user}/ 구조 자체가 불가능하다.
   프로브가 만든 것은 프로브가 지운다(남기면 다음 실행의 판정을 흐린다). */
{
  const dir = `${PKG}/cgi-bin/config/.probe-${nonce}`;
  const mk = await files(`${dir}/`, { method: 'POST' });
  const wr = await files(`${dir}/t.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"probe":1}' });
  const rd = await files(`${dir}/t.json`);
  const back = rd.json && rd.json.probe === 1;
  await files(`${dir}/t.json`, { method: 'DELETE' });
  const rmDir = await files(dir, { method: 'DELETE' });
  if (!mk.ok) add('0c', '폴더 생성·쓰기', 'FAIL', `디렉터리 생성 실패 — HTTP ${mk.status}`);
  else if (!wr.ok || !back) add('0c', '폴더 생성·쓰기', 'FAIL', `쓰기/되읽기 실패 — HTTP ${wr.status}`);
  else add('0c', '폴더 생성·쓰기', 'PASS', `생성·쓰기·되읽기 성공${rmDir.ok ? '' : ' (정리 실패 — 수동 삭제 필요)'}`);
  if (!rmDir.ok) console.log(`  ⚠ 남은 폴더: ${dir}`);
}

/* 0d — 접두 없는 이름이 무엇으로 해석되는가. catalogWhere(owner) 기본값이 'SYS' 라
   목록과 실제 조회가 서로 다른 스키마를 보게 되는지가 여기서 갈린다. */
{
  const bare = await q('SELECT COUNT(*) FROM MONSTATE');
  const qual = await q('SELECT COUNT(*) FROM SYS.MONSTATE');
  const note = `접두없음 ${bare.ok ? '성공' : '실패'} / SYS. 접두 ${qual.ok ? '성공' : '실패'}`;
  if (bare.ok && qual.ok) add('0d', '비수식 이름 해석', 'INFO', `${note} — 둘 다 열림(같은 스키마이거나 권한 넓음)`);
  else if (!bare.ok && qual.ok) add('0d', '비수식 이름 해석', 'INFO', `${note} — owner 전달 필수`);
  else add('0d', '비수식 이름 해석', 'FAIL', `${note} — 이 계정은 진동 테이블에 접근 불가`);
}

/* 0e — TQL 안의 @jsh/fs 가 유저별로 갇히는가. 안 갇히면 남의 토큰·서비스 계정 비번이 읽히므로
   유저 격리는 "실수 방지"이지 권한 경계가 아니다. 읽히는지만 보고 내용은 출력하지 않는다. */
{
  const script = [
    'FAKE(linspace(0,0,1))',
    'SCRIPT({',
    '  var ok = 0;',
    `  try { require("@jsh/fs").readFile("/work${PKG}/cgi-bin/config/llm.json"); ok = 1; } catch (e) { ok = 0; }`,
    '  $.yield(ok);',
    '})',
    'CSV()',
  ].join('\n');
  const r = await fetch(`${B}/db/tql`, { method: 'POST', headers: { ...H, 'Content-Type': 'text/plain' }, body: script });
  const t = (await r.text()).trim();
  if (!r.ok) add('0e', 'TQL 파일 격리', 'INFO', `TQL 실행 실패 — HTTP ${r.status} (별도 확인 필요)`);
  else if (/^1\b/.test(t)) add('0e', 'TQL 파일 격리', 'FAIL', '남의 설정 파일이 읽힘 — 격리는 실수 방지 수준');
  else if (/^0\b/.test(t)) add('0e', 'TQL 파일 격리', 'PASS', '파일 접근이 막힘');
  else add('0e', 'TQL 파일 격리', 'INFO', `판정 불가 — 응답: ${t.slice(0, 60)}`);
}

/* 0f — 타이머 이름 길이 상한. /web/api/timers 는 JWT 전용이라 토큰으로는 찍을 수 없다. */
add('0f', '타이머 이름 길이', 'SKIP', '서비스 계정 JWT 필요 — Phase 6 착수 시 확인');

/* 0g — 토큰 유저가 자기 스키마에 테이블을 만들 수 있는가. 된다면 앱 저장소를 SYS 공용으로 두고
   GRANT 를 관리하는 대신 유저별 테이블로 가를 수 있다 — 키 접두도 GRANT 도 필요 없어진다. */
{
  const t = `NEO_VIBE_PROBE_${nonce.slice(1, 7).toUpperCase()}`;
  const mk = await q(`CREATE LOOKUP TABLE ${t} (K VARCHAR(40) PRIMARY KEY, VAL VARCHAR(40))`);
  const wr = mk.ok ? await q(`INSERT INTO ${t} VALUES('k','v')`) : null;
  const rd = mk.ok ? await q(`SELECT VAL FROM ${t}`) : null;
  if (mk.ok) await q(`DROP TABLE ${t}`);
  if (!mk.ok) add('0g', '자기 테이블 생성', 'FAIL', `CREATE 거부 — ${mk.reason || mk.status}`);
  else if (!wr.ok || !rd.ok) add('0g', '자기 테이블 생성', 'FAIL', 'CREATE 는 되나 INSERT/SELECT 실패');
  else add('0g', '자기 테이블 생성', 'PASS', '생성·쓰기·읽기·삭제 성공 — 유저별 저장소 가능');
}

const W = Math.max(...rows.map((r) => r.name.length));
console.log(`\n전제 프로브 — ${B}${user ? ` / 계정 ${user}` : ''}\n`);
for (const r of rows) console.log(`${r.id}  ${r.name.padEnd(W)}  ${r.verdict.padEnd(4)}  ${r.note}`);

const a = rows.find((r) => r.id === '0a');
if (a.verdict !== 'PASS') {
  console.log('\n☠ 0a 실패 — 토큰으로 계정을 특정할 수 없습니다. 이름 기반 격리가 성립하지 않으므로');
  console.log('   신원 확정 방식을 다시 정하기 전에는 Phase 1 로 넘어가면 안 됩니다.');
  process.exit(1);
}
