/* 감시 목록 밖 태그 정리 — 오프라인(Neo 불필요). npm run smoke에 포함.

   기간 삭제로는 못 하는 일이다: 설비 하나를 철거해 그 이력만 지우려 해도 기간으로 지우면
   멀쩡한 다른 태그까지 같이 사라진다. 그래서 태그별 삭제가 필요한데, 그러려면 먼저
   "어느 태그가 얼마나 차지하나"를 알아야 한다(총계로는 대상을 고를 수 없다).

   삭제는 데이터 → 태그 이름(메타) 순이다. 메타 정리 SQL이 "데이터가 하나도 안 남은 이름"만
   지우므로 순서가 바뀌면 아무것도 안 지워지고 철거한 설비가 목록에 영영 남는다. */
globalThis.window = globalThis;

const DB = (await import('../../cgi-bin/db/db.js')).default;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let SQLS = [];                 // 실행된 SQL 순서
let ROWS = {};                 // 패턴 → 반환 행
DB.q = null;                   // db.js 내부 q는 못 갈아끼운다 — fetch를 막는다
globalThis.fetch = (url) => {
  const sql = decodeURIComponent(String(url).replace(/^\/db\/query\?q=/, '').split('&')[0]);
  SQLS.push(sql);
  const key = Object.keys(ROWS).find((k) => sql.includes(k));
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ success: true, data: { rows: key ? ROWS[key] : [] } }),
  });
};

const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── 태그별 보유량 집계 ─────────────────────────────────────────────────────
/* NEO_VIBE_BAND의 NAME은 '테이블:태그:계열'이라 태그 하나가 계열 십여 개를 갖는다.
   묶지 않으면 목록이 계열 수만큼 부풀어 사람이 읽을 수 없다. */
{
  SQLS = [];
  ROWS = {
    'from NEO_VIBE_BAND': [['T:A:sub', 100], ['T:A:one', 100], ['T:A:envBPFO', 50], ['T:B:sub', 7]],
    'from NEO_VIBE_EVENTS': [['T:A', 12], ['T:C', 3]],
  };
  const u = await DB.tagUsage();
  chk(u['T:A'].band === 250, '한 태그의 계열을 합쳐 센다', String(u['T:A'].band));
  chk(u['T:A'].events === 12, '이벤트도 같은 키로 묶인다', String(u['T:A'].events));
  chk(u['T:C'].band === 0 && u['T:C'].events === 3, '이벤트만 있는 태그도 나온다');
  chk(Object.keys(u).sort().join(',') === 'T:A,T:B,T:C', '태그 단위로 묶인다', Object.keys(u).sort().join(','));
}

// 한쪽 조회가 실패해도 다른 쪽은 살린다 — 정리 화면이 통째로 안 열리는 것보다 낫다
{
  const okFetch = globalThis.fetch;
  globalThis.fetch = (url) => (String(url).includes('NEO_VIBE_BAND')
    ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ success: false, reason: 'boom' }) })
    : okFetch(url));
  const u = await DB.tagUsage();
  chk(u['T:A'] && u['T:A'].events === 12, '대역 조회가 실패해도 이벤트는 나온다', JSON.stringify(u['T:A'] || null));
  globalThis.fetch = okFetch;
}

