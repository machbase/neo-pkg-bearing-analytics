/* judgeTick 상태머신 시나리오 검증 — 앱/서버 공통 규칙의 단일 출처.
 *
 * 확정은 **시간이 아니라 회차**로 센다. 판정 틱은 10초마다 돌지만 등급을 만드는 결함 패턴은
 * 추출 주기(기본 10분)로 갱신되므로, 틱을 세면 "2회차 연속"이 20초가 되어 뜻이 사라진다.
 * 그래서 rg와 함께 **그 값을 잰 시각(cyc)**을 받아 cyc가 바뀔 때만 회차를 센다.
 *
 * 2회차인 근거는 NASA IMS 실측이다(건전 7측정점 158일 · 결함 3):
 * 결함 셋 다 "첫 단발 → 긴 공백 → 연속 구간" 모양이고 첫 단발은 전부 헛것이었다.
 * 단발을 다 받으면 오탐 14.6건/월, 2회 연속만 받으면 5.3건/월이며 리드타임은 오히려 길어진다.
 */
globalThis.window = globalThis;
const { judgeTick } = await import('../src/app.js');

const S = 1000, M = 60 * S, H = 60 * M;
const CYC = 10 * M;                                      // 패턴 추출 주기(기본값)
const cfg = { escHold: M, recHold: 5 * M, reno: { 1: 0, 2: H, 3: 30 * M } }; // 계측용 홀드 + 주의끔/위험1h/심각30m
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } }

/* 회차 러너 — 등급 시퀀스를 한 회차에 하나씩 먹인다(cyc가 매번 바뀐다). */
function cycles(grades, c = cfg, breaches) {
  let st = null; const log = [];
  grades.forEach((rg, i) => {
    const t = i * CYC;
    const r = judgeTick(st, rg, (breaches && breaches[i]) || false, t, c, null, true, t);
    st = r.next;
    r.events.forEach((e) => log.push({ i, t, etype: e.etype, gi: e.gi, epMs: e.epMs }));
  });
  return { log, st };
}
const types = (l) => l.map((e) => e.etype).join();

// ── 1. 단발은 확정되지 않는다 ───────────────────────────────────────────
{
  const { log, st } = cycles([1, 0, 0]);
  check('단발: observe 1건뿐, threshold 없음', types(log) === 'observe' && st.g === 0);
}
{ // 한 회차씩 깜빡이면 영영 확정되지 않는다 — 실측에서 정상 베어링 오탐이 이 모양이었다
  const { log } = cycles([1, 0, 1, 0, 1, 0]);
  check('깜빡임: threshold 0건', log.filter((e) => e.etype === 'threshold').length === 0);
  check('깜빡임: 조짐은 매번 남는다', log.filter((e) => e.etype === 'observe').length === 3);
}

// ── 2. 2회차 연속이면 확정 ──────────────────────────────────────────────
{
  const { log } = cycles([1, 1, 1]);
  check('2회 연속: observe→threshold 순서', types(log) === 'observe,threshold');
  check('2회 연속: 확정은 두 번째 회차', log[1].i === 1 && log[1].gi === 1);
}
{ // 최초 관측이 이미 나빠도 즉시 확정하지 않는다 — 감시를 켜는 순간 전 태그가 한꺼번에 울린다
  const { log, st } = cycles([2]);
  check('최초 나쁨: observe만, 등급은 아직 0', types(log) === 'observe' && st.g === 0);
}

// ── 3. 회차는 패턴 측정 시각으로 센다(틱 수가 아니다) ──────────────────
{
  /* 같은 cyc로 여러 번 부르는 것이 실제 동작이다: 판정 틱 10초 · 패턴 10분이면 회차당 60번 불린다.
     틱을 세면 20초 만에 확정되어 "2회차 연속"이 무의미해진다. */
  let st = null; const log = [];
  for (let m = 0; m < 30; m++) {
    const cyc = Math.floor(m / 10) * CYC;                // 10분마다 새 회차
    for (let k = 0; k < 6; k++) {                        // 1분에 6틱(10초)
      const r = judgeTick(st, 1, false, m * M + k * 10 * S, cfg, null, true, cyc);
      st = r.next;
      r.events.forEach((e) => log.push({ m, etype: e.etype }));
    }
  }
  check('회차: 같은 cyc 반복은 회차로 안 센다', types(log) === 'observe,threshold');
  check('회차: 확정이 10분 뒤(20초 아님)', log[1].m >= 10 && log[1].m < 20);
}

