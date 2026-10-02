/* 화면 표시 — 대역 색·확대 리스너 수명·ISO 원본 단위·리포트 DC 안내
   · 대역 8칸은 서로 다른 8색, 포락선 계열은 점선(같은 차트·범례·리포트)
   · 차트 확대의 창(window) 리스너는 끄는 동안만 — 탭을 오가도 쌓이지 않음
   · 가속도·변위 설비의 ISO 판정값은 원본 단위(같은 대역 RMS)로 표시, 존 판정은 속도 환산
   · 리포트 DC 성분은 경고 상자 밖 회색 한 줄(앱과 같은 구분)
   오프라인(Neo 불필요) · npm run smoke 포함 */
import fs from 'node:fs';
globalThis.window = globalThis;
// 창 리스너 계수 — 차트 확대가 붙이는 mousemove·mouseup
const winL = { mousemove: new Set(), mouseup: new Set() };
globalThis.addEventListener = (t, f) => { if (winL[t]) winL[t].add(f); };
globalThis.removeEventListener = (t, f) => { if (winL[t]) winL[t].delete(f); };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' });

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Report = (await import('../../cgi-bin/report/report.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');
const { emptyDet } = await import('../src/data/live.js');
const { view } = await import('../src/view.js');
const renderToString = (await import('preact-render-to-string')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};

// ── 대역 색 ──────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(new URL('../src/data/live.js', import.meta.url), 'utf8');
  const cols = JSON.parse(/const BAND_COLOR = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"'));
  chk(cols.length >= VC.BAND_FREQ.length && new Set(cols.slice(0, VC.BAND_FREQ.length)).size === VC.BAND_FREQ.length,
    '주파수 대역 8칸이 모두 다른 색(예전: 5색 반복 — 세 쌍이 같은 색)', cols.length + '색');
  chk(/dash: ENV_DASH/.test(src), '포락선 계열은 점선 표시');

  // 차트가 계열별 점선을 실제로 적용
  const dashes = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'setLineDash' ? (d) => dashes.push(d.join(',')) : (k === 'measureText' ? () => ({ width: 10 }) : () => {}))), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 600, height: 220 }), style: {}, parentElement: { clientWidth: 600, getBoundingClientRect: () => ({ width: 600 }) }, width: 600, height: 220, clientWidth: 600, addEventListener() {}, removeEventListener() {} };
  CH.drawMultiLine(canvas, { series: [{ label: '1× 대역', color: '#2fb7a6', vals: [1, 2, 3] }, { label: 'BPFO(외륜)', color: '#d9534f', dash: [5, 3], vals: [1, 1, 2] }], xLabels: ['a', 'b', 'c'], height: 220 }, {});
  chk(dashes.includes('5,3') && dashes.filter((d) => d === '').length >= 2, '포락선 계열만 점선으로 그리고 다음 계열에서 실선 복귀', dashes.join(' | '));

  // 범례 — 앱 화면·리포트
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (o) { Object.assign(this.state, o); };
  app.E = Object.assign({}, CH, Mock);
  app.data = Mock.generateData(42, 3);
  Object.assign(app.state, { ready: true, tab: 'detail', srcSel: [...new Set(app.data.equipment.map((e) => e.table))] });
  app._applied = Object.assign({}, app.state);
  app._lastBandSeries = [{ key: 'one', label: '1× 대역', color: '#2fb7a6' }, { key: 'envBPFO', label: 'BPFO(외륜)', color: '#d9534f', dash: [5, 3] }];
  const lg = app.renderVals().bandLegend;
  chk(lg.length === 2 && !lg[0].dash && lg[1].dash, '범례에 점선 표시 여부');
  const rep = Report.buildReportHTML ? Report : null;
  if (rep) {
    const src2 = fs.readFileSync(new URL('../../cgi-bin/report/report.js', import.meta.url), 'utf8');
    chk(/dash:sr\.dash/.test(src2) && /border-top:2px dashed/.test(src2), '리포트 차트·범례도 점선');
  }
}

