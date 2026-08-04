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
{
  const roll = mkRoll(120, () => ({ rms: 0.8, crest: 22 }));
  const m = VC.sevMetrics(roll, { zones: ZONES, fs: 25600 });
  chk(m.crest.badge === '계측 아티팩트 의심',
    'Crest 15 초과는 결함이 아니라 계측 아티팩트 — 등급어 대신 그 사실을 낸다', m.crest.badge);
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
  chk(short.trend.graded === false && short.trend.grade === 0 && short.trend.badge === '참고',
    '관측 60분 미만은 변화율 등급 없음(참고)', JSON.stringify({ durMin: short.n.durMin, badge: short.trend.badge }));

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
  chk(ok.avg.badge === '' && ok.avg.grade === 2, '게이트가 없으면 등급 그대로', String(ok.avg.grade));
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
  chk(cards[2].badgeKo === '주의', 'Crest 카드 배지 — 화면·리포트 공통', cards[2].badgeKo);
  chk(/√\(2·ln N\)/.test(cards[2].foot2), 'Crest 기준의 근거를 각주로 남긴다', cards[2].foot2);
  chk(/등급 없음/.test(cards[1].foot2), '최댓값은 등급 없이 사실만', cards[1].foot2);
  chk(cards[1].label === 'P95 RMS · 1초 롤업(광대역)', '두 화면의 라벨이 같다', cards[1].label);
  chk(cards.every((c) => c.badgeKo && c.thrText), '모든 카드가 배지·기준 문구를 갖는다');

  // 등급어가 아닌 배지에는 override 표식이 붙는다(색이 등급을 주장하지 않게)
  const gated = app._sevCards(VC.sevMetrics(roll, { zones: ZONES, fs: 25600, gate: true }), 'mm/s');
  chk(gated[0].override === true && gated[0].badgeKo === '잠정', '잠정 배지는 등급어가 아님을 표시한다', gated[0].badgeKo);
  chk(cards[0].override === false, '정상 등급어에는 표식이 없다');
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
  chk(okc[0].badgeKo === '주의' && okc[2].badgeKo === '양호', '보류가 아니면 등급어 그대로',
    okc.map((c) => c.badgeKo).join(' · '));
}

// ── 빈 입력에서 죽지 않는다 ────────────────────────────────────────────────
{
  const m = VC.sevMetrics([], { zones: ZONES, fs: 0 });
  chk(m.avg.value === 0 && m.n.buckets === 0 && isFinite(m.crest.thr),
    '버킷이 없어도 값이 나온다(0으로)', JSON.stringify({ thr: m.crest.thr, buckets: m.n.buckets }));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
