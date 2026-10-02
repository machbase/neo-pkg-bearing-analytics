// 회전수 미설정 가드 — 오프라인(Neo 불필요) · npm run smoke 포함
// · 회전수 없으면 추측(폴백 1800) 없이 1× 상대 대역 폭 0·결함주파수 미산출·결함 패턴 축 "측정 불가"
// · 회전수 미설정 배너 표시·해제
globalThis.window = globalThis;
const { App } = await import('../src/app.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Band = (await import('../../cgi-bin/monitor/band.js')).default;

let fail = 0;
const chk = (c, label, extra) => {
  if (c) console.log('PASS', label, extra === undefined ? '' : extra);
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); }
};

// ── 1× 상대 대역은 회전수 없이 정의 불가 ────────────────────────────────
{
  const nyq = 12800;
  const off = Band.bandsFor(0, nyq);
  const on = Band.bandsFor(30, nyq);
  chk(off.length === on.length, '대역 개수는 그대로 — 배열 모양이 바뀌면 학습·판정이 인덱스로 어긋난다',
    off.length + '/' + on.length);
  /* 폭 0 → 에너지 0 → 학습은 전부 0인 대역 거부, 판정은 한계 0인 대역 건너뜀(기존 경로라 별도 분기 없음) */
  chk(off.slice(0, 4).every((b) => b[1] - b[0] === 0),
    '1× 상대 4대역(sub·one·fault·high)은 폭 0 — 추측한 경계로 재느니 안 재는 게 맞다',
    JSON.stringify(off.slice(0, 4)));
  chk(off.slice(4).every((b) => b[1] > b[0]),
    '절대 주파수 대역(vh1~vh4)은 회전수와 무관하므로 그대로 산다', JSON.stringify(off.slice(4)));
  chk(on.slice(0, 4).every((b) => b[1] > b[0]), '회전수가 있으면 네 대역이 정상 폭을 갖는다');
}

// ── 커버리지: 회전수 없으면 두 축이 "측정 불가"로 빠짐 ────────────────────
{
  const app = new App({ seed: 1, equipmentCount: 1 });
  app.E = CH;
  const base = { id: 'T:x', table: 'T', name: 'x', unit: 'mm/s', cls: 'II', fs: 25600,
    bearing: { model: '직접입력', n: 9, Bd: 7.94, Pd: 39.04, phi: 0 } };
  const noRpm = Object.assign({}, base, { rpm: 0 });
  const withRpm = Object.assign({}, base, { rpm: 1800 });
  // 판정용 최소 det — 스펙트럼이 비어도 커버리지·판정문 경로는 동작
  const emptySp = { freqs: [], mags: [], res: 1 };
  const det = { quality: null, raw: { values: [] }, isoRms: 0.5, indics: [],
    fft: emptySp, env: emptySp, envQ: null, ordSpec: emptySp, bandSet: null,
    bandAt: null, frMeas: null, levels: {}, anchorMs: 1 };

  const a = app._dx(noRpm, det, null);
  const b = app._dx(withRpm, det, null);
  chk(a.cov.missing.indexOf('결함 패턴') >= 0,
    '회전수 없으면 결함 패턴 축이 빠진 것으로 표시된다 — 0점이 아니라 측정 불가', a.cov.missing.join('·'));
  chk(a.cov.extra.indexOf('대역') < 0, '대역 축도 참여하지 않는다', JSON.stringify(a.cov.extra));
  chk(/회전수 미상/.test(a.verdict), '판정문이 사유를 이름으로 말한다', a.verdict);
  chk(!/회전수 미상/.test(b.verdict), '회전수가 있으면 그 문구가 안 뜬다', b.verdict);
}

// ── 결함주파수는 회전수 없이 산출 불가 ──────────────────────────────────────────
{
  const geo = { n: 9, Bd: 7.94, Pd: 39.04, phi: 0 };
  const f0 = VC.bearingFreqs(0, geo), f1 = VC.bearingFreqs(1800, geo);
  chk(!(f0.BPFO > 0), '회전수 0이면 BPFO가 서지 않는다 — 격자가 만들어질 수 없다', String(f0.BPFO));
  chk(f1.BPFO > 0, '회전수가 있으면 BPFO가 선다', f1.BPFO.toFixed(2));
}

// ── 배너 해제 ────────────────────────────────────────────────────────
/* 회전수 미설정 배너는 서명(sig) 검사보다 먼저 계산 — 뒤에 있으면 다른 경고가 그대로일 때 조기 return으로 갱신 누락 */
{
  const app = Object.create(App.prototype);
  const eqs = ['s1-c1', 's1-c2'].map((n) => ({
    id: 'NASA_LIVE:' + n, table: 'NASA_LIVE', name: n, alias: n,
    rpm: 0, bearing: { model: '', n: 0 }, lastSeen: Date.now(), stat: {},
  }));
  app.data = { now: Date.now(), equipment: eqs, events: [], reports: [] };
  app.state = { srcSel: ['NASA_LIVE'], equipRpm: {}, equipBearing: {}, equipGeo: {},
    monMode: 'app', monitorInterval: '10s', bandOn: false, knownTags: [], revived: {} };
  app._toast = () => {};
  let health = null;
  app.setState = (o) => { Object.assign(app.state, o); if ('health' in o) health = o.health; };

  app._applyHealth({}, null);
  const nogeo = (health || []).filter((w) => w.k === 'nogeo');
  chk(nogeo.length === 1, '회전수가 없으면 배너가 뜬다', nogeo.length ? nogeo[0].text.slice(0, 40) : '없음');

  // 값 채움 — 실제로는 설정 저장 뒤 _reloadLive가 equipment 재구성
  eqs.forEach((e) => { e.rpm = 1800; e.bearing = { model: '6206', n: 9 }; });
  app._applyHealth({}, null);
  chk((health || []).filter((w) => w.k === 'nogeo').length === 0,
    '값을 채우면 배너가 사라진다 — sig 검사보다 먼저 재야 한다',
    JSON.stringify((health || []).map((w) => w.k)));

  // 반대 방향 — 한 대만 다시 비면 배너 재표시
  eqs[0].rpm = 0;
  app._applyHealth({}, null);
  const back = (health || []).filter((w) => w.k === 'nogeo');
  chk(back.length === 1 && /1대/.test(back.text || back[0].text),
    '다시 비면 배너가 돌아온다', back.length ? back[0].text.slice(0, 34) : '없음');
}

