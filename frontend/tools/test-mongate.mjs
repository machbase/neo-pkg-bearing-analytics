// 감시 등급 결함 패턴 게이트 — 오프라인(Neo 불필요) · npm run smoke 포함
// · 게이트 규칙(패턴이 켜고 ISO가 높이 결정), 앱·서버 임베드 소스 결과 일치
// · 감시 창(표본 수 기준·짧은 창·낮은 임계), 대역·베이스라인 이벤트 없음, 저샘플 전대역 폴백
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
/* 소스 대조용 파일 읽기 — cwd 무관하도록 모듈 위치 기준 경로 */
const PKG = new URL('../../', import.meta.url);
const readPkg = async (rel) => (await import('node:fs')).readFileSync(new URL(rel, PKG), 'utf8');
const { judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (c, label, extra) => {
  if (c) console.log('PASS', label, extra === undefined ? '' : extra);
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); }
};

// ── 게이트 규칙 자체 ────────────────────────────────────────────────────────
{
  chk(VC.patternGate(false, 3) === 0, 'ISO가 D존이어도 패턴이 없으면 등급 0 — ISO는 경보를 켜지 않는다');
  chk(VC.patternGate(true, 0) === 1, '패턴이 켜지면 최소 주의 — "결함 검출 · 양호"는 화면이 스스로 어긋난다');
  chk(VC.patternGate(true, 2) === 2 && VC.patternGate(true, 3) === 3, 'ISO가 높이를 정한다');
}

// ── 앱·서버 동일 소스 ────────────────────────────────────────────
/* 서버 TQL은 patSrc() 문자열 임베드 — 그 소스만으로 앱과 같은 값 필요, 상수(DEMOD_FIX·TGT_H·MON_ADOPT) 포함 */
{
  const src = VC.patSrc();
  const F = new Function(src + '\nreturn { envelopeSpectrum, targetedMatch, bearingFreqs, envMaxFor, demodFixed, patternGate, MON_REV, MON_ADOPT };')();
  chk(F.MON_REV === VC.MON_REV && F.MON_ADOPT === VC.MON_ADOPT, '상수가 임베드 소스에 실린다',
    'REV=' + F.MON_REV + ' ADOPT=' + F.MON_ADOPT);

  const FS = 25600, N = 1 << 14, fc = 3000, fm = 107, x = [];
  for (let i = 0; i < N; i++) { const t = i / FS; x.push((1 + 0.6 * Math.cos(2 * Math.PI * fm * t)) * Math.cos(2 * Math.PI * fc * t)); }
  const geo = { n: 9, Bd: 7.94, Pd: 39.04, phi: 0 }, rpm = 1800, fr = rpm / 60;
  const a = (M) => {
    const bf = M.bearingFreqs(rpm, geo);
    const env = M.envelopeSpectrum(x, FS, M.envMaxFor(bf, fr, FS), M.demodFixed(FS));
    const t = M.targetedMatch(env, bf, fr, env.resTrue || env.res);
    return t ? t.r : 0;
  };
  const rApp = a(VC), rSrv = a(F);
  chk(Math.abs(rApp - rSrv) < 1e-9, '임베드 소스가 앱과 같은 격자 점수를 낸다 — 두 모드가 갈리지 않는다',
    rApp.toFixed(3) + ' / ' + rSrv.toFixed(3));
}

// ── 감시 창은 상세분석보다 짧음 ─────────────────────────────────────────────
/* 서버(goja)가 느려 100회전이면 회차가 10분 주기 초과 — 감시는 트리거, 확정은 상세분석 */
{
  chk(VC.MON_REV < 100, '감시 창(25회전)이 상세분석(100회전)보다 짧다', String(VC.MON_REV));
  chk(VC.MON_ADOPT < VC.TGT_ADOPT,
    '창이 짧으면 점수 분포가 내려가므로 임계도 같이 낮다 — 같은 값을 쓰면 감시가 조용해진다',
    VC.MON_ADOPT + ' < ' + VC.TGT_ADOPT);
}

// ── 대역은 이벤트 없음 ─────────────────────────────────────────────
{
  const cfg = { escHold: 0, recHold: 0, reno: {} };
  const r = judgeTick(null, 1, false, 1000, cfg, { on: true, gi: 2 });
  chk(!r.events.some((e) => /^band/.test(e.etype)), '대역 이탈이 이벤트를 안 낸다',
    r.events.map((e) => e.etype).join('|') || '(없음)');
  chk(r.next.bb === true, '이탈 상태는 추적한다 — 근거표가 읽는다');
}

