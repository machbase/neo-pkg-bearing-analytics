/* 결함 패턴 게이트의 감시·상세·서버 일치 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 등급을 켜는 유일한 축(ISO는 높이만) — 검출기는 targetedMatch 하나, 임계만 창 길이별 짝
     (25회전 MON_ADOPT · 100회전 TGT_ADOPT, 같은 오탐률 기준)
   · 두 창 판정 일치(값) + 세 경로 호출 형태·표본 수 식·창 상한 일치(구조) */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { readFile } = await import('node:fs/promises');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── 1. 두 창 판정 일치 ──────────────────────────────────────────────
/* 같은 신호를 감시 창(25회전)·상세 창(100회전)으로 잘라 각자 임계로 판정 — 임계 짝이 창 길이 차이를 흡수해 일치 필요
   세 부류 사용 — 한쪽으로 쏠린 신호로는 "둘 다 항상 켜짐/꺼짐"도 일치로 보임 */
const GEO = { n: 9, Bd: 12.7, Pd: 65, phi: 0 }, RPM = 1800, FS = 20000;
const fr = RPM / 60, bf = VC.bearingFreqs(RPM, GEO);

function signal(nRev, kind) {
  let seed = 999;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const n = Math.round(FS * nRev / fr), v = [];
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    let x = Math.sin(2 * Math.PI * fr * t) + 0.4 * Math.sin(2 * Math.PI * 2 * fr * t) + 0.6 * rnd();
    // 복조 대역(1–5 kHz)에 광대역 성분 추가 — 비워 두면 배경 중앙값이 바닥으로 내려가 배수가 부풂
    x += 0.5 * rnd() * Math.sin(2 * Math.PI * 2500 * t) + 0.5 * rnd() * Math.sin(2 * Math.PI * 3800 * t);
    if (kind === 'bpfo') { const p = (t * bf.BPFO) % 1; x += 2.2 * Math.exp(-p * 45) * Math.sin(2 * Math.PI * 3000 * t); }
    if (kind === 'other') { const p = (t * 77) % 1; x += 2.2 * Math.exp(-p * 45) * Math.sin(2 * Math.PI * 3000 * t); }
    v.push(x);
  }
  return v;
}
// 상세(liveDetail)·감시(monPattern)와 같은 포락선 생성 방식 — 창 길이만 다름
function gateOf(nRev, kind, thr) {
  const v = signal(nRev, kind);
  const env = VC.envelopeSpectrum(v, FS, VC.envMaxFor(bf, fr, FS), VC.demodFixed(FS));
  const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
  return { on: VC.patternGrade(t ? t.r : 0, false, thr), r: t ? t.r : 0 };
}
for (const kind of ['bpfo', 'other', 'none']) {
  const det = gateOf(100, kind, VC.TGT_ADOPT);   // 상세
  const mon = gateOf(25, kind, VC.MON_ADOPT);    // 감시
  chk(det.on === mon.on, '두 창이 같은 답을 낸다 — ' + kind,
    '상세 r=' + det.r.toFixed(2) + '→' + det.on + ' · 감시 r=' + mon.r.toFixed(2) + '→' + mon.on);
}
// 부류가 실제로 갈려야 일치 검사가 유의미
chk(gateOf(100, 'bpfo', VC.TGT_ADOPT).on !== gateOf(100, 'none', VC.TGT_ADOPT).on,
  '결함과 정상이 갈린다 — 일치 검사가 공허하지 않다');

// ── 2. 임계 짝 ────────────────────────────────────────────────────────────
chk(VC.MON_ADOPT < VC.TGT_ADOPT, '짧은 창의 임계가 더 낮다 — 창이 짧으면 점수 분포가 내려간다',
  VC.MON_ADOPT + ' < ' + VC.TGT_ADOPT);
chk(VC.patternGrade(VC.TGT_ADOPT, false, undefined) === 0,
  '창 임계를 안 밝히면 게이트를 열지 않는다 — 기본값은 조용히 틀린 창으로 판정하게 한다');

