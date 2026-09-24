// 전용 DB + 유저 스키마로 앱 저장소를 가를 수 있는지 찍는다. 되면 테이블마다 GRANT 를 관리할
// 필요도, LOOKUP 키에 유저 접두를 붙일 필요도 없어지고 격리가 권한 경계가 된다.
// 두 경로를 차례로 본다: ① 유저가 직접 DB 를 만든다(관리자 개입 없음) ② 안 되면 SYS 가 만들고 권한을 준다.
// 앱이 실제로 만드는 DDL(롤업 포함)을 그대로 써야 판정이 의미가 있다.
//   VIBE_TOKEN=nt_... node frontend/tools/probe-multidb.mjs
// SYS 작업은 무인증 경로로 나간다 — 이 인스턴스는 헤더 없는 요청을 SYS 로 받는다.
const B = (process.env.VIBE_BASE || 'http://127.0.0.1:5654').replace(/\/$/, '');
const TOK = process.env.VIBE_TOKEN || '';
const nonce = 'p' + Math.random().toString(36).slice(2, 12) + 'z';
const DB_U = 'VIBE_PROBE_U';   // 유저가 직접 만드는 DB
const DB_S = 'VIBE_PROBE_S';   // SYS 가 만들고 권한을 주는 DB

if (!TOK) { console.log('VIBE_TOKEN 이 없습니다 — 비-SYS 계정의 API 토큰을 넣고 실행하세요.'); process.exit(2); }

async function run(sql, asUser) {
  const headers = asUser ? { Authorization: 'Bearer ' + TOK } : {};
  const r = await fetch(`${B}/db/query?q=${encodeURIComponent(sql)}&format=json`, { headers });
  const j = await r.json().catch(() => ({ success: false, reason: `HTTP ${r.status}` }));
  return { ok: r.ok && j.success !== false, reason: j.reason || '', rows: (j.data && j.data.rows) || [] };
}
const sys = (sql) => run(sql, false);
const usr = (sql) => run(sql, true);

const rows = [];
const add = (name, verdict, note) => { rows.push({ name, verdict, note }); };
const show = () => {
  const W = Math.max(...rows.map((r) => r.name.length));
  console.log(`\n전용 DB 프로브 — ${B}\n`);
  for (const r of rows) console.log(`${r.name.padEnd(W)}  ${r.verdict.padEnd(4)}  ${r.note}`);
};

const who = await usr(`SELECT s.USER_NAME FROM V$STMT t, V$SESSION s WHERE t.SESS_ID=s.ID AND t.QUERY LIKE '%${nonce}%'`);
const names = [...new Set(who.rows.map((x) => String(x[0])))];
if (names.length !== 1 || names[0] === 'SYS') {
  console.log(`계정 특정 실패 (${names.join() || '없음'}) — 비-SYS 토큰이 필요합니다.`);
  process.exit(1);
}
const U = names[0];

