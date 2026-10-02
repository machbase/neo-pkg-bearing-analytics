/* ISO 대역제한 판정 — ISO 10816 존 경계(10~1000 Hz 속도 RMS 기준)에 대역제한 값을 대는지 확인
   · 통과/저지대역, ISO ≤ 전대역(상한 성질), DC 제거, 지름길 상한, 샘플레이트 추정, worstGrade(넘어온 축 중 최악)
   · 상세·리포트(FFT)와 감시(밴드패스) 값 일치, 임베드 자체 완결, 원본 단위(g·μm)도 속도로 환산해 같은 경계
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const FS = 25600, N = 16384;

// 합성 신호 — 주파수를 알아 각 대역 에너지 참값을 앎
function tone(f, amp, n, fs) {
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / fs);
  return x;
}
const add = (...xs) => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0));
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

// ── 통과대역/저지대역 ──────────────────────────────────────────────────────
{
  // 100 Hz(통과) 진폭 1 → RMS 1/√2 = 0.7071
  const pass = tone(100, 1, N, FS);
  const r = VC.isoRms(pass, FS);
  chk(Math.abs(r - 0.7071) < 0.01, '통과대역 100 Hz는 그대로 통과', r.toFixed(4));

  // 5 kHz(저지) 진폭 1 → 거의 0
  const stop = tone(5000, 1, N, FS);
  const r2 = VC.isoRms(stop, FS);
  chk(r2 < 0.02, '저지대역 5 kHz는 걸러진다', r2.toFixed(5));

  // 1 Hz(저지, ISO 하한 아래) — 회전이 느린 성분·드리프트
  const lo = tone(1, 1, N, FS);
  const r3 = VC.isoRms(lo, FS);
  chk(r3 < 0.05, '10 Hz 아래도 걸러진다', r3.toFixed(5));
}

// ── 상한 성질: ISO ≤ 전대역 ────────────────────────────────────────────────
{
  const sig = add(tone(100, 1, N, FS), tone(5000, 3, N, FS));   // 고주파가 지배
  const wide = rms(sig), iso = VC.isoRms(sig, FS);
  chk(iso <= wide + 1e-9, 'ISO ≤ 전대역 (상한 성질)', iso.toFixed(4) + ' ≤ ' + wide.toFixed(4));
  /* "전대역이 양호 경계 미만이면 계산 없이 양호 확정"의 근거 — 깨지면 건너뛴 구간의 이상을 놓침 */
  chk(wide > 2 && iso < 0.8, '고주파가 지배하면 전대역만 크게 부푼다',
    '전대역 ' + wide.toFixed(2) + ' vs ISO ' + iso.toFixed(2));
}

// ── DC 오프셋 ──────────────────────────────────────────────────────────────
{
  const base = tone(100, 1, N, FS);
  const off = base.map((v) => v + 5);        // 큰 DC
  chk(Math.abs(VC.isoRms(off, FS) - VC.isoRms(base, FS)) < 0.01, 'DC 오프셋은 ISO 값에 영향 없음');
  // windowRms도 DC 제거(롤업 SUM으로 평균 제거)
  const b = [{ rms: Math.sqrt(0.5 + 25), cnt: 1000, sum: 5000 }];   // AC 0.7071 + DC 5
  chk(Math.abs(VC.windowRms(b).rms - 0.7071) < 0.01, 'windowRms가 DC를 제거한다', VC.windowRms(b).rms.toFixed(4));
  chk(VC.windowRms([{ rms: 2, cnt: 100 }]).rms === 2, 'SUM 없는 옛 버킷은 기존 동작 유지');
}

