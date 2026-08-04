/* ISO 대역제한 판정 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   ISO 10816의 존 경계(1.12/2.80/7.10)는 10~1000 Hz 속도 RMS를 재서 만든 값이다. 전대역 값을
   그 경계에 대면 다른 양을 재게 된다 — 실측(BEARING:C1, 25.6 kHz)에서 에너지의 82%가 1 kHz
   위에 있어 전대역 RMS가 49% 부풀고 등급이 주의→위험으로 뒤집혔다.

   여기서 지키는 것:
    ① 밴드패스가 FFT로 낸 대역 에너지와 같은 답을 낸다
    ② ISO ≤ 전대역 (상한 성질) — 이게 성립해야 "전대역이 양호면 계산 없이 양호 확정"이 옳다
    ③ 존과 베이스라인이 서로 다른 값을 본다
    ④ 표시 등급은 세 판정 중 최악 */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const FS = 25600, N = 16384;

// 합성 신호 — 주파수를 알고 만들었으므로 각 대역 에너지의 참값을 안다
function tone(f, amp, n, fs) {
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / fs);
  return x;
}
const add = (...xs) => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0));
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

// ── ① 통과대역/저지대역 ────────────────────────────────────────────────────
{
  // 100 Hz(통과) 진폭 1 → RMS 1/√2 = 0.7071
  const pass = tone(100, 1, N, FS);
  const r = VC.isoRms(pass, FS);
  chk(Math.abs(r - 0.7071) < 0.01, '통과대역 100 Hz는 그대로 통과', r.toFixed(4));

  // 5 kHz(저지) 진폭 1 → 거의 0이어야 한다
  const stop = tone(5000, 1, N, FS);
  const r2 = VC.isoRms(stop, FS);
  chk(r2 < 0.02, '저지대역 5 kHz는 걸러진다', r2.toFixed(5));

  // 1 Hz(저지, ISO 하한 아래) — 회전이 느린 성분·드리프트
  const lo = tone(1, 1, N, FS);
  const r3 = VC.isoRms(lo, FS);
  chk(r3 < 0.05, '10 Hz 아래도 걸러진다', r3.toFixed(5));
}

// ── ② 상한 성질: ISO ≤ 전대역 ──────────────────────────────────────────────
{
  const sig = add(tone(100, 1, N, FS), tone(5000, 3, N, FS));   // 고주파가 지배
  const wide = rms(sig), iso = VC.isoRms(sig, FS);
  chk(iso <= wide + 1e-9, 'ISO ≤ 전대역 (상한 성질)', iso.toFixed(4) + ' ≤ ' + wide.toFixed(4));
  /* 이 성질이 "전대역이 양호 경계 미만이면 계산 없이 양호 확정"의 근거다.
     깨지면 판정을 건너뛴 구간에서 실제 이상을 놓친다. */
  chk(wide > 2 && iso < 0.8, '고주파가 지배하면 전대역만 크게 부푼다',
    '전대역 ' + wide.toFixed(2) + ' vs ISO ' + iso.toFixed(2));
}

// ── DC 오프셋 ──────────────────────────────────────────────────────────────
{
  const base = tone(100, 1, N, FS);
  const off = base.map((v) => v + 5);        // 큰 DC
  chk(Math.abs(VC.isoRms(off, FS) - VC.isoRms(base, FS)) < 0.01, 'DC 오프셋은 ISO 값에 영향 없음');
  // windowRms도 같은 성질을 가져야 한다(롤업 SUM으로 평균 제거)
  const b = [{ rms: Math.sqrt(0.5 + 25), cnt: 1000, sum: 5000 }];   // AC 0.7071 + DC 5
  chk(Math.abs(VC.windowRms(b).rms - 0.7071) < 0.01, 'windowRms가 DC를 제거한다', VC.windowRms(b).rms.toFixed(4));
  chk(VC.windowRms([{ rms: 2, cnt: 100 }]).rms === 2, 'SUM 없는 옛 버킷은 기존 동작 유지');
}

