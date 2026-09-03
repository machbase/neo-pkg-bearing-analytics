/* 시간축 지속성 — "N회차 연속 나빠야 확정"이 오탐을 깎는가.
 *
 * 진입 확인 시간(escHold)이 10분 주기 판정에서 뜻을 갖는 유일한 경우가 이것이다.
 * 기존 섀도는 3시간 간격이라 "2회차"가 6시간이 되어 실제 동작과 다르다 — 여기서는 **진짜 10분 주기**로 돈다.
 * 대신 모집단을 Set 2(6.8일 · 4태그)로 좁힌다. 리드타임 숫자는 못 믿지만, 아래 질문은 답이 나온다:
 *
 *   오탐이 회차를 건너 **지속**되는가, 회차마다 **무작위**인가?
 *     지속 → 연속 요구가 소용없다(같은 스펙트럼 성분이 10분 뒤에도 그 자리에 있다)
 *     무작위 → 연속 요구가 유효하다
 *
 * 회차별 발화 여부를 배열로 남겨 K=1·2·3을 **한 번의 조회로** 사후 분석한다.
 */
globalThis.window = globalThis;
const _f = globalThis.fetch;
globalThis.fetch = (u, o) => _f(typeof u === 'string' && u.startsWith('/') ? 'http://127.0.0.1:5654' + u : u, o);
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const q = async (s) => (await (await fetch('/db/query?q=' + encodeURIComponent(s) + '&format=csv&timeformat=ms')).text()).trim().split('\n').slice(1);

const GEO = { n: 16, Bd: 8.4, Pd: 71.5, phi: 15.17 }, FS = 20480, RPM = 2000, ZONES = [0.71, 1.8, 4.5];
/* 인자로 세트를 고른다 — Set 1은 34.5일 8태그라 회차가 8배다(약 100분).
   Set 2는 옆 베어링이 파손 중이라 최악 조건이므로, 건전 138일치인 Set 1로 확인해야 한다. */
const SET = process.argv[2] || 's2';
const ALL = {
  s2: [['s2-c1', '외륜'], ['s2-c2', '정상'], ['s2-c3', '정상'], ['s2-c4', '정상']],
  s1: [['s1-c1', '정상'], ['s1-c2', '정상'], ['s1-c3', '정상'], ['s1-c4', '정상'],
       ['s1-c5', '내륜'], ['s1-c7', '구름체']],
};
const TAGS = ALL[SET] || ALL.s2;
const STEP = 10 * 60000;   // 실제 감시 주기

const bf = VC.bearingFreqs(RPM, GEO), fr = RPM / 60;
const band = VC.demodFixed(FS), eMax = VC.envMaxFor(bf, fr, FS);
const secs = Math.min(22, VC.MON_REV / fr);
const need = Math.max(4096, Math.round(FS * VC.MON_REV / fr));

console.log(`시간축 지속성 — 10분 주기 · 창 ${VC.MON_REV}회전 · 임계 ${VC.MON_ADOPT}\n`);

const series = {};   // tag -> [{at, fired, r}]
for (const [tag, truth] of TAGS) {
  const st = (await q(`select MIN_TIME, MAX_TIME from V$NASA_BEARING_STAT where NAME='${tag}'`))[0].split(',');
  const t0 = +st[0], t1 = +st[1];
  const snapRows = await q(`select ROLLUP('min',1,TIME) rt from NASA_BEARING where NAME='${tag}' group by rt order by rt`);
  const snaps = [];
  let last = -Infinity;
  for (const l of snapRows) {
    const ms = +l.split(',')[0];
    if (ms - last >= STEP) { snaps.push(ms + 60000); last = ms; }
  }
  const out = [];
  for (const at of snaps) {
    let v = [];
    for (const sec of [secs, 60, 180]) {
      const lo = BigInt(Math.round(at - sec * 1000)) * 1000000n, hi = BigInt(at) * 1000000n;
      const rows = await q(`select VALUE from NASA_BEARING where NAME='${tag}' and TIME between ${lo} and ${hi} limit 262144`);
      v = rows.map(Number).filter(isFinite);
      if (v.length >= need) break;
    }
    if (v.length < 4096) continue;
    if (v.length > need) v = v.slice(v.length - need);
    const env = VC.envelopeSpectrum(v, FS, eMax, band);
    const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
    const r = t ? t.r || 0 : 0;
    out.push({ at: at, r: r, fired: r >= VC.MON_ADOPT });
  }
  series[tag] = { truth: truth, t0: t0, t1: t1, ticks: out };
  const nf = out.filter((x) => x.fired).length;
  console.log(`  ${tag} (${truth}) — 회차 ${out.length} · 발화 ${nf} (${(nf / out.length * 100).toFixed(0)}%)`);
}

