// 데이터 삭제 경로 검사 — 오프라인. npm run smoke에 포함.
// 핵심 주장: 행을 지우면 데이터가 하나도 안 남은 태그의 "이름"도 같이 사라진다.
// TAG 표는 데이터와 이름 등록이 따로라, 행만 지우면 철거한 설비가 태그 목록에 영영 남는다.
globalThis.window = globalThis;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── 문장 ───────────────────────────────────────────────────────────────────
{
  const q = SQL.metaPurgeOrphans('NEO_VIBE_BAND');
  chk(/^delete from NEO_VIBE_BAND metadata\b/.test(q), '이름 삭제는 METADATA 절을 쓴다', q);
  /* 조건이 "데이터가 남은 이름의 여집합"이어야 한다. 구간을 조건에 넣으면 안 된다 —
     일부만 지운 태그의 이름까지 지워져, 살아 있는 설비가 목록에서 사라진다. */
  chk(/not in \(select NAME from NEO_VIBE_BAND group by NAME\)/.test(q), '데이터가 남은 이름은 건드리지 않는다', q);
  chk(!/TIME|between/i.test(q), '이름 삭제에는 기간 조건이 없다', q);

  chk(/NEO_VIBE_EVENTS metadata/.test(SQL.metaPurgeOrphans('NEO_VIBE_EVENTS')), '이벤트 표에도 같은 규칙');
}

// ── 삭제 경로가 두 문장을 모두 낸다 ────────────────────────────────────────
{
  /* db.js는 fetch를 타므로 q()만 가로채 어떤 SQL이 나갔는지 본다.
     행 삭제만 하고 이름을 안 지우면 "지웠는데 태그가 그대로"가 된다 — 실제로 그랬다. */
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

  // db.js 내부 함수를 그대로 재현한다(모듈이 fetch를 물고 있어 직접 import가 안 된다)
  const purgeNames = (t) => fake.q(SQL.metaPurgeOrphans(t)).catch(() => null);
  await run('기간 삭제(대역) — 행과 이름을 함께 지운다', () =>
    fake.q(SQL.bandDeleteRange(1, 2)).then(() => purgeNames('NEO_VIBE_BAND')));
  await run('기간 삭제(이벤트) — 행과 이름을 함께 지운다', () =>
    fake.q(SQL.eventsDeleteRange(1, 2)).then(() => purgeNames('NEO_VIBE_EVENTS')));
  await run('태그 삭제(이벤트) — 행과 이름을 함께 지운다', () =>
    fake.q(SQL.eventsDeleteTag('T', 'A')).then(() => purgeNames('NEO_VIBE_EVENTS')));
}

// ── 실제 소스에 배선돼 있는가 ──────────────────────────────────────────────
{
  /* 위 검사는 "이렇게 부르면 맞다"까지만 본다. 진짜 배선은 db.js가 하므로 소스를 직접 확인한다
     — 배선을 빠뜨리면 위 검사는 통과하는데 화면에서는 이름이 안 지워진다. */
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
