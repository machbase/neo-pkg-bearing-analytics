// renderVals 뷰모델 스냅샷 — 리팩터링 전후로 돌려 출력이 바뀌지 않았음을 증명한다.
// 사용: node tools/snap-vm.mjs > before.json  →  (리팩터링)  →  node tools/snap-vm.mjs > after.json  →  diff
// 함수·DOM 핸들러는 비교 대상이 아니므로 이름만 남기고 값만 직렬화한다.
import renderToString from 'preact-render-to-string';
globalThis.window = globalThis;

const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

const app = new App({ defaultTab: 'monitor', defaultTheme: 'dark', seed: 42, equipmentCount: 20 });
app.setState = function (s) { Object.assign(this.state, s); };
app._scheduleDraw = function () {};
app.E = CH; app.live = true;
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
  genTags: sorted.slice(0, 3).map((e) => e.id),
  genPeriod: 'all', genFrom: CH.fmtDT(d.now - 86400000), genTo: CH.fmtDT(d.now),
  from: CH.fmtDT(d.now - 7 * 86400000).slice(0, 10), to: CH.fmtDT(d.now).slice(0, 10),
});

// 함수는 존재 여부만, 나머지는 값 그대로 — 순환 참조(eq 등)는 잘라낸다
function ser(v, depth) {
  if (depth > 6) return '…';
  if (typeof v === 'function') return '[fn]';
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 60).map((x) => ser(x, depth + 1));
  const o = {};
  Object.keys(v).sort().forEach((k) => { if (k !== 'eq' && k !== 'det') o[k] = ser(v[k], depth + 1); });
  return o;
}

const CASES = [
  ['monitor', { tab: 'monitor' }],
  ['detail', { tab: 'detail', dxOpen: true }],
  ['report', { tab: 'report' }],
  ['set-source', { tab: 'settings', setSection: 'source' }],
  ['set-equip', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: '6206' } }],
  ['set-criteria', { tab: 'settings', setSection: 'criteria', baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60 } } }],
  ['set-monitor', { tab: 'settings', setSection: 'monitor' }],
  ['set-llm', { tab: 'settings', setSection: 'llm' }],
];

const base = JSON.parse(JSON.stringify(app.state));
const out = {};
for (const [name, patch] of CASES) {
  Object.assign(app.state, JSON.parse(JSON.stringify(base)), patch);
  const vm = app.renderVals();
  out[name] = { vm: ser(vm, 0), html: renderToString(view(vm)).length };
}
console.log(JSON.stringify(out, null, 1));
