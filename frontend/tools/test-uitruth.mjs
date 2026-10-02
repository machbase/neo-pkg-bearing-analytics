/* 화면 표시·안내 문구 ↔ 실제 판정 동작 정합 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 판정 보류 KPI 툴팁 — 사유별 대수 합 = 보류 대수(결함 패턴 측정 대기·실패 포함)
   · 이벤트 목록 계측 이상·복귀 행 — 지표값 없음, 사유 표시(값·기준 0 미표시)
   · 근거 블록 커토그램 상한 — 적용 상한의 실제 출처 표기
   · 베이스라인·대역은 이벤트·등급 없음, RMS 알람 없음 — 문구가 없는 동작을 말하지 않음 */
globalThis.window = globalThis;
// 설정 화면 렌더가 부르는 커버리지 조회 — 빈 결과로 대체
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' });

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};

const TABLES = ['VIBRATION_RAW', 'SENSOR_DATA'];
function mkApp(patch) {
  const app = new App({ seed: 11, equipmentCount: 8 });
  app.setState = function (s) { Object.assign(this.state, s); };
  app._scheduleDraw = function () {};
  app._toast = function () {};
  app._persistView = function () { return Promise.resolve(); };
  app.E = CH; app.live = true;
  const d = Mock.generateData(11, 8);
  d.equipment.forEach((e) => { e.fs = 25600; });
  app.data = d;
  app.liveTables = TABLES.slice();
  Object.assign(app.state, { ready: true, tab: 'monitor', monitorOn: true, srcSel: TABLES.slice() }, patch || {});
  return app;
}

// ── 1. 판정 보류 KPI 툴팁 — 결함 패턴 측정 대기·실패도 센다 ─────────────────────
{
  const app = mkApp();
  const eqs = app._activeEqs();
  app._gradeState = {};
  eqs.forEach((e) => { app._gradeState[e.table + ':' + e.name] = { gi: 0, patOk: true, patOn: false }; });
  const k0 = eqs[0].table + ':' + eqs[0].name, k1 = eqs[1].table + ':' + eqs[1].name;
  app._gradeState[k0] = { gi: 1, patOk: false, patMiss: true, patWait: false };
  app._gradeState[k1] = { gi: 0, patOk: false, patMiss: false };
  const hold = app.renderVals().kpiCells.find((c) => c.label === '판정 보류');
  const listed = (hold.tip.match(/ (\d+)대 —/g) || []).reduce((s, x) => s + Number(x.replace(/\D/g, '')), 0);
  chk(hold.count === 2, '보류 대수 = 측정 실패 1 + 판정 못 함 1', hold.count);
  chk(/결함 패턴 측정 대기·실패 1대/.test(hold.tip) && !/NaN/.test(hold.tip), '툴팁에 결함 패턴 측정 대기·실패 대수가 나온다', hold.tip.split('\n').slice(-2).join(' / '));
  chk(listed === hold.count, '툴팁 사유별 대수 합 = 보류 대수(빠진 사유 없음)', listed + '/' + hold.count);
}

// ── 2. 이벤트 목록 — 계측 이상·복귀는 사유, 등급 행은 값·기준 ──────────────────
{
  const app = mkApp({ evtTag: 'all', evtType: 'all' });
  const eq = app._activeEqs()[0];
  const base = { ms: Date.now(), tagId: eq.id, tagAlias: eq.alias || eq.name, tagName: eq.name, unit: 'mm/s', grade: 2, bands: null };
  app.state.events = [
    Object.assign({ id: 'a', type: 'sensor_fault', typeKo: '계측 이상', value: 0, base: 2.8, detail: '플랫라인 — 값이 거의 변하지 않습니다 — 센서 정지·케이블 탈락 의심' }, base),
    Object.assign({ id: 'b', type: 'sensor_ok', typeKo: '계측 복귀', value: 0, base: 0, detail: '계측 정상 복귀' }, base, { grade: 0 }),
    Object.assign({ id: 'c', type: 'threshold', typeKo: '임계 초과', value: 3.1, base: 2.8, detail: '' }, base),
  ];
  const rows = app.renderVals().evtRows;
  const [f, o, t] = ['a', 'b', 'c'].map((id) => rows.find((r) => r.id === id));
  chk(f.valText === '플랫라인' && f.noteText === '' && /케이블 탈락/.test(f.valTip), '계측 이상 — 칸엔 사유, 설명은 호버(값·기준 숫자 없음)', JSON.stringify([f.valText, f.noteText]));
  chk(o.valText === '계측 정상 복귀' && o.noteText === '' && o.valTip === '', '계측 복귀 — 사유만', JSON.stringify([o.valText, o.noteText, o.valTip]));
  chk(/3\.1/.test(t.valText) && /^기준 2\.8/.test(t.noteText), '등급 행은 예전처럼 값 · 기준', t.valText + ' · ' + t.noteText);
}

