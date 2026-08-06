/* 설정 입력 유실 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   설정 화면의 입력칸은 전부 제어 입력(value=상태)이다. 판정 틱은 알람이 켜져 있으면 어느 탭에서든
   도는데, 그 끝에서 화면을 다시 그리면 타이핑 도중인 칸에 옛 상태값이 도로 써진다.
   onChange는 포커스가 빠질 때 발화하므로 그전에 글자가 날아가면 저장될 값 자체가 없다 —
   사용자에게는 "임계값을 고쳐도 저장이 안 된다"로 보인다. */
globalThis.window = globalThis;
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data: { rows: [] } }) });

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};
const mk = (tab) => {
  const a = new App({ seed: 1, equipmentCount: 1 });
  a.setState = function (s) { Object.assign(this.state, s); };
  a._scheduleDraw = () => {}; a._toast = () => {};
  a.E = CH; a.live = true; a.repaints = 0; a.forceUpdate = function () { this.repaints++; };
  a._refreshRunState = () => {}; a._judgeLive = () => Promise.resolve(0);
  a._syncMonitorTimer = () => Promise.resolve(); a._syncBandTimer = () => Promise.resolve();
  a.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  Object.assign(a.state, { ready: true, tab, monitorOn: true, srcSel: [] });
  return a;
};
const tick = async (a) => { await a._tickLive(); await new Promise((r) => setTimeout(r, 60)); };

// ── 판정 틱이 설정 화면을 건드리지 않는다 ──────────────────────────────────
for (const [tab, repaint] of [['monitor', true], ['detail', true], ['report', true], ['settings', false]]) {
  const a = mk(tab);
  await tick(a);
  chk((a.repaints > 0) === repaint,
    tab + ' 탭 — 틱이 화면을 ' + (repaint ? '다시 그린다' : '다시 그리지 않는다'), 'repaints=' + a.repaints);
}
// 막은 것은 화면 갱신뿐 — 판정·알림은 설정 화면에서도 계속 돌아야 한다
{
  const a = mk('settings');
  let judged = 0;
  a._judgeLive = () => { judged++; return Promise.resolve(0); };
  await tick(a);
  chk(judged === 1, '설정 탭에서도 판정은 계속 돈다', 'judge=' + judged);
}

// ── 임계값 수정이 저장까지 간다 ────────────────────────────────────────────
{
  const a = mk('settings');
  a.state.classThresh = {}; a.state.unitThresh = {};
  a._setClassThresh('II', 1, '3.5');
  a._setUnitThresh('g', 0, '0.8');
  // state에는 친 문자열 그대로 — 숫자로 만드는 일은 _effZones 한 곳에서만 한다
  chk(a.state.classThresh.II[1] === '3.5' && a.state.unitThresh.g[0] === '0.8', '핸들러가 state에 반영');
  chk(a.state.dirty === true, '저장 필요 표시(dirty)');
  const cfg = a._cfgFromState();
  chk(cfg.classThresh.II[1] === '3.5' && cfg.unitThresh.g[0] === '0.8', '저장 대상(_cfgFromState)에 포함');
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[1] === 3.5, '판정 존이 사용자 값을 쓴다');
  chk(a._effZones({ unit: 'g', cls: 'II' })[0] === 0.8, '단위 임계도 반영');
  // 틱이 돌아도 수정값이 살아 있어야 한다(예전엔 여기서 화면이 되감겼다)
  await tick(a);
  chk(a.state.classThresh.II[1] === '3.5', '틱이 지나도 수정값 유지');
  // 빈 값은 기본값으로 되돌린다(지우기)
  a._setClassThresh('II', 1, '');
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[1] === 2.8, '빈 값이면 ISO 기본값으로 복귀');
}

