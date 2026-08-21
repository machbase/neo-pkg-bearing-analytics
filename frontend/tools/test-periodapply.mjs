/* 기간 달력(DateRange)과 그 적용 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   달력에서 고른 값은 위젯 안에만 있고 '적용'을 눌러야 조회 구간이 된다. 고르는 도중에 커밋하면
   날짜만 정하고 시각은 아직인 중간 구간으로 조회가 나가고, 사용자는 무엇이 반영됐는지 알 수 없다. */
globalThis.window = globalThis;
globalThis.window.innerWidth = 1280;
globalThis.window.innerHeight = 900;
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data: { rows: [] } }) });

const { render } = await import('preact-render-to-string');
const { html } = await import('../src/html.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');
const { DateRange, pickerOpen } = await import('../src/daterange.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const NOW = Date.UTC(2026, 7, 13, 9, 0, 0);
const mk = (st) => {
  const a = new App({ seed: 1, equipmentCount: 1 });
  a.setState = function (s) { Object.assign(this.state, s); };
  a._scheduleDraw = () => {}; a._toast = () => {};
  a.E = CH; a.live = true; a.forceUpdate = () => {};
  a.data = { now: NOW, equipment: [], events: [], reports: [] };
  Object.assign(a.state, {
    ready: true, tab: 'detail', srcSel: [], selTag: null,
    period: 'custom', from: '2026-08-13T00:00', to: '2026-08-13T06:00',
    genPeriod: 'custom', genTags: [], genFrom: '2026-08-01T00:00', genTo: '2026-08-02T00:00',
  }, st || {});
  return a;
};
// 위젯은 상태만으로 검사한다 — 그리기(DOM) 없이 열기·고르기·적용까지 같은 경로를 탄다
const mkPicker = (props) => {
  const p = new DateRange(Object.assign({ from: '2026-08-13T00:00', to: '2026-08-13T06:00' }, props || {}));
  p.setState = function (s) { Object.assign(this.state, s); };
  return p;
};
const day = (y, m, d) => new Date(y, m - 1, d).getTime();

// ── 달력 위젯 ───────────────────────────────────────────────────────────
{ // 여는 순간 지금 구간이 초안이 된다 — 빈 달력에서 다시 고르게 하면 하루짜리 조정도 두 번 일이다
  const p = mkPicker();
  p._open();
  chk(p.state.open === true, '버튼을 누르면 달력이 열린다');
  chk(p.state.fromDay === day(2026, 8, 13) && p.state.ft === '00:00', '지금 조회 중인 구간이 초안으로 들어온다', p.state.ft);
  chk(p.state.tt === '06:00', '시각도 그대로 들고 온다', p.state.tt);
  p._close();
}
{ // 고르는 동안은 바깥으로 아무것도 나가지 않는다 — 여기가 중간 구간 조회를 막는 지점
  let applied = 0;
  const p = mkPicker({ onApply: () => { applied++; } });
  p._open();
  p._pickDay(day(2026, 8, 10));
  p._pickDay(day(2026, 8, 12));
  chk(applied === 0, '날짜를 고르는 동안에는 적용이 일어나지 않는다');
  chk(p.state.fromDay === day(2026, 8, 10) && p.state.toDay === day(2026, 8, 12), '첫 클릭이 시작, 다음 클릭이 종료', p.state.pick);
  p._pickDay(day(2026, 8, 20));
  chk(p.state.fromDay === day(2026, 8, 20) && p.state.toDay === day(2026, 8, 20), '구간을 다 고른 뒤의 클릭은 새 구간의 시작이다');
}
{ // 고르는 중(종료를 기다리는 상태)에 시작보다 앞을 누르면 뒤집지 않고 그쪽을 새 시작으로 삼는다
  const p = mkPicker();
  p._open();
  p._pickDay(day(2026, 8, 12));
  p._pickDay(day(2026, 8, 5));
  chk(p.state.fromDay === day(2026, 8, 5) && p.state.toDay === day(2026, 8, 12), '거꾸로 골라도 구간이 뒤집히지 않는다', p.state.pick);
}
{ // 적용에서만 값이 나간다
  let got = null;
  const p = mkPicker({ onApply: (f, t) => { got = [f, t]; } });
  p._open();
  p._pickDay(day(2026, 8, 10));
  p._pickDay(day(2026, 8, 12));
  p.setState({ ft: '08:30', tt: '17:00' });
  p._apply();
  chk(got && got[0] === '2026-08-10T08:30' && got[1] === '2026-08-12T17:00', '적용하면 고른 구간이 그대로 나간다', got && got.join(' ~ '));
  chk(p.state.open === false, '적용하면 달력이 닫힌다');
}
{ // 뒤집힌 구간은 적용 자체가 막힌다
  let applied = 0;
  const p = mkPicker({ onApply: () => { applied++; } });
  p._open();
  p._pickDay(day(2026, 8, 12));
  p.setState({ ft: '23:00', tt: '01:00' });
  chk(p._range().bad === true, '종료가 시작보다 빠르면 잘못된 구간으로 본다');
  p._apply();
  chk(applied === 0, '잘못된 구간은 적용되지 않는다');
  chk(p.state.open === true, '막혔으면 달력도 닫지 않는다 — 닫으면 무엇이 잘못됐는지 볼 수 없다');
}
{ // 날짜만 쓰는 자리(내보내기·삭제)는 시각을 하루 경계로 채운다
  let got = null;
  const p = mkPicker({ mode: 'date', from: '2026-08-01', to: '2026-08-03', onApply: (f, t) => { got = [f, t]; } });
  p._open();
  p._apply();
  chk(got && got[0] === '2026-08-01' && got[1] === '2026-08-03', '날짜 모드는 날짜만 내보낸다', got && got.join(' ~ '));
}
{ // 흘려 적은 시각을 되돌린다 — 세 자리(930)는 09:30이 자연스럽다
  const p = mkPicker();
  p._open();
  p._timeFix('ft', '00:00')({ target: { value: '930' } });
  chk(p.state.ft === '09:30', "'930' → 09:30", p.state.ft);
  p._timeFix('tt', '23:59')({ target: { value: '9' } });
  chk(p.state.tt === '09:00', "'9' → 09:00", p.state.tt);
  p._timeFix('ft', '00:00')({ target: { value: '' } });
  chk(p.state.ft === '00:00', '비우면 기본 시각으로 돌아간다', p.state.ft);
}
// ── 조회 기간은 일 단위로 고른다 ─────────────────────────────────────────
{ /* 시·분까지 맞추는 것은 손이 많이 가고, 실제로 필요한 짧은 창은 프리셋(1시간·6시간)과
     이벤트 클릭(그 시각 ±30분)이 이미 준다. 달력은 날짜만 받고 하루 전체를 뜻한다. */
  let got = null;
  const p = mkPicker({ showTime: false, onApply: (f, t) => { got = [f, t]; } });
  p._open();
  chk(p.state.ft === '00:00' && p.state.tt === '23:59', '날짜만 고르는 달력은 하루 전체를 잡는다', p.state.ft + '~' + p.state.tt);
  p._pickDay(day(2026, 8, 10));
  p._pickDay(day(2026, 8, 12));
  p._apply();
  chk(got && got[0] === '2026-08-10T00:00' && got[1] === '2026-08-12T23:59', '값은 날짜+시각 형식 그대로 나간다', got && got.join(' ~ '));
  chk(!render(p._panel()).includes('value="00:00"'), '시각 입력칸은 아예 없다');
}
{ // 하루 경계가 아닌 구간(프리셋·이벤트 클릭)은 버튼에 시각까지 적어야 무슨 창인지 알 수 있다
  const dayPick = render(html`<${DateRange} from="2026-08-10T00:00" to="2026-08-12T23:59" showTime=${false} />`);
  chk(dayPick.includes('08-10 ~ 08-12'), '달력으로 고른 구간은 날짜만 적는다', (dayPick.match(/<span>[^<]*~[^<]*<\/span>/) || [])[0]);
  const evPick = render(html`<${DateRange} from="2026-08-13T08:30" to="2026-08-13T09:30" showTime=${false} />`);
  chk(evPick.includes('08-13 08:30 ~ 08-13 09:30'), '하루 안의 창은 시각까지 적는다', (evPick.match(/<span>[^<]*~[^<]*<\/span>/) || [])[0]);
}
{ // 상세분석·리포트 달력은 시각을 받지 않는다
  const a = mk();
  chk(a.renderVals().periodRange.showTime === false, '상세분석 달력은 일 단위');
  const b = mk({ tab: 'report' });
  chk(b.renderVals().genRange.showTime === false, '리포트 달력도 일 단위');
}

// ── 차트는 데이터가 있는 구간만 ──────────────────────────────────────────
const STAT = { minMs: Date.parse('2026-08-03T04:00'), maxMs: Date.parse('2026-08-12T09:30') };
{ /* 하루 단위로 고르면 마지막 날 대부분이 데이터 없는 시간이다. 그대로 조회하면 축이 거기까지
     늘어나 빈 여백이 생기고, 버킷 단위도 실제보다 긴 구간 기준으로 잡혀 해상도를 잃는다. */
  const a = mk({ period: 'custom', from: '2026-08-03T00:00', to: '2026-08-12T23:59' });
  const w = a._rollWindow(NOW, STAT, 'detail');
  chk(w.fromMs === STAT.minMs, '데이터가 시작되는 시각부터 조회한다', new Date(w.fromMs).toISOString());
  chk(w.toMs === STAT.maxMs, '데이터가 끝나는 시각까지만 조회한다', new Date(w.toMs).toISOString());
}
{ // 데이터 안쪽으로 좁혀 고른 구간은 건드리지 않는다
  const a = mk({ period: 'custom', from: '2026-08-05T00:00', to: '2026-08-06T23:59' });
  const w = a._rollWindow(NOW, STAT, 'detail');
  chk(w.fromMs === Date.parse('2026-08-05T00:00') && w.toMs === Date.parse('2026-08-06T23:59'), '데이터 안쪽 구간은 고른 그대로 조회한다');
}
{ /* 구간과 데이터가 아예 어긋나면 좁히지 않는다 — 당기면 요청과 다른 시기의 데이터를 보여주게 되고,
     리포트라면 "그 기간을 분석했다"는 잘못된 기록이 남는다. 빈 구간은 빈 채로 알린다. */
  const a = mk({ period: 'custom', from: '2026-09-01T00:00', to: '2026-09-05T23:59' });
  const w = a._rollWindow(NOW, STAT, 'detail');
  chk(w.fromMs === Date.parse('2026-09-01T00:00') && w.toMs === Date.parse('2026-09-05T23:59'), '데이터와 겹치지 않는 구간은 당기지 않는다');
}
{ // 리포트도 같은 규칙 — 리포트에 적히는 관측 창이 실제 조회 구간과 같아야 한다
  const a = mk({ tab: 'report', genPeriod: 'custom', genFrom: '2026-08-01T00:00', genTo: '2026-08-31T23:59' });
  const w = a._rollWindow(NOW, STAT, 'report');
  chk(w.fromMs === STAT.minMs && w.toMs === STAT.maxMs, '리포트 기간도 데이터가 있는 만큼으로 좁힌다');
}
{ // 구간이 짧아진 만큼 버킷도 촘촘해진다 — 좁히지 않으면 하루치를 시간별로 그리게 된다
  const a = mk({ period: 'custom', from: '2026-08-12T00:00', to: '2026-08-12T23:59' });
  const w = a._rollWindow(NOW, { minMs: Date.parse('2026-08-12T08:00'), maxMs: Date.parse('2026-08-12T09:00') }, 'detail');
  chk(w.unit === 'sec', '데이터가 1시간뿐이면 초별로 그린다', w.unit + ' (' + w.label + ')');
}

// ── 데이터가 있는 구간만 고를 수 있다 ────────────────────────────────────
const BND = { minMs: new Date(2026, 7, 3).getTime(), maxMs: new Date(2026, 7, 12, 9, 30).getTime() };
{ // 빈 구간을 골라 봐야 빈 차트·빈 리포트가 나오고, 그것이 "이상 없음"으로 읽힌다
  const p = mkPicker(Object.assign({ from: '2026-08-05T00:00', to: '2026-08-06T00:00' }, BND));
  p._open();
  p._pickDay(day(2026, 8, 1));
  chk(p.state.fromDay === day(2026, 8, 5), '데이터 시작 전 날짜는 눌러도 안 잡힌다', new Date(p.state.fromDay).getDate());
  p._pickDay(day(2026, 8, 20));
  chk(p.state.toDay === day(2026, 8, 6), '데이터 끝 뒤 날짜도 안 잡힌다', new Date(p.state.toDay).getDate());
  p._pickDay(day(2026, 8, 3));
  p._pickDay(day(2026, 8, 12));
  chk(p.state.fromDay === day(2026, 8, 3) && p.state.toDay === day(2026, 8, 12), '구간의 양 끝날은 고를 수 있다');
}
{ // 데이터가 오늘까지 오지 않는 태그(정지 설비·적재가 끝난 표)는 마지막 날이 기준이다
  const p = mkPicker(Object.assign({}, BND));
  p._open();
  const q = p._quick();
  chk(q[0].label === '마지막 날', "오늘 데이터가 없으면 '오늘' 대신 '마지막 날'로 적는다", q[0].label);
  q[0].on();
  chk(p.state.fromDay === day(2026, 8, 12) && p.state.toDay === day(2026, 8, 12), '마지막 날 = 데이터가 있는 마지막 날', new Date(p.state.toDay).getDate());
  q[2].on();
  chk(p.state.fromDay === day(2026, 8, 6) && p.state.toDay === day(2026, 8, 12), '최근 7일도 마지막 날에서 거꾸로 센다', new Date(p.state.fromDay).getDate());
  q[3].on();
  chk(p.state.fromDay === day(2026, 8, 3), '데이터 시작보다 앞으로는 안 간다 (최근 30일)', new Date(p.state.fromDay).getDate());
}
{ // 데이터가 오늘까지 있으면 평소대로 오늘 기준
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const p = mkPicker({ minMs: today.getTime() - 40 * 86400000, maxMs: Date.now() });
  p._open();
  chk(p._quick()[0].label === '오늘', "오늘까지 데이터가 있으면 '오늘'이다");
}
{ // 열자마자 빈 달을 보고 넘겨야 하는 일이 없어야 한다
  const p = mkPicker(Object.assign({ from: '2026-08-05T00:00', to: '2026-08-06T00:00' }, BND));
  p._open();
  chk(p.state.view === new Date(2026, 7, 1).getTime(), '데이터가 한 달 안에 있으면 그 달부터 펼친다', new Date(p.state.view).toDateString());
}
{ /* 달 이동은 데이터가 있는 달까지만. 단 화살표를 흐리게 죽이지는 않는다 — 흐린 단추는
     "왜 안 눌리는지"를 사용자가 짚어야 한다. 눌리게 두고 이유를 팝오버에 적는다. */
  const p = mkPicker(Object.assign({}, BND));
  p._open();
  const view0 = p.state.view;
  const prev = render(p._panel()).split('<button').find((b) => /chevron-left/.test(b));
  chk(!/disabled/.test(prev) && !/opacity/.test(prev.split('>')[0]), '갈 곳이 없어도 화살표는 흐려지거나 잠기지 않는다');
  p._navMonth(-1);
  chk(p.state.view === view0, '데이터가 없는 쪽으로는 달이 넘어가지 않는다');
  chk(p.state.notice === '이전 달에는 데이터가 없습니다', '왜 안 넘어가는지 팝오버가 말한다', p.state.notice);
  chk(render(p._panel()).includes('이전 달에는 데이터가 없습니다'), '그 문구가 화면에 그려진다');
  chk(render(p._panel()).includes('데이터 2026-08-03 ~ 2026-08-12') === false, '안내가 떠 있는 동안은 그 자리에 데이터 구간 대신 이유가 온다');
}
{ // 데이터 없는 날짜도 눌리면 이유를 말한다 — 무시만 하면 고장으로 읽힌다
  const p = mkPicker(Object.assign({ from: '2026-08-05T00:00', to: '2026-08-06T00:00' }, BND));
  p._open();
  p._pickDay(day(2026, 8, 20));
  chk(p.state.notice === '그 날짜에는 데이터가 없습니다', '데이터 없는 날을 누르면 이유가 뜬다', p.state.notice);
  p._pickDay(day(2026, 8, 10));
  chk(p.state.notice === '' && p.state.fromDay === day(2026, 8, 10), '되는 날짜를 누르면 안내는 사라진다');
}
{ // 구간을 모르면(통계 없음) 아무것도 막지 않는다 — 모른다고 잠그면 고를 방법이 없다
  const p = mkPicker();
  p._open();
  p._pickDay(day(2020, 1, 1));
  chk(p.state.fromDay === day(2020, 1, 1), '데이터 구간을 모르면 어떤 날짜든 고를 수 있다');
}

{ // 열린 동안은 화면 자동 갱신을 멈춘다 — 고르는 중에 값이 되돌려지면 안 된다
  const before = pickerOpen.n;
  const p = mkPicker();
  p._open();
  chk(pickerOpen.n === before + 1, '달력이 열리면 틱이 멈춘다');
  p._close();
  chk(pickerOpen.n === before, '닫으면 다시 돈다');
}

// ── 상세분석 ────────────────────────────────────────────────────────────
{
  const a = mk();
  const v = a.renderVals();
  chk(v.periodRange.active === true, '직접 고른 구간이면 달력 버튼이 켜져 보인다');
  chk(v.periodRange.from === '2026-08-13T00:00' && v.periodRange.to === '2026-08-13T06:00', '버튼에는 지금 조회 구간이 적힌다', v.periodRange.from);
  chk(!v.periodPresets.some((c) => c.label === '직접 입력'), "'직접 입력' 칩은 없다 — 달력 버튼이 그 자리를 대신한다");
}
{ // 프리셋 구간은 지금 시각에 붙어 있다 — 고른 순간의 옛 구간을 적으면 조회 결과와 어긋난다
  const a = mk({ period: '1h', from: '2026-08-01T00:00', to: '2026-08-01T01:00' });
  const v = a.renderVals();
  chk(v.periodRange.active === false, '프리셋이면 달력 버튼은 꺼져 보인다');
  chk(v.periodRange.to === a.E.fmtDT(NOW).replace(' ', 'T'), '프리셋 구간은 지금 기준으로 다시 적는다', v.periodRange.to);
}
{ // 적용 = 커밋 + 직접 입력으로 전환 (프리셋을 쓰던 중에도 달력만으로 들어갈 수 있어야 한다)
  const a = mk({ period: '1h' });
  a.renderVals().periodRange.onApply('2026-08-12T00:00', '2026-08-12T12:00');
  chk(a.state.period === 'custom', '달력으로 고르면 직접 입력으로 바뀐다', a.state.period);
  chk(a.state.from === '2026-08-12T00:00' && a.state.to === '2026-08-12T12:00', '적용하면 조회 구간이 바뀐다', a.state.from);
  chk(a._rollWindow(NOW, { minMs: Date.UTC(2026, 0, 1) }, 'detail').fromMs === Date.parse('2026-08-12T00:00'),
    '적용한 구간으로 조회한다');
}
{ // 프리셋으로 되돌아갈 수 있다
  const a = mk();
  const oneH = a.renderVals().periodPresets.find((c) => c.label === '1시간');
  if (oneH) oneH.onClick();
  chk(a.state.period === '1h', '프리셋 칩을 누르면 그 구간으로 돌아간다', a.state.period);
}

// ── 리포트 ──────────────────────────────────────────────────────────────
{
  const a = mk({ tab: 'report' });
  const v = a.renderVals();
  chk(v.genRange.active === true, '리포트도 직접 고른 구간이면 버튼이 켜져 보인다');
  v.genRange.onApply('2026-07-20T00:00', '2026-07-21T00:00');
  chk(a.state.genFrom === '2026-07-20T00:00' && a.state.genPeriod === 'custom', '리포트 기간도 적용에서 커밋된다', a.state.genFrom);
  /* 화면에 보이는 구간과 리포트가 조회하는 구간은 같아야 한다 —
     어긋나면 "화면엔 7월인데 8월 리포트가 나오는" 조용한 오차가 된다. */
  const w = a._rollWindow(NOW, { minMs: Date.UTC(2026, 0, 1) }, 'report');
  chk(w.fromMs === Date.parse('2026-07-20T00:00'), '리포트는 화면에 보이는 구간으로 조회한다', new Date(w.fromMs).toISOString());
}
{ // 프리셋일 때 버튼에 한 구간을 적으면 거짓말이 된다 — 태그마다 최신 데이터가 다르다
  const a = mk({ tab: 'report', genPeriod: '24h' });
  const v = a.renderVals();
  chk(!!v.genRange.label, '프리셋이면 구간 대신 문구를 적는다', v.genRange.label);
  chk(v.genPeriodNote === v.genPeriodSummary, '무슨 뜻인지는 아래 설명줄이 맡는다', v.genPeriodNote);
}

/* 추세 차트 축 시작 — 앞은 당기고 뒤는 두고 중간은 비운다.
   간헐 수집 태그(스냅샷형 데이터셋)는 고른 기간의 앞쪽이 통째로 비어 그래프가 반쪽으로 그려졌다.
   앞 여백은 "아직 데이터가 시작되지 않았다"뿐이라 당겨도 잃는 것이 없지만, 뒤 여백은 마지막 수집
   이후의 무수신이라 지우면 끊긴 태그가 멀쩡히 꽉 찬 그래프로 보인다. */
{
  const a = mk();
  const H = 3600000;
  const winFrom = NOW - H, winTo = NOW;
  const gap = [{ ms: NOW - 27 * 60000 }, { ms: NOW - 10 * 60000 }, { ms: NOW }];   // 앞 33분이 빈 창
  chk(a._xFrom0(gap, winFrom) === gap[0].ms, '★ 앞이 비면 첫 표본까지 당긴다');
  chk(a._rangeText(gap, '', { fromMs: winFrom, toMs: winTo }).indexOf(CH.fmtDT(gap[0].ms)) === 0,
    '   구간 문구도 같은 곳에서 시작한다(눈금과 어긋나면 안 된다)');
  chk(a._rangeText(gap, '', { fromMs: winFrom, toMs: winTo }).indexOf(CH.fmtDT(winTo)) > 0,
    '   끝은 고른 기간 그대로 — 뒤가 비어 있다는 사실을 지우지 않는다');

  const dead = [{ ms: winFrom }, { ms: winFrom + 5 * 60000 }];                     // 5분 뒤부터 무수신
  chk(a._xFrom0(dead, winFrom) === winFrom, '★ 뒤가 비어도 시작을 건드리지 않는다');
  chk(a._rangeText(dead, '', { fromMs: winFrom, toMs: winTo }).indexOf(CH.fmtDT(winTo)) > 0,
    '   구간 끝도 고른 기간 그대로 — 두절이 여백으로 남는다');

  const full = [{ ms: winFrom - 60000 }, { ms: winTo }];                            // 창보다 넓은 데이터
  chk(a._xFrom0(full, winFrom) === winFrom, '   데이터가 창을 덮으면 고른 기간 그대로');
  chk(a._xFrom0([], winFrom) === winFrom, '   표본이 하나도 없으면 고른 기간 그대로');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
