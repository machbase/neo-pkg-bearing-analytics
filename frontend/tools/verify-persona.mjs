// 페르소나 판정 규칙(R1~R12) 기계 검사 — 진단 로직(calc/live/app) 수정 시 회귀 확인
// · 라이브(Neo + 로그인 계정의 BEARING 테이블 데이터 필요) · npm run verify:live 포함
//   NEO_TOKEN=nt_… node tools/verify-persona.mjs [테이블]
await import('./_liveauth.mjs');   // 신원(NEO_TOKEN) — 없으면 건너뜀

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const L = await import('../src/data/live.js');
const { App, normCfg } = await import('../src/app.js');
const { readFileSync } = await import('node:fs');

// 설비 설정 = 로그인 계정의 저장 설정(앱 부팅과 같은 경로) — 빈 cfg면 전부 폴백이라 실제 앱과 다른 것을 검증
const CFG = normCfg(await L.loadConfig());
const TBL = process.argv[2] || 'BEARING';
if (!(await L.listTagTables()).includes(TBL)) { console.log('건너뜀 — 이 계정에 ' + TBL + ' 테이블 없음(테이블 이름을 인자로)'); process.exit(0); }

const data = await L.buildLiveData(Object.assign({}, CH), [TBL], CFG);
const app = new App({}); app.E = Object.assign({}, CH); app.live = true; app.data = data;
const eq = data.equipment[0];
app.state.selTag = eq.id;
const anchor = app._detailAnchorMs(eq), vu = app.state.viewUnit || null;
const det = await L.liveDetail(app.E, eq, anchor, vu);
app._detailCache[eq.id] = { state: 'ready', det, anchor, viewUnit: vu, eqSnap: Object.assign({}, eq), snapNow: Date.now() };
const ev = app._evidence(eq, det);   // det 전달 — 앵커 재계산으로 캐시가 버려지지 않게
const dx = app._dx(eq, det);
const pack = app._opinionPack(eq, det, app._kurtSat(eq));

let pass = 0, fail = 0;
const chk = (id, ok, msg) => { if (ok) { pass++; console.log(`  PASS ${id} — ${msg}`); } else { fail++; console.log(`  FAIL ${id} — ${msg}`); } };

console.log(`\n=== 페르소나 규칙 검사 (${eq.name}) ===`);
const gate = !!(det.quality && det.quality.gate);
const hasBearing = !!(eq.bearing && eq.bearing.n > 0);
console.log(`  (컨텍스트: gate=${gate} · 베어링=${hasBearing ? eq.bearing.model : '미지정'} · 분해능=${det.fft.res ? det.fft.res.toFixed(2) : '?'}Hz · 창=${det.anaSec ? det.anaSec.toFixed(2) : '?'}s)\n`);

// R1: 규격은 정의된 물리량·대역·평균화로만 — ISO 판정은 대역제한 값
chk('R1', det.isoRms != null && /ISO 10816 판정/.test(pack) && /10–1000 Hz|10-1000 Hz/.test(pack),
  'ISO 판정에 대역제한(10-1000Hz) 값 사용');
chk('R1b', !/실시간 감시|감시 등급/.test(pack),
  '광대역 감시 등급(알람용)은 LLM 입력에서 제외 — 리포트 등급과 섞임 방지');

// R2: 상관 증거 1회 가점 — 임펄스성은 단일항
const bearing = ev.conf.find(c => /베어링/.test(c.f)) || {};
chk('R2', !/\+\d+.*(고SK|고Kurtosis).*\+\d+.*고Crest/.test(bearing.breakdown || ''),
  '임펄스성 지표 중복 가점 없음(단일항)');

// R3: 결함주파수 매칭 없이 베어링 가점 금지
const envCredit = /포락선 반복/.test(bearing.breakdown || '');
chk('R3', !(envCredit && !hasBearing),
  `베어링 미지정 시 포락선 반복만으로 베어링 가점하지 않음 (현재 가점=${envCredit})`);

// R4: 음성 소견 인쇄
chk('R4', /미검출|미상|대조 불가|없음/.test(pack), '음성 소견(미검출/대조불가) 인쇄됨');

