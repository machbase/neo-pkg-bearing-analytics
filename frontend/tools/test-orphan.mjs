/* 감시 목록 밖 태그 정리 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 태그별 보유량 집계(BAND 계열 합산·이벤트), 한쪽 조회 실패 시 다른 쪽 유지
   · 태그별 삭제: 저장 계열 전부, 데이터 → 태그 이름(메타) 순(메타 정리 SQL이 데이터 없는 이름만 지움)
   · 화면에 고아만 보유량 순 표시, 정리 후 판정 캐시·현황 갱신 */
globalThis.window = globalThis;

const DB = (await import('../../cgi-bin/db/db.js')).default;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let SQLS = [];                 // 실행된 SQL 순서
let ROWS = {};                 // 패턴 → 반환 행
DB.q = null;                   // db.js 내부 q는 교체 불가 — fetch를 가로챔
import './_faketoken.mjs';   // db.js 관문용 토큰 칸
globalThis.fetch = (url) => {
  const sql = decodeURIComponent(String(url).replace(/^[^?]*\?q=/, '').split('&')[0]);
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
/* BAND NAME은 '테이블:태그:계열' — 태그 단위로 묶어 목록이 계열 수만큼 부풀지 않게 함
   · 평소엔 V$_STAT(행 스캔 없음), 삭제 직후(exact)는 원본 집계 — 두 경로 같은 결과 */
const BAND_ROWS = [['T:A:sub', 100], ['T:A:one', 100], ['T:A:envBPFO', 50], ['T:B:sub', 7]];
const EV_ROWS = [['T:A', 12], ['T:C', 3]];
const FAIL_RES = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ success: false, reason: 'boom' }) });
const scansOf = (list) => list.filter((s) => /from (EVENTS|BAND)\b/.test(s));   // 원본 표 직접 조회(V$_STAT·메타 제외)
for (const exact of [false, true]) {
  SQLS = [];
  ROWS = { 'V$BAND_STAT': BAND_ROWS, 'V$EVENTS_STAT': EV_ROWS, 'from BAND': BAND_ROWS, 'from EVENTS': EV_ROWS };
  const u = await DB.tagUsage(exact);
  const via = exact ? ' (원본 집계)' : ' (V$_STAT)';
  chk(u['T:A'].band === 250, '한 태그의 계열을 합쳐 센다' + via, String(u['T:A'].band));
  chk(u['T:A'].events === 12, '이벤트도 같은 키로 묶인다' + via, String(u['T:A'].events));
  chk(u['T:C'].band === 0 && u['T:C'].events === 3, '이벤트만 있는 태그도 나온다' + via);
  chk(Object.keys(u).sort().join(',') === 'T:A,T:B,T:C', '태그 단위로 묶인다' + via, Object.keys(u).sort().join(','));
  chk(exact ? scansOf(SQLS).length === 2 : scansOf(SQLS).length === 0,
    exact ? '삭제 직후 갱신은 원본을 센다' : '평소엔 원본 행을 훑지 않는다', SQLS.join(' | '));
}

// V$_STAT 조회 실패 → 원본 집계로 대체
{
  const okFetch = globalThis.fetch;
  globalThis.fetch = (url) => (String(url).includes('_STAT') ? FAIL_RES() : okFetch(url));
  const u = await DB.tagUsage();
  chk(u['T:A'] && u['T:A'].band === 250 && u['T:A'].events === 12, 'V$_STAT이 실패하면 원본 집계로 센다', JSON.stringify(u['T:A'] || null));
  globalThis.fetch = okFetch;
}

// 한쪽 조회가 실패해도 다른 쪽 유지 — 정리 화면 전체 실패 방지
{
  const okFetch = globalThis.fetch;
  globalThis.fetch = (url) => (String(url).includes('BAND') ? FAIL_RES() : okFetch(url));
  const u = await DB.tagUsage();
  chk(u['T:A'] && u['T:A'].events === 12, '대역 조회가 실패해도 이벤트는 나온다', JSON.stringify(u['T:A'] || null));
  globalThis.fetch = okFetch;
}

