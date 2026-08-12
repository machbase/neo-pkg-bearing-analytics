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
// 목 설비엔 샘플레이트가 없어 대역 추출 계획이 항상 비어 있었다 — 라이브와 같게 채워
// 대역 카드(채움 현황·주기 변경 예상치)의 실제 분기를 검사한다.
d.equipment.forEach((e) => { e.fs = 25600; });
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
  genPeriod: 'all', genFrom: E.fmtDT(d.now - 86400000), genTo: E.fmtDT(d.now),
  from: E.fmtDT(d.now - 7 * 86400000).slice(0, 10), to: E.fmtDT(d.now).slice(0, 10),
});
// 이벤트 한 건 — 상세 열은 유형별로 담기는 것이 달라 필요한 필드만 덮어써 만든다
const _evt = (o) => Object.assign({
  ms: d.now, tagId: eq0.id, tagAlias: eq0.alias || eq0.name, tagName: eq0.name,
  unit: 'mm/s', value: 0, base: 0, grade: 0, bands: null, detail: '',
}, o);
const cases = [
  ['monitor 기본', {}],
  ['monitor 필터+알람중지+토스트', { gradeFilter: 1, monitorOn: false, toast: { msg: 't', kind: 'warn' } }],
  ['monitor 빈 소스', { srcSel: [] }],
  // 테이블 필터 — 드롭다운(체크·수·푸터)과 걸린 칩이 실제로 렌더되는지
  ["monitor 테이블 필터 열림", { tblOpen: true }, ["테이블 검색", "전체 선택", "전체 해제", "닫기", "GEARBOX_VIB"]],
  ['monitor 테이블 필터 적용', { tblHide: ['SENSOR_DATA'] }, ['MOTOR_CURRENT', 'codicon-close', '!전체 테이블 표시 중']],
  ['monitor 테이블 전체 표시', {}, ['전체 테이블 표시 중']],
  ['monitor 테이블 전부 해제', { tblHide: ['VIBRATION_RAW', 'SENSOR_DATA', 'MOTOR_CURRENT', 'GEARBOX_VIB', 'BEARING_TEMP'] }, ['표시할 테이블을 하나도 고르지 않았습니다', '전체 표시']],
  ['detail 기본', { tab: 'detail' }],
  ['detail 빈 소스', { tab: 'detail', srcSel: [] }],
  ['detail 종합분석+AI소견', { tab: 'detail', dxOpen: true, dxAiText: '소견 텍스트' }],
  ['detail AI 로딩', { tab: 'detail', dxOpen: true, dxAiText: '__loading__' }],
  /* 설비 카드 순서 — 저장된 순서를 먼저 따르고, 없는 태그는 심각도순으로 뒤에 붙는다.
     기본(순서 없음)은 지금까지와 같은 심각도 내림차순이라 동작이 안 바뀐다. */
  ['monitor 카드 드래그 가능', { tab: 'monitor' },
    ['draggable="true"', 'cursor: grab']],
  ['monitor 카드 사용자 순서', { tab: 'monitor', cardOrder: [sorted[3].id, sorted[1].id] },
    // 지정한 둘이 앞으로 오고 나머지는 심각도순
    [sorted[3].name, sorted[1].name]],
  // 드래그 중인 카드는 흐려지고, 미리보기 순서대로 자리가 바뀐 채 렌더된다
  ['monitor 카드 드래그 중', { tab: 'monitor', cardDragId: sorted[0].id },
    ['opacity: .35;', 'grabbing']],
  ['monitor 카드 드래그 미리보기', { tab: 'monitor', cardDragId: sorted[0].id, cardOrder: [], cardPreview: [sorted[2].id, sorted[0].id] },
    [sorted[2].name, sorted[0].name]],
  /* 감시 이상 배너 — 알람이 안 오는 이유가 '정상이라서'인지 '감시가 죽어서'인지 구분하는 자리다.
     서버 타이머는 등록만 성공하고 첫 실행에서 죽을 수 있어, 화면에 이게 없으면 알 방법이 없다. */
  ['monitor 감시 멈춤 배너', { tab: 'monitor',
    health: [{ k: 'stopped', lv: 'err', text: '서버 감시가 멈춰 있습니다 — STOP, ReferenceError: tt is not defined', act: '다시 등록' }] },
    ['서버 감시가 멈춰 있습니다', 'ReferenceError', '다시 등록', 'codicon-error']],
  ['monitor 심박 지연 배너', { tab: 'monitor',
    health: [{ k: 'stale', lv: 'err', text: '마지막 판정이 30시간 전입니다 (주기 3s)', act: '다시 등록' }] },
    ['마지막 판정이 30시간 전입니다']],
  ['monitor 판정대상 0개 배너', { tab: 'monitor',
    health: [{ k: 'nodata', lv: 'warn', text: '판정 대상이 0개입니다 — 감시 태그에 새 데이터가 들어오는지 확인하세요' }] },
    ['판정 대상이 0개입니다', 'codicon-warning']],
  ['monitor 이상 없으면 배너 없음', { tab: 'monitor', health: null },
    ['!서버 감시가 멈춰', '!판정 대상이 0개']],
  /* 정지·신호 두절 배지 — 둘 다 "값이 조용한" 상태지만 뜻이 정반대다.
     두절은 화면 값이 과거 값이라 표시가 없으면 정상으로 오해한다. */
  ['monitor 신호 두절 배지', { tab: 'monitor', _runState: { [eq0.table + ':' + eq0.name]: { lost: true, run: false, age: 7200000 } } },
    ['신호 두절', 'codicon-debug-disconnect', '센서·수집기·네트워크']],
  /* 두절이면 스파크라인 캡션이 사라져야 한다 — 과거 값을 놓고 "실시간"이라 하면 배지와 모순된다.
     한 대만 두절이면 다른 카드의 캡션에 가려 부재를 못 보므로, 전 카드를 두절로 놓고 확인한다. */
  ['monitor 두절이면 실시간 캡션 없음',
    { tab: 'monitor', _runState: Object.fromEntries(sorted.map((e) => [e.table + ':' + e.name, { lost: true, run: false, age: 7200000 }])) },
    // 선도 흐려져야 한다 — 배지만 얹고 선이 선명하면 그 선을 현재 값으로 읽는다
    ['신호 두절', 'opacity: .4', '!실시간 · 최근 1분']],
  ['monitor 정지 배지', { tab: 'monitor', _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: false, age: 1000 } } },
    // 정지는 값이 낮을 뿐 수신은 되고 있다 — 캡션은 그대로여야 한다
    ['정지', 'codicon-debug-pause', '판정을 얼립니다', '실시간 · 최근 1분', '!opacity: .4']],
  // '신호 두절'이라는 말 자체는 이벤트 유형 필터에도 있으므로, 배지 아이콘으로 부재를 확인한다
  ['monitor 운전 중이면 배지 없음', { tab: 'monitor', _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: true, age: 1000 } } },
    ['!codicon-debug-disconnect', '!codicon-debug-pause']],
  /* 등급 원인 표시 — 존(ISO)만으로 등급을 매기면 고주파가 지배하는 센서에서 베어링이
     나빠져도 카드가 양호로 남는다. 무엇이 등급을 올렸는지 카드에 보여야 한다. */
  ['monitor 등급 원인(대역)', { tab: 'monitor',
    _gradeState: { [eq0.table + ':' + eq0.name]: { gi: 2, src: 'band', iso: 0.31, wide: 3.55, limited: true } } },
    ['· 대역', 'ISO 10~1000 Hz', '전대역', '1 kHz 위']],
  ['monitor 등급 원인(베이스라인)', { tab: 'monitor',
    _gradeState: { [eq0.table + ':' + eq0.name]: { gi: 1, src: 'baseline', iso: 0.31, wide: 3.55, limited: true } } },
    ['· 베이스라인']],
  // ISO가 올린 등급은 원인을 안 붙인다 — 기본이라 매 카드에 붙으면 잡음이 된다
  ['monitor 등급 원인(ISO는 미표시)', { tab: 'monitor',
    _gradeState: { [eq0.table + ':' + eq0.name]: { gi: 2, src: 'iso', iso: 3.1, wide: 3.2, limited: true } } },
    ['!· 대역', '!· 베이스라인']],
  /* 되살아난 태그 — 지웠다 다시 등록된 태그에 옛 학습값이 말없이 붙는 것을 막는다.
     확인 전까지 베이스라인·대역 판정이 멈춰 있으므로 그 사실이 화면에 보여야 한다. */
  ['settings criteria 되살아난 태그', { tab: 'settings', setSection: 'criteria',
    revived: { [eq0.table + ':' + eq0.name]: 1 },
    baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60, at: 1785000000000 } } },
    ['학습값이 남아 있습니다 — 이전과 같은 설비인가요?', '같은 설비 — 유지', '다른 설비 — 초기화', '남의 기준으로 판정']],
  ['monitor 되살아남 배너', { tab: 'monitor',
    health: [{ k: 'revived', lv: 'warn', text: 'C1 — 새로 추가된 태그에 예전 학습값이 남아 있습니다. 이전과 같은 설비인지 확인해 주세요', act: '설정에서 확인' }] },
    ['예전 학습값이 남아 있습니다', '설정에서 확인']],
  /* 표시 상한 — 잘린 태그는 감시 대상이 아니다. 화면에 안 나오면 "정상이라 조용한 것"으로 읽힌다.
     어느 테이블이 몇 개 잘렸는지까지 나와야 어디 선택을 풀지 판단할 수 있다. */
  ['settings source 상한 초과', { tab: 'settings', setSection: 'source',
    srcCap: { perTable: [{ table: 'VIBRATION_RAW', shown: 20, total: 27, byTotal: false }], dropped: 7, droppedKeys: {}, eligible: 27, shown: 20, byTotal: false } },
    ['27개 중 20개', '7개 제외', '테이블당 상한']],
  ['settings source 상한 안(안내 없음)', { tab: 'settings', setSection: 'source' }, ['!표시 상한']],
  /* 별칭 편집 — 감시 상한만큼 나와야 한다(예전엔 db 기본값 20으로 잘려, 상한을 올려도
     21번째부터는 별칭을 못 달았다). 목록이 길어지므로 검색이 실제로 동작해야 한다.
     _tagCache를 심어야 필터가 실제로 도는 것을 본다 — 스모크엔 DB가 없어 캐시가 비어 있다. */
  ['settings source 별칭 목록', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'], _tagCache: { VIBRATION_RAW: ['P1', 'P2', 'MOTOR_A'] } },
    ['VIBRATION_RAW · P1', 'VIBRATION_RAW · MOTOR_A', '>3개<']],
  ['settings source 별칭 검색', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'], _tagCache: { VIBRATION_RAW: ['P1', 'P2', 'MOTOR_A'] }, tagQuery: 'motor' },
    ['VIBRATION_RAW · MOTOR_A', '1 / 3개', '!VIBRATION_RAW · P1']],
  ['settings source 별칭 검색 무결과', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'], _tagCache: { VIBRATION_RAW: ['P1', 'P2', 'MOTOR_A'] }, tagQuery: 'ZZZNOPE' },
    ['검색과 일치하는 태그가 없습니다']],
  /* 목록은 테이블의 전 태그다 — 감시 상한 밖 태그도 나오되 '감시 제외'로 표시한다.
     한 번에 그리는 줄만 제한하고, 몇 개가 더 있는지는 밝힌다(조용히 자르지 않는다). */
  ['settings source 별칭 감시제외 표시', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'],
    _tagCache: { VIBRATION_RAW: ['P1', 'P2'] },
    srcCap: { perTable: [], dropped: 1, droppedKeys: { 'VIBRATION_RAW:P2': 1 }, eligible: 2, shown: 1, byTotal: false } },
    ['VIBRATION_RAW · P2', '감시 제외']],
  ['settings source 별칭 줄 수 제한 고지', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'],
    _tagCache: { VIBRATION_RAW: Array.from({ length: 260 }, (_, i) => 'T' + i) } },
    ['260개', '아래로 더 내리면 60개가 이어집니다']],
  // 바닥까지 내려 이어 붙인 뒤에는 남았다는 안내가 사라진다(끝까지 스크롤로 닿는다)
  ['settings source 별칭 이어 붙인 뒤', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'],
    _tagCache: { VIBRATION_RAW: Array.from({ length: 260 }, (_, i) => 'T' + i) }, aliasShown: 400 },
    ['260개', 'VIBRATION_RAW · T259', '!이어집니다']],
  ['monitor 상한 배너', { tab: 'monitor',
    health: [{ k: 'cap', lv: 'warn', text: '태그 7개가 표시 상한(테이블당 20개 · 전체 40개)을 넘어 감시에서 빠져 있습니다 — 감시 중인 태그는 20개입니다', act: '설정에서 확인' }] },
    ['감시에서 빠져 있습니다', '설정에서 확인']],
  /* 서버 회차가 주기에 근접하면 곧 겹친다 — 겹친 회차는 잠금에 막혀 통째로 건너뛰므로
     타이머는 RUNNING인데 실제 판정 간격만 조용히 늘어난다. 그 전에 알린다. */
  ['monitor 서버 회차 지연 경고', { tab: 'monitor',
    health: [{ k: 'slowtick', lv: 'warn', text: '서버 감시 1회차가 8.2초 걸립니다 (주기 10s · 태그 120개) — 주기를 늘리는 것을 권합니다.', act: '설정 열기' }] },
    ['1회차가 8.2초 걸립니다', '설정 열기']],
  ['monitor 서버 회차 초과(주기 건너뜀)', { tab: 'monitor',
    health: [{ k: 'slowtick', lv: 'err', text: '서버 감시 1회차가 12.4초 걸립니다 (주기 10s · 태그 200개) — 회차가 겹쳐 일부 주기를 건너뜁니다. 주기를 늘리거나 감시 태그를 줄이세요.', act: '설정 열기' }] },
    ['회차가 겹쳐 일부 주기를 건너뜁니다']],
  /* 계측 이상 배지 — 정지보다 먼저 뜬다. 플랫라인은 값이 낮아 정지처럼 보이지만 뜻이 정반대다:
     정지는 설비가 선 것이고, 플랫라인은 센서가 죽어 그 태그가 무기한 무감시가 된 상태다. */
  ['monitor 계측 이상 배지', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: false, age: 1000, gate: { label: '플랫라인', detail: 'σ 0.00001 / peak 2.400' } } } },
    ['계측 이상', 'codicon-warning', '플랫라인', '헛경보', '센서·케이블·마운팅', '!codicon-debug-pause']],
  // 두절이 계측 이상보다 우선한다 — 데이터가 아예 없으면 볼 파형도 없다
  ['monitor 두절이 계측 이상보다 우선', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: true, run: false, age: 7200000, gate: { label: '플랫라인', detail: 'x' } } } },
    // '계측 이상'이라는 말은 이벤트 유형 필터에도 있으므로 배지 툴팁 문구로 부재를 본다
    ['신호 두절', '!센서·케이블·마운팅']],
  /* 판정 보류 — 계측 이상·신호 두절·정지 셋 다 지금 등급을 매기지 않는 상태다.
     카드 숫자가 그 설비를 대표하지 않으므로 등급 칩을 대체하고 등급 집계에서도 뺀다.
     "계측 이상인데 양호"처럼 화면이 자기 모순을 말하는 것을 막는 자리다. */
  ['monitor 판정 보류 칩(계측 이상)', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: true, age: 1000, gate: { label: '플랫라인', detail: 'x' } } } },
    // 색도 중립이어야 한다 — 칩만 회색이고 테두리·스파크가 등급색이면 화면이 정상이라고 말한다
    ['판정 보류', '지금 등급을 매기지 않습니다', '플랫라인', 'border-left: 3px solid var(--text-muted)']],
  ['monitor 판정 보류 칩(정지)', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: false, age: 1000 } } },
    ['판정 보류', '정지']],
  ['monitor 판정 보류 칩(두절)', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: true, run: false, age: 7200000 } } },
    ['판정 보류', '신호 두절']],
  // 보류가 아니면 등급 칩이 그대로 나와야 한다 — 전 카드가 보류로 덮이면 안 된다
  // '판정 보류'는 KPI 칸 라벨에도 늘 있으므로, 칩 툴팁 문구로 부재를 본다
  ['monitor 정상은 등급 칩 유지', { tab: 'monitor', _runState: {} }, ['!지금 등급을 매기지 않습니다']],
  // KPI 칸 — 내역은 호버로 내린다(칸을 늘리면 난잡해진다)
  ['monitor KPI 판정 보류 칸', { tab: 'monitor',
    _runState: {
      [sorted[0].table + ':' + sorted[0].name]: { lost: true, run: false, age: 7200000 },
      [sorted[1].table + ':' + sorted[1].name]: { lost: false, run: true, age: 1000, gate: { label: '클리핑', detail: 'x' } },
      [sorted[2].table + ':' + sorted[2].name]: { lost: false, run: false, age: 1000 },
    } },
    ['판정 보류', '계측 이상 1대', '신호 두절 1대', '정지 1대']],
  /* 상세 통계 요약 — 리포트와 같은 지표를 쓴다. COUNT/AVG/MIN/MAX는 진동에서 오해를 만든다:
     MIN은 정지 구간 값이고, MAX는 계측 스파이크 하나에 좌우되며, AVG는 간헐 고진동을 평탄화한다. */
  ['detail 통계 요약(중앙값·P95)', { tab: 'detail' },
    ['중앙값 RMS', 'P95 RMS', 'B/C 초과 버킷', 'Crest P95', '변화율', '관측 창',
      '!건수 (COUNT)', '!평균 (AVG)', '!최솟값 (MIN)', '!최댓값 (MAX)']],
  /* 카드 숫자 = 판정값(항상 ISO 대역제한). 라벨은 "어느 대역에서 잰 값인가"를 주파수로 적어
     원인으로 오해되지 않게 한다. 나머지 두 축의 값은 카드에 안 적는다 — 신규 설치에서는
     대부분 미학습이라 거의 모든 카드가 "베이스라인 — 대역 —"이 되어 잡음이 된다.
     "왜 이 등급인가"는 등급 칩의 원인 표시가 답하고, "얼마나"는 호버·상세분석의 몫이다. */
  ['monitor 카드 판정값·대역 라벨', { tab: 'monitor',
    _gradeState: { [eq0.table + ':' + eq0.name]: { gi: 2, src: 'band', iso: 2.38, wide: 3.55, limited: true, basis: 'iso', blR: 5.5, bandR: 2.3 } } },
    ['2.38', '10~1000 Hz', '베이스라인 한계 대비 ×5.5', '대역 최대 ×2.3']],
  ['monitor 카드에 축 값을 안 적는다', { tab: 'monitor',
    _gradeState: { [eq0.table + ':' + eq0.name]: { gi: 1, src: 'baseline', iso: 1.5, wide: 1.6, limited: true, basis: 'iso', blR: null, bandR: null } } },
    ['1.50', '!베이스라인 —', '!대역 —']],
  ['report 기본', { tab: 'report' }],
  ['report 생성중+미리보기모달', { tab: 'report', genRunning: true, genStep: 2, viewReport: { rec: {}, url: 'report.html?x=1', fname: 'RPT_TEST.html' } }],
  ['report 커스텀 기간', { tab: 'report', genPeriod: 'custom' }],
  ['report 대상 태그 미선택(기간 없음)', { tab: 'report', genTags: [], genPeriod: '', genFrom: '', genTo: '' }],
  ['report 빈 소스', { tab: 'report', srcSel: [] }],
  ['settings source+dirty+이동확인모달', { tab: 'settings', setSection: 'source', dirty: true, pendingNav: 'monitor' }],
  // 데이터 관리 — 현황 조회 전/중/후, 그리고 삭제 2단계(날짜 고르기 → 건수 확인) 각각의 분기
  ['settings data 현황 읽는 중', { tab: 'settings', setSection: 'data', usageBusy: true }, ['현황을 읽는 중']],
  // usageBusy를 명시로 끈다 — 케이스가 한 state를 이어 쓰므로 앞 케이스의 true가 남는다
  ['settings data 현황 실패', { tab: 'settings', setSection: 'data', usage: null, usageBusy: false }, ['현황을 읽지 못했습니다']],
  ['settings data 현황', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: { from: d.now - 11 * 86400000, to: d.now } },
    band: { rows: 39120, keys: 396, span: { from: d.now - 30 * 86400000, to: d.now } },
    monstate: { rows: 269 }, baseline: { rows: 26 },
  } }, ['이벤트 이력', 'NEO_VIBE_EVENTS', '>TAG<', '>LOOKUP<', '대역 에너지 추이', '판정 상태', '7,730건',
    '기간 삭제…', '기간 안 모든 태그', '학습 구간 포함 주의',
    /* 태그별 정리는 감시 목록 밖 태그가 있을 때만 나온다 — 이 케이스는 tagUsage가 없어(현황만 읽음)
       고아를 모르는 상태다. 없는 기능을 있다고 적던 문구가 되살아나지 않게 함께 막는다. */
    '!태그별 정리…', '!태그 단위 삭제도 가능',
    // 이벤트가 TAG가 되면서 설비 단위 삭제가 가능해졌다 — 옛 LOG 제약 문구가 남아 있으면 안 된다
    '!LOG 테이블이라 중간을 지울 수 없어', '태그의 이력만 따로',
    // 학습값은 행이 아니라 각주다 — 늘지 않는 데이터라 정리 대상이 아니다
    '!학습값 (베이스라인)', '재학습이 같은 자리를 덮어써 늘지 않습니다', '판정 기준으로 이동',
    // 학습값은 덮어쓰기라 행이 안 늘어난다 — 정리 대상이 아니라는 것을 화면이 말해야 한다
    ]],
  /* 기간 고르기 — 기본값을 두지 않는다(빈칸 + 버튼 잠금).
     기본값을 넣었더니 보관 기간이 하루뿐일 때 시작＞종료로 뒤집혔고(사용자 보고),
     넓게 잡으면 기본이 사실상 전체 삭제가 됐다. 되돌릴 수 없는 동작이라 둘 다 안 된다. */
  // 기본은 보관 중인 전체 구간(min~max) — 사용자는 여기서 좁힌다
  ['settings data 날짜 고르기(기본=전체 구간)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 100, span: { from: d.now - 30 * 86400000, to: d.now } }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purgePick: 'events', purgeFrom: null, purgeTo: null },
    ['이벤트 이력 삭제', '>선택<', '지울 기간을 정하세요', '보관 중:',
      'value="' + E.fmtDT(d.now - 30 * 86400000).slice(0, 10) + '"', 'value="' + E.fmtDT(d.now).slice(0, 10) + '"']],
  // 보관 정보가 없으면 지울 것이 없다 — 빈칸 + 잠금
  ['settings data 날짜 고르기(데이터 없음·잠금)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 0, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purgePick: 'events', purgeFrom: null, purgeTo: null },
    ['!value="20', 'not-allowed']],
  ['settings data 날짜 고르면 잠금 해제', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 100, span: { from: d.now - 30 * 86400000, to: d.now } }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purgePick: 'events', purgeFrom: '2026-07-01', purgeTo: '2026-07-15' },
    ['value="2026-07-01"', 'value="2026-07-15"', '!not-allowed']],
  ['settings data 확인(세는 중)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'events', fromMs: d.now - 86400000, toMs: d.now, counting: true, n: null } }, ['세는 중', '건수 확인 중']],
  ['settings data 확인(건수 나옴)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'events', fromMs: d.now - 86400000, toMs: d.now, counting: false, n: 5102, keep: 2628 } },
    ['정말 삭제하시겠습니까?', '5,102건 삭제', '삭제 후 남는 데이터 2,628건', '영구 삭제되며 복구할 수 없습니다',
      '이 기간을 다룬 리포트는 다시 만들 수 없습니다', '내보내기로 저장한 뒤 제거하는 것을 권장',
      // 표 이름을 치기 전에는 삭제 버튼이 잠긴다
      '계속하려면 테이블 이름', 'not-allowed']],
  // 표 이름을 정확히 입력하면 열린다(대소문자 무시)
  ['settings data 확인(이름 입력 완료)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'events', fromMs: d.now - 86400000, toMs: d.now, counting: false, n: 5102, keep: 2628 }, purgeTyped: 'neo_vibe_events' },
    ['5,102건 삭제', '!not-allowed']],
  // 삭제 실행 중 — 버튼이 잠기고 라벨이 바뀐다(중복 실행 방지)
  ['settings data 삭제 실행 중', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'events', fromMs: d.now - 86400000, toMs: d.now, counting: false, n: 5102, keep: 2628, running: true } },
    ['삭제 중…', 'not-allowed']],
  ['settings data 확인(지울 것 없음)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 10, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'events', fromMs: d.now - 86400000, toMs: d.now, counting: false, n: 0, keep: 10 } }, ['지울 데이터 없음']],
  ['settings data 대역 확인', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 0, span: null }, band: { rows: 39120, keys: 396, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'band', fromMs: d.now - 86400000, toMs: d.now, counting: false, n: 14418, keep: 24702 } },
    ['NEO_VIBE_BAND', '14,418행 삭제', '대역 베이스라인을 다시 학습', '추세 차트에서 이 구간이 비어 보입니다',
      // 대역은 내보내기 경로가 없다 — 이벤트 전용 안내가 새면 안 된다
      '!내보내기로 저장한 뒤']],
  ['settings equip+펼침+커스텀베어링', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: '직접 입력' } }],
  ['settings equip 슬리브', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: 'sleeve' } }],
  ['settings equip 계측·구동 전부 입력', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipRpm: { [eq0.id]: '1800' },
    equipBearing: { [eq0.id]: '6206' }, equipMeta: { [eq0.id]: { mount: 'magnet', drive: 'belt', belt: { d1: 120, d2: 300 }, vanes: 7 } },
  }, ['계측·구동', '벨트 제원', '종동축 1×', '베인 통과', '유효 상한 2.0 kHz', '외륜 결함 주파수', '케이지(리테이너) 회전 주파수', '풀리비(D1÷D2)로 계산한', '!전원 계통주파수']],
  ['settings equip 계측·구동 미입력(접힘 배지)', { tab: 'settings', setSection: 'equip', equipAdv: {} },
    ['형상·계측·구동', '마운팅 방식·구동방식·날개수', '!전원 계통주파수']],
  // 항목 옆 ? 호버 툴팁 — 표 헤더(단위·Class·RPM·베어링)와 계측·구동 입력 양쪽에 붙는다.
  // 계통주파수 칩은 평소 숨김(국내 60Hz 고정)이라 '!'로 부재를 확인한다.
  ['settings equip 항목 툴팁(표 헤더)', { tab: 'settings', setSection: 'equip' },
    ['ISO 10816 기계 등급', '1800 rpm으로 가정', '베어링 외륜의 각인', '!전원 계통주파수']],
  ['settings equip 항목 툴팁(계측·구동 펼침)', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true },
    equipMeta: { [eq0.id]: { drive: 'belt', belt: { d1: 120, d2: 300 } } } },
    ['스터드 10, 접착 5, 자석 2, 프로브 1 kHz', '벨트 옆면의 각인', '마우스를 올리면 설명']],
  // 접힌 버튼 이름은 행마다 같다 — 직접 입력이라는 사실은 옆의 베어링 모델 셀렉트가 말한다
  ['settings equip 직접 입력도 버튼 라벨은 설정', { tab: 'settings', setSection: 'equip', equipBearing: { [eq0.id]: '직접 입력' } },
    ['</span>설정<span']],
  // 직접 입력(커스텀 베어링) 형상 4칸에도 툴팁이 붙어야 한다 — 사용자 보고로 추가된 회귀 케이스
  ['settings equip 직접 입력 형상 툴팁', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: '직접 입력' } },
    ['전동체(볼 또는 롤러)의 개수', 'ball diameter', 'pitch diameter', '깊은홈 볼베어링은 0°', '형상 제원 표']],
  /* 목록 필터·일괄 적용 — 감시 태그는 상한(100개)까지 늘어난다. 목록에 자체 스크롤을 두지 않는
     대신(행이 펼쳐지므로 고정 높이 안에 가두면 펼친 내용이 갇힌다) 손댈 줄만 남기는 필터와,
     한 행을 채워 같은 설비로 퍼뜨리는 일괄 적용을 둔다. 값 검사는 test-equipbulk.mjs. */
  // 필터는 전체/미설정 둘뿐 — "설정 미완료"는 필터가 아니라 각 행의 n/N 배지가 짚는다
  ['settings equip 목록 필터', { tab: 'settings', setSection: 'equip' },
    ['미설정', '기본값(Class II · 1800 rpm · mm/s)으로 판정 중', '!설정 미완료']],
  ['settings equip 필터 빈 상태', { tab: 'settings', setSection: 'equip', equipFilter: 'unset',
    equipCls: Object.fromEntries(d.equipment.map((e) => [e.id, 'II'])) },
    ['조건에 맞는 태그가 없습니다', '전체 보기']],
  ['settings equip 일괄 적용 패널', { tab: 'settings', setSection: 'equip',
    equipCls: { [eq0.id]: 'III' }, equipRpm: { [eq0.id]: '3600' }, equipBearing: { [eq0.id]: '6205' },
    equipMeta: { [eq0.id]: { mount: 'stud', drive: 'belt', belt: { d1: 120, d2: 300 }, vanes: 7 } },
    equipBulk: { id: eq0.id, scope: '', fields: {} } },
    // 칩 하나 = 입력칸 하나 — 묶으면 값이 다 안 보이고 일부만 켜는 선택도 사라진다
    ['복사할 항목', '3600 rpm', '6205', '>계측<', '스터드', '>구동<', '벨트·풀리',
      '풀리 D1', '120 mm', '풀리 D2', '300 mm', '>날개수<', '7매',
      '개에 적용', '덮어씁니다', '같은 테이블']],
  ['settings equip 일괄 적용 — 복사할 값 없음', { tab: 'settings', setSection: 'equip',
    equipBulk: { id: eq0.id, scope: '', fields: {} } },
    ['복사할 값이 없습니다']],
  // 1800 rpm은 60Hz 4극 동기속도 → 50Hz로 설정돼 있으면 "60Hz 쪽에 맞다"고 경고해야 한다
  ['settings equip 계통 불일치 경고(1800rpm인데 50Hz 설정)', { tab: 'settings', setSection: 'equip', lineHz: '50', equipRpm: { [eq0.id]: '1800' } },
    ['60 Hz 계통 동기속도에 맞습니다', '전기적 결함 100 Hz']],
  // 베이스라인 상태 툴팁은 학습된 태그에만 렌더 → 학습 상태를 주입해 그 경로까지 검사
  ['settings criteria', { tab: 'settings', setSection: 'criteria',
    baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60, ex: { idle: 8, ramp: 4 } } } },
    ['A(양호)와 B(주의)를 가르는', '알람과 조치 권고가 여기서 갈립니다', '긴급 점검 대상', '그 결함이 정상 기준이 됩니다',
      '정지·기동 구간과 순간 스파이크는 자동으로 걸러지지만', '99.7%가 한계 안', '사용자 정의 기준으로 판정',
      '스파이크에 흔들리지 않는 중앙값 방식', '최소 μ의 1.2배',
      'σ 0.30 (k=3)', '절대값이 양호 존이라도', '학습은 선택 사항이며', '절대 임계</b>(존 경계) —']],
  // 과거 채우기 진행 중 — 진행바·남은시간·"학습 가능" 표시가 렌더되는 경로
  ['settings criteria 과거채우기 진행중', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandFill: { done: 312, total: 864, eta: 690000, learnable: true } },
    ['과거 데이터 채우기', '312', '864', '남은 시간 약', '학습 가능 ✓', '중지']],
  ['settings criteria 과거채우기 미달', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandFill: { done: 20, total: 864, eta: 1055000, learnable: false } },
    ['학습 최소 표본 미달']],
  // 채움 현황 — 완료/부분/미채움이 태그 행에 칩으로 보여야 한다(학습 상태와 별개 정보)
  /* 두 학습 기간은 분리돼야 한다 — 같은 24시간이 RMS엔 8,640개, 대역엔 144개다(밀도 60배 차).
     공유하면 RMS에 타당한 "최근 1시간" 선택이 대역을 6개로 만들어 학습을 깨뜨린다. */
  ['settings criteria 학습 기간 분리', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandInterval: '10m', blWin: '1h', bandWin: '24h', evalWindow: '10s', monitorInterval: '3s' },
    ['정상 학습 기간', '대역 학습 기간', '10분마다 추출하므로 표본 144개', '판정 구간 10초 단위로 묶어 표본 360개']],
  // 조합이 최소 표본에 못 미치면 눌러보기 전에 알려야 한다 (1시간 주기 × 6시간 = 6개 < 30)
  ['settings criteria 대역 표본 부족', { tab: 'settings', setSection: 'criteria', bandOn: true, bandInterval: '1h', bandWin: '6h' },
    ['표본 6개', '학습되지 않습니다', '추출 주기를 줄이거나 학습 기간을 늘리십시오']],
  // 대역은 표본이 성겨 긴 기간이 필요하다 — 1시간 선택지는 아예 두지 않는다
  ['settings criteria 대역 기간 선택지', { tab: 'settings', setSection: 'criteria', bandOn: true },
    ['최근 6시간', '최근 3일', '최근 7일']],
  /* 두 기간이 실제로 분리됐는지 — 값을 다르게 주고 각자 자기 값을 쓰는지 본다.
     대역 경로(학습·채우기·주기변경 모달)가 blWin을 참조하면 안내와 실제 동작이 어긋난다. */
  ['settings criteria 기간 분리 반영', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandInterval: '10m', blWin: '1h', bandWin: '7d', evalWindow: '10s', monitorInterval: '10s' },
    ['표본 1008개',            // 7일 ÷ 10분 = 1008 (blWin 1h였다면 6개)
      '최근 7일',              // 채우기 안내도 대역 기간
      '표본 360개']],          // RMS는 1시간 ÷ 10초 = 360
  /* 카드 구조 — 값 만들기와 기준 잡기가 섞이면 설정과 설명이 번갈아 나와 훑기 어렵다.
     구획 제목으로 나누고 상세 설명은 툴팁으로 내렸는지 확인한다. */
  ['settings criteria 대역 카드 구획', { tab: 'settings', setSection: 'criteria', bandOn: true },
    ['대역 추출', '정상 기준 학습', '채널별 학습 상태', '학습됨',
      // 채우기는 학습 기간에 의존하므로 그 설정보다 뒤에 와야 한다
      '!대역값 만들기',
      /* 설명은 툴팁(data-tip 속성) 안에만 둔다 — 본문에 늘어놓으면 설정과 설명이 번갈아 나온다.
         속성 안에 있는지까지 봐야 한다: 단순 문자열 검색은 본문과 속성을 구분하지 못한다. */
      'data-tip="이미 쌓인 원본에서',
      /* 이 경고만 본문에 둔다 — 결함이 진행 중일 때 배우면 그 결함이 정상 기준이 되는데,
         호버해야 보이면 그 순간에 못 읽는다. 나머지 설명은 툴팁으로 내렸다. */
      '결함이 진행 중이면 그 결함이 정상 기준이 됩니다',
      // 본문에 남아 있던 설명 줄은 걷어냈다
      '!>알람이 켜져 있을 때만 동작합니다']],
  // 학습 시점 표기 — 언제 배운 기준인지가 값만큼 중요하다. 한 달 넘으면 색으로도 경고
  ['settings criteria 학습 시점 표기', { tab: 'settings', setSection: 'criteria',
    baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60, evalWin: 10, at: Date.now() - 3 * 3600000 } } },
    ['3시간 전', '학습 시점', '10초 구간 기준', '이 기준을 학습한 시점입니다']],
  /* 오래된 학습 — 설정 화면에 들어가지 않아도 알아야 하므로 좌측 배지에도 올린다.
     자동 재학습을 하지 않는 이유(결함을 정상으로 흡수)를 안내에 담는다. */
  ['settings criteria 오래된 학습', { tab: 'settings', setSection: 'criteria',
    baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60, at: Date.now() - 45 * 86400000 } } },
    ['개월 전', '한 달이 넘었습니다', '학습한 지 한 달이 넘은 태그', '재학습 1',
      '정비나 운전 조건 변경이 있었다면']],
  /* 빠진 대역과 이유 — 학습된 것만 나열하면 "왜 4/5냐"를 물어봐야 알 수 있다.
     1 kHz 위 옥타브 대역들은 회전주파수와 무관하게 하한이 고정이라, 샘플레이트가 낮으면
     하한이 Nyquist를 넘어 빈 대역이 된다. 그 태그는 8/8이 원리적으로 불가능하므로
     분모도 "측정 가능한 대역 수"로 줄여야 도달 못 할 목표를 보여주지 않는다. */
  /* 확인 대기가 여러 개면 한 번에 끝낼 길이 있어야 한다 — 하나씩 누르게 두면 확인이 일이 되고,
     일이 되면 읽지 않고 누르게 된다. 되돌릴 수 없는 초기화는 여기 두지 않는다. */
  /* 회차보다 짧은 주기는 고를 수 없어야 한다 — 고르면 회차가 겹쳐 표가 영영 비는데
     화면 어디에도 이유가 안 나온다(실제로 겪었다). 태그가 적으면 1분도 멀쩡하므로 규모로 판단한다. */
  ['settings criteria 대역 주기 — 회차보다 짧으면 잠금', { tab: 'settings', setSection: 'criteria', bandOn: true },
    ['한 회차 약', '회차가 겹쳐 아무것도 쌓이지 않습니다']],
  ['settings criteria 확인 대기 일괄', { tab: 'settings', setSection: 'criteria',
    revived: Object.fromEntries(sorted.slice(0, 3).map((e) => [e.table + ':' + e.name, { at: d.now }])),
    baselines: Object.fromEntries(sorted.slice(0, 3).map((e) => [e.table + ':' + e.name, { mu: 1, sigma: 0.05, k: 3, n: 130, at: d.now }])) },
    ['확인 대기', '3개', '모두 같은 설비 — 유지', '!모두 다른 설비']],
  ['settings criteria 확인 대기 없으면 줄도 없다', { tab: 'settings', setSection: 'criteria', revived: {} },
    ['!확인 대기']],
  ['settings criteria 측정 불가 대역', { tab: 'settings', setSection: 'criteria', bandOn: true,
    baselines: Object.fromEntries(['sub', 'one', 'fault', 'high'].map((b) => [eq0.table + ':' + eq0.name + ':' + b,
      { mu: 1, sigma: 0.01, k: 3, n: 130, band: b, at: Date.now() }])) },
    /* 목 설비는 fs=25600(Nyquist 12.8k)이라 8개 대역 모두 측정 가능이고, 마운팅 미상이어도
       복조 대역이 성립해 주기성 1계열이 붙는다(품번 없으면 결함주파수 3계열은 안 붙음) → 분모 9.
       분모가 대역 8개만 세면 분자(포락선 포함)가 분모를 넘는다 — 12/8 방지. */
    ['4/9 계열 학습됨', '학습 안 됨', '2~4 kHz', '표본 부족 또는 학습 실패']],
  /* 표본 칩 — 비율이 아니라 개수로 쓴다. 알아야 할 것은 "최소 표본(30)을 넘었나"인데
     28% 같은 값으로는 판단이 안 된다(144칸의 28%는 40개로 충분, 60칸이면 17개로 부족). */
  ['settings criteria 표본 현황', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandCov: { [eq0.table + ':' + eq0.name]: { set: {}, have: 144, need: 144 },
      [sorted[1].table + ':' + sorted[1].name]: { set: {}, have: 40, need: 144 },
      [sorted[2].table + ':' + sorted[2].name]: { set: {}, have: 0, need: 144 } } },
    ['표본 144개', '표본 40개', '표본 부족 0개', '칸에 대역값이 있습니다',
      '학습 최소 표본(30개)을 넘었습니다', '학습에는 최소 30개가 필요합니다',
      // 격자 경계로 100%는 원리적으로 안 나오므로 분모를 보여주지 않는다
      '비어 있는 칸은 구간 경계와 진행 중인 칸이라 정상입니다',
      '!144/144', '!채움 28%', '!미채움']],
  // 전부 채워졌으면 "남은 개수" 대신 완료 문구가 나오고 버튼이 잠겨야 한다
  ['settings criteria 채움 완료', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandCov: Object.fromEntries(sorted.slice(0, 20).map((e) => [e.table + ':' + e.name, { set: {}, have: 144, need: 144 }])) },
    ['구간이 모두 채워져 있습니다', 'not-allowed']],
  // 주기 변경 모달 — 숫자 근거와 이전 구간 처리 3안이 나와야 한다
  ['settings criteria 주기변경 모달', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandIvOpen: true, bandIvNext: '1m', bandIvAct: 'refill' },
    ['대역 추출 주기 변경', '대역 학습 표본', '회차당 소요', '서버 점유율', '최소 학습 소요',
      '그대로 둠', '새 주기로 다시 계산', '대역 베이스라인 초기화', '적용']],
  // 1시간 주기 + 24h 학습창 = 24개 → 최소 30 미달이라 경고가 떠야 한다
  ['settings criteria 주기변경 학습불가 경고', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandIvOpen: true, bandIvNext: '1h', blWin: '24h' },
    ['학습 불가']],
  // 문장형 + 슬라이딩 도식 — 두 값의 관계와 겹쳐 이동함이 화면에 드러나야 한다
  ['settings monitor', { tab: 'settings', setSection: 'monitor' },
    ['직전', '구간의 데이터를', '마다 판정',
      '구간이 길면 짧은 진동이 하나의 상태로 합쳐집니다',
      /* 없어야 하는 것들: 상시 배너(고칠 게 없는 경고), 도식(설명 과잉),
         제거된 설정, 생성 코드 없는 이벤트 유형, 옛 라벨 */
      '!다른 구간 기준입니다', '!← 지금', '!집계 방식', '!스펙트럼 변화', '!평가 윈도우',
      '!대역 에너지 추세']],
  /* 부하 문구는 문제일 때만 — 여유로우면 표시하지 않는다(3%를 알릴 이유가 없다).
     값은 판정 틱이 실제로 잰 소요를 쓴다(_tickCostMs). 상수 추정이던 시절엔 태그 20개·주기 1초가
     경고 대상이었지만, 실측하면 그 조건은 실제로 여유롭다 — 경고는 정말 밀릴 때만 떠야 한다. */
  ['settings monitor 부하 경고(실측)', { tab: 'settings', setSection: 'monitor', monitorInterval: '1s',
    _tickCostMs: 780 },
    ['780ms(실측)', '주기의 78%를 씁니다']],
  ['settings monitor 부하 초과(회차 밀림)', { tab: 'settings', setSection: 'monitor', monitorInterval: '1s',
    _tickCostMs: 1400 },
    ['다음 회차를 밀어냅니다']],
  ['settings monitor 부하 여유(문구 없음)', { tab: 'settings', setSection: 'monitor', monitorInterval: '1m',
    _tickCostMs: 130 },
    ['!%를 씁니다']],
  // 첫 틱 전에는 잰 값이 없다 — 모델 추정으로 채우되 실측이 아님을 밝힌다
  ['settings monitor 부하 미측정(예상)', { tab: 'settings', setSection: 'monitor', monitorInterval: '1s',
    _tickCostMs: null }, ['!(실측)']],
  // RMS 구간 < 판정 주기는 데이터에 구멍을 만든다 — 화면에서 경고하고 선택지도 잠근다
  ['settings monitor RMS구간 부족 경고', { tab: 'settings', setSection: 'monitor', monitorInterval: '30s', evalWindow: '3s' },
    ['RMS 구간이 판정 주기보다 짧습니다', '주기보다 짧음']],
  // 이벤트 유형 필터는 실제 생성되는 6종이어야 한다(spectrum은 항상 0건이었음)
  ['monitor 이벤트 유형 필터', { tab: 'monitor' },
    ['임계 초과', '상태 지속', '정상 복귀', '베이스라인 이탈', '대역 이탈', '대역 복귀', '!스펙트럼 변화']],
  ['settings llm+테스트중', { tab: 'settings', setSection: 'llm', llmTesting: true }],
  ['settings llm ollama+테스트결과', { tab: 'settings', setSection: 'llm', llmProvider: 'ollama', llmTest: { ok: true, msg: 'ok' } }],
  ['이벤트 미확인만', { tab: 'monitor', evtNewOnly: true }],
  /* 상세 열 — 유형마다 담기는 것이 다르다. 숫자열이 아니라 "값 · 근거" 한 줄이고,
     두절은 지표값 자체가 없어 무수신 시간만 쓴다(0을 보여주면 0을 측정한 것으로 읽힌다). */
  ['monitor 이벤트 상세(유형별)', { tab: 'monitor', evtScope: 'all', evtType: 'all', evtTag: 'all', events: [
    _evt({ id: 'e1', type: 'threshold', typeKo: '임계 초과', value: 2.8043, base: 2.8, grade: 2 }),
    _evt({ id: 'e2', type: 'band', typeKo: '대역 이탈', value: 1.0773, base: 1, grade: 1,
      bands: [{ k: 'sub', ko: '서브동기', v: 0.03, lim: 0.029, r: 1.03 }, { k: 'one', ko: '1× 대역', v: 0.048, lim: 0.045, r: 1.08 }] }),
    _evt({ id: 'e3', type: 'bandrec', typeKo: '대역 복귀', value: 0.8999, base: 1, grade: 0 }),
    _evt({ id: 'e4', type: 'signal_lost', typeKo: '신호 두절', value: 0, base: 0, grade: 1, detail: '4분 무수신' }),
    // DETAIL이 비어 있는 옛 두절 이벤트 — 시간 없이 사실만 남는다(0 / 기준 0으로 새면 안 된다)
    _evt({ id: 'e5', type: 'signal_lost', typeKo: '신호 두절', value: 0, base: 0, grade: 1, detail: '' }),
  ] },
    ['상세', '2.80 mm/s', '· 기준 2.80', '×1.08', '· 2개 대역(서브동기·1× 대역)', '×0.90', '· 전 대역 정상',
      '4분 무수신', '>무수신<',
      // 옛 열 제목·구분자와, 두절 행이 숫자로 새는 경우
      '!지표값 vs 기준', '!/ 기준', '!0.000 mm/s', '!기준 0.000']],
];

