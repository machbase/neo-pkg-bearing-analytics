/* 서버 감시 ISO 캐시 TTL — isoAt는 실제로 잰 틱에만 찍혀 TTL마다 재측정되는지
   · 캐시 틱에도 찍으면 판정 주기 < TTL인 한 만료 불가 → ISO 값이 첫 측정에 고정되어 등급이 안 변함
   · 생성된 TQL에서 isoValue를 그대로 떼어내 실제 설정으로 실행(옮겨 적지 않음)
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Mon = (await import('../../cgi-bin/monitor/monitor.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const TICK = 10000, TTL = 30000, WIN = 1000, FS = 25600;
const tql = Mon.buildMonitorTql({
  judgeSrc: 'function(){return{next:{},events:[]}}', limitSrc: VC.baselineLimit.toString(),
  winSrc: VC.windowRms.toString(), bandSrc: VC.bandJudgeSrc(),
  runSrc: VC.isRunning.toString(), refSrc: VC.runRef.toString(), isoSrc: VC.isoSrc(),
  tickMs: TICK, isoTtlMs: TTL, isoWinMs: WIN,
  tags: [{ tbl: 'T', tag: 'A', fs: FS, zones: [1.12, 2.8, 7.1] }], cfg: {},
});

// 생성물에서 isoValue 본문만 추출 — 상수(TTL·창 길이)가 구워진 그대로
// near(베이스라인 쪽 알람 임박) 인자 유무 모두 매칭
const m = /function isoValue\(t, wide, prev, key(?:, near)?\)\{[\s\S]*?\n\}/.exec(tql);
chk(!!m, 'TQL에서 isoValue 추출');
if (!m) { console.log('\n=== FAIL ' + fail + '건 ==='); process.exit(1); }
chk(m[0].indexOf(String(TTL)) >= 0, 'TTL 상수가 소스에 구워져 있다', String(TTL));

/* 스텁 환경 — DB는 "지금 실제 ISO 값"을 내는 신호 반환 + 조회 횟수 집계
   · isoRms는 실제 함수(밴드패스 후 값까지 확인) */
let queries = 0, trueIso = 1.5, NOW = 0;
const env = {
  isoNeeded: VC.isoNeeded, isoRms: VC.isoRms,
  esc: String,
  dtms: (ms) => String(ms),
  LAST: { 'T:A': 0 },
  db: {
    query() {
      queries++;
      // 100 Hz 정현파 — RMS = 진폭/√2라 원하는 ISO 값을 정확히 생성
      const amp = trueIso * Math.SQRT2, n = FS;
      const rows = new Array(n);
      for (let i = 0; i < n; i++) rows[i] = [amp * Math.sin(2 * Math.PI * 100 * i / FS)];
      return { forEach: (fn) => rows.forEach(fn) };
    },
  },
};
/* WVAL = 감시기가 모은 초 버킷(지름길 isoSkippable의 상한)
   · 기본은 경계를 훌쩍 넘는 값(지름길 차단), 지름길 검사에서만 낮춤 */
const WVAL = { 'T:A': [{ rms: 99, cnt: FS }] };
// gateFromRaw·GRAW — isoValue가 받은 원본으로 계측 게이트도 실행(같은 샘플 재사용)
// srcOf — 데이터 표의 수식된 이름을 돌려주는 TQL 내부 헬퍼(여기선 표가 하나라 그대로 통과)
const mkIsoValue = (db) => new Function('isoNeeded', 'isoRms', 'isoSkippable', 'esc', 'dtms', 'LAST', 'WVAL', 'db', 'getNow', 'gateFromRaw', 'GRAW', 'impactEvidence', 'IMP', 'srcOf',
  'var now; ' + m[0] + '; return function(t,w,p,k,n){ now = getNow(); return isoValue(t,w,p,k,n); };'
)(env.isoNeeded, env.isoRms, VC.isoSkippable, env.esc, env.dtms, env.LAST, WVAL, db, () => NOW, VC.gateFromRaw, {}, VC.impactEvidence, {}, (t) => t);
const isoValue = mkIsoValue(env.db);

const TAG = { tbl: 'T', tag: 'A', fs: FS, zones: [1.12, 2.8, 7.1] };
const gradeOf = (v) => VC.gradeFor(v, TAG.zones);

// ── 10분 주행: 실제 ISO 1.5 → 3.5 상승(주의 → 위험) ─────────────────────────
{
  let prev = null;
  const seen = [];
  for (let t = 0; t <= 600000; t += TICK) {
    NOW = t;
    trueIso = 1.5 + 2.0 * (t / 600000);        // 선형 상승
    const wide = trueIso * 1.4;                // 전대역은 항상 ISO보다 큼(상한 성질)
    const r = isoValue(TAG, wide, prev, 'T:A', false);
    // 호출측과 동일 — fresh일 때만 시각 기록
    prev = r.fresh ? { iso: r.v, isoAt: NOW } : (prev || null);
    seen.push({ t, real: trueIso, judged: r.v, fresh: r.fresh });
  }
  const last = seen[seen.length - 1];
  const expected = Math.floor(600000 / TTL) + 1;   // TTL마다 한 번씩 재측정

  chk(queries >= expected - 2 && queries <= expected + 2,
    'TTL(30초)마다 재측정한다', queries + '회 (기대 ' + expected + '회 · 주기 10초로 61틱)');
  chk(Math.abs(last.judged - last.real) < 0.4,
    '10분 뒤 판정값이 실제값을 따라간다', '실제 ' + last.real.toFixed(2) + ' vs 판정 ' + last.judged.toFixed(2));
  chk(gradeOf(last.judged) === gradeOf(last.real),
    '등급이 실제와 일치한다', '실제 ' + gradeOf(last.real) + ' vs 판정 ' + gradeOf(last.judged));
  /* 동결되면 첫 값(1.5·주의)에 고정 — queries 1회·등급 1로 남음 */
  chk(queries > 5, '값이 첫 측정에 동결되지 않는다', queries + '회 측정');
}