// ── 지름길 상한 — 창 맞춤 ─────────────────────────────────────────────────
/* 상한 성질은 같은 표본일 때만 성립 — ISO는 최근 1초, 판정값은 평가창 전체라 평가창 값으로는 마지막 1초 튐을 삼킴
   · isoSkippable은 구간 안 최대 초 버킷 기준(어떤 1초 창도 그보다 클 수 없음) */
{
  const Z0 = 1.12;
  chk(VC.isoSkippable([{ rms: 0.3, cnt: 1000 }, { rms: 0.4, cnt: 1000 }], Z0) === true,
    '전 구간이 경계 아래면 건너뛴다');
  chk(VC.isoSkippable([{ rms: 0.3, cnt: 1000 }, { rms: 3.0, cnt: 1000 }], Z0) === false,
    '한 초라도 경계를 넘으면 건너뛰지 않는다');
  chk(VC.isoSkippable([], Z0) === false && VC.isoSkippable(null, Z0) === false,
    '버킷이 없으면 상한을 못 세우므로 건너뛰지 않는다');
  chk(VC.isoSkippable([{ rms: 0.3, cnt: 1000 }], 0) === false, '경계가 없으면 건너뛰지 않는다');
  // 평가창 RMS는 경계 아래인데 그 안의 한 초는 위험 — 평가창(wide) 비교로는 놓치는 모양
  const spike = [];
  for (let i = 0; i < 9; i++) spike.push({ rms: 0.30, cnt: 1000 });
  spike.push({ rms: 3.0, cnt: 1000 });
  const wide = VC.windowRms(spike).rms;
  chk(wide < Z0 && VC.isoSkippable(spike, Z0) === false,
    '평가창은 양호인데 한 초가 튀면 계산한다', '평가창 ' + wide.toFixed(4) + ' · 최대 초 3.0');
}

// ── 샘플레이트 추정 — 표본 간격의 중앙값 ──────────────────────────────────
/* fs는 대역제한 여부(isoNeeded)·필터 차단주파수를 정함 — "초당 행 수"는 기록 밀도에 끌려감(간헐 캡처 과소·중복 적재 과대)
   · 간격 중앙값 사용: 갭은 정렬 끝으로 밀려 중앙값에 못 닿고, 중복은 간격 0이라 제외 */
{
  const DT = 39;                                  // 25.6 kHz ≈ 39 μs 간격
  const cont = (n, dt) => { const a = [1e15]; for (let i = 1; i < n; i++) a.push(a[i-1] + dt); return a; };
  chk(Math.abs(VC.fsFromTimes(cont(500, DT)) - 25641) < 2, '연속 표본 → 간격의 역수', String(VC.fsFromTimes(cont(500, DT))));
  chk(VC.fsFromTimes(cont(500, 1000)) === 1000, '1 kHz(1,000 μs 간격)도 그대로', String(VC.fsFromTimes(cont(500, 1000))));

  // 간헐 캡처 — 1초 캡처 6번 사이 60초 갭(갭 5개는 중앙값에 못 닿음)
  const burst = [];
  let t = 1e15;
  for (let b = 0; b < 6; b++) {
    for (let i = 0; i < 200; i++) { burst.push(t); t += DT; }
    t += 60e6;                                    // 60초 쉼
  }
  chk(Math.abs(VC.fsFromTimes(burst) - 25641) < 2, '간헐 캡처여도 갭에 끌려가지 않는다', String(VC.fsFromTimes(burst)));
  // 대조 — 같은 데이터를 "초당 행 수"로 세면 크게 과소
  const rows = burst.length, spanSec = (burst[burst.length-1] - burst[0]) / 1e6;
  chk(Math.round(rows / spanSec) < 100, '대조: 초당 행 수로 세면 100 Hz 아래로 무너진다',
    Math.round(rows / spanSec) + ' Hz');

  // 중복 적재 — 같은 시각 두 번(간격 0 제외로 두 배 안 됨)
  const dup = [];
  cont(300, DT).forEach((v) => { dup.push(v); dup.push(v); });
  chk(Math.abs(VC.fsFromTimes(dup) - 25641) < 2, '중복 적재에도 두 배로 뛰지 않는다', String(VC.fsFromTimes(dup)));

  chk(VC.fsFromTimes(cont(10, DT)) === 0 && VC.fsFromTimes([]) === 0 && VC.fsFromTimes(null) === 0,
    '근거가 얇으면 0 — 호출측이 옛 추정으로 물러난다');
}

