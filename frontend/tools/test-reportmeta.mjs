// _reportMeta/_reportBuild 계약(구조) — 오프라인(Neo 불필요) · npm run smoke 포함
// · 리포트 data 조립은 한 곳 — 앱·검증 하네스(verify-summary)가 같은 메서드 호출
// · 대역 범례 토글
import { readFile } from 'node:fs/promises';

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const appSrc = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const harSrc = await readFile(new URL('./verify-summary.mjs', import.meta.url), 'utf8');

// ── 1. 단일 소스: 앱·하네스 모두 같은 메서드 호출 ────────────────────
chk(/^\s{2}_reportMeta\(eq, det, ev, rptSat, dx\) \{/m.test(appSrc), '_reportMeta 메서드 존재');
chk(/^\s{2}_reportBuild\(eq, det, docNo, llmName\) \{/m.test(appSrc), '_reportBuild 메서드 존재');
chk(/self\._reportMeta\(eq, det, _ev, _rptSat, dx\)/.test(appSrc), '_genOne이 _reportMeta 사용');
chk(/self\._reportBuild\(eq, det, docNo,/.test(appSrc), '_genOne이 _reportBuild 사용');
chk(/app\._reportMeta\(eq, det, _ev, _rptSat, dx\)/.test(harSrc), '하네스가 _reportMeta 사용');
chk(/app\._reportBuild\(eq, det, /.test(harSrc), '하네스가 _reportBuild 사용');

// ── 2. 하네스 "조립부"의 요약 조립 복제 감지 ──
// 검사 목록(checks)엔 같은 문구가 정당하게 등장 → buildReportHTML 호출 전 조립 구간만 검사
const harAssembly = harSrc.slice(0, harSrc.indexOf('const html = Report.buildReportHTML('));
const ONLY_IN_APP = [
  'gateReason', 'gateCap', 'unmeasurable', 'winNote',
  '계측 검증 후 재측정', 'ISO Criterion II', '아티팩트는 에너지를 더하기만',
  'Analysis Engine', 'Ruleset ', 'Fingerprint ',
];
const leaked = ONLY_IN_APP.filter((s) => harAssembly.includes(s));
chk(leaked.length === 0, '하네스 조립부에 요약·재현성 조립이 복제되지 않음', leaked.length ? '복제 발견: ' + leaked.join(', ') : '');

// ── 3. 하네스가 만드는 건 차트 계열뿐 ──────────────────────────────────────
const harData = (harSrc.match(/const data = Object\.assign\(\{([\s\S]*?)\}, meta\);/) || [])[1] || '';
const harKeys = [...harData.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
const CHART_ONLY = ['refs', 'xL', 'xT', 'kxl', 'rms', 'p2p', 'crest', 'kurt', 'bands'];
const extra = harKeys.filter((k) => !CHART_ONLY.includes(k));
chk(extra.length === 0, '하네스 자체 조립은 차트 계열로 한정', extra.length ? '초과: ' + extra.join(',') : harKeys.join(','));

// ── 4. 요약 8블록 필드가 _reportMeta 안에 모두 존재 ────────────────────────
const metaBody = appSrc.slice(appSrc.indexOf('_reportMeta(eq, det, ev, rptSat, dx) {'), appSrc.indexOf('_reportBuild(eq, det, docNo, llmName) {'));
const NEED = ['gate:', 'gateReason:', 'gateCap:', 'cands:', 'unmeasurable:', 'rpmTxt:', 'obsTxt:', 'action:', 'bias:', 'winNote:',
  'iso:', 'levelsOk:', 'parsevalOk:', 'mon:', 'rpmMeas:', 'evidence:', 'negatives:', 'unexplained:', 'missing:', 'acq:'];
const missing = NEED.filter((k) => !metaBody.includes(k));
chk(missing.length === 0, '요약·ISO·근거 필드가 _reportMeta에 모두 존재', missing.length ? '누락: ' + missing.join(',') : NEED.length + '종');

// ── 5. _genOne에 인라인 조립 없음 ───────────────────────────
const genOne = appSrc.slice(appSrc.indexOf('_genOne'), appSrc.indexOf('_reportMeta(eq, det, ev, rptSat, dx) {'));
chk(!/summary: \(function \(\)/.test(genOne), '_genOne에 인라인 summary 조립 없음');
chk(!/_dataOld/.test(appSrc), '임시 비교용 코드(_dataOld) 제거됨');

/* 대역 범례 토글 — 큰 계열을 꺼야 작은 대역 변화가 보임, 범례는 계열 목록에서 생성(구성 변경 시 불일치 방지) */
{
  const Report = (await import('../../cgi-bin/report/report.js')).default;
  const bands = ['서브동기', '결함 대역', '2~4 kHz'].map((l, i) => ({ label: l, color: '#abc' + i, vals: [1, 2, 3] }));
  const html = Report.buildReportHTML({ alias: 'T', name: 'A', data: { bands, kxl: ['a', 'b', 'c'] } });
  const n = (html.match(/data-series=/g) || []).length;
  chk(n === bands.length, '범례가 계열 수만큼 나온다', n + '/' + bands.length);
  chk(/data-toggle="cBand"/.test(html), '대역 차트 범례에 토글이 붙는다');
  chk(/filter\(function\(sr\)\{return !hid\[sr.label\]/.test(html), '꺼진 계열은 그리지 않는다 — 축 범위도 다시 잡힌다');
  chk(/rng=\[s,e\]/.test(html), '확대해 둔 구간이 토글로 풀리지 않는다');
  // 토글 없는 차트는 범례 클릭 불가 — 눌리는 듯 보이는데 무반응이면 고장으로 읽힘
  const only = html.slice(html.indexOf('cCrest'), html.indexOf('cBand'));
  chk(!/data-series=/.test(only), '토글 안 준 차트에는 안 붙는다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
