/* 대역 백필 앵커의 되짚기 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   백필 앵커는 벽시계 격자(정각·10분·20분…)에 맞춰 만들어지는데, 간헐 수집(예: 10분마다 1초)의
   기록 시각은 그 격자와 무관하다. 그대로 두면 앵커가 거의 전부 수집 공백에 떨어져 백필이
   한 건도 못 쌓고, 대역 베이스라인이 학습되지 않아 세 판정 중 대역만 조용히 죽는다. */
const Band = (await import('../../cgi-bin/monitor/band.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};
const TAGS = [{ tbl: 'T', tag: 'A', fr: 30, fs: 25600, demod: [5000, 10000], bf: null }];
const body = (tql) => (/SCRIPT\(\{([\s\S]*)\}\)/.exec(tql) || [])[1] || '';

// ── 백필: 격자를 받아 되짚기·구간 중복검사를 켠다 ─────────────────────────
{
  const tql = Band.buildBandTql({ tags: TAGS, anchors: [1e12, 1e12 + 600000], nowMs: 1e12, grid: 600000 });
  chk(/var GRID=600000;/.test(tql), '격자 간격이 값으로 구워진다');
  chk(/if\(vals\.length < 1024 && GRID > 0\)\{/.test(tql), '표본이 모자랄 때만 되짚는다 — 멀쩡한 앵커에는 조회가 안 붙는다');
  chk(/ROLLUP\('sec',1,TIME\)[\s\S]*order by RT desc limit 1/.test(tql),
    '표본이 있는 마지막 초를 초 롤업에서 찾는다 — 원본 역주행은 스캔 폭에 비례해 느리다');
  chk(/to_date\('"\+dt\(maxMs-GRID\)/.test(tql), '되짚는 범위는 격자 한 칸 — 더 가면 여러 앵커가 같은 구간을 겹쳐 잰다');
  chk(/dLo = GRID>0 \? \(maxMs-GRID\) : maxMs/.test(tql),
    '중복 검사도 칸 단위 — 되짚으면 저장 시각이 앵커와 달라져 점 검사로는 매번 못 찾는다');
  let err = null;
  try { new Function(body(tql)); } catch (e) { err = e; }
  chk(!err, '생성된 스크립트가 구문상 유효하다 — 임베드 코드라 오류는 실행 때만 드러난다', err ? err.message : '');
}
// ── 타이머: 앵커가 MAX_TIME 하나뿐이라 되짚을 필요가 없다 ─────────────────
{
  const tql = Band.buildBandTql({ tags: TAGS, nowMs: 1e12 });
  chk(/var GRID=0;/.test(tql), '타이머 경로는 격자가 0 — 되짚기와 구간 중복검사가 꺼진다');
  chk(/MAX_TIME/.test(tql), '앵커는 그 태그의 마지막 데이터 시각');
  let err = null;
  try { new Function(body(tql)); } catch (e) { err = e; }
  chk(!err, '타이머 스크립트도 구문상 유효하다', err ? err.message : '');
}
// ── 앱이 격자를 실제로 넘긴다 ─────────────────────────────────────────────
{
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  chk(/buildBandTql\(\{ tags: \[job\.t\], anchors: chunk, nowMs: now, grid: plan\.iv \}\)/.test(app),
    '백필이 추출 주기를 격자로 넘긴다 — 안 넘기면 되짚기가 꺼진 채 예전 동작이 된다');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
