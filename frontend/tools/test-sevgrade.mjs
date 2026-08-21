/* 기간 지표 등급 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   상세분석 화면과 리포트가 같은 4장 카드를 각자 계산하던 때, 규칙이 두 벌로 갈려
   같은 설비가 두 등급으로 보였다(Crest 6.06 → 화면 '심각' / 리포트 '주의').
   지금은 둘 다 VC.sevMetrics 하나를 쓴다. 이 검사가 그 단일 소스를 고정한다. */
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
// 버킷 생성 — rms/crest를 직접 지정. cnt는 버킷당 샘플 수(Crest 기준 √(2·ln N)의 모수).
const mkRoll = (n, f, cnt = 25600, stepMs = 1000) =>
  Array.from({ length: n }, (_, i) => Object.assign({ ms: 1700000000000 + i * stepMs, cnt }, f(i)));

// ── Crest: 정상 기계를 심각으로 올리지 않는다 ──────────────────────────────
{
  const roll = mkRoll(120, () => ({ rms: 0.8, crest: 6.06 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  chk(Math.abs(m.crest.thr - Math.sqrt(2 * Math.log(25600))) < 1e-9,
    'Crest 기준은 상수가 아니라 √(2·ln N)', m.crest.thr.toFixed(2));
  chk(m.crest.grade === 1, 'Crest 6.06은 심각이 아니라 주의 — 정상 기계(3~5)를 경보로 만들지 않는다', String(m.crest.grade));
  chk(m.crest.badge === '', '15 이하는 등급어 그대로', m.crest.badge);
}
/* 아티팩트로 단정하려면 원시 파형 게이트가 함께 걸려야 한다 — 롤업 버킷의 Crest는
   버킷 안에 충격이 몰린 실제 결함에서도 크다(내륜 결함 확정 채널이 1시간 버킷에서 24.8).
   게이트 없이 큰 것을 "계측 아티팩트"로 단정하면 진짜 결함을 잡음으로 몰아낸다. */
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
  /* 관측 사실과 "판정에 쓰지 마라"는 다른 색이어야 한다 — 회색은 "무시해도 됨"으로 읽히는데
     충격성 강함은 정반대(실제로 강한 충격이 있으니 보라)다. */
  chk(cNo.note === true && cGa.note === false,
    '충격성 강함만 관측 사실(note) — 아티팩트는 아니다', JSON.stringify({ noGate: cNo.note, gated: cGa.note }));
}

// ── 대표값은 최댓값이 아니라 P95 ───────────────────────────────────────────
/* 조용한 구간에 단발 스파이크 하나가 섞여도 등급이 뒤집히면 안 된다. */
{
  const roll = mkRoll(100, (i) => ({ rms: i === 50 ? 9.0 : 0.5, crest: 4 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  chk(m.p95.grade === 0, '단발 극단치 하나로 P95 등급이 뒤집히지 않는다', String(m.p95.grade));
  chk(m.n.wMax === 9.0 && m.n.overBC === 1, '최댓값과 초과 버킷 수는 사실대로 남는다',
    JSON.stringify({ wMax: m.n.wMax, overBC: m.n.overBC }));
}

// ── 변화율: 관측 창이 짧으면 등급을 매기지 않는다 ──────────────────────────
{
  // 마지막 1/4이 직전 1/4의 4배 — 변화율 ×4
  const ramp = (n) => (i) => ({ rms: i < n * 0.75 ? 0.5 : 2.0, crest: 4 });
  const short = VC.sevMetrics(mkRoll(40, ramp(40)), { zones: ZONES, fs: 25600 });
  chk(short.trend.graded === false && short.trend.grade === 0 && short.trend.badge === '',
    '관측 60분 미만은 변화율 등급 없음 — 배지도 비운다', JSON.stringify({ durMin: short.n.durMin, badge: short.trend.badge }));

  // 같은 모양을 1분 버킷으로 늘려 관측 창을 넘긴다
  const long = VC.sevMetrics(mkRoll(120, ramp(120), 25600, 60000), { zones: ZONES, fs: 25600 });
  chk(long.trend.graded === true && long.trend.grade === 3,
    '관측 창이 충분하면 변화율 등급을 매긴다', JSON.stringify({ durMin: long.n.durMin, grade: long.trend.grade }));
}

// ── 계측 게이트: RMS 계열은 잠정 ───────────────────────────────────────────
{
  const roll = mkRoll(120, () => ({ rms: 5.0, crest: 4 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600, gate: true });
  chk(m.avg.badge === '잠정' && m.p95.badge === '잠정',
    '게이트 중에는 RMS 등급을 확정하지 않는다(잠정)', m.avg.badge);
  const ok = VC.sevMetrics(roll, { zones: ZONES, fs: 25600, gate: false });
  /* RMS 카드(평균·P95)는 등급을 갖지 않는다 — 카드는 광대역·원본 단위이고 등급은
     ISO 대역제한·속도라 기준이 다르다. 등급어를 달면 "P95 양호인데 종합 심각"이 한 화면에 남는다.
     평균은 거기에 더해 조용한 구간이 고진동을 희석한다는 이유가 하나 더 있다. */
  chk(ok.avg.graded === false && ok.p95.graded === false,
    'RMS 카드 둘 다 등급 없음 — 등급은 앵커 축(결함 패턴 게이트 + ISO 높이)이 담당한다',
    JSON.stringify({ avg: ok.avg.badge, p95: ok.p95.badge }));
  /* 등급이 없는 카드는 평소에 배지를 아예 비운다 — "참고" 네 개가 항상 붙으면 아무 신호도
     아니게 되고, 배지가 보이는 순간이 예외라는 규칙이 무너진다. */
  chk(ok.avg.badge === '' && ok.p95.badge === '', '게이트가 아니면 배지 없음', JSON.stringify([ok.avg.badge, ok.p95.badge]));
}

// ── 화면과 리포트가 같은 카드를 낸다 ───────────────────────────────────────
/* _sevCards는 두 화면이 공유하는 조립기다. 라벨·배지·기준 문구가 갈리면
   같은 태그를 상세에서 보고 리포트를 뽑을 때 숫자와 배지가 둘 다 바뀐다. */
{
  const app = new App({ seed: 3, equipmentCount: 1 });
  app.E = CH;
  const roll = mkRoll(120, () => ({ rms: 3.5, crest: 6.06 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  const cards = app._sevCards(m, 'mm/s');

  chk(cards.length === 4, '카드는 4장', String(cards.length));
  /* Crest는 등급을 갖지 않는다 — 기준 √(2·ln N)이 가우시안 가정이라 롤업 버킷이 길어질수록
     실측이 기대를 계속 넘는다. 같은 데이터가 분 롤업 주의 / 시간 롤업 위험으로 갈렸다. */
  chk(m.crest.graded === false && cards[2].badgeKo === '' && cards[2].arrow === '',
    'Crest는 등급어도 화살표도 없다 — 롤업 길이에 등급이 뒤집혔다', JSON.stringify({ badge: cards[2].badgeKo, arrow: cards[2].arrow }));
  chk(/√\(2·ln N\)/.test(cards[2].foot2), 'Crest 기준의 근거를 각주로 남긴다', cards[2].foot2);
  chk(/등급 없음/.test(cards[1].foot2), '최댓값은 등급 없이 사실만', cards[1].foot2);
  chk(cards[1].label === 'P95 RMS · 1초 롤업(광대역)', '두 화면의 라벨이 같다', cards[1].label);
  chk(cards.every((c) => c.thrText), '모든 카드가 기준 문구를 갖는다');
  chk(cards.every((c) => c.badgeKo === '' && c.override === true),
    '평소엔 네 장 다 배지 없음 — 행 머리말이 한 번만 말한다', cards.map((c) => c.badgeKo).join('|'));

  // 등급어가 아닌 배지에는 override 표식이 붙는다(색이 등급을 주장하지 않게)
  const gated = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 25600, gate: true }), 'mm/s');
  chk(gated[0].override === true && gated[0].badgeKo === '잠정', '잠정 배지는 등급어가 아님을 표시한다', gated[0].badgeKo);
  chk(cards[0].override === true && cards[0].badgeKo === '' && cards[0].arrow === '',
    '평균 카드는 등급어·화살표가 없다 — 빨간 ▲는 등급 없이도 알람으로 읽힌다', cards[0].badgeKo);
}

// ── 계측 사유 목록이 감시와 상세에서 같다 ─────────────────────────────────
/* 목록이 갈리면 같은 태그가 모니터링에서는 판정 보류, 상세분석에서는 확정 등급이 된다.
   실제로 클리핑·DC 드리프트가 그랬다 — 감시는 막고 상세는 통과시켰다. */
{
  chk(VC.GATE_BLOCK.join(',') === 'flatline,sparse,spike,kurtx,clip,dc',
    '판정을 막는 사유는 이 여섯 가지', VC.GATE_BLOCK.join(','));

  // 함수 안 사본(서버 TQL 임베드용)이 모듈 상수와 갈라지지 않았는지 — 소스에서 직접 읽는다
  const inFn = /var BLOCK = \[([^\]]+)\]/.exec(VC.signalQuality.toString());
  chk(!!inFn && inFn[1].replace(/['\s]/g, '') === VC.GATE_BLOCK.join(','),
    'signalQuality 안 사본이 GATE_BLOCK과 같다', inFn && inFn[1]);

  // 클리핑 파형 — 꼭대기를 잘라 만든다
  const n = 8192, clipped = [];
  for (let i = 0; i < n; i++) clipped.push(Math.max(-0.6, Math.min(0.6, Math.sin(i * 0.05))));
  const q = VC.signalQuality(clipped, 2048);
  chk(q.issues.some((x) => x.key === 'clip'), '클리핑을 감지한다', q.issues.map((x) => x.key).join(','));
  chk(q.gate === true, '클리핑은 판정 보류 사유다 — 감시만 막고 화면은 통과시키면 두 화면이 갈린다', String(q.gate));

  const r = VC.gateReason(q, null);
  chk(!!r && r.key === 'clip' && r.src === 'det', '보류 사유를 하나로 집어낸다', r && r.key);
  // 감시가 본 사유가 있으면 그쪽이 우선 — 화면 문구는 판정이 실제로 멈춘 이유여야 한다
  const rm = VC.gateReason(q, { key: 'dc', label: 'DC 드리프트', detail: '...' });
  chk(rm.key === 'dc' && rm.src === 'mon', '감시가 본 사유가 우선한다', rm.key);
  chk(VC.gateReason({ ok: true, issues: [], gate: false }, null) === null, '멀쩡하면 사유가 없다');
}

// ── 보류 중에는 어느 카드도 등급어를 쓰지 않는다 ───────────────────────────
{
  const app = new App({ seed: 5, equipmentCount: 1 });
  app.E = CH;
  // 클리핑 상황을 그대로: RMS는 주의 구간, Crest는 낮게(잘려서)
  const roll = mkRoll(120, () => ({ rms: 2.03, crest: 1.08 }));
  const held = { key: 'clip', label: '클리핑(포화)', detail: '파형 꼭대기가 잘렸습니다' };
  const cards = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 2048, gate: true }), 'mm/s', held);

  chk(cards.every((c) => c.override), '네 장 모두 등급어가 아닌 배지', cards.map((c) => c.badgeKo).join(' · '));
  chk(cards[2].badgeKo === '잠정', 'Crest의 초록 양호가 사라진다 — 클리핑 신호에서 제일 위험한 배지', cards[2].badgeKo);
  chk(/클리핑은 꼭대기를 잘라/.test(cards[2].foot2), 'Crest가 왜 낮은지 각주로 적는다', cards[2].foot2);
  chk(/진폭이 과소/.test(cards[1].foot2), 'RMS도 과소일 수 있음을 밝힌다', cards[1].foot2);

  const dc = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 2048, gate: true }), 'mm/s',
    { key: 'dc', label: 'DC 드리프트' });
  chk(/과대/.test(dc[0].foot2), 'DC는 과대 방향임을 밝힌다 — 사유마다 틀리는 방향이 다르다', dc[0].foot2);

  // 보류가 아니면 등급어 그대로
  const okc = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 2048, gate: false }), 'mm/s', null);
  chk(okc.every((c) => c.badgeKo === ''), '보류가 풀리면 배지가 사라진다 — 잠정은 게이트에만 붙는다',
    okc.map((c) => c.badgeKo).join('|'));
}

