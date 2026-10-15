/* 기간 달력(DateRange)과 적용 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 달력 선택은 '적용' 때만 커밋(고르는 중 중간 구간 조회 방지), 일 단위·데이터 있는 날만 선택
   · 조회·리포트 창을 데이터 구간으로 좁힘(안 겹치면 유지), 추세 축은 앞 여백만 당김 */
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
// 위젯은 상태만으로 검사 — DOM 없이 열기·고르기·적용까지 같은 경로
const mkPicker = (props) => {
  const p = new DateRange(Object.assign({ from: '2026-08-13T00:00', to: '2026-08-13T06:00' }, props || {}));
  p.setState = function (s) { Object.assign(this.state, s); };
  return p;
};
const day = (y, m, d) => new Date(y, m - 1, d).getTime();

// ── 달력 위젯 ───────────────────────────────────────────────────────────
{ // 여는 순간 현재 구간이 초안 — 빈 달력에서 다시 고르는 수고 방지
  const p = mkPicker();
  p._open();
  chk(p.state.open === true, '버튼을 누르면 달력이 열린다');
  chk(p.state.fromDay === day(2026, 8, 13) && p.state.ft === '00:00', '지금 조회 중인 구간이 초안으로 들어온다', p.state.ft);
  chk(p.state.tt === '06:00', '시각도 그대로 들고 온다', p.state.tt);
  p._close();
}
{ // 고르는 동안은 바깥으로 출력 없음 — 중간 구간 조회 차단 지점
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
{ // 종료 대기 중 시작보다 앞을 누르면 그쪽을 새 시작으로(구간 역전 없음)
  const p = mkPicker();
  p._open();
  p._pickDay(day(2026, 8, 12));
  p._pickDay(day(2026, 8, 5));
  chk(p.state.fromDay === day(2026, 8, 5) && p.state.toDay === day(2026, 8, 12), '거꾸로 골라도 구간이 뒤집히지 않는다', p.state.pick);
}
{ // 적용 시에만 값 출력
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
{ // 뒤집힌 구간은 적용 차단
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
{ // 날짜만 쓰는 자리(내보내기·삭제)는 날짜만 출력
  let got = null;
  const p = mkPicker({ mode: 'date', from: '2026-08-01', to: '2026-08-03', onApply: (f, t) => { got = [f, t]; } });
  p._open();
  p._apply();
  chk(got && got[0] === '2026-08-01' && got[1] === '2026-08-03', '날짜 모드는 날짜만 내보낸다', got && got.join(' ~ '));
}
{ // 약식 시각 입력 보정 — 세 자리(930) → 09:30
  const p = mkPicker();
  p._open();
  p._timeFix('ft', '00:00')({ target: { value: '930' } });
  chk(p.state.ft === '09:30', "'930' → 09:30", p.state.ft);
  p._timeFix('tt', '23:59')({ target: { value: '9' } });
  chk(p.state.tt === '09:00', "'9' → 09:00", p.state.tt);
  p._timeFix('ft', '00:00')({ target: { value: '' } });
  chk(p.state.ft === '00:00', '비우면 기본 시각으로 돌아간다', p.state.ft);
}
// ── 조회 기간은 일 단위 선택 ─────────────────────────────────────────
{ /* 짧은 창은 프리셋(1시간·6시간)·이벤트 클릭(±30분)이 담당 — 달력은 날짜만 받고 하루 전체를 뜻함 */
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
{ // 하루 경계가 아닌 구간(프리셋·이벤트 클릭)은 버튼에 시각까지 표시
  const dayPick = render(html`<${DateRange} from="2026-08-10T00:00" to="2026-08-12T23:59" showTime=${false} />`);
  chk(dayPick.includes('<span>2026-08-10 ~ 2026-08-12</span>'), '달력으로 고른 구간은 날짜만 적는다', (dayPick.match(/<span>[^<]*~[^<]*<\/span>/) || [])[0]);
  const evPick = render(html`<${DateRange} from="2026-08-13T08:30" to="2026-08-13T09:30" showTime=${false} />`);
  chk(evPick.includes('<span>2026-08-13 08:30 ~ 2026-08-13 09:30</span>'), '하루 안의 창은 시각까지 적는다', (evPick.match(/<span>[^<]*~[^<]*<\/span>/) || [])[0]);
  const Y = new Date().getFullYear();
  const nowPick = render(html`<${DateRange} from=${Y + '-01-02T00:00'} to=${Y + '-01-03T23:59'} showTime=${false} />`);
  chk(nowPick.includes('<span>' + Y + '-01-02 ~ ' + Y + '-01-03</span>'), '올해 구간도 연도를 적는다', (nowPick.match(/<span>[^<]*~[^<]*<\/span>/) || [])[0]);
}
{ // 상세분석·리포트 달력은 시각 입력 없음
  const a = mk();
  chk(a.renderVals().periodRange.showTime === false, '상세분석 달력은 일 단위');
  const b = mk({ tab: 'report' });
  chk(b.renderVals().genRange.showTime === false, '리포트 달력도 일 단위');
}

// ── 차트는 데이터가 있는 구간만 ──────────────────────────────────────────
const STAT = { minMs: Date.parse('2026-08-03T04:00'), maxMs: Date.parse('2026-08-12T09:30') };
{ /* 하루 단위 선택 시 끝날 대부분이 빈 시간 — 그대로 조회하면 축 빈 여백·버킷 해상도 손실 */
  const a = mk({ period: 'custom', from: '2026-08-03T00:00', to: '2026-08-12T23:59' });
  const w = a._rollWindow(NOW, STAT, 'detail');
  chk(w.fromMs === STAT.minMs, '데이터가 시작되는 시각부터 조회한다', new Date(w.fromMs).toISOString());
  chk(w.toMs === STAT.maxMs, '데이터가 끝나는 시각까지만 조회한다', new Date(w.toMs).toISOString());
}
{ // 데이터 안쪽으로 좁혀 고른 구간은 그대로
  const a = mk({ period: 'custom', from: '2026-08-05T00:00', to: '2026-08-06T23:59' });
  const w = a._rollWindow(NOW, STAT, 'detail');
  chk(w.fromMs === Date.parse('2026-08-05T00:00') && w.toMs === Date.parse('2026-08-06T23:59'), '데이터 안쪽 구간은 고른 그대로 조회한다');
}
{ /* 구간과 데이터가 아예 안 겹치면 좁히지 않음 — 당기면 다른 시기 데이터 표시·리포트에 잘못된 기간 기록 */
  const a = mk({ period: 'custom', from: '2026-09-01T00:00', to: '2026-09-05T23:59' });
  const w = a._rollWindow(NOW, STAT, 'detail');
  chk(w.fromMs === Date.parse('2026-09-01T00:00') && w.toMs === Date.parse('2026-09-05T23:59'), '데이터와 겹치지 않는 구간은 당기지 않는다');
}
{ // 리포트도 같은 규칙 — 리포트 관측 창 = 실제 조회 구간
  const a = mk({ tab: 'report', genPeriod: 'custom', genFrom: '2026-08-01T00:00', genTo: '2026-08-31T23:59' });
  const w = a._rollWindow(NOW, STAT, 'report');
  chk(w.fromMs === STAT.minMs && w.toMs === STAT.maxMs, '리포트 기간도 데이터가 있는 만큼으로 좁힌다');
}
{ // 좁혀진 구간만큼 버킷도 촘촘하게
  const a = mk({ period: 'custom', from: '2026-08-12T00:00', to: '2026-08-12T23:59' });
  const w = a._rollWindow(NOW, { minMs: Date.parse('2026-08-12T08:00'), maxMs: Date.parse('2026-08-12T09:00') }, 'detail');
  chk(w.unit === 'sec', '데이터가 1시간뿐이면 초별로 그린다', w.unit + ' (' + w.label + ')');
}

// ── 데이터가 있는 구간만 선택 가능 ────────────────────────────────────
const BND = { minMs: new Date(2026, 7, 3).getTime(), maxMs: new Date(2026, 7, 12, 9, 30).getTime() };
{ // 빈 구간 선택 차단 — 빈 차트·리포트가 "이상 없음"으로 읽힘
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
{ // 데이터가 오늘까지 없는 태그(정지 설비·적재 종료 표)는 마지막 날 기준
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
{ // 열 때 데이터 있는 달부터 표시
  const p = mkPicker(Object.assign({ from: '2026-08-05T00:00', to: '2026-08-06T00:00' }, BND));
  p._open();
  chk(p.state.view === new Date(2026, 7, 1).getTime(), '데이터가 한 달 안에 있으면 그 달부터 펼친다', new Date(p.state.view).toDateString());
}
{ /* 달 이동은 데이터 있는 달까지만 — 화살표는 비활성화하지 않고 이유를 팝오버로 표시 */
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
{ // 데이터 없는 날짜를 누르면 이유 표시 — 무반응은 고장으로 읽힘
  const p = mkPicker(Object.assign({ from: '2026-08-05T00:00', to: '2026-08-06T00:00' }, BND));
  p._open();
  p._pickDay(day(2026, 8, 20));
  chk(p.state.notice === '그 날짜에는 데이터가 없습니다', '데이터 없는 날을 누르면 이유가 뜬다', p.state.notice);
  p._pickDay(day(2026, 8, 10));
  chk(p.state.notice === '' && p.state.fromDay === day(2026, 8, 10), '되는 날짜를 누르면 안내는 사라진다');
}
{ // 구간을 모르면(통계 없음) 선택 제한 없음
  const p = mkPicker();
  p._open();
  p._pickDay(day(2020, 1, 1));
  chk(p.state.fromDay === day(2020, 1, 1), '데이터 구간을 모르면 어떤 날짜든 고를 수 있다');
}

{ // 열린 동안 화면 자동 갱신 정지 — 고르는 중 값 되돌림 방지
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
{ // 프리셋 구간은 현재 시각 기준으로 표시 — 고른 순간의 구간을 적으면 조회 결과와 불일치
  const a = mk({ period: '1h', from: '2026-08-01T00:00', to: '2026-08-01T01:00' });
  const v = a.renderVals();
  chk(v.periodRange.active === false, '프리셋이면 달력 버튼은 꺼져 보인다');
  chk(v.periodRange.to === a.E.fmtDT(NOW).replace(' ', 'T'), '프리셋 구간은 지금 기준으로 다시 적는다', v.periodRange.to);
}
{ // 적용 = 커밋 + 직접 입력으로 전환(프리셋 사용 중에도 달력만으로 진입)
  const a = mk({ period: '1h' });
  a.renderVals().periodRange.onApply('2026-08-12T00:00', '2026-08-12T12:00');
  chk(a.state.period === 'custom', '달력으로 고르면 직접 입력으로 바뀐다', a.state.period);
  chk(a.state.from === '2026-08-12T00:00' && a.state.to === '2026-08-12T12:00', '적용하면 조회 구간이 바뀐다', a.state.from);
  chk(a._rollWindow(NOW, { minMs: Date.UTC(2026, 0, 1) }, 'detail').fromMs === Date.parse('2026-08-12T00:00'),
    '적용한 구간으로 조회한다');
}
{ // 프리셋으로 복귀 가능
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
  /* 화면 표시 구간 = 리포트 조회 구간 */
  const w = a._rollWindow(NOW, { minMs: Date.UTC(2026, 0, 1) }, 'report');
  chk(w.fromMs === Date.parse('2026-07-20T00:00'), '리포트는 화면에 보이는 구간으로 조회한다', new Date(w.fromMs).toISOString());
}
{ // 프리셋이면 버튼에 구간 대신 문구 — 태그마다 최신 데이터가 다름
  const a = mk({ tab: 'report', genPeriod: '24h' });
  const v = a.renderVals();
  chk(!!v.genRange.label, '프리셋이면 구간 대신 문구를 적는다', v.genRange.label);
  chk(v.genPeriodNote === v.genPeriodSummary, '무슨 뜻인지는 아래 설명줄이 맡는다', v.genPeriodNote);
}

/* 추세 차트 축 시작 — 앞 여백은 당기고 뒤 여백은 유지
   앞 여백 = 데이터 시작 전(당겨도 손실 없음), 뒤 여백 = 마지막 수집 이후 무수신(지우면 끊긴 태그가 멀쩡해 보임) */
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