// ── 4. 단계별 악화 ──────────────────────────────────────────────────────
{
  const { log } = cycles([1, 1, 2, 2, 3, 3]);
  check('단계 악화: threshold 3건 gi=1,2,3',
    log.filter((e) => e.etype === 'threshold').map((e) => e.gi).join() === '1,2,3');
  check('단계 악화: 조짐은 양호 이탈 때만 1건', log.filter((e) => e.etype === 'observe').length === 1);
}

// ── 5. 지속 재알림 — 시간 기준이라 회차와 무관하게 돈다 ────────────────
{
  const grades = [2, 2]; for (let i = 0; i < 14; i++) grades.push(2);   // 확정 후 140분
  const { log } = cycles(grades);
  const sus = log.filter((e) => e.etype === 'sustained');
  check('지속: 위험(1h)이 140분간 sustained 2건', sus.length === 2);
}
{
  const grades = [1, 1]; for (let i = 0; i < 20; i++) grades.push(1);
  const { log } = cycles(grades);
  check('지속: 재알림 끔(0)이면 sustained 0건', log.filter((e) => e.etype === 'sustained').length === 0);
}

// ── 6. 복귀도 2회차 연속 ────────────────────────────────────────────────
{
  const { log } = cycles([1, 1, 1, 0, 0]);
  const rec = log.filter((e) => e.etype === 'recovery');
  check('복귀: 2회 연속 정상에서 recovery 1건', rec.length === 1 && rec[0].i === 4);
  check('복귀: 에피소드 길이를 싣는다', rec.length && rec[0].epMs === 3 * CYC);
}
{
  /* 한 회차만 꺼졌다가 다시 켜지면 복귀가 나면 안 된다 — 실측에서 외륜이 452회차 연속 중
     한 번 꺼졌고, 그때 복귀가 나가면 "고쳐졌나?"로 읽힌다. */
  const { log } = cycles([1, 1, 1, 0, 1, 1, 0, 0]);
  check('복귀: 중간 1회차 꺼짐엔 recovery 없음', log.filter((e) => e.etype === 'recovery').length === 1);
  check('복귀: 재악화로 threshold가 늘지 않는다', log.filter((e) => e.etype === 'threshold').length === 1);
}

// ── 7. 완화(아직 나쁨) — 조용히 상태만 ─────────────────────────────────
{
  const { log, st } = cycles([3, 3, 2, 2]);
  check('완화: threshold는 심각 진입 1건뿐', log.filter((e) => e.etype === 'threshold').length === 1);
  check('완화: 상태는 위험(2)로 갱신', st.g === 2);
  check('완화: improve 1건', log.filter((e) => e.etype === 'improve').length === 1);
}

// ── 8. 베이스라인 — 상태만 추적, 이벤트는 내지 않는다 ──────────────────
{
  const { log, st } = cycles([0, 0, 0], cfg, [false, true, true]);
  check('베이스라인: 이벤트 0건', log.filter((e) => e.etype === 'baseline').length === 0);
  check('베이스라인: 이탈 상태는 남는다(근거표가 읽는다)', st.b === true);
}

// ── 9. 정지·두절이면 판정을 얼린다 ─────────────────────────────────────
{
  let st = null;
  const a = judgeTick(st, 1, false, 0, cfg, null, true, 0); st = a.next;
  const b = judgeTick(st, 1, false, CYC, cfg, null, true, CYC); st = b.next;   // 확정
  const c = judgeTick(st, 0, false, 2 * CYC, cfg, null, false, 2 * CYC);        // 정지
  check('동결: 정지 중에는 이벤트 없음', c.events.length === 0 && c.frozen === true);
  check('동결: 등급을 유지한다(복귀로 읽지 않음)', c.next.g === 1);
}

console.log(`\njudge state-machine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
