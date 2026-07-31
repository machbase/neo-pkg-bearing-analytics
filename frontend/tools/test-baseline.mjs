// 베이스라인 로버스트화 단위 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.
// 핵심 주장: "학습 데이터가 오염돼도(스파이크·정지·램프) 한계가 거짓말하지 않는다"를 수치로 고정한다.
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── 1. 오염 내성: 스파이크 3/60개가 한계를 흔들지 못해야 한다 ──────────────
// (구식 평균/σ에서는 이 오염으로 한계가 ~3배 부풀어 실제 악화를 덮었다)
const clean = Array.from({ length: 60 }, (_, i) => 2 + 0.1 * Math.sin(i)); // 정상 2.0±0.1 (결정론)
const dirty = clean.slice(); dirty[10] = 10; dirty[30] = 10; dirty[50] = 10;

const fitC = VC.baselineFit(clean), fitD = VC.baselineFit(dirty);
const limC = VC.baselineLimit({ mu: fitC.mu, sigma: fitC.sigma, k: 3 });
const limD = VC.baselineLimit({ mu: fitD.mu, sigma: fitD.sigma, k: 3 });
const drift = Math.abs(limD - limC) / limC;
chk(drift < 0.10, '스파이크 3/60 오염에도 한계 변동 <10%',
  `깨끗 ${limC.toFixed(3)} vs 오염 ${limD.toFixed(3)} (변동 ${(drift * 100).toFixed(1)}%)`);

