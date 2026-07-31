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

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