// ── 카드 라벨은 실제 롤업 단위를 말한다 ───────────────────────────────────
/* 라벨에 "1초 롤업"을 박아 두면 기간이 길어져 분·시간 롤업이 되어도 계속 1초라고 말한다.
   임계 √(2·ln N)는 N을 따라가므로 판정은 맞고 라벨만 거짓이 된다 — 제일 찾기 어려운 종류다. */
{
  const app = new App({ seed: 11, equipmentCount: 1 });
  app.E = CH;
  const m = VC.sevMetrics(mkRoll(120, () => ({ rms: 1.0, crest: 4 })), { zones: ZONES, fs: 25600 });
  chk(/1초 롤업/.test(app._sevCards(m, 'mm/s', null, 1)[0].label), '초 롤업이면 1초', app._sevCards(m, 'mm/s', null, 1)[0].label);
  chk(/1분 롤업/.test(app._sevCards(m, 'mm/s', null, 60)[0].label), '분 롤업이면 1분', app._sevCards(m, 'mm/s', null, 60)[0].label);
  chk(/1시간 롤업/.test(app._sevCards(m, 'mm/s', null, 3600)[1].label), '시간 롤업이면 1시간', app._sevCards(m, 'mm/s', null, 3600)[1].label);
}

// ── Crest 배지와 각주가 서로 어긋나지 않는다 ───────────────────────────────
/* 배지는 P95로 판단하는데 각주는 최댓값을 인쇄한다. P95만 경계 아래인 구간에서
   "위험"만 뜨고 아티팩트 경고는 안 붙어, 화면이 스스로 모순됐다. */
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

