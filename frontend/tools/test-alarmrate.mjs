/* 알람 발생률 — 폭주 조건(스파이크·한계 근처 진동·지속 이탈·단조 상승)을 결정론적으로 재현해 이벤트 건수 고정
   · 앱·서버가 공유하는 실제 judgeTick 호출(재구현 금지)
   · 구간 RMS(windowRms) 합산·미완성 버킷 제외
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const ZONES = [1.12, 2.80, 7.10];      // ISO Class II
const BL = { mu: 1.5826, sigma: 0.0022, k: 3 }; // 산포가 작은 베이스라인 — ×1.2 클램프가 한계를 정함
const LIM = VC.baselineLimit(BL);
const IV = 10000;                       // 평가 주기 10초(기본)

chk(Math.abs(LIM - BL.mu * 1.2) < 1e-9, '산포가 작으면 한계는 μ×1.2 클램프가 결정', LIM.toFixed(4));

/* 판정값 산출 — winMs=0이면 최신 표본 하나, >0이면 그 창의 제곱평균(RMS는 제곱으로 합쳐야 같은 양) */
function evalAt(vals, i, winMs) {
  if (!winMs) return vals[i];
  const k = Math.max(1, Math.round(winMs / 1000));
  let ss = 0, n = 0;
  for (let j = i; j >= 0 && j > i - k; j--) { ss += vals[j] * vals[j]; n++; }
  return Math.sqrt(ss / n);
}

// 1초 간격 값 계열을 10초마다 판정(서버·앱과 같은 샘플링)
/* cycMs = 등급 입력(결함 패턴) 갱신 주기(판정 틱보다 훨씬 느림)
   · 확정은 시간 홀드가 아닌 회차로 세므로 스파이크 방어의 핵심 */
function run(vals, { escHold = 0, recHold = 300000, winMs = 0, cycMs = IV } = {}) {
  const cfg = { escHold, recHold, reno: { 1: 0, 2: 3600000, 3: 1800000 } };
  let prev = null, out = {};
  for (let i = 0; i < vals.length; i += IV / 1000) {
    const t = i * 1000;
    const v = evalAt(vals, i, winMs);
    const r = judgeTick(prev, VC.gradeFor(v, ZONES), v > LIM, t, cfg, null, true, Math.floor(t / cycMs) * cycMs);
    r.events.forEach((e) => { out[e.etype] = (out[e.etype] || 0) + 1; });
    /* 베이스라인은 이벤트를 안 내므로 상태 온셋을 셈(재무장 히스테리시스는 유지) */
    if (r.next.b && !(prev && prev.b)) out.baseline = (out.baseline || 0) + 1;
    prev = r.next;
  }
  return out;
}

const H = 3600; // 1시간 = 3600초 표본

// ① 존 경계 위로 짧게 튀었다 내려옴(시간의 25%)
const spikes = Array.from({ length: H }, (_, i) => (i % 12 < 3 ? 2.95 : 2.38));
// ② 베이스라인 한계 바로 위를 오르내림
const hover = Array.from({ length: H }, (_, i) => (i % 40 < 15 ? LIM * 1.05 : LIM * 0.98));
// ③ 진짜 지속 이탈 — 억제되면 안 됨
const real = Array.from({ length: H }, (_, i) => (i < 600 ? 2.38 : 2.95));
// ④ 단조 상승 — 존마다 1건씩
const ramp = Array.from({ length: H }, (_, i) => 0.9 + (i / H) * 7.0);

console.log('\n■ 현재 규칙(escHold 0 · 판정값 1초) — baseline은 이벤트가 아닌 상태 온셋 집계');
const cur = {
  '① 짧은 스파이크(경계 위 25%)': run(spikes),
  '② 베이스라인 한계 근처 진동': run(hover),
  '③ 진짜 지속 이탈': run(real),
  '④ 단조 상승': run(ramp),
};
for (const [k, v] of Object.entries(cur)) console.log('  %s → %s', k.padEnd(30), JSON.stringify(v));