// ── 확대 리스너 수명 ─────────────────────────────────────────────────
{
  const mkCanvas = () => {
    const L = {};
    return { L, style: {}, getBoundingClientRect: () => ({ left: 0, width: 600 }), addEventListener: (t, f) => { L[t] = f; }, removeEventListener: (t) => { delete L[t]; } };
  };
  // 상세분석을 12번 오감 = 캔버스 9장씩 새로 만들어 그림
  for (let v = 0; v < 12; v++) for (let c = 0; c < 9; c++) CH.zoomDraw(mkCanvas(), 100, () => {}, 'k');
  chk(winL.mousemove.size === 0 && winL.mouseup.size === 0, '탭을 12번 오가도 창 리스너 0개(예전: 방문마다 9쌍 누적 → 108쌍)', winL.mousemove.size + '/' + winL.mouseup.size);
  // 끄는 동안만 붙었다 놓으면 떨어짐
  const cv = mkCanvas();
  let drawn = 0;
  CH.zoomDraw(cv, 100, () => { drawn++; }, 'k');
  cv.L.wheel({ preventDefault() {}, clientX: 300, deltaY: -1 });   // 확대해야 끌기 가능
  cv.L.mousedown({ clientX: 300 });
  chk(winL.mousemove.size === 1 && winL.mouseup.size === 1, '끄는 동안만 창 리스너 부착');
  [...winL.mousemove][0]({ clientX: 250 });
  [...winL.mouseup][0]();
  chk(winL.mousemove.size === 0 && winL.mouseup.size === 0 && drawn >= 3, '놓으면 떨어지고 이동은 그대로 동작', 'draws=' + drawn);
  // 같은 캔버스 다시 그리기 — 이전 핸들러 교체, 끄는 중이던 창 리스너도 정리
  cv.L.mousedown({ clientX: 300 });
  CH.zoomDraw(cv, 100, () => {}, 'k');
  chk(winL.mousemove.size === 0, '끄는 중에 다시 그려도 옛 창 리스너 정리');
}

// ── ISO 원본 단위 ────────────────────────────────────────────────────
{
  const mk = (unit, isoRms, isoRaw) => {
    const app = new App({ seed: 7, equipmentCount: 3 });
    app.setState = function (o) { Object.assign(this.state, o); };
    app._toast = () => {};
    app.E = Object.assign({}, CH, Mock);
    app.data = Mock.generateData(42, 3);
    const eq = app.data.equipment[0];
    eq.unit = unit;
    Object.assign(app.state, { ready: true, tab: 'detail', selTag: eq.id, diagTag: eq.id, srcSel: [...new Set(app.data.equipment.map((e) => e.table))] });
    app._applied = Object.assign({}, app.state);
    app.live = true;
    app._trends = () => ({ kurt: [], bands: [], xLabels: [], xTips: [], state: 'ready' });
    const det = Object.assign(emptyDet(eq), { isoRms, isoRaw, isoBlocks: 8 });
    app._detailCache[eq.id] = { state: 'ready', det, eqSnap: Object.assign({}, eq), snapNow: Date.now(), key: app._detailKey() };
    return { app, eq, det };
  };
  let { app, eq, det } = mk('g', 2.089, 0.0773);
  let row = app.renderVals().statRows[0];
  chk(/^0\.077\d? g · Class/.test(row.v) && /존 판정은 속도 환산/.test(row.t), '가속도 설비 — 상세분석 ISO 판정값을 원본 단위로(예전: 2.089 mm/s)', row.v + ' / ' + row.t);
  chk(/^2\.09 mm\/s\(속도 환산\)$/.test(app._isoDisp(eq, Object.assign({}, det, { isoRaw: null }))), '원본 값이 없으면 환산값을 속도 단위로(원본 단위를 붙이지 않음)', app._isoDisp(eq, Object.assign({}, det, { isoRaw: null })));
  ({ app, eq, det } = mk('mm/s', 2.089, 2.089));
  row = app.renderVals().statRows[0];
  chk(/^2\.09 mm\/s · Class/.test(row.v) && !/속도 환산/.test(row.t), '속도 센서는 그대로', row.v);

  // 계측 보류 조치 문구 — 속도 환산값에 원본 단위 표기 없음
  const appSrc = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(!/this\.E\.fmt\(det\.isoRms\) \+ ' ' \+ eq\.unit/.test(appSrc), '속도 환산값에 원본 단위를 붙이는 곳 없음');

  // 리포트 — ISO 값 줄
  const html = Report.buildReportHTML({
    docNo: 'VBR-TEST', alias: 'T', tagName: 'T:T', generatedText: '-', specs: [], sevMachine: 'T · Class II · 1800 RPM',
    gradeKo: '주의', gradeColor: '#d99a2b', gradeIdx: 1, zones: ['1.12', '2.80', '7.10'], zonesUnit: 'mm/s',
    judge: { patOn: true, patNa: false, isoGi: 1, isoOnly: 0, site: '베어링 외륜(BPFO)' }, verdict: '-', verdictSub: '-', sevCards: [], stats: [], indics: [],
    data: {
      iso: { rms: '2.089', disp: '0.0773 g', conv: true, gradeIdx: 1, gradeKo: '주의', color: '#d99a2b', anaSec: '8.0', blocks: 8, spread: '1.05' },
      levels: [], evidence: [], summary: { cands: [], unmeasurable: [], rpmTxt: '-', obsTxt: '-', acqTxt: '-' },
    },
  });
  const vis = html.replace(/<script[\s\S]*?<\/script>/g, '');   // 보이는 글만(원자료 JSON 제외)
  chk(/RMS 0\.0773 g/.test(vis) && /존은 속도 환산/.test(vis) && !/2\.089/.test(vis), '리포트 ISO 줄도 원본 단위(예전: 속도 RMS 2.089 mm/s)', (vis.match(/[^>]{0,40}0\.0773 g[^<]{0,30}/) || [''])[0]);
}

