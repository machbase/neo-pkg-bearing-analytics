// _reportMeta/_reportBuild 계약 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.
// 핵심 주장: "리포트 data 조립은 한 곳에만 있다". 이 파일이 지키는 건 값의 정확성이 아니라
// 구조다 — 앱과 검증 하네스가 같은 메서드를 부르는지, 손복사가 되살아나지 않았는지.
import { readFile } from 'node:fs/promises';

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const appSrc = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const harSrc = await readFile(new URL('./verify-summary.mjs', import.meta.url), 'utf8');

// ── 1. 단일 소스: 앱과 하네스 모두 같은 메서드를 부른다 ────────────────────
chk(/^\s{2}_reportMeta\(eq, det, ev, rptSat\) \{/m.test(appSrc), '_reportMeta 메서드 존재');
chk(/^\s{2}_reportBuild\(eq, det, docNo, llmName\) \{/m.test(appSrc), '_reportBuild 메서드 존재');
chk(/self\._reportMeta\(eq, det, _ev, _rptSat\)/.test(appSrc), '_genOne이 _reportMeta 사용');
chk(/self\._reportBuild\(eq, det, docNo,/.test(appSrc), '_genOne이 _reportBuild 사용');
chk(/app\._reportMeta\(eq, det, _ev, _rptSat\)/.test(harSrc), '하네스가 _reportMeta 사용');
chk(/app\._reportBuild\(eq, det, /.test(harSrc), '하네스가 _reportBuild 사용');

// ── 2. 손복사 재발 방지: 하네스 "조립부"에 요약 조립이 다시 생기면 잡는다 ──
// 검사 목록(checks)에는 렌더 결과를 확인하는 정규식으로 같은 문구가 정당하게 등장하므로,
// buildReportHTML 호출 전까지의 조립 구간만 본다.
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

// ── 4. 요약 8블록 필드가 _reportMeta 안에 모두 있다 ────────────────────────
const metaBody = appSrc.slice(appSrc.indexOf('_reportMeta(eq, det, ev, rptSat) {'), appSrc.indexOf('_reportBuild(eq, det, docNo, llmName) {'));
const NEED = ['gate:', 'gateReason:', 'gateCap:', 'cands:', 'unmeasurable:', 'rpmTxt:', 'obsTxt:', 'action:', 'bias:', 'winNote:',
  'iso:', 'levelsOk:', 'parsevalOk:', 'mon:', 'rpmMeas:', 'evidence:', 'negatives:', 'unexplained:', 'missing:', 'acq:'];
const missing = NEED.filter((k) => !metaBody.includes(k));
chk(missing.length === 0, '요약·ISO·근거 필드가 _reportMeta에 모두 존재', missing.length ? '누락: ' + missing.join(',') : NEED.length + '종');

// ── 5. _genOne에 옛 인라인 조립이 남아 있지 않다 ───────────────────────────
const genOne = appSrc.slice(appSrc.indexOf('_genOne'), appSrc.indexOf('_reportMeta(eq, det, ev, rptSat) {'));
chk(!/summary: \(function \(\)/.test(genOne), '_genOne에 인라인 summary 조립 없음');
chk(!/_dataOld/.test(appSrc), '임시 비교용 코드(_dataOld) 제거됨');

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