// ── 대역제한이 필요한 샘플레이트 판별 ──────────────────────────────────────
chk(VC.isoNeeded(25600) === true, '25.6 kHz는 대역제한 필요 (Nyquist 12.8 kHz)');
chk(VC.isoNeeded(1000) === false, '1 kHz는 불필요 — Nyquist 500 Hz라 1 kHz 위가 없다');
chk(VC.isoNeeded(2000) === false, '2 kHz도 불필요 — Nyquist가 정확히 1000 Hz');
chk(VC.isoNeeded(0) === false && VC.isoNeeded(undefined) === false, '샘플레이트 불명이면 필터를 걸지 않는다');

// ── worstGrade — 넘어온 축 중 최악 + 등급 축(src) ──────────────────────────
{
  chk(VC.worstGrade(0, 0, 0).gi === 0, '전부 정상이면 양호');
  const a = VC.worstGrade(0, 1, 0);
  chk(a.gi === 1 && a.src === 'baseline', '존 양호 + 베이스라인 이탈 → 주의(베이스라인)', JSON.stringify(a));
  const b2 = VC.worstGrade(1, 1, 3);
  chk(b2.gi === 3 && b2.src === 'band', '대역이 가장 나쁘면 대역이 등급을 정한다', JSON.stringify(b2));
  const c = VC.worstGrade(2, 1, 1);
  chk(c.gi === 2 && c.src === 'iso', '존이 가장 나쁘면 존', JSON.stringify(c));
  chk(VC.worstGrade(0, 0, 2).gi === 2, 'ISO 양호여도 대역 위험이면 위험으로 표시');
}

// ── 상세·리포트와 감시가 같은 양 측정 ─────────────────────────────────────
/* 상세·리포트(FFT 블록평균 bandRmsAveraged)와 감시(시간영역 밴드패스 isoRms)는 같은 ISO 정의 — 두 구현 값 일치 확인 */
{
  const sig = add(tone(30, 2, N, FS), tone(150, 1, N, FS), tone(600, 0.5, N, FS), tone(4000, 3, N, FS));
  const rep = VC.bandRmsAveraged(sig, FS, 10, 1000, 8).rms;   // 상세·리포트
  const mon = VC.isoRms(sig, FS);                              // 감시
  const diff = Math.abs(mon / rep - 1);
  chk(diff < 0.05, '리포트(FFT 블록평균)와 감시(밴드패스) ISO 값이 5% 이내',
    rep.toFixed(4) + ' vs ' + mon.toFixed(4) + ' (' + (diff * 100).toFixed(2) + '%)');
  // 1 kHz 위 배제 — 4 kHz 성분이 들어와도 값 거의 불변
  const noHf = add(tone(30, 2, N, FS), tone(150, 1, N, FS), tone(600, 0.5, N, FS));
  chk(Math.abs(VC.isoRms(noHf, FS) / mon - 1) < 0.05, '1 kHz 위 성분이 ISO 값을 바꾸지 않는다',
    VC.isoRms(noHf, FS).toFixed(4) + ' vs ' + mon.toFixed(4));
}

