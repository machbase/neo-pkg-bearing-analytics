/* 계정 권한 부여·회수·상태 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 회수 구문 = 부여의 역순(공용 표 → CREATE → CONNECT), 부여한 대상과 1:1
   · 상태 = 대상 5곳(DB·공용 표 4) 중 권한 기록 수 — 실제 기록 형태(_META 행 포함) 그대로 입력
   · 계정별 줄: 다 있으면 회수만·없으면 부여만·일부면 둘 다, 회수는 줄 안 확인 + 타이머 경고
   · 다시 읽기: 조회 중 요청은 끝난 뒤 한 번 더, 실패해도 목록 유지 */
globalThis.window = globalThis;
const sent = [];
let failUsers = false;
// 앱이 보내는 SQL 수집 — 권한 기록·타이머 조회는 빈 결과, failUsers면 계정 목록 조회 실패
globalThis.fetch = async (url) => {
  const m = /[?&]q=([^&]*)/.exec(String(url));
  const sql = m ? decodeURIComponent(m[1]) : '';
  if (m) sent.push(sql);
  if (failUsers && /M\$SYS_USERS/.test(sql)) return { ok: true, status: 200, json: async () => ({ success: false, reason: 'boom' }), text: async () => '' };
  return { ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' };
};

const DB = (await import('../../cgi-bin/db/db.js')).default;
const SQL = DB.SQL;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
DB.setUser('SYS');

// ── 1. 회수 구문 ──────────────────────────────────────────────────────
{
  const g = SQL.grantStatements('JOY'), r = SQL.revokeStatements('JOY');
  chk(r.length === 6 && r.every((s) => /^REVOKE .+ FROM JOY$/.test(s)), '회수 6문장 — 모두 FROM 계정', r.length);
  chk(/MONSTATE/.test(r[0]) && /CONNECT ON DATABASE/.test(r[5]) && /CREATE ON DATABASE/.test(r[4]), '역순 — 공용 표 먼저, CONNECT 마지막');
  const tgt = (s) => s.replace(/^(GRANT|REVOKE) /, '').replace(/ (TO|FROM) JOY$/, '');
  chk(JSON.stringify(g.map(tgt).sort()) === JSON.stringify(r.map(tgt).sort()), '부여한 권한·대상과 1:1 — 남는 권한 없음');
  chk(SQL.revokeStatements("x'; DROP").every((q) => !/[';]/.test(q.replace(/;$/, ''))), '계정명의 따옴표·세미콜론은 지워 구문 주입 불가');
}

// ── 2. 상태 요약 — 실제 권한 기록 형태 ─────────────────────────────────────
{
  const full = (u) => [[u, null], [u, 'BAND'], [u, 'BASELINE'], [u, 'EVENTS'], [u, 'MONSTATE'], [u, '_BAND_META'], [u, '_EVENTS_META']];
  const m = SQL.accessSummary(full('JOY').concat([['PART', null]]), [['JOY', 'NEO_BEARING_MONITOR_JOY'], ['JOY', 'NEO_BEARING_BAND_JOY']]);
  chk(m.JOY.n === 5 && m.JOY.total === 5, '부여 직후 기록 7행(_META 포함) → 5/5', JSON.stringify(m.JOY));
  chk(m.JOY.timers === 2, '이 패키지 타이머 수를 센다', m.JOY.timers);
  chk(m.PART.n === 1, '표 권한을 회수하고 DB 권한만 남으면 1/5', JSON.stringify(m.PART));
  chk(!m.TESTUSER, '기록이 없는 계정은 항목 없음(= 권한 없음)');
}

// ── 3. 계정별 줄 ──────────────────────────────────────────────────────
function mkApp(st) {
  const app = new App({ seed: 1, equipmentCount: 1 });
  app.setState = function (s) { Object.assign(this.state, s); };
  app._toast = () => {};
  app.E = CH; app.live = true;
  app.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  Object.assign(app.state, { ready: true, tab: 'settings', setSection: 'source', user: 'SYS',
    grantUsers: ['JOY', 'PART', 'TESTUSER'], grantStatus: st }, {});
  return app;
}
{
  const st = { JOY: { n: 5, total: 5, timers: 2 }, PART: { n: 1, total: 5, timers: 0 } };
  const app = mkApp(st);
  const rows = app.renderVals().grantRows;
  const by = (u) => rows.filter((r) => r.user === u)[0];
  chk(by('JOY').statusText === '권한 있음' && !by('JOY').canGrant && by('JOY').canRevoke, '다 있으면 회수만');
  chk(by('TESTUSER').statusText === '권한 없음' && by('TESTUSER').canGrant && !by('TESTUSER').canRevoke, '없으면 부여만');
  chk(/일부/.test(by('PART').statusText) && by('PART').canGrant && by('PART').canRevoke, '일부면 둘 다', by('PART').statusText);
  chk(by('JOY').timersText === '타이머 2개' && /매 회차 실패/.test(by('JOY').askText), '타이머가 있으면 회수 확인에 경고', by('JOY').askText);
  chk(/지우지 않으며/.test(by('TESTUSER').askText), '회수해도 데이터는 남는다고 알린다');
  by('JOY').onRevoke();
  chk(app.renderVals().grantRows.filter((r) => r.user === 'JOY')[0].ask, '회수 버튼은 바로 실행하지 않고 줄 안에서 확인');
  const unk = mkApp(null).renderVals().grantRows[0];
  chk(unk.statusText === '확인 불가' && unk.canGrant && unk.canRevoke, '상태를 못 읽으면 두 버튼 모두(재실행 무해)');
  chk(/-- 권한 회수/.test(app.renderVals().dbGrantSql) && /REVOKE CONNECT ON DATABASE/.test(app.renderVals().dbGrantSql)
    && /M\$SYS_USER_ACCESS/.test(app.renderVals().dbGrantSql), 'SQL 직접 하기에 회수·확인 구문');
}

// ── 4. 회수 실행 — 보내는 SQL 순서, 끝나면 상태 다시 읽기 ───────────────────
{
  const app = mkApp({ JOY: { n: 5, total: 5, timers: 0 } });
  sent.length = 0;
  app._grantRun('JOY', true);
  await new Promise((r) => setTimeout(r, 30));
  const rev = sent.filter((s) => /^REVOKE/.test(s));
  chk(rev.length === 6 && /MONSTATE/.test(rev[0]) && /CONNECT/.test(rev[5]), '회수 6문장을 역순으로 보낸다', rev.length);
  chk(sent.some((s) => /M\$SYS_USER_ACCESS/.test(s)), '끝나면 권한 상태를 다시 읽는다');
  chk(/회수했습니다/.test(app.state.grantMsg) && app.state.grantBusy === '', '결과 문구·처리 중 해제', app.state.grantMsg);
}

// ── 5. 다시 읽기 — 조회 중 요청은 끝난 뒤 한 번 더, 실패해도 목록 유지 ──────────────────
{
  const app = mkApp({ JOY: { n: 5, total: 5, timers: 0 } });
  sent.length = 0;
  app._loadGrantUsers(true); app._loadGrantUsers(true);   // 새로고침 중 부여·회수 직후 갱신 요청
  await new Promise((r) => setTimeout(r, 40));
  const nUsers = sent.filter((q) => /M\$SYS_USERS/.test(q)).length;
  chk(nUsers === 2, '조회 중 다시 읽기 요청을 버리지 않는다(끝난 뒤 한 번 더)', nUsers);
  const app2 = mkApp(null);
  app2.state.grantUsers = ['JOY']; app2.state.grantMsg = 'JOY 의 권한을 회수했습니다 (6건)';
  failUsers = true;
  app2._loadGrantUsers(true);
  await new Promise((r) => setTimeout(r, 30));
  failUsers = false;
  chk(app2.state.grantUsers.length === 1 && /회수했습니다/.test(app2.state.grantMsg) && /다시 읽지 못했습니다/.test(app2.state.grantMsg),
    '다시 읽기 실패 — 목록·직전 결과 문구 유지', app2.state.grantMsg);
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
