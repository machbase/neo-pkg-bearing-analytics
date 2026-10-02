/* 서버 TQL 임베드 함수의 자체 완결 — judgeTick·baselineLimit·bandJudge·windowRms·notify·patSrc 등을 격리 스코프에서 실행
   · 몸통이 모듈 스코프 이름을 참조하면 압축 번들에서 이름이 어긋나 타이머가 ReferenceError로 죽음
   · new Function은 전역 스코프만 봄 → 개발 소스로 자유 식별자 검출 + esbuild 압축본으로 재확인
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Notify = (await import('../../cgi-bin/notify/notify.js')).default;
const { judgeTick, detailSrc } = await import('../src/app.js');

let fail = 0;
const chk = (label, fn) => {
  try { fn(); console.log('PASS', label); } catch (e) { fail++; console.error('FAIL', label, '—', e.message); }
};

// monitor.js가 만드는 것과 같은 선언문을 격리 스코프에서 평가
function isolate(decls, call) {
  return new Function(decls + '\nreturn (' + call + ');')();
}

chk('judgeDetail 격리 실행 — durKo까지 자체 완결인가', () => {
  /* judgeDetail은 durKo를 이름으로 호출 — detailSrc()가 함께 선언해야 함
     · durKo를 부르는 유일한 분기인 복귀 경로를 태움 */
  const out = isolate(detailSrc(),
    'judgeDetail({ etype: "recovery", epMs: 4 * 3600000 }, { r: 4.2, key: "외륜(BPFO)" }, { crest: 9.1, kurt: 5.2 })');
  if (!/만에 복귀/.test(out)) throw new Error('복귀 문구가 없다: ' + out);
  if (!/판정 창 Crest 9.1/.test(out)) throw new Error('충격성 근거가 없다: ' + out);
});

const S = {
  judge: judgeTick.toString(),
  limit: VC.baselineLimit.toString(),
  band: VC.bandJudgeSrc(),
  win: VC.windowRms.toString(),
};

