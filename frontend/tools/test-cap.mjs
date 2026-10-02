/* 표시 상한 — 테이블당·전체 상한을 넘겨 잘린 태그 집계·표시
   · 잘린 수·테이블별 내역을 모니터 경고·설정 안내에 표시(카드 없는 태그를 "감시 중 정상"으로 오독 방지)
   · 잘린 키·빈 태그는 _catalogTick의 '새 태그'에서 제외(무한 재적재 방지)
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;

// live.js가 로드 시점에 DB 함수를 캡처(export const listTags = DB.listTags) — 스텁은 import 전에 설치
const DB = (await import('../../cgi-bin/db/db.js')).default;
const TAGS = {};      // { 테이블: [태그명...] }
const EMPTY = {};     // { 'T:태그': 1 } — 데이터 없는 태그(상한과 무관하게 제외)
DB.listTags = (table, cap) => Promise.resolve((TAGS[table] || []).slice(0, cap || 20));
DB.tagStats = (table) => {
  const m = {};
  (TAGS[table] || []).forEach((t, i) => {
    if (EMPTY[table + ':' + t]) { m[t] = { count: 0, minMs: 0, maxMs: 0 }; return; }
    m[t] = { count: 1000, minMs: 1700000000000, maxMs: 1700000600000 + i };
  });
  return Promise.resolve(m);
};
DB.rollupTrend = () => Promise.resolve([]);
DB.isNoRollup = () => false;

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { buildLiveData, CAPS } = await import('../src/data/live.js');
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};
const mkTags = (pre, n) => Array.from({ length: n }, (_, i) => pre + (i + 1));

// ── 테이블당 상한 ──────────────────────────────────────────────────────────
{
  TAGS.T1 = mkTags('A', CAPS.perTable + 5);
  const d = await buildLiveData(CH, ['T1'], {});
  chk(d.equipment.length === CAPS.perTable, '테이블당 상한만큼만 설비가 만들어진다', String(d.equipment.length));
  chk(d.cap.dropped === 5, '잘린 수를 센다', JSON.stringify({ dropped: d.cap.dropped, eligible: d.cap.eligible, shown: d.cap.shown }));
  chk(d.cap.eligible === CAPS.perTable + 5 && d.cap.shown === CAPS.perTable, '전체 수도 함께 센다 — "20개 중 20개"로는 잘린 걸 알 수 없다');
  chk(!d.cap.byTotal, '테이블당 상한에 걸린 것이지 전체 상한이 아니다');
  chk(!!d.cap.droppedKeys['T1:A' + (CAPS.perTable + 5)] && !d.cap.droppedKeys['T1:A1'], '잘린 키가 정확히 기록된다');
  const per = d.cap.perTable[0];
  chk(per && per.table === 'T1' && per.shown === CAPS.perTable && per.total === CAPS.perTable + 5,
    '테이블별 내역이 남는다 — 어느 테이블의 선택을 풀어야 자리가 나는지 알려야 한다', JSON.stringify(per));
}

// ── 데이터 없는 태그는 잘린 수에서 제외 ─────────────────────────────────────
/* 빈 태그는 상한과 무관하게 제외 대상 — 잘린 수로 세면 헛경고 */
{
  TAGS.T2 = mkTags('B', 10);
  EMPTY['T2:B3'] = 1; EMPTY['T2:B7'] = 1;
  const d = await buildLiveData(CH, ['T2'], {});
  chk(d.equipment.length === 8, '빈 태그는 설비가 되지 않는다', String(d.equipment.length));
  chk(d.cap.dropped === 0, '빈 태그는 상한 경고를 만들지 않는다', JSON.stringify(d.cap));
  chk(d.cap.eligible === 8, '상한 계산의 모수는 데이터가 있는 태그뿐');
  delete EMPTY['T2:B3']; delete EMPTY['T2:B7'];
}

