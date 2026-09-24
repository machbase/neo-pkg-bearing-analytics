/* 재적재 실패 — 오프라인(Neo 불필요). npm run smoke에 포함.

   재적재는 판정 틱을 멈춰 두고 데이터를 다시 읽는다. 두 구멍이 있었다:
   ① 실패하면 틱을 다시 켜지 않아 새로고침 전까지 판정이 조용히 멈췄다.
   ② 테이블 조회 실패는 오류가 아니라 "그 테이블 태그 0개"로 성공 처리됐다 — 카드가 사라지고,
      다음 카탈로그 틱이 "감시할 태그 없음"으로 서버 감시 타이머를 지웠다.
   지금은 조회 실패를 실패로 올리고, 옛 데이터로 감시를 이어 가며 재시도하고, 그동안 서버 타이머를 굽지 않는다. */
globalThis.window = globalThis;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' });

// 긴 타이머(재시도)는 잡아 두고 직접 돌린다 — 짧은 것은 그대로 흘린다
const realST = setTimeout, realCT = clearTimeout;
let sched = [];
globalThis.setTimeout = (fn, ms) => {
  if (ms >= 10000) { const t = { fn, ms, id: 'R' + sched.length, off: false }; sched.push(t); return t.id; }
  return realST(fn, ms);
};
globalThis.clearTimeout = (id) => {
  if (typeof id === 'string' && id.charAt(0) === 'R') { const t = sched.find((x) => x.id === id); if (t) t.off = true; return; }
  realCT(id);
};
const pending = () => sched.filter((t) => !t.off);
const fire = async () => { const t = pending().pop(); t.off = true; t.fn(); await settle(); return t.ms; };

const DB = (await import('../../cgi-bin/db/db.js')).default;
const { buildLiveData } = await import('../src/data/live.js');
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const settle = () => new Promise((r) => realST(r, 20));

// ── 가짜 DB: 테이블별로 실패를 켜고 끈다 ─────────────────────────────────
const T1 = 1700000000000;
const down = new Set();          // 목록 조회가 실패하는 테이블
const statDown = new Set();      // 통계 조회가 실패하는 테이블
let timesDown = false, gate = null, listCalls = 0;
DB.listTags = async (table) => {
  listCalls++;
  if (gate) await gate;
  if (down.has(table)) throw new Error('HTTP 500');
  return ['X'];
};
DB.tagStats = async (table) => {
  if (statDown.has(table)) throw new Error('HTTP 500');
  return { X: { count: 3600 * 100, minMs: T1 - 3600000, maxMs: T1 } };
};
DB.rollupBatch = async (table, names) => {
  const o = {};
  names.forEach((n) => { o[n] = Array.from({ length: 10 }, (_, i) => ({ ms: T1 - (10 - i) * 1000, rms: 1, cnt: 100 })); });
  return o;
};
DB.sampleTimes = async () => { if (timesDown) throw new Error('HTTP 500'); return Array.from({ length: 50 }, (_, i) => (T1 - 1000) * 1000 + i * 1000); };

const E = (await import('../../cgi-bin/chart/chart.js')).default;   // 앱의 ENGINE과 같다

// ── 적재 함수 ────────────────────────────────────────────────────────────
{
  timesDown = true;
  const d = await buildLiveData(E, ['A'], {});
  chk(d.equipment.length === 1 && d.equipment[0].fs === 100 && d.failed.length === 0,
    '표본 간격 조회가 실패해도 적재는 성공 — 초당 건수 중앙값으로 물러난다', 'fs=' + (d.equipment[0] || {}).fs);
  timesDown = false;
  const d2 = await buildLiveData(E, ['A'], {});
  chk(d2.equipment[0].fs === 1000, '조회가 되면 표본 간격(1ms → 1000Hz)이 1순위', 'fs=' + d2.equipment[0].fs);

  down.add('B'); statDown.add('C');
  const d3 = await buildLiveData(E, ['A', 'B', 'C'], {});
  chk(d3.equipment.map((e) => e.table).join() === 'A' && d3.failed.join() === 'B,C',
    '목록·통계 조회에 실패한 테이블은 조용히 빠지지 않고 failed로 올라온다', 'failed=' + d3.failed.join());
  const d4 = await buildLiveData(E, ['B'], {});
  chk(d4.equipment.length === 0 && d4.failed.join() === 'B', '전부 실패해도 failed가 실린다(빈 결과를 "태그 없음"으로 읽지 않게)');
  down.clear(); statDown.clear();
}

