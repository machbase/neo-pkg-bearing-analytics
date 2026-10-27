/* 리포트(요약·전체 분석) 판정 표시 — 오프라인(Neo 불필요) · npm run smoke 포함
 * · 등급 배지 = 화면 카드 등급 + 네 단계 중 위치, 사유는 패턴×ISO 조합(A~D)별 개조식 한 줄
 * · 심각도: 결함 패턴(등급 발동) × ISO 존(등급 수준) — 존은 A~D·규격 뜻, 등급어는 결과 줄에만, A·B는 한 칸
 * · 등급 없는 카드도 값·기준으로 초과 판단 · 0점 후보는 '근거 없음'으로 · LLM 소견은 질문 셋(지금 상태 · 그렇게 보는 이유 · 권장 행동)
 */
import Report from '../../cgi-bin/report/report.js';

let pass = 0, fail = 0;
const chk = (ok, msg, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (got ? ' — ' + got : '')); ok ? pass++ : fail++; };

const GK = ['양호', '주의', '위험', '심각'];
const BYZ = [1, 1, 2, 3];
// 등급 배지 글자(아이콘 SVG 뒤)
const badge = (h) => { const m = h.match(/class="gb (?:t\d|tn)">(?:<svg[\s\S]*?<\/svg>)?<span>([^<]*)<\/span>/); return m ? m[1] : null; };
const part = (h, open, close) => { const a = h.indexOf(open); return a < 0 ? '' : h.slice(a, h.indexOf(close, a + open.length) + close.length); };
const resRow = (h) => part(h, '<div class="res">', '</div></div>');
const vis = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const count = (s, t) => s.split(t).length - 1;

/* 리포트는 재판정 없이 앱이 넘긴 값만 인쇄 — 최소 페이로드로 재현 */
function build(gi, judge, isoIdx, extra, top) {
  return Report.buildReportHTML(Object.assign({
    docNo: 'VBR-TEST', alias: 'T', tagName: 'T:T', generatedText: '-', specs: [{ k: '데이터 건수', v: '1,000', unit: '건' }],
    sevMachine: 'T · Class II · 1800 RPM', isoClass: 'II',
    gradeKo: GK[gi], gradeIdx: gi, zones: ['1.12', '2.80', '7.10'], zonesUnit: 'mm/s',
    judge: Object.assign({ byZone: BYZ }, judge), verdict: '판정문', verdictSub: '-', anchorBrief: { at: '01:23', note: '8구간 중 6구간 동일' },
    sevCards: [], actions: [{ txt: '다음 정기 점검 시 베어링 점검' }, { txt: '구동 계통도 입력' }],
    build: { cells: [{ k: 'Analysis Engine', v: 'v1', subs: ['Ruleset R', 'Fingerprint F'] }, { k: 'Report ID', v: 'VBR-TEST' }] },
    data: {
      iso: isoIdx == null ? null : { rms: '3.20', gradeIdx: isoIdx, gradeKo: GK[isoIdx], anaSec: '24', blocks: 8, spread: '1.1' },
      evidence: [], summary: { cands: top || [], unmeasurable: [], rpmTxt: '1800 rpm' },
    },
  }, extra || {}));
}

// ── A. 패턴 ○ · ISO C — 등급 위험 ────────────────────────────────────
{
  const h = build(2, { patOn: true, patNa: false, isoGi: 2, isoOnly: 0, site: '베어링 외륜(BPFO)', isoPos: 60 }, 2);
  chk(badge(h) === '위험', 'A 등급 배지가 판정 등급(위험)', badge(h));
  chk(h.includes('>3/4</span>'), 'A 네 단계 중 위치(3단계)');
  chk(/class="pill on t2">(?:<svg[\s\S]*?<\/svg>)?베어링 외륜\(BPFO\)</.test(h), 'A 결함 패턴 알약이 부위로 켜진다');
  chk(h.includes('베어링 결함주파수 성분 출현 · 진동 크기 ISO C 구간(제한 운전)'), 'A 사유를 개조식 한 줄로');
  chk(h.includes('<div class="vd-h">베어링 결함 진행 단계</div>') && !h.includes('>판정문<'), 'A 제목은 부위 세분 대신 "베어링 결함 + 단계"');
  chk(h.includes('결함 패턴 있음 + ISO C 구간 → 위험'), 'A 판정 규칙 한 줄');
  chk(/class="t2 on"[^>]*>위험 · 현재</.test(resRow(h)) && resRow(h).includes('>심각<'), 'A 결과 줄에서 위험 칸이 현재, 다음 단계(심각)도 보인다');
}

