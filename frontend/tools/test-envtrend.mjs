/* 포락선 계열의 추세 차트 합류 — 대역 8칸은 브라우저가 원시 창에서 계산, 포락선은 서버 저장값을 읽음(값 두 벌 방지)
   · 청크 격자와 저장 앵커 격자가 달라 가장 가까운 앵커를 얹고 먼 자리는 비움
   · 배수 축(베이스라인 한계로 나눈 무차원)·빈 계열 축 가드
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;

// live.js가 로드 시점에 DB 함수를 캡처 — 스텁을 먼저 설치(test-cap.mjs와 같은 규약)
const DB = (await import('../../cgi-bin/db/db.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const FS = 2048;
let TREND = {};                     // { 'T:A:envBPFO': [{ms,v}...] }
DB.bandTrend = (key) => Promise.resolve(TREND[key] || []);
// 청크마다 같은 파형 — 대역값은 관심 밖(값만 나오면 됨)
DB.rawWindow = () => {
  const values = [];
  for (let i = 0; i < 4096; i++) values.push(Math.sin(2 * Math.PI * 100 * i / FS));
  return Promise.resolve({ values });
};

const L = await import('../src/data/live.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const E = { fmtMD: (m) => String(m), fmtDT: (m) => String(m) };
const T0 = 1_700_000_000_000, HOUR = 3600000;
const eq = { table: 'T', name: 'A', fs: FS, rpm: 1800, _unit: 'min' };
// 6시간 · 24청크 → 청크 간격 약 15.6분
const roll = [];
for (let i = 0; i < 24; i++) roll.push({ ms: T0 + i * HOUR / 4 });
const from = roll[0].ms, to = roll[roll.length - 1].ms;
const ENV = VC.BAND_ORDER.slice(VC.BAND_FREQ.length);

const load = () => L.loadTrendChunks(E, eq, roll);
const labels = (tr) => tr.bands.map((b) => b.label);

// ── 계열이 없으면 추가 없음 ────────────────────────────────────────────────
{
  TREND = {};
  const tr = await load();
  chk(tr.bands.length === VC.BAND_FREQ.length, '저장된 포락선이 없으면 대역 8칸뿐', String(tr.bands.length));
  chk(tr.bands.every((b) => b.vals.length === tr.times.length), '대역 계열 길이가 x축과 같다');
}

// ── 저장된 계열 합류 ───────────────────────────────────────────────────────
{
  TREND = {};
  // 10분 간격 앵커 — 실제 추출 주기와 같게
  const rows = [];
  for (let t = from; t <= to; t += 600000) rows.push({ ms: t, v: 1 + (t - from) / (to - from) });
  TREND['T:A:envBPFO'] = rows;
  const tr = await load();
  chk(tr.bands.length === VC.BAND_FREQ.length + 1, '저장된 계열 하나가 붙는다', String(tr.bands.length));
  const bp = tr.bands[tr.bands.length - 1];
  chk(bp.label === VC.BAND_KO.envBPFO, '한글 라벨을 쓴다', bp.label);
  chk(bp.vals.length === tr.times.length, 'x축 길이에 맞춰 리샘플된다', `${bp.vals.length}/${tr.times.length}`);
  chk(bp.vals.every((v) => v != null), '앵커가 촘촘하면 빈 칸이 없다');
  // 가장 가까운 앵커 선택 — 값이 시각에 선형이라 청크 시각 기대값과 일치해야 함
  const worst = Math.max(...tr.times.map((t, i) => Math.abs(bp.vals[i] - (1 + (t - from) / (to - from)))));
  chk(worst < 0.05, '가장 가까운 앵커 값을 고른다', `최대 오차 ${worst.toFixed(4)}`);
  // 포락선 색은 대역 색과 겹치지 않음(범례 혼동 방지)
  chk(!tr.bands.slice(0, VC.BAND_FREQ.length).some((b) => b.color === bp.color), '포락선 색이 대역과 겹치지 않는다', bp.color);
}

// ── 없는 구간은 비움 ───────────────────────────────────────────────────────
{
  TREND = {};
  // 뒤쪽 절반에만 값 — 대역 추출을 도중에 켠 경우
  const rows = [];
  for (let t = from + (to - from) / 2; t <= to; t += 600000) rows.push({ ms: t, v: 2 });
  TREND['T:A:envBPFO'] = rows;
  const tr = await load();
  const bp = tr.bands[tr.bands.length - 1];
  const nulls = bp.vals.filter((v) => v == null).length;
  chk(nulls > 0, '값이 없던 구간은 null로 비운다', `${nulls}/${bp.vals.length}칸`);
  chk(bp.vals[bp.vals.length - 1] === 2, '값이 있는 구간은 채운다');
  chk(bp.vals[0] == null, '앞쪽(추출 전)은 비어 있다');
}

// ── 판정 계열 전부 합류 ────────────────────────────────────────────────────
{
  TREND = {};
  const rows = [];
  for (let t = from; t <= to; t += 600000) rows.push({ ms: t, v: 1 });
  ENV.forEach((bn) => { TREND['T:A:' + bn] = rows; });
  const tr = await load();
  chk(tr.bands.length === VC.BAND_FREQ.length + ENV.length, '판정 계열 전부가 차트에 온다', String(tr.bands.length));
  chk(ENV.every((bn) => labels(tr).indexOf(VC.BAND_KO[bn]) >= 0), '이름이 하나도 안 빠진다', labels(tr).join(','));
  /* 저장 전용 계열은 차트 제외 — 반복주파수(Hz)와 대역 RMS는 단위가 달라 한 축 불가 */
  TREND['T:A:envF0'] = rows; TREND['T:A:fr'] = rows;
  const tr2 = await load();
  chk(tr2.bands.length === VC.BAND_FREQ.length + ENV.length, '저장 전용 계열은 차트에 안 온다', String(tr2.bands.length));
}

