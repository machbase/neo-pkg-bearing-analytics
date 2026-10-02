/* 서버 감시의 발송 설정 경로 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 웹훅 URL은 감시 스크립트에 미포함(파일 API는 계정 구분 없음) — 알림 회차에 계정 CONFIG 표에서 조회
   · 저장(db.js writeDomain)↔해석(notify.configFromRows·notifyCfgFrom) 왕복, 앱·서버 해석 일치
   · 생성 TQL에서 떼어낸 원문 함수로 발송·놓친 알림 기록(회차 상태의 nf)·앱 배너 확인 */
globalThis.window = globalThis;

// LOOKUP 테이블을 메모리 맵으로 흉내(test-cfgstore와 같은 방식)
const store = new Map();
globalThis.fetch = async (url) => {
  const sql = decodeURIComponent(String(url).replace(/^[^?]*\?q=/, '').replace(/&.*$/, ''));
  let rows = [];
  let m;
  if (/^select K, VAL from /.test(sql)) rows = [...store.entries()].map(([k, v]) => [k, v]);
  else if ((m = /^select count\(\*\) from \S+ where K='(.*)'$/.exec(sql))) rows = [[store.has(m[1]) ? 1 : 0]];
  else if ((m = /^insert into \S+ values\('(.*?)', '(.*)'\)$/.exec(sql))) store.set(m[1], m[2]);
  else if ((m = /^update \S+ set VAL='(.*)' where K='(.*?)'$/.exec(sql))) store.set(m[2], m[1]);
  else if ((m = /^delete from \S+ where K='(.*?)'$/.exec(sql))) store.delete(m[1]);
  return { ok: true, status: 200, json: async () => ({ success: true, data: { rows } }) };
};