// 유저 스키마에 앱 테이블을 만들고 쓰고 읽는다. 어느 DB 에서든 같은 검사를 돌린다.
async function exercise(db, tag) {
  const P = `${db}.${U}`;
  const ddl = [
    ['LOOKUP', `CREATE LOOKUP TABLE ${P}.MONSTATE (K VARCHAR(200) PRIMARY KEY, VAL VARCHAR(4000))`],
    ['TAG', `CREATE TAG TABLE ${P}.EVENTS (NAME VARCHAR(200) PRIMARY KEY, TIME DATETIME BASETIME, VALUE DOUBLE, ETYPE VARCHAR(16), GRADE VARCHAR(8), LIM DOUBLE, DETAIL VARCHAR(400), EID VARCHAR(120))`],
    ['TAG+롤업', `CREATE TAG TABLE ${P}.BAND (NAME VARCHAR(200) PRIMARY KEY, TIME DATETIME BASETIME, VALUE DOUBLE SUMMARIZED)`],
  ];
  for (const [label, sql] of ddl) {
    const r = await usr(sql);
    add(`${tag} CREATE ${label}`, r.ok ? 'PASS' : 'FAIL', r.ok ? '생성됨' : r.reason);
  }
  const ins = await usr(`INSERT INTO ${P}.MONSTATE VALUES('k','v')`);
  const sel = await usr(`SELECT VAL FROM ${P}.MONSTATE WHERE K='k'`);
  add(`${tag} INSERT/SELECT`, ins.ok && sel.rows.length === 1 ? 'PASS' : 'FAIL', ins.ok ? `되읽기 ${sel.rows.length}건` : ins.reason);

  const bins = await usr(`INSERT INTO ${P}.BAND VALUES('T:tag:fault', SYSDATE, 1.5)`);
  add(`${tag} TAG INSERT`, bins.ok ? 'PASS' : 'FAIL', bins.ok ? '1건' : bins.reason);

  // 앱의 bandTrend 와 같은 모양. 첫 삽입 직후엔 롤업이 아직 안 돌 수 있다
  const roll = await usr(`SELECT ROLLUP('min',1,TIME) rt, AVG(VALUE) av FROM ${P}.BAND WHERE NAME='T:tag:fault' GROUP BY rt ORDER BY rt`);
  add(`${tag} 롤업 조회`, roll.ok ? 'PASS' : 'INFO', roll.ok ? `${roll.rows.length}건` : `${roll.reason} (첫 삽입 직후면 지연일 수 있음)`);

  const cat = await usr(`SELECT DATABASE_NAME, NAME FROM M$SYS_TABLES WHERE NAME LIKE 'NEO_VIBE%'`);
  const mine = cat.rows.filter((r) => String(r[0]) === db).length;
  add(`${tag} 카탈로그 노출`, cat.ok && mine > 0 ? 'PASS' : 'FAIL', cat.ok ? `${db} ${mine}건 / 전체 ${cat.rows.length}건` : cat.reason);
}

const made = [];
try {
  /* 경로 ① — 유저가 직접 DB 를 만든다. 되면 관리자 개입이 통째로 사라진다. */
  const selfMk = await usr(`CREATE DATABASE ${DB_U}`);
  if (selfMk.ok) {
    made.push(DB_U);
    add('유저가 DB 생성', 'PASS', `${DB_U} — 관리자 GRANT 없이 생성됨`);
    await exercise(DB_U, '유저DB');
  } else {
    add('유저가 DB 생성', 'FAIL', selfMk.reason);

    /* 경로 ② — SYS 가 만들고 권한을 준다. */
    const mk = await sys(`CREATE DATABASE ${DB_S}`);
    if (!mk.ok) { add('SYS DB 생성', 'FAIL', mk.reason); show(); process.exit(1); }
    made.push(DB_S);
    add('SYS DB 생성', 'PASS', `${DB_S} 생성됨`);

    const gc = await sys(`GRANT CONNECT ON DATABASE ${DB_S} TO ${U}`);
    const gr = await sys(`GRANT CREATE ON DATABASE ${DB_S} TO ${U}`);
    add('DB 권한 부여', gc.ok && gr.ok ? 'PASS' : 'FAIL', `CONNECT ${gc.ok ? 'ok' : gc.reason} / CREATE ${gr.ok ? 'ok' : gr.reason}`);
    await exercise(DB_S, 'SYS DB');
  }

  /* 기본 DB 의 SYS 테이블은 어느 경로든 여전히 차단되어야 한다. */
  const leak = await usr('SELECT COUNT(*) FROM MACHBASEDB.SYS.MONSTATE');
  add('기본 DB 격리', leak.ok ? 'FAIL' : 'PASS', leak.ok ? '남의 DB 테이블이 읽힘' : '차단됨');
} finally {
  for (const db of made) {
    // 유저가 만든 DB 는 유저가 지울 수 있어야 한다 — 못 지우면 그것도 알아야 할 사실이다
    let rm = await usr(`DROP DATABASE ${db} CASCADE FORCE`);
    const byUser = rm.ok;
    if (!rm.ok) rm = await sys(`DROP DATABASE ${db} CASCADE FORCE`);
    add(`정리 ${db}`, rm.ok ? 'PASS' : 'FAIL', rm.ok ? (byUser ? '유저가 삭제' : 'SYS 가 삭제') : `${rm.reason} — 수동 삭제 필요`);
  }
  show();
}
