// 런타임 스모크 테스트 — htm 템플릿은 런타임 파싱이므로 빌드 성공만으로 부족하다.
// 전 탭 + 주요 분기(모달/토스트/빈상태/커스텀 베어링 등)를 renderToString으로 실제 평가한다.
// 사용: node tools/smoke.mjs
import renderToString from 'preact-render-to-string';

globalThis.window = globalThis; // app.js의 window 참조 가드용

const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default; // 목 생성기는 테스트 전용(tools/) — 앱 번들엔 미포함
const { App } = await import('../src/app.js');

const E = CH;
if (!Mock.generateData || !E.drawLine) { console.error('FAIL: chart/mock 모듈 로드 실패'); process.exit(1); }

const app = new App({ defaultTab: 'monitor', defaultTheme: 'dark', seed: 42, equipmentCount: 20 });
app.setState = function (s) { Object.assign(this.state, s); }; // preact 내부 우회(순수 상태 평가만)
app._scheduleDraw = function () {};
// 앱은 라이브 전용이 됐으므로, 스모크는 목 데이터를 라이브 상태 모양으로 주입해 템플릿을 검증한다
app.E = E; app.live = true;
const d = Mock.generateData(42, 20);
app.data = d;
app.liveTables = ['VIBRATION_RAW', 'SENSOR_DATA', 'MOTOR_CURRENT', 'GEARBOX_VIB', 'BEARING_TEMP'];
const sorted = d.equipment.slice().sort((a, b) => b.grade - a.grade);
sorted.forEach((e, i) => { e.order = i; });
const eq0 = sorted[0];
app._detailCache[eq0.id] = { state: 'ready', det: Mock.buildDetail(eq0) };
Object.assign(app.state, {
  ready: true, srcSel: app.liveTables.slice(), selTag: eq0.id, diagTag: eq0.id,
  events: d.events.slice(), reports: d.reports.slice(),
  genTags: sorted.slice(0, 3).map(e => e.id),
  from: E.fmtDT(d.now - 7 * 86400000).slice(0, 10), to: E.fmtDT(d.now).slice(0, 10),
});
const cases = [
  ['monitor 기본', {}],
  ['monitor 필터+알람중지+토스트', { gradeFilter: 1, monitorOn: false, toast: { msg: 't', kind: 'warn' } }],
  ['monitor 빈 소스', { srcSel: [] }],
  ['detail 기본', { tab: 'detail' }],
  ['detail 빈 소스', { tab: 'detail', srcSel: [] }],
  ['detail 종합분석+AI소견', { tab: 'detail', dxOpen: true, dxAiText: '소견 텍스트' }],
  ['detail AI 로딩', { tab: 'detail', dxOpen: true, dxAiText: '__loading__' }],
  ['detail AI 폴백+커스텀기간', { tab: 'detail', dxOpen: true, dxAiText: '__fallback__', period: 'custom' }],
  ['report 기본', { tab: 'report' }],
  ['report 생성중+미리보기모달', { tab: 'report', genRunning: true, genStep: 2, viewReport: { rec: {}, url: 'report.html?x=1', fname: 'RPT_TEST.html' } }],
  ['report 빈 소스', { tab: 'report', srcSel: [] }],
  ['settings source+dirty+이동확인모달', { tab: 'settings', setSection: 'source', dirty: true, pendingNav: 'monitor' }],
  ['settings equip+펼침+커스텀베어링', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: '직접 입력' } }],
  ['settings equip 슬리브', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: 'sleeve' } }],
  ['settings criteria', { tab: 'settings', setSection: 'criteria' }],
  ['settings monitor', { tab: 'settings', setSection: 'monitor' }],
  ['settings llm+테스트중', { tab: 'settings', setSection: 'llm', llmTesting: true }],
  ['settings llm ollama+테스트결과', { tab: 'settings', setSection: 'llm', llmProvider: 'ollama', llmTest: { ok: true, msg: 'ok' } }],
  ['이벤트 미확인만', { tab: 'monitor', evtNewOnly: true }],
];

const baseState = JSON.parse(JSON.stringify(app.state));
let fail = 0;
for (const [label, patch] of cases) {
  try {
    Object.assign(app.state, JSON.parse(JSON.stringify(baseState)), patch);
    const out = renderToString(view(app.renderVals()));
    if (!out || out.length < 500) throw new Error('suspiciously short output: ' + out.length);
    console.log('PASS', label, '(' + out.length + ' chars)');
  } catch (e) {
    fail++;
    console.error('FAIL', label, '—', e.message);
  }
}
process.exit(fail ? 1 : 0);
