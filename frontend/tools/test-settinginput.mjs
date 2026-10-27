/* 설정 입력 유실 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 판정 틱이 설정·상세분석 화면을 다시 그리지 않음(제어 입력에 옛 상태값 덮어쓰기 방지), 판정은 계속
   · 임계값 수정·소수점 입력·기본값 초기화가 저장(dirty)까지 도달, 상세분석 스냅샷 유지
   · 모든 설정 섹션에 저장 버튼(판정 기준은 카드 안 + 하단 고정) */
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
  a.state.user = 'TESTER';   // 토큰·계정 확인을 마친 상태
  a._scheduleDraw = () => {}; a._toast = () => {};
  a.E = CH; a.live = true; a.repaints = 0; a.forceUpdate = function () { this.repaints++; };
  a._refreshRunState = () => {}; a._judgeLive = () => Promise.resolve(0);
  a._syncMonitorTimer = () => Promise.resolve(); a._syncBandTimer = () => Promise.resolve();
  a.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  Object.assign(a.state, { ready: true, tab, monitorOn: true, srcSel: [] });
  return a;
};
const tick = async (a) => { await a._tickLive(); await new Promise((r) => setTimeout(r, 60)); };

// ── 판정 틱이 설정·상세분석 화면 미갱신 ─────────────────────────
// 상세분석은 캡처 스냅샷 화면 — 새로고침·태그전환·기간변경으로만 갱신
for (const [tab, repaint] of [['monitor', true], ['detail', false], ['report', true], ['settings', false]]) {
  const a = mk(tab);
  await tick(a);
  chk((a.repaints > 0) === repaint,
    tab + ' 탭 — 틱이 화면을 ' + (repaint ? '다시 그린다' : '다시 그리지 않는다'), 'repaints=' + a.repaints);
}
/* 상세분석 스냅샷 — 재캡처는 사용자 선택(기간·기준시각·표시 물리량)으로만 판단
   (앵커는 lastSeen에 물려 있어 앵커 기준이면 판정 틱마다 재캡처) */
{
  const a = mk('detail');
  const eq = { id: 'e1', table: 'T', name: 'tag', lastSeen: 1700000000000, stat: { minMs: 1699999000000, maxMs: 1700000000000 } };
  Object.assign(a.state, { period: 'all', from: '2023-11-15T10:00', to: '2023-11-15T11:00', detailAnchor: null, viewUnit: null });
  const key = a._detailKey();
  const snap = { state: 'ready', det: {}, eqSnap: Object.assign({}, eq), snapNow: eq.lastSeen, key, anchor: 1700000000001, viewUnit: null, gate: null };
  a._detailCache[eq.id] = snap;
  a._detail(eq);
  eq.lastSeen += 3000;                 // 판정 틱이 최신 수집 시각 전진
  a._detail(eq);
  chk(a._detailCache[eq.id] === snap, '★ 상세분석 — lastSeen이 전진해도 스냅샷을 다시 잡지 않는다');
  chk(a._detailCache[eq.id].anchor === 1700000000001, '   기준 시각도 캡처 시점 값 그대로', 'anchor=' + a._detailCache[eq.id].anchor);
  a._runState = { 'T:tag': { gate: { label: '플랫라인', detail: '' } } };
  chk(a._detailCache[eq.id].gate === null, '   감시가 계측 이상을 새로 봐도 스냅샷의 게이트는 그대로');
  chk(a._gateOf(eq).label === '플랫라인', '   라이브 게이트는 따로 읽힌다(배너 비교용)');
  a.setState({ period: '1h' });        // 사용자가 기간을 바꾸면 재캡처
  chk(a._detailKey() !== key, '   조회 기간을 바꾸면 재캡처된다');
}

// 막은 것은 화면 갱신뿐 — 판정·알림은 설정 화면에서도 계속
{
  const a = mk('settings');
  let judged = 0;
  a._judgeLive = () => { judged++; return Promise.resolve(0); };
  await tick(a);
  chk(judged === 1, '설정 탭에서도 판정은 계속 돈다', 'judge=' + judged);
}

