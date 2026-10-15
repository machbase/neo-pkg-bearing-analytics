/* 라이브 경로 스모크 — 라이브(Neo 필요) · npm run smoke:live 포함
   · 실제 Neo에 붙여 buildLiveData/liveDetail/렌더/저장소 왕복 검증
   · 로그인: NEO_USER·NEO_PASSWORD 환경변수(_liveauth.mjs), 없으면 건너뜀
   · 계정마다 테이블 구성이 다름 — 기준 데이터 BEARING(C1)은 필수(없으면 건너뜀), VIBE_DATA는 있으면 함께 조립
   · 저장소 왕복은 그 계정에 시험 행·파일을 쓰고 지움 — 설정은 끝나면(실패해도) 원래 값으로 복구 */
import renderToString from 'preact-render-to-string';

const { DB: AuthDB } = await import('./_liveauth.mjs');

const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default; // 테스트 전용 목 생성기
const { App } = await import('../src/app.js');
const L = await import('../src/data/live.js');
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const E = Object.assign({}, CH, Mock); // 차트·목 유틸을 한 엔진 객체로 병합
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('PASS', label, extra || '');
  else { fail++; console.error('FAIL', label, extra || ''); }
};

// 1. 테이블 목록 — 검사 대상 = BEARING + (있으면) VIBE_DATA
const tables = await L.listTagTables();
if (!tables.includes('BEARING')) { console.log('건너뜀 — 이 계정에 기준 테이블 BEARING 없음 (' + tables.join(',') + ')'); process.exit(0); }
const SRC = ['BEARING'].concat(tables.includes('VIBE_DATA') ? ['VIBE_DATA'] : []);
ok(tables.length > 0, '테이블 목록', tables.join(',') + ' → 검사 대상 ' + SRC.join(','));

// 2. 데이터 조립 (검사 대상 테이블)
const data = await L.buildLiveData(E, SRC, {});
/* 설비 = 데이터가 있는 태그 — 메타에 이름만 남은(데이터 삭제된) 태그는 제외(DB 상태에 따라 수가 바뀌므로 통계로 기대값 산정) */
{
  const withData = [], nameOnly = [];
  for (const t of SRC) {
    const st = await L.tagStats(t).catch(() => ({}));
    const names = await L.listTags(t, 1000).catch(() => []);
    names.forEach((n) => (st[n] && st[n].count > 0 ? withData : nameOnly).push(t + ':' + n));
  }
  const got = data.equipment.map((e) => e.id).sort().join(',');
  ok(withData.length > 0 && got === withData.sort().join(','), '설비 = 데이터가 있는 태그만', got + (nameOnly.length ? ' · 이름만 남은 태그 제외: ' + nameOnly.join(',') : ''));
}
const c1 = data.equipment.find(e => e.id === 'BEARING:C1');
ok(c1 && c1.rollup.length > 100, 'C1 롤업 버킷', c1 && c1.rollup.length + '개 · step ' + c1.rollupStepSec + 's');
ok(c1 && c1.rms > 0 && c1.sparkVals.length > 10, 'C1 RMS/스파크', c1 && 'rms=' + c1.rms.toFixed(2) + ' spark=' + c1.sparkVals.length);
ok(c1 && c1.fs > 20000, 'C1 샘플레이트 추정(~25.6kHz)', c1 && c1.fs + ' Hz');
ok(data.now === Math.max(...data.equipment.map(e => e.lastSeen)), 'data.now = 최신 시각');

// 2a. rollup 미지원 테이블(VIBE_TEST — 사용자 시뮬레이터) DATE_TRUNC 폴백
if (tables.includes('VIBE_TEST')) {
  const dvt = await L.buildLiveData(E, ['VIBE_TEST'], {});
  const okEqs = dvt.equipment.filter(e => e.rollup.length > 0 && e.rms > 0);
  ok(dvt.equipment.length >= 1 && okEqs.length === dvt.equipment.length,
    'rollup 폴백(VIBE_TEST 실시간 시뮬)',
    dvt.equipment.map(e => e.name + ':' + e.rollup.length + 'b/rms' + e.rms.toFixed(2)).join(' · '));
}

