// monitor/monitor.js — 서버 상시감시 판정 TQL 생성기
// 앱이 설정을 자체 완결형 .tql로 컴파일·저장 → Neo 타이머가 주기 실행(앱 없이도 감시)
// 판정 함수는 앱 소스를 그대로 임베드(규칙 동일). 롤업 없는 테이블은 SCRIPT 안에서 사전 판별해 건너뜀
// (타이머 컨텍스트는 SQL 오류 하나가 스크립트 전체를 중단)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(
    typeof require === 'function' ? require('./watchdog.js') : root.VibeWatchdog);
  else root.VibeMonitor = factory(root.VibeWatchdog);
})(typeof self !== 'undefined' ? self : this, function (WD) {
  'use strict';

  // convSrc 미지정 시 폴백 — 단위 변환 없음, 대역 RMS는 isoRms로 대체
  var CONV_FALLBACK = 'var convertDomain = function(v){ return v.slice(0); };'
    + ' var bandRmsAveraged = function(v, fs){ return { rms: isoRms(v, fs) }; };';

  // spec — 앱 _monSpec()이 만듦
  // · 임베드 소스(앱과 같은 함수): judgeSrc(judgeTick) · limitSrc(baselineLimit, 클램프 포함) · winSrc(windowRms)
  //   · runSrc(isRunning, 정지 판별) · refSrc(runRef, 운전 기준값) · detailSrc(judgeDetail, 이벤트 사유 문구)
  //   · isoSrc(isoRms·isoNeeded·isoSkippable) · convSrc(속도 변환·ISO 대역 평균) · gateSrc(계측 게이트)
  //   · bandSrc(bandJudge, 자체 완결형) · patSrc(포락선·결함 격자, 자체 완결형)
  // · 주기(ms): tickMs 판정 주기(두절·잠금 만료 = 6배) · winMs RMS 구간 · lagMs 구간 끝 적재 여유
  //   · isoWinMs ISO 원본 창 · isoTtlMs ISO 재측정 간격 · isoQuietMs 조용할 때 ISO 재측정 간격
  //   · patTtlMs 패턴 재계산 간격 · bandWinMs 대역값 룩백
  // · 저장소: tblPrefix 공용 표 접두(전용 DB SYS 스키마) · keyPrefix 행 키 계정 접두 · srcMap 데이터 표 이름 → 조회용 수식 이름
  // · bandOrder: 대역 계열 목록(calc BAND_ORDER)
  // · tags: [{tbl, tag, alias, unit, fs, rpm, geo(구름체 기하|null), soft(마운팅 상한 초과 대역),
  //           zones(원본 단위 존), isoZones(mm/s 존 — ISO 등급용), bl(RMS 베이스라인|null), bb(대역 베이스라인|null)}]
  // · cfg: {escHold, recHold, reno:{1,2,3}}(ms)
  // · tzOffsetMin: 알림 문구 시각의 표시 시간대 UTC 오프셋(분, 앱이 구울 때 값). 없으면 서버 시간
  // · notify: {src(notify.serverSrc()), cfgTable(계정 설정 표), defs(라우팅 기본값), cfg(dryRun 전용 발송 설정)}
  // · dryRun
  // 발송 설정(웹훅 URL)은 스크립트에 싣지 않음 — 파일 API는 계정 격리가 없어 발송 회차에 cfgTable에서 읽음
  // dryRun=true면 INSERT/UPSERT/발송 대신 $.yield로 결정만 방출(테스트용)
  /* 임베드 소스가 TQL에서 실제로 도는지 등록 전 확인 — 바깥 이름 참조는 타이머 첫 실행에서 ReferenceError.
     new Function은 전역 스코프만 봐 TQL과 같은 조건 */
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
    // 각 함수를 한 번씩 호출 — 선언만으론 몸통 안 자유 식별자가 안 드러남
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
      'judgeDetail({ etype: "recovery", epMs: 1000 }, { r: 4, key: "BPFO" }, { crest: 9, kurt: 5 });',
      'var _e = { etype: "threshold", tag: "T", grade: "위험", val: 1, lim: 1, ts: 0, tbl: "T" };',
      'eventMessage(_e); shouldNotify(_e, { channels: {}, routes: {} });',
      'notifyCfgFrom(configFromRows([["cfg:monitor#0", "%7B%7D"]], "monitor").obj, { order: ["x"], timing: { x: "y" } });',
    ]).join('\n');
    try { new Function(probe)(); return null; } catch (e) { return e.message || String(e); }
  }

  function buildMonitorTql(spec) {
    spec = spec || {};
    var judgeSrc = spec.judgeSrc || '';
    // limitSrc 미지정 시 폴백(클램프 없음)
    var limitSrc = spec.limitSrc || 'function(bl){return bl?bl.mu+(bl.k||3)*bl.sigma:null;}';
    // RMS 구간 — 판정값은 구간 전체의 실효값 하나(앱과 같은 규칙)
    var winMs = spec.winMs || 10000;
    // 구간 끝 버킷은 적재 중이라 표본이 적음 — 여유를 두고 조회, windowRms가 거름
    var lagMs = spec.lagMs || 4000;
    var winSrc = spec.winSrc || '';
    // 정지 판별(앱과 같은 함수) — 없으면 정지를 개선으로 읽어 복귀 알림
    var runSrc = spec.runSrc || '';
    /* ISO 대역제한(10~1000 Hz) RMS — 비용이 커서 전대역이 양호 경계 미만이면 생략(ISO ≤ 전대역).
       잰 값은 판정 상태에 담아 재사용 */
    var isoSrc = spec.isoSrc || '';
    var gateSrc = spec.gateSrc || '';   // 계측 게이트 — 파형이 기계 신호인지 계측 문제인지 판별
    var isoTtlMs = spec.isoTtlMs || 30000;
    // 비속도 원본 태그가 조용할 때(원본 단위 양호 경계 미만)의 ISO 재측정 간격 — 앱 ISO_TTL_QUIET_MS와 같음
    var isoQuietMs = spec.isoQuietMs || 300000;
    var convSrc = spec.convSrc || '';
    var patTtlMs = spec.patTtlMs || 600000;   // 패턴 재계산 최소 간격
    var isoWinMs = spec.isoWinMs || 1000;
    var refSrc = spec.refSrc || '';
    var tickMs = spec.tickMs || 10000;          // 판정 주기 — 두절 기준은 6배
    var lostMs = Math.max(60000, tickMs * 6);
    // 중복 실행 잠금 만료 — 앞 회차가 비정상 종료해 남은 잠금을 무시할 시점(정상 회차는 끝에서 해제)
    var lockTtlMs = Math.max(60000, tickMs * 6);
    // 대역값 룩백 — 별도 타이머가 주기적으로 적재하므로 추출 주기의 몇 배
    var bandWinMs = spec.bandWinMs || 7200000; // 2시간
    var bandSrc = spec.bandSrc || '';
    var cfg = spec.cfg || { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 3600000, 3: 1800000 } };
    var tags = spec.tags || [];
    var dry = !!spec.dryRun;
    var nf = spec.notify || null;

    var body = [
      'SCRIPT({',
      // 표 접두 TBLP(전용 DB의 SYS 스키마)·행 키 접두 UPFX(계정) — 키 조립 때 붙이고 읽을 때 뗌
      'var TBLP=' + JSON.stringify(spec.tblPrefix || '') + ';',
      'var UPFX=' + JSON.stringify(spec.keyPrefix || '') + ';',
      /* 데이터 표 수식 이름 대응표 — 비-SYS 타이머는 접두 없는 이름이 조용히 0건.
         키는 짧은 이름, 조회 때만 수식 */
      'var SRC=' + JSON.stringify(spec.srcMap || {}) + ';',
      'function srcOf(t){ return SRC[t]||t; }',
      'function statOf(t){ var s=srcOf(t), i=s.lastIndexOf("."); return i<0 ? "V$"+s+"_STAT" : s.slice(0,i+1)+"V$"+s.slice(i+1)+"_STAT"; }',
      // var 대입 — 미니파이로 함수명이 바뀌어도 호출 이름 유지
      'var judgeTick = ' + judgeSrc + ';', // judgeTick — 앱과 동일 소스
      'var baselineLimit = ' + limitSrc + ';', // 베이스라인 한계식(클램프 포함) — 앱과 동일 소스
      bandSrc ? 'var bandJudge = ' + bandSrc + ';' : 'var bandJudge = function(){return null;};',
      // 결함 패턴(등급을 켜는 축) — 앱과 같은 소스. goja가 느려 patTtlMs로 재계산 간격 제한
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
      // 회차 전체를 try로 감쌈 — Neo 타이머는 예외 한 번에 STOP, 재시도 없음
      'try {',
      'var db=$.db(), now=Date.now(), nDone=0, nPat=0, roll={};',
      // 회차 상태 기록(errAdd·stPut) — 대역 타이머와 같은 조각
      WD.statusSrc(),
      /* 롤업 사용 가능 여부 — 실제 쿼리로 판단(내부 롤업 객체는 소유자 것이라
         GRANT 받은 계정의 카탈로그엔 안 보임) */
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
      /* 발송 설정은 보낼 알림이 생긴 회차에만 계정 설정 표에서 읽고 회차 내 재사용.
         dryRun은 주입 설정 사용 */
      'var NFON=' + (nf ? 'true' : 'false') + ';',
      'var NOTIFY=' + (dry && nf && nf.cfg ? JSON.stringify(nf.cfg) : 'null') + ';',
      'var NFSRC=' + JSON.stringify({ table: (nf && nf.cfgTable) || '', defs: (nf && nf.defs) || {} }) + ';',
      'var NFERR=null, NFOK=false;',
      'function loadNotify(){',
      '  if(NOTIFY) return {cfg:NOTIFY, err:""};',
      '  if(!NFSRC.table) return {cfg:null, err:"설정 표 위치가 없습니다"};',
      '  var rows=[];',
      // 접두는 LIKE 대신 범위 — LOOKUP 표는 접두 LIKE가 0건(sql.js mine 참조)
      '  try{ db.query("select K, VAL from "+NFSRC.table+" where K >= \'cfg:monitor#\' and K < \'cfg:monitor$\'").forEach(function(r){ rows.push([r[0], r[1]]); }); }',
      '  catch(e){ return {cfg:null, err:"설정 조회 실패: "+String(e).slice(0,160)}; }',
      '  var c=configFromRows(rows, "monitor");',
      '  if(c.err) return {cfg:null, err:c.err};',
      '  NOTIFY=notifyCfgFrom(c.obj, NFSRC.defs);',
      '  return {cfg:NOTIFY, err:""};',
      '}',
      // ⚠ 앱 TYPEKO(app.js)와 키 일치 필요 — 빠진 키는 영문 코드가 그대로 노출
      'var TYPEKO=' + JSON.stringify({ observe: '관찰', threshold: '임계 초과', sustained: '상태 지속', recovery: '정상 복귀', improve: '상태 개선', signal_lost: '신호 두절', sensor_fault: '계측 이상', sensor_ok: '계측 복귀', baseline: '베이스라인 이탈', band: '대역 이탈', bandrec: '대역 복귀' }) + ';',
      /* ⚠ 폴백 목록은 calc BAND_ORDER와 일치 필요 — BAND 조회의 NAME IN 목록이라 빠진 계열은 조용히 판정에서 빠짐.
         뒤 4개(포락선)가 베어링 근거 계열 */
      'var BORDER=' + JSON.stringify(spec.bandOrder
        || ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4', 'envPkRel', 'envBPFO', 'envBPFI', 'envBSF']) + ';',
      /* 대역 추출 타이머가 적재한 최신 대역값 — 한 앵커의 계열이 같은 시각이라 TIME 역순 몇 줄로 충분(이름별 첫 등장만).
         BAND가 없으면(추출 미사용) null → 대역 판정만 생략 */
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
      // 밀리초 포함 로컬 시각 문자열(to_date 인자) — 원본 창 절단·이벤트 TIME 기록용
      'function dtms(ms){ var d=new Date(ms); function p(n,w){var s2=""+n;while(s2.length<w)s2="0"+s2;return s2;}',
      '  return p(d.getFullYear(),4)+"-"+p(d.getMonth()+1,2)+"-"+p(d.getDate(),2)+" "+p(d.getHours(),2)+":"+p(d.getMinutes(),2)+":"+p(d.getSeconds(),2)+" "+p(d.getMilliseconds(),3); }',
      'var GRAW={};',   // 원본으로 본 게이트 결과(isoValue가 채움)
      'var IMP={};',    // 충격성 근거(Crest·첨도, 같은 원본에서 측정)
      /* 존 판정값(ISO) — 원본이 가속도·변위면 속도로 변환해 잼(앱 _isoRefresh와 같은 순서).
         속도 원본은 전대역이 양호 경계 미만이면 생략(ISO ≤ 전대역), 비속도 원본은 조용할 때 재측정 간격만 늘림.
         직전 값이 TTL 안이면 재사용. 반환 { v, fresh } — fresh(이번에 실측)일 때만 호출측이 isoAt 갱신.
         단위가 비면 속도로 간주 */
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
      /* 결함 패턴(등급을 켜는 축) — 원시 파형 → 포락선 → 결함주파수 격자.
         patTtlMs 안이면 직전 값 재사용(포락선 계산 비용 큼). 회전수·기하가 없으면 null(판정 못 함).
         고정 대역(1~5 kHz)이 안 서면 전대역 복조(앱 monPattern·상세분석과 같은 규칙), 반환 wide로 표시 */
      'function patValue(t, prev, key){',
      // at = 이 값을 잰 시각(회차 계수 기준) — 캐시 히트에도 원래 측정 시각
      '  if(prev && prev.pat!=null && (now-(prev.patAt||0)) < ' + patTtlMs + ') return {on:!!prev.pat, r:prev.patR, iso:prev.patIso, key:prev.patK||"", wide:!!prev.patW, cached:true, at:prev.patAt||0};',
      '  if(!t.rpm || !t.geo || !t.geo.n) return null;',
      '  var fr = t.rpm/60; if(!(fr>0)) return null;',
      '  var band = demodFixed(t.fs) || null;',
      '  var bf = bearingFreqs(t.rpm, t.geo); if(!bf) return null;',
      /* 표본이 모자라면 창을 넓혀 재조회 — 최대 2회·600초 상한(길수록 운전 상태가 섞임).
         앱 monPattern과 같은 규칙 */
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
      '  if(vals.length > need) vals = vals.slice(vals.length - need);',   // 최신 쪽 사용(앱 monPattern과 같은 창)
      '  var env = envelopeSpectrum(vals, t.fs, envMaxFor(bf, fr, t.fs), band);',
      '  var m = targetedMatch(env, bf, fr, env.resTrue||env.res);',
      '  var r2 = m ? (m.r||0) : 0;',
      /* 등급 높이용 ISO도 같은 파형에서 잼(패턴과 같은 시점) —
         속도 변환 후 10~1000 Hz 대역 RMS 8블록 평균(앱 monPattern과 같음) */
      '  var _iv = null; try{',
      '    var _vel = (!t.unit || t.unit==="mm/s") ? vals : convertDomain(vals, t.fs, t.unit, "mm/s", fr);',
      '    var _ra = bandRmsAveraged(_vel, t.fs, 10, 1000, 8); _iv = _ra ? _ra.rms : null;',
      '  }catch(e){}',
      '  return {on: patternGrade(r2, false, MON_ADOPT) > 0, r: r2, key: m?(m.key||""):"", iso: _iv, fresh:true, wide: !band, at: now};',
      '}',
      // 화면 durKo와 같은 규칙
      'function durAgo(ms){ if(ms<60000) return Math.round(ms/1000)+"초";'
      + ' if(ms<3600000){ var m=Math.round(ms/60000); return m>=60?"1시간":m+"분"; }'
      + ' if(ms<86400000){ var h=Math.floor(ms/3600000), hm=Math.round((ms%3600000)/60000); if(hm===60){h++;hm=0;} return h+"시간"+(hm?" "+hm+"분":""); }'
      + ' var d=Math.floor(ms/86400000), dh=Math.round((ms%86400000)/3600000); if(dh===24){d++;dh=0;} return d+"일"+(dh?" "+dh+"시간":""); }',
      'function fmtTs(ms){ var d=new Date(ms); function p(n){return (n<10?"0":"")+n;} return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }',
      // 알림 문구용 시각 — 표시 시간대 오프셋(goja엔 시간대 데이터 없음). fmtTs는 SQL용 서버 시간 그대로
      (spec.tzOffsetMin == null ? 'function fmtShow(ms){ return fmtTs(ms); }'
        : 'function fmtShow(ms){ var d=new Date(ms+' + (Number(spec.tzOffsetMin) * 60000) + '); function p(n){return (n<10?"0":"")+n;}'
          + ' return d.getUTCFullYear()+"-"+p(d.getUTCMonth()+1)+"-"+p(d.getUTCDate())+" "+p(d.getUTCHours())+":"+p(d.getUTCMinutes())+":"+p(d.getUTCSeconds()); }'),
      /* 이벤트 사유 문구 — 앱과 같은 함수의 자체 완결형 소스(embedSrc 출력).
         toString 단독은 압축된 바깥 이름 참조로 서버에서만 실패 */
      spec.detailSrc || 'var judgeDetail = function(){return "";};',
      // 발송은 회차 끝에 모아서(flushNotify) — 동시 다발 이벤트를 묶어 채널 한도(Slack 초당 1건) 회피
      'var NQ=[];',
      'function notifyEvent(t, ev, v, l, d){',
      '  if(!NFON) return;',
      '  var gradeKo=GW[ev.gi];',
      '  NQ.push({alias:t.alias||t.tag, tag:t.tag, table:t.tbl, typeKo:TYPEKO[ev.etype]||ev.etype, gradeKo:gradeKo, etype:ev.etype, detail:d||"", val:v, lim:l, unit:t.unit||"", timeText:fmtShow(now)});',
      dry ? '  $.yield("notify", t.tbl+":"+t.tag, ev.etype, gradeKo);' : '',
      '}',
      /* 회차 발송 — 거르기·묶기는 planNotifications(앱과 같은 함수).
         설정을 못 읽으면 미발송 + NFERR 기록(상태 기록의 nf → 앱 배너) */
      'function flushNotify(now){',
      '  if(!NQ.length) return;',
      '  var L=loadNotify();',
      '  if(L.err){ NFERR={t:now, m:L.err, n:NQ.length}; NQ=[]; return; }',
      '  NFOK=true;',
      '  var w=L.cfg.channels && L.cfg.channels.webhook, to=w ? w.to : "";',
      '  if(!to){ NQ=[]; return; }',
      '  var msgs=planNotifications(NQ, L.cfg, "webhook", fmtShow(now)); NQ=[];',
      dry
        ? '  msgs.forEach(function(m){ $.yield("notifyMsg", m.subject, (m.event&&m.event.n)||1); });'
        : '  msgs.forEach(function(m){ try{ $.request(to,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payloadFor(m,to))}).do(function(r){}); }catch(e){} });',
      '}',
      // 판정값 일괄 수집 — 테이블당 NAME IN 조회 1회로 전 태그의 구간 버킷
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
      /* 마지막 수신 시각 — 통계 뷰(테이블당 1회).
         DATETIME은 goja에서 Time 객체라 문자열로 파싱(band.js tms와 같음) */
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
      // 직전 판정 상태 일괄 조회. HAD = 행 존재 여부(putState의 insert/update 선택용)
      'var PREV={}, HAD={};',
      'function loadPrev(){',
      // 예약 키도 함께 — putState로 쓰므로 존재 여부 필요(모르면 insert가 PK 충돌)
      '  var ks=TAGS.map(function(t){ return "\'"+esc(UPFX+t.tbl+":"+t.tag)+"\'"; })',
      '    .concat(["__lock","__st:mon"].map(function(k){ return "\'"+esc(UPFX+k)+"\'"; })).join(",");',
      // 실패 = 직전 상태 모름 → 판정하면 전 태그가 "처음 보는 태그"로 알림 중복 → 회차 건너뜀
      '  try{ db.query("select K, VAL from "+TBLP+"MONSTATE where K in ("+ks+")").forEach(function(r){',
      '    var k=String(r[0]).slice(UPFX.length); HAD[k]=1; PREV[k]=dec(r[1]); }); return true; }',
      '  catch(e){ errAdd("state_read", e, 1); return false; }',
      '}',
      /* 회차 상태 — 매 회차 덮어씀(다음 정상 회차가 문제 목록을 비움)
         nf(놓친 알림)는 발송 성공 전까지 누적 유지, 직전 상태를 모르면 생략(앱이 마지막 값 유지) */
      'function stMon(known){',
      '  var o={t:now, ms:Date.now()-now, n:nDone, pat:nPat, err:ERRS};',
      '  if(known){ var p=PREV["__st:mon"], pnf=(p&&p.nf)||null;',
      '    o.nf = NFERR ? {t:now, m:NFERR.m, n:((pnf&&pnf.n)||0)+NFERR.n} : (NFOK ? null : pnf); }',
      '  return o;',
      '}',
      // 상태 쓰기 — update 우선(delete+insert는 회차 겹침 시 unique index 충돌). 쓰기 실패는 무시
      'function putState(k, o){',
      '  try{',
      '    var v=enc(o);',
      '    if(HAD[k]) db.exec("update "+TBLP+"MONSTATE set VAL=\'"+v+"\' where K=\'"+esc(UPFX+k)+"\'");',
      '    else { db.exec("insert into "+TBLP+"MONSTATE values(\'"+esc(UPFX+k)+"\',\'"+v+"\')"); HAD[k]=1; }',
      '  }catch(e){}',
      '}',
      'var LOADED=loadPrev();',
      // 중복 실행 방지 — 앞 회차가 살아 있으면 이번 회차 생략(겹치면 상태를 서로 덮어씀)
      'var BUSY=false;',
      dry ? '' : 'var _lk=PREV["__lock"]; if(_lk&&_lk.t&&(now-_lk.t)<' + lockTtlMs + ') BUSY=true;',
      'if(!LOADED){',
      dry ? '  $.yield("status", JSON.stringify(stMon(false)));' : '  stPut("__st:mon", stMon(false));',
      '  $.yield("skip", now, 0);',
      '} else if(!BUSY){',
      dry ? '' : 'putState("__lock",{t:now});',
      'collect();',
      'lastSeen();',
      'TAGS.forEach(function(t){',
      // 태그 격리 — 한 태그의 실패(이벤트 저장 등)가 나머지 태그 판정을 막지 않음. 실패 태그는 상태·알림 미저장 → 다음 회차 재시도
      'try {',
      '  if(!rollupOk(t.tbl)) return;', // 롤업 없으면 건너뜀(ERR-2264 방지)
      // 판정값 = RMS 구간 실효값(일괄 수집한 버킷 사용)
      '  var key=t.tbl+":"+t.tag, prev=PREV[key]||null;',
      // 신호 두절 — 판정 주기 6배 넘게 무수신
      '  var last = LAST[key]||0;',
      '  var lost = last>0 && (now-last) > ' + lostMs + ';',
      '  var wr = windowRms(WVAL[key]);',
      '  if(!wr){',
      // 값이 없어도 두절은 알림(상태 전환 시 1회)
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
      // 존 판정 = ISO 10~1000 Hz, 베이스라인 판정 = 전대역(1 kHz 위 결함까지) — 앱과 같음
      '  var wide = wr.rms;',
      // ISO 값(mm/s)은 ISO 존으로 판정(원본 단위 존과 물리량이 다름)
      '  var z=t.isoZones||t.zones;',
      // 베이스라인 한계 초과면 ISO 생략 조건 해제(_near) — 한계가 ISO 양호 경계보다 낮을 수 있음
      '  var _lim0 = baselineLimit(t.bl);',
      '  var _near = _lim0!=null && wide>_lim0;',
      '  var _iso = isoValue(t, wide, prev, key, _near);',
      /* ISO를 못 쟀으면(조회 실패·표본 부족) 직전 등급·ISO 값 유지(앱과 같은 규칙)
         — 전대역으로 대체하면 과대 판정 */
      '  var _hold = !!_iso.hold;',
      '  var val = _hold ? ((prev&&prev.iso!=null)?prev.iso:wide) : _iso.v;',
      // 등급은 결함 패턴이 켤 때만 오르고 ISO가 높이를 정함(앱 patternGate와 같음)
      '  var _isoG = _hold ? (prev?(prev.g||0):0) : (val<z[0]?0:val<z[1]?1:val<z[2]?2:3);',
      '  var _pv = patValue(t, prev, key);',
      // 패턴을 잰 태그 수 — nDone(훑은 수)과 별도, 패턴 축이 통째로 빈 상태 감지용
      '  if(_pv) nPat++;',
      '  var _hv = (_pv && _pv.iso!=null) ? _pv.iso : val;',   // 높이를 정한 ISO 값 — 이벤트 값 칸에도 이 값
      '  var _hG = (_pv && _pv.iso!=null) ? (_pv.iso<z[0]?0:_pv.iso<z[1]?1:_pv.iso<z[2]?2:3) : _isoG;',
      /* 잴 수 있는 태그인데 이번에 못 쟀으면 판정 보류 — 직전 등급·회차 유지(거짓 복귀 방지).
         calc.patternRound(patSrc 임베드) */
      '  var _pr = patternRound(_pv, !!(t.rpm && t.geo && t.geo.n), prev, _hG);',
      '  var rg = _pr.rg;',
      '  var lim = baselineLimit(t.bl);',
      '  var breach = lim!=null && wide>lim;',
      /* 계측 게이트 — 계측 문제로 보이면 진동 판정을 멈추고 계측 이상으로 알림.
         플랫라인·DC는 롤업만으로, 클립·스파이크·첨도는 원본을 받은 틱에만(GRAW).
         원본 판정은 판정 상태(gr)로 60초간 승계(캐시 틱에도 지속 판정 유지) */
      '  var graw = GRAW[key] || null;',
      '  if(!graw && prev && prev.gr && (now-(prev.gr.at||0)) < 60000) graw = prev.gr.v;',
      '  var bad = gateFromBuckets(WVAL[key], wide, (t.rpm||0)/60) || graw || null;',
      '  var sens = sensorTick(prev, bad, now, CFG);',
      // 대역 판정 — 설비당 1건으로 합성, 미학습·추출 미사용이면 null
      // t.soft = 마운팅 상한 초과 대역(앱이 계산) — 그 대역만 이탈하면 '주의'가 상한
      // elat = 포락선 계열 이탈 래치 — 신호가 묻혀도 유지, 재학습에서만 해제(앱과 같은 규칙)
      '  var bj = sens.on ? null : bandJudge(bandNow(t), t.bb, !!(prev&&prev.bb), t.soft, prev&&prev.elat, now);',
      '  var _elat = bj ? bj.latch : (prev && prev.elat);',
      /* 운전 판별 — 정지 수준이면 판정 동결(정지를 개선으로 오인 방지).
         기준은 학습 μ, 없으면 최근 버킷 P75 */
      '  var recent=(WVAL[key]||[]).map(function(x){return x.rms;});',
      '  var run = isRunning(wide, runRef(t.bl, recent));',   // 정지 여부는 주파수와 무관
      '  if(sens.on) run=false;',   // 계측을 못 믿는 동안은 판정 동결
      '  if(lost) run=false;',
      '  var res=judgeTick(prev,rg,breach,now,CFG,bj,run,_pr.cyc);',   // 회차 식별자 = 패턴을 잰 시각(보류면 직전 회차)
      '  res.next.lost = lost?1:0;',
      '  sens.events.forEach(function(e){ res.events.push(e); });',
      '  if(_elat && Object.keys(_elat).length) res.next.elat=_elat;',
      '  res.next.sf=sens.next.sf; if(sens.next.sfs!=null) res.next.sfs=sens.next.sfs; if(sens.next.sfc!=null) res.next.sfc=sens.next.sfc;',
      // 원본을 본 틱에만 갱신(이상 없으면 저장 안 해 해제). 안 본 틱은 유효기간 안의 직전 판정 승계
      '  if(_iso.fresh){ if(GRAW[key]) res.next.gr={v:GRAW[key], at:now}; }',
      '  else if(prev && prev.gr && (now-(prev.gr.at||0)) < 60000) res.next.gr=prev.gr;',
      /* 충격성 근거는 숫자(crest·kurt)만 저장 — 한글 문장은 인코딩이 길어
         MONSTATE.VAL 한도 초과 시 잘려 dec()가 null(상태 소실) */
      '  if(_iso.fresh){ if(IMP[key]) res.next.im={v:{crest:IMP[key].crest, kurt:IMP[key].kurt}, at:now}; }',
      '  else if(prev && prev.im && (now-(prev.im.at||0)) < 60000) res.next.im=prev.im;',
      // 실측 틱에만 시각 기록(캐시·폴백값에 찍으면 TTL 만료 안 됨)
      '  if(_iso.fresh){ res.next.iso=val; res.next.isoAt=now; } else if(prev&&prev.iso!=null){ res.next.iso=prev.iso; res.next.isoAt=prev.isoAt; }',
      // 패턴 결과도 상태에 저장(TQL은 매 실행 새로 시작 — 캐시는 여기뿐). 못 잰 틱엔 직전 값 승계
      '  if(_pv && _pv.fresh){ res.next.pat=_pv.on?1:0; res.next.patR=_pv.r; res.next.patK=_pv.key||""; res.next.patIso=_pv.iso; res.next.patAt=now; res.next.patW=_pv.wide?1:0;',
      // 격자 점수를 BAND 계열(:pattern)로 기록 — 이벤트에 안 남는 단발·경계 구간 추적용, 대역·포락선과 한 표
      dry
        ? '    $.yield("pattern", t.tbl+":"+t.tag, _pv.r);'
        : '    try{ db.exec("insert into "+TBLP+"BAND values(\'"+esc(UPFX+t.tbl+":"+t.tag+":pattern")+"\', to_date(\'"+dtms(now)+"\'), "+(+_pv.r||0)+")"); }catch(e){}',
      '  }',
      '  else if(prev && prev.pat!=null){ res.next.pat=prev.pat; res.next.patR=prev.patR; res.next.patK=prev.patK; res.next.patIso=prev.patIso; res.next.patAt=prev.patAt; res.next.patW=prev.patW; }',
      '  var _im = IMP[key] || ((prev && prev.im && (now-(prev.im.at||0)) < 60000) ? prev.im.v : null);',
      // 발송 대기는 이 태그의 이벤트 저장이 모두 끝난 뒤 — 저장 실패 시 알림만 나가는 것 방지
      '  var _nq=[];',
      '  res.events.forEach(function(ev){',
      // 계측 이상은 지표값 없음(val/lim 0은 자리 채움)
      '    var isS = ev.etype=="sensor_fault"||ev.etype=="sensor_ok";',
      /* 이벤트 값은 원본 단위 — 속도 원본은 등급 높이를 정한 ISO 값·경계, 가속도·변위 원본은 구간 RMS + 기준 비움
         + 근거(ISO 존)를 DETAIL 머리에(앱 _judgeLive와 같음) */
      '    var nat = !isS && !!t.unit && t.unit!=="mm/s";',
      '    var v2 = isS ? 0 : (nat ? wide : _hv);',
      '    var l2 = (nat||isS) ? 0 : (ev.etype=="recovery" ? z[0] : (ev.gi>0 ? z[ev.gi-1] : z[0]));',
      '    l2 = (l2==null?0:l2);',
      // 사유 문구 — 등급 이벤트는 judgeDetail(앱과 같은 함수), 계측 이상은 그 판정의 문구 그대로
      '    var dt = isS ? (ev.detail||"") : judgeDetail(ev, _pv, _im);',
      '    if(nat) dt = "ISO "+GW[_hG]+" 구간"+(dt ? " · "+dt : "");',
      dry
        ? '    $.yield("evt", key, ev.etype, GW[ev.gi], v2, l2, dt);'
        : '    var eid=key+":"+now+":"+ev.etype;\n    db.exec("insert into "+TBLP+"EVENTS values(\'"+esc(UPFX+key)+"\', to_date(\'"+dtms(now)+"\'), "+v2+", \'"+ev.etype+"\', \'"+GW[ev.gi]+"\', "+l2+", \'"+esc(dt)+"\', \'"+esc(eid)+"\')");',
      '    _nq.push([ev, v2, nat ? null : l2, dt]);', // 기준 숫자 없는 행은 lim=null(근거는 문구로)
      '  });',
      '  _nq.forEach(function(a){ notifyEvent(t, a[0], a[1], a[2], a[3]); });',
      dry
        ? '  $.yield("state", key, enc(res.next));'
        : '  putState(key, res.next);',
      '  nDone++;',
      '} catch(e) { errAdd("tag_fail", t.tbl+":"+t.tag+" — "+e, 1); }',
      '});',
      // 전 태그 판정 후 묶어서 발송
      'flushNotify(now);',
      // 회차 상태 — 시각·판정 수·패턴 수·소요·문제 목록·놓친 알림("돌았는가"·회차 겹침·실패 사유)
      dry ? '$.yield("status", JSON.stringify(stMon(true)));' : 'putState("__st:mon", stMon(true));',
      dry ? '' : 'putState("__lock",{t:0});',   // 잠금 해제
      '$.yield("done", now, nDone);',
      '} else { $.yield("skip", now, 0); }',
      // 실패 시 잠금 해제 필수(안 풀면 TTL까지 BUSY) + 사유를 상태 기록에
      '} catch(e) {',
      '  try { putState("__lock",{t:0}); } catch(e2) {}',
      dry
        ? '  try { errAdd("round", e, 1); $.yield("status", JSON.stringify(stMon(LOADED===true))); } catch(e2) {}'
        : '  try { errAdd("round", e, 1); stPut("__st:mon", stMon(LOADED===true)); } catch(e2) {}',
      '  $.yield("error", Date.now(), 0);',
      '}',
      '})',
      'CSV()',
    ];
    return body.join('\n');
  }

  return { buildMonitorTql: buildMonitorTql, validateSpec: validateSpec };
});
