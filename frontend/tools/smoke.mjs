// 런타임 스모크 — 전 탭·주요 분기(모달/토스트/빈 상태/커스텀 베어링 등)를 renderToString으로 실제 평가
// · htm 템플릿은 런타임 파싱이라 빌드 성공만으로는 부족함
// 오프라인(Neo 불필요) · npm run smoke 포함
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
// 앱은 라이브 전용 — 목 데이터를 라이브 상태 모양으로 주입해 템플릿 검증
app.E = E; app.live = true;
const d = Mock.generateData(42, 20);
// 목 설비엔 샘플레이트가 없음 — 라이브처럼 채워 대역 카드(채움 현황·주기 변경 예상치) 분기까지 검사
d.equipment.forEach((e) => { e.fs = 25600; });
app.data = d;
app.liveTables = ['VIBRATION_RAW', 'SENSOR_DATA', 'MOTOR_CURRENT', 'GEARBOX_VIB', 'BEARING_TEMP'];
const sorted = d.equipment.slice().sort((a, b) => b.grade - a.grade);
sorted.forEach((e, i) => { e.order = i; });
const eq0 = sorted[0];
const eqG = sorted.find((e) => e.unit === 'g') || eq0;   // 가속도 설비 — 원본 단위 표시 검사용
/* 판정 한 회차 뒤의 _gradeState — 전 태그 채움
   (일부만 채우면 나머지 카드가 '판정 대기'라 보류 부재를 검사 못 함) */
