/* 계측 게이트 — 파형이 기계 신호인지 계측 문제(플랫라인·DC·클리핑)인지 판별
   · 롤업·원본 게이트·충격성 근거·상태기(escHold/recHold)·스파크라인 평탄화·서버 이월/유효기간·임베드 자체 완결
   · 판별 순서: 데이터 → 두절 확인 → 게이트 → 진동 판정(두절이면 게이트 건너뜀)
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── 롤업만으로 보는 게이트 (조회 0회) ──────────────────────────────────────
{
  const bk = (rms, sum, mn, mx) => [{ cnt: 1000, rms: rms, sum: sum, mn: mn, mx: mx }];

  /* 플랫라인 — 죽은 센서의 상수 출력(정지처럼 보이나 무기한 무감시 상태) */
  const flat = VC.gateFromBuckets(bk(2.4, 2400, 2.4, 2.4), 0.00001);
  chk(flat && flat.key === 'flatline', '상수값은 플랫라인으로 잡는다', flat && flat.detail);
  chk(flat && flat.gi === 2, '플랫라인은 위험 등급 — 감시가 통째로 죽은 상태', String(flat && flat.gi));

  // 정지: 값은 작지만 흔들림 → 게이트 아님(계측 이상이면 정지마다 알람)
  chk(VC.gateFromBuckets(bk(0.05, 0, -0.15, 0.15), 0.05) === null, '정지(작지만 흔들림)는 게이트가 아니다');
  chk(VC.gateFromBuckets(bk(2.0, 0, -3, 3), 2.0) === null, '정상 파형은 통과');

  /* DC — 일정한 DC(MEMS 중력축·근접센서 갭)는 판정값에 무관해 통과, 1초 평균이 흔들릴 때만 차단
     버킷: 평균 m, 버킷 안 σ ac → rms = √(m²+ac²) */
  const mkB = (means, ac) => means.map((m, i) => ({ ms: 1700000000000 + i * 1000, cnt: 1000, sum: m * 1000,
    rms: Math.sqrt(m * m + ac * ac), mn: m - 3 * ac, mx: m + 3 * ac }));
  chk(VC.gateFromBuckets(mkB(Array(10).fill(1.0), 0.05), 0.05, 30) === null,
    '일정한 DC(1 g 중력축 — 진동 σ의 20배)는 막지 않는다(예전: 영구 계측 이상·판정 동결)');
  const alt = (a) => Array.from({ length: 10 }, (_, i) => 1.0 + (i % 2 ? a : -a));   // 평균 흔들림 σ_m = a
  const dc = VC.gateFromBuckets(mkB(alt(0.03), 0.05), 0.06, 30);
  chk(dc && dc.key === 'dc', '1초 평균이 진동 σ의 0.6배로 흔들리면 DC 드리프트로 막는다', dc && dc.detail);
  chk(VC.gateFromBuckets(mkB(alt(0.02), 0.05), 0.055, 30) === null, '0.4배는 통과(경계 0.5배)');
  chk(VC.gateFromBuckets(mkB(alt(0.03), 0.05), 0.06, 5) === null, '버킷당 10회전 미만(저속기)은 판단 안 함 — 실제 진동이 1초 평균을 흔듦');
  chk(VC.gateFromBuckets(mkB(alt(0.03), 0.05), 0.06, 0) === null, '회전수를 모르면 판단 안 함');
  chk(VC.gateFromBuckets(mkB(alt(0.03), 0.05).slice(0, 2), 0.06, 30) === null, '버킷 3개 미만은 판단 안 함');
  const slow = mkB(alt(0.03), 0.05).map((b) => Object.assign({}, b, { cnt: 60, sum: b.sum / 1000 * 60 }));   // 초당 60샘플 = 30 Hz에 회전당 2샘플
  chk(VC.gateFromBuckets(slow, 0.06, 30) === null, '회전당 4샘플 미만(느린 값 태그)은 판단 안 함 — 버킷 안 σ가 진동을 못 담음');

  chk(VC.gateFromBuckets([], 1) === null && VC.gateFromBuckets(null, 1) === null,
    '버킷이 없으면 판단하지 않는다 — 두절 태그를 계측 이상으로 오판하면 안 된다');
}