// ── B. 패턴 ○ · ISO A — 진동이 아직 작은 초기 결함 ──────────────────
{
  const h = build(1, { patOn: true, patNa: false, isoGi: 0, isoOnly: 0, site: '베어링 내륜(BPFI)', isoPos: 1.3 }, 0);
  chk(badge(h) === '주의' && h.includes('>2/4</span>'), 'B 등급 주의 · 2단계', badge(h));
  chk(h.includes('진동 크기 정상(ISO A 구간) · 베어링 결함주파수 성분 먼저 출현'), 'B 진동이 작은데 왜 주의인지 개조식으로');
  chk(h.includes('<div class="vd-h">베어링 결함 초기 징후</div>'), 'B 제목 — 베어링 결함 초기 징후');
  chk(h.includes('판정 기준 <span class="v">01:23</span> · 8구간 중 6구간 동일') && !h.includes('관측 창') && !/<span>회전수 /.test(h), 'B 사실 줄은 단계 · 근거 점수 · 판정 기준만');
  chk(/<div class="todo">[\s\S]*?<b>다음 정기 점검 시 베어링 점검<\/b><\/div>/.test(h), 'B 지금 할 일은 한 줄');
  chk(/<b class="tc t0">A 구간<\/b>/.test(h), 'B ISO 카드 꼬리표는 존 색(A 초록)');
  const r = resRow(h);
  chk(count(r, '주의') === 1 && /class="t1 on" style="grid-column:span 2">주의 · 현재</.test(r), 'B A·B는 결과 줄 "주의" 한 칸으로 묶이고 현재로 켜진다', r.slice(0, 140));
  chk(/class="zn cur"><div class="b"><span class="pin" style="left:5\.2%"><\/span>/.test(h), 'B 현재 존 칸 안의 값 위치(1.3% → A칸 5.2%)');
  chk(/<div class="map">(<span>↓<\/span>){4}<\/div><div class="sv-ch"><b>판정 등급 <span>결함 패턴이 있을 때 · 위 구간별<\/span><\/b><span>현재 <b class="now t1">주의<\/b><\/span><\/div><div class="res">/.test(h),
    'B 판정 등급은 존 막대와 같은 급의 머리 + 존→등급 화살표 + 현재 등급');
}

