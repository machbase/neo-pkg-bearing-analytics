// 타이머 자가 방어 검사 — 오프라인. npm run smoke에 포함.
//
// Neo 타이머는 스크립트가 한 번 예외를 던지면 STOP으로 두고 재시도하지 않는다. 예전에는 죽은
// 타이머를 되살리는 감시자 타이머를 뒀는데, 감시자도 같은 이유로 죽고 되살리려면 계정
// 비밀번호를 TQL에 구워야 해서(그 파일은 읽힌다) 걷어냈다. 대신 회차를 통째로 감싼다.
// 여기서 지키는 주장: 생성된 TQL은 어떤 예외에도 밖으로 던지지 않는다.
const Monitor = (await import('../../cgi-bin/monitor/monitor.js')).default;
const Band = (await import('../../cgi-bin/monitor/band.js')).default;
const WD = (await import('../../cgi-bin/monitor/watchdog.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const PFX = 'NEO_BEARING_STORE.JOY.';
const monSpec = { tblPrefix: PFX, tags: [], now: Date.now() };
const mon = String(Monitor.buildMonitorTql(monSpec));
const band = String(Band.buildBandTql({
  tags: [{ tbl: 'T', tag: 'A', fr: 30, fs: 12800 }], anchors: [Date.now()],
  nowMs: Date.now(), grid: 600000, tblPrefix: PFX, selfHb: '__hbband',
}));

console.log('\n== 회차가 예외로 죽지 않는다 ==');
{
  chk(/try \{/.test(mon) && /\} catch\(e\) \{/.test(mon), '감시 TQL이 회차를 try/catch로 감싼다');
  chk(/try \{/.test(band) && /\} catch\(e\)/.test(band), '대역 TQL이 회차를 try/catch로 감싼다');
  // 예외가 나면 잠금을 풀어야 한다 — 안 풀면 TTL이 지날 때까지 모든 회차가 BUSY로 건너뛴다
  const tail = mon.slice(mon.lastIndexOf('} catch(e)'));
  chk(/__lock/.test(tail), '예외 경로에서 잠금을 푼다');
  chk(/__err/.test(tail), '예외 사유를 남긴다 — 조용히 건너뛰면 왜 멈췄는지 아무도 모른다');
  chk(/\$\.yield\("error"/.test(tail), '예외를 밖으로 던지지 않고 결과로 돌려준다');
}

console.log('\n== 되살리기 코드는 들어가지 않는다 ==');
{
  // 되살리기는 Neo에 인증 요청을 보내야 하는데 서버 TQL에는 세션이 없다.
  // 남아 있으면 없어진 REST 경로로 매 회차 404를 쏘거나, 비밀번호가 파일에 실린다.
  for (const [name, tql] of [['감시', mon], ['대역', band]]) {
    chk(!/web\/api\/timers/.test(tql), `${name} TQL에 옛 타이머 REST 경로가 없다`);
    chk(!/wdTick|wdResolve|wdLogin/.test(tql), `${name} TQL에 되살리기 코드가 없다`);
    chk(!/password|loginName/.test(tql), `${name} TQL에 자격증명이 없다`);
  }
}

console.log('\n== 심박은 남는다 ==');
{
  // 앱의 건강 배너와 자동 복구가 이 값을 읽는다 — 없으면 "돌고 있는지"를 알 수 없다
  chk(/__hb/.test(mon), '감시 TQL이 심박을 남긴다');
  chk(/hbPut\(db,"__hbband"/.test(band), '대역 TQL이 심박을 남긴다');
  chk(/TBLP/.test(WD.hbOnlySrc('__hbband', 'nOk')), '심박도 계정 스키마 테이블에 쓴다');
  // 값이 안 쌓인 회차에도 남겨야 한다 — 보는 쪽이 알고 싶은 것은 "돌았는가"지 "일했는가"가 아니다
  chk(/catch\(e\)\{\}/.test(WD.hbOnlySrc('__hb', '0')), '심박 실패가 회차를 죽이지 않는다');
}

console.log('\n== 저장소는 계정 스키마를 본다 ==');
{
  for (const [name, tql] of [['감시', mon], ['대역', band]]) {
    const bare = /(^|[\s("])NEO_VIBE_[A-Z_]+/m.test(tql.replace(/\+TBLP\+"NEO_VIBE_[A-Z_]+/g, ''));
    chk(!bare, `${name} TQL의 앱 테이블이 전부 접두를 지난다`);
  }
  chk(/var TBLP="NEO_BEARING_STORE\.JOY\."/.test(mon), '접두를 값으로 굽는다', (mon.match(/var TBLP=[^;]*/) || [''])[0]);
}

console.log('\n== 생성물이 실제로 유효한가 ==');
{
  chk(!Monitor.validateSpec(monSpec), '감시 TQL이 구문상 유효하다', Monitor.validateSpec(monSpec) || 'OK');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