// ── 데이터 관리 현황 ───────────────────────────────────────────────────────
/* 평소엔 V$_STAT 한 줄(행 수와 무관), 삭제 직후는 원본 집계(V$_STAT 반영 지연) — 화면 값 형태는 같음 */
{
  ROWS = {
    'from V$EVENTS_STAT': [[2, 15, 1000, 2000]],
    'from V$BAND_STAT': [[4, 257, 1500, 2500]],
    'from (select NAME from BAND': [[4]],
    'select count(*) from EVENTS': [[15]],
    'select min(TIME), max(TIME) from EVENTS': [[1000, 2000]],
    'select count(*) from BAND': [[257]],
    'select min(TIME), max(TIME) from BAND': [[1500, 2500]],
    'from MONSTATE': [[3]], 'from BASELINE': [[5]],
  };
  SQLS = []; const fast = await DB.usageStats(); const fastSql = SQLS.slice();
  SQLS = []; const slow = await DB.usageStats(true); const slowSql = SQLS.slice();
  chk(fast.band.rows === 257 && fast.band.keys === 4 && fast.band.span.from === 1500 && fast.band.span.to === 2500
    && fast.events.rows === 15 && fast.events.span.to === 2000 && fast.monstate.rows === 3 && fast.baseline.rows === 5,
    'V$_STAT 한 줄을 화면 값으로 옮긴다', JSON.stringify(fast));
  chk(JSON.stringify(fast) === JSON.stringify(slow), '두 경로의 값·형태가 같다', JSON.stringify(slow));
  chk(scansOf(fastSql).length === 0, '평소 현황은 원본 행을 훑지 않는다', fastSql.join(' | '));
  chk(scansOf(slowSql).length === 5, '삭제 직후 현황은 원본을 센다', String(scansOf(slowSql).length));
  const okFetch = globalThis.fetch;
  globalThis.fetch = (url) => (String(url).includes('_STAT') ? FAIL_RES() : okFetch(url));
  const fb = await DB.usageStats();
  globalThis.fetch = okFetch;
  chk(JSON.stringify(fb) === JSON.stringify(slow), 'V$_STAT이 실패하면 원본 집계로 센다', JSON.stringify(fb));
  ROWS = { 'from V$BAND_STAT': [[0, null, null, null]], 'from V$EVENTS_STAT': [[0, null, null, null]] };
  const empty = await DB.usageStats();
  chk(empty.band.rows === 0 && empty.band.keys === 0 && empty.events.rows === 0 && empty.band.span.from === 0,
    '데이터가 없으면 0건(빈 집계의 null을 0으로)', JSON.stringify(empty.band));
}

// ── 기간 삭제의 이름 목록 ─────────────────────────────────────────────────
/* TAG 표 DELETE는 이름 정확일치만 받음 — 이름은 메타 표에서(행 스캔 없음) */
{
  SQLS = [];
  ROWS = { '_band_meta': [['T:A:fault'], ['T:B:fault']] };
  await DB.deleteBandRange(1000, 2000);
  chk(/_band_meta/.test(SQLS[0] || ''), '지울 이름은 메타 표에서 읽는다', SQLS[0]);
  const dels = SQLS.filter((s) => /^delete from BAND where NAME=/.test(s));
  chk(dels.length === 2 && /T:A:fault/.test(dels[0]) && /T:B:fault/.test(dels[1]), '메타의 이름마다 한 문장', String(dels.length));
  chk(!SQLS.some((s) => /^select NAME, count\(\*\) from BAND/.test(s)), '이름을 모으려고 행을 묶지 않는다');
}