// ── C. 패턴 ✕ · ISO C — 진동만 큼 ─────────────────────────────────
{
  const h = build(0, { patOn: false, patNa: false, isoGi: 2, isoOnly: 2, site: '질량 불평형', isoPos: 60 }, 2);
  chk(badge(h) === '양호' && h.includes('>1/4</span>'), 'C 결함 패턴이 없으면 ISO만으로 안 올린다', badge(h));
  chk(/class="pill on t0">(?:<svg[\s\S]*?<\/svg>)?없음</.test(h) && /class="pill">있음</.test(h), 'C "없음"이 켜지고 근거 1순위 이름을 "있음" 자리에 쓰지 않는다');
  chk(h.includes('진동 크기 C 구간(3.20 mm/s)으로 높지만 베어링 결함 패턴이 없어 등급 미반영'), 'C 진동이 크다는 사실을 숨기지 않는다');
  chk(h.includes('불평형') && h.includes('정렬불량') && h.includes('풀림') && h.includes('위상') && h.includes('축방향'), 'C 확인할 것과 판별 한계를 적는다');
  chk(!/ on"/.test(resRow(h)) && h.includes('지금은 결함 패턴이 없어 해당 없음'), 'C 결과 줄은 켜지지 않고 해당 없음을 적는다');
}

// ── D. 회전수·기하 없음 — 등급 아닌 측정 상태 ───────────────────────
{
  const h = build(0, { patOn: false, patNa: true, isoGi: 2, isoOnly: 0, site: '', isoPos: 60 }, 2);
  chk(badge(h) === '판정 못 함', 'D 배지가 "판정 못 함" — 양호로 인쇄하지 않는다', badge(h));
  chk(!/class="gb tn"><svg/.test(h) && !h.includes('/4</span>'), 'D 측정 상태엔 등급 아이콘·단계 없음');
  chk(/class="pill on tn">미측정 · 회전수·베어링 정보 없음</.test(h), 'D 결함 패턴 알약이 미측정(체크 없음)');
  chk(h.includes('명판 회전수') && h.includes('이 값만으로는 베어링 상태 판단 불가'), 'D 채울 정보와 ISO 값의 한계를 적는다');
  const g = build(0, { patOn: false, patNa: true, patWhy: 'gate', isoGi: 2, isoOnly: 0, site: '' }, 2);
  chk(badge(g) === '판정 보류' && g.includes('계측 이상으로 결함 패턴 판정 안 함') && !g.includes('명판 회전수'), "D' 계측 이상은 판정 보류 · 회전수 입력 안내 없음");
  const sl = build(0, { patOn: false, patNa: true, patWhy: 'sleeve', isoGi: 1, isoOnly: 1, site: '' }, 1);
  chk(badge(sl) === '판정 대상 아님' && sl.includes('결함 패턴 판정 대상 아님') && !sl.includes('명판 회전수'), "D' 저널 베어링은 품번을 넣으라고 하지 않는다");
}

// ── 존 막대 = ISO 눈금(등급 아님) ─────────────────────────────────
{
  const h = build(0, { patOn: false, patNa: false, isoGi: 2, isoOnly: 2, site: '' }, 2);
  const zl = (h.match(/<div class="zones">([\s\S]*?)<div class="map">/) || [])[1] || '';
  chk(zl.includes('A 신규 설비 수준') && zl.includes('D 손상 우려') && zl.includes('0 – 1.12') && zl.includes('7.10 mm/s 이상'), '존 이름은 규격 뜻, 범위는 0부터·마지막은 "이상"');
  chk(!/양호|주의|위험|심각/.test(zl) && !zl.includes('#'), '존에 등급어·등급색을 쓰지 않는다');
  chk(h.includes('결함 패턴이 등급을 발동하고, 진동 크기가 높이를 결정'), '심각도 절이 두 축의 역할을 적는다');
  const n = build(1, { patOn: true, patNa: false, isoGi: null, isoOnly: 0, site: '' }, null);
  chk(n.includes('ISO 값 없음') && !n.includes('class="pin"') && n.includes('ISO 값 계산 불가로 진동 크기 미반영'), 'ISO 값이 없으면 위치 대신 사유');
}

// ── 등급 없는 카드도 값·기준으로 초과 판단 ───────────────────────────
{
  const cards = [{ label: 'Crest P95 · 1초 롤업', value: '7.56', unit: '', thr: '기준 < 5.46', over: false, badgeKo: '', arrow: '', foot2: '최댓값 9.2' },
    { label: 'P95 RMS · 1초 롤업(광대역)', value: '0.119', unit: 'mm/s', thr: '기준 < 1.80', over: false, badgeKo: '', arrow: '', foot2: '광대역 B/C 초과 0/501버킷' }];
  const h = vis(build(1, { patOn: true, isoGi: 0, isoPos: 1 }, 0, { sevCards: cards }));
  chk(/Crest Factor P95<\/span><b class="tc">기준 초과/.test(h) && h.includes('충격성 성분 존재'), 'Crest 7.56 > 5.46 — 요약 카드에 기준 초과');
  chk(/광대역 RMS P95<\/span><b class="tc t0">기준 이내/.test(h) && h.includes('감시용 · 기준 1.80 · 초과 0/501'), '광대역 RMS는 기준 이내(초록) · B/C 초과 횟수');
  chk(h.includes('기준 5.46 · 충격성 성분 존재'), 'Crest 기준은 부등호 없이 값만');
  chk(/class="num over">7\.56/.test(h) && />초과<\/span>/.test(h) && />이내<\/span>/.test(h), '지표 표 상태도 초과·이내');
}

// ── 결함 후보 — 0점은 '근거 없음'으로 묶음 ─────────────────────────────
{
  const top = [{ f: '베어링(Bearing)', score: 45, why: 'BSF 측대역 무리' }, { f: '기계적 풀림', score: 0, why: '근거 부족' }];
  const evidence = [{ f: '베어링(Bearing)', score: 45, breakdown: 'BSF +45' }, { f: '기계적 풀림', score: 0 }, { f: '불평형', na: true, caveat: '위상·축방향 필요' }];
  const h = build(1, { patOn: true, isoGi: 0, isoPos: 1, site: '베어링(Bearing)' }, 0, { data: { iso: { rms: '0.038', gradeIdx: 0, anaSec: '15', blocks: 8 }, evidence,
    fft: { freqs: [1], mags: [1], markers: [{ label: '1×', freq: 29.2, kind: 'x' }, { label: 'BPFO', freq: 104.1, kind: 'fq' }, { label: 'BSF', freq: 67.6, kind: 'fq' }], dispHz: 1000, nyqHz: 10204 },
    summary: { cands: top, unmeasurable: [{ f: '불평형', why: '위상·축방향 필요' }] } } }, top);
  const card = part(h, '<span class="ct">결함 후보</span>', 'class="cand-f"');
  chk(card.includes('>베어링<') && !card.includes('기계적 풀림'), '0점 후보는 후보 목록에서 뺀다');
  chk(!card.includes('(Bearing)'), '후보 이름은 괄호 풀이 없이');
  chk(h.includes('그 외 1종 근거 없음 · 1종 측정 불가'), '근거 없음·측정 불가 개수를 적는다');
  chk(h.includes('근거 점수 <span class="v">45/100</span> · 중간'), '요약에 1순위 근거 점수와 강도');
  chk(h.includes('<span class="hit" title="전동체(볼) 결함 주파수 · 근거가 가리킨 성분"><b>BSF</b>전동체<span class="mono">67.6 Hz</span></span>') && !h.includes('>근거</span>')
    && h.includes('<span title="외륜 결함 주파수"><b>BPFO</b>외륜<span class="mono">104.1 Hz</span></span>') && h.includes('<b>1×</b>회전'),
    'FFT 기준 주파수 목록 — 약어 · 뜻 · 주파수, 근거가 가리킨 성분(BSF)만 테두리');
  chk(h.includes("fftc('cFft','tFft',{freqs:R.fft.freqs.slice(0,fe),mags:R.fft.mags.slice(0,fe),markers:[],"), 'FFT 차트엔 기준선을 긋지 않는다(저주파에 몰려 겹침)');
  chk(h.includes('<div class="rng"><button class="on" data-f="0" onclick="setFftRange(0)">기본 0–1.0 kHz</button>') && h.includes('onclick="setFftRange(1)">전대역 0–10.2 kHz</button>')
    && h.includes('.rng button:not(.on){display:none!important}'), 'FFT 기본 범위(상세분석과 같음) · 전대역 전환 · 인쇄엔 선택된 범위만 표기');
  const sv = part(h, '<section id="severity"', '<div class="sv-cols">');
  chk(/<div class="sv-act"><div class="todo">[\s\S]*?지금 할 일[\s\S]*?<\/div><div class="facts"><span>근거 점수 <span class="v">45\/100<\/span>/.test(sv), '심각도 머리에도 요약과 같은 지금 할 일 · 근거 사실(인쇄용)');
  chk(/<span>측정 불가 1종<\/span>/.test(h) && h.includes('측정 불가는 가능성이 낮은 게 아니라 볼 수 없는 것'), '측정 불가는 점수 대상 아님으로 따로 · 뜻은 권고 안내문');
}

// ── 전체 분석 04 결함 근거 · 05 세부 조치 · 차트 제목 ─────────────────────────
{
  const evidence = [
    { f: '베어링(Bearing)', score: 45, gains: [{ t: 'BSF 측대역 12개 · 배경 대비 15.3배', p: 45 }], breakdown: 'BSF 측대역 12개 · 배경 대비 15.3배 +45 = 45', caveat: '' },
    { f: '독립 회전원(종동축·인접 기계)', score: 40, gains: [{ t: '237.1 Hz(8.13×) 기본파 + 하모닉 3개', p: 40 }], caveat: '구동 계통도(풀리비·기어비)·인접 기계 배치 확인 필요 — 이 한 장이면 귀속이 닫힘' },
    { f: '오일 훨(Oil whirl)', score: 0, caveat: '구름베어링(6206) — 유막 베어링 현상이라 해당 없음' },
    { f: '기계적 풀림(Looseness)', score: 0, caveat: '' },
    { f: '불평형(Imbalance)', na: true, caveat: '위상·축방향 데이터 없음 — 단일 채널로는 원리상 판별 불가' },
    { f: '정렬불량(Misalignment)', na: true, caveat: '위상·축방향 데이터 없음 — 단일 채널로는 원리상 판별 불가' }];
  const data = { iso: { rms: '0.038', gradeIdx: 0 }, evidence, evidWeak: true, evidAdopt: 55,
    negatives: ['0.5× subharmonic 미검출', '100/120 Hz(2×계통주파수) 근처 성분 미검출 — 전기적 결함 정황 없음(전원 차단 시험으로 확정)'],
    negShort: ['0.5×', '2×계통주파수'], negCard: ['0.5× subharmonic', '100/120 Hz 계통주파수 → 전기적 결함 정황 없음'],
    unexplained: ['237.1Hz(8.13×)', '236.0Hz(8.09×)'], missing: [],
    acq: { winSec: 21.68, res: 0.21, averages: 4, isoBlocks: 8 },
    rms: [1], p2p: [1], kurt: [1], env: { freqs: [1] }, kurtogram: { best: { loHz: 7100, hiHz: 7400, sk: 3.8 } },
    summary: { cands: [{ f: '베어링(Bearing)', score: 45 }], unmeasurable: [] } };
  const h = build(1, { patOn: true, isoGi: 0, isoPos: 1 }, 0, { data, envBand: '1.0kHz–5.0kHz',
    actions: [{ txt: '다음 정기 점검에 베어링 상태 확인 · 윤활 · 체결' }, { txt: '구동 계통도(풀리비·기어비)·인접 기계 확인 — 237 Hz 성분 귀속' }] });
  const ev = part(h, '<section id="evidence"', '</section>');
  chk(/<div class="lcg"><div class="card chc">/.test(ev) && !/class="cg"/.test(ev), '04 근거 카드는 자기 격자(.lcg) — 차트 격자의 홀수 전체 폭 규칙이 안 걸림');
  chk(ev.includes('<div class="note">1순위 45점으로 원인 확정 기준(55점) 미달 — 등급은 결함 패턴이 정함(이 표는 원인 순위)</div>') && !ev.includes('유력 후보 없음'), '04 맨 위는 회색 한 줄 — 등급과 원인 순위를 구분');
  chk(ev.includes('>베어링<') && ev.includes('>독립 회전원<') && !ev.includes('(Bearing)'), '04 후보 이름은 괄호 풀이 없이');
  chk(ev.includes('BSF 측대역 12개 · 배경 대비 15.3배 <span class="pt">+45</span>') && !ev.includes('= 45') && !ev.includes('이 한 장이면'), '04 가점은 작게, 합계·설명 문장 없음');
  chk(ev.includes('오일 훨(해당 없음) · 기계적 풀림'), '04 근거 없음 — 해당 없는 후보는 따로 표시');
  chk(ev.includes('불평형 · 정렬불량 — 위상·축방향 데이터 없음</span>'), '04 측정 불가는 사유별 한 줄');
  chk(ev.includes('<span>100/120 Hz 계통주파수 → 전기적 결함 정황 없음</span>') && !ev.includes('전원 차단'), '04 미검출 카드는 무엇 → 뜻 한 줄');
  chk(ev.includes('title="237.1Hz(8.13×) · 236.0Hz(8.09×)"><span>236.0 · 237.1 Hz</span>'), '04 미설명은 주파수 오름차순, 배수는 title');
  chk(!ev.includes('미입력 정보와 그 영향') && !ev.includes('스펙트럼 취득 조건'), '04 미입력 항목이 없으면 카드 없음 · 취득 조건 카드 없음');
  const adv = part(h, '<section id="advice"', '</section>');
  chk(/<span class="tg tc">정기 점검<\/span>/.test(adv) && !adv.includes('단일 채널') && ev.includes('<div class="disc">단일 채널') && ev.includes('확정 진단은 정비 담당자 현장 확인 필요') && !h.includes('다축·위상 측정'),
    '05 세부 조치 — 정기 점검은 등급색 · 판단 한계 안내문은 04 끝으로(다축·위상 측정 문구 없음)');
  const adv2 = part(build(1, { patOn: true, isoGi: 0, isoPos: 1 }, 0, { actions: [{ txt: '베어링 이상음 · 발열 점검', why: '베어링 결함 신호 초기 단계', tag: '정기 점검' }] }), '<section id="advice"', '</section>');
  chk(adv2.includes('<span class="tx">베어링 이상음 · 발열 점검<span class="why">베어링 결함 신호 초기 단계</span></span><span class="tg tc">정기 점검</span>')
    && adv2.includes('<span class="t">세부 조치</span>'), '05 세부 조치 — 할 일 아래 이유, 항목 꼬리표');
  const none = build(0, { patOn: false, isoGi: 0 }, 0, { actions: [] });
  chk(none.includes('추가 조치 없음 — 지금 할 일대로 운전'), '세부 조치가 없으면 추가 조치 없음');
  chk(h.includes('<span class="t">RMS 추이<span class="en">ISO 10816 존 기준선</span></span>') && h.includes('<span class="t">첨도 추이<span class="en">Kurtosis</span></span>')
    && h.includes('진동 에너지(실효값)의 시간 변화'), '02 차트 제목은 상세분석과 같은 한글 + 영문명 · 한 줄 설명');
  chk(h.includes('<span class="t">포락선 분석<span class="en">Envelope</span></span><span class="s12 m3"><span class="mono">복조 1.0kHz–5.0kHz</span>')
    && h.includes('<span class="t">대역별 충격성<span class="en">Kurtogram</span></span>') && !h.includes('합니다'), '03 차트 제목 · 복조 대역 · 개조식');
}

// ── 판단의 한계 — 측정 불가는 사유별, 미검출은 짧은 이름, 미설명은 주파수만 ───────
{
  const um = [{ f: '불평형(Imbalance)', why: '위상·축방향 데이터 없음 — 단일 채널로는 원리상 판별 불가' },
    { f: '정렬불량(Misalignment)', why: '위상·축방향 데이터 없음 — 단일 채널로는 원리상 판별 불가' },
    { f: '베인 통과', why: '임펠러 날개수 미입력 — #날개×1× 대조 불가' }];
  const h = build(1, { patOn: true, isoGi: 0, isoPos: 1 }, 0, { data: { iso: { rms: '0.038', gradeIdx: 0, anaSec: '15', blocks: 8 }, evidence: [],
    negatives: ['0.5× subharmonic 미검출', '100/120 Hz(2×계통주파수) 근처 성분 미검출 — 전기적 결함 정황 없음'], negShort: ['0.5×', '2×계통주파수'],
    unexplained: ['237.1Hz(8.13×)', '504.3Hz(17.29×)'], summary: { cands: [], unmeasurable: um } } });
  const lim = part(h, '<span class="ct">판단의 한계</span>', '</section>');
  chk(lim.includes('불평형 · 정렬불량 — 위상·축방향 데이터 없음<br>베인 통과 — 임펠러 날개수 미입력') && !lim.includes('원리상'), '측정 불가는 사유별 한 줄 · 사유는 첫 구절만');
  chk(lim.includes('>0.5× · 2×계통주파수<') && !lim.includes('subharmonic'), '확인했으나 미검출은 짧은 이름');
  chk(lim.includes('237.1 · 504.3 Hz — 출처 확인 필요'), '미설명 성분은 주파수만');
  chk(lim.includes('<span class="c">3<small>종</small></span>') && lim.includes('<span class="c">2<small>종</small></span>') && lim.includes('<span class="c">2<small>개</small></span>'),
    '왼쪽 숫자는 개수 — 단위(종·개)를 붙여 순번으로 안 읽히게');
  const old = build(1, { patOn: true, isoGi: 0, isoPos: 1 }, 0, { data: { iso: { rms: '0.038', gradeIdx: 0 }, evidence: [], negatives: ['0.5× subharmonic 미검출'], summary: { cands: [], unmeasurable: [] } } });
  chk(old.includes('0.5× subharmonic 미검출'), '짧은 이름이 없는 옛 페이로드는 전문');
}

// ── 계측 게이트 — 요약 경고·잠정 후보·판정 보류 ────────────────────────
{
  const h = build(1, { patOn: true, isoGi: 0, isoPos: 1 }, 0, { data: { iso: { rms: '0.5', gradeIdx: 0, anaSec: '8', blocks: 8 }, gate: true,
    quality: { gate: true, issues: [{ key: 'spike', label: '단발 스파이크 의심', detail: 'Crest 18 — 스파이크성 잡음' }] },
    summary: { gate: true, gateReason: 'Crest P95 18.0', gateCap: 40, bias: '이 값은 상한', cands: [{ f: '베어링', score: 40 }], unmeasurable: [] } } });
  chk(h.includes('<div class="alert t3"><div class="h">계측 검증 필요 — 결함 진단 보류</div>'), '게이트면 요약에 빨간 경고');
  chk(h.includes('잠정 후보') && h.includes('전역 상한 40/100') && h.includes('이 값은 상한'), '후보는 잠정 · 상한 · 편향 방향');
  chk(/<div class="gate-box t3"><div class="gb-t">계측 검증 필요/.test(h), '심각도 절에 계측 경고 상자');
  chk(/<b>판정 보류<\/b>/.test(h), 'ISO 카드는 판정 보류');
}

// ── 전체 분석 지표 표 — 4행(ISO · Crest · 광대역 P95 · 변화율), 짧은 비고 + 전문은 title ──────
{
  const cards = [{ label: '평균 RMS · 1초 롤업(광대역)', value: '0.117', unit: 'mm/s', thr: '기준 < 1.80', foot2: '평균은 등급 없음' },
    { label: 'P95 RMS · 1초 롤업(광대역)', value: '0.119', unit: 'mm/s', thr: '기준 < 1.80', foot2: '최댓값 0.120 mm/s(등급 없음)', brief: '중앙 0.116 · 평균 0.117 · 최대 0.120 · B/C 초과 0/501 버킷' },
    { label: 'Crest P95 · 1초 롤업', value: '7.56', thr: '기준 < 5.46', foot2: '기준 = √(2·ln N) + 1', brief: '최댓값 9.20 · 1초 롤업' },
    { label: '변화율 (최근 1/4 ÷ 직전 1/4)', value: '×0.998', thr: '관측 8분 — 기준선 없음', foot2: '', brief: '관측 8분 · 기준선 없음(60분 이상 필요)' }];
  const data = { iso: { rms: '0.038', gradeIdx: 0, anaSec: '15.7', blocks: 8, spread: '1.07' }, levels: { 'mm/s': 0.116, g: 0.434, 'μm': 0.05 }, natUnit: 'mm/s', summary: {} };
  const h = build(1, { patOn: true, isoGi: 0, isoPos: 1, site: '베어링(Bearing)' }, 0, { sevCards: cards, data,
    build: { cells: [{ k: 'Analysis Engine', v: 'v1' }, { k: 'Acquisition', v: 'FFT 16,384' }, { k: 'Report ID', v: 'VBR-TEST' }] } });
  const tb = part(h, '<div class="card tbl mt">', '</section>');
  const rows = (tb.match(/<div class="r">/g) || []).length;
  chk(rows === 4 && !tb.includes('평균 RMS') && !tb.includes('실시간 감시'), '표는 4행 — 평균 RMS·실시간 감시 행 없음', rows + '행');
  chk(tb.indexOf('Crest Factor P95') < tb.indexOf('광대역 RMS P95') && tb.indexOf('광대역 RMS P95') < tb.indexOf('>변화율<'), '행 순서 ISO · Crest · 광대역 · 변화율');
  chk(/<span class="st t0 tc">A<\/span>/.test(tb) && /<span class="st t0 tc">이내<\/span>/.test(tb) && /<span class="st t1 tc">초과<\/span>/.test(tb), '상태색 — A 초록 · 이내 초록 · 초과 주황');
  chk(tb.includes('title="기준 = √(2·ln N) + 1">최댓값 9.20 · 1초 롤업<'), '비고는 짧게, 전문은 title');
  chk(tb.includes('>등급 근거 · 10–1000 Hz 속도 RMS · 8블록 평균 · 15.7 s<') && tb.includes('블록간 변동 ×1.07'), 'ISO 비고는 짧게, 변동은 title');
  const sv = part(h, '<section id="severity"', '<div class="sv-cols">');
  chk(!sv.includes('먼저 출현') && sv.includes('결함 패턴 있음 + ISO A 구간 → 주의'), '판정식이 담는 사유는 심각도 머리에서 반복하지 않는다');
  chk(/class="pill on t1">(?:<svg[\s\S]*?<\/svg>)?베어링</.test(h) && !h.includes('(Bearing)<'), '결함 패턴 알약은 괄호 풀이 없이');
  chk(!/물리량별 RMS/.test(h), '표 아래 물리량별 RMS 문장 없음');
  const mt = part(h, '<footer id="meta"', '</footer>');
  chk(/Acquisition[\s\S]*Broadband RMS<\/span><span class="v">0\.116 mm\/s<\/span><span class="s">0\.434 g<\/span><span class="s">0\.050 μm<\/span>[\s\S]*Report ID/.test(mt), '물리량별 RMS는 측정 정보 칸(원본 단위가 값)');
}

// ── LLM 소견 — 질문 셋(지금 상태 · 그렇게 보는 이유 · 권장 행동), 핵심 요약, 절 번호 · 목차 없음 ──────
{
  const opinion = '핵심 요약: 베어링 결함 초기 징후 · 원인은 확정 전 · 운전 유지하며 정기 점검에서 확인\n## 지금 상태\n• 진동 크기는 **0.038 mm/s**로 A 구간(신규 설비 수준)임\n## 그렇게 보는 이유\n• 베어링 근거점수 45점으로 확정 기준에 못 미침\n• 옛 형식 줄 → 결론 분리\n## 권장 행동\n• 운전 유지하고 다음 정기 점검에서 베어링 상태 확인함.\n• 버전 1.2 펌웨어 확인...';
  const top = [{ f: '베어링', score: 45 }];
  const h = build(1, { patOn: true, isoGi: 0, isoPos: 1 }, 0, { opinion, opinionModel: 'ornith 9B' }, top);
  chk(h.includes('<div class="llm-sum">베어링 결함 초기 징후 · 원인은 확정 전 · 운전 유지하며 정기 점검에서 확인</div>'), '요약 탭 LLM 카드에 핵심 요약(맨 앞 줄)');
  const llmAt = h.indexOf('class="llm-sum"');
  chk(llmAt > h.indexOf('<div class="facts">') && llmAt < h.indexOf('<span>ISO 판정값</span>'), '요약 탭 LLM 카드는 판정 카드 바로 아래(핵심 수치 위)');
  chk(h.includes('<span class="tent">잠정 판정</span>'), '1순위 근거가 강함(70) 미만이면 잠정 판정');
  const labs = (part(h, '<section id="llm"', '</section>').match(/<span class="lb">[^<]*<\/span>/g) || []).join('|');
  chk(labs === '<span class="lb">지금 상태</span>|<span class="lb">그렇게 보는 이유</span>|<span class="lb">권장 행동</span>', '섹션 = 질문 셋, 소제목 그대로', labs);
  chk(h.includes('<div class="it"><span>진동 크기는 <b>0.038 mm/s</b>로 A 구간(신규 설비 수준)임</span></div>'), '"→" 없는 줄은 한 줄(결론 줄 없음)·굵게 표시');
  chk(h.includes('<span>옛 형식 줄</span><span class="cc">'), '"→"가 있으면 결론 분리(옛 형식 호환)');
  chk(h.includes('<span>운전 유지하고 다음 정기 점검에서 베어링 상태 확인함</span></div>') && h.includes('<span>버전 1.2 펌웨어 확인...</span>'), '줄 끝 마침표만 제거(소수점 · 말줄임표 보존)');
  chk(!/class="na"|<span class="no">01<\/span><div class="it">/.test(part(h, '<section id="llm"', '</section>')), '권장 행동은 번호 매기지 않음(세부 조치 목록과 구분)');
  chk(!/<span class="lb">[^<]*<\/span><div class="its"><div class="it"><span>핵심 요약/.test(h), '핵심 요약은 항목으로 중복 인쇄하지 않는다');
  chk(h.includes('<span class="n">05</span><span class="t">세부 조치</span>') && h.includes('<span class="n">06</span><span class="t">LLM 소견</span>'), 'LLM 소견이 있으면 06');
  chk(!/<nav|class="rnav"|full-grid|syncNav/.test(h), '전체 분석에 왼쪽 목차 없음(마크업 · 스타일 · 스크롤 동기화 모두)');
  const n = build(1, { patOn: true, isoGi: 0 }, 0, {}, top);
  chk(!n.includes('<section id="llm"') && !n.includes('<span class="n">06</span>') && !n.includes('class="llm-sum"'), 'LLM 소견이 없으면 절·카드·06 번호 없음');
  chk(/@media print\{[^]*?\.meta\{grid-template-columns:none;grid-auto-flow:column/.test(n), '인쇄 시 측정 정보는 한 줄(칸 수와 무관)');
  chk(n.includes('.cg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))') && n.includes('.cg>.chc:last-child:nth-child(odd){grid-column:1/-1}'), '추세·스펙트럼 차트는 2열(4장 = 2×2), 홀수 마지막 장은 한 줄 전체');
}

// ── 머리·탭·측정 정보 ───────────────────────────────────────────────
{
  const h = build(0, { patOn: false, isoGi: 0 }, 0);
  chk(h.includes('data-v="sum"') && h.includes('>전체 분석</button>'), '요약 / 전체 분석 탭');
  chk((h.match(/class="theme-btn"/g) || []).length === 2, '인쇄·테마 버튼');
  chk(/class="meta"><div><span class="k">Analysis Engine<\/span><span class="v">v1<\/span><span class="s">Ruleset R<\/span>/.test(h), '측정 정보(재현성) 칸');
  chk(/데이터 건수 <span class="v">1,000건<\/span>/.test(h), '머리에 조회 사양');
}

// ── 모델 직접 — 결과 줄 묶음은 정본 규칙(byZone)에서 ──────────────────
{
  const m = Report.sevModel({ gi: 1, gradeKo: '주의', judge: { patOn: true, byZone: BYZ }, iso: { idx: 1, val: '1.5 mm/s' }, zones: ['1.12', '2.80', '7.10'] });
  chk(JSON.stringify(m.iso.res.map((r) => [r.ko, r.span, r.on])) === JSON.stringify([['주의', 2, true], ['위험', 1, false], ['심각', 1, false]]), '결과 줄 = [주의×2, 위험, 심각], B 값이면 주의 칸');
  chk(m.step === 2 && Report.sevModel({ gi: 0, gradeKo: '양호', judge: { patNa: true } }).step === 0, '단계 = 등급+1, 판정 불가는 0');
  chk(Report.isoPinPct(1.5, [1.12, 2.8, 7.1], 1) > 25 && Report.isoPinPct(1.5, [1.12, 2.8, 7.1], 1) < 50, '값 위치는 해당 존 칸 안');
  chk(Report.isoPinPct(99, [1.12, 2.8, 7.1], 3) === 99.5 && Report.isoPinPct(0, [1.12, 2.8, 7.1], 0) === 0.5, '값 위치는 막대 양 끝 안으로 고정');
}

console.log(`\nreport judge: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
