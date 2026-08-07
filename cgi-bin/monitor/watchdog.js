// monitor/watchdog.js — 서버 타이머 감시.
//
// Neo 타이머는 스크립트가 한 번 던지면 STOP으로 두고 재시도하지 않는다. 앱이 열려 있으면
// 앱이 되살리지만 닫아두면 아무도 모른다 — 실제로 순간적인 소켓 고갈 하나로 감시가 1.4시간
// 꺼져 있었다. 그래서 서버 안에 감시자를 둔다.
//
// 고리 구조 — 모두가 최소 한 명에게 감시받는다:
//   NEO_VIBE_WD (5분)      → 감시·대역 추출을 본다
//   NEO_VIBE_MONITOR (10초) → 감시자를 본다
//   NEO_VIBE_BAND (10분)    → 감시자를 본다
// 감시자를 따로 둔 이유는 감시의 생존이 대역 추출 같은 다른 기능의 on/off에 걸리면 안 되기
// 때문이다. 대역 추출은 원인 분석용 선택 기능이고, 감시가 살아있는지는 안전 기능이다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeWatchdog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 되살릴지 말지의 판단부만 순수 함수로 떼어낸다 — TQL 안에서는 DB도 HTTP도 없이
     검증할 수 없기 때문이다. 바깥 이름을 참조하지 않아 그대로 임베드해도 안전하다.
       hb  : 상대가 마지막으로 남긴 심박 {t}
       w   : 이쪽이 기억하는 시도 이력 {n,at}
       cfg : {stale,gap,max,calm}
     반환 {act, w, why} — why는 사람이 로그에서 읽을 사유다. */
  function wdDecide(hb, w, now, cfg) {
    w = (w && typeof w === 'object') ? { n: w.n || 0, at: w.at || 0 } : { n: 0, at: 0 };
    // 오래 조용했으면 처음부터 센다 — 몇 달에 한 번 나는 순간 장애까지 누적하면
    // 정작 필요할 때 남은 시도가 없다
    if (w.at && now - w.at > cfg.calm) { w = { n: 0, at: 0 }; }
    // 상대가 한 번도 안 뛰었으면 판단하지 않는다 — 갓 등록됐거나 아직 첫 회차 전이다
    if (!hb || !(hb.t > 0)) return { act: false, w: w, why: 'nohb' };
    if (now - hb.t <= cfg.stale) return { act: false, w: w, why: 'alive' };
    /* 되살려도 같은 자리에서 또 죽는 경우(스크립트 파손)가 있다. 무한히 재시도하면
       상대가 매번 등록만 되고 죽기를 반복해 로그만 쌓이고 진짜 고장이 묻힌다. */
    if (w.n >= cfg.max) return { act: false, w: w, why: 'gaveup' };
    // 방금 시도했으면 결과를 기다린다 — 등록 직후엔 아직 첫 회차가 안 돌았을 수 있다
    if (w.at && now - w.at < cfg.gap) return { act: false, w: w, why: 'waiting' };
    return { act: true, w: { n: w.n + 1, at: now }, why: 'restart' };
  }

  /* TQL에 박을 감시 코드. 호출부는 `wdTick(db)` 한 줄이면 된다.
       o: { base('http://127.0.0.1:5654'), authPath,
            targets: [{ peer(타이머 이름), hb(상대 심박 키), key(이력 키),
                        stale, gap, max, calm }] } */
  function wdSrc(o) {
    var q = function (v) { return JSON.stringify(String(v)); };
    var targets = (o.targets || []).map(function (t) {
      return { peer: String(t.peer), hb: String(t.hb), key: String(t.key),
        cfg: { stale: Math.round(t.stale), gap: Math.round(t.gap), max: Math.round(t.max), calm: Math.round(t.calm) } };
    });
    return [
      'var WD_BASE=' + q(o.base) + ', WD_AUTH=' + q(o.authPath) + ';',
      'var WD_TARGETS=' + JSON.stringify(targets) + ';',
      // 고정 별칭 — 압축기가 이름을 바꿔도 부르는 쪽이 안 흔들린다(band.js와 같은 이유)
      'var __wdDecide=' + wdDecide.toString() + ';',
      // MONSTATE 값 규약은 감시 쪽과 같다 — URL 인코딩된 JSON 한 칸
      'function wdGet(db,k){ var v=null; try{ db.query("select VAL from NEO_VIBE_MONSTATE where K=\'"+k+"\'")',
      '  .forEach(function(r){ try{ v=JSON.parse(decodeURIComponent(String(r[0]))); }catch(e){} }); }catch(e){} return v; }',
      'function wdPut(db,k,o){ try{ var c=0; db.query("select count(*) from NEO_VIBE_MONSTATE where K=\'"+k+"\'").forEach(function(r){ c=+r[0]; });',
      '  var v=encodeURIComponent(JSON.stringify(o)).replace(/\'/g,"%27");',
      '  if(c>0) db.exec("update NEO_VIBE_MONSTATE set VAL=\'"+v+"\' where K=\'"+k+"\'");',
      '  else db.exec("insert into NEO_VIBE_MONSTATE values(\'"+k+"\',\'"+v+"\')"); }catch(e){} }',
      /* 자격 증명은 굽지 않고 런타임에 읽는다 — .tql은 파일 API로 읽히므로 비밀번호를
         박으면 노출 면이 하나 더 는다. 앱이 쓰는 파일이 없으면 앱과 같은 기본 계정으로 붙는다. */
      'function wdLogin(){ var u="SYS", p="MANAGER";',
      '  try{ var fs=require("@jsh/fs"); var a=JSON.parse(String(fs.readFile(WD_AUTH))); if(a&&a.user){ u=a.user; p=a.password||""; } }catch(e){}',
      '  var tok="";',
      '  try{ $.request(WD_BASE+"/web/api/login",{method:"POST",headers:{"Content-Type":"application/json"},',
      '    body:JSON.stringify({loginName:u,password:p})}).do(function(r){ if(r.status===200) r.text(function(t){',
      '      try{ tok=JSON.parse(String(t)).accessToken||""; }catch(e){} }); }); }catch(e){}',
      '  return tok; }',
      'function wdStart(name){ var tok=wdLogin(); if(!tok) return false; var ok=false;',
      '  try{ $.request(WD_BASE+"/web/api/timers/"+name+"/state",{method:"POST",',
      '    headers:{"Authorization":"Bearer "+tok,"Content-Type":"application/json"},',
      '    body:JSON.stringify({state:"start"})}).do(function(r){ ok=(r.status===200); }); }catch(e){}',
      '  return ok; }',
      /* 감시가 본체를 죽이면 본말전도다 — 여기서 나는 어떤 오류도 삼킨다.
         now를 인자로 받지 않는 이유는 대역 쪽 now가 생성 시각으로 구워져 있어서다. */
      'function wdTick(db){ var out=[];',
      '  for(var i=0;i<WD_TARGETS.length;i++){ var t=WD_TARGETS[i];',
      '    try{ var d=__wdDecide(wdGet(db,t.hb), wdGet(db,t.key), Date.now(), t.cfg);',
      '      if(!d.act){ out.push(t.peer+":"+d.why); continue; }',
      '      var ok=wdStart(t.peer); d.w.ok=!!ok; wdPut(db,t.key,d.w);',
      '      out.push(t.peer+":"+(ok?"restarted":"failed"));',
      '    }catch(e){ out.push(t.peer+":err"); } }',
      '  return out.join(","); }',
    ];
  }

  /* 심박 한 줄 — "언제 몇 건 했는가". 상대는 이 시각의 나이만 본다.
     타이머가 RUNNING인데 실제로는 아무것도 안 하는 경우까지 잡으려면 상태가 아니라 이게 필요하다. */
  function hbSrc(key, nExpr) {
    return 'try{ wdPut(db,' + JSON.stringify(String(key)) + ',{t:Date.now(),n:' + (nExpr || '0') + '}); }catch(e){}';
  }

  /* 감시자 전용 TQL — 하는 일이 이것뿐이라 죽을 거리가 거의 없다.
     자기 심박도 남긴다: 감시자가 멎으면 감시·대역 추출 쪽이 이걸 보고 되살린다. */
  function buildWatchdogTql(o) {
    return ['SCRIPT({', 'var db=$.db();']
      .concat(wdSrc(o))
      .concat([hbSrc(o.selfHb, '0'), '$.yield("wd", wdTick(db));', '})', 'CSV()'])
      .join('\n');
  }

  return { wdDecide: wdDecide, wdSrc: wdSrc, hbSrc: hbSrc, buildWatchdogTql: buildWatchdogTql };
});
