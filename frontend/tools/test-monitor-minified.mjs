// 미니파이 회귀 — 라이브(Neo 필요, NEO_TOKEN 없으면 건너뜀) · npm 스크립트 미포함
// · 빌드 시 함수명이 축약돼도(judgeTick→ie, shouldNotify→n …) 생성된 타이머 TQL 동작(ReferenceError 없음)
globalThis.window = globalThis;
const NEO = process.env.NEO_URL || 'http://127.0.0.1:5654';
// 앱과 같은 신원 — 토큰 계정으로 실행(헤더 없는 요청은 서버 설정에 따라 401 또는 기본 신원)
const TOKEN = (process.env.NEO_TOKEN || '').trim();
if (!TOKEN) { console.log('건너뜀 — 라이브 Neo API 토큰 필요: NEO_TOKEN 환경변수'); process.exit(0); }
const AUTH = { Authorization: 'Bearer ' + TOKEN };
const who = await fetch(NEO + '/db/token/validate', { method: 'POST', headers: AUTH })
  .then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.valid ? String(j.user).toUpperCase() : '')).catch(() => '');
if (!who) { console.log('건너뜀 — 토큰 무효이거나 Neo 미기동(' + NEO + ')'); process.exit(0); }
const M = (await import('../../cgi-bin/monitor/monitor.js')).default;
const N = (await import('../../cgi-bin/notify/notify.js')).default;

// 빌드처럼 이름이 축약된 judgeTick 소스(호출측은 'judgeTick' 사용)
const minifiedJudgeSrc = 'function ie(p,rg,b,now,cfg){var e=[],n;'
  + 'if(!p){n={g:rg,since:now,cand:rg,candSince:now,lastRe:now,b:b};if(rg>0)e.push({etype:"threshold",gi:rg});}'
  + 'else if(rg===p.g){n={g:p.g,since:p.since,cand:p.g,candSince:p.since,lastRe:p.lastRe,b:b};}'
  + 'else{n={g:rg,since:now,cand:rg,candSince:now,lastRe:now,b:b};if(rg>p.g)e.push({etype:"threshold",gi:rg});else if(rg===0)e.push({etype:"recovery",gi:0});}'
  + 'if(b&&!(p&&p.b))e.push({etype:"baseline",gi:Math.max(1,rg)});return{next:n,events:e};}';

const spec = {
  judgeSrc: minifiedJudgeSrc,
  cfg: { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 3600000, 3: 1800000 } },
  tags: [{ tbl: 'VIBE_TEST', tag: 'SENSOR_FREQ', alias: '1', unit: 'mm/s', zones: [1.12, 2.8, 7.1], bl: { mu: 0.5, sigma: 0.1, k: 3 } }],
  notify: {
    src: N.serverSrc(),
    cfg: { channels: { webhook: { on: true, to: 'https://webhook.site/TEST' } }, routes: { '주의': { webhook: false, timing: '즉시' }, '위험': { webhook: true, timing: '즉시' }, '심각': { webhook: true, timing: '즉시' } } },
  },
  // 저장소 위치·행 키 계정 접두·데이터 표 수식 이름 — 없으면 판정 상태 조회 실패로 회차를 건너뜀(state_read)
  tblPrefix: 'NEO_BEARING_STORE.SYS.', keyPrefix: who + ':', srcMap: { VIBE_TEST: 'SYS.VIBE_TEST' },
  dryRun: true, // 실제 발송·기록 없음
};
const tql = M.buildMonitorTql(spec);
let pass = 0, fail = 0;
const check = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n); } };

check('judgeTick을 var로 바인딩(축약명 무관)', /var judgeTick = function ie\(/.test(tql));
check('notify는 IIFE로 스코프 격리(esc 충돌 방지)', tql.includes('var __NF=(function(){'));
/* 압축으로 함수 이름이 바뀌어도 서버 호출 이름은 고정 — 묶음 두 함수(planNotifications·bundleMessage)도 재노출 필요 */
check('notify 함수 고정 이름 재노출',
  /var eventMessage=__NF\.em, payloadFor=__NF\.pf, shouldNotify=__NF\.sn,/.test(tql)
  && /planNotifications=__NF\.pn, bundleMessage=__NF\.bm,/.test(tql)
  && /notifyCfgFrom=__NF\.nc, configFromRows=__NF\.cr;/.test(tql));

const res = await fetch(NEO + '/db/tql', { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain' }, AUTH), body: tql });
const text = (await res.text()).trim();
console.log('HTTP', res.status, '\n' + text);
check('HTTP 200', res.status === 200);
check('ReferenceError 없음', !/ReferenceError|is not defined/.test(text));
check('오류 없이 순회 완료', /(^|\n)done,/.test(text));

console.log(`\nminified-safe: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
