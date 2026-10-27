/* 판정 입력의 화면 설정 독립성 — 라이브(Neo 필요) · npm run smoke:live 포함
   ① 표시 물리량(g/mm·s⁻¹/μm) 토글에 결함 판정 불변(포락선·커토그램은 표시용 변환값 anaVals 미사용)
   ② 앵커 선택 점수와 그 앵커의 판정 점수가 같은 회전수 기준
   신원: NEO_TOKEN 환경변수(_liveauth.mjs), 없으면 건너뜀 */
const { DB } = await import('./_liveauth.mjs');
const { liveDetail, sweepAnchors } = await import('../src/data/live.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;

let st = null;
try { st = (await DB.tagStats('NASA_BEARING'))['s2-c1'] || null; } catch (e) { st = null; }
if (!st || !st.maxMs) { console.log('건너뜀 — NASA_BEARING:s2-c1 없음(또는 조회 권한 없음)'); console.log('judge-inputs: 건너뜀'); process.exit(0); }

const t1 = st.maxMs, mn = st.minMs;
const eq = { id: 'NASA_BEARING:s2-c1', table: 'NASA_BEARING', name: 's2-c1', fs: 20480, rpm: 2000,
  unit: 'g', cls: 'I', bearing: { model: '직접입력', n: 16, Bd: 8.4, Pd: 71.5, phi: 15.17 },
  lastSeen: t1, stat: { minMs: mn } };

let fail = 0;
const chk = (c, label, extra) => {
  if (c) console.log('PASS', label, extra === undefined ? '' : extra);
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); }
};

const from = t1 - 864e5;
const g = await liveDetail(CH, eq, t1, 'g', from);
const v = await liveDetail(CH, eq, t1, 'mm/s', from);

/* 실데이터로 계산됐는지 먼저 — 조회가 막히면 양쪽 다 빈 값이라 아래 비교가 공허하게 통과 */
const real = g.raw.values.length > 0 && v.raw.values.length > 0 && !!g.sideband && !!v.sideband && g.levels != null;
chk(real, '실데이터로 계산됨(파형·결함 격자·3도메인 레벨)', 'raw ' + g.raw.values.length + '/' + v.raw.values.length);
if (!real) { console.log('\njudge-inputs: 데이터 없이 비교 불가'); process.exit(1); }

const sg = g.sideband.r, sv = v.sideband.r;
chk(Math.abs(sg - sv) < 1e-9, '표시 물리량이 결함 격자 점수를 바꾸지 않는다',
  'g=' + sg.toFixed(4) + ' · mm/s=' + sv.toFixed(4));
chk(g.sideband.key === v.sideband.key, '부위 귀속도 같다', g.sideband.key + ' / ' + v.sideband.key);
chk(g.bandKurt != null && Math.abs(g.bandKurt - v.bandKurt) < 1e-9,
  '밴드 커토시스도 같다 — 첨도는 배율엔 불변이지만 적분·미분엔 안 그렇다',
  g.bandKurt + ' / ' + v.bandKurt);

/* 파형·스펙트로그램은 표시 단위를 따르는 게 정상 — 여기선 원단위 기준 레벨만 대조 */
chk(JSON.stringify(g.levels) === JSON.stringify(v.levels),
  '3도메인 레벨은 원단위 기준이라 표시와 무관하게 같다');

// ② 스윕 점수와 판정 점수 기준 일치 — 같은 시점을 두 경로로 재서 대조
const sw = await sweepAnchors(CH, eq, t1 - 1, t1, 2);
const last = (sw.anchors || []).filter((a) => !a.empty).pop();
if (!last) { console.log('건너뜀(스윕 후보 없음)'); }
else {
  const d = await liveDetail(CH, eq, last.at, 'g', from);
  const dr = d.sideband ? d.sideband.r : 0;
  chk(dr > 0 && Math.abs(last.patScore - dr) / dr < 0.02,
    '앵커를 고른 점수와 그 앵커의 판정 점수가 같은 기준이다(2% 이내)',
    '스윕=' + last.patScore.toFixed(3) + ' · 판정=' + dr.toFixed(3));
}

console.log(fail ? `\njudge-inputs: ${fail} failed` : '\njudge-inputs: 전부 통과');
process.exit(fail ? 1 : 0);
