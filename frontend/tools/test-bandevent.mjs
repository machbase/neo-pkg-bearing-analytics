// 대역 판정·저장 구성 — DETAIL 컬럼·배수 등급·히스테리시스 ×0.9·대역 무이벤트(상태만 추적)
// · 임베드 판정기 앱↔서버 동등성·EVENTS INSERT 자릿수·알림 라우팅/페이로드
// · 밀도 균일화·채울 앵커·백필 계산부 동일성·측정 불가 대역·마운팅 상한 잠정 강등
// 오프라인(Neo 불필요) · npm run smoke 포함
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;
const { judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// 대역값 예시(BEARING:C1) + 정상 베이스라인(가정)
const NOW = { sub: 0.630, one: 1.090, fault: 1.783, high: 1.142, vh2: 2.559 };
const BLS = {
  sub: { mu: 0.60, sigma: 0.04, k: 3 }, one: { mu: 1.05, sigma: 0.06, k: 3 },
  fault: { mu: 1.20, sigma: 0.08, k: 3 }, high: { mu: 0.70, sigma: 0.05, k: 3 },
  vh2: { mu: 1.60, sigma: 0.12, k: 3 },
};

// ── DETAIL 컬럼·삭제 SQL ───────────────────────────────────────────────────
// 이벤트 표는 TAG 테이블 — NAME='<테이블>:<태그>'라 설비 단위 삭제 가능
chk(/DETAIL VARCHAR\(400\)/.test(SQL.monCreateTables().join('')), 'CREATE에 DETAIL 컬럼');
chk(/CREATE TAG TABLE EVENTS/.test(SQL.monCreateTables().join('')), '이벤트 표가 TAG 테이블');
chk(!/SUMMARIZED/.test(SQL.monCreateTables()[0]), '이벤트는 SUMMARIZED 없음(롤업 미생성)');
chk(/GRADE, LIM, DETAIL/.test(SQL.eventsSelect(10)), 'SELECT가 DETAIL 포함');
{
  const ins = SQL.eventInsert({ eid: 'e', ts: 1, tbl: 'T', tag: 'A', etype: 'band', grade: '주의', val: 1.34, lim: 1, detail: "fault=1.783/1.440 · o'x" });
  chk(/'fault=1.783\/1.440 · o''x'/.test(ins), 'INSERT가 DETAIL을 이스케이프해 담음');
  chk(/values\('T:A', from_timestamp\(/.test(ins), 'INSERT의 NAME이 <테이블>:<태그>');
}
{
  // 태그별 삭제
  chk(/where NAME='T:A'$/.test(SQL.eventsDeleteTag('T', 'A')), '태그별 삭제 SQL');
  /* 구간 삭제 — 이름마다 한 문장(공유 표라 시간만으로 지우면 남의 행까지 삭제, TAG 표는 NAME 정확일치 + 시간범위만 허용) */
  const evDel = SQL.eventsDeleteRange(['T:A', 'T:B'], 1, 2);
  chk(evDel.length === 2 && evDel.every((q) => /where NAME='T:[AB]' and TIME between from_timestamp\(.*\) and from_timestamp\(/.test(q)),
    '기간 삭제 SQL — 이름마다 한 문장', evDel[0]);
  const bdDel = SQL.bandDeleteRange(['T:A:fault'], 1, 2);
  chk(bdDel.length === 1 && /where NAME='T:A:fault' and TIME between from_timestamp\(/.test(bdDel[0]),
    '대역 기간 삭제 SQL', bdDel[0]);
}

// ── 배수 등급 ──────────────────────────────────────────────────────────────
{
  const j = VC.bandJudge(NOW, BLS, false);
  chk(j && j.on, '이탈 판정');
  chk(j.over.length === 3, '이탈 대역 3개 (fault·high·vh2)', j.over.map((o) => o.k).join(','));
  chk(Math.abs(j.maxR - 1.34) < 0.02, '최대 배수 ×1.34', '×' + j.maxR.toFixed(2));
  chk(j.gi === 1, '×1.34 → 주의(gi=1)', 'gi=' + j.gi);
  // 경계 확인
  const mk = (r) => ({ fault: BLS.fault.mu + 3 * BLS.fault.sigma === 0 ? 0 : VC.baselineLimit(BLS.fault) * r });
  chk(VC.bandJudge(mk(1.2), { fault: BLS.fault }, false).gi === 1, '×1.2 → 주의');
  chk(VC.bandJudge(mk(2.0), { fault: BLS.fault }, false).gi === 2, '×2.0 → 위험');
  chk(VC.bandJudge(mk(4.0), { fault: BLS.fault }, false).gi === 3, '×4.0 → 심각');
}

// ── 히스테리시스 ───────────────────────────────────────────────────────────
{
  // 한계의 0.95배 — 신규면 정상, 이탈 중이면 이탈 유지
  const lim = VC.baselineLimit(BLS.fault);
  const mild = { fault: lim * 0.95 };
  chk(!VC.bandJudge(mild, { fault: BLS.fault }, false).on, '신규 판정: ×0.95는 정상');
  chk(VC.bandJudge(mild, { fault: BLS.fault }, true).on, '이탈 중: ×0.95는 유지(플래핑 방지)');
  const rec = { fault: lim * 0.85 };
  chk(!VC.bandJudge(rec, { fault: BLS.fault }, true).on, '이탈 중: ×0.85는 복귀');
  chk(Math.abs(VC.BAND_HYST - 0.9) < 1e-9, '히스테리시스 상수 0.9', String(VC.BAND_HYST));
}

// ── 대역은 이벤트 없음 · 상태만 추적 ─────────────────────────────────────────
/* 대역 단독 알림은 계열 다중비교라 오탐이 큼 — 알림은 베이스라인이 내고 대역은 근거표에서 원인 계열 식별용 */
{
  const cfg = { escHold: 300000, recHold: 300000, reno: {} };
  let st = null; const seq = [], bbs = [];
  [false, true, true, true, false, false].forEach((on, i) => {
    const r = judgeTick(st, 1, false, 1000 * i, cfg, { on: on, gi: 1 });
    st = r.next;
    seq.push(r.events.filter((e) => /^band/.test(e.etype)).map((e) => e.etype).join(','));
    bbs.push(st.bb);
  });
  chk(seq.every((x) => x === ''), '대역 이벤트가 하나도 안 난다', JSON.stringify(seq));
  chk(JSON.stringify(bbs) === JSON.stringify([false, true, true, true, false, false]),
    '이탈 상태(bb)는 그대로 추적한다 — 근거표가 읽어야 한다', JSON.stringify(bbs));
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
  // 포락선 계열(envBPFO 등 대문자 키)도 복원 — 예전 정규식([a-z]만)은 빠뜨려 이벤트 목록에서 누락
  const envBls = { sub: { mu: 0.01, sigma: 0.005, k: 3 }, envBPFO: { mu: 0.05, sigma: 0.02, k: 3 }, envPkRel: { mu: 0.05, sigma: 0.02, k: 3 } };
  const je = VC.bandJudge({ sub: 0.05, envBPFO: 0.3, envPkRel: 0.4 }, envBls, false);
  const pe = VC.bandParse(je.detail);
  chk(pe.length === je.over.length && pe.some((o) => o.k === 'envBPFO' && o.ko === VC.BAND_KO.envBPFO) && pe.some((o) => o.k === 'envPkRel'),
    'DETAIL 왕복 — 포락선 계열 포함', je.detail + ' → ' + pe.map((o) => o.k).join(','));
}

// ── 판정 불가 ──────────────────────────────────────────────────────────────
chk(VC.bandJudge(NOW, null, false) === null, '베이스라인 없으면 판정 안 함(null)');
chk(VC.bandJudge(null, BLS, false) === null, '대역값 없으면 판정 안 함(null)');
chk(VC.bandJudge({ fault: 1.0 }, { one: BLS.one }, false) === null, '겹치는 대역이 없으면 판정 불가');

// ── 서버 모드 동등성 ───────────────────────────────────────────────────────
// 임베드본 = 원본 답 · TQL 판정 호출 · INSERT 자릿수 확인
{
  const Mon = (await import('../../cgi-bin/monitor/monitor.js')).default;
  /* 임베드본은 바깥 이름(상수·baselineLimit) 무참조 — 아무것도 주입하지 않고 평가(TQL과 같은 조건) */
  const src = VC.bandJudgeSrc();
  const embedded = new Function('return ' + src)();

  /* 판정 계열 목록이 두 벌(임베드 bandJudge 내부 리터럴 ↔ BAND_ORDER) — 어긋나면 알람만 조용히 누락
     · 문자열 비교 대신 실제 판정으로 확인 */
  {
    const bl = { mu: 1, sigma: 0.1, k: 3 };
    const judges = (bn) => { const r = embedded({ [bn]: 10 }, { [bn]: bl }, false); return !!(r && r.on); };
    const missed = VC.BAND_ORDER.filter((bn) => !judges(bn));
    chk(missed.length === 0, '임베드 판정기가 판정 계열을 하나도 빠뜨리지 않는다', missed.join(',') || '전부 판정');
    // 반대 방향 — 저장 전용 계열은 판정 제외("반복주파수 상승"을 이탈로 알리지 않게)
    const extra = VC.BAND_CTX.filter(judges);
    chk(extra.length === 0, '저장 전용 계열은 임베드 판정기도 무시한다', extra.join(',') || '없음');
  }
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
  /* 예비 목록(bandOrder 미지정 시 BORDER)도 정본과 일치해야 함 — 대역값 조회 NAME IN 목록이라 빠지면 조회 불가
     · 평소 안 도는 경로라 목록을 직접 꺼내 대조 */
  {
    const noOrder = Object.assign({}, spec);
    delete noOrder.bandOrder;
    const t2 = Mon.buildMonitorTql(noOrder);
    const i2 = t2.indexOf("var BORDER=");
    const got = i2 < 0 ? [] : JSON.parse(t2.slice(i2 + 11, t2.indexOf(";", i2)));
    chk(JSON.stringify(got) === JSON.stringify(VC.BAND_ORDER),
      '예비 대역 목록이 정본(BAND_ORDER)과 같다', got.join(',') || '못 찾음');
  }
  /* judgeTick 7번째 run = 정지·두절 시 판정 동결, 8번째 cyc = 회차 기준(패턴 측정 시각, patternRound가 결정)
     · cyc가 빠지면 판정 틱마다 회차가 세어짐 */
  chk(/judgeTick\(prev,rg,breach,now,CFG,bj,run,_pr\.cyc\)/.test(tql), '서버 TQL이 대역·운전여부·회차를 judgeTick에 전달');
  chk(/bandJudge\(bandNow\(t\), t\.bb/.test(tql), '서버 TQL이 최신 대역값으로 판정');
  chk(/BAND/.test(tql), '서버 TQL이 대역 테이블 조회');
  chk(/"대역 이탈"/.test(tql) || /대역 이탈/.test(tql), '알림 문구에 대역 이벤트 한글명');

  /* INSERT 인자 수 == EVENTS 컬럼 수 — 어긋나면 SQL 오류로 타이머 스크립트가 조용히 전면 중단
     · INSERT가 여러 곳(일반 이벤트·신호 두절)이라 전부 실제로 평가해 자릿수를 셈 */
  const inserts = [...tql.matchAll(/db\.exec\((\"insert into \"\+TBLP\+\"EVENTS values\([\s\S]*?)\);/g)].map((x) => x[1]);
  chk(inserts.length >= 2, 'INSERT 식 추출 (일반 + 신호 두절)', inserts.length + '곳');
  // 타입 괄호(VARCHAR(120) 등) 때문에 마지막 ')'까지 잡고 타입 괄호 제거
  const decl = /EVENTS \(([\s\S]*)\)/.exec(SQL.monCreateTables().find((s) => /EVENTS/.test(s)))[1];
  const cols = decl.replace(/\([^)]*\)/g, '').split(',').length;
  // 생성 식이 참조하는 이름을 전부 채워 실제 평가(문자열 조립이라 정적 검사로는 자릿수 불명)
  // dtms — TIME을 to_date 문자열로 변환(monitor.js 자체 정의)
  // TBLP·UPFX — 표 위치(공용 스키마)·행 키 접두(여기선 빈 값)
  const NAMES = ['esc', 'eid', 't', 'now', 'ev', 'GW', 'v2', 'l2', 'dt', 'key', 'last', 'durAgo', 'dtms', 'TBLP', 'UPFX'];
  const VALS = [String, 'T:A:1:band', { tbl: 'T', tag: 'A' }, 1, { etype: 'band', gi: 1 },
    ['양호', '주의'], 1.3, 1, 'fault=1/2', 'T:A', 0, () => '2시간', () => '2026-08-04 10:30:45 123', '', ''];
  let detailOk = false;
  inserts.forEach((src, i) => {
    const sqlStr = new Function(...NAMES, 'return ' + src)(...VALS);
    const args = sqlStr.replace(/^.*?values\(/, '').replace(/\)$/, '').split(',').length;
    chk(args === cols, 'INSERT#' + (i + 1) + ' 인자 수 == EVENTS 컬럼 수 (ERR-2026 회귀 방지)', args + '/' + cols);
    chk(/values\('T:A', to_date\('\d{4}-/.test(sqlStr), 'INSERT#' + (i + 1) + ' NAME·TIME이 TAG 규약');
    if (/'fault=1\/2', '[^']*'\)$/.test(sqlStr)) detailOk = true;   // DETAIL 다음 EID가 마지막
  });
  chk(detailOk, 'DETAIL이 EID 앞 인자로 들어감');
}

// ── 알림 라우팅 ────────────────────────────────────────────────────────────
// 라우팅 표는 심각도(주의/위험/심각) 행만 — 복귀 계열('양호')은 예외로 발송(해제 통지)
{
  const N = (await import('../../cgi-bin/notify/notify.js')).default;
  const cfg = { channels: { webhook: { on: true, to: 'http://x' } }, routes: { '주의': { webhook: true, timing: '즉시' } } };
  const t = (g, e) => N.shouldNotify(g, e, 'webhook', cfg);
  chk(t('주의', 'band'), '대역 이탈은 등급으로 라우팅');
  chk(t('양호', 'bandrec'), '대역 복귀는 등급 행이 없어도 발송(해제 통지)');
  chk(t('양호', 'recovery'), '정상 복귀도 동일');
  chk(!t('심각', 'band'), '미라우팅 심각도는 발송 안 함');
  chk(/bandrec/.test(N.serverSrc()), '서버 임베드 소스에도 bandrec 예외 포함');

  /* 발송 여부는 timing 하나로 결정
     · 옛 저장본 표기 '무시'도 꺼짐으로 읽음(설정·서버 TQL 호환) */
  const t2 = (routes) => N.shouldNotify('주의', 'band', 'webhook',
    { channels: { webhook: { on: true, to: 'http://x' } }, routes });
  chk(t2({ '주의': { timing: '즉시' } }), 'timing 즉시면 발송 — 체크박스 없이');
  chk(!t2({ '주의': { timing: '알림 안 함' } }), "'알림 안 함'은 미발송");
  chk(!t2({ '주의': { timing: '무시' } }), "옛 표기 '무시'도 미발송(저장본 호환)");
  chk(t2({ '주의': { webhook: false, timing: '즉시' } }), '남은 webhook 키는 무시된다 — 이관이 timing으로 옮겨 둔다');

  /* 대상별 페이로드 — URL로 판별(Slack·Discord는 필드 배타적, Google Chat은 모르는 필드면 400) */
  const msg = { subject: 's', text: 's\nline2\nline3', html: '<b>h</b>', event: { gradeKo: '위험' } };
  const P = (url) => N.payloadFor(msg, url);
  {
    // Discord는 embed — 등급을 색 막대로 구분
    const d = P('https://discord.com/api/webhooks/1/x');
    chk(!d.content && d.embeds && d.embeds.length === 1, 'Discord는 embed로 보낸다');
    chk(d.embeds[0].title === 's' && d.embeds[0].description === 'line2\nline3', '제목은 title로, 본문에서 첫 줄은 뺀다');
    chk(d.embeds[0].color === 0xe07b39, '심각도가 색으로 붙는다(위험=주황)');
    chk(P('https://discord.com/api/webhooks/1/x') && N.payloadFor({ subject: 's', text: 's', event: { gradeKo: '심각' } }, 'https://discord.com/api/webhooks/1/x').embeds[0].color === 0xe5484d, '심각=적색');
    chk(N.payloadFor({ subject: 's', text: 's', event: { gradeKo: '양호' } }, 'https://discord.com/api/webhooks/1/x').embeds[0].color === 0x3aa76d, '복귀(양호)=녹색');
  }
  chk(JSON.stringify(P('https://hooks.slack.com/services/x')) === JSON.stringify({ text: msg.text }), 'Slack은 text만');
  chk(JSON.stringify(P('https://chat.googleapis.com/v1/spaces/A/messages?key=k&token=t')) === JSON.stringify({ text: msg.text }),
    'Google Chat은 text만 — 모르는 필드는 400');
  const gen = P('https://my-endpoint.example/hook');
  chk(gen.text === msg.text && gen.subject === 's' && gen.body === '<b>h</b>' && !!gen.event, '자체 엔드포인트는 전 필드(메일형 포함)');
  chk(/chat\\.googleapis\\.com/.test(N.serverSrc()), '서버 임베드 소스에도 Google Chat 판별 포함');

  /* 메시지 본문 — 제목 정보(등급·설비·유형) 반복 없음, 값 줄은 유형별
     · 계측 이상에 자리 채움 0을 "측정값 0.000"으로 내보내지 않음 */
  {
    const m1 = N.eventMessage({ alias: '3번 펌프', tag: 'LOAD_03', typeKo: '임계 초과', gradeKo: '위험', etype: 'threshold', val: 5.753, lim: 2.8, unit: 'mm/s', timeText: 'T1' });
    chk(m1.subject === '[위험] 3번 펌프 (LOAD_03) · 임계 초과', '제목 한 줄에 판정의 전부', m1.subject);
    chk(m1.text.split('\n').length === 3, '본문은 값·시각 두 줄뿐(반복 없음)', String(m1.text.split('\n').length));
    chk(/×2\.05/.test(m1.text), '기준 대비 비율이 붙는다', m1.text.split('\n')[1]);
    const m2 = N.eventMessage({ alias: 'GATE_DC', tag: 'GATE_DC', typeKo: '계측 이상', gradeKo: '주의', etype: 'sensor_fault', val: 0, lim: 1.12, detail: 'DC 치우침 — 센서 바이어스 의심', timeText: 'T1' });
    chk(!/측정값|0\.000/.test(m2.text), '계측 이상에 측정값 0.000을 찍지 않는다', m2.text);
    chk(/DC 치우침/.test(m2.text), '대신 사유를 싣는다');
    const m3 = N.eventMessage({ alias: 'C1', tag: 'C1', typeKo: '대역 이탈', gradeKo: '위험', etype: 'band', val: 3.12, lim: 1, detail: 'envBPFO=…', timeText: 'T1' });
    chk(/알람 기준 대비 ×3\.12/.test(m3.text) && !/기준 1\.000/.test(m3.text), '대역은 비율만 — "측정값 3.12/기준 1.000"으로 찍지 않는다');
  }
}

// ── 밀도 균일화 ────────────────────────────────────────────────────────────
// 학습 창 안 구간별 표본 밀도 차이 보정 — 촘촘한 쪽이 기준을 지배하지 않게(주기 변경·타이머 정지 대비)
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
  // 격자당 대표 한 점 그대로 — 평균·중앙값으로 뭉치면 σ가 줄어 오경보 증가
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
// 이미 찬 칸은 건너뜀(태그 추가 후 재채우기 시 그 태그만)
// TAG 테이블은 NAME+TIME 중복을 막지 않아 안 빼면 겹쳐 쌓임
{
  const iv = 600000, now = 1785312345678;
  const all = VC.bandAnchors(now, iv, 5, {});
  chk(all.length === 5, '요청한 칸 수만큼', all.length + '개');
  chk(all.every((t) => t % iv === 0), '격자에 스냅 — 타이머가 찍을 칸과 같은 위치');
  chk(all.every((t, i) => i === 0 || t < all[i - 1]), '최신 → 과거 순서(중단해도 최신이 남게)');
  // 진행 중인 칸(floor(now/iv)) 제외 → 첫 앵커는 마지막 완료 칸
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
// 백필·타이머는 같은 계산부 사용 — 값이 이어붙어야 두 구간을 함께 학습 가능
{
  const Band = (await import('../../cgi-bin/monitor/band.js')).default;
  const tags = [{ tbl: 'T', tag: 'A', fr: 25, fs: 302 }];
  const timer = Band.buildBandTql({ tags, nowMs: 1000, dryRun: true });
  const back = Band.buildBandTql({ tags, nowMs: 1000, anchors: [1000, 400, 100], dryRun: true });
  chk(/var ANCHORS=null;/.test(timer), '타이머 모드: 앵커 없음 → MAX_TIME 하나');
  chk(/var ANCHORS=\[1000,400,100\];/.test(back), '백필 모드: 앵커 배열 임베드');
  chk(/MAX_TIME/.test(back), '백필도 MAX_TIME 경로를 유지(앵커 미지정 폴백)');
  // 계산부(FFT·대역적분·INSERT)는 두 모드 완전 동일
  const core = (s) => s.slice(s.indexOf('var durMs'), s.indexOf('$.yield("done"'))
    .replace(/var anch=ANCHORS;[\s\S]*?anch\.forEach\(function\(maxMs\)\{/, '');
  chk(core(timer) === core(back), '계산부가 두 모드에서 문자 단위로 동일 (값이 이어붙는 근거)');
  const bal = (s) => { let d = 0; for (const c of s) { if (c === '{' || c === '(') d++; if (c === '}' || c === ')') d--; } return d; };
  chk(bal(timer) === 0 && bal(back) === 0, '두 모드 모두 괄호 균형');
}

// ── 측정 불가 대역 ─────────────────────────────────────────────────────────
/* 대역 하한 > Nyquist면 값이 항상 0 — 학습하면 한계 0이라 조금만 커도 이탈
   · 판정·집계 양쪽에서 한계 0 대역 제외 */
{
  const zero = { mu: 0, sigma: 0, k: 3 };
  chk(VC.baselineLimit(zero) === 0, '전부 0인 대역의 한계는 0');
  const j = VC.bandJudge({ vh2: 0.0001, fault: 2.0 }, { vh2: zero, fault: { mu: 1.5, sigma: 0.1, k: 3 } }, false);
  chk(j && !/vh2/.test(j.detail), '판정이 한계 0인 대역을 건너뜀', j ? j.detail : 'null');
  chk(j && j.over.length === 1, '정상 대역만 이탈로 집계', String(j.over.length));
  // 한계 0 대역만 있으면 판정 불가(null)
  chk(VC.bandJudge({ vh2: 0.0001 }, { vh2: zero }, false) === null, '쓸 수 있는 대역이 없으면 판정 불가');
}

// ── 대역 경계와 측정 가능성 ────────────────────────────────────────────────
/* 1 kHz 위 대역은 회전주파수 무관 고정 하한 — 샘플레이트 2 kHz 미만이면 Nyquist 초과로 빈 대역
   · 분모는 측정 가능한 대역 수 */
{
  const nyq = (fs) => fs / 2;
  const e1k = VC.bandEdges(30, nyq(1000));
  chk(e1k[4][0] === 1000, '초고주파 하한은 1000 Hz 고정(회전주파수 무관)', String(e1k[4][0]));
  chk(VC.bandEdges(60, nyq(1000))[4][0] === 1000, '회전주파수를 바꿔도 하한 동일');

  // 1 kHz 샘플링: Nyquist 500 → 초고주파(1000~500)는 빈 대역
  const able1k = VC.BAND_FREQ.filter((bn) => VC.bandMeasurable(bn, 30, 1000));
  chk(able1k.length === 4, '1 kHz 샘플링에서 측정 가능 대역은 4개', able1k.join(','));
  chk(!VC.bandMeasurable('vh1', 30, 1000), '1~2 kHz 측정 불가');
  chk(VC.bandMeasurable('high', 30, 1000), '고주파(300~1000)는 측정 가능');

  // 25.6 kHz면 전부 가능
  chk(VC.BAND_FREQ.every((bn) => VC.bandMeasurable(bn, 30, 25600)), '25.6 kHz에서는 대역 전부 가능');
  /* 포락선 계열은 대역 경계가 없어 측정 가능 검사 통과(BAND_ORDER 전체로 돌려도 안 깨져야 함) */
  chk(VC.BAND_ORDER.filter((bn) => VC.BAND_FREQ.indexOf(bn) < 0).every((bn) => VC.bandMeasurable(bn, 30, 1000)),
    '포락선 계열은 대역 경계 검사를 통과한다');

  // 인자 없으면 허용 — 판단 불가를 "불가"로 단정하면 학습이 통째로 막힘
  chk(VC.bandMeasurable('vh1', 0, 0), '회전주파수·샘플레이트 불명이면 허용');
}
// ── 측정 불가 대역도 저장 ──────────────────────────────────────────────────
/* 0으로 저장(행을 빼면 "측정 불가"와 "타이머 미실행" 구분 불가)
   · 0 오해는 학습(전부 0이면 거부)·판정(한계 0이면 건너뜀)에서 차단 */
{
  const Band = (await import('../../cgi-bin/monitor/band.js')).default;
  const tql = Band.buildBandTql({ tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 1000 }], nowMs: 1, dryRun: true });
  chk(!/continue;/.test(tql.slice(tql.indexOf('for(var b=0;b<acc.length'))),
    '추출은 대역을 걸러내지 않는다 — 5개 전부 저장');
  chk((tql.match(/NAMES\[b\]/g) || []).length >= 1, '대역 이름으로 저장');
  // 빈 대역은 acc가 0이라 v=0
  const fr = 30, fs = 1000, nyq = fs / 2;
  const B = [[2, 15], [15, 45], [45, 300], [300, 1000], [1000, nyq]];
  chk(B[4][0] >= Math.min(B[4][1], nyq), '초고주파는 빈 대역이라 값이 0으로 나온다');
  chk(!VC.bandMeasurable('vh1', fr, fs), 'calc는 그 대역을 측정 불가로 판단(표시·학습용)');
}

// ── 마운팅 유효 상한 초과 대역 ─────────────────────────────────────────────
/* 마운팅 유효 상한 위 대역 = 잠정(부착부 공진일 수 있어 확정 근거 불가)
   · 제외하지 않고 값은 유지, 등급만 '주의'로 묶음(초기 베어링 결함·마운트 헐거움 관측용) */
{
  const fr = 30, fs = 25600;
  chk(JSON.stringify(VC.softBands(fr, fs, 'magnet')) === JSON.stringify(['vh2', 'vh3', 'vh4']),
    '자석(2 kHz): 상한을 걸치는 vh2부터 잠정', VC.softBands(fr, fs, 'magnet').join(','));
  chk(JSON.stringify(VC.softBands(fr, fs, 'stud')) === JSON.stringify(['vh4']),
    '스터드(10 kHz): vh4만 잠정', VC.softBands(fr, fs, 'stud').join(','));
  chk(VC.softBands(fr, fs, 'probe').length === 4, '프로브(1 kHz): vh1~vh4 전부 잠정');
  // 대역 상한 = 마운팅 상한이면 잠정 아님(상한 안에서 끝남)
  chk(VC.softBands(fr, fs, 'magnet').indexOf('vh1') < 0, '1~2 kHz는 자석 상한(2 kHz)에 딱 맞아 유효');
  // 마운팅 미상은 제한 없음(자석 가정은 과잉 차단)
  chk(VC.softBands(fr, fs, '').length === 0 && VC.softBands(fr, fs, 'unknown').length === 0, '마운팅 미상이면 제한 없음');
  chk(VC.softBands(0, fs, 'magnet').length === 0 && VC.softBands(fr, 0, 'magnet').length === 0, '회전주파수·샘플레이트 불명이면 제한 없음');

  const BL3 = { mu: 1.0, sigma: 0.1, k: 3 };          // 한계 1.3
  const lim3 = VC.baselineLimit(BL3);
  const hot = { vh3: lim3 * 4.0 };                     // 상한 위 대역만 ×4.0
  chk(VC.bandJudge(hot, { vh3: BL3 }, false).gi === 3, '상한 미적용이면 ×4.0 → 심각(gi=3)');
  const soft = VC.bandJudge(hot, { vh3: BL3 }, false, ['vh3']);
  chk(soft.on, '잠정 대역이어도 이탈은 이탈 — 알람 자체를 없애지 않는다');
  chk(soft.gi === 1, '잠정 대역만 이탈 → 주의(gi=1)로 묶임', 'gi=' + soft.gi);
  chk(soft.soft === true, '잠정 판정 플래그');
  chk(Math.abs(soft.maxR - 4.0) < 0.01, '배수 자체는 깎지 않는다(값은 사실이다)', '×' + soft.maxR.toFixed(2));
  chk(/vh3=.*\(잠정\)/.test(soft.detail), 'DETAIL에 잠정 표식', soft.detail);
  const rt = VC.bandParse(soft.detail);
  chk(rt.length === 1 && rt[0].soft === true, '저장된 DETAIL에서도 잠정이 읽힌다');

  /* 유효 대역이 함께 이탈하면 등급은 유효 대역 배수로만 결정(잠정 대역으로 심각 승격 금지) */
  const BLf = { mu: 1.0, sigma: 0.1, k: 3 };
  const both = { fault: VC.baselineLimit(BLf) * 2.0, vh3: lim3 * 4.0 };
  const mixed = VC.bandJudge(both, { fault: BLf, vh3: BL3 }, false, ['vh3']);
  chk(mixed.gi === 2, '유효 대역 ×2.0 + 잠정 ×4.0 → 위험(유효 배수 기준)', 'gi=' + mixed.gi);
  chk(mixed.soft === false, '유효 대역이 함께 걸리면 잠정 판정이 아니다');
  chk(mixed.over.length === 2 && mixed.over.some((o) => o.soft), '잠정 대역도 이탈 목록에는 남는다');

  // softKeys 미지정 = 잠정 없음과 동일(옛 호출부·저장된 TQL 호환)
  chk(JSON.stringify(VC.bandJudge(NOW, BLS, false, undefined)) === JSON.stringify(VC.bandJudge(NOW, BLS, false)),
    'softKeys 미지정은 기존 동작과 동일');
}

// ── 마운팅 상한의 서버 모드 동등성 ─────────────────────────────────────────
{
  const Mon = (await import('../../cgi-bin/monitor/monitor.js')).default;
  const embedded = new Function('return ' + VC.bandJudgeSrc())();
  const BL3 = { mu: 1.0, sigma: 0.1, k: 3 };
  const hot = { vh3: VC.baselineLimit(BL3) * 4.0 };
  chk(JSON.stringify(embedded(hot, { vh3: BL3 }, false, ['vh3'])) === JSON.stringify(VC.bandJudge(hot, { vh3: BL3 }, false, ['vh3'])),
    '임베드본도 잠정 강등을 같게 판정 (앱↔서버 드리프트 0)');
  const tql = Mon.buildMonitorTql({
    judgeSrc: judgeTick.toString(), limitSrc: VC.baselineLimit.toString(),
    bandSrc: VC.bandJudgeSrc(), bandOrder: VC.BAND_ORDER, bandWinMs: 7200000,
    tags: [{ tbl: 'T', tag: 'A', alias: 'a', unit: 'mm/s', zones: [1, 2, 3], bl: BL3, bb: { vh3: BL3 }, soft: ['vh3'] }],
    cfg: { escHold: 0, recHold: 0, reno: {} },
  });
  chk(/bandJudge\(bandNow\(t\), t\.bb, !!\(prev&&prev\.bb\), t\.soft, prev&&prev\.elat, now\)/.test(tql),
    '서버 TQL이 상한 초과 대역과 포락선 이탈 이력을 판정에 전달');
  chk(/"soft":\["vh3"\]/.test(tql), '태그 스펙에 잠정 대역 목록이 값으로 구워짐');
  /* 포락선 이탈 이력(elat)은 판정 상태에 저장 — 안 담으면 매 틱 초기화
     · 앱·서버가 같은 필드를 써야 모드 전환 시 이력 유지 */
  chk(/res\.next\.elat=_elat/.test(tql), '이탈 이력을 판정 상태에 담아 다음 틱으로 넘긴다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
