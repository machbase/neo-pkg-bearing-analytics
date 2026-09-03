/* 알람 발생률 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.
   실데이터로는 측정할 수 없다: 조용한 기간엔 아무 일도 안 일어나고, 시끄러웠던 기간의
   원본은 재생성으로 사라졌으며, 쌓인 이벤트는 여러 버전 코드가 만든 것이다.
   그래서 알람이 폭주하는 조건을 결정론적으로 재현해 현재 규칙이 무엇을 내는지 고정한다.
   판정은 앱·서버가 공유하는 실제 judgeTick을 그대로 호출한다(재구현하면 결과가 갈린다). */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const ZONES = [1.12, 2.80, 7.10];      // ISO Class II
const BL = { mu: 1.5826, sigma: 0.0022, k: 3 }; // 실측 SENSOR_NORMAL — 산포가 작아 ×1.2 클램프가 한계를 정한다
const LIM = VC.baselineLimit(BL);
const IV = 10000;                       // 평가 주기 10초(기본)

chk(Math.abs(LIM - BL.mu * 1.2) < 1e-9, '산포가 작으면 한계는 μ×1.2 클램프가 결정', LIM.toFixed(4));

/* 판정값 산출 — winMs=0이면 최신 표본 하나(현재 동작), >0이면 그 창의 제곱평균.
   RMS를 제곱으로 합치면 창을 넓힌 RMS와 같은 값이다(산술평균은 다른 양이 된다). */
function evalAt(vals, i, winMs) {
  if (!winMs) return vals[i];
  const k = Math.max(1, Math.round(winMs / 1000));
  let ss = 0, n = 0;
  for (let j = i; j >= 0 && j > i - k; j--) { ss += vals[j] * vals[j]; n++; }
  return Math.sqrt(ss / n);
}

// 1초 간격 값 계열을 10초마다 판정 — 서버·앱이 실제로 하는 것과 같은 샘플링
/* cycMs = 등급 입력(결함 패턴)이 갱신되는 주기. 판정 틱보다 훨씬 느리다(실제 기본 10분).
   확정을 막는 것은 시간 홀드가 아니라 **회차**이므로, 이 값이 스파이크 방어의 핵심이다. */
function run(vals, { escHold = 0, recHold = 300000, winMs = 0, cycMs = IV } = {}) {
  const cfg = { escHold, recHold, reno: { 1: 0, 2: 3600000, 3: 1800000 } };
  let prev = null, out = {};
  for (let i = 0; i < vals.length; i += IV / 1000) {
    const t = i * 1000;
    const v = evalAt(vals, i, winMs);
    const r = judgeTick(prev, VC.gradeFor(v, ZONES), v > LIM, t, cfg, null, true, Math.floor(t / cycMs) * cycMs);
    r.events.forEach((e) => { out[e.etype] = (out[e.etype] || 0) + 1; });
    /* 베이스라인은 이벤트를 내지 않으므로(이벤트는 10분 패턴 축 전용) 상태 온셋을 센다 —
       재무장 히스테리시스는 그대로 살아 있고, 근거표·카드가 그 상태를 읽는다. */
    if (r.next.b && !(prev && prev.b)) out.baseline = (out.baseline || 0) + 1;
    prev = r.next;
  }
  return out;
}

const H = 3600; // 1시간 = 3600초 표본

// ① 관측된 패턴: 존 경계 위로 짧게 튀었다 내려온다(실측 중앙 1초·최대 8초, 시간의 25%)
const spikes = Array.from({ length: H }, (_, i) => (i % 12 < 3 ? 2.95 : 2.38));
// ② 베이스라인 한계 바로 위를 오르내린다(실측 초과배수 1.002~1.23)
const hover = Array.from({ length: H }, (_, i) => (i % 40 < 15 ? LIM * 1.05 : LIM * 0.98));
// ③ 진짜 지속 이탈 — 반드시 1건만 나와야 한다(억제되면 안 됨)
const real = Array.from({ length: H }, (_, i) => (i < 600 ? 2.38 : 2.95));
// ④ 단조 상승 — 존을 하나씩 밟고 올라간다. 존마다 1건씩만
const ramp = Array.from({ length: H }, (_, i) => 0.9 + (i / H) * 7.0);