// ── 소수점 입력 ────────────────────────────────────────────────────────────
/* htm이 preact/compat에 묶여 있어 onChange가 키 입력마다 발화한다. 예전엔 그때마다 parseFloat로
   정규화해 state에 넣고 그 값을 화면에 되돌려줬다 — "1." 이 1이 되어 점이 지워지면서
   1.12 같은 값을 아예 못 쳤다. 지금은 친 문자열을 그대로 담고 쓸 때만 숫자로 만든다. */
{
  const a = mk('settings');
  a.state.classThresh = {}; a.state.unitThresh = {};
  for (const step of ['1', '1.', '1.1', '1.12']) a._setClassThresh('II', 0, step);   // 한 글자씩
  chk(a.state.classThresh.II[0] === '1.12', '★ 소수점 입력이 살아남는다', JSON.stringify(a.state.classThresh.II[0]));
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[0] === 1.12, '   판정에는 숫자로 들어간다');

  // 입력 중간 상태가 칸에 그대로 남아야 다음 글자를 칠 수 있다
  a._setClassThresh('II', 1, '3.');
  const vm = a.renderVals();
  const row = (vm.threshRows || []).find((r) => r.label === 'Class II');
  chk(row && row.v1 === '3.', '   입력 중인 "3." 이 칸에 그대로 남는다', row && JSON.stringify(row.v1));
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[1] === 3, '   그동안 판정값은 3');

  const rowI = (vm.threshRows || []).find((r) => r.label === 'Class I');
  chk(rowI && rowI.v0 === 0.71, '   안 고친 칸은 ISO 기본값', rowI && rowI.v0);

  // 숫자가 아니면 판정이 NaN으로 죽지 않게 기본값으로 돌린다
  a._setClassThresh('II', 2, 'abc');
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[2] === 7.1, '   숫자가 아니면 기본값으로 판정');

  a._setUnitThresh('g', 0, '0.');
  chk(a.state.unitThresh.g[0] === '0.', '   단위 임계도 문자열 보존');
  chk(a._effZones({ unit: 'g', cls: 'II' })[0] === 0, '   단위 임계 파싱');
}

// ── 기본값으로 초기화 ──────────────────────────────────────────────────────
/* 초기화는 저장까지 하지 않는다 — 다른 편집과 같이 저장 버튼으로 확정한다.
   예전엔 dirty를 안 세워서 저장 안내가 뜨지 않았고, 되돌린 뒤 그냥 나가면 조용히 없던 일이 됐다
   (화면은 기본값인데 저장된 값은 옛 값이라 다음에 들어오면 되살아난다). */
{
  const a = mk('settings');
  a.state.classThresh = { II: [null, '3.5'] }; a.state.unitThresh = { g: ['0.8'] };
  a.state.dirty = false;
  let toast = '';
  a._toast = (m) => { toast = m; };
  a.renderVals().onResetThresh();
  chk(Object.keys(a.state.classThresh).length === 0 && Object.keys(a.state.unitThresh).length === 0,
    '초기화가 사용자 임계값을 비운다');
  chk(a.state.dirty === true, '★ 초기화도 저장 필요 표시(dirty) — 안 세우면 조용히 유실된다');
  chk(/저장해야/.test(toast), '   알림이 저장이 필요함을 밝힌다', toast);
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[1] === 2.8, '   화면 값은 ISO 기본값으로');
}

// ── 저장 버튼 도달성 ───────────────────────────────────────────────────────
/* 판정 기준 섹션은 임계값 표 아래로 태그 목록이 길게 이어져, 값을 고친 뒤 한참 내려가야
   저장 버튼이 나왔다("저장 클릭이 없어"). 하단 고정 + 카드 안 저장 둘 다 있어야 한다. */
{
  const renderToString = (await import('preact-render-to-string')).default;
  const { view } = await import('../src/view.js');
  const Mock = (await import('./mock.js')).default;
  const a = mk('settings');
  a._ensureTags = () => {}; a._refreshBandCov = () => {};
  const d = Mock.generateData(42, 5);
  d.equipment.forEach((e) => { e.fs = 25600; });
  a.data = d; a.liveTables = ['T1'];
  Object.assign(a.state, { srcSel: ['T1'], setSection: 'criteria', dirty: true });
  const h = renderToString(view(a.renderVals()));
  const n = (h.match(/>저장</g) || []).length;
  chk(n >= 2, '판정 기준 — 저장 버튼 2개(카드 안 + 하단 고정)', n + '개');
  chk(/position: sticky; bottom: 0/.test(h), '하단 저장 막대가 고정된다');
  chk(/저장하지 않은 변경사항/.test(h), '미저장 상태를 알린다');
  for (const sec of ['source', 'equip', 'criteria', 'monitor', 'llm', 'data']) {
    a.state.setSection = sec;
    chk(/>저장</.test(renderToString(view(a.renderVals()))), '  ' + sec + ' 섹션에도 저장 버튼');
  }
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