// ── 진폭 정상 + Crest 초과는 "징후 없음"으로 끝내지 않는다 ─────────────────
/* 등급은 진폭 축(ISO 존·베이스라인·대역)만 쓰므로 Crest가 빨개도 종합은 양호로 남는다.
   그 자체는 의도된 것이지만, 빨간 카드 옆에 "뚜렷한 결함 징후 없음 — 정상 운전"이라고
   쓰면 화면이 스스로 모순된다. 등급은 그대로 두고 문구만 사실을 반영한다. */
{
  const app = new App({ seed: 7, equipmentCount: 1 });
  app.E = CH;
  const eq = { id: 'T1:T1', table: 'T1', name: 'T1', alias: 'T1', grade: 0, zones: ZONES, unit: 'mm/s',
    rpm: 1800, fs: 25600, rms: 0.12, cls: 'II', bearing: null, rollup: [] };
  // _dxLive가 보는 최소 상세 — 스펙트럼은 비우고 계측 게이트도 없는 상태
  const det = { fft: { freqs: [], mags: [], markers: [] }, spectral: { notes: [], cause: null },
    envelope: { freqs: [], mags: [], markers: [], hint: '', fault: null },
    indics: [], quality: { ok: true, issues: [], gate: false }, raw: { fs: 25600, values: [] } };

  const calm = VC.sevMetrics(mkRoll(120, () => ({ rms: 0.12, crest: 3.0 })), { zones: ZONES, fs: 25600 });
  chk(calm.crest.grade === 0, '기준 이하 Crest는 양호', String(calm.crest.grade));

  /* 커버리지 — 축이 비어 있으면 "징후 없음"이라고 단정하지 않는다.
     worstGrade는 최댓값이라 축이 늘면 등급은 올라가기만 하므로, 관측 등급은 하한이다.
     "주의 이상"은 축 하나로도 참이지만 "양호"는 축이 다 살아있을 때만 단정할 수 있다. */
  /* 커버리지 분모는 "필수 축" 둘(ISO 존·결함 패턴)이다. 이 둘은 학습이 필요 없어 분석만으로
     완결되고, 베이스라인·대역은 "평소 대비"라 지속 감시의 개념이라 보강으로 뺀다 —
     넷을 한 분모로 두면 학습 안 한 설비에서 상세분석이 미완성으로 읽힌다. */
  chk(/판정 기준 0\/2/.test(app._dx(eq, det, calm).verdict),
    '필수 축이 비면 "이상 없음"이 아니라 커버리지를 밝힌다', app._dx(eq, det, calm).verdict);

  /* 네 축이 다 살아있으면 종전 문구 그대로. 축은 전부 "앵커 시점" 값이다 —
     ISO는 det.isoRms, 베이스라인은 앵커 파형 RMS vs 학습 한계, 대역은 det.bandAt, 패턴은 스펙트럼. */
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

  // 패턴 축이 원인을 지목하면 진폭이 양호여도 등급이 오른다
  app._evidence = () => ({ top: { f: '베어링 외륜(BPFO)', score: 80 }, gate: false, conf: [], block: '', confLines: '' });
  const dxP = app._dx(eq, detF, calm);
  chk(dxP.patGi === 1 && dxP.gi === 1, '진폭 양호 + 결함 패턴 → 주의', JSON.stringify({ pat: dxP.patGi, gi: dxP.gi }));
  chk(/베어링/.test(dxP.verdict) && !/징후 없음/.test(dxP.verdict),
    '원인을 지목했으면 "징후 없음"이라고 쓰지 않는다', dxP.verdict);
  /* ISO는 **등급을 켜지 않는다** — 결함 패턴이 게이트이고 ISO는 높이만 정한다.
     이 풀에서 ISO 단독 오탐이 69%인데 그게 등급을 그대로 끌어올리기 때문이다(게이트로 바꾸면 3%).
     대신 진동 수준이 존을 넘은 사실은 isoOnly와 판정문이 밝힌다 — 숨기지 않는다. */
  app._evidence = () => ({ top: { score: 0 }, gate: false, conf: [], block: '', confLines: '' });
  app._gradeState = {};
  const dxIso = app._dx(eq, Object.assign({}, detF, { isoRms: 8.0 }), calm);   // Class II D존
  chk(dxIso.gi === 0 && dxIso.isoOnly === 3,
    'ISO가 D존이어도 결함 패턴이 없으면 등급을 안 올린다 — 대신 isoOnly로 사실을 남긴다',
    JSON.stringify({ gi: dxIso.gi, isoOnly: dxIso.isoOnly }));
  chk(/베어링 결함 징후 없음/.test(dxIso.verdict) && /진동 수준/.test(dxIso.verdict),
    '판정문이 "양호"로 끝내지 않고 진동 수준을 밝힌다 — 원인이 베어링 밖일 수 있다', dxIso.verdict);
  /* 결함 패턴이 켜지면 ISO가 높이를 정한다 — 베이스라인 축과 같은 관용구(max(1, isoGi)). */
  app._evidence = () => ({ top: { f: '베어링 외륜(BPFO)', score: 80 }, gate: false, conf: [], block: '', confLines: '' });
  const dxBoth = app._dx(eq, Object.assign({}, detF, { isoRms: 8.0 }), calm);
  chk(dxBoth.gi === 3, '패턴 채택 + ISO D존 → 심각 (ISO가 높이를 정한다)', String(dxBoth.gi));
  const dxLow = app._dx(eq, Object.assign({}, detF, { isoRms: 0.2 }), calm);
  chk(dxLow.gi === 1, '패턴 채택 + ISO 양호 → 주의 (최소 한 칸은 올린다)', String(dxLow.gi));
  /* 상세분석의 게이트는 결함 패턴 하나다 — 베이스라인·대역이 켜져도 등급을 안 올린다.
     같은 태그가 학습 여부로 다른 등급을 내면 일회성 분석 도구로 못 쓴다(학습 전 3% → 후 15%였다). */
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

  app._evidence = App.prototype._evidence;   // 이후 검사에 영향이 가지 않게 되돌린다
  app._gradeState = {};

  // 스크린샷 상황: 평균 0.12 mm/s(양호)인데 Crest P95 14.7(위험)
  const spiky = VC.sevMetrics(mkRoll(120, () => ({ rms: 0.12, crest: 14.7 })), { zones: ZONES, fs: 25600 });
  const dxs = app._dx(eq, det, spiky);
  chk(spiky.avg.grade === 0 && spiky.crest.grade === 2, '진폭은 양호, Crest는 위험',
    JSON.stringify({ avg: spiky.avg.grade, crest: spiky.crest.grade }));
  chk(dxs.impulse === true && dxs.verdict === '진폭 정상 · 충격성 신호 존재 — 계측 확인 후 재평가',
    '빨간 Crest 옆에서 "정상 운전"이라고 쓰지 않는다', dxs.verdict);
  chk(dxs.gradeKo === '양호' && dxs.color === CH.STATUS[0].color,
    '문구만 바뀌고 등급·색은 양호 그대로 — Crest는 등급 축이 아니다', dxs.gradeKo);

  // 계측 게이트가 걸리면 그쪽이 우선 — 이미 계측 확인을 지시하고 있다
  const gated = app._dx(eq, Object.assign({}, det, {
    quality: { ok: false, gate: true, issues: [{ key: 'clip', label: '클리핑(포화)', detail: '꼭대기가 잘림' }] } }), spiky);
  chk(gated.impulse === false && /계측 검증 필요/.test(gated.verdict),
    '계측 게이트 문구가 충격성 문구를 덮는다', gated.verdict);

  // 판정이 충격성을 지적하면 권고도 따라간다 — 한 화면에서 서로 다른 지시를 내면 안 된다
  chk(!/정상 운전 유지/.test('포락선에서 베어링 결함 주파수 대조 · 센서·케이블·마운팅 점검'),
    '권고 문구가 "정상 운전 유지"와 겹치지 않는다');
}