const DB = (await import('../../cgi-bin/db/db.js')).default;
const Notify = (await import('../../cgi-bin/notify/notify.js')).default;
const Monitor = (await import('../../cgi-bin/monitor/monitor.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App, judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

DB.setUser('JOY');
// 조각 둘 이상 나오는 긴 URL — 조각 경계의 %XX 분할 해독까지 확인
const URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=K&token=' + 'x%y'.repeat(1500) + '&한글=값';
const DEFS = { order: ['주의', '위험', '심각', '감시 이상'], timing: { '주의': '즉시', '위험': '즉시', '심각': '즉시', '감시 이상': '즉시' } };

// ── 생성 TQL에 발송 설정 미포함 ─────────────────────────────────
const baseSpec = {
  judgeSrc: judgeTick.toString(),
  tags: [{ tbl: 'T', tag: 'A', zones: [1.12, 2.8, 7.1], fs: 1000, bl: null, bb: null }],
  cfg: { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 0, 3: 0 } },
};
const tql = Monitor.buildMonitorTql(Object.assign({}, baseSpec, {
  // 호출측이 실수로 cfg를 넘겨도 실제 감시(dryRun 아님)에는 굽지 않음
  notify: { src: Notify.serverSrc(), cfgTable: DB.configTable(), defs: DEFS,
    cfg: { channels: { webhook: { on: true, to: URL } }, routes: {} } },
}));
chk(!tql.includes('chat.googleapis.com') && !tql.includes('token='), '감시 스크립트에 웹훅 URL이 없다');
chk(tql.includes('var NOTIFY=null;'), '발송 설정은 비어 있고 실행 때 채운다');
chk(tql.includes('"table":"NEO_BEARING_STORE.JOY.CONFIG"'), '읽을 곳은 그 계정의 설정 표다', DB.configTable());
chk(/\["__lock","__st:mon"\]/.test(tql), '예약 키(잠금·회차 상태)도 존재 여부를 읽는다 — 놓친 알림 누적의 직전 값');
chk(Monitor.validateSpec(Object.assign({}, baseSpec, { notify: { src: Notify.serverSrc(), cfgTable: 'X', defs: DEFS } })) === null,
  '사전 실행 검사 통과 — 새 임베드 함수에 자유 식별자가 없다');
const dryTql = Monitor.buildMonitorTql(Object.assign({}, baseSpec, { dryRun: true,
  notify: { src: Notify.serverSrc(), cfg: { channels: { webhook: { on: true, to: 'https://webhook.site/T' } }, routes: {} } } }));
chk(dryTql.includes('webhook.site/T'), 'dryRun만 주입한 설정을 쓴다(테스트 전용 경로)');

// ── 저장 → 해석 왕복 ────────────────────────────────────────────────────
await DB.saveConfig({ monitorOn: true, notifCh: { webhook: true }, notifTo: { webhook: URL },
  routes: { '주의': { timing: '알림 안 함' } }, machineClass: 'II' });
const cfgRows = [...store.entries()].filter(([k]) => /^cfg:/.test(k));
const monRows = cfgRows.filter(([k]) => /^cfg:monitor#/.test(k));
chk(monRows.length > 1, `알림 설정이 여러 조각으로 저장됐다 (${monRows.length}조각)`);
const rt = Notify.configFromRows(cfgRows, 'monitor');
chk(!rt.err && rt.obj && rt.obj.notifTo.webhook === URL, '실제 저장 경로의 조각을 다시 합쳐 URL이 그대로 나온다', rt.err);
chk(!!rt.obj && rt.obj.machineClass === undefined, '다른 도메인 조각은 섞지 않는다');

// 가장자리
chk(JSON.stringify(Notify.configFromRows([], 'monitor')) === '{"obj":{},"err":""}', '행이 없으면 빈 설정 — 오류가 아니다(저장한 적 없음)');
const holed = monRows.filter(([k]) => !/#0$/.test(k));
chk(/누락/.test(Notify.configFromRows(holed, 'monitor').err), '조각이 빠지면 오류로 돌려준다(빈 설정으로 읽으면 미발송이 묻힌다)');
chk(/해독/.test(Notify.configFromRows([['cfg:monitor#0', '%E0%A4%A']], 'monitor').err), '해독이 안 되면 오류');

// ── 앱·서버 동일 함수로 해석 ──────────────────────────────────────
{
  // _notifyCfg 기준 결과 형태 — 바뀌면 화면 체크 상태와 발송이 갈림
  const old = (S) => {
    const out = {};
    DEFS.order.forEach((k) => { const r = (S.routes || {})[k]; out[k] = r ? r : { timing: DEFS.timing[k] }; });
    return { channels: { webhook: { on: !!(S.notifCh || {}).webhook, to: (S.notifTo || {}).webhook || '' } }, routes: out };
  };
  const states = [
    {},
    { notifCh: { webhook: true }, notifTo: { webhook: 'https://x' }, routes: { '주의': { timing: '알림 안 함' }, '기타': { timing: '즉시' } } },
    { notifCh: { webhook: false }, notifTo: { webhook: 'https://x' }, routes: null },
  ];
  states.forEach((S, i) => {
    const got = App.prototype._notifyCfg.call({ state: S, _ac: App.prototype._ac });
    chk(JSON.stringify(got) === JSON.stringify(old(S)), `앱 _notifyCfg 결과가 이전과 같다 (#${i})`);
    chk(JSON.stringify(Notify.notifyCfgFrom(S, DEFS)) === JSON.stringify(got), `서버 해석이 앱과 같다 (#${i})`);
  });
}

// ── 서버 원문 함수 실행 ─────────────────────────────────────────────────
const fnSrc = (name) => {
  const s = tql.indexOf('function ' + name + '(');
  if (s < 0) throw new Error(name + ' 원문을 못 찾았다 — 생성기 구조가 바뀌었다');
  let d = 0;
  for (let i = tql.indexOf('{', s); i < tql.length; i++) {
    if (tql[i] === '{') d++;
    else if (tql[i] === '}' && !--d) return tql.slice(s, i + 1);
  }
  throw new Error(name + ' 괄호가 안 닫힌다');
};
const line = (needle) => {
  const l = tql.split('\n').find((x) => x.includes(needle));
  if (!l) throw new Error('원문 줄을 못 찾았다: ' + needle);
  return l.trim();
};
const SRV = [line('var NFON='), line('var NOTIFY='), line('var NFSRC='), line('var NFERR='), 'var NQ=[];',
  line('var GW='), line('var TYPEKO='), 'function fmtTs(ms){ return "T" + ms; }', 'function fmtShow(ms){ return "T" + ms; }', Notify.serverSrc(),
  fnSrc('loadNotify'), fnSrc('notifyEvent'), fnSrc('flushNotify')].join('\n');

function round(rowsOrErr, nEvents) {
  const sent = [], queries = [];
  const db = { query(sql) { queries.push(sql); if (rowsOrErr instanceof Error) throw rowsOrErr; return rowsOrErr; } };
  const $ = { request(url, o) { sent.push({ url, body: o.body }); return { do(fn) { fn({ ok: true, status: 200 }); } }; },
    yield() {} };
  const run = new Function('db', '$', 'now', SRV + '\n'
    + 'for (var i = 0; i < ' + nEvents + '; i++) notifyEvent({tbl:"T", tag:"A"+i, alias:"설비"+i, unit:"mm/s"}, {etype:"threshold", gi:2}, 4.2, 2.8, "");\n'
    + 'flushNotify(now);\n'
    + 'return {NFERR: NFERR, NFOK: NFOK};');
  const st = run(db, $, 1700000000000);
  return { sent, queries, st };
}
{
  const r = round(cfgRows.map(([k, v]) => [k, v]), 2);
  chk(r.queries.length === 1 && /from NEO_BEARING_STORE\.JOY\.CONFIG where K >= 'cfg:monitor#' and K < 'cfg:monitor\$'/.test(r.queries[0]),
    '보낼 것이 있는 회차에 계정 설정 표를 한 번 읽는다', r.queries[0]);
  chk(r.sent.length === 2 && r.sent.every((s) => s.url === URL), '읽은 URL로 이벤트마다 발송한다(묶음 기준 미만)', r.sent.length);
  chk(r.st.NFERR === null && r.st.NFOK === true, '성공 회차는 오류를 남기지 않는다');
  chk(r.sent.length && JSON.parse(r.sent[0].body).text.includes('설비0'), '문구는 앱과 같은 함수로 만든다');
}
{
  const r = round(cfgRows.map(([k, v]) => [k, v]), 0);
  chk(r.queries.length === 0 && r.sent.length === 0, '조용한 회차에는 설정 표를 읽지 않는다');
}
{
  const r = round(new Error('ERR-2830 no privilege'), 3);
  chk(r.sent.length === 0, '설정을 못 읽으면 보내지 않는다');
  chk(r.st.NFERR && /설정 조회 실패/.test(r.st.NFERR.m) && r.st.NFERR.n === 3, '사유와 건수를 NFERR에 남긴다', JSON.stringify(r.st.NFERR));
}
{
  const r = round(holed.map(([k, v]) => [k, v]), 1);
  chk(r.sent.length === 0 && r.st.NFERR && /누락/.test(r.st.NFERR.m), '조각이 빠진 설정은 오류로 남기고 보내지 않는다');
}
{
  const off = [];
  store.clear();
  await DB.saveConfig({ notifCh: { webhook: false }, notifTo: { webhook: 'https://x' } });
  store.forEach((v, k) => off.push([k, v]));
  const r = round(off, 2);
  chk(r.sent.length === 0 && r.st.NFERR === null && r.st.NFOK === true, '채널이 꺼져 있으면 오류 없이 보내지 않는다');
  const r2 = round([], 2);
  chk(r2.sent.length === 0 && r2.st.NFERR === null, '저장한 적이 없으면 오류 없이 보내지 않는다');
}

// ── 놓친 알림(nf) — 회차 상태 기록에 누적, 발송 성공 시 해제 ─────────────────
{
  const i = tql.indexOf('function stMon(known){');
  const src = tql.slice(i, tql.indexOf('\n}', i) + 2);
  const w = (NFERR, NFOK, PREV, known = true) => new Function('NFERR', 'NFOK', 'PREV', 'now', 'nDone', 'nPat', 'ERRS', src + '\nreturn stMon(' + known + ');')(
    NFERR, NFOK, PREV, 1000, 0, 0, []);
  const e = { t: 5, m: 'x', n: 3 };
  chk(JSON.stringify(w(e, false, {}).nf) === JSON.stringify({ t: 1000, m: 'x', n: 3 }), '실패 회차는 nf에 사유·건수를 남긴다');
  chk(w({ t: 6, m: 'y', n: 2 }, false, { '__st:mon': { nf: { t: 5, m: 'x', n: 3 } } }).nf.n === 5, '해제 전 실패가 이어지면 건수 누적');
  chk(w(null, true, { '__st:mon': { nf: { t: 5, m: 'x', n: 3 } } }).nf === null, '발송에 성공하면 해제');
  chk(JSON.stringify(w(null, false, { '__st:mon': { nf: { t: 5, m: 'x', n: 3 } } }).nf) === JSON.stringify({ t: 5, m: 'x', n: 3 }),
    '보낼 것 없던 회차는 이전 기록 유지');
  chk(!('nf' in w(e, false, {}, false)), '직전 상태를 모르는 회차는 nf 생략(앱이 마지막 값 유지)');
}

// ── 앱 배너 ─────────────────────────────────────────────────────────────
function mkApp(patch) {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._toast = function () {};
  app._syncMonitorTimer = function () { return Promise.resolve(); };
  app._syncBandTimer = function () { return Promise.resolve(); };
  app.E = CH; app.live = true;
  Object.assign(app.state, { ready: true, monMode: 'server', monitorOn: true, monitorInterval: '3s' }, patch || {});
  return app;
}
{
  const a = mkApp();
  a._applyHealth({}, { mon: { nf: { t: Date.now() - 120000, m: '설정 조회 실패: ERR-2830', n: 3 } }, band: null });
  const w = (a.state.health || []).find((x) => x.k === 'nferr');
  chk(!!w && /3건/.test(w.text) && /ERR-2830/.test(w.text), '서버가 알림을 못 보냈으면 배너에 건수와 사유를 올린다', w && w.text);
  const b = mkApp();
  b._applyHealth({}, { mon: { nf: null }, band: null });
  chk(!(b.state.health || []).some((x) => x.k === 'nferr'), '해제된 기록(nf:null)은 배너를 만들지 않는다');
  const c = mkApp({ monMode: 'app' });
  c._applyHealth({}, { mon: { nf: { t: Date.now(), m: 'x', n: 1 } }, band: null });
  chk(!(c.state.health || []).some((x) => x.k === 'nferr'), '앱 모드는 서버 발송 기록을 보지 않는다');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
