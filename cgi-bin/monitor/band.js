// monitor/band.js — 대역 에너지 추출 TQL 생성기.
// 선택된 태그마다 짧은 원시 창을 서버에서 FFT해 대역 RMS를 구하고 BAND(TAG)에 적재한다.
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
  /* 회전수를 모르면 1× 상대 대역(sub·one·fault·high)은 정의 자체가 없다. 폭 0으로 돌려주면
     에너지가 0이 되어 학습이 그 대역을 거부하고 판정이 건너뛴다 — 이미 있는 경로를 그대로 탄다.
     추측한 fr로 경계를 그으면 네 대역이 전부 엉뚱한 곳을 재면서 값은 멀쩡해 보인다. */
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
  /* opt: { demod:[lo,hi], bf:{O,I,B,F} } — 주면 포락선 지표를 함께 낸다.
     demod는 복조 대역(Hz)이고 앱이 정해 값으로 굽는다. 여기서 커토그램을 다시 돌리지 않는 이유는
     둘이다: (1) 필터뱅크라 비싸고 (2) 앵커마다 다른 대역을 고르면 추세가 무의미해진다 —
     매번 다른 것을 재게 된다. bf는 결함주파수의 회전주파수 배수 계수(calc.faultCoeffs). */
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
    // 평균을 뺀 뒤 창을 씌운다 — 순서가 바뀌면 직류가 창 모양 그대로 저주파에 실린다
    for (i = 0; i < L; i++) { re[i] = (vals[i] - mean) * W[i]; im[i] = 0; }
    fft(re, im);
    /* 1× 실측 — 명판 ±12% 안의 로컬 최대. 명판은 동기속도라 슬립·부하만큼 늘 어긋나고,
       가변속이면 아예 다른 값이 된다. 대역 경계가 1× 상대(0.5×·1.5×·10×)라 fr이 어긋나면
       대역이 통째로 밀려 다른 성분을 재게 된다 — 값은 계속 나오므로 눈에 띄지도 않는다.
       규칙은 calc.measuredOneX와 같다(±12%·진짜 로컬 최대·잡음 바닥의 3배). 다만 여기는
       바깥 이름을 참조할 수 없어(임베드 소스) 같은 규칙을 이 스펙트럼 위에 다시 쓴다.
       잡음 바닥은 전역이 아니라 창 주변에서 잡는다 — 25 kHz 대역까지 포함한 전역 중앙값은
       저주파 판단에 쓸 기준이 아니다. 못 찾으면 0을 돌려 명판을 그대로 쓴다. */
    function meas1x() {
      if (!(fr > 0)) return 0;
      var i0 = Math.max(1, Math.ceil(fr * 0.88 / df)), i1 = Math.floor(fr * 1.12 / df);
      if (i1 <= i0 || i1 >= half - 1) return 0;   // 창이 한 빈도 안 되면 분해능이 모자란다
      var mag = function (k) { return Math.sqrt(re[k] * re[k] + im[k] * im[k]); };
      var bi = -1, bm = 0, k;
      for (k = i0; k <= i1; k++) { var v = mag(k); if (v > bm) { bm = v; bi = k; } }
      if (bi < 1 || bi >= half - 1) return 0;
      var y0 = mag(bi - 1), y1 = bm, y2 = mag(bi + 1);
      if (y0 > y1 || y2 > y1) return 0;           // 창 경계에 걸린 사면이지 봉우리가 아니다
      var w = (i1 - i0 + 1) * 3, n0 = Math.max(1, i0 - w), n1 = Math.min(half - 1, i1 + w);
      var nb = []; for (k = n0; k <= n1; k++) nb.push(mag(k));
      nb.sort(function (p, q) { return p - q; });
      var med = nb[nb.length >> 1] || 0;
      /* 바닥의 8배 — 잡음만 있어도 창 안 최댓값은 중앙값의 4배쯤 나온다(레일리 분포).
         3배로 잡으면 잡음 봉우리가 통과해 앵커마다 다른 fr을 물고, 그 흔들림이 그대로
         대역 경계의 흔들림이 되어 학습 σ를 부풀린다 — 고치려던 문제를 다시 만드는 셈이다.
         긴 창에서 진짜 1× 선은 바닥의 수십~수백 배라 8배로도 놓치지 않는다.
         1×가 약한 설비(잘 정렬된 기계)는 못 찾고 명판으로 떨어지는데, 그게 안전한 쪽이다. */
      if (!(y1 >= med * 8)) return 0;
      /* 저주파 최댓값의 2% — 깨끗한 신호의 부동소수 반올림 잡음도 국소적으로는 봉우리 모양이라 위 검사를 통과하므로 거른다.
         기준을 전대역이 아니라 10× 이하로 두는 이유: 가속도는 f²로 커져 전대역 최댓값이 고주파에 있어,
         그걸 기준 삼으면 멀쩡한 1×가 늘 미달로 떨어진다. */
      var lfHi = Math.min(half - 1, Math.floor(Math.min(10 * fr, nyq) / df)), lf = 0;
      for (k = Math.max(1, Math.ceil(2 / df)); k <= lfHi; k++) { var lv = mag(k); if (lv > lf) lf = lv; }
      if (!(y1 >= lf * 0.02)) return 0;
      // 포물선 보간 — 빈 간격이 25.6 kHz·32k점에서 0.78 Hz라, 30 Hz 근처에서 그대로 쓰면 2.6% 오차다
      var den = y0 - 2 * y1 + y2, d = den !== 0 ? (y0 - y2) / (2 * den) : 0;
      if (!(d > -1 && d < 1)) d = 0;
      return (bi + d) * df;
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

    /* 포락선 복조 — 베어링 결함은 볼이 흠집을 때릴 때마다 구조 공진(수 kHz)을 울린다.
       원시 스펙트럼에는 "고주파 에너지가 있다"까지만 보이고 "몇 Hz로 두들기나"는 안 보인다
       (그 값은 스펙트럼 선이 아니라 진폭 변조로 숨어 있다). 복조하면 그 반복주파수가 선으로 나온다.
       고주파가 센 것과 주기적으로 두들기는 것은 다르다 — 캐비테이션·유동 잡음은 앞만, 베어링
       결함은 둘 다다. 그 구분이 이 계산의 존재 이유다.

       이미 구한 FFT를 재활용한다: 통과대역의 양의 주파수만 남겨 역변환하면 해석신호가 되고,
       그 크기가 포락선이다(대역통과와 힐베르트를 한 번에). 시간영역에서 필터를 새로 돌리는 것보다
       싸고, 대역 경계가 정확하다. */
    function envelope() {
      if (!opt || !opt.demod) return null;
      var k0 = Math.max(1, Math.ceil(opt.demod[0] / df)), k1 = Math.min(half - 1, Math.floor(opt.demod[1] / df));
      if (k1 <= k0 + 4) return null;   // 통과대역에 빈이 몇 개 없으면 포락선이 성립하지 않는다
      var j, ar = new Array(L), ai = new Array(L);
      for (j = 0; j < L; j++) { ar[j] = 0; ai[j] = 0; }
      for (j = k0; j <= k1; j++) { ar[j] = 2 * re[j]; ai[j] = 2 * im[j]; }   // 음의 주파수를 버리고 2배 = 해석신호
      for (j = 0; j < L; j++) ai[j] = -ai[j];                                 // 역변환 = 켤레→정변환→켤레→/L
      fft(ar, ai);
      /* 포락선은 이미 Hann이 씌워진 신호에서 나오므로 창이 한 번 더 필요 없다 —
         |해석신호(x·w)| ≈ env(x)·w라 포락선 자체가 창을 물고 나온다. */
      var e = new Array(L), em = 0;
      for (j = 0; j < L; j++) { var er0 = ar[j] / L, ei0 = -ai[j] / L; e[j] = Math.sqrt(er0 * er0 + ei0 * ei0); em += e[j]; }
      em /= L;
      /* 평균(DC)을 빼는 것이 핵심이다. 안 빼면 이 값은 그 대역의 평균 진폭 — 곧 vh2/vh3 대역
         에너지의 복사본이 되어 같은 정보를 두 번 저장하게 된다. AC 성분만이 "변조의 세기"다. */
      var ac = 0, er = new Array(L), ei = new Array(L);
      for (j = 0; j < L; j++) { var d0 = e[j] - em; ac += d0 * d0; er[j] = d0; ei[j] = 0; }
      var acRms = Math.sqrt(ac / L / NG);
      fft(er, ei);
      var amp = function (kk) { return Math.sqrt(2 * (er[kk] * er[kk] + ei[kk] * ei[kk]) / (L * L * NG)); };
      // 2 Hz 아래는 창 모양이 만드는 저주파라 뺀다. 위는 결함주파수 3× 하모닉이 들어올 만큼만 본다.
      var kMin = Math.max(1, Math.ceil(2 / df)), kMax = Math.min(half - 1, Math.floor(Math.min(1000, nyq) / df));
      if (kMax <= kMin) return { pkRel: 0, f0: 0, harm: 0, O: 0, I: 0, B: 0, F: 0 };
      var nb = [], pk = 0, pi = -1;
      for (j = kMin; j <= kMax; j++) { var av = amp(j); nb.push(av); if (av > pk) { pk = av; pi = j; } }
      nb.sort(function (p, q) { return p - q; });
      var med = nb[nb.length >> 1] || 0;
      var thr = Math.max(pk * 0.15, med * 4);
      var f0 = (pi > 0 && pk >= thr) ? pi * df : 0;
      /* 주기성의 정도 — 포락선 스펙트럼이 얼마나 뾰족한가(지배 피크 ÷ 중앙값). 무차원이다.
         품번이 없어 어느 주파수를 볼지 모를 때 쓰는 판정값이다.

         진폭이 아니라 비율인 이유는 둘이다. (1) 포락선의 진폭 계열은 대역 에너지의 상수배라
         vh2/vh3와 정보가 겹친다 — 결함이든 잡음이든 대역이 세지면 같이 커진다. 판별하는 것은
         크기가 아니라 뾰족함이다: 광대역 잡음의 포락선은 무작위로 출렁여 피크가 중앙값의 5~7배에
         머물고, 주기적 충격은 한 주파수에 몰려 수십~수천 배로 솟는다. (2) 무차원이라 부하가
         변해 신호가 통째로 커져도 값이 안 변한다 — 베이스라인 σ가 작아져 작은 변화를 잡는다. */
      var pkRel = med > 0 ? pk / med : 0;
      // 하모닉 수 — 정수배로 나란히 서면 우연이 아니다. 품번이 없어도 이것만으로 결함성을 가른다.
      var harm = 0;
      if (f0 > 0) for (j = 2; j <= 5; j++) {
        var fh0 = f0 * j; if (fh0 > kMax * df) break;
        var t0 = Math.max(0.01 * j * fh0, 2 * df), best0 = 0, q0;
        for (q0 = Math.max(kMin, Math.ceil((fh0 - t0) / df)); q0 <= Math.min(kMax, Math.floor((fh0 + t0) / df)); q0++) { var w0 = amp(q0); if (w0 > best0) best0 = w0; }
        if (best0 >= thr) harm++;
      }
      /* 결함주파수 진폭은 1~3× 하모닉의 제곱합 — 한 줄이 우연히 걸릴 수는 있어도 정수배로
         나란히 서는 건 우연이 아니다. 허용오차를 차수에 비례시키는 이유는 구름 미끄러짐 때문이다:
         실측 BPFO는 계산값에서 1~2% 벗어나고, 3×에서는 그 오차가 3배로 벌어진다. */
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

    // fr을 함께 돌려준다 — 경계를 정한 값이 무엇인지 모르면 저장된 대역값을 나중에 해석할 수 없다
    return { vals: out, fr: frUse, meas: frM > 0, env: envelope() };
  }

  /* spec: { tags:[{tbl,tag,fr,fs}], nowMs, anchors } → 자체 완결형 TQL 문자열.
     태그마다 SQL→FFT→SCRIPT 블록을 만들고, 결과를 BAND에 INSERT 한다.
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
      // 앱 저장소는 계정 스키마에 있다 — 접두가 없으면 서버가 다른 테이블을 보게 된다
      'var TBLP=' + JSON.stringify(spec.tblPrefix || '') + ';',
      'var UPFX=' + JSON.stringify(spec.keyPrefix || '') + ';',
      /* 데이터 표는 대개 남(SYS)의 소유다 — 접두 없는 이름은 접속 계정 스키마에서 찾으므로
         타이머가 SYS 가 아니면 조용히 "없는 표"가 되어 회차가 0건으로 끝난다(try/catch 가 삼킨다).
         키는 짧은 이름을 그대로 쓰고, 조회할 때만 수식된 이름으로 바꾼다. */
      'var SRC=' + JSON.stringify(spec.srcMap || {}) + ';',
      'function srcOf(t){ return SRC[t]||t; }',
      'function statOf(t){ var s=srcOf(t), i=s.lastIndexOf("."); return i<0 ? "V$"+s+"_STAT" : s.slice(0,i+1)+"V$"+s.slice(i+1)+"_STAT"; }',
      'var TAGS=' + JSON.stringify(tags.map(function (t) {
        // demod·bf는 앱이 정해 값으로 굽는다 — 서버는 커토그램도 베어링 형상표도 갖고 있지 않다
        return { tbl: t.tbl, tag: t.tag, fr: t.fr, fs: t.fs, win: Math.pow(2, WIN_POW),
          demod: t.demod || null, bf: t.bf || null };
      })) + ';',
      'var NAMES=' + JSON.stringify(BAND_NAMES) + ';',
      /* 고정 별칭으로 받는다 — 압축기가 함수 이름을 바꿔도 바깥에서 부르는 이름은 그대로다.
         .name을 쓰면 선언과 호출이 같은 값을 참조해야 하는 규칙이 생기는데, 한 곳만 어겨도
         압축 후에만 드러나는 ReferenceError가 된다(테스트는 통과하고 배포본만 죽는다). */
      'var __bandEnergy=' + bandEnergy.toString() + ';',
      // null이면 태그마다 MAX_TIME 하나(타이머), 배열이면 그 시각들을 창 끝으로 반복(백필)
      'var ANCHORS=' + (spec.anchors && spec.anchors.length ? JSON.stringify(spec.anchors.map(Number)) : 'null') + ';',
      /* 백필 앵커의 격자 간격. 앵커가 수집 공백에 떨어졌을 때 되짚을 범위이자, 이미 채운 칸을
         가려내는 단위다. 타이머 경로는 앵커가 MAX_TIME 하나뿐이라 0(되짚기·구간 중복검사 없음). */
      'var GRID=' + (spec.anchors && spec.anchors.length ? Math.max(0, Number(spec.grid) || 0) : 0) + ';',
      /* 회차 전체를 감싼다 — 예외가 밖으로 나가면 Neo 가 타이머를 STOP 으로 두고 재시도하지 않는다.
         대역 추출은 원본을 읽고 FFT 까지 돌아 실패할 자리가 많다. */
      'try {',
      'var db=$.db(), now=' + (Number(spec.nowMs) || Date.now()) + ', nOk=0;',
      'function esc(s){return String(s).replace(/\'/g,"\'\'");}',
      // 시각 문자열(밀리초 포함) — sqlDate와 같은 규약
      'function pad(n,w){var s=""+n;while(s.length<w)s="0"+s;return s;}',
      'function dt(ms){var d=new Date(ms);return pad(d.getFullYear(),4)+"-"+pad(d.getMonth()+1,2)+"-"+pad(d.getDate(),2)+" "+pad(d.getHours(),2)+":"+pad(d.getMinutes(),2)+":"+pad(d.getSeconds(),2)+" "+pad(d.getMilliseconds(),3);}',
      /* DATETIME 컬럼은 goja에서 Time 객체로 온다 — 숫자도 문자열도 아니고 .getTime()/.UnixNano()도 없다.
         Number()는 NaN이 되므로 문자열("YYYY-MM-DD HH:MM:SS.ns +0900 KST")을 직접 파싱한다
         (다른 방법을 쓰면 조용히 NaN이 되어 태그가 통째로 스킵된다). */
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
      /* 없는 테이블·태그는 그 태그만 건너뛴다 — 태그 목록이 값으로 구워져 있어, 소스가 바뀌거나
         옛 TQL이 남으면 이 조회가 예외를 던진다. 감싸지 않으면 스크립트가 통째로 끝나
         멀쩡한 나머지 태그의 대역 추출까지 멈춘다(타이머는 STOP으로 죽는다). */
      '    try { db.query("select MAX_TIME from "+statOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\'").forEach(function(r){ mx=tms(r[0]); }); } catch(e) { return; }',
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
      /* 되짚기가 붙으면 저장 시각이 앵커와 달라진다 — 앵커 한 점만 보면 매번 못 찾아 같은 구간을
         다시 계산하고 값이 쌓인다. 그래서 백필은 격자 한 칸 안에 이미 값이 있는지로 판단한다. */
      dry ? '' : '  var seen=0, dLo = GRID>0 ? (maxMs-GRID) : maxMs;',
      dry ? '' : '  try { db.query("select count(*) from "+TBLP+"BAND where NAME=\'"+esc(UPFX+t.tbl+":"+t.tag+":"+NAMES[0])+"\' and TIME between to_date(\'"+dt(dLo)+"\') and to_date(\'"+dt(maxMs)+"\')")',
      // 표가 아직 없거나 조회가 실패하면 중복을 감수하고 진행한다 — 감시가 통째로 죽는 것보다 낫다
      dry ? '' : '    .forEach(function(r){ seen=+r[0]; }); } catch(e) { seen=0; }',
      dry ? '' : '  if(seen>0) return;',
      '  var fromMs = maxMs - durMs;',
      '  var vals=[];',
      // 원본 조회도 같다 — 없는 테이블이면 이 앵커만 버리고 다음 태그로 간다
      '  try { db.query("select VALUE from "+srcOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dt(fromMs)+"\') and to_date(\'"+dt(maxMs)+"\') order by TIME")',
      '    .forEach(function(r){ vals.push(+r[0]); }); } catch(e) { return; }',
      /* 간헐 수집(예: 10분마다 1초) 대응 — 백필 앵커는 벽시계 격자(정각·10분·20분…)에 맞춰 만들어지는데
         수집 시각은 그 격자와 무관하다. 그대로 두면 앵커가 거의 전부 수집 공백에 떨어져 백필이 한 건도
         못 쌓고, 대역 베이스라인이 영영 학습되지 않아 근거 축 중 대역만 조용히 죽는다.
         비었으면 앵커 이전에서 표본이 실제로 있는 마지막 초로 한 번만 당겨 다시 읽는다.
         하한은 격자 한 칸 — 더 가면 여러 앵커가 같은 구간을 겹쳐 재 추세가 같은 값의 반복이 되고,
         그러면 σ가 붕괴해 한계가 μ에 붙는다(중복 저장을 막는 이유와 같다).
         타이머 경로(GRID=0)는 앵커가 이미 MAX_TIME이라 되짚을 필요가 없어 건너뛴다. */
      '  if(vals.length < 1024 && GRID > 0){',
      '    var snapMs=0;',
      '    try { db.query("select ROLLUP(\'sec\',1,TIME) RT, COUNT(VALUE) CNT from "+srcOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dt(maxMs-GRID)+"\') and to_date(\'"+dt(maxMs)+"\') group by RT order by RT desc limit 1")',
      '      .forEach(function(r){ if(+r[1]>0) snapMs=tms(r[0]); }); } catch(e) { snapMs=0; }',
      '    if(snapMs>0){',
      '      maxMs = snapMs + 1000;',   // 그 초의 끝까지 창에 넣는다
      '      fromMs = maxMs - durMs;',
      '      vals=[];',
      '      try { db.query("select VALUE from "+srcOf(t.tbl)+" where NAME=\'"+esc(t.tag)+"\' and TIME between to_date(\'"+dt(fromMs)+"\') and to_date(\'"+dt(maxMs)+"\') order by TIME")',
      '        .forEach(function(r){ vals.push(+r[0]); }); } catch(e) { return; }',
      '    }',
      '  }',
      '  if(vals.length < 1024) return;',
      // 대역값의 정의는 bandEnergy 하나뿐 — 앱·서버·테스트가 같은 소스를 쓴다
      '  var vv=__bandEnergy(vals, t.fs, t.fr, t.fs/2, {demod:t.demod, bf:t.bf});',
      '  if(!vv) return;',
      /* 저장하는 fr은 명판이 아니라 이 앵커의 경계를 실제로 정한 값이다 — 실측이 되면 실측값,
         못 찾았으면 명판. 그래야 나중에 대역값을 그때의 회전수로 되짚을 수 있고, 이 계열
         자체가 회전수 추세가 된다. */
      '  var fr=vv.fr;',
      '  var ts=dt(maxMs);',
      /* 측정 불가 대역(하한이 Nyquist 이상)도 0으로 저장한다 — 행을 빼면 "측정 불가"인지
         "타이머가 안 돌았는지" 구분이 안 된다. 정확히 0은 그 대역에 FFT 빈이 하나도 없다는
         뜻이라(성분이 있으면 아주 작아도 0이 아니다) 빈 대역의 신뢰할 만한 표시가 된다.
         0을 정상으로 오해하는 것은 저장이 아니라 학습·판정에서 막는다:
         학습은 전부 0인 대역을 거부하고, bandJudge는 한계 0인 대역을 건너뛴다. */
      '  for(var b=0;b<vv.vals.length;b++){',
      '    var v=vv.vals[b];',
      dry
        ? '    $.yield("band", t.tbl+":"+t.tag+":"+NAMES[b], v);'
        : '    db.exec("insert into "+TBLP+"BAND values(\'"+esc(UPFX+t.tbl+":"+t.tag+":"+NAMES[b])+"\', to_date(\'"+ts+"\'), "+v+")");',
      '  }',
      dry
        ? '  $.yield("fr", t.tbl+":"+t.tag+":fr", fr);'
        : '  db.exec("insert into "+TBLP+"BAND values(\'"+esc(UPFX+t.tbl+":"+t.tag+":fr")+"\', to_date(\'"+ts+"\'), "+fr+")");',
      /* 포락선 지표 — 결함주파수 4종은 베어링 품번이 있을 때만 넣는다.
         측정 불가 대역을 0으로 남기는 규칙(위)과 다른 이유: 대역은 샘플레이트가 정하는 물리적
         사실이라 "잴 수 없음"과 "안 돌았음"을 구분해 둘 값이 있지만, 품번 미지정은 설정 화면에서
         바로 보이는 상태다. 4계열을 0으로 영구히 쌓는 것은 행 수만 33% 늘린다. */
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
      '});',
      /* 심박과 상호 감시 — 타이머로 돌 때만 붙인다(백필·미리보기는 타이머가 아니다).
         대역 값이 안 쌓이는 회차에도 심박은 남긴다: 상대가 보는 것은 "돌았는가"지 "일했는가"가 아니다. */
      (!dry && spec.selfHb) ? WD.hbOnlySrc(spec.selfHb, 'nOk') : '',
      '$.yield("done", now, nOk);',
      '} catch(e) { $.yield("error", Date.now(), 0); }',
      '})',
      'CSV()',
    ];
    return body.join('\n');
  }

  return { buildBandTql: buildBandTql, BAND_NAMES: BAND_NAMES, WIN_POW: WIN_POW, bandsFor: bandsFor, bandEnergy: bandEnergy };
});
