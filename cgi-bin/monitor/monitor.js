// monitor/monitor.js — 서버 상시감시(P5) 판정 TQL 생성기.
// 앱이 설정을 컴파일해 자체 완결형 .tql로 저장 → Neo 타이머가 주기 실행(앱 없이도 감시).
// 핵심: judgeTick 소스를 그대로 임베드(앱과 동일 규칙 — 드리프트 0). 롤업 없는 테이블은
// SCRIPT 내부에서 사전 판별해 건너뜀(타이머 컨텍스트는 SQL 오류 하나가 스크립트 전체를 즉사시킴).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeMonitor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // spec: { judgeSrc(judgeTick 소스문자열), limitSrc(baselineLimit 소스문자열 — 클램프 포함),
  //         winSrc(windowRms 소스 — 구간 RMS), winMs(RMS 구간 길이 ms),
  //         bandSrc(bandJudgeSrc() — 상수 포함 자체 완결형), bandWinMs(대역값 룩백, 기본 2h),
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
      spec.winSrc ? 'var windowRms = ' + spec.winSrc + ';' : 'var windowRms = function(){return null;};',
      spec.runSrc ? 'var isRunning = ' + spec.runSrc + ';' : 'var isRunning = function(){return true;};',
      spec.isoSrc || 'var isoRms = function(){return null;}; var isoNeeded = function(){return false;};',
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
      'isoNeeded(25600); isoRms([1,2,3,4,5,6,7,8], 25600);',
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
    var isoTtlMs = spec.isoTtlMs || 30000;
    var isoWinMs = spec.isoWinMs || 1000;
    var refSrc = spec.refSrc || '';
    var tickMs = spec.tickMs || 10000;          // 판정 주기 — 두절 기준(6배)의 근거
    var lostMs = Math.max(60000, tickMs * 6);
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
      winSrc ? 'var windowRms = ' + winSrc + ';' : 'var windowRms = function(b){ if(!b||!b.length) return null; var ss=0,n=0; for(var i=0;i<b.length;i++){ ss+=b[i].rms*b[i].rms*b[i].cnt; n+=b[i].cnt; } return n?{rms:Math.sqrt(ss/n)}:null; };',
      runSrc ? 'var isRunning = ' + runSrc + ';' : 'var isRunning = function(){return true;};',
      refSrc ? 'var runRef = ' + refSrc + ';' : 'var runRef = function(){return 0;};',
      isoSrc || 'var isoRms = function(){return null;}; var isoNeeded = function(){return false;};',
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
      'var TYPEKO=' + JSON.stringify({ threshold: '임계 초과', sustained: '상태 지속', recovery: '정상 복귀', improve: '상태 개선', signal_lost: '신호 두절', baseline: '베이스라인 이탈', band: '대역 이탈', bandrec: '대역 복귀' }) + ';',
      'var BORDER=' + JSON.stringify(spec.bandOrder || ['sub', 'one', 'fault', 'high', 'vhigh']) + ';',
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
      // 밀리초까지 찍는 시각 문자열 — 1초 창을 정확히 자르려면 초 단위로는 부족하다
      'function dtms(ms){ var d=new Date(ms); function p(n,w){var s2=""+n;while(s2.length<w)s2="0"+s2;return s2;}',
      '  return p(d.getFullYear(),4)+"-"+p(d.getMonth()+1,2)+"-"+p(d.getDate(),2)+" "+p(d.getHours(),2)+":"+p(d.getMinutes(),2)+":"+p(d.getSeconds(),2)+" "+p(d.getMilliseconds(),3); }',
      /* 존 판정값 — 전대역이 양호 경계 미만이면 ISO도 반드시 양호라 계산을 건너뛴다.
         넘었을 때만 원본 1초를 받아 밴드패스로 정확히 잰다(실측 goja 210ms/태그).
         직전에 잰 값이 TTL 안이면 그걸 쓴다 — 경계를 오가도 조회가 폭주하지 않게. */
      'function isoValue(t, wide, prev, key){',
      '  if(!isoNeeded(t.fs)) return wide;',
      '  if(wide < t.zones[0]) return wide;',
      '  if(prev && prev.iso!=null && (now-(prev.isoAt||0)) < ' + isoTtlMs + ') return prev.iso;',
      '  var end = LAST[key]||now, vals=[];',
      '  try{ db.query("select VALUE from "+t.tbl+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dtms(end-' + isoWinMs + ')+"\') and to_date(\'"+dtms(end)+"\') order by TIME")',
      '    .forEach(function(r){ vals.push(+r[0]); }); }catch(e){ return wide; }',
      '  var v = isoRms(vals, t.fs);',
      '  return v==null ? wide : v;',
      '}',
      'function durAgo(ms){ if(ms<60000) return Math.round(ms/1000)+"초"; if(ms<3600000) return Math.round(ms/60000)+"분"; return (ms/3600000).toFixed(1)+"시간"; }',
      'function fmtTs(ms){ var d=new Date(ms); function p(n){return (n<10?"0":"")+n;} return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }',
      'function notifyEvent(t, ev, v, l){',
      '  if(!NOTIFY.channels) return;',
      '  var gradeKo=GW[ev.gi];',
      '  if(!shouldNotify(gradeKo, ev.etype, "webhook", NOTIFY)) return;',
      '  var to=NOTIFY.channels.webhook.to;',
      '  var msg=eventMessage({alias:t.alias||t.tag, tag:t.tag, table:t.tbl, typeKo:TYPEKO[ev.etype]||ev.etype, gradeKo:gradeKo, val:v, lim:l, unit:t.unit||"", timeText:fmtTs(now)});',
      dry
        ? '  $.yield("notify", t.tbl+":"+t.tag, ev.etype, gradeKo);'
        : '  try{ $.request(to,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payloadFor(msg,to))}).do(function(r){}); }catch(e){}',
      '}',
      /* 판정값 일괄 수집 — 테이블당 한 번의 NAME IN 조회로 전 태그의 구간 버킷을 받는다.
         태그마다 따로 물으면 비용이 태그 수에 비례하는데(실측 32.6ms/태그), 배치는 12.97ms/태그다. */
      'var WVAL={};',
      'function collect(){',
      '  var byTbl={};',
      '  TAGS.forEach(function(t){ if(rollupOk(t.tbl)) (byTbl[t.tbl]=byTbl[t.tbl]||[]).push(t.tag); });',
      '  Object.keys(byTbl).forEach(function(tbl){',
      '    var ns=byTbl[tbl].map(function(x){return "\'"+esc(x)+"\'";}).join(",");',
      '    var q="select NAME, ROLLUP(\'sec\',1,TIME) rt, SUMSQ(VALUE) ss, COUNT(VALUE) cnt, SUM(VALUE) sm from "+tbl',
      '      +" where NAME in ("+ns+") and TIME between now-' + ((winMs + lagMs) * 1000000) + ' and now group by NAME, rt order by NAME, rt";',
      '    try{',
      '      db.query(q).forEach(function(r){',
      '        if(!(r[3]>0)) return;',
      '        var k=tbl+":"+String(r[0]);',
      '        (WVAL[k]=WVAL[k]||[]).push({rms:Math.sqrt(r[2]/r[3]), cnt:r[3], sum:r[4]});',
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
      'collect();',
      'lastSeen();',
      'TAGS.forEach(function(t){',
      '  if(!rollupOk(t.tbl)) return;', // 롤업 없으면 건너뜀 — ERR-2264로 스크립트 즉사 방지
      // 판정값 = RMS 구간의 실효값. 배치로 미리 모은 버킷에서 꺼내므로 태그마다 조회하지 않는다.
      '  var key=t.tbl+":"+t.tag, prev=null;',
      '  db.query("select VAL from NEO_VIBE_MONSTATE where K=\'"+esc(key)+"\'").forEach(function(r){ prev=dec(r[0]); });',
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
      : '      db.exec("insert into NEO_VIBE_EVENTS values(\'"+esc(key+":"+now+":signal_lost")+"\',"+now+",\'"+esc(t.tbl)+"\',\'"+esc(t.tag)+"\',\'signal_lost\',\'"+GW[1]+"\',0,0,\'"+esc(durAgo(now-last))+" 무수신\')");',
      '      notifyEvent(t, lev, 0, 0);',
      dry ? '' : '      db.exec("delete from NEO_VIBE_MONSTATE where K=\'"+esc(key)+"\'");\n      db.exec("insert into NEO_VIBE_MONSTATE values(\'"+esc(key)+"\',\'"+enc(st)+"\')");',
      '    }',
      '    return;',
      '  }',
      /* 존 판정과 베이스라인 판정은 서로 다른 값을 본다(앱과 동일).
         존 = ISO 10~1000 Hz (절대 기준이라 표준이 정의한 양) · 베이스라인 = 전대역 (자기 기준 대비,
         어느 주파수든 잡는 가장 넓은 그물). 여기까지 대역제한을 걸면 1 kHz 위 결함을 놓친다. */
      '  var wide = wr.rms;',
      '  var z=t.zones;',
      '  var val = isoValue(t, wide, prev, key);',
      '  var isoFresh = isoNeeded(t.fs) && wide>=z[0];',
      '  var rg = val<z[0]?0:val<z[1]?1:val<z[2]?2:3;',
      '  var lim = baselineLimit(t.bl);',
      '  var breach = lim!=null && wide>lim;',
      // 대역 판정 — 설비당 1건으로 합성. 미학습·추출 미사용이면 null이라 judgeTick이 조용히 지나간다.
      '  var bj = bandJudge(bandNow(t), t.bb, !!(prev&&prev.bb));',
      /* 운전 판별 — 정지 수준이면 판정을 얼린다. 정지를 개선으로 읽으면 "복귀했습니다" 알림이
         나가고, 사람은 설비가 고쳐진 줄 안다. 기준은 학습 μ, 없으면 최근 버킷 P75(학습과 같은 방법). */
      '  var recent=(WVAL[key]||[]).map(function(x){return x.rms;});',
      '  var run = isRunning(wide, runRef(t.bl, recent));',   // 정지 여부는 주파수와 무관
      '  if(lost) run=false;',
      '  var res=judgeTick(prev,rg,breach,now,CFG,bj,run);',
      '  res.next.lost = lost?1:0;',
      '  if(isoFresh){ res.next.iso=val; res.next.isoAt=now; } else if(prev&&prev.iso!=null){ res.next.iso=prev.iso; res.next.isoAt=prev.isoAt; }',
      '  res.events.forEach(function(ev){',
      // 대역 이벤트는 값이 "한계 대비 배수"라 단위가 다르다 — val=배수, lim=1(=한계). 앱과 동일.
      '    var isB = ev.etype=="band"||ev.etype=="bandrec";',
      '    var v2 = isB ? (bj?bj.maxR:0) : (ev.etype=="baseline" ? wide : val);',
      '    var l2 = isB ? 1 : (ev.etype=="baseline"?lim:(ev.etype=="recovery"?z[0]:(ev.gi>0?z[ev.gi-1]:z[0])));',
      '    l2 = (l2==null?0:l2);',
      '    var dt = (ev.etype=="band"&&bj) ? bj.detail : "";',
      dry
        ? '    $.yield("evt", key, ev.etype, GW[ev.gi], v2, l2, dt);'
        : '    var eid=key+":"+now+":"+ev.etype;\n    db.exec("insert into NEO_VIBE_EVENTS values(\'"+esc(eid)+"\',"+now+",\'"+esc(t.tbl)+"\',\'"+esc(t.tag)+"\',\'"+ev.etype+"\',\'"+GW[ev.gi]+"\',"+v2+","+l2+",\'"+esc(dt)+"\')");',
      '    notifyEvent(t, ev, v2, l2);', // 라우팅에 걸리면 발송(서버는 임계·베이스라인 모두 같은 sec버킷 RMS 사용)
      '  });',
      dry
        ? '  $.yield("state", key, enc(res.next));'
        : '  db.exec("delete from NEO_VIBE_MONSTATE where K=\'"+esc(key)+"\'");\n  db.exec("insert into NEO_VIBE_MONSTATE values(\'"+esc(key)+"\',\'"+enc(res.next)+"\')");',
      '  nDone++;',
      '});',
      /* 심박 — 이번 실행이 언제, 몇 개를 판정했는지 한 행에 남긴다.
         타이머 상태만 보면 "RUNNING인데 실제로는 아무것도 안 하는" 경우를 놓친다
         (감시 대상 태그의 데이터가 끊기면 전부 건너뛰어 nDone=0이 된다).
         새 테이블을 만들지 않으려고 MONSTATE에 예약 키로 넣는다 — 태그 키와 겹치지 않는다. */
      dry ? '' : 'db.exec("delete from NEO_VIBE_MONSTATE where K=\'__hb\'");',
      dry ? '' : 'db.exec("insert into NEO_VIBE_MONSTATE values(\'__hb\',\'"+enc({t:now,n:nDone})+"\')");',
      '$.yield("done", now, nDone);',
      '})',
      'CSV()',
    ];
    return body.join('\n');
  }

  return { buildMonitorTql: buildMonitorTql, validateSpec: validateSpec };
});
