// 데이터 삭제 경로 — 오프라인(Neo 불필요) · npm run smoke 포함
// · 행 삭제 시 데이터가 안 남은 태그 이름(METADATA)도 정리(TAG 표는 데이터·이름 등록이 별개)
// · 기간 삭제는 이름별 문장(계정 접두, 시간 조건만인 DELETE 없음), db.js 배선 확인
globalThis.window = globalThis;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── 문장 ───────────────────────────────────────────────────────────────────
{
  const q = SQL.metaPurgeOrphans('BAND');
  chk(/^delete from BAND metadata\b/.test(q), '이름 삭제는 METADATA 절을 쓴다', q);
  /* 조건 = "데이터가 남은 이름의 여집합", 기간 조건 금지(일부만 지운 태그의 이름까지 삭제됨) */
  chk(/not in \(select NAME from BAND group by NAME\)/.test(q), '데이터가 남은 이름은 건드리지 않는다', q);
  chk(!/TIME|between/i.test(q), '이름 삭제에는 기간 조건이 없다', q);

  chk(/EVENTS metadata/.test(SQL.metaPurgeOrphans('EVENTS')), '이벤트 표에도 같은 규칙');
}

// ── 삭제 경로가 두 문장 모두 실행 ────────────────────────────────────────
{
  /* 가짜 q()로 실행 SQL 관찰 — 행만 지우고 이름을 안 지우면 "지웠는데 태그가 그대로" */
  const seen = [];
  const fake = {
    q: (sql) => { seen.push(String(sql)); return Promise.resolve([]); },
  };
  const run = async (name, fn) => {
    seen.length = 0;
    await fn();
    const del = seen.filter((s) => /^delete/i.test(s) && !/metadata/i.test(s)).length;
    const meta = seen.filter((s) => /metadata/i.test(s)).length;
    chk(del >= 1 && meta === 1, name, `행 삭제 ${del}건 · 이름 정리 ${meta}건`);
  };

  // db.js 내부 함수(purgeNames·순차 실행) 재현
  const purgeNames = (t) => fake.q(SQL.metaPurgeOrphans(t)).catch(() => null);
  const runAll = (list) => list.reduce((p2, sql) => p2.then(() => fake.q(sql)), Promise.resolve());
  /* 기간 삭제는 이름마다 한 문장 — 계정 공유 표라 시간만으로 지우면 남의 행까지 삭제,
     TAG 표는 LIKE 불가(ERR-2073: NAME 정확일치 + 시간범위만) */
  const KEYS = ['T:A:fault', 'T:B:fault'];
  await run('기간 삭제(대역) — 행과 이름을 함께 지운다', () =>
    runAll(SQL.bandDeleteRange(KEYS, 1, 2)).then(() => purgeNames('BAND')));
  await run('기간 삭제(이벤트) — 행과 이름을 함께 지운다', () =>
    runAll(SQL.eventsDeleteRange(KEYS, 1, 2)).then(() => purgeNames('EVENTS')));
  await run('태그 삭제(이벤트) — 행과 이름을 함께 지운다', () =>
    fake.q(SQL.eventsDeleteTag('T', 'A')).then(() => purgeNames('EVENTS')));
}

// ── 기간 삭제가 남의 행 미접촉 ─────────────────────────────────
{
  /* 시간 조건만인 DELETE는 공용 표에서 전 계정 데이터 삭제 — 에러 없이 "남의 데이터 소실"로만 나타남 */
  SQL.setScope('NEO_BEARING_STORE', 'JOY');
  const stmts = SQL.bandDeleteRange(['T:A:fault'], 1, 2).concat(SQL.eventsDeleteRange(['T:A'], 1, 2));
  chk(stmts.length === 2, '이름 하나당 문장 하나', `${stmts.length}건`);
  chk(stmts.every((q) => q.includes("NAME='JOY:")), '지울 이름에 계정 접두가 붙는다', stmts[0]);
  chk(stmts.every((q) => /NAME=/.test(q)), '시간 조건만으로 지우는 문장이 없다', stmts.join(' | '));
  chk(SQL.bandDeleteRange([], 1, 2).length === 0, '지울 이름이 없으면 문장도 없다');
  SQL.setScope('', '');
}

// ── 실제 소스 배선 ──────────────────────────────────────────────
{
  /* 위 검사는 호출 규칙까지만 — 실제 배선은 db.js 소스로 확인 */
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
  ['deleteEventsRange', 'deleteBandRange', 'deleteEventsOfTag', 'deleteBandOfTag'].forEach((fn) => {
    const i = src.indexOf('function ' + fn + '(');
    const body = i >= 0 ? src.slice(i, src.indexOf('\n  function ', i + 10)) : '';
    chk(i >= 0 && /purgeNames\(/.test(body), fn + '이 이름 정리를 부른다');
  });
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