// ── 3. 세 경로 동일 규칙 호출 (구조) ─────────────────────────────────
/* 값 검사로는 다른 검출기 재도입을 못 잡음 — 호출 형태 고정 */
const appSrc = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const liveSrc = await readFile(new URL('../src/data/live.js', import.meta.url), 'utf8');
const monSrc = await readFile(new URL('../../cgi-bin/monitor/monitor.js', import.meta.url), 'utf8');

chk(/VC\.patternGrade\(det\.sideband[\s\S]{0,160}VC\.TGT_ADOPT\)/.test(appSrc),
  '상세는 det.sideband(targetedMatch)를 TGT_ADOPT로 연다');
chk(/VC\.patternGrade\(r, false, VC\.MON_ADOPT\)/.test(liveSrc),
  '앱 감시는 같은 함수를 MON_ADOPT로 연다');
chk(/patternGrade\(r2, false, MON_ADOPT\)/.test(monSrc),
  '서버 감시도 같은 함수를 MON_ADOPT로 연다');
// 서버 임베드에 patternGrade 포함 필요 — 없으면 TQL에서 ReferenceError
chk(/patternGrade: patternGrade/.test(await readFile(new URL('../../cgi-bin/calc/calc.js', import.meta.url), 'utf8')),
  'patternGrade가 서버 임베드(patSrc)에 실린다');

/* EVID_ADOPT는 원인 지목·근거 강도 표시 전용 — 등급 게이트에 쓰이면 경로별 판정이 갈림 */
const dxBody = appSrc.slice(appSrc.indexOf('_dxLive(eq, detIn, sev) {'), appSrc.indexOf('var wgA = VC.worstGrade('));
chk(!/patternGrade\([\s\S]{0,80}EVID_ADOPT/.test(dxBody),
  '등급 게이트가 근거 점수(EVID_ADOPT)로 되돌아가지 않았다');

/* 포락선 생성 방식(복조 대역·상한)이 같아야 배수 비교 가능 — 임계 짝은 창 길이 차이만 흡수 */
for (const [src, who] of [[liveSrc, 'live.js']]) {
  const nBand = (src.match(/VC\.demodFixed\(/g) || []).length;
  const nMax = (src.match(/VC\.envMaxFor\(/g) || []).length;
  chk(nBand >= 3 && nMax >= 3, who + '의 상세·감시·스윕이 모두 고정 대역과 envMaxFor를 쓴다',
    'demodFixed ' + nBand + '곳 · envMaxFor ' + nMax + '곳');
}

/* 창을 시간으로만 잡으면 저밀도 태그에서 표본 부족으로 판정 생략 — 앱·서버 표본 수 식이 같아야 화면 등급과 알람 일치 */
{
  const monSrc = await readFile(new URL('../../cgi-bin/monitor/monitor.js', import.meta.url), 'utf8');
  const has = (s, t) => s.indexOf(t) >= 0;
  chk(has(monSrc, 'Math.max(4096, Math.round(t.fs * MON_REV / fr))'),
    '서버도 필요 표본 수를 앱과 같은 식으로 잡는다');
  chk(has(liveSrc, 'Math.max(4096, Math.round(fs_ * VC.MON_REV / fr))'),
    '앱 쪽 식이 그대로다 — 한쪽만 바뀌면 다시 갈린다');
  chk(has(monSrc, 'function grab(sec)') && has(monSrc, '_wk<2'),
    '서버가 표본 부족이면 창을 넓혀 다시 읽는다 (두 번까지)');
  chk(has(monSrc, 'Math.min(600,') && has(liveSrc, 'Math.min(600,'),
    '창 상한 600초도 양쪽이 같다 — 더 넓히면 운전 상태가 섞인다');
}

console.log(fail ? '=== 실패 ' + fail + '건 ===' : '=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