const baseState = JSON.parse(JSON.stringify(app.state));
let fail = 0;

/* 정적 검사 — renderToString은 실제 DOM을 만들지 않아 "속성명이 통째로 빠진 태그"(<th "style값">)를
   그대로 통과시킨다. 브라우저에서는 setAttribute가 InvalidCharacterError로 죽어 화면이 멈춘다.
   렌더 테스트로는 잡히지 않는 부류라 소스를 직접 훑는다. */
{
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/view.js', import.meta.url), 'utf8');
  const bad = [...src.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\s+"/g)];
  if (bad.length) {
    fail++;
    console.error('FAIL 속성명 없는 태그 ' + bad.length + '건 —', [...new Set(bad.map((m) => '<' + m[1]))].join(' '));
  } else console.log('PASS 태그 속성명 정적 검사');
  /* data-tip은 textContent로 렌더되므로 HTML 엔티티가 디코딩되지 않고 문자 그대로 보인다.
     줄바꿈이 필요하면 마크업이 아니라 app.js의 helpTip에 일반 문자열('\n')로 둬야 한다. */
  /* data-tip을 붙였으면 cursor:help도 같이 둔다 — 커서 변화가 유일한 호버 단서다. */
  {
    const spans = [...src.matchAll(/<span[^>]*data-tip=[^>]*>/g)].map((m) => m[0]);
    // style이 변수(${...})면 안을 볼 수 없다 — 정적 검사 대상에서 뺀다(false positive 방지)
    const noCur = spans.filter((t) => !/cursor: help/.test(t) && !/codicon/.test(t) && !/style=\$\{/.test(t));
    if (noCur.length) console.log('NOTE data-tip에 cursor:help 없는 span ' + noCur.length + '건 (점선 밑줄만 표시됨)');
    else console.log('PASS 호버 표시 일관성');
  }
  const ent = [...src.matchAll(/data-tip="[^"]*&#\d+;/g)];
  if (ent.length) {
    fail++;
    console.error('FAIL data-tip에 HTML 엔티티 ' + ent.length + '건 — helpTip으로 옮기고 \\n을 쓸 것');
  } else console.log('PASS data-tip 엔티티 정적 검사');
}
/* import 누락 검사 — data/live.js의 함수를 쓰면서 import를 빠뜨리면 그 코드가 실행될 때
   ReferenceError가 동기로 던져진다. 클릭 핸들러 안에서 나면 화면에 아무 반응이 없어
   "버튼이 동작 안 한다"로만 보인다(실제로 채우기 버튼이 그렇게 죽어 있었다).
   renderToString은 그 경로를 안 타므로 렌더 테스트로는 잡히지 않는다. */
{
  const rd = (await import('node:fs/promises')).readFile;
  const appSrc = await rd(new URL('../src/app.js', import.meta.url), 'utf8');
  const liveSrc = await rd(new URL('../src/data/live.js', import.meta.url), 'utf8');
  const exported = [...liveSrc.matchAll(/export const (\w+)/g)].map((m) => m[1]);
  const imported = new Set();
  for (const m of appSrc.matchAll(/import \{([^}]+)\} from '\.\/data\/live\.js'/g)) {
    m[1].split(',').forEach((x) => imported.add(x.trim()));
  }
  // 호출 형태로 쓰이는데 import가 없는 이름 (앞에 . 이 붙으면 다른 객체의 메서드라 제외)
  const missing = exported.filter((n) => !imported.has(n)
    && new RegExp('(^|[^.\\w])' + n + '\\s*\\(', 'm').test(appSrc));
  if (missing.length) {
    fail++;
    console.error('FAIL live.js import 누락 ' + missing.length + '건 — ' + missing.join(', '));
  } else console.log('PASS live.js import 정합성 (' + exported.length + '개 export 대조)');

  /* 첫 화면 운전 상태 — _reloadLive가 _refreshRunState를 부르지 않으면, 판정 틱이 처음 도는
     주기(iv)만큼 두절 설비가 배지 없이 정상처럼 보인다. 렌더 테스트로는 잡히지 않는 배선이라
     소스에서 확인한다(_reloadLive 본문 안에 호출이 있는지). */
  {
    const rl = /_reloadLive\(\) \{[\s\S]*?\n  \}/.exec(appSrc);
    if (!rl) { fail++; console.error('FAIL _reloadLive 본문을 찾지 못함 — 정규식 확인'); }
    else if (rl[0].indexOf('_refreshRunState') < 0) {
      fail++;
      console.error('FAIL 첫 화면 운전 상태 미계산 — _reloadLive에서 _refreshRunState를 부를 것');
    } else console.log('PASS 첫 화면 운전 상태 계산');
  }

  /* 설정 키 저장 경로 검사 — CFG_KEYS에만 있고 db.js CONFIG_FILES에 없는 키는 파일로 안 나간다.
     반대로 CONFIG_FILES에만 있으면 저장은 되는데 켤 때 복원이 안 된다(카드 순서가 그랬다). */
  const dbSrc = await rd(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
  const ck = /var CFG_KEYS = \[([\s\S]*?)\];/.exec(appSrc);
  const cf = /var CONFIG_FILES = \{([\s\S]*?)\};/.exec(dbSrc);
  if (!ck || !cf) { fail++; console.error('FAIL 설정 키 목록을 찾지 못함 — CFG_KEYS/CONFIG_FILES 정규식 확인'); }
  else {
    const keys = [...ck[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const filed = new Set([...cf[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const unsaved = keys.filter((k) => !filed.has(k));
    // CONFIG_FILES 쪽은 파일명(.json)도 같이 잡히므로 빼고 비교한다
    const unread = [...filed].filter((k) => !/\.json$/.test(k) && keys.indexOf(k) < 0);
    if (unsaved.length || unread.length) {
      fail++;
      console.error('FAIL 설정 키 불일치 — 저장 안 됨: [' + unsaved.join(', ') + '] · 복원 안 됨: [' + unread.join(', ') + ']');
    } else console.log('PASS 설정 키 저장·복원 정합성 (' + keys.length + '개)');
  }
}

for (const [label, patch, expect] of cases) {
  try {
    /* _로 시작하는 키는 state가 아니라 인스턴스 필드로 넣는다 — 판정 루프가 계산해 두는
       중간값(_runState·_flap 등)은 state에 없어서, state에만 넣으면 화면에 아무 영향이 없다. */
    const inst = {}, st = {};
    for (const [k, v] of Object.entries(patch)) (k[0] === '_' ? inst : st)[k] = v;
    app._runState = null; app._flap = null; app._gradeState = null;   // 케이스 간 이월 방지
    Object.assign(app, inst);
    Object.assign(app.state, JSON.parse(JSON.stringify(baseState)), st);
    const out = renderToString(view(app.renderVals()));
    if (!out || out.length < 500) throw new Error('suspiciously short output: ' + out.length);
    // expect가 있으면 "렌더가 깨지지 않았다"를 넘어 "그 내용이 실제로 나왔다"까지 확인한다.
    // '!' 접두면 부재 검사 — 조건부로 숨겨야 하는 UI(계통주파수 칩 등)가 새어 나오면 잡는다.
    const miss = (expect || []).filter((s) => s[0] === '!' ? out.indexOf(s.slice(1)) >= 0 : out.indexOf(s) < 0);
    if (miss.length) throw new Error('기대 불일치: ' + miss.join(' / '));
    console.log('PASS', label, '(' + out.length + ' chars)');
  } catch (e) {
    fail++;
    console.error('FAIL', label, '—', e.message);
  }
}
process.exit(fail ? 1 : 0);
