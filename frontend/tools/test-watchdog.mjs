// 타이머 자가 방어 — 오프라인(Neo 불필요) · npm run smoke 포함
// · Neo 타이머는 예외 한 번에 STOP 후 재시도 없음 → 생성 TQL은 회차를 감싸 어떤 예외도 밖으로 던지지 않음
// · 되살리기(감시자 타이머) 코드·자격증명 미포함, 회차 상태 기록 유지, 저장소는 계정 스키마 접두
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
  nowMs: Date.now(), grid: 600000, tblPrefix: PFX, statusKey: '__st:band',
}));

console.log('\n== 회차가 예외로 죽지 않는다 ==');
{
  chk(/try \{/.test(mon) && /\} catch\(e\) \{/.test(mon), '감시 TQL이 회차를 try/catch로 감싼다');
  chk(/try \{/.test(band) && /\} catch\(e\)/.test(band), '대역 TQL이 회차를 try/catch로 감싼다');
  // 예외 시 잠금 해제 — 안 풀면 TTL까지 모든 회차가 BUSY로 건너뜀
  const tail = mon.slice(mon.lastIndexOf('} catch(e)'));
  chk(/__lock/.test(tail), '예외 경로에서 잠금을 푼다');
  chk(/errAdd\("round"/.test(tail) && /stPut\("__st:mon"/.test(tail), '예외 사유를 회차 상태 기록에 남긴다(앱 배너)');
  const btail = band.slice(band.lastIndexOf('} catch(e) {'));
  chk(/errAdd\("round"/.test(btail) && /stPut\("__st:band"/.test(btail), '대역도 예외 사유를 회차 상태 기록에 남긴다');
  chk(/\$\.yield\("error"/.test(tail), '예외를 밖으로 던지지 않고 결과로 돌려준다');
}

console.log('\n== 되살리기 코드는 들어가지 않는다 ==');
{
  // 되살리기는 Neo 인증 요청이 필요한데 서버 TQL엔 세션 없음 — 남으면 없는 REST 경로로 매 회차 404 또는 비밀번호가 파일에 실림
  for (const [name, tql] of [['감시', mon], ['대역', band]]) {
    chk(!/web\/api\/timers/.test(tql), `${name} TQL에 옛 타이머 REST 경로가 없다`);
    chk(!/wdTick|wdResolve|wdLogin/.test(tql), `${name} TQL에 되살리기 코드가 없다`);
    chk(!/password|loginName/.test(tql), `${name} TQL에 자격증명이 없다`);
  }
}

console.log('\n== 회차 상태는 남는다 ==');
{
  // 앱의 건강 배너·자동 복구가 이 값을 읽음 — 없으면 동작 여부 확인 불가
  chk(/putState\("__st:mon", stMon\(true\)\)/.test(mon), '감시 TQL이 회차 상태를 남긴다');
  chk(/stPut\("__st:band",\{t:Date\.now\(\)/.test(band), '대역 TQL이 회차 상태를 남긴다');
  chk(/TBLP/.test(WD.statusSrc()), '상태 기록도 계정 스키마 테이블에 쓴다');
  // 기록 실패가 회차를 멈추지 않음
  chk(/catch\(e\)\{\} \}$/.test(WD.statusSrc()), '상태 기록 실패가 회차를 죽이지 않는다');
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