// 2b. 설정(별칭/Class/RPM) 조립 반영 확인
const dataCfg = await L.buildLiveData(E, ['BEARING'], { aliases: { 'BEARING:C1': '1호 베어링' }, equipCls: { 'BEARING:C1': 'IV' }, equipRpm: { 'BEARING:C1': 3600 } });
const c1cfg = dataCfg.equipment.find(e => e.id === 'BEARING:C1');
ok(c1cfg && c1cfg.alias === '1호 베어링' && c1cfg.cls === 'IV' && c1cfg.rpm === 3600, '설정 반영(별칭·Class·RPM)', c1cfg && (c1cfg.alias + '/' + c1cfg.cls + '/' + c1cfg.rpm));

// 3. 상세 데이터 (파형 + FFT + 지표 + 복원 그래프)
const det = await L.liveDetail(E, c1);
ok(det.raw.values.length > 1000, 'C1 원시 파형', det.raw.values.length + ' pts');
ok(det.fft.freqs.length > 100, 'C1 FFT 스펙트럼', det.fft.freqs.length + ' bins · res ' + det.fft.res.toFixed(3) + 'Hz');
ok(det.indics.length === 4, '시간영역 지표 4종', det.indics.map(i => i.k + '=' + i.v).join(' · '));
/* 차수 마커(1×/2×/3×)는 rpm/60 기반 — 회전수 설정 시에만 표시, 미설정이면 미표시(회전수 추측 안 함) */
ok(det.fft.markers.length === 0, '회전수 미설정이면 차수 마커를 그리지 않는다 — 추측한 격자를 그리느니 비운다',
  det.fft.markers.map(m => m.label).join(',') || '(없음)');
const detCfg = await L.liveDetail(E, c1cfg);
ok(detCfg.fft.markers.length >= 3, 'FFT 마커(1×/2×/3×+베어링)', detCfg.fft.markers.map(m => m.label).join(','));
ok(det.envelope.freqs.length > 50, '포락선 스펙트럼(복원)', det.envelope.freqs.length + ' bins · ' + det.envelope.hint.slice(0, 40));
ok(det.cepstrum.freqs.length > 30, '켑스트럼(복원)', det.cepstrum.freqs.length + ' bins');
ok(det.spectro.rows === 22 && det.spectro.cols === 52, '스펙트로그램(복원)', det.spectro.rows + 'x' + det.spectro.cols + ' · fmax ' + det.spectro.fmax);

// 3b. 첨도·대역 에너지 추이 (청크 샘플링)
const tr = await L.loadTrendChunks(E, c1, c1.rollup);
ok(tr.kurt.length >= 10, '첨도 추이 청크', tr.kurt.length + '점 · kurt[0]=' + (tr.kurt[0] || 0).toFixed(1));
// 대역 개수는 VC.BAND_FREQ 기준(하드코딩 금지)
ok(tr.bands.length === VC.BAND_FREQ.length && tr.bands[1].vals.length === tr.kurt.length,
  '대역 에너지 ' + VC.BAND_FREQ.length + '계열(차수 상대 + 절대 kHz)', tr.bands.map(b => b.label).join('/'));

