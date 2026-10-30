// 화면 다국어 — 사전 정합성 · 영·일 렌더에 한국어 잔존 없음 · 진단 엔진 문구는 화면 언어와 무관하게 한국어 · 리포트는 생성 언어로 번역
// 오프라인(Neo 불필요) · npm run smoke 포함
import renderToString from 'preact-render-to-string';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;

const EN = (await import('../src/i18n/en.js')).default;
const JA = (await import('../src/i18n/ja.js')).default;
const I18N = await import('../src/i18n.js');
const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Report = (await import('../../cgi-bin/report/report.js')).default;
const Notify = (await import('../../cgi-bin/notify/notify.js')).default;
const Monitor = (await import('../../cgi-bin/monitor/monitor.js')).default;
const TxCore = (await import('../../cgi-bin/i18n/tx.js')).default;
const Mock = (await import('./mock.js')).default;
const { App, judgeDetail } = await import('../src/app.js');

// 오프라인 — 롤업 조회는 토큰 없이 실패(경고만, 렌더는 캐시·빈 값으로 진행)
const _warn = console.warn;
console.warn = (...a) => { if (!/rollFor failed/.test(String(a[0]))) _warn(...a); };
let fail = 0;
const chk = (ok, name, info) => { if (ok) console.log('PASS', name); else { fail++; console.error('FAIL', name, info || ''); } };
const HAN = /[가-힣]/;

// ── 1. 코드의 T('…') 키가 en·ja 사전에 모두 있음 ──────────────────────────
const unq = (s) => s.replace(/\\(.)/g, (m, c) => ({ n: '\n', r: '\r', t: '\t' }[c] || c));
const keys = new Set();
for (const f of ['../src/app.js', '../src/view.js', '../src/daterange.js', '../../cgi-bin/report/report.js', '../../cgi-bin/notify/notify.js']) {
  const src = await readFile(new URL(f, import.meta.url), 'utf8');
  // notify.js는 알림 언어 번역기 X.T('…')
  for (const m of src.matchAll(/(?<![\w$.])(?:Tk?|X\.T)\('((?:[^'\\]|\\.)*)'/g)) keys.add(unq(m[1]));
}
const missEn = [...keys].filter((k) => !(k in EN));
const missJa = [...keys].filter((k) => !(k in JA));
chk(keys.size > 1000, 'T() 키를 소스에서 찾음', keys.size);
chk(!missEn.length, 'T() 키가 영어 사전에 모두 있음', missEn.slice(0, 5).join(' | ') + (missEn.length > 5 ? ' 외 ' + (missEn.length - 5) : ''));
chk(!missJa.length, 'T() 키가 일본어 사전에 모두 있음', missJa.slice(0, 5).join(' | ') + (missJa.length > 5 ? ' 외 ' + (missJa.length - 5) : ''));