/* 상한은 통계 조회 뒤 적용 — 앞에서 자르면 빈 태그가 자리를 차지 */
{
  TAGS.T3 = mkTags('C', CAPS.perTable + 5);
  for (let i = 1; i <= 5; i++) EMPTY['T3:C' + i] = 1;   // 앞쪽 5개가 빈 태그
  const d = await buildLiveData(CH, ['T3'], {});
  chk(d.equipment.length === CAPS.perTable, '빈 태그가 상한 자리를 잡아먹지 않는다', String(d.equipment.length));
  chk(d.equipment[0].name === 'C6', '데이터가 있는 태그부터 채운다', d.equipment[0].name);
  for (let i = 1; i <= 5; i++) delete EMPTY['T3:C' + i];
}

// ── 전체 상한 ──────────────────────────────────────────────────────────────
{
  const _h = Math.floor(CAPS.total / 2);
  TAGS.U1 = mkTags('P', _h); TAGS.U2 = mkTags('Q', _h); TAGS.U3 = mkTags('R', 15);
  const d = await buildLiveData(CH, ['U1', 'U2', 'U3'], {});
  chk(d.equipment.length === CAPS.total, '전체 상한을 넘지 않는다', String(d.equipment.length));
  chk(d.cap.dropped === (2 * _h + 15) - CAPS.total && d.cap.byTotal, '전체 상한에 걸린 것을 구분해 표시한다', JSON.stringify({ dropped: d.cap.dropped, byTotal: d.cap.byTotal }));
  chk(d.cap.eligible === 2 * _h + 15, '상한을 넘겨도 뒤 테이블까지 세어 총계를 낸다 — 여기서 멈추면 "몇 개 중 몇 개"를 못 쓴다', String(d.cap.eligible));
}

// ── 상한 안이면 표시 없음 ──────────────────────────────────────────────────
{
  TAGS.V1 = mkTags('S', 3);
  const d = await buildLiveData(CH, ['V1'], {});
  chk(d.cap.dropped === 0 && d.cap.perTable.length === 0, '상한 안에서는 경고가 없다', JSON.stringify(d.cap));
}

// ── 화면 경고 ──────────────────────────────────────────────────────────────
function mkApp(patch) {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._scheduleDraw = function () {};
  app._toast = function () {};
  app._persistView = function () { return Promise.resolve(); };
  app._syncMonitorTimer = function () { return Promise.resolve(); };
  app._syncBandTimer = function () { return Promise.resolve(); };
  app.E = CH; app.live = true;
  Object.assign(app.state, { ready: true, monMode: 'app', monitorOn: true }, patch || {});
  return app;
}
{
  const app = mkApp({ srcCap: { perTable: [{ table: 'T1', shown: 20, total: 25, byTotal: false }], dropped: 5, droppedKeys: {}, eligible: 25, shown: 20, byTotal: false } });
  app._applyHealth(null, null);
  const w = (app.state.health || []).find((x) => x.k === 'cap');
  chk(!!w, '잘린 태그가 있으면 모니터링 탭에 경고가 뜬다 — 알람이 안 오는 이유가 "정상이라서"가 아니다');
  chk(!!w && /5개/.test(w.text) && /20개/.test(w.text), '빠진 수와 감시 중인 수를 함께 적는다', w && w.text);
  chk(!!w && !!w.act, '설정으로 가는 길을 준다', w && w.act);

  const ok = mkApp({ srcCap: { perTable: [], dropped: 0, droppedKeys: {}, eligible: 3, shown: 3, byTotal: false } });
  ok._applyHealth(null, null);
  chk(!(ok.state.health || []).some((x) => x.k === 'cap'), '잘린 게 없으면 경고를 만들지 않는다');
}