// ── 베이스라인도 이벤트 없음 — 판정값이 10초 축이라 10분 이벤트와 시간축 불일치 ──
{
  const cfg = { escHold: 0, recHold: 0, reno: {} };
  const r = judgeTick({ g: 0, since: 0, cand: 0, candSince: 0, lastRe: 0, b: false }, 0, true, 1000, cfg, null);
  chk(r.next.g === 0, '베이스라인이 켜져도 등급은 안 오른다', String(r.next.g));
  chk(!r.events.some((e) => e.etype === 'baseline'), '베이스라인 이탈이 이벤트를 안 낸다',
    r.events.map((e) => e.etype).join('|') || '(없음)');
  chk(r.next.b === true, '이탈 상태는 추적한다 — 근거표가 읽는다');
}

// ── 감시 창은 시간 아닌 표본 수 기준 ────────────────────────────────
/* 타임스탬프가 퍼진 태그(재생 데이터·간헐 수집, 예: NASA IMS)는 벽시계 밀도 ≠ 샘플레이트
   → 시간 창만으로 읽으면 표본 4096 미만이 되어 판정이 조용히 건너뛰어짐 */
{
  const { monPattern } = await import('../src/data/live.js');
  chk(typeof monPattern === 'function', 'monPattern이 감시용 진입점이다');
  const src = await readPkg('frontend/src/data/live.js');
  const body = src.slice(src.indexOf('export async function monPattern'), src.indexOf('// 상세분석 상세 데이터'));
  chk(/const need = Math\.max\(4096, Math\.round\(fs_ \* VC\.MON_REV \/ fr\)\)/.test(body),
    '필요한 표본 수를 회전수에서 역산한다');
  chk(/for \(let k = 0; k < 2 && w\.values\.length && w\.values\.length < need/.test(body),
    '모자라면 창을 넓혀 다시 읽는다 — 밀도가 낮은 태그가 조용히 빠지지 않게');
  chk(/w\.values\.length > need/.test(body), '넘치면 최신 쪽만 쓴다 — 창이 길어지면 운전 상태가 섞인다');
}

/* ── 저샘플 폴백: 세 경로 동일 규칙 ───────────────────────────────────────
   · 고정 대역(1~5 kHz)은 fs ≥ 10.5 kHz에서만 성립, 그 미만은 대역통과 없이 전대역 복조(커토그램 폴백 없음)
   · 감시가 손을 떼면 카드가 '판정 보류'로 굳어 상세분석과 불일치 — 세 경로 모두 전대역 여부 함께 반환 */
{
  chk(VC.demodFixed(20480) && !VC.demodFixed(2048), '고정 대역은 고샘플에서만 선다',
    JSON.stringify(VC.demodFixed(2048)));
  // 대역 없이도 포락선 산출 — 폴백의 전제
  const sig = []; for (let i = 0; i < 8192; i++) sig.push(Math.sin(2 * Math.PI * 120 * i / 2048) * (1 + Math.sin(2 * Math.PI * 7 * i / 2048)));
  chk(VC.envelopeSpectrum(sig, 2048, 500, null).freqs.length > 0, '대역이 null이면 전대역으로 복조한다');

  const live = await readPkg('frontend/src/data/live.js');
  const mon = live.slice(live.indexOf('export async function monPattern'), live.indexOf('// 상세분석 상세 데이터'));
  chk(!/if \(!band\) return null/.test(mon), '감시 경로가 저샘플에서 손을 떼지 않는다');
  chk(/demodSrc: band \? 'fixed' : 'wideband'/.test(mon), '감시 경로가 복조 출처를 알려준다');
  chk(/det\.demodSrc = fixBand \? 'fixed' : 'wideband'/.test(live), '상세 경로도 같은 이름으로 알려준다');

  const srv = await readPkg('cgi-bin/monitor/monitor.js');
  chk(!/demodFixed\(t\.fs\); if\(!band\) return null/.test(srv), '서버 감시도 저샘플에서 손을 떼지 않는다');
  chk(/demodFixed\(t\.fs\) \|\| null/.test(srv) && /wide: !band/.test(srv), '서버 감시도 전대역 여부를 함께 돌려준다');
}

console.log(fail ? `\n=== FAIL ${fail}건 (추가분 포함) ===` : '\n=== 추가분까지 전부 통과 ===');
process.exit(fail ? 1 : 0);
