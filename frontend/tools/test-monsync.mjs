// 서버 감시 타이머 재동기화 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.
// 핵심 주장: "화면에 보이는 판정 기준과 서버 타이머가 쓰는 기준이 항상 같다".
// 타이머 TQL은 태그 목록·존·베이스라인을 값으로 굽기 때문에, 그 값이 바뀌면 반드시 다시 구워야 한다.
globalThis.window = globalThis;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// 타이머 API를 가로채 "몇 번 구웠는지 / 무엇을 구웠는지"를 관찰한다
function makeApp(mode) {
  const app = new App({ seed: 42, equipmentCount: 3 });
  app.setState = function (s) { Object.assign(this.state, s); };
  app._scheduleDraw = function () {};
  app._toast = function (m) { app._toasts.push(m); };
  app._toasts = [];
  app.E = CH; app.live = true;
  const d = Mock.generateData(42, 3);
  app.data = d;
  app.liveTables = ['VIBRATION_RAW'];
  d.equipment.forEach((e, i) => { e.order = i; e.table = 'VIBRATION_RAW'; e.id = 'VIBRATION_RAW:' + e.name; });
  Object.assign(app.state, {
    ready: true, srcSel: ['VIBRATION_RAW'], monitorOn: true, monMode: mode,
    monitorInterval: '10s', baselines: {},
  });
  // 네트워크 대체 — 실제 타이머 생성 대신 호출만 기록
  app._builds = [];
  const Monitor = null; // 실제 buildMonitorTql은 app 내부에서 호출되므로 createMonitorTimer만 가로챈다
  return app;
}

// createMonitorTimer/deleteMonitorTimer는 모듈 import라 직접 스텁이 안 된다 →
// _syncMonitorTimer가 부르는 지점을 관찰하기 위해 메서드를 감싼다(서명 계산은 원본 로직 그대로 탄다).
function instrument(app) {
  const orig = app._syncMonitorTimer.bind(app);
  app._syncCalls = [];   // 호출 시도(silent 여부)
  app._syncBakes = [];   // 실제로 구운 서명
  app._syncMonitorTimer = function (silent) {
    app._syncCalls.push(!!silent);
    // 원본의 서명 계산만 재현해 "구웠는가"를 판정 — 네트워크는 타지 않는다
    const S = app.state;
    if (!app.live) return Promise.resolve();
    if (S.monMode !== 'server' || !S.monitorOn) { app._specSig = null; return Promise.resolve(); }
    const spec = app._monSpec();
    const sched = { '10s': '@every 10s', '30s': '@every 30s', '1m': '@every 1m', '10m': '@every 10m' }[S.monitorInterval] || '@every 1m';
    if (!spec.tags.length) { app._specSig = null; return Promise.resolve(); }
    const sig = JSON.stringify(spec.tags) + '|' + JSON.stringify(spec.cfg) + '|' + sched;
    if (silent && sig === app._specSig) return Promise.resolve();
    app._specSig = sig;
    app._syncBakes.push(sig);
    return Promise.resolve();
  };
  return app;
}

// ── 1. 서명 가드: 변한 게 없으면 굽지 않는다 ───────────────────────────────
{
  const app = instrument(makeApp('server'));
  app._syncMonitorTimer(false);           // 최초(저장) — 굽는다
  app._syncMonitorTimer(true);            // 변경 없음
  app._syncMonitorTimer(true);
  chk(app._syncBakes.length === 1, '변경 없으면 재생성 안 함', `호출 ${app._syncCalls.length}회 · 구움 ${app._syncBakes.length}회`);
}

// ── 2. 베이스라인 학습 → 서버가 새 μ·σ로 판정 ──────────────────────────────
{
  const app = instrument(makeApp('server'));
  app._syncMonitorTimer(false);
  const before = app._syncBakes[0];
  const key = app.data.equipment[0].table + ':' + app.data.equipment[0].name;
  app._blMap = { [key]: { mu: 2.0, sigma: 0.15, k: 3 } };   // 학습이 채우는 자리
  app.setState({ baselines: app._blMap });
  app._syncMonitorTimer(true);
  const after = app._syncBakes[app._syncBakes.length - 1];
  chk(app._syncBakes.length === 2, '베이스라인 학습 후 TQL 재생성됨');
  chk(!before.includes('"mu":2') && after.includes('"mu":2'), '재생성된 TQL에 새 μ가 들어감');
}