// ── 결함 패턴 축 — 학습 없이 등급을 올린다 ────────────────────────────────
/* 진폭에 안 나타나는 초기 베어링 결함이 있다: 실측에서 베어링4 롤러결함이 ISO A존
   0.44 mm/s인데 포락선엔 BPFO가 서 있었다. 근거 점수는 스펙트럼 하나로 나오므로
   학습이 없어도 이 축은 돌아야 하고, 원인을 지목하는 점수면 등급도 따라야 한다. */
{
  chk(VC.patternGrade(VC.EVID_ADOPT, false) === 1, '원인 채택 점수면 주의', String(VC.patternGrade(VC.EVID_ADOPT, false)));
  chk(VC.patternGrade(VC.EVID_ADOPT - 1, false) === 0, '그 아래는 등급 없음', String(VC.patternGrade(VC.EVID_ADOPT - 1, false)));
  chk(VC.patternGrade(95, false) === 1, '아무리 강해도 상한은 주의 — 급한지는 진폭 축이 말한다', String(VC.patternGrade(95, false)));
  chk(VC.patternGrade(95, true) === 0, '계측 게이트 중에는 스펙트럼을 못 믿으므로 축을 비운다', String(VC.patternGrade(95, true)));

  // worstGrade 4번째 축 — 진폭 세 축이 전부 0이어도 패턴이 등급을 만든다
  const w = VC.worstGrade(0, 0, 0, 1);
  chk(w.gi === 1 && w.src === 'pattern', '진폭 양호 + 패턴 근거 → 주의(패턴)', JSON.stringify(w));
  // 더 나쁜 축이 있으면 그쪽이 이긴다(상한이 주의라 진폭을 덮지 않는다)
  const w2 = VC.worstGrade(3, 0, 0, 1);
  chk(w2.gi === 3 && w2.src === 'iso', '패턴이 진폭 판정을 끌어내리지 않는다', JSON.stringify(w2));
  chk(VC.worstGrade(0, 0, 0, 0).gi === 0, '아무 축도 안 걸리면 양호');
}