/* 존 전이 스파이크 — 회차(cycMs)가 방어선
   · 10분 회차면 확정 안 됨, 회차를 판정 주기와 같게 두면 그대로 확정 */
{
  const slow = run(spikes, { cycMs: 600000 });   // 실제 감시와 같게 등급 입력을 10분마다 갱신
  chk((slow.threshold || 0) <= 1, '① 회차가 10분이면 초 단위 스파이크는 확정으로 안 간다', 'threshold ' + (slow.threshold || 0));
  chk((cur['① 짧은 스파이크(경계 위 25%)'].threshold || 0) > 10,
    '① 회차를 판정 주기와 같게 두면 스파이크가 그대로 확정된다 — 회차가 방어선임을 못 박는다',
    'threshold ' + cur['① 짧은 스파이크(경계 위 25%)'].threshold);
}
chk((cur['② 베이스라인 한계 근처 진동'].baseline || 0) <= 2,
  '② 베이스라인도 재무장에 recHold를 요구 — 한계 근처 진동에 1건(온셋)', 'baseline ' + cur['② 베이스라인 한계 근처 진동'].baseline);
// 주의 확정 1건 + 위험 승격 1건 = 2건
chk((cur['③ 진짜 지속 이탈'].threshold || 0) === 2, '③ 진짜 이탈: 주의 확정 + 위험 승격 = 2건', 'threshold ' + cur['③ 진짜 지속 이탈'].threshold);
chk((cur['③ 진짜 지속 이탈'].observe || 0) === 1, '③ 진짜 이탈: 조짐은 양호 이탈 때 1건', 'observe ' + cur['③ 진짜 지속 이탈'].observe);
chk((cur['③ 진짜 지속 이탈'].baseline || 0) === 1, '③ 진짜 이탈의 베이스라인 온셋은 1건(억제되지 않음)', 'baseline ' + cur['③ 진짜 지속 이탈'].baseline);
chk((cur['④ 단조 상승'].threshold || 0) === 3, '④ 단조 상승은 존마다 1건씩 3건', 'threshold ' + cur['④ 단조 상승'].threshold);

/* 베이스라인 재무장(recHold) 즉시 — 한계 근처 진동이 매번 새 이탈로 폭주(사용자가 '즉시' 선택 가능) */
{
  const b = run(hover, { recHold: 0 }).baseline || 0;
  console.log('  베이스라인 재무장을 즉시로 내리면 — 한계 근처 진동 온셋 ' + b + '건');
  // 베이스라인 이탈은 10초 축·시간 기준이라 recHold가 유일한 방어선
  chk(b > 50, '베이스라인 재무장이 유일한 방어선 — 즉시로 내리면 폭주', String(b));
}

/* 재무장 대기 중 재이탈 — 중복 온셋 없음(해제 후보 취소 경로)
   · recHold보다 빠르게 오가면 이탈 유지, 온셋은 처음 1건 */
{
  const cfg = { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 0, 3: 0 } };
  let prev = null, n = 0;
  for (let i = 0; i < 200; i++) {
    const r = judgeTick(prev, 1, i % 4 < 2, i * 10000, cfg, null);
    if (r.next.b && !(prev && prev.b)) n++;
    prev = r.next;
  }
  chk(n === 1, '재무장 대기 중 재이탈은 중복 온셋 없음', n + '건');
  chk(prev.b === true, '오가는 동안 이탈 상태 유지', 'b=' + prev.b);
}

// recHold 넘게 정상이면 재무장 — 다음 이탈 온셋 잡힘(영구 억제 금지)
{
  const cfg = { escHold: 0, recHold: 60000, reno: { 1: 0, 2: 0, 3: 0 } };
  let prev = null, n = 0;
  // 이탈 → 3분 정상 → 재이탈
  [[0, true], [10000, true], [20000, false], [200000, false], [210000, true]].forEach(([t, br]) => {
    const r = judgeTick(prev, 1, br, t, cfg, null);
    if (r.next.b && !(prev && prev.b)) n++;
    prev = r.next;
  });
  chk(n === 2, 'recHold 넘게 정상이면 재무장 — 다음 이탈 온셋이 잡힌다', n + '건');
}

