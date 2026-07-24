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
      { k: 'RMS (파형 구간)', v: fmt(rms), hint: unit, desc: '표시 구간 원시 파형의 실효값' },
      { k: '커토시스 (Kurtosis)', v: kurt.toFixed(2), hint: kurt > 4.5 ? '충격성 경계 초과' : '', desc: '3=정규분포 · 클수록 충격성 결함 신호' },
      { k: 'Peak', v: fmt(peak), hint: unit, desc: '구간 내 최대 순간 진폭' },
      { k: 'Crest Factor', v: crest.toFixed(2), hint: crest > 6 ? '높음' : '', desc: 'Peak/RMS · 충격성 지표' }
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

  // 포락선 스펙트럼: 정류(|x|) 신호의 저주파 스펙트럼 — 베어링 충격 반복 주파수 복조
  function envelopeSpectrum(values, fs, maxHz) {
    var n = values.length;
    if (n < 64) return { freqs: [], mags: [], res: 1 };
    var env = new Array(n), i;
    for (i = 0; i < n; i++) env[i] = Math.abs(values[i]);
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
    if (oneXn.count >= 4) { out.notes.push('1× 하모닉 ' + oneXn.count + '개 열 — 기계적 풀림 패턴'); picked = picked || '기계적 풀림'; }
    if (twoX > 0 && oneX > 0 && twoX >= 0.8 * oneX) { out.notes.push('2×(' + (2 * fr).toFixed(0) + ' Hz)가 1× 이상으로 우세 — 축 정렬 불량 패턴'); picked = picked || '축 정렬 불량'; }
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
    cepstrumFromSpectrum: cepstrumFromSpectrum, stftGrid: stftGrid, bandEnergies: bandEnergies,
    diagnoseDominant: diagnoseDominant, analyzeSpectrum: analyzeSpectrum, harmonicEnergy: harmonicEnergy,
    baselineFit: baselineFit, baselineLimit: baselineLimit,
    BASELINE_MIN_N: BASELINE_MIN_N
  };
});
