/* 서버 TQL에 문자열로 박아 넣는 함수들이 정말 자체 완결인지 검사한다.

   monitor.js는 judgeTick/baselineLimit/bandJudge/windowRms의 소스를 그대로 TQL SCRIPT 안에
   붙여 서버가 앱과 같은 규칙으로 판정하게 한다. 그런데 함수 몸통이 모듈 스코프의 상수나 다른
   함수를 이름으로 참조하면, 그 이름은 TQL 쪽에 존재하지 않는다. 개발 소스에서는 감싸는 코드가
   같은 이름으로 상수를 선언해 줘서 통과하지만, vite가 번들을 압축하면 몸통 안 이름이 바뀌어
   (BAND_ORDER → tt) 선언과 어긋나고 타이머가 ReferenceError로 죽는다. 실제로 그렇게 하루
   넘게 감시가 멈춰 있었다.

   new Function은 전역 스코프만 본다 — 모듈 스코프 이름은 여기서 안 보인다. 그래서 개발
   소스로도 자유 식별자를 잡아낸다. 압축은 이름을 바꿀 뿐 참조를 만들거나 없애지 않으므로,
   여기서 자유 식별자가 0이면 압축본에서도 0이다. */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Notify = (await import('../../cgi-bin/notify/notify.js')).default;
const { judgeTick } = await import('../src/app.js');

let fail = 0;
const chk = (label, fn) => {
  try { fn(); console.log('PASS', label); } catch (e) { fail++; console.error('FAIL', label, '—', e.message); }
};

// monitor.js가 만드는 것과 같은 선언문을 격리 스코프에서 평가한다
function isolate(decls, call) {
  return new Function(decls + '\nreturn (' + call + ');')();
}

const S = {
  judge: judgeTick.toString(),
  limit: VC.baselineLimit.toString(),
  band: VC.bandJudgeSrc(),
  win: VC.windowRms.toString(),
};

chk('judgeTick 격리 실행', () => {
  const r = isolate('var judgeTick = ' + S.judge + ';',
    'judgeTick(null, 2, false, 1000, { escHold: 0, recHold: 0, reno: {} }, null, true)');
  if (!r || !r.next || r.next.g !== 2) throw new Error('결과 이상: ' + JSON.stringify(r));
});

chk('baselineLimit 격리 실행', () => {
  const r = isolate('var baselineLimit = ' + S.limit + ';', 'baselineLimit({ mu: 2, sigma: 0.1, k: 3 })');
  if (Math.abs(r - VC.baselineLimit({ mu: 2, sigma: 0.1, k: 3 })) > 1e-12) throw new Error('값 불일치: ' + r);
});

chk('windowRms 격리 실행', () => {
  const b = [{ rms: 1.0, cnt: 100 }, { rms: 2.0, cnt: 100 }];
  const r = isolate('var windowRms = ' + S.win + ';', 'windowRms(' + JSON.stringify(b) + ')');
  const want = VC.windowRms(b);
  if (!r || Math.abs(r.rms - want.rms) > 1e-12) throw new Error('값 불일치: ' + JSON.stringify(r));
});

/* bandJudge는 모듈 상수(BAND_ORDER·BAND_KO·BAND_GRADE·BAND_HYST)와 baselineLimit을 쓰던 자리다.
   격리 스코프에서 부르면 그 참조가 남아 있는지 바로 드러난다. */
chk('bandJudge 격리 실행', () => {
  const now = { sub: 0.1, one: 0.5, fault: 0.3, high: 0.2, vhigh: 0 };
  const bls = { sub: { mu: 0.1, sigma: 0.01, k: 3 }, one: { mu: 0.2, sigma: 0.01, k: 3 },
    fault: { mu: 0.3, sigma: 0.01, k: 3 }, high: { mu: 0.2, sigma: 0.01, k: 3 }, vhigh: { mu: 0, sigma: 0, k: 3 } };
  const r = isolate('var bandJudge = ' + S.band + ';',
    'bandJudge(' + JSON.stringify(now) + ',' + JSON.stringify(bls) + ', false)');
  const want = VC.bandJudge(now, bls, false);
  if (JSON.stringify(r) !== JSON.stringify(want)) {
    throw new Error('앱/서버 판정 불일치\n  격리: ' + JSON.stringify(r) + '\n  앱  : ' + JSON.stringify(want));
  }
  if (!r.on || r.gi !== 2) throw new Error('이탈(위험)이 잡혀야 하는 입력인데 결과가 ' + JSON.stringify(r));
});

chk('notify serverSrc 격리 실행', () => {
  const ev = { etype: 'threshold', tag: 'T1', grade: '위험', val: 4.2, lim: 2.8, ts: 1700000000000, tbl: 'TBL' };
  const r = isolate(Notify.serverSrc(), 'eventMessage(' + JSON.stringify(ev) + ')');
  const want = Notify.eventMessage(ev);
  if (!r || !r.subject) throw new Error('메시지 없음: ' + JSON.stringify(r));
  if (r.subject !== want.subject || r.text !== want.text) throw new Error('앱/서버 메시지 불일치');
  const sn = isolate(Notify.serverSrc(), 'shouldNotify(' + JSON.stringify(ev) + ', ' + JSON.stringify({ channels: { webhook: true }, routes: {} }) + ')');
  if (sn === undefined) throw new Error('shouldNotify가 undefined');
});

