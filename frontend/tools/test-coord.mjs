/* 탭·PC 조율 — 한 계정의 백그라운드 쓰기는 담당 하나만, 설정·학습값 저장은 다른 곳에 전파, 계정 전환 시 쓰기 중단
   · 담당 기록(__lead): 하나만 담당, 만료 뒤 이어받기, 동시 부팅 경합, 이어받을 때 판정 상태 다시 읽기
   · 표시 탭: 판정·자동 복구 없음, 헤더 '보기 전용'
   · 저장 표시(__cfgv·__blv): 다른 탭이 다시 읽음, 편집 중인 폼은 유지
   · 계정 전환: 저장·조율 중단, 전체 화면 안내, 원래 계정 복귀 시 해제 / db.js 관문이 다른 계정 요청 차단
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mkJwt = (sub) => `h.${b64({ sub })}.sig`;
const ls = { accessToken: mkJwt('joy') };
globalThis.localStorage = {
  getItem: (k) => (k in ls ? ls[k] : null),
  setItem: (k, v) => { ls[k] = String(v); },
  removeItem: (k) => { delete ls[k]; },
};
let fetched = [];
globalThis.fetch = async (p) => { fetched.push(String(p)); return { ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' }; };

const DB = (await import('../../cgi-bin/db/db.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');
const { view } = await import('../src/view.js');
import fs from 'node:fs';
import renderToString from 'preact-render-to-string';

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const clone = (o) => JSON.parse(JSON.stringify(o));
DB.setUser('JOY');

// ── 공유 MONSTATE(계정 키 공간) — 탭마다 같은 맵을 읽고 씀 ──────────────────
const MS = {};
const T1 = 1700000000000;
const SAVED = { srcSel: ['A'], monitorOn: true, monMode: 'app', monitorInterval: '3s', renotify: { '주의': '0', '위험': '1h', '심각': '30m' } };
let cfgInDb = clone(SAVED);

function mkTab() {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app.forceUpdate = function () {};
  app._toasts = [];
  app._toast = function (m, k) { this._toasts.push((k || '') + ':' + m); };
  app.E = CH;
  app.live = true;
  app.user = 'JOY';
  app.liveTables = ['A', 'B'];
  app.data = { now: T1, equipment: [], events: [], reports: [] };
  app._monLoad = async () => clone(MS);
  app._monSave = async (k, o) => { MS[k] = clone(o); };
  app._cfgLoad = async () => clone(cfgInDb);
  app._leadWait = () => new Promise((r) => setTimeout(r, 5));
  app._n = { bl: 0, ev: 0, reload: 0, timers: 0, cfg: 0 };
  app._loadBaselines = function () { this._n.bl++; return Promise.resolve(); };
  app._loadEventsLive = function () { this._n.ev++; };
  app._reloadLive = function () { this._n.reload++; };
  app._startTimers = function () { this._n.timers++; };
  const cl = app._cfgLoad;
  app._cfgLoad = function () { this._n.cfg++; return cl(); };
  app._applied = Object.assign({}, app.state, clone(SAVED));
  app._cfgOk = true;
  app._lead = false; app._leadAt = 0; app._cfgSeen = null;   // _applyLive와 같은 시작 상태
  return app;
}
const leads = (...tabs) => tabs.filter((t) => t._isLead()).length;

// ── 담당 하나 ─────────────────────────────────────────────────────────
const A = mkTab(), B = mkTab();
{
  chk(!A._isLead() && !B._isLead(), '조율 전에는 쓰기 없음(부팅 직후 따라잡기 판정 겹침 방지)');
  await A._coordTick();
  await B._coordTick();
  chk(A._isLead() && !B._isLead() && MS.__lead.id === A._tabId, '먼저 연 탭이 담당, 나중 탭은 표시만');
  await A._coordTick(); await B._coordTick();
  chk(leads(A, B) === 1 && MS.__lead.id === A._tabId, '갱신 후에도 담당 유지(10초마다 기록 갱신)');
}

// ── 동시 부팅 경합 ─────────────────────────────────────────────────────
{
  const snap = clone(MS);
  delete MS.__lead;
  const X = mkTab(), Y = mkTab(), Z = mkTab();
  await Promise.all([X._coordTick(), Y._coordTick(), Z._coordTick()]);
  chk(leads(X, Y, Z) === 1, '셋이 동시에 잡아도 기록 뒤 다시 읽어 마지막 기록자 하나만 담당',
    [X, Y, Z].map((t) => t._isLead() ? 'L' : '-').join(''));
  Object.keys(MS).forEach((k) => delete MS[k]); Object.assign(MS, snap);
}

// ── 표시 탭: 판정·자동 복구 없음 ────────────────────────────────────────
{
  await B._judgeLive();
  chk(B._lastJudgeAt === undefined, '표시 탭은 앱 모드 판정을 건너뜀(이벤트·알림 중복 없음)');
  await A._judgeLive();
  chk(A._lastJudgeAt > 0, '담당 탭은 판정');
  let synced = 0;
  const tgt = { key: 'mon', recK: 'monRec', toast: '재등록', sync: () => { synced++; }, rec: () => '' };
  const dead = { k: 'monDead', text: '서버 감시가 멈췄습니다', why: 'x' };
  const wB = B._recoverWarn(tgt, dead, Date.now(), () => {});
  chk(synced === 0 && /다른 탭\(또는 PC\)이 맡습니다/.test(wB.text) && wB.act === '다시 등록', '표시 탭은 자동 재등록 안 함(수동 버튼만)', wB.text);
  A._recoverWarn(tgt, dead, Date.now(), () => {});
  chk(synced === 1, '담당 탭이 자동 재등록');
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/C\.monMode !== 'server' && self\._isLead\(\) && self\._checkIdentity\(\)/.test(src), '패턴 점수 기록도 담당만');
}

// ── 헤더 배지 ─────────────────────────────────────────────────────────
{
  const vA = A.renderVals(), vB = B.renderVals();
  chk(vA.monModeBadgeText === '앱' && vB.monModeBadgeText === '앱 · 보기 전용', '앱 모드 표시 탭은 "보기 전용" 배지', vB.monModeBadgeText);
  chk(/이 탭은 결과만 표시/.test(vB.monPillTitle), '배지 설명 — 판정은 다른 탭이 맡음', vB.monPillTitle);
}

// ── 만료·이어받기 ─────────────────────────────────────────────────────
{
  A._leadAt = Date.now() - 31000;
  chk(!A._isLead(), '담당도 마지막 갱신이 만료 시간을 넘기면 스스로 쓰기 중단(백그라운드 탭 타이머 지연)');
  A._leadAt = Date.now();
  MS.__lead.t = Date.now() - 31000;                 // 담당 탭이 닫힘 — 기록 갱신 멈춤
  MS['A:X'] = { g: 2, from: 'DB' };                  // 담당이 남긴 판정 상태
  B._monState = { 'A:X': { g: 0, from: 'stale' } };  // 표시 탭 메모리는 옛 값
  await B._coordTick();
  chk(B._isLead() && MS.__lead.id === B._tabId, '담당 기록이 만료되면 표시 탭이 이어받음');
  chk(B._monState['A:X'] && B._monState['A:X'].from === 'DB', '이어받을 때 판정 상태를 DB 값으로 교체(옛 메모리로 판정해 알림 중복 방지)');
  await A._coordTick();
  chk(!A._isLead() && leads(A, B) === 1, '옛 담당이 돌아와도 새 담당 유지', A._isLead());
}

// ── 저장 표시: 설정·학습값 ─────────────────────────────────────────────
{
  const C = mkTab();
  await C._coordTick();                              // 첫 조율 — 기준만 기록
  chk(C._n.cfg === 0 && C._n.bl === 0, '첫 조율은 다시 읽지 않음(방금 읽은 값)');
  cfgInDb = Object.assign(clone(SAVED), { monitorInterval: '5s', renotify: { '주의': '0', '위험': '2h', '심각': '30m' } });
  await A._bumpStamp('cfg');
  await C._coordTick(); await new Promise((r) => setTimeout(r, 5));
  chk(C._n.cfg === 1 && C._ac().renotify['위험'] === '2h' && C.state.renotify['위험'] === '2h', '다른 탭이 설정을 저장하면 다음 조율에서 다시 읽어 적용본·폼 모두 교체');
  chk(C._n.timers === 1 && C._n.reload === 0, '판정 주기만 바뀌면 틱만 다시 시작(데이터 재적재 없음)');
  await A._coordTick();
  chk(A._n.cfg === 0, '자기가 저장한 표시는 다시 읽지 않음');

  C.state.dirty = true; C.state.renotify = { '주의': '0', '위험': '9h', '심각': '30m' };
  cfgInDb = Object.assign(clone(cfgInDb), { srcSel: ['A', 'B', 'GONE'], renotify: { '주의': '0', '위험': '3h', '심각': '30m' } });
  await B._bumpStamp('cfg');
  await C._coordTick(); await new Promise((r) => setTimeout(r, 5));
  chk(C._ac().renotify['위험'] === '3h' && C.state.renotify['위험'] === '9h', '편집 중인 폼은 유지하고 적용본만 교체');
  chk(C._toasts.some((t) => /다른 곳에서 설정이 저장되었습니다/.test(t)), '편집 중이면 덮어쓰기 경고');
  chk(C._n.reload === 1 && C._ac().srcSel.join() === 'A,B', '감시 대상이 바뀌면 다시 불러오기(없는 테이블은 제외)', C._ac().srcSel.join());

  await A._bumpStamp('bl');
  await C._coordTick();
  chk(C._n.bl === 1, '다른 탭이 학습값을 저장하면 베이스라인 다시 읽음');

  // 담당의 서버 스크립트 재등록은 조율(다른 곳 저장분 반영) 뒤에
  const keepLead = clone(MS.__lead);
  const D = mkTab();
  await D._coordTick();
  D._lead = true; D._leadAt = Date.now(); MS.__lead = { id: D._tabId, t: Date.now() };
  D._healthTick = () => {}; D._refreshFlap = () => {};
  const baked = [];
  D._syncMonitorTimer = function () { baked.push(this._ac().renotify['위험']); return Promise.resolve(); };
  D._syncBandTimer = D._syncWdTimer = () => Promise.resolve();
  D._cfgLoad = () => new Promise((r) => setTimeout(() => r(clone(cfgInDb)), 30));   // 느린 설정 읽기
  cfgInDb = Object.assign(clone(cfgInDb), { renotify: { '주의': '0', '위험': '4h', '심각': '30m' } });
  await A._bumpStamp('cfg');
  await D._catalogTick();
  chk(baked.join() === '4h', '다른 곳이 저장한 틱에도 새 설정으로 굽는다(옛 설정으로 되돌리지 않음)', baked.join());
  cfgInDb = Object.assign(clone(cfgInDb), { renotify: { '주의': '0', '위험': '5h', '심각': '30m' } });
  await A._bumpStamp('cfg');
  baked.length = 0;
  const pend = D._coordTick();                       // 조율 진행 중(느린 설정 읽기)에 틱이 옴
  await D._catalogTick();
  await pend;
  chk(baked.join() === '5h', '진행 중인 조율이 있으면 그 결과를 기다린 뒤 굽는다', baked.join());
  D._reloading = true; baked.length = 0;
  await D._catalogTick();
  chk(baked.length === 0, '재적재 중에는 굽지 않음(바뀐 선택을 옛 태그 목록으로 굽기 방지)');
  D._reloading = false;
  MS.__lead = { id: 'other', t: Date.now() };
  await D._catalogTick();
  chk(!D._isLead() && baked.length === 0, '표시 탭은 굽지 않음');
  MS.__lead = Object.assign(keepLead, { t: Date.now() });
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk((src.match(/self\._bumpStamp\('cfg'\)/g) || []).length === 3 && /_resyncMonSoon\(\) \{[\s\S]{0,200}_bumpStamp\('bl'\)/.test(src),
    '설정 저장 3경로·학습값 변경이 저장 표시를 남김');
}

// ── 계정 전환 ─────────────────────────────────────────────────────────
{
  const lead0 = clone(MS.__lead);
  ls.accessToken = mkJwt('kim');
  B._onStorage();
  chk(B.state.idSwitch === 'KIM' && !B._isLead(), '다른 계정 로그인 감지(저장소 이벤트) — 안내 표시·담당 내려놓음');
  const v = B.renderVals();
  chk(v.idSwitchShow && v.idSwitchTo === 'KIM' && v.idSwitchFrom === 'JOY' && /앱 감시는 이 탭에서 멈춥니다/.test(v.idSwitchMon),
    '전체 화면 안내 — 바뀐 계정·원래 계정·감시 상태', v.idSwitchMon);
  const htm = renderToString(view(v));
  chk(/다른 계정으로 로그인되었습니다/.test(htm) && />새로고침</.test(htm) && /position: fixed; inset: 0; z-index: 400/.test(htm), '안내 화면이 실제로 그려짐(새로고침 버튼)');
  await B._coordTick();
  chk(JSON.stringify(MS.__lead) === JSON.stringify(lead0), '전환 중엔 담당 기록도 쓰지 않음');
  B._toasts = [];
  chk(B._cfgLocked() === true && B._toasts.some((t) => /다른 계정으로 로그인되어 저장하지 않았습니다/.test(t)), '설정 저장 차단');
  B._lead = true; B._leadAt = Date.now(); B._lastJudgeAt = 0;   // 담당이었어도
  await B._judgeLive();
  chk(B._lastJudgeAt === 0, '판정 없음(담당 기록이 남아 있어도)');

  let health = 0;
  const keepHealth = B._healthTick;
  B._healthTick = () => { health++; };
  B._tickLive();
  const ticked = !!B._ticking;                       // 시작했으면 동기 구간에서 켜짐
  await B._catalogTick();
  chk(!ticked && health === 0, '주기 조회·점검도 멈춤(막힌 조회가 "조회 실패" 배너로 남지 않게)');
  B._healthTick = keepHealth;
  fetched = [];
  let err = null;
  await DB.q('select 1').catch((e) => { err = e; });
  chk(err && err.idSwitch === 'KIM' && fetched.length === 0, 'db.js 관문 — 다른 계정 세션으로는 요청 자체를 보내지 않음', err && err.message);

  ls.accessToken = mkJwt('joy');
  B._onStorage();
  chk(B.state.idSwitch === null, '원래 계정으로 다시 로그인하면 안내 해제');
  await B._coordTick();
  chk(B._isLead(), '다음 조율에서 담당 다시 잡음(기록이 아직 자기 것)');
  fetched = [];
  await DB.q('select 1');
  chk(fetched.length === 1, '요청 재개');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
