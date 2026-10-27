/* 벨트 종동축 센서 — 센서 위치(모터측/종동측)에 따른 회전수가 모든 경로에서 같은지
   · 종동측 = 잰 종동축 회전수 우선, 없으면 모터 RPM × D1/D2, 둘 다 없으면 0(측정 불가)
   · 감시(앱·서버 스펙)·대역 추출·상세분석·리포트·LLM 입력·설정 화면이 같은 값, 모터측은 입력 RPM 그대로
   · 벨트 진단 가설은 반대쪽 축(모터) 1×로 귀속, 실측값 저장은 종동축 칸, 일괄 적용에 센서 위치 포함
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;

// live.js가 로드 시점에 DB 함수를 캡처 — 스텁은 import 전에 설치
const DB = (await import('../../cgi-bin/db/db.js')).default;
const T0 = 1700000000000, FS = 25600, SPAN = 600;
DB.listTags = () => Promise.resolve(['FAN', 'MOTOR', 'BARE']);
DB.tagStats = () => Promise.resolve(Object.fromEntries(['FAN', 'MOTOR', 'BARE'].map((t) => [t, { count: FS * SPAN, minMs: T0, maxMs: T0 + SPAN * 1000 }])));
DB.rollupTrend = () => Promise.resolve([]);
DB.isNoRollup = () => false;

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { buildLiveData, emptyDet } = await import('../src/data/live.js');
const { App } = await import('../src/app.js');
const { view } = await import('../src/view.js');
const renderToString = (await import('preact-render-to-string')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const BELT = { d1: 100, d2: 160, len: 1200 };
const DRIVEN = 1780 * 100 / 160;   // 1112.5 — 풀리 환산 종동축

// ── 회전수 규칙 ──────────────────────────────────────────────────────────
{
  const s = (rpm, meta) => VC.shaftRpm(rpm, meta);
  chk(s(1780, {}).rpm === 1780 && s(1780, {}).src === 'motor', '구동 미상 — 입력 RPM 그대로');
  chk(s(1780, { drive: 'belt', belt: BELT }).rpm === 1780, '벨트라도 모터측(기본) — 입력 RPM 그대로');
  chk(s(1780, { drive: 'direct', sensorPos: 'driven', belt: BELT }).src === 'motor', '직결이면 센서 위치 무시');
  const p = s(1780, { drive: 'belt', sensorPos: 'driven', belt: BELT });
  chk(p.rpm === DRIVEN && p.src === 'pulley', '종동측 — 모터 RPM × D1/D2 = 1112.5', JSON.stringify(p));
  const m = s(1780, { drive: 'belt', sensorPos: 'driven', belt: Object.assign({ drivenRpm: 1095 }, BELT) });
  chk(m.rpm === 1095 && m.src === 'measured', '잰 종동축 회전수가 있으면 그 값 우선(풀리 환산보다)');
  const x = s(1780, { drive: 'belt', sensorPos: 'driven', belt: {} });
  chk(x.rpm === 0 && x.src === 'missing', '종동측인데 풀리경·잰 값 없음 — 0(모터 RPM으로 대조하지 않음)');
}

// ── 설비 데이터 — 한 곳에서 바꿔 모든 경로가 같은 값 ─────────────────────────
const CFG = {
  srcSel: ['T'], lineHz: '60', monitorOn: true, monMode: 'server', monitorInterval: '3s', bandOn: true, bandInterval: '10m',
  equipRpm: { 'T:FAN': '1780', 'T:MOTOR': '1780', 'T:BARE': '1780' },
  equipBearing: { 'T:FAN': '6208', 'T:MOTOR': '6206', 'T:BARE': '6206' },
  equipMeta: {
    'T:FAN': { drive: 'belt', sensorPos: 'driven', belt: BELT },
    'T:MOTOR': { drive: 'belt', belt: BELT },
    'T:BARE': { drive: 'belt', sensorPos: 'driven', belt: {} },
  },
};
const data = await buildLiveData(CH, ['T'], CFG);
const eqOf = (n) => data.equipment.find((e) => e.name === n);
const fan = eqOf('FAN'), motor = eqOf('MOTOR'), bare = eqOf('BARE');
chk(fan.rpm === DRIVEN && fan.rpmMotor === 1780 && fan.rpmSrc === 'pulley', '종동측 설비 — eq.rpm = 종동축 1112.5, 입력 RPM은 rpmMotor로 보존', JSON.stringify({ rpm: fan.rpm, m: fan.rpmMotor, s: fan.rpmSrc }));
chk(motor.rpm === 1780 && motor.rpmSrc === 'motor', '모터측 설비 — 예전과 같음(입력 RPM)');
chk(bare.rpm === 0 && bare.rpmSrc === 'missing', '종동측인데 풀리경 없음 — 회전수 0(결함 패턴 측정 불가)');

function mkApp() {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app.state.user = 'TESTER';   // 토큰·계정 확인을 마친 상태
  app._toast = () => {};
  app.E = Object.assign({}, CH);
  app.live = true; app.user = 'JOY';
  app.data = { now: T0 + SPAN * 1000, equipment: data.equipment.map((e) => Object.assign({}, e)), events: [], reports: [] };
  Object.assign(app.state, JSON.parse(JSON.stringify(CFG)), { ready: true, tab: 'settings', setSection: 'equip' });
  app._applied = Object.assign({}, app.state);
  return app;
}
const app = mkApp();
const F = app.data.equipment.find((e) => e.name === 'FAN'), M = app.data.equipment.find((e) => e.name === 'MOTOR'), B0 = app.data.equipment.find((e) => e.name === 'BARE');

// 감시 — 앱 판정·서버 스펙·대역 추출
{
  chk(app._patCapable(F) && !app._patCapable(B0), '앱 감시 — 종동측은 잴 수 있고, 풀리경 없는 종동측은 측정 불가');
  chk(app._patBlockedId('T:BARE') && !app._patBlockedId('T:FAN'), '설정 화면 "판정 불가" — 같은 규칙(설정 즉시 반영)');
  const spec = app._monSpec();
  const st = (spec.tags || []).find((t) => t.tag === 'FAN'), sm = (spec.tags || []).find((t) => t.tag === 'MOTOR');
  chk(st && st.rpm === DRIVEN && sm && sm.rpm === 1780, '서버 감시 스펙 — 종동측 1112.5, 모터측 1780', JSON.stringify({ fan: st && st.rpm, motor: sm && sm.rpm }));
  const bt = app._bandTags().tags.find((t) => t.tag === 'FAN');
  chk(bt && Math.abs(bt.fr - DRIVEN / 60) < 0.01, '대역 추출 — 종동축 1×(18.54 Hz) 기준 경계', bt && bt.fr);
}

// 상세분석·리포트·LLM — 표기와 계산
{
  const det = emptyDet(F);
  const dx = app._dx(F, det, VC.sevMetrics([], { zones: F.zones, fs: F.fs }));
  chk(/1112\.5 RPM \(종동축·풀리 환산\)/.test(dx.sub), '상세분석 판정 부제 — 종동축 회전수와 출처', dx.sub);
  const ev = app._evidence(F, det);
  const evTxt = JSON.stringify(ev);
  chk(/■ 회전수: 1112\.5 RPM \(종동축·풀리 환산\) — 모터 1780 RPM\(1× 18\.5 Hz\)/.test(evTxt), '상세분석 근거 — 종동축 회전수·모터 회전수 함께, 1×는 종동축', (evTxt.match(/■ 회전수[^"]{0,70}/) || [''])[0]);
  const llm = String(app._opinionPack(F, det, { flag: false }));
  chk(/1112\.5 RPM \(종동축·풀리 환산\) \(1×=18\.5 Hz/.test(llm), 'LLM 입력 — 종동축 회전수·1×', (llm.match(/\[설비\][^\n]{0,90}/) || [''])[0]);
  // 소견 프롬프트 — 질문 셋 · 설비 담당자 대상 · 조치는 엔진 결정만 · 감시 등급·별점·0점 후보 목록 없음
  const op = String(app._opinionPrompt(F, det, dx, { flag: false }));
  chk(/## 지금 상태\n[\s\S]*## 그렇게 보는 이유\n[\s\S]*## 권장 행동\n/.test(op) && /설비 담당자/.test(op), '소견 프롬프트 — 질문 셋 · 독자 설비 담당자');
  chk(op.includes('[지금 할 일 — 엔진 결정] ' + app._todoText(F, det, dx)) && /\[세부 조치 — 엔진 결정\]\n/.test(op), '소견 프롬프트 — 권장 행동의 출처(지금 할 일 · 세부 조치) 동봉');
  chk(!/감시 등급|실시간 감시|[★☆]|근거점수 0\/100|A\(양호\)/.test(op), '소견 프롬프트 — 감시 등급 · 별점 · 0점 후보 줄 · 등급어 존 이름 없음');
  chk(!/규칙 기반 1차 판정/.test(op) && /· 판정 = /.test(op), '소견 프롬프트 — 판정 문구는 화면 제목과 같은 것');
  const meta = app._reportMeta(F, det, ev, { flag: false }, dx);
  chk(/1112\.5 RPM \(종동축·풀리 환산\)/.test(meta.summary.rpmTxt), '리포트 요약 — 종동축 회전수와 출처', meta.summary.rpmTxt);
  const bf = VC.bearingFreqs(DRIVEN, F.bearing);
  chk(Math.abs(bf.BPFO - VC.bearingFreqs(1780, F.bearing).BPFO * 100 / 160) < 1e-9, '결함 주파수는 종동축 기준(모터 기준의 D1/D2배)', bf.BPFO.toFixed(2) + ' Hz');
  // 화면 판정 영역(상세분석 탭)
  Object.assign(app.state, { tab: 'detail', selTag: F.id, diagTag: F.id });
  app._detailCache[F.id] = { state: 'ready', det, eqSnap: Object.assign({}, F), snapNow: Date.now(), key: app._detailKey() };
  const v = app.renderVals();
  chk(/1112\.5 RPM \(종동축·풀리 환산\)/.test(v.sevMachine), '상세분석 화면 설비 줄', v.sevMachine);
  // 리포트 생성 경로 — sevMachine 식이 콜백 안에서 self로 부름(this면 생성 시 TypeError)
  const src = (await import('node:fs')).readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const gen = src.slice(src.indexOf('  _genOne('), src.indexOf('  _reportMeta(eq, det, ev, rptSat, dx) {'));
  chk(/sevMachine: eq\.name \+ ' · Class ' \+ eq\.cls \+ ' · ' \+ self\._rpmText\(eq\)/.test(gen) && !/this\._rpmText/.test(gen), '리포트 설비 줄도 같은 표기(콜백 안 self)');
  // 종동측 문구에 '명판' 표기 없음 — 켑스트럼 기준 1×·리포트 측정 한계
  const liveSrc = (await import('node:fs')).readFileSync(new URL('../src/data/live.js', import.meta.url), 'utf8');
  const rptSrc = (await import('node:fs')).readFileSync(new URL('../../cgi-bin/report/report.js', import.meta.url), 'utf8');
  // 리포트의 회전수 기준은 FFT 머리의 summary.rpmTxt(위 '리포트 요약' 검사가 종동축 표기 확인)
  chk(/eq\.rpmSrc === 'pulley' \? '종동축 1×\(풀리 환산\) 기준'/.test(liveSrc) && /'회전수 ' \+ sm\.rpmTxt/.test(rptSrc) && !/명판값을/.test(rptSrc),
    '켑스트럼 기준 1×·리포트 회전수 표기 — 종동측을 "명판"이라 하지 않음');
  Object.assign(app.state, { tab: 'settings' });
}

// 벨트 진단 가설 — 센서가 종동축이면 반대쪽(모터) 1×로 귀속
{
  const fr = DRIVEN / 60, fm = 1780 / 60;
  const freqs = [], mags = [];
  for (let f = 0.5; f <= 400; f += 0.5) { freqs.push(f); mags.push(0.01); }
  const put = (f, m) => { const i = Math.round(f / 0.5) - 1; mags[i] = m; };
  put(fm, 1.0); put(2 * fm, 0.5); put(3 * fm, 0.3); put(4 * fm, 0.2); put(fr, 0.15);
  const det = Object.assign(emptyDet(F), { ordSpec: { freqs, mags, res: 0.5, resTrue: 0.5 } });
  const ev = app._evidence(F, det);
  const ind = ev.conf.find((c) => /독립 회전원/.test(c.f));
  chk(ind && ind.tags.some((t) => /벨트 모터 1× 29\.7Hz\(풀리비 1\.60\)와 일치 — 귀속 확정/.test(t)), '지배 비동기 봉우리 29.7 Hz = 모터 1× — 귀속 확정(예전: 종동축 18.5 Hz를 찾아 놓침)', ind && ind.tags.join(' | '));
  const evM = app._evidence(M, Object.assign(emptyDet(M), { ordSpec: { freqs, mags, res: 0.5, resTrue: 0.5 } }));
  const indM = evM.conf.find((c) => /독립 회전원/.test(c.f));
  chk(indM && !indM.tags.some((t) => /귀속 확정/.test(t)), '모터측 센서에서 같은 스펙트럼 — 모터 1×는 동기 성분이라 다른 축 귀속 아님');
  // 비어 있는 설비 정보 — 설정에 입력 칸이 있는 항목만 안내(계측 방향·위상은 앱이 받지 못해 제외)
  const all = ev.missing.join(' · ') + ' / ' + app._metaAction(ev).map((x) => x.t + ' ' + x.w).join(' · ');
  chk(!/계측 방향|위상|축방향/.test(all), '입력 칸이 없는 계측 방향·위상은 미입력 정보·세부 조치에 넣지 않는다', all);
  chk(ev.missNames.length === ev.missing.length && ev.missNames.every((n) => ev.missing.some((m) => m.indexOf(n + '(') === 0))
    && (ev.missNames.length === 0 || (app._metaAction(ev)[0].t === ev.missNames.join(' · ') + ' 입력' && app._metaAction(ev)[0].tag === '정보 입력')),
    '설정할 수 있는 빈 항목은 세부 조치 "설비 정보 입력"에 모두 나온다', ev.missNames.join(','));
  const bare = app._evidence(Object.assign({}, F, { meta: {}, bearing: null }), Object.assign(emptyDet(F), { ordSpec: { freqs, mags, res: 0.5, resTrue: 0.5 } }));
  chk(['베어링 품번', '마운팅 방식', '구동방식'].every((n) => bare.missNames.indexOf(n) >= 0), '품번·마운팅·구동방식이 비면 셋 다 안내', bare.missNames.join(','));
}

// 상세분석 RPM 경고 — 종동측이면 문구·저장처가 종동축
{
  const det = Object.assign(emptyDet(F), { frMeas: { f: 1080 / 60, rpm: 1080, rpmTol: 3, distinct: true } });
  Object.assign(app.state, { tab: 'detail', selTag: F.id, diagTag: F.id });
  app._detailCache[F.id] = { state: 'ready', det, eqSnap: Object.assign({}, F), snapNow: Date.now(), key: app._detailKey() };
  const v = app.renderVals();
  chk(/^종동축 회전수 1112\.5 rpm\(풀리 환산\)이 스펙트럼에서 잰 1080 rpm/.test(v.rpmWarn) && /피치 지름/.test(v.rpmWarn), '경고 — 종동축 회전수 기준·벨트 슬립/피치 지름 안내', v.rpmWarn.slice(0, 60));
  let saved = null;
  app._applyNow = (ov) => { saved = ov; return Promise.resolve(true); };
  app._reloadLive = () => {};
  await v.onRpmWarnAct();
  chk(saved && saved.equipMeta && saved.equipMeta['T:FAN'].belt.drivenRpm === 1080 && !saved.equipRpm && saved.equipMeta['T:FAN'].belt.d1 === 100,
    '"실측값으로 저장" — 모터 RPM이 아니라 종동축 회전수 칸에(풀리경 유지)', JSON.stringify(saved && saved.equipMeta && saved.equipMeta['T:FAN']));
  chk(((app.state.equipMeta['T:FAN'] || {}).belt || {}).drivenRpm === 1080 && app.state.equipRpm['T:FAN'] === '1780', '편집본도 종동축 칸만 바뀜');
  Object.assign(app.state, { tab: 'settings' });
}

// 설정 화면 — 결함 주파수 칩·RPM 칸 꼬리표·벨트 줄
{
  const a2 = mkApp();
  const rows = (() => { const base = {}; a2._vmSettings(base, a2.data.equipment); return base.equipRows; })();
  const rf = rows.find((r) => r.id === 'T:FAN'), rm = rows.find((r) => r.id === 'T:MOTOR'), rb = rows.find((r) => r.id === 'T:BARE');
  const chip = (r, k) => (r.freqChips.find((c) => c.label === k) || {}).val;
  chk(chip(rf, '1× 회전') === '18.5' && chip(rm, '1× 회전') === '29.7', '결함 주파수 칩 — 종동측은 종동축(18.5 Hz), 모터측은 그대로(29.7 Hz)', chip(rf, '1× 회전') + ' / ' + chip(rm, '1× 회전'));
  chk(rf.rpmTag === '종동' && /종동축 1112\.5 rpm으로 대조 \(풀리비 0\.625 환산\)/.test(rf.rpmTagTip) && !rm.rpmTag, 'RPM 칸 꼬리표 "종동" + 툴팁(대조 회전수), 모터측은 없음', rf.rpmTagTip);
  chk(/결함 대조 회전수 1112\.5 rpm \(종동축 · 풀리 환산\)/.test(rf.beltRatio) && /종동축 1× 18\.5 Hz/.test(rm.beltRatio), '벨트 줄 안내 — 종동측은 대조 회전수, 모터측은 예전 문구', rf.beltRatio);
  chk(/잴 수 있습니다/.test(rb.beltRatio) && /잴 수 없습니다/.test(rb.rpmTagTip), '풀리경 없는 종동측 — 측정 불가 안내');
  chk(rf.beltRpmPh === '1112.5 (풀리 환산)', '종동축 회전수 칸 — 비우면 쓰일 환산값을 회색 글씨로', rf.beltRpmPh);
  a2._setEquipMeta('T:MOTOR', 'sensorPos', 'driven');
  chk(a2.state.equipMeta['T:MOTOR'].sensorPos === 'driven', '센서 위치 종동측 저장');
  a2._setEquipMeta('T:MOTOR', 'sensorPos', 'motor');
  chk(!('sensorPos' in a2.state.equipMeta['T:MOTOR']), '모터측으로 되돌리면 키 삭제(기존 설정과 같은 모양)');
  a2.state.equipAdv = { 'T:FAN': true };
  const htm = renderToString(view(a2.renderVals()));
  chk(/>종동<\/span>/.test(htm) && /<option[^>]*value="driven">종동측<\/option>/.test(htm) && /placeholder="1112\.5 \(풀리 환산\)"/.test(htm), '화면 — RPM 칸 꼬리표·센서 위치 선택·종동축 회전수 칸');
  // 일괄 적용 — 센서 위치·종동축 회전수도 복사
  a2.state.equipMeta['T:FAN'] = { drive: 'belt', sensorPos: 'driven', belt: Object.assign({ drivenRpm: 1095 }, BELT) };
  a2.state.equipBulk = { id: 'T:FAN', scope: '', fields: {} };
  const rf2 = (() => { const base = {}; a2._vmSettings(base, a2.data.equipment); return base.equipRows.find((r) => r.id === 'T:FAN'); })();
  const ks = (rf2.bulkFields || []).map((f) => f.k);
  chk(ks.includes('beltPos') && ks.includes('beltRpm'), '일괄 적용 칩 — 센서 위치·종동축 회전수', ks.join(','));
  a2._applyEquipBulk('T:FAN', ['T:MOTOR'], { drive: true, beltPos: true, beltD1: true, beltD2: true, beltRpm: true });
  const mm = a2.state.equipMeta['T:MOTOR'];
  chk(mm.sensorPos === 'driven' && mm.belt.drivenRpm === 1095 && mm.belt.d2 === 160, '대상에 센서 위치·종동축 회전수 복사', JSON.stringify(mm));
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