// ── 지름길 상한 — 창을 맞춰서 잡는다 ──────────────────────────────────────
/* 상한 성질은 "같은 표본"일 때만 성립한다. ISO는 최근 1초에서 재고 판정값은 평가창 전체의
   실효값이라, 평가창 값을 경계에 대면 조용한 9초 뒤 마지막 1초만 튄 경우를 삼킨다.
   isoSkippable은 구간 안 가장 큰 초 버킷을 본다 — 어떤 1초 창도 그보다 클 수 없다. */
{
  const Z0 = 1.12;
  chk(VC.isoSkippable([{ rms: 0.3, cnt: 1000 }, { rms: 0.4, cnt: 1000 }], Z0) === true,
    '전 구간이 경계 아래면 건너뛴다');
  chk(VC.isoSkippable([{ rms: 0.3, cnt: 1000 }, { rms: 3.0, cnt: 1000 }], Z0) === false,
    '한 초라도 경계를 넘으면 건너뛰지 않는다');
  chk(VC.isoSkippable([], Z0) === false && VC.isoSkippable(null, Z0) === false,
    '버킷이 없으면 상한을 못 세우므로 건너뛰지 않는다');
  chk(VC.isoSkippable([{ rms: 0.3, cnt: 1000 }], 0) === false, '경계가 없으면 건너뛰지 않는다');
  // 평가창 RMS는 경계 아래인데 그 안의 한 초는 위험 — 옛 지름길(wide 비교)이 놓치던 모양
  const spike = [];
  for (let i = 0; i < 9; i++) spike.push({ rms: 0.30, cnt: 1000 });
  spike.push({ rms: 3.0, cnt: 1000 });
  const wide = VC.windowRms(spike).rms;
  chk(wide < Z0 && VC.isoSkippable(spike, Z0) === false,
    '평가창은 양호인데 한 초가 튀면 계산한다', '평가창 ' + wide.toFixed(4) + ' · 최대 초 3.0');
}

// ── 샘플레이트 추정 — 표본 간격의 중앙값 ──────────────────────────────────
/* fs는 대역제한을 걸지 말지를 정하고(isoNeeded) 필터 차단주파수까지 정한다. 이걸 "초당 행 수"로
   세면 기록 밀도에 끌려간다 — 간헐 캡처면 과소, 중복 적재면 과대. 실측에서 진짜 4,096 Hz인
   태그가 각각 70·8,190으로 잡혔고, 70이면 대역제한이 통째로 꺼진다.
   간격을 보면 갭은 정렬 끝으로 밀려 중앙값에 못 닿고, 중복은 간격 0이라 제외된다. */
{
  const DT = 39;                                  // 25.6 kHz ≈ 39 μs 간격(BEARING 실측)
  const cont = (n, dt) => { const a = [1e15]; for (let i = 1; i < n; i++) a.push(a[i-1] + dt); return a; };
  chk(Math.abs(VC.fsFromTimes(cont(500, DT)) - 25641) < 2, '연속 표본 → 간격의 역수', String(VC.fsFromTimes(cont(500, DT))));
  chk(VC.fsFromTimes(cont(500, 1000)) === 1000, '1 kHz(1,000 μs 간격)도 그대로', String(VC.fsFromTimes(cont(500, 1000))));

  // 간헐 캡처 — 1초 캡처 6번 사이에 60초 갭. 갭 5개는 중앙값에 닿지 못한다
  const burst = [];
  let t = 1e15;
  for (let b = 0; b < 6; b++) {
    for (let i = 0; i < 200; i++) { burst.push(t); t += DT; }
    t += 60e6;                                    // 60초 쉼
  }
  chk(Math.abs(VC.fsFromTimes(burst) - 25641) < 2, '간헐 캡처여도 갭에 끌려가지 않는다', String(VC.fsFromTimes(burst)));
  // 같은 데이터를 "초당 행 수"로 세면 어떻게 나오는지 — 이게 지금 방식이 빠지는 함정이다
  const rows = burst.length, spanSec = (burst[burst.length-1] - burst[0]) / 1e6;
  chk(Math.round(rows / spanSec) < 100, '대조: 초당 행 수로 세면 100 Hz 아래로 무너진다',
    Math.round(rows / spanSec) + ' Hz');

  // 중복 적재 — 같은 시각이 두 번. 간격 0은 제외되므로 값이 두 배로 뛰지 않는다
  const dup = [];
  cont(300, DT).forEach((v) => { dup.push(v); dup.push(v); });
  chk(Math.abs(VC.fsFromTimes(dup) - 25641) < 2, '중복 적재에도 두 배로 뛰지 않는다', String(VC.fsFromTimes(dup)));

  chk(VC.fsFromTimes(cont(10, DT)) === 0 && VC.fsFromTimes([]) === 0 && VC.fsFromTimes(null) === 0,
    '근거가 얇으면 0 — 호출측이 옛 추정으로 물러난다');
}

