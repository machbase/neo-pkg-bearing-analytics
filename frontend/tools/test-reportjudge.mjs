/* 리포트 헤드라인 등급 = 화면 카드 등급 — 오프라인(Neo 불필요)
 * · ISO 존과 갈리면 불일치 사실과 확인 사항 기재(패턴×ISO 조합 A~D)
 * · 게이지는 등급이 아닌 ISO 존 눈금임을 명시
 */
import Report from '../../cgi-bin/report/report.js';

let pass = 0, fail = 0;
const chk = (ok, msg, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (got ? ' — ' + got : '')); ok ? pass++ : fail++; };

const GK = ['양호', '주의', '위험', '심각'];
// 스타일시트에도 .judge-gap 규칙이 있어 클래스명 아닌 실제 문단(class 속성)으로 판별
const GAP = (h) => h.includes('class="judge-gap"');
const COLOR = ['#3aa76d', '#d99a2b', '#e07b39', '#e5484d'];

/* 리포트는 재판정 없이 앱이 넘긴 값만 인쇄 — 최소 페이로드로 재현 */
function build(gi, judge, isoIdx) {
  return Report.buildReportHTML({
    docNo: 'VBR-TEST', alias: 'T', tagName: 'T:T', generatedText: '-', specs: [],
    sevMachine: 'T · Class II · 1800 RPM',
    gradeKo: GK[gi], gradeColor: COLOR[gi], gradeIdx: gi,
    zones: ['1.12', '2.80', '7.10'], zonesUnit: 'mm/s',
    judge: judge, verdict: '-', verdictSub: '-', sevCards: [], stats: [], indics: [],
    data: {
      iso: isoIdx == null ? null
        : { rms: '3.20', gradeIdx: isoIdx, gradeKo: GK[isoIdx], color: COLOR[isoIdx], anaSec: '24', blocks: 8, spread: '1.1' },
      levels: [], evidence: [], summary: { cands: [], unmeasurable: [], rpmTxt: '-', obsTxt: '-', acqTxt: '-' },
    },
  });
}

// ── A. 패턴 ○ · ISO 위험 — 둘이 일치 ────────────────────────────────────
{
  const h = build(2, { patOn: true, patNa: false, isoGi: 2, isoOnly: 0, site: '베어링 외륜(BPFO)' }, 2);
  chk(h.includes('>위험<'), 'A 헤드라인이 판정 등급(위험)');
  chk(h.includes('결함 패턴 검출'), 'A 배지가 등급을 켠 축을 말한다');
  chk(h.includes('베어링 외륜(BPFO)'), 'A 부위까지 적는다');
  chk(!GAP(h), 'A 일치하면 불일치 문단을 넣지 않는다');
}

// ── B. 패턴 ○ · ISO 양호 — 진폭이 아직 낮은 초기 결함 ──────
{
  const h = build(1, { patOn: true, patNa: false, isoGi: 0, isoOnly: 0, site: '베어링 내륜(BPFI)' }, 0);
  chk(h.includes('>주의<'), 'B 헤드라인이 주의 — 전에는 ISO 존 A라 "양호"였다');
  chk(GAP(h) && h.includes('진폭은 아직 낮습니다'), 'B 진폭이 낮다는 사실을 적는다');
  chk(h.includes('진폭보다 먼저 주파수에'), 'B 왜 등급이 올랐는지 설명한다');
}

// ── C. 패턴 ✕ · ISO 위험 — 진폭만 높음 ─────────────────────
{
  const h = build(0, { patOn: false, patNa: false, isoGi: 2, isoOnly: 2, site: '' }, 2);
  chk(h.includes('>양호<'), 'C 헤드라인이 양호 — 전에는 ISO 존 C라 "위험"이었다');
  chk(h.includes('결함 패턴 없음'), 'C 배지가 근거 없음을 말한다');
  chk(GAP(h) && h.includes('진폭은 ISO 존 C'), 'C 진폭이 높다는 사실을 숨기지 않는다');
  chk(h.includes('불평형') && h.includes('정렬불량') && h.includes('풀림'), 'C 무엇을 확인할지 적는다');
  chk(h.includes('위상') && h.includes('축방향'), 'C 이 도구로 판별 불가라는 한계를 적는다');
}

// ── D. 회전수·기하 없음 — 등급 아닌 측정 상태 ───────────────────────
{
  const h = build(0, { patOn: false, patNa: true, isoGi: 2, isoOnly: 0, site: '' }, 2);
  chk(h.includes('판정 못 함'), 'D 헤드라인이 "판정 못 함" — 양호로 인쇄하지 않는다');
  chk(h.includes('결함 패턴 미측정'), 'D 배지가 미측정을 말한다');
  chk(h.includes('명판 회전수'), 'D 무엇을 채워야 하는지 적는다');
  chk(h.includes('이 값만으로는 베어링 상태를 말할 수 없습니다'), 'D ISO 값의 한계를 못 박는다');
}

// ── 게이지는 등급 아닌 ISO 존 눈금 ──────────────────────────────
{
  const h = build(0, { patOn: false, patNa: false, isoGi: 2, isoOnly: 2, site: '' }, 2);
  chk(h.includes('ISO 10816 존 위치'), '게이지가 무엇의 눈금인지 밝힌다');
  chk(h.includes('위 등급과 다른 축입니다'), '게이지와 등급이 다른 축임을 적는다');
  chk(h.includes('규격 참조값'), 'ISO 행 라벨에서 "판정"을 뗐다');
}

console.log(`\nreport judge: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