// ── 리포트 DC 성분 안내 — 앱과 같은 구분(경고 아닌 회색 한 줄) ────────────────
{
  const fs0 = 1000, sine = (off, clip) => Array.from({ length: 4000 }, (_, i) => { const v = off + Math.sin(2 * Math.PI * 30 * i / fs0); return clip ? Math.min(v, off + 0.7) : v; });
  const qDc = VC.signalQuality(sine(10), fs0, 30), qMix = VC.signalQuality(sine(10, true), fs0, 30);
  chk(qDc.ok && qDc.issues.length === 1 && qDc.issues[0].key === 'dcoff' && qMix.issues.some((x) => x.key === 'clip') && qMix.issues.some((x) => x.key === 'dcoff'),
    '입력 준비 — DC만 / DC+클리핑', qDc.issues.map((x) => x.key) + ' / ' + qMix.issues.map((x) => x.key));
  const rpt = (quality) => Report.buildReportHTML({
    docNo: 'VBR-TEST', alias: 'T', tagName: 'T:T', generatedText: '-', specs: [], sevMachine: '-', gradeKo: '정상', gradeColor: '#3aa76d', gradeIdx: 0,
    zones: ['1.12', '2.80', '7.10'], zonesUnit: 'mm/s', judge: { patOn: true, patNa: false, isoGi: 0, isoOnly: 0, site: '' }, verdict: '-', verdictSub: '-', sevCards: [], stats: [], indics: [],
    data: { quality, levels: [], evidence: [], summary: { cands: [], unmeasurable: [], rpmTxt: '-', obsTxt: '-', acqTxt: '-' } },
  }).replace(/<script[\s\S]*?<\/script>/g, '');
  const box = (h) => (/<div class="gate-box[\s\S]*?<div class="gb-d">/.exec(h) || [''])[0];
  const note = (h) => (/<div class="q-note">([^<]*)<\/div>/.exec(h) || ['', ''])[1];
  let h = rpt(qDc);
  chk(/DC 성분: 평균이 진동 σ의 \d+배/.test(note(h)) && /판정값은 DC를 뺀 값/.test(note(h)) && !box(h),
    'DC만 — 리포트에 회색 안내 한 줄, 경고 상자 없음(예전: 아무것도 안 나옴)', note(h).slice(0, 40));
  h = rpt(qMix);
  chk(/클리핑/.test(box(h)) && !/DC 성분/.test(box(h)) && /DC 성분/.test(note(h)),
    'DC+클리핑 — 경고 상자엔 클리핑만, DC는 상자 밖 안내(예전: DC도 경고 항목으로)');
  h = rpt(null);
  chk(!note(h) && !box(h), '신호 품질 사유 없으면 둘 다 없음');

  // 앱 → 리포트 전달 — 참고 사유만 있어도 넘김
  const app = new App({ seed: 7, equipmentCount: 2 });
  app.E = Object.assign({}, CH, Mock); app.data = Mock.generateData(42, 2);
  const eq = app.data.equipment[0];
  let meta = null, err = '';
  try { meta = app._reportMeta(eq, Object.assign(emptyDet(eq), { quality: qDc }), { conf: [], negatives: [], unexplained: [], missing: [], acq: null, bandDev: [] }, null, {}); } catch (e) { err = e.message; }
  chk(meta && meta.quality === qDc, '참고 사유만 있어도 리포트로 전달(예전: ok면 null)', err);
}

// ── 리포트 보관함 — 리포트마다 다른 이름(같은 태그 리포트도 구분) ─────────────────
{
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (o) { Object.assign(this.state, o); };
  app.E = Object.assign({}, CH, Mock);
  app.data = Mock.generateData(42, 3);
  const mk = (f, ms) => ({ id: f, fname: f, ms, tags: ['SENSOR_FREQ'], period: '2026-09-22 16:32 ~ 2026-09-22 17:32', llm: true });
  Object.assign(app.state, { ready: true, tab: 'report', srcSel: [...new Set(app.data.equipment.map((e) => e.table))], reports: [mk('SENSOR_FREQ_20261002_133412.html', 2), mk('SENSOR_FREQ_20260922_172253.html', 1)] });
  app._applied = Object.assign({}, app.state);
  const v = app.renderVals();
  chk(v.reportRows[0].nameText === 'SENSOR_FREQ_20261002_133412' && v.reportRows[1].nameText === 'SENSOR_FREQ_20260922_172253', '보관함 — 리포트명(파일 이름)으로 표시, 같은 태그끼리도 구분(예전: 둘 다 SENSOR_FREQ)', v.reportRows.map((r) => r.nameText).join(' / '));
  const htm = renderToString(view(v));
  chk(/>리포트명<\/th>/.test(htm) && !/>대상 태그<\/th>/.test(htm) && /title="SENSOR_FREQ"[^>]*>SENSOR_FREQ_20261002_133412</.test(htm), '열 이름 "리포트명", 마우스 올리면 대상 태그');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
