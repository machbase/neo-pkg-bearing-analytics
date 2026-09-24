/* 서버 감시의 ISO 판정 단위 — 오프라인(Neo 불필요). npm run smoke에 포함.

   ISO 10816 존은 속도(mm/s) 규격이다. 앱은 가속도·변위 원본을 속도로 바꾼 뒤 ISO를 재고
   클래스별 mm/s 경계로 판정한다. 서버 감시가 원본 그대로 재서 원본 단위 존에 대면 같은 신호가
   앱과 서버에서 다른 등급이 된다(가속도 태그의 알림 등급이 화면과 갈린다).
   생성된 TQL의 원문을 떼어내 앱 계산과 같은 값·같은 등급이 나오는지 본다 — 옮겨 적으면
   생성기가 바뀌어도 테스트만 통과한다. */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { buildMonitorTql, validateSpec } = (await import('../../cgi-bin/monitor/monitor.js')).default;
const Notify = (await import('../../cgi-bin/notify/notify.js')).default;
const { judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

// ── 변환 정확도 — 해석해와 대조 ─────────────────────────────────────────
{
  const FS = 4096, N = 4096, F = 100;   // 창 안에 정수 주기 — 누설 없이 해석해와 맞는다
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

// ── 서버 임베드 소스가 자체 완결인가(모듈 상수를 참조하면 압축본 서버에서만 죽는다) ──
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

// 4.0 mm/s RMS @30 Hz(1×)에 해당하는 가속도 신호 — 클래스 II에서 '위험'(2.8~7.1) 구간이다
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
  WVAL[KEY] = [{ rms: 3.0, cnt: FS }];   // 원본 단위(g)로 양호 경계 위 — 조용하지 않다
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
// 조용한 가속도 태그 — 전대역 지름길은 안 쓰고 재측정 간격만 늘린다(앱과 같은 30초/5분)
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
// 속도 원본은 예전과 같다 — 변환 없음·지름길 유지
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
/* 가속도·변위 설비의 등급 이벤트는 원본 단위 값만 적는다. 등급은 속도 ISO로 매기므로 원본 단위의
   "기준" 숫자가 없다 — 숫자를 비우고 근거(ISO 존·결함 패턴)를 DETAIL 머리에 말로 적는다. */
{
  const L = [line('var nat = !isS'), line('var v2 = isS'), line('var l2 = nat'), line('if(nat) dt = ')].join('\n');
  const GWk = ['양호', '주의', '위험', '심각'];
  const run = (t, ev, dt) => new Function('t', 'z', 'val', 'wide', 'isS', '_hG', 'GW', 'ev', 'dt',
    L + '\nreturn {v2:v2, l2:l2, dt:dt, nat:nat};')(t, t.isoZones || t.zones, 3.975, 0.077, false, 2, GWk, ev, dt);
  const jd = '격자 3.1 · 외륜(BPFO) · 2회 연속 확정';
  const a = run(T, { etype: 'threshold', gi: 2 }, jd);
  chk(a.nat && a.v2 === 0.077 && a.l2 === 0, '가속도 설비: 값은 원본 단위 구간 RMS, 기준 숫자는 비운다', JSON.stringify(a));
  chk(a.dt === 'ISO 위험 구간 · ' + jd, '근거를 DETAIL 머리에 말로 적는다', a.dt);
  chk(Notify.basisText(a.dt) === 'ISO 위험 구간 · 결함 패턴 외륜(BPFO)', '화면·알림의 근거 문구', Notify.basisText(a.dt));
  const r = run(T, { etype: 'recovery', gi: 0 }, '2시간 만에 복귀');
  chk(r.v2 === 0.077 && r.l2 === 0 && Notify.basisText(r.dt) === 'ISO 위험 구간', '복귀도 원본 단위 값 + ISO 존만(패턴 부위 없음)', r.dt);
  const d = run(Object.assign({}, T, { unit: 'mm/s' }), { etype: 'threshold', gi: 1 }, 'x');
  chk(!d.nat && d.v2 === 3.975 && d.l2 === 1.12 && d.dt === 'x', '속도 설비는 예전과 같다 — ISO 값·ISO 경계', JSON.stringify(d));

  const m = Notify.eventMessage({ alias: '펌프', tag: 'A', typeKo: '임계 초과', gradeKo: '위험', etype: 'threshold',
    val: 0.077, lim: null, unit: 'g', detail: a.dt, timeText: 'T' });
  chk(/0\.077 g · ISO 위험 구간 · 결함 패턴 외륜\(BPFO\)/.test(m.text) && !/기준/.test(m.text), '알림도 원본 단위 값 + 근거 문구(기준 숫자 없음)', m.text.split('\n')[1]);
  const m2 = Notify.eventMessage({ alias: '펌프', tag: 'A', typeKo: '임계 초과', gradeKo: '주의', etype: 'threshold',
    val: 3.975, lim: 1.12, unit: 'mm/s', detail: 'x', timeText: 'T' });
  chk(/3\.975 mm\/s \/ 기준 1\.120/.test(m2.text), '속도 설비 알림은 예전과 같다(값 / 기준)', m2.text.split('\n')[1]);
  chk(Notify.basisText('') === '' && Notify.basisText('격자 2.0 · 2회 연속 확정') === '', '근거가 없으면 빈 문자열(부위 자리에 확정 문구를 잡지 않는다)');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