// ── 지울 계열 목록이 최신인가 ──────────────────────────────────────────────
/* 여기가 조용히 어긋나기 쉬운 자리다 — 계열을 늘릴 때 삭제 목록만 빠지면 지워지지 않은 계열이
   남고, 그러면 메타 정리도 안 된다("데이터가 없는 이름"이 아니게 되므로). */
{
  SQLS = []; ROWS = {};
  await DB.deleteBandOfTag('T', 'A');
  const deleted = SQLS.filter((s) => /^delete from NEO_VIBE_BAND where NAME=/.test(s))
    .map((s) => (/NAME='T:A:([^']+)'/.exec(s) || [])[1]);
  const want = VC.BAND_ORDER.concat(VC.BAND_CTX, VC.BAND_LEGACY || []);
  const missed = want.filter((bn) => deleted.indexOf(bn) < 0);
  chk(missed.length === 0, '저장하는 계열을 하나도 안 남기고 지운다', missed.join(',') || `${deleted.length}종`);
  chk(deleted.indexOf('envBPFO') >= 0 && deleted.indexOf('envPkRel') >= 0, '포락선 계열도 지운다');
  chk(deleted.indexOf('fr') >= 0 && deleted.indexOf('envF0') >= 0, '저장 전용 계열도 지운다');

  // 데이터 → 메타 순서. 뒤집히면 메타 정리가 아무것도 못 지운다.
  const iMeta = SQLS.findIndex((s) => /metadata/.test(s));
  const iLast = SQLS.map((s, i) => (/^delete from NEO_VIBE_BAND where NAME=/.test(s) ? i : -1)).filter((i) => i >= 0).pop();
  chk(iMeta > iLast, '데이터를 다 지운 뒤에 태그 이름을 정리한다', `데이터 마지막 ${iLast} → 메타 ${iMeta}`);
  chk(/NAME not in \(select NAME from/.test(SQLS[iMeta]), '데이터가 안 남은 이름만 지운다', SQLS[iMeta]);
}
{
  SQLS = []; ROWS = {};
  await DB.deleteEventsOfTag('T', 'A');
  const iMeta = SQLS.findIndex((s) => /metadata/.test(s));
  const iDel = SQLS.findIndex((s) => /^delete from NEO_VIBE_EVENTS/.test(s));
  chk(iDel >= 0 && iMeta > iDel, '이벤트도 데이터 → 메타 순서', `${iDel} → ${iMeta}`);
}

// ── 화면이 고아만 골라 보여주는가 ──────────────────────────────────────────
{
  const a = Object.create(App.prototype);
  a.E = { fmtDT: (m) => new Date(m).toISOString().replace('T', ' ').slice(0, 19) };
  a._num = (n) => String(n);
  a.data = { equipment: [{ id: 'T:A', table: 'T', name: 'A' }] };   // 지금 감시 중인 태그
  a.state = {
    srcSel: ['T'],
    usage: { events: { rows: 15, span: null }, band: { rows: 257, span: null }, monstate: { rows: 2 }, baseline: { rows: 6 } },
    tagUsage: { 'T:A': { band: 250, events: 12 }, 'T:B': { band: 7, events: 0 }, 'T:C': { band: 0, events: 3 } },
  };
  a._monState = {};
  const base = {};
  a._dataVals(base);
  const keys = base.orphanRows.map((r) => r.key);
  chk(keys.indexOf('T:A') < 0, '감시 중인 태그는 목록에 없다', keys.join(','));
  chk(keys.length === 2 && keys.indexOf('T:B') >= 0 && keys.indexOf('T:C') >= 0, '감시 목록 밖 태그만 나온다', keys.join(','));
  // 큰 것부터 — 정리해서 얻는 게 큰 순서로 보여야 고를 수 있다
  chk(base.orphanRows[0].key === 'T:B', '보유량이 큰 태그가 위로', keys.join(','));
  chk(/7행/.test(base.orphanRows[0].stat) && /3건/.test(base.orphanRows[1].stat), '대역·이벤트를 나눠 적는다',
    base.orphanRows.map((r) => r.stat).join(' | '));
  // 표에도 총량이 붙어야 목록을 열기 전에 정리할 게 있는지 안다
  const bandRow = base.dataRows.find((r) => r.id === 'band');
  chk(/감시 대상 밖 7행/.test(bandRow.stat), '표 요약에 감시 대상 밖 양이 붙는다', bandRow.stat);
  chk(!!bandRow.act2, '고아가 있으면 태그별 정리 버튼이 생긴다');
  /* 예전에는 이 자리에 "태그 단위 삭제도 가능"이라고 적혀 있었는데 그 화면이 없었다.
     문구가 기능보다 앞서 있으면 사용자는 자기가 못 찾는 것으로 읽는다. */
  const evRow = base.dataRows.find((r) => r.id === 'events');
  chk(evRow.act.sub !== '태그 단위 삭제도 가능', '없는 기능을 있다고 적지 않는다', evRow.act.sub);

  // 고아가 없으면 버튼도 없다 — 누를 이유가 없는 버튼을 두지 않는다
  a.state.tagUsage = { 'T:A': { band: 250, events: 12 } };
  const base2 = {};
  a._dataVals(base2);
  chk(base2.orphanRows.length === 0 && !base2.dataRows.find((r) => r.id === 'band').act2, '고아가 없으면 버튼이 없다');
}

// ── 정리 실행 ──────────────────────────────────────────────────────────────
{
  const a = Object.create(App.prototype);
  const calls = [];
  a.state = {}; a._monState = { 'T:B': { g: 1 }, 'T:A': { g: 0 } };
  a.setState = (o) => Object.assign(a.state, o);
  a._toast = () => {};
  a._refreshUsage = () => { calls.push('refresh'); return Promise.resolve(); };
  SQLS = []; ROWS = {};
  await a._purgeOrphan([{ key: 'T:B', band: 7, events: 0 }]);
  chk(SQLS.some((s) => /delete from NEO_VIBE_BAND where NAME='T:B:sub'/.test(s)), '대역 데이터를 지운다');
  chk(!SQLS.some((s) => /delete from NEO_VIBE_EVENTS/.test(s)), '없는 이벤트는 지우러 가지 않는다');
  chk(SQLS.some((s) => /NEO_VIBE_MONSTATE/.test(s)), '판정 상태도 함께 지운다');
  /* 화면이 들고 있는 판정 상태 캐시를 안 비우면, 지운 태그가 '감시 대상 밖'으로 계속 세진다 —
     지웠는데 숫자가 그대로라 사용자는 삭제가 안 된 줄로 읽는다. */
  chk(!a._monState['T:B'] && !!a._monState['T:A'], '지운 태그만 캐시에서 빠진다', Object.keys(a._monState).join(','));
  chk(calls.indexOf('refresh') >= 0, '지운 뒤 현황을 다시 읽는다');
  chk(a.state.orphanBusy === null, '진행 표시가 풀린다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
