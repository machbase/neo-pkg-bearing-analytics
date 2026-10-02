/* 서버 타이머 회차 상태 기록(__st:mon · __st:band) — 생성 TQL을 가짜 DB 위에서 실제로 한 회차씩 실행
   · 판정 상태 조회 실패 → 회차 건너뜀(이벤트·알림 없음) + state_read 기록
   · 이벤트 저장 실패 → 그 태그만 건너뜀(상태 미저장 → 다음 회차 재시도) + tag_fail 기록, 나머지 태그는 판정
   · 회차 예외 → round 기록 + 잠금 해제, 다음 정상 회차가 문제 목록을 비움
   · 대역도 같은 기록, 앱은 두 기록을 같은 배너 규칙으로 표시
   오프라인(Neo 불필요) · npm run smoke 포함 */
import fs from 'node:fs';

globalThis.window = globalThis;
const Monitor = (await import('../../cgi-bin/monitor/monitor.js')).default;
const Band = (await import('../../cgi-bin/monitor/band.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App, judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const dec = (v) => JSON.parse(decodeURIComponent(v));

// 가짜 DB — MONSTATE는 맵, 조회 실패·이벤트 저장 실패를 켤 수 있음
function mkDb(opt) {
  const state = new Map(), execs = [];
  return {
    state, execs, opt,
    query(sql) {
      let m;
      if (/MONSTATE where K in/.test(sql)) {
        if (opt.failStateRead) throw new Error('ERR-9999 state read');
        return [...state.entries()];
      }
      if ((m = /select count\(\*\) from \S*MONSTATE where K='([^']*)'/.exec(sql))) return [[state.has(m[1]) ? 1 : 0]];
      if (/select MAX_TIME from/.test(sql)) {
        if (opt.failStatFor && sql.includes("NAME='" + opt.failStatFor + "'")) throw new Error('ERR-2025 stat');
        return [['2026-01-01 00:00:00']];
      }
      if (/_STAT/.test(sql)) return [['A', '2020-01-01 00:00:00'], ['B', '2020-01-01 00:00:00']];
      return [];
    },
    // 성공한 문장만 기록
    exec(sql) {
      let m;
      if (/insert into \S*EVENTS/.test(sql) && opt.failEventFor && sql.includes("'" + opt.failEventFor + "'")) throw new Error('ERR-1418 event insert');
      if ((m = /insert into \S*MONSTATE values\('([^']*)','([^']*)'\)/.exec(sql))) {
        if (state.has(m[1])) throw new Error('duplicate key');
        state.set(m[1], m[2]);
      } else if ((m = /update \S*MONSTATE set VAL='([^']*)' where K='([^']*)'/.exec(sql))) state.set(m[2], m[1]);
      execs.push(sql);
    },
  };
}
// 생성 TQL의 SCRIPT 본문 실행
function run(tql, db, yieldThrow) {
  const js = tql.slice(tql.indexOf('SCRIPT({') + 8, tql.lastIndexOf('})'));
  const out = [];
  const $ = {
    db: () => db,
    yield: (...a) => { if (yieldThrow && a[0] === yieldThrow) { yieldThrow = null; throw new Error('yield boom'); } out.push(a); },
    request: () => ({ do() {} }),
  };
  new Function('$', js)($);
  return out;
}
const kinds = (out) => out.map((a) => a[0]).join(',');
const evInserts = (db) => db.execs.filter((s) => /insert into \S*EVENTS/.test(s));
const st = (db, k) => (db.state.has('JOY:' + k) ? dec(db.state.get('JOY:' + k)) : null);

const monTql = Monitor.buildMonitorTql({
  judgeSrc: judgeTick.toString(), tblPrefix: 'P.', keyPrefix: 'JOY:',
  tags: [{ tbl: 'T', tag: 'A', zones: [1, 2, 3] }, { tbl: 'T', tag: 'B', zones: [1, 2, 3] }],
  cfg: { escHold: 0, recHold: 0, reno: {} },
});

// ── 서버 감시 ───────────────────────────────────────────────────────────
{
  const db = mkDb({});
  const out = run(monTql, db);
  const s = st(db, '__st:mon');
  chk(evInserts(db).length === 2 && /done/.test(kinds(out)), '정상 회차 — 두 태그 모두 판정(두절 이벤트 2건)', kinds(out));
  chk(s && Array.isArray(s.err) && s.err.length === 0 && s.t > 0 && 'nf' in s, '회차 상태 기록 — 문제 없음·놓친 알림 필드 포함', JSON.stringify(s));
}
{
  const db = mkDb({ failStateRead: true });
  const out = run(monTql, db);
  const s = st(db, '__st:mon');
  chk(evInserts(db).length === 0 && /skip/.test(kinds(out)), '판정 상태 조회 실패 → 회차 건너뜀(알림 중복 없음)', kinds(out));
  chk(!db.state.has('JOY:T:A') && !db.state.has('JOY:T:B'), '태그 상태도 쓰지 않음');
  chk(s && s.err.length === 1 && s.err[0].c === 'state_read' && /ERR-9999/.test(s.err[0].m) && !('nf' in s),
    'state_read 기록(직전 상태 모름 → 놓친 알림 필드 생략)', JSON.stringify(s));
}
{
  const db = mkDb({ failEventFor: 'JOY:T:A' });
  run(monTql, db);
  const s = st(db, '__st:mon');
  chk(evInserts(db).some((x) => x.includes("'JOY:T:B'")) && db.state.has('JOY:T:B'), '이벤트 저장 실패 태그가 있어도 나머지 태그는 판정·저장');
  chk(!db.state.has('JOY:T:A'), '실패 태그는 상태를 저장하지 않음 — 다음 회차 재시도');
  chk(s && s.err.length === 1 && s.err[0].c === 'tag_fail' && s.err[0].n === 1 && /T:A/.test(s.err[0].m), 'tag_fail 기록(건수·태그)', JSON.stringify(s.err));

  db.opt.failEventFor = null;
  run(monTql, db);
  const s2 = st(db, '__st:mon');
  chk(evInserts(db).filter((x) => x.includes("'JOY:T:A'")).length === 1 && db.state.has('JOY:T:A'), '다음 회차에 실패 태그를 다시 판정·저장');
  chk(s2 && s2.err.length === 0, '정상 회차가 문제 목록을 비움', JSON.stringify(s2.err));
}
{
  const db = mkDb({});
  const out = run(monTql, db, 'done');
  const s = st(db, '__st:mon');
  const lock = st(db, '__lock');
  chk(/error/.test(kinds(out)) && s && s.err.some((e) => e.c === 'round' && /yield boom/.test(e.m)), '회차 예외 → round 기록', JSON.stringify(s && s.err));
  chk(lock && lock.t === 0, '예외에도 잠금 해제');
}

// ── 대역 추출 ───────────────────────────────────────────────────────────
const bandTql = Band.buildBandTql({
  tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 12800, win: 4096 }, { tbl: 'T', tag: 'B', fr: 30, fs: 12800, win: 4096 }],
  nowMs: Date.now(), tblPrefix: 'P.', keyPrefix: 'JOY:', statusKey: '__st:band',
});
{
  const db = mkDb({ failStatFor: 'A' });
  const out = run(bandTql, db);
  const s = st(db, '__st:band');
  chk(/done/.test(kinds(out)) && s && s.err.length === 1 && s.err[0].c === 'tag_fail' && /T:A/.test(s.err[0].m),
    '대역 — 조회 실패 태그를 조용히 건너뛰지 않고 tag_fail로 기록, 회차는 계속', JSON.stringify(s));
  const db2 = mkDb({});
  run(bandTql, db2, 'done');
  const s2 = st(db2, '__st:band');
  chk(s2 && s2.err.some((e) => e.c === 'round'), '대역 — 회차 예외도 기록(전에는 결과로만 방출)', JSON.stringify(s2 && s2.err));
}

