// 서버 판정 TQL 생성기 라이브 테스트 — dryRun으로 실테이블 무변경, 생성 스크립트가
// SCRIPT 컨텍스트에서 judgeTick 임베드+DB조회+판정을 제대로 도는지 확인.
globalThis.window = globalThis;
const NEO = 'http://127.0.0.1:5654';
const { judgeTick } = await import('../src/app.js');
const { buildMonitorTql } = (await import('../../cgi-bin/monitor/monitor.js')).default;

const Z = [1.12, 2.8, 7.1]; // Class II 기본 존
const spec = {
  judgeSrc: judgeTick.toString(),
  cfg: { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 3600000, 3: 1800000 } },
  tags: [
    { tbl: 'VIBE_TEST', tag: 'SENSOR_NORMAL', zones: Z, bl: null },
    { tbl: 'VIBE_TEST', tag: 'SENSOR_SPIKE', zones: Z, bl: null },
    { tbl: 'VIBE_TEST', tag: 'SENSOR_TREND', zones: Z, bl: { mu: 0.5, sigma: 0.1, k: 3 } },
  ],
  dryRun: true,
};
const tql = buildMonitorTql(spec);
console.log('--- 생성 TQL 길이:', tql.length, '자 · judgeTick 임베드:', tql.includes('function judgeTick'));

const res = await fetch(NEO + '/db/tql', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: tql });
const text = await res.text();
console.log('--- HTTP', res.status);
console.log(text.trim());

let pass = 0, fail = 0;
const check = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n); } };
check('HTTP 200', res.status === 200);
check('goja/SQL 오류 없음', !/error|ERR-|panic|undefined is not/i.test(text));
check('done 행 방출(태그 순회 완료)', /(^|\n)done,/.test(text));
const doneRow = (text.match(/(?:^|\n)done,(\d+),(\d+)/) || []);
check('순회 태그 수 = 3', doneRow[2] === '3');
check('state 행 방출(판정 상태)', /(^|\n)state,/.test(text));
// SENSOR_NORMAL RMS(~1.58)면 grade 1(주의) → evt 방출 기대(직전상태 없을 때). prev 있으면 무이벤트 정상.
console.log('\n(참고) evt 행:', (text.match(/(?:^|\n)evt,[^\n]*/g) || []).join(' | ') || '없음(직전상태와 동일이면 정상)');

console.log(`\nmonitor-tql live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