// ── 설정 화면 안내 ─────────────────────────────────────────────────────────
{
  const app = mkApp({
    tab: 'settings', setSection: 'source', srcSel: ['T1'],
    srcCap: { perTable: [{ table: 'T1', shown: 20, total: 25, byTotal: false }], dropped: 5, droppedKeys: {}, eligible: 25, shown: 20, byTotal: false },
  });
  app.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  app._ensureTags = function () {};
  const vm = app.renderVals();
  chk(vm.capShow === true, '설정 데이터 소스에 상한 안내가 나온다');
  chk(/25개 중 20개/.test(vm.capText || ''), '몇 개 중 몇 개인지 적는다', vm.capText);
  chk(/테이블당 상한/.test(vm.capHint || ''), '테이블당인지 전체인지 구분해 안내한다', vm.capHint);
  chk((vm.capRows || []).length === 1 && vm.capRows[0].dropped === '5개 제외', '테이블별 내역을 보여준다', JSON.stringify(vm.capRows));

  const tot = mkApp({
    tab: 'settings', setSection: 'source', srcSel: ['U1'],
    srcCap: { perTable: [{ table: 'U3', shown: 0, total: 15, byTotal: true }], dropped: 15, droppedKeys: {}, eligible: 55, shown: 40, byTotal: true },
  });
  tot.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  tot._ensureTags = function () {};
  chk(/전체 상한/.test(tot.renderVals().capHint || ''), '전체 상한에 걸렸을 때는 테이블 선택을 풀라고 안내한다', tot.renderVals().capHint);
}

// ── 잘린 태그는 '새 태그' 아님(무한 재적재 방지) ───────────────────────────
/* 재적재해도 같은 태그가 또 잘림 — 새 태그로 읽으면 카탈로그 틱마다 재적재 반복 */
{
  TAGS.W1 = mkTags('Z', CAPS.perTable + 5);
  const d = await buildLiveData(CH, ['W1'], {});
  const app = mkApp({ srcSel: ['W1'], srcCap: d.cap, knownTags: null });
  app.data = d;
  app._blMap = {};
  app._healthTick = function () {};
  let reloads = 0;
  app._reloadLive = function () { reloads++; };

  await app._catalogTick();
  chk(!app._reloadPending && reloads === 0, '상한에 잘린 태그로는 재적재가 걸리지 않는다', String(reloads));

  // 진짜 새 태그는 재적재
  TAGS.W1 = TAGS.W1.concat(['Z_NEW']);
  app._cating = false;
  await app._catalogTick();
  chk(app._reloadPending === true, '진짜 새 태그는 그대로 감지한다');
}

// ── 데이터 없는 태그도 '새 태그' 아님(무한 재적재 방지) ─────────────────────
/* 데이터를 지워도 _<table>_meta엔 이름이 남음 — 적재는 통계 없는 태그를 빼므로 새 태그로 읽으면 재적재 반복 */
{
  TAGS.X1 = mkTags('E', 4);
  const d = await buildLiveData(CH, ['X1'], {});
  const app = mkApp({ srcSel: ['X1'], srcCap: d.cap, knownTags: null });
  app.data = d;
  app._blMap = {};
  app._healthTick = function () {};
  let reloads = 0;
  app._reloadLive = function () { reloads++; };

  TAGS.X1 = TAGS.X1.concat(['E_GHOST']);
  EMPTY['X1:E_GHOST'] = 1;
  await app._catalogTick();
  chk(!app._reloadPending && reloads === 0, '메타에만 남은 빈 태그로는 재적재가 걸리지 않는다', String(reloads));
  chk((app.state.knownTags || []).indexOf('X1:E_GHOST') < 0,
    '빈 태그는 되살아남 검사 대상에도 들어가지 않는다 — 설정 화면에 없는 태그를 확인 대기로 걸면 안 된다',
    JSON.stringify(app.state.knownTags));

  // 그 이름에 데이터가 들어오면 새 태그로 감지
  delete EMPTY['X1:E_GHOST'];
  app._cating = false;
  await app._catalogTick();
  chk(app._reloadPending === true, '빈 태그에 데이터가 들어오면 그때 새 태그로 감지한다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