/* 모의 유효성 — 잘못된 스탬프 규칙("전대역이 경계를 넘었나")으로 같은 주행 시 반드시 동결 재현 */
{
  queries = 0;
  let prev = null, lastV = 0;
  for (let t = 0; t <= 600000; t += TICK) {
    NOW = t;
    trueIso = 1.5 + 2.0 * (t / 600000);
    const wide = trueIso * 1.4;
    const r = isoValue(TAG, wide, prev, 'T:A', false);
    lastV = r.v;
    // 잘못된 규칙: 실제 측정 여부와 무관하게 경계를 넘으면 시각 재기록
    if (VC.isoNeeded(TAG.fs) && wide >= TAG.zones[0]) prev = { iso: r.v, isoAt: NOW };
    else if (prev) prev = { iso: prev.iso, isoAt: prev.isoAt };
  }
  chk(queries === 1, '모의 유효성: 옛 규칙은 한 번만 재고 만다', queries + '회');
  chk(Math.abs(lastV - 1.5) < 0.05 && gradeOf(lastV) === 1,
    '모의 유효성: 옛 규칙은 첫 값(주의)에 동결된다 — 실제는 3.50(위험)',
    '판정 ' + lastV.toFixed(2) + ' 등급 ' + gradeOf(lastV));
}

// ── 캐시 동작(매 틱 재측정 방지) ───────────────────────────────────────────
{
  queries = 0;
  let prev = null;
  NOW = 0; trueIso = 2.0;
  for (let i = 0; i < 3; i++) {                 // 30초 안에 3틱
    NOW = i * TICK;
    const r = isoValue(TAG, 2.8, prev, 'T:A', false);
    prev = r.fresh ? { iso: r.v, isoAt: NOW } : prev;
  }
  chk(queries === 1, 'TTL 안에서는 한 번만 측정한다 (조회 폭주 방지)', queries + '회');
}

// ── 계산을 건너뛴 경우는 캐시 제외 ─────────────────────────────────────────
{
  queries = 0;
  NOW = 0;
  /* 상한 = 구간 안 최대 초 버킷(평가창 값을 쓰면 마지막 1초 튐을 양호로 확정) */
  WVAL['T:A'] = [{ rms: 0.4, cnt: FS }, { rms: 0.5, cnt: FS }];
  const lowWide = isoValue(TAG, 0.5, null, 'T:A', false);       // 모든 초가 경계 미만 → 상한 성질로 확정
  chk(lowWide.v === 0.5 && lowWide.fresh === false, '전 구간이 경계 미만이면 전대역 값을 그대로, fresh=false', JSON.stringify(lowWide));
  chk(queries === 0, '전 구간이 경계 미만이면 원본을 조회하지 않는다', queries + '회');

  // 평가창 값은 경계 아래인데 한 초가 튄 경우 — 건너뛰면 위험을 놓침
  queries = 0;
  const spike = [];
  for (let i = 0; i < 9; i++) spike.push({ rms: 0.30, cnt: FS });
  spike.push({ rms: 3.0, cnt: FS });
  WVAL['T:A'] = spike;
  const wideOfSpike = VC.windowRms(spike).rms;
  chk(wideOfSpike < TAG.zones[0], '전제: 급상승이 섞여도 평가창 RMS는 양호 경계 아래', wideOfSpike.toFixed(4));
  isoValue(TAG, wideOfSpike, null, 'T:A');
  chk(queries === 1, '한 초라도 경계를 넘으면 건너뛰지 않는다(급상승을 삼키지 않는다)', queries + '회');
  WVAL['T:A'] = [{ rms: 99, cnt: FS }];
  queries = 0;

  const lowFs = isoValue({ tbl: 'T', tag: 'A', fs: 1000, zones: TAG.zones }, 5.0, null, 'T:A', false);
  chk(lowFs.v === 5.0 && lowFs.fresh === false, '1 kHz 태그는 대역제한 불필요 — 전대역 그대로, fresh=false', JSON.stringify(lowFs));
  chk(queries === 0, '대역제한 불필요면 조회하지 않는다', queries + '회');
}

// ── 조회 실패 시 폴백값은 캐시에 남지 않음 ──────────────────────────────────
{
  const broken = mkIsoValue({ query() { throw new Error('DB 오류'); } });
  NOW = 0;
  const r = broken(TAG, 3.0, null, 'T:A', false);
  chk(r.fresh === false, '조회 실패는 fresh=false — 폴백값이 캐시로 굳지 않는다', JSON.stringify(r));
  /* hold = "ISO를 못 쟀음" 신호 — 호출측이 등급을 직전 값으로 유지(전대역으로 갈아타면 부풀린 값으로 즉시 알람 가능) */
  chk(r.hold === true, '조회 실패는 hold=true — 호출측이 등급을 유지하도록', JSON.stringify(r));
  const shortWin = mkIsoValue({ query() { queries++; return { forEach: (fn) => [[1], [2], [3]].forEach(fn) }; } });
  const r2 = shortWin(TAG, 3.0, null, 'T:A');
  chk(r2.fresh === false && r2.hold === true, '1초 창 표본 부족(256개 미만)도 hold=true', JSON.stringify(r2));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
