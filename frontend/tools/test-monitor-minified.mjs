// 미니파이 회귀 테스트 — 빌드 시 함수명이 축약돼도(judgeTick→ie, shouldNotify→n …)
// 생성된 타이머 TQL이 동작해야 한다. 이걸 안 지켜서 서버 모드가 ReferenceError로 죽었었다.
globalThis.window = globalThis;
const NEO = 'http://127.0.0.1:5654';
const M = (await import('../../cgi-bin/monitor/monitor.js')).default;
const N = (await import('../../cgi-bin/notify/notify.js')).default;

// 실제 빌드처럼 이름이 축약된 judgeTick 소스(호출측은 여전히 'judgeTick'을 쓴다)
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
  dryRun: true, // 실제 발송·기록 없음
};
const tql = M.buildMonitorTql(spec);
let pass = 0, fail = 0;
const check = (n, c) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n); } };

check('judgeTick을 var로 바인딩(축약명 무관)', /var judgeTick = function ie\(/.test(tql));
check('notify는 IIFE로 스코프 격리(esc 충돌 방지)', tql.includes('var __NF=(function(){'));
/* 압축이 함수 이름을 갈아도 서버가 부를 이름은 고정이어야 한다.
   묶음 두 함수(planNotifications·bundleMessage)도 같이 재노출되지 않으면 서버만 ReferenceError가 난다. */
check('notify 함수 고정 이름 재노출',
  /var eventMessage=__NF\.em, payloadFor=__NF\.pf, shouldNotify=__NF\.sn,/.test(tql)
  && /planNotifications=__NF\.pn, bundleMessage=__NF\.bm,/.test(tql)
  && /notifyCfgFrom=__NF\.nc, configFromRows=__NF\.cr;/.test(tql));

const res = await fetch(NEO + '/db/tql', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: tql });
const text = (await res.text()).trim();
console.log('HTTP', res.status, '\n' + text);
check('HTTP 200', res.status === 200);
check('ReferenceError 없음', !/ReferenceError|is not defined/.test(text));
check('오류 없이 순회 완료', /(^|\n)done,/.test(text));

console.log(`\nminified-safe: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
