// 서버 감시자(워치독) 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.
// 핵심 주장 넷:
//   1. 되살릴지 말지의 판단이 옳다 (살아있음/미시작/멈춤/대기/포기/리셋)
//   2. 그 판단부는 TQL 안에 홀로 떨어져도 돈다 (바깥 이름을 참조하지 않는다)
//   3. 감시 고리가 옳게 짜인다 — 자기를 안 보고, 없는 상대를 안 보고, 감시자도 감시받는다
//   4. 감시의 생존이 대역 추출 설정에 걸리지 않는다
globalThis.window = globalThis;
const WD = (await import('../../cgi-bin/monitor/watchdog.js')).default;
const Monitor = (await import('../../cgi-bin/monitor/monitor.js')).default;
const Band = (await import('../../cgi-bin/monitor/band.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Notify = (await import('../../cgi-bin/notify/notify.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const CFG = { stale: 60000, gap: 300000, max: 3, calm: 3600000 };
const NOW = 1_700_000_000_000;

// ── 1. 판단부 ──────────────────────────────────────────────────────────────
{
  const d = (hb, w) => WD.wdDecide(hb, w, NOW, CFG);

  chk(d({ t: NOW - 5000 }, null).why === 'alive', '최근 심박이면 가만둔다');
  chk(!d({ t: NOW - 5000 }, null).act, '가만둘 때는 되살리지 않는다');

  /* 심박이 없는 것과 오래된 것은 다르다. 갓 등록된 타이머는 아직 한 번도 안 뛰었을 뿐인데
     이걸 "죽었다"로 읽으면 등록하자마자 재등록을 걸어 무한 루프가 된다. */
  chk(d(null, null).why === 'nohb', '심박이 없으면 판단하지 않는다');
  chk(d({ t: 0 }, null).why === 'nohb', 't=0도 미시작으로 본다');

  const r = d({ t: NOW - 600000 }, null);
  chk(r.act && r.why === 'restart', '심박이 오래되면 되살린다');
  chk(r.w.n === 1 && r.w.at === NOW, '시도 이력을 남긴다', JSON.stringify(r.w));

  // 방금 시도했으면 결과를 기다린다 — 등록 직후엔 아직 첫 회차가 안 돌았을 수 있다
  chk(d({ t: NOW - 600000 }, { n: 1, at: NOW - 60000 }).why === 'waiting', '간격 안에서는 다시 시도하지 않는다');
  const again = d({ t: NOW - 600000 }, { n: 1, at: NOW - 400000 });
  chk(again.act && again.w.n === 2, '간격이 지나면 다시 시도한다', JSON.stringify(again.w));

  /* 스크립트가 깨진 경우는 몇 번을 등록해도 같은 자리에서 죽는다. 상한에서 손을 떼야
     로그가 재등록으로 도배되지 않고, 앱 배너와 사람이 진짜 사유를 본다. */
  chk(d({ t: NOW - 600000 }, { n: 3, at: NOW - 400000 }).why === 'gaveup', '상한을 넘기면 손을 뗀다');

  // 오래 조용했으면 처음부터 — 몇 달에 한 번 나는 장애까지 누적하면 남은 시도가 없다
  const calm = d({ t: NOW - 600000 }, { n: 3, at: NOW - 2 * 3600e3 });
  chk(calm.act && calm.w.n === 1, '오래 조용하면 시도 횟수를 리셋한다', JSON.stringify(calm.w));

  // 이력이 깨져 있어도(문자열·undefined) 죽지 않는다 — MONSTATE는 사람 손이 닿는 곳이다
  chk(d({ t: NOW - 600000 }, 'garbage').act, '이력이 망가져 있어도 판단은 된다');
}

// ── 2. 홀로 떨어져도 도는가 ────────────────────────────────────────────────
{
  /* TQL에는 이 파일의 다른 이름이 하나도 없다. 몸통이 바깥 이름을 참조하면 그 자리에서
     ReferenceError가 나고, 타이머는 등록만 성공한 뒤 첫 회차에서 죽는다(화면엔 표시 없음).
     그래서 소스만 떼어 빈 스코프에서 되살려 본다. */
  const lone = new Function('return (' + WD.wdDecide.toString() + ')')();
  chk(lone({ t: NOW - 600000 }, null, NOW, CFG).act === true, '판단부는 소스만으로 홀로 돈다');

  // 압축으로 이름이 바뀌어도 몸통이 자기 이름에 기대지 않는다
  const renamed = WD.wdDecide.toString().replace(/wdDecide/g, 'x');
  chk(new Function('return (' + renamed + ')')()({ t: NOW - 600000 }, null, NOW, CFG).act === true, '이름이 바뀌어도 돈다');
}

// ── 3. 굽기 ────────────────────────────────────────────────────────────────
{
  const base = { base: 'http://127.0.0.1:5654', authPath: '/work/public/p/cgi-bin/config/neo-auth.json' };
  const T = (peer, hb, key) => ({ peer, hb, key, stale: 60000, gap: 300000, max: 3, calm: 3600000 });

  // TQL 안의 JS가 실제로 파싱되는지 — 문법 오류를 여기서 못 잡으면 감시가 조용히 멎는다
  const inner = (tql) => tql.slice(tql.indexOf('SCRIPT({') + 8, tql.lastIndexOf('})'));
  const parses = (tql) => { try { new Function(inner(tql)); return true; } catch (e) { return e.message; } };
  /* 대상 목록만 떼어 본다 — TQL 전체에서 이름을 찾으면 안 된다. 감시 TQL은 NEO_VIBE_BAND를
     대역 값 조회용으로도 쓰므로, 통째로 훑으면 감시 대상이 비어 있어도 통과해 버린다. */
  const targetsOf = (tql) => JSON.parse(/var WD_TARGETS=(\[.*?\]);/.exec(tql)[1]).map((t) => t.peer);

  const wdTql = WD.buildWatchdogTql(Object.assign({}, base, {
    selfHb: '__hbwd', targets: [T('NEO_VIBE_MONITOR', '__hb', '__wd_mon'), T('NEO_VIBE_BAND', '__hbband', '__wd_band')],
  }));
  chk(parses(wdTql) === true, '감시자 TQL이 파싱된다', parses(wdTql));
  chk(targetsOf(wdTql).join(',') === 'NEO_VIBE_MONITOR,NEO_VIBE_BAND', '감시자는 둘 다 본다', targetsOf(wdTql).join(','));
  chk(/__hbwd/.test(wdTql), '감시자도 자기 심박을 남긴다 — 감시자가 멎으면 대상들이 되살린다');
  chk(/neo-auth\.json/.test(wdTql) && !/"password":"[^"]/.test(wdTql), '자격 증명은 굽지 않고 런타임에 읽는다');

  const monSpec = (extra) => Object.assign({
    judgeSrc: 'function judgeTick(){return {}}', limitSrc: VC.baselineLimit.toString(),
    bandSrc: VC.bandJudgeSrc(), winSrc: VC.windowRms.toString(), runSrc: VC.isRunning.toString(),
    refSrc: VC.runRef.toString(), isoSrc: VC.isoSrc(), gateSrc: VC.gateSrc(),
    isoTtlMs: 30000, isoWinMs: 1000, tickMs: 10000, winMs: 10000, lagMs: 2000,
    bandOrder: VC.BAND_ORDER, bandWinMs: 3600000,
    tags: [{ tbl: 'T', tag: 'A', alias: 'a', unit: 'mm/s', fs: 2000, zones: [1.12, 2.8, 7.1], bl: null, bb: null }],
    cfg: { escHold: 60000, recHold: 60000, reno: { 1: 0, 2: 0, 3: 0 } },
    notify: { src: Notify.serverSrc(), cfg: {} },
  }, extra || {});

  const wdOnWd = Object.assign({}, base, { selfHb: '__hb', targets: [T('NEO_VIBE_WD', '__hbwd', '__wd_wd')] });
  const mon = Monitor.buildMonitorTql(monSpec({ wd: wdOnWd }));
  chk(parses(mon) === true, '감시 TQL이 파싱된다', parses(mon));
  chk(targetsOf(mon).join(',') === 'NEO_VIBE_WD', '감시는 감시자만 본다', targetsOf(mon).join(','));

  const monNo = Monitor.buildMonitorTql(monSpec({ wd: null }));
  chk(!/wdTick/.test(monNo), '감시자가 없으면 감시 코드를 굽지 않는다');
  chk(parses(monNo) === true, '감시 코드 없이도 파싱된다', parses(monNo));

  const bandWd = Object.assign({}, base, { selfHb: '__hbband', targets: [T('NEO_VIBE_WD', '__hbwd', '__wd_wd')] });
  const bandTags = [{ tbl: 'T', tag: 'A', fr: 30, fs: 2000 }];
  const band = Band.buildBandTql({ tags: bandTags, nowMs: 1, wd: bandWd });
  chk(parses(band) === true, '대역 TQL이 파싱된다', parses(band));
  chk(targetsOf(band).join(',') === 'NEO_VIBE_WD', '대역도 감시자만 본다', targetsOf(band).join(','));
  chk(/__hbband/.test(band), '대역이 자기 심박을 남긴다 — 이게 없으면 감시자가 생사를 못 본다');

  /* 백필·미리보기는 타이머가 아니다. 여기에 심박을 남기면 "대역 타이머가 살아 있다"고
     거짓말하게 되고, 정작 타이머가 죽어도 감시자가 되살리지 않는다. */
  chk(!/wdTick|__hbband/.test(Band.buildBandTql({ tags: bandTags, nowMs: 1, anchors: [1, 2] })), '백필에는 심박도 감시도 넣지 않는다');
  chk(!/wdTick|__hbband/.test(Band.buildBandTql({ tags: bandTags, nowMs: 1, wd: bandWd, dryRun: true })), '미리보기에도 넣지 않는다');
}

// ── 4. 감시 고리 ───────────────────────────────────────────────────────────
{
  const mk = (patch) => {
    const app = new App({ seed: 1, equipmentCount: 1 });
    app.setState = function (st) { Object.assign(this.state, st); };
    app._scheduleDraw = function () {};
    Object.assign(app.state, { monitorOn: true, monMode: 'server', monitorInterval: '10s', bandInterval: '10m', bandOn: false }, patch || {});
    return app;
  };
  const peers = (spec) => (spec ? spec.targets.map((t) => t.peer).sort().join(',') : null);

  let a = mk({ bandOn: true });
  chk(peers(a._wdSpec('wd')) === 'NEO_VIBE_BAND,NEO_VIBE_MONITOR', '감시자는 감시와 대역을 본다', peers(a._wdSpec('wd')));
  chk(peers(a._wdSpec('mon')) === 'NEO_VIBE_WD', '감시는 감시자를 본다', peers(a._wdSpec('mon')));
  chk(peers(a._wdSpec('band')) === 'NEO_VIBE_WD', '대역도 감시자를 본다', peers(a._wdSpec('band')));
  chk(!a._wdSpec('wd').targets.some((t) => t.peer === 'NEO_VIBE_WD'), '자기 자신은 보지 않는다 — 죽은 자가 자기를 못 살린다');

  /* 이 검사가 이 설계의 이유다. 대역 추출은 원인 분석용 선택 기능이고 감시의 생존은
     안전 기능인데, 예전 구조에서는 대역을 끄면 무인 복구가 통째로 사라졌다. */
  a = mk({ bandOn: false });
  chk(peers(a._wdSpec('wd')) === 'NEO_VIBE_MONITOR', '대역을 꺼도 감시자는 남아 감시를 본다', peers(a._wdSpec('wd')));
  chk(peers(a._wdSpec('mon')) === 'NEO_VIBE_WD', '대역을 꺼도 감시는 감시자를 본다', peers(a._wdSpec('mon')));

  // 앱 감시 모드 — 감시 타이머가 없으니 대역만 본다
  a = mk({ monMode: 'app', bandOn: true });
  chk(peers(a._wdSpec('wd')) === 'NEO_VIBE_BAND', '앱 모드에서는 대역만 본다', peers(a._wdSpec('wd')));

  // 볼 상대가 하나도 없으면 감시자 자체를 만들지 않는다
  a = mk({ monMode: 'app', bandOn: false });
  chk(a._wdSpec('wd') === null, '볼 상대가 없으면 감시자를 만들지 않는다', JSON.stringify(a._wdSpec('wd')));
  chk(a._wdSpec('mon') === null, '감시자가 없으면 감시도 감시 코드를 안 굽는다');

  a = mk({ monitorOn: false, bandOn: true });
  chk(a._wdSpec('wd') === null, '감시를 끄면 감시자도 없다');

  // 죽었다고 볼 기준은 상대의 주기에서 나온다
  a = mk({ bandOn: true, monitorInterval: '1m', bandInterval: '10m' });
  const tg = {};
  a._wdSpec('wd').targets.forEach((t) => { tg[t.peer] = t.stale; });
  chk(tg.NEO_VIBE_MONITOR === 6 * 60000, '감시 기준 = 주기의 6배', String(tg.NEO_VIBE_MONITOR));
  chk(tg.NEO_VIBE_BAND === 1800000, '대역 기준 = 3배와 30분 중 큰 쪽', String(tg.NEO_VIBE_BAND));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
