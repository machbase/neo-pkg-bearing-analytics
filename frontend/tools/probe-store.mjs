// 전용 DB 저장소가 실제 서버에서 도는지 — 테이블·롤업 생성부터 설정 왕복까지 앱과 같은 경로로 찍는다.
//   VIBE_TOKEN=nt_... node frontend/tools/probe-store.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = createRequire(import.meta.url)(path.join(HERE, '../../cgi-bin/db/db.js'));
const B = (process.env.VIBE_BASE || 'http://127.0.0.1:5654').replace(/\/$/, '');
const TOK = process.env.VIBE_TOKEN || '';
if (!TOK) { console.log('VIBE_TOKEN 이 없습니다.'); process.exit(2); }

// db.js 는 상대 경로로 fetch 한다 — node 에서 돌리려면 호스트를 붙여 준다
const real = globalThis.fetch;
globalThis.fetch = (u, init) => real(String(u).startsWith('http') ? u : B + u, init);
const sysQ = async (sql) => {
  const r = await real(`${B}/db/query?q=${encodeURIComponent(sql)}&format=json`);
  const j = await r.json().catch(() => ({ success: false }));
  return { ok: j.success !== false, reason: j.reason || '', rows: (j.data && j.data.rows) || [] };
};

const rows = [];
const add = (n, v, note) => rows.push({ n, v, note });
DB.setToken(TOK);
const U = await DB.whoami().catch(() => '');
if (!U || U === 'SYS') { console.log(`비-SYS 토큰이 필요합니다 (${U || '특정 실패'})`); process.exit(1); }
DB.setUser(U);

let made = false;
try {
  if (!(await DB.checkAppDb())) {
    const mk = await sysQ('CREATE DATABASE VIBE');
    made = mk.ok;
    await sysQ(`GRANT CONNECT ON DATABASE VIBE TO ${U}`);
    await sysQ(`GRANT CREATE ON DATABASE VIBE TO ${U}`);
    add('DB 준비', mk.ok ? 'PASS' : 'FAIL', mk.ok ? 'VIBE 생성 + 권한 부여' : mk.reason);
  } else add('DB 준비', 'PASS', '이미 사용 가능');

  add('checkAppDb', (await DB.checkAppDb()) ? 'PASS' : 'FAIL', '');

  await DB.ensureMonTables();
  add('저장소 테이블 생성', 'PASS', '5종 + 권한 확인 통과');

  // CREATE ROLLUP 으로 만든 객체는 이름에 'ROLLUP' 이 안 들어간다 — 붙인 이름 그대로다
  const roll = await sysQ(`SELECT DATABASE_NAME, NAME FROM M$SYS_TABLES WHERE NAME LIKE 'BAND_%'`);
  add('대역 롤업 생성', roll.rows.length ? 'PASS' : 'FAIL',
    roll.rows.map((r) => r[0] + '.' + r[1]).join(' ') || '없음');

  const cfg = { machineClass: 'III', monitorOn: true, aliases: { 'T:a': '펌프 1번' }, llmKeys: { claude: "sk-'x'" } };
  await DB.saveConfig(cfg);
  const back = await DB.loadConfig();
  add('설정 왕복', back && back.machineClass === 'III' && back.aliases['T:a'] === '펌프 1번' && back.llmKeys.claude === "sk-'x'" ? 'PASS' : 'FAIL',
    back ? JSON.stringify(back).slice(0, 70) : 'null');

  const trend = await DB.bandTrend('T:a:fault', 'min', Date.now() - 3600e3, Date.now()).then(() => 'ok').catch((e) => e.message);
  add('대역 추세 조회', trend === 'ok' ? 'PASS' : 'INFO', trend === 'ok' ? '롤업 경로 동작' : String(trend).slice(0, 60));
} catch (e) {
  add('실패', 'FAIL', (e && e.message) || String(e));
} finally {
  if (made) {
    const rm = await sysQ('DROP DATABASE VIBE CASCADE FORCE');
    add('정리', rm.ok ? 'PASS' : 'FAIL', rm.ok ? 'VIBE 삭제' : `${rm.reason} — 수동 삭제 필요`);
  } else add('정리', 'SKIP', '기존 DB 라 두고 나감');
  const W = Math.max(...rows.map((r) => r.n.length));
  console.log(`\n저장소 프로브 — ${B} / 계정 ${U}\n`);
  for (const r of rows) console.log(`${r.n.padEnd(W)}  ${r.v.padEnd(4)}  ${r.note}`);
}
