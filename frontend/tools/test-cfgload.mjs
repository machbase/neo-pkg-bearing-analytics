/* 설정 읽기 실패 — 세 결과(읽음·없음·실패) 구분, 실패 동안 덮어쓰기 경로(저장·알람 토글·부분 저장·옛 파일 이관·타이머) 차단
   · 복구 흐름(다시 시도·손상 영역만 기본값으로 열기)을 DB 응답 흉내로 확인
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;

// CONFIG 테이블을 메모리 맵으로 흉내 — 쓰기·타이머·파일 요청 집계
const store = new Map();
let failSelect = false;
const hits = { write: 0, rpc: 0, file: 0 };
import './_faketoken.mjs';   // db.js 관문용 토큰 칸
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/\/web\/api\/rpc/.test(u)) { hits.rpc++; return { ok: true, status: 200, json: async () => ({ result: [] }) }; }
  if (/\/web\/api\/files/.test(u)) { hits.file++; return { ok: false, status: 404, json: async () => ({}) }; }
  const sql = decodeURIComponent(u.replace(/^[^?]*\?q=/, '').replace(/&.*$/, ''));
  let rows = [], m;
  if (/^select K, VAL from \S+CONFIG/.test(sql)) {
    if (failSelect) return { ok: false, status: 500, json: async () => ({ success: false, reason: 'MACH-ERR 9999 연결 끊김' }) };
    rows = [...store.entries()];
  } else if ((m = /^select count\(\*\) from \S+ where K='(.*)'$/.exec(sql))) rows = [[store.has(m[1]) ? 1 : 0]];
  else if ((m = /^insert into \S+ values\('(.*?)', '(.*)'\)$/.exec(sql))) { hits.write++; store.set(m[1], m[2]); }
  else if ((m = /^update \S+ set VAL='(.*)' where K='(.*?)'$/.exec(sql))) { hits.write++; store.set(m[2], m[1]); }
  else if ((m = /^delete from \S+ where K='(.*?)'$/.exec(sql))) { hits.write++; store.delete(m[1]); }
  return { ok: true, status: 200, json: async () => ({ success: true, data: { rows } }) };
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

const REAL = { srcSel: ['VIBE_TEST'], equipRpm: { 'VIBE_TEST:A': 1780 }, aliases: { 'VIBE_TEST:A': '펌프 1' },
  machineClass: 'III', monitorOn: true, monMode: 'server', llmProvider: 'ollama' };
async function seed(cfg) { store.clear(); failSelect = false; await DB.saveConfig(cfg); hits.write = 0; hits.rpc = 0; hits.file = 0; }

// ── db: 세 결과 구분 ───────────────────────────────────────────────────
await seed(REAL);
chk((await DB.loadConfig()).machineClass === 'III', '읽음 — 설정 객체');
store.clear();
chk((await DB.loadConfig()) === null, '없음 — 설정 행이 하나도 없으면 null(신규 설치)');

await seed(REAL);
failSelect = true;
let e1 = null;
try { await DB.loadConfig(); } catch (e) { e1 = e; }
chk(e1 && e1.kind === 'query', '조회 실패는 null이 아니라 거부(kind=query)', e1 && e1.message);

await seed(REAL);
store.delete('cfg:equipment#0');
store.set('cfg:equipment#1', store.get('cfg:equipment#1') || '%7B%7D');   // #0 없이 #1만 — 조각 누락
let e2 = null;
try { await DB.loadConfig(); } catch (e) { e2 = e; }
chk(e2 && e2.kind === 'broken' && JSON.stringify(e2.domains) === '["equipment"]', '조각 손상은 거부(kind=broken, 영역 이름)', e2 && e2.message);
const part = await DB.loadConfig({ allowBroken: true });
chk(part && part.machineClass === 'III' && part.equipRpm === undefined, 'allowBroken — 손상 영역만 빼고 나머지는 돌려준다');

// ── db: 실패 중 덮어쓰기 경로 ───────────────────────────────────────────
await seed(REAL);
failSelect = true;
let e3 = null;
try { await DB.saveConfigPartial({ cardOrder: ['x'] }, ['cardOrder']); } catch (e) { e3 = e; }
chk(e3 && hits.write === 0, '부분 저장은 읽기에 실패하면 쓰지 않는다(설비 정보 소실 경로)', 'writes=' + hits.write);
const mig = await DB.migrateConfigToDb();
chk(mig === 'skipped' && hits.write === 0 && hits.file === 0, '옛 파일 이관은 비어 있음이 확인될 때만 — 못 읽었으면 건너뛴다', mig);

// ── 앱: 실패 화면과 저장 잠금 ────────────────────────────────────────────
function mkApp() {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._toast = function (m) { this._lastToast = m; };
  app._scheduleDraw = function () {};
  return app;
}
{
  await seed(REAL);
  failSelect = true;
  const app = mkApp();
  app._bootAs(CH);
  await settle();
  chk(app.state.cfgFail && app.state.cfgFail.kind === 'query' && !app.live, '조회 실패 → 기본값으로 띄우지 않고 실패 화면', JSON.stringify(app.state.cfgFail));
  const vm = app.renderVals();
  chk(vm.cfgFailShow && !vm.isMonitor && !vm.isSettings && !vm.cfgRepairShow, '탭을 그리지 않고, 조회 실패에는 재설정 버튼을 주지 않는다');

  const before = app.state.monitorOn;
  const ok = await app._persistCfg();
  app._toggleMonitorNow();
  await app._persistView(['cardOrder'], { cardOrder: ['x'] });
  app.live = true; await app._syncMonitorTimer(); await app._syncBandTimer(); app.live = false;
  await settle();
  chk(ok === false && hits.write === 0, '설정 저장이 거부된다(전 영역 덮어쓰기 경로)', 'writes=' + hits.write);
  chk(app.state.monitorOn === before, '알람 토글이 상태를 바꾸지 않는다(켠 것처럼 보이고 저장은 안 되는 상태 방지)');
  chk(hits.rpc === 0, '타이머를 굽거나 지우지 않는다(기본값 "앱 감시"가 서버 타이머를 지우는 경로)', 'rpc=' + hits.rpc);
  chk(/불러오지 못한/.test(app._lastToast || ''), '거부 사유를 알린다', app._lastToast);

  // 다시 시도 — 읽혔지만 데이터(테이블 목록)를 못 불러와 설정이 화면에 미반영인 경우
  failSelect = false;
  app._retryCfg();
  await settle();
  chk(!app.state.cfgFail, '다시 시도 → 읽히면 실패 화면이 걷힌다');
  chk(app._cfgOk === false && (await app._persistCfg()) === false && hits.write === 0,
    '설정은 읽었지만 화면에 반영 전(데이터 적재 실패)이면 여전히 저장을 막는다');

  // 설정이 화면에 반영되면 잠금 해제
  Object.assign(app, { _loadReports() {}, _startTimers() {}, _loadEventsLive() {}, _checkRevived() {},
    _judgeLive() { return Promise.resolve(); }, _loadBaselines() { return Promise.resolve(); } });
  app._applyLive({ equipment: [], now: Date.now() }, await DB.loadConfig(), ['VIBE_TEST']);
  chk(app._cfgOk === true && app.state.machineClass === 'III', '읽은 설정이 state에 들어가면 잠금이 풀린다');
  const w0 = hits.write;
  const ok2 = await app._persistCfg();
  const back = await DB.loadConfig();
  chk(ok2 === true && hits.write > w0 && back.equipRpm['VIBE_TEST:A'] === 1780 && back.aliases['VIBE_TEST:A'] === '펌프 1',
    '이후 저장은 실제 설정을 그대로 다시 쓴다(설비 정보 보존)');
}
{
  // 인증 끊김이면 인증 화면 우선
  await seed(REAL);
  const app = mkApp();
  app.state.authMsg = '세션이 만료되었습니다';
  app._initCfgFail({ kind: 'query', message: 'x' });
  chk(!app.state.cfgFail, '인증 끊김 화면을 설정 실패 화면이 덮지 않는다');
}
{
  // 손상 — 다시 시도로 안 풀리므로 그 영역만 기본값으로 여는 길
  await seed(REAL);
  store.delete('cfg:equipment#0'); store.set('cfg:equipment#1', '%7B%7D');
  const app = mkApp();
  app._bootAs(CH);
  await settle();
  const vm = app.renderVals();
  chk(app.state.cfgFail && app.state.cfgFail.kind === 'broken' && vm.cfgRepairShow && /설비 정보/.test(vm.cfgRepairLabel),
    '손상 → 그 영역 이름을 대고 기본값으로 열기 버튼을 준다', vm.cfgRepairLabel);
  const w0 = hits.write;
  app._repairCfg();
  await settle();
  chk(!app.state.cfgFail && app.state.tab === 'settings' && app.state.setSection === 'equip', '누르면 그 영역의 설정 화면으로 보낸다');
  chk(hits.write === w0, '누르는 것만으로는 아무것도 저장하지 않는다', 'writes=' + (hits.write - w0));
}
{
  // 없음 — 신규 설치는 기본값으로 시작, 저장 허용(덮어쓸 것 없음)
  store.clear(); failSelect = false;
  const app = mkApp();
  app._bootAs(CH);
  await settle();
  chk(!app.state.cfgFail && app._cfgOk === true && app._cfgFresh === true, '저장한 적 없음 → 실패 화면 없이 시작, 저장 허용');
  const vm = app.renderVals();
  chk(vm.monEmptyFresh === true, '빈 화면이 "처음 설정" 안내로 바뀐다');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