// ── ③ 대역제한이 필요한 샘플레이트 판별 ────────────────────────────────────
chk(VC.isoNeeded(25600) === true, '25.6 kHz는 대역제한 필요 (Nyquist 12.8 kHz)');
chk(VC.isoNeeded(1000) === false, '1 kHz는 불필요 — Nyquist 500 Hz라 1 kHz 위가 없다');
chk(VC.isoNeeded(2000) === false, '2 kHz도 불필요 — Nyquist가 정확히 1000 Hz');
chk(VC.isoNeeded(0) === false && VC.isoNeeded(undefined) === false, '샘플레이트 불명이면 필터를 걸지 않는다');

// ── ④ 표시 등급은 세 판정 중 최악 ──────────────────────────────────────────
{
  chk(VC.worstGrade(0, 0, 0).gi === 0, '전부 정상이면 양호');
  const a = VC.worstGrade(0, 1, 0);
  chk(a.gi === 1 && a.src === 'baseline', '존 양호 + 베이스라인 이탈 → 주의(베이스라인)', JSON.stringify(a));
  const b2 = VC.worstGrade(1, 1, 3);
  chk(b2.gi === 3 && b2.src === 'band', '대역이 가장 나쁘면 대역이 등급을 정한다', JSON.stringify(b2));
  const c = VC.worstGrade(2, 1, 1);
  chk(c.gi === 2 && c.src === 'iso', '존이 가장 나쁘면 존', JSON.stringify(c));
  /* ISO만 쓰면 고주파가 지배하는 센서에서 베어링이 나빠져도 카드가 양호로 남는다 —
     C1은 ISO로 위험이 나올 수 없다(실측 80창 중 위험 0). 그 회귀를 여기서 막는다. */
  chk(VC.worstGrade(0, 0, 2).gi === 2, 'ISO 양호여도 대역 위험이면 위험으로 표시');
}

// ── 상세·리포트와 감시가 같은 양을 재는가 ─────────────────────────────────
/* 상세분석·리포트는 예전부터 ISO 10~1000 Hz를 FFT 블록평균(bandRmsAveraged)으로 재고 있었고,
   감시만 전대역을 쓰고 있었다. 오늘 감시를 대역제한으로 바꿔 셋이 같은 정의가 됐다.
   구현이 둘(FFT vs 시간영역 밴드패스)이므로 값이 갈라지지 않는지 확인한다. */
{
  const sig = add(tone(30, 2, N, FS), tone(150, 1, N, FS), tone(600, 0.5, N, FS), tone(4000, 3, N, FS));
  const rep = VC.bandRmsAveraged(sig, FS, 10, 1000, 8).rms;   // 상세·리포트
  const mon = VC.isoRms(sig, FS);                              // 감시
  const diff = Math.abs(mon / rep - 1);
  chk(diff < 0.05, '리포트(FFT 블록평균)와 감시(밴드패스) ISO 값이 5% 이내',
    rep.toFixed(4) + ' vs ' + mon.toFixed(4) + ' (' + (diff * 100).toFixed(2) + '%)');
  // 둘 다 1 kHz 위를 확실히 배제해야 한다 — 4 kHz 성분 3이 들어와도 값이 거의 안 변해야 한다
  const noHf = add(tone(30, 2, N, FS), tone(150, 1, N, FS), tone(600, 0.5, N, FS));
  chk(Math.abs(VC.isoRms(noHf, FS) / mon - 1) < 0.05, '1 kHz 위 성분이 ISO 값을 바꾸지 않는다',
    VC.isoRms(noHf, FS).toFixed(4) + ' vs ' + mon.toFixed(4));
}