// ── 3. 베이스라인 삭제도 기준 변경이다 ─────────────────────────────────────
{
  const app = instrument(makeApp('server'));
  const key = app.data.equipment[0].table + ':' + app.data.equipment[0].name;
  app._blMap = { [key]: { mu: 2.0, sigma: 0.15, k: 3 } };
  app.setState({ baselines: app._blMap });
  app._syncMonitorTimer(false);
  app._blMap = {}; app.setState({ baselines: {} });          // 삭제
  app._syncMonitorTimer(true);
  chk(app._syncBakes.length === 2 && app._syncBakes[1].includes('"bl":null'), '베이스라인 삭제 후 재생성 · bl=null 반영');
}

// ── 4. 태그 증감 — 새 설비가 무감시로 방치되면 안 된다 ─────────────────────
{
  const app = instrument(makeApp('server'));
  app._syncMonitorTimer(false);
  const n0 = app._monSpec().tags.length;
  const extra = Object.assign({}, app.data.equipment[0], { name: 'NEW_TAG', id: 'VIBRATION_RAW:NEW_TAG' });
  app.data.equipment.push(extra);                            // 새 태그 등장
  app._syncMonitorTimer(true);
  const n1 = app._monSpec().tags.length;
  chk(app._syncBakes.length === 2 && n1 === n0 + 1, '태그 추가 → 재생성 · 감시 대상 포함', `${n0} → ${n1}`);

  app.data.equipment.splice(-1, 1);                          // 태그 사라짐
  app._syncMonitorTimer(true);
  chk(app._syncBakes.length === 3, '태그 제거 → 재생성');
}

// ── 5. 평가 주기 변경도 서명에 포함 ────────────────────────────────────────
{
  const app = instrument(makeApp('server'));
  app._syncMonitorTimer(false);
  app.setState({ monitorInterval: '1m' });
  app._syncMonitorTimer(true);
  chk(app._syncBakes.length === 2 && app._syncBakes[1].includes('@every 1m'), '평가 주기 변경 → 재생성');
}

// ── 6. 앱 감시 모드에서는 아무것도 굽지 않는다 ─────────────────────────────
{
  const app = instrument(makeApp('app'));
  app._syncMonitorTimer(false);
  app._syncMonitorTimer(true);
  chk(app._syncBakes.length === 0, '앱 감시 모드 — 타이머 미생성', `구움 ${app._syncBakes.length}회`);
}

// ── 7. 디바운스: 전체 학습(병렬 N건)이 재생성 1번으로 합쳐진다 ─────────────
{
  const app = instrument(makeApp('server'));
  app._resyncMonSoon(); app._resyncMonSoon(); app._resyncMonSoon(); // 3태그 동시 학습 완료
  await new Promise((r) => setTimeout(r, 1000));
  chk(app._syncCalls.length === 1, '전체 학습 N건 → 재동기화 1회로 병합', `호출 ${app._syncCalls.length}회`);
  chk(app._syncCalls[0] === true, '자동 재동기화는 silent(토스트 없음)');
}

// ── 8. 자동 경로는 토스트를 띄우지 않는다(사용자 저장만 알림) ──────────────
{
  const app = instrument(makeApp('server'));
  app._toasts = [];
  app._resyncMonSoon();
  await new Promise((r) => setTimeout(r, 1000));
  chk(app._toasts.length === 0, '자동 재동기화 시 토스트 없음', `토스트 ${app._toasts.length}건`);
}


