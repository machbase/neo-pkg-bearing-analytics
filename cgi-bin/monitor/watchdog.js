// monitor/watchdog.js — 타이머 심박.
//
// 예전에는 여기에 "감시자"가 있었다. Neo 타이머는 스크립트가 한 번 예외를 던지면 STOP으로 두고
// 재시도하지 않아서, 죽은 타이머를 되살리는 별도 타이머를 두고 서로 감시하는 고리를 만들었다.
//
// 그 구조를 걷어낸 이유:
//   · 감시자도 같은 타이머라 같은 이유로 죽는다. Neo 프로세스가 멈추면 함께 멈춘다 —
//     "되살리기"가 실제로 커버하던 것은 "일시적 예외로 한 타이머만 STOP된 경우" 하나뿐이었다.
//   · 그 하나는 회차를 try/catch로 감싸 애초에 죽지 않게 하는 쪽이 싸고, 공백도 없다.
//   · 되살리려면 Neo에 인증 요청을 보내야 하는데(타이머 API는 JSON-RPC + JWT), 서버에서 도는
//     TQL에는 세션이 없다. 계정 비밀번호를 TQL에 구우면 그 파일을 읽을 수 있는 사람에게 넘어간다.
//
// 남은 역할은 심박뿐이다 — "이 타이머가 돌기는 했는가"를 앱이 알아야 건강 배너와 자동 복구가 돈다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeWatchdog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* TQL에 박을 심박 코드. 회차마다 MONSTATE에 {t, n}을 남긴다.
       key   : 심박 키(__hb · __hbband)
       nExpr : 그 회차가 처리한 건수를 담은 식(문자열)
     저장소는 공용 표라 TQL 안의 TBLP(표 위치)와 UPFX(행 키 접두)를 그대로 쓴다.
     값이 안 쌓인 회차에도 심박은 남긴다 — 보는 쪽이 알고 싶은 것은 "돌았는가"지 "일했는가"가 아니다.
     전부 try로 감싼다: 심박을 못 남기는 것이 회차를 죽일 이유는 되지 않는다. */
  function hbOnlySrc(key, nExpr) {
    return [
      'function hbPut(db,k,o){ try{ var c=0;',
      '  db.query("select count(*) from "+TBLP+"MONSTATE where K=\'"+UPFX+k+"\'").forEach(function(r){ c=+r[0]; });',
      '  var v=encodeURIComponent(JSON.stringify(o)).replace(/\'/g,"%27");',
      '  if(c>0) db.exec("update "+TBLP+"MONSTATE set VAL=\'"+v+"\' where K=\'"+UPFX+k+"\'");',
      '  else db.exec("insert into "+TBLP+"MONSTATE values(\'"+UPFX+k+"\',\'"+v+"\')"); }catch(e){} }',
      'try{ hbPut(db,' + JSON.stringify(String(key)) + ',{t:Date.now(),n:' + (nExpr || '0') + '}); }catch(e){}',
    ].join('\n');
  }

  return { hbOnlySrc: hbOnlySrc };
});
