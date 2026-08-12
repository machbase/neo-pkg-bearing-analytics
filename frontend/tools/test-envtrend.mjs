/* 포락선 계열이 추세 차트에 얹히는가 — 오프라인(Neo 불필요). npm run smoke에 포함.

   대역 8칸은 브라우저가 원시 창에서 그 자리에 계산하고, 포락선 4칸은 서버가 쌓아 둔 것을 읽는다.
   출처가 갈리는 이유는 값이 두 벌이 되면 안 되기 때문이다 — 여기서 다시 복조하면 서버가 판정에
   쓴 값과 다른 값이 화면에 그려져 "알람은 났는데 차트엔 안 보이는" 상태가 된다.

   대신 시간 격자가 어긋난다: 청크는 기간을 24등분한 자리고 저장 앵커는 추출 주기(10분 이상)마다다.
   가장 가까운 앵커를 골라 얹되 멀리 떨어진 자리는 비워야 한다 — 안 비우면 대역 추출을 켜기 전
   기간까지 선이 이어져 없던 값이 있는 것처럼 보인다. */
globalThis.window = globalThis;

// DB는 live.js가 모듈 로드 시점에 함수를 캡처한다 — 스텁을 먼저 꽂는다(test-cap.mjs와 같은 규약)
const DB = (await import('../../cgi-bin/db/db.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const FS = 2048;
let TREND = {};                     // { 'T:A:envBPFO': [{ms,v}...] }
DB.bandTrend = (key) => Promise.resolve(TREND[key] || []);
// 청크마다 같은 파형 — 대역값은 이 시험의 관심사가 아니다(값이 나오기만 하면 된다)
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

// ── 계열이 없으면 아무것도 안 붙는다 ───────────────────────────────────────
{
  TREND = {};
  const tr = await load();
  chk(tr.bands.length === VC.BAND_FREQ.length, '저장된 포락선이 없으면 대역 8칸뿐', String(tr.bands.length));
  chk(tr.bands.every((b) => b.vals.length === tr.times.length), '대역 계열 길이가 x축과 같다');
}

// ── 저장된 계열이 얹힌다 ───────────────────────────────────────────────────
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
  // 가장 가까운 앵커를 고른다 — 값이 시각에 선형이라 청크 시각의 기대값과 맞아야 한다
  const worst = Math.max(...tr.times.map((t, i) => Math.abs(bp.vals[i] - (1 + (t - from) / (to - from)))));
  chk(worst < 0.05, '가장 가까운 앵커 값을 고른다', `최대 오차 ${worst.toFixed(4)}`);
  // 색이 대역과 겹치지 않아야 범례에서 축이 같은 줄로 안 읽힌다
  chk(!tr.bands.slice(0, VC.BAND_FREQ.length).some((b) => b.color === bp.color), '포락선 색이 대역과 겹치지 않는다', bp.color);
}

// ── 없는 구간은 비운다 ─────────────────────────────────────────────────────
{
  TREND = {};
  // 뒤쪽 절반에만 값이 있다 — 대역 추출을 도중에 켠 경우
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

// ── 판정 계열 전부가 붙는다 ────────────────────────────────────────────────
{
  TREND = {};
  const rows = [];
  for (let t = from; t <= to; t += 600000) rows.push({ ms: t, v: 1 });
  ENV.forEach((bn) => { TREND['T:A:' + bn] = rows; });
  const tr = await load();
  chk(tr.bands.length === VC.BAND_FREQ.length + ENV.length, '판정 계열 전부가 차트에 온다', String(tr.bands.length));
  chk(ENV.every((bn) => labels(tr).indexOf(VC.BAND_KO[bn]) >= 0), '이름이 하나도 안 빠진다', labels(tr).join(','));
  /* 저장 전용 계열은 차트에도 오면 안 된다 — 반복주파수(Hz)와 대역 RMS를 한 축에 그리면
     단위가 다른 값이 같은 눈금으로 읽힌다. */
  TREND['T:A:envF0'] = rows; TREND['T:A:fr'] = rows;
  const tr2 = await load();
  chk(tr2.bands.length === VC.BAND_FREQ.length + ENV.length, '저장 전용 계열은 차트에 안 온다', String(tr2.bands.length));
}

// ── 조회가 실패해도 차트는 그려진다 ────────────────────────────────────────
{
  TREND = {};
  DB.bandTrend = () => Promise.reject(new Error('boom'));
  const tr = await load();
  chk(tr.bands.length === VC.BAND_FREQ.length, '포락선 조회 실패는 대역 차트를 막지 않는다', String(tr.bands.length));
  DB.bandTrend = (key) => Promise.resolve(TREND[key] || []);
}

// ── 배수 축 ────────────────────────────────────────────────────────────────
/* 원값은 계열 간 크기가 네 자릿수까지 벌어져(저주파 0.0016 vs 고주파 0.42) 작은 대역이 축 바닥에
   붙는다 — 사용자가 원래 지적한 "대역끼리 비교가 안 됨"의 실체다. 단위를 대역마다 다르게 주면
   축을 공유할 수 없어 오히려 더 안 되므로, 각 계열을 자기 베이스라인 한계로 나눠 무차원으로 만든다.
   ×1이 곧 판정선이라 "알람은 났는데 차트엔 안 보인다"도 함께 사라진다. */
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

  // 학습이 없으면 나눌 기준이 없다 — 1로 눌러 그리면 "정상"으로 읽히므로 빼는 편이 맞다
  chk(norm.length === 2, '학습 없는 계열은 배수 축에서 빠진다', norm.map((s) => s.label).join(','));
  const rawRatio = series[1].vals[0] / series[0].vals[0];
  const normRatio = norm[1].vals[0] / norm[0].vals[0];
  chk(rawRatio > 200, '원값은 계열 간 크기 차가 크다', `×${rawRatio.toFixed(0)}`);
  chk(normRatio < 2, '배수로 보면 같은 눈금에 모인다', `×${normRatio.toFixed(2)}`);
  chk(norm[0].vals[0] > 1 && norm[1].vals[0] < 1, '기준을 넘은 계열만 ×1 위로 간다',
    `sub ×${norm[0].vals[0].toFixed(2)} · vh2 ×${norm[1].vals[0].toFixed(2)}`);
  // 빈 구간(추출 전)이 0으로 바뀌면 "정상"으로 읽힌다 — null은 null로 남아야 한다
  const lim0 = VC.baselineLimit(bl.sub);
  const gap = [null, 0.0016].map((v) => (v == null ? null : v / lim0));
  chk(gap[0] === null, '빈 구간은 배수 축에서도 비어 있다');
}

// ── 그릴 계열이 하나도 없을 때 ─────────────────────────────────────────────
/* 학습이 하나도 없는 태그에서 배수 축을 켜면 남는 계열이 0개다. 이때 축 범위가 초기값(±Infinity)
   그대로라 눈금이 '-InfinityK'로 찍히고 그림이 통째로 깨졌다. 계열을 전부 꺼도 같은 자리다. */
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

  // 소스에도 가드가 실제로 있는지 — 위 재현은 복사본이라 원본이 빠지면 못 잡는다
  const chart = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../cgi-bin/chart/chart.js', import.meta.url), 'utf8'));
  const body = chart.slice(chart.indexOf('function drawMultiLine'), chart.indexOf('function drawMultiLine') + 1400);
  chk(/isFinite\(mn\) \|\| !isFinite\(mx\)/.test(body), 'drawMultiLine에 축 가드가 있다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