// ── 포락선 조회 실패에도 차트 표시 ─────────────────────────────────────────
{
  TREND = {};
  DB.bandTrend = () => Promise.reject(new Error('boom'));
  const tr = await load();
  chk(tr.bands.length === VC.BAND_FREQ.length, '포락선 조회 실패는 대역 차트를 막지 않는다', String(tr.bands.length));
  DB.bandTrend = (key) => Promise.resolve(TREND[key] || []);
}

// ── 배수 축 ────────────────────────────────────────────────────────────────
/* 원값은 계열 간 크기 차가 커서 작은 대역이 축 바닥에 붙음 → 각 계열을 자기 베이스라인 한계로 나눠 무차원화
   · ×1이 곧 판정선 */
{
  const { App } = await import('../src/app.js');
  const a = Object.create(App.prototype);
  a.state = {};
  a._blMap = {
    'T:A:sub': { mu: 0.001, sigma: 0.0001, k: 3 },     // 한계 0.0013
    'T:A:vh2': { mu: 0.4, sigma: 0.02, k: 3 },         // 한계 0.46
  };
  const bl = a._bandBaselines({ table: 'T', name: 'A' });
  chk(!!bl && !!bl.sub && !!bl.vh2, '학습된 계열만 베이스라인으로 잡힌다', Object.keys(bl || {}).join(','));

  const series = [
    { key: 'sub', label: '서브동기', vals: [0.0016] },
    { key: 'vh2', label: '2~4 kHz', vals: [0.42] },
    { key: 'envBPFO', label: 'BPFO(외륜)', vals: [0.9] },   // 학습 없음
  ];
  const norm = series.map((s) => {
    const lim = s.key ? VC.baselineLimit(bl[s.key]) : 0;
    if (!(lim > 0)) return null;
    return { label: s.label, vals: s.vals.map((v) => (v == null ? null : v / lim)) };
  }).filter(Boolean);

  // 학습 없는 계열은 제외 — 기준이 없어 1로 그리면 "정상"으로 읽힘
  chk(norm.length === 2, '학습 없는 계열은 배수 축에서 빠진다', norm.map((s) => s.label).join(','));
  const rawRatio = series[1].vals[0] / series[0].vals[0];
  const normRatio = norm[1].vals[0] / norm[0].vals[0];
  chk(rawRatio > 200, '원값은 계열 간 크기 차가 크다', `×${rawRatio.toFixed(0)}`);
  chk(normRatio < 2, '배수로 보면 같은 눈금에 모인다', `×${normRatio.toFixed(2)}`);
  chk(norm[0].vals[0] > 1 && norm[1].vals[0] < 1, '기준을 넘은 계열만 ×1 위로 간다',
    `sub ×${norm[0].vals[0].toFixed(2)} · vh2 ×${norm[1].vals[0].toFixed(2)}`);
  // 빈 구간(추출 전)은 null 유지 — 0이면 "정상"으로 읽힘
  const lim0 = VC.baselineLimit(bl.sub);
  const gap = [null, 0.0016].map((v) => (v == null ? null : v / lim0));
  chk(gap[0] === null, '빈 구간은 배수 축에서도 비어 있다');
}

// ── 그릴 계열이 하나도 없을 때 ─────────────────────────────────────────────
/* 계열 0개(학습 없음·전부 끔)면 축 범위가 ±Infinity로 남음 — 가드로 유한 눈금 유지 */
{
  const axis = (series, refLines) => {
    let mn = Infinity, mx = -Infinity;
    series.forEach((s) => { for (let i = 0; i < s.vals.length; i++) { if (s.vals[i] < mn) mn = s.vals[i]; if (s.vals[i] > mx) mx = s.vals[i]; } });
    if (!isFinite(mn) || !isFinite(mx)) { if (!refLines) return null; mn = 0; mx = 0; }
    if (refLines) refLines.forEach((r) => { mx = Math.max(mx, r.val); });
    const m = (mx - mn) * 0.12 || 1; mn = 0; mx += m;
    const range = mx - mn || 1;
    return [0, 1, 2, 3, 4, 5].map((i) => mn + range * i / 5);
  };
  const ticks = axis([], [{ val: 1 }]);
  chk(ticks && ticks.every((t) => isFinite(t)), '계열이 없어도 눈금이 유한하다', ticks ? ticks.map((t) => t.toFixed(2)).join(',') : 'null');
  chk(ticks && ticks[ticks.length - 1] >= 1, '기준선이 축 안에 들어온다', ticks ? ticks[ticks.length - 1].toFixed(2) : 'null');
  chk(axis([], null) === null, '기준선도 없으면 아예 그리지 않는다');
  chk(axis([{ vals: [0.9, 1.3] }], [{ val: 1 }]).every((t) => isFinite(t)), '정상 경로는 그대로');

  // 원본 소스의 가드 존재 확인 — 위 재현은 복사본
  const chart = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../cgi-bin/chart/chart.js', import.meta.url), 'utf8'));
  const body = chart.slice(chart.indexOf('function drawMultiLine'), chart.indexOf('function drawMultiLine') + 1400);
  chk(/isFinite\(mn\) \|\| !isFinite\(mx\)/.test(body), 'drawMultiLine에 축 가드가 있다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