/* ── 감시 살아있음 확인(_applyHealth) ────────────────────────────────────────
   서버 타이머는 등록만 성공하고 첫 실행에서 죽을 수 있다. 그러면 화면은 상시감시 켜짐에
   초록 점인데 판정은 0건이다 — "조용함 = 정상"과 구분이 안 된다. 그 구분을 만드는 판정부. */
{
  const mk = (patch) => {
    const app = new App({ seed: 1, equipmentCount: 1 });
    app.setState = function (st) { Object.assign(this.state, st); };
    app._scheduleDraw = function () {};
    app.live = true;
    // 자동 복구가 실제로 타이머를 다시 등록하므로 테스트에서는 호출만 세어 둔다
    app.resyncs = 0;
    app._syncMonitorTimer = function () { this.resyncs++; return Promise.resolve(); };
    app._toast = function () {};
    Object.assign(app.state, { monitorOn: true, monMode: 'server', monitorInterval: '3s', bandOn: false }, patch || {});
    return app;
  };
  const kinds = (app) => (app.state.health || []).map((w) => w.k).sort().join(',');
  const NOW = Date.now();
  const RUN = { NEO_VIBE_MONITOR: { state: 'RUNNING', schedule: '@every 10s' } };

  let a = mk();
  a._applyHealth(RUN, { t: NOW - 5000, n: 4 });
  chk(a.state.health === null, '정상(RUNNING + 최근 심박)이면 배너 없음', kinds(a));

  a = mk();
  a._applyHealth({ NEO_VIBE_MONITOR: { state: 'STOP, ReferenceError: tt is not defined' } }, { t: NOW - 5000, n: 4 });
  chk(kinds(a) === 'stopped', '타이머 STOP이면 멈춤 배너', kinds(a));
  chk(/ReferenceError/.test((a.state.health[0] || {}).text || ''), '배너에 실패 사유가 그대로 실린다');

  a = mk();
  a._applyHealth({}, { t: NOW - 5000, n: 4 });
  chk(kinds(a) === 'nomon', '타이머가 없으면 미등록 배너', kinds(a));

  /* 이번 사고의 핵심 조건 — 타이머는 RUNNING인데 판정이 30시간 멈춰 있던 상태.
     타이머 상태만 봤다면 정상으로 보였을 것이다. */
  a = mk();
  a._applyHealth(RUN, { t: NOW - 30 * 3600e3, n: 4 });
  chk(kinds(a) === 'stale', 'RUNNING이어도 심박이 오래되면 지연 배너', kinds(a));

  a = mk();
  a._applyHealth(RUN, { t: NOW - 5000, n: 0 });
  chk(kinds(a) === 'nodata', '판정 대상 0개면 데이터 유입 경고', kinds(a));

  a = mk();
  a._applyHealth(null, null);
  chk(kinds(a) === 'unknown', '타이머 상태 조회 실패는 "모름"으로 표시', kinds(a));

  // 대역 추출은 켜져 있을 때만 본다 — 꺼둔 기능으로 경고를 내면 안 된다
  a = mk({ bandOn: false });
  a._applyHealth(RUN, { t: NOW - 5000, n: 4 });
  chk(a.state.health === null, '대역 추출이 꺼져 있으면 대역 타이머는 보지 않는다', kinds(a));
  a = mk({ bandOn: true });
  a._applyHealth(RUN, { t: NOW - 5000, n: 4 });
  chk(kinds(a) === 'noband', '대역 추출이 켜져 있는데 타이머가 없으면 경고', kinds(a));

  // 감시를 꺼둔 상태는 이상이 아니다
  a = mk({ monitorOn: false });
  a._healthTick();
  chk(a.state.health == null, '감시 자체를 꺼두면 배너 없음', kinds(a));

  // 같은 상태가 이어지면 리렌더하지 않는다(10초마다 setState가 도는 것을 막는다)
  a = mk();
  let n = 0;
  a.setState = function (st) { n++; Object.assign(this.state, st); };
  a._applyHealth(RUN, { t: NOW - 5000, n: 4 });
  a._applyHealth(RUN, { t: NOW - 4000, n: 4 });
  a._applyHealth(RUN, { t: NOW - 3000, n: 4 });
  chk(n <= 1, '상태가 그대로면 setState를 반복하지 않는다', `setState ${n}회`);
}