console.log('\n■ 현재 규칙(escHold 0 · 판정값 1초) — baseline은 이벤트가 아닌 상태 온셋 집계');
const cur = {
  '① 짧은 스파이크(경계 위 25%)': run(spikes),
  '② 베이스라인 한계 근처 진동': run(hover),
  '③ 진짜 지속 이탈': run(real),
  '④ 단조 상승': run(ramp),
};
for (const [k, v] of Object.entries(cur)) console.log('  %s → %s', k.padEnd(30), JSON.stringify(v));

// 현재 규칙이 실제로 폭주하는지 — 이게 확인 안 되면 고칠 근거가 없다
/* 존 전이는 recHold가 재무장을 막아 스파이크에 안 흔들린다 — 기본값 5분이면 1건.
   그 값을 30초 이하로 내리면 61건이 되므로, recHold가 유일한 방어선이라는 점을 함께 고정한다. */
{
  const slow = run(spikes, { cycMs: 600000 });   // 실제 감시와 같게 등급 입력을 10분마다 갱신
  chk((slow.threshold || 0) <= 1, '① 회차가 10분이면 초 단위 스파이크는 확정으로 안 간다', 'threshold ' + (slow.threshold || 0));
  chk((cur['① 짧은 스파이크(경계 위 25%)'].threshold || 0) > 10,
    '① 회차를 판정 주기와 같게 두면 스파이크가 그대로 확정된다 — 회차가 방어선임을 못 박는다',
    'threshold ' + cur['① 짧은 스파이크(경계 위 25%)'].threshold);
}
chk((cur['② 베이스라인 한계 근처 진동'].baseline || 0) <= 2,
  '② 베이스라인도 재무장에 recHold를 요구 — 한계 근처 진동에 1건(온셋)', 'baseline ' + cur['② 베이스라인 한계 근처 진동'].baseline);
// 초기 관측(등급 1)에서 1건 + 위험 승격에서 1건 = 2건이 정상이다
chk((cur['③ 진짜 지속 이탈'].threshold || 0) === 2, '③ 진짜 이탈: 주의 확정 + 위험 승격 = 2건', 'threshold ' + cur['③ 진짜 지속 이탈'].threshold);
chk((cur['③ 진짜 지속 이탈'].observe || 0) === 1, '③ 진짜 이탈: 조짐은 양호 이탈 때 1건', 'observe ' + cur['③ 진짜 지속 이탈'].observe);
chk((cur['③ 진짜 지속 이탈'].baseline || 0) === 1, '③ 진짜 이탈의 베이스라인 온셋은 1건(억제되지 않음)', 'baseline ' + cur['③ 진짜 지속 이탈'].baseline);
chk((cur['④ 단조 상승'].threshold || 0) === 3, '④ 단조 상승은 존마다 1건씩 3건', 'threshold ' + cur['④ 단조 상승'].threshold);

/* recHold를 0으로 두면 두 경로가 함께 폭주한다 — 이 설정이 유일한 방어선임을 못 박는다.
   recHoldOptions에 '즉시'가 있어 사용자가 고를 수 있으므로, 그 대가를 수치로 남긴다. */
{
  const b = run(hover, { recHold: 0 }).baseline || 0;
  console.log('  베이스라인 재무장을 즉시로 내리면 — 한계 근처 진동 온셋 ' + b + '건');
  /* 등급 쪽 방어선은 회차로 옮겨갔지만, 베이스라인 이탈 상태는 여전히 10초 축·시간 기준이다.
     재무장(recHold)을 즉시로 내리면 한계 근처를 오가는 신호가 매번 새 이탈로 잡힌다. */
  chk(b > 50, '베이스라인 재무장이 유일한 방어선 — 즉시로 내리면 폭주', String(b));
}

/* 재무장 대기 중 다시 이탈해도 중복 이벤트가 나지 않아야 한다(해제 후보가 취소되는 경로).
   한계 위/아래를 recHold보다 빠르게 오가면 이탈은 계속 유지되고 이벤트는 처음 1건뿐이다. */
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

