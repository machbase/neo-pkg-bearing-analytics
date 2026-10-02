/* 표시 시간대 — 계산·조회는 에포크, 표시·날짜 경계만 설정 시간대
   · 앱 조회 SQL은 from_timestamp(에포크 나노초) — 브라우저·서버 시간대와 무관
   · 차트 모듈 시간대 도구(parts·makeTime·parseDT·startOfDay), 서머타임 경계
   · 시간대 전환 시 화면 기간이 같은 순간 유지, 리포트·서버 알림 문구에 시간대 반영
   오프라인(Neo 불필요) · npm run smoke 포함 */
import fs from 'node:fs';

globalThis.window = globalThis;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Monitor = (await import('../../cgi-bin/monitor/monitor.js')).default;
const Mock = (await import('./mock.js')).default;
const { App, judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const T = Date.UTC(2026, 8, 28, 5, 3, 7, 123);   // 2026-09-28 05:03:07.123 UTC

// ── 조회 SQL ────────────────────────────────────────────────────────────
{
  SQL.setUser && SQL.setUser('JOY');
  const q = SQL.eventsRange(T, T + 1000, 10);
  chk(/from_timestamp\(1790571787123000000\)/.test(q) && !/to_date/.test(q), '조회 시각 = 에포크 나노초(밀리초에 000000을 글자로)', q.slice(0, 160));
  const big = SQL.eventsRange(1799999999999, 1799999999999, 1);
  chk(big.includes('from_timestamp(1799999999999000000)'), '큰 값도 정밀도 손실 없음');
  const ins = SQL.eventInsert({ eid: 'e', ts: T, tbl: 'T', tag: 'A', etype: 'threshold', grade: '주의', val: 1, lim: 1, detail: '' });
  chk(ins.includes('from_timestamp(1790571787123000000)'), '이벤트 저장 시각도 에포크');
  const src = fs.readFileSync(new URL('../../cgi-bin/db/sql.js', import.meta.url), 'utf8');
  chk(!/getHours|getFullYear|new Date\(/.test(src), 'SQL 모듈에 브라우저 시간 계산 없음');
}

// ── 시간대 도구 ─────────────────────────────────────────────────────────
{
  const at = {};
  for (const z of ['UTC', 'Asia/Seoul', 'America/New_York']) {
    CH.setZone(z);
    at[z] = CH.fmtFull(T);
    chk(CH.parseDT(CH.fmtFull(T).replace(' ', 'T')) === T, z + ' — 표시 글자 ↔ 에포크 왕복 일치', at[z]);
  }
  chk(at.UTC === '2026-09-28 05:03:07.123' && at['Asia/Seoul'] === '2026-09-28 14:03:07.123' && at['America/New_York'] === '2026-09-28 01:03:07.123',
    '같은 순간을 시간대마다 다르게 표시', JSON.stringify(at));
  CH.setZone('Asia/Seoul');
  chk(CH.fmtFull(CH.startOfDay(T)) === '2026-09-28 00:00:00.000' && CH.offsetLabel(T) === 'UTC+09:00', '하루 시작·오프셋 표기(서울)');
  CH.setZone('America/New_York');
  const d1 = CH.parseDT('2026-03-08T01:30'), d2 = CH.parseDT('2026-03-08T03:30');
  chk(new Date(d1).toISOString() === '2026-03-08T06:30:00.000Z' && new Date(d2).toISOString() === '2026-03-08T07:30:00.000Z',
    '서머타임 시작 전후(EST −5 → EDT −4)', new Date(d1).toISOString() + ' / ' + new Date(d2).toISOString());
  const n1 = CH.parseDT('2026-11-01T03:30');
  chk(new Date(n1).toISOString() === '2026-11-01T08:30:00.000Z', '서머타임 종료 후(EST −5)');
  chk(CH.fmtTick(T, 3600000) === '01:03', '차트 눈금도 시간대를 따름', CH.fmtTick(T, 3600000));
  CH.setZone('Nowhere/Bogus');
  chk(CH.getZone() === '', '모르는 시간대 이름은 브라우저 시간으로');
  CH.setZone('');
}

// ── 앱: 적용·전환·설정 화면 ─────────────────────────────────────────────
function mkApp() {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (s) { Object.assign(this.state, s); };
  app._toast = function () {};
  app.E = CH;
  return app;
}
{
  const app = mkApp();
  CH.setZone('UTC');
  app.state.from = '2026-09-28T05:03'; app.state.to = '2026-09-28T06:03';
  const f0 = CH.parseDT(app.state.from), t0 = CH.parseDT(app.state.to);
  app._applied = Object.assign({}, app.state, { displayTz: 'Asia/Seoul' });
  app._applyZone();
  chk(CH.getZone() === 'Asia/Seoul', '적용된 설정(저장본)의 시간대로 전환');
  chk(app.state.from === '2026-09-28T14:03' && CH.parseDT(app.state.from) === f0 && CH.parseDT(app.state.to) === t0,
    '전환 시 화면 기간 글자를 새 시간대로 다시 적어 같은 순간 유지', app.state.from + ' ~ ' + app.state.to);

  CH.setZone('America/New_York');
  const off = Math.round(CH.offsetMs(Date.now()) / 60000);
  const tql = Monitor.buildMonitorTql({ judgeSrc: judgeTick.toString(), tblPrefix: 'P.', keyPrefix: 'JOY:', tags: [], cfg: {}, tzOffsetMin: off });
  const i = tql.indexOf('function fmtShow');
  const fmtShow = new Function(tql.slice(i, tql.indexOf('\n', i)) + '\nreturn fmtShow;')();
  chk(fmtShow(T) === CH.fmtFull(T).slice(0, 19), '서버 알림 문구 시각 = 구울 때의 표시 시간대 오프셋', fmtShow(T));
  const appSrc = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/tzOffsetMin: Math\.round\(CH\.offsetMs\(Date\.now\(\)\) \/ 60000\)/.test(appSrc), '감시 스펙에 표시 시간대 오프셋을 실음');
  chk(/CH\.startOfDay\(now\)/.test(appSrc), '"오늘" 이벤트 범위는 표시 시간대 0시부터');
  chk(!/Date\.parse\(|\.getHours\(\)|\.setHours\(/.test(appSrc), '앱에 브라우저 시간 직접 계산 없음');
  CH.setZone('');
}
{
  const app = mkApp();
  app.data = Mock.generateData(42, 6);
  app.live = true;
  Object.assign(app.state, { ready: true, tab: 'settings', srcSel: [...new Set(app.data.equipment.map((e) => e.table))] });
  app.state.displayTz = 'Asia/Tokyo';
  app._applied = Object.assign({}, app.state, { displayTz: '' });
  const base = {};
  app._vmSettings(base, app.data.equipment);
  chk(base.tzOptions[0].v === '' && base.tzOptions.some((o) => o.v === 'UTC') && base.tzOptions.some((o) => o.v === 'Asia/Seoul'),
    '설정 목록 — 브라우저 시간·UTC·IANA 시간대', base.tzOptions.length + '개');
  chk(base.tzValue === 'Asia/Tokyo' && /저장하면 적용됩니다/.test(base.tzNow), '저장 전에는 미리보기만(적용은 저장 후)', base.tzNow);
  const dbSrc = fs.readFileSync(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
  chk(/'source\.json': \['srcSel', 'displayTz'\]/.test(dbSrc), '설정 DB에 저장되는 키');
}
{
  const repSrc = fs.readFileSync(new URL('../../cgi-bin/report/report.js', import.meta.url), 'utf8');
  const appSrc = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/CH\.setZone\(R\.tz\)/.test(repSrc) && /tz: CH\.zoneName\(\)/.test(appSrc), '리포트 차트는 만든 시간대로 표시(여는 사람의 브라우저 시간 무관)');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
