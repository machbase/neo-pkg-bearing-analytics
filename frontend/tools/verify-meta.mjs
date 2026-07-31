// 메타데이터 A/B — 같은 데이터에 메타(마운팅·구동·날개수)만 바꿔서 판정이 실제로 달라지는지 확인.
// 안 달라지면 폼은 있어도 의미가 없다(입력만 늘고 결과는 그대로) — 그 회귀를 잡는 하네스.
// 라이브 하네스: Neo(127.0.0.1:5654)가 떠 있고 BEARING 테이블에 데이터가 있어야 한다.
// 사용: node tools/verify-meta.mjs   (또는 npm run verify:live)
globalThis.window = globalThis;
const NEO = 'http://127.0.0.1:5654'; const _f = globalThis.fetch;
globalThis.fetch = (u, o) => _f(typeof u === 'string' && u.startsWith('/') ? NEO + u : u, o);

try { await _f(NEO + '/db/query?q=' + encodeURIComponent('SELECT 1 as X'), { signal: AbortSignal.timeout(3000) }); }
catch (e) { console.error('SKIP — Neo(' + NEO + ') 미기동. 서버를 띄운 뒤 다시 실행하세요.'); process.exit(2); }

const E = (await import('../../cgi-bin/chart/chart.js')).default;
const L = await import('../src/data/live.js');
const { App } = await import('../src/app.js');
const { readFileSync } = await import('node:fs');
const BASE = (() => {
  try { return JSON.parse(readFileSync(new URL('../../cgi-bin/config/equipment.json', import.meta.url), 'utf8')); }
  catch (e) { console.warn('[harness] equipment.json 로드 실패 — 폴백으로 진행:', e.message); return {}; }
})();

let fail = 0;
async function run(label, extra) {
  const cfg = Object.assign({}, BASE, extra);
  const data = await L.buildLiveData(Object.assign({}, E), ['BEARING'], cfg);
  const app = new App({}); app.E = Object.assign({}, E); app.live = true; app.data = data;
  const eq = data.equipment[0]; app.state.selTag = eq.id;
  const anchor = app._detailAnchorMs(eq);
  const det = await L.liveDetail(app.E, eq, anchor, null);
  app._detailCache[eq.id] = { state: 'ready', det, anchor, viewUnit: null, eqSnap: Object.assign({}, eq), snapNow: Date.now() };
  const ev = app._evidence(eq, det);
  const kg = det.kurtogram && det.kurtogram.best;
  console.log('\n───── ' + label + ' ─────');
  console.log('  마운팅       :', det.mount || '(미상)', det.mountFmax ? '· 상한 ' + (det.mountFmax / 1000).toFixed(1) + 'kHz' : '· 상한 없음',
    det.kgCapped ? '· 대역 잘림' : '');
  console.log('  커토그램 대역:', kg ? (kg.loHz / 1000).toFixed(2) + '–' + (kg.hiHz / 1000).toFixed(2) + ' kHz (SK ' + kg.sk.toFixed(1) + ')' : '없음');
  console.log('  포락선 지배  :', det.envQ && det.envQ.f0 > 0 ? det.envQ.f0.toFixed(2) + ' Hz · 하모닉 ' + det.envQ.harm : '없음');
  console.log('  베어링 대조  :', det.bearMatch && det.bearMatch.hit ? det.bearMatch.hit.key + ' 일치' : '미매칭');
  const scored = ev.conf.filter(c => !c.na);
  console.log('  후보 상위3   :', scored.slice(0, 3).map(c => c.f.replace(/\(.*/, '') + ' ' + c.score).join(' | ') || '없음');
  const na = ev.conf.filter(c => c.na);
  console.log('  측정 불가    :', na.length + '종 — ' + na.map(c => c.f.replace(/\(.*/, '')).join(', '));
  const mline = ev.block.split('\n').filter(l => /미입력 메타데이터|메타데이터:|마운팅 상한/.test(l));
  mline.forEach(l => console.log('  ' + l.replace(/^■ /, '· ').slice(0, 150)));
  return { det, ev };
}

// A는 진짜 "메타 없음"이어야 한다 — 사용자가 UI에서 저장한 equipMeta가 BASE에 실려 오므로 명시적으로 비운다
const A = await run('A. 메타 없음 (equipMeta 강제 제거)', { equipMeta: {} });
const A0 = await run('A0. 현재 저장된 설정 그대로', {});
const B = await run('B. 자석 마운트', { equipMeta: { 'BEARING:C1': { mount: 'magnet' } } });
const C = await run('C. 스터드 + 벨트(풀리 120/300) + 날개 7', {
  equipMeta: { 'BEARING:C1': { mount: 'stud', drive: 'belt', belt: { d1: 120, d2: 300 }, vanes: 7 } },
});
const D = await run('D. 자석 + 직결 (해당없음 처리 확인)', {
  equipMeta: { 'BEARING:C1': { mount: 'magnet', drive: 'direct' } },
});

// ── 회귀 어서션: 메타가 판정 경로를 실제로 바꿨는가 ─────────────────────────
console.log('\n=== 어서션 ===');
const chk = (ok, msg) => { if (ok) console.log('  PASS', msg); else { fail++; console.log('  FAIL', msg); } };
chk(B.det.mountFmax === 2000 && B.det.kgCapped, '자석 마운트 → 커토그램 상한 2 kHz 적용·대역 잘림');
chk(!B.det.kurtogram || !B.det.kurtogram.best || B.det.kurtogram.best.hiHz <= 2000 + 1,
  '자석 마운트 → 선택 대역이 상한 아래');
chk(A.det.mountFmax === 0 || A.det.mountFmax === undefined || !A.det.mount, '메타 없음 → 상한 미적용(미상)');
const naNames = (r) => r.ev.conf.filter(c => c.na).map(c => c.f).join(',');
chk(!/벨트·풀리/.test(naNames(D)), '직결 지정 → 벨트 후보가 목록에서 제외(측정 불가 아님)');
chk(/벨트·풀리/.test(naNames(C)), '벨트+풀리경만 → 벨트 결함은 여전히 볼 수 없음(벨트길이 필요)');
console.log('\n=== 결과: ' + (fail ? 'FAIL ' + fail + '건' : '전부 통과') + ' ===');
if (fail) process.exitCode = 1;