// ── 앱: 재적재 실패 → 옛 데이터로 감시 + 재시도 ───────────────────────────
function mkApp() {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { if (st.ready === false) this._blanked = (this._blanked || 0) + 1; Object.assign(this.state, st); };
  app._toasts = [];
  app._toast = function (m, k) { this._toasts.push((k || '') + ':' + m); };
  app._loadEventsLive = function () {};
  app._starts = 0;
  app._startTimers = function () { this._starts++; };
  app._monSpecCalls = 0;
  app._monSpec = function () { this._monSpecCalls++; return { tags: [] }; };
  app._bandSpec = function () { this._monSpecCalls++; return { tags: [] }; };
  app._dropTimer = function () { return Promise.resolve(); };
  app.E = E;
  app.live = true;
  app._cfgOk = true;
  return app;
}
{
  sched = [];
  const app = mkApp();
  const old = await buildLiveData(E, ['A'], {});
  app.data = old;
  app._loadedSel = ['A'];
  Object.assign(app.state, { srcSel: ['A', 'B'], monMode: 'server', monitorOn: true, bandOn: true });
  down.add('B');                              // 새로 고른 B를 못 읽는다

  app._reloadLive();
  await settle();
  const LF = app.state.loadFail;
  chk(app.data === old && app.state.ready === true && app._starts === 1,
    '실패하면 옛 데이터를 그대로 두고 판정 틱을 다시 켠다(예전: 틱이 영구히 멈춤)', 'starts=' + app._starts);
  chk(LF && LF.missing.join() === 'B' && LF.tables.join() === 'B' && LF.tries === 1,
    '배너 상태 — 못 불러온 테이블(B)과 실패 원인 테이블', JSON.stringify(LF && { missing: LF.missing, tables: LF.tables, tries: LF.tries }));
  chk(pending().length === 1 && pending()[0].ms === 10000, '10초 뒤 재시도가 걸린다');
  chk(app._toasts.filter((t) => /이전 데이터로 감시/.test(t)).length === 1, '첫 실패만 토스트 — 재시도 실패마다 띄우지 않는다');

  await app._syncMonitorTimer(true);
  await app._syncBandTimer(true);
  chk(app._monSpecCalls === 0, '실패 중에는 서버 판정·대역 타이머를 굽지 않는다(빠진 테이블을 "태그 없음"으로 읽어 지우지 않게)');

  const w = app._loadFailWarns();
  chk(w.length === 1 && /B\)은 감시되지 않습니다/.test(w[0].text) && /다시 저장할 필요는 없습니다/.test(w[0].text) && !/선택을 해제/.test(w[0].text),
    '배너 — 계속 감시되는 것과 빠진 것, 다시 저장할 필요 없음을 말한다', w[0] && w[0].text);

  const blanked = app._blanked || 0;
  const ms2 = await fire();
  chk(app._blanked === blanked && app.state.loadFail.tries === 2 && pending()[0].ms === 20000,
    '재시도는 화면을 적재 중으로 바꾸지 않고, 실패하면 간격을 두 배로', 'ran after ' + ms2 + 'ms, next ' + pending()[0].ms);
  await fire();
  const w3 = app._loadFailWarns();
  chk(/B 테이블이 지워졌거나 권한이 없는지/.test(w3[0].text), '세 번째 실패부터 원인 안내(테이블 삭제·권한, 선택 해제)를 덧붙인다');
  for (let i = 0; i < 6; i++) await fire();
  chk(pending()[0].ms === 300000, '재시도 간격은 5분에서 멈춘다', pending()[0].ms);

  down.delete('B');                            // 원인이 사라졌다
  await fire();
  chk(!app.state.loadFail && !app._loadFail && pending().length === 0 && app.data !== old
    && app.data.equipment.map((e) => e.table).sort().join() === 'A,B',
    '재시도가 성공하면 새 선택으로 바뀌고 배너·재시도가 사라진다', app.data.equipment.map((e) => e.table).join());
  chk(app._toasts.some((t) => /^ok:.*정상 감시로 돌아왔습니다/.test(t)), '복귀를 알린다');
  await app._syncMonitorTimer(true);
  chk(app._monSpecCalls === 1, '복귀하면 서버 타이머 동기화가 다시 돈다');
}

// ── 앱: "지금 다시 시도" 버튼 ────────────────────────────────────────────
{
  sched = [];
  const app = mkApp();
  app.data = await buildLiveData(E, ['A'], {});
  app._loadedSel = ['A'];
  Object.assign(app.state, { srcSel: ['A', 'B'] });
  down.add('B');
  app._reloadLive();
  await settle();
  down.delete('B');
  const w = app._loadFailWarns()[0];
  w.onAct();
  chk(app.state.loadFail && app.state.loadFail.busy === true && app._loadFailWarns()[0].act === '다시 시도 중…', '누르면 "다시 시도 중…"');
  await settle();
  chk(!app.state.loadFail && pending().length === 0, '수동 재시도가 성공하면 걸려 있던 자동 재시도도 치운다');
}

// ── 앱: 겹침 방지 ───────────────────────────────────────────────────────
{
  sched = [];
  const app = mkApp();
  app.data = await buildLiveData(E, ['A'], {});
  app._loadedSel = ['A'];
  Object.assign(app.state, { srcSel: ['A'] });
  let open;
  gate = new Promise((r) => { open = r; });
  listCalls = 0;
  app._reloadLive();
  app._reloadLive();
  app._reloadLive();
  await settle();
  chk(listCalls === 1, '진행 중에 들어온 재적재는 바로 돌지 않는다', 'calls=' + listCalls);
  gate = null; open();
  await settle(); await settle();
  chk(listCalls === 2 && !app._reloading, '끝난 뒤 한 번으로 모아 다시 돈다(그 사이 바뀐 선택 반영)', 'calls=' + listCalls);
}

// ── 부팅: 조회 실패 테이블은 되살아남 검사 범위에서 뺀다 ─────────────────
{
  sched = [];
  const app = mkApp();
  let scope = null;
  app._checkRevived = function (keys, tables) { scope = tables; };
  app._loadReports = function () {};
  app._loadBaselines = async function () { this._blMap = {}; };
  app._judgeLive = async function () {};
  down.add('B');
  const d = await buildLiveData(E, ['A', 'B'], {});
  app.data = d;
  app._applyLive(d, {}, ['A', 'B']);
  await settle();
  chk(scope && scope.join() === 'A', '못 읽은 테이블(B)의 태그를 "사라짐"으로 치지 않는다 — 멀쩡한 학습을 되살아남으로 오판하는 경로', scope && scope.join());
  down.clear();
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