// ── 3. 근거 블록 — 커토그램 상한 출처 ───────────────────────────────────
{
  const app = mkApp();
  const eq = Object.assign({}, app._activeEqs()[0], { unit: 'mm/s', rpm: 1800, meta: {}, bearing: { model: '', n: 0, Bd: 0, Pd: 0, phi: 0 } });
  const det = Mock.buildDetail(eq);
  const cap = (src, m, a, r) => {
    Object.assign(det, { mount: m ? 'magnet' : '', mountFmax: m, aliasFmax: a, rollFmax: r, kgCapSrc: src, kgFmax: Math.min.apply(null, [m, a, r].filter((x) => x > 0)), kgCapped: true });
    return (app._evidence(eq, det).block.split('\n').find((l) => l.indexOf('■ 결함 대역 탐색 상한') === 0) || '');
  };
  const r = cap('rolloff', 0, 0, 10240);
  chk(/AA 롤오프\(Nyquist의 80%\) 10\.2 kHz/.test(r) && /적용 10\.2 kHz\(AA 롤오프 기준\)/.test(r) && !/마운팅/.test(r),
    '마운팅 미설정 — 롤오프 상한을 마운팅으로 적지 않는다', r);
  const m = cap('mount', 2000, 0, 10240);
  chk(/적용 2\.0 kHz\(마운팅 기준\)/.test(m), '마운팅이 가장 낮으면 마운팅 기준', m);
  det.accelNyqFrac = 0.9;   // 에일리어싱 의심 조건(f_eff > Nyquist의 80%)
  const a = cap('alias', 0, 6400, 10240);
  chk(/적용 6\.4 kHz\(에일리어싱 기준\)/.test(a), '에일리어싱 의심이 가장 낮으면 에일리어싱 기준', a);
}

// ── 4. 안내 문구 — 없는 동작을 말하지 않음 ────────────────────────────────
{
  const app = mkApp({ tab: 'settings', setSection: 'criteria' });
  const vm = app.renderVals();
  const tips = Object.keys(vm.helpTip).map((k) => vm.helpTip[k]).join('\n');
  chk(!/RMS 알람/.test(tips), '진폭(RMS) 알람이 따로 있다고 말하지 않는다 — 등급은 결함 패턴이 켬');
  chk(/결함 패턴을 재서 등급/.test(vm.helpTip['대역 추출 주기']), '추출 주기가 등급 회차를 정한다고 알린다');
  chk(!/단위별 임계값으로 판정/.test(vm.helpTip['단위']) && /속도로 환산/.test(vm.helpTip['단위']), '가속도·변위도 속도로 환산해 Class 경계로 판정');
  chk(!/주의로 표시됩니다/.test(vm.helpTip['A/B']) && /등급을 바꾸지 않습니다/.test(vm.helpTip['A/B']), 'A/B 경계는 등급을 바꾸지 않는다(패턴 켜지면 최소 주의)');
  const src = (await import('node:fs')).readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
    + (await import('node:fs')).readFileSync(new URL('../src/view.js', import.meta.url), 'utf8');
  const bad = ['이탈 이벤트가 생성', '이벤트를 추가로 생성', '임계 초과·베이스라인 이탈 시 이벤트', '이벤트 해설', '알람이 나는 값', '커토그램 선택 대역을 그대로 신뢰', '두 가지 기준']
    .filter((p) => src.indexOf(p) >= 0);
  chk(!bad.length, '베이스라인·대역은 이벤트·알림이 없다 — 옛 문구 잔존 없음', bad.join(' | '));
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
