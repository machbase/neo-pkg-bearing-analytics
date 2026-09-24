/* 결함 패턴을 못 잰 틱 — 오프라인(Neo 불필요). npm run smoke에 포함.

   등급은 결함 패턴(원본 파형, 약 10분 주기)이 켠다. 잴 수 있는 태그인데 한 번 못 재면(조회 실패·표본 부족·
   첫 측정 전) 예전에는 "패턴 없음 = 양호"로 읽고 회차 식별자도 없어 판정 틱마다 새 회차로 셌다 —
   알람 중이던 태그가 두 틱(몇 초) 만에 거짓 "정상 복귀"로 확정되고, 다음 측정에서 다시 악화 알림이 나갔다.
   지금은 calc.patternRound가 "판정 보류"로 직전 등급·회차를 넘겨 전이를 막는다. 앱·서버가 같은 함수다. */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { buildMonitorTql, validateSpec } = (await import('../../cgi-bin/monitor/monitor.js')).default;
const { judgeTick, App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const CFG = { escHold: 0, recHold: 0, reno: {} };
const MIN = 60000, T0 = 1700000000000;

// ── 순수 함수 ──────────────────────────────────────────────────────────
{
  const prev = { g: 2, cyc: 100 };
  chk(JSON.stringify(VC.patternRound(null, true, prev, 0)) === '{"rg":2,"cyc":100,"miss":true}', '잴 수 있는데 결과가 없으면 직전 등급·회차를 넘긴다(보류)');
  chk(JSON.stringify(VC.patternRound(null, false, prev, 3)) === '{"rg":0,"cyc":null,"miss":false}', '애초에 못 재는 태그(회전수·기하 없음)는 예전처럼 0 — 보류가 아니다');
  chk(JSON.stringify(VC.patternRound({ on: true, at: 200 }, true, prev, 1)) === '{"rg":1,"cyc":200,"miss":false}', '측정 결과가 있으면 그대로 판정한다');
  chk(VC.patternRound(null, true, null, 2).rg === 0, '직전 상태가 없으면 보류해도 0(첫 관측)');
}

// ── 상태기로 재현: 알람 중(위험) 태그에서 측정이 빠진 틱들 ────────────────────
function alarmed() {   // 두 측정 회차 연속 위험 → 확정
  const a = judgeTick(null, 2, false, T0, CFG, null, true, T0);
  const b = judgeTick(a.next, 2, false, T0 + 10 * MIN, CFG, null, true, T0 + 10 * MIN);
  return b.next;
}
{
  // 예전 방식: 못 잰 틱 = 패턴 없음(0) + 회차 없음(null)
  let s = alarmed(), evs = [];
  for (let i = 1; i <= 3; i++) { const r = judgeTick(s, VC.patternGate(false, 0), false, T0 + 10 * MIN + i * 3000, CFG, null, true, null); evs = evs.concat(r.events); s = r.next; }
  chk(evs.some((e) => e.etype === 'recovery') && s.g === 0, '(재현) 예전 방식은 몇 초 만에 거짓 "정상 복귀"를 확정했다', evs.map((e) => e.etype).join(','));

  // 지금: patternRound로 보류
  s = alarmed(); evs = [];
  for (let i = 1; i <= 5; i++) {
    const pr = VC.patternRound(null, true, s, 0);
    const r = judgeTick(s, pr.rg, false, T0 + 10 * MIN + i * 3000, CFG, null, true, pr.cyc);
    evs = evs.concat(r.events); s = r.next;
  }
  chk(evs.length === 0 && s.g === 2, '못 잰 틱이 이어져도 알림 없이 위험 등급을 유지한다', 'events=' + evs.length + ' g=' + s.g);

  // 실제 측정이 돌아와 패턴이 없다고 두 회차 연속 나오면 그때 복귀한다
  const m1 = T0 + 20 * MIN, m2 = T0 + 30 * MIN;
  let r = judgeTick(s, VC.patternRound({ on: false, at: m1 }, true, s, 0).rg, false, m1, CFG, null, true, m1);
  const e1 = r.events.map((e) => e.etype); s = r.next;
  r = judgeTick(s, VC.patternRound({ on: false, at: m1 }, true, s, 0).rg, false, m1 + 3000, CFG, null, true, m1);   // 같은 측정 재사용
  const e2 = r.events.map((e) => e.etype); s = r.next;
  r = judgeTick(s, VC.patternRound({ on: false, at: m2 }, true, s, 0).rg, false, m2, CFG, null, true, m2);
  const e3 = r.events.map((e) => e.etype); s = r.next;
  chk(!e1.includes('recovery') && !e2.includes('recovery') && e3.includes('recovery') && s.g === 0,
    '진짜 복귀는 패턴 없음 측정이 두 회차 연속일 때만(같은 측정 재사용은 세지 않는다)', [e1, e2, e3].map((x) => x.join('|') || '-').join(' / '));
}

// ── 서버 임베드 ─────────────────────────────────────────────────────────
{
  let out = null, err = '';
  try { out = new Function(VC.patSrc() + '\nreturn patternRound(null, true, { g: 3, cyc: 7 }, 0);')(); } catch (e) { err = e.message; }
  chk(!err && out && out.rg === 3 && out.cyc === 7 && out.miss === true, '서버 임베드(patSrc)에서 격리 실행 — 자유 식별자 없음', err || JSON.stringify(out));
  const spec = { judgeSrc: judgeTick.toString(), patSrc: VC.patSrc(), isoSrc: VC.isoSrc(),
    tags: [{ tbl: 'T', tag: 'A', zones: [1.12, 2.8, 7.1], fs: 25600, rpm: 1800, geo: { n: 9, Bd: 9.5, Pd: 46 }, bl: null, bb: null }],
    cfg: CFG };
  const tql = buildMonitorTql(spec);
  chk(validateSpec(spec) === null, '사전 실행 검사 통과');
  chk(tql.includes('var _pr = patternRound(_pv, !!(t.rpm && t.geo && t.geo.n), prev, _hG);') && tql.includes('judgeTick(prev,rg,breach,now,CFG,bj,run,_pr.cyc)'),
    '서버 판정도 같은 함수로 등급 후보·회차를 정한다');
}

// ── 화면 — 보류 사유 ─────────────────────────────────────────────────────
{
  const app = new App({ seed: 7, equipmentCount: 3 });
  const eq = { table: 'T', name: 'A' };
  app._gradeState = { 'T:A': { gi: 2, patOk: false, patMiss: true, patWait: false } };
  const h1 = app._holdOf(eq);
  app._gradeState['T:A'].patWait = true;
  const h2 = app._holdOf(eq);
  app._gradeState['T:A'] = { gi: 0, patOk: false, patMiss: false };
  const h3 = app._holdOf(eq);
  chk(h1 && h1.kind === 'patmiss' && /측정 실패/.test(h1.label), '측정 실패는 "결함 패턴 측정 실패" 보류로 보인다', h1 && h1.label);
  chk(h2 && /첫 측정 대기/.test(h2.label), '첫 측정 전은 "첫 측정 대기"', h2 && h2.label);
  chk(h3 && h3.kind === 'nojudge', '애초에 못 재는 태그는 예전처럼 "판정 못 함"', h3 && h3.label);
  chk(app._patCapable({ rpm: 1800, bearing: { n: 9 } }) && !app._patCapable({ rpm: 0, bearing: { n: 9 } }) && !app._patCapable({ rpm: 1800, bearing: null }),
    '잴 수 있는 태그 = 회전수와 구름체 기하가 둘 다 있음(monPattern과 같은 조건)');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
