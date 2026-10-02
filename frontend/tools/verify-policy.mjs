/* 알람 확정 규칙 비교 — verify-persist가 저장한 회차별 격자 점수(persist-<set>.json)에 정책만 교체 적용
 * · 정책: K=1·K=2·첫 신호 예외(태그당 1회·조용 3/7일) — 건전 오탐(측정점·월당)·결함 검출·첫 경보 잔여% 측정
 * · 첫 신호 예외 후보 근거: 초기 결함·정상 오탐 모두 단발, 자란 결함은 연속
 * · 덤프 필요(verify-persist 선행, 없으면 건너뜀)
 */
import fs from 'node:fs';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const SETS = ['s1', 's2'].filter((s) => fs.existsSync(new URL(`./persist-${s}.json`, import.meta.url)));
if (!SETS.length) { console.log('덤프 없음 — verify-persist.mjs를 먼저 돌리십시오.'); process.exit(0); }

const DAY = 864e5;
const data = {};
for (const s of SETS) data[s] = JSON.parse(fs.readFileSync(new URL(`./persist-${s}.json`, import.meta.url), 'utf8'));

/* 정책: 회차 발화 시퀀스 → 알람 확정 회차 인덱스 목록, 에피소드당 1건(반복은 재알림 주기 담당) */
const POLICIES = {
  'K=1 (단발도 알람)': (fired) => {
    const out = []; let on = false;
    fired.forEach((f, i) => { if (f) { if (!on) { out.push(i); on = true; } } else on = false; });
    return out;
  },
  'K=2 (2회차 연속만)': (fired) => {
    const out = []; let run = 0, on = false;
    fired.forEach((f, i) => { if (f) { run++; if (!on && run >= 2) { out.push(i); on = true; } } else { run = 0; on = false; } });
    return out;
  },
  '첫 신호 예외 · 태그당 1회': (fired) => {
    const out = []; let run = 0, on = false, used = false;
    fired.forEach((f, i) => {
      if (f) {
        run++;
        if (!on && (run >= 2 || !used)) { out.push(i); on = true; if (run < 2) used = true; }
      } else { run = 0; on = false; }
    });
    return out;
  },
  '첫 신호 예외 · 조용 3일': (fired, at) => quiet(fired, at, 3 * DAY),
  '첫 신호 예외 · 조용 7일': (fired, at) => quiet(fired, at, 7 * DAY),
};
/* 조용 예외 — 직전 발화(알람 아님)로부터 gap 이상 지났으면 단발도 채택(걸러진 단발이 이어지면 조용하지 않음) */
function quiet(fired, at, gap) {
  const out = []; let run = 0, on = false, lastFire = -Infinity;
  fired.forEach((f, i) => {
    if (f) {
      const wasQuiet = at[i] - lastFire >= gap;
      run++;
      if (!on && (run >= 2 || wasQuiet)) { out.push(i); on = true; }
      lastFire = at[i];
    } else { run = 0; on = false; }
  });
  return out;
}

const rows = [];
for (const [name, fn] of Object.entries(POLICIES)) {
  let hAlarm = 0, hDays = 0, fHit = 0, fN = 0;
  const leads = [];
  for (const s of SETS) {
    for (const [tag, d] of Object.entries(data[s])) {
      const fired = d.r.map((r) => r >= VC.MON_ADOPT);
      const hits = fn(fired, d.at);
      const days = (d.t1 - d.t0) / DAY;
      if (d.truth === '정상') { hAlarm += hits.length; hDays += days; }
      else {
        fN++;
        if (hits.length) {
          fHit++;
          leads.push([tag, Math.round((d.t1 - d.at[hits[0]]) / (d.t1 - d.t0) * 100)]);
        } else leads.push([tag, null]);
      }
    }
  }
  rows.push({ name, hAlarm, perMon: hAlarm / (hDays / 30), fHit, fN, leads });
}

console.log(`알람 확정 규칙 비교 — ${SETS.join('+')} · 10분 주기 · 임계 ${VC.MON_ADOPT}\n`);
const W = 26;
console.log('규칙'.padEnd(W) + '오탐  측정점·월당  검출   결함별 첫 경보(잔여%)');
console.log('─'.repeat(W + 48));
for (const r of rows) {
  const lead = r.leads.map(([t, v]) => t + ' ' + (v == null ? '미검출' : v + '%')).join(' · ');
  console.log(r.name.padEnd(W) + String(r.hAlarm).padStart(4)
    + r.perMon.toFixed(1).padStart(12) + `   ${r.fHit}/${r.fN}`.padStart(7) + '   ' + lead);
}