// ── 포락선 계열은 latch, 주파수 대역은 그대로 ─────────────────────────────
/* 스폴은 메워지지 않는다 — 신호만 부하·윤활·센서 각도에 따라 묻힌다. 그래서 "지금 안 보인다"를
   "없어졌다"로 읽으면 안 된다: 포락선 계열은 한 번 넘으면 최고 배수와 최초 시각을 기억해 유지한다.
   주파수 대역(1× 등)은 반대다 — 부하에 따라 정상적으로 오르내리므로 "지금 큰가"가 맞는 질문이다. */
{
  const BL = { mu: 1.0, sigma: 0, k: 3 };          // 한계 = max(1.0, 1.2) = 1.2
  const bls = { one: BL, envBPFI: BL };

  // 1차: 둘 다 이탈
  const t1 = 1000;
  const r1 = VC.bandJudge({ one: 3.0, envBPFI: 3.0 }, bls, false, null, null, t1);
  chk(r1.on && r1.latch.envBPFI && Math.abs(r1.latch.envBPFI.r - 2.5) < 1e-9 && r1.latch.envBPFI.at === t1,
    '포락선 이탈은 최고 배수와 최초 시각을 기억한다', JSON.stringify(r1.latch));
  chk(!r1.latch.one, '주파수 대역은 기억하지 않는다', JSON.stringify(Object.keys(r1.latch)));

  // 2차: 둘 다 한계 아래로 내려옴 — 포락선만 유지된다
  const r2 = VC.bandJudge({ one: 0.5, envBPFI: 0.5 }, bls, true, null, r1.latch, t1 + 60000);
  chk(r2.on, '포락선 이력이 있으면 이탈 상태가 유지된다', String(r2.on));
  const keys = r2.over.map((o) => o.k);
  chk(keys.indexOf('envBPFI') >= 0 && keys.indexOf('one') < 0,
    '유지되는 것은 포락선뿐 — 1× 대역은 내려오면 해제된다', keys.join(','));
  const ob = r2.over.filter((o) => o.k === 'envBPFI')[0];
  chk(ob.latched === true && Math.abs(ob.r - 2.5) < 1e-9 && ob.at === t1,
    '판정은 기억한 최고 배수로 하고 최초 시각을 함께 낸다', JSON.stringify({ r: ob.r, at: ob.at, latched: ob.latched }));
  chk(/이력 ×2\.50/.test(r2.detail), '이력으로 유지되는 항목은 detail에 그 사실을 적는다', r2.detail);

  // 최고 배수는 갱신되고 최초 시각은 유지된다 — "언제부터"가 흔들리면 latch의 뜻이 없다
  const r3 = VC.bandJudge({ one: 0.5, envBPFI: 6.0 }, bls, true, null, r2.latch, t1 + 120000);
  chk(Math.abs(r3.latch.envBPFI.r - 5.0) < 1e-9 && r3.latch.envBPFI.at === t1,
    '최고 배수는 갱신, 최초 시각은 유지', JSON.stringify(r3.latch.envBPFI));

  // 이력을 안 넘기면(재학습 후) 깨끗하게 시작한다
  const r4 = VC.bandJudge({ one: 0.5, envBPFI: 0.5 }, bls, false, null, null, t1 + 180000);
  chk(r4.on === false && !Object.keys(r4.latch).length,
    '재학습으로 이력을 지우면 이탈이 풀린다 — latch를 푸는 유일한 자리', JSON.stringify(r4.latch));
}

