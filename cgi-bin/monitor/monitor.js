// monitor/monitor.js — 서버 상시감시(P5) 판정 TQL 생성기.
// 앱이 설정을 컴파일해 자체 완결형 .tql로 저장 → Neo 타이머가 주기 실행(앱 없이도 감시).
// 핵심: judgeTick 소스를 그대로 임베드(앱과 동일 규칙 — 드리프트 0). 롤업 없는 테이블은
// SCRIPT 내부에서 사전 판별해 건너뜀(타이머 컨텍스트는 SQL 오류 하나가 스크립트 전체를 즉사시킴).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(
    typeof require === 'function' ? require('./watchdog.js') : root.VibeWatchdog);
  else root.VibeMonitor = factory(root.VibeWatchdog);
})(typeof self !== 'undefined' ? self : this, function (WD) {
  'use strict';

  /* convSrc를 넘기지 않은 호출(옛 스펙·테스트)용 — 변환하지 않고, 패턴 높이는 버터워스 ISO로 잰다. */
  var CONV_FALLBACK = 'var convertDomain = function(v){ return v.slice(0); };'
    + ' var bandRmsAveraged = function(v, fs){ return { rms: isoRms(v, fs) }; };';

  // spec: { judgeSrc(judgeTick 소스문자열), limitSrc(baselineLimit 소스문자열 — 클램프 포함),
  //         winSrc(windowRms 소스 — 구간 RMS), winMs(RMS 구간 길이 ms),
  //         bandSrc(bandJudgeSrc() — 상수 포함 자체 완결형), bandWinMs(대역값 룩백, 기본 2h),
  //         patSrc(patSrc() — 포락선·격자 자체 완결형), patTtlMs(패턴 재계산 최소 간격, 기본 10분),
  //         tags:[{tbl,tag,alias,unit,zones:[z0,z1,z2](원본 단위),isoZones:[z0,z1,z2](mm/s — ISO 등급용),
  //                bl:{mu,sigma,k}|null,bb:{sub:{mu,sigma,k},...}|null}],
  //         convSrc(calc.convSrc() — 속도 변환·ISO 대역 평균), isoQuietMs(조용할 때 ISO 재측정 간격),
  //         cfg:{escHold,recHold,reno:{1,2,3}}(ms),
  //         notify:{src(notify.serverSrc()), cfgTable(계정 설정 표 이름), defs:{order,timing}(라우팅 기본값),
  //                 cfg(dryRun 전용 — 발송 설정 직접 주입)}, dryRun }
  // 발송 설정(웹훅 URL 포함)은 스크립트에 싣지 않는다 — 보낼 알림이 생긴 회차에 cfgTable에서 읽는다.
  // 스크립트는 파일 API로 저장되고, 파일 API는 계정 구분 없이 로그인한 누구나 연다.
  // dryRun=true면 INSERT/UPSERT/발송 대신 $.yield로 결정만 방출(테스트용, 실테이블·외부 무영향).
  /* 임베드할 소스가 TQL 안에서 실제로 돌아가는지 미리 확인한다.

     함수를 문자열로 박는 방식이라, 몸통이 바깥 이름을 참조하면 TQL 쪽에는 그 이름이 없어
     ReferenceError가 난다. 그런데 타이머는 등록 자체는 성공하고 첫 실행에서 죽으므로 화면엔
     아무 표시가 없다 — 감시가 멈춰 있어도 모른다. 그래서 등록 전에 여기서 부딪혀 본다.
     new Function은 전역 스코프만 보므로 모듈 스코프 이름은 여기서도 안 보인다 = TQL과 같은 조건. */
  function validateSpec(spec) {
    var decls = [
      'var judgeTick = ' + (spec.judgeSrc || 'function(){return{next:{},events:[]}}') + ';',
      'var baselineLimit = ' + (spec.limitSrc || 'function(){return null}') + ';',
      spec.bandSrc ? 'var bandJudge = ' + spec.bandSrc + ';' : 'var bandJudge = function(){return null;};',
      spec.patSrc || 'var patternGate = function(p,i){return p?Math.max(1,i||0):0;}; var patternRound = function(p,c,v,h){return {rg:patternGate(!!(p&&p.on),h),cyc:p?(p.at||null):null,miss:false};}; var envelopeSpectrum=function(){return{freqs:[],mags:[]};}; var targetedMatch=function(){return null;}; var bearingFreqs=function(){return null;}; var envMaxFor=function(){return 500;}; var demodFixed=function(){return null;};',
      spec.winSrc ? 'var windowRms = ' + spec.winSrc + ';' : 'var windowRms = function(){return null;};',
      spec.runSrc ? 'var isRunning = ' + spec.runSrc + ';' : 'var isRunning = function(){return true;};',
      spec.isoSrc || 'var isoRms = function(){return null;}; var isoNeeded = function(){return false;}; var isoSkippable = function(){return false;};',
      spec.convSrc || CONV_FALLBACK,
      spec.gateSrc || 'var gateFromBuckets = function(){return null;}; var gateFromRaw = function(){return null;}; var sensorTick = function(p,b,n,c){return {on:false,next:{},events:[]};};',
      spec.refSrc ? 'var runRef = ' + spec.refSrc + ';' : 'var runRef = function(){return 0;};',
      spec.detailSrc || 'var judgeDetail = function(){return "";};',
      spec.notify && spec.notify.src ? spec.notify.src
        : 'function eventMessage(){return{}} function shouldNotify(){return true}'
          + ' function notifyCfgFrom(){return{}} function configFromRows(){return{obj:{},err:""}}',
    ];
    // 각 함수를 한 번씩 실제로 호출한다 — 선언만 해서는 몸통 안 자유 식별자가 드러나지 않는다
    var probe = decls.concat([
      'judgeTick(null, 1, false, 0, { escHold: 0, recHold: 0, reno: {} }, null, true);',
      'baselineLimit({ mu: 1, sigma: 0.1, k: 3 });',
      'windowRms([{ rms: 1, cnt: 10 }, { rms: 1, cnt: 10 }]);',
      'bandJudge({ one: 1 }, { one: { mu: 0.5, sigma: 0.01, k: 3 } }, false);',
      'isRunning(1, runRef({ mu: 1, sigma: 0.1, k: 3 }, [1, 1]));',
      'isoNeeded(25600); isoRms([1,2,3,4,5,6,7,8], 25600); isoSkippable([{rms:1,cnt:10}], 1.12);',
      'patternRound(null, true, { g: 2, cyc: 5 }, 1); patternRound({ on: true, at: 9 }, true, null, 2);',
      'var _cv = []; for (var _i = 0; _i < 1024; _i++) _cv.push(Math.sin(_i / 5));',
      'bandRmsAveraged(convertDomain(_cv, 1024, "g", "mm/s", 10), 1024, 10, 500, 8); convertDomain(_cv, 1024, "μm", "mm/s", 10);',
      'gateFromBuckets([{cnt:10,rms:1,sum:0,mn:-1,mx:1}], 1); sensorTick(null, null, 0, { escHold: 0, recHold: 0 });',
      'judgeDetail({ etype: "recovery", epMs: 1000 }, { r: 4, key: "외륜(BPFO)" }, { crest: 9, kurt: 5 });',
      'var _e = { etype: "threshold", tag: "T", grade: "위험", val: 1, lim: 1, ts: 0, tbl: "T" };',
      'eventMessage(_e); shouldNotify(_e, { channels: {}, routes: {} });',
      'notifyCfgFrom(configFromRows([["cfg:monitor#0", "%7B%7D"]], "monitor").obj, { order: ["x"], timing: { x: "y" } });',
    ]).join('\n');
    try { new Function(probe)(); return null; } catch (e) { return e.message || String(e); }
  }

  function buildMonitorTql(spec) {
    spec = spec || {};
    var judgeSrc = spec.judgeSrc || '';
    // 폴백은 클램프 없는 구식 — limitSrc를 안 넘긴 옛 호출도 동작은 하되, 앱은 항상 넘긴다(_monSpec)
    var limitSrc = spec.limitSrc || 'function(bl){return bl?bl.mu+(bl.k||3)*bl.sigma:null;}';
    /* RMS 구간 — 판정값은 이 구간 전체의 실효값 하나다. 최신 1초 버킷만 쓰면 데이터 대부분이
       판정에 안 들어가고, 순간 잡음이 그대로 등급을 흔든다(앱과 같은 규칙). */
    var winMs = spec.winMs || 10000;
    // 구간 끝의 버킷은 아직 적재 중이라 샘플이 적게 온다 — 여유를 두고 조회하고 windowRms가 걸러낸다
    var lagMs = spec.lagMs || 4000;
    var winSrc = spec.winSrc || '';
    /* 정지·신호 두절 판별 — 앱과 같은 함수를 임베드한다.
       이게 없으면 서버는 설비 정지를 "값이 좋아졌다"로 읽어 복귀 알림을 내고,
       데이터가 끊긴 태그는 조용히 건너뛰어 화면상 정상으로 남는다(최악의 실패 모드). */
    var runSrc = spec.runSrc || '';
    /* ISO 대역제한(10~1000 Hz) — 존 등급은 표준이 정의한 양으로 재야 한다.
       매번 재면 태그당 0.21초가 드므로, 전대역이 양호 경계 미만이면 상한 성질로 건너뛴다
       (에너지는 더해지기만 하므로 ISO ≤ 전대역이다). 잰 값은 판정 상태에 담아 재사용한다. */
    var isoSrc = spec.isoSrc || '';
    var gateSrc = spec.gateSrc || '';   // 계측 게이트 — 파형이 기계 신호인지 계측 문제인지
    var isoTtlMs = spec.isoTtlMs || 30000;
    // 원본이 속도가 아닌 태그가 조용할 때(원본 단위 양호 경계 미만) 쓰는 간격 — 앱 ISO_TTL_QUIET_MS와 같다
    var isoQuietMs = spec.isoQuietMs || 300000;
    var convSrc = spec.convSrc || '';
    var patTtlMs = spec.patTtlMs || 600000;   // 패턴 재계산 최소 간격 — 대역 추출과 같은 10분
    var isoWinMs = spec.isoWinMs || 1000;
    var refSrc = spec.refSrc || '';
    var tickMs = spec.tickMs || 10000;          // 판정 주기 — 두절 기준(6배)의 근거
    var lostMs = Math.max(60000, tickMs * 6);
    /* 중복 실행 잠금의 만료 — 정상 회차는 끝에서 스스로 푸므로, 이 값은 "앞 회차가 죽어서
       잠금이 남았을 때 언제 무시하고 재개할까"만 정한다. 짧으면 느린 회차를 죽은 것으로
       오인해 다시 겹치고, 길면 복구가 늦다. 두절 기준과 같은 눈금을 쓴다. */
    var lockTtlMs = Math.max(60000, tickMs * 6);
    // 대역값은 별도 타이머가 주기(기본 10분)로 적재하므로 룩백이 넉넉해야 한다.
    // 추출 주기의 몇 배를 잡아 한두 번 걸러도 마지막 값을 놓치지 않게 한다.
    var bandWinMs = spec.bandWinMs || 7200000; // 2시간
    var bandSrc = spec.bandSrc || '';
    var cfg = spec.cfg || { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 3600000, 3: 1800000 } };
    var tags = spec.tags || [];
    var dry = !!spec.dryRun;
    var nf = spec.notify || null;

    var body = [
      'SCRIPT({',
      /* 앱 저장소는 전용 DB 의 SYS 스키마에 있다 — 접두가 없으면 서버가 다른 표를 보게 된다.
         공용 표라 계정 구분은 행의 키 접두(UPFX)가 한다 — 키를 만들 때 붙이고 읽을 때 뗀다. */
      'var TBLP=' + JSON.stringify(spec.tblPrefix || '') + ';',
      'var UPFX=' + JSON.stringify(spec.keyPrefix || '') + ';',
      /* 데이터 표는 대개 남(SYS)의 소유다 — 접두 없는 이름은 접속 계정 스키마에서 찾으므로
         타이머가 SYS 가 아니면 조용히 "없는 표"가 되어 회차가 0건으로 끝난다(try/catch 가 삼킨다).
         키는 짧은 이름을 그대로 쓰고, 조회할 때만 수식된 이름으로 바꾼다. */
      'var SRC=' + JSON.stringify(spec.srcMap || {}) + ';',
      'function srcOf(t){ return SRC[t]||t; }',
      'function statOf(t){ var s=srcOf(t), i=s.lastIndexOf("."); return i<0 ? "V$"+s+"_STAT" : s.slice(0,i+1)+"V$"+s.slice(i+1)+"_STAT"; }',
      // var에 대입해 두는 이유: 빌드 미니파이로 함수명이 바뀌어도(judgeTick→ie) 호출측 이름이 유지된다
      'var judgeTick = ' + judgeSrc + ';', // 순수 judgeTick(prev,rg,breach,now,cfg,bandState) — 앱과 동일 소스
      'var baselineLimit = ' + limitSrc + ';', // 베이스라인 한계식(클램프 포함) — 앱과 동일 소스
      bandSrc ? 'var bandJudge = ' + bandSrc + ';' : 'var bandJudge = function(){return null;};',
      /* 결함 패턴 — 등급을 켜는 축이라 서버에서도 같은 소스를 돌려야 앱과 갈리지 않는다.
         goja가 느려서(16k 표본 855 ms) 25회전 창을 쓰고 patTtlMs(기본 10분)로 재계산을 막는다. */
      spec.patSrc || 'var patternGate = function(p,i){return p?Math.max(1,i||0):0;}; var patternRound = function(p,c,v,h){return {rg:patternGate(!!(p&&p.on),h),cyc:p?(p.at||null):null,miss:false};}; var envelopeSpectrum=function(){return{freqs:[],mags:[]};}; var targetedMatch=function(){return null;}; var bearingFreqs=function(){return null;}; var envMaxFor=function(){return 500;}; var demodFixed=function(){return null;};',
      winSrc ? 'var windowRms = ' + winSrc + ';' : 'var windowRms = function(b){ if(!b||!b.length) return null; var ss=0,n=0; for(var i=0;i<b.length;i++){ ss+=b[i].rms*b[i].rms*b[i].cnt; n+=b[i].cnt; } return n?{rms:Math.sqrt(ss/n)}:null; };',
      runSrc ? 'var isRunning = ' + runSrc + ';' : 'var isRunning = function(){return true;};',
      refSrc ? 'var runRef = ' + refSrc + ';' : 'var runRef = function(){return 0;};',
      isoSrc || 'var isoRms = function(){return null;}; var isoNeeded = function(){return false;}; var isoSkippable = function(){return false;};',
      convSrc || CONV_FALLBACK,
      gateSrc || 'var gateFromBuckets = function(){return null;}; var gateFromRaw = function(){return null;}; var sensorTick = function(p,b,n,c){return {on:false,next:{},events:[]};};',
      'function enc(o){return encodeURIComponent(JSON.stringify(o)).replace(/\'/g,"%27");}',
      'function dec(s){try{return JSON.parse(decodeURIComponent(s));}catch(e){return null;}}',
      'function esc(s){return String(s).replace(/\'/g,"\'\'");}',
      'var GW=["\\uC591\\uD638","\\uC8FC\\uC758","\\uC704\\uD5D8","\\uC2EC\\uAC01"];', // 양호/주의/위험/심각
      /* 회차 전체를 감싼다 — Neo 타이머는 스크립트가 한 번 던지면 STOP 으로 두고 재시도하지
         않는다. 순간적인 연결 실패 하나가 감시를 영구히 끄는 일을 여기서 끊는다.
         (예전에는 죽은 뒤 되살리는 감시자 타이머를 따로 뒀는데, 그 감시자도 같은 이유로 죽을
          수 있는 데다 되살리려면 자격증명이 필요해서 애초에 안 죽는 쪽으로 바꿨다.) */
      'try {',
      'var db=$.db(), now=Date.now(), nDone=0, nPat=0, roll={};',
      /* 롤업을 쓸 수 있는가 — 카탈로그(M$SYS_TABLES)로 세지 않는다. 내부 롤업 객체는 표 소유자의
         것이라 GRANT 를 받은 계정에게는 보이지 않고, 그러면 전 태그를 건너뛰어 회차가 0건으로 끝난다
         (에러도 없이). 앱과 같은 방식으로 실제 쿼리를 한 번 던져 보고 판단한다. */
      'function rollupOk(tbl){',
      '  if(roll[tbl]===undefined){',
      '    var tg=""; for(var i=0;i<TAGS.length;i++) if(TAGS[i].tbl===tbl){ tg=TAGS[i].tag; break; }',
      '    try{ db.query("select ROLLUP(\'sec\',1,TIME) rt from "+srcOf(tbl)+" where NAME=\'"+esc(tg)+"\' and TIME between now-60000000000 and now group by rt limit 1")',
      '      .forEach(function(){ }); roll[tbl]=true; }catch(e){ roll[tbl]=false; }',
      '  }',
      '  return roll[tbl];',
      '}',
      'var CFG=' + JSON.stringify(cfg) + ';',
      'var TAGS=' + JSON.stringify(tags) + ';',
      // ── 알림 발송 (앱과 동일한 notify 소스를 인라인) ──
      nf ? nf.src : '',
      /* 발송 설정은 보낼 것이 생긴 회차에만 계정 설정 표에서 읽고, 그 회차 안에서는 재사용한다.
         조용한 회차에는 조회가 없다. dryRun은 테스트가 주입한 설정을 쓰고 표를 읽지 않는다. */
      'var NFON=' + (nf ? 'true' : 'false') + ';',
      'var NOTIFY=' + (dry && nf && nf.cfg ? JSON.stringify(nf.cfg) : 'null') + ';',
      'var NFSRC=' + JSON.stringify({ table: (nf && nf.cfgTable) || '', defs: (nf && nf.defs) || {} }) + ';',
      'var NFERR=null, NFOK=false;',
      'function loadNotify(){',
      '  if(NOTIFY) return {cfg:NOTIFY, err:""};',
      '  if(!NFSRC.table) return {cfg:null, err:"설정 표 위치가 없습니다"};',
      '  var rows=[];',
      // 접두는 LIKE가 아니라 범위로 고른다 — 이 빌드의 LOOKUP 표에서 접두 LIKE가 표에 따라 0건을 돌려준다(sql.js mine 참조)
      '  try{ db.query("select K, VAL from "+NFSRC.table+" where K >= \'cfg:monitor#\' and K < \'cfg:monitor$\'").forEach(function(r){ rows.push([r[0], r[1]]); }); }',
      '  catch(e){ return {cfg:null, err:"설정 조회 실패: "+String(e).slice(0,160)}; }',
      '  var c=configFromRows(rows, "monitor");',
      '  if(c.err) return {cfg:null, err:c.err};',
      '  NOTIFY=notifyCfgFrom(c.obj, NFSRC.defs);',
      '  return {cfg:NOTIFY, err:""};',
      '}',
      // ⚠ 앱의 TYPEKO(app.js)와 키가 같아야 한다 — 빠진 키는 폴백으로 영문 코드가 샌다. test-eventdetail이 대조한다.
      'var TYPEKO=' + JSON.stringify({ observe: '관찰', threshold: '임계 초과', sustained: '상태 지속', recovery: '정상 복귀', improve: '상태 개선', signal_lost: '신호 두절', sensor_fault: '계측 이상', sensor_ok: '계측 복귀', baseline: '베이스라인 이탈', band: '대역 이탈', bandrec: '대역 복귀' }) + ';',
      /* ⚠ 예비 목록은 calc의 BAND_ORDER와 항상 같아야 한다. BORDER는 BAND를 읽는
         NAME IN 목록을 만들므로, 여기서 빠진 계열은 값을 읽지도 못한다 — 적재·학습이 멀쩡해도
         그 축만 조용히 사라지고 에러는 안 난다. 뒤 4개(포락선)가 베어링 근거 계열이다.
         test-bandevent가 이 예비값을 정본과 대조한다. */
      'var BORDER=' + JSON.stringify(spec.bandOrder
        || ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4', 'envPkRel', 'envBPFO', 'envBPFI', 'envBSF']) + ';',
      /* 대역 추출 타이머가 적재한 최신 대역값을 읽는다. 한 앵커의 계열들이 같은 시각에 한 묶음으로
         들어가므로 TIME 역순 몇 줄이면 전부 잡힌다(이름별 첫 등장만 취함).
         BAND가 아직 없을 수 있어(추출 미사용) try로 감싼다 — 없으면 대역 판정만 건너뛴다. */
      'function bandNow(t){',
      '  if(!t.bb) return null;',
      '  var pre=UPFX+t.tbl+":"+t.tag+":", ns=[];',
      '  for(var i=0;i<BORDER.length;i++) ns.push("\'"+esc(pre+BORDER[i])+"\'");',
      '  var out=null;',
      '  try{',
      '    db.query("select NAME, VALUE from "+TBLP+"BAND where NAME in ("+ns.join(",")+") and TIME between '
        + "\" + bandFrom() + \" and now order by TIME desc limit \" + (BORDER.length*5)).forEach(function(r){",
      '      var k=String(r[0]).slice(pre.length);',
      '      if(out&&out[k]!==undefined) return;',      // 같은 대역의 더 오래된 값은 무시
      '      if(!out) out={};',
      '      out[k]=r[1];',
      '    });',
      '  }catch(e){ return null; }',
      '  return out;',
      '}',
      'function bandFrom(){ return "to_date(\'" + fmtTs(now-' + bandWinMs + ') + "\')"; }',
      /* 밀리초까지 찍는 시각 문자열(앱 sqlDate와 같은 규약) — 1초 창 절단과 이벤트 TIME 기록이 같이 쓴다
         (같은 초에 여러 이벤트가 나면 초 단위로는 구분이 안 된다). */
      'function dtms(ms){ var d=new Date(ms); function p(n,w){var s2=""+n;while(s2.length<w)s2="0"+s2;return s2;}',
      '  return p(d.getFullYear(),4)+"-"+p(d.getMonth()+1,2)+"-"+p(d.getDate(),2)+" "+p(d.getHours(),2)+":"+p(d.getMinutes(),2)+":"+p(d.getSeconds(),2)+" "+p(d.getMilliseconds(),3); }',
      /* 존 판정값 — 전대역이 양호 경계 미만이면 ISO도 반드시 양호라 계산을 건너뛰고,
         넘었을 때만 원본 1초를 받아 밴드패스로 정확히 잰다. 직전에 잰 값이 TTL 안이면 그걸 쓴다.
         반환 { v, fresh } — fresh는 "이번에 실제로 쟀다"는 뜻이고, 이때만 호출측이 isoAt을 갱신한다
         (캐시값에 시각을 찍으면 TTL이 영원히 만료되지 않는다). */
      'var GRAW={};',   // 원본으로 본 게이트 결과 — isoValue가 채운다
      'var IMP={};',    // 충격성 근거(Crest·첨도) — 같은 원본에서 함께 잰다
      /* ISO 존은 속도 규격이라 원본이 가속도·변위면 속도로 바꿔 잰다(앱 _isoRefresh와 같은 함수·순서).
         전대역을 그대로 쓰는 두 지름길은 원본이 속도일 때만 성립한다 — 전대역 속도 RMS ≥ ISO 대역 RMS라는
         부등식이 다른 물리량에서는 서지 않는다. 그런 태그는 대신 조용할 때(원본 단위 양호 경계 미만)
         재측정 간격만 늘린다(앱과 같은 규칙). 단위가 비어 있으면 속도로 본다. */
      'function isoValue(t, wide, prev, key, near){',
      '  var mms = !t.unit || t.unit==="mm/s";',
      '  var quiet = isoSkippable(WVAL[key], t.zones[0]) && !near;',
      '  if(mms && !isoNeeded(t.fs)) return {v:wide, fresh:false};',
      '  if(mms && quiet) return {v:wide, fresh:false};',
      '  var ttl = (!mms && quiet) ? ' + isoQuietMs + ' : ' + isoTtlMs + ';',
      '  if(prev && prev.iso!=null && (now-(prev.isoAt||0)) < ttl) return {v:prev.iso, fresh:false};',
      '  var end = LAST[key]||now, vals=[];',
      '  try{ db.query("select VALUE from "+srcOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dtms(end-' + isoWinMs + ')+"\') and to_date(\'"+dtms(end)+"\') order by TIME")',
      '    .forEach(function(r){ vals.push(+r[0]); }); }catch(e){ return {v:wide, fresh:false, hold:true}; }',
      '  var g = gateFromRaw(vals, t.fs); if(g) GRAW[key]=g; else delete GRAW[key];',
      '  var im = impactEvidence(vals, t.fs); if(im) IMP[key]=im; else delete IMP[key];',
      '  var vel = mms ? vals : convertDomain(vals, t.fs, t.unit, "mm/s", t.rpm>0 ? t.rpm/60 : 0);',
      '  var v = isoRms(vel, t.fs);',
      '  return v==null ? {v:wide, fresh:false, hold:true} : {v:v, fresh:true};',
      '}',
      /* 결함 패턴 — 25회전 원시 파형 → 포락선 → 결함주파수 격자. 등급을 켜는 축이다.
         patTtlMs(기본 10분) 안이면 직전 값을 그대로 쓴다 — 판정은 10초마다 도는데 포락선은
         태그당 수백 ms라 매 틱 돌릴 수 없다. 베어링 열화는 며칠 단위라 10분이면 충분하고,
         급변은 ISO·베이스라인 축이 10초로 따로 본다.
         회전수·기하가 없으면 null — 그건 "정상"이 아니라 "판정 못 함"이고, 등급이 안 오르는
         대신 커버리지가 화면에 드러낸다.
         샘플레이트가 낮아 고정 대역(1~5 kHz)이 안 서면 대역통과 없이 전대역으로 복조한다 —
         앱(monPattern)·상세분석과 같은 규칙이다. 세 경로가 갈리면 같은 태그가 화면마다
         다른 등급을 갖는다. 반환의 wide로 알려 화면이 근거를 낮춰 적게 한다. */
      'function patValue(t, prev, key){',
      /* at = 이 값을 **잰 시각**. 판정 상태기가 회차를 세는 기준이라 캐시 히트에도 원래 측정 시각을 돌려준다
         (지금 시각을 주면 10초 틱마다 새 회차로 세어져 "2회차 연속"이 20초가 된다). */
      '  if(prev && prev.pat!=null && (now-(prev.patAt||0)) < ' + patTtlMs + ') return {on:!!prev.pat, r:prev.patR, iso:prev.patIso, key:prev.patK||"", wide:!!prev.patW, cached:true, at:prev.patAt||0};',
      '  if(!t.rpm || !t.geo || !t.geo.n) return null;',
      '  var fr = t.rpm/60; if(!(fr>0)) return null;',
      '  var band = demodFixed(t.fs) || null;',
      '  var bf = bearingFreqs(t.rpm, t.geo); if(!bf) return null;',
      /* 창을 시간으로만 잡으면 밀도가 낮은 태그에서 표본이 모자라 판정이 통째로 건너뛰어진다
         (적재 시 타임스탬프가 퍼진 데이터·재생 데이터가 그렇다). 앱 monPattern과 같은 규칙으로
         모자라면 창을 넓혀 다시 읽는다 — 두 번까지, 600초 상한. 무한정 넓히지 않는 이유는
         창이 길어질수록 서로 다른 운전 상태가 섞여 정상상태 전제가 깨지기 때문이다.
         ⚠ 앱만 되짚으면 같은 신호에 앱은 재고 서버는 못 재, 화면엔 등급이 뜨는데 알람은 안 난다. */
      '  var need = Math.max(4096, Math.round(t.fs * MON_REV / fr));',
      '  var secs = Math.min(22, MON_REV/fr), end = LAST[key]||now;',
      '  function grab(sec){ var out=[];',
      '    try{ db.query("select VALUE from "+srcOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dtms(end-Math.round(sec*1000))+"\') and to_date(\'"+dtms(end)+"\') order by TIME")',
      '      .forEach(function(r){ out.push(+r[0]); }); }catch(e){ return null; }',
      '    return out; }',
      '  var vals = grab(secs); if(!vals) return null;',
      '  for(var _wk=0; _wk<2 && vals.length && vals.length<need; _wk++){',
      '    var _ws = Math.min(600, secs * Math.ceil(need/Math.max(1,vals.length)) * 1.2);',
      '    var _wv = grab(_ws); if(!_wv || _wv.length <= vals.length) break;',
      '    vals = _wv;',
      '  }',
      '  if(vals.length < 4096) return null;',
      '  if(vals.length > need) vals = vals.slice(vals.length - need);',   // 최신 쪽을 쓴다(앱 monPattern과 같은 창)
      '  var env = envelopeSpectrum(vals, t.fs, envMaxFor(bf, fr, t.fs), band);',
      '  var m = targetedMatch(env, bf, fr, env.resTrue||env.res);',
      '  var r2 = m ? (m.r||0) : 0;',
      /* 등급 높이를 정할 ISO도 같은 파형에서 잰다 — 10초 축 값을 쓰면 등급이 10초마다 움직여
         10분 주기인 패턴과 시간축이 어긋난다. 한 등급은 한 시점에서 나와야 한다.
         앱 monPattern과 같은 계산이다: 속도로 바꾼 뒤 10~1000 Hz 대역 RMS를 8블록 평균한다. */
      '  var _iv = null; try{',
      '    var _vel = (!t.unit || t.unit==="mm/s") ? vals : convertDomain(vals, t.fs, t.unit, "mm/s", fr);',
      '    var _ra = bandRmsAveraged(_vel, t.fs, 10, 1000, 8); _iv = _ra ? _ra.rms : null;',
      '  }catch(e){}',
      '  return {on: patternGrade(r2, false, MON_ADOPT) > 0, r: r2, key: m?(m.key||""):"", iso: _iv, fresh:true, wide: !band, at: now};',
      '}',
      // 화면의 durKo와 같은 규칙 — 같은 사건을 이벤트와 화면이 다르게 적으면 같은 것인지 알 수 없다
      'function durAgo(ms){ if(ms<60000) return Math.round(ms/1000)+"초";'
      + ' if(ms<3600000){ var m=Math.round(ms/60000); return m>=60?"1시간":m+"분"; }'
      + ' if(ms<86400000){ var h=Math.floor(ms/3600000), hm=Math.round((ms%3600000)/60000); if(hm===60){h++;hm=0;} return h+"시간"+(hm?" "+hm+"분":""); }'
      + ' var d=Math.floor(ms/86400000), dh=Math.round((ms%86400000)/3600000); if(dh===24){d++;dh=0;} return d+"일"+(dh?" "+dh+"시간":""); }',
      'function fmtTs(ms){ var d=new Date(ms); function p(n){return (n<10?"0":"")+n;} return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }',
      /* 이벤트 사유 문구 — 앱과 같은 함수를 자체 완결형으로 받는다(durKo를 같이 묶은 embedSrc 출력).
         toString 하나만 받으면 압축된 바깥 이름을 못 찾아 서버에서만 죽는다. */
      spec.detailSrc || 'var judgeDetail = function(){return "";};',
      /* 발송은 회차 끝에 몰아서 한다(flushNotify) — 태그별로 즉시 보내면 묶을 기회가 없다.
         수집이 끊기면 전 태그가 같은 회차에 두절을 내는데(실측 91건·60건), 하나씩 보내면
         채널 한도(Slack 초당 1건)에 걸려 임의의 일부만 도착한다. 거르기·묶기 규칙은
         planNotifications 하나가 정하고 앱과 서버가 그 함수를 공유한다. */
      'var NQ=[];',
      'function notifyEvent(t, ev, v, l, d){',
      '  if(!NFON) return;',
      '  var gradeKo=GW[ev.gi];',
      '  NQ.push({alias:t.alias||t.tag, tag:t.tag, table:t.tbl, typeKo:TYPEKO[ev.etype]||ev.etype, gradeKo:gradeKo, etype:ev.etype, detail:d||"", val:v, lim:l, unit:t.unit||"", timeText:fmtTs(now)});',
      dry ? '  $.yield("notify", t.tbl+":"+t.tag, ev.etype, gradeKo);' : '',
      '}',
      /* 회차 발송 — 거르기·묶기는 planNotifications가 정한다(앱과 같은 함수).
         설정을 못 읽으면 보내지 않고 NFERR에 남긴다. 이벤트는 이미 기록됐고 알림만 빠진 것이라
         앱이 __nferr를 배너로 알린다. 읽기에 성공한 회차가 오면 그 기록을 지운다. */
      'function flushNotify(now){',
      '  if(!NQ.length) return;',
      '  var L=loadNotify();',
      '  if(L.err){ NFERR={t:now, m:L.err, n:NQ.length}; NQ=[]; return; }',
      '  NFOK=true;',
      '  var w=L.cfg.channels && L.cfg.channels.webhook, to=w ? w.to : "";',
      '  if(!to){ NQ=[]; return; }',
      '  var msgs=planNotifications(NQ, L.cfg, "webhook", fmtTs(now)); NQ=[];',
      dry
        ? '  msgs.forEach(function(m){ $.yield("notifyMsg", m.subject, (m.event&&m.event.n)||1); });'
        : '  msgs.forEach(function(m){ try{ $.request(to,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payloadFor(m,to))}).do(function(r){}); }catch(e){} });',
      '}',
      /* 판정값 일괄 수집 — 테이블당 한 번의 NAME IN 조회로 전 태그의 구간 버킷을 받는다(태그별 개별 조회보다 훨씬 싸다). */
      'var WVAL={};',
      'function collect(){',
      '  var byTbl={};',
      '  TAGS.forEach(function(t){ if(rollupOk(t.tbl)) (byTbl[t.tbl]=byTbl[t.tbl]||[]).push(t.tag); });',
      '  Object.keys(byTbl).forEach(function(tbl){',
      '    var ns=byTbl[tbl].map(function(x){return "\'"+esc(x)+"\'";}).join(",");',
      '    var q="select NAME, ROLLUP(\'sec\',1,TIME) rt, SUMSQ(VALUE) ss, COUNT(VALUE) cnt, SUM(VALUE) sm, MIN(VALUE) mnv, MAX(VALUE) mxv from "+srcOf(tbl)',
      '      +" where NAME in ("+ns+") and TIME between now-' + ((winMs + lagMs) * 1000000) + ' and now group by NAME, rt order by NAME, rt";',
      '    try{',
      '      db.query(q).forEach(function(r){',
      '        if(!(r[3]>0)) return;',
      '        var k=tbl+":"+String(r[0]);',
      '        (WVAL[k]=WVAL[k]||[]).push({rms:Math.sqrt(r[2]/r[3]), cnt:r[3], sum:r[4], mn:r[5], mx:r[6]});',
      '      });',
      '    }catch(e){}',
      '  });',
      '}',
      /* 마지막 수신 시각 — 통계 뷰라 원본을 훑지 않는다(테이블당 1회).
         DATETIME은 goja에서 Time 객체로 와서 숫자도 문자열도 아니다 — 문자열로 만들어 파싱한다
         (band.js의 tms와 같은 규약. 다른 방법을 쓰면 조용히 NaN이 되어 전 태그가 두절로 보인다). */
      'var LAST={};',
      'function tms(v){ var s=String(v); var m=/^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d+))?/.exec(s); if(!m) return 0;',
      '  var frac=m[7]?("0."+m[7]):"0";',
      '  return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]).getTime() + Math.round(parseFloat(frac)*1000); }',
      'function lastSeen(){',
      '  var byTbl={};',
      '  TAGS.forEach(function(t){ (byTbl[t.tbl]=byTbl[t.tbl]||[]).push(t.tag); });',
      '  Object.keys(byTbl).forEach(function(tbl){',
      '    var ns=byTbl[tbl].map(function(x){return "\'"+esc(x)+"\'";}).join(",");',
      '    try{ db.query("select NAME, MAX_TIME from "+statOf(tbl)+" where NAME in ("+ns+")").forEach(function(r){',
      '      LAST[tbl+":"+String(r[0])]=tms(r[1]); }); }catch(e){}',
      '  });',
      '}',
      /* 직전 판정 상태를 한 번에 읽는다 — 태그마다 점조회를 하면 회차가 주기를 넘긴다.
         HAD는 "그 키의 행이 이미 있었나" — putState의 insert/update 선택 근거(존재 확인 조회 생략). */
      'var PREV={}, HAD={};',
      'function loadPrev(){',
      // 예약키도 같이 읽는다 — 이들도 putState로 쓰므로 존재 여부를 알아야 한다(모르면 두 번째 쓰기부터 insert가 PK 충돌로 묻힌다)
      '  var ks=TAGS.map(function(t){ return "\'"+esc(UPFX+t.tbl+":"+t.tag)+"\'"; })',
      '    .concat(["__lock","__hb","__err","__nferr"].map(function(k){ return "\'"+esc(UPFX+k)+"\'"; })).join(",");',
      '  try{ db.query("select K, VAL from "+TBLP+"MONSTATE where K in ("+ks+")").forEach(function(r){',
      '    var k=String(r[0]).slice(UPFX.length); HAD[k]=1; PREV[k]=dec(r[1]); }); }catch(e){}',
      '}',
      /* 상태 쓰기 — update 우선(delete+insert는 회차가 겹치면 unique index 충돌로 스크립트가 죽는다).
         한 태그의 쓰기 실패가 나머지 태그의 감시를 멈추게 두지 않는다. */
      'function putState(k, o){',
      '  try{',
      '    var v=enc(o);',
      '    if(HAD[k]) db.exec("update "+TBLP+"MONSTATE set VAL=\'"+v+"\' where K=\'"+esc(UPFX+k)+"\'");',
      '    else { db.exec("insert into "+TBLP+"MONSTATE values(\'"+esc(UPFX+k)+"\',\'"+v+"\')"); HAD[k]=1; }',
      '  }catch(e){}',
      '}',
      'loadPrev();',
      /* 상호 감시 — 대역 추출이 멎었으면 여기서 다시 켠다. 잠금 검사보다 앞에 둔다:
         이번 회차를 통째로 건너뛰더라도 상대의 생사는 봐야 한다. */
      /* 중복 실행 방지 — 앞 회차가 아직 살아 있으면 이번 회차는 아무것도 하지 않고 넘어간다
         (겹치면 같은 태그의 상태를 서로 덮어쓴다). 잠금이 TTL로 풀리는 것은 앞 회차가 비정상 종료한 경우뿐이다. */
      'var BUSY=false;',
      dry ? '' : 'var _lk=PREV["__lock"]; if(_lk&&_lk.t&&(now-_lk.t)<' + lockTtlMs + ') BUSY=true;',
      'if(!BUSY){',
      dry ? '' : 'putState("__lock",{t:now});',
      'collect();',
      'lastSeen();',
      'TAGS.forEach(function(t){',
      '  if(!rollupOk(t.tbl)) return;', // 롤업 없으면 건너뜀 — ERR-2264로 스크립트 즉사 방지
      // 판정값 = RMS 구간의 실효값. 배치로 미리 모은 버킷에서 꺼내므로 태그마다 조회하지 않는다.
      '  var key=t.tbl+":"+t.tag, prev=PREV[key]||null;',
      /* 신호 두절 — 새 데이터가 판정 주기의 6배 넘게 안 들어왔다. 감시가 눈을 감은 상태다.
         버킷이 없어 그냥 건너뛰면 화면은 마지막 값을 들고 계속 정상으로 보인다. */
      '  var last = LAST[key]||0;',
      '  var lost = last>0 && (now-last) > ' + lostMs + ';',
      '  var wr = windowRms(WVAL[key]);',
      '  if(!wr){',
      // 값이 없으면 판정은 못 하지만, 두절이면 그 사실은 알려야 한다(상태 전환 시 1회)
      '    if(lost && !(prev&&prev.lost)){',
      '      var st=prev?{g:prev.g,since:prev.since,cand:prev.cand,candSince:prev.candSince,lastRe:prev.lastRe,b:prev.b,bb:prev.bb}:{g:0,since:now,cand:0,candSince:now,lastRe:now,b:false};',
      '      st.lost=1;',
      '      var lev={etype:"signal_lost",gi:1};',
      dry
      ? '      $.yield("evt", key, "signal_lost", GW[1], 0, 0, "");'
      : '      db.exec("insert into "+TBLP+"EVENTS values(\'"+esc(UPFX+key)+"\', to_date(\'"+dtms(now)+"\'), 0, \'signal_lost\', \'"+GW[1]+"\', 0, \'"+esc(durAgo(now-last))+" 무수신\', \'"+esc(key+":"+now+":signal_lost")+"\')");',
      '      notifyEvent(t, lev, 0, 0, durAgo(now-last)+" 무수신");',
      dry ? '' : '      putState(key, st);',
      '    }',
      '    return;',
      '  }',
      /* 존 판정과 베이스라인 판정은 서로 다른 값을 본다(앱과 동일).
         존 = ISO 10~1000 Hz (절대 기준이라 표준이 정의한 양) · 베이스라인 = 전대역 (자기 기준 대비,
         어느 주파수든 잡는 가장 넓은 그물). 여기까지 대역제한을 걸면 1 kHz 위 결함을 놓친다. */
      '  var wide = wr.rms;',
      // ISO 값(mm/s)은 ISO 존으로 판정한다 — 원본 단위 존(t.zones)에 대면 다른 물리량을 비교하게 된다
      '  var z=t.isoZones||t.zones;',
      // 베이스라인 한계는 ISO 양호 경계보다 낮을 수 있다 — 그쪽으로 알람이 날 상황이면 원본을 받아야 한다
      '  var _lim0 = baselineLimit(t.bl);',
      '  var _near = _lim0!=null && wide>_lim0;',
      '  var _iso = isoValue(t, wide, prev, key, _near);',
      /* ISO를 못 쟀으면(조회 실패·표본 부족) 등급을 직전 값으로 유지한다 — 앱과 같은 규칙.
         전대역으로 갈아타면 대역제한으로 없애려던 부풀린 값이 그대로 판정에 들어가고,
         escHold가 0이면 그 틱에 바로 알람이 나간다. 이벤트에 실을 값은 직전에 잰 ISO를 쓴다. */
      '  var _hold = !!_iso.hold;',
      '  var val = _hold ? ((prev&&prev.iso!=null)?prev.iso:wide) : _iso.v;',
      /* 등급은 결함 패턴이 켤 때만 오르고 ISO가 높이를 정한다 — 앱과 같은 규칙(patternGate).
         ISO를 독립 축으로 두면 검증 풀에서 단독 오탐 69%가 그대로 등급이 된다(게이트로 4%). */
      '  var _isoG = _hold ? (prev?(prev.g||0):0) : (val<z[0]?0:val<z[1]?1:val<z[2]?2:3);',
      '  var _pv = patValue(t, prev, key);',
      /* 판정한 태그 수를 따로 센다 — nDone은 "훑은 수"라 결함 패턴 축이 통째로 비어 있어도 줄지 않는다.
         타이머는 RUNNING·심박도 정상인데 등급이 오를 수 없는 상태를, 이 값 없이는 화면이 못 알아챈다. */
      '  if(_pv) nPat++;',
      '  var _hG = (_pv && _pv.iso!=null) ? (_pv.iso<z[0]?0:_pv.iso<z[1]?1:_pv.iso<z[2]?2:3) : _isoG;',
      /* 잴 수 있는 태그(회전수·기하 있음)인데 이번에 못 쟀으면(조회 실패·표본 부족) 판정 보류 —
         직전 등급·회차를 넘겨 거짓 복귀를 막는다. 앱과 같은 함수(calc.patternRound, patSrc 임베드). */
      '  var _pr = patternRound(_pv, !!(t.rpm && t.geo && t.geo.n), prev, _hG);',
      '  var rg = _pr.rg;',
      '  var lim = baselineLimit(t.bl);',
      '  var breach = lim!=null && wide>lim;',
      /* 계측 게이트 — 두절 확인 뒤, 진동 판정 앞. 파형이 계측 문제로 보이면 진동 판정을 멈추고
         계측 이상으로 따로 알린다. 플랫라인·DC는 롤업만으로(조회 0회), 클립·스파이크·첨도는
         원본을 받은 틱에만(isoValue가 GRAW에 담아 둔다). */
      /* 원본으로 본 계측 판정은 이번 틱에 원본을 받았을 때만 GRAW에 있다(스크립트는 매 실행
         새로 시작한다). 그대로 두면 캐시를 쓴 틱마다 "이상 없음"이 되어 지속 판정(1분)이
         영영 안 찬다. 그래서 판정 상태에 실어 나르고, 오래되면 스스로 무효가 되게 한다. */
      '  var graw = GRAW[key] || null;',
      '  if(!graw && prev && prev.gr && (now-(prev.gr.at||0)) < 60000) graw = prev.gr.v;',
      '  var bad = gateFromBuckets(WVAL[key], wide) || graw || null;',
      '  var sens = sensorTick(prev, bad, now, CFG);',
      // 대역 판정 — 설비당 1건으로 합성. 미학습·추출 미사용이면 null이라 judgeTick이 조용히 지나간다.
      // t.soft = 마운팅 상한 초과 대역(앱이 계산해 구워 보낸다) — 그 대역만 이탈하면 '주의'가 상한
      /* elat: 포락선 계열의 이탈 이력. 앱 판정과 같은 규칙이어야 두 모드가 갈리지 않는다 —
         결함 패턴은 되돌아가지 않으므로 신호가 묻혀도 유지하고, 재학습에서만 풀린다. */
      '  var bj = sens.on ? null : bandJudge(bandNow(t), t.bb, !!(prev&&prev.bb), t.soft, prev&&prev.elat, now);',
      '  var _elat = bj ? bj.latch : (prev && prev.elat);',
      /* 운전 판별 — 정지 수준이면 판정을 얼린다. 정지를 개선으로 읽으면 "복귀했습니다" 알림이
         나가고, 사람은 설비가 고쳐진 줄 안다. 기준은 학습 μ, 없으면 최근 버킷 P75(학습과 같은 방법). */
      '  var recent=(WVAL[key]||[]).map(function(x){return x.rms;});',
      '  var run = isRunning(wide, runRef(t.bl, recent));',   // 정지 여부는 주파수와 무관
      '  if(sens.on) run=false;',   // 계측을 못 믿는 동안은 판정 동결
      '  if(lost) run=false;',
      '  var res=judgeTick(prev,rg,breach,now,CFG,bj,run,_pr.cyc);',   // 회차 식별자 = 패턴을 잰 시각(보류면 직전 회차)
      '  res.next.lost = lost?1:0;',
      '  sens.events.forEach(function(e){ res.events.push(e); });',
      '  if(_elat && Object.keys(_elat).length) res.next.elat=_elat;',
      '  res.next.sf=sens.next.sf; if(sens.next.sfs!=null) res.next.sfs=sens.next.sfs; if(sens.next.sfc!=null) res.next.sfc=sens.next.sfc;',
      /* 원본을 실제로 본 틱(_iso.fresh)에만 갱신한다 — 봤는데 이상이 없으면 저장하지 않아
         그 자리에서 딱지가 떨어진다. 안 본 틱은 유효기간 안에서 직전 판정을 그대로 물려준다. */
      '  if(_iso.fresh){ if(GRAW[key]) res.next.gr={v:GRAW[key], at:now}; }',
      '  else if(prev && prev.gr && (now-(prev.gr.at||0)) < 60000) res.next.gr=prev.gr;',
      /* 상태에는 **숫자만** 남긴다 — 읽는 곳(judgeDetail)이 crest·kurt만 쓰는데 text·kind까지
         저장하면 문장 하나가 인코딩 259자를 먹는다. MONSTATE.VAL은 VARCHAR(1000)이라
         게이트가 걸린 태그(gr의 긴 한글 사유까지 실린다)에서 상한을 넘어 **잘린다** —
         잘린 값은 dec()가 null로 떨어뜨려 그 태그만 직전 상태를 영영 못 쌓는다(에러는 안 난다). */
      '  if(_iso.fresh){ if(IMP[key]) res.next.im={v:{crest:IMP[key].crest, kurt:IMP[key].kurt}, at:now}; }',
      '  else if(prev && prev.im && (now-(prev.im.at||0)) < 60000) res.next.im=prev.im;',
      // 실제로 잰 틱에만 시각을 찍는다 — 캐시·폴백값에 찍으면 TTL이 영원히 만료되지 않는다
      '  if(_iso.fresh){ res.next.iso=val; res.next.isoAt=now; } else if(prev&&prev.iso!=null){ res.next.iso=prev.iso; res.next.isoAt=prev.isoAt; }',
      /* 패턴 결과도 상태에 실어 나른다 — TQL은 매 실행 새로 시작하므로 캐시가 여기 말고는 없다.
         못 잰 틱(회전수 미입력·표본 부족)에는 직전 값을 그대로 넘겨 TTL이 살아 있게 한다. */
      '  if(_pv && _pv.fresh){ res.next.pat=_pv.on?1:0; res.next.patR=_pv.r; res.next.patK=_pv.key||""; res.next.patIso=_pv.iso; res.next.patAt=now; res.next.patW=_pv.wide?1:0;',
      /* 격자 점수를 시계열로 남긴다 — 이벤트는 "달라진 순간"만 담으므로, 확정에 못 간 단발이나
         점수가 채택선 근처에서 노는 구간은 이력 어디에도 안 남았다(감시가 뭘 봤는지 흔적이 없었다).
         대역·포락선과 같은 표에 넣어야 한 차트에 겹쳐 그린다 — 따로 두면 조회·정리 경로가 두 벌이 된다. */
      dry
        ? '    $.yield("pattern", t.tbl+":"+t.tag, _pv.r);'
        : '    try{ db.exec("insert into "+TBLP+"BAND values(\'"+esc(UPFX+t.tbl+":"+t.tag+":pattern")+"\', to_date(\'"+dtms(now)+"\'), "+(+_pv.r||0)+")"); }catch(e){}',
      '  }',
      '  else if(prev && prev.pat!=null){ res.next.pat=prev.pat; res.next.patR=prev.patR; res.next.patK=prev.patK; res.next.patIso=prev.patIso; res.next.patAt=prev.patAt; res.next.patW=prev.patW; }',
      '  var _im = IMP[key] || ((prev && prev.im && (now-(prev.im.at||0)) < 60000) ? prev.im.v : null);',
      '  res.events.forEach(function(ev){',
      /* 계측 이상만 지표값이 없다 — val/lim의 0은 자리를 비울 수 없어 넣은 값이지 측정이 아니다. */
      '    var isS = ev.etype=="sensor_fault"||ev.etype=="sensor_ok";',
      /* 이벤트 값은 설비의 원본 단위로 적는다. 속도 원본이면 등급을 정한 ISO 값·ISO 경계 그대로다.
         가속도·변위 원본이면 등급은 속도 ISO로 매기므로 원본 단위의 "기준" 숫자가 없다 —
         값은 원본 단위 구간 RMS, 기준은 비우고 근거(ISO 존·결함 패턴)를 DETAIL 머리에 말로 적는다.
         앱 판정(_judgeLive)과 같은 규칙이다. */
      '    var nat = !isS && !!t.unit && t.unit!=="mm/s";',
      '    var v2 = isS ? 0 : (nat ? wide : val);',
      '    var l2 = nat ? 0 : (ev.etype=="recovery" ? z[0] : (ev.gi>0 ? z[ev.gi-1] : z[0]));',
      '    l2 = (l2==null?0:l2);',
      /* 등급 이벤트의 사유는 앱과 같은 함수가 짓는다 — 격자 점수·부위·확정 근거에 충격성 근거를 더한다.
         _im은 원본을 본 틱의 근거이고, 못 본 틱이면 유효기간 안에서 직전 것을 쓴다(위에서 정해 둔다).
         계측 이상은 그 판정이 실은 문구를 그대로 쓴다. */
      '    var dt = isS ? (ev.detail||"") : judgeDetail(ev, _pv, _im);',
      '    if(nat) dt = "ISO "+GW[_hG]+" 구간"+(dt ? " · "+dt : "");',
      dry
        ? '    $.yield("evt", key, ev.etype, GW[ev.gi], v2, l2, dt);'
        : '    var eid=key+":"+now+":"+ev.etype;\n    db.exec("insert into "+TBLP+"EVENTS values(\'"+esc(UPFX+key)+"\', to_date(\'"+dtms(now)+"\'), "+v2+", \'"+ev.etype+"\', \'"+GW[ev.gi]+"\', "+l2+", \'"+esc(dt)+"\', \'"+esc(eid)+"\')");',
      '    notifyEvent(t, ev, v2, nat ? null : l2, dt);', // 라우팅에 걸리면 발송 — 기준 숫자가 없는 행은 근거를 말로 붙인다
      '  });',
      dry
        ? '  $.yield("state", key, enc(res.next));'
        : '  putState(key, res.next);',
      '  nDone++;',
      '});',
      // 전 태그를 다 본 뒤가 "같은 순간"의 경계다 — 여기서 묶어 보낸다
      'flushNotify(now);',
      dry ? 'if(NFERR) $.yield("nferr", NFERR.m, NFERR.n);'
        : 'if(NFERR) putState("__nferr", NFERR); else if(NFOK && PREV.__nferr && PREV.__nferr.t) putState("__nferr",{t:0});',
      /* 심박 — 이번 실행이 언제, 몇 개를 판정했는지 한 행에 남긴다.
         타이머 상태만 보면 "RUNNING인데 실제로는 아무것도 안 하는" 경우를 놓친다
         (감시 대상 태그의 데이터가 끊기면 전부 건너뛰어 nDone=0이 된다).
         새 테이블을 만들지 않으려고 MONSTATE에 예약 키로 넣는다 — 태그 키와 겹치지 않는다. */
      /* 회차 소요도 남긴다 — 감시 대상 상한을 상수로 짐작하는 대신, 그 설치에서 한 회차가
         실제로 얼마나 걸리는지를 보고 판단하게 한다. 주기에 근접하면 회차가 겹치기 시작한다
         (그때 무슨 일이 나는지가 이 잠금이 생긴 이유다). */
      dry ? '' : 'putState("__hb",{t:now,n:nDone,pat:nPat,ms:Date.now()-now});',
      dry ? '' : 'putState("__lock",{t:0});',   // 해제 — 다음 회차가 바로 이어받는다
      '$.yield("done", now, nDone);',
      '} else { $.yield("skip", now, 0); }',
      /* 실패해도 다음 회차는 정상으로 돌아온다. 잠금은 반드시 푼다 — 안 풀면 TTL 이 지날 때까지
         모든 회차가 BUSY 로 건너뛴다. 사유는 심박 옆에 남겨 앱이 배너로 보여준다. */
      '} catch(e) {',
      '  try { putState("__lock",{t:0}); } catch(e2) {}',
      '  try { putState("__err",{t:Date.now(),m:String(e).slice(0,300)}); } catch(e2) {}',
      '  $.yield("error", Date.now(), 0);',
      '}',
      '})',
      'CSV()',
    ];
    return body.join('\n');
  }

  return { buildMonitorTql: buildMonitorTql, validateSpec: validateSpec };
});
