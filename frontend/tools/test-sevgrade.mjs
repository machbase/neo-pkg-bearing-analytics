/* 기간 지표 등급(VC.sevMetrics) — 오프라인(Neo 불필요) · npm run smoke 포함
   · 상세분석·리포트가 같은 4장 카드(_sevCards) 공유 — 단일 소스 고정
   · Crest·P95·변화율·계측 게이트 규칙, 결함 패턴 게이트 + ISO 높이 판정문(_dx)
   · 포락선 latch·축 분리·결함주파수 대조·커토그램 상한·dwell 지속 최악 */
globalThis.window = globalThis;

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const ZONES = [1.12, 2.8, 7.1];   // Class II
// 버킷 생성 — rms/crest 직접 지정, cnt는 버킷당 샘플 수(Crest 기준 √(2·ln N)의 모수)
const mkRoll = (n, f, cnt = 25600, stepMs = 1000) =>
  Array.from({ length: n }, (_, i) => Object.assign({ ms: 1700000000000 + i * stepMs, cnt }, f(i)));

// ── Crest: 정상 기계를 심각으로 올리지 않음 ──────────────────────────────
{
  const roll = mkRoll(120, () => ({ rms: 0.8, crest: 6.06 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  chk(Math.abs(m.crest.thr - (Math.sqrt(2 * Math.log(25600)) + 1)) < 1e-9,
    'Crest 기준은 상수가 아니라 √(2·ln N) + 1(잡음만일 때 버킷 최댓값의 P99.9 근사)', m.crest.thr.toFixed(2));
  chk(m.crest.grade === 1, 'Crest 6.06은 심각이 아니라 주의 — 정상 기계(3~5)를 경보로 만들지 않는다', String(m.crest.grade));
  chk(m.crest.badge === '', '15 이하는 등급어 그대로', m.crest.badge);
}
/* 잡음 수준 Crest는 충격성 아님 — 순수 가우시안 잡음의 버킷 P95 ≈ 4.7(N=25600) */
{
  const m = VC.sevMetrics(mkRoll(120, () => ({ rms: 0.8, crest: 4.75 })), { zones: ZONES, fs: 25600 });
  chk(m.crest.grade === 0, '잡음 수준(4.75)은 충격성 아님 — 종합 판정이 "정상 운전"으로', String(m.crest.grade));
  const lng = VC.sevMetrics(mkRoll(120, () => ({ rms: 0.8, crest: 6.06 }), 25600 * 60, 60000), { zones: ZONES, fs: 25600 });
  chk(lng.crest.grade === 0 && lng.crest.impOk === false, '버킷이 10초보다 길면 충격성 판단 안 함 — 부하 변동이 Crest를 키움', JSON.stringify({ g: lng.crest.grade, step: lng.n.stepSec }));
}
/* 아티팩트 단정은 원시 파형 게이트가 함께 걸릴 때만 — 롤업 버킷 Crest는 충격이 몰린 실제 결함에서도 큼 */
{
  const roll = mkRoll(120, () => ({ rms: 0.8, crest: 22 }));
  const noGate = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  chk(noGate.crest.badge === '충격성 강함',
    '게이트 없이 큰 Crest는 "충격성 강함"까지만 — 결함일 수 있다', noGate.crest.badge);
  const gated = VC.sevMetrics(roll, { zones: ZONES, fs: 25600, gate: true });
  chk(gated.crest.badge === '계측 아티팩트 의심',
    '원시 파형 게이트가 함께 걸리면 아티팩트로 단정한다', gated.crest.badge);
  const app0 = new App({ seed: 17, equipmentCount: 1 }); app0.E = CH;
  const cNo = app0._sevCards(noGate, 'mm/s', null, 1)[2];
  const cGa = app0._sevCards(gated, 'mm/s', { key: 'spike', label: '스파이크' }, 1)[2];
  chk(cNo.override === true && cGa.override === true, '어느 쪽도 등급어가 아니다');
  /* 관측 사실(충격성 강함)과 "판정에 쓰지 마라"(아티팩트)는 다른 색 — 회색은 "무시해도 됨"으로 읽힘 */
  chk(cNo.note === true && cGa.note === false,
    '충격성 강함만 관측 사실(note) — 아티팩트는 아니다', JSON.stringify({ noGate: cNo.note, gated: cGa.note }));
}

// ── 대표값은 최댓값 아닌 P95 ───────────────────────────────────────────
/* 조용한 구간의 단발 스파이크 하나로 등급이 뒤집히지 않음 */
{
  const roll = mkRoll(100, (i) => ({ rms: i === 50 ? 9.0 : 0.5, crest: 4 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  chk(m.p95.grade === 0, '단발 극단치 하나로 P95 등급이 뒤집히지 않는다', String(m.p95.grade));
  chk(m.n.wMax === 9.0 && m.n.overBC === 1, '최댓값과 초과 버킷 수는 사실대로 남는다',
    JSON.stringify({ wMax: m.n.wMax, overBC: m.n.overBC }));
}

// ── 변화율: 관측 창이 짧으면 등급 없음 ──────────────────────────
{
  // 마지막 1/4이 직전 1/4의 4배 — 변화율 ×4
  const ramp = (n) => (i) => ({ rms: i < n * 0.75 ? 0.5 : 2.0, crest: 4 });
  const short = VC.sevMetrics(mkRoll(40, ramp(40)), { zones: ZONES, fs: 25600 });
  chk(short.trend.graded === false && short.trend.grade === 0 && short.trend.badge === '',
    '관측 60분 미만은 변화율 등급 없음 — 배지도 비운다', JSON.stringify({ durMin: short.n.durMin, badge: short.trend.badge }));

  // 같은 모양을 1분 버킷으로 늘려 관측 창 충족 — 등급은 없고 기준(×2) 초과만 표시
  const long = VC.sevMetrics(mkRoll(120, ramp(120), 25600, 60000), { zones: ZONES, fs: 25600 });
  chk(long.trend.graded === false && long.trend.grade === 0 && long.trend.cmp && long.trend.over && long.trend.badge === '×2 초과',
    '변화율은 등급 없음(예전: ×2 넘으면 주의 다음 바로 심각) — 기준 초과만 표시', JSON.stringify({ durMin: long.n.durMin, badge: long.trend.badge }));
  // 정지 → 기동: 직전 1/4이 정지 수준이면 비교 불성립
  const start = VC.sevMetrics(mkRoll(120, (i) => ({ rms: i < 90 ? 0.02 : 1.0, crest: 4 }), 25600, 60000), { zones: ZONES, fs: 25600 });
  chk(!start.trend.cmp && !start.trend.over && start.trend.badge === '', '정지→기동 구간은 비교 불가(예전: ×50 "심각")', 'x' + start.n.wTrend.toFixed(0));
  const app1 = new App({ seed: 5, equipmentCount: 1 }); app1.E = CH;
  chk(/운전 상태 변화 포함 — 비교 불가/.test(app1._sevCards(start, 'mm/s')[3].thrText) && app1._sevBrief(start, 60).trend === '운전 상태 변화 포함 — 정지·기동 구간이 섞임',
    '카드·표 비고에 비교 불가 사유', app1._sevBrief(start, 60).trend);
}

// ── 계측 게이트: RMS 계열은 잠정 ───────────────────────────────────────────
{
  const roll = mkRoll(120, () => ({ rms: 5.0, crest: 4 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600, gate: true });
  chk(m.avg.badge === '잠정' && m.p95.badge === '잠정',
    '게이트 중에는 RMS 등급을 확정하지 않는다(잠정)', m.avg.badge);
  const ok = VC.sevMetrics(roll, { zones: ZONES, fs: 25600, gate: false });
  /* RMS 카드(평균·P95)는 등급 없음 — 카드는 광대역·원본 단위, 등급은 ISO 대역제한·속도라 기준이 다름
     (평균은 조용한 구간이 고진동을 희석하는 문제도 있음) */
  chk(ok.avg.graded === false && ok.p95.graded === false,
    'RMS 카드 둘 다 등급 없음 — 등급은 앵커 축(결함 패턴 게이트 + ISO 높이)이 담당한다',
    JSON.stringify({ avg: ok.avg.badge, p95: ok.p95.badge }));
  /* 등급 없는 카드는 평소 배지 비움 — 배지가 보이는 순간이 예외라는 규칙 유지 */
  chk(ok.avg.badge === '' && ok.p95.badge === '', '게이트가 아니면 배지 없음', JSON.stringify([ok.avg.badge, ok.p95.badge]));
}

// ── 화면·리포트 동일 카드 ───────────────────────────────────────
/* _sevCards는 두 화면 공유 조립기 — 라벨·배지·기준 문구 일치 */
{
  const app = new App({ seed: 3, equipmentCount: 1 });
  app.E = CH;
  const roll = mkRoll(120, () => ({ rms: 3.5, crest: 6.06 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  const cards = app._sevCards(m, 'mm/s');

  chk(cards.length === 4, '카드는 4장', String(cards.length));
  /* Crest는 등급 없음 — 기준 √(2·ln N)이 가우시안 가정이라 롤업 버킷이 길수록 실측이 기대를 넘어 등급이 롤업 길이에 좌우 */
  chk(m.crest.graded === false && cards[2].badgeKo === '' && cards[2].arrow === '',
    'Crest는 등급어도 화살표도 없다 — 롤업 길이에 등급이 뒤집혔다', JSON.stringify({ badge: cards[2].badgeKo, arrow: cards[2].arrow }));
  chk(/√\(2·ln N\) \+ 1/.test(cards[2].foot2), 'Crest 기준의 근거를 각주로 남긴다', cards[2].foot2);
  chk(/등급 없음/.test(cards[1].foot2), '최댓값은 등급 없이 사실만', cards[1].foot2);
  chk(cards[1].label === 'P95 RMS · 1초 롤업(광대역)', '두 화면의 라벨이 같다', cards[1].label);
  chk(cards.every((c) => c.thrText), '모든 카드가 기준 문구를 갖는다');
  chk(cards.every((c) => c.badgeKo === '' && c.override === true),
    '평소엔 네 장 다 배지 없음 — 행 머리말이 한 번만 말한다', cards.map((c) => c.badgeKo).join('|'));

  // 등급어가 아닌 배지엔 override 표식(색이 등급을 주장하지 않게)
  const gated = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 25600, gate: true }), 'mm/s');
  chk(gated[0].override === true && gated[0].badgeKo === '잠정', '잠정 배지는 등급어가 아님을 표시한다', gated[0].badgeKo);
  chk(cards[0].override === true && cards[0].badgeKo === '' && cards[0].arrow === '',
    '평균 카드는 등급어·화살표가 없다 — 빨간 ▲는 등급 없이도 알람으로 읽힌다', cards[0].badgeKo);
}

// ── 계측 사유 목록 감시·상세 동일 ─────────────────────────────────
/* 목록이 갈리면 같은 태그가 모니터링에선 판정 보류, 상세분석에선 확정 등급이 됨 */
{
  chk(VC.GATE_BLOCK.join(',') === 'flatline,sparse,spike,kurtx,clip,dc',
    '판정을 막는 사유는 이 여섯 가지', VC.GATE_BLOCK.join(','));

  // 함수 안 사본(서버 TQL 임베드용)과 모듈 상수 일치 — 소스에서 직접 읽음
  const inFn = /var BLOCK = \[([^\]]+)\]/.exec(VC.signalQuality.toString());
  chk(!!inFn && inFn[1].replace(/['\s]/g, '') === VC.GATE_BLOCK.join(','),
    'signalQuality 안 사본이 GATE_BLOCK과 같다', inFn && inFn[1]);

  // 클리핑 파형 — 꼭대기를 잘라 생성
  const n = 8192, clipped = [];
  for (let i = 0; i < n; i++) clipped.push(Math.max(-0.6, Math.min(0.6, Math.sin(i * 0.05))));
  const q = VC.signalQuality(clipped, 2048);
  chk(q.issues.some((x) => x.key === 'clip'), '클리핑을 감지한다', q.issues.map((x) => x.key).join(','));
  chk(q.gate === true, '클리핑은 판정 보류 사유다 — 감시만 막고 화면은 통과시키면 두 화면이 갈린다', String(q.gate));

  const r = VC.gateReason(q, null);
  chk(!!r && r.key === 'clip' && r.src === 'det', '보류 사유를 하나로 집어낸다', r && r.key);
  // 감시가 본 사유 우선 — 화면 문구는 판정이 실제로 멈춘 이유
  const rm = VC.gateReason(q, { key: 'dc', label: 'DC 드리프트', detail: '...' });
  chk(rm.key === 'dc' && rm.src === 'mon', '감시가 본 사유가 우선한다', rm.key);
  chk(VC.gateReason({ ok: true, issues: [], gate: false }, null) === null, '멀쩡하면 사유가 없다');
}

// ── 보류 중엔 어느 카드도 등급어 없음 ───────────────────────────
{
  const app = new App({ seed: 5, equipmentCount: 1 });
  app.E = CH;
  // 클리핑 상황: RMS는 주의 구간, Crest는 낮음(잘려서)
  const roll = mkRoll(120, () => ({ rms: 2.03, crest: 1.08 }));
  const held = { key: 'clip', label: '클리핑(포화)', detail: '파형 꼭대기가 잘렸습니다' };
  const cards = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 2048, gate: true }), 'mm/s', held);

  chk(cards.every((c) => c.override), '네 장 모두 등급어가 아닌 배지', cards.map((c) => c.badgeKo).join(' · '));
  chk(cards[2].badgeKo === '잠정', 'Crest의 초록 양호가 사라진다 — 클리핑 신호에서 제일 위험한 배지', cards[2].badgeKo);
  chk(/클리핑은 꼭대기를 잘라/.test(cards[2].foot2), 'Crest가 왜 낮은지 각주로 적는다', cards[2].foot2);
  chk(/진폭 과소/.test(cards[1].foot2), 'RMS도 과소일 수 있음을 밝힌다', cards[1].foot2);

  const dc = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 2048, gate: true }), 'mm/s',
    { key: 'dc', label: 'DC 드리프트' });
  chk(/과대/.test(dc[0].foot2), 'DC는 과대 방향임을 밝힌다 — 사유마다 틀리는 방향이 다르다', dc[0].foot2);

  // 보류가 아니면 배지 없음
  const okc = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 2048, gate: false }), 'mm/s', null);
  chk(okc.every((c) => c.badgeKo === ''), '보류가 풀리면 배지가 사라진다 — 잠정은 게이트에만 붙는다',
    okc.map((c) => c.badgeKo).join('|'));
}

