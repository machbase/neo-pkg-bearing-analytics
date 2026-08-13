/* 직접 입력 기간의 '적용' 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   네이티브 datetime 피커에는 확인 단추가 없다. 값이 바뀔 때마다 커밋하면 날짜만 고르고 시각을
   아직 안 고른 중간 구간으로 조회가 나가고, 사용자는 무엇이 반영됐는지 알 수 없다.
   그래서 고르는 동안은 초안(fromD/toD)에만 담고 '적용'에서 커밋한다.
   리포트는 초안도 조회 구간으로 인정한다 — 적용을 잊고 생성하면 화면과 다른 기간이 인쇄되기 때문이다. */
globalThis.window = globalThis;
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data: { rows: [] } }) });

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const NOW = Date.UTC(2026, 7, 13, 9, 0, 0);
const mk = (st) => {
  const a = new App({ seed: 1, equipmentCount: 1 });
  a.setState = function (s) { Object.assign(this.state, s); };
  a._scheduleDraw = () => {}; a._toast = () => {}; a._closePicker = () => {};
  a.E = CH; a.live = true; a.forceUpdate = () => {};
  a.data = { now: NOW, equipment: [], events: [], reports: [] };
  Object.assign(a.state, {
    ready: true, tab: 'detail', srcSel: [], selTag: null,
    period: 'custom', from: '2026-08-13T00:00', to: '2026-08-13T06:00',
    genPeriod: 'custom', genTags: [], genFrom: '2026-08-01T00:00', genTo: '2026-08-02T00:00',
  }, st || {});
  return a;
};

// ── 상세분석 ────────────────────────────────────────────────────────────
{
  const a = mk();
  const v = a.renderVals();
  chk(v.periodApplyShow === true, '직접 입력이면 적용 단추가 나온다');
  chk(v.periodApplyOff === true, '고친 것이 없으면 눌리지 않는다 — 누를 수 있으면 반영된 줄 오해한다');
  chk(v.periodFrom === '2026-08-13T00:00', '초안이 없으면 커밋값을 보여준다', v.periodFrom);
}
{ // 프리셋 구간에서는 적용 단추 자체가 없다(입력칸도 비활성)
  const a = mk({ period: '1h' });
  chk(a.renderVals().periodApplyShow === false, '프리셋 구간에는 적용 단추가 없다');
}
{ // 고르는 동안은 커밋되지 않는다 — 이것이 중간 구간 조회를 막는 지점
  const a = mk();
  a.renderVals().onFromChange({ target: { value: '2026-08-12T00:00' } });
  chk(a.state.from === '2026-08-13T00:00', '고르는 중에는 조회 구간이 그대로다', a.state.from);
  chk(a.state.fromD === '2026-08-12T00:00', '고른 값은 초안에 담긴다', a.state.fromD);
  const v2 = a.renderVals();
  chk(v2.periodFrom === '2026-08-12T00:00', '화면은 초안을 보여준다', v2.periodFrom);
  chk(v2.periodApplyOff === false, '고친 것이 있으면 적용이 켜진다');
}
{ // 적용 = 커밋 + 초안 비움
  const a = mk();
  a.renderVals().onFromChange({ target: { value: '2026-08-12T00:00' } });
  a.renderVals().onPeriodApply();
  chk(a.state.from === '2026-08-12T00:00', '적용하면 조회 구간이 바뀐다', a.state.from);
  chk(a.state.fromD === null && a.state.toD === null, '적용 후 초안은 비워진다');
  chk(a.renderVals().periodApplyOff === true, '적용 후에는 다시 눌리지 않는다');
}
{ // Enter도 같은 확정 수단 — 피커를 연 채 키보드로 끝낼 수 있어야 한다
  const a = mk();
  a.renderVals().onToChange({ target: { value: '2026-08-13T09:00' } });
  let prevented = 0;
  a.renderVals().onPeriodKey({ key: 'Enter', preventDefault: () => { prevented++; } });
  chk(a.state.to === '2026-08-13T09:00', 'Enter로도 적용된다', a.state.to);
  chk(prevented === 1, 'Enter의 기본 동작(폼 제출)은 막는다');
}
{ // 뒤집힌 구간은 적용을 막고 이유를 화면에 적는다 — 토스트는 사라지므로 문구가 남아야 한다
  const a = mk();
  a.renderVals().onFromChange({ target: { value: '2026-08-13T23:00' } });
  const v = a.renderVals();
  chk(v.periodApplyOff === true, '시작이 종료보다 늦으면 적용이 막힌다');
  chk(!!v.periodBad, '왜 막혔는지 화면에 남는다', v.periodBad);
  v.onPeriodApply();
  chk(a.state.from === '2026-08-13T00:00', '막힌 값은 커밋되지 않는다', a.state.from);
}
{ // 프리셋으로 옮기면 초안은 버린다 — 남기면 '직접 입력'으로 돌아왔을 때 옛 편집이 되살아난다
  const a = mk();
  a.renderVals().onFromChange({ target: { value: '2026-08-12T00:00' } });
  const chips = a.renderVals().periodPresets;
  const oneH = chips.find((c) => c.label === '1시간');
  if (oneH) oneH.onClick();
  chk(a.state.fromD === null && a.state.toD === null, '프리셋을 고르면 초안이 사라진다');
}

// ── 리포트 ──────────────────────────────────────────────────────────────
{
  const a = mk({ tab: 'report' });
  const v = a.renderVals();
  chk(v.genApplyOff === true, '리포트도 고친 것이 없으면 적용이 꺼져 있다');
  v.onGenFromChange({ target: { value: '2026-07-20T00:00' } });
  chk(a.state.genFrom === '2026-08-01T00:00', '리포트도 고르는 중에는 커밋하지 않는다', a.state.genFrom);
  const v2 = a.renderVals();
  chk(v2.genPeriodFrom === '2026-07-20T00:00', '리포트 화면도 초안을 보여준다', v2.genPeriodFrom);
  chk(v2.genApplyOff === false, '리포트 적용 단추가 켜진다');

  /* 적용을 누르지 않아도 생성 구간은 화면과 같아야 한다.
     여기서 커밋값을 쓰면 "화면엔 7월인데 8월 리포트가 나오는" 조용한 오차가 된다. */
  const w = a._rollWindow(NOW, { minMs: Date.UTC(2026, 0, 1) }, 'report');
  chk(w.fromMs === Date.parse('2026-07-20T00:00'), '적용 전에도 리포트는 화면에 보이는 구간으로 조회한다',
    new Date(w.fromMs).toISOString());

  v2.onGenPeriodApply();
  chk(a.state.genFrom === '2026-07-20T00:00' && a.state.genFromD === null, '리포트 적용도 커밋 후 초안을 비운다');
}
{ // 상세분석은 초안을 조회에 섞지 않는다 — 캐시 키가 커밋값이라 섞으면 키와 내용이 어긋난다
  const a = mk();
  a.renderVals().onFromChange({ target: { value: '2026-07-01T00:00' } });
  const w = a._rollWindow(NOW, { minMs: Date.UTC(2026, 0, 1) }, 'detail');
  chk(w.fromMs === Date.parse('2026-08-13T00:00'), '상세분석은 적용 전 초안으로 조회하지 않는다',
    new Date(w.fromMs).toISOString());
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
