/* 서버 감시의 ISO 판정 단위 — 가속도·변위 원본을 속도로 환산해 ISO를 재고 mm/s 존으로 판정(앱과 같은 값·등급)
   · 변환 정확도·convSrc 자체 완결·조용한 태그 재측정 간격·패턴 높이·이벤트 값/근거 원본 단위 표기
   · 속도 설비 이벤트 값 = 등급 높이를 정한 ISO(패턴을 잰 파형) — 1초 창 ISO를 적으면 값<기준인 위험 행 가능
   · 생성된 TQL 원문을 떼어내 실행(옮겨 적지 않음)
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
// 앱 판정 루프 실행용 — 콘솔 계정·토큰·DB 응답 흉내, 보낸 SQL 기록
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ls = { accessToken: `h.${b64({ sub: 'alpha' })}.sig`, 'neo-pkg-bearing-analytics.token.ALPHA': 'nt_a_' + 'A'.repeat(43) };
globalThis.localStorage = { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } };
const sent = [];
globalThis.fetch = async (p) => { sent.push(decodeURIComponent(String(p))); return { ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }), text: async () => '' }; };
const DB = (await import('../../cgi-bin/db/db.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { buildMonitorTql, validateSpec } = (await import('../../cgi-bin/monitor/monitor.js')).default;
const Notify = (await import('../../cgi-bin/notify/notify.js')).default;
const { judgeTick, App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

// ── 변환 정확도 — 해석해와 대조 ─────────────────────────────────────────
{
  const FS = 4096, N = 4096, F = 100;   // 창 안에 정수 주기 — 누설 없이 해석해와 일치
  const sine = Array.from({ length: N }, (_, i) => Math.sin(2 * Math.PI * F * i / FS));
  const v = VC.convertDomain(sine, FS, 'g', 'mm/s', 0);
  chk(near(rms(v) / rms(sine), 9806.65 / (2 * Math.PI * F), 0.005), '가속도 → 속도는 적분(1/ω) — 1 g RMS @100 Hz = 15.608 mm/s', (rms(v) / rms(sine)).toFixed(3));
  const x = VC.convertDomain(sine, FS, 'μm', 'mm/s', 0);
  chk(near(rms(x) / rms(sine), 2 * Math.PI * F * 1e-3, 0.005), '변위 → 속도는 미분(ω) — 1 μm RMS @100 Hz = 0.628 mm/s', (rms(x) / rms(sine)).toFixed(4));
  const back = VC.convertDomain(v, FS, 'mm/s', 'g', 0);
  chk(near(rms(back), rms(sine), 0.005), '왕복 변환이 원래 크기로 돌아온다');
  chk(JSON.stringify([VC.unitScale('g'), VC.unitScale('mm/s'), VC.unitScale('μm'), VC.unitScale('')])
    === JSON.stringify([[9.80665, 2], [1e-3, 1], [1e-6, 0], null]), '단위 표(SI 배율·차수)가 그대로다');
  chk(VC.convertDomain(sine, FS, '', 'mm/s', 0)[7] === sine[7], '모르는 단위는 변환하지 않는다(원본 그대로)');
}

// ── 서버 임베드 소스 자체 완결(모듈 상수 참조 시 압축본 서버에서만 죽음) ──
{
  const FS = 12000, raw = Array.from({ length: 12000 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 47 * i / FS) + 0.05 * Math.sin(2 * Math.PI * 2100 * i / FS));
  let iso, err = '';
  try {
    iso = new Function('raw', 'FS', VC.convSrc() + '\nvar v = convertDomain(raw, FS, "g", "mm/s", 29.3);'
      + '\nreturn { v: v, a: bandRmsAveraged(v, FS, 10, 1000, 8).rms };')(raw, FS);
  } catch (e) { err = e.message; }
  chk(!err, 'convSrc 격리 실행 — 자유 식별자 없음', err);
  const appV = VC.convertDomain(raw, FS, 'g', 'mm/s', 29.3);
  chk(!err && iso.v.every((x, i) => x === appV[i]), '격리 실행한 변환이 앱과 비트 단위로 같다');
  chk(!err && iso.a === VC.bandRmsAveraged(appV, FS, 10, 1000, 8).rms, '격리 실행한 대역 평균이 앱과 같다');
}

// ── 생성 TQL 원문 ───────────────────────────────────────────────────────
const FS = 25600, RPM = 1758, fr = RPM / 60;
const Zg = [0.5, 1, 2], Ziso = [1.12, 2.8, 7.1];
const spec = {
  judgeSrc: judgeTick.toString(), isoSrc: VC.isoSrc(), convSrc: VC.convSrc(), gateSrc: VC.gateSrc(),
  isoTtlMs: 30000, isoQuietMs: 300000, isoWinMs: 1000, tickMs: 3000,
  tags: [{ tbl: 'T', tag: 'A', unit: 'g', fs: FS, rpm: RPM, zones: Zg, isoZones: Ziso, bl: null, bb: null }],
  cfg: { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 0, 3: 0 } },
};
const tql = buildMonitorTql(spec);
chk(validateSpec(spec) === null, '사전 실행 검사 통과(변환 함수 포함)');
const fnSrc = (name) => {
  const s = tql.indexOf('function ' + name + '(');
  if (s < 0) throw new Error(name + ' 원문을 못 찾았다 — 생성기 구조가 바뀌었다');
  let d = 0;
  for (let i = tql.indexOf('{', s); i < tql.length; i++) {
    if (tql[i] === '{') d++;
    else if (tql[i] === '}' && !--d) return tql.slice(s, i + 1);
  }
  throw new Error(name + ' 괄호가 안 닫힌다');
};
const line = (needle) => {
  const l = tql.split('\n').find((x) => x.includes(needle));
  if (!l) throw new Error('원문 줄을 못 찾았다: ' + needle);
  return l.trim();
};

// 4.0 mm/s RMS @30 Hz(1×)에 해당하는 가속도 신호 — 클래스 II '위험'(2.8~7.1) 구간
const VRMS = 4.0, F1 = 29.3;
const aPeakG = VRMS * Math.SQRT2 * 2 * Math.PI * F1 / 9806.65;
const rawG = Array.from({ length: FS }, (_, i) => aPeakG * Math.sin(2 * Math.PI * F1 * i / FS) + 0.002 * Math.sin(2 * Math.PI * 3100 * i / FS));

function mkIsoValue(rows, nowMs) {
  const db = { query() { return rows.map((v) => [v]); } };
  return new Function('db', 'now', 'esc', 'dtms', 'LAST', 'WVAL', 'GRAW', 'IMP', 'srcOf',
    'isoNeeded', 'isoSkippable', 'isoRms', 'gateFromRaw', 'impactEvidence', 'convertDomain',
    fnSrc('isoValue') + '\nreturn isoValue;')(db, nowMs, (s) => s, () => '', {}, WVAL, {}, {}, (t) => t,
    VC.isoNeeded, VC.isoSkippable, VC.isoRms, VC.gateFromRaw, VC.impactEvidence, VC.convertDomain);
}
const WVAL = {};
const T = spec.tags[0], KEY = 'T:A', NOW = 1700000000000;

// 10초 축 ISO — 앱 _isoRefresh와 같은 계산(변환 → 버터워스 ISO)
{
  WVAL[KEY] = [{ rms: 3.0, cnt: FS }];   // 원본 단위(g)로 양호 경계 위 — 조용하지 않음
  const r = mkIsoValue(rawG, NOW)(T, 3.0, null, KEY, false);
  const app = VC.isoRms(VC.convertDomain(rawG, FS, 'g', 'mm/s', RPM / 60), FS);
  chk(r.fresh && r.v === app, '서버 10초 축 ISO가 앱 계산과 같다(속도 변환 후)', r.v && r.v.toFixed(3));
  chk(near(r.v, VRMS, 0.03), '가속도 원본에서 속도 ISO가 제대로 나온다 (4.0 mm/s)', r.v && r.v.toFixed(3));

  const z = new Function('t', line('var z=') + ' return z;')(T);
  chk(JSON.stringify(z) === JSON.stringify(Ziso), '등급은 ISO 존(mm/s)으로 매긴다 — 원본 단위 존이 아니다');
  const g = VC.gradeFor(r.v, z);
  chk(g === 2, "4.0 mm/s는 클래스 II '위험' — 앱과 같은 등급", g);
  chk(VC.gradeFor(rms(rawG), Zg) === 0, '(고치기 전 방식: 원본 g를 g 존에 대면 양호로 나왔다)');
}
// 조용한 가속도 태그 — 전대역 지름길 없이 재측정 간격만 늘림(앱과 같은 30초/5분)
{
  WVAL[KEY] = [{ rms: 0.1, cnt: FS }];   // 원본 단위 양호 경계(0.5 g) 미만
  const iv = mkIsoValue(rawG, NOW);
  const cached = iv(T, 0.1, { iso: 1.23, isoAt: NOW - 120000 }, KEY, false);
  chk(!cached.fresh && cached.v === 1.23, '조용하면 5분 안의 직전 값을 쓴다(2분 전 측정)');
  const stale = iv(T, 0.1, { iso: 1.23, isoAt: NOW - 400000 }, KEY, false);
  chk(stale.fresh && stale.v !== 0.1, '5분이 지나면 다시 잰다 — 전대역(원본 단위)을 ISO 값으로 쓰지 않는다');
  const busy = iv(T, 0.1, { iso: 1.23, isoAt: NOW - 120000 }, KEY, true);
  chk(busy.fresh, '베이스라인 근처(near)면 30초 간격으로 돌아간다');
}
// 속도 원본 — 변환 없음·지름길 유지
{
  const Tv = Object.assign({}, T, { unit: 'mm/s', zones: Ziso });
  const rawV = Array.from({ length: FS }, (_, i) => 3 * Math.sin(2 * Math.PI * F1 * i / FS));
  WVAL[KEY] = [{ rms: 5, cnt: FS }];
  const r = mkIsoValue(rawV, NOW)(Tv, 5, null, KEY, false);
  chk(r.v === VC.isoRms(rawV, FS), '속도 원본은 변환 없이 잰다(예전과 같은 값)');
  WVAL[KEY] = [{ rms: 0.5, cnt: FS }];
  const q = mkIsoValue(rawV, NOW)(Tv, 0.5, null, KEY, false);
  chk(!q.fresh && q.v === 0.5, '속도 원본의 전대역 지름길은 그대로다(ISO ≤ 전대역)');
}
// 결함 패턴의 높이 — 앱 monPattern과 같은 계산(변환 → 10~1000 Hz 8블록 평균)
{
  chk(tql.includes('if(vals.length > need) vals = vals.slice(vals.length - need);'), '패턴 창은 최신 쪽 필요한 표본만 쓴다(앱과 같은 창)');
  const a = tql.indexOf('var _iv = null; try{'), b = tql.indexOf('}catch(e){}', a);
  if (a < 0 || b < 0) throw new Error('패턴 ISO 원문을 못 찾았다');
  const snip = tql.slice(a, b + '}catch(e){}'.length);
  const run = new Function('vals', 't', 'fr', 'convertDomain', 'bandRmsAveraged', snip + '\nreturn _iv;');
  const got = run(rawG, T, fr, VC.convertDomain, VC.bandRmsAveraged);
  const app = VC.bandRmsAveraged(VC.convertDomain(rawG, FS, 'g', 'mm/s', fr), FS, 10, 1000, 8).rms;
  chk(got === app, '서버 패턴 높이 ISO가 앱과 같다', got && got.toFixed(3));
  chk(VC.gradeFor(got, Ziso) === 2, "패턴 높이도 '위험'");
}

// ── 이벤트 값·기준 — 원본 단위 표기 ─────────────────────────────────────
/* 가속도·변위 설비 등급 이벤트 — 원본 단위 값만, 기준 숫자는 비우고 근거(ISO 존·결함 패턴)를 DETAIL 머리에 말로 기록
   · 등급은 속도 ISO로 매겨 원본 단위 기준값이 없음 */
{
  const L = [line('var _hv = '), line('var nat = !isS'), line('var v2 = isS'), line('var l2 = '), line('if(nat) dt = ')].join('\n');
  const GWk = ['양호', '주의', '위험', '심각'];
  const run = (t, ev, dt, pv, val, isS) => new Function('t', 'z', 'val', 'wide', 'isS', '_hG', 'GW', 'ev', 'dt', '_pv',
    L + '\nreturn {v2:v2, l2:l2, dt:dt, nat:nat};')(t, t.isoZones || t.zones, val == null ? 3.975 : val, 0.077, !!isS, 2, GWk, ev, dt, pv || null);
  const jd = '격자 3.1 · 외륜(BPFO) · 2회 연속 확정';
  const a = run(T, { etype: 'threshold', gi: 2 }, jd);
  chk(a.nat && a.v2 === 0.077 && a.l2 === 0, '가속도 설비: 값은 원본 단위 구간 RMS, 기준 숫자는 비운다', JSON.stringify(a));
  chk(a.dt === 'ISO 위험 구간 · ' + jd, '근거를 DETAIL 머리에 말로 적는다', a.dt);
  chk(Notify.basisText(a.dt) === 'ISO 위험 구간 · 결함 패턴 외륜(BPFO)', '화면·알림의 근거 문구', Notify.basisText(a.dt));
  const r = run(T, { etype: 'recovery', gi: 0 }, '2시간 만에 복귀');
  chk(r.v2 === 0.077 && r.l2 === 0 && Notify.basisText(r.dt) === 'ISO 위험 구간', '복귀도 원본 단위 값 + ISO 존만(패턴 부위 없음)', r.dt);
  const d = run(Object.assign({}, T, { unit: 'mm/s' }), { etype: 'threshold', gi: 1 }, 'x');
  chk(!d.nat && d.v2 === 3.975 && d.l2 === 1.12 && d.dt === 'x', '속도 설비는 예전과 같다 — ISO 값·ISO 경계', JSON.stringify(d));
  // 서버 — 높이를 정한 ISO(패턴 파형 2.9, 위험)와 1초 창 ISO(2.75, 주의 구간)가 다를 때
  const sv = run(Object.assign({}, T, { unit: 'mm/s' }), { etype: 'threshold', gi: 2 }, 'x', { iso: 2.9 }, 2.75);
  chk(sv.v2 === 2.9 && sv.l2 === 2.8 && sv.v2 >= sv.l2, '서버: 속도 설비 이벤트 값 = 등급 높이를 정한 ISO(예전: 1초 창 2.75 < 기준 2.8인 위험 행)', JSON.stringify(sv));
  const sv0 = run(Object.assign({}, T, { unit: 'mm/s' }), { etype: 'threshold', gi: 2 }, 'x', null, 2.75);
  chk(sv0.v2 === 2.75, '패턴 ISO가 없으면 높이도 1초 창 값이라 그 값 그대로');
  // 계측 이상·복귀 — 지표값 없음, 앱 _judgeLive와 같이 값·기준 모두 0
  const sf = run(Object.assign({}, T, { unit: 'mm/s' }), { etype: 'sensor_fault', gi: 2 }, '플랫라인 — x', null, null, true);
  const so = run(T, { etype: 'sensor_ok', gi: 0 }, '계측 정상 복귀', null, null, true);
  chk(sf.v2 === 0 && sf.l2 === 0 && so.v2 === 0 && so.l2 === 0 && sf.dt === '플랫라인 — x',
    '서버: 계측 이상·복귀는 값·기준 0(예전: 존 경계가 기준으로 저장돼 목록에 "0 · 기준 2.8")', JSON.stringify([sf, so]));

  const m = Notify.eventMessage({ alias: '펌프', tag: 'A', typeKo: '임계 초과', gradeKo: '위험', etype: 'threshold',
    val: 0.077, lim: null, unit: 'g', detail: a.dt, timeText: 'T' });
  chk(/0\.077 g · ISO 위험 구간 · 결함 패턴 외륜\(BPFO\)/.test(m.text) && !/기준/.test(m.text), '알림도 원본 단위 값 + 근거 문구(기준 숫자 없음)', m.text.split('\n')[1]);
  const m2 = Notify.eventMessage({ alias: '펌프', tag: 'A', typeKo: '임계 초과', gradeKo: '주의', etype: 'threshold',
    val: 3.975, lim: 1.12, unit: 'mm/s', detail: 'x', timeText: 'T' });
  chk(/3\.975 mm\/s \/ 기준 1\.120/.test(m2.text), '속도 설비 알림은 예전과 같다(값 / 기준)', m2.text.split('\n')[1]);
  chk(Notify.basisText('') === '' && Notify.basisText('격자 2.0 · 2회 연속 확정') === '', '근거가 없으면 빈 문자열(부위 자리에 확정 문구를 잡지 않는다)');
}