// ── 카드 라벨은 실제 롤업 단위 표시 ───────────────────────────────────
/* 라벨 고정("1초 롤업")이면 분·시간 롤업에서도 1초로 표기 — 판정은 맞고 라벨만 틀림 */
{
  const app = new App({ seed: 11, equipmentCount: 1 });
  app.E = CH;
  const m = VC.sevMetrics(mkRoll(120, () => ({ rms: 1.0, crest: 4 })), { zones: ZONES, fs: 25600 });
  chk(/1초 롤업/.test(app._sevCards(m, 'mm/s', null, 1)[0].label), '초 롤업이면 1초', app._sevCards(m, 'mm/s', null, 1)[0].label);
  chk(/1분 롤업/.test(app._sevCards(m, 'mm/s', null, 60)[0].label), '분 롤업이면 1분', app._sevCards(m, 'mm/s', null, 60)[0].label);
  chk(/1시간 롤업/.test(app._sevCards(m, 'mm/s', null, 3600)[1].label), '시간 롤업이면 1시간', app._sevCards(m, 'mm/s', null, 3600)[1].label);
}

// ── Crest 배지·각주 일치 ───────────────────────────────
/* 배지는 P95 기준, 각주는 최댓값 인쇄 — P95만 경계 아래일 때 최댓값 초과 사실은 각주가 밝힘 */
{
  const app = new App({ seed: 13, equipmentCount: 1 });
  app.E = CH;
  // 대부분 14.7, 몇 개만 20.5 → P95는 경계 아래, 최댓값은 위
  const roll = mkRoll(120, (i) => ({ rms: 0.12, crest: i % 40 === 0 ? 20.5 : 14.7 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  chk(m.crest.value <= 15 && m.n.wCrest > 15, 'P95는 경계 아래, 최댓값은 위',
    JSON.stringify({ p95: +m.crest.value.toFixed(2), max: +m.n.wCrest.toFixed(1) }));
  chk(m.crest.badge === '', '배지는 대표값(P95) 기준 — 단발 하나로 붙지 않는다', m.crest.badge || '(없음)');
  chk(/아티팩트 경계/.test(app._sevCards(m, 'mm/s', null, 1)[2].foot2),
    '그래도 최댓값이 경계를 넘었다는 사실은 각주가 밝힌다', app._sevCards(m, 'mm/s', null, 1)[2].foot2);
}

// ── 진폭 정상 + Crest 초과는 "징후 없음"으로 끝내지 않음 ─────────────────
/* Crest는 등급 축이 아니라 빨개도 종합 등급은 그대로 — 판정문만 사실 반영("정상 운전"과 모순 방지) */
{
  const app = new App({ seed: 7, equipmentCount: 1 });
  app.E = CH;
  // 결함 패턴 축은 회전수·구름체 기하가 둘 다 있어야 성립(감시 _patCapable과 같은 조건) — 품번 지정 설비
  const eq = { id: 'T1:T1', table: 'T1', name: 'T1', alias: 'T1', grade: 0, zones: ZONES, unit: 'mm/s',
    rpm: 1800, fs: 25600, rms: 0.12, cls: 'II', bearing: { model: '6205', n: 9, Bd: 7.94, Pd: 39, phi: 0 }, rollup: [] };
  // _dxLive가 보는 최소 상세 — 스펙트럼 비움, 계측 게이트 없음
  const det = { fft: { freqs: [], mags: [], markers: [] }, spectral: { notes: [], cause: null },
    envelope: { freqs: [], mags: [], markers: [], hint: '', fault: null },
    indics: [], quality: { ok: true, issues: [], gate: false }, raw: { fs: 25600, values: [] } };

  const calm = VC.sevMetrics(mkRoll(120, () => ({ rms: 0.12, crest: 3.0 })), { zones: ZONES, fs: 25600 });
  chk(calm.crest.grade === 0, '기준 이하 Crest는 양호', String(calm.crest.grade));

  /* 커버리지 — 축이 비면 "징후 없음" 단정 금지(관측 등급은 하한, "양호"는 축이 다 살아있을 때만) */
  /* 커버리지 분모 = 필수 축 둘(ISO 존·결함 패턴, 학습 불필요), 베이스라인·대역은 "평소 대비" 보강 축 */
  chk(/판정 기준 0\/2/.test(app._dx(eq, det, calm).verdict),
    '필수 축이 비면 "이상 없음"이 아니라 커버리지를 밝힌다', app._dx(eq, det, calm).verdict);

  /* 네 축이 다 살아있으면 기본 문구 — 축은 전부 앵커 시점 값
     (ISO=det.isoRms, 베이스라인=앵커 파형 RMS vs 학습 한계, 대역=det.bandAt, 패턴=스펙트럼) */
  app._evidence = () => ({ top: { score: 0 }, gate: false, conf: [], block: '', confLines: '' });
  app._blMap = { 'T1:T1': { mu: 1.0, sigma: 0, k: 3 } };          // 한계 = max(1.0, 1.2) = 1.2
  app._bandBaselines = () => ({ one: { mu: 1.0, sigma: 0, k: 3 } });
  app._softBands = () => [];
  const quietWave = Array.from({ length: 512 }, (_, i) => 0.3 * Math.sin(i / 7));   // AC RMS ≈ 0.21
  // isoRms는 liveDetail이 앵커 시점에서 이미 속도(mm/s)로 낸 값 — 0.5는 Class II A존
  const detF = Object.assign({}, det, { isoRms: 0.5, anchorMs: 1700000000000,
    raw: { times_ms: [], values: quietWave, fs: 25600 },
    bandAt: { one: 0.5 },                                          // 한계 1.2 아래 → 이탈 없음
    fft: { freqs: [10, 20, 30], mags: [1, 0.5, 0.2], markers: [] } });
  chk(app._dx(eq, detF, calm).verdict === '뚜렷한 결함 징후 없음 — 정상 운전',
    '네 축이 다 살아있고 조용하면 종전 문구', app._dx(eq, detF, calm).verdict);
  var _cv = app._dx(eq, detF, calm).cov;
  chk(_cv.n === 2 && _cv.total === 2, '필수 2축이 다 살아있으면 완전', JSON.stringify(_cv));
  chk(_cv.extra.length === 2, '학습된 보강 축은 미달이 아니라 "더해진 것"으로 센다', JSON.stringify(_cv.extra));

  /* 저샘플 전대역 복조의 "없음"은 고정 대역보다 약한 근거(조기 결함의 kHz 공진이 Nyquist 밖)
     → 판정문에 한계 덧붙임, 등급이 선 뒤엔 생략 */
  const detW = Object.assign({}, detF, { demodSrc: 'wideband' });
  chk(/전대역 복조/.test(app._dx(eq, detW, calm).verdict),
    '전대역 복조였으면 "정상 운전"으로 끝내지 않는다', app._dx(eq, detW, calm).verdict);
  chk(/뚜렷한 결함 징후 없음/.test(app._dx(eq, detW, calm).verdict),
    '판정 자체는 그대로 — 문구만 한계를 덧붙인다');
  chk(!/전대역 복조/.test(app._dx(eq, detF, calm).verdict),
    '고정 대역이면 덧붙이지 않는다', app._dx(eq, detF, calm).verdict);

  /* 패턴 축이 잡히면 진폭 양호여도 등급 상승 — 게이트는 격자 배수(det.sideband = targetedMatch, 감시와 같은 검출기),
     원인 이름은 근거 점수(_evidence) */
  app._evidence = () => ({ top: { f: '베어링 외륜(BPFO)', score: 80 }, gate: false, conf: [], block: '', confLines: '' });
  const sbOn = { r: VC.TGT_ADOPT + 1, key: 'BPFO', adopted: true };
  const detP = Object.assign({}, detF, { sideband: sbOn });
  const dxP = app._dx(eq, detP, calm);
  chk(dxP.patGi === 1 && dxP.gi === 1, '진폭 양호 + 결함 패턴 → 주의', JSON.stringify({ pat: dxP.patGi, gi: dxP.gi }));
  chk(/베어링/.test(dxP.verdict) && !/징후 없음/.test(dxP.verdict),
    '원인을 지목했으면 "징후 없음"이라고 쓰지 않는다', dxP.verdict);
  /* ISO는 등급을 켜지 않음(결함 패턴이 게이트, ISO는 높이만) — 존 초과 사실은 isoOnly·판정문으로 표시 */
  app._evidence = () => ({ top: { score: 0 }, gate: false, conf: [], block: '', confLines: '' });
  app._gradeState = {};
  const dxIso = app._dx(eq, Object.assign({}, detF, { isoRms: 8.0 }), calm);   // Class II D존
  chk(dxIso.gi === 0 && dxIso.isoOnly === 3,
    'ISO가 D존이어도 결함 패턴이 없으면 등급을 안 올린다 — 대신 isoOnly로 사실을 남긴다',
    JSON.stringify({ gi: dxIso.gi, isoOnly: dxIso.isoOnly }));
  chk(/베어링 결함 징후 없음/.test(dxIso.verdict) && /진동 크기 ISO D 구간/.test(dxIso.verdict),
    '판정문이 "양호"로 끝내지 않고 진동 크기(ISO 구간)를 밝힌다 — 원인이 베어링 밖일 수 있다', dxIso.verdict);
  /* 결함 패턴이 켜지면 ISO가 높이 결정 — max(1, isoGi) */
  app._evidence = () => ({ top: { f: '베어링 외륜(BPFO)', score: 80 }, gate: false, conf: [], block: '', confLines: '' });
  const dxBoth = app._dx(eq, Object.assign({}, detF, { isoRms: 8.0, sideband: sbOn }), calm);
  chk(dxBoth.gi === 3, '패턴 채택 + ISO D존 → 심각 (ISO가 높이를 정한다)', String(dxBoth.gi));
  const dxLow = app._dx(eq, Object.assign({}, detF, { isoRms: 0.2, sideband: sbOn }), calm);
  chk(dxLow.gi === 1, '패턴 채택 + ISO 양호 → 주의 (최소 한 칸은 올린다)', String(dxLow.gi));
  /* 근거 점수가 높아도 격자 배수가 창 임계 아래면 게이트 닫힘 — 감시와 같은 기준이라 카드→상세 이동 시 등급 불변 */
  const dxWeak = app._dx(eq, Object.assign({}, detF, { sideband: { r: VC.TGT_ADOPT - 0.5, key: 'BPFO' } }), calm);
  chk(dxWeak.gi === 0, '근거 점수가 높아도 격자 배수가 임계 아래면 등급을 안 올린다', JSON.stringify({ gi: dxWeak.gi }));
  /* 상세분석 게이트는 결함 패턴 하나 — 베이스라인·대역이 켜져도 등급 불변(학습 여부로 등급이 달라지면 일회성 분석 불가) */
  app._evidence = () => ({ top: { score: 0 }, gate: false, conf: [], block: '', confLines: '' });
  app._blMap = { 'T1:T1': { mu: 0.001, sigma: 0.0001, k: 3 } };  // 평소 대비 급증하도록 아주 낮은 기준
  const dxBl = app._dx(eq, Object.assign({}, detF, { isoRms: 0.2 }), calm);
  chk(dxBl.gi === 0, '베이스라인이 켜져도 등급은 안 오른다 — 게이트는 패턴 하나', String(dxBl.gi));
  chk(dxBl.blOnly === 1 && /평소 대비 급증/.test(dxBl.verdict),
    '대신 켜졌다는 사실은 판정문이 밝힌다 — 숨기지 않는다', dxBl.verdict);
  app._blMap = {};
  app._evidence = () => ({ top: { score: 0 }, gate: false, conf: [], block: '', confLines: '' });
  chk(dxIso.cov.missing.indexOf('ISO 존') < 0, 'ISO 축은 적용된 것으로 센다', JSON.stringify(dxIso.cov.missing));
  chk(dxIso.cov.missing.every((k) => k.indexOf('·') < 0),
    '축 이름에 가운뎃점이 없다 — 이름을 가운뎃점으로 이어 붙이므로 개수가 오독된다', JSON.stringify(dxIso.cov.missing));

  app._evidence = App.prototype._evidence;   // 이후 검사 영향 방지로 원복
  app._gradeState = {};

  // 평균 0.12 mm/s(양호)인데 Crest P95 14.7(위험)인 상황
  const spiky = VC.sevMetrics(mkRoll(120, () => ({ rms: 0.12, crest: 14.7 })), { zones: ZONES, fs: 25600 });
  const dxs = app._dx(eq, det, spiky);
  chk(spiky.avg.grade === 0 && spiky.crest.grade === 2, '진폭은 양호, Crest는 위험',
    JSON.stringify({ avg: spiky.avg.grade, crest: spiky.crest.grade }));
  chk(dxs.impulse === true && dxs.verdict === '진폭 정상 · 충격성 신호 존재 — 계측 확인 후 재평가',
    '빨간 Crest 옆에서 "정상 운전"이라고 쓰지 않는다', dxs.verdict);
  chk(dxs.gradeKo === '양호' && dxs.color === CH.STATUS[0].color,
    '문구만 바뀌고 등급·색은 양호 그대로 — Crest는 등급 축이 아니다', dxs.gradeKo);

  // 계측 게이트 문구 우선 — 이미 계측 확인 지시
  const gated = app._dx(eq, Object.assign({}, det, {
    quality: { ok: false, gate: true, issues: [{ key: 'clip', label: '클리핑(포화)', detail: '꼭대기가 잘림' }] } }), spiky);
  chk(gated.impulse === false && /계측 검증 필요/.test(gated.verdict),
    '계측 게이트 문구가 충격성 문구를 덮는다', gated.verdict);

  // 판정이 충격성을 지적하면 권고도 일치 — 한 화면 내 상충 지시 방지
  chk(!/정상 운전 유지/.test('포락선에서 베어링 결함 주파수 대조 · 센서·케이블·마운팅 점검'),
    '권고 문구가 "정상 운전 유지"와 겹치지 않는다');
}

// ── 결함 패턴 축 — 학습 없이 등급 상승 ────────────────────────────────
/* 진폭에 안 나타나는 초기 베어링 결함 대응 — 격자 배수는 스펙트럼 하나로 산출되어 학습 불필요 */
{
  const T = VC.TGT_ADOPT;
  chk(VC.patternGrade(T, false, T) === 1, '창의 임계에 닿으면 주의', String(VC.patternGrade(T, false, T)));
  chk(VC.patternGrade(T - 0.01, false, T) === 0, '그 아래는 등급 없음', String(VC.patternGrade(T - 0.01, false, T)));
  chk(VC.patternGrade(95, false, T) === 1, '아무리 강해도 상한은 주의 — 급한지는 진폭 축이 말한다', String(VC.patternGrade(95, false, T)));
  chk(VC.patternGrade(95, true, T) === 0, '계측 게이트 중에는 스펙트럼을 못 믿으므로 축을 비운다', String(VC.patternGrade(95, true, T)));
  /* 임계 미지정 시 판정 안 함 — 기본값이 있으면 창 변경 시 조용히 틀린 임계 사용 */
  chk(VC.patternGrade(95, false, undefined) === 0, '창 임계 없이는 게이트를 열지 않는다', String(VC.patternGrade(95, false, undefined)));
  chk(VC.MON_ADOPT < VC.TGT_ADOPT, '짧은 창(감시)의 임계가 더 낮다 — 점수 분포가 내려가므로',
    VC.MON_ADOPT + ' < ' + VC.TGT_ADOPT);

  // worstGrade 4번째 축 — 진폭 세 축이 전부 0이어도 패턴이 등급 생성
  const w = VC.worstGrade(0, 0, 0, 1);
  chk(w.gi === 1 && w.src === 'pattern', '진폭 양호 + 패턴 근거 → 주의(패턴)', JSON.stringify(w));
  // 더 나쁜 축 우선(패턴 상한이 주의라 진폭을 덮지 않음)
  const w2 = VC.worstGrade(3, 0, 0, 1);
  chk(w2.gi === 3 && w2.src === 'iso', '패턴이 진폭 판정을 끌어내리지 않는다', JSON.stringify(w2));
  chk(VC.worstGrade(0, 0, 0, 0).gi === 0, '아무 축도 안 걸리면 양호');
}

// ── 포락선 계열은 latch, 주파수 대역은 그대로 ─────────────────────────────
/* 스폴은 메워지지 않음(신호만 부하·윤활·센서 각도에 묻힘) → 포락선 계열은 한 번 넘으면 최고 배수·최초 시각 유지
   주파수 대역(1× 등)은 부하에 따라 정상적으로 오르내려 현재값 기준 */
{
  const BL = { mu: 1.0, sigma: 0, k: 3 };          // 한계 = max(1.0, 1.2) = 1.2
  const bls = { one: BL, envBPFI: BL };

  // 1차: 둘 다 이탈
  const t1 = 1000;
  const r1 = VC.bandJudge({ one: 3.0, envBPFI: 3.0 }, bls, false, null, null, t1);
  chk(r1.on && r1.latch.envBPFI && Math.abs(r1.latch.envBPFI.r - 2.5) < 1e-9 && r1.latch.envBPFI.at === t1,
    '포락선 이탈은 최고 배수와 최초 시각을 기억한다', JSON.stringify(r1.latch));
  chk(!r1.latch.one, '주파수 대역은 기억하지 않는다', JSON.stringify(Object.keys(r1.latch)));

  // 2차: 둘 다 한계 아래 — 포락선만 유지
  const r2 = VC.bandJudge({ one: 0.5, envBPFI: 0.5 }, bls, true, null, r1.latch, t1 + 60000);
  chk(r2.on, '포락선 이력이 있으면 이탈 상태가 유지된다', String(r2.on));
  const keys = r2.over.map((o) => o.k);
  chk(keys.indexOf('envBPFI') >= 0 && keys.indexOf('one') < 0,
    '유지되는 것은 포락선뿐 — 1× 대역은 내려오면 해제된다', keys.join(','));
  const ob = r2.over.filter((o) => o.k === 'envBPFI')[0];
  chk(ob.latched === true && Math.abs(ob.r - 2.5) < 1e-9 && ob.at === t1,
    '판정은 기억한 최고 배수로 하고 최초 시각을 함께 낸다', JSON.stringify({ r: ob.r, at: ob.at, latched: ob.latched }));
  chk(/이력 ×2\.50/.test(r2.detail), '이력으로 유지되는 항목은 detail에 그 사실을 적는다', r2.detail);

  // 최고 배수는 갱신, 최초 시각은 유지("언제부터" 고정)
  const r3 = VC.bandJudge({ one: 0.5, envBPFI: 6.0 }, bls, true, null, r2.latch, t1 + 120000);
  chk(Math.abs(r3.latch.envBPFI.r - 5.0) < 1e-9 && r3.latch.envBPFI.at === t1,
    '최고 배수는 갱신, 최초 시각은 유지', JSON.stringify(r3.latch.envBPFI));

  // 이력 미전달(재학습 후)이면 초기화
  const r4 = VC.bandJudge({ one: 0.5, envBPFI: 0.5 }, bls, false, null, null, t1 + 180000);
  chk(r4.on === false && !Object.keys(r4.latch).length,
    '재학습으로 이력을 지우면 이탈이 풀린다 — latch를 푸는 유일한 자리', JSON.stringify(r4.latch));
}

// ── 커토그램 탐색 상한 — 안티에일리어싱 롤오프 반드시 제외 ──────────────
/* Nyquist 바로 아래는 안티에일리어싱으로 신호가 죽은 수치 잡음 구간 — 에너지가 작을수록 첨도가 폭발해
   상한 없으면 커토그램이 늘 거기를 선택, 설정 아닌 신호처리 상한이라 조건 없이 적용 */
{
  chk(VC.KG_NYQ_FRAC > 0 && VC.KG_NYQ_FRAC < 1, '롤오프 상한 비율이 Nyquist 안에 있다', String(VC.KG_NYQ_FRAC));
  // 잡음뿐인 최상단 대역의 첨도 폭발 재현 — 상한 필요성
  const FS = 12000, N = 65536;
  const sig = new Array(N);
  for (let i = 0; i < N; i++) {
    // 2.5 kHz 공진 + 1 kHz 성분, Nyquist(6 kHz) 근처는 비움(안티에일리어싱 흉내)
    sig[i] = Math.sin(2 * Math.PI * 2500 * i / FS) * (1 + 0.5 * Math.sin(2 * Math.PI * 30 * i / FS))
      + 0.3 * Math.sin(2 * Math.PI * 1000 * i / FS) + (i % 997 === 0 ? 3 : 0);
  }
  const noCap = VC.kurtogram(sig, FS, 0);
  const capped = VC.kurtogram(sig, FS, (FS / 2) * VC.KG_NYQ_FRAC);
  chk(!!capped && !!capped.best && capped.best.hiHz <= (FS / 2) * VC.KG_NYQ_FRAC + 1,
    '상한을 주면 선택 대역이 그 아래로 제한된다',
    capped && capped.best ? Math.round(capped.best.loHz) + '~' + Math.round(capped.best.hiHz) : '없음');
  chk(!!noCap && !!noCap.best, '상한이 없으면 Nyquist까지 훑는다',
    noCap && noCap.best ? Math.round(noCap.best.loHz) + '~' + Math.round(noCap.best.hiHz) : '없음');
}

// ── 진동 축·베어링 축 분리 ───────────────────────────────────────
/* 최댓값 하나로 뭉치면 비특이적 주파수 대역이 특이적 포락선 계열을 덮음
   (옆 베어링 결함이 축을 타고 정상 베어링 센서에도 실림) */
{
  const BL = { mu: 1.0, sigma: 0, k: 3 };   // 한계 1.2
  const bls = { vh2: BL, envBPFI: BL };
  // 진동 대역은 크고 포락선은 낮은 경우 — "진동은 커졌으나 이 베어링이 상한 근거는 아님"
  const spread = VC.bandJudge({ vh2: 4.8, envBPFI: 1.4 }, bls, false, null, null, 1000);
  chk(Math.abs(spread.freqR - 4.0) < 1e-9 && spread.freqKey === 'vh2',
    '진동 축은 주파수 대역 최대', JSON.stringify({ r: spread.freqR, k: spread.freqKey }));
  chk(Math.abs(spread.envR - 1.1666666666666667) < 1e-6 && spread.envKey === 'envBPFI',
    '베어링 축은 포락선 결함주파수 최대', JSON.stringify({ r: spread.envR, k: spread.envKey }));
  chk(spread.maxR === spread.freqR, '등급은 여전히 최댓값 — 갈라 내는 것은 원인 표시다');

  // 포락선만 걸린 경우 — 진동 축은 0
  const envOnly = VC.bandJudge({ vh2: 0.5, envBPFI: 3.6 }, bls, false, null, null, 1000);
  chk(envOnly.freqR === 0 && envOnly.envR > 0,
    '포락선만 이탈하면 진동 축은 0', JSON.stringify({ freq: envOnly.freqR, env: envOnly.envR }));
  chk(envOnly.envKey === 'envBPFI', '어느 결함주파수인지 함께 낸다 — 내륜·외륜·롤러로 조치가 갈린다', envOnly.envKey);
}

// ── 결함주파수 대조 — 허용오차 하한과 FTF 제외 ────────────────────────────
/* ① 허용오차 하한 = 스펙트럼 분해능 — 저주파 결함주파수는 ±1%가 빈 간격보다 작아 원리적으로 매칭 불가
   ② FTF(케이지)는 결함 후보 아님 — 정상 베어링에서도 0.45×가 상태와 무관하게 관측
      (①만 넣고 FTF를 후보로 두면 정상 베어링이 곧바로 결함으로 잡힘) */
{
  const bf = VC.bearingFreqs(2000, { n: 16, Bd: 8.407, Pd: 71.501, phi: 15.17 });
  const res = 20480 / 32768;   // 0.625 Hz

  // FTF 14.78 Hz — 가장 가까운 빈은 15.0(1.5% 벗어남), ±1%로는 매칭 불가
  const atFtf = VC.bearingMatch({ f0: 15.0, harm: 4 }, bf, 33.33, res);
  chk(atFtf.hit === null, 'FTF는 결함 후보가 아니다 — 케이지는 정상 베어링에서도 돈다',
    atFtf.hit ? atFtf.hit.key : '(hit 없음)');
  chk(!!atFtf.cage && atFtf.cage.harm === 4,
    '다만 관측 사실로는 남긴다(cage)', JSON.stringify(atFtf.cage));

  // 저주파 BSF — 저속 설비에선 ±1%가 분해능보다 작아 하한 없으면 매칭 불가
  const slow = VC.bearingFreqs(300, { n: 16, Bd: 8.407, Pd: 71.501, phi: 15.17 });
  const f0 = Math.round(slow.BSF / res) * res;      // 참값에 가장 가까운 빈
  chk(Math.abs(f0 - slow.BSF) / slow.BSF > 0.01,
    '전제: 저속에서는 가장 가까운 빈도 ±1%를 벗어난다',
    'BSF ' + slow.BSF.toFixed(2) + ' vs 빈 ' + f0.toFixed(3));
  chk(VC.bearingMatch({ f0: f0, harm: 3 }, slow, 5, 0).hit === null, '하한 없으면 미검출(옛 동작)');
  const withRes = VC.bearingMatch({ f0: f0, harm: 3 }, slow, 5, res);
  chk(withRes.hit && withRes.hit.key === 'BSF', '분해능 하한을 주면 검출된다',
    withRes.hit ? withRes.hit.key : '없음');

  /* 구름체 결함은 자전 1회에 두 궤도를 각각 때려 2×BSF 지배 — 2×BSF도 BSF로 매칭 */
  const b2 = VC.bearingMatch({ f0: 2 * bf.BSF, harm: 3 }, bf, 33.33, res);
  chk(b2.hit && b2.hit.key === 'BSF' && b2.hit.ord === 2, '2×BSF도 BSF로 잡는다',
    b2.hit ? b2.hit.key + ' ord' + b2.hit.ord : '없음');
  chk(b2.negatives.indexOf('BSF') < 0,
    '한 배수가 맞았으면 그 계열은 음성 소견이 아니다', JSON.stringify(b2.negatives));

  /* 하한이 허용오차를 무한정 넓히지 않음 — 하한이 실제로 구속하는 저주파에서 확인(BPFO처럼 ±2%가 분해능보다 크면 검사 무력) */
  chk(VC.bearingMatch({ f0: slow.BSF + 2 * res, harm: 3 }, slow, 5, res).hit === null,
    '분해능 1.5배 밖은 여전히 미검출 — 하한이 허용오차를 무너뜨리지 않는다',
    'BSF ' + slow.BSF.toFixed(2) + ' + ' + (2 * res).toFixed(2) + 'Hz');
}

// ── 기간 내 "지속된 최악" — 백분위 아닌 시간 기준 ─────────────────────
/* P95는 기간 길이에 따라 허용 시간이 달라짐(1시간=3분, 34일=41시간) — dwell은 시간 단위라 기간 무관
   수집 갭을 건너뛴 연속은 연속 아님 */
{
  const mk2 = (arr, stepMs = 60000) => arr.map((v, i) => ({ ms: 1700000000000 + i * stepMs, rms: v }));

  // 단발 스파이크는 지속 아님
  const spike = VC.dwellWorst(mk2([0.5, 0.5, 9.0, 0.5, 0.5, 0.5]), 180000, 3);
  chk(spike && spike.v < 1, '단발 스파이크는 지속 최악이 되지 않는다', JSON.stringify(spike));

  // 연속 3개가 높으면 그 수준 채택(창 안 최솟값 = 창 내내 유지된 수준)
  const sust = VC.dwellWorst(mk2([0.5, 0.5, 3.0, 3.2, 3.1, 0.5]), 180000, 3);
  chk(sust && Math.abs(sust.v - 3.0) < 1e-9, '연속 유지된 수준을 잡는다', JSON.stringify(sust));
  chk(sust.durMs >= 180000, '요구한 지속 시간을 만족한다', String(sust.durMs));

  // 갭 건너뛴 연속은 연속 아님 — 앞 2개 + (긴 공백) + 뒤 1개
  const gapped = [{ ms: 0, rms: 5 }, { ms: 60000, rms: 5 }, { ms: 60000 * 999, rms: 5 }];
  const g2 = VC.dwellWorst(gapped, 180000, 3);
  chk(g2 === null, '수집 갭을 건너뛴 연속은 지속으로 세지 않는다', JSON.stringify(g2));

  // 기간 길이 무관 — 같은 모양을 길게 늘여도 결과 동일
  const shortP = VC.dwellWorst(mk2([0.5, 3.0, 3.0, 3.0, 0.5]), 180000, 3);
  const longP = VC.dwellWorst(mk2(Array(200).fill(0.5).concat([3.0, 3.0, 3.0]).concat(Array(200).fill(0.5))), 180000, 3);
  chk(shortP && longP && Math.abs(shortP.v - longP.v) < 1e-9,
    '기간 길이가 달라도 판정 기준이 같다 — P95와 다른 점',
    JSON.stringify({ short: shortP.v, long: longP.v }));
}

// ── 빈 입력 처리 ────────────────────────────────────────────────
{
  const m = VC.sevMetrics([], { zones: ZONES, fs: 0 });
  chk(m.avg.value === 0 && m.n.buckets === 0 && isFinite(m.crest.thr),
    '버킷이 없어도 값이 나온다(0으로)', JSON.stringify({ thr: m.crest.thr, buckets: m.n.buckets }));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
