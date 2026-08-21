// 앵커 스윕 실측 — "창의 끝 한 점" 대비 "기간을 훑어 최악을 고름"이 실제로 무엇을 바꾸는지.
// NASA IMS는 끝이 정지 구간이라 옛 동작이 무엇을 놓치는지 그대로 드러난다.
globalThis.window = globalThis;
// api.js는 브라우저 same-origin 상대경로(/db/...)를 쓰므로 node에서는 호스트를 프리픽스
const _fetch = globalThis.fetch;
globalThis.fetch = (url, opts) => _fetch(typeof url === 'string' && url.startsWith('/') ? 'http://127.0.0.1:5654' + url : url, opts);
const { sweepAnchors } = await import('../src/data/live.js');
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

const NEO = 'http://127.0.0.1:5654/db/query';
const q = async (s) => {
  const r = await fetch(NEO + '?q=' + encodeURIComponent(s) + '&format=csv&timeformat=ms');
  return (await r.text()).trim().split('\n').slice(1);
};
const ZONES = [0.71, 1.8, 4.5];   // Class I 존 (mm/s)
const G = ['양호', '주의', '위험', '심각'];

const CASES = [
  { tag: 's2-c1', ko: 'IMS Set2 B1 · 외륜 파손(시험 종료)', geo: { n: 16, Bd: 8.4, Pd: 71.5, phi: 15.17 }, days: 6 },
  { tag: 's1-c1', ko: 'IMS Set1 B1-X · 끝까지 건전', geo: { n: 16, Bd: 8.4, Pd: 71.5, phi: 15.17 }, days: 6 },
];

for (const c of CASES) {
  const t1 = +(await q(`select MAX_TIME from V$NASA_BEARING_STAT where NAME='${c.tag}'`))[0];
  const t0 = t1 - c.days * 864e5;
  const eq = { table: 'NASA_BEARING', name: c.tag, fs: 20480, rpm: 2000, unit: 'g',
    bearing: c.geo, lastSeen: t1, stat: { minMs: t0 } };
  const t = Date.now();
  const sw = await sweepAnchors(null, eq, t0, t1, 8);
  const el = Date.now() - t;

  console.log('\n### ' + c.ko + ' — 최근 ' + c.days + '일');
  console.log('시각(UTC)         ISO(mm/s)  등급   결함점수  부위    비고');
  let worst = null;
  for (const a of sw.anchors) {
    if (a.empty) { console.log(new Date(a.at).toISOString().slice(5, 16).padEnd(18) + '(데이터 없음)'); continue; }
    const gi = VC.gradeFor(a.isoRms, ZONES);
    const adopt = a.patScore >= VC.TGT_ADOPT;
    if (!worst || gi > worst.gi || (gi === worst.gi && a.patScore > worst.a.patScore)) worst = { gi, a };
    console.log(new Date(a.at).toISOString().slice(5, 16).padEnd(18)
      + a.isoRms.toFixed(2).padStart(8) + '   ' + G[gi].padEnd(6)
      + a.patScore.toFixed(1).padStart(7) + '   ' + (adopt ? a.patKey : '—').padEnd(7)
      + (a.acRms < 0.01 ? '정지 의심(AC ' + a.acRms.toFixed(4) + ' g)' : ''));
  }
  const last = sw.anchors[sw.anchors.length - 1];
  console.log('');
  console.log('  옛 동작(창의 끝만)  → ISO ' + (last.empty ? '없음' : last.isoRms.toFixed(2) + ' mm/s · ' + G[VC.gradeFor(last.isoRms, ZONES)]
    + ' · 결함점수 ' + last.patScore.toFixed(1)));
  console.log('  새 동작(기간 최악)  → ISO ' + worst.a.isoRms.toFixed(2) + ' mm/s · ' + G[worst.gi]
    + ' · 결함점수 ' + worst.a.patScore.toFixed(1) + ' · ' + new Date(worst.a.at).toISOString().slice(5, 16));
  console.log('  앵커 ' + sw.scanned + '개 · ' + el + ' ms (개당 ' + Math.round(el / sw.scanned) + ' ms) · 창 ' + sw.winSec.toFixed(1) + '초');
}