// 앱 모드 판정 — 실제 판정 루프가 저장하는 이벤트 행
{
  DB.setUser('ALPHA');
  const app = new App({ seed: 7, equipmentCount: 1 });
  app.setState = function (st) { Object.assign(this.state, st); }; app.forceUpdate = () => {}; app._toast = () => {};
  app.E = CH; app.live = true; app.user = 'ALPHA';
  const eq = { id: 'T:A', table: 'T', name: 'A', alias: 'A', unit: 'mm/s', zones: Ziso, fs: FS, rpm: RPM, secBuckets: [], lastSeen: Date.now() };
  app.data = { now: Date.now(), equipment: [eq], events: [], reports: [] };
  app._applied = Object.assign({}, app.state, { monitorOn: true, monMode: 'app', monitorInterval: '3s', renotify: { '주의': '0', '위험': '0', '심각': '0' } });
  app._isLead = () => true; app._checkIdentity = () => true;
  app._activeEqs = () => [eq]; app._evalValue = () => 3.0;
  app._isoValue = () => ({ v: 2.75, basis: 'iso' });                                   // 1초 창 ISO — 주의 구간
  app._refreshBandNow = () => {}; app._refreshPatNow = () => {};
  app._patNow = { 'T:A': { on: true, iso: 2.9, r: 40, at: NOW, key: 'BPFO' } };        // 패턴 파형 ISO — 위험 구간
  app._patCapable = () => true; app._isoZones = () => Ziso; app._monState = {};
  sent.length = 0;
  await app._judgeLive();
  await new Promise((r) => setTimeout(r, 20));
  const ins = sent.find((q) => /insert into \S+EVENTS values/.test(q)) || '';
  const m = /values\('[^']*', [^,]*\([^)]*\), ([\d.]+), '(\w+)', '([^']+)', ([\d.]+),/.exec(ins);
  chk(m && m[2] === 'observe' && m[3] === '위험' && +m[1] === 2.9 && +m[4] === 2.8,
    '앱: 이벤트 행 = 위험 · 값 2.9 · 기준 2.8 (예전: 값 2.75 — 기준보다 낮은 위험)', m ? m.slice(1).join(' / ') : ins.slice(0, 160));
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