// ── 입력 회전수 점검 — 상세분석 경고·실측값 저장 ────────────────────────
{
  const Mock = (await import('./mock.js')).default;
  const { emptyDet } = await import('../src/data/live.js');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' });
  const mk = (meas) => {
    const app = new App({ seed: 7, equipmentCount: 3 });
    app.setState = function (o) { Object.assign(this.state, o); };
    app._toast = function (m) { this._t = m; };
    app.E = Object.assign({}, CH, Mock);
    app.data = Mock.generateData(42, 3);
    const eq = app.data.equipment[0];
    eq.rpm = 1800;
    Object.assign(app.state, { ready: true, tab: 'detail', selTag: eq.id, diagTag: eq.id, srcSel: [...new Set(app.data.equipment.map((e) => e.table))],
      equipRpm: { [eq.id]: '1800', other: '3550' } });
    app._applied = Object.assign({}, app.state, { equipRpm: { [eq.id]: '1800', other: '3000' } });
    // 라이브 상세 캐시를 직접 채움(조회 없이) — 캡처된 스냅샷에 실측 1×만 지정
    app.live = true;
    app._trends = () => ({ kurt: [], bands: [], xLabels: [], xTips: [], state: 'ready' });
    const det = Object.assign(emptyDet(eq), { frMeas: meas });
    app._detailCache[eq.id] = { state: 'ready', det, eqSnap: Object.assign({}, eq), snapNow: Date.now(), key: app._detailKey() };
    return { app, eq };
  };
  let { app, eq } = mk({ f: 29.2, rpm: 1752, distinct: true });
  let vm = app.renderVals();
  chk(/1800 rpm이 스펙트럼에서 잰 1752 rpm과 -2.7% 다릅니다/.test(vm.rpmWarn || '') && vm.rpmWarnAct === '실측값 1752 rpm으로 저장',
    '동기속도(1800)를 넣고 실측 1752 — 경고와 저장 버튼', (vm.rpmWarn || '').slice(0, 60));
  const { view } = await import('../src/view.js');
  const renderToString = (await import('preact-render-to-string')).default;
  const htm = renderToString(view(vm));
  chk(/스펙트럼에서 잰 1752 rpm/.test(htm) && />실측값 1752 rpm으로 저장</.test(htm), '상세분석 화면에 경고·저장 버튼이 그려짐');
  ({ app } = mk({ f: 29.6, rpm: 1776, distinct: true }));
  chk(!app.renderVals().rpmWarn, '1.3% 차이(부하 변동 범위)는 경고 안 함');
  ({ app } = mk({ f: 29.2, rpm: 1752, distinct: false }));
  chk(!app.renderVals().rpmWarn, '분해능 안의 차이(구분 불가)는 경고 안 함');
  ({ app } = mk(null));
  chk(!app.renderVals().rpmWarn, '실측 못 하면 경고 안 함');

  ({ app, eq } = mk({ f: 29.2, rpm: 1752, distinct: true }));
  let saved = null, reloaded = 0;
  app._applyNow = function (ov) { saved = ov; return Promise.resolve(true); };
  app._reloadLive = function () { reloaded++; };
  const act = app.renderVals().onRpmWarnAct;
  if (act) await act();
  chk(saved && saved.equipRpm[eq.id] === '1752' && saved.equipRpm.other === '3000', '저장은 그 설비 값만 — 다른 설비는 적용된 값 그대로', JSON.stringify(saved && saved.equipRpm));
  chk(app.state.equipRpm.other === '3550' && app.state.equipRpm[eq.id] === '1752', '설정 화면에서 편집 중이던 다른 설비 값은 유지');
  chk(reloaded === 1 && /측정 시점 부하 기준/.test(app._t || ''), '저장 뒤 재적재(판정에 새 회전수) · 측정 시점 부하 기준 안내', app._t);
  const fs = await import('node:fs');
  const appSrc = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'), viewSrc = fs.readFileSync(new URL('../src/view.js', import.meta.url), 'utf8');
  chk(!/1800 rpm으로 가정/.test(appSrc) && /동기속도\(1800\)는 넣지 마십시오/.test(appSrc) && !/기본 1800/.test(viewSrc),
    'RPM 도움말·입력칸 — 1800 가정 문구 제거, 정격 회전수 안내');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
