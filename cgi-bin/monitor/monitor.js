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

  // spec: { judgeSrc(judgeTick 소스문자열), limitSrc(baselineLimit 소스문자열 — 클램프 포함),
  //         winSrc(windowRms 소스 — 구간 RMS), winMs(RMS 구간 길이 ms),
  //         bandSrc(bandJudgeSrc() — 상수 포함 자체 완결형), bandWinMs(대역값 룩백, 기본 2h),
  //         patSrc(patSrc() — 포락선·격자 자체 완결형), patTtlMs(패턴 재계산 최소 간격, 기본 10분),
  //         tags:[{tbl,tag,alias,unit,zones:[z0,z1,z2],bl:{mu,sigma,k}|null,bb:{sub:{mu,sigma,k},...}|null}],
  //         cfg:{escHold,recHold,reno:{1,2,3}}(ms), secWinNs(최신 sec 버킷 조회 룩백, 기본 10s),
  //         notify:{src(notify.serverSrc()), cfg:{channels,routes}}, dryRun }
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
      spec.patSrc || 'var patternGate = function(p,i){return p?Math.max(1,i||0):0;}; var envelopeSpectrum=function(){return{freqs:[],mags:[]};}; var targetedMatch=function(){return null;}; var bearingFreqs=function(){return null;}; var envMaxFor=function(){return 500;}; var demodFixed=function(){return null;};',
      spec.winSrc ? 'var windowRms = ' + spec.winSrc + ';' : 'var windowRms = function(){return null;};',
      spec.runSrc ? 'var isRunning = ' + spec.runSrc + ';' : 'var isRunning = function(){return true;};',
      spec.isoSrc || 'var isoRms = function(){return null;}; var isoNeeded = function(){return false;}; var isoSkippable = function(){return false;};',
      spec.gateSrc || 'var gateFromBuckets = function(){return null;}; var gateFromRaw = function(){return null;}; var sensorTick = function(p,b,n,c){return {on:false,next:{},events:[]};};',
      spec.refSrc ? 'var runRef = ' + spec.refSrc + ';' : 'var runRef = function(){return 0;};',
      spec.notify && spec.notify.src ? spec.notify.src : 'function eventMessage(){return{}} function shouldNotify(){return true}',
    ];
    // 각 함수를 한 번씩 실제로 호출한다 — 선언만 해서는 몸통 안 자유 식별자가 드러나지 않는다
    var probe = decls.concat([
      'judgeTick(null, 1, false, 0, { escHold: 0, recHold: 0, reno: {} }, null, true);',
      'baselineLimit({ mu: 1, sigma: 0.1, k: 3 });',
      'windowRms([{ rms: 1, cnt: 10 }, { rms: 1, cnt: 10 }]);',
      'bandJudge({ one: 1 }, { one: { mu: 0.5, sigma: 0.01, k: 3 } }, false);',
      'isRunning(1, runRef({ mu: 1, sigma: 0.1, k: 3 }, [1, 1]));',
      'isoNeeded(25600); isoRms([1,2,3,4,5,6,7,8], 25600); isoSkippable([{rms:1,cnt:10}], 1.12);',
      'gateFromBuckets([{cnt:10,rms:1,sum:0,mn:-1,mx:1}], 1); sensorTick(null, null, 0, { escHold: 0, recHold: 0 });',
      'var _e = { etype: "threshold", tag: "T", grade: "위험", val: 1, lim: 1, ts: 0, tbl: "T" };',
      'eventMessage(_e); shouldNotify(_e, { channels: {}, routes: {} });',
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
    var patTtlMs = spec.patTtlMs || 600000;   // 패턴 재계산 최소 간격 — 대역 추출과 같은 10분
    var isoWinMs = spec.isoWinMs || 1000;
    var refSrc = spec.refSrc || '';
    var tickMs = spec.tickMs || 10000;          // 판정 주기 — 두절 기준(6배)의 근거
    var lostMs = Math.max(60000, tickMs * 6);
    /* 중복 실행 잠금의 만료 — 정상 회차는 끝에서 스스로 푸므로, 이 값은 "앞 회차가 죽어서
       잠금이 남았을 때 언제 무시하고 재개할까"만 정한다. 짧으면 느린 회차를 죽은 것으로
       오인해 다시 겹치고, 길면 복구가 늦다. 두절 기준과 같은 눈금을 쓴다. */
    var lockTtlMs = Math.max(60000, tickMs * 6);
    var secWinNs = spec.secWinNs || 10000000000; // (구버전 호환 — 미사용)
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
      // var에 대입해 두는 이유: 빌드 미니파이로 함수명이 바뀌어도(judgeTick→ie) 호출측 이름이 유지된다
      'var judgeTick = ' + judgeSrc + ';', // 순수 judgeTick(prev,rg,breach,now,cfg,bandState) — 앱과 동일 소스
      'var baselineLimit = ' + limitSrc + ';', // 베이스라인 한계식(클램프 포함) — 앱과 동일 소스
      bandSrc ? 'var bandJudge = ' + bandSrc + ';' : 'var bandJudge = function(){return null;};',
      /* 결함 패턴 — 등급을 켜는 축이라 서버에서도 같은 소스를 돌려야 앱과 갈리지 않는다.
         goja가 느려서(16k 표본 855 ms) 25회전 창을 쓰고 patTtlMs(기본 10분)로 재계산을 막는다. */
      spec.patSrc || 'var patternGate = function(p,i){return p?Math.max(1,i||0):0;}; var envelopeSpectrum=function(){return{freqs:[],mags:[]};}; var targetedMatch=function(){return null;}; var bearingFreqs=function(){return null;}; var envMaxFor=function(){return 500;}; var demodFixed=function(){return null;};',
      winSrc ? 'var windowRms = ' + winSrc + ';' : 'var windowRms = function(b){ if(!b||!b.length) return null; var ss=0,n=0; for(var i=0;i<b.length;i++){ ss+=b[i].rms*b[i].rms*b[i].cnt; n+=b[i].cnt; } return n?{rms:Math.sqrt(ss/n)}:null; };',
      runSrc ? 'var isRunning = ' + runSrc + ';' : 'var isRunning = function(){return true;};',
      refSrc ? 'var runRef = ' + refSrc + ';' : 'var runRef = function(){return 0;};',
      isoSrc || 'var isoRms = function(){return null;}; var isoNeeded = function(){return false;}; var isoSkippable = function(){return false;};',
      gateSrc || 'var gateFromBuckets = function(){return null;}; var gateFromRaw = function(){return null;}; var sensorTick = function(p,b,n,c){return {on:false,next:{},events:[]};};',
      'function enc(o){return encodeURIComponent(JSON.stringify(o)).replace(/\'/g,"%27");}',
      'function dec(s){try{return JSON.parse(decodeURIComponent(s));}catch(e){return null;}}',
      'function esc(s){return String(s).replace(/\'/g,"\'\'");}',
      'var GW=["\\uC591\\uD638","\\uC8FC\\uC758","\\uC704\\uD5D8","\\uC2EC\\uAC01"];', // 양호/주의/위험/심각
      'var db=$.db(), now=Date.now(), nDone=0, roll={};',
      'function rollupOk(tbl){ if(roll[tbl]===undefined){ var n=0; db.query("select count(*) from M$SYS_TABLES where NAME like \'_"+tbl+"_ROLLUP_%\'").forEach(function(r){n=r[0];}); roll[tbl]=n>0; } return roll[tbl]; }',
      'var CFG=' + JSON.stringify(cfg) + ';',
      'var TAGS=' + JSON.stringify(tags) + ';',
      // ── 알림 발송 (앱과 동일한 notify 소스를 인라인) ──
      nf ? nf.src : '',
      'var NOTIFY=' + JSON.stringify(nf ? (nf.cfg || {}) : {}) + ';',
      'var TYPEKO=' + JSON.stringify({ threshold: '임계 초과', sustained: '상태 지속', recovery: '정상 복귀', improve: '상태 개선', signal_lost: '신호 두절', sensor_fault: '계측 이상', sensor_ok: '계측 복귀', baseline: '베이스라인 이탈', band: '대역 이탈', bandrec: '대역 복귀' }) + ';',
      'var BORDER=' + JSON.stringify(spec.bandOrder || ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4']) + ';',
      /* 대역 추출 타이머가 적재한 최신 대역값을 읽는다. 5개 대역이 같은 시각에 한 묶음으로
         들어가므로 TIME 역순 몇 줄이면 전부 잡힌다(이름별 첫 등장만 취함).
         NEO_VIBE_BAND가 아직 없을 수 있어(추출 미사용) try로 감싼다 — 없으면 대역 판정만 건너뛴다. */
      'function bandNow(t){',
      '  if(!t.bb) return null;',
      '  var pre=t.tbl+":"+t.tag+":", ns=[];',
      '  for(var i=0;i<BORDER.length;i++) ns.push("\'"+esc(pre+BORDER[i])+"\'");',
      '  var out=null;',
      '  try{',
      '    db.query("select NAME, VALUE from NEO_VIBE_BAND where NAME in ("+ns.join(",")+") and TIME between '
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
      'function isoValue(t, wide, prev, key, near){',
      '  if(!isoNeeded(t.fs)) return {v:wide, fresh:false};',
      '  if(isoSkippable(WVAL[key], t.zones[0]) && !near) return {v:wide, fresh:false};',
      '  if(prev && prev.iso!=null && (now-(prev.isoAt||0)) < ' + isoTtlMs + ') return {v:prev.iso, fresh:false};',
      '  var end = LAST[key]||now, vals=[];',
      '  try{ db.query("select VALUE from "+t.tbl+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dtms(end-' + isoWinMs + ')+"\') and to_date(\'"+dtms(end)+"\') order by TIME")',
      '    .forEach(function(r){ vals.push(+r[0]); }); }catch(e){ return {v:wide, fresh:false, hold:true}; }',
      '  var g = gateFromRaw(vals, t.fs); if(g) GRAW[key]=g; else delete GRAW[key];',
      '  var im = impactEvidence(vals, t.fs); if(im) IMP[key]=im; else delete IMP[key];',
      '  var v = isoRms(vals, t.fs);',
      '  return v==null ? {v:wide, fresh:false, hold:true} : {v:v, fresh:true};',
      '}',
      /* 결함 패턴 — 25회전 원시 파형 → 포락선 → 결함주파수 격자. 등급을 켜는 축이다.
         patTtlMs(기본 10분) 안이면 직전 값을 그대로 쓴다 — 판정은 10초마다 도는데 포락선은
         태그당 수백 ms라 매 틱 돌릴 수 없다. 베어링 열화는 며칠 단위라 10분이면 충분하고,
         급변은 ISO·베이스라인 축이 10초로 따로 본다.
         회전수·기하가 없거나 샘플레이트가 낮아 고정 대역이 안 서면 null — 그건 "정상"이 아니라
         "판정 못 함"이고, 등급이 안 오르는 대신 커버리지가 화면에 드러낸다. */
      'function patValue(t, prev, key){',
      '  if(prev && prev.pat!=null && (now-(prev.patAt||0)) < ' + patTtlMs + ') return {on:!!prev.pat, r:prev.patR, iso:prev.patIso, cached:true};',
      '  if(!t.rpm || !t.geo || !t.geo.n) return null;',
      '  var fr = t.rpm/60; if(!(fr>0)) return null;',
      '  var band = demodFixed(t.fs); if(!band) return null;',
      '  var bf = bearingFreqs(t.rpm, t.geo); if(!bf) return null;',
      '  var secs = Math.min(22, MON_REV/fr), end = LAST[key]||now, vals=[];',
      '  try{ db.query("select VALUE from "+t.tbl+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dtms(end-Math.round(secs*1000))+"\') and to_date(\'"+dtms(end)+"\') order by TIME")',
      '    .forEach(function(r){ vals.push(+r[0]); }); }catch(e){ return null; }',
      '  if(vals.length < 4096) return null;',
      '  var env = envelopeSpectrum(vals, t.fs, envMaxFor(bf, fr, t.fs), band);',
      '  var m = targetedMatch(env, bf, fr, env.resTrue||env.res);',
      '  var r2 = m ? (m.r||0) : 0;',
      /* 등급 높이를 정할 ISO도 같은 파형에서 잰다 — 10초 축 값을 쓰면 등급이 10초마다 움직여
         10분 주기인 패턴과 시간축이 어긋난다. 한 등급은 한 시점에서 나와야 한다. */
      '  var _iv = null; try{ _iv = isoRms(vals, t.fs); }catch(e){}',
      '  return {on: r2 >= MON_ADOPT, r: r2, iso: _iv, fresh:true};',
      '}',
      // 화면의 durKo와 같은 규칙 — 같은 사건을 이벤트와 화면이 다르게 적으면 같은 것인지 알 수 없다
      'function durAgo(ms){ if(ms<60000) return Math.round(ms/1000)+"초";'
      + ' if(ms<3600000){ var m=Math.round(ms/60000); return m>=60?"1시간":m+"분"; }'
      + ' if(ms<86400000){ var h=Math.floor(ms/3600000), hm=Math.round((ms%3600000)/60000); if(hm===60){h++;hm=0;} return h+"시간"+(hm?" "+hm+"분":""); }'
      + ' var d=Math.floor(ms/86400000), dh=Math.round((ms%86400000)/3600000); if(dh===24){d++;dh=0;} return d+"일"+(dh?" "+dh+"시간":""); }',
      'function fmtTs(ms){ var d=new Date(ms); function p(n){return (n<10?"0":"")+n;} return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }',
      'function notifyEvent(t, ev, v, l, d){',
      '  if(!NOTIFY.channels) return;',
      '  var gradeKo=GW[ev.gi];',
      '  if(!shouldNotify(gradeKo, ev.etype, "webhook", NOTIFY)) return;',
      '  var to=NOTIFY.channels.webhook.to;',
      '  var msg=eventMessage({alias:t.alias||t.tag, tag:t.tag, table:t.tbl, typeKo:TYPEKO[ev.etype]||ev.etype, gradeKo:gradeKo, etype:ev.etype, detail:d||"", val:v, lim:l, unit:t.unit||"", timeText:fmtTs(now)});',
      dry
        ? '  $.yield("notify", t.tbl+":"+t.tag, ev.etype, gradeKo);'
        : '  try{ $.request(to,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payloadFor(msg,to))}).do(function(r){}); }catch(e){}',
      '}',
      /* 판정값 일괄 수집 — 테이블당 한 번의 NAME IN 조회로 전 태그의 구간 버킷을 받는다(태그별 개별 조회보다 훨씬 싸다). */
      'var WVAL={};',
      'function collect(){',
      '  var byTbl={};',
      '  TAGS.forEach(function(t){ if(rollupOk(t.tbl)) (byTbl[t.tbl]=byTbl[t.tbl]||[]).push(t.tag); });',
      '  Object.keys(byTbl).forEach(function(tbl){',
      '    var ns=byTbl[tbl].map(function(x){return "\'"+esc(x)+"\'";}).join(",");',
      '    var q="select NAME, ROLLUP(\'sec\',1,TIME) rt, SUMSQ(VALUE) ss, COUNT(VALUE) cnt, SUM(VALUE) sm, MIN(VALUE) mnv, MAX(VALUE) mxv from "+tbl',
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
      '    try{ db.query("select NAME, MAX_TIME from V$"+tbl+"_STAT where NAME in ("+ns+")").forEach(function(r){',
      '      LAST[tbl+":"+String(r[0])]=tms(r[1]); }); }catch(e){}',
      '  });',
      '}',
      /* 직전 판정 상태를 한 번에 읽는다 — 태그마다 점조회를 하면 회차가 주기를 넘긴다.
         HAD는 "그 키의 행이 이미 있었나" — putState의 insert/update 선택 근거(존재 확인 조회 생략). */
      'var PREV={}, HAD={};',
      'function loadPrev(){',
      // 예약키(__lock/__hb)도 같이 읽는다 — 이들도 putState로 쓰므로 존재 여부를 알아야 한다
      '  var ks=TAGS.map(function(t){ return "\'"+esc(t.tbl+":"+t.tag)+"\'"; }).concat(["\'__lock\'","\'__hb\'"]).join(",");',
      '  try{ db.query("select K, VAL from NEO_VIBE_MONSTATE where K in ("+ks+")").forEach(function(r){',
      '    var k=String(r[0]); HAD[k]=1; PREV[k]=dec(r[1]); }); }catch(e){}',
      '}',
      /* 상태 쓰기 — update 우선(delete+insert는 회차가 겹치면 unique index 충돌로 스크립트가 죽는다).
         한 태그의 쓰기 실패가 나머지 태그의 감시를 멈추게 두지 않는다. */
      'function putState(k, o){',
      '  try{',
      '    var v=enc(o);',
      '    if(HAD[k]) db.exec("update NEO_VIBE_MONSTATE set VAL=\'"+v+"\' where K=\'"+esc(k)+"\'");',
      '    else { db.exec("insert into NEO_VIBE_MONSTATE values(\'"+esc(k)+"\',\'"+v+"\')"); HAD[k]=1; }',
      '  }catch(e){}',
      '}',
      'loadPrev();',
      /* 상호 감시 — 대역 추출이 멎었으면 여기서 다시 켠다. 잠금 검사보다 앞에 둔다:
         이번 회차를 통째로 건너뛰더라도 상대의 생사는 봐야 한다. */
      (!dry && spec.wd) ? WD.wdSrc(spec.wd).join('\n') : '',
      (!dry && spec.wd) ? 'var _wd=wdTick(db);' : '',
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
      : '      db.exec("insert into NEO_VIBE_EVENTS values(\'"+esc(key)+"\', to_date(\'"+dtms(now)+"\'), 0, \'signal_lost\', \'"+GW[1]+"\', 0, \'"+esc(durAgo(now-last))+" 무수신\', \'"+esc(key+":"+now+":signal_lost")+"\')");',
      '      notifyEvent(t, lev, 0, 0, durAgo(now-last)+" 무수신");',
      dry ? '' : '      putState(key, st);',
      '    }',
      '    return;',
      '  }',
      /* 존 판정과 베이스라인 판정은 서로 다른 값을 본다(앱과 동일).
         존 = ISO 10~1000 Hz (절대 기준이라 표준이 정의한 양) · 베이스라인 = 전대역 (자기 기준 대비,
         어느 주파수든 잡는 가장 넓은 그물). 여기까지 대역제한을 걸면 1 kHz 위 결함을 놓친다. */
      '  var wide = wr.rms;',
      '  var z=t.zones;',
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
      '  var _hG = (_pv && _pv.iso!=null) ? (_pv.iso<z[0]?0:_pv.iso<z[1]?1:_pv.iso<z[2]?2:3) : _isoG;',
      '  var rg = patternGate(!!(_pv && _pv.on), _hG);',
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
      '  var res=judgeTick(prev,rg,breach,now,CFG,bj,run);',
      '  res.next.lost = lost?1:0;',
      '  sens.events.forEach(function(e){ res.events.push(e); });',
      '  if(_elat && Object.keys(_elat).length) res.next.elat=_elat;',
      '  res.next.sf=sens.next.sf; if(sens.next.sfs!=null) res.next.sfs=sens.next.sfs; if(sens.next.sfc!=null) res.next.sfc=sens.next.sfc;',
      /* 원본을 실제로 본 틱(_iso.fresh)에만 갱신한다 — 봤는데 이상이 없으면 저장하지 않아
         그 자리에서 딱지가 떨어진다. 안 본 틱은 유효기간 안에서 직전 판정을 그대로 물려준다. */
      '  if(_iso.fresh){ if(GRAW[key]) res.next.gr={v:GRAW[key], at:now}; }',
      '  else if(prev && prev.gr && (now-(prev.gr.at||0)) < 60000) res.next.gr=prev.gr;',
      '  if(_iso.fresh){ if(IMP[key]) res.next.im={v:IMP[key], at:now}; }',
      '  else if(prev && prev.im && (now-(prev.im.at||0)) < 60000) res.next.im=prev.im;',
      // 실제로 잰 틱에만 시각을 찍는다 — 캐시·폴백값에 찍으면 TTL이 영원히 만료되지 않는다
      '  if(_iso.fresh){ res.next.iso=val; res.next.isoAt=now; } else if(prev&&prev.iso!=null){ res.next.iso=prev.iso; res.next.isoAt=prev.isoAt; }',
      /* 패턴 결과도 상태에 실어 나른다 — TQL은 매 실행 새로 시작하므로 캐시가 여기 말고는 없다.
         못 잰 틱(회전수 미입력·표본 부족)에는 직전 값을 그대로 넘겨 TTL이 살아 있게 한다. */
      '  if(_pv && _pv.fresh){ res.next.pat=_pv.on?1:0; res.next.patR=_pv.r; res.next.patIso=_pv.iso; res.next.patAt=now; }',
      '  else if(prev && prev.pat!=null){ res.next.pat=prev.pat; res.next.patR=prev.patR; res.next.patIso=prev.patIso; res.next.patAt=prev.patAt; }',
      '  var _im = IMP[key] || ((prev && prev.im && (now-(prev.im.at||0)) < 60000) ? prev.im.v : null);',
      '  res.events.forEach(function(ev){',
      // 대역 이벤트는 값이 "한계 대비 배수"라 단위가 다르다 — val=배수, lim=1(=한계). 앱과 동일.
      '    var isB = ev.etype=="band"||ev.etype=="bandrec";',
      '    var isS = ev.etype=="sensor_fault"||ev.etype=="sensor_ok";',
      '    var v2 = isB ? (bj?bj.maxR:0) : isS ? 0 : (ev.etype=="baseline" ? wide : val);',
      '    var l2 = isB ? 1 : (ev.etype=="baseline"?lim:(ev.etype=="recovery"?z[0]:(ev.gi>0?z[ev.gi-1]:z[0])));',
      '    l2 = (l2==null?0:l2);',
      /* 대역·베이스라인 이벤트에 충격성 근거를 덧붙인다 — 같은 에너지 상승이라도 임펄스인지
         광대역 잡음인지에 따라 볼 곳이 다르다(베어링·기어 vs 유동·부착 이완).
         원본을 못 본 틱이면 직전 근거를 유효기간 안에서 쓴다. */
      '    var _imTxt = _im ? _im.text : "";',
      '    var dt = ev.etype=="band" ? [(bj?bj.detail:""), _imTxt].filter(function(x){return !!x;}).join(" · ")',
      '      : ev.etype=="baseline" ? _imTxt : (isS ? (ev.detail||"") : "");',
      dry
        ? '    $.yield("evt", key, ev.etype, GW[ev.gi], v2, l2, dt);'
        : '    var eid=key+":"+now+":"+ev.etype;\n    db.exec("insert into NEO_VIBE_EVENTS values(\'"+esc(key)+"\', to_date(\'"+dtms(now)+"\'), "+v2+", \'"+ev.etype+"\', \'"+GW[ev.gi]+"\', "+l2+", \'"+esc(dt)+"\', \'"+esc(eid)+"\')");',
      '    notifyEvent(t, ev, v2, l2, dt);', // 라우팅에 걸리면 발송(서버는 임계·베이스라인 모두 같은 sec버킷 RMS 사용)
      '  });',
      dry
        ? '  $.yield("state", key, enc(res.next));'
        : '  putState(key, res.next);',
      '  nDone++;',
      '});',
      /* 심박 — 이번 실행이 언제, 몇 개를 판정했는지 한 행에 남긴다.
         타이머 상태만 보면 "RUNNING인데 실제로는 아무것도 안 하는" 경우를 놓친다
         (감시 대상 태그의 데이터가 끊기면 전부 건너뛰어 nDone=0이 된다).
         새 테이블을 만들지 않으려고 MONSTATE에 예약 키로 넣는다 — 태그 키와 겹치지 않는다. */
      /* 회차 소요도 남긴다 — 감시 대상 상한을 상수로 짐작하는 대신, 그 설치에서 한 회차가
         실제로 얼마나 걸리는지를 보고 판단하게 한다. 주기에 근접하면 회차가 겹치기 시작한다
         (그때 무슨 일이 나는지가 이 잠금이 생긴 이유다). */
      dry ? '' : 'putState("__hb",{t:now,n:nDone,ms:Date.now()-now});',
      dry ? '' : 'putState("__lock",{t:0});',   // 해제 — 다음 회차가 바로 이어받는다
      '$.yield("done", now, nDone);',
      '} else { $.yield("skip", now, 0); }',
      '})',
      'CSV()',
    ];
    return body.join('\n');
  }

  return { buildMonitorTql: buildMonitorTql, validateSpec: validateSpec };
});
