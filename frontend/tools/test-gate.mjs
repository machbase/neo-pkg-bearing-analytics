/* 계측 게이트 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   게이트는 "들어온 파형이 기계 신호인가, 계측 문제인가"를 판별한다. 이게 판정 앞에 없으면
   커넥터 접촉이 "심각"으로 나가고(값 과대) 클리핑은 조용히 지나간다(값 과소) — 틀리는 방향이
   일정하지도 않아 어느 쪽으로도 못 믿는다.

   판별 순서가 중요하다: 데이터 → 두절 확인 → 게이트 → 진동 판정.
   두절이면 볼 파형이 없으므로 게이트를 건너뛰어야 한다(안 그러면 "샘플 부족"으로 오판). */
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

  /* 플랫라인 — 죽은 센서가 상수를 뱉는 상태. 값이 낮아 "정지"처럼 보이지만 뜻이 정반대다:
     정지는 설비가 선 것이고(운전 재개되면 판정도 재개), 플랫라인은 그 태그가 무기한 무감시다. */
  const flat = VC.gateFromBuckets(bk(2.4, 2400, 2.4, 2.4), 0.00001);
  chk(flat && flat.key === 'flatline', '상수값은 플랫라인으로 잡는다', flat && flat.detail);
  chk(flat && flat.gi === 2, '플랫라인은 위험 등급 — 감시가 통째로 죽은 상태', String(flat && flat.gi));

  // 정지: 값은 작지만 흔들린다 → 게이트 아님. 이걸 계측 이상으로 내면 정지마다 알람이 난다.
  chk(VC.gateFromBuckets(bk(0.05, 0, -0.15, 0.15), 0.05) === null, '정지(작지만 흔들림)는 게이트가 아니다');
  chk(VC.gateFromBuckets(bk(2.0, 0, -3, 3), 2.0) === null, '정상 파형은 통과');

  // DC 드리프트 — 기준선이 0에서 크게 벗어남
  const dc = VC.gateFromBuckets(bk(5.02, 5000, 4, 6), 0.5);
  chk(dc && dc.key === 'dc', 'DC 드리프트를 잡는다', dc && dc.detail);

  chk(VC.gateFromBuckets([], 1) === null && VC.gateFromBuckets(null, 1) === null,
    '버킷이 없으면 판단하지 않는다 — 두절 태그를 계측 이상으로 오판하면 안 된다');
}

// ── 정지 판별의 참조값은 판정값과 같은 양이어야 한다 ──────────────────────
/* 버킷 rms는 DC를 포함하고 판정값(windowRms)은 AC다. 둘을 섞어 비교하면 오프셋이 있는 센서가
   운전 중에도 항상 정지로 읽힌다 — 실측으로 DC 9.0인 태그가 정지 배지를 달고 있었다. */
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

  /* 단발 스파이크는 게이트가 아니다 — 커넥터 접촉일 수도, 저속 기계의 초기 결함일 수도 있다.
     정도의 문제라 경계가 임의적인데 판정까지 막으면 진짜 결함을 계측 문제로 오해한다.
     대신 충격성 근거로 붙여 사람이 판단할 재료를 준다. */
  const spike = sine(0.05); spike[1000] = 20;
  chk(VC.gateFromRaw(spike, FS) === null, '단발 스파이크는 판정을 막지 않는다', String(VC.gateFromRaw(spike, FS)));
  const ev = VC.impactEvidence(spike, FS);
  chk(ev && ev.kind === '충격성', '대신 충격성 근거로 남는다', ev && ev.text);
  chk(ev && /마운팅·커넥터/.test(ev.text), 'Crest 15 초과면 계측 확인을 권한다(막지는 않는다)');

  // 클리핑 — 측정범위 초과. 진폭이 과소 표시되므로 게이트가 없으면 조용히 놓친다.
  const clip = sine(2).map((v) => Math.max(-1, Math.min(1, v)));
  const gc = VC.gateFromRaw(clip, FS);
  chk(gc && gc.key === 'clip', '클리핑을 잡는다', gc && gc.detail);

  // 플랫라인은 원본 쪽에서도 같은 결론이어야 한다
  const flat = new Array(N).fill(2.4);
  const gf = VC.gateFromRaw(flat, FS);
  chk(gf && gf.key === 'flatline' && gf.gi === 2, '원본에서도 플랫라인은 위험', gf && gf.key);
}

// ── 충격성 근거 — 임펄스와 광대역 잡음을 가른다 ───────────────────────────
/* 대역 에너지가 올랐을 때 원인이 임펄스(베어링·기어)인지 넓게 퍼진 잡음(유동·부착 이완)인지
   RMS 계열로는 구분이 안 된다. 이 값이 그걸 가르는 유일한 재료다. */
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

// ── 스파크라인이 변동 없는 신호를 부풀리지 않는다 ─────────────────────────
/* 스파크는 최소~최대를 높이에 꽉 채우므로, 상수 출력(죽은 센서)의 1e-7 잡음이 전체 진폭으로
   늘어나 살아 있는 것처럼 보였다. 배지는 "계측 이상"인데 선은 펄떡이는 모순이 생긴다. */
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
  // 정지는 값이 작을 뿐 변동은 있다 — 이것까지 평평해지면 정지와 센서 사망이 화면에서 같아진다
  const idle = []; for (let i = 0; i < 36; i++) idle.push(0.09 + 0.02 * Math.sin(i));
  chk(amp(idle) > 20, '정지(작지만 변동 있음)는 평평하게 만들지 않는다', amp(idle).toFixed(0) + 'px');
}

// ── 원본 게이트가 판정 상태로 이월되고, 오래되면 스스로 무효가 되는가 ────
/* 서버 스크립트는 매 실행 새로 시작하므로 GRAW는 그 틱에 원본을 받았을 때만 채워진다.
   이월이 없으면 캐시를 쓴 틱마다 "이상 없음"이 되어 지속 판정(1분)이 영영 안 찬다.
   반대로 이월만 하고 유효기간이 없으면, 이상이 멎어 원본을 다시 볼 기회가 없을 때
   딱지가 영구히 붙는다(앱 쪽에서 실제로 그랬다). 둘 다 필요하다. */
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

  // 앱 쪽 — 유효기간이 지난 판정은 없는 것으로 본다
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
/* gateFromRaw → signalQuality → kurtosis로 서로를 이름으로 부른다. 각각 'var 이름 = <소스>'로
   붙이면 압축 후 죽는다. 실제로 상수 하나(GATE_FLAT_RATIO)를 바깥에 두는 실수를 validateSpec이
   먼저 잡았다 — 그 회귀를 여기서 막는다. */
{
  const src = VC.gateSrc();
  const call = (code) => new Function(src + '\n' + code)();
  const flat = call('return gateFromBuckets([{cnt:1000,rms:2.4,sum:2400,mn:2.4,mx:2.4}], 0.00001);');
  chk(flat && flat.key === 'flatline', '임베드본 gateFromBuckets 동작', flat && flat.key);
  const tick = call('return sensorTick(null, {key:"x",label:"L",detail:"D",gi:1}, 0, {escHold:0,recHold:0});');
  chk(tick && tick.events.length === 1, '임베드본 sensorTick 동작', JSON.stringify(tick && tick.events));
  const raw = call('var x=[]; for(var i=0;i<8192;i++) x.push(Math.sin(i)); x[100]=50; return gateFromRaw(x, 25600);');
  chk(raw !== undefined, '임베드본 gateFromRaw 동작 (signalQuality·kurtosis 상호참조 포함)', raw && raw.key);

  // 압축 모의 — 이름을 바꿔도 동작해야 한다
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