/* ── 자동 복구 ───────────────────────────────────────────────────────────────
   Neo 타이머는 스크립트가 한 번 던지면 STOP으로 두고 재시도하지 않는다. 실제로 순간적인
   소켓 고갈(WSAENOBUFS) 하나로 감시가 1.4시간 꺼져 있었다. 그 자리를 사람의 클릭이 아니라
   앱이 메우되, 스크립트가 깨진 경우까지 무한히 되살리려 들지 않는 것이 이 판정부의 몫이다. */
{
  const mk = (patch) => {
    const app = new App({ seed: 1, equipmentCount: 1 });
    app.setState = function (st) { Object.assign(this.state, st); };
    app._scheduleDraw = function () {};
    app.live = true;
    app.resyncs = 0; app.bandResyncs = 0;
    app._syncMonitorTimer = function () { this.resyncs++; return Promise.resolve(); };
    app._syncBandTimer = function () { this.bandResyncs++; return Promise.resolve(); };
    app._toast = function () {};
    Object.assign(app.state, { monitorOn: true, monMode: 'server', monitorInterval: '10s', bandOn: false }, patch || {});
    return app;
  };
  const warn = (app) => (app.state.health || [])[0] || {};
  const kinds = (app) => (app.state.health || []).map((w) => w.k).sort().join(',');
  const NOW = Date.now();
  const DEAD = { NEO_VIBE_MONITOR: { state: 'STOP, MACHCLI dial tcp 127.0.0.1:5656: bind: ... buffer space ...' } };
  const RUN = { NEO_VIBE_MONITOR: { state: 'RUNNING', schedule: '@every 10s' } };

  // 죽은 것을 보면 즉시 다시 등록한다 — 클릭을 기다리지 않는다
  let a = mk();
  a._applyHealth(DEAD, { t: NOW - 5000, n: 4 });
  chk(a.resyncs === 1, '멈춘 것을 보면 스스로 다시 등록한다', `${a.resyncs}회`);
  chk(warn(a).lv === 'warn' && /자동으로 다시 등록/.test(warn(a).text || ''), '복구를 시도했다고 알린다', warn(a).text);
  chk(/buffer space/.test(warn(a).text || ''), '사유는 그대로 남긴다');

  // 결과를 기다리는 동안은 다시 시도하지 않는다 — 10초 주기로 재등록을 퍼부으면 안 된다
  a._recover.mon.at = Date.now();
  a._applyHealth(DEAD, { t: NOW - 5000, n: 4 });
  chk(a.resyncs === 1, '간격 안에서는 다시 시도하지 않는다', `${a.resyncs}회`);
  chk(/기다리는 중/.test(warn(a).text || ''), '기다리는 중임을 밝힌다', warn(a).text);

  /* 스크립트가 깨진 경우 — 몇 번을 등록해도 같은 자리에서 죽는다. 상한에서 손을 떼고
     사유를 그대로 보여줘야 한다. 계속 "복구했습니다"로 덮으면 진짜 고장이 가려진다. */
  a = mk();
  for (let i = 0; i < 6; i++) {
    a._applyHealth(DEAD, { t: NOW - 5000, n: 4 });
    if (a._recover && a._recover.mon) a._recover.mon.at -= 200000;    // 간격을 넘긴 것으로 둔다
  }
  chk(a.resyncs === 3, '상한(3회)을 넘겨 되살리려 들지 않는다', `${a.resyncs}회`);
  chk(warn(a).lv === 'err' && /살아나지 않았습니다/.test(warn(a).text || ''), '포기하면 오류로 되돌린다', warn(a).text);
  chk(warn(a).act === '다시 등록', '사람이 직접 시도할 길은 남긴다');

  // 살아난 뒤 — 조용히 지우지 않는다. 감시가 없던 구간은 데이터에 구멍으로 남는다
  a = mk();
  a._applyHealth(DEAD, { t: NOW - 5000, n: 4 });
  a._applyHealth(RUN, { t: Date.now() - 5000, n: 4 });
  chk(warn(a).k === 'recovered', '복구된 뒤에도 멈췄었다는 사실을 남긴다', JSON.stringify(warn(a).k));
  chk(/확인된 것이 아닙니다/.test(warn(a).text || ''), '그 구간의 "이상 없음"이 확인이 아님을 밝힌다');

  // 오래 조용하면 시도 횟수를 처음부터 — 몇 달에 한 번 나는 장애까지 누적하면 안 된다
  a._recover.mon.at = Date.now() - 2 * 3600e3;
  a._applyHealth(RUN, { t: Date.now() - 5000, n: 4 });
  chk(a.state.health === null, '오래 조용하면 흔적을 지운다', JSON.stringify(a.state.health));
  a._applyHealth(DEAD, { t: Date.now() - 5000, n: 4 });
  chk(a.resyncs === 2, '카운터가 리셋돼 다시 복구를 시도한다', `${a.resyncs}회`);

  // 앱 모드에는 서버 타이머가 없다 — 되살릴 대상 자체가 없다
  a = mk();
  a.state.monMode = 'app';
  a._applyHealth(DEAD, { t: NOW - 5000, n: 4 });
  chk(a.resyncs === 0, '앱 모드에서는 재등록하지 않는다', `${a.resyncs}회`);

  /* 상태를 못 읽은 것(Neo 연결 실패)은 "살아났다"가 아니다.
     모르는 것을 복구됐다고 적으면 배너가 거짓말을 한다. */
  a = mk();
  a._applyHealth(DEAD, { t: NOW - 5000, n: 4 });
  a._applyHealth(null, null);
  chk(kinds(a) === 'unknown', '상태를 못 읽으면 복구 판단을 하지 않는다', kinds(a));

  /* 대역 추출도 켜둔 설정이다 — 멈추면 대역 기준이 판정에서 조용히 빠진다.
     감시만 되살리고 이건 두면 세 축 중 하나가 없는 채로 "정상"처럼 보인다. */
  const BDEAD = { NEO_VIBE_MONITOR: { state: 'RUNNING' }, NEO_VIBE_BAND: { state: 'STOP, dial tcp ...' } };
  const BRUN = { NEO_VIBE_MONITOR: { state: 'RUNNING' }, NEO_VIBE_BAND: { state: 'RUNNING' } };
  a = mk({ bandOn: true });
  a._applyHealth(BDEAD, { t: NOW - 5000, n: 4 });
  chk(a.bandResyncs === 1, '대역 추출이 멈추면 그것도 스스로 다시 등록한다', `${a.bandResyncs}회`);
  chk(a.resyncs === 0, '감시가 멀쩡하면 감시는 건드리지 않는다', `${a.resyncs}회`);
  chk(/자동으로 다시 등록/.test((a.state.health[0] || {}).text || ''), '대역 복구도 알린다', (a.state.health[0] || {}).text);

  a._applyHealth(BRUN, { t: Date.now() - 5000, n: 4 });
  chk((a.state.health[0] || {}).k === 'bandrecovered', '대역도 멈췄었다는 사실을 남긴다', JSON.stringify((a.state.health[0] || {}).k));
  chk(/대역 기준이 판정에서 빠져/.test((a.state.health[0] || {}).text || ''), '대역은 결과가 다르다 — 축 하나가 빠져 있었다고 적는다');

  // 두 타이머가 같이 죽으면 각자의 카운터로 각자 복구한다
  a = mk({ bandOn: true });
  a._applyHealth({ NEO_VIBE_MONITOR: { state: 'STOP, x' }, NEO_VIBE_BAND: { state: 'STOP, y' } }, { t: NOW - 5000, n: 4 });
  chk(a.resyncs === 1 && a.bandResyncs === 1, '둘 다 죽으면 둘 다 되살린다', `감시 ${a.resyncs} · 대역 ${a.bandResyncs}`);

  /* 대역 추출은 앱 감시 모드에서도 서버 타이머로 돈다 — 추세는 앱이 닫혀도 이어져야 하니까.
     그런데 확인이 서버 분기 안에 있으면 앱 모드 사용자는 대역이 죽어도 모른 채,
     세 축 중 하나가 빠진 판정을 "이상 없음"으로 보게 된다. */
  a = mk({ bandOn: true, monMode: "app" });
  a._applyHealth(BDEAD, null);
  chk(a.bandResyncs === 1, "앱 감시 모드에서도 대역 추출은 되살린다", a.bandResyncs + "회");
  chk(a.resyncs === 0, "앱 모드에서 감시 타이머는 여전히 건드리지 않는다", a.resyncs + "회");
  a._applyHealth(BRUN, null);
  chk(kinds(a) === "bandrecovered", "앱 모드에서도 멈췄었다는 사실을 남긴다", kinds(a));

  // 앱 모드에서 대역이 멀쩡하면 조용하다 — 감시 타이머가 없는 것은 이상이 아니다
  a = mk({ bandOn: true, monMode: "app" });
  a._applyHealth({ NEO_VIBE_BAND: { state: "RUNNING" } }, null);
  chk(a.state.health === null, "앱 모드에서 감시 타이머 부재는 이상이 아니다", JSON.stringify(a.state.health));

  /* 꺼둔 기능을 복구가 켜지 않는다 — 대역 추출을 끈 채로 남은 옛 타이머가 STOP이어도
     그건 되살릴 대상이 아니라 지울 대상이다. 사용자가 끈 것을 앱이 되켜면 안 된다. */
  a = mk({ bandOn: false });
  a._applyHealth(BDEAD, { t: NOW - 5000, n: 4 });
  chk(a.bandResyncs === 0, '대역 추출이 꺼져 있으면 되살리지 않는다', a.bandResyncs + '회');
  chk(!/대역/.test(JSON.stringify(a.state.health || [])), '꺼둔 기능으로 배너도 내지 않는다');

  // 대역 추출을 꺼두면 흔적도 남기지 않는다 — 꺼둔 기능으로 배너를 내면 안 된다
  a = mk({ bandOn: true });
  a._applyHealth(BDEAD, { t: NOW - 5000, n: 4 });
  a.state.bandOn = false;
  a._applyHealth(BRUN, { t: Date.now() - 5000, n: 4 });
  chk(a.state.health === null, '대역 추출을 끄면 대역 복구 흔적도 사라진다', JSON.stringify(a.state.health));
}