// 이탈이 recHold 넘게 완전히 걷히면 재무장되어 다음 이탈이 정상적으로 잡혀야 한다(영구 억제 금지)
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
/* 판정값은 RMS 구간 전체의 실효값 하나다. SUMSQ가 이미 Σx²이므로 제곱으로 합치면
   원본에서 직접 √(Σx²/N)을 낸 것과 같다 — 산술평균으로 합치면 다른 양이 된다.
   그리고 구간 끝 버킷은 아직 적재 중이라(실측 875~901 / 정상 1000개) 판정에서 빼야 한다. */
{
  const mk = (rms, cnt) => ({ rms, cnt });
  // 원본 직접 계산과 일치하는지 — SUMSQ를 되살려 비교한다
  const B = [mk(2.0, 1000), mk(3.0, 1000), mk(4.0, 1000)];
  const direct = Math.sqrt(B.reduce((a, b) => a + b.rms * b.rms * b.cnt, 0) / 3000);
  const wr = VC.windowRms(B);
  chk(Math.abs(wr.rms - direct) < 1e-12, '구간 RMS == 원본 직접 계산', wr.rms.toFixed(10));
  chk(wr.n === 3000 && wr.used === 3, '전 버킷 사용 · N 합산', `n=${wr.n} used=${wr.used}`);
  // 산술평균과는 다른 양이어야 한다(같으면 제곱 합산이 안 된 것)
  const arith = B.reduce((a, b) => a + b.rms, 0) / 3;
  chk(Math.abs(wr.rms - arith) > 0.05, '산술평균과 구분됨(제곱으로 합침)', `RMS ${wr.rms.toFixed(4)} vs 산술 ${arith.toFixed(4)}`);

  // 버킷 크기가 달라도 cnt 가중으로 정확 — 큰 버킷이 더 기여해야 한다
  const uneven = [mk(1.0, 100), mk(5.0, 900)];
  const uw = VC.windowRms(uneven, 0);
  const trueU = Math.sqrt((1 * 100 + 25 * 900) / 1000);
  chk(Math.abs(uw.rms - trueU) < 1e-12, '버킷 크기 불균등도 cnt 가중으로 정확', uw.rms.toFixed(6));

  // 미완성 버킷 제외 — 마지막이 중앙값의 90% 미만이면 빠진다
  const withPartial = [mk(2.0, 1000), mk(2.0, 1000), mk(9.9, 300)];
  const p = VC.windowRms(withPartial);
  chk(p.used === 2 && p.dropped === 1, '미완성 버킷 제외', `used=${p.used} dropped=${p.dropped}`);
  chk(Math.abs(p.rms - 2.0) < 1e-12, '제외 후 값이 오염되지 않음', p.rms.toFixed(6));
  chk(VC.windowRms(withPartial, 0).used === 3, 'minCntRatio 0이면 전부 사용(비교용)');

  chk(VC.windowRms([]) === null && VC.windowRms(null) === null, '빈 입력은 null');
  chk(VC.windowRms([mk(NaN, 1000)]) === null, '값이 NaN인 버킷만 있으면 null');

  // 스무딩은 구간이 결정하고 step과 무관하다 — 같은 신호를 step만 바꿔 재도 판정값이 같아야 한다
  const sig = Array.from({ length: 120 }, (_, i) => (i % 10 < 5 ? 4.0 : 0.8));
  const winAt = (i, w) => VC.windowRms(sig.slice(Math.max(0, i - w + 1), i + 1).map((v) => mk(v, 1000)), 0).rms;
  const at = (step) => { const out = []; for (let i = 9; i < sig.length; i += step) out.push(winAt(i, 10).toFixed(6)); return out; };
  const s1 = at(1), s5 = at(5);
  chk(s5.every((v) => s1.indexOf(v) >= 0), '구간 10 고정 시 step을 바꿔도 같은 판정값 집합', `step1 ${new Set(s1).size}종 / step5 ${new Set(s5).size}종`);
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