// 4. 라이브 상태로 전 탭 렌더
const app = new App({ defaultTab: 'monitor', defaultTheme: 'dark', seed: 42, equipmentCount: 20 });
app.setState = function (s) { Object.assign(this.state, s); };
app._scheduleDraw = function () {};
app.E = E; app.live = true; app.liveTables = tables; app.data = data;
app._detailCache['BEARING:C1'] = { state: 'ready', det };
const sorted = data.equipment.slice().sort((a, b) => b.grade - a.grade);
sorted.forEach((e, i) => { e.order = i; });
Object.assign(app.state, {
  ready: true, srcSel: SRC, selTag: 'BEARING:C1', diagTag: sorted[0].id,
  events: [], reports: [], genTags: sorted.slice(0, 3).map(e => e.id),
  from: E.fmtDT(data.now - 7 * 86400000).slice(0, 10), to: E.fmtDT(data.now).slice(0, 10),
});
for (const tab of ['monitor', 'detail', 'report']) {
  app.state.tab = tab;
  try {
    const out = renderToString(view(app.renderVals()));
    ok(out.length > 3000, '라이브 렌더 ' + tab, out.length + ' chars');
    if (tab === 'detail') ok(out.includes('vc-env') && out.includes('vc-cep') && out.includes('vc-spec'), '라이브에서 전체 그래프 카드 복원');
  } catch (e) { fail++; console.error('FAIL 라이브 렌더 ' + tab, e.message); }
}
app.state.tab = 'settings'; app.state.setSection = 'source';
const so = renderToString(view(app.renderVals()));
ok(SRC.every((t) => so.includes(t)), '설정탭 실제 테이블 목록', SRC.join(','));

// 4b. 리포트: HTML 조립(XSS 이스케이프) + 저장/목록/읽기/삭제 왕복
{
  const Report = (await import('../../cgi-bin/report/report.js')).default;
  const DB = (await import('../../cgi-bin/db/db.js')).default;
  const html = Report.buildReportHTML({
    docNo: 'VBR-TEST', alias: '<script>x</script>', tagName: 'BEARING · C1', generatedText: 'g', logoDataURL: null,
    specs: [{ k: '데이터 건수', v: '1', unit: '건' }], sevMachine: 'C1 · Class II · 1800 RPM',
    gradeKo: '위험', gradeColor: '#e07b39', zones: ['1.12', '2.80', '7.10'], zonesUnit: 'mm/s', gradeIdx: 2,
    verdict: '테스트', verdictSub: 'sub',
    sevCards: [{ label: '평균 RMS', badgeKo: '주의', value: '1.5', unit: 'mm/s', thr: '기준 < 2.8', over: false, arrow: '▼', delta: '1.3' }],
    stats: [{ k: '평균', v: '1.5' }], indics: [{ k: 'RMS', v: '1.5', hint: '', desc: 'd' }],
    opinion: null, actions: [{ txt: 'a' }],
    data: { rms: [1, 2], xL: ['a', 'b'], xT: ['a', 'b'], refs: [], unit: 'mm/s', kxl: [] },
    chartLibSrc: '/*chartlib*/', fftHint: '', waveDesc: '', envDesc: '', cepDesc: '',
  });
  ok(!html.includes('<script>x') && html.includes('&lt;script&gt;'), '리포트 XSS 이스케이프');
  ok(html.includes('Content-Security-Policy') && html.includes('진동 심각도 평가') && html.includes('theme-btn'), '리포트 양식(프로토타입 고정판)+CSP');
  ok(html.includes('window.RPT') && html.includes('id="cRms"') && html.includes('/*chartlib*/'), '리포트 캔버스 렌더(엔진+데이터 내장)');
  // 계정 폴더(앱과 같은 경로) — 시험 파일은 끝나면(실패해도) 지움
  const fn = 'RPT_SMOKETEST_20260101-20260102_20260101_000000.html', dir = L.reportDir();
  try {
    await DB.ensureDir(dir);
    await DB.saveFile(dir + '/' + fn, html, 'text/html');
    const ls = await DB.listDir(dir);
    ok(ls.some(f => f.name === fn), '리포트 저장→목록 확인', dir);
    const blob = await DB.readFileBlob(dir + '/' + fn);
    ok(blob && blob.size > 500, '리포트 읽기(미리보기 경로)', blob.size + ' bytes');
  } finally {
    await DB.deleteFile(dir + '/' + fn).catch(() => {});
  }
  const ls2 = await DB.listDir(dir);
  ok(!ls2.some(f => f.name === fn), '리포트 삭제 확인');
}