// ── 서버 감시도 회전수를 넘김 — 없으면 DC 드리프트를 영영 안 봄 ──────────────
{
  const Monitor = (await import('../../cgi-bin/monitor/monitor.js')).default;
  const tql = Monitor.buildMonitorTql({ judgeSrc: 'function judgeTick(){}', tblPrefix: 'P.', keyPrefix: 'JOY:',
    tags: [{ tbl: 'T', tag: 'A', zones: [1, 2, 3], rpm: 1800 }], cfg: {} });
  const line = tql.split('\n').find((l) => /var bad = gateFromBuckets\(/.test(l));
  let got = null;
  new Function('gateFromBuckets', 'WVAL', 'key', 'wide', 't', 'graw', line + '; return bad;')(
    (b, w, fr) => { got = fr; return null; }, { k: [] }, 'k', 1, { rpm: 1800 }, null);
  chk(got === 30, '서버 감시 게이트에 회전 Hz 전달(1800 rpm → 30)', String(got));
}

// ── 원본 파형의 DC — 상세분석(signalQuality) ─────────────────────────────
{
  const FS = 2560, N = FS * 4, fr = 30;
  const wave = (off) => Array.from({ length: N }, (_, i) => off(i) + 0.05 * Math.sin(2 * Math.PI * fr * i / FS));
  const steady = VC.signalQuality(wave(() => 1.0), FS, fr);
  const info = steady.issues.find((x) => x.key === 'dcoff');
  chk(info && info.info && steady.ok && !steady.gate, '일정한 DC는 참고 사유(ok·판정 보류 아님)', info && info.detail);
  const drift = VC.signalQuality(wave((i) => 1.0 + 0.04 * Math.sign(Math.sin(2 * Math.PI * i / (FS * 2)))), FS, fr);
  chk(drift.issues.some((x) => x.key === 'dc') && drift.gate && !drift.ok, '구간 평균이 흔들리면 DC 드리프트 — 판정 보류');
  const noFr = VC.signalQuality(wave((i) => 1.0 + 0.04 * Math.sign(Math.sin(2 * Math.PI * i / (FS * 2)))), FS, 0);
  chk(!noFr.issues.some((x) => x.key === 'dc'), '회전수 모르면 드리프트 판단 안 함(감시 게이트와 같은 규칙)');
}

// ── 정지 판별 참조값은 판정값과 같은 양(AC) ─────────────────────────────────
/* 버킷 rms는 DC 포함, 판정값(windowRms)은 AC — 섞으면 오프셋 있는 센서가 운전 중에도 정지로 읽힘 */
{
  const bk = [{ cnt: 2048, rms: 9.029, sum: 9.0 * 2048, mn: 8.0, mx: 10.0 }];   // DC 9.0 + AC 0.72
  const ac = VC.acVals(bk);
  chk(Math.abs(ac[0] - 0.72) < 0.01, '버킷에서 AC 성분만 뽑는다', ac[0].toFixed(3));
  chk(VC.isRunning(0.72, VC.runRef(null, ac)) === true, 'AC끼리 비교하면 운전으로 본다');
  chk(VC.isRunning(0.72, VC.runRef(null, [9.029])) === false,
    '(대조) DC 포함 값과 비교하면 정지로 오판한다 — 이 조합이 실제 버그였다');
  chk(VC.acVals([{ cnt: 10, rms: 2 }])[0] === 2, 'SUM이 없으면 rms를 그대로 쓴다(옛 버킷)');
}

// ── 원본이 있어야 보는 게이트 ──────────────────────────────────────────────
{
  const FS = 25600, N = 8192;
  const sine = (amp) => { const x = new Array(N); for (let i = 0; i < N; i++) x[i] = amp * Math.sin(2 * Math.PI * 100 * i / FS); return x; };

  chk(VC.gateFromRaw(sine(1), FS) === null, '정상 정현파는 통과');

  /* 단발 스파이크는 게이트 아님(커넥터 접촉·저속 기계 초기 결함 구분 불가) — 충격성 근거로만 표시 */
  const spike = sine(0.05); spike[1000] = 20;
  chk(VC.gateFromRaw(spike, FS) === null, '단발 스파이크는 판정을 막지 않는다', String(VC.gateFromRaw(spike, FS)));
  const ev = VC.impactEvidence(spike, FS);
  chk(ev && ev.kind === '충격성', '대신 충격성 근거로 남는다', ev && ev.text);
  chk(ev && /마운팅·커넥터/.test(ev.text), 'Crest 15 초과면 계측 확인을 권한다(막지는 않는다)');

  // 클리핑 — 측정범위 초과(진폭 과소 표시)
  const clip = sine(2).map((v) => Math.max(-1, Math.min(1, v)));
  const gc = VC.gateFromRaw(clip, FS);
  chk(gc && gc.key === 'clip', '클리핑을 잡는다', gc && gc.detail);

  // 원본 쪽 플랫라인도 같은 결론
  const flat = new Array(N).fill(2.4);
  const gf = VC.gateFromRaw(flat, FS);
  chk(gf && gf.key === 'flatline' && gf.gi === 2, '원본에서도 플랫라인은 위험', gf && gf.key);
}

// ── 충격성 근거 — 임펄스와 광대역 잡음 구분 ─────────────────────────────────
/* 대역 에너지 상승 원인이 임펄스(베어링·기어)인지 광대역 잡음(유동·부착 이완)인지 RMS로는 구분 불가 */
{
  const FS2 = 2048, N2 = 2048;
  const mk = (f) => { const x = []; for (let i = 0; i < N2; i++) x.push(f(i / FS2, i)); return x; };
  const clean = VC.impactEvidence(mk((t) => Math.sin(2 * Math.PI * 100 * t)), FS2);
  chk(clean && clean.kind === '광대역', '정현파는 광대역', clean && clean.text);
  const imp = VC.impactEvidence(mk((t, i) => Math.sin(2 * Math.PI * 100 * t) * 0.1 + (i % 256 === 3 ? 5 : 0)), FS2);
  chk(imp && imp.kind === '충격성', '반복 임펄스는 충격성', imp && imp.text);
  chk(VC.impactEvidence([1, 2, 3], FS2) === null, '표본이 적으면 판단하지 않는다');
  chk(VC.impactEvidence(new Array(2048).fill(2.4), FS2) === null, '변동이 없으면 판단하지 않는다(플랫라인은 게이트가 본다)');
}

// ── 상태기: 진입 escHold · 해제 recHold ────────────────────────────────────
{
  const cfg = { escHold: 60000, recHold: 300000 };
  const bad = { key: 'spike', label: '단발 스파이크', detail: 'Crest 30', gi: 1 };
  let st = null;
  const run = (t, b) => { const r = VC.sensorTick(st, b, t, cfg); st = r.next; return r; };

  chk(run(0, bad).events.length === 0, '진입 즉시는 알리지 않는다 — 단발 스파이크 한 번은 잡음');
  chk(run(30000, bad).events.length === 0, '30초로는 부족');
  const on = run(60000, bad);
  chk(on.events.length === 1 && on.events[0].etype === 'sensor_fault', '1분 유지되면 계측 이상 1건', JSON.stringify(on.events[0]));
  chk(run(70000, bad).events.length === 0, '유지 중에는 중복 발화 없음');
  chk(run(80000, null).events.length === 0, '정상 복귀 직후에는 아직 해제하지 않는다');
  const off = run(400000, null);
  chk(off.events.length === 1 && off.events[0].etype === 'sensor_ok', 'recHold 지나면 계측 복귀 1건', JSON.stringify(off.events[0]));
  chk(off.on === false, '해제 후 상태 종료');
}

// ── 스파크라인은 변동 없는 신호를 부풀리지 않음 ─────────────────────────────
/* 스파크는 최소~최대를 높이에 채움 — 상수 출력의 미세 잡음이 전체 진폭으로 늘어나지 않게 평탄 처리 */
{
  const CH = (await import('../../cgi-bin/chart/chart.js')).default;
  const amp = (v) => {
    const ys = CH.sparkPath(v, 132, 40, 3).line.split(' ').map((s2) => +s2.split(',')[1]);
    return Math.max(...ys) - Math.min(...ys);
  };
  const flat = []; for (let i = 0; i < 36; i++) flat.push(2.4 + 1e-7 * (Math.random() * 2 - 1));
  chk(amp(flat) === 0, '상수 출력은 평평하게 그린다', amp(flat) + 'px');
  chk(amp(new Array(36).fill(0)) === 0, '전부 0도 평평하게');
  const real = []; for (let i = 0; i < 36; i++) real.push(1.8 + 0.3 * Math.sin(i));
  chk(amp(real) > 20, '정상 신호는 그대로 채워 그린다', amp(real).toFixed(0) + 'px');
  // 정지는 작아도 변동 있음 — 평탄 처리 대상 아님(센서 사망과 구분)
  const idle = []; for (let i = 0; i < 36; i++) idle.push(0.09 + 0.02 * Math.sin(i));
  chk(amp(idle) > 20, '정지(작지만 변동 있음)는 평평하게 만들지 않는다', amp(idle).toFixed(0) + 'px');
}

// ── 원본 게이트의 판정 상태 이월·유효기간 ───────────────────────────────────
/* 서버 스크립트는 매 실행 새로 시작 — GRAW는 원본을 받은 틱에만 채워짐
   · 이월 없으면 지속 판정이 안 참, 유효기간 없으면 딱지가 영구히 붙음 → 둘 다 필요 */
{
  const Mon = (await import('../../cgi-bin/monitor/monitor.js')).default;
  const tql = Mon.buildMonitorTql({
    judgeSrc: 'function(){return{next:{},events:[]}}', limitSrc: VC.baselineLimit.toString(),
    winSrc: VC.windowRms.toString(), bandSrc: VC.bandJudgeSrc(), runSrc: VC.isRunning.toString(),
    refSrc: VC.runRef.toString(), isoSrc: VC.isoSrc(), gateSrc: VC.gateSrc(), tickMs: 10000,
    tags: [{ tbl: 'T', tag: 'A', fs: 25600, zones: [1.12, 2.8, 7.1] }], cfg: {},
  });
  const has = (needle) => tql.indexOf(needle) >= 0;
  chk(has('var graw = GRAW[key] || null;'), '이번 틱에 본 원본 판정을 먼저 쓴다');
  chk(has('if(!graw && prev && prev.gr &&'), '못 본 틱은 직전 판정을 물려받는다');
  chk(has('if(_iso.fresh){ if(GRAW[key]) res.next.gr='), '원본을 실제로 본 틱에만 갱신한다');
  chk(/\(now-\(prev\.gr\.at\|\|0\)\) < \d+/.test(tql), '물려받을 때 유효기간을 본다');

  // 앱 쪽 — 유효기간 지난 판정은 무효
  const { App } = await import('../src/app.js');
  const app = new App({ seed: 1, equipmentCount: 1 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._scheduleDraw = function () {};
  const G = { key: 'spike', label: '단발 스파이크', detail: 'Crest 30', gi: 1 };
  app._gateRaw = { 'T:A': { g: G, at: Date.now() } };
  chk(app._rawGate('T:A') === G, '갓 본 판정은 그대로 쓴다');
  app._gateRaw = { 'T:A': { g: G, at: Date.now() - 61000 } };
  chk(app._rawGate('T:A') === null, '유효기간(60초)이 지나면 딱지가 떨어진다');
  chk(app._gateRaw['T:A'] === undefined, '지난 판정은 지워 둔다 — 다시 볼 때까지 남기지 않는다');
  chk(app._rawGate('없는키') === null, '없는 키는 null');
}

// ── 임베드 자체 완결 (서버 TQL) ────────────────────────────────────────────
/* gateFromRaw → signalQuality → kurtosis 상호 이름 호출 — 개별 'var 이름 = <소스>'로 붙이면 압축 후 죽음
   · gateSrc() 임베드본의 자체 완결(상수 포함) 확인 */
{
  const src = VC.gateSrc();
  const call = (code) => new Function(src + '\n' + code)();
  const flat = call('return gateFromBuckets([{cnt:1000,rms:2.4,sum:2400,mn:2.4,mx:2.4}], 0.00001);');
  chk(flat && flat.key === 'flatline', '임베드본 gateFromBuckets 동작', flat && flat.key);
  const tick = call('return sensorTick(null, {key:"x",label:"L",detail:"D",gi:1}, 0, {escHold:0,recHold:0});');
  chk(tick && tick.events.length === 1, '임베드본 sensorTick 동작', JSON.stringify(tick && tick.events));
  const raw = call('var x=[]; for(var i=0;i<8192;i++) x.push(Math.sin(i)); x[100]=50; return gateFromRaw(x, 25600);');
  chk(raw !== undefined, '임베드본 gateFromRaw 동작 (signalQuality·kurtosis 상호참조 포함)', raw && raw.key);

  // 압축 모의 — 이름을 바꿔도 동작
  const MAP = [['kurtosis', 'z1'], ['signalQuality', 'z2'], ['gateFromBuckets', 'z3'], ['gateFromRaw', 'z4'], ['sensorTick', 'z5']];
  let msrc = [VC.kurtosis, VC.signalQuality, VC.gateFromBuckets, VC.gateFromRaw, VC.sensorTick].map((fn) => fn.toString()).join('\n');
  for (const [from, to] of MAP) msrc = msrc.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
  const M = new Function(msrc + '\nreturn [z1,z2,z3,z4,z5];')();
  const mini = VC.embedSrc(M, { gateFromBuckets: M[2], gateFromRaw: M[3], sensorTick: M[4] });
  let ok = false, err = '';
  try {
    const r = new Function(mini + '\nreturn gateFromRaw(arguments[0], 25600);')(new Array(8192).fill(2.4));
    ok = !!(r && r.key === 'flatline');
  } catch (e) { err = e.message; }
  chk(ok, '이름이 압축돼도 임베드본이 동작', err);
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
