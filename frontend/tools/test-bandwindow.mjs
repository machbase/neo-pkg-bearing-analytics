/* 대역 학습·채우기의 시간 기준 — 창의 끝 = 태그의 마지막 데이터(lastSeen), 벽시계 아님
   · 적재가 끝난 테이블에서 창이 데이터 뒤에 놓이지 않게(RMS 학습과 같은 기준)
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;

const DB = (await import('../../cgi-bin/db/db.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let RAW = {};        // 'T:A:sub' → [{ms,v}...]
let TIMES = {};      // bandTimes 결과
let ASKED = [];      // bandRaw가 실제로 물은 구간
DB.bandRaw = (key, from, to) => { ASKED.push({ key, from, to }); return Promise.resolve(RAW[key] || []); };
DB.bandTimes = (keys, from, to) => Promise.resolve(TIMES);
DB.saveBaseline = () => Promise.resolve();

const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const DAY = 86400000, MIN = 60000;
const now = Date.now();
// 적재가 끝난 태그(5일 전 · 75분짜리)와 지금도 들어오는 태그
const STALE = { maxMs: now - 5 * DAY, minMs: now - 5 * DAY - 75 * MIN };
const LIVE = { maxMs: now - MIN, minMs: now - 30 * DAY };

const mkApp = (stat) => {
  const a = Object.create(App.prototype);
  a.live = true;
  a.state = { bandInterval: '10m', bandWin: '24h', srcSel: ['T'], equipBearing: {}, equipMeta: {}, equipGeo: {}, blK: 3 };
  a.setState = (o) => Object.assign(a.state, o);
  a._detailCache = {};
  a.data = { equipment: [{ id: 'T:A', table: 'T', name: 'A', fs: 25600, rpm: 1800, stat, lastSeen: stat.maxMs, alias: 'A' }] };
  return a;
};

// ── 채울 칸 세기 ───────────────────────────────────────────────────────────
{
  const a = mkApp(STALE);
  const plan = a._bandPlan();
  chk(plan.total > 0, '적재가 끝난 태그도 채울 칸이 있다', `${plan.total}칸`);
  chk(plan.total === 7, '데이터 구간(75분) ÷ 주기(10분) = 7칸', String(plan.total));
  /* 창의 끝 = 마지막 데이터(벽시계면 창 전체가 데이터 뒤라 0칸 → "이미 다 채워짐"으로 오표시) */
  chk(plan.ends['T:A'] === STALE.maxMs, '창의 끝 = 그 태그의 마지막 데이터', new Date(plan.ends['T:A']).toISOString());
  chk(plan.froms['T:A'] === STALE.minMs, '데이터보다 앞으로는 안 간다', new Date(plan.froms['T:A']).toISOString());

  const b = mkApp(LIVE);
  const p2 = b._bandPlan();
  chk(p2.total >= 140 && p2.total <= 144, '라이브 태그는 창 전체(24h/10m)를 채운다', `${p2.total}칸`);
  chk(Math.abs(p2.ends['T:A'] - LIVE.maxMs) < 1000, '라이브도 같은 규칙 — lastSeen ≈ 지금이라 동작이 그대로', '');
}

// ── 학습이 보는 구간 ───────────────────────────────────────────────────────
{
  const a = mkApp(STALE);
  ASKED = []; RAW = {};
  await a._learnBandBaseline(a.data.equipment[0]);
  chk(ASKED.length === VC.BAND_ORDER.length, '판정 계열 전부를 조회한다', `${ASKED.length}개`);
  const q = ASKED[0];
  chk(Math.abs(q.to - STALE.maxMs) < 1000, '학습 창의 끝 = 마지막 데이터', new Date(q.to).toISOString());
  chk(Math.abs(q.from - (STALE.maxMs - 24 * 3600000)) < 1000, '거기서 학습 기간만큼 거슬러 올라간다');
  chk(q.to <= now, '미래를 보지 않는다');
}

// ── 채움 현황 ──────────────────────────────────────────────────────────────
/* 조회는 가장 이른 시작으로 한 번, 세기는 태그별 창 안에서만(창 밖 값은 "채워짐" 제외) */
{
  const a = mkApp(STALE);
  const plan = a._bandPlan();
  const probe = VC.BAND_FREQ[0];
  TIMES = {
    ['T:A:' + probe]: [
      STALE.maxMs - 60 * MIN, STALE.maxMs - 50 * MIN, STALE.maxMs - 40 * MIN,   // 창 안
      now - 30 * MIN,                                                            // 창 밖(최근)
      STALE.minMs - 10 * MIN,                                                    // 창 밖(더 과거)
    ],
  };
  const cov = await a._refreshBandCov();
  chk(cov['T:A'].have === 3, '창 안의 값만 센다', `${cov['T:A'].have}칸`);
  chk(cov['T:A'].need === plan.per['T:A'], '필요한 칸 수도 그 태그 기준', `${cov['T:A'].need}`);
}

// ── 라이브 태그는 벽시계 기준과 동일 ─────────────────────────────────────────
/* lastSeen ≈ 지금이면 벽시계 기준과 같은 창 */
{
  const a = mkApp(LIVE);
  const plan = a._bandPlan();
  chk(Math.abs(plan.froms['T:A'] - (now - 24 * 3600000)) < 2 * MIN, '라이브 창 시작이 지금−24h와 같다');
  ASKED = []; RAW = {};
  await a._learnBandBaseline(a.data.equipment[0]);
  chk(Math.abs(ASKED[0].to - now) < 2 * MIN, '라이브 학습 창의 끝도 지금과 같다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