// ── 임베드 자체 완결 ───────────────────────────────────────────────────────
/* 서버 TQL에 문자열로 삽입 — 바깥 이름 참조 금지
   · isoRms→bandpass→biquad 상호 이름 호출이라 개별 'var 이름 = <소스>'면 압축 후 죽음(named function expression 이름은 자기 안에서만 보임) */
{
  const src = VC.isoSrc();
  const sig = add(tone(100, 1, N, FS), tone(5000, 3, N, FS));
  const got = new Function(src + '\nreturn isoRms(arguments[0], arguments[1]);')(sig, FS);
  const want = VC.isoRms(sig, FS);
  chk(Math.abs(got - want) < 1e-12, '임베드본과 원본 isoRms 일치 (앱↔서버 드리프트 0)', got.toFixed(6));
  chk(new Function(src + '\nreturn isoNeeded(25600);')() === true, '임베드본 isoNeeded 동작');

  /* 압축 모의 — 함수 소스 안의 이름만 일괄 변경(미니파이어 흉내), 조립 코드의 리터럴('var bandpass =')은 유지
     · 개발 소스로는 이름이 그대로라 이 결함이 드러나지 않음 */
  const MAP = [['biquad', 'q1'], ['bandpass', 'q2'], ['isoRms', 'q3'], ['isoNeeded', 'q4']];
  let msrc = [VC.biquad, VC.bandpass, VC.isoRms, VC.isoNeeded].map((fn) => fn.toString()).join('\n');
  for (const [from, to] of MAP) msrc = msrc.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
  const M = new Function(msrc + '\nreturn [q1,q2,q3,q4];')();
  chk(M.every((fn, i) => fn.name === MAP[i][1]), '압축 모의로 이름이 바뀐 함수 생성', M.map((fn) => fn.name).join(','));

  const runIso = (code) => {
    try { return { v: new Function(code + '\nreturn isoRms(arguments[0], arguments[1]);')(sig, FS) }; }
    catch (e) { return { err: e.message }; }
  };
  // 모의 유효성 먼저 확인 — var 나열 방식은 반드시 실패해야 함
  const naive = runIso(MAP.map(([orig], i) => 'var ' + orig + ' = ' + M[i] + ';').join('\n'));
  chk(!!naive.err, '모의 유효성: var 나열 방식은 압축 시 깨진다', naive.err || '깨지지 않음(모의가 무력)');
  const good = runIso(VC.embedSrc(M, { isoRms: M[2], isoNeeded: M[3] }));
  chk(!good.err && Math.abs(good.v - want) < 1e-12,
    '이름이 압축돼도 임베드본이 동작 (상호참조가 한 스코프에 있다)', good.err || good.v.toFixed(6));
}

// ── 원본 단위가 달라도 ISO 축은 같은 규격 경계 ─────────────────────────────
/* ISO 10816은 속도(mm/s) 규격 — 가속도·변위 신호도 속도로 환산해 같은 경계로 판정(단위 설정과 무관한 등급) */
{
  const ISO_II = VC.ISO_ZONES.II;              // 1.12 / 2.8 / 7.1 mm/s
  const fr = 30;                               // 1800 RPM
  // 60 Hz 순수 톤 — 속도 진폭을 알고 가속도·변위로 변환
  const vAmp = 4.0;                            // mm/s peak → RMS 2.83 (주의 존)
  const vel = tone(60, vAmp, N, FS);
  const wantV = rms(vel);

  // 속도 → 가속도(미분)·변위(적분) 후 다시 속도로 돌려 ISO 판정
  const acc = VC.convertDomain(vel, FS, 'mm/s', 'g', fr);
  const dis = VC.convertDomain(vel, FS, 'mm/s', 'μm', fr);
  const backFromAcc = VC.isoRms(VC.convertDomain(acc, FS, 'g', 'mm/s', fr), FS);
  const backFromDis = VC.isoRms(VC.convertDomain(dis, FS, 'μm', 'mm/s', fr), FS);

  chk(Math.abs(backFromAcc - wantV) / wantV < 0.02,
    '가속도로 받아 적분해도 원래 속도 RMS로 돌아온다', backFromAcc.toFixed(4) + ' vs ' + wantV.toFixed(4));
  chk(Math.abs(backFromDis - wantV) / wantV < 0.02,
    '변위로 받아 미분해도 원래 속도 RMS로 돌아온다', backFromDis.toFixed(4) + ' vs ' + wantV.toFixed(4));
  chk(VC.gradeFor(backFromAcc, ISO_II) === VC.gradeFor(wantV, ISO_II)
    && VC.gradeFor(backFromDis, ISO_II) === VC.gradeFor(wantV, ISO_II),
    '세 단위 모두 같은 ISO 등급', ['mm/s', 'g', 'μm'].map((u, i) =>
      u + '=' + VC.gradeFor([wantV, backFromAcc, backFromDis][i], ISO_II)).join(' '));

  // 대조 — 원본 단위 임의 존에 그대로 대면 등급이 갈림
  const gZones = VC.zonesFor('g', 'II');
  chk(VC.gradeFor(rms(acc), gZones) !== VC.gradeFor(wantV, ISO_II),
    '변환 없이 g 임의 존에 대면 등급이 어긋난다(통일이 필요한 이유)',
    'g존=' + VC.gradeFor(rms(acc), gZones) + ' vs ISO=' + VC.gradeFor(wantV, ISO_II));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