// ── 임계값 수정이 저장까지 도달 ────────────────────────────────────────────
{
  const a = mk('settings');
  a.state.classThresh = {}; a.state.unitThresh = {};
  a._setClassThresh('II', 1, '3.5');
  a._setUnitThresh('g', 0, '0.8');
  // state엔 입력 문자열 그대로 — 숫자 변환은 _effZones 한 곳에서만
  chk(a.state.classThresh.II[1] === '3.5' && a.state.unitThresh.g[0] === '0.8', '핸들러가 state에 반영');
  chk(a.state.dirty === true, '저장 필요 표시(dirty)');
  const cfg = a._cfgFromState();
  chk(cfg.classThresh.II[1] === '3.5' && cfg.unitThresh.g[0] === '0.8', '저장 대상(_cfgFromState)에 포함');
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[1] === 3.5, '판정 존이 사용자 값을 쓴다');
  chk(a._effZones({ unit: 'g', cls: 'II' })[0] === 0.8, '단위 임계도 반영');
  // 틱이 돌아도 수정값 유지
  await tick(a);
  chk(a.state.classThresh.II[1] === '3.5', '틱이 지나도 수정값 유지');
  // 빈 값은 기본값으로 복귀(지우기)
  a._setClassThresh('II', 1, '');
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[1] === 2.8, '빈 값이면 ISO 기본값으로 복귀');
}

// ── 소수점 입력 ────────────────────────────────────────────────────────────
/* htm이 preact/compat에 묶여 onChange가 키 입력마다 발화 — 입력 문자열을 그대로 담고 쓸 때만 숫자로 변환("1." 보존) */
{
  const a = mk('settings');
  a.state.classThresh = {}; a.state.unitThresh = {};
  for (const step of ['1', '1.', '1.1', '1.12']) a._setClassThresh('II', 0, step);   // 한 글자씩
  chk(a.state.classThresh.II[0] === '1.12', '★ 소수점 입력이 살아남는다', JSON.stringify(a.state.classThresh.II[0]));
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[0] === 1.12, '   판정에는 숫자로 들어간다');

  // 입력 중간 상태가 칸에 그대로 남아야 다음 글자 입력 가능
  a._setClassThresh('II', 1, '3.');
  const vm = a.renderVals();
  const row = (vm.threshRows || []).find((r) => r.label === 'Class II');
  chk(row && row.v1 === '3.', '   입력 중인 "3." 이 칸에 그대로 남는다', row && JSON.stringify(row.v1));
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[1] === 3, '   그동안 판정값은 3');

  const rowI = (vm.threshRows || []).find((r) => r.label === 'Class I');
  chk(rowI && rowI.v0 === 0.71, '   안 고친 칸은 ISO 기본값', rowI && rowI.v0);

  // 숫자가 아니면 NaN 방지로 기본값 판정
  a._setClassThresh('II', 2, 'abc');
  chk(a._effZones({ unit: 'mm/s', cls: 'II' })[2] === 7.1, '   숫자가 아니면 기본값으로 판정');

  a._setUnitThresh('g', 0, '0.');
  chk(a.state.unitThresh.g[0] === '0.', '   단위 임계도 문자열 보존');
  chk(a._effZones({ unit: 'g', cls: 'II' })[0] === 0, '   단위 임계 파싱');
}

// ── 기본값으로 초기화 ──────────────────────────────────────────────────────
/* 초기화는 저장까지 하지 않고 저장 버튼으로 확정 — dirty를 세워 저장 안내 표시(안 세우면 나갈 때 조용히 유실) */
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
/* 판정 기준 섹션은 태그 목록이 길어 저장 버튼이 멀어짐 → 하단 고정 + 카드 안 저장 둘 다 필요 */
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
