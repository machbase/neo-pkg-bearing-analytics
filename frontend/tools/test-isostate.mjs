/* 서버 감시 ISO 판정의 호출부 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   test-isottl.mjs가 isoValue 안쪽(캐시·TTL·건너뛰기)을 본다면, 여기는 그 결과를 받아
   쓰는 호출부 네 줄을 본다. 판정을 실제로 좌우하는 것이 그 네 줄이기 때문이다:
    · isoAt 스탬프 — "이번에 실제로 쟀는가"로만 찍어야 한다. 캐시에서 꺼낸 값에도 찍으면
      판정 주기가 TTL보다 짧은 한 만료가 구조적으로 불가능해져 ISO 값이 첫 측정에 고정된다.
    · hold 처리 — ISO를 못 쟀을 때 등급을 직전 값으로 유지한다. 전대역으로 갈아타면
      대역제한으로 없애려던 부풀린 값이 판정에 들어가고, escHold가 0이면 즉시 알람이 나간다.

   호출부도 생성된 TQL 원문에서 떼어내 실행한다 — 옮겨 적으면 생성기가 바뀌었을 때
   테스트만 통과하고 실물이 깨진다. 발췌가 실패하면 조용히 통과하지 않고 예외로 터진다. */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { judgeTick } = await import('../src/app.js');
