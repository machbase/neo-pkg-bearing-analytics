// 요약 모드 렌더 검증 — 실제 라이브 데이터 + 실제 설비 설정으로 _genOne과 같은 data를 조립해 리포트를 만든다.
// 라이브 하네스: Neo(127.0.0.1:5654)가 떠 있고 BEARING 테이블에 데이터가 있어야 한다.
// data 조립은 app.js _reportMeta()/_reportBuild()가 단일 소스 — 앱에 필드를 추가하면 하네스도 자동으로 받는다.
// 사용: node tools/verify-summary.mjs [TAG]   (또는 npm run verify:live)
globalThis.window = globalThis;
const NEO = 'http://127.0.0.1:5654'; const _f = globalThis.fetch;
globalThis.fetch = (u, o) => _f(typeof u === 'string' && u.startsWith('/') ? NEO + u : u, o);

try { await _f(NEO + '/db/query?q=' + encodeURIComponent('SELECT 1 as X'), { signal: AbortSignal.timeout(3000) }); }
catch (e) { console.error('SKIP — Neo(' + NEO + ') 미기동. 서버를 띄운 뒤 다시 실행하세요.'); process.exit(2); }

const E = (await import('../../cgi-bin/chart/chart.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Report = (await import('../../cgi-bin/report/report.js')).default;
const L = await import('../src/data/live.js');
const { App } = await import('../src/app.js');
const { readFileSync } = await import('node:fs');

// ⚠설비 설정(베어링 품번·Class·RPM·단위)을 반드시 물린다 — 빈 cfg면 전부 폴백이라 실제와 다른 것을 검증하게 된다
const CFG = (() => {
  try { return JSON.parse(readFileSync(new URL('../../cgi-bin/config/equipment.json', import.meta.url), 'utf8')); }
  catch (e) { console.warn('[harness] equipment.json 로드 실패 — 폴백으로 진행:', e.message); return {}; }
})();

const data0 = await L.buildLiveData(Object.assign({}, E), [process.argv[2] || 'BEARING'], CFG);
const app = new App({}); app.E = Object.assign({}, E); app.live = true; app.data = data0;
const eq = data0.equipment[0]; app.state.selTag = eq.id;
const anchor = app._detailAnchorMs(eq), vu = app.state.viewUnit || null;
const det = await L.liveDetail(app.E, eq, anchor, vu);
app._detailCache[eq.id] = { state: 'ready', det, anchor, viewUnit: vu, eqSnap: Object.assign({}, eq), snapNow: Date.now() };
// det를 넘겨야 앵커 재계산으로 캐시가 버려지지 않는다 — 안 넘기면 emptyDet으로 떨어져 결론이 서로 어긋난다
const dx = app._dx(eq, det), _ev = app._evidence(eq, det), _rptSat = app._kurtSat(eq);

// 차트 계열에 쓰는 값만 남긴다 — 요약이 쓰던 파생값(cP95·cExp·nTot·wAvg 등)은 _reportMeta 안으로 갔다
const roll = eq.rollup || [];
const rms = roll.map(r => r.rms), crestA = roll.map(r => r.crest), p2pV = roll.map(r => r.p2p);
const pct = (a, q) => { const x = a.slice().sort((m, n) => m - n); return x.length ? x[Math.min(x.length - 1, Math.floor(q * (x.length - 1)))] : 0; };
const gate = !!(det.quality && det.quality.gate); // 아래 검사 목록의 조건 분기용

// ⚠data 조립은 app.js _reportMeta()가 단일 소스 — 하네스가 손으로 베끼지 않는다.
//   여기서 만드는 건 차트 계열(롤업 의존)뿐이고, 요약·ISO·재현성 바는 앱과 같은 코드가 만든다.
const meta = app._reportMeta(eq, det, _ev, _rptSat);
const data = Object.assign({
  refs: eq.zones.map((z, i) => ({ val: z, color: ['#3aa76d', '#d99a2b', '#e07b39'][i], label: ['A/B ', 'B/C ', 'C/D '][i] + E.fmt(z) })),
  xL: roll.map(r => E.fmtMD(r.ms)), xT: roll.map(r => E.fmtDT(r.ms)), kxl: roll.map(r => E.fmtMD(r.ms)),
  rms: rms.length ? rms : null, p2p: rms.length ? p2pV : null, crest: rms.length ? crestA : null, kurt: null, bands: null,
}, meta);

const build = app._reportBuild(eq, det, 'VBR-HARNESS', '');

const html = Report.buildReportHTML({
  docNo: 'VBR-HARNESS', alias: eq.alias || eq.name, tagName: eq.table + ' · ' + eq.name, generatedText: E.fmtDT(Date.now()),
  specs: [], sevMachine: eq.name + ' · Class ' + eq.cls + ' · ' + eq.rpm + ' RPM',
  gradeKo: dx.gradeKo, gradeColor: dx.color,
  zones: eq.zones.map(z => E.fmt(z)), zonesUnit: eq.unit, gradeIdx: eq.grade,
  verdict: dx.verdict, verdictSub: dx.sub, sevCards: [], stats: [{ k: '중앙값 RMS', v: E.fmt(pct(rms, 0.5)) }],
  indics: det.indics, opinion: null, actions: dx.actions,
  data, chartLibSrc: '/* chart engine omitted in harness */', build,
  fftHint: det.fft.freqs.length ? '해상도 ' + det.fft.res.toFixed(2) + ' Hz' : '',
  waveDesc: '', envDesc: det.envelope.hint, cepDesc: det.cepstrum.note,
});

// 리팩터링 전후 리포트를 바이트 비교할 때 쓴다 — VERIFY_DUMP=before.html node tools/verify-summary.mjs
// (동작을 바꾸지 않는 정리 작업이 정말 안 바꿨는지 확인하는 가장 확실한 방법)
if (process.env.VERIFY_DUMP) {
  (await import('node:fs')).writeFileSync(process.env.VERIFY_DUMP, html);
  console.log('dumped:', process.env.VERIFY_DUMP, html.length, 'bytes');
}
const txt = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

console.log('\n=== 요약 모드 검사 (' + eq.name + ' · 베어링 ' + ((eq.bearing && eq.bearing.model) || '미지정') + ' · gate=' + gate + ' · verdict="' + dx.verdict + '") ===');
// ⚠리포트 문구를 바꾸면 이 목록도 같이 고칠 것 — 검사기가 옛 문구를 보면 실제와 다른 것을 통과시킨다
const checks = [
  ['[1] 헤드라인(판정 or 보류)', /계측 검증 필요 — 결함 진단 보류|이상 진동|주의 관찰|정상 범위/],
  ['[1] 조치 카드 1장', /계측 검증 후 재측정 — 기계 상태 미판정|계속 운전|다음 정기 점검 시 확인|계획 정지 시 점검|긴급 점검/],
  ['[1] 조치 근거는 값·대역(등급 순환 금지)', /근거 · .*(Crest P95|10–1000 Hz)/],
  ['[2] 판정 기준값 못박기', /판정에 쓰는 값은 ISO 대역제한 속도 RMS/],
  ['[2] 감시는 참고로 격하', /알람 기준|감시 참고|규격 판정 아님/],
  ['[3] 지금 할 일', /지금 할 일/],
  ['[4] 잠정 후보', /잠정 후보/],
  ['[5] 이 측정으론 볼 수 없음', /이 측정으론 볼 수 없음/],
  ['[6] 확인했으나 미검출', /확인했으나 미검출/],
  ['[7] 아직 설명 못 한 성분', /아직 설명 못 한 성분/],
  ['[8] 상세로 가는 바로가기', /자세히|상세 분석|전체 보기/],
  ['메타 · Analysis Engine', /Analysis Engine/],
  ['메타 · Ruleset/Fingerprint', /Ruleset .+Fingerprint/],
  ['메타 · Acquisition', /Acquisition/],
];
if (gate) {
  checks.push(['게이트 · 전역 상한 40 표기', /전역 상한 40|상한 40/]);
  checks.push(['게이트 · ISO 판정 보류 표기', /판정 보류/]);
  checks.push(['게이트 · 편향 방향(상한/하한)', /이 값은 상한|이 값은 하한/]);
}
let bad = 0;
checks.forEach(([n, re]) => { const ok = re.test(txt); if (!ok) bad++; console.log(' ', ok ? '✓' : '✗', n); });

console.log('\n=== 구조 ===');
console.log('  전체보기 접기(details) 제거:', /class="adv"/.test(html) ? '✗ 남음' : '✓');
console.log('  인쇄 시 요약+상세 동시:', /beforeprint/.test(html) ? '✓' : '✗');
console.log('  통합 경고 박스:', (html.match(/class="sum-alert/g) || []).length + '개' + (gate ? ' (게이트 시 1)' : ''));
console.log('  HTML 크기:', (html.length / 1024).toFixed(0), 'KB');
let unbal = 0;
['div', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'span', 'ol', 'ul', 'li', 'details'].forEach(t => {
  const o = (html.match(new RegExp('<' + t + '(?=[ >])', 'g')) || []).length;
  const c = (html.match(new RegExp('</' + t + '>', 'g')) || []).length;
  if (o !== c) { unbal++; console.log('  ✗ 태그 불균형', t, '열림' + o, '닫힘' + c); }
});
console.log('  태그 균형:', unbal ? '✗ ' + unbal + '종' : '✓');

const ORDER = ['판정에 쓰는 값은', '지금 할 일', '잠정 후보', '이 측정으론 볼 수 없음', '확인했으나 미검출', '아직 설명 못 한 성분'];
const pos = ORDER.map(k => txt.indexOf(k));
const ord = pos.map((v, i) => (v < 0 ? ORDER[i] + '(없음)' : (i && v < pos[i - 1] ? ORDER[i] + '(순서역전)' : null))).filter(Boolean);
console.log('\n요약 블록 순서:', ord.length ? '✗ ' + ord.join(', ') : '✓ 사양 순서대로');
console.log('\n=== 결과: ' + (checks.length - bad) + '/' + checks.length + ' 통과 ===');
if (bad || unbal || ord.length) process.exitCode = 1;