/* bandJudge가 상수와 한계식을 안에 다시 들고 있으므로, 모듈 쪽 정의와 어긋나지 않는지 본다.
   어긋나면 화면과 서버 판정이 조용히 갈라진다. */
chk('bandJudge 내부 상수·한계식이 모듈 정의와 일치', () => {
  const bl = { mu: 0.2, sigma: 0.01, k: 3 };
  const lim = VC.baselineLimit(bl);
  const now = {}, bls = {};
  VC.BAND_ORDER.forEach((k) => { now[k] = lim * 1.2; bls[k] = bl; });   // 전 대역 이탈
  const r = VC.bandJudge(now, bls, false);
  if (!r || r.over.length !== VC.BAND_ORDER.length) throw new Error('대역 수 불일치 — ORDER가 갈라짐: ' + JSON.stringify(r && r.over.map((o) => o.k)));
  r.over.forEach((o) => {
    if (Math.abs(o.lim - lim) > 1e-12) throw new Error(o.k + ' 한계식 불일치: ' + o.lim + ' ≠ ' + lim);
    if (o.ko !== VC.BAND_KO[o.k]) throw new Error(o.k + ' 이름 불일치: ' + o.ko + ' ≠ ' + VC.BAND_KO[o.k]);
  });
  // 등급 경계도 모듈 상수와 같은 값이어야 한다 (×1.5 초과 위험 · ×3.0 초과 심각)
  const at = (mult) => { const n = {}; VC.BAND_ORDER.forEach((k) => { n[k] = lim * mult; }); return VC.bandJudge(n, bls, false).gi; };
  if (at(VC.BAND_GRADE[0] + 0.01) !== 2 || at(VC.BAND_GRADE[1] + 0.01) !== 3 || at(1.01) !== 1) {
    throw new Error('등급 경계가 BAND_GRADE와 어긋남');
  }
});

chk('isRunning/runRef 격리 실행', () => {
  const decls = 'var isRunning = ' + VC.isRunning.toString() + ';\nvar runRef = ' + VC.runRef.toString() + ';';
  const r = isolate(decls, 'isRunning(1.0, runRef(null, [1,1,1,1]))');
  if (r !== VC.isRunning(1.0, VC.runRef(null, [1, 1, 1, 1]))) throw new Error('값 불일치: ' + r);
  // 정지 판정도 같은 답이어야 한다
  const stopped = isolate(decls, 'isRunning(0.1, runRef({ mu: 2, sigma: 0.1, k: 3 }, []))');
  if (stopped !== false) throw new Error('정지가 운전으로 판정됨');
});

/* isRunning은 정지 기준(0.2)을 안에 다시 들고 있다 — 학습이 쓰는 BL_IDLE_FRAC과 갈라지면
   "학습은 정지로 걸러낸 값을 판정은 운전으로 본다"는 모순이 조용히 생긴다. */
chk('isRunning의 정지 기준이 BL_IDLE_FRAC과 일치', () => {
  const ref = 10;
  const edge = ref * VC.BL_IDLE_FRAC;
  if (VC.isRunning(edge * 0.999, ref)) throw new Error('기준 바로 아래인데 운전으로 판정 — 상수가 갈라졌다');
  if (!VC.isRunning(edge * 1.001, ref)) throw new Error('기준 바로 위인데 정지로 판정 — 상수가 갈라졌다');
});

/* 압축본에서만 나는 사고였으므로 실제 배포 번들도 본다. bandJudge가 자체 완결이면 압축본에서도
   대역 이름 문자열이 함수 안에 함께 들어 있다 — 상수를 바깥에 두면 그 자리가 비고 참조만 남는다. */
{
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../../main.html', import.meta.url), 'utf8').catch(() => null);
  if (!html) console.log('SKIP 번들 검사 — main.html 없음 (npm run build:root 후 확인)');
  else chk('번들의 bandJudge가 자체 완결', () => {
    // 대역 이름 배열과 한계식이 같은 함수 안에 있어야 한다(둘 사이에 함수 경계가 없어야 함)
    const i2 = html.indexOf('"sub","one","fault","high","vhigh"');
    if (i2 < 0) throw new Error('번들에서 대역 이름 배열을 찾지 못함 — 빌드 확인');
    const near = html.slice(i2, i2 + 1200);
    if (!/\.mu\+\(.{1,4}\.k\|\|3\)\*/.test(near)) throw new Error('한계식이 함수 밖에 있다 — 자체 완결이 깨졌다');
  });
}

console.log(fail ? '=== 실패 ' + fail + '건 ===' : '=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
