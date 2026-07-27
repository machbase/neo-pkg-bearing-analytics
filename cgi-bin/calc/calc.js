// calc/index.js — 진동 계산 코어 (순수 JS · fetch/DOM 없음)
// 프론트(Vite import)와 jsh(require) 겸용 UMD. 계산 로직의 단일 소스 — 여기만 수정한다.
// (frontend/src/engine/vibe-engine.js 안의 ISO/BEARINGS 사본은 mock 데모 전용)
//
// 제공: ISO 존/등급 · 베어링 결함주파수 · 롤업 버킷(RMS/P2P/Crest) · 커토시스 ·
//       FFT(radix-2) · 진폭 스펙트럼 · 포락선 스펙트럼 · 켑스트럼 · STFT(스펙트로그램) ·
//       대역 에너지 · 시간영역 지표 · 지배주파수 규칙 진단
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- ISO 10816 / 단위별 존 ---------------- */
  var ISO_ZONES = { I: [0.71, 1.8, 4.5], II: [1.12, 2.8, 7.1], III: [1.8, 4.5, 11.2], IV: [2.8, 7.1, 18.0] };
  var UNIT_ZONES = { 'mm/s': null, 'g': [0.5, 1.0, 2.0], 'μm': [12, 25, 50] };
  function zonesFor(unit, cls) {
    if (unit === 'mm/s') return ISO_ZONES[cls] || ISO_ZONES.II;
    return UNIT_ZONES[unit] || ISO_ZONES.II;
  }
  function gradeFor(v, zones) { return v < zones[0] ? 0 : v < zones[1] ? 1 : v < zones[2] ? 2 : 3; }

  /* ---------------- 베어링 ---------------- */
  var BEARINGS = {
    '6206': { n: 9, Bd: 9.5, Pd: 46.0, phi: 0 }, '6208': { n: 9, Bd: 12.7, Pd: 60.0, phi: 0 },
    '6209': { n: 9, Bd: 12.7, Pd: 65.0, phi: 0 }, '6310': { n: 8, Bd: 19.0, Pd: 82.0, phi: 0 },
    '6311': { n: 8, Bd: 20.6, Pd: 90.0, phi: 0 }, '6312': { n: 8, Bd: 22.2, Pd: 97.0, phi: 0 },
    '6313': { n: 8, Bd: 23.8, Pd: 102, phi: 0 }, '6314': { n: 8, Bd: 25.0, Pd: 110, phi: 0 },
    '6315': { n: 8, Bd: 25.0, Pd: 115, phi: 0 }, '6316': { n: 8, Bd: 26.5, Pd: 123, phi: 0 },
    '22218': { n: 14, Bd: 20.0, Pd: 130, phi: 12 }, '23124': { n: 17, Bd: 25.0, Pd: 165, phi: 10 },
    'NU312': { n: 12, Bd: 20.0, Pd: 96.5, phi: 0 }, 'NU316': { n: 11, Bd: 26.0, Pd: 127, phi: 0 },
    'sleeve': { n: 0, Bd: 0, Pd: 0, phi: 0 }
  };
  function bearingFreqs(rpm, b) {
    var fr = rpm / 60, ratio = b.Pd > 0 ? (b.Bd / b.Pd) * Math.cos(b.phi * Math.PI / 180) : 0;
    return {
      fr: fr, x1: fr, x2: 2 * fr, x3: 3 * fr,
      FTF: (fr / 2) * (1 - ratio),
      BPFO: (b.n / 2) * fr * (1 - ratio),
      BPFI: (b.n / 2) * fr * (1 + ratio),
      BSF: b.Bd > 0 ? (b.Pd / (2 * b.Bd)) * fr * (1 - ratio * ratio) : 0
    };
  }

  // 결함 주파수 요약(설정탭 칩 표시용): rpm + bearing → { fr, sleeve, list:[[label,Hz],…] }
  function faultFreqSummary(rpm, b) {
    var fr = rpm / 60;
    if (!b || !b.n) return { fr: fr, sleeve: true, list: [['1×', fr], ['2×', 2 * fr]] };
    var f = bearingFreqs(rpm, b);
    return { fr: fr, sleeve: false, list: [['BPFO', f.BPFO], ['BPFI', f.BPFI], ['BSF', f.BSF], ['FTF', f.FTF]] };
  }

  /* ---------------- 롤업 버킷 / 통계 ---------------- */
  // /db/query 롤업 행 [ms, SUMSQ, COUNT, MIN, MAX] → {ms, rms, p2p, crest, cnt}
  function toBucket(r) {
    var cnt = r[2];
    if (!cnt) return null;
    var rms = Math.sqrt(Math.max(0, r[1]) / cnt);
    var mn = r[3], mx = r[4];
    return { ms: r[0], rms: rms, p2p: mx - mn, crest: rms > 0 ? Math.max(Math.abs(mn), Math.abs(mx)) / rms : 0, cnt: cnt };
  }

  function kurtosis(values) {
    var n = values.length;
    if (n < 8) return 3;
    var mean = 0, i;
    for (i = 0; i < n; i++) mean += values[i];
    mean /= n;
    var m2 = 0, m4 = 0;
    for (i = 0; i < n; i++) { var d = values[i] - mean, d2 = d * d; m2 += d2; m4 += d2 * d2; }
    m2 /= n; m4 /= n;
    return m2 > 0 ? m4 / (m2 * m2) : 3;
  }

  function fmt(v) {
    var a = Math.abs(v);
    return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  }

  // 원시 파형 → 시간영역 지표 4종 (index 1=커토시스는 진단 규칙이 참조하므로 순서 고정)
  function timeIndics(values, unit) {
    if (!values.length) return [];
    var ss = 0, peak = 0, i;
    for (i = 0; i < values.length; i++) { ss += values[i] * values[i]; var a = Math.abs(values[i]); if (a > peak) peak = a; }
    var rms = Math.sqrt(ss / values.length);
    var crest = rms > 0 ? peak / rms : 0;
    var kurt = kurtosis(values);
    return [
      { k: 'RMS (원시파형·표시구간)', v: fmt(rms), hint: unit, desc: '표시 구간 원시 파형의 실효값 (롤업 RMS와 별개)' },
      { k: '커토시스 (Kurtosis·원시파형)', v: kurt.toFixed(2), hint: kurt > 4.5 ? '충격성 경계 초과' : '', desc: '3=정규분포 · 클수록 충격성 결함 신호' },
      { k: 'Peak (원시파형)', v: fmt(peak), hint: unit, desc: '구간 내 최대 순간 진폭' },
      { k: 'Crest Factor (원시파형)', v: crest.toFixed(2), hint: crest > 6 ? '높음' : '', desc: 'Peak/RMS · 충격성 지표 (롤업 Crest와 별개)' }
    ];
  }

  /* ---------------- FFT (radix-2, in-place) ---------------- */
  function fftComplex(re, im) {
    var n = re.length, i, j, bit, len;
    for (i = 1, j = 0; i < n; i++) {
      for (bit = n >> 1; j & bit; bit >>= 1) j ^= bit;
      j |= bit;
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (var s = 0; s < n; s += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var i1 = s + k, i2 = s + k + len / 2;
          var vr = re[i2] * cr - im[i2] * ci;
          var vi = re[i2] * ci + im[i2] * cr;
          re[i2] = re[i1] - vr; im[i2] = im[i1] - vi;
          re[i1] += vr; im[i1] += vi;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // 밴드 커토시스: 고주파 대역(≥loHz)만 남긴 신호의 커토시스. 회전 성분(1×·하모닉)을 제거해
  // 베어링·기어 충격의 임펄스성만 평가한다(원파형 커토시스보다 결함 특이도가 높음).
  // FFT로 저주파 빈을 0으로 만든 뒤 역FFT(켤레 트릭)로 시간영역 복원.
  function bandKurtosis(values, fs, loHz) {
    var n = values.length;
    if (n < 64 || !(fs > 0)) return null;
    var m = 1; while (m * 2 <= n) m *= 2; // radix-2 크기
    var re = values.slice(0, m), im = new Array(m), i, orig = 0;
    for (i = 0; i < m; i++) { orig += re[i] * re[i]; im[i] = 0; }
    var origRms = Math.sqrt(orig / m);
    if (!(origRms > 0)) return null;
    fftComplex(re, im);
    var df = fs / m, loBin = Math.max(1, Math.round(loHz / df));
    if (loBin >= m / 2) return null; // 컷오프가 Nyquist 근처면 무의미
    re[0] = 0; im[0] = 0; // DC 제거
    for (var k = 1; k < loBin; k++) { re[k] = 0; im[k] = 0; re[m - k] = 0; im[m - k] = 0; } // 저주파 양측 제거
    for (i = 0; i < m; i++) im[i] = -im[i];   // 역FFT: conj → fft → (real)/m
    fftComplex(re, im);
    var out = new Array(m), fe = 0;
    for (i = 0; i < m; i++) { var x = re[i] / m; out[i] = x; fe += x * x; }
    // 고주파 대역 에너지가 미미하면(정상·임펄스 없음) 커토시스가 수치적으로 불안정 → 판단 불가
    if (Math.sqrt(fe / m) < 0.02 * origRms) return null;
    return kurtosis(out);
  }

  // 신호 품질 체크 — 분석 전에 "이 데이터를 믿어도 되나"를 본다(garbage-in 방어).
  //  · flatline: 값이 거의 안 변함 → 센서 정지/케이블 탈락 (진동 있어도 0으로 "정상" 오판)
  //  · clip: 최대·최소값이 과도하게 반복 → 포화(측정범위 초과) → 진폭 과소·가짜 고주파
  //  · dc: 평균이 진폭 대비 큼 → DC 드리프트(가짜 RMS 상승)
  //  반환 { ok, issues:[{key,label,detail}], severe(판정 신뢰 불가 수준) }
  function signalQuality(values, fs) {
    var n = values.length, issues = [];
    if (n < 32) return { ok: false, issues: [{ key: 'sparse', label: '데이터 부족', detail: '샘플이 너무 적어 분석 신뢰도가 낮습니다' }], severe: true };
    var mn = Infinity, mx = -Infinity, sum = 0, i;
    for (i = 0; i < n; i++) { var v = values[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    var mean = sum / n, range = mx - mn;
    var ss = 0; for (i = 0; i < n; i++) { var d = values[i] - mean; ss += d * d; }
    var std = Math.sqrt(ss / n), peak = Math.max(Math.abs(mn), Math.abs(mx));
    // flatline: 표준편차가 피크 대비 극히 작음(거의 상수)
    if (peak === 0 || std < 1e-9 || (peak > 0 && std < 0.002 * peak)) {
      issues.push({ key: 'flatline', label: '플랫라인', detail: '값이 거의 변하지 않습니다 — 센서 정지·케이블 탈락 의심' });
      return { ok: false, issues: issues, severe: true }; // 나머지 검사 무의미
    }
    // clip: 최고치 밴드가 바로 아래 밴드보다 과밀 = 평평한 꼭대기(잘림). 매끈한 사인은 밀도비 ≈2.4라 안 걸림.
    var b = range * 0.005;
    function inBand(lo, hi) { var c = 0; for (var j = 0; j < n; j++) if (values[j] >= lo && values[j] < hi) c++; return c; }
    var topMax = inBand(mx - b, mx + 1e-9), nextMax = inBand(mx - 2 * b, mx - b);
    var topMin = inBand(mn - 1e-9, mn + b), nextMin = inBand(mn + b, mn + 2 * b);
    var clipMax = topMax > 0.03 * n && topMax > 4 * (nextMax + 1);
    var clipMin = topMin > 0.03 * n && topMin > 4 * (nextMin + 1);
    if (clipMax || clipMin) issues.push({ key: 'clip', label: '클리핑(포화)', detail: '파형 꼭대기가 잘렸습니다 — 측정범위 초과, 진폭 과소·가짜 고주파 위험' });
    // DC 드리프트: 평균이 표준편차(교류 성분) 대비 과도하게 큼
    if (Math.abs(mean) > 3 * std) issues.push({ key: 'dc', label: 'DC 드리프트', detail: '기준선이 0에서 크게 벗어났습니다 — 가짜 RMS 상승 가능' });
    return { ok: issues.length === 0, issues: issues, severe: false };
  }

  // 첨도 포화 감지 — 첨도가 고점에서 하락 중인데 RMS는 유지/상승이면 "회복 아님(결함 확산 말기)" 경고.
  //  kurtSeries·rmsSeries: 시간순 배열(추이). 반환 { flag, msg } (flag=true면 경고)
  function kurtosisSaturation(kurtSeries, rmsSeries) {
    var k = (kurtSeries || []).filter(function (x) { return isFinite(x); });
    if (k.length < 6) return { flag: false };
    var pi = 0, pk = -Infinity;
    for (var i = 0; i < k.length; i++) if (k[i] > pk) { pk = k[i]; pi = i; }
    var cur = k[k.length - 1];
    // 고점이 유의미(>4.5)하고, 고점이 최근이 아니며(뒤에 데이터 있음), 현재가 고점 대비 30%+ 하락
    if (pk < 4.5 || pi >= k.length - 2 || cur > pk * 0.7) return { flag: false };
    // 같은 구간 RMS는 유지/상승(하락 아님)이어야 "회복 아님".
    // ⚠ kurt 추이와 rms 배열은 길이가 다를 수 있어(청크 수 vs 롤업 버킷 수) 시간 비율로 정렬해 같은 시점끼리 비교.
    var r = (rmsSeries || []).filter(function (x) { return isFinite(x); });
    if (r.length >= 3) {
      var rPeak = r[Math.round(pi / (k.length - 1) * (r.length - 1))], rCur = r[r.length - 1];
      if (rCur < rPeak * 0.9) return { flag: false }; // RMS도 내렸으면 진짜 회복(일시 스파이크 등)
    }
    return { flag: true, msg: '첨도가 고점(' + pk.toFixed(1) + ')에서 ' + cur.toFixed(1) + '로 하락했으나 RMS는 유지·상승 — "회복"이 아니라 결함 확산(말기)일 수 있습니다. 포락선·RMS를 함께 확인하세요.' };
  }

  // 물리량 변환 — 가속도(g)↔속도(mm/s)↔변위(μm). 주파수 영역에서 (iω)^Δorder 적용 → 역FFT.
  //  · 시간 적분 대신 주파수 영역: 드리프트(적분 상수) 누적이 없고 수학적으로 동일.
  //  · 적분(오더↓) 시 저주파 드리프트를 hpHz 고역통과로 제거. 미분(오더↑)은 필터 불필요.
  //  order: 변위=0 · 속도=1 · 가속도=2 (미분할수록 order↑). SI 단위로 변환 후 계수 적용, 다시 표시 단위로.
  var UNIT_SI = { 'g': 9.80665, 'mm/s': 1e-3, 'μm': 1e-6 }; // 표시값 × 이것 = SI(m/s²·m/s·m)
  var UNIT_ORD = { 'g': 2, 'mm/s': 1, 'μm': 0 };
  function convertDomain(values, fs, fromUnit, toUnit, fr) {
    if (fromUnit === toUnit) return values.slice(0);
    var sFrom = UNIT_SI[fromUnit], sTo = UNIT_SI[toUnit], d = UNIT_ORD[toUnit] - UNIT_ORD[fromUnit];
    if (sFrom == null || sTo == null || d === 0) return values.slice(0);
    var n = values.length, m = 1; while (m * 2 <= n) m *= 2;
    if (m < 16 || !(fs > 0)) return values.slice(0);
    var re = new Array(m), im = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re[i] = (values[i] - mean) * sFrom; im[i] = 0; }
    fftComplex(re, im);
    var df = fs / m, integ = d < 0;
    var hpBin = integ ? Math.max(1, Math.round(Math.max(2, (fr || 0) * 0.3) / df)) : 0; // 적분 시 저주파 드리프트 컷
    re[0] = 0; im[0] = 0;
    for (var k = 1; k < m / 2; k++) {
      if (integ && k < hpBin) { re[k] = 0; im[k] = 0; re[m - k] = 0; im[m - k] = 0; continue; }
      var w = 2 * Math.PI * k * df, mag = Math.pow(w, d), ang = d * Math.PI / 2; // (iω)^d = ω^d ∠ d·90°
      var hr = mag * Math.cos(ang), hi = mag * Math.sin(ang);
      var rk = re[k], ik = im[k];
      re[k] = rk * hr - ik * hi; im[k] = rk * hi + ik * hr;
      re[m - k] = re[k]; im[m - k] = -im[k]; // 실신호 보장: 미러는 켤레
    }
    re[m / 2] = 0; im[m / 2] = 0; // Nyquist 빈 제거
    for (i = 0; i < m; i++) im[i] = -im[i];
    fftComplex(re, im);
    var out = new Array(m), toDisp = 1 / sTo;
    for (i = 0; i < m; i++) out[i] = (re[i] / m) * toDisp;
    return out;
  }
  // 스펙트럼(진폭) 물리량 변환 — 서버 FFT mags를 표시 단위로. |(iω)^d| = ω^d 스케일.
  function convertSpectrumMags(mags, freqs, fromUnit, toUnit) {
    var d = UNIT_ORD[toUnit] - UNIT_ORD[fromUnit];
    if (d === 0 || UNIT_SI[fromUnit] == null || UNIT_SI[toUnit] == null) return mags.slice(0);
    var sc = UNIT_SI[fromUnit] / UNIT_SI[toUnit];
    return mags.map(function (mg, i) { var w = 2 * Math.PI * freqs[i]; return w > 0 ? mg * sc * Math.pow(w, d) : 0; });
  }

  // 대역통과: FFT에서 [loHz,hiHz] 밖 빈을 제거하고 역FFT → 그 대역만 남은 실신호. (양측 대칭 유지)
  function bandpassSignal(values, fs, loHz, hiHz) {
    var n = values.length, m = 1; while (m * 2 <= n) m *= 2;
    if (m < 16 || !(fs > 0)) return values.slice(0);
    var re = new Array(m), im = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re[i] = values[i] - mean; im[i] = 0; }
    fftComplex(re, im);
    var df = fs / m, lo = Math.max(1, Math.round(loHz / df)), hi = Math.min(m / 2 - 1, Math.round(hiHz / df));
    for (var k = 0; k < m; k++) { var keep = (k >= lo && k <= hi) || (k >= m - hi && k <= m - lo); if (!keep) { re[k] = 0; im[k] = 0; } }
    for (i = 0; i < m; i++) im[i] = -im[i];
    fftComplex(re, im);
    var out = new Array(m); for (i = 0; i < m; i++) out[i] = re[i] / m;
    return out;
  }

  // 커토그램 — 대역별 Spectral Kurtosis(대역통과 신호의 첨도)를 스캔해 "가장 충격성이 강한 대역"을 찾는다.
  // 포락선 복조 대역을 자동 선택하기 위한 앞단. 반환 { levels:[{nb,bwHz,sk:[...]}], best:{loHz,hiHz,center,bw,sk}, fmax }
  function kurtogram(values, fs) {
    var n = values.length;
    if (n < 512 || !(fs > 0)) return null;
    var m = 1; while (m * 2 <= n) m *= 2;
    var re0 = new Array(m), im0 = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re0[i] = values[i] - mean; im0[i] = 0; }
    fftComplex(re0, im0); // 스펙트럼 1회 계산 후, 대역마다 역FFT만
    var df = fs / m, nyq = m / 2;
    var BANDS = [4, 8, 16, 32], levels = [], best = null;
    BANDS.forEach(function (nb) {
      var bw = Math.floor(nyq / nb);
      if (bw < 16) return; // 대역이 너무 좁으면 첨도가 불안정 → 건너뜀
      var sk = [];
      for (var bi = 0; bi < nb; bi++) {
        var lo = bi * bw + 1, hi = Math.min(nyq - 1, (bi + 1) * bw);
        var re = new Array(m), im = new Array(m), j;
        for (j = 0; j < m; j++) { re[j] = 0; im[j] = 0; }
        for (var k = lo; k <= hi; k++) { re[k] = re0[k]; im[k] = im0[k]; re[m - k] = re0[m - k]; im[m - k] = im0[m - k]; }
        for (j = 0; j < m; j++) im[j] = -im[j];
        fftComplex(re, im);
        var bp = new Array(m), fe = 0;
        for (j = 0; j < m; j++) { bp[j] = re[j] / m; fe += bp[j] * bp[j]; }
        var v = Math.sqrt(fe / m) > 1e-9 ? kurtosis(bp) : 0; // 대역 에너지 없으면 0
        sk.push(v);
        if (v > 0 && (!best || v > best.sk)) best = { loHz: lo * df, hiHz: hi * df, center: (lo + hi) / 2 * df, bw: (hi - lo) * df, sk: v, nb: nb };
      }
      levels.push({ nb: nb, bwHz: bw * df, sk: sk });
    });
    if (!levels.length || !best) return null;
    return { levels: levels, best: best, fmax: nyq * df };
  }

  // 진폭 스펙트럼: 평균 제거 + Hann 창 + zero-pad → 단측 진폭 (maxHz까지)
  function amplitudeSpectrum(values, fs, maxHz) {
    var n = values.length;
    if (n < 16) return { freqs: [], mags: [], res: 1 };
    var N = 1; while (N < n) N <<= 1;
    var re = new Array(N), im = new Array(N), i;
    var mean = 0;
    for (i = 0; i < n; i++) mean += values[i];
    mean /= n;
    var wsum = 0;
    for (i = 0; i < n; i++) {
      var w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); // Hann
      re[i] = (values[i] - mean) * w; im[i] = 0; wsum += w;
    }
    for (i = n; i < N; i++) { re[i] = 0; im[i] = 0; }
    fftComplex(re, im);
    var res = fs / N;
    var kMax = Math.min(N / 2, Math.floor((maxHz || fs / 2) / res));
    var freqs = [], mags = [];
    for (var k = 1; k <= kMax; k++) {
      freqs.push(k * res);
      mags.push(2 * Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (wsum || 1));
    }
    return { freqs: freqs, mags: mags, res: res };
  }

  // 포락선 스펙트럼: 정류(|x|) 신호의 저주파 스펙트럼 — 베어링 충격 반복 주파수 복조.
  // band({loHz,hiHz})를 주면 커토그램이 찾은 최적 대역만 통과시킨 뒤 복조(권장) → 잡음 억제·결함 반복 주파수 선명.
  function envelopeSpectrum(values, fs, maxHz, band) {
    var n = values.length;
    if (n < 64) return { freqs: [], mags: [], res: 1 };
    var src = (band && band.hiHz > band.loHz) ? bandpassSignal(values, fs, band.loHz, band.hiHz) : values;
    var env = new Array(src.length), i;
    for (i = 0; i < src.length; i++) env[i] = Math.abs(src[i]);
    return amplitudeSpectrum(env, fs, Math.min(maxHz || 500, fs * 0.4));
  }

  // 켑스트럼: log 스펙트럼의 FFT — 라모닉(rahmonic) 피크 = 하모닉/측대역 간격 (quefrency ms)
  function cepstrumFromSpectrum(mags, res, maxMs) {
    var n = mags.length;
    if (n < 32) return { freqs: [], mags: [] };
    var N = 1; while (N < n) N <<= 1;
    var re = new Array(N), im = new Array(N), i;
    for (i = 0; i < N; i++) { re[i] = i < n ? Math.log(mags[i] + 1e-9) : 0; im[i] = 0; }
    fftComplex(re, im);
    var dtMs = 1000 / (N * res); // quefrency 간격(ms)
    var kMax = Math.min(N / 2, Math.floor((maxMs || 100) / dtMs));
    var freqs = [], out = [];
    for (var k = 2; k <= kMax; k++) {
      freqs.push(k * dtMs);
      out.push(Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N);
    }
    return { freqs: freqs, mags: out };
  }

  // STFT 스펙트로그램: grid[시간(과거→현재)][주파수], rows×cols — vibe-engine drawHeat 포맷
  function stftGrid(values, fs, fmax, rows, cols) {
    rows = rows || 22; cols = cols || 52;
    var n = values.length;
    if (n < 256) return { grid: [], rows: 0, cols: 0, fmax: 0 };
    var seg = Math.floor(n / rows);
    var nfft = 1; while (nfft * 2 <= seg && nfft < 2048) nfft <<= 1;
    var grid = [];
    for (var t = 0; t < rows; t++) {
      var start = Math.min(n - nfft, Math.floor(t * (n - nfft) / Math.max(1, rows - 1)));
      var sp = amplitudeSpectrum(values.slice(start, start + nfft), fs, fmax);
      var row = [];
      for (var c = 0; c < cols; c++) {
        var f = (c / (cols - 1)) * fmax;
        var idx = Math.min(sp.mags.length - 1, Math.max(0, Math.round(f / sp.res) - 1));
        row.push(sp.mags.length ? sp.mags[idx] : 0);
      }
      grid.push(row);
    }
    return { grid: grid, rows: rows, cols: cols, fmax: fmax };
  }

  // 대역 에너지: 1× 대역 / 결함 대역(2~10×) / 고주파 대역 — 스펙트럼에서 RMS 합산
  function bandEnergies(spec, fr, fs) {
    var b = [0, 0, 0];
    var hi = Math.min(10 * fr, fs * 0.4);
    for (var i = 0; i < spec.freqs.length; i++) {
      var f = spec.freqs[i], e = spec.mags[i] * spec.mags[i];
      if (f >= 0.5 * fr && f <= 1.5 * fr) b[0] += e;
      else if (f > 1.5 * fr && f <= hi) b[1] += e;
      else if (f > hi) b[2] += e;
    }
    return [Math.sqrt(b[0]), Math.sqrt(b[1]), Math.sqrt(b[2])];
  }

  // 특정 주파수의 하모닉 열 에너지 — f0, 2f0, … nf0 (±tol)에서 유의 진폭(≥minMag)만 합산·계수
  function harmonicEnergy(freqs, mags, f0, nHarm, minMag) {
    if (!(f0 > 0) || !freqs.length) return { energy: 0, count: 0 };
    var e = 0, cnt = 0, fmax = freqs[freqs.length - 1], h, i;
    for (h = 1; h <= nHarm; h++) {
      var t = f0 * h; if (t > fmax) break;
      var tol = Math.max(1.5, t * 0.03), best = 0;
      for (i = 0; i < freqs.length; i++) if (Math.abs(freqs[i] - t) <= tol && mags[i] > best) best = mags[i];
      if (best > (minMag || 0)) { e += best; cnt++; }
    }
    return { energy: e, count: cnt };
  }
  // 반송파 주변 측대역 에너지 — carrier ± k·spacing (k=1..n), 유의 진폭만
  function sidebandEnergy(freqs, mags, carrier, spacing, n, minMag) {
    if (!(carrier > 0) || !(spacing > 0) || !freqs.length) return 0;
    var e = 0, fmax = freqs[freqs.length - 1], k, i;
    for (k = 1; k <= n; k++) {
      var ts = [carrier - k * spacing, carrier + k * spacing];
      for (var j = 0; j < 2; j++) {
        var t = ts[j]; if (t <= 0 || t > fmax) continue;
        var tol = Math.max(1.5, t * 0.03), best = 0;
        for (i = 0; i < freqs.length; i++) if (Math.abs(freqs[i] - t) <= tol && mags[i] > best) best = mags[i];
        if (best > (minMag || 0)) e += best;
      }
    }
    return e;
  }
  // 스펙트럼 패턴 진단(단일 피크 대조 보강): 하모닉 열·측대역으로 풀림/정렬/베어링 결함 패턴 검출.
  // 노이즈 플로어 오검출 방지 — 유의 임계(최대피크 8% & 중앙값 4배)를 넘는 피크만 하모닉으로 인정.
  function analyzeSpectrum(freqs, mags, fr, bf) {
    var out = { notes: [], cause: null };
    if (!freqs.length || !(fr > 0)) return out;
    var peakMag = 0, i; for (i = 0; i < mags.length; i++) if (mags[i] > peakMag) peakMag = mags[i];
    if (peakMag <= 0) return out;
    var sorted = mags.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)] || 0;
    var thr = Math.max(peakMag * 0.08, median * 4);
    var oneXn = harmonicEnergy(freqs, mags, fr, 8, thr);
    var oneX = harmonicEnergy(freqs, mags, fr, 1, thr).energy;
    var twoX = harmonicEnergy(freqs, mags, 2 * fr, 1, thr).energy;
    // 지배 피크의 동기성 — 정수배 하모닉 열(풀림)은 지배 성분이 동기일 때만 성립. 비동기 지배면 하모닉 계수가 있어도 풀림 아님(베어링·벨트 등).
    var domF = null, domM = 0; for (i = 0; i < mags.length; i++) if (mags[i] > domM) { domM = mags[i]; domF = freqs[i]; }
    var domOrd = domF != null ? domF / fr : 0, domSync = Math.abs(domOrd - Math.round(domOrd)) < 0.06 && Math.round(domOrd) >= 1;
    var picked = null;
    if (bf) {
      var bpfo = harmonicEnergy(freqs, mags, bf.BPFO, 5, thr);
      var bpfi = harmonicEnergy(freqs, mags, bf.BPFI, 5, thr);
      var bpfiSb = sidebandEnergy(freqs, mags, bf.BPFI, fr, 3, thr);
      var bsf = harmonicEnergy(freqs, mags, bf.BSF, 5, thr);
      if (bpfo.count >= 3) { out.notes.push('BPFO(' + bf.BPFO.toFixed(1) + ' Hz) 하모닉 ' + bpfo.count + '개 열 — 외륜 결함 패턴'); picked = picked || '베어링 외륜 결함'; }
      if (bpfi.count >= 3) { out.notes.push('BPFI(' + bf.BPFI.toFixed(1) + ' Hz) 하모닉 ' + bpfi.count + '개' + (bpfiSb > 0 ? ' + 1× 측대역' : '') + ' — 내륜 결함 패턴'); picked = picked || '베어링 내륜 결함'; }
      if (bsf.count >= 3) { out.notes.push('BSF(' + bf.BSF.toFixed(1) + ' Hz) 하모닉 ' + bsf.count + '개 열 — 전동체 결함 패턴'); picked = picked || '베어링 전동체 결함'; }
    }
    if (oneXn.count >= 4 && domSync) { out.notes.push('1× 하모닉 ' + oneXn.count + '개 열(동기 지배) — 기계적 풀림 패턴'); picked = picked || '기계적 풀림'; }
    else if (oneXn.count >= 4 && !domSync) { out.notes.push('정수배 하모닉 ' + oneXn.count + '개 존재하나 지배 성분이 비동기(' + domOrd.toFixed(2) + '×) — 풀림보다 베어링·비1× 우선'); }
    if (twoX > 0 && oneX > 0 && twoX >= 0.8 * oneX && domSync) { out.notes.push('2×(' + (2 * fr).toFixed(0) + ' Hz)가 1× 이상으로 우세 — 축 정렬 불량 패턴'); picked = picked || '축 정렬 불량'; }
    out.cause = picked;
    return out;
  }

  // 지배 주파수 규칙 진단: 1×/2×/베어링 결함 주파수와 대조 (±max(1.5Hz, 4%))
  function diagnoseDominant(freqs, mags, fr, bf) {
    var domF = null, domM = 0, i;
    for (i = 0; i < freqs.length; i++) if (mags[i] > domM) { domM = mags[i]; domF = freqs[i]; }
    if (domF == null) return null;
    function near(f, ref) { return ref > 0 && Math.abs(f - ref) <= Math.max(1.5, ref * 0.04); }
    var hit = '', cause = null;
    if (near(domF, fr)) { hit = '1× 회전 성분'; cause = '질량 불평형 의심'; }
    else if (near(domF, 2 * fr)) { hit = '2× 성분'; cause = '축 정렬 불량 의심'; }
    else if (bf) {
      if (near(domF, bf.BPFO)) { hit = 'BPFO 근접'; cause = '베어링 외륜 결함 의심'; }
      else if (near(domF, bf.BPFI)) { hit = 'BPFI 근접'; cause = '베어링 내륜 결함 의심'; }
      else if (near(domF, bf.BSF)) { hit = 'BSF 근접'; cause = '볼(전동체) 결함 의심'; }
    }
    return { domF: domF, domM: domM, hit: hit, cause: cause };
  }

  // 베이스라인(정상 상태) 학습: 값 배열 → 평균·표본표준편차. 판정은 rms > μ + kσ (baselineLimit)
  // 최소 표본 30 — σ 추정 오차 ≈ σ/√(2(n-1)), 30 미만이면 σ가 신뢰 불가라 학습 불가로 본다.
  var BASELINE_MIN_N = 30;
  function baselineFit(vals) {
    var n = vals.length;
    if (n < BASELINE_MIN_N) return null; // 표본 부족 — 학습 불가
    var s = 0, i;
    for (i = 0; i < n; i++) s += vals[i];
    var mu = s / n, v = 0;
    for (i = 0; i < n; i++) v += (vals[i] - mu) * (vals[i] - mu);
    return { mu: mu, sigma: Math.sqrt(v / (n - 1)), n: n };
  }
  function baselineLimit(bl) { return bl ? bl.mu + (bl.k || 3) * bl.sigma : null; }

  return {
    ISO_ZONES: ISO_ZONES, UNIT_ZONES: UNIT_ZONES, zonesFor: zonesFor, gradeFor: gradeFor,
    BEARINGS: BEARINGS, bearingFreqs: bearingFreqs, faultFreqSummary: faultFreqSummary,
    toBucket: toBucket, kurtosis: kurtosis, fmt: fmt, timeIndics: timeIndics,
    fftComplex: fftComplex, bandKurtosis: bandKurtosis, amplitudeSpectrum: amplitudeSpectrum, envelopeSpectrum: envelopeSpectrum,
    bandpassSignal: bandpassSignal, kurtogram: kurtogram,
    convertDomain: convertDomain, convertSpectrumMags: convertSpectrumMags,
    signalQuality: signalQuality, kurtosisSaturation: kurtosisSaturation,
    cepstrumFromSpectrum: cepstrumFromSpectrum, stftGrid: stftGrid, bandEnergies: bandEnergies,
    diagnoseDominant: diagnoseDominant, analyzeSpectrum: analyzeSpectrum, harmonicEnergy: harmonicEnergy,
    baselineFit: baselineFit, baselineLimit: baselineLimit,
    BASELINE_MIN_N: BASELINE_MIN_N
  };
});