// 참고: 구식(평균/σ)이었다면 얼마나 부풀었는지 — 회귀가 아니라 "왜 바꿨나"의 기록
{
  const n = dirty.length, mean = dirty.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(dirty.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
  console.log('  (참고: 구식 평균/σ 한계 = ' + (mean + 3 * sd).toFixed(2) + ' — 정상 2.0의 '
    + ((mean + 3 * sd) / 2).toFixed(1) + '배까지 알람 침묵)');
}

// ── 2. 정상상태 게이트: 정지·램프 버킷이 걸러져야 한다 ────────────────────
// 시간순: 정지 10개 → 기동 램프 2개 → 정상 50개 → 정지 램프 1개 → 정지 5개
const seq = []
  .concat(Array.from({ length: 10 }, () => 0.05))
  .concat([0.9, 1.7])
  .concat(Array.from({ length: 50 }, (_, i) => 2 + 0.05 * Math.sin(i)))
  .concat([1.1])
  .concat(Array.from({ length: 5 }, () => 0.04));
const ss = VC.steadyStateFilter(seq);
chk(ss.idle >= 15, '정지 버킷 제외(≥15)', `idle=${ss.idle}`);
chk(ss.ramp >= 3, '과도(기동·정지 램프) 버킷 제외(≥3)', `ramp=${ss.ramp}`);
const fitSS = VC.baselineFit(ss.vals);
chk(fitSS && Math.abs(fitSS.mu - 2) < 0.1, '게이트 후 μ가 운전 수준(≈2.0)', fitSS && `μ=${fitSS.mu.toFixed(3)}`);
// 게이트 없이 통짜로 학습했다면 μ가 정지 구간에 끌려 내려간다 — 게이트의 존재 이유
const fitRaw = VC.baselineFit(seq);
chk(fitRaw.mu < fitSS.mu, '게이트 없으면 μ 왜곡 확인(비교군)', `통짜 μ=${fitRaw.mu.toFixed(3)}`);

// ── 3a. 표본 부족: 게이트가 정지를 걸러낸 뒤 남은 표본이 적으면 학습 거부(null) ──
// 운전 25 + 정지 20 — 운전이 다수라 P75 참조는 운전 수준을 가리키고, 정지 20개가 걸러진다
const shortRun = Array.from({ length: 25 }, (_, i) => 2 + 0.05 * Math.sin(i)).concat(Array.from({ length: 20 }, () => 0.05));
const ss2 = VC.steadyStateFilter(shortRun);
chk(ss2.idle >= 20 && VC.baselineFit(ss2.vals) === null, '정상상태 표본 부족 시 학습 거부', `잔여 ${ss2.vals.length}개`);

// ── 3b. 창 대부분이 정지인 극단: P75 참조가 정지 수준에 붙어 게이트가 무력화된다 ──
// → baselineFit의 이중 수준(bimodal) 플래그가 잡아야 한다 (app은 이 플래그로 학습을 거부)
const mostlyOff = Array.from({ length: 400 }, () => 0.05)
  .concat([0.9, 1.7])
  .concat(Array.from({ length: 60 }, (_, i) => 2 + 0.05 * Math.sin(i)));
const ss3 = VC.steadyStateFilter(mostlyOff);
chk(ss3.bimodal, '정지 87% 창 → 이중 수준 감지(학습 거부 신호)',
  `비율 ${(ss3.bimodalFrac * 100).toFixed(0)}% · 높이 ×${ss3.bimodalRatio.toFixed(0)}`);
// 반대로 정상 학습(오염 포함)에서는 이 플래그가 서지 않아야 한다 — 오탐이면 정상 학습까지 막는다
chk(!VC.steadyStateFilter(dirty).bimodal, '스파이크 5%로는 이중 수준 미발동(오탐 없음)');

/* ── 3c. 충격성 정상 신호 오탐 방지 (실데이터 회귀) ─────────────────────────
   BEARING:C1 실측 분포 — 중앙값의 3배 위에 16%가 몰리지만 상위군은 중앙값의 5.6배에 그친다.
   비율만 보던 초기 구현은 이걸 "정지↔운전"으로 오인해 학습을 거부했다(사용자 보고).
   구분 기준은 "얼마나 많이"가 아니라 "얼마나 위에"다. */
{
  const base = Array.from({ length: 170 }, (_, i) => 0.54 + 0.03 * Math.sin(i * 1.3)); // 운전 수준
  const imp = Array.from({ length: 37 }, (_, i) => 1.8 + 1.2 * Math.sin(i * 2.1));      // 충격 (중앙값의 3~6배)
  const impulsive = [];
  for (let i = 0; i < 207; i++) impulsive.push(i % 6 === 0 ? imp[(i / 6) | 0] || 2.4 : base[i % base.length]);
  const ssI = VC.steadyStateFilter(impulsive);
  chk(!ssI.bimodal, '충격성 정상 신호는 이중 수준 아님(BEARING:C1 유형)',
    `비율 ${(ssI.bimodalFrac * 100).toFixed(0)}% · 높이 ×${ssI.bimodalRatio.toFixed(1)} (임계 ×${VC.BL_BIMODAL_RATIO})`);
  chk(VC.baselineFit(ssI.vals) !== null, '충격성 정상 신호도 학습 성공', `잔여 ${ssI.vals.length}개`);
}

// ── 4. 클램프: 초안정 신호에서 한계는 최소 μ×1.2 ──────────────────────────
chk(VC.baselineLimit({ mu: 2, sigma: 0.001, k: 3 }) === 2.4, '초안정 신호 한계 클램프(μ×1.2)',
  `한계=${VC.baselineLimit({ mu: 2, sigma: 0.001, k: 3 })}`);
chk(Math.abs(VC.baselineLimit({ mu: 2, sigma: 0.5, k: 3 }) - 3.5) < 1e-9, '정상 산포에선 μ+kσ 그대로', '한계=3.5');

// ── 5. 기본 성질 ───────────────────────────────────────────────────────────
chk(VC.median([3, 1, 2]) === 2 && VC.median([1, 2, 3, 4]) === 2.5, 'median 홀/짝');
chk(VC.baselineLimit(null) === null, '미학습이면 null');
// k=3 의미 보존: 정규 잡음에서 로버스트 σ ≈ 표본 σ (1.4826 보정 확인)
{
  const norm = Array.from({ length: 500 }, (_, i) => 2 + 0.1 * Math.sin(i * 1.7) + 0.05 * Math.sin(i * 0.3));
  const f = VC.baselineFit(norm);
  const mean = norm.reduce((a, b) => a + b, 0) / norm.length;
  const sd = Math.sqrt(norm.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (norm.length - 1));
  chk(f.sigma > sd * 0.5 && f.sigma < sd * 2, '로버스트 σ가 표본 σ와 같은 자릿수(1.4826 보정)',
    `σᵣ=${f.sigma.toFixed(4)} vs σ=${sd.toFixed(4)}`);
}

// ── 6. 서버 감시 스크립트에 같은 한계식이 임베드되는가 ─────────────────────
const Monitor = (await import('../../cgi-bin/monitor/monitor.js')).VibeMonitor
  || (await import('../../cgi-bin/monitor/monitor.js')).default;
const tql = Monitor.buildMonitorTql({
  judgeSrc: 'function judgeTick(p,r,b,n,c){return {events:[],next:{}};}',
  limitSrc: VC.baselineLimit.toString(),
  tags: [{ tbl: 'T', tag: 'X', zones: [1, 2, 3], bl: { mu: 2, sigma: 0.001, k: 3 } }],
  dryRun: true,
});
chk(/var baselineLimit = function/.test(tql) && /Math\.max/.test(tql), '서버 TQL에 클램프 포함 한계식 임베드');
chk(/baselineLimit\(t\.bl\)/.test(tql), '서버 판정이 임베드된 한계식을 호출');

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
