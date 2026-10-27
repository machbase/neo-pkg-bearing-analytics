/* 이벤트 목록·건수 — 같은 조건으로 DB에서 거름, 주기 갱신
   · 유형·태그 필터가 조회 조건 — 필터 결과의 최근 200건, 건수와 일치
   · 선택 해제한 테이블 이벤트는 목록·건수 모두 제외, 내보내기는 포함
   · '최근 이벤트' 칸은 필터 무관, 겹친 요청은 마지막 것만, 30초마다 다시 읽음
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
import fs from 'node:fs';

// ── 가짜 EVENTS 표 — 앱이 만든 SQL을 그대로 해석 ─────────────────────────
const EV = [];   // [NAME, TIME(ms), VALUE, ETYPE, GRADE, LIM, DETAIL, EID]
let sqls = [], slow = 0;
function match(w, r) {
  let m = /TIME between from_timestamp\((\d+)000000\) and from_timestamp\((\d+)000000\)/.exec(w);
  if (m && !(r[1] >= Number(m[1]) && r[1] <= Number(m[2]))) return false;
  if ((m = /NAME in \(([^)]*)\)/.exec(w)) && !m[1].split(',').map((s) => s.trim().slice(1, -1)).includes(r[0])) return false;
  if (/NAME=''/.test(w)) throw new Error("NAME='' — Machbase는 빈 문자열을 NULL로 봄(ERR-2284)");
  if ((m = /NAME >= '([^']*)' and NAME < '([^']*)'/.exec(w)) && !(r[0] >= m[1] && r[0] < m[2])) return false;
  if ((m = /ETYPE='([^']*)'/.exec(w)) && r[3] !== m[1]) return false;
  return true;
}
import './_faketoken.mjs';   // db.js 관문용 토큰 칸
globalThis.fetch = async (url) => {
  const sql = decodeURIComponent(String(url).replace(/^[^?]*\?q=/, '').replace(/&.*$/, ''));
  sqls.push(sql);
  if (slow > 0) { slow--; await new Promise((r) => setTimeout(r, 40)); }
  let rows = [];
  const m = /^select (count\(\*\)|NAME, TIME, VALUE, ETYPE, GRADE, LIM, DETAIL, EID) from \S+EVENTS where (.*?)(?: order by TIME desc limit (\d+))?$/.exec(sql);
  if (m) {
    const hit = EV.filter((r) => match(m[2], r)).sort((a, b) => b[1] - a[1]);
    rows = m[1] === 'count(*)' ? [[hit.length]] : hit.slice(0, Number(m[3]));
  }
  return { ok: true, status: 200, json: async () => ({ success: true, data: { rows } }), text: async () => '' };
};

const DB = (await import('../../cgi-bin/db/db.js')).default;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
DB.setUser('JOY');

const T = Date.now();
let n = 0;
const add = (key, ago, etype) => EV.push([key, T - ago, 1, etype, '주의', 1, '', 'e' + (n++)]);
for (let i = 0; i < 250; i++) add('JOY:A:X', 1000 + i * 1000, 'threshold');          // 최근 250건
for (let i = 0; i < 10; i++) add('JOY:A:Y', 600000 + i * 1000, 'sensor_fault');      // 오래된 쪽 10건
for (let i = 0; i < 5; i++) add('JOY:B:Z', 500 + i * 100, 'threshold');              // B 테이블 5건(가장 최근)
add('JOY:C:W', 100, 'threshold');                                                      // 감시 대상 아닌 테이블
add('KIM:A:X', 50, 'threshold');                                                       // 다른 계정

// ── SQL ──────────────────────────────────────────────────────────────
{
  const q = SQL.eventsRange(0, 1, 200, { etype: 'threshold', keys: ['A:X', 'B:Z'] });
  chk(/NAME in \('JOY:A:X','JOY:B:Z'\)/.test(q) && /ETYPE='threshold'/.test(q) && /limit 200$/.test(q), '필터가 조회 조건으로 — 태그 목록·유형', q.slice(-120));
  chk(SQL.eventsCount(0, 1, { etype: 'threshold', keys: ['A:X'] }).split(' where ')[1] === SQL.eventsRange(0, 1, 1, { etype: 'threshold', keys: ['A:X'] }).split(' where ')[1].replace(/ order by.*$/, ''),
    '목록과 건수는 같은 조건');
  const q0 = SQL.eventsRange(0, 1, 1, { keys: [] });
  chk(/NAME in \('JOY::'\)/.test(q0) && !/NAME=''/.test(q0), "빈 태그 목록 — 없는 키로 0건(빈 IN 문법 오류·'' NULL 오류 방지)", q0.slice(-60));
  chk(/NAME >= 'JOY:' and NAME < 'JOY;'/.test(SQL.eventsRange(0, 1)), '필터 없으면 내 이벤트 전체(내보내기)');
}

// ── 앱 ──────────────────────────────────────────────────────────────
const mkEq = (table, name) => ({
  id: table + ':' + name, table, name, alias: name, unit: 'mm/s', cls: 'II', baseCls: 'II', zones: [1.12, 2.8, 7.1],
  fs: 25600, rpm: 1800, bearing: { model: '', n: 0, Bd: 0, Pd: 0, phi: 0 }, meta: { lineHz: 60 },
  stat: { count: 1000, minMs: T - 3600000, maxMs: T }, lastSeen: T, rms: 1, sparkVals: [1], spark: {}, rollup: [], grade: 0,
});
function mkApp(sel) {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app._sets = 0;
  app.setState = function (st) { if ('events' in st) this._sets++; Object.assign(this.state, st); };
  app._toast = () => {};
  app.E = CH;
  app.live = true;
  app.data = { now: T, equipment: [mkEq('A', 'X'), mkEq('A', 'Y'), mkEq('B', 'Z')] };
  app._applied = Object.assign({}, app.state, { srcSel: sel });
  Object.assign(app.state, { ready: true, tab: 'monitor', evtScope: 'all', evtTag: 'all', evtType: 'all' });
  return app;
}
{
  const app = mkApp(['A', 'B']);
  await app._loadEventsLive();
  chk(app.state.events.length === 200 && app._evtTotal === 265 && app._evtCapped, '필터 없음 — 목록 최근 200건 · 건수는 감시 태그 전체(다른 테이블·다른 계정 제외)',
    app.state.events.length + '/' + app._evtTotal);

  app.state.evtType = 'sensor_fault';
  await app._loadEventsLive();
  const vm = app.renderVals();
  chk(app.state.events.length === 10 && app._evtTotal === 10 && !app._evtCapped && app.state.events.every((e) => e.type === 'sensor_fault'),
    '유형 필터 — 그 유형의 최근 200건을 조회(예전: 전체 200건 안에서 거르면 0건)', app.state.events.length + '/' + app._evtTotal);
  chk(vm.evtRows.length === 10 && vm.evtCount === 10 && !vm.evtEmpty && !vm.evtCapped, '화면 — 목록 10행 · 건수 10 · "조용합니다" 안 뜸');
  chk(/· Z$/.test(vm.lastEventText), "'최근 이벤트' 칸은 필터 무관 — 전체 중 최신(B:Z)", vm.lastEventText);

  app.state.evtType = 'all'; app.state.evtTag = 'A:Y';
  await app._loadEventsLive();
  chk(app.state.events.length === 10 && app._evtTotal === 10, '태그 필터도 조회 조건');
}
{
  const app = mkApp(['A']);             // B 선택 해제
  app.state.evtTag = 'B:Z';
  await app._loadEventsLive();
  chk(app._evtTotal === 260 && !app.state.events.some((e) => e.tagName === 'Z'), '선택 해제한 테이블 이벤트는 목록·건수 모두 제외', app._evtTotal);
  chk(app.state.evtTag === 'all', '고른 태그가 감시 대상에서 빠지면 필터는 전체로');
  const ex = await DB.loadEventsRange(0, T + 1);
  chk(ex.length === 266 && ex.some((r) => r.tbl === 'B'), '내보내기 조회는 해제한 테이블까지 내 이벤트 전체(다른 계정 제외)', ex.length + '건');
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/_exportEvents\(\) \{[\s\S]{0,600}loadEventsRange\(fromMs, toMs\)\.then/.test(src), '내보내기는 필터 없이 호출');
}
{
  const app = mkApp(['A', 'B']);
  await app._loadEventsLive();
  const s0 = app._sets;
  await app._loadEventsLive();
  chk(app._sets === s0, '결과가 같으면 다시 그리지 않음(30초 갱신이 매번 화면 갱신하지 않게)');
  app.setState({ events: [] });
  await app._loadEventsLive();
  chk(app.state.events.length === 200, '다른 곳이 목록을 비웠으면 같은 결과라도 다시 채움');

  slow = 2;                              // 첫 요청(전체 — 건수·목록 2건)만 늦게 도착
  const p1 = app._loadEventsLive();
  app.state.evtType = 'sensor_fault';
  const p2 = app._loadEventsLive();
  await Promise.all([p1, p2]);
  chk(app.state.events.length === 10 && app._evtTotal === 10, '겹친 요청은 마지막 것만 반영(늦게 온 옛 결과가 덮지 않음)', app.state.events.length);
}
{
  const app = mkApp(['A']);
  app.data.equipment = [];
  sqls = [];
  await app._loadEventsLive();
  chk(sqls.length === 0 && app.state.events.length === 0 && app._evtTotal === 0 && app._lastEvt === null, '감시 태그가 없으면 조회 없이 빈 목록·0건');
  let loads = 0;
  Object.assign(app, { _healthTick() {}, _refreshFlap() {}, _coordTick() { return Promise.resolve(); } });
  app._loadEventsLive = function () { loads++; return Promise.resolve(); };
  app._lead = true; app._applied.monMode = 'server';
  await app._catalogTick(); await app._catalogTick();
  chk(loads === 1, '카탈로그 틱(10초)마다가 아니라 30초에 한 번');
  app._evtPollAt = Date.now() - 31000;
  await app._catalogTick();
  chk(loads === 2, '30초 지나면 다시 읽음 — 서버 모드 담당 탭도(예전: 새 이벤트를 모름)');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