const gradedAll = (patOk) => Object.fromEntries(sorted.map((e) => [e.table + ':' + e.name, { gi: 0, patOk: patOk, patOn: false }]));
app._detailCache[eq0.id] = { state: 'ready', det: Mock.buildDetail(eq0) };
Object.assign(app.state, {
  ready: true, user: 'TESTER', srcSel: app.liveTables.slice(), selTag: eq0.id, diagTag: eq0.id,   // 토큰·계정 확인을 마친 상태
  events: d.events.slice(), reports: d.reports.slice(),
  genTags: sorted.slice(0, 3).map(e => e.id),
  genPeriod: 'all', genFrom: E.fmtDT(d.now - 86400000), genTo: E.fmtDT(d.now),
  from: E.fmtDT(d.now - 7 * 86400000).slice(0, 10), to: E.fmtDT(d.now).slice(0, 10),
});
// 이벤트 한 건 생성 — 유형별로 필요한 필드만 덮어씀
const _evt = (o) => Object.assign({
  ms: d.now, tagId: eq0.id, tagAlias: eq0.alias || eq0.name, tagName: eq0.name,
  unit: 'mm/s', value: 0, base: 0, grade: 0, bands: null, detail: '',
}, o);
const cases = [
  ['monitor 기본', {}, ['등급: 결함 패턴 + ISO 존', '!심각도: ']],
  ['monitor 필터+알람중지+토스트', { gradeFilter: 1, monitorOn: false, toast: { msg: 't', kind: 'warn' } }],
  ['monitor 빈 소스', { srcSel: [] }],
// 테이블 필터 — 드롭다운(체크·수·푸터)과 적용 칩 렌더 확인
  ["monitor 테이블 필터 열림", { tblOpen: true }, ["테이블 검색", "전체 선택", "전체 해제", "닫기", "GEARBOX_VIB"]],
  ['monitor 테이블 필터 적용', { tblHide: ['SENSOR_DATA'] }, ['MOTOR_CURRENT', 'codicon-close', '!전체 테이블 표시 중']],
  ['monitor 테이블 전체 표시', {}, ['전체 테이블 표시 중']],
  ['monitor 테이블 전부 해제', { tblHide: ['VIBRATION_RAW', 'SENSOR_DATA', 'MOTOR_CURRENT', 'GEARBOX_VIB', 'BEARING_TEMP'] }, ['표시할 테이블을 하나도 고르지 않았습니다', '전체 표시']],
  ['detail 기본', { tab: 'detail' }],
  ['detail 빈 소스', { tab: 'detail', srcSel: [] }],
  ['detail 종합분석+AI소견', { tab: 'detail', dxOpen: true, dxAiText: '소견 텍스트' }],
  ['detail AI 로딩', { tab: 'detail', dxOpen: true, dxAiText: '__loading__' }],
/* 설비 카드 순서 — 저장 순서 우선, 나머지는 심각도순으로 뒤에 붙음(순서 없으면 심각도 내림차순) */
  ['monitor 카드 드래그 가능', { tab: 'monitor' },
    ['draggable="true"', 'cursor: grab']],
  ['monitor 카드 사용자 순서', { tab: 'monitor', cardOrder: [sorted[3].id, sorted[1].id] },
    // 지정한 둘이 앞으로 오고 나머지는 심각도순
    [sorted[3].name, sorted[1].name]],
// 드래그 중 카드는 흐림 + 미리보기 순서대로 렌더
  ['monitor 카드 드래그 중', { tab: 'monitor', cardDragId: sorted[0].id },
    ['opacity: .35;', 'grabbing']],
  ['monitor 카드 드래그 미리보기', { tab: 'monitor', cardDragId: sorted[0].id, cardOrder: [], cardPreview: [sorted[2].id, sorted[0].id] },
    [sorted[2].name, sorted[0].name]],
/* 감시 이상 배너 — 알람 부재가 '정상'인지 '감시 중단'인지 구분용
   (서버 타이머는 등록 성공 후 첫 실행에서 죽을 수 있음) */
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
/* 정지·신호 두절 배지 — 둘 다 값이 조용하지만 뜻이 정반대임
   (두절은 화면 값이 과거 값이라 표시 없으면 정상으로 오해) */
  ['monitor 신호 두절 배지', { tab: 'monitor', _runState: { [eq0.table + ':' + eq0.name]: { lost: true, run: false, age: 7200000 } } },
    ['신호 두절', 'codicon-debug-disconnect', '센서·수집기·네트워크']],
/* 두절이면 스파크라인 '실시간' 캡션 없음(배지와 모순 방지)
   · 다른 카드 캡션에 가려지지 않게 전 카드를 두절로 놓고 확인 */
  ['monitor 두절이면 실시간 캡션 없음',
    { tab: 'monitor', _runState: Object.fromEntries(sorted.map((e) => [e.table + ':' + e.name, { lost: true, run: false, age: 7200000 }])) },
    // 선도 흐림 — 선명하면 현재 값으로 읽힘
    ['신호 두절', 'opacity: .4', '!실시간 · 최근 1분']],
  ['monitor 정지 배지', { tab: 'monitor', _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: false, age: 1000 } } },
    // 정지는 수신 중 — 캡션 유지
    ['정지', 'codicon-debug-pause', '판정을 얼립니다', '실시간 · 최근 1분', '!opacity: .4']],
  // '신호 두절' 문구는 이벤트 유형 필터에도 있음 — 배지 아이콘으로 부재 확인
  ['monitor 운전 중이면 배지 없음', { tab: 'monitor', _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: true, age: 1000 } } },
    ['!codicon-debug-disconnect', '!codicon-debug-pause']],
  /* 확정 상태를 칩 옆에 표시 — 악화·복귀를 대칭으로
     (복귀 1회차 표시가 없으면 카드가 조용히 초록이 되고, 되돌아가도 이벤트가 없어 흔적이 안 남음) */
  ['monitor 확정 전은 회차 표시', { tab: 'monitor', _runState: {},
    _gradeState: Object.assign(gradedAll(true), { [eq0.table + ':' + eq0.name]: { gi: 1, patOk: true, patOn: true } }),
    _monState: { [eq0.table + ':' + eq0.name]: { g: 0, candN: 1 } } },
    ['1회차']],
  ['monitor 확정 뒤는 지속 시간', { tab: 'monitor', _runState: {},
    _gradeState: Object.assign(gradedAll(true), { [eq0.table + ':' + eq0.name]: { gi: 1, patOk: true, patOn: true } }),
    _monState: { [eq0.table + ':' + eq0.name]: { g: 1, since: Date.now() - 40 * 60000 } } },
    ['40분째']],
  ['monitor 복귀 대기는 복귀 회차', { tab: 'monitor', _runState: {},
    _gradeState: Object.assign(gradedAll(true), { [eq0.table + ':' + eq0.name]: { gi: 0, patOk: true, patOn: false } }),
    _monState: { [eq0.table + ':' + eq0.name]: { g: 1, since: Date.now() - 40 * 60000, candN: 1 } } },
    ['복귀 1회차']],
  /* 등급 칩 옆에 축 이름 없음 — 등급을 올리는 축이 결함 패턴 하나라 매 카드 같은 말이 됨
     (근거는 값 호버가 표시) */
  ['monitor 등급 칩에 축 이름 없음', { tab: 'monitor',
    _gradeState: { [eq0.table + ':' + eq0.name]: { gi: 2, src: 'pattern', patOk: true, patOn: true, patR: 6.04, iso: 0.31, wide: 3.55, limited: true } } },
    ['!· 대역', '!· 베이스라인', '!· 결함 패턴']],
  // 등급 근거는 값 호버에 — 격자 점수 포함
  ['monitor 등급 근거는 값 호버에', { tab: 'monitor',
    _gradeState: { [eq0.table + ':' + eq0.name]: { gi: 2, src: 'pattern', patOk: true, patOn: true, patR: 6.04, iso: 0.31, wide: 3.55, limited: true } } },
    ['결함 패턴 검출', '격자 6.0', 'ISO 10~1000 Hz', '전대역', '1 kHz 위']],
  /* 되살아난 태그 — 재등록 태그에 옛 학습값이 말없이 붙는 것 방지
     · 확인 전까지 베이스라인·대역 판정 정지 → 화면에 표시 */
  ['settings criteria 되살아난 태그', { tab: 'settings', setSection: 'criteria',
    revived: { [eq0.table + ':' + eq0.name]: 1 },
    baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60, at: 1785000000000 } } },
    ['학습값이 남아 있습니다 — 이전과 같은 설비인가요?', '같은 설비 — 유지', '다른 설비 — 초기화', '남의 기준으로 판정']],
  ['monitor 되살아남 배너', { tab: 'monitor',
    health: [{ k: 'revived', lv: 'warn', text: 'C1 — 새로 추가된 태그에 예전 학습값이 남아 있습니다. 이전과 같은 설비인지 확인해 주세요', act: '설정에서 확인' }] },
    ['예전 학습값이 남아 있습니다', '설정에서 확인']],
  /* 표시 상한 — 잘린 태그는 무감시라 테이블별 잘린 개수까지 표시 */
  ['settings source 상한 초과', { tab: 'settings', setSection: 'source',
    srcCap: { perTable: [{ table: 'VIBRATION_RAW', shown: 20, total: 27, byTotal: false }], dropped: 7, droppedKeys: {}, eligible: 27, shown: 20, byTotal: false } },
    ['27개 중 20개', '7개 제외', '테이블당 상한']],
  ['settings source 상한 안(안내 없음)', { tab: 'settings', setSection: 'source' }, ['!표시 상한']],
  // 계정 권한 표(SYS) — 상태·타이머·버튼, 회수는 줄 안에서 확인
  ['settings source 계정 권한 표', { tab: 'settings', setSection: 'source', user: 'SYS', grantUsers: ['JOY', 'TESTUSER'],
    grantStatus: { JOY: { n: 5, total: 5, timers: 1 } } },
    ['패키지 사용 계정 권한', '권한 있음', '권한 없음', '타이머 1개', '권한 회수', '권한 주기', '-- 권한 회수', '!의 권한을 회수할까요?']],
  ['settings source 계정 권한 회수 확인', { tab: 'settings', setSection: 'source', user: 'SYS', grantUsers: ['JOY'],
    grantStatus: { JOY: { n: 5, total: 5, timers: 1 } }, grantAsk: 'JOY' },
    ['의 권한을 회수할까요?', '매 회차 실패합니다', '>회수<', '>취소<']],
  /* 별칭 편집 목록·검색 — 스모크엔 DB가 없어 _tagCache를 심어 필터 경로를 태움 */
  ['settings source 별칭 목록', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'], _tagCache: { VIBRATION_RAW: ['P1', 'P2', 'MOTOR_A'] } },
    ['VIBRATION_RAW · P1', 'VIBRATION_RAW · MOTOR_A', '>3개<']],
  ['settings source 별칭 검색', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'], _tagCache: { VIBRATION_RAW: ['P1', 'P2', 'MOTOR_A'] }, tagQuery: 'motor' },
    ['VIBRATION_RAW · MOTOR_A', '1 / 3개', '!VIBRATION_RAW · P1']],
  ['settings source 별칭 검색 무결과', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'], _tagCache: { VIBRATION_RAW: ['P1', 'P2', 'MOTOR_A'] }, tagQuery: 'ZZZNOPE' },
    ['검색과 일치하는 태그가 없습니다']],
  /* 목록 = 테이블 전 태그 — 상한 밖 태그는 '감시 제외' 표시
     · 그리는 줄 수만 제한하고 남은 개수는 고지 */
  ['settings source 별칭 감시제외 표시', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'],
    _tagCache: { VIBRATION_RAW: ['P1', 'P2'] },
    srcCap: { perTable: [], dropped: 1, droppedKeys: { 'VIBRATION_RAW:P2': 1 }, eligible: 2, shown: 1, byTotal: false } },
    ['VIBRATION_RAW · P2', '감시 제외']],
  ['settings source 별칭 줄 수 제한 고지', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'],
    _tagCache: { VIBRATION_RAW: Array.from({ length: 260 }, (_, i) => 'T' + i) } },
    ['260개', '아래로 더 내리면 60개가 이어집니다']],
  // 끝까지 이어 붙인 뒤에는 남은 개수 안내 없음
  ['settings source 별칭 이어 붙인 뒤', { tab: 'settings', setSection: 'source', srcSel: ['VIBRATION_RAW'],
    _tagCache: { VIBRATION_RAW: Array.from({ length: 260 }, (_, i) => 'T' + i) }, aliasShown: 400 },
    ['260개', 'VIBRATION_RAW · T259', '!이어집니다']],
  ['monitor 상한 배너', { tab: 'monitor',
    health: [{ k: 'cap', lv: 'warn', text: '태그 7개가 표시 상한(테이블당 20개 · 전체 40개)을 넘어 감시에서 빠져 있습니다 — 감시 중인 태그는 20개입니다', act: '설정에서 확인' }] },
    ['감시에서 빠져 있습니다', '설정에서 확인']],
  /* 서버 회차 지연 경고 — 회차가 주기를 넘으면 잠금에 막혀 건너뜀(RUNNING인데 간격만 늘어남)
     · 겹치기 전에 고지 */
  ['monitor 서버 회차 지연 경고', { tab: 'monitor',
    health: [{ k: 'slowtick', lv: 'warn', text: '서버 감시 1회차가 8.2초 걸립니다 (주기 10s · 태그 120개) — 주기를 늘리는 것을 권합니다.', act: '설정 열기' }] },
    ['1회차가 8.2초 걸립니다', '설정 열기']],
  ['monitor 서버 회차 초과(주기 건너뜀)', { tab: 'monitor',
    health: [{ k: 'slowtick', lv: 'err', text: '서버 감시 1회차가 12.4초 걸립니다 (주기 10s · 태그 200개) — 회차가 겹쳐 일부 주기를 건너뜁니다. 주기를 늘리거나 감시 태그를 줄이세요.', act: '설정 열기' }] },
    ['회차가 겹쳐 일부 주기를 건너뜁니다']],
  /* 계측 이상 배지 — 정지보다 우선
     · 플랫라인은 정지처럼 보이나 센서 고장으로 무감시 상태임 */
  ['monitor 계측 이상 배지', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: false, age: 1000, gate: { label: '플랫라인', detail: 'σ 0.00001 / peak 2.400' } } } },
    ['계측 이상', 'codicon-warning', '플랫라인', '헛경보', '센서·케이블·마운팅', '!codicon-debug-pause']],
  // 두절이 계측 이상보다 우선 — 데이터가 없으면 볼 파형도 없음
  ['monitor 두절이 계측 이상보다 우선', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: true, run: false, age: 7200000, gate: { label: '플랫라인', detail: 'x' } } } },
    // '계측 이상' 문구는 이벤트 유형 필터에도 있음 — 배지 툴팁 문구로 부재 확인
    ['신호 두절', '!센서·케이블·마운팅']],
  /* 판정 보류 — 계측 이상·신호 두절·정지는 등급 미부여
     · 등급 칩 대체 + 등급 집계 제외("계측 이상인데 양호" 같은 모순 방지) */
  ['monitor 판정 보류 칩(계측 이상)', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: true, age: 1000, gate: { label: '플랫라인', detail: 'x' } } } },
    // 색도 중립 — 테두리·스파크까지 등급색이 아니어야 함
    ['판정 보류', '지금 등급을 매기지 않습니다', '플랫라인', 'border-left: 3px solid var(--text-muted)']],
  ['monitor 판정 보류 칩(정지)', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: false, run: false, age: 1000 } } },
    ['판정 보류', '정지']],
  ['monitor 판정 보류 칩(두절)', { tab: 'monitor',
    _runState: { [eq0.table + ':' + eq0.name]: { lost: true, run: false, age: 7200000 } } },
    ['판정 보류', '신호 두절']],
  /* 보류가 아니면 등급 칩 유지
     · '판정 보류'는 KPI 라벨에도 있어 칩 툴팁 문구로 부재 확인
     · patOk(결함 패턴 측정됨)라야 보류가 아님 */
  ['monitor 정상은 등급 칩 유지', { tab: 'monitor', _runState: {}, _gradeState: gradedAll(true) },
    ['!지금 등급을 매기지 않습니다']],
  /* 결함 패턴 미측정(회전수·기하 없음) = 양호 아닌 보류
     · 등급을 켜는 축이 그 하나라 초록이면 "이상 없음" 단언이 됨 */
  ['monitor 패턴 미측정은 보류', { tab: 'monitor', _runState: {}, _gradeState: gradedAll(false) },
    ['판정 보류', '지금 등급을 매기지 않습니다', '판정 못 함']],
  // 첫 판정 회차 전 = 판정 대기(등급 미부여)
  ['monitor 판정 전에는 대기', { tab: 'monitor', _runState: {}, _gradeState: {} },
    ['판정 보류', '지금 등급을 매기지 않습니다', '판정 대기']],
  // KPI 칸 — 보류 내역은 호버로
  ['monitor KPI 판정 보류 칸', { tab: 'monitor',
    _runState: {
      [sorted[0].table + ':' + sorted[0].name]: { lost: true, run: false, age: 7200000 },
      [sorted[1].table + ':' + sorted[1].name]: { lost: false, run: true, age: 1000, gate: { label: '클리핑', detail: 'x' } },
      [sorted[2].table + ':' + sorted[2].name]: { lost: false, run: false, age: 1000 },
    } },
    ['판정 보류', '계측 이상 1대', '신호 두절 1대', '정지 1대']],
  /* 상세 기간 통계 표 — 리포트와 같은 지표(중앙값·P95 등), COUNT/AVG/MIN/MAX 칸 없음
     · MIN=정지 구간, MAX=스파이크 좌우, AVG=간헐 고진동 평탄화라 오해 유발 */
  /* 심각도 패널 — 결함 패턴(발동 여부) | ISO 존(진동 크기)
     · 존은 규격 뜻(A~D), 등급어는 결과 줄에만 · A·B는 결과 줄 한 칸 · 종합 분석 토글은 머리줄 */
  ['detail 심각도 패널 두 열', { tab: 'detail' },
    ['결함 패턴', '발동 여부', '진동 크기', '신규 설비 수준', '손상 우려', '결함 패턴이 있을 때의 판정 등급',
      'grid-column: span 2', '!권장 조치 <b', 'codicon-chevron-down', '!종합 위험도', '!A 양호', '!종합 분석 펼치기</button>']],
  ['detail 기간 통계 표(중앙값·P95)', { tab: 'detail' },
    ['기간 통계', 'ISO 판정값', '광대역 RMS P95', '중앙 ', '지속 최악', 'Crest Factor P95', '변화율', '관측 창', 'B/C 초과',
      '!통계 요약', '!건수 (COUNT)', '!평균 (AVG)', '!최솟값 (MIN)', '!최댓값 (MAX)']],
  /* 카드 숫자 = 판정값(ISO 대역제한) — 라벨은 측정 대역 주파수
     · 베이스라인·대역 축 값은 카드 본문에 없음(미학습이면 "—"만 늘어 잡음), 값 호버에만 */
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
  // 데이터 관리 — 현황 조회 전·중·후, 삭제 2단계(날짜 고르기 → 건수 확인) 분기
  ['settings data 현황 읽는 중', { tab: 'settings', setSection: 'data', usageBusy: true }, ['현황을 읽는 중']],
  // usageBusy 명시 해제 — baseState에 없는 키라 앞 케이스 값이 남음
  ['settings data 현황 실패', { tab: 'settings', setSection: 'data', usage: null, usageBusy: false }, ['현황을 읽지 못했습니다']],
  ['settings data 현황', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: { from: d.now - 11 * 86400000, to: d.now } },
    band: { rows: 39120, keys: 396, span: { from: d.now - 30 * 86400000, to: d.now } },
    monstate: { rows: 269 }, baseline: { rows: 26 },
  } }, ['이벤트 이력', 'EVENTS', '>TAG<', '>LOOKUP<', '대역 에너지 추이', '판정 상태', '7,730건',
    '기간 삭제…', '기간 안 모든 태그', '학습 구간 포함 주의',
    /* 태그별 정리는 감시 목록 밖 태그가 있을 때만 — tagUsage 없음(현황만 읽음)이라 부재 */
    '!태그별 정리…', '!태그 단위 삭제도 가능',
    // 이벤트는 TAG 테이블 — 설비 단위 삭제 안내, LOG 제약 문구 없음
    '!LOG 테이블이라 중간을 지울 수 없어', '태그의 이력만 따로',
    // 학습값은 행 아닌 각주 — 덮어쓰기라 늘지 않아 정리 대상 아님
    '!학습값 (베이스라인)', '재학습이 같은 자리를 덮어써 늘지 않습니다', '판정 기준으로 이동',
    ]],
  // 기간 고르기 — 기본은 보관 중인 전체 구간(min~max), 사용자가 좁힘
  ['settings data 날짜 고르기(기본=전체 구간)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 100, span: { from: d.now - 30 * 86400000, to: d.now } }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purgePick: 'events', purgeFrom: null, purgeTo: null },
    ['이벤트 이력 삭제', '>선택<', '지울 기간을 정하세요', '보관 중:',
      E.fmtDT(d.now - 30 * 86400000).slice(0, 10) + ' ~ ' + E.fmtDT(d.now).slice(0, 10)]],
  // 보관 정보 없음 — 빈칸 + 잠금
  ['settings data 날짜 고르기(데이터 없음·잠금)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 0, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purgePick: 'events', purgeFrom: null, purgeTo: null },
    ['!value="20', 'not-allowed']],
  ['settings data 날짜 고르면 잠금 해제', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 100, span: { from: d.now - 30 * 86400000, to: d.now } }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purgePick: 'events', purgeFrom: '2026-07-01', purgeTo: '2026-07-15' },
    ['2026-07-01 ~ 2026-07-15', '!not-allowed']],
  ['settings data 확인(세는 중)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'events', fromMs: d.now - 86400000, toMs: d.now, counting: true, n: null } }, ['세는 중', '건수 확인 중']],
  ['settings data 확인(건수 나옴)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'events', fromMs: d.now - 86400000, toMs: d.now, counting: false, n: 5102, keep: 2628 } },
    ['정말 삭제하시겠습니까?', '5,102건 삭제', '삭제 후 남는 데이터 2,628건', '영구 삭제되며 복구할 수 없습니다',
      '이 기간을 다룬 리포트는 다시 만들 수 없습니다', '내보내기로 저장한 뒤 제거하는 것을 권장',
      // 테이블 이름 입력 전 삭제 버튼 잠금
      '계속하려면 테이블 이름', 'not-allowed']],
  // 테이블 이름 일치 시 잠금 해제(대소문자 무시)
  ['settings data 확인(이름 입력 완료)', { tab: 'settings', setSection: 'data', usage: {
    events: { rows: 7730, span: null }, band: { rows: 0, keys: 0, span: null }, monstate: { rows: 0 }, baseline: { rows: 0 },
  }, purge: { kind: 'events', fromMs: d.now - 86400000, toMs: d.now, counting: false, n: 5102, keep: 2628 }, purgeTyped: 'events' },
    ['5,102건 삭제', '!not-allowed']],
  // 삭제 실행 중 — 버튼 잠금·라벨 변경(중복 실행 방지)
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
    ['BAND', '14,418행 삭제', '대역 베이스라인을 다시 학습', '추세 차트에서 이 구간이 비어 보입니다',
      // 대역은 내보내기 경로 없음 — 이벤트 전용 안내 부재
      '!내보내기로 저장한 뒤']],
  ['settings equip+펼침+커스텀베어링', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: '직접 입력' } }],
  ['settings equip 슬리브', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: 'sleeve' } }],
  ['settings equip 계측·구동 전부 입력', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipRpm: { [eq0.id]: '1800' },
    equipBearing: { [eq0.id]: '6206' }, equipMeta: { [eq0.id]: { mount: 'magnet', drive: 'belt', belt: { d1: 120, d2: 300 }, vanes: 7 } },
  }, ['계측·구동', '벨트 제원', '종동축 1×', '베인 통과', '유효 상한 2.0 kHz', '외륜 결함 주파수', '케이지(리테이너) 회전 주파수', '풀리비(D1÷D2)로 계산한', '!전원 계통주파수']],
  ['settings equip 계측·구동 미입력(접힘 배지)', { tab: 'settings', setSection: 'equip', equipAdv: {} },
    ['형상·계측·구동', '마운팅 방식·구동방식·날개수', '!전원 계통주파수']],
  // 항목 옆 ? 호버 툴팁 — 표 헤더(단위·Class·RPM·베어링)·계측·구동 입력 양쪽
  // 계통주파수 칩은 평소 숨김(국내 60Hz 고정) — '!'로 부재 확인
  ['settings equip 항목 툴팁(표 헤더)', { tab: 'settings', setSection: 'equip' },
    ['ISO 10816 기계 등급', '동기속도(1800)는 넣지 마십시오', '베어링 외륜의 각인', '!전원 계통주파수']],
  ['settings equip 항목 툴팁(계측·구동 펼침)', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true },
    equipMeta: { [eq0.id]: { drive: 'belt', belt: { d1: 120, d2: 300 } } } },
    ['스터드 10, 접착 5, 자석 2, 프로브 1 kHz', '벨트 옆면의 각인', '마우스를 올리면 설명']],
  // 접힌 버튼 라벨은 행마다 '설정' — 직접 입력 여부는 옆 베어링 셀렉트가 표시
  ['settings equip 직접 입력도 버튼 라벨은 설정', { tab: 'settings', setSection: 'equip', equipBearing: { [eq0.id]: '직접 입력' } },
    ['</span>설정<span']],
  // 직접 입력(커스텀 베어링) 형상 4칸 툴팁
  ['settings equip 직접 입력 형상 툴팁', { tab: 'settings', setSection: 'equip', equipAdv: { [eq0.id]: true }, equipBearing: { [eq0.id]: '직접 입력' } },
    ['전동체(볼 또는 롤러)의 개수', 'ball diameter', 'pitch diameter', '깊은홈 볼베어링은 0°', '형상 제원 표']],
  /* 목록 필터·일괄 적용 — 손댈 줄만 남기는 필터 + 한 행 값을 다른 태그로 퍼뜨리는 일괄 적용(값 검사는 test-equipbulk.mjs)
     · 필터는 전체/판정 불가 둘뿐("미설정"은 판정 불가의 부분집합) */
  ['settings equip 목록 필터', { tab: 'settings', setSection: 'equip' },
    ['판정 불가', '회전수와 베어링 기하가 둘 다 있어야', '!설정 미완료']],
  ['settings equip 필터 빈 상태', { tab: 'settings', setSection: 'equip', equipFilter: 'blocked',
    equipRpm: Object.fromEntries(d.equipment.map((e) => [e.id, '1800'])),
    equipBearing: Object.fromEntries(d.equipment.map((e) => [e.id, '6209'])) },   // 카탈로그 품번이라야 기하가 붙음
    ['조건에 맞는 태그가 없습니다', '전체 보기']],
  ['settings equip 일괄 적용 패널', { tab: 'settings', setSection: 'equip',
    equipCls: { [eq0.id]: 'III' }, equipRpm: { [eq0.id]: '3600' }, equipBearing: { [eq0.id]: '6205' },
    equipMeta: { [eq0.id]: { mount: 'stud', drive: 'belt', belt: { d1: 120, d2: 300 }, vanes: 7 } },
    equipBulk: { id: eq0.id, scope: '', fields: {} } },
    // 칩 하나 = 입력칸 하나(값 전부 표시·개별 선택 가능)
    ['복사할 항목', '3600 rpm', '6205', '>계측<', '스터드', '>구동<', '벨트·풀리',
      '풀리 D1', '120 mm', '풀리 D2', '300 mm', '>날개수<', '7매',
      '개에 적용', '덮어씁니다', '같은 테이블']],
  ['settings equip 일괄 적용 — 복사할 값 없음', { tab: 'settings', setSection: 'equip',
    equipBulk: { id: eq0.id, scope: '', fields: {} } },
    ['복사할 값이 없습니다']],
  // 1800 rpm = 60Hz 4극 동기속도 — 50Hz 설정이면 불일치 경고
  ['settings equip 계통 불일치 경고(1800rpm인데 50Hz 설정)', { tab: 'settings', setSection: 'equip', lineHz: '50', equipRpm: { [eq0.id]: '1800' } },
    ['60 Hz 계통 동기속도에 맞습니다', '전기적 결함 100 Hz']],
  // 베이스라인 상태 툴팁은 학습된 태그에만 렌더 → 학습 상태를 주입해 그 경로까지 검사
  ['settings criteria', { tab: 'settings', setSection: 'criteria',
    baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60, ex: { idle: 8, ramp: 4 } } } },
    ['ISO 존 A와 B를 가르는', '조치 권고가 여기서 갈립니다', '긴급 점검 대상', '그 결함이 정상 기준이 됩니다',
      '정지·기동 구간과 순간 스파이크는 자동으로 걸러지지만', '99.7%가 한계 안', '사용자 정의 기준으로 판정',
      '스파이크에 흔들리지 않는 중앙값 방식', '최소 μ의 1.2배',
      'σ 0.30 (k=3)', '절대값이 ISO A 구간이라도', '학습은 선택 사항이며', '절대 임계</b>(존 경계) —',
      // 존은 규격 뜻으로 — 등급어(양호~심각)와 섞지 않음
      '등급은 결함 패턴이 잡혀야 켜지고', '카드와 근거표에 베이스라인 이탈로 표시됩니다', 'D 손상 우려', '!A(양호)', '!D 심각']],
  // 과거 채우기 진행 중 — 진행바·남은시간·"학습 가능" 표시가 렌더되는 경로
  ['settings criteria 과거채우기 진행중', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandFill: { done: 312, total: 864, eta: 690000, learnable: true } },
    ['과거 데이터 채우기', '312', '864', '남은 시간 약', '학습 가능 ✓', '중지']],
  ['settings criteria 과거채우기 미달', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandFill: { done: 20, total: 864, eta: 1055000, learnable: false } },
    ['학습 최소 표본 미달']],
  /* RMS·대역 학습 기간 분리 — 표본 밀도가 달라(대역이 훨씬 성김) 공유하면 대역 표본 부족 */
  ['settings criteria 학습 기간 분리', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandInterval: '10m', blWin: '1h', bandWin: '24h', evalWindow: '10s', monitorInterval: '3s' },
    ['정상 학습 기간', '대역 학습 기간', '10분마다 추출하므로 표본 144개', '판정 구간 10초 단위로 묶어 표본 360개']],
  // 최소 표본 미달 조합은 사전 경고(1시간 주기 × 6시간 = 6개 < 30)
  ['settings criteria 대역 표본 부족', { tab: 'settings', setSection: 'criteria', bandOn: true, bandInterval: '1h', bandWin: '6h' },
    ['표본 6개', '학습되지 않습니다', '추출 주기를 줄이거나 학습 기간을 늘리십시오']],
  // 대역 기간 선택지 — 표본이 성겨 1시간 선택지 없음
  ['settings criteria 대역 기간 선택지', { tab: 'settings', setSection: 'criteria', bandOn: true },
    ['최근 6시간', '최근 3일', '최근 7일']],
  /* 기간 분리 반영 — 값을 다르게 주고 각자 자기 값을 쓰는지 확인
     · 대역 경로(학습·채우기·주기변경 모달)는 bandWin 참조 */
  ['settings criteria 기간 분리 반영', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandInterval: '10m', blWin: '1h', bandWin: '7d', evalWindow: '10s', monitorInterval: '10s' },
    ['표본 1008개',            // 7일 ÷ 10분 = 1008 (blWin 1h였다면 6개)
      '최근 7일',              // 채우기 안내도 대역 기간
      '표본 360개']],          // RMS는 1시간 ÷ 10초 = 360
  /* 대역 카드 구조 — 구획 제목(추출·학습·학습 상태)으로 나누고 상세 설명은 툴팁으로 */
  ['settings criteria 대역 카드 구획', { tab: 'settings', setSection: 'criteria', bandOn: true },
    ['대역·결함 패턴 추출', '정상 기준 학습', '채널별 학습 상태', '학습됨',
      '!대역값 만들기',
      // 설명은 툴팁(data-tip 속성) 안 — 속성 접두까지 포함해 본문과 구분
      'data-tip="이미 쌓인 원본에서',
      // 이 경고만 본문에 — 결함 진행 중 학습은 그 결함을 정상 기준으로 만듦
      '결함이 진행 중이면 그 결함이 정상 기준이 됩니다',
      // 본문 설명 줄 부재
      '!>알람이 켜져 있을 때만 동작합니다']],
  // 학습 시점 표기 — 한 달 넘으면 색으로도 경고
  ['settings criteria 학습 시점 표기', { tab: 'settings', setSection: 'criteria',
    baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60, evalWin: 10, at: Date.now() - 3 * 3600000 } } },
    ['3시간 전', '학습 시점', '10초 구간 기준', '이 기준을 학습한 시점입니다']],
  /* 오래된 학습 — 좌측 배지에도 표시
     · 자동 재학습 안 하는 이유(결함을 정상으로 흡수)를 안내에 포함 */
  ['settings criteria 오래된 학습', { tab: 'settings', setSection: 'criteria',
    baselines: { [eq0.table + ':' + eq0.name]: { mu: 2.1, sigma: 0.3, k: 3, n: 60, spanMin: 60, at: Date.now() - 45 * 86400000 } } },
    ['개월 전', '한 달이 넘었습니다', '학습한 지 한 달이 넘은 태그', '재학습 1',
      '정비나 운전 조건 변경이 있었다면']],
  // 알람 설정 "판정 기준에서 변경"의 스크롤 앵커 — id 없으면 섹션 맨 위로 떨어짐
  ['settings criteria 추출 주기 칸에 앵커', { tab: 'settings', setSection: 'criteria' }, ['id="band-iv"']],
  /* 대역 주기 — 한 회차보다 짧은 주기는 잠금(회차가 겹쳐 표가 빔), 태그 규모로 판단
     · 이 주기가 등급 확정의 회차 길이도 정함을 고지 */
  ['settings criteria 대역 주기 — 회차보다 짧으면 잠금', { tab: 'settings', setSection: 'criteria', bandOn: true },
    ['한 회차 약', '겹쳐서 아무것도 쌓이지 않습니다', '등급 확정의 회차 길이도 정합니다']],
  /* 확인 대기 일괄 처리 — 되돌릴 수 없는 초기화는 일괄 대상 아님 */
  ['settings criteria 확인 대기 일괄', { tab: 'settings', setSection: 'criteria',
    revived: Object.fromEntries(sorted.slice(0, 3).map((e) => [e.table + ':' + e.name, { at: d.now }])),
    baselines: Object.fromEntries(sorted.slice(0, 3).map((e) => [e.table + ':' + e.name, { mu: 1, sigma: 0.05, k: 3, n: 130, at: d.now }])) },
    ['확인 대기', '3개', '모두 같은 설비 — 유지', '!모두 다른 설비']],
  ['settings criteria 확인 대기 없으면 줄도 없다', { tab: 'settings', setSection: 'criteria', revived: {} },
    ['!확인 대기']],
  /* 측정 불가 대역 — 빠진 대역과 이유 표시, 분모는 측정 가능한 계열 수
     · 1 kHz 위 옥타브 대역은 하한 고정이라 샘플레이트가 낮으면 Nyquist 초과로 빈 대역 */
  ['settings criteria 측정 불가 대역', { tab: 'settings', setSection: 'criteria', bandOn: true,
    baselines: Object.fromEntries(['sub', 'one', 'fault', 'high'].map((b) => [eq0.table + ':' + eq0.name + ':' + b,
      { mu: 1, sigma: 0.01, k: 3, n: 130, band: b, at: Date.now() }])) },
    /* 분모 9 = 대역 8(fs 25600이라 전부 측정 가능) + 주기성 1계열(품번 없어 결함주파수 3계열 제외)
       · 분자에 포락선이 포함되므로 분모도 포함 */
    ['4/9 계열 학습됨', '학습 안 됨', '2~4 kHz', '표본 부족 또는 학습 실패']],
  /* 표본 칩 — 비율 아닌 개수(판단 기준이 최소 표본 30개) */
  ['settings criteria 표본 현황', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandCov: { [eq0.table + ':' + eq0.name]: { set: {}, have: 144, need: 144 },
      [sorted[1].table + ':' + sorted[1].name]: { set: {}, have: 40, need: 144 },
      [sorted[2].table + ':' + sorted[2].name]: { set: {}, have: 0, need: 144 } } },
    ['표본 144개', '표본 40개', '표본 부족 0개', '칸에 대역값이 있습니다',
      '학습 최소 표본(30개)을 넘었습니다', '학습에는 최소 30개가 필요합니다',
      // 격자 경계 때문에 100%가 안 나오므로 분모 미표시
      '비어 있는 칸은 구간 경계와 진행 중인 칸이라 정상입니다',
      '!144/144', '!채움 28%', '!미채움']],
  // 전부 채워지면 완료 문구 + 버튼 잠금
  ['settings criteria 채움 완료', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandCov: Object.fromEntries(sorted.slice(0, 20).map((e) => [e.table + ':' + e.name, { set: {}, have: 144, need: 144 }])) },
    ['구간이 모두 채워져 있습니다', 'not-allowed']],
  // 주기 변경 모달 — 숫자 근거 + 이전 구간 처리 3안
  ['settings criteria 주기변경 모달', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandIvOpen: true, bandIvNext: '1m', bandIvAct: 'refill' },
    ['대역·결함 패턴 추출 주기 변경', '대역 학습 표본', '회차당 소요', '서버 점유율', '최소 학습 소요',
      '그대로 둠', '새 주기로 다시 계산', '대역 베이스라인 초기화', '적용']],
  // 1시간 주기 × 24시간 학습 = 24개 < 30 — 학습 불가 경고
  ['settings criteria 주기변경 학습불가 경고', { tab: 'settings', setSection: 'criteria', bandOn: true,
    bandIvOpen: true, bandIvNext: '1h', blWin: '24h' },
    ['학습 불가']],
  // 알람 설정 — 구간·주기 관계를 문장형으로 설명
  ['settings monitor', { tab: 'settings', setSection: 'monitor' },
    ['직전', '구간의 데이터를', '마다 판정',
      '구간이 길면 짧은 진동이 하나의 상태로 합쳐집니다',
      // 부재: 상시 배너·도식·제거된 설정·발화 안 하는 이벤트 유형·옛 라벨
      '!다른 구간 기준입니다', '!← 지금', '!집계 방식', '!스펙트럼 변화', '!평가 윈도우',
      '!대역 에너지 추세',
      '등급이 바뀌거나 신호 두절·계측 이상이 생기면 이벤트를 기록합니다', '!임계 초과·베이스라인 이탈 시 이벤트']],
  /* 부하 문구는 문제일 때만 — 값은 판정 틱 실측 소요(_tickCostMs) */
  ['settings monitor 부하 경고(실측)', { tab: 'settings', setSection: 'monitor', monitorInterval: '1s',
    _tickCostMs: 780 },
    ['780ms(실측)', '주기의 78%를 씁니다']],
  ['settings monitor 부하 초과(회차 밀림)', { tab: 'settings', setSection: 'monitor', monitorInterval: '1s',
    _tickCostMs: 1400 },
    ['다음 회차를 밀어냅니다']],
  ['settings monitor 부하 여유(문구 없음)', { tab: 'settings', setSection: 'monitor', monitorInterval: '1m',
    _tickCostMs: 130 },
    ['!%를 씁니다']],
  // 첫 틱 전 — 모델 추정값, '(실측)' 표기 없음
  ['settings monitor 부하 미측정(예상)', { tab: 'settings', setSection: 'monitor', monitorInterval: '1s',
    _tickCostMs: null }, ['!(실측)']],
  // RMS 구간 < 판정 주기면 데이터 구멍 — 경고 + 선택지 잠금
  ['settings monitor RMS구간 부족 경고', { tab: 'settings', setSection: 'monitor', monitorInterval: '30s', evalWindow: '3s' },
    ['RMS 구간이 판정 주기보다 짧습니다', '주기보다 짧음']],
  /* 이벤트 유형 필터 = 실제 발화하는 7종만(안 나오는 항목은 "0건"을 감시 문제로 오독)
     · 베이스라인·대역은 이벤트를 안 내 제외, 지난 이력 라벨은 TYPEKO로 렌더 */
  ['monitor 이벤트 유형 필터', { tab: 'monitor' },
    /* 베이스라인·대역 이름은 목데이터 지난 이벤트 행에 찍힘 — 필터 전용 '대역 복귀'로 부재 확인 */
    ['임계 초과', '상태 지속', '상태 개선', '정상 복귀', '계측 이상', '계측 복귀', '신호 두절',
      '!스펙트럼 변화', '!대역 복귀']],
  /* 확정 흐름 표시 — 확정 시간은 판정 기준의 추출 주기가 정함, 알람 설정엔 결과만(설정은 한 곳) */
  ['settings monitor 확정 흐름 표시', { tab: 'settings', setSection: 'monitor', bandInterval: '30m' },
    ['이상 진입', '정상 복귀', '1회차', '2회차', '이후',
      '확정 표시', '해제', '보내지 않음', '발송', '재알림 주기마다 다시 알림',
      /* 규칙·회차 길이·결과를 한 문장으로 — 값은 <b>로 렌더돼 문구와 값을 따로 확인
         · "등급이 바뀐 뒤"(변화에만 적용), "다음 판정에서도"(시간 아닌 회차), "최대"(발생 시점부터 최악값)
         · 30분 주기면 알림은 최대 1시간 */
      '>30분<', '마다 판정하고,', '등급이 바뀐 뒤 다음 판정에서도 같으면', '알림이 갑니다', '최대', '>1시간<', '주기 변경',
      // 블록 바닥은 테마별 실색 토큰(--bg-input은 흰색 오버레이라 다크에서 대비 붕괴)
      'var(--bg-inset)',
      // 제거된 설정 문구 부재
      '!진입·복귀 시간이 걸러냅니다']],
  ['settings llm+테스트중', { tab: 'settings', setSection: 'llm', llmTesting: true }, ['리포트 소견·상세분석 LLM 소견', '!이벤트 해설']],
  ['settings llm ollama+테스트결과', { tab: 'settings', setSection: 'llm', llmProvider: 'ollama', llmTest: { ok: true, msg: 'ok' } }],
  ['이벤트 미확인만', { tab: 'monitor', evtNewOnly: true }],
  /* 이벤트 상세 열 — 유형별 "값 · 근거" 한 줄
     · 두절은 지표값 없이 무수신 시간만(0 표시 금지) */
  ['monitor 이벤트 상세(유형별)', { tab: 'monitor', evtScope: 'all', evtType: 'all', evtTag: 'all', events: [
    _evt({ id: 'e1', type: 'threshold', typeKo: '임계 초과', value: 2.8043, base: 2.8, grade: 2 }),
    _evt({ id: 'e2', type: 'band', typeKo: '대역 이탈', value: 1.0773, base: 1, grade: 1,
      bands: [{ k: 'sub', ko: '서브동기', v: 0.03, lim: 0.029, r: 1.03 }, { k: 'one', ko: '1× 대역', v: 0.048, lim: 0.045, r: 1.08 }] }),
    _evt({ id: 'e3', type: 'bandrec', typeKo: '대역 복귀', value: 0.8999, base: 1, grade: 0 }),
    _evt({ id: 'e4', type: 'signal_lost', typeKo: '신호 두절', value: 0, base: 0, grade: 1, detail: '4분 무수신' }),
    // DETAIL 빈 두절 이벤트 — 시간 없이 사실만(0 / 기준 0 표시 금지)
    _evt({ id: 'e5', type: 'signal_lost', typeKo: '신호 두절', value: 0, base: 0, grade: 1, detail: '' }),
  ] },
    ['상세', '2.80 mm/s', '· 기준 2.80', '×1.08', '· 2개 대역(서브동기·1× 대역)', '×0.90', '· 전 대역 정상',
      '4분 무수신', '>무수신<',
      // 옛 열 제목·구분자, 두절 행 숫자 표시 부재
      '!지표값 vs 기준', '!/ 기준', '!0.000 mm/s', '!기준 0.000']],
  /* 가속도 설비 등급 이벤트 — 원본 단위 값 + 말로 된 근거(ISO 존·결함 부위), 숫자 기준 없음
     · 등급은 속도 ISO로 매겨 원본 단위 기준값이 없음 */
  ['monitor 이벤트 원본 단위(g)', { tab: 'monitor', evtScope: 'all', evtType: 'all', evtTag: 'all', events: [
    _evt({ id: 'g1', type: 'threshold', typeKo: '임계 초과', unit: 'g', value: 0.0773, base: 0, grade: 2,
      detail: 'ISO 위험 구간 · 격자 3.1 · 외륜(BPFO) · 2회 연속 확정' }),
    _evt({ id: 'g2', type: 'recovery', typeKo: '정상 복귀', unit: 'g', value: 0.0211, base: 0, grade: 0,
      detail: 'ISO 양호 구간 · 2시간 만에 복귀' }),
  ] },
    ['0.077 g', '0.021 g', 'ISO 위험 구간 · 결함 패턴 외륜(BPFO)', 'ISO 양호 구간', '!기준 0']],
  /* 가속도 설비 카드 — 판정은 속도 환산값(iso), 화면 숫자는 같은 대역 원본 단위 RMS(isoRaw) */
  ['monitor 가속도 카드 원본 단위', { _gradeState: { [eqG.table + ':' + eqG.name]: { gi: 2, src: 'pattern', patOk: true, patOn: true, patR: 6.04,
    iso: 4.0, isoRaw: 0.0771, wide: 0.31, limited: true, basis: 'iso' } } },
    ['0.077', 'ISO 10~1000 Hz  0.077 g', '속도로 환산해 비교합니다', '!ISO 10~1000 Hz  4.00']],
  /* 설정 읽기 실패 화면 — 탭 내용 없이 사유·다음 행동만
     · 조회 실패=다시 시도, 조각 손상=해당 영역 기본값으로 열기 추가 */
  ['설정 읽기 실패(조회)', { cfgFail: { kind: 'query', msg: '설정 조회 실패 — HTTP 500', domains: [] } },
    ['설정을 불러오지 못했습니다', '다시 시도', '설정 조회 실패 — HTTP 500', '!기본값으로 열기', '!카드 크기']],
  ['설정 읽기 실패(손상)', { tab: 'settings', cfgFail: { kind: 'broken', msg: '설정 일부가 손상됐습니다 — equipment', domains: ['equipment'] } },
    ['설비 정보 설정을 읽을 수 없습니다', '다시 시도', '설비 정보만 기본값으로 열기', '!카드 크기']],
];

