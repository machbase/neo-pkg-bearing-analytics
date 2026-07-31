// 대역 이벤트 구성 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.
// 확정한 사양(①설비당 1건 ②DETAIL 컬럼 ③배수 등급 ④히스테리시스 ×0.9 ⑤시간홀드 미적용)이
// 실제 코드에서 그대로 지켜지는지 본다.
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;
const { judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// 실측 BEARING:C1 대역값 + 정상 시절 베이스라인(가정)
const NOW = { sub: 0.630, one: 1.090, fault: 1.783, high: 1.142, vhigh: 2.559 };
const BLS = {
  sub: { mu: 0.60, sigma: 0.04, k: 3 }, one: { mu: 1.05, sigma: 0.06, k: 3 },
  fault: { mu: 1.20, sigma: 0.08, k: 3 }, high: { mu: 0.70, sigma: 0.05, k: 3 },
  vhigh: { mu: 1.60, sigma: 0.12, k: 3 },
};

// ── ② DETAIL 컬럼 ──────────────────────────────────────────────────────────
chk(/DETAIL VARCHAR\(400\)/.test(SQL.monCreateTables().join('')), 'CREATE에 DETAIL 컬럼');
chk(/ADD COLUMN \(DETAIL/.test(SQL.eventsAddDetail()), '기존 설치용 ALTER 제공');
chk(/GRADE, VAL, LIM, DETAIL/.test(SQL.eventsSelect(10)), 'SELECT가 DETAIL 포함');
{
  const ins = SQL.eventInsert({ eid: 'e', ts: 1, tbl: 'T', tag: 'A', etype: 'band', grade: '주의', val: 1.34, lim: 1, detail: "fault=1.783/1.440 · o'x" });
  chk(/'fault=1.783\/1.440 · o''x'\)$/.test(ins), 'INSERT가 DETAIL을 이스케이프해 담음');
}

// ── ③ 배수 등급 ────────────────────────────────────────────────────────────
{
  const j = VC.bandJudge(NOW, BLS, false);
  chk(j && j.on, '이탈 판정');
  chk(j.over.length === 3, '이탈 대역 3개 (fault·high·vhigh)', j.over.map((o) => o.k).join(','));
  chk(Math.abs(j.maxR - 1.34) < 0.02, '최대 배수 ×1.34', '×' + j.maxR.toFixed(2));
  chk(j.gi === 1, '×1.34 → 주의(gi=1)', 'gi=' + j.gi);
  // 경계 확인
  const mk = (r) => ({ fault: BLS.fault.mu + 3 * BLS.fault.sigma === 0 ? 0 : VC.baselineLimit(BLS.fault) * r });
  chk(VC.bandJudge(mk(1.2), { fault: BLS.fault }, false).gi === 1, '×1.2 → 주의');
  chk(VC.bandJudge(mk(2.0), { fault: BLS.fault }, false).gi === 2, '×2.0 → 위험');
  chk(VC.bandJudge(mk(4.0), { fault: BLS.fault }, false).gi === 3, '×4.0 → 심각');
}

// ── ④ 히스테리시스 ─────────────────────────────────────────────────────────
{
  // 한계의 0.95배 — 신규면 정상, 이탈 중이면 계속 이탈로 유지되어야 한다
  const lim = VC.baselineLimit(BLS.fault);
  const mild = { fault: lim * 0.95 };
  chk(!VC.bandJudge(mild, { fault: BLS.fault }, false).on, '신규 판정: ×0.95는 정상');
  chk(VC.bandJudge(mild, { fault: BLS.fault }, true).on, '이탈 중: ×0.95는 유지(플래핑 방지)');
  const rec = { fault: lim * 0.85 };
  chk(!VC.bandJudge(rec, { fault: BLS.fault }, true).on, '이탈 중: ×0.85는 복귀');
  chk(Math.abs(VC.BAND_HYST - 0.9) < 1e-9, '히스테리시스 상수 0.9', String(VC.BAND_HYST));
}

// ── ① 설비당 1건 · ⑤ 시간홀드 미적용 ───────────────────────────────────────
{
  const cfg = { escHold: 300000, recHold: 300000, reno: {} };  // 홀드를 크게 줘도 대역은 즉시 나야 한다
  let st = null; const seq = [];
  [false, true, true, true, false, false].forEach((on, i) => {
    const r = judgeTick(st, 1, false, 1000 * i, cfg, { on: on, gi: 1 });
    st = r.next;
    seq.push(r.events.filter((e) => /^band/.test(e.etype)).map((e) => e.etype).join(','));
  });
  chk(seq[1] === 'band', '이탈 온셋에 즉시 band 1건 (escHold 무시)', JSON.stringify(seq));
  chk(seq[2] === '' && seq[3] === '', '이탈 유지 중 중복 이벤트 없음');
  chk(seq[4] === 'bandrec', '복귀 시 bandrec 1건 (recHold 무시)');
  chk(seq.filter((x) => x).length === 2, '전 구간 대역 이벤트 정확히 2건 — 설비당 1건 원칙', seq.filter((x) => x).join('|'));
  chk(st.bb === false, '상태에 bb 필드 유지', 'bb=' + st.bb);
}

// ── DETAIL 왕복 ────────────────────────────────────────────────────────────
{
  const j = VC.bandJudge(NOW, BLS, false);
  const p = VC.bandParse(j.detail);
  chk(p.length === j.over.length, 'DETAIL 파싱 개수 일치', p.length + '/' + j.over.length);
  chk(p.every((o, i) => Math.abs(o.v - j.over[i].v) < 1e-6 && Math.abs(o.lim - j.over[i].lim) < 1e-3),
    'DETAIL 왕복 값 보존');
  chk(p[0].ko === '결함 대역', '한글 라벨 복원', p.map((o) => o.ko).join(','));
  chk(VC.bandParse('').length === 0 && VC.bandParse(null).length === 0, '빈 DETAIL은 빈 배열(기존 4종 이벤트)');
}

// ── 판정 불가 ──────────────────────────────────────────────────────────────
chk(VC.bandJudge(NOW, null, false) === null, '베이스라인 없으면 판정 안 함(null)');
chk(VC.bandJudge(null, BLS, false) === null, '대역값 없으면 판정 안 함(null)');
chk(VC.bandJudge({ fault: 1.0 }, { one: BLS.one }, false) === null, '겹치는 대역이 없으면 판정 불가');

// ── 서버 모드 동등성 ───────────────────────────────────────────────────────
// 대역 판정은 앱과 서버(타이머 TQL) 양쪽에서 돌아야 한다. 서버는 소스를 문자열로 임베드하므로
// (a) 임베드본이 원본과 같은 답을 내는지 (b) TQL이 판정을 실제로 호출하는지 둘 다 본다.
{
  const Mon = (await import('../../cgi-bin/monitor/monitor.js')).default;
  /* (a) 임베드본은 바깥 이름을 하나도 안 써야 한다 — 상수든 baselineLimit이든.
     예전엔 상수를 문자열로 앞에 붙여 감싸고 baselineLimit은 인자로 넣어 줬는데, 그렇게 하면
     검사만 통과하고 실제 TQL에서는 죽는다(감싸는 이름과 압축된 몸통 안 이름이 어긋난다).
     그래서 아무것도 넣어 주지 않고 그대로 평가한다 = TQL과 같은 조건. */
  const src = VC.bandJudgeSrc();
  const embedded = new Function('return ' + src)();
  const cases = [[NOW, BLS, false], [NOW, BLS, true], [{ fault: 0.5 }, BLS, false], [null, BLS, false], [NOW, null, false]];
  const same = cases.every(([n, b, w]) => JSON.stringify(embedded(n, b, w)) === JSON.stringify(VC.bandJudge(n, b, w)));
  chk(same, '임베드본과 원본 bandJudge 판정 일치 (앱↔서버 드리프트 0)');

  const spec = {
    judgeSrc: judgeTick.toString(), limitSrc: VC.baselineLimit.toString(),
    bandSrc: VC.bandJudgeSrc(), bandOrder: VC.BAND_ORDER, bandWinMs: 7200000,
    tags: [{ tbl: 'T', tag: 'A', alias: 'a', unit: 'mm/s', zones: [1, 2, 3], bl: { mu: 1, sigma: 0.1, k: 3 }, bb: BLS }],
    cfg: { escHold: 0, recHold: 0, reno: {} },
  };
  const tql = Mon.buildMonitorTql(spec);
  // 7번째 인자 run은 정지·두절 때 판정을 얼린다 — 대역 판정(bj)과 함께 전달돼야 한다
  chk(/judgeTick\(prev,rg,breach,now,CFG,bj,run\)/.test(tql), '서버 TQL이 대역 판정·운전여부를 judgeTick에 전달');
  chk(/bandJudge\(bandNow\(t\), t\.bb/.test(tql), '서버 TQL이 최신 대역값으로 판정');
  chk(/NEO_VIBE_BAND/.test(tql), '서버 TQL이 대역 테이블 조회');
  chk(/"대역 이탈"/.test(tql) || /대역 이탈/.test(tql), '알림 문구에 대역 이벤트 한글명');

  /* (b) INSERT 인자 수 == EVENTS 컬럼 수.
     DETAIL을 추가하면서 서버 INSERT를 안 고쳐 ERR-2026("insert values와 컬럼 수 불일치")으로
     서버 감시가 통째로 죽은 적이 있다. 타이머 컨텍스트는 SQL 오류 하나가 스크립트를 즉사시키므로
     조용히 전면 중단된다 — 생성된 식을 실제로 평가해 자릿수를 센다. */
  // 이벤트 INSERT는 한 곳이 아니다(일반 이벤트 · 신호 두절) — 전부 평가한다.
  // 새 INSERT를 추가할 때 컬럼 수를 안 맞추면 그 경로만 조용히 스크립트를 죽인다.
  const inserts = [...tql.matchAll(/db\.exec\((\"insert into NEO_VIBE_EVENTS values\([\s\S]*?)\);/g)].map((x) => x[1]);
  chk(inserts.length >= 2, 'INSERT 식 추출 (일반 + 신호 두절)', inserts.length + '곳');
  // VARCHAR(120) 안의 괄호 때문에 [^)]*로는 첫 괄호에서 끊긴다 — 마지막 ')'까지 잡고 타입 괄호를 지운다
  const decl = /NEO_VIBE_EVENTS \(([\s\S]*)\)/.exec(SQL.monCreateTables().find((s) => /NEO_VIBE_EVENTS/.test(s)))[1];
  const cols = decl.replace(/\([^)]*\)/g, '').split(',').length;
  // 생성 식이 참조하는 이름을 전부 채워 실제로 평가한다(문자열 조립이라 정적 검사로는 자릿수를 못 센다)
  const NAMES = ['esc', 'eid', 't', 'now', 'ev', 'GW', 'v2', 'l2', 'dt', 'key', 'last', 'durAgo'];
  const VALS = [String, 'T:A:1:band', { tbl: 'T', tag: 'A' }, 1, { etype: 'band', gi: 1 },
    ['양호', '주의'], 1.3, 1, 'fault=1/2', 'T:A', 0, () => '2시간'];
  let detailOk = false;
  inserts.forEach((src, i) => {
    const sqlStr = new Function(...NAMES, 'return ' + src)(...VALS);
    const args = sqlStr.replace(/^.*?values\(/, '').replace(/\)$/, '').split(',').length;
    chk(args === cols, 'INSERT#' + (i + 1) + ' 인자 수 == EVENTS 컬럼 수 (ERR-2026 회귀 방지)', args + '/' + cols);
    if (/'fault=1\/2'\)$/.test(sqlStr)) detailOk = true;
  });
  chk(detailOk, 'DETAIL이 마지막 인자로 들어감');
}

// ── 알림 라우팅 ────────────────────────────────────────────────────────────
// 라우팅 표는 심각도(주의/위험/심각) 행만 있다. 복귀 계열은 등급이 '양호'라 행이 없어
// 예외 처리를 안 하면 이탈 알림만 가고 해제 알림은 영영 안 간다.
{
  const N = (await import('../../cgi-bin/notify/notify.js')).default;
  const cfg = { channels: { webhook: { on: true, to: 'http://x' } }, routes: { '주의': { webhook: true, timing: '즉시' } } };
  const t = (g, e) => N.shouldNotify(g, e, 'webhook', cfg);
  chk(t('주의', 'band'), '대역 이탈은 등급으로 라우팅');
  chk(t('양호', 'bandrec'), '대역 복귀는 등급 행이 없어도 발송(해제 통지)');
  chk(t('양호', 'recovery'), '정상 복귀도 동일');
  chk(!t('심각', 'band'), '미라우팅 심각도는 발송 안 함');
  chk(/bandrec/.test(N.serverSrc()), '서버 임베드 소스에도 bandrec 예외 포함');
}

// ── 밀도 균일화 ────────────────────────────────────────────────────────────
// 학습 창 안에서 구간별 표본 밀도가 다르면 촘촘한 쪽이 기준을 결정해 버린다.
// 주기 변경뿐 아니라 타이머가 몇 시간 멈춰도 같은 일이 생기므로 안전망이 필요하다.
{
  const rows = [];
  for (let i = 0; i < 720; i++) rows.push({ ms: i * 60000, v: 2.0 + 0.1 * Math.sin(i) });        // 앞 12h · 1분 · 이상
  for (let i = 0; i < 72; i++) rows.push({ ms: 12 * 3600000 + i * 600000, v: 1.0 + 0.1 * Math.sin(i) }); // 뒤 12h · 10분 · 정상
  const mu = (v) => { const f = VC.baselineFit(VC.steadyStateFilter(v).vals); return f ? f.mu : NaN; };
  const rawMu = mu(rows.map((r) => r.v));
  const evenMu = mu(VC.evenSample(rows, 600000));
  chk(Math.abs(rawMu - 1.985) < 0.02, '균일화 전: 촘촘한 구간이 기준을 지배', 'μ=' + rawMu.toFixed(3));
  chk(Math.abs(evenMu - 1.500) < 0.02, '균일화 후: 시간 기준 절반씩', 'μ=' + evenMu.toFixed(3));
  chk(VC.evenSample(rows, 600000).length === 144, '10분 격자 → 72+72 = 144점');
  // 대표 한 점을 그대로 써야 한다 — 버킷 평균/중앙값으로 뭉치면 σ가 줄어 한계가 좁아지고 오경보가 는다
  const spread = [];
  for (let i = 0; i < 300; i++) spread.push({ ms: i * 60000, v: 1 + (i % 7) * 0.3 });
  const sdOf = (v) => { const f = VC.baselineFit(VC.steadyStateFilter(v).vals); return f ? f.sigma : NaN; };
  const sdAll = sdOf(spread.map((r) => r.v)), sdEven = sdOf(VC.evenSample(spread, 60000));
  chk(Math.abs(sdAll - sdEven) < 1e-9, '격자=원간격이면 무손실(솎지 않음)', sdAll.toFixed(4) + ' / ' + sdEven.toFixed(4));
  chk(VC.evenSample([], 600000).length === 0 && VC.evenSample(null, 6e5).length === 0, '빈 입력 안전');
  chk(VC.evenSample(rows, 0).length === rows.length, '격자 0이면 그대로(솎기 없음)');
  chk(VC.evenSample([{ ms: NaN, v: 1 }, { ms: 0, v: 2 }], 1000).length === 1, '시각 없는 행은 버림');
}

// ── 채울 앵커 선정 ─────────────────────────────────────────────────────────
// 태그를 새로 추가하고 다시 채우면 그 태그만 채워져야 한다(이미 찬 칸은 건너뜀).
// TAG 테이블은 같은 NAME+TIME 중복을 막지 않아, 안 빼면 다시 누를 때마다 겹쳐 쌓인다(실측 확인).
{
  const iv = 600000, now = 1785312345678;
  const all = VC.bandAnchors(now, iv, 5, {});
  chk(all.length === 5, '요청한 칸 수만큼', all.length + '개');
  chk(all.every((t) => t % iv === 0), '격자에 스냅 — 타이머가 찍을 칸과 같은 위치');
  chk(all.every((t, i) => i === 0 || t < all[i - 1]), '최신 → 과거 순서(중단해도 최신이 남게)');
  // 진행 중인 칸(floor(now/iv))은 아직 안 끝났으므로 제외한다 → 첫 앵커는 마지막 '완료된' 칸
  chk(all[0] < now && now - all[0] <= 2 * iv, '첫 앵커는 마지막 완료 칸(진행 중인 칸 제외)');
  chk(all[0] !== Math.floor(now / iv) * iv, '현재 칸은 만들지 않음');
  const have = {};
  all.slice(0, 2).forEach((t) => { have[t / iv] = true; });
  const left = VC.bandAnchors(now, iv, 5, have);
  chk(left.length === 3, '보유 칸은 제외 — 이어하기·태그 추가가 공짜', left.length + '개');
  chk(left.every((t) => !have[t / iv]), '제외된 칸이 다시 안 나옴');
  const full = {};
  all.forEach((t) => { full[t / iv] = true; });
  chk(VC.bandAnchors(now, iv, 5, full).length === 0, '전부 차 있으면 계산할 것 없음');
  chk(VC.bandAnchors(now, 0, 5, {}).length === 0 && VC.bandAnchors(now, iv, 0, {}).length === 0, '잘못된 인자는 빈 목록');
}

// ── 백필 앵커 ──────────────────────────────────────────────────────────────
// 백필과 타이머는 같은 계산부를 써야 값이 이어붙는다(다르면 두 구간을 함께 학습할 수 없다).
{
  const Band = (await import('../../cgi-bin/monitor/band.js')).default;
  const tags = [{ tbl: 'T', tag: 'A', fr: 25, fs: 302 }];
  const timer = Band.buildBandTql({ tags, nowMs: 1000, dryRun: true });
  const back = Band.buildBandTql({ tags, nowMs: 1000, anchors: [1000, 400, 100], dryRun: true });
  chk(/var ANCHORS=null;/.test(timer), '타이머 모드: 앵커 없음 → MAX_TIME 하나');
  chk(/var ANCHORS=\[1000,400,100\];/.test(back), '백필 모드: 앵커 배열 임베드');
  chk(/MAX_TIME/.test(back), '백필도 MAX_TIME 경로를 유지(앵커 미지정 폴백)');
  // 계산부(FFT·대역적분·INSERT)는 두 모드가 완전히 동일해야 한다
  const core = (s) => s.slice(s.indexOf('var durMs'), s.indexOf('$.yield("done"'))
    .replace(/var anch=ANCHORS;[\s\S]*?anch\.forEach\(function\(maxMs\)\{/, '');
  chk(core(timer) === core(back), '계산부가 두 모드에서 문자 단위로 동일 (값이 이어붙는 근거)');
  const bal = (s) => { let d = 0; for (const c of s) { if (c === '{' || c === '(') d++; if (c === '}' || c === ')') d--; } return d; };
  chk(bal(timer) === 0 && bal(back) === 0, '두 모드 모두 괄호 균형');
}

// ── 측정 불가 대역 ─────────────────────────────────────────────────────────
/* 대역 하한이 Nyquist보다 높으면 값이 항상 0이다(1× 30Hz면 초고주파 하한 990Hz인데
   302Hz 샘플링은 151Hz까지만 본다). 그대로 학습하면 μ=0·σ=0 → 한계 0이 되어
   0보다 큰 값이 한 번만 나와도 이탈로 잡힌다. 판정과 집계 양쪽에서 걸러야 한다. */
{
  const zero = { mu: 0, sigma: 0, k: 3 };
  chk(VC.baselineLimit(zero) === 0, '전부 0인 대역의 한계는 0');
  const j = VC.bandJudge({ vhigh: 0.0001, fault: 2.0 }, { vhigh: zero, fault: { mu: 1.5, sigma: 0.1, k: 3 } }, false);
  chk(j && !/vhigh/.test(j.detail), '판정이 한계 0인 대역을 건너뜀', j ? j.detail : 'null');
  chk(j && j.over.length === 1, '정상 대역만 이탈로 집계', String(j.over.length));
  // 한계 0짜리만 있으면 판정 자체가 불가(any=false)여야 한다
  chk(VC.bandJudge({ vhigh: 0.0001 }, { vhigh: zero }, false) === null, '쓸 수 있는 대역이 없으면 판정 불가');
}

// ── 대역 경계와 측정 가능성 ────────────────────────────────────────────────
/* 초고주파는 회전주파수와 무관하게 1000 Hz 고정 하한이다 — 33× 같은 상대값이 아니다.
   그래서 샘플레이트가 2 kHz 미만이면 하한이 Nyquist를 넘어 빈 대역이 되고, 값이 항상 0이 된다.
   그 태그는 5/5가 원리적으로 불가능하므로 분모를 "측정 가능한 대역 수"로 줄여야 한다. */
{
  const nyq = (fs) => fs / 2;
  const e1k = VC.bandEdges(30, nyq(1000));
  chk(e1k[4][0] === 1000, '초고주파 하한은 1000 Hz 고정(회전주파수 무관)', String(e1k[4][0]));
  chk(VC.bandEdges(60, nyq(1000))[4][0] === 1000, '회전주파수를 바꿔도 하한 동일');

  // 1 kHz 샘플링: Nyquist 500 → 초고주파(1000~500)는 빈 대역
  const able1k = VC.BAND_ORDER.filter((bn) => VC.bandMeasurable(bn, 30, 1000));
  chk(able1k.length === 4, '1 kHz 샘플링에서 측정 가능 대역은 4개', able1k.join(','));
  chk(!VC.bandMeasurable('vhigh', 30, 1000), '초고주파 측정 불가');
  chk(VC.bandMeasurable('high', 30, 1000), '고주파(300~1000)는 측정 가능');

  // 25.6 kHz면 전부 가능
  chk(VC.BAND_ORDER.every((bn) => VC.bandMeasurable(bn, 30, 25600)), '25.6 kHz에서는 5개 전부 가능');

  // 인자가 없으면 막지 않는다 — 판단 불가를 "불가"로 단정하면 학습이 통째로 막힌다
  chk(VC.bandMeasurable('vhigh', 0, 0), '회전주파수·샘플레이트 불명이면 허용');
}
// ── 측정 불가 대역도 저장한다 ──────────────────────────────────────────────
/* 행을 빼면 "측정 불가"인지 "타이머가 안 돌았는지" 구분이 안 된다. 0으로 남겨두고,
   0을 정상으로 오해하는 것은 학습(전부 0이면 거부)과 판정(한계 0이면 건너뜀)에서 막는다. */
{
  const Band = (await import('../../cgi-bin/monitor/band.js')).default;
  const tql = Band.buildBandTql({ tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 1000 }], nowMs: 1, dryRun: true });
  chk(!/continue;/.test(tql.slice(tql.indexOf('for(var b=0;b<acc.length'))),
    '추출은 대역을 걸러내지 않는다 — 5개 전부 저장');
  chk((tql.match(/NAMES\[b\]/g) || []).length >= 1, '대역 이름으로 저장');
  // 0이 나오는 조건 자체는 유지된다(빈 대역은 acc가 0이라 v=0)
  const fr = 30, fs = 1000, nyq = fs / 2;
  const B = [[2, 15], [15, 45], [45, 300], [300, 1000], [1000, nyq]];
  chk(B[4][0] >= Math.min(B[4][1], nyq), '초고주파는 빈 대역이라 값이 0으로 나온다');
  chk(!VC.bandMeasurable('vhigh', fr, fs), 'calc는 그 대역을 측정 불가로 판단(표시·학습용)');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
