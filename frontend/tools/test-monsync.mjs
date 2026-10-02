// 서버 감시 타이머 재동기화 — 오프라인(Neo 불필요) · npm run smoke 포함
// · 타이머 TQL에 값으로 구운 기준(태그·존·베이스라인·주기)이 바뀌면 재생성, 안 바뀌면 생략
// · 감시 살아있음 판정(_applyHealth)·자동 복구(상한·홀드)·설정 전 반복 삭제 요청 억제
globalThis.window = globalThis;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

// 판정 타이머 상태 기록만 있는 상태 묶음(_applyHealth 둘째 인자)
const ST = (mon) => (mon ? { mon, band: null } : null);
let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// 타이머 API 가로채 굽기 횟수·내용 관찰
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
  const Monitor = null; // 미사용(관찰은 instrument()에서)
  return app;
}

// create/deleteMonitorTimer는 모듈 import라 스텁 불가 → _syncMonitorTimer를 대체해 관찰
function instrument(app) {
  const orig = app._syncMonitorTimer.bind(app);
  app._syncCalls = [];   // 호출 시도(silent 여부)
  app._syncBakes = [];   // 실제로 구운 서명
  app._syncMonitorTimer = function (silent) {
    app._syncCalls.push(!!silent);
    // 원본 서명 계산만 재현해 "구웠는가" 판정 — 네트워크 없음
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

// ── 1. 서명 가드: 변경 없으면 굽지 않음 ───────────────────────────────
{
  const app = instrument(makeApp('server'));
  app._syncMonitorTimer(false);           // 최초(저장) — 구움
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

// ── 3. 베이스라인 삭제도 기준 변경 ─────────────────────────────────────
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

// ── 4. 태그 증감 — 새 설비 무감시 방치 방지 ─────────────────────
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

// ── 6. 앱 감시 모드에서는 굽지 않음 ─────────────────────────────
{
  const app = instrument(makeApp('app'));
  app._syncMonitorTimer(false);
  app._syncMonitorTimer(true);
  chk(app._syncBakes.length === 0, '앱 감시 모드 — 타이머 미생성', `구움 ${app._syncBakes.length}회`);
}

// ── 7. 디바운스: 전체 학습(병렬 N건) → 재생성 1번 ─────────────
{
  const app = instrument(makeApp('server'));
  app._resyncMonSoon(); app._resyncMonSoon(); app._resyncMonSoon(); // 3태그 동시 학습 완료
  await new Promise((r) => setTimeout(r, 1000));
  chk(app._syncCalls.length === 1, '전체 학습 N건 → 재동기화 1회로 병합', `호출 ${app._syncCalls.length}회`);
  chk(app._syncCalls[0] === true, '자동 재동기화는 silent(토스트 없음)');
}

// ── 8. 자동 경로는 토스트 없음(사용자 저장만 알림) ──────────────
{
  const app = instrument(makeApp('server'));
  app._toasts = [];
  app._resyncMonSoon();
  await new Promise((r) => setTimeout(r, 1000));
  chk(app._toasts.length === 0, '자동 재동기화 시 토스트 없음', `토스트 ${app._toasts.length}건`);
}


/* ── 감시 살아있음 확인(_applyHealth) ────────────────────────────────────────
   서버 타이머는 등록 성공 후 첫 실행에서 죽을 수 있음 — "조용함 = 정상"과 "판정 0건" 구분 */
{
  const mk = (patch) => {
    const app = new App({ seed: 1, equipmentCount: 1 });
    app.setState = function (st) { Object.assign(this.state, st); };
    app._scheduleDraw = function () {};
    app.live = true;
    // 자동 복구의 타이머 재등록은 호출 횟수만 셈
    app.resyncs = 0;
    app._syncMonitorTimer = function () { this.resyncs++; return Promise.resolve(); };
    app._toast = function () {};
    Object.assign(app.state, { monitorOn: true, monMode: 'server', monitorInterval: '3s', bandOn: false }, patch || {});
    return app;
  };
  const kinds = (app) => (app.state.health || []).map((w) => w.k).sort().join(',');
  const NOW = Date.now();
  const RUN = { NEO_BEARING_MONITOR: { state: 'RUNNING', schedule: '@every 10s' } };

  let a = mk();
  a._applyHealth(RUN, ST({ t: NOW - 5000, n: 4 }));
  chk(a.state.health === null, '정상(RUNNING + 최근 심박)이면 배너 없음', kinds(a));

  a = mk();
  a._applyHealth({ NEO_BEARING_MONITOR: { state: 'STOP, ReferenceError: tt is not defined' } }, ST({ t: NOW - 5000, n: 4 }));
  chk(kinds(a) === 'stopped', '타이머 STOP이면 멈춤 배너', kinds(a));
  chk(/ReferenceError/.test((a.state.health[0] || {}).text || ''), '배너에 실패 사유가 그대로 실린다');

  a = mk();
  a._applyHealth({}, ST({ t: NOW - 5000, n: 4 }));
  chk(kinds(a) === 'nomon', '타이머가 없으면 미등록 배너', kinds(a));

  /* 타이머는 RUNNING인데 판정이 30시간 멈춘 상태 — 타이머 상태만으론 정상으로 보임 */
  a = mk();
  a._applyHealth(RUN, ST({ t: NOW - 30 * 3600e3, n: 4 }));
  chk(kinds(a) === 'stale', 'RUNNING이어도 심박이 오래되면 지연 배너', kinds(a));

  a = mk();
  a._applyHealth(RUN, ST({ t: NOW - 5000, n: 0 }));
  chk(kinds(a) === 'nodata', '판정 대상 0개면 데이터 유입 경고', kinds(a));

  a = mk();
  a._applyHealth(null, ST(null));
  chk(kinds(a) === 'unknown', '타이머 상태 조회 실패는 "모름"으로 표시', kinds(a));

  // 대역 추출은 켜져 있을 때만 확인 — 꺼둔 기능으로 경고 금지
  a = mk({ bandOn: false });
  a._applyHealth(RUN, ST({ t: NOW - 5000, n: 4 }));
  chk(a.state.health === null, '대역 추출이 꺼져 있으면 대역 타이머는 보지 않는다', kinds(a));
  a = mk({ bandOn: true });
  a._applyHealth(RUN, ST({ t: NOW - 5000, n: 4 }));
  chk(kinds(a) === 'noband', '대역 추출이 켜져 있는데 타이머가 없으면 경고', kinds(a));

  // 감시 꺼둔 상태는 이상 아님
  a = mk({ monitorOn: false });
  a._healthTick();
  chk(a.state.health == null, '감시 자체를 꺼두면 배너 없음', kinds(a));

  // 같은 상태 지속 시 리렌더 생략(10초마다 setState 방지)
  a = mk();
  let n = 0;
  a.setState = function (st) { n++; Object.assign(this.state, st); };
  a._applyHealth(RUN, ST({ t: NOW - 5000, n: 4 }));
  a._applyHealth(RUN, ST({ t: NOW - 4000, n: 4 }));
  a._applyHealth(RUN, ST({ t: NOW - 3000, n: 4 }));
  chk(n <= 1, '상태가 그대로면 setState를 반복하지 않는다', `setState ${n}회`);
}

/* ── 자동 복구 ───────────────────────────────────────────────────────────────
   Neo 타이머는 스크립트가 한 번 던지면 STOP 후 재시도 없음(예: 순간 소켓 고갈) → 앱이 자동 재등록,
   스크립트가 깨진 경우 무한 재시도 없음(상한) */
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
  const DEAD = { NEO_BEARING_MONITOR: { state: 'STOP, MACHCLI dial tcp 127.0.0.1:5656: bind: ... buffer space ...' } };
  const RUN = { NEO_BEARING_MONITOR: { state: 'RUNNING', schedule: '@every 10s' } };

  // 멈춘 타이머는 클릭 없이 즉시 재등록
  let a = mk();
  a._applyHealth(DEAD, ST({ t: NOW - 5000, n: 4 }));
  chk(a.resyncs === 1, '멈춘 것을 보면 스스로 다시 등록한다', `${a.resyncs}회`);
  chk(warn(a).lv === 'warn' && /자동으로 다시 등록/.test(warn(a).text || ''), '복구를 시도했다고 알린다', warn(a).text);
  chk(/buffer space/.test(warn(a).text || ''), '사유는 그대로 남긴다');

  // 결과 대기 중엔 재시도 없음 — 10초 주기 재등록 폭주 방지
  a._recover.mon.at = Date.now();
  a._applyHealth(DEAD, ST({ t: NOW - 5000, n: 4 }));
  chk(a.resyncs === 1, '간격 안에서는 다시 시도하지 않는다', `${a.resyncs}회`);
  chk(/기다리는 중/.test(warn(a).text || ''), '기다리는 중임을 밝힌다', warn(a).text);

  /* 스크립트가 깨진 경우 — 상한에서 포기하고 사유 표시("복구했습니다"로 진짜 고장 은폐 방지) */
  a = mk();
  for (let i = 0; i < 6; i++) {
    a._applyHealth(DEAD, ST({ t: NOW - 5000, n: 4 }));
    if (a._recover && a._recover.mon) a._recover.mon.at -= 200000;    // 간격 경과로 간주
  }
  chk(a.resyncs === 3, '상한(3회)을 넘겨 되살리려 들지 않는다', `${a.resyncs}회`);
  chk(warn(a).lv === 'err' && /살아나지 않았습니다/.test(warn(a).text || ''), '포기하면 오류로 되돌린다', warn(a).text);
  chk(warn(a).act === '다시 등록', '사람이 직접 시도할 길은 남긴다');

  // 살아난 뒤에도 흔적 유지 — 감시 공백 구간은 데이터에 구멍으로 남음
  a = mk();
  a._applyHealth(DEAD, ST({ t: NOW - 5000, n: 4 }));
  a._applyHealth(RUN, ST({ t: Date.now() - 5000, n: 4 }));
  chk(warn(a).k === 'recovered', '복구된 뒤에도 멈췄었다는 사실을 남긴다', JSON.stringify(warn(a).k));
  chk(/확인된 것이 아닙니다/.test(warn(a).text || ''), '그 구간의 "이상 없음"이 확인이 아님을 밝힌다');

  // 오래 조용하면 시도 횟수 리셋 — 드문 장애 간 누적 방지
  a._recover.mon.at = Date.now() - 2 * 3600e3;
  a._applyHealth(RUN, ST({ t: Date.now() - 5000, n: 4 }));
  chk(a.state.health === null, '오래 조용하면 흔적을 지운다', JSON.stringify(a.state.health));
  a._applyHealth(DEAD, ST({ t: Date.now() - 5000, n: 4 }));
  chk(a.resyncs === 2, '카운터가 리셋돼 다시 복구를 시도한다', `${a.resyncs}회`);

  // 앱 모드엔 서버 감시 타이머 없음 — 되살릴 대상 없음
  a = mk();
  a.state.monMode = 'app';
  a._applyHealth(DEAD, ST({ t: NOW - 5000, n: 4 }));
  chk(a.resyncs === 0, '앱 모드에서는 재등록하지 않는다', `${a.resyncs}회`);

  /* 상태 조회 실패(Neo 연결 실패)는 "살아남"이 아님 — 복구 판단 없이 "모름" */
  a = mk();
  a._applyHealth(DEAD, ST({ t: NOW - 5000, n: 4 }));
  a._applyHealth(null, ST(null));
  chk(kinds(a) === 'unknown', '상태를 못 읽으면 복구 판단을 하지 않는다', kinds(a));
  /* _applyHealth는 연속 실패가 쌓인 뒤에만 호출 — 1회 튄 조회로 배너가 뒤집히지 않도록 _healthTick에서 계수 */
  const APPSRC = (await import('node:fs')).readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(APPSRC.indexOf('< TIMER_MISS_MIN) return;') >= 0,
    '조회 1회 실패로는 _applyHealth를 부르지 않는다 — 못 읽은 틱은 화면을 그대로 둔다');

  /* 순회는 하는데 패턴 판정 0건인 상태 — 타이머·심박·두절 검사를 전부 통과해 이 경고 없으면 화면이 조용함 */
  const HB0 = (over) => ({ t: Date.now() - 3000, n: 60, pat: 0, ms: 3000, __over: over });
  a = mk();
  a._applyHealth(RUN, ST(HB0()));
  chk(kinds(a) === '', '기동 직후 pat 0은 알리지 않는다 — 패턴은 주기마다 잰다', kinds(a) || '(없음)');
  a._patZeroAt = Date.now() - 20 * 60000;                 // 20분째 0
  a._applyHealth(RUN, ST(HB0()));
  chk(kinds(a) === 'nopat', '0이 이어지면 알린다', kinds(a));
  chk(/알람이 날 수 없습니다/.test(warn(a).text || ''), '알람이 날 수 없는 상태임을 밝힌다');

  // 한 번이라도 재면 홀드 해제 — 옛 0구간이 남아 다음 0에 즉시 뜨는 것 방지
  a._applyHealth(RUN, ST({ t: Date.now() - 3000, n: 60, pat: 7, ms: 3000 }));
  chk(!a._patZeroAt, '판정한 태그가 있으면 홀드를 푼다', String(a._patZeroAt));
  a._applyHealth(RUN, ST(HB0()));
  chk(kinds(a) === '', '풀린 뒤엔 다시 처음부터 센다', kinds(a) || '(없음)');

  // pat 필드 없는 옛 TQL엔 경고 없음 — 재등록 전 오경보 방지
  a = mk();
  a._patZeroAt = Date.now() - 20 * 60000;
  a._applyHealth(RUN, ST({ t: Date.now() - 3000, n: 60, ms: 3000 }));
  chk(kinds(a) === '', '옛 TQL(pat 없음)에는 뜨지 않는다', kinds(a) || '(없음)');

  /* 대역 추출 타이머도 복구 대상 — 멈추면 대역 기준이 판정에서 조용히 빠짐 */
  const BDEAD = { NEO_BEARING_MONITOR: { state: 'RUNNING' }, NEO_BEARING_BAND: { state: 'STOP, dial tcp ...' } };
  const BRUN = { NEO_BEARING_MONITOR: { state: 'RUNNING' }, NEO_BEARING_BAND: { state: 'RUNNING' } };
  a = mk({ bandOn: true });
  a._applyHealth(BDEAD, ST({ t: NOW - 5000, n: 4 }));
  chk(a.bandResyncs === 1, '대역 추출이 멈추면 그것도 스스로 다시 등록한다', `${a.bandResyncs}회`);
  chk(a.resyncs === 0, '감시가 멀쩡하면 감시는 건드리지 않는다', `${a.resyncs}회`);
  chk(/자동으로 다시 등록/.test((a.state.health[0] || {}).text || ''), '대역 복구도 알린다', (a.state.health[0] || {}).text);

  a._applyHealth(BRUN, ST({ t: Date.now() - 5000, n: 4 }));
  chk((a.state.health[0] || {}).k === 'bandrecovered', '대역도 멈췄었다는 사실을 남긴다', JSON.stringify((a.state.health[0] || {}).k));
  chk(/대역 기준이 판정에서 빠져/.test((a.state.health[0] || {}).text || ''), '대역은 결과가 다르다 — 축 하나가 빠져 있었다고 적는다');

  // 두 타이머 동시 정지 시 각자 카운터로 각자 복구
  a = mk({ bandOn: true });
  a._applyHealth({ NEO_BEARING_MONITOR: { state: 'STOP, x' }, NEO_BEARING_BAND: { state: 'STOP, y' } }, ST({ t: NOW - 5000, n: 4 }));
  chk(a.resyncs === 1 && a.bandResyncs === 1, '둘 다 죽으면 둘 다 되살린다', `감시 ${a.resyncs} · 대역 ${a.bandResyncs}`);

  /* 대역 추출은 앱 감시 모드에서도 서버 타이머로 동작(앱이 닫혀도 추세 지속) → 앱 모드에서도 확인·복구 */
  a = mk({ bandOn: true, monMode: "app" });
  a._applyHealth(BDEAD, ST(null));
  chk(a.bandResyncs === 1, "앱 감시 모드에서도 대역 추출은 되살린다", a.bandResyncs + "회");
  chk(a.resyncs === 0, "앱 모드에서 감시 타이머는 여전히 건드리지 않는다", a.resyncs + "회");
  a._applyHealth(BRUN, ST(null));
  chk(kinds(a) === "bandrecovered", "앱 모드에서도 멈췄었다는 사실을 남긴다", kinds(a));

  // 앱 모드에서 대역 정상이면 배너 없음 — 감시 타이머 부재는 이상 아님
  a = mk({ bandOn: true, monMode: "app" });
  a._applyHealth({ NEO_BEARING_BAND: { state: "RUNNING" } }, ST(null));
  chk(a.state.health === null, "앱 모드에서 감시 타이머 부재는 이상이 아니다", JSON.stringify(a.state.health));

  /* 꺼둔 기능은 복구 대상 아님 — 대역 추출을 끈 채 남은 옛 타이머가 STOP이어도 되켜지 않음 */
  a = mk({ bandOn: false });
  a._applyHealth(BDEAD, ST({ t: NOW - 5000, n: 4 }));
  chk(a.bandResyncs === 0, '대역 추출이 꺼져 있으면 되살리지 않는다', a.bandResyncs + '회');
  chk(!/대역/.test(JSON.stringify(a.state.health || [])), '꺼둔 기능으로 배너도 내지 않는다');

  // 대역 추출을 끄면 복구 흔적도 제거 — 꺼둔 기능으로 배너 금지
  a = mk({ bandOn: true });
  a._applyHealth(BDEAD, ST({ t: NOW - 5000, n: 4 }));
  a.state.bandOn = false;
  a._applyHealth(BRUN, ST({ t: Date.now() - 5000, n: 4 }));
  chk(a.state.health === null, '대역 추출을 끄면 대역 복구 흔적도 사라진다', JSON.stringify(a.state.health));
}

/* ── 설정 전 반복 요청 ────────────────────────────────────────────────────────
   새 설치 상태에서 10초마다 없는 타이머를 지우면 Neo 500 반복 → 삭제 여부 기억 */
{
  const app = new App({ seed: 1, equipmentCount: 1 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._scheduleDraw = function () {};
  app.live = true;
  let dels = 0;
  app._dropTimerCalls = () => dels;
  const del = () => { dels++; return Promise.resolve(true); };
  Object.assign(app.state, { monitorOn: true, monMode: 'app' });

  // 없는 타이머는 삭제 요청 안 함 — Neo 500이 새 설치에서 고장으로 읽힘
  let states = 0;
  app._timerStates = () => { states++; return Promise.resolve({}); };   // 등록된 타이머 없음
  await app._dropTimer('_specSig', del, 'NEO_BEARING_MONITOR');
  chk(dels === 0, '없는 타이머는 삭제 요청조차 보내지 않는다', dels + '회');
  chk(states === 1, '있는지 한 번만 확인한다', states + '회');

  await app._dropTimer('_specSig', del, 'NEO_BEARING_MONITOR');
  await app._dropTimer('_specSig', del, 'NEO_BEARING_MONITOR');
  chk(states === 1, '한 번 확인했으면 조회도 다시 하지 않는다', states + '회');

  // 있으면 삭제
  app._specSig = null;
  app._timerStates = () => Promise.resolve({ NEO_BEARING_MONITOR: { state: 'RUNNING' } });
  await app._dropTimer('_specSig', del, 'NEO_BEARING_MONITOR');
  chk(dels === 1, '있으면 지운다', dels + '회');

  /* 상태 조회 실패(연결 실패) 시엔 삭제 시도 — 꺼둔 설정의 타이머가 계속 도는 것 방지 */
  app._specSig = null;
  app._timerStates = () => Promise.resolve(null);
  await app._dropTimer('_specSig', del, 'NEO_BEARING_MONITOR');
  chk(dels === 2, '상태를 모르면 지워 본다', dels + '회');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