// ── 앱 배너 ─────────────────────────────────────────────────────────────
function mkApp(patch) {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (s) { Object.assign(this.state, s); };
  app._toast = function () {};
  app._bandSyncs = 0;
  app._syncMonitorTimer = function () { return Promise.resolve(); };
  app._syncBandTimer = function () { this._bandSyncs++; return Promise.resolve(); };
  app.E = CH; app.live = true;
  Object.assign(app.state, { ready: true, monMode: 'server', monitorOn: true, monitorInterval: '3s', bandOn: true, bandInterval: '10m' }, patch || {});
  return app;
}
const RUN = { NEO_BEARING_MONITOR: { state: 'RUNNING' }, NEO_BEARING_BAND: { state: 'RUNNING' } };
const W = (a) => a.state.health || [];
{
  const a = mkApp();
  const now = Date.now();
  a._applyHealth(RUN, {
    mon: { t: now - 3000, n: 4, pat: 1, ms: 200, err: [{ c: 'state_read', m: 'ERR-9999 state read', n: 1 }, { c: 'tag_fail', m: 'T:A — ERR-1418', n: 3 }], nf: null },
    band: { t: now - 60000, n: 2, err: [{ c: 'tag_fail', m: 'T:B — ERR-2025', n: 1 }] },
  });
  const sr = W(a).find((w) => w.k === 'st:mon:state_read');
  const tf = W(a).find((w) => w.k === 'st:mon:tag_fail');
  const bt = W(a).find((w) => w.k === 'st:band:tag_fail');
  chk(sr && sr.lv === 'err' && /서버 감시/.test(sr.text) && /ERR-9999/.test(sr.text), '상태 조회 실패 배너(사유 포함)', sr && sr.text);
  chk(tf && tf.lv === 'warn' && /태그 3개/.test(tf.text), '태그 실패 배너(건수)', tf && tf.text);
  chk(bt && /대역 추출/.test(bt.text), '대역 실패도 같은 규칙으로 배너', bt && bt.text);
}
{
  const a = mkApp();
  const now = Date.now();
  a._applyHealth(RUN, { mon: { t: now - 3000, n: 4, pat: 1, err: [] }, band: { t: now - 2 * 3600000, n: 3, err: [] } });
  const bs = W(a).find((w) => w.k === 'bandstale');
  chk(bs && /회차를 마치지 못했습니다/.test(bs.text) && a._bandSyncs === 1, '대역 기록이 주기 3배 넘게 멈춤 → 배너 + 자동 재등록', bs && bs.text);
  const b = mkApp();
  b._applyHealth(RUN, { mon: { t: now - 3000, n: 4, pat: 1, err: [] }, band: { t: now - 5 * 60000, n: 3, err: [] } });
  chk(!W(b).some((w) => w.k === 'bandstale'), '주기 안의 기록은 정상');
}
{
  const a = mkApp();
  const now = Date.now(), base = { t: now - 3000, n: 4, pat: 1, err: [] };
  a._applyHealth(RUN, { mon: Object.assign({ nf: { t: now - 60000, m: '설정 조회 실패', n: 2 } }, base), band: null });
  const has = () => W(a).some((w) => w.k === 'nferr');
  const h1 = has();
  a._applyHealth(RUN, { mon: Object.assign({}, base), band: null });
  const h2 = has();
  a._applyHealth(RUN, { mon: Object.assign({ nf: null }, base), band: null });
  const h3 = has();
  chk(h1 && h2 && !h3, '놓친 알림 — 필드 없는 기록(직전 상태 모름)엔 유지, nf:null에 해제', [h1, h2, h3].join());
}
{
  const a = mkApp();
  const s = a._timerStatus({ __hb: { t: 5, n: 2, pat: 1, ms: 9 }, __nferr: { t: 4, m: 'x', n: 1 } });
  chk(s.mon && s.mon.t === 5 && s.mon.nf && s.mon.nf.n === 1 && s.band === null, '재등록 전 옛 스크립트(__hb·__nferr)도 같은 모양으로 읽음', JSON.stringify(s));
  chk(a._timerStatus({ '__st:mon': { t: 7, err: [] }, __hb: { t: 5 } }).mon.t === 7, '새 기록이 있으면 새 기록 우선');
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/\(srv \|\| C\.bandOn\) \? loadMonState\(\)/.test(src), '앱 모드에서도 대역이 켜져 있으면 상태 기록을 읽음');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
