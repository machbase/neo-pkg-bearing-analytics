// 판정 입력이 화면 설정에 흔들리지 않는가 (라이브 — Neo 필요, 없으면 건너뜀)
//
// 두 가지를 잠근다:
//  ① 표시 물리량(g/mm·s⁻¹/μm) 토글이 결함 판정을 바꾸면 안 된다. anaVals는 표시용으로 변환되는데
//     포락선·커토그램이 그걸 쓰면 적분(1/ω)이 걸린 신호를 복조하게 되어 1~5 kHz에 기울기가 얹힌다.
//  ② 앵커를 고르는 점수와 그 앵커에서 다시 내는 점수가 같은 회전수 기준을 써야 한다.
//     중심 주파수는 명판인데 측대역 간격만 실측이면 검증 하네스와 다른 것을 돌게 된다.
globalThis.window = globalThis;
const _f = globalThis.fetch;
globalThis.fetch = (u, o) => _f(typeof u === 'string' && u.startsWith('/') ? 'http://127.0.0.1:5654' + u : u, o);
const { liveDetail, sweepAnchors } = await import('../src/data/live.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;

const q = async (s) => {
  const r = await fetch('/db/query?q=' + encodeURIComponent(s) + '&format=csv&timeformat=ms');
  return (await r.text()).trim().split('\n').slice(1);
};
let rows;
try { rows = await q("select MAX_TIME, MIN_TIME from V$NASA_BEARING_STAT where NAME='s2-c1'"); }
catch (e) { console.log('건너뜀 — Neo 미기동'); console.log('judge-inputs: 건너뜀'); process.exit(0); }
if (!rows || !rows.length) { console.log('건너뜀 — NASA_BEARING:s2-c1 없음'); console.log('judge-inputs: 건너뜀'); process.exit(0); }

const [t1, mn] = rows[0].split(',').map(Number);
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

const sg = g.sideband ? g.sideband.r : 0, sv = v.sideband ? v.sideband.r : 0;
chk(Math.abs(sg - sv) < 1e-9, '표시 물리량이 결함 격자 점수를 바꾸지 않는다',
  'g=' + sg.toFixed(4) + ' · mm/s=' + sv.toFixed(4));
chk((g.sideband && g.sideband.key) === (v.sideband && v.sideband.key),
  '부위 귀속도 같다', (g.sideband && g.sideband.key) + ' / ' + (v.sideband && v.sideband.key));
chk(g.bandKurt != null && Math.abs(g.bandKurt - v.bandKurt) < 1e-9,
  '밴드 커토시스도 같다 — 첨도는 배율엔 불변이지만 적분·미분엔 안 그렇다',
  g.bandKurt + ' / ' + v.bandKurt);

/* 파형·스펙트로그램은 보는 것이라 단위를 따라가야 정상이다 — 안 바뀌면 오히려 버그다. */
chk(g.levels && v.levels && JSON.stringify(g.levels) === JSON.stringify(v.levels),
  '3도메인 레벨은 원단위 기준이라 표시와 무관하게 같다');

// ② 스윕 점수와 판정 점수가 같은 기준인가 — 같은 시점을 두 경로로 재서 대조
const sw = await sweepAnchors(CH, eq, t1 - 1, t1, 2);
const last = (sw.anchors || []).filter((a) => !a.empty).pop();
if (!last) { console.log('건너뜀(스윕 후보 없음)'); }
else {
  const d = await liveDetail(CH, eq, last.at, 'g', from);
  const dr = d.sideband ? d.sideband.r : 0;
  chk(Math.abs(last.patScore - dr) / Math.max(1e-9, dr) < 0.02,
    '앵커를 고른 점수와 그 앵커의 판정 점수가 같은 기준이다(2% 이내)',
    '스윕=' + last.patScore.toFixed(3) + ' · 판정=' + dr.toFixed(3));
}

console.log(fail ? `\njudge-inputs: ${fail} failed` : '\njudge-inputs: 전부 통과');
process.exit(fail ? 1 : 0);