// 5. 설정 저장/복원 왕복(계정 CONFIG 표) — 끝나면(실패해도) 원래 설정으로
const prev = await L.loadConfig();
if (!prev) console.log('건너뜀 설정 왕복 — 기존 설정을 읽지 못함(원상 복구 불가)');
else {
  try {
    const cfgIn = { srcSel: ['BEARING'], machineClass: 'III', equipRpm: { 'BEARING:C1': 3600 }, memo: '스모크' };
    await L.saveConfig(cfgIn);
    const cfgOut = await L.loadConfig();
    ok(cfgOut && cfgOut.machineClass === 'III' && cfgOut.equipRpm['BEARING:C1'] === 3600, '설정 저장→복원 왕복(CONFIG)');
  } finally {
    await L.saveConfig(prev);
  }
}

// 6. 상시감시 저장소 왕복 — 베이스라인·이벤트·판정상태
{
  const DB = (await import('../../cgi-bin/db/db.js')).default;
  await L.ensureMonTables();
  // 베이스라인 upsert→조회→갱신→삭제
  await L.saveBaseline('ZZ:SMOKE', { mu: 1.5, sigma: 0.2, k: 3, n: 60, at: 1 });
  let bls = await L.loadBaselines();
  ok(bls['ZZ:SMOKE'] && bls['ZZ:SMOKE'].mu === 1.5, '베이스라인 저장→조회');
  await L.saveBaseline('ZZ:SMOKE', { mu: 2.5, sigma: 0.3, k: 2, n: 60, at: 2 }); // 갱신(UPDATE 경로)
  bls = await L.loadBaselines();
  ok(bls['ZZ:SMOKE'] && bls['ZZ:SMOKE'].mu === 2.5 && bls['ZZ:SMOKE'].k === 2, '베이스라인 갱신(upsert UPDATE)');
  await L.deleteBaseline('ZZ:SMOKE');
  bls = await L.loadBaselines();
  ok(!bls['ZZ:SMOKE'], '베이스라인 삭제');
  // 이벤트 조회 — GRADE는 단어, 실 테이블 오염 방지로 읽기만
  const evs = await L.loadEvents(500);
  ok(Array.isArray(evs) && (evs.length === 0 || typeof evs[0].grade === 'string'), '이벤트 로드(GRADE 단어)');
  /* 기간 지정 조회(CSV/JSON 내보내기용) 범위 필터
     · 하한은 ms=0 아닌 하루 뒤 — 로컬 시각 문자열이 UTC로 읽혀 1970 이전이 되면 DB가 거부(시간대 ±14h 여유) */
  const PAST = 86400000;                                       // 1970-01-02 — 실 이벤트보다 한참 이전
  const rangeNone = await L.loadEventsRange(PAST, PAST + 1);   // 이 구간엔 이벤트 없음
  const rangeAll = await L.loadEventsRange(PAST, Date.now());  // 전체 범위
  ok(rangeNone.length === 0 && Array.isArray(rangeAll) && rangeAll.length >= evs.length, '이벤트 기간 조회(범위 필터)');
  // 판정상태(MONSTATE, LOOKUP) upsert→조회
  try {
    await L.saveMonState('ZZ:SMOKE', { g: 2, b: true, rms: 3.14, ms: 1 });
    const ms = await L.loadMonState();
    ok(ms['ZZ:SMOKE'] && ms['ZZ:SMOKE'].g === 2 && ms['ZZ:SMOKE'].b === true, '판정상태 저장→조회');
  } finally {
    await DB.deleteMonState('ZZ:SMOKE');   // 계정 접두 키로 삭제(공용 표)
  }
  const ms2 = await L.loadMonState();
  ok(!ms2['ZZ:SMOKE'], '판정상태 시험 행 삭제');
}

process.exit(fail ? 1 : 0);
