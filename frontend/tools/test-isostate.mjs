/* 서버 감시 ISO 판정의 호출부 — 생성된 TQL 원문에서 isoValue·호출부 줄을 떼어내 실행(옮겨 적지 않음)
   · isoAt 스탬프는 실제로 잰 틱에만(캐시 틱에도 찍으면 TTL 만료가 불가능해져 첫 측정값에 고정)
   · 못 쟀으면 등급을 직전 값으로 유지(hold) — 전대역으로 갈아타지 않음
   · 초 버킷 지름길, 최악 판정 상태의 MONSTATE.VAL 폭 수용
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
import fs2 from 'node:fs';
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { judgeTick } = await import('../src/app.js');
const { buildMonitorTql } = (await import('../../cgi-bin/monitor/monitor.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const Z = [1.12, 2.80, 7.10];
const TTL = 30000, TICK = 10000, FS = 25600;   // 주기 < TTL — 캐시 틱이 생기는 조건
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
/* 발췌 줄 — _lim0·_near(베이스라인 알람 근접 시 원본으로 계측 게이트 확인)도 포함
   · 검사 대상은 패턴 게이트 앞의 ISO 등급(_isoG), 게이트 자체는 test-sevgrade 담당 */
const BODY = [src, line('var _lim0 = baselineLimit('), line('var _near ='),
  line('var _iso = isoValue('), line('var _hold ='), line('var val = _hold ?'),
  line('var _isoG = _hold ?'), line('if(_iso.fresh){ res.next.iso')].join('\n');
const step = new Function('now', 'prev', 'db', 'esc', 'dtms', 'LAST', 'WVAL', 'isoNeeded', 'isoSkippable', 'isoRms',
  'baselineLimit', 'gateFromRaw', 'GRAW', 'impactEvidence', 'IMP',
  'srcOf', 't', 'wide', 'z', 'key', 'res', BODY + '\nreturn {val:val, rg:_isoG, hold:_hold, fresh:_iso.fresh, next:res.next};');

// ── 스텁 — DB만 교체 ───────────────────────────────────────────────────────
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
    (x) => x, TAG, wide, Z, KEY, { next: {} });   // srcOf — 표가 하나라 그대로 통과
};
const loud = [{ rms: 99, cnt: FS }];      // 지름길이 끼어들지 않게

// ── 스탬프: 실제로 잰 틱에만 ───────────────────────────────────────────────
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

// ── hold: 못 쟀으면 등급을 직전 값으로 유지 ─────────────────────────────────
{
  const WIDE = 4.77;                                   // 전대역은 부풀어 위험 존 · 직전 ISO는 1.60(주의)
  const prev = { g: 1, iso: 1.60, isoAt: -TTL * 2 };   // TTL 지난 상태 — 재측정 시도
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
  // 직전 상태가 없으면 양호로 두고 다음 틱 대기
  mode = 'throw';
  const cold = run(0, null, loud, WIDE, 9);
  mode = 'ok';
  chk(cold.rg === 0, '직전 상태가 없으면 등급을 올리지 않는다', '등급 ' + cold.rg);
}

// ── 지름길: 호출부가 초 버킷을 상한으로 전달 ────────────────────────────────
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

/* 판정 상태는 MONSTATE.VAL에 encodeURIComponent(JSON)로 저장 — 넘치면 잘린 채 저장돼 그 태그 상태가 조용히 소실
   · 파생 가능한 문장(충격성 text 등)은 상태에 넣지 않음 */
{
  const SQL = (await import('../../cgi-bin/db/sql.js')).default;
  const ddl = SQL.monCreateTables().filter((s) => s.indexOf('MONSTATE') >= 0)[0];
  const at = ddl ? ddl.indexOf('VAL VARCHAR(') : -1;
  const CAP = at < 0 ? 0 : parseInt(ddl.slice(at + 'VAL VARCHAR('.length), 10);
  chk(CAP > 0, '상태 테이블의 VAL 폭을 DDL에서 읽는다', String(CAP));

  // 가장 큰 상태 — 계측 게이트가 걸리고 충격성 근거·패턴·포락선 이력까지 한 태그에 다 실린 경우
  const worst = {
    g: 2, since: 1788391267294, cand: 2, candSince: 1788391267294, candN: 1,
    cyc: 1788391267294, lastRe: 1788391267294, b: true, bb: true, lost: 0,
    epAt: 1788391267294, alarmG: 2, imp: 1, sf: 1, sfs: 1788391267294, sfc: 1788391267294,
    gr: { v: { key: 'flatline', label: '플랫라인', gi: 2,
      detail: '값이 거의 변하지 않습니다 — 센서 정지·케이블 탈락 의심' }, at: 1788391267294 },
    im: { v: { crest: 22.313096406778342, kurt: 474.1315523222581 }, at: 1788391267294 },
    iso: 1.5738057983462597, isoAt: 1788391267294,
    pat: 1, patR: 4.1928374651, patK: '외륜(BPFO)', patIso: 1.5738057983462597,
    patAt: 1788391267294, patW: 0,
    elat: { envBPFO: { r: 1.4465715184893877, at: 1788391267294 },
            envBSF: { r: 1.309249891417762, at: 1788391267294 } },
  };
  const encLen = encodeURIComponent(JSON.stringify(worst)).split("'").join('%27').length;
  chk(encLen < CAP, '최악 상태도 VAL 폭 안에 들어간다 — 넘치면 조용히 잘린다', encLen + ' / ' + CAP);

  // 파생 가능한 산문은 상태 제외 확인
  chk(tql.indexOf('res.next.im={v:{crest:') >= 0, '충격성 근거는 숫자만 저장한다 (text·kind는 파생물)');
  chk(tql.indexOf('res.next.im={v:IMP[key]') < 0, '객체를 통째로 저장하지 않는다');

  // 기존 설치는 DDL만으로 안 바뀜(CREATE 실패를 삼킴) — 폭 검사·확장 훅 필요
  const dbSrc = fs2.readFileSync(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
  chk(dbSrc.indexOf('.then(widenMonState)') >= 0, '자동 생성 훅이 폭 검사를 함께 돈다');
  chk(dbSrc.indexOf('MONSTATE_VAL_MIN = ' + CAP) >= 0, '마이그레이션 기준값이 DDL 폭과 같다', 'MONSTATE_VAL_MIN vs ' + CAP);
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