const baseState = JSON.parse(JSON.stringify(app.state));
let fail = 0;

/* 정적 검사 — 속성명 빠진 태그(<th "style값">)는 renderToString은 통과하나 브라우저에선 InvalidCharacterError
   · 렌더로 못 잡아 소스를 직접 훑음 */
{
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/view.js', import.meta.url), 'utf8');
  const bad = [...src.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\s+"/g)];
  if (bad.length) {
    fail++;
    console.error('FAIL 속성명 없는 태그 ' + bad.length + '건 —', [...new Set(bad.map((m) => '<' + m[1]))].join(' '));
  } else console.log('PASS 태그 속성명 정적 검사');
  // data-tip엔 cursor:help 동반 — 커서 변화가 유일한 호버 단서
  {
    const spans = [...src.matchAll(/<span[^>]*data-tip=[^>]*>/g)].map((m) => m[0]);
    // style이 변수(${...})면 검사 제외(오탐 방지)
    const noCur = spans.filter((t) => !/cursor: help/.test(t) && !/codicon/.test(t) && !/style=\$\{/.test(t));
    if (noCur.length) console.log('NOTE data-tip에 cursor:help 없는 span ' + noCur.length + '건 (점선 밑줄만 표시됨)');
    else console.log('PASS 호버 표시 일관성');
  }
  // data-tip은 textContent라 HTML 엔티티가 그대로 보임 — 줄바꿈은 app.js helpTip의 '\n'으로
  const ent = [...src.matchAll(/data-tip="[^"]*&#\d+;/g)];
  if (ent.length) {
    fail++;
    console.error('FAIL data-tip에 HTML 엔티티 ' + ent.length + '건 — helpTip으로 옮기고 \\n을 쓸 것');
  } else console.log('PASS data-tip 엔티티 정적 검사');
}
/* import 누락 검사 — live.js 함수 import 누락은 실행 시 ReferenceError(핸들러면 무반응)
   · renderToString은 그 경로를 안 타 소스로 대조 */
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

  /* 첫 화면 운전 상태 — _reloadLive 본문에 _refreshRunState 호출 확인
     · 없으면 첫 판정 틱까지 두절 설비가 배지 없이 정상처럼 보임 */
  {
    const rl = /_reloadLive\((quiet)?\) \{[\s\S]*?\n  \}/.exec(appSrc);
    if (!rl) { fail++; console.error('FAIL _reloadLive 본문을 찾지 못함 — 정규식 확인'); }
    else if (rl[0].indexOf('_refreshRunState') < 0) {
      fail++;
      console.error('FAIL 첫 화면 운전 상태 미계산 — _reloadLive에서 _refreshRunState를 부를 것');
    } else console.log('PASS 첫 화면 운전 상태 계산');
  }

  /* 설정 키 저장 경로 — CFG_KEYS ↔ db.js CONFIG_FILES 대조
     · CFG_KEYS에만 있으면 저장 안 됨, CONFIG_FILES에만 있으면 복원 안 됨 */
  const dbSrc = await rd(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
  const ck = /var CFG_KEYS = \[([\s\S]*?)\];/.exec(appSrc);
  const cf = /var CONFIG_FILES = \{([\s\S]*?)\};/.exec(dbSrc);
  if (!ck || !cf) { fail++; console.error('FAIL 설정 키 목록을 찾지 못함 — CFG_KEYS/CONFIG_FILES 정규식 확인'); }
  else {
    const keys = [...ck[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const filed = new Set([...cf[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const unsaved = keys.filter((k) => !filed.has(k));
    // CONFIG_FILES의 파일명(.json)은 제외하고 비교
    const unread = [...filed].filter((k) => !/\.json$/.test(k) && keys.indexOf(k) < 0);
    if (unsaved.length || unread.length) {
      fail++;
      console.error('FAIL 설정 키 불일치 — 저장 안 됨: [' + unsaved.join(', ') + '] · 복원 안 됨: [' + unread.join(', ') + ']');
    } else console.log('PASS 설정 키 저장·복원 정합성 (' + keys.length + '개)');
  }
}

for (const [label, patch, expect] of cases) {
  try {
    /* _ 접두 키는 인스턴스 필드로 주입 — 판정 루프 중간값(_runState·_flap 등)은 state 밖 */
    const inst = {}, st = {};
    for (const [k, v] of Object.entries(patch)) (k[0] === '_' ? inst : st)[k] = v;
    app._runState = null; app._flap = null; app._gradeState = null;   // 케이스 간 이월 방지
    Object.assign(app, inst);
    Object.assign(app.state, JSON.parse(JSON.stringify(baseState)), st);
    const out = renderToString(view(app.renderVals()));
    if (!out || out.length < 500) throw new Error('suspiciously short output: ' + out.length);
    // expect: 기대 문구가 실제로 렌더됐는지 확인
    // '!' 접두는 부재 검사 — 숨겨야 할 UI(계통주파수 칩 등) 노출 감지
    const miss = (expect || []).filter((s) => s[0] === '!' ? out.indexOf(s.slice(1)) >= 0 : out.indexOf(s) < 0);
    if (miss.length) throw new Error('기대 불일치: ' + miss.join(' / '));
    console.log('PASS', label, '(' + out.length + ' chars)');
  } catch (e) {
    fail++;
    console.error('FAIL', label, '—', e.message);
  }
}
process.exit(fail ? 1 : 0);
