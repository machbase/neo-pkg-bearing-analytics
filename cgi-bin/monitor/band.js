// monitor/band.js — 대역 에너지 추출 TQL 생성기.
// 선택된 태그마다 짧은 원시 창을 서버에서 FFT해 대역 RMS를 구하고 NEO_VIBE_BAND(TAG)에 적재한다.
//
// 왜 서버에서 하나: 대역값 하나를 얻으려고 원시 11 MB를 브라우저로 옮길 이유가 없다.
//   서버에서 계산하면 숫자 6개만 오간다. 앱이 닫혀 있어도 추세가 이어져야 하므로 타이머로 돈다.
// 왜 알람 타이머와 분리하나: 판정은 10초 주기가 좋고 대역 추출은 FFT라 40대면 20초가 든다.
//   주기를 묶으면 둘 다 나빠지고, 한쪽이 죽으면 다른 쪽도 멈춘다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(
    typeof require === 'function' ? require('./watchdog.js') : root.VibeWatchdog);
  else root.VibeBand = factory(root.VibeWatchdog);
})(typeof self !== 'undefined' ? self : this, function (WD) {
  'use strict';

  var BAND_NAMES = ['sub', 'one', 'fault', 'high', 'vhigh'];
  // 창은 2의 거듭제곱 샘플이 되게 잡는다 — FFT가 그 길이를 쓰고, 클라이언트 계산과도 일치한다.
  var WIN_POW = 15; // 2^15 = 32,768 샘플 (25.6 kHz에서 1.28초 · 1 kHz에서 32.8초)

  // fr(회전주파수) 기준 대역 경계 — live.js의 정의와 반드시 같아야 한다(두 벌이면 값이 어긋난다)
  function bandsFor(fr, nyq) {
    return [
      [2, Math.max(3, 0.5 * fr)],
      [Math.max(2, 0.5 * fr), 1.5 * fr],
      [1.5 * fr, Math.min(1000, 10 * fr)],
      [Math.min(1000, 10 * fr), 1000],
      [1000, nyq],
    ];
  }

  /* spec: { tags:[{tbl,tag,fr,fs}], nowMs, anchors } → 자체 완결형 TQL 문자열.
     태그마다 SQL→FFT→SCRIPT 블록을 만들고, 결과를 NEO_VIBE_BAND에 INSERT 한다.
     dryRun이면 INSERT 대신 $.yield로 값만 방출(검증용).

     anchors(ms 배열)를 주면 각 시각을 창의 끝으로 삼아 그만큼 반복한다 — 과거 채우기(백필)용.
     안 주면 태그의 MAX_TIME 하나만 쓴다(타이머의 평소 동작). 계산부는 완전히 같아서
     백필 값과 타이머 값이 같은 규칙으로 나온다 — 이게 두 구간을 이어 학습할 수 있는 근거다. */
  function buildBandTql(spec) {
    spec = spec || {};
    var tags = spec.tags || [];
    var dry = !!spec.dryRun;
    if (!tags.length) return '';
    // TQL은 파이프라인 하나만 실행되므로, 태그별 조회를 SCRIPT 안에서 db().query로 돈다.
    // (FFT() 스테이지는 파이프라인당 하나뿐이라 태그마다 파이프를 만들 수 없다 → goja에서 직접 FFT)
    var body = [
      'SCRIPT({',
      'var TAGS=' + JSON.stringify(tags.map(function (t) {
        return { tbl: t.tbl, tag: t.tag, fr: t.fr, fs: t.fs, win: Math.pow(2, WIN_POW) };
      })) + ';',
      'var NAMES=' + JSON.stringify(BAND_NAMES) + ';',
      // null이면 태그마다 MAX_TIME 하나(타이머), 배열이면 그 시각들을 창 끝으로 반복(백필)
      'var ANCHORS=' + (spec.anchors && spec.anchors.length ? JSON.stringify(spec.anchors.map(Number)) : 'null') + ';',
      'var db=$.db(), now=' + (Number(spec.nowMs) || Date.now()) + ', nOk=0;',
      'function esc(s){return String(s).replace(/\'/g,"\'\'");}',
      // 시각 문자열(밀리초 포함) — sqlDate와 같은 규약
      'function pad(n,w){var s=""+n;while(s.length<w)s="0"+s;return s;}',
      'function dt(ms){var d=new Date(ms);return pad(d.getFullYear(),4)+"-"+pad(d.getMonth()+1,2)+"-"+pad(d.getDate(),2)+" "+pad(d.getHours(),2)+":"+pad(d.getMinutes(),2)+":"+pad(d.getSeconds(),2)+" "+pad(d.getMilliseconds(),3);}',
      /* DATETIME 컬럼은 goja에서 Time 객체로 온다 — 숫자도 문자열도 아니고 .getTime()/.UnixNano()도 없다.
         Number()는 NaN이 되므로 문자열("2025-11-24 10:19:26.099961088 +0900 KST")을 직접 파싱한다.
         이 빌드의 확인된 유일한 경로다(다른 방법을 쓰면 조용히 NaN이 되어 태그가 통째로 스킵된다). */
      'function tms(v){ var s=String(v); var m=/^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d+))?/.exec(s); if(!m) return 0;',
      '  var frac=m[7]?("0."+m[7]):"0";',
      '  return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]).getTime() + Math.round(parseFloat(frac)*1000); }',
      'TAGS.forEach(function(t){',
      '  if(!(t.fs>0)||!(t.fr>0)) return;',
      '  var durMs = Math.round(t.win / t.fs * 1000);',
      // 최신 데이터 시각을 먼저 확인 — 정지 설비의 옛 구간을 긁지 않기 위해
      '  var anch=ANCHORS;',
      '  if(!anch){',
      '    var mx=0;',
      '    db.query("select MAX_TIME from V$"+t.tbl+"_STAT where NAME=\'"+esc(t.tag)+"\'").forEach(function(r){ mx=tms(r[0]); });',
      '    if(!(mx>0)) return;',
      '    anch=[mx];',
      '  }',
      '  anch.forEach(function(maxMs){',
      /* 이 앵커를 이미 저장했으면 통째로 건너뛴다 — 원본 읽기·FFT·저장 전부.

         소스에 새 데이터가 안 들어오면 MAX_TIME이 그 자리에 멈추는데, 타이머는 계속 돈다.
         그러면 매 회차 같은 시각에 같은 값을 다시 계산해 넣는다(적재가 끝난 정적 테이블은
         영원히). 저장이 늘어나는 것보다 학습이 망가지는 게 크다 — 같은 값이 반복되면
         대역 베이스라인의 σ가 0으로 붕괴해 한계가 μ에 붙고, 값이 조금만 움직여도 이탈이 된다.

         앵커 하나당 6키(대역 5 + fr)를 함께 쓰므로 대표로 첫 키만 확인하면 된다.
         백필 경로는 앱이 bandTimes로 이미 걸러 보내지만, 여기서도 막아 두 경로가 같게 동작한다. */
      /* dry run은 쓰지 않으므로 이 검사를 하지 않는다 — 하면 이미 저장된 앵커에서
         미리보기가 빈 결과로 나와 검증이 통과 여부를 못 가린다. */
      dry ? '' : '  var seen=0;',
      dry ? '' : '  try { db.query("select count(*) from NEO_VIBE_BAND where NAME=\'"+esc(t.tbl+":"+t.tag+":"+NAMES[0])+"\' and TIME between to_date(\'"+dt(maxMs)+"\') and to_date(\'"+dt(maxMs)+"\')")',
      // 표가 아직 없거나 조회가 실패하면 중복을 감수하고 진행한다 — 감시가 통째로 죽는 것보다 낫다
      dry ? '' : '    .forEach(function(r){ seen=+r[0]; }); } catch(e) { seen=0; }',
      dry ? '' : '  if(seen>0) return;',
      '  var fromMs = maxMs - durMs;',
      '  var vals=[];',
      '  db.query("select VALUE from "+t.tbl+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dt(fromMs)+"\') and to_date(\'"+dt(maxMs)+"\') order by TIME")',
      '    .forEach(function(r){ vals.push(+r[0]); });',
      '  if(vals.length < 1024) return;',
      // 2의 거듭제곱으로 맞춘 뒤 실수 FFT(반복 radix-2)
      '  var m=1; while(m*2<=vals.length) m*=2;',
      '  var re=new Array(m), im=new Array(m), i, mean=0;',
      '  for(i=0;i<m;i++) mean+=vals[i]; mean/=m;',
      '  for(i=0;i<m;i++){ re[i]=vals[i]-mean; im[i]=0; }',
      '  (function(){',
      '    var n=re.length,j=0,bit,len;',
      '    for(i=1;i<n;i++){ for(bit=n>>1; j&bit; bit>>=1) j^=bit; j|=bit; if(i<j){var tr=re[i];re[i]=re[j];re[j]=tr;var ti=im[i];im[i]=im[j];im[j]=ti;} }',
      '    for(len=2;len<=n;len<<=1){ var ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);',
      '      for(var s=0;s<n;s+=len){ var cr=1,ci=0;',
      '        for(var k=0;k<len/2;k++){ var i1=s+k,i2=s+k+len/2;',
      '          var vr=re[i2]*cr-im[i2]*ci, vi=re[i2]*ci+im[i2]*cr;',
      '          re[i2]=re[i1]-vr; im[i2]=im[i1]-vi; re[i1]+=vr; im[i1]+=vi;',
      '          var ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr; } } }',
      '  })();',
      '  var nyq=t.fs/2, fr=t.fr;',
      '  var B=[[2,Math.max(3,0.5*fr)],[Math.max(2,0.5*fr),1.5*fr],[1.5*fr,Math.min(1000,10*fr)],[Math.min(1000,10*fr),1000],[1000,nyq]];',
      '  var half=m/2, df=t.fs/m, acc=[0,0,0,0,0];',
      '  for(var k=1;k<=half-1;k++){ var f=k*df, p=re[k]*re[k]+im[k]*im[k];',
      '    for(var b=0;b<B.length;b++) if(f>=B[b][0] && f<B[b][1]) { acc[b]+=p; break; } }',
      '  var ts=dt(maxMs);',
      /* 측정 불가 대역(하한이 Nyquist 이상)도 0으로 저장한다 — 행을 빼면 "측정 불가"인지
         "타이머가 안 돌았는지" 구분이 안 된다. 정확히 0은 그 대역에 FFT 빈이 하나도 없다는
         뜻이라(성분이 있으면 아주 작아도 0이 아니다) 빈 대역의 신뢰할 만한 표시가 된다.
         0을 정상으로 오해하는 것은 저장이 아니라 학습·판정에서 막는다:
         학습은 전부 0인 대역을 거부하고, bandJudge는 한계 0인 대역을 건너뛴다. */
      '  for(var b=0;b<acc.length;b++){',
      '    var v=Math.sqrt(2*acc[b]/(m*m));',
      dry
        ? '    $.yield("band", t.tbl+":"+t.tag+":"+NAMES[b], v);'
        : '    db.exec("insert into NEO_VIBE_BAND values(\'"+esc(t.tbl+":"+t.tag+":"+NAMES[b])+"\', to_date(\'"+ts+"\'), "+v+")");',
      '  }',
      dry
        ? '  $.yield("fr", t.tbl+":"+t.tag+":fr", fr);'
        : '  db.exec("insert into NEO_VIBE_BAND values(\'"+esc(t.tbl+":"+t.tag+":fr")+"\', to_date(\'"+ts+"\'), "+fr+")");',
      '  nOk++;',
      '  });',
      '});',
      /* 심박과 상호 감시 — 타이머로 돌 때만 붙인다(백필·미리보기는 타이머가 아니다).
         대역 값이 안 쌓이는 회차에도 심박은 남긴다: 상대가 보는 것은 "돌았는가"지 "일했는가"가 아니다. */
      (!dry && spec.wd) ? WD.wdSrc(spec.wd).join('\n') : '',
      (!dry && spec.wd) ? WD.hbSrc(spec.wd.selfHb, 'nOk') : '',
      (!dry && spec.wd) ? 'var _wd=wdTick(db);' : '',
      '$.yield("done", now, nOk);',
      '})',
      'CSV()',
    ];
    return body.join('\n');
  }

  return { buildBandTql: buildBandTql, BAND_NAMES: BAND_NAMES, WIN_POW: WIN_POW, bandsFor: bandsFor };
});
