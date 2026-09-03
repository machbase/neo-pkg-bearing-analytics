/* 알람 확정 규칙 비교 — verify-persist가 남긴 회차별 격자 점수로 정책만 갈아 끼운다.
 *
 * 조회가 수천 건이라 한 번 도는 데 Set 1이 100분이다. 계열을 파일로 떠 두면 정책 비교는 즉시 끝난다.
 *
 * 왜 "첫 신호 예외"가 필요한가 — 실측된 성질이 앞뒤로 다르기 때문이다:
 *   · 초기 결함은 **단발**이다 (내륜은 34.5일에 단발 2번이 전부, 구름체는 단발 128번)
 *   · 자란 결함은 **붙는다** (외륜은 452회차 연속)
 *   · 정상의 오탐도 **단발**이다 — 그래서 단발을 다 받으면 오탐이, 다 버리면 초기 결함이 죽는다
 */
import fs from 'node:fs';

const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const SETS = ['s1', 's2'].filter((s) => fs.existsSync(new URL(`./persist-${s}.json`, import.meta.url)));
if (!SETS.length) { console.log('덤프 없음 — verify-persist.mjs를 먼저 돌리십시오.'); process.exit(0); }

const DAY = 864e5;
const data = {};
for (const s of SETS) data[s] = JSON.parse(fs.readFileSync(new URL(`./persist-${s}.json`, import.meta.url), 'utf8'));

/* 정책은 회차 시퀀스를 받아 "알람이 확정된 회차 인덱스" 목록을 돌려준다.
   에피소드당 1건으로 센다 — 연속 발화가 이어지는 동안은 같은 경보이고, 반복은 재알림 주기가 맡는다. */
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
/* 조용 예외 — 직전 **발화**로부터 gap 이상 지났으면 단발도 받는다.
   직전 알람이 아니라 직전 발화를 기준으로 삼는다: 걸러진 단발이 이어지는 동안은 조용한 게 아니다. */
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