// ── 구간 RMS ───────────────────────────────────────────────────────────────
/* 판정값 = RMS 구간 전체 실효값 — 버킷을 제곱으로 합쳐 원본 √(Σx²/N)과 일치
   · 구간 끝 적재 중 버킷은 판정에서 제외 */
{
  const mk = (rms, cnt) => ({ rms, cnt });
  // 원본 직접 계산과 일치 확인 — SUMSQ 복원 비교
  const B = [mk(2.0, 1000), mk(3.0, 1000), mk(4.0, 1000)];
  const direct = Math.sqrt(B.reduce((a, b) => a + b.rms * b.rms * b.cnt, 0) / 3000);
  const wr = VC.windowRms(B);
  chk(Math.abs(wr.rms - direct) < 1e-12, '구간 RMS == 원본 직접 계산', wr.rms.toFixed(10));
  chk(wr.n === 3000 && wr.used === 3, '전 버킷 사용 · N 합산', `n=${wr.n} used=${wr.used}`);
  // 산술평균과 달라야 함(같으면 제곱 합산 누락)
  const arith = B.reduce((a, b) => a + b.rms, 0) / 3;
  chk(Math.abs(wr.rms - arith) > 0.05, '산술평균과 구분됨(제곱으로 합침)', `RMS ${wr.rms.toFixed(4)} vs 산술 ${arith.toFixed(4)}`);

  // 버킷 크기 불균등 — cnt 가중(큰 버킷이 더 기여)
  const uneven = [mk(1.0, 100), mk(5.0, 900)];
  const uw = VC.windowRms(uneven, 0);
  const trueU = Math.sqrt((1 * 100 + 25 * 900) / 1000);
  chk(Math.abs(uw.rms - trueU) < 1e-12, '버킷 크기 불균등도 cnt 가중으로 정확', uw.rms.toFixed(6));

  // 미완성 버킷 제외 — 마지막 버킷 cnt가 중앙값의 90% 미만이면 제외
  const withPartial = [mk(2.0, 1000), mk(2.0, 1000), mk(9.9, 300)];
  const p = VC.windowRms(withPartial);
  chk(p.used === 2 && p.dropped === 1, '미완성 버킷 제외', `used=${p.used} dropped=${p.dropped}`);
  chk(Math.abs(p.rms - 2.0) < 1e-12, '제외 후 값이 오염되지 않음', p.rms.toFixed(6));
  chk(VC.windowRms(withPartial, 0).used === 3, 'minCntRatio 0이면 전부 사용(비교용)');

  chk(VC.windowRms([]) === null && VC.windowRms(null) === null, '빈 입력은 null');
  chk(VC.windowRms([mk(NaN, 1000)]) === null, '값이 NaN인 버킷만 있으면 null');

  // 스무딩은 구간이 결정(step 무관) — step만 바꿔도 같은 판정값
  const sig = Array.from({ length: 120 }, (_, i) => (i % 10 < 5 ? 4.0 : 0.8));
  const winAt = (i, w) => VC.windowRms(sig.slice(Math.max(0, i - w + 1), i + 1).map((v) => mk(v, 1000)), 0).rms;
  const at = (step) => { const out = []; for (let i = 9; i < sig.length; i += step) out.push(winAt(i, 10).toFixed(6)); return out; };
  const s1 = at(1), s5 = at(5);
  chk(s5.every((v) => s1.indexOf(v) >= 0), '구간 10 고정 시 step을 바꿔도 같은 판정값 집합', `step1 ${new Set(s1).size}종 / step5 ${new Set(s5).size}종`);
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