// ── 2. 사전끼리 키 집합 같고, 자리표시 {n} 집합이 원문과 같음 ──────────────
const onlyEn = Object.keys(EN).filter((k) => !(k in JA)), onlyJa = Object.keys(JA).filter((k) => !(k in EN));
chk(!onlyEn.length && !onlyJa.length, 'en·ja 사전 키 집합 일치', onlyEn.concat(onlyJa).slice(0, 5).join(' | '));
const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join('');
const badPh = [];
for (const [name, d] of [['en', EN], ['ja', JA]]) {
  for (const k of Object.keys(d)) {
    // 빈 번역은 수량 접미사('개' 등)만 — 영어엔 붙일 말이 없음
    if (typeof d[k] !== 'string' || (!d[k] && k.replace(/\{#[^}]*\}/g, '').length > 1)) { badPh.push(name + ' 빈 값: ' + k); continue; }
    if (ph(k) !== ph(d[k])) badPh.push(name + ' 자리표시: ' + k + ' → ' + d[k]);
    if (HAN.test(d[k])) badPh.push(name + ' 번역에 한글: ' + k);
  }
}
chk(!badPh.length, '번역값 비어 있지 않음·자리표시 일치·한글 없음', badPh.slice(0, 5).join(' | ') + (badPh.length > 5 ? ' 외 ' + (badPh.length - 5) : ''));

// ── 3. 언어 전환 동작 ─────────────────────────────────────────────────────
chk(I18N.getLang() === 'ko', '브라우저 밖 기본 언어는 한국어(기존 검사 호환)');
chk(I18N.T('태그 {0}개 처리 실패 — 다음 회차에 다시 시도합니다', 3) === '태그 3개 처리 실패 — 다음 회차에 다시 시도합니다', '한국어는 원문 그대로 채움');
I18N.setLang('en');
chk(!HAN.test(I18N.T('태그 {0}개 처리 실패 — 다음 회차에 다시 시도합니다', 3)) && /3/.test(I18N.T('태그 {0}개 처리 실패 — 다음 회차에 다시 시도합니다', 3)), '영어 번역 + 인자 채움');
chk(I18N.withLang('ko', () => I18N.T('없음')) === '없음' && I18N.getLang() === 'en', 'withLang은 구간만 한국어, 끝나면 복원');
chk(I18N.tx('3분 전') === I18N.T('{0}분 전', '3'), 'tx — 숫자 자리표시 역매칭');
chk(I18N.tx('ISO 위험 구간 · 결함 패턴 외륜(BPFO)').indexOf('BPFO') >= 0 && !HAN.test(I18N.tx('ISO 위험 구간 · 결함 패턴 외륜(BPFO)')), 'tx — 저장된 이벤트 사유(조각·템플릿) 번역');
chk(I18N.tx('MOTOR_A') === 'MOTOR_A' && I18N.tx('1호 압축기') === '1호 압축기', 'tx — 사전에 없는 값(태그·별칭)은 그대로');
// 상태 저장 문구 — 영어일 때 만들어도 한국어로 저장돼 나중에 일본어로 바꾸면 일본어로 표시
const stored = I18N.Tk('Neo 콘솔에 로그인되어 있지 않습니다');
I18N.setLang('ja');
chk(stored === 'Neo 콘솔에 로그인되어 있지 않습니다' && I18N.tx(stored) === JA['Neo 콘솔에 로그인되어 있지 않습니다'], 'Tk — 저장은 한국어, 표시는 그때의 언어');
I18N.setLang('ko');

// ── 4. 영·일 렌더 — 목 데이터(설비 이름)·LLM 소견 외 한국어 없음 ─────────────
const app = new App({ defaultTab: 'monitor', defaultTheme: 'dark', seed: 42, equipmentCount: 20 });
app.setState = function (s) { Object.assign(this.state, s); };
app._scheduleDraw = function () {};
app.E = CH; app.live = true;
const d = Mock.generateData(42, 20);
d.equipment.forEach((e) => { e.fs = 25600; });
app.data = d;
app.liveTables = ['VIBRATION_RAW', 'SENSOR_DATA', 'MOTOR_CURRENT', 'GEARBOX_VIB', 'BEARING_TEMP'];
const sorted = d.equipment.slice().sort((a, b) => b.grade - a.grade);
sorted.forEach((e, i) => { e.order = i; });
const eq0 = sorted[0];
app._detailCache[eq0.id] = { state: 'ready', det: Mock.buildDetail(eq0) };
Object.assign(app.state, {
  ready: true, user: 'TESTER', srcSel: app.liveTables.slice(), selTag: eq0.id, diagTag: eq0.id,
  events: d.events.slice(), reports: d.reports.slice(), genTags: sorted.slice(0, 3).map((e) => e.id), genPeriod: 'all',
});
const base = JSON.parse(JSON.stringify(app.state));
// 목 데이터 문자열 — 사용자 데이터라 번역 대상 아님
const dataStr = new Set();
d.equipment.forEach((e) => { [e.name, e.alias].forEach((s) => s && dataStr.add(s)); });
(d.reports || []).forEach((r) => { (r.tags || []).forEach((s) => dataStr.add(s)); if (r.period) dataStr.add(r.period); });
(d.events || []).forEach((e) => { [e.tagAlias, e.tagName].forEach((s) => s && dataStr.add(s)); });
const dataList = [...dataStr].filter((s) => HAN.test(s)).sort((a, b) => b.length - a.length);
const cases = [
  ['모니터링', { tab: 'monitor' }],
  ['상세분석', { tab: 'detail', dxOpen: true }],
  ['리포트', { tab: 'report' }],
  ['설정 데이터 소스', { tab: 'settings', setSection: 'source' }],
  ['설정 설비 정보', { tab: 'settings', setSection: 'equip' }],
  ['설정 판정 기준', { tab: 'settings', setSection: 'criteria' }],
  ['설정 알람', { tab: 'settings', setSection: 'monitor' }],
  ['설정 LLM', { tab: 'settings', setSection: 'llm' }],
  ['토큰 입력', { ready: true, user: '', needsToken: true, authMsg: '' }],
  ['언어 메뉴 열림', { tab: 'monitor', langOpen: true }],
];
for (const lang of ['en', 'ja']) {
  I18N.setLang(lang);
  const left = new Map();
  for (const [label, patch] of cases) {
    Object.assign(app.state, JSON.parse(JSON.stringify(base)), patch, { lang });
    let out = renderToString(view(app.renderVals()));
    out = out.replace(/<style[\s\S]*?<\/style>/g, '').replace(/(title|data-tip|placeholder|aria-label)="([^"]*)"/g, ' $2 ').replace(/<[^>]+>/g, '  ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    for (const s of dataList) out = out.split(s).join(' ');
    out = out.replace(/한국어/g, ' ');   // 언어 메뉴의 자기 이름 표기
    for (const m of out.matchAll(/[^\s]*[가-힣][^\n]*?(?=\s{2,}|$)/g)) if (!left.has(m[0].trim())) left.set(m[0].trim(), label);
  }
  const rows = [...left.entries()];
  chk(!rows.length, lang + ' 렌더에 한국어 잔존 없음', rows.slice(0, 8).map(([k, l]) => '[' + l + '] ' + k.slice(0, 70)).join(' | ') + (rows.length > 8 ? ' 외 ' + (rows.length - 8) : ''));
}

// 대역 추세 범례 — 계열 라벨은 한국어(숨김 키), 표시만 번역
I18N.setLang('en');
Object.assign(app.state, JSON.parse(JSON.stringify(base)), { tab: 'detail', lang: 'en' });
app._lastBandSeries = [{ key: 'sub', label: '서브동기', color: '#abc' }, { key: 'envBPFO', label: 'BPFO(외륜)', color: '#abd', dash: [4, 3] }];
app.state.bandHide = { '서브동기': 1 };
const lg = app.renderVals().bandLegend;
chk(lg[0].label === EN['서브동기'] && lg[1].label === EN['BPFO(외륜)'] && lg[0].on === false && lg[1].on === true, '대역 범례 — 표시는 번역, 숨김 키는 원문', JSON.stringify(lg.map((l) => [l.label, l.on])));
app._lastBandSeries = null;
I18N.setLang('ko');

// ── 5. 진단 엔진 문구는 화면 언어와 무관하게 한국어 ──────────────────────────
// 원인·결함명 문구를 정규식으로 다시 검사하므로 번역되면 세부 조치가 빠짐
I18N.setLang('ko');
Object.assign(app.state, JSON.parse(JSON.stringify(base)));
const det = app._detailCache[eq0.id].det;
const dxKo = app._dx(eq0, det);
I18N.setLang('en');
const dxEn = app._dx(eq0, det);
chk(HAN.test(dxEn.verdict) && dxEn.verdict === dxKo.verdict, '영어 화면에서도 엔진 판정문은 한국어 원문', dxEn.verdict);
chk(JSON.stringify(dxEn.actions) === JSON.stringify(dxKo.actions), '영어 화면에서도 세부 조치 목록이 한국어와 같음');
const st = { minMs: d.now - 86400000, maxMs: d.now };
chk(HAN.test(app._rollWindow(d.now, st, 'report').label), '리포트 롤업 단위 라벨은 한국어');
const promptEn = app._opinionPrompt(eq0, det, dxKo, app._kurtSat(eq0));
I18N.setLang('ko');
chk(promptEn === app._opinionPrompt(eq0, det, dxKo, app._kurtSat(eq0)), 'LLM 프롬프트는 화면 언어와 무관하게 같은 한국어');
I18N.setLang('ko');

// ── 6. 리포트 — 생성 언어로 번역(엔진은 한국어로 돌고 리포트가 표시 지점에서 번역) ───
// _genOne과 같은 조립(차트 계열만 고정값)
function rptInput(eq, dt, lang, opinion) {
  return I18N.withLang('ko', () => {
    const roll = eq.rollup || [];
    const held = VC.gateReason(dt.quality, null);
    const m = VC.sevMetrics(roll, { zones: eq.zones, fs: eq.fs, gate: !!held });
    const dx = app._dx(eq, dt, m), br = app._sevBrief(m, 60);
    const sevCards = app._sevCards(m, eq.unit, held, 60).map((c, i) => ({ label: c.label, badgeKo: c.badgeKo, note: c.note, value: c.valueText, unit: c.unit,
      thr: c.thrText, over: c.over, arrow: c.arrow, delta: c.deltaText, foot2: c.foot2, brief: ['', br.p95, br.crest, br.trend][i], noJudge: i === 2 && !m.crest.impOk }));
    const ev = app._evidence(eq, dt), rz = app._isoZones(eq);
    const data = Object.assign({
      refs: [], xL: roll.map(() => 'x'), xT: roll.map(() => 'x'), kxl: [], rms: roll.map((r) => r.rms), kurt: [3, 4],
      bands: [{ key: 'sub', label: '서브동기', color: '#abc', vals: [1, 2] }, { key: 'envBPFO', label: 'BPFO(외륜)', color: '#abd', vals: [1, 2] }],
    }, app._reportMeta(eq, dt, ev, app._kurtSat(eq), dx));
    return {
      docNo: 'VBR-X', alias: eq.alias || eq.name, tagName: eq.table + ' · ' + eq.name, generatedText: '-', logoDataURL: null,
      specs: [{ k: I18N.T('데이터 건수'), v: app._num(m.n.cnt), unit: I18N.T('건') }, { k: I18N.T('롤업 단위'), v: '분별 (1m) · 원본 집계' }],
      gradeKo: dx.gradeKo, gradeColor: dx.color, zones: rz.map((z) => CH.fmt(z)), zonesUnit: 'mm/s', gradeIdx: dx.gi, isoClass: eq.cls, verdict: dx.verdict,
      judge: Object.assign(app._sevJudge(eq, dt, dx, ev.top ? ev.top.f : ''), { score: ev.top ? ev.top.score : null, isoRms: dt.isoRms != null ? CH.fmt(dt.isoRms) : '' }),
      // 분포 줄 — 한국어로 만든 '8구간 중 이곳만 · 단발 가능성 · 정지 의심 …'을 리포트가 번역(값이 키째 구분자를 품음)
      anchorBrief: app._anchorBrief({ anchor: d.now, pick: { worst: 1, live: 8, level: 2, atLevel: 1, stopped: 2 } }, ''), sevCards, indics: dt.indics, opinion, opinionModel: opinion ? 'm' : null, actions: dx.actions,
      data: Object.assign({ tz: 'Asia/Seoul' }, data), chartLibSrc: '', build: app._reportBuild(eq, dt, 'VBR-X', opinion ? 'm' : ''),
      fftHint: dt.fft.freqs.length ? I18N.T('해상도 {0} Hz', dt.fft.res.toFixed(2)) : '', envBand: dt.envelope.band || '',
      i18n: app._i18nFor(lang),
    };
  });
}
const vis = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/(title|alt)="([^"]*)"/g, ' $2 ')
  .replace(/<[^>]+>/g, '  ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
chk(app._i18nFor('ko') === null && app._opinionLang('ko') === '', '한국어 리포트 — 번역기·LLM 언어 지시 없음');
for (const lang of ['en', 'ja']) {
  const D = lang === 'en' ? EN : JA;
  const opinion = D['핵심 요약'] + ': x · y\n## ' + D['지금 상태'] + '\n• a\n## ' + D['권장 행동'] + '\n• b';
  const left = new Map();
  let h0 = '';
  for (const eq of sorted) {
    const dt = Mock.buildDetail(eq);
    const h = Report.buildReportHTML(rptInput(eq, dt, lang, opinion));
    if (!h0) h0 = h;
    let v = vis(h);
    for (const s of dataList) v = v.split(s).join(' ');
    for (const m of v.matchAll(/[^\s]*[가-힣][^\n]*?(?=\s{2,}|$)/g)) if (!left.has(m[0].trim())) left.set(m[0].trim(), eq.id);
  }
  const rows = [...left.entries()];
  chk(!rows.length, lang + ' 리포트에 한국어 잔존 없음(설비 20종)', rows.slice(0, 6).map(([k, id]) => '[' + id + '] ' + k.slice(0, 70)).join(' | ') + (rows.length > 6 ? ' 외 ' + (rows.length - 6) : ''));
  const rpt = JSON.parse((h0.match(/window\.RPT = (.*?);<\/script>/) || [, '{}'])[1]);
  chk(h0.indexOf('<html lang="' + lang + '">') >= 0 && rpt.lbl && rpt.lbl.noData === D['데이터 없음'], lang + ' 리포트 — html lang · 빈 차트 문구');
  chk(rpt.bands && rpt.bands[0].label === D['서브동기'] && h0.indexOf('data-series="' + D['서브동기'] + '"') >= 0, lang + ' 리포트 — 대역 범례와 내장 계열 라벨이 같은 번역(숨김 키 일치)', JSON.stringify(rpt.bands && rpt.bands[0]) + ' ' + (h0.match(/data-series="[^"]*"/) || [''])[0]);
  chk(/class="llm-key"/.test(h0) && h0.indexOf('<span class="lb">' + D['지금 상태'] + '</span>') >= 0, lang + ' 리포트 — 번역된 핵심 요약 머리말 인식');
  const ol = app._opinionLang(lang);
  chk(ol.indexOf(D['지금 상태']) >= 0 && ol.indexOf(lang === 'ja' ? '일본어' : '영어') >= 0, lang + ' LLM 소견 — 출력 언어·머리말 지시');
}
I18N.setLang('ko');

// ── 7. 실시간 전용 문구 — 목 데이터가 안 지나는 경로(공유 모듈 출력·이어 붙인 문구·오류 메시지) ──
// 표시 지점과 같은 방식(tx)으로 번역되는지 — 사전에 없으면 한국어가 그대로 남음
const fsig = 1000, sine = (n, off, amp) => Array.from({ length: n }, (_, i) => off + (amp || 1) * Math.sin(2 * Math.PI * 30 * i / fsig));
const liveTxt = [];
// 신호 품질 — 데이터 부족 · 플랫라인 · 클리핑 · DC 성분 · DC 드리프트 · 단발 스파이크 · 극단 첨도
[sine(20, 0), Array(4000).fill(1), sine(4000, 0).map((v) => Math.min(v, 0.7)), sine(4000, 10),
  sine(4000, 0).map((v, i) => v + 3 * Math.sin(2 * Math.PI * 0.3 * i / fsig)), sine(4000, 0, 0.01).map((v, i) => (i === 2000 ? 5 : v))]
  .forEach((s) => (VC.signalQuality(s, fsig, 30).issues || []).forEach((x) => liveTxt.push(x.label, x.detail)));
// 롤업 게이트 — 플랫라인 · DC 드리프트
[VC.gateFromBuckets([{ ms: 0, cnt: 10, mn: 1, mx: 1, sum: 10, rms: 1 }], 0, 30),
  VC.gateFromBuckets([0, 5, -5, 3].map((m, i) => ({ ms: i * 1000, cnt: 200, mn: m - 1, mx: m + 1, sum: m * 200, rms: Math.sqrt(m * m + 0.01) })), 0.1, 30)]
  .forEach((g) => { if (g) liveTxt.push(g.label, g.detail); });
// 계측 이상 이벤트 사유 — sensorTick이 '라벨 — 사유'로 이어 붙여 저장(사유 안에도 ' — ' 있음) · 복귀
const sensDet = (bad) => VC.sensorTick(null, bad, 0, {}).events.map((e) => e.detail);
[VC.gateFromBuckets([{ ms: 0, cnt: 10, mn: 1, mx: 1, sum: 10, rms: 1 }], 0, 30)]
  .concat((VC.signalQuality(sine(4000, 0, 0.01).map((v, i) => (i === 2000 ? 5 : v)), fsig, 30).issues || []).map((x) => ({ label: x.label, detail: x.detail, gi: 2 })))
  .forEach((b) => liveTxt.push(...sensDet(b)));
liveTxt.push(...VC.sensorTick({ sf: 1 }, null, 0, {}).events.map((e) => e.detail));
// 판정 기준 분포 줄(리포트는 한국어로 만들어 번역) — 가장 나쁜 곳 · 이곳만 · N구간 동일 × 정지 의심 제외
for (const pick of [{ level: 0 }, { level: 2, atLevel: 1 }, { level: 2, atLevel: 3 }].flatMap((p) => [p, Object.assign({ stopped: 2 }, p)])) {
  liveTxt.push(I18N.withLang('ko', () => app._anchorBrief({ anchor: d.now, pick: Object.assign({ worst: 1, live: 8 }, pick) }, '').note));
}
// 첨도 포화 — 짧은 관측 창 안내 · 하락 경고
const ks = VC.kurtosisSaturation([3, 5, 9, 8, 5, 4, 3.5], [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6], 30), kl = VC.kurtosisSaturation([3, 5, 9, 8, 5, 4, 3.5], [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6], 99999);
liveTxt.push(ks.note, kl.msg);
// LLM·DB 오류(토스트·설정 화면에 그대로 나감) · 서버 감시 무수신 표기(이벤트 사유)
liveTxt.push('API 키(또는 프로바이더)가 설정되지 않았습니다', '[Claude] 본문 없이 응답이 끝났습니다 — 출력 한도(4096 토큰)를 사고 단계에서 모두 썼습니다',
  '[Claude] 본문 없이 응답이 끝났습니다 — 모델이 응답을 거절했습니다(cyber)', '[Claude] 본문 없이 응답이 끝났습니다 — stop_reason 없음',
  '[Ollama] 연결 실패 — Ollama 실행 여부와 OLLAMA_ORIGINS(CORS) 설정을 확인하세요', '[OpenAI] 브라우저에서 직접 호출이 차단되었습니다(CORS) — 백엔드 프록시가 필요합니다',
  'API 토큰이 없어 요청을 보내지 않았습니다', '조회 실패 HTTP 500: boom', '다른 계정(USER2)으로 로그인되어 요청을 보내지 않았습니다 — 새로고침하세요',
  '45초 무수신', '1시간 무수신', '2일 3시간 무수신');
// 포락선 설명 — live.js가 진단 문구 + 복조 대역을 이어 붙임(화면 envHint 경로 그대로)
const calcSrc = await readFile(new URL('../../cgi-bin/calc/calc.js', import.meta.url), 'utf8');
const hits = [...calcSrc.matchAll(/hit = '([^']+)'; cause = '([^']+)'/g)].map((m) => '포락선 지배 주파수 87.3 Hz — ' + m[1] + ' (' + m[2] + ')')
  .concat(['해석 신호(|z|) 포락선의 저주파 스펙트럼 · 충격 반복 주파수 복조']);
const bandsTxt = [' · 복조 대역 1.0kHz–5.0kHz(고정)', ' · 복조 대역 없음 — 샘플레이트 2.0kHz로는 고정 대역(1–5 kHz) 불성립 — 전대역으로 복조'];
const det0 = app._detailCache[eq0.id].det, hint0 = det0.envelope.hint;
for (const lang of ['en', 'ja']) {
  I18N.setLang(lang);
  const bad = liveTxt.filter((s) => s && HAN.test(I18N.tx(s))).map((s) => s + ' → ' + I18N.tx(s));
  Object.assign(app.state, JSON.parse(JSON.stringify(base)), { tab: 'detail', dxOpen: true, lang });
  for (const h of hits) for (const b of bandsTxt) {
    det0.envelope.hint = h + b;
    const v = app.renderVals().envHint;
    if (HAN.test(v)) bad.push(h + b + ' → ' + v);
  }
  chk(!bad.length && hits.length >= 5, lang + ' 실시간 전용 문구(신호 품질·게이트·첨도·오류·무수신·포락선 ' + (liveTxt.length + hits.length * 2) + '종) 번역', bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ' 외 ' + (bad.length - 4) : ''));
  // 상세분석 — 목 설비 20대 전부(근거·조치·품질 조합이 설비마다 다름)
  const left = new Map();
  for (const eq of sorted) {
    app._detailCache[eq.id] = app._detailCache[eq.id] || { state: 'ready', det: Mock.buildDetail(eq) };
    Object.assign(app.state, JSON.parse(JSON.stringify(base)), { tab: 'detail', dxOpen: true, selTag: eq.id, diagTag: eq.id, lang });
    let out = renderToString(view(app.renderVals()));
    out = out.replace(/<style[\s\S]*?<\/style>/g, '').replace(/(title|data-tip|placeholder|aria-label)="([^"]*)"/g, ' $2 ').replace(/<[^>]+>/g, '  ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    for (const s of dataList) out = out.split(s).join(' ');
    for (const m of out.matchAll(/[^\s]*[가-힣][^\n]*?(?=\s{2,}|$)/g)) if (!left.has(m[0].trim())) left.set(m[0].trim(), eq.id);
  }
  const rows = [...left.entries()];
  chk(!rows.length, lang + ' 상세분석 — 목 설비 20대 전부 한국어 잔존 없음', rows.slice(0, 6).map(([k, id]) => '[' + id + '] ' + k.slice(0, 70)).join(' | ') + (rows.length > 6 ? ' 외 ' + (rows.length - 6) : ''));
}
det0.envelope.hint = hint0;
I18N.setLang('ko');

// ── 8. 이벤트 내보내기(CSV/JSON) — 내려받을 때의 화면 언어, 저장값(한국어)은 그대로 ─────────
const evRows = [
  { ts: d.now, tbl: eq0.table, tag: eq0.name, etype: 'threshold', grade: '위험', val: 7.5, lim: 7.1, detail: 'ISO 위험 구간 · 결함 패턴 외륜(BPFO)' },
  { ts: d.now, tbl: eq0.table, tag: eq0.name, etype: 'signal_lost', grade: '위험', val: 0, lim: 0, detail: '1시간 30분 무수신' },
  { ts: d.now, tbl: eq0.table, tag: eq0.name, etype: 'observe', grade: '주의', val: 3.1, lim: 2.8, detail: judgeDetail({ etype: 'observe' }, { r: 3.2, key: 'BPFO' }, null) },
  { ts: d.now, tbl: eq0.table, tag: eq0.name, etype: 'band', grade: '주의', val: 1.9, lim: 1, detail: 'sub=0.050/0.025 · vh4=0.030/0.016(잠정)' },
  { ts: d.now, tbl: eq0.table, tag: eq0.name, etype: 'sensor_fault', grade: '위험', val: 0, lim: 0, detail: sensDet(VC.gateFromBuckets([{ ms: 0, cnt: 10, mn: 1, mx: 1, sum: 10, rms: 1 }], 0, 30))[0] },
];
const csvKo = app._eventsFile(evRows, 'csv').content;
chk(csvKo.split('\r\n')[0] === '﻿시각,테이블,태그,별칭,유형,등급,지표값,기준값,상세' && /위험/.test(csvKo), '내보내기 — 한국어는 이전과 같은 헤더·값');
for (const lang of ['en', 'ja']) {
  I18N.setLang(lang);
  const D = lang === 'en' ? EN : JA;
  const csv = app._eventsFile(evRows, 'csv'), js = JSON.parse(app._eventsFile(evRows, 'json').content);
  const strip = (s) => { for (const n of dataList) s = s.split(n).join(' '); return s; };
  chk(csv.ext === 'csv' && csv.content.indexOf(D['시각'] + ',') === 1 && !HAN.test(strip(csv.content)), lang + ' 내보내기 CSV — 헤더·유형·등급·상세 번역', strip(csv.content).split('\r\n').filter((l) => HAN.test(l)).slice(0, 2).join(' | '));
  chk(js[0].grade === D['위험'] && !HAN.test(strip(JSON.stringify(js))), lang + ' 내보내기 JSON — 값 번역(키는 영어 그대로)', strip(JSON.stringify(js)).slice(0, 200));
}
I18N.setLang('ko');

// ── 9. 저장 이벤트 사유 — 판정기 전 분기(목록·내보내기·알림 공통 tx) ─────────────────
// 이어 붙인 문구라 자리표시 문형이 앞뒤 조각을 삼키면 순서가 틀어짐('{0} 만에 복귀'가 사유 전체를 먹음) — ' · ' 조각 수도 같아야 함
const dets = [];
for (const et of ['observe', 'threshold', 'sustained', 'recovery', 'improve']) {
  for (const pat of [null, { r: 3.2 }, { r: 3.2, key: 'BPFO' }, { r: 1.4, key: 'BPFI' }, { key: 'BSF' }]) {
    for (const imp of [null, { crest: 5.1, kurt: 4.2 }]) {
      const dt = judgeDetail({ etype: et, epMs: et === 'recovery' ? 4800000 : 0 }, pat, imp);
      if (dt) dets.push(dt);
      // 원본 단위 설비(가속도·변위) — 'ISO <등급> 구간' 접두(서버 판정기와 같은 조립)
      for (const g of ['주의', '위험', '심각']) dets.push('ISO ' + g + ' 구간' + (dt ? ' · ' + dt : ''));
    }
  }
}
for (const lang of ['en', 'ja']) {
  I18N.setLang(lang);
  const bad = dets.filter((s) => { const o = I18N.tx(s); return HAN.test(o) || o.split(' · ').length !== s.split(' · ').length; })
    .map((s) => s + ' → ' + I18N.tx(s));
  chk(dets.length > 100 && !bad.length, lang + ' 저장 이벤트 사유 ' + dets.length + '종 — 번역·조각 순서 유지', bad.slice(0, 3).join(' | ') + (bad.length > 3 ? ' 외 ' + (bad.length - 3) : ''));
}
I18N.setLang('ko');

// ── 10. 웹훅 알림 — 설정의 알림 언어로(앱 발송·테스트 발송·서버 타이머 공통 notify 함수) ──────
// 서버는 감시 스크립트에 실린 부분 사전 + 임베드 번역기 — 전체 사전(앱 발송)과 결과가 같아야 함(빠진 키 없음)
const gate0 = VC.gateFromBuckets([{ ms: 0, cnt: 10, mn: 1, mx: 1, sum: 10, rms: 1 }], 0, 30);
const nEv = (etype, gradeKo, typeKo, detail, val, lim) => ({ alias: eq0.alias || eq0.name, tag: eq0.name, table: eq0.table, typeKo, gradeKo, etype, detail, val, lim, unit: 'mm/s', timeText: '2026-10-30 10:00:00' });
const nEvs = [
  nEv('observe', '주의', '관찰', judgeDetail({ etype: 'observe' }, { r: 3.2, key: 'BPFO' }, null), 3.1, 2.8),
  nEv('threshold', '위험', '임계 초과', judgeDetail({ etype: 'threshold' }, { r: 3.2, key: 'BPFI' }, { crest: 5.1, kurt: 4.2 }), 7.5, 7.1),
  nEv('threshold', '심각', '임계 초과', 'ISO 심각 구간 · ' + judgeDetail({ etype: 'threshold' }, { r: 4.1, key: 'BSF' }, null), 0.21, null),
  nEv('sustained', '위험', '상태 지속', judgeDetail({ etype: 'sustained' }, { r: 2.2, key: 'BPFO' }, null), 7.5, 7.1),
  nEv('recovery', '양호', '정상 복귀', judgeDetail({ etype: 'recovery', epMs: 4800000 }, { r: 0.8 }, null), 1.1, 2.8),
  nEv('improve', '주의', '상태 개선', judgeDetail({ etype: 'improve' }, { r: 1.2, key: 'BPFO' }, null), 3.0, 2.8),
  nEv('signal_lost', '위험', '신호 두절', '1시간 30분 무수신', 0, 0),
  nEv('sensor_fault', '위험', '계측 이상', sensDet(gate0)[0], 0, 0),
  nEv('sensor_ok', '양호', '계측 복귀', '계측 정상 복귀', 0, 0),
  nEv('band', '주의', '대역 이탈', 'sub=0.050/0.025 · vh4=0.030/0.016(잠정)', 1.9, 1),
  nEv('bandrec', '양호', '대역 복귀', 'sub=0.020/0.025', 0.8, 1),
];
const msgText = (m) => [m.subject, m.text, String(m.html || '').replace(/<[^>]+>/g, ' ')].join('\n');
const noData = (s) => { for (const n of dataList.concat([eq0.alias || '', eq0.name])) if (n) s = s.split(n).join(' '); return s; };
// 한국어 — 번역기 없음 = 이전과 같은 문구
chk(nEvs.every((e) => JSON.stringify(Notify.eventMessage(e)) === JSON.stringify(Notify.eventMessage(e, app._i18nFor('ko')))), '알림 한국어 — 번역기 없을 때와 같음');
// 서버 경로 — 실제 감시 스펙으로 스크립트를 만들고 거기 실린 부분 사전·번역기 소스를 격리 실행
Object.assign(app.state, JSON.parse(JSON.stringify(base)));
const spec = app._monSpec();
const tqlTxt = Monitor.buildMonitorTql(spec);
const ndict = JSON.parse((tqlTxt.match(/var NDICT=(\{.*?\}), NLC=\{\};/) || [, 'null'])[1]);
const makeTxIso = new Function('var makeTx = ' + spec.notify.i18n.src + '; return makeTx;')();
chk(Monitor.validateSpec(spec) === null && ndict && Object.keys(ndict.en).length > 50 && tqlTxt.indexOf('notifyL(L.cfg.lang)') > 0, '서버 감시 스크립트 — 번역기·부분 사전 실림(등록 전 검사 통과)',
  ndict ? Object.keys(ndict.en).length + '키' : 'NDICT 없음');
for (const lang of ['en', 'ja']) {
  const D = lang === 'en' ? EN : JA;
  const La = app._i18nFor(lang), Ls = makeTxIso(ndict[lang], lang === 'en');
  const bundle = nEvs.slice(6, 7).concat(nEvs.slice(6, 7), nEvs.slice(6, 7), nEvs.slice(6, 7), nEvs.slice(6, 7));
  const ma = nEvs.map((e) => Notify.eventMessage(e, La)).concat([Notify.bundleMessage(bundle, 't', La)]);
  const ms = nEvs.map((e) => Notify.eventMessage(e, Ls)).concat([Notify.bundleMessage(bundle, 't', Ls)]);
  const left = ma.map(msgText).map(noData).filter((s) => HAN.test(s));
  chk(!left.length, lang + ' 알림 문구 — 유형 11종·묶음 한국어 없음', left.slice(0, 2).join(' || ').replace(/\n/g, ' ⏎ ').slice(0, 300));
  const diff = ma.map((m, i) => [msgText(m), msgText(ms[i])]).filter((p) => p[0] !== p[1]);
  chk(!diff.length, lang + ' 서버 알림 = 앱 알림(부분 사전에 빠진 키 없음)', diff.slice(0, 1).map((p) => p[0].slice(0, 120) + ' ≠ ' + p[1].slice(0, 120)).join('').replace(/\n/g, ' ⏎ '));
  chk(ma[0].subject.indexOf('[' + D['주의'] + ']') === 0, lang + ' 알림 제목 — 등급어 번역', ma[0].subject);
}
// 설정 — notifLang 저장·서버 cfg 반영, 비었으면 저장 때 화면 언어로 확정
I18N.setLang('ja');
Object.assign(app.state, { notifLang: '' });
chk(app._cfgFromState().notifLang === 'ja' && Notify.notifyCfgFrom({ notifLang: 'en' }, {}).lang === 'en' && Notify.notifyCfgFrom({}, {}).lang === '', '알림 언어 설정 — 저장 때 확정 · 서버 cfg.lang');
I18N.setLang('ko');

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