// ── 임베드 자체 완결 ───────────────────────────────────────────────────────
/* 서버 TQL에 문자열로 박히므로 바깥 이름을 쓰면 안 된다. isoRms→bandpass→biquad로 서로를
   이름으로 부르는 구조라, 각각 'var 이름 = <소스>'로 붙이면 압축 후 죽는다
   (named function expression의 이름은 자기 안에서만 보인다 — 오늘 감시를 죽인 그 함정). */
{
  const src = VC.isoSrc();
  const sig = add(tone(100, 1, N, FS), tone(5000, 3, N, FS));
  const got = new Function(src + '\nreturn isoRms(arguments[0], arguments[1]);')(sig, FS);
  const want = VC.isoRms(sig, FS);
  chk(Math.abs(got - want) < 1e-12, '임베드본과 원본 isoRms 일치 (앱↔서버 드리프트 0)', got.toFixed(6));
  chk(new Function(src + '\nreturn isoNeeded(25600);')() === true, '임베드본 isoNeeded 동작');

  /* 압축 모의 — 개발 소스로는 이 결함이 절대 안 드러난다(이름이 그대로라 우연히 맞는다).

     미니파이어가 실제로 하는 일을 흉내낸다: 함수 소스 안의 이름만 일괄로 바꾼다.
     조립 코드가 쓰는 리터럴('var bandpass =')은 미니파이어가 건드리지 못하므로 그대로 둔다.
     이 조건에서 'var 이름 = <소스>' 방식은 반드시 깨진다 — 그게 오늘 감시를 죽인 결함이다. */
  const MAP = [['biquad', 'q1'], ['bandpass', 'q2'], ['isoRms', 'q3'], ['isoNeeded', 'q4']];
  let msrc = [VC.biquad, VC.bandpass, VC.isoRms, VC.isoNeeded].map((fn) => fn.toString()).join('\n');
  for (const [from, to] of MAP) msrc = msrc.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
  const M = new Function(msrc + '\nreturn [q1,q2,q3,q4];')();
  chk(M.every((fn, i) => fn.name === MAP[i][1]), '압축 모의로 이름이 바뀐 함수 생성', M.map((fn) => fn.name).join(','));

  const runIso = (code) => {
    try { return { v: new Function(code + '\nreturn isoRms(arguments[0], arguments[1]);')(sig, FS) }; }
    catch (e) { return { err: e.message }; }
  };
  // 이 모의가 무력하지 않은지부터 확인한다 — 깨진 방식은 반드시 실패해야 한다
  const naive = runIso(MAP.map(([orig], i) => 'var ' + orig + ' = ' + M[i] + ';').join('\n'));
  chk(!!naive.err, '모의 유효성: var 나열 방식은 압축 시 깨진다', naive.err || '깨지지 않음(모의가 무력)');
  const good = runIso(VC.embedSrc(M, { isoRms: M[2], isoNeeded: M[3] }));
  chk(!good.err && Math.abs(good.v - want) < 1e-12,
    '이름이 압축돼도 임베드본이 동작 (상호참조가 한 스코프에 있다)', good.err || good.v.toFixed(6));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
