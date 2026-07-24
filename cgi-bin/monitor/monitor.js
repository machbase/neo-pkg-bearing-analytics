// monitor/monitor.js — 서버 상시감시(P5) 판정 TQL 생성기.
// 앱이 설정을 컴파일해 자체 완결형 .tql로 저장 → Neo 타이머가 주기 실행(앱 없이도 감시).
// 핵심: judgeTick 소스를 그대로 임베드(앱과 동일 규칙 — 드리프트 0). 롤업 없는 테이블은
// SCRIPT 내부에서 사전 판별해 건너뜀(타이머 컨텍스트는 SQL 오류 하나가 스크립트 전체를 즉사시킴).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeMonitor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // spec: { judgeSrc(judgeTick 소스문자열), tags:[{tbl,tag,alias,unit,zones:[z0,z1,z2],bl:{mu,sigma,k}|null}],
  //         cfg:{escHold,recHold,reno:{1,2,3}}(ms), secWinNs(최신 sec 버킷 조회 룩백, 기본 10s),
  //         notify:{src(notify.serverSrc()), cfg:{channels,routes}}, dryRun }
  // dryRun=true면 INSERT/UPSERT/발송 대신 $.yield로 결정만 방출(테스트용, 실테이블·외부 무영향).
  function buildMonitorTql(spec) {
    spec = spec || {};
    var judgeSrc = spec.judgeSrc || '';
    var secWinNs = spec.secWinNs || 10000000000; // 10초
    var cfg = spec.cfg || { escHold: 0, recHold: 300000, reno: { 1: 0, 2: 3600000, 3: 1800000 } };
    var tags = spec.tags || [];
    var dry = !!spec.dryRun;
    var nf = spec.notify || null;

    var body = [
      'SCRIPT({',
      // var에 대입해 두는 이유: 빌드 미니파이로 함수명이 바뀌어도(judgeTick→ie) 호출측 이름이 유지된다
      'var judgeTick = ' + judgeSrc + ';', // 순수 judgeTick(prev,rg,breach,now,cfg) — 앱과 동일 소스
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
      'var TYPEKO=' + JSON.stringify({ threshold: '임계 초과', sustained: '상태 지속', recovery: '정상 복귀', baseline: '베이스라인 이탈' }) + ';',
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
      'TAGS.forEach(function(t){',
      '  if(!rollupOk(t.tbl)) return;', // 롤업 없으면 건너뜀 — ERR-2264로 스크립트 즉사 방지
      '  var val=NaN;',
      '  var qs="select ROLLUP(\'sec\',1,TIME) rt, SUMSQ(VALUE) ss, COUNT(VALUE) cnt from "+t.tbl+" where NAME=\'"+esc(t.tag)+"\' and TIME between now-' + secWinNs + ' and now group by rt order by rt desc limit 1";',
      '  db.query(qs).forEach(function(r){ if(r[2]>0) val=Math.sqrt(r[1]/r[2]); });',
      '  if(!(val>=0)) return;',
      '  var z=t.zones, rg = val<z[0]?0:val<z[1]?1:val<z[2]?2:3;',
      '  var lim = t.bl ? t.bl.mu+(t.bl.k||3)*t.bl.sigma : null;',
      '  var breach = lim!=null && val>lim;',
      '  var key=t.tbl+":"+t.tag, prev=null;',
      '  db.query("select VAL from NEO_VIBE_MONSTATE where K=\'"+esc(key)+"\'").forEach(function(r){ prev=dec(r[0]); });',
      '  var res=judgeTick(prev,rg,breach,now,CFG);',
      '  res.events.forEach(function(ev){',
      '    var l2 = ev.etype=="baseline"?lim:(ev.etype=="recovery"?z[0]:(ev.gi>0?z[ev.gi-1]:z[0]));',
      '    l2 = (l2==null?0:l2);',
      dry
        ? '    $.yield("evt", key, ev.etype, GW[ev.gi], val, l2);'
        : '    var eid=key+":"+now+":"+ev.etype;\n    db.exec("insert into NEO_VIBE_EVENTS values(\'"+esc(eid)+"\',"+now+",\'"+esc(t.tbl)+"\',\'"+esc(t.tag)+"\',\'"+ev.etype+"\',\'"+GW[ev.gi]+"\',"+val+","+l2+")");',
      '    notifyEvent(t, ev, val, l2);', // 라우팅에 걸리면 발송(서버는 임계·베이스라인 모두 같은 sec버킷 RMS 사용)
      '  });',
      dry
        ? '  $.yield("state", key, enc(res.next));'
        : '  db.exec("delete from NEO_VIBE_MONSTATE where K=\'"+esc(key)+"\'");\n  db.exec("insert into NEO_VIBE_MONSTATE values(\'"+esc(key)+"\',\'"+enc(res.next)+"\')");',
      '  nDone++;',
      '});',
      '$.yield("done", now, nDone);',
      '})',
      'CSV()',
    ];
    return body.join('\n');
  }

  return { buildMonitorTql: buildMonitorTql };
});
