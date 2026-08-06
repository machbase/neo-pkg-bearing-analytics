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

  /* 1 kHz 위는 옥타브로 쪼갠다. 통짜로 두면 25.6 kHz 센서에서 1~12.8 kHz가 한 칸이라
     3.7 옥타브가 섞인다 — 베어링 공진(보통 2~5 kHz)이 두 배로 커져도 넓은 통에 희석돼
     배수가 안 올라간다. 이름은 샘플레이트와 무관하게 고정이고, Nyquist를 넘어 잴 수 없는
     칸은 0으로 저장된다(학습이 전부 0인 대역을 거부하고 판정은 한계 0인 대역을 건너뛴다). */
  var BAND_NAMES = ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4'];
  // 창은 2의 거듭제곱 샘플이 되게 잡는다 — FFT가 그 길이를 쓰고, 클라이언트 계산과도 일치한다.
  var WIN_POW = 15; // 2^15 = 32,768 샘플 (25.6 kHz에서 1.28초 · 1 kHz에서 32.8초)

  // fr(회전주파수) 기준 대역 경계 — live.js의 정의와 반드시 같아야 한다(두 벌이면 값이 어긋난다)
  function bandsFor(fr, nyq) {
    return [
      [2, Math.max(3, 0.5 * fr)],
      [Math.max(2, 0.5 * fr), 1.5 * fr],
      [1.5 * fr, Math.min(1000, 10 * fr)],
      [Math.min(1000, 10 * fr), 1000],
      [1000, 2000],
      [2000, 4000],
      [4000, 8000],
      [8000, nyq],
    ];
  }

  /* 대역 RMS 계산 — 이 함수 하나가 값의 정의다. TQL에 소스로 박히므로 바깥 이름을
     참조하지 않는다(참조하면 타이머 첫 회차에서 ReferenceError로 죽는다).

     Welch: 창을 겹쳐 나눠 FFT한 뒤 평균한다. FFT 한 번의 스펙트럼은 자체 분산이 100%라
     — 같은 정상 신호를 두 번 재도 대역값이 눈에 띄게 다르다 — 그 흔들림이 대역 베이스라인의
     σ를 부풀려 한계를 느슨하게 만든다. K블록 평균은 분산을 √K배 줄여, 같은 σ로 더 작은
     변화를 잡게 한다.

     Hann 창: FFT는 창의 양끝이 이어진다고 가정한다. 안 이어지면 그 불연속이 모든 주파수로
     번져(누설), 1×의 큰 성분이 베어링 대역까지 들어올린다. 창으로 양끝을 0으로 눕히면
     누설이 줄지만 신호를 깎으므로, 잡음대역폭 NG=Σw²/L로 나눠 크기를 되돌린다
     (사각창이면 NG=1이라 옛 식과 같아진다 — 정의가 이어진다는 확인점이다).

     대가는 분해능이다: 블록이 짧아진 만큼 df가 커진다. 대역이 넓어 선 스펙트럼이 아니라
     통과대역 에너지를 보는 용도라 감당 가능하지만, 짧은 창(m<4096)에서는 블록을 쪼개지
     않고 창만 씌운다 — 거기서 더 쪼개면 최저 대역에 빈이 남지 않는다. */
  function bandEnergy(vals, fs, fr, nyq) {
    var m = 1; while (m * 2 <= vals.length) m *= 2;
    if (m < 256 || !(fs > 0)) return null;
    var L = m;
    var i, W = new Array(L), wss = 0;
    for (i = 0; i < L; i++) { W[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / L); wss += W[i] * W[i]; }
    var NG = wss / L;
    var B = [
      [2, Math.max(3, 0.5 * fr)],
      [Math.max(2, 0.5 * fr), 1.5 * fr],
      [1.5 * fr, Math.min(1000, 10 * fr)],
      [Math.min(1000, 10 * fr), 1000],
      [1000, 2000],
      [2000, 4000],
      [4000, 8000],
      [8000, nyq],
    ];
    var half = L / 2, df = fs / L, acc = [0, 0, 0, 0, 0, 0, 0, 0];
    var re = new Array(L), im = new Array(L);
    function fft(re, im) {
      var n = re.length, j = 0, bit, len, i2;
      for (i2 = 1; i2 < n; i2++) {
        for (bit = n >> 1; j & bit; bit >>= 1) j ^= bit;
        j |= bit;
        if (i2 < j) { var tr = re[i2]; re[i2] = re[j]; re[j] = tr; var ti = im[i2]; im[i2] = im[j]; im[j] = ti; }
      }
      for (len = 2; len <= n; len <<= 1) {
        var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (var st = 0; st < n; st += len) {
          var cr = 1, ci = 0;
          for (var k = 0; k < len / 2; k++) {
            var a = st + k, b = st + k + len / 2;
            var vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
            re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
            var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
          }
        }
      }
    }
    var mean = 0;
    for (i = 0; i < L; i++) mean += vals[i];
    mean /= L;
    // 평균을 뺀 뒤 창을 씌운다 — 순서가 바뀌면 직류가 창 모양 그대로 저주파에 실린다
    for (i = 0; i < L; i++) { re[i] = (vals[i] - mean) * W[i]; im[i] = 0; }
    fft(re, im);
    for (var k = 1; k <= half - 1; k++) {
      var f = k * df, pw = re[k] * re[k] + im[k] * im[k];
      for (var b = 0; b < B.length; b++) if (f >= B[b][0] && f < B[b][1]) { acc[b] += pw; break; }
    }
    var out = [];
    for (var b2 = 0; b2 < acc.length; b2++) out.push(Math.sqrt(2 * acc[b2] / (L * L * NG)));
    return out;
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
      'var ' + bandEnergy.name + '=' + bandEnergy.toString() + ';',
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
      // 대역값의 정의는 bandEnergy 하나뿐 — 앱·서버·테스트가 같은 소스를 쓴다
      '  var vv=bandEnergy(vals, t.fs, t.fr, t.fs/2);',
      '  if(!vv) return;',
      '  var fr=t.fr;',
      '  var ts=dt(maxMs);',
      /* 측정 불가 대역(하한이 Nyquist 이상)도 0으로 저장한다 — 행을 빼면 "측정 불가"인지
         "타이머가 안 돌았는지" 구분이 안 된다. 정확히 0은 그 대역에 FFT 빈이 하나도 없다는
         뜻이라(성분이 있으면 아주 작아도 0이 아니다) 빈 대역의 신뢰할 만한 표시가 된다.
         0을 정상으로 오해하는 것은 저장이 아니라 학습·판정에서 막는다:
         학습은 전부 0인 대역을 거부하고, bandJudge는 한계 0인 대역을 건너뛴다. */
      '  for(var b=0;b<vv.length;b++){',
      '    var v=vv[b];',
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

  return { buildBandTql: buildBandTql, BAND_NAMES: BAND_NAMES, WIN_POW: WIN_POW, bandsFor: bandsFor, bandEnergy: bandEnergy };
});
