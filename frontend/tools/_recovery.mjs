/* 복귀 알림 설계안별 이벤트 수 비교 — "알람이 너무 많아지지 않나"를 숫자로 본다.
   판정은 실제 judgeTick을 쓰되, 복귀 규칙만 바깥에서 흉내내 비교한다. */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const { judgeTick } = await import('../src/app.js');

const Z = [1.12, 2.80, 7.10];
const BL = { mu: 1.5826, sigma: 0.0022, k: 3 };
const LIM = VC.baselineLimit(BL);
const CFG = { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 3600000, 3: 1800000 } };
const V = { 양호: 0.8, 주의: 2.0, 위험: 4.0, 심각: 8.0 };
const IV = 10;                       // 판정 10초 간격(초 단위 계열)

function build(segs) { const v = []; segs.forEach(([n, d]) => { for (let i = 0; i < d; i++) v.push(V[n]); }); return v; }

/* 안별 복귀 규칙
   A0 현재      : 양호(등급 0) 도달 + recHold → recovery. baseline 해제는 무음.
   A1 개선복귀   : 직전 알람 등급보다 낮아지고 recHold 유지 → recovery 1건(단계마다가 아님).
                  baseline 해제도 1건.
   A2 단계마다   : 완화 한 단계마다 이벤트. baseline 해제도 1건. */
function run(vals, mode) {
  let prev = null;
  const out = {};
  let lastAlarm = 0;        // 마지막 알람을 낸 등급
  let candG = null, candT = 0;   // 개선 후보(등급, 시작시각)
  let wasB = false, bcs = null;
  const add = (k) => { out[k] = (out[k] || 0) + 1; };
  for (let i = 0; i < vals.length; i += IV) {
    const t = i * 1000, v = vals[i];
    const rg = VC.gradeFor(v, Z), breach = v > LIM;
    const r = judgeTick(prev, rg, breach, t, CFG, null);
    r.events.forEach((e) => {
      add(e.etype);
      if (e.etype === 'threshold') lastAlarm = Math.max(lastAlarm, e.gi);
    });
    if (mode !== 'A0') {
      // 개선 감지 — 확정 등급이 마지막 알람 등급보다 낮아졌고 recHold 유지되면 1건
      const g = r.next.g;
      if (lastAlarm > 0 && g < lastAlarm) {
        if (candG !== g) { candG = g; candT = t; }
        if (t - candT >= CFG.recHold) {
          if (mode === 'A2') { add('improve'); lastAlarm = g; }        // 단계마다
          else { add('improve'); lastAlarm = 0; }                       // 알람당 1건
          candG = null;
        }
      } else if (g >= lastAlarm) { candG = null; }
      // baseline 해제 — 이탈이 recHold 넘게 걷히면 1건
      const nb = !!r.next.b;
      if (wasB && !nb) add('baselinerec');
      wasB = nb;
    }
    prev = r.next;
  }
  return out;
}

const H = 3600;
const CASES = {
  '① 위험 30분 → 정상 30분': build([['위험', 1800], ['양호', 1800]]),
  '② 위험 30분 → 주의 30분(완화)': build([['위험', 1800], ['주의', 1800]]),
  '③ 심각→위험→주의→양호 (단계 하강)': build([['심각', 900], ['위험', 900], ['주의', 900], ['양호', 900]]),
  '④ 진동 (위험 7분 ↔ 정상 7분 ×3)': build(Array.from({ length: 3 }, () => [['위험', 420], ['양호', 420]]).flat()),
  '⑤ 위험 2시간 지속': build([['위험', 7200]]),
  '⑥ 안정 (주의 유지)': build([['주의', H]]),
};
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log('%s %10s %10s %10s', '패턴'.padEnd(36), 'A0(현재)', 'A1(알람당)', 'A2(단계마다)');
const tot = { A0: 0, A1: 0, A2: 0 };
for (const [name, v] of Object.entries(CASES)) {
  const r = { A0: run(v, 'A0'), A1: run(v, 'A1'), A2: run(v, 'A2') };
  ['A0', 'A1', 'A2'].forEach((k) => { tot[k] += sum(r[k]); });
  console.log('%s %10d %10d %10d', name.padEnd(36), sum(r.A0), sum(r.A1), sum(r.A2));
}
console.log('%s %10d %10d %10d', '합계'.padEnd(36), tot.A0, tot.A1, tot.A2);
console.log('%s %10s %10s %10s', '증가율'.padEnd(36), '—',
  '+' + Math.round((tot.A1 / tot.A0 - 1) * 100) + '%', '+' + Math.round((tot.A2 / tot.A0 - 1) * 100) + '%');
console.log('\n[상세] ① 위험→정상');
['A0', 'A1', 'A2'].forEach((k) => console.log('  ' + k + ': ' + JSON.stringify(run(CASES['① 위험 30분 → 정상 30분'], k))));
console.log('[상세] ③ 단계 하강');
['A0', 'A1', 'A2'].forEach((k) => console.log('  ' + k + ': ' + JSON.stringify(run(CASES['③ 심각→위험→주의→양호 (단계 하강)'], k))));
