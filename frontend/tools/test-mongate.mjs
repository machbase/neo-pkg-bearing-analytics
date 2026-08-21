// 감시 등급도 결함 패턴이 켠다 — 앱·서버가 같은 규칙을 쓰는지 잠근다.
//
// 전에는 감시가 ISO OR 베이스라인 OR 대역이라 상세분석(패턴 게이트)과 다른 답을 냈다.
// 검증 풀에서 ISO 단독 오탐이 69%인데 그게 그대로 등급이 됐다 — 게이트로 바꾸면 4%다.
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
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

// ── 앱과 서버가 같은 소스를 쓴다 ────────────────────────────────────────────
/* 서버 TQL은 patSrc()를 문자열로 임베드한다. 그 소스만으로 앱과 같은 값이 나와야
   두 모드가 갈리지 않는다 — 상수(DEMOD_FIX·TGT_H·MON_ADOPT)까지 함께 실려야 한다. */
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

// ── 감시 창은 상세분석보다 짧다 ─────────────────────────────────────────────
/* 서버(goja)가 앱보다 100~400배 느려서 100회전이면 91태그 한 회차가 10분 주기를 넘는다.
   25회전이면 검출 66%→59%로 7%p만 주고 회차가 감당된다 — 감시는 트리거이고 확정은 상세가 한다. */
{
  chk(VC.MON_REV < 100, '감시 창(25회전)이 상세분석(100회전)보다 짧다', String(VC.MON_REV));
  chk(VC.MON_ADOPT < VC.TGT_ADOPT,
    '창이 짧으면 점수 분포가 내려가므로 임계도 같이 낮다 — 같은 값을 쓰면 감시가 조용해진다',
    VC.MON_ADOPT + ' < ' + VC.TGT_ADOPT);
}

// ── 대역은 이벤트를 내지 않는다 ─────────────────────────────────────────────
{
  const cfg = { escHold: 0, recHold: 0, reno: {} };
  const r = judgeTick(null, 1, false, 1000, cfg, { on: true, gi: 2 });
  chk(!r.events.some((e) => /^band/.test(e.etype)), '대역 이탈이 이벤트를 안 낸다',
    r.events.map((e) => e.etype).join('|') || '(없음)');
  chk(r.next.bb === true, '이탈 상태는 추적한다 — 근거표가 읽는다');
}

// ── 베이스라인도 이벤트를 내지 않는다 — 판정값이 10초 축이라 10분 이벤트와 시간축이 다르다 ──
{
  const cfg = { escHold: 0, recHold: 0, reno: {} };
  const r = judgeTick({ g: 0, since: 0, cand: 0, candSince: 0, lastRe: 0, b: false }, 0, true, 1000, cfg, null);
  chk(r.next.g === 0, '베이스라인이 켜져도 등급은 안 오른다', String(r.next.g));
  chk(!r.events.some((e) => e.etype === 'baseline'), '베이스라인 이탈이 이벤트를 안 낸다',
    r.events.map((e) => e.etype).join('|') || '(없음)');
  chk(r.next.b === true, '이탈 상태는 추적한다 — 근거표가 읽는다');
}

// ── 감시 창은 시간이 아니라 표본 수로 잡는다 ────────────────────────────────
/* 적재 시 타임스탬프가 퍼진 태그(재생 데이터·간헐 수집)는 벽시계 밀도가 샘플레이트와 다르다.
   NASA IMS가 그렇다 — 20,480 표본이 1분에 퍼져 있어 341/초다. 25회전이 0.75초인 태그에서
   시간 창으로만 읽으면 256 표본이 들어오고, 4096 미만이라 **판정이 조용히 통째로 건너뛰어진다**.
   실제로 섀도 실행에서 14태그 전 수명의 판정 회차가 0으로 나왔다(에러 없이). */
{
  const { monPattern } = await import('../src/data/live.js');
  chk(typeof monPattern === 'function', 'monPattern이 감시용 진입점이다');
  const src = (await import('node:fs')).readFileSync('frontend/src/data/live.js', 'utf8');
  const body = src.slice(src.indexOf('export async function monPattern'), src.indexOf('// 상세분석 상세 데이터'));
  chk(/const need = Math\.max\(4096, Math\.round\(fs_ \* VC\.MON_REV \/ fr\)\)/.test(body),
    '필요한 표본 수를 회전수에서 역산한다');
  chk(/for \(let k = 0; k < 2 && w\.values\.length && w\.values\.length < need/.test(body),
    '모자라면 창을 넓혀 다시 읽는다 — 밀도가 낮은 태그가 조용히 빠지지 않게');
  chk(/w\.values\.length > need/.test(body), '넘치면 최신 쪽만 쓴다 — 창이 길어지면 운전 상태가 섞인다');
}

console.log(fail ? `\n=== FAIL ${fail}건 (추가분 포함) ===` : '\n=== 추가분까지 전부 통과 ===');
process.exit(fail ? 1 : 0);