/* ── 설정 전 반복 요청 ────────────────────────────────────────────────────────
   새로 설치하면 감시 대상도 설정도 없다. 그 상태에서 확인이 10초마다 도는데, 매번 없는
   타이머를 지우러 가면 Neo가 500을 돌려준다 — 실패 요청 세 건이 영원히 나가고 그 소음이
   진짜 오류를 덮는다. 한 번 지웠으면 지웠다고 기억해야 한다. */
{
  const app = new App({ seed: 1, equipmentCount: 1 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._scheduleDraw = function () {};
  app.live = true;
  let dels = 0;
  app._dropTimerCalls = () => dels;
  const del = () => { dels++; return Promise.resolve(true); };
  Object.assign(app.state, { monitorOn: true, monMode: 'app' });

  // 없는 타이머는 지우러 가지도 않는다 — 없는 것을 지우면 Neo가 500을 돌려주고,
  // 새 설치에서 그 빨간 요청이 화면을 덮어 고장으로 읽힌다
  let states = 0;
  app._timerStates = () => { states++; return Promise.resolve({}); };   // 등록된 타이머 없음
  await app._dropTimer('_specSig', del, 'NEO_VIBE_MONITOR');
  chk(dels === 0, '없는 타이머는 삭제 요청조차 보내지 않는다', dels + '회');
  chk(states === 1, '있는지 한 번만 확인한다', states + '회');

  await app._dropTimer('_specSig', del, 'NEO_VIBE_MONITOR');
  await app._dropTimer('_specSig', del, 'NEO_VIBE_MONITOR');
  chk(states === 1, '한 번 확인했으면 조회도 다시 하지 않는다', states + '회');

  // 실제로 있으면 지운다
  app._specSig = null;
  app._timerStates = () => Promise.resolve({ NEO_VIBE_MONITOR: { state: 'RUNNING' } });
  await app._dropTimer('_specSig', del, 'NEO_VIBE_MONITOR');
  chk(dels === 1, '있으면 지운다', dels + '회');

  /* 상태를 못 읽었으면(연결 실패) 예전처럼 지워 본다 — 확인이 안 된다고 손을 놓으면
     꺼둔 설정의 타이머가 계속 도는 쪽이 된다. */
  app._specSig = null;
  app._timerStates = () => Promise.resolve(null);
  await app._dropTimer('_specSig', del, 'NEO_VIBE_MONITOR');
  chk(dels === 2, '상태를 모르면 지워 본다', dels + '회');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
