/* 상세분석 "분석 중" 표시 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   파형·스펙트럼·계측 검증은 조회가 끝나야 나온다. 그전까지 화면은 경고 없이 멀쩡해 보이는데,
   클리핑 같은 계측 이상 경고가 몇 초 뒤에야 뜨는 그 구간이 정확히 "이상 없음"으로 오독되는 구간이다.
   계산 중이라는 사실과, 판정이 아직 확정 아님을 화면이 말해야 한다. */
globalThis.window = globalThis;
import renderToString from 'preact-render-to-string';

const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const mk = (state) => {
  const app = new App({ defaultTab: 'detail', seed: 42, equipmentCount: 5 });
  app.setState = function (s) { Object.assign(this.state, s); };
  app._scheduleDraw = () => {}; app._toast = () => {};
  app.E = CH; app.live = true; app.forceUpdate = () => {};
  const d = Mock.generateData(42, 5);
  d.equipment.forEach((e) => { e.fs = 25600; });
  app.data = d;
  app.liveTables = ['VIBRATION_RAW'];
  const eq = d.equipment[0];
  Object.assign(app.state, {
    ready: true, tab: 'detail', srcSel: app.liveTables.slice(), selTag: eq.id,
    events: [], reports: [],
  });
  // 캐시를 실제와 같은 모양으로 심는다 — 키가 어긋나면 _detail이 캐시를 버리고 조회를 시작한다
  app._detailCache[eq.id] = {
    state, det: Mock.buildDetail(eq), key: app._detailKey(), anchor: app._detailAnchorMs(eq),
    viewUnit: app.state.viewUnit || null, gate: null,
    eqSnap: Object.assign({}, eq), snapNow: d.now,
  };
  return app;
};

// ── 조회 중 ────────────────────────────────────────────────────────────────
{
  const app = mk('loading');
  const v = app.renderVals();
  chk(v.detBusy === true, '조회 중에는 분석 중 상태가 선다');
  chk(!!v.detBusyText && /분석 중/.test(v.detBusyText), '무엇을 하는 중인지 적는다', v.detBusyText);
  chk(/확정/.test(v.detBusyText), '판정이 아직 확정이 아님을 밝힌다 — 이 문장이 오독을 막는다');
  chk(/분석 중/.test(v.dxVerdict), '결론 자리에 결론 대신 진행 중임을 적는다', v.dxVerdict);
  chk(v.detWarn === '', '조회 중에는 실패·빈 구간 배너를 함께 띄우지 않는다', JSON.stringify(v.detWarn));
  const html = renderToString(view(v));
  chk(html.indexOf(v.detBusyText) >= 0, '배너가 실제로 렌더된다(htm은 런타임 파싱이라 값만 봐선 부족)');
  chk(/vspin/.test(html), '진행 중임이 보이게 회전 표시가 붙는다');
}
// ── 완료 ──────────────────────────────────────────────────────────────────
{
  const app = mk('ready');
  const v = app.renderVals();
  chk(v.detBusy === false, '끝나면 분석 중 표시가 사라진다');
  chk(!/분석 중/.test(v.dxVerdict), '끝나면 실제 판정이 결론 자리에 온다', v.dxVerdict);
  const html = renderToString(view(v));
  chk(html.indexOf('분석 중 — 파형') < 0, '완료 화면에 진행 배너가 남지 않는다');
}
// ── 실패 ──────────────────────────────────────────────────────────────────
{
  const app = mk('error');
  const v = app.renderVals();
  chk(v.detBusy === false, '실패는 진행 중이 아니다');
  chk(/조회에 실패/.test(v.detWarn), '실패는 실패라고 적는다', v.detWarn);
  const html = renderToString(view(v));
  chk(html.indexOf(v.detWarn) >= 0, '실패 배너가 렌더된다');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
