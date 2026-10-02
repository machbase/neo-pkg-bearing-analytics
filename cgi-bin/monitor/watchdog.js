// monitor/watchdog.js — 타이머 회차 상태 기록 TQL 조각(errAdd·stPut)
// 상태 기록은 앱 건강 배너·자동 복구의 근거("돌았는가 · 무엇이 실패했는가")
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeWatchdog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 회차 상태 기록 조각 — 타이머마다 MONSTATE 키 하나(__st:mon · __st:band)
     · errAdd(c, m, n): 이번 회차 문제 누적(같은 코드는 건수 합산, 사유는 첫 건) — 코드 state_read · tag_fail · round
     · stPut(k, o): 행 유무를 몰라도 쓰는 기록(개수 조회 → update/insert, 조회 실패 시 insert → 충돌이면 update)
     TQL 안의 db·TBLP·UPFX 사용. 전부 try — 기록 실패가 회차를 멈추지 않음 */
  function statusSrc() {
    return [
      'var ERRS=[];',
      'function errAdd(c,m,n){ for(var i=0;i<ERRS.length;i++) if(ERRS[i].c===c){ ERRS[i].n+=(n||1); return; }',
      '  ERRS.push({c:c, m:String(m==null?"":m).slice(0,200), n:n||1}); }',
      'function stPut(k,o){ var v=encodeURIComponent(JSON.stringify(o)).replace(/\'/g,"%27"), kk=String(UPFX+k).replace(/\'/g,"\'\'"), c=-1;',
      '  try{ db.query("select count(*) from "+TBLP+"MONSTATE where K=\'"+kk+"\'").forEach(function(r){ c=+r[0]; }); }catch(e){}',
      '  var up="update "+TBLP+"MONSTATE set VAL=\'"+v+"\' where K=\'"+kk+"\'", ins="insert into "+TBLP+"MONSTATE values(\'"+kk+"\',\'"+v+"\')";',
      '  try{ if(c>0) db.exec(up); else if(c===0) db.exec(ins); else { try{ db.exec(ins); }catch(e){ db.exec(up); } } }catch(e){} }',
    ].join('\n');
  }

  return { statusSrc: statusSrc };
});
