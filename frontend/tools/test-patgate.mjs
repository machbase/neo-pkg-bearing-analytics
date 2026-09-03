/* 결함 패턴 게이트가 감시·상세·서버에서 하나인지 검사한다.

   이 축은 등급을 **켜는** 유일한 축이라(ISO는 높이만 정한다) 여기가 갈리면 같은 태그가
   화면마다 다른 등급을 갖는다. 실제로 그렇게 갈려 있었다: 감시는 targetedMatch 격자 배수를
   MON_ADOPT와 대보는데, 상세만 _evidence 종합 점수를 EVID_ADOPT와 대봤다. 척도가 달라
   서로 환산되지 않으므로 "감시 주의 · 상세 양호"가 정상 동작처럼 남았다.

   지금 규칙은 하나다 — 검출기는 targetedMatch 하나, 임계만 창 길이에 맞춘 짝을 쓴다
   (25회전 MON_ADOPT · 100회전 TGT_ADOPT, 같은 오탐률에 맞춘 값). */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { readFile } = await import('node:fs/promises');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── 1. 두 창이 같은 답을 낸다 ──────────────────────────────────────────────
/* 같은 신호를 감시 창(25회전)과 상세 창(100회전)으로 잘라 각자의 임계로 판정한다.
   임계 짝이 창 길이 차이를 흡수하므로 두 답은 같아야 한다 — 다르면 사용자가 카드에서
   상세로 넘어갔을 때 등급이 바뀐다. 세 부류를 쓰는 이유는 한쪽으로만 쏠린 신호로는
   "둘 다 항상 켜짐/꺼짐"이 일치로 보이기 때문이다. */
const GEO = { n: 9, Bd: 12.7, Pd: 65, phi: 0 }, RPM = 1800, FS = 20000;
const fr = RPM / 60, bf = VC.bearingFreqs(RPM, GEO);

function signal(nRev, kind) {
  let seed = 999;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const n = Math.round(FS * nRev / fr), v = [];
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    let x = Math.sin(2 * Math.PI * fr * t) + 0.4 * Math.sin(2 * Math.PI * 2 * fr * t) + 0.6 * rnd();
    // 복조 대역(1–5 kHz)에 광대역 성분을 실어 준다 — 실제 기계의 그 대역은 비어 있지 않고,
    // 비워 두면 배경 중앙값이 바닥으로 내려가 배수가 신호와 무관하게 부푼다
    x += 0.5 * rnd() * Math.sin(2 * Math.PI * 2500 * t) + 0.5 * rnd() * Math.sin(2 * Math.PI * 3800 * t);
    if (kind === 'bpfo') { const p = (t * bf.BPFO) % 1; x += 2.2 * Math.exp(-p * 45) * Math.sin(2 * Math.PI * 3000 * t); }
    if (kind === 'other') { const p = (t * 77) % 1; x += 2.2 * Math.exp(-p * 45) * Math.sin(2 * Math.PI * 3000 * t); }
    v.push(x);
  }
  return v;
}
// 상세(liveDetail)·감시(monPattern)가 포락선을 만드는 방식 그대로 — 창 길이만 다르다
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
// 부류가 실제로 갈려야 검사에 뜻이 있다 — 셋 다 같은 답이면 위 일치는 공허하다
chk(gateOf(100, 'bpfo', VC.TGT_ADOPT).on !== gateOf(100, 'none', VC.TGT_ADOPT).on,
  '결함과 정상이 갈린다 — 일치 검사가 공허하지 않다');

// ── 2. 임계 짝 ────────────────────────────────────────────────────────────
chk(VC.MON_ADOPT < VC.TGT_ADOPT, '짧은 창의 임계가 더 낮다 — 창이 짧으면 점수 분포가 내려간다',
  VC.MON_ADOPT + ' < ' + VC.TGT_ADOPT);
chk(VC.patternGrade(VC.TGT_ADOPT, false, undefined) === 0,
  '창 임계를 안 밝히면 게이트를 열지 않는다 — 기본값은 조용히 틀린 창으로 판정하게 한다');

// ── 3. 세 경로가 같은 규칙을 부른다 (구조) ─────────────────────────────────
/* 값 검사만으로는 "누가 딴 검출기를 다시 들여왔다"를 못 잡는다 — 갈라졌던 방식이
   정확히 그것이었다(상세만 _evidence 점수로 게이트를 열었다). 호출 형태를 고정한다. */
const appSrc = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const liveSrc = await readFile(new URL('../src/data/live.js', import.meta.url), 'utf8');
const monSrc = await readFile(new URL('../../cgi-bin/monitor/monitor.js', import.meta.url), 'utf8');

chk(/VC\.patternGrade\(det\.sideband[\s\S]{0,160}VC\.TGT_ADOPT\)/.test(appSrc),
  '상세는 det.sideband(targetedMatch)를 TGT_ADOPT로 연다');
chk(/VC\.patternGrade\(r, false, VC\.MON_ADOPT\)/.test(liveSrc),
  '앱 감시는 같은 함수를 MON_ADOPT로 연다');
chk(/patternGrade\(r2, false, MON_ADOPT\)/.test(monSrc),
  '서버 감시도 같은 함수를 MON_ADOPT로 연다');
// 서버가 그 함수를 실제로 갖고 있어야 한다 — 임베드에 안 실리면 TQL에서 ReferenceError로 죽는다
chk(/patternGrade: patternGrade/.test(await readFile(new URL('../../cgi-bin/calc/calc.js', import.meta.url), 'utf8')),
  'patternGrade가 서버 임베드(patSrc)에 실린다');

/* 게이트가 근거 점수로 되돌아가면 다시 갈라진다 — EVID_ADOPT는 원인 지목·근거 강도 표시에만
   쓰여야 하고, 등급을 켜는 자리에는 없어야 한다. */
const dxBody = appSrc.slice(appSrc.indexOf('_dxLive(eq, detIn, sev) {'), appSrc.indexOf('var wgA = VC.worstGrade('));
chk(!/patternGrade\([\s\S]{0,80}EVID_ADOPT/.test(dxBody),
  '등급 게이트가 근거 점수(EVID_ADOPT)로 되돌아가지 않았다');

/* 두 경로의 포락선이 같은 방식으로 만들어져야 배수가 비교 가능하다 —
   복조 대역이나 상한이 갈리면 임계 짝이 흡수하는 것은 창 길이뿐이므로 전제가 깨진다. */
for (const [src, who] of [[liveSrc, 'live.js']]) {
  const nBand = (src.match(/VC\.demodFixed\(/g) || []).length;
  const nMax = (src.match(/VC\.envMaxFor\(/g) || []).length;
  chk(nBand >= 3 && nMax >= 3, who + '의 상세·감시·스윕이 모두 고정 대역과 envMaxFor를 쓴다',
    'demodFixed ' + nBand + '곳 · envMaxFor ' + nMax + '곳');
}

/* 창을 시간으로만 잡으면 밀도가 낮은 태그에서 표본이 모자라 판정이 통째로 건너뛰어진다.
   앱만 되짚으면 같은 신호에 앱은 재고 서버는 못 재 — 화면엔 등급이 뜨는데 알람은 안 난다
   (실측: 60태그 전부 서버 표본 미달이라 이벤트 0건, 그동안 심박은 정상이었다). */
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
