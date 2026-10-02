// monitor/band.js — 대역 에너지 추출 TQL 생성기
// 선택 태그마다 짧은 원시 창을 서버에서 FFT해 대역 RMS·포락선 지표를 구하고 BAND(TAG)에 적재
// 서버 계산(원시 파형 전송 불필요·앱 없이 추세 유지), 판정 타이머와 주기·실패 분리
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(
    typeof require === 'function' ? require('./watchdog.js') : root.VibeWatchdog);
  else root.VibeBand = factory(root.VibeWatchdog);
})(typeof self !== 'undefined' ? self : this, function (WD) {
  'use strict';

  /* 1 kHz 위는 옥타브 분할(넓은 한 칸이면 베어링 공진 증가가 희석됨). 이름은 샘플레이트와 무관하게 고정,
     Nyquist 너머 칸은 0 저장(학습은 전부 0인 대역 거부, 판정은 한계 0인 대역 생략) */
  var BAND_NAMES = ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4'];
  // 창은 2의 거듭제곱 샘플(FFT 길이, 클라이언트 계산과 일치)
  var WIN_POW = 15; // 2^15 = 32,768 샘플 (25.6 kHz에서 1.28초 · 1 kHz에서 32.8초)

  // fr(회전주파수) 기준 대역 경계 — live.js 정의와 일치 필요
  // 회전수를 모르면 1× 상대 대역(sub·one·fault·high)은 폭 0(학습 거부·판정 생략) — 추측 fr로 경계를 긋지 않음
  function bandsFor(fr, nyq) {
    if (!(fr > 0)) return [[0, 0], [0, 0], [0, 0], [0, 0], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]]
      .map(function (b, i) { return i < 4 ? b : [Math.min(b[0], nyq), Math.min(b[1], nyq)]; });
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

  /* 대역 RMS 계산 — 값의 유일한 정의. TQL에 소스로 박히므로 바깥 이름 참조 금지(첫 회차 ReferenceError).
     최대 2의 거듭제곱 길이 한 블록에 Hann 창 → FFT, 잡음대역폭 NG=Σw²/L로 크기 보정 */
  /* opt: { demod:[lo,hi], bf:{O,I,B,F}, lineHz } — demod·bf를 주면 포락선 지표도 산출.
     demod = 복조 대역(Hz, 앱이 고정값으로 전달 — 앵커마다 바뀌면 추세 무의미),
     bf = 결함주파수의 회전주파수 배수 계수(calc.faultCoeffs), lineHz = 계통주파수(1× 실측에서 거부) */
  function bandEnergy(vals, fs, fr, nyq, opt) {
    var m = 1; while (m * 2 <= vals.length) m *= 2;
    if (m < 256 || !(fs > 0)) return null;
    var L = m;
    var i, W = new Array(L), wss = 0;
    for (i = 0; i < L; i++) { W[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / L); wss += W[i] * W[i]; }
    var NG = wss / L;
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
    // 평균 제거 후 창 적용(순서가 바뀌면 직류가 저주파로 샘)
    for (i = 0; i < L; i++) { re[i] = (vals[i] - mean) * W[i]; im[i] = 0; }
    fft(re, im);
    /* 1× 실측 — 입력 RPM ±5%(유도전동기 슬립 통상 ≤5%) 안의 로컬 최대, 계통주파수(opt.lineHz) 1.5 분해능 안이면 거부.
       calc.measuredOneX와 같은 규칙(임베드 소스라 여기서 다시 구현). 잡음 바닥은 창 주변 중앙값.
       범위를 넓히면 벨트로 이어진 모터 등 다른 회전체 봉우리를 1×로 잡음. 못 찾으면 0 → 입력 RPM 사용 */
    function meas1x() {
      if (!(fr > 0)) return 0;
      var i0 = Math.max(1, Math.ceil(fr * 0.95 / df)), i1 = Math.floor(fr * 1.05 / df);
      if (i1 <= i0 || i1 >= half - 1) return 0;   // 분해능 부족·범위 초과
      var mag = function (k) { return Math.sqrt(re[k] * re[k] + im[k] * im[k]); };
      var bi = -1, bm = 0, k;
      for (k = i0; k <= i1; k++) { var v = mag(k); if (v > bm) { bm = v; bi = k; } }
      if (bi < 1 || bi >= half - 1) return 0;
      var y0 = mag(bi - 1), y1 = bm, y2 = mag(bi + 1);
      if (y0 > y1 || y2 > y1) return 0;           // 창 경계의 사면(봉우리 아님)
      var w = (i1 - i0 + 1) * 3, n0 = Math.max(1, i0 - w), n1 = Math.min(half - 1, i1 + w);
      var nb = []; for (k = n0; k <= n1; k++) nb.push(mag(k));
      nb.sort(function (p, q) { return p - q; });
      var med = nb[nb.length >> 1] || 0;
      // 바닥의 8배 이상 — 잡음만으로도 창 안 최댓값이 중앙값의 약 4배(레일리 분포). 약한 1×는 명판으로 폴백
      if (!(y1 >= med * 8)) return 0;
      /* 저주파(10× 이하) 최댓값의 2% 이상 — 반올림 잡음 봉우리 제거.
         기준이 전대역이면 가속도(f²)의 고주파 최댓값에 1×가 늘 미달 */
      var lfHi = Math.min(half - 1, Math.floor(Math.min(10 * fr, nyq) / df)), lf = 0;
      for (k = Math.max(1, Math.ceil(2 / df)); k <= lfHi; k++) { var lv = mag(k); if (lv > lf) lf = lv; }
      if (!(y1 >= lf * 0.02)) return 0;
      // 포물선 보간으로 빈 간격 오차 보정
      var den = y0 - 2 * y1 + y2, d = den !== 0 ? (y0 - y2) / (2 * den) : 0;
      if (!(d > -1 && d < 1)) d = 0;
      var fm = (bi + d) * df, lh = opt && opt.lineHz > 0 ? opt.lineHz : 0;
      // 2극 전동기(fr≈59 Hz)가 60 Hz 전기 성분에 고정되는 것 방지
      if (lh > 0 && Math.abs(fm - lh) <= 1.5 * df) return 0;
      return fm;
    }
    var frM = meas1x(), frUse = frM > 0 ? frM : fr;
    var B = [
      [2, Math.max(3, 0.5 * frUse)],
      [Math.max(2, 0.5 * frUse), 1.5 * frUse],
      [1.5 * frUse, Math.min(1000, 10 * frUse)],
      [Math.min(1000, 10 * frUse), 1000],
      [1000, 2000],
      [2000, 4000],
      [4000, 8000],
      [8000, nyq],
    ];
    for (var k2 = 1; k2 <= half - 1; k2++) {
      var f = k2 * df, pw = re[k2] * re[k2] + im[k2] * im[k2];
      for (var b = 0; b < B.length; b++) if (f >= B[b][0] && f < B[b][1]) { acc[b] += pw; break; }
    }
    var out = [];
    for (var b2 = 0; b2 < acc.length; b2++) out.push(Math.sqrt(2 * acc[b2] / (L * L * NG)));

    /* 포락선 복조 — 결함 충격의 반복주파수(진폭 변조)를 선으로 드러냄(고주파 잡음과 주기적 충격 구분).
       기존 FFT 재활용: 통과대역 양의 주파수만 남겨 역변환 = 해석신호, 그 크기 = 포락선 */
    function envelope() {
      if (!opt || !opt.demod) return null;
      var k0 = Math.max(1, Math.ceil(opt.demod[0] / df)), k1 = Math.min(half - 1, Math.floor(opt.demod[1] / df));
      if (k1 <= k0 + 4) return null;   // 통과대역 빈이 너무 적으면 불성립
      var j, ar = new Array(L), ai = new Array(L);
      for (j = 0; j < L; j++) { ar[j] = 0; ai[j] = 0; }
      for (j = k0; j <= k1; j++) { ar[j] = 2 * re[j]; ai[j] = 2 * im[j]; }   // 음의 주파수를 버리고 2배 = 해석신호
      for (j = 0; j < L; j++) ai[j] = -ai[j];                                 // 역변환 = 켤레→정변환→켤레→/L
      fft(ar, ai);
      // 창 재적용 불필요 — |해석신호(x·w)| ≈ env(x)·w
      var e = new Array(L), em = 0;
      for (j = 0; j < L; j++) { var er0 = ar[j] / L, ei0 = -ai[j] / L; e[j] = Math.sqrt(er0 * er0 + ei0 * ei0); em += e[j]; }
      em /= L;
      // DC 제거 필수 — 안 빼면 대역 에너지(vh2/vh3)의 복사본, AC 성분만이 변조 세기
      var ac = 0, er = new Array(L), ei = new Array(L);
      for (j = 0; j < L; j++) { var d0 = e[j] - em; ac += d0 * d0; er[j] = d0; ei[j] = 0; }
      var acRms = Math.sqrt(ac / L / NG);
      fft(er, ei);
      var amp = function (kk) { return Math.sqrt(2 * (er[kk] * er[kk] + ei[kk] * ei[kk]) / (L * L * NG)); };
      // 2 Hz 미만(창 모양 성분) 제외, 상한 1 kHz(결함주파수 3× 하모닉 포함 범위)
      var kMin = Math.max(1, Math.ceil(2 / df)), kMax = Math.min(half - 1, Math.floor(Math.min(1000, nyq) / df));
      if (kMax <= kMin) return { pkRel: 0, f0: 0, harm: 0, O: 0, I: 0, B: 0, F: 0 };
      var nb = [], pk = 0, pi = -1;
      for (j = kMin; j <= kMax; j++) { var av = amp(j); nb.push(av); if (av > pk) { pk = av; pi = j; } }
      nb.sort(function (p, q) { return p - q; });
      var med = nb[nb.length >> 1] || 0;
      var thr = Math.max(pk * 0.15, med * 4);
      var f0 = (pi > 0 && pk >= thr) ? pi * df : 0;
      /* 주기성 정도 pkRel = 지배 피크 ÷ 중앙값(무차원) — 품번 없이 쓰는 판정값.
         진폭 대신 비율: 대역 에너지와 정보 중복 없음, 부하 변화에 불변 */
      var pkRel = med > 0 ? pk / med : 0;
      // 하모닉 수 — 정수배 정렬은 결함성 근거(품번 불필요)
      var harm = 0;
      if (f0 > 0) for (j = 2; j <= 5; j++) {
        var fh0 = f0 * j; if (fh0 > kMax * df) break;
        var t0 = Math.max(0.01 * j * fh0, 2 * df), best0 = 0, q0;
        for (q0 = Math.max(kMin, Math.ceil((fh0 - t0) / df)); q0 <= Math.min(kMax, Math.floor((fh0 + t0) / df)); q0++) { var w0 = amp(q0); if (w0 > best0) best0 = w0; }
        if (best0 >= thr) harm++;
      }
      // 결함주파수 진폭 = 1~3× 하모닉 제곱합. 허용오차는 차수에 비례(구름 미끄러짐으로 1~2% 벗어남)
      function harmSum(coef) {
        if (!(coef > 0) || !(frUse > 0)) return 0;
        var f1 = coef * frUse, s = 0, h;
        for (h = 1; h <= 3; h++) {
          var fh = f1 * h; if (fh < 2 || fh > kMax * df) break;
          var tol = Math.max(0.01 * h * fh, 2 * df), best = 0, q;
          for (q = Math.max(kMin, Math.ceil((fh - tol) / df)); q <= Math.min(kMax, Math.floor((fh + tol) / df)); q++) { var wv = amp(q); if (wv > best) best = wv; }
          s += best * best;
        }
        return Math.sqrt(s);
      }
      var bf = opt.bf || null;
      return { pkRel: pkRel, f0: f0, harm: harm,
        O: bf ? harmSum(bf.O) : 0, I: bf ? harmSum(bf.I) : 0, B: bf ? harmSum(bf.B) : 0, F: bf ? harmSum(bf.F) : 0 };
    }

    // 경계를 정한 fr도 반환(저장값 해석용)
    return { vals: out, fr: frUse, meas: frM > 0, env: envelope() };
  }

  /* spec: { tags:[{tbl,tag,fr,fs,demod,bf}], nowMs, anchors, grid } → 자체 완결형 TQL 문자열.
     SCRIPT 하나에서 태그마다 원본 조회 → bandEnergy → BAND INSERT. dryRun이면 $.yield로 값만 방출.
     anchors(ms 배열) = 창 끝 시각들(백필), 없으면 태그 MAX_TIME 하나(타이머) — 계산부는 동일 */
  function buildBandTql(spec) {
    spec = spec || {};
    var tags = spec.tags || [];
    var dry = !!spec.dryRun;
    if (!tags.length) return '';
    // TQL은 파이프라인 하나·FFT() 스테이지 하나 → 태그별 조회·FFT를 SCRIPT(goja) 안에서 직접
    var body = [
      'SCRIPT({',
      // 표 접두 TBLP(공용 스키마)·행 키 접두 UPFX(계정)
      'var TBLP=' + JSON.stringify(spec.tblPrefix || '') + ';',
      'var UPFX=' + JSON.stringify(spec.keyPrefix || '') + ';',
      /* 데이터 표 수식 이름 대응표 — 비-SYS 타이머는 접두 없는 이름이 조용히 0건.
         키는 짧은 이름, 조회 때만 수식 */
      'var SRC=' + JSON.stringify(spec.srcMap || {}) + ';',
      'function srcOf(t){ return SRC[t]||t; }',
      'function statOf(t){ var s=srcOf(t), i=s.lastIndexOf("."); return i<0 ? "V$"+s+"_STAT" : s.slice(0,i+1)+"V$"+s.slice(i+1)+"_STAT"; }',
      'var TAGS=' + JSON.stringify(tags.map(function (t) {
        // demod·bf는 앱이 계산해 값으로 전달(서버엔 커토그램·베어링 형상표 없음)
        return { tbl: t.tbl, tag: t.tag, fr: t.fr, fs: t.fs, win: Math.pow(2, WIN_POW),
          demod: t.demod || null, bf: t.bf || null };
      })) + ';',
      'var NAMES=' + JSON.stringify(BAND_NAMES) + ';',
      // 고정 별칭으로 대입 — 압축기가 함수 이름을 바꿔도 호출 이름 유지
      'var __bandEnergy=' + bandEnergy.toString() + ';',
      // null이면 태그마다 MAX_TIME 하나(타이머), 배열이면 그 시각들을 창 끝으로 반복(백필)
      'var ANCHORS=' + (spec.anchors && spec.anchors.length ? JSON.stringify(spec.anchors.map(Number)) : 'null') + ';',
      // 백필 앵커 격자 간격 — 수집 공백 되짚기 범위·기존 칸 판별 단위. 타이머 경로는 0
      'var GRID=' + (spec.anchors && spec.anchors.length ? Math.max(0, Number(spec.grid) || 0) : 0) + ';',
      // 회차 전체를 try로 감쌈 — Neo 타이머는 예외 한 번에 STOP, 재시도 없음
      'try {',
      'var db=$.db(), now=' + (Number(spec.nowMs) || Date.now()) + ', nOk=0, T0=Date.now();',
      // 회차 상태 기록(errAdd·stPut) — 판정 타이머와 같은 조각
      WD.statusSrc(),
      'function esc(s){return String(s).replace(/\'/g,"\'\'");}',
      // 로컬 시각 문자열(밀리초 포함) — to_date 인자용
      'function pad(n,w){var s=""+n;while(s.length<w)s="0"+s;return s;}',
      'function dt(ms){var d=new Date(ms);return pad(d.getFullYear(),4)+"-"+pad(d.getMonth()+1,2)+"-"+pad(d.getDate(),2)+" "+pad(d.getHours(),2)+":"+pad(d.getMinutes(),2)+":"+pad(d.getSeconds(),2)+" "+pad(d.getMilliseconds(),3);}',
      /* DATETIME은 goja에서 Time 객체(.getTime()/.UnixNano() 없음, Number()는 NaN)
         → 문자열 "YYYY-MM-DD HH:MM:SS.ns +0900 KST"를 직접 파싱 */
      'function tms(v){ var s=String(v); var m=/^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d+))?/.exec(s); if(!m) return 0;',
      '  var frac=m[7]?("0."+m[7]):"0";',
      '  return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]).getTime() + Math.round(parseFloat(frac)*1000); }',
      'TAGS.forEach(function(t){',
      // 태그 격리 — 한 태그의 조회·저장 실패가 나머지 태그 추출을 막지 않음
      'try {',
      '  if(!(t.fs>0)||!(t.fr>0)) return;',
      '  var durMs = Math.round(t.win / t.fs * 1000);',
      // 타이머 경로 앵커 = 태그의 최신 데이터 시각(MAX_TIME)
      '  var anch=ANCHORS;',
      '  if(!anch){',
      '    var mx=0;',
      // 없는 테이블·태그는 그 태그만 건너뜀(예외가 스크립트 전체를 멈추지 않게)
      '    try { db.query("select MAX_TIME from "+statOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\'").forEach(function(r){ mx=tms(r[0]); }); } catch(e) { errAdd("tag_fail", t.tbl+":"+t.tag+" — "+e, 1); return; }',
      '    if(!(mx>0)) return;',
      '    anch=[mx];',
      '  }',
      '  anch.forEach(function(maxMs){',
      /* 이미 저장한 앵커면 건너뜀 — 정지한 소스는 MAX_TIME이 멈춰 같은 값이 반복 저장되고 학습 σ가 0으로 붕괴.
         앵커당 키를 함께 쓰므로 첫 키만 확인. 백필은 되짚기로 저장 시각이 달라져 격자 한 칸 안을 확인.
         dry run은 검사 생략 */
      dry ? '' : '  var seen=0, dLo = GRID>0 ? (maxMs-GRID) : maxMs;',
      dry ? '' : '  try { db.query("select count(*) from "+TBLP+"BAND where NAME=\'"+esc(UPFX+t.tbl+":"+t.tag+":"+NAMES[0])+"\' and TIME between to_date(\'"+dt(dLo)+"\') and to_date(\'"+dt(maxMs)+"\')")',
      // 조회 실패 시 중복을 감수하고 진행
      dry ? '' : '    .forEach(function(r){ seen=+r[0]; }); } catch(e) { seen=0; }',
      dry ? '' : '  if(seen>0) return;',
      '  var fromMs = maxMs - durMs;',
      '  var vals=[];',
      // 원본 조회 실패 시 이 앵커 건너뜀
      '  try { db.query("select VALUE from "+srcOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dt(fromMs)+"\') and to_date(\'"+dt(maxMs)+"\') order by TIME")',
      '    .forEach(function(r){ vals.push(+r[0]); }); } catch(e) { errAdd("tag_fail", t.tbl+":"+t.tag+" — "+e, 1); return; }',
      /* 간헐 수집 대응(백필만) — 앵커가 수집 공백이면 격자 한 칸 안에서 표본이 있는 마지막 초로 1회 당겨 재조회.
         한 칸을 넘기면 앵커끼리 구간이 겹쳐 σ 붕괴 */
      '  if(vals.length < 1024 && GRID > 0){',
      '    var snapMs=0;',
      '    try { db.query("select ROLLUP(\'sec\',1,TIME) RT, COUNT(VALUE) CNT from "+srcOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dt(maxMs-GRID)+"\') and to_date(\'"+dt(maxMs)+"\') group by RT order by RT desc limit 1")',
      '      .forEach(function(r){ if(+r[1]>0) snapMs=tms(r[0]); }); } catch(e) { snapMs=0; }',
      '    if(snapMs>0){',
      '      maxMs = snapMs + 1000;',   // 그 초의 끝까지 창에 포함
      '      fromMs = maxMs - durMs;',
      '      vals=[];',
      '      try { db.query("select VALUE from "+srcOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dt(fromMs)+"\') and to_date(\'"+dt(maxMs)+"\') order by TIME")',
      '        .forEach(function(r){ vals.push(+r[0]); }); } catch(e) { errAdd("tag_fail", t.tbl+":"+t.tag+" — "+e, 1); return; }',
      '    }',
      '  }',
      '  if(vals.length < 1024) return;',
      // 대역값 정의는 bandEnergy 하나(앱·서버 공용 소스)
      '  var vv=__bandEnergy(vals, t.fs, t.fr, t.fs/2, {demod:t.demod, bf:t.bf, lineHz:t.lineHz});',
      '  if(!vv) return;',
      // 저장 fr = 이 앵커의 경계를 정한 값(실측, 없으면 명판) — 회전수 추세 겸용
      '  var fr=vv.fr;',
      '  var ts=dt(maxMs);',
      // 측정 불가 대역(하한 ≥ Nyquist)도 0으로 저장 — "측정 불가"와 "미실행" 구분, 0은 학습·판정에서 제외
      '  for(var b=0;b<vv.vals.length;b++){',
      '    var v=vv.vals[b];',
      dry
        ? '    $.yield("band", t.tbl+":"+t.tag+":"+NAMES[b], v);'
        : '    db.exec("insert into "+TBLP+"BAND values(\'"+esc(UPFX+t.tbl+":"+t.tag+":"+NAMES[b])+"\', to_date(\'"+ts+"\'), "+v+")");',
      '  }',
      dry
        ? '  $.yield("fr", t.tbl+":"+t.tag+":fr", fr);'
        : '  db.exec("insert into "+TBLP+"BAND values(\'"+esc(UPFX+t.tbl+":"+t.tag+":fr")+"\', to_date(\'"+ts+"\'), "+fr+")");',
      // 포락선 지표 — 결함주파수 4종은 베어링 품번(bf)이 있을 때만 저장
      '  if(vv.env){',
      '    var EK=[["envPkRel","pkRel"],["envF0","f0"],["envHarm","harm"]];',
      '    if(t.bf) EK=EK.concat([["envBPFO","O"],["envBPFI","I"],["envBSF","B"],["envFTF","F"]]);',
      '    for(var q=0;q<EK.length;q++){ var ev=vv.env[EK[q][1]];',
      '      if(!(ev>=0)) continue;',
      dry
        ? '      $.yield("env", t.tbl+":"+t.tag+":"+EK[q][0], ev);'
        : '      db.exec("insert into "+TBLP+"BAND values(\'"+esc(UPFX+t.tbl+":"+t.tag+":"+EK[q][0])+"\', to_date(\'"+ts+"\'), "+ev+")");',
      '    }',
      '  }',
      '  nOk++;',
      '  });',
      '} catch(e) { errAdd("tag_fail", t.tbl+":"+t.tag+" — "+e, 1); }',
      '});',
      // 회차 상태 — 타이머 실행 때만(백필·미리보기 제외), 값이 안 쌓인 회차·실패 회차에도 기록
      (!dry && spec.statusKey) ? 'stPut(' + JSON.stringify(spec.statusKey) + ',{t:Date.now(), ms:Date.now()-T0, n:nOk, err:ERRS});' : '',
      '$.yield("done", now, nOk);',
      '} catch(e) {',
      (!dry && spec.statusKey)
        ? '  try { errAdd("round", e, 1); stPut(' + JSON.stringify(spec.statusKey) + ',{t:Date.now(), ms:Date.now()-T0, n:nOk, err:ERRS}); } catch(e2) {}'
        : '',
      '  $.yield("error", Date.now(), 0);',
      '}',
      '})',
      'CSV()',
    ];
    return body.join('\n');
  }

  return { buildBandTql: buildBandTql, BAND_NAMES: BAND_NAMES, WIN_POW: WIN_POW, bandsFor: bandsFor, bandEnergy: bandEnergy };
});
