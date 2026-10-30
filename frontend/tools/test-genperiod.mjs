/* 데이터 없는 기간의 리포트 생성 차단 — 빈 문서가 "그날 이상 없었다"는 잘못된 기록으로 남지 않게 생성 전에 막음
   · 판정은 직접 입력 기간만(프리셋은 태그별 최신 데이터에 앵커되어 비지 않음), 일부 태그만 없으면 그 태그만 제외
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
import renderToString from 'preact-render-to-string';

const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// 데이터가 2026-08-10 하루만 있는 태그 둘
const D0 = Date.UTC(2026, 7, 10, 0, 0), D1 = Date.UTC(2026, 7, 10, 23, 59);
const mkEq = (id, name, stat) => ({
  id, table: 'T', name, alias: name, unit: 'mm/s', cls: 'II', rpm: 1800, fs: 25600,
  // bearing은 라이브에서 항상 객체(미지정이면 n=0) — 실제 모양 그대로
  grade: 0, rms: 1, zones: [1.12, 2.8, 7.1], bearing: { model: '', n: 0, Bd: 0, Pd: 0, phi: 0 }, meta: {}, rollup: [],
  spark: { line: '', area: '' }, // 모니터링 카드가 요구하는 최소 형태(검사 대상 아님)
  stat: stat, lastSeen: stat ? stat.maxMs : 0,
});
const mk = (period, from, to, eqs) => {
  const a = new App({ defaultTab: 'report', seed: 1, equipmentCount: 1 });
  a.setState = function (s) { Object.assign(this.state, s); };
  a._scheduleDraw = () => {}; a.E = CH; a.live = true; a.forceUpdate = () => {};
  a.toasts = []; a._toast = function (m, k) { this.toasts.push({ m, k }); };
  a.gen = null; a._genOne = function () { return Promise.resolve(); };
  a.data = { now: D1, equipment: eqs, events: [], reports: [] };
  a.liveTables = ['T'];
  Object.assign(a.state, {
    ready: true, tab: 'report', srcSel: ['T'], events: [], reports: [],
    genTags: eqs.map((e) => e.id), genPeriod: period, genFrom: from, genTo: to,
  });
  return a;
};
const IN = ['2026-08-10T00:00', '2026-08-10T12:00'];      // 데이터 구간 안
const OUT = ['2026-07-01T00:00', '2026-07-02T00:00'];      // 데이터보다 과거
const A = () => mkEq('T:A', 'A', { minMs: D0, maxMs: D1 });
const B = () => mkEq('T:B', 'B', { minMs: D0, maxMs: D1 });

// ── 기간 안이면 그대로 생성 가능 ──────────────────────────────────────────
{
  const a = mk('custom', IN[0], IN[1], [A(), B()]);
  const v = a.renderVals();
  chk(!v.genNoDataShow, '데이터가 있는 기간은 경고하지 않는다');
  chk(!v.genNoDataAll, '생성이 막히지 않는다');
}
// ── 전 태그가 기간 밖 = 생성 차단 ─────────────────────────────────────────
{
  const a = mk('custom', OUT[0], OUT[1], [A(), B()]);
  const v = a.renderVals();
  chk(v.genNoDataAll === true, '전부 데이터가 없으면 생성이 막힌다');
  chk(/데이터가 없습니다/.test(v.genNoDataText), '없다고 말한다', v.genNoDataText);
  chk(/2026/.test(v.genNoDataText), '데이터가 어느 구간에 있는지 알려준다 — 기간을 고칠 수 있어야 한다');
  chk(/전체/.test(v.genNoDataText), "'전체' 프리셋이라는 해결책을 준다");
  chk(/opacity: \.5/.test(v.genBtnStyle) && /not-allowed/.test(v.genBtnStyle), '생성 버튼이 비활성으로 보인다');
  const html = renderToString(view(v));
  chk(html.indexOf(v.genNoDataText) >= 0, '경고가 실제로 렌더된다');
  // 버튼을 눌러도 생성 안 됨
  v.onGenReport();
  chk(a.state.genRunning !== true, '눌러도 생성이 시작되지 않는다');
  chk(a.toasts.some((t) => /데이터가 없습니다/.test(t.m)), '왜 안 되는지 알린다', JSON.stringify(a.toasts));
}
// ── 일부만 기간 밖 = 그 태그만 빼고 생성 ──────────────────────────────────
{
  const a = mk('custom', IN[0], IN[1], [A(), mkEq('T:C', 'C', { minMs: Date.UTC(2020, 0, 1), maxMs: Date.UTC(2020, 0, 2) })]);
  const v = a.renderVals();
  chk(v.genNoDataShow === true, '일부만 없어도 알린다');
  chk(v.genNoDataAll === false, '나머지가 있으면 생성을 막지는 않는다');
  chk(/제외/.test(v.genNoDataText), '무엇이 빠지는지 미리 말한다', v.genNoDataText);
  chk(a._genGapIds.length === 1 && a._genGapIds[0] === 'T:C', '빠질 태그를 정확히 집는다', JSON.stringify(a._genGapIds));
}
// ── 프리셋은 태그 최신 데이터에 앵커 — 판정 대상 아님 ─────────────────────
{
  for (const p of ['1h', '24h', 'all']) {
    const a = mk(p, OUT[0], OUT[1], [A()]);
    const v = a.renderVals();
    chk(!v.genNoDataShow, p + ' 프리셋은 막지 않는다 — 각 태그의 최신 데이터 기준으로 창을 다시 잡는다');
  }
}
// ── 통계를 모르는 태그는 막지 않음 ──────────────────────────────────────────
{
  const a = mk('custom', OUT[0], OUT[1], [mkEq('T:D', 'D', null)]);
  chk(!a.renderVals().genNoDataShow, '통계를 모르면 막지 않는다 — 모른다를 없다로 바꾸지 않는다');
}

// ── 데이터 구간 내부 공백은 겹침 검사로 못 잡음 → 생성 시점에 건너뜀 ──
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/if \(!roll\.length\) \{ var e0 = new Error\('선택 기간에 표본이 없습니다'\); e0\.__nodata = true; throw e0; \}/.test(src),
    '표본 0건이면 리포트를 만들지 않는다 — 겹침 검사만으론 내부 공백을 못 잡는다');
  chk(/if \(e && e\.__nodata\) \{ self\._genSkips\.push/.test(src),
    '데이터 없음은 실패가 아니라 건너뜀으로 센다 — 고장으로 읽히면 원인을 엉뚱한 데서 찾는다');
  chk(/_sk\.length \+ '건 건너뜀|T\('[^']*\{1\}건 건너뜀[^']*', self\._genSaved, _sk\.length/.test(src), '건너뛴 건수를 사용자에게 알린다');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