chk('judgeTick 격리 실행', () => {
  /* 확정까지 전 경로를 태우려고 회차 두 번 입력(cyc 변경) — 한 번이면 조짐만 */
  const CFG = "{ escHold: 0, recHold: 0, reno: {} }";
  const r = isolate('var judgeTick = ' + S.judge + ';',
    '(function(){ var a = judgeTick(null, 2, false, 0, ' + CFG + ', null, true, 0);'
    + ' return judgeTick(a.next, 2, false, 600000, ' + CFG + ', null, true, 600000); })()');
  if (!r || !r.next || r.next.g !== 2) throw new Error('결과 이상: ' + JSON.stringify(r));
  if (!r.events.some((e) => e.etype === 'threshold')) throw new Error('확정 이벤트 없음: ' + JSON.stringify(r.events));
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

/* bandJudge 격리 실행 — 모듈 상수(BAND_ORDER·BAND_KO·BAND_GRADE·BAND_HYST)·baselineLimit 참조 잔존 검출 */
chk('bandJudge 격리 실행', () => {
  const now = { sub: 0.1, one: 0.5, fault: 0.3, high: 0.2, vh1: 0 };
  const bls = { sub: { mu: 0.1, sigma: 0.01, k: 3 }, one: { mu: 0.2, sigma: 0.01, k: 3 },
    fault: { mu: 0.3, sigma: 0.01, k: 3 }, high: { mu: 0.2, sigma: 0.01, k: 3 }, vh1: { mu: 0, sigma: 0, k: 3 } };
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

/* bandJudge 내부 상수·한계식 = 모듈 정의 확인(어긋나면 화면·서버 판정이 조용히 갈라짐) */
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
  // 등급 경계 = 모듈 상수 BAND_GRADE(×1.5 초과 위험 · ×3.0 초과 심각)
  const at = (mult) => { const n = {}; VC.BAND_ORDER.forEach((k) => { n[k] = lim * mult; }); return VC.bandJudge(n, bls, false).gi; };
  if (at(VC.BAND_GRADE[0] + 0.01) !== 2 || at(VC.BAND_GRADE[1] + 0.01) !== 3 || at(1.01) !== 1) {
    throw new Error('등급 경계가 BAND_GRADE와 어긋남');
  }
});

chk('isRunning/runRef 격리 실행', () => {
  const decls = 'var isRunning = ' + VC.isRunning.toString() + ';\nvar runRef = ' + VC.runRef.toString() + ';';
  const r = isolate(decls, 'isRunning(1.0, runRef(null, [1,1,1,1]))');
  if (r !== VC.isRunning(1.0, VC.runRef(null, [1, 1, 1, 1]))) throw new Error('값 불일치: ' + r);
  // 정지 판정도 같은 답
  const stopped = isolate(decls, 'isRunning(0.1, runRef({ mu: 2, sigma: 0.1, k: 3 }, []))');
  if (stopped !== false) throw new Error('정지가 운전으로 판정됨');
});

/* isRunning 내부 정지 기준 = 학습의 BL_IDLE_FRAC 확인(갈라지면 학습·판정의 정지 기준 모순) */
chk('isRunning의 정지 기준이 BL_IDLE_FRAC과 일치', () => {
  const ref = 10;
  const edge = ref * VC.BL_IDLE_FRAC;
  if (VC.isRunning(edge * 0.999, ref)) throw new Error('기준 바로 아래인데 운전으로 판정 — 상수가 갈라졌다');
  if (!VC.isRunning(edge * 1.001, ref)) throw new Error('기준 바로 위인데 정지로 판정 — 상수가 갈라졌다');
});

/* 실제 배포 번들(main.html) 검사 — 자체 완결이면 압축본에서도 대역 이름 배열과 한계식이 같은 함수 안에 있음 */
{
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../../main.html', import.meta.url), 'utf8').catch(() => null);
  if (!html) console.log('SKIP 번들 검사 — main.html 없음 (npm run build:root 후 확인)');
  else chk('번들의 bandJudge가 자체 완결', () => {
    // 대역 이름 배열 근처에 한계식 존재(사이에 함수 경계 없음)
    const i2 = html.indexOf('"sub","one","fault","high","vh1"');
    if (i2 < 0) throw new Error('번들에서 대역 이름 배열을 찾지 못함 — 빌드 확인');
    const near = html.slice(i2, i2 + 1200);
    if (!/\.mu\+\(.{1,4}\.k\|\|3\)\*/.test(near)) throw new Error('한계식이 함수 밖에 있다 — 자체 완결이 깨졌다');
  });
}

/* 압축본 검사 — 임베드가 소스 이름으로 선언하면 개발 소스에선 통과하나 압축본에선 어긋남 → 배포와 같은 압축으로 재실행
   · 호출까지 수행(단락 평가 뒤 참조는 그 가지를 타야 드러남) */
{
  const esbuild = (await import('esbuild')).default;
  const { writeFile, rm } = await import('node:fs/promises');
  const path = (await import('node:path')).default;
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const minPath = path.join(here, '_calc.min.test.mjs');

  const out = await esbuild.build({
    entryPoints: [path.join(here, '../../cgi-bin/calc/calc.js')],
    bundle: true, minify: true, format: 'esm', write: false,
  });
  await writeFile(minPath, out.outputFiles[0].text);
  const MIN = (await import(pathToFileURL(minPath).href)).default;

  // 결함 주파수가 실린 합성 신호 — 격자·채택 임계까지 실제 경로를 태움
  const GEO = { n: 9, Bd: 12.7, Pd: 65, phi: 0 }, RPM = 1800, FS = 20000, N = 8192;
  const bfA = VC.bearingFreqs(RPM, GEO);
  const sig = [];
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    let v = Math.sin(2 * Math.PI * 30 * t);
    const ph = (t * bfA.BPFO) % 1;
    v += 3 * Math.exp(-ph * 60) * Math.sin(2 * Math.PI * 3000 * t);
    sig.push(v);
  }

  const patCall = 'var band=demodFixed(' + FS + ');'
    + 'var bf=bearingFreqs(' + RPM + ',' + JSON.stringify(GEO) + ');'
    + 'var env=envelopeSpectrum(SIG,' + FS + ',envMaxFor(bf,' + (RPM / 60) + ',' + FS + '),band);'
    + 'var m=targetedMatch(env,bf,' + (RPM / 60) + ',env.resTrue||env.res);'
    + 'return {band:band,m:m,gate:patternGate(true,2)};';

  const isolateMin = (decls, body) => new Function('SIG', decls + '\n' + body)(sig);

  chk('압축본 patSrc 격리 실행 — 상수가 클로저 안까지 따라간다', () => {
    const r = isolateMin(MIN.patSrc(), patCall);
    if (!r.band || r.band.hiHz !== 5000) throw new Error('demodFixed 결과 이상: ' + JSON.stringify(r.band));
    if (!r.m || !(r.m.r > 0)) throw new Error('targetedMatch가 격자를 못 탐: ' + JSON.stringify(r.m));
    if (r.gate !== 2) throw new Error('patternGate 결과 이상: ' + r.gate);
  });

  chk('압축본 patSrc가 앱과 같은 값을 낸다', () => {
    const got = isolateMin(MIN.patSrc(), patCall);
    const bf = VC.bearingFreqs(RPM, GEO);
    const env = VC.envelopeSpectrum(sig, FS, VC.envMaxFor(bf, RPM / 60, FS), VC.demodFixed(FS));
    const want = VC.targetedMatch(env, bf, RPM / 60, env.resTrue || env.res);
    if (JSON.stringify(got.m) !== JSON.stringify(want)) {
      throw new Error('앱/서버 판정 불일치\n  서버: ' + JSON.stringify(got.m) + '\n  앱  : ' + JSON.stringify(want));
    }
  });

  chk('압축본 isoSrc·gateSrc 격리 실행', () => {
    const iso = isolateMin(MIN.isoSrc(), 'return {rms:isoRms(SIG,' + FS + '),need:isoNeeded(' + FS + ')};');
    if (!(iso.rms > 0)) throw new Error('isoRms 결과 이상: ' + JSON.stringify(iso));
    const g = isolateMin(MIN.gateSrc(), 'return {raw:gateFromRaw(SIG),imp:impactEvidence(SIG)};');
    if (g.imp == null) throw new Error('impactEvidence가 null');
  });

  /* 포락선 1·2순위 접전 입력 — envAmbig 가지를 태워 내부 상수 참조 노출(안 태우면 단락 평가에 가려 통과) */
  const AMB_NOW = { envBPFO: 1.0, envBPFI: 0.95 };
  const AMB_BLS = { envBPFO: { mu: 0.1, sigma: 0.01, k: 3 }, envBPFI: { mu: 0.1, sigma: 0.01, k: 3 } };
  chk('압축본 bandJudge 격리 실행 — 접전(envAmbig) 가지까지', () => {
    const r = isolateMin('var bandJudge=' + MIN.bandJudgeSrc() + ';',
      'return bandJudge(' + JSON.stringify(AMB_NOW) + ',' + JSON.stringify(AMB_BLS) + ',false);');
    const want = VC.bandJudge(AMB_NOW, AMB_BLS, false);
    if (JSON.stringify(r) !== JSON.stringify(want)) {
      throw new Error('앱/서버 판정 불일치\n  서버: ' + JSON.stringify(r) + '\n  앱  : ' + JSON.stringify(want));
    }
    if (!r.envAlt) throw new Error('접전인데 종류를 단정했다 — envAmbig 가지를 안 탔다');
  });

  await rm(minPath, { force: true });
}

/* bandJudge 내부 접전 여유(ETM) = ENV_TYPE_MARGIN 확인(갈라지면 앱·서버 중 한쪽만 종류 단정) */
chk('bandJudge 내부 접전 여유가 ENV_TYPE_MARGIN과 일치', () => {
  const bls = { envBPFO: { mu: 0.1, sigma: 0.01, k: 3 }, envBPFI: { mu: 0.1, sigma: 0.01, k: 3 } };
  const at = (ratio) => VC.bandJudge({ envBPFO: 1.0, envBPFI: ratio }, bls, false).envAlt;
  const m = VC.ENV_TYPE_MARGIN;
  if (!at(1.0 * m + 0.01)) throw new Error('여유 안쪽인데 단정했다 — 상수가 갈라졌다');
  if (at(1.0 * m - 0.02)) throw new Error('여유 밖인데 단정을 안 했다 — 상수가 갈라졌다');
});

console.log(fail ? '=== 실패 ' + fail + '건 ===' : '=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