// R5/R6: 게이트는 전역 — 걸리면 모든 후보 캡(특정 후보만 캡 금지)
if (gate) {
  const over = ev.conf.filter(c => !c.na && c.score > 40).map(c => `${c.f}=${c.score}`);
  chk('R6', over.length === 0,
    `게이트 시 전 후보 캡 적용 (캡 초과: ${over.join(', ') || '없음'})`);
  chk('R6b', /진단 보류/.test(dx.verdict), '게이트 시 verdict가 진단 보류');
} else {
  console.log('  SKIP R6 — 게이트 미발동');
}

// R7: 측정 불가 항목엔 점수·별점 없음
const naScored = ev.conf.filter(c => c.na && (c.score > 0 || (c.s || 0) > 0));
chk('R7', naScored.length === 0,
  `측정 불가 항목에 점수 없음 (위반: ${naScored.map(c => c.f + '=' + c.score).join(', ') || '없음'})`);
chk('R7b', !/판별 불가.*근거점수 [1-9]/.test(ev.confLines), '판별 불가 라인에 점수 미표기');

// R8/R9: 관측 창이 짧으면 첨도 포화(말기) 주장 금지
const roll = eq.rollup || [];
const durMin = roll.length > 1 ? (roll[roll.length - 1].ms - roll[0].ms) / 60000 : 0;
const sat = app._kurtSat(eq);
chk('R9', !(durMin < 1440 && sat.flag && /말기/.test(sat.msg || '')),
  `관측 ${durMin.toFixed(0)}분에서 "말기" 주장 없음`);

// R10: 불확도 — ISO 값이 존 경계 ±10% 안이면 단정 금지(경계 근접 표기)
if (det.isoRms != null) {
  const near = eq.zones.some(z => Math.abs(det.isoRms - z) / z < 0.1);
  chk('R10', !near || /경계 근접|불확도|잠정/.test(pack),
    `존 경계 근접 시 불확도 표기 (근접=${near})`);
}

// 분해능 주장: 1Hz 분해능으로 측대역 부재/실측 회전수 단정 금지
const res = det.fft.res || 1;
chk('RES1', !/측대역: 뚜렷하지 않음(?!.*분해능)/.test(ev.block), '측대역 부재 주장에 분해능 한계 명시');
const rpmClaim = /1× 실측 [\d.]+ Hz\(\d+ RPM\)/.test(ev.block);
chk('RES2', !rpmClaim || /±|불확도/.test(ev.block),
  `실측 회전수에 불확도 표기 (분해능 ${res.toFixed(2)}Hz → ±${(res * 60).toFixed(0)}rpm)`);

// 취득 조건 표기(윈도우·평균)
chk('ACQ', /Hann|윈도우/.test(pack) && /평균|블록/.test(pack), '스펙트럼 취득 조건(윈도우·평균) 표기');

// Crest 임계가 참조 정상범위(3~5 정상)와 정합 — 3.0을 경보 임계로 쓰지 않음
const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
chk('CREST', !/sev\('Crest[^']*',\s*wCrest,\s*''\s*,\s*3(\.0)?\s*,/.test(appSrc),
  'Crest 경보 임계가 3.0이 아님(참조: 3~5 정상 · 25.6k샘플 기대최대 4.5σ)');
chk('CREST2', !/wCrest\s*<\s*3\s*\?\s*0\s*:\s*wCrest\s*<\s*6\s*\?\s*2/.test(appSrc),
  'Crest 3~6을 "위험"으로 등급화하지 않음');

// 결함 사전 폭 — 오일훨/베인패스/기어/전기/캐비테이션/종동축 표현 여부
const dictTerms = ['오일', '베인', '기어', '전기', '캐비테이션', '종동축', '미설명'];
const covered = dictTerms.filter(t => new RegExp(t).test(ev.confLines + ev.block));
chk('DICT', covered.length >= 4,
  `결함 사전 폭 (표현됨: ${covered.join(',') || '없음'} / ${dictTerms.length}종)`);

console.log(`\n=== 결과: ${pass} PASS · ${fail} FAIL ===`);
if (fail) process.exitCode = 1;