// ── 커토그램 탐색 상한 — 안티에일리어싱 롤오프를 반드시 뺀다 ──────────────
/* Nyquist 바로 아래는 안티에일리어싱 필터가 신호를 죽인 구간이라 남은 것이 수치 잡음이고,
   첨도는 에너지가 작을수록 폭발한다. 상한이 없으면 커토그램이 늘 거기를 골라 복조 대역
   전체가 잡음이 된다 — 실측(CWRU 12 kHz 결함 18파일)에서 전부 5813~6000 Hz를 골라
   결함 종류 적중이 0/18이었고, Nyquist의 80%로 자르니 7/18이 됐다.
   마운팅·에일리어싱 상한과 달리 설정이 아니라 신호처리에서 오는 상한이라 조건 없이 걸어야 한다. */
{
  chk(VC.KG_NYQ_FRAC > 0 && VC.KG_NYQ_FRAC < 1, '롤오프 상한 비율이 Nyquist 안에 있다', String(VC.KG_NYQ_FRAC));
  // 잡음만 있는 최상단 대역에서 첨도가 폭발하는 것 자체를 재현한다 — 상한이 필요한 이유
  const FS = 12000, N = 65536;
  const sig = new Array(N);
  for (let i = 0; i < N; i++) {
    // 2.5 kHz 공진 + 1 kHz 성분. Nyquist(6 kHz) 근처는 비워 둔다(안티에일리어싱을 흉내)
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

// ── 진동 축과 베어링 축은 갈라 낸다 ───────────────────────────────────────
/* 최댓값 하나로 뭉치면 비특이적 주파수 대역이 특이적 포락선 계열을 덮는다.
   실측(NASA IMS Set 1, 8채널): 정상 베어링이 vh2 ×3.97로 결함 베어링(×2.35)보다 높았다 —
   말기에 옆 베어링 결함이 축을 타고 그 센서에도 실리기 때문이다.
   포락선 결함주파수만 보면 정상 최대 1.26 / 결함 최소 1.42로 갈린다. */
{
  const BL = { mu: 1.0, sigma: 0, k: 3 };   // 한계 1.2
  const bls = { vh2: BL, envBPFI: BL };
  // 진동 대역이 크고 포락선은 낮은 경우 — "진동은 커졌으나 이 베어링이 상한 근거는 아니다"
  const spread = VC.bandJudge({ vh2: 4.8, envBPFI: 1.4 }, bls, false, null, null, 1000);
  chk(Math.abs(spread.freqR - 4.0) < 1e-9 && spread.freqKey === 'vh2',
    '진동 축은 주파수 대역 최대', JSON.stringify({ r: spread.freqR, k: spread.freqKey }));
  chk(Math.abs(spread.envR - 1.1666666666666667) < 1e-6 && spread.envKey === 'envBPFI',
    '베어링 축은 포락선 결함주파수 최대', JSON.stringify({ r: spread.envR, k: spread.envKey }));
  chk(spread.maxR === spread.freqR, '등급은 여전히 최댓값 — 갈라 내는 것은 원인 표시다');

  // 포락선만 걸린 경우 — 진동 축은 비어야 한다
  const envOnly = VC.bandJudge({ vh2: 0.5, envBPFI: 3.6 }, bls, false, null, null, 1000);
  chk(envOnly.freqR === 0 && envOnly.envR > 0,
    '포락선만 이탈하면 진동 축은 0', JSON.stringify({ freq: envOnly.freqR, env: envOnly.envR }));
  chk(envOnly.envKey === 'envBPFI', '어느 결함주파수인지 함께 낸다 — 내륜·외륜·롤러로 조치가 갈린다', envOnly.envKey);
}

// ── 결함주파수 대조 — 허용오차 하한과 FTF 제외 ────────────────────────────
/* ① 허용오차는 스펙트럼 분해능보다 좁을 수 없다. 저주파 결함주파수는 ±1%가 빈 간격보다
      작아 참값이 어느 빈에도 안 떨어지고, 그러면 원리적으로 매칭이 불가능하다.
   ② FTF(케이지)는 결함 후보가 아니다. 케이지는 정상 베어링에서도 항상 돌아 0.45×가 상태와
      무관하게 관측된다 — 실측에서 정상 채널이 초기부터 0.45× 하모닉 3개를 계속 냈다.
      ①만 넣고 FTF를 후보로 두면 정상 베어링이 곧바로 베어링 결함으로 잡힌다. */
{
  const bf = VC.bearingFreqs(2000, { n: 16, Bd: 8.407, Pd: 71.501, phi: 15.17 });
  const res = 20480 / 32768;   // 0.625 Hz

  // FTF 14.78 Hz — 가장 가까운 빈은 15.0(1.5% 벗어남). 허용오차 ±1%로는 절대 못 맞춘다
  const atFtf = VC.bearingMatch({ f0: 15.0, harm: 4 }, bf, 33.33, res);
  chk(atFtf.hit === null, 'FTF는 결함 후보가 아니다 — 케이지는 정상 베어링에서도 돈다',
    atFtf.hit ? atFtf.hit.key : '(hit 없음)');
  chk(!!atFtf.cage && atFtf.cage.harm === 4,
    '다만 관측 사실로는 남긴다(cage)', JSON.stringify(atFtf.cage));

  // 저주파 BSF — 저속 설비에서는 ±1%가 분해능보다 작아진다. 하한이 없으면 매칭 불가
  const slow = VC.bearingFreqs(300, { n: 16, Bd: 8.407, Pd: 71.501, phi: 15.17 });
  const f0 = Math.round(slow.BSF / res) * res;      // 참값에 가장 가까운 빈
  chk(Math.abs(f0 - slow.BSF) / slow.BSF > 0.01,
    '전제: 저속에서는 가장 가까운 빈도 ±1%를 벗어난다',
    'BSF ' + slow.BSF.toFixed(2) + ' vs 빈 ' + f0.toFixed(3));
  chk(VC.bearingMatch({ f0: f0, harm: 3 }, slow, 5, 0).hit === null, '하한 없으면 미검출(옛 동작)');
  const withRes = VC.bearingMatch({ f0: f0, harm: 3 }, slow, 5, res);
  chk(withRes.hit && withRes.hit.key === 'BSF', '분해능 하한을 주면 검출된다',
    withRes.hit ? withRes.hit.key : '없음');

  /* 구름체 결함은 자전 1회에 두 궤도를 각각 때리므로 2×BSF가 지배하는 것이 관례다
     (CWRU 공식 결함주파수표도 구름체를 4.7135× = 2×BSF로 적는다).
     ⚠실측 기록: CWRU 볼 결함 6파일에서 이 후보 추가의 이득은 0이었다 — 그 파일들의 지배 피크는
     BSF 배수가 아니라 1.00×·0.40× 같은 축 관련 차수였다. 물리적으로 옳고 오탐도 없어서
     (정상 4파일 전부 미검출 유지) 남기지만, 볼 결함을 잡아 주는 장치는 아니다. */
  const b2 = VC.bearingMatch({ f0: 2 * bf.BSF, harm: 3 }, bf, 33.33, res);
  chk(b2.hit && b2.hit.key === 'BSF' && b2.hit.ord === 2, '2×BSF도 BSF로 잡는다',
    b2.hit ? b2.hit.key + ' ord' + b2.hit.ord : '없음');
  chk(b2.negatives.indexOf('BSF') < 0,
    '한 배수가 맞았으면 그 계열은 음성 소견이 아니다', JSON.stringify(b2.negatives));

  /* 하한이 무한정 넓히지는 않는다. 하한이 실제로 구속하는 저주파에서 확인해야 한다 —
     BPFO처럼 ±2%가 분해능보다 큰 곳은 상대오차가 이기므로 이 검사가 무력해진다. */
  chk(VC.bearingMatch({ f0: slow.BSF + 2 * res, harm: 3 }, slow, 5, res).hit === null,
    '분해능 1.5배 밖은 여전히 미검출 — 하한이 허용오차를 무너뜨리지 않는다',
    'BSF ' + slow.BSF.toFixed(2) + ' + ' + (2 * res).toFixed(2) + 'Hz');
}

// ── 기간 내 "지속된 최악" — 백분위가 아니라 시간 기준 ─────────────────────
/* P95는 기간 길이에 따라 허용 시간이 달라진다(1시간=3분, 34일=41시간) — 같은 배지가 기간마다
   다른 물리를 뜻하게 된다. dwell은 시간 단위라 기간과 무관하게 같은 뜻을 유지한다.
   그리고 수집이 끊긴 갭을 건너뛴 연속은 연속이 아니다 — 안 끊으면 34일 중 흩어진 3개로도 만족된다. */
{
  const mk2 = (arr, stepMs = 60000) => arr.map((v, i) => ({ ms: 1700000000000 + i * stepMs, rms: v }));

  // 단발 스파이크 하나는 지속이 아니다
  const spike = VC.dwellWorst(mk2([0.5, 0.5, 9.0, 0.5, 0.5, 0.5]), 180000, 3);
  chk(spike && spike.v < 1, '단발 스파이크는 지속 최악이 되지 않는다', JSON.stringify(spike));

  // 연속 3개가 높으면 그 수준이 잡힌다(창 안 최솟값 = 그 창 내내 유지된 수준)
  const sust = VC.dwellWorst(mk2([0.5, 0.5, 3.0, 3.2, 3.1, 0.5]), 180000, 3);
  chk(sust && Math.abs(sust.v - 3.0) < 1e-9, '연속 유지된 수준을 잡는다', JSON.stringify(sust));
  chk(sust.durMs >= 180000, '요구한 지속 시간을 만족한다', String(sust.durMs));

  // 갭을 건너뛴 연속은 연속이 아니다 — 앞 2개 + (긴 공백) + 뒤 1개
  const gapped = [{ ms: 0, rms: 5 }, { ms: 60000, rms: 5 }, { ms: 60000 * 999, rms: 5 }];
  const g2 = VC.dwellWorst(gapped, 180000, 3);
  chk(g2 === null, '수집 갭을 건너뛴 연속은 지속으로 세지 않는다', JSON.stringify(g2));

  // 기간 길이가 달라도 같은 기준 — 같은 모양을 길게 늘여도 결과가 같다
  const shortP = VC.dwellWorst(mk2([0.5, 3.0, 3.0, 3.0, 0.5]), 180000, 3);
  const longP = VC.dwellWorst(mk2(Array(200).fill(0.5).concat([3.0, 3.0, 3.0]).concat(Array(200).fill(0.5))), 180000, 3);
  chk(shortP && longP && Math.abs(shortP.v - longP.v) < 1e-9,
    '기간 길이가 달라도 판정 기준이 같다 — P95와 다른 점',
    JSON.stringify({ short: shortP.v, long: longP.v }));
}

// ── 빈 입력에서 죽지 않는다 ────────────────────────────────────────────────
{
  const m = VC.sevMetrics([], { zones: ZONES, fs: 0 });
  chk(m.avg.value === 0 && m.n.buckets === 0 && isFinite(m.crest.thr),
    '버킷이 없어도 값이 나온다(0으로)', JSON.stringify({ thr: m.crest.thr, buckets: m.n.buckets }));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