// ── 지울 계열 목록 최신성 ──────────────────────────────────────────────
/* 계열 추가 시 삭제 목록 누락 → 남은 계열 때문에 메타 정리도 안 됨("데이터 없는 이름"이 아니게 됨) */
{
  SQLS = []; ROWS = {};
  await DB.deleteBandOfTag('T', 'A');
  const deleted = SQLS.filter((s) => /^delete from BAND where NAME=/.test(s))
    .map((s) => (/NAME='T:A:([^']+)'/.exec(s) || [])[1]);
  const want = VC.BAND_ORDER.concat(VC.BAND_CTX, VC.BAND_LEGACY || []);
  const missed = want.filter((bn) => deleted.indexOf(bn) < 0);
  chk(missed.length === 0, '저장하는 계열을 하나도 안 남기고 지운다', missed.join(',') || `${deleted.length}종`);
  chk(deleted.indexOf('envBPFO') >= 0 && deleted.indexOf('envPkRel') >= 0, '포락선 계열도 지운다');
  chk(deleted.indexOf('fr') >= 0 && deleted.indexOf('envF0') >= 0, '저장 전용 계열도 지운다');

  // 데이터 → 메타 순서(뒤집히면 메타 정리 불가)
  const iMeta = SQLS.findIndex((s) => /metadata/.test(s));
  const iLast = SQLS.map((s, i) => (/^delete from BAND where NAME=/.test(s) ? i : -1)).filter((i) => i >= 0).pop();
  chk(iMeta > iLast, '데이터를 다 지운 뒤에 태그 이름을 정리한다', `데이터 마지막 ${iLast} → 메타 ${iMeta}`);
  chk(/NAME not in \(select NAME from/.test(SQLS[iMeta]), '데이터가 안 남은 이름만 지운다', SQLS[iMeta]);
}
{
  SQLS = []; ROWS = {};
  await DB.deleteEventsOfTag('T', 'A');
  const iMeta = SQLS.findIndex((s) => /metadata/.test(s));
  const iDel = SQLS.findIndex((s) => /^delete from EVENTS/.test(s));
  chk(iDel >= 0 && iMeta > iDel, '이벤트도 데이터 → 메타 순서', `${iDel} → ${iMeta}`);
}

// ── 화면에 고아만 표시 ──────────────────────────────────────────
{
  const a = Object.create(App.prototype);
  a.E = { fmtDT: (m) => new Date(m).toISOString().replace('T', ' ').slice(0, 19) };
  a._num = (n) => String(n);
  a.data = { equipment: [{ id: 'T:A', table: 'T', name: 'A' }] };   // 감시 중인 태그
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
  // 보유량 큰 순 — 정리 효과 큰 것부터
  chk(base.orphanRows[0].key === 'T:B', '보유량이 큰 태그가 위로', keys.join(','));
  chk(/7행/.test(base.orphanRows[0].stat) && /3건/.test(base.orphanRows[1].stat), '대역·이벤트를 나눠 적는다',
    base.orphanRows.map((r) => r.stat).join(' | '));
  // 표 요약에도 총량 표시 — 목록을 열기 전에 정리 대상 유무 파악
  const bandRow = base.dataRows.find((r) => r.id === 'band');
  chk(/감시 대상 밖 7행/.test(bandRow.stat), '표 요약에 감시 대상 밖 양이 붙는다', bandRow.stat);
  chk(!!bandRow.act2, '고아가 있으면 태그별 정리 버튼이 생긴다');
  /* 없는 기능 안내 문구("태그 단위 삭제도 가능") 금지 */
  const evRow = base.dataRows.find((r) => r.id === 'events');
  chk(evRow.act.sub !== '태그 단위 삭제도 가능', '없는 기능을 있다고 적지 않는다', evRow.act.sub);

  // 고아가 없으면 정리 버튼 없음
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
  chk(SQLS.some((s) => /delete from BAND where NAME='T:B:sub'/.test(s)), '대역 데이터를 지운다');
  chk(!SQLS.some((s) => /delete from EVENTS/.test(s)), '없는 이벤트는 지우러 가지 않는다');
  chk(SQLS.some((s) => /MONSTATE/.test(s)), '판정 상태도 함께 지운다');
  /* 판정 상태 캐시도 비움 — 안 비우면 지운 태그가 '감시 대상 밖'으로 계속 세져 삭제 실패로 오독 */
  chk(!a._monState['T:B'] && !!a._monState['T:A'], '지운 태그만 캐시에서 빠진다', Object.keys(a._monState).join(','));
  chk(calls.indexOf('refresh') >= 0, '지운 뒤 현황을 다시 읽는다');
  chk(a.state.orphanBusy === null, '진행 표시가 풀린다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