/* 회차별 발화 계열을 파일로 남긴다 — 조회가 수천 건이라 한 번 도는 데 Set 1이 100분이다.
   정책(K·첫알람 예외 등)을 바꿔 볼 때마다 다시 돌리면 답을 얻기 전에 질문이 식는다. */
{
  const fs = await import('node:fs');
  const dump = {};
  for (const [tag, s] of Object.entries(series)) {
    dump[tag] = { truth: s.truth, t0: s.t0, t1: s.t1, at: s.ticks.map((x) => x.at), r: s.ticks.map((x) => +x.r.toFixed(3)) };
  }
  const out = new URL('./persist-' + SET + '.json', import.meta.url);
  fs.writeFileSync(out, JSON.stringify(dump));
  console.log(`
계열 저장 — ${out.pathname.split('/').pop()}`);
}

// ── 발화가 몰려 있나 흩어져 있나 ────────────────────────────────────────
console.log('\n━━ 발화 연속 길이 분포 ━━');
console.log('  (연속 길이 1이 많으면 무작위 → 연속 요구가 유효 · 길면 지속 → 소용없음)\n');
for (const [tag, s] of Object.entries(series)) {
  const runs = [];
  let cur = 0;
  for (const x of s.ticks) { if (x.fired) cur++; else if (cur) { runs.push(cur); cur = 0; } }
  if (cur) runs.push(cur);
  if (!runs.length) { console.log(`  ${tag} (${s.truth}) — 발화 없음`); continue; }
  const one = runs.filter((n) => n === 1).length;
  const mx = Math.max(...runs);
  const med = runs.slice().sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  console.log(`  ${tag} (${s.truth}) — 구간 ${runs.length}개 · 길이1 ${one}개 · 중앙 ${med} · 최대 ${mx}`);
}

// ── K회차 연속을 요구하면 ────────────────────────────────────────────────
console.log('\n━━ K회차 연속 요구 ━━\n');
console.log('K   건전 경보  결함 검출  결함 첫 경보(잔여%)');
for (const K of [1, 2, 3]) {
  let hAlarm = 0, fHit = 0, fN = 0, remTxt = '없음';
  for (const [, s] of Object.entries(series)) {
    /* 확정 = K회차 연속 발화. 에피소드당 1건으로 센다(연속 발화가 이어지는 동안은 같은 경보다) —
       재알림은 별도 주기가 담당하므로 여기서 세면 이중이 된다. */
    let run = 0, on = false, alarms = 0, firstAt = null;
    for (const x of s.ticks) {
      if (x.fired) { run++; if (!on && run >= K) { on = true; alarms++; if (firstAt == null) firstAt = x.at; } }
      else { run = 0; on = false; }
    }
    if (s.truth === '정상') hAlarm += alarms;
    else { fN++; if (firstAt != null) { fHit++; remTxt = Math.round((s.t1 - firstAt) / (s.t1 - s.t0) * 100) + '%'; } }
  }
  console.log(`${K}   ${String(hAlarm).padStart(8)}  ${String(fHit + '/' + fN).padStart(9)}  ${remTxt.padStart(18)}`);
}
