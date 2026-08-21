// judgeTick 상태머신 시나리오 검증 — 앱/서버 공통 규칙의 단일 출처
globalThis.window = globalThis;
const { judgeTick } = await import('../src/app.js');

const S = 1000, M = 60 * S, H = 60 * M;
const cfg = { escHold: 30 * S, recHold: 5 * M, reno: { 1: 0, 2: H, 3: 30 * M } }; // 주의끔/위험1h/심각30m
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } }

// 시퀀스 러너 — [t(ms), rg, breach] 목록을 순서대로 먹여 events 로그 반환
function run(seq, c = cfg) {
  let st = null; const log = [];
  for (const [t, rg, breach] of seq) {
    const r = judgeTick(st, rg, breach || false, t, c);
    st = r.next;
    r.events.forEach(e => log.push({ t, etype: e.etype, gi: e.gi }));
  }
  return { log, st };
}
const types = l => l.map(e => e.etype);

// 1) 악화 즉시(진입확인 0) — 정상→위험
{
  const c = { ...cfg, escHold: 0 };
  const { log } = run([[0, 0], [10 * S, 2]], c);
  check('악화 즉시: threshold 1건 gi=2', log.length === 1 && log[0].etype === 'threshold' && log[0].gi === 2);
}

// 2) 악화 진입확인 30초 — 위험이 30초 미달이면 무음, 넘으면 알림
{
  const { log } = run([[0, 0], [10 * S, 2], [20 * S, 2], [45 * S, 2]]); // 후보 10s→45s = 35s 지속
  check('진입확인: 30초 지속 후 threshold 1건', types(log).join() === 'threshold' && log[0].t === 45 * S);
}
{
  const { log } = run([[0, 0], [10 * S, 2], [20 * S, 0]]); // 위험 잠깐 튀고 10s만에 정상 복귀 → 확정 안 됨
  check('진입확인: 순간 스파이크(<30초)는 무음', log.length === 0);
}

// 3) 단계별 악화 — 정상→주의→위험→심각 각각 알림 (escHold 0)
{
  const c = { ...cfg, escHold: 0 };
  const { log } = run([[0, 0], [S, 1], [2 * S, 2], [3 * S, 3]], c);
  check('단계 악화: threshold 3건 gi=1,2,3', types(log).join() === 'threshold,threshold,threshold' && log.map(e => e.gi).join() === '1,2,3');
}

// 4) 지속 재알림 — 위험 유지 시 1시간마다 sustained
{
  const c = { ...cfg, escHold: 0 };
  const seq = [[0, 0], [S, 2]]; // 위험 진입
  for (let t = 2; t <= 60 * 130; t += 60) seq.push([t * S, 2]); // 130분간 매 1분 tick
  const { log } = run(seq, c);
  const sus = log.filter(e => e.etype === 'sustained');
  check('지속: 위험 130분간 sustained 2건(1h,2h 경계)', sus.length === 2);
  check('지속: 첫 sustained ≈ 1시간 후', sus.length && Math.abs(sus[0].t - (S + H)) < 90 * S);
}
{ // 주의는 재알림 끔(0) → sustained 없음
  const c = { ...cfg, escHold: 0 };
  const seq = [[0, 0], [S, 1]];
  for (let t = 2; t <= 60 * 200; t += 60) seq.push([t * S, 1]);
  const { log } = run(seq, c);
  check('지속: 주의(끔)는 sustained 0건', log.filter(e => e.etype === 'sustained').length === 0);
}

// 5) 정상 복귀 디바운스 — 위험→정상, 5분 유지돼야 recovery
{
  const c = { ...cfg, escHold: 0 };
  // 위험 진입 → 정상 후 5분 미만에서 tick → 5분 넘겨 tick
  const { log } = run([[0, 0], [S, 2], [10 * S, 0], [4 * M, 0], [6 * M, 0]], c);
  const rec = log.filter(e => e.etype === 'recovery');
  check('복귀: 정상 5분 유지 후 recovery 1건', rec.length === 1 && rec[0].t === 6 * M);
}
{ // 플래핑 — 정상 잠깐 갔다 다시 위험 → recovery 안 나감
  const c = { ...cfg, escHold: 0 };
  const { log } = run([[0, 0], [S, 2], [10 * S, 0], [2 * M, 2], [3 * M, 2]], c);
  check('복귀: 정상<5분 후 재악화 → recovery 0건', log.filter(e => e.etype === 'recovery').length === 0);
  check('복귀: 플래핑 재악화는 threshold도 추가 안 됨(위험 유지)', log.filter(e => e.etype === 'threshold').length === 1);
}

// 6) 완화(아직 나쁨) — 심각→위험은 조용히(알림 없음), 상태는 위험으로
{
  const c = { ...cfg, escHold: 0, recHold: 0 };
  const { log, st } = run([[0, 0], [S, 3], [2 * S, 2]], c);
  check('완화: 심각→위험 알림 없음(threshold 1건=심각 진입만)', log.filter(e => e.etype === 'threshold').length === 1);
  check('완화: 상태는 위험(2)로 갱신', st.g === 2);
}

// 7) 베이스라인 이탈 — 상태는 추적하되 이벤트는 내지 않는다(이벤트는 10분 패턴 축 전용)
{
  const c = { ...cfg, escHold: 0 };
  const { log, st } = run([[0, 0, false], [S, 0, true], [2 * S, 0, true]], c);
  check('베이스라인: 이벤트 0건', log.filter(e => e.etype === 'baseline').length === 0);
  check('베이스라인: 이탈 상태는 남는다(근거표가 읽는다)', st.b === true);
}

// 8) 최초 관측이 이미 나쁨 — 즉시 기록
{
  const { log } = run([[0, 2]]);
  check('최초 나쁨: threshold 즉시 1건', log.length === 1 && log[0].etype === 'threshold' && log[0].gi === 2);
}

console.log(`\njudge state-machine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
