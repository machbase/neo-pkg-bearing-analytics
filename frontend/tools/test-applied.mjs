/* 저장 전 편집 격리 — 판정·서버 타이머·재적재는 적용본(app._ac())만 읽고 편집본(state)은 폼 안에만
   · 즉시 저장 버튼(헤더 알람 등)은 자기 값만 저장, "저장 안 함"은 폼을 저장본으로 되돌림
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;

// CONFIG 테이블을 메모리 맵으로 흉내(test-cfgload와 같은 방식) — 쓰기 실패 토글 가능
const store = new Map();
let failWrite = false;
import './_faketoken.mjs';   // db.js 관문용 토큰 칸
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/\/web\/api\/rpc/.test(u)) return { ok: true, status: 200, json: async () => ({ result: [] }) };
  if (/\/web\/api\/files/.test(u)) return { ok: false, status: 404, json: async () => ({}) };
  const sql = decodeURIComponent(u.replace(/^[^?]*\?q=/, '').replace(/&.*$/, ''));
  let rows = [], m;
  if (/^select K, VAL from \S+CONFIG/.test(sql)) rows = [...store.entries()];
  else if ((m = /^select count\(\*\) from \S+ where K='(.*)'$/.exec(sql))) rows = [[store.has(m[1]) ? 1 : 0]];
  else if (/^(insert|update|delete)/.test(sql) && /CONFIG/.test(sql) && failWrite) {
    return { ok: false, status: 500, json: async () => ({ success: false, reason: 'MACH-ERR 9999 연결 끊김' }) };
  } else if ((m = /^insert into \S+ values\('(.*?)', '(.*)'\)$/.exec(sql))) store.set(m[1], m[2]);
  else if ((m = /^update \S+ set VAL='(.*)' where K='(.*?)'$/.exec(sql))) store.set(m[2], m[1]);
  else if ((m = /^delete from \S+ where K='(.*?)'$/.exec(sql))) store.delete(m[1]);
  return { ok: true, status: 200, json: async () => ({ success: true, data: { rows } }), text: async () => '' };
};

const DB = (await import('../../cgi-bin/db/db.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const settle = () => new Promise((r) => setTimeout(r, 30));
DB.setUser('JOY');

const T1 = 1700000000000;
const mkEq = (table) => ({
  id: table + ':X', table, name: 'X', alias: 'X', unit: 'mm/s', cls: 'II', baseCls: 'II', zones: [1.12, 2.8, 7.1],
  fs: 25600, rpm: 1800, bearing: { model: '', n: 0, Bd: 0, Pd: 0, phi: 0 }, meta: { lineHz: 60 },
  stat: { count: 1000, minMs: T1 - 3600000, maxMs: T1 }, lastSeen: T1, rms: 1, sparkVals: [1], spark: {}, rollup: [], grade: 0,
});
const SAVED = {
  srcSel: ['A', 'B'], monitorOn: true, monMode: 'server', bandOn: true, bandInterval: '10m', evalWindow: '10s',
  classThresh: {}, renotify: { '주의': '0', '위험': '1h', '심각': '30m' },
  notifCh: { webhook: true }, notifTo: { webhook: 'https://saved.example/hook' },
  equipRpm: { 'A:X': 1800 }, llmProvider: 'claude',
};

function mkApp() {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._toasts = [];
  app._toast = function (m, k) { this._toasts.push((k || '') + ':' + m); };
  app._scheduleDraw = function () {};
  Object.assign(app, { _loadReports() {}, _startTimers() {}, _loadEventsLive() {}, _checkRevived() {},
    _loadBaselines() { this._blMap = {}; return Promise.resolve(); } });
  app._judges = 0;
  app._judgeLive = function () { this._judges++; return Promise.resolve(); };
  app.E = CH;
  app.live = true;
  return app;
}

store.clear();
await DB.saveConfig(SAVED);
const app = mkApp();
const data = { now: T1, equipment: [mkEq('A'), mkEq('B')], cap: null };
app.data = data;
app._applyLive(data, await DB.loadConfig(), ['A', 'B']);
await settle();

// ── 폼에서 편집만 하고 저장 안 함 ─────────────────────────────────────────
const EDIT = { monitorOn: false, bandOn: false, srcSel: ['A'], classThresh: { II: ['9', '9', '9'] },
  renotify: { '주의': '0', '위험': '0', '심각': '0' }, notifTo: { webhook: 'https://draft.example/hook' }, equipRpm: { 'A:X': 3600 } };
app.setState(Object.assign({ dirty: true }, EDIT));

{
  const dropped = [];
  let spec = null;
  app._dropTimer = function (sig) { dropped.push(sig); return Promise.resolve(); };
  const orig = App.prototype._monSpec;
  app._monSpec = function () { spec = orig.call(this); return spec; };
  await app._syncMonitorTimer(true);
  await app._syncBandTimer(true);
  chk(dropped.length === 0, '폼에서 알람·대역 추출을 끄기만 하면 서버 타이머를 지우지 않는다(예전: 10초 점검이 지움)',
    'drops=' + dropped.join() + ' bandSkip=' + (app._bandSkipWhy || ''));
  chk(spec && spec.tags.map((t) => t.tbl).join() === 'A,B', '서버 감시 대상 = 저장된 선택(A,B) — 체크만 해제한 B가 빠지지 않는다', spec && spec.tags.map((t) => t.tbl).join());
  chk(spec && spec.tags[0].isoZones.join() === '1.12,2.8,7.1' && spec.cfg.reno[2] === 3600000,
    '존·재알림 주기도 저장된 값으로 굽는다', spec && JSON.stringify({ z: spec.tags[0].isoZones, r: spec.cfg.reno }));
  delete app._dropTimer; delete app._monSpec;
}
{
  chk(app._activeEqs().map((e) => e.table).join() === 'A,B', '앱 판정·모니터링 대상도 저장된 선택');
  chk(app._isoZones(data.equipment[0]).join() === '1.12,2.8,7.1', '앱 판정 존도 저장된 임계값');
  chk(app._isoZones(data.equipment[0], app.state).join() === '9,9,9', '설정 화면 미리보기는 편집본을 넘겨 새 값을 본다');
  chk(app._notifyCfg().channels.webhook.to === 'https://saved.example/hook', '앱 모드 발송은 저장된 웹훅으로(입력 중인 주소로 보내지 않는다)');
  const vm = app.renderVals();
  chk(vm.monitorText === 'ON' && vm.monModeBadgeText === '서버 상시', '헤더는 적용된 상태를 보여 준다(폼에서 끈 것을 꺼진 것으로 보이지 않게)', vm.monitorText);
}

// ── 재적재도 저장본으로 ────────────────────────────────────────────────
{
  const listed = [];
  const keep = { listTags: DB.listTags, tagStats: DB.tagStats, rollupBatch: DB.rollupBatch, sampleTimes: DB.sampleTimes };
  DB.listTags = async (t) => { listed.push(t); return ['X']; };
  DB.tagStats = async () => ({ X: { count: 3600 * 100, minMs: T1 - 3600000, maxMs: T1 } });
  DB.rollupBatch = async (t, names) => Object.fromEntries(names.map((n) => [n, []]));
  DB.sampleTimes = async () => [];
  app._reloadLive();
  await settle();
  const a = app.data.equipment.find((e) => e.id === 'A:X');
  chk(listed.join() === 'A,B' && a && a.rpm === 1800, '새 태그 감지 등으로 다시 불러와도 저장된 선택·회전수로(편집 중인 3600이 섞이지 않는다)', listed.join() + ' rpm=' + (a && a.rpm));
  Object.assign(DB, keep);
}

// ── 즉시 저장 버튼은 자기 값만 ──────────────────────────────────────────
{
  await app._toggleMonitorNow();
  await settle();
  const back = await DB.loadConfig();
  chk(back.monitorOn === false && app._ac().monitorOn === false, '헤더 알람 토글 → 알람만 저장·적용', 'saved=' + back.monitorOn);
  chk(JSON.stringify(back.classThresh) === '{}' && back.notifTo.webhook === 'https://saved.example/hook' && back.srcSel.join() === 'A,B',
    '설정 탭의 저장 안 한 편집(임계값·웹훅·선택)은 딸려 저장되지 않는다(예전: 전체 저장)', JSON.stringify(back.classThresh));
  chk(app.state.dirty === true && app.state.classThresh.II && app.state.classThresh.II[0] === '9', '편집본과 "변경됨" 표시는 그대로 남는다');

  failWrite = true;
  app._toggleMonitorNow();
  const optimistic = app._ac().monitorOn;
  await settle();
  failWrite = false;
  chk(optimistic === true && app._ac().monitorOn === false && app.state.monitorOn === false && app._toasts.some((t) => /^err:설정 저장 실패/.test(t)),
    '누르면 바로 적용되고, 저장이 실패하면 되돌린다', 'optimistic=' + optimistic + ' after=' + app._ac().monitorOn);

  await app._toggleMonitorNow();
  await settle();
  chk(app._ac().monitorOn === true && app._judges >= 1, '다시 켜면 즉시 1회 판정');

  app.state.bandIvNext = '30m'; app.state.bandIvAct = 'keep';
  await app._applyBandInterval();
  await settle();
  const b3 = await DB.loadConfig();
  chk(b3.bandInterval === '30m' && app._ac().bandInterval === '30m' && JSON.stringify(b3.classThresh) === '{}',
    '대역 추출 주기 확정 → 그 값만 저장·적용(타이머 격자와 채운 값이 같은 주기)', b3.bandInterval);

  app._pickLlmProvider('openai');
  // 저장 왕복 전 — 드롭다운 값이 적용본이라 바로 바뀌어야 한 번에 선택됨(늦으면 다시 그리기가 옛 값으로 되돌림)
  const b4now = app._ac().llmProvider;
  await settle();
  const b4 = await DB.loadConfig();
  chk(b4now === 'openai' && b4.llmProvider === 'openai' && JSON.stringify(b4.classThresh) === '{}', 'LLM 선택 → 바로 적용(드롭다운 한 번에) · 그 값만 저장', b4now);
}

// ── 저장 안 함 = 되돌림 ────────────────────────────────────────────────
{
  app.state.tab = 'settings';
  app.state.pendingNav = 'monitor';
  app._confirmNav('discard');
  const S = app.state;
  chk(S.dirty === false && S.tab === 'monitor' && S.srcSel.join() === 'A,B' && JSON.stringify(S.classThresh) === '{}'
    && S.notifTo.webhook === 'https://saved.example/hook' && S.equipRpm['A:X'] === 1800,
    '저장 안 함 → 폼 값이 저장본으로 돌아간다(예전: 표시만 지우고 편집값이 남음)', JSON.stringify({ sel: S.srcSel, ct: S.classThresh }));
  chk(S.monitorOn === true && S.bandInterval === '30m',
    '즉시 저장된 값은 되돌리지 않는다(이미 저장본이다)');
}

// ── 저장 = 그때 적용 ───────────────────────────────────────────────────
{
  app.setState({ dirty: true, srcSel: ['A'], classThresh: { II: ['2', '4', '8'] } });
  const seen = [];
  app._syncMonitorTimer = function () { seen.push(this._ac().srcSel.join() + '|' + this._isoZones(data.equipment[0]).join()); return Promise.resolve(); };
  app._syncBandTimer = function () { return Promise.resolve(); };
  app._syncWdTimer = function () { return Promise.resolve(); };
  const ok = await app._persistCfg();
  const b5 = await DB.loadConfig();
  chk(ok && seen[0] === 'A|2,4,8' && b5.srcSel.join() === 'A', '저장하면 그 값으로 적용본이 바뀌고 서버 타이머를 새 값으로 굽는다', seen[0]);
  chk(app._activeEqs().map((e) => e.table).join() === 'A', '앱 판정 대상도 저장 직후부터 새 선택');
}

// ── LLM 설정도 저장본으로 — 설정 화면(연결 테스트·상태 표시)만 편집본 ─────────────
{
  const LLM = (await import('../../cgi-bin/llm/llm.js')).default;
  const keep = { createLLM: LLM.createLLM, testConnection: LLM.testConnection };
  const made = [], tested = [];
  LLM.createLLM = (cfg) => { made.push(cfg); return keep.createLLM(cfg); };
  LLM.testConnection = (cfg) => { tested.push(cfg); return Promise.resolve({ ok: true, ms: 1, sample: 'OK' }); };
  const app = mkApp();
  app.data = data;
  app._applied = Object.assign({}, app.state, { srcSel: ['A', 'B'], llmProvider: 'claude', llmKeys: { claude: 'saved-key' }, llmModels: {} });
  Object.assign(app.state, { ready: true, dirty: true, llmProvider: 'openai', llmKeys: { claude: 'saved-key', openai: 'draft-key' }, llmModels: { openai: 'gpt-draft' } });

  chk(app._llmCfg().provider === 'claude' && app._llmCfg().apiKey === 'saved-key', '호출 설정은 저장본(claude · 저장된 키)', JSON.stringify(app._llmCfg()));
  made.length = 0;
  app._dxExplain(data.equipment[0]);
  chk(made[0] && made[0].provider === 'claude' && made[0].apiKey === 'saved-key', '상세분석 AI 소견은 저장된 키로 호출(예전: 입력 중인 openai 키)', made[0] && made[0].provider);
  app.state.tab = 'detail';
  const vd = app.renderVals();
  chk(/^Claude/.test(vd.dxLlmModel || '') && vd.llmProviderSel === 'claude' && vd.llmProvOptions.map((o) => o.id).join() === 'claude',
    '상세분석 표시·선택 목록도 저장본', (vd.dxLlmModel || '') + ' · ' + vd.llmProvOptions.map((o) => o.id).join());
  app._testLLM();
  chk(tested[0] && tested[0].provider === 'openai' && tested[0].apiKey === 'draft-key', '연결 테스트는 입력 중인 값(저장 전 확인용)', tested[0] && tested[0].provider);
  app.state.tab = 'settings';
  const base = {};
  app._vmSettings(base, data.equipment);
  chk(/OpenAI/.test(base.llmStatusText), '설정 화면 상태 표시는 입력 중인 값', base.llmStatusText);
  Object.assign(LLM, keep);
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