const { buildMonitorTql } = (await import('../../cgi-bin/monitor/monitor.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const Z = [1.12, 2.80, 7.10];
const TTL = 30000, TICK = 10000, FS = 25600;   // 주기가 TTL보다 짧은 것이 동결의 성립 조건
const tql = buildMonitorTql({
  judgeSrc: judgeTick.toString(), isoSrc: VC.isoSrc(), isoTtlMs: TTL, isoWinMs: 1000, tickMs: TICK,
  tags: [{ tbl: 'T', tag: 'A', zones: Z, fs: FS, bl: null, bb: null }],
  cfg: { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 0, 3: 0 } },
});

// ── 생성 TQL에서 isoValue와 호출부 원문 발췌 ──────────────────────────────
const src = (() => {
  const s = tql.indexOf('function isoValue(');
  if (s < 0) throw new Error('isoValue 원문을 못 찾았다 — 생성기 구조가 바뀌었다');
  let d = 0;
  for (let i = tql.indexOf('{', s); i < tql.length; i++) {
    if (tql[i] === '{') d++;
    else if (tql[i] === '}' && !--d) return tql.slice(s, i + 1);
  }
  throw new Error('isoValue 괄호가 안 닫힌다');
})();
const line = (needle) => {
  const l = tql.split('\n').find((x) => x.includes(needle));
  if (!l) throw new Error('호출부 원문을 못 찾았다: ' + needle);
  return l.trim();
};
/* _lim0·_near는 계측 게이트 때문에 붙었다 — 베이스라인 쪽으로 알람이 날 상황이면 원본을 받아
   계측을 같이 확인한다(ISO 계산과 같은 샘플). 호출부를 떼어낼 때 이 줄들도 같이 와야 한다. */
/* rg는 이제 결함 패턴 게이트를 거친 값이라, 이 테스트가 보는 것은 그 앞의 ISO 등급(_isoG)이다.
   게이트 자체는 test-sevgrade가 잠근다 — 여기서는 ISO 계산·보류·TTL만 본다. */
const BODY = [src, line('var _lim0 = baselineLimit('), line('var _near ='),
  line('var _iso = isoValue('), line('var _hold ='), line('var val = _hold ?'),
  line('var _isoG = _hold ?'), line('if(_iso.fresh){ res.next.iso')].join('\n');
const step = new Function('now', 'prev', 'db', 'esc', 'dtms', 'LAST', 'WVAL', 'isoNeeded', 'isoSkippable', 'isoRms',
  'baselineLimit', 'gateFromRaw', 'GRAW', 'impactEvidence', 'IMP',
  't', 'wide', 'z', 'key', 'res', BODY + '\nreturn {val:val, rg:_isoG, hold:_hold, fresh:_iso.fresh, next:res.next};');

// ── 스텁 — DB만 갈아끼운다 ────────────────────────────────────────────────
const KEY = 'T:A', TAG = { tbl: 'T', tag: 'A', fs: FS, zones: Z };
let queries = 0, mode = 'ok', measured = 0;
const db = { query() {
  queries++;
  if (mode === 'throw') throw new Error('DB 오류');
  return { forEach(cb) { const n = mode === 'short' ? 100 : FS; for (let i = 0; i < n; i++) cb([1]); } };
} };
// 표본 부족이면 진짜 규칙대로 null, 아니면 "그 시점 값"
const isoRmsStub = (vals, fs) => (VC.isoRms(vals, fs) === null ? null : measured);
const run = (now, prev, buckets, wide, iso) => {
  measured = iso;
  return step(now, prev, db, (x) => x, () => '', { [KEY]: now }, { [KEY]: buckets },
    VC.isoNeeded, VC.isoSkippable, isoRmsStub, VC.baselineLimit, VC.gateFromRaw, {}, VC.impactEvidence, {},
    TAG, wide, Z, KEY, { next: {} });
};
const loud = [{ rms: 99, cnt: FS }];      // 지름길이 끼어들지 않게

// ── 스탬프: 실제로 잰 틱에만 찍는다 ───────────────────────────────────────
{
  const first = run(0, null, loud, 4.0, 1.5);
  chk(first.fresh === true && first.next.isoAt === 0, '첫 틱은 실측 → isoAt 기록', JSON.stringify(first.next));

  const cached = run(TICK, Object.assign({ g: 1 }, first.next), loud, 4.0, 3.5);
  chk(cached.fresh !== true, 'TTL 안에서는 재측정하지 않는다');
  chk(cached.next.isoAt === first.next.isoAt,
    '캐시에서 꺼낸 틱은 isoAt를 다시 찍지 않는다', 'isoAt ' + cached.next.isoAt + ' (기대 ' + first.next.isoAt + ')');
  chk(cached.next.iso === first.next.iso, '캐시 틱은 직전 값을 그대로 들고 간다', String(cached.next.iso));

  const expired = run(TTL + TICK, Object.assign({ g: 1 }, cached.next), loud, 4.0, 3.5);
  chk(expired.fresh === true && expired.next.isoAt === TTL + TICK,
    'TTL이 지나면 다시 재고 그때 찍는다', String(expired.next.isoAt));
  chk(expired.next.iso === 3.5 && expired.rg === 2,
    '갱신된 값으로 등급이 움직인다(주의 → 위험)', 'iso ' + expired.next.iso + ' 등급 ' + expired.rg);
}

// ── hold: 못 쟀으면 등급을 직전 값으로 유지한다 ───────────────────────────
{
  const WIDE = 4.77;                                   // 전대역은 부풀어 위험 존 · 직전 ISO는 1.60(주의)
  const prev = { g: 1, iso: 1.60, isoAt: -TTL * 2 };   // TTL이 지난 상태라 재측정을 시도한다
  chk(VC.gradeFor(WIDE, Z) === 2, '전제: 전대역 값을 그대로 쓰면 위험으로 읽힌다');
  for (const [m, name] of [['throw', '조회 실패'], ['short', '표본 부족']]) {
    mode = m;
    const r = run(0, prev, loud, WIDE, 9);
    mode = 'ok';
    chk(r.hold === true, `${name} → hold`, JSON.stringify({ hold: r.hold, fresh: r.fresh }));
    chk(r.rg === prev.g, `${name}: 등급을 직전 값으로 유지(전대역으로 갈아타지 않는다)`,
      '등급 ' + r.rg + ' (전대역이면 ' + VC.gradeFor(WIDE, Z) + ')');
    chk(r.next.iso === prev.iso && r.next.isoAt === prev.isoAt,
      `${name}: 폴백값을 캐시에 남기지 않는다`, JSON.stringify(r.next));
  }
  // 직전 상태가 없으면 올릴 근거도 없다 — 양호로 두고 다음 틱을 기다린다
  mode = 'throw';
  const cold = run(0, null, loud, WIDE, 9);
  mode = 'ok';
  chk(cold.rg === 0, '직전 상태가 없으면 등급을 올리지 않는다', '등급 ' + cold.rg);
}

// ── 지름길: 호출부가 초 버킷을 상한으로 넘긴다 ────────────────────────────
{
  queries = 0;
  run(0, null, [{ rms: 0.3, cnt: FS }, { rms: 0.4, cnt: FS }], 0.35, 1.0);
  chk(queries === 0, '모든 초 버킷이 경계 아래면 계산을 건너뛴다');

  const spike = [];
  for (let i = 0; i < 9; i++) spike.push({ rms: 0.30, cnt: FS });
  spike.push({ rms: 3.0, cnt: FS });
  const wide = VC.windowRms(spike).rms;
  chk(wide < Z[0], '전제: 평가창 10초 RMS는 양호 경계 아래', wide.toFixed(4) + ' < ' + Z[0]);
  queries = 0;
  const r = run(0, null, spike, wide, 3.0);
  chk(queries === 1, '한 초라도 경계를 넘으면 계산한다(급상승을 삼키지 않는다)', queries + '회 조회');
  chk(r.rg === 2, '그 급상승이 등급에 반영된다', '등급 ' + r.rg);
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
