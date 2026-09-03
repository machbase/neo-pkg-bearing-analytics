// 라이브 경로 스모크 — 실제 Neo(127.0.0.1:5654)에 붙여 buildLiveData/liveDetail/렌더를 검증한다.
// 사용: node tools/smoke-live.mjs   (Neo가 떠 있어야 함)
import renderToString from 'preact-render-to-string';

globalThis.window = globalThis;
// api.js는 브라우저 same-origin 상대경로(/db/...)를 쓰므로 node에서는 호스트를 프리픽스
const NEO = 'http://127.0.0.1:5654';
const _fetch = globalThis.fetch;
globalThis.fetch = (url, opts) => _fetch(typeof url === 'string' && url.startsWith('/') ? NEO + url : url, opts);

const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default; // 테스트 전용 목 생성기
const { App } = await import('../src/app.js');
const L = await import('../src/data/live.js');
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const E = Object.assign({}, CH, Mock); // 구 vibe-engine 병합 형태
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('PASS', label, extra || '');
  else { fail++; console.error('FAIL', label, extra || ''); }
};

// 1. 테이블 목록
const tables = await L.listTagTables();
ok(tables.includes('BEARING') && tables.includes('VIBE_DATA'), '테이블 목록', tables.join(','));

// 2. 데이터 조립 (진동 테이블 2개)
const data = await L.buildLiveData(E, ['BEARING', 'VIBE_DATA'], {});
ok(data.equipment.length === 5, '설비 5개 (C1,C2,vib-x/y/z)', 'got ' + data.equipment.length);
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

// 2b. 설정(별칭/Class/RPM)이 조립에 반영되는지
const dataCfg = await L.buildLiveData(E, ['BEARING'], { aliases: { 'BEARING:C1': '1호 베어링' }, equipCls: { 'BEARING:C1': 'IV' }, equipRpm: { 'BEARING:C1': 3600 } });
const c1cfg = dataCfg.equipment.find(e => e.id === 'BEARING:C1');
ok(c1cfg && c1cfg.alias === '1호 베어링' && c1cfg.cls === 'IV' && c1cfg.rpm === 3600, '설정 반영(별칭·Class·RPM)', c1cfg && (c1cfg.alias + '/' + c1cfg.cls + '/' + c1cfg.rpm));

// 3. 상세 데이터 (파형 + FFT + 지표 + 복원 그래프)
const det = await L.liveDetail(E, c1);
ok(det.raw.values.length > 1000, 'C1 원시 파형', det.raw.values.length + ' pts');
ok(det.fft.freqs.length > 100, 'C1 FFT 스펙트럼', det.fft.freqs.length + ' bins · res ' + det.fft.res.toFixed(3) + 'Hz');
ok(det.indics.length === 4, '시간영역 지표 4종', det.indics.map(i => i.k + '=' + i.v).join(' · '));
/* 차수 마커(1×/2×/3×)는 rpm/60에서 나오므로 회전수가 있어야 선다. c1은 설정 없이 조립한 것이라
   rpm이 0이다 — 이 패키지는 회전수를 추측하지 않는다(폴백을 넣으면 2극·6극 설비에서 격자가
   통째로 어긋나는데 화면은 평소처럼 등급을 낸다). 그래서 두 방향을 다 잠근다:
   설정이 있으면 마커가 서고, 없으면 아예 그리지 않는다. */
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
// 대역 개수는 제품 목록에서 가져온다 — 숫자를 박아 두면 대역이 늘 때 이 검사만 낡는다
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
  ready: true, srcSel: ['BEARING', 'VIBE_DATA'], selTag: 'BEARING:C1', diagTag: sorted[0].id,
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
ok(so.includes('BEARING') && so.includes('VIBE_DATA'), '설정탭 실제 테이블 목록');

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
  const fn = 'RPT_SMOKETEST_20260101-20260102_20260101_000000.html';
  await DB.ensureDir('/vibration-reports');
  await DB.saveFile('/vibration-reports/' + fn, html, 'text/html');
  const ls = await DB.listDir('/vibration-reports');
  ok(ls.some(f => f.name === fn), '리포트 저장→목록 확인');
  const blob = await DB.readFileBlob('/vibration-reports/' + fn);
  ok(blob && blob.size > 500, '리포트 읽기(미리보기 경로)', blob.size + ' bytes');
  await DB.deleteFile('/vibration-reports/' + fn);
  const ls2 = await DB.listDir('/vibration-reports');
  ok(!ls2.some(f => f.name === fn), '리포트 삭제 확인');
}

// 5. 설정 저장/복원 (cgi-bin/config/*.json 분할 파일 왕복 — Neo 인증 파일 API)
const AUTH = { user: 'SYS', password: 'MANAGER' };
const prev = await L.loadConfig(); // 기존 설정 보존
const cfgIn = { srcSel: ['BEARING'], machineClass: 'III', equipRpm: { 'BEARING:C1': 3600 }, memo: '스모크' };
await L.saveConfig(cfgIn, AUTH);
const cfgOut = await L.loadConfig();
ok(cfgOut && cfgOut.machineClass === 'III' && cfgOut.equipRpm['BEARING:C1'] === 3600, '설정 저장→복원 왕복(config.json)');
await L.saveConfig(prev || {}, AUTH); // 원상 복구

// 6. 상시감시(P6) 저장소 왕복 — LOOKUP 4종 + 이벤트/베이스라인/MONCFG
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
  // 이벤트 조회 — LOG 테이블(append 전용), GRADE는 단어. 실 테이블 오염 방지 위해 읽기만 검증
  const evs = await L.loadEvents(500);
  ok(Array.isArray(evs) && (evs.length === 0 || typeof evs[0].grade === 'string'), '이벤트 로드(GRADE 단어)');
  /* 기간 지정 조회(CSV/JSON 내보내기용) — 범위 필터 동작.
     하한을 ms=0으로 두지 않는다: 질의는 로컬 시각 문자열(to_date)로 나가는데 DB는 UTC 기준으로
     읽어 epoch 바로 아래로 떨어지고, Machbase가 1970-01-01 이전 DATETIME을 거부한다(ERR-2247).
     시간대 최대 오프셋(±14h)을 넘기려고 하루 뒤에서 잡는다 — 어느 시간대에서 돌려도 안전하다. */
  const PAST = 86400000;                                       // 1970-01-02 — 실 이벤트보다 한참 이전
  const rangeNone = await L.loadEventsRange(PAST, PAST + 1);   // 이 구간엔 이벤트 없음
  const rangeAll = await L.loadEventsRange(PAST, Date.now());  // 전체 범위
  ok(rangeNone.length === 0 && Array.isArray(rangeAll) && rangeAll.length >= evs.length, '이벤트 기간 조회(범위 필터)');
  // 판정상태(MONSTATE, LOOKUP) upsert→조회
  await L.saveMonState('ZZ:SMOKE', { g: 2, b: true, rms: 3.14, ms: 1 });
  let ms = await L.loadMonState();
  ok(ms['ZZ:SMOKE'] && ms['ZZ:SMOKE'].g === 2 && ms['ZZ:SMOKE'].b === true, '판정상태 저장→조회');
  await DB.q("DELETE FROM NEO_VIBE_MONSTATE WHERE K='ZZ:SMOKE'");
}

process.exit(fail ? 1 : 0);
