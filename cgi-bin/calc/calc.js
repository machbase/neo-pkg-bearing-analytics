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

  /* ---------------- 판정 파라미터 지문 ----------------
   * 리포트끼리 "왜 숫자가 다른가"를 가리는 값. 버전 문자열은 사람이 올리는 걸 잊으면 거짓말이 되지만,
   * 지문은 실제 임계에서 계산되므로 동작이 바뀌면 반드시 달라진다.
   * 지문이 같은데 결과가 다르면 = 데이터가 달라진 것 / 지문이 다르면 = 엔진이 달라진 것.
   * ⚠판정에 영향을 주는 상수를 바꾸면 이 목록에도 반영할 것.
   */
  var RULESET = '2026.07';
  function rulesetFingerprint() {
    var p = [
      'iso:10-1000', 'isoBlocks:8', 'parseval:0.03',
      'crest:15', 'kurt:25', 'crestBands:5/8/15', 'kurtBands:4/10/25',
      'matchTol:0.01', 'bpfTol:0.02', 'harm:2', 'ordTolRel:0.01',
      'satMinSpanMin:' + SAT_MIN_SPAN_MIN,
      'mountFmax:10000/5000/2000/1000',
      'bl:mad1.4826/idle0.2/ramp0.3/margin0.2/bimodal0.1x10',
      'bearingFsRatio:20', 'aliasFmax:0.8nyq/half', 'winMs:exact', 'bandGrade:1.5/3.0/hyst0.9',
      'bandLimGate:>0', 'evalWin:rms/partialCnt0.9',
    ].join('|');
    var hsh = 2166136261; // FNV-1a
    for (var i = 0; i < p.length; i++) { hsh ^= p.charCodeAt(i); hsh = (hsh * 16777619) >>> 0; }
    return hsh.toString(36).slice(0, 6);
  }

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
  /* r = [ms, SUMSQ, COUNT, MIN, MAX, SUM?] — SUM은 뒤에 붙은 선택 컬럼이다.
     sum이 있으면 windowRms가 평균(DC)을 빼고 실효값을 낸다. ISO는 AC 성분 기준이고,
     오프셋이 있는 센서에서는 DC가 그대로 판정값을 부풀린다. */
  function toBucket(r) {
    var cnt = r[2];
    if (!cnt) return null;
    var rms = Math.sqrt(Math.max(0, r[1]) / cnt);
    var mn = r[3], mx = r[4];
    var b = { ms: r[0], rms: rms, p2p: mx - mn, crest: rms > 0 ? Math.max(Math.abs(mn), Math.abs(mx)) / rms : 0, cnt: cnt };
    if (r.length > 5 && isFinite(r[5])) b.sum = r[5];
    return b;
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
    // 힌트는 참조 정상범위 밴드로 — 임계 하나로 자르면 정상 기계도 경보가 뜬다.
    // Crest 3~5 정상(N샘플 백색잡음 기대 최대 √(2·lnN), 25,600샘플이면 ≈4.5σ) / 5~8 초기 / 8~15 뚜렷 / >15 계측 아티팩트 의심
    // Kurtosis ≈3 정상 / 4~10 초기 / 10~25 뚜렷 / >25 계측 아티팩트 의심 (비단조 — 말기엔 3 근처로 회귀)
    return [
      { k: 'RMS (원시파형·표시구간)', v: fmt(rms), hint: unit, desc: '표시 구간 원시 파형의 실효값 (롤업 RMS와 별개)' },
      { k: '커토시스 (Kurtosis·원시파형)', v: kurt.toFixed(2), hint: kurtBand(kurt), desc: '3=정규분포 · 4~10 초기 · 10~25 뚜렷 · >25 계측 아티팩트 의심' },
      { k: 'Peak (원시파형)', v: fmt(peak), hint: unit, desc: '구간 내 최대 순간 진폭' },
      { k: 'Crest Factor (원시파형)', v: crest.toFixed(2), hint: crestBand(crest, values.length), desc: 'Peak/RMS · 3~5 정상 · 5~8 초기 · 8~15 뚜렷 · >15 계측 아티팩트 의심' }
    ];
  }
  // 참조 정상범위 밴드 라벨 (임계 단일값 대신 구간 해석)
  function crestBand(c, n) {
    var expMax = n > 1 ? Math.sqrt(2 * Math.log(n)) : 4.5; // 백색잡음 기대 최대(σ 배수)
    if (c > 15) return '계측 아티팩트 의심';
    if (c > 8) return '뚜렷한 충격성';
    if (c > 5) return '초기 충격성';
    return '정상(백색잡음 기대 최대 ' + expMax.toFixed(1) + 'σ)';
  }
  function kurtBand(k) {
    if (k > 25) return '계측 아티팩트 의심';
    if (k > 10) return '뚜렷한 충격성';
    if (k > 4) return '초기 충격성';
    return '정상';
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
    if (n < 32) return { ok: false, issues: [{ key: 'sparse', label: '데이터 부족', detail: '샘플이 너무 적어 분석 신뢰도가 낮습니다' }], severe: true, gate: true };
    var mn = Infinity, mx = -Infinity, sum = 0, i;
    for (i = 0; i < n; i++) { var v = values[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    var mean = sum / n, range = mx - mn;
    var ss = 0; for (i = 0; i < n; i++) { var d = values[i] - mean; ss += d * d; }
    var std = Math.sqrt(ss / n), peak = Math.max(Math.abs(mn), Math.abs(mx));
    // flatline: 표준편차가 피크 대비 극히 작음(거의 상수)
    if (peak === 0 || std < 1e-9 || (peak > 0 && std < 0.002 * peak)) {
      issues.push({ key: 'flatline', label: '플랫라인', detail: '값이 거의 변하지 않습니다 — 센서 정지·케이블 탈락 의심' });
      return { ok: false, issues: issues, severe: true, gate: true }; // 나머지 검사 무의미
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
    // 계측 아티팩트 게이트: 극단 Crest/첨도는 베어링 결함(통상 Crest<10)이 아니라 단발 스파이크
    // (ESD·케이블 흔들림·커넥터 접촉) 시그니처에 가깝다 → gate=true면 "진단 보류·계측 검증 필요"
    var peakAC = Math.max(Math.abs(mx - mean), Math.abs(mn - mean));
    var crest = std > 1e-12 ? peakAC / std : 0, kurt = kurtosis(values), gate = false;
    if (crest > 15) { issues.push({ key: 'spike', label: '단발 스파이크 의심', detail: 'Crest ' + crest.toFixed(1) + ' — 결함 신호(통상 <10)보다 스파이크성 잡음(ESD·케이블·접촉) 시그니처에 가깝습니다' }); gate = true; }
    if (kurt > 25) { issues.push({ key: 'kurtx', label: '극단 첨도', detail: 'Kurtosis ' + kurt.toFixed(1) + ' — 소수 샘플이 지배하는 신호, 계측 아티팩트 가능성 — 센서·마운팅 확인 필요' }); gate = true; }
    return { ok: issues.length === 0, issues: issues, severe: false, gate: gate };
  }

  // 첨도 포화 감지 — 첨도가 고점에서 하락 중인데 RMS는 유지/상승이면 "회복 아님(결함 확산 말기)" 경고.
  //  kurtSeries·rmsSeries: 시간순 배열(추이). 반환 { flag, msg } (flag=true면 경고)
  // spanMin: 관측 구간 길이(분). 첨도 비단조성("말기 확산")은 주·월 단위 추세에서만 성립하므로
  // 짧은 창에서는 결함 서사 대신 운전조건 변화로 읽는다(관측 창이 결론의 시간 범위를 제한).
  var SAT_MIN_SPAN_MIN = 1440;
  function kurtosisSaturation(kurtSeries, rmsSeries, spanMin) {
    var k = (kurtSeries || []).filter(function (x) { return isFinite(x); });
    if (k.length < 6) return { flag: false };
    if (spanMin != null && spanMin < SAT_MIN_SPAN_MIN) {
      return { flag: false, short: true, spanMin: spanMin,
        note: '관측 구간 ' + Math.round(spanMin) + '분 — 첨도 하락의 결함 해석(말기 확산)은 주·월 단위 추세에서만 성립합니다. 이 창에서는 운전조건 변화로 읽으세요.' };
    }
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

  // 대역제한 RMS — FFT 대역통과 후 실효값. ISO 10816/20816 판정은 10–1000 Hz 대역제한 속도 RMS에
  // 정의되므로 광대역 롤업 RMS 대신 이 값으로 존을 판정한다.
  function bandRms(values, fs, loHz, hiHz) {
    var bp = bandpassSignal(values, fs, loHz, hiHz);
    var s = 0, i; for (i = 0; i < bp.length; i++) s += bp[i] * bp[i];
    return bp.length ? Math.sqrt(s / bp.length) : 0;
  }

  /* 여러 대역의 RMS를 FFT 한 번으로 구한다.
     bandRms를 대역마다 부르면 같은 신호를 매번 FFT+역FFT 하므로, 대역 4~5개에 53만 샘플이면
     그것만으로 0.25초가 든다. Parseval 정리로 주파수영역에서 바로 제곱합을 내면 역FFT가 필요 없다.
     bands: [[lo,hi], …] → 같은 순서의 RMS 배열. bandRms와 동일한 값을 준다(검증: test-dsp). */
  function bandRmsMulti(values, fs, bands) {
    var n = values.length, m = 1; while (m * 2 <= n) m *= 2;
    if (m < 16 || !(fs > 0) || !bands || !bands.length) return (bands || []).map(function () { return 0; });
    var re = new Array(m), im = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re[i] = values[i] - mean; im[i] = 0; }
    fftComplex(re, im);
    // 단측 파워: |X(k)|²을 빈별로 미리 구해두고 대역마다 합만 낸다
    var half = m / 2, pw = new Array(half + 1);
    for (i = 0; i <= half; i++) pw[i] = (re[i] * re[i] + im[i] * im[i]);
    var df = fs / m;
    return bands.map(function (b) {
      var loB = Math.max(1, Math.round(b[0] / df)), hiB = Math.min(half - 1, Math.round(b[1] / df));
      if (hiB < loB) return 0;
      var s = 0, k;
      for (k = loB; k <= hiB; k++) s += pw[k];
      // 양측 스펙트럼이므로 ×2, Parseval 정규화 1/m² → 시간영역 제곱평균
      return Math.sqrt(2 * s / (m * m));
    });
  }

  // 1× 실측 — 명판 RPM은 동기속도(예: 1800=4극)라 부하 슬립·오차로 실제와 다르다. 차수 해석 전체가
  // 1× 위에 서므로 스펙트럼에서 명판 ±tol% 창의 유의 로컬 피크를 찾아 실측 회전주파수를 확정한다.
  // 반환 { f, rpm } 또는 null(유의 피크 없음 → 명판 기준 유지, 차수엔 오차 가능성 표기)
  function measuredOneX(freqs, mags, frNom, tolPct) {
    if (!(frNom > 0) || !freqs || freqs.length < 8) return null;
    var tol = (tolPct || 12) / 100, lo = frNom * (1 - tol), hi = frNom * (1 + tol);
    var peakMag = 0, i; for (i = 0; i < mags.length; i++) if (mags[i] > peakMag) peakMag = mags[i];
    var sorted = mags.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)] || 0;
    var bi = -1, bm = 0;
    for (i = 0; i < freqs.length; i++) if (freqs[i] >= lo && freqs[i] <= hi && mags[i] > bm) { bm = mags[i]; bi = i; }
    if (bi < 0 || bm < Math.max(peakMag * 0.02, median * 3)) return null;
    // 창 경계에 걸린 사면이 아닌 진짜 로컬 최대인지 확인
    if ((bi > 0 && mags[bi - 1] > bm) || (bi < mags.length - 1 && mags[bi + 1] > bm)) return null;
    return { f: freqs[bi], rpm: freqs[bi] * 60 };
  }

  // 포락선 스펙트럼 정량 — 지배 반복주파수 f0·차수(f0/1×)·하모닉 수·1× 측대역 유무.
  // 베어링 형식을 몰라도 읽을 수 있는 결정 검사: 하모닉≥2면 "일관된 반복 충격"(결함성),
  // 미만이면 단발 스파이크와 구분 불가 → 베어링 근거 점수에 상한을 걸어야 한다.
  function envelopeQuant(freqs, mags, fr) {
    if (!freqs || freqs.length < 16) return null;
    var peakMag = 0, i; for (i = 0; i < mags.length; i++) if (mags[i] > peakMag) peakMag = mags[i];
    if (!(peakMag > 0)) return null;
    var sorted = mags.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)] || 0;
    var thr = Math.max(peakMag * 0.15, median * 4);
    var f0 = 0, m0 = 0; // 지배 반복주파수 (2 Hz 미만 DC 근처 제외)
    for (i = 0; i < freqs.length; i++) if (freqs[i] >= 2 && mags[i] > m0) { m0 = mags[i]; f0 = freqs[i]; }
    if (!(f0 > 0) || m0 < thr) return { f0: 0, order: 0, harm: 0, sb1x: false, consistent: false };
    var pickNear = function (t) { if (!(t > 0) || t > freqs[freqs.length - 1]) return 0; var tol = Math.max(1.5, t * 0.03), b = 0, j; for (j = 0; j < freqs.length; j++) if (Math.abs(freqs[j] - t) <= tol && mags[j] > b) b = mags[j]; return b; };
    var harm = 1;
    for (var h = 2; h <= 4; h++) if (pickNear(h * f0) > Math.max(thr * 0.5, m0 * 0.12)) harm++;
    var sb1x = fr > 0 && (pickNear(f0 - fr) > thr * 0.5 || pickNear(f0 + fr) > thr * 0.5); // 1× 측대역(내륜 정황)
    return { f0: f0, order: fr > 0 ? f0 / fr : 0, m0: m0, harm: harm, sb1x: sb1x, consistent: harm >= 2 };
  }

  // 대역제한 RMS를 N개 블록으로 나눠 에너지 평균 — ISO 판정은 "정상상태 · 충분한 평균"이 전제다.
  // 단일 블록 값은 어느 스파이크가 걸렸느냐로 흔들려 규격 판정값이 될 수 없다.
  // 반환 { rms, blocks, spread } — spread=블록 간 변동(최대/최소 비), 정상상태 여부 판단용.
  function bandRmsAveraged(values, fs, loHz, hiHz, nBlocks) {
    var n = values.length, nb = Math.max(1, nBlocks || 8);
    var blen = Math.floor(n / nb);
    if (blen < 64) return { rms: bandRms(values, fs, loHz, hiHz), blocks: 1, spread: 1 };
    var acc = 0, mn = Infinity, mx = 0, used = 0;
    for (var b = 0; b < nb; b++) {
      var seg = values.slice(b * blen, (b + 1) * blen);
      var r = bandRms(seg, fs, loHz, hiHz);
      if (!(r > 0)) continue;
      acc += r * r; used++;
      if (r < mn) mn = r; if (r > mx) mx = r;
    }
    if (!used) return { rms: 0, blocks: 0, spread: 1 };
    return { rms: Math.sqrt(acc / used), blocks: used, spread: mn > 0 ? mx / mn : 1 };
  }

  // Welch 평균 스펙트럼 — 블록 분할 + 50% 중첩 + Hann 평균. 충격성 신호에서 1블록 스펙트럼은
  // 어느 스파이크가 걸렸느냐로 진폭이 춤추므로, 진폭을 근거로 쓰려면 평균이 필요하다.
  // 반환 { freqs, mags, res, blocks } — mags는 진폭 스펙트럼의 파워 평균 후 제곱근.
  function welchSpectrum(values, fs, maxHz, blockSec) {
    var n = values.length;
    var blen = Math.min(n, Math.max(256, Math.round((blockSec || 4) * fs)));
    var hop = Math.max(1, Math.floor(blen / 2));
    var starts = [];
    for (var s = 0; s + blen <= n; s += hop) starts.push(s);
    if (!starts.length) starts = [0];
    var acc = null, res = 1, freqs = null, used = 0;
    for (var i = 0; i < starts.length; i++) {
      var seg = values.slice(starts[i], starts[i] + blen);
      var sp = amplitudeSpectrum(seg, fs, maxHz);
      if (!sp.freqs.length) continue;
      if (!acc) { acc = new Array(sp.mags.length); for (var k = 0; k < acc.length; k++) acc[k] = 0; freqs = sp.freqs; res = sp.res; }
      var m = Math.min(acc.length, sp.mags.length);
      for (var j = 0; j < m; j++) acc[j] += sp.mags[j] * sp.mags[j];
      used++;
    }
    if (!acc || !used) return { freqs: [], mags: [], res: 1, resTrue: 1, blocks: 0 };
    var mags = new Array(acc.length);
    for (var q = 0; q < acc.length; q++) mags[q] = Math.sqrt(acc[q] / used);
    // resTrue = 창 길이가 정하는 실제 분해능(제로패딩 전) — 불확도·측대역 판정은 이 값으로
    return { freqs: freqs, mags: mags, res: res, resTrue: fs / blen, blocks: used };
  }

  // 데시메이션(정수 배수 추출). ⚠호출 전 반드시 대역제한(반Nyquist 이하)해야 폴딩이 생기지 않는다.
  function decimate(values, factor) {
    var f = Math.max(1, Math.floor(factor));
    if (f === 1) return values.slice(0);
    var out = [];
    for (var i = 0; i < values.length; i += f) out.push(values[i]);
    return out;
  }

  // 포락선 반복주파수 ↔ 베어링 결함주파수 대조. 허용오차 ±1%(BPFO/BPFI는 케이지 슬립 감안 ±2%).
  // 가점 조건 = "매칭 + 하모닉 2개 이상" — 단일 피크는 우연 일치와 구분되지 않는다.
  // 미매칭은 무증거가 아니라 반대 증거이므로 negatives로 돌려 보고(음성 소견)한다.
  // 측대역은 반송파가 그 결함주파수일 때만 근거: 내륜=BPFI±1×, 전동체=BSF±FTF, 외륜=측대역 없음.
  /* 포락선 복조로 베어링 결함을 볼 수 있는 최소 샘플레이트.
     복조가 성립하려면 충격 링잉(고주파 반송파)과 결함 반복(저주파 변조)이 충분히 분리돼야 한다.
     반송파를 볼 수 없는 샘플레이트에서는 "미검출"이 아니라 "측정 불가"다(R7) — 낮은 샘플레이트로
     잡히지 않은 것을 반대 증거로 쓰면 있는 결함을 없다고 말하게 된다.
     기준은 최고 결함주파수의 20배 — 반복 성분의 하모닉 몇 개와 반송파 대역이 Nyquist 안에 들어올 최소선. */
  /* ---------------- 대역 이탈 판정 ----------------
     대역은 ISO 존과 무관하므로 "평소 대비 배수"로 등급을 매긴다. 그리고 상관된 대역
     (fault+high+vhigh는 한 결함의 세 표현)을 따로 알리면 알람이 배로 늘어 피로해지므로,
     설비 단위로 하나로 합성한다 — 어느 대역이 함께 올랐는지가 오히려 진단 정보다.
     복귀는 ×0.9로 히스테리시스를 둔다(한계 근처 진동으로 이벤트가 반복되는 것을 막음). */
  var BAND_KO = { sub: '서브동기', one: '1× 대역', fault: '결함 대역', high: '고주파', vhigh: '초고주파' };
  var BAND_ORDER = ['sub', 'one', 'fault', 'high', 'vhigh'];
  var BAND_GRADE = [1.5, 3.0];   // ×1.0~1.5 주의 · 1.5~3.0 위험 · 3.0~ 심각
  var BAND_HYST = 0.9;           // 복귀 판정 배수
  /* now: {대역:값} · bls: {대역:{mu,sigma,k}} · wasOn: 직전 이탈 여부(히스테리시스용)
     반환 { on, gi, over:[{k,ko,v,lim,r}], maxR, detail } — detail은 이벤트 DETAIL 컬럼에 그대로 들어간다

     이 함수는 소스가 통째로 서버 TQL에 박히므로(monitor.js) 바깥 이름을 하나도 쓰지 않는다.
     상수도 한계식도 안에서 다시 선언한다 — 모듈 상수를 참조하면 번들 압축 때 이름이 바뀌어
     TQL 쪽에서 ReferenceError로 죽는다. 중복이 생긴 만큼 test-embedsrc.mjs가 모듈 상수·
     baselineLimit과 값이 어긋나지 않는지 확인한다. */
  function bandJudge(now, bls, wasOn) {
    if (!now || !bls) return null;
    var ORDER = ['sub', 'one', 'fault', 'high', 'vhigh'];
    var KO = { sub: '서브동기', one: '1× 대역', fault: '결함 대역', high: '고주파', vhigh: '초고주파' };
    var GRADE = [1.5, 3.0], HYST = 0.9;
    var thr = wasOn ? HYST : 1.0;
    var over = [], maxR = 0, any = false;
    ORDER.forEach(function (k) {
      var v = now[k], b = bls[k];
      if (!(v > 0) || !b) return;
      var lim = b ? Math.max(b.mu + (b.k || 3) * b.sigma, b.mu * 1.2) : null;   // baselineLimit과 같은 식
      /* 한계가 0이면 그 대역은 판정에 쓸 수 없다 — 대역 하한이 Nyquist보다 높아 값이 항상 0이면
         μ=0·σ=0으로 학습되어 이렇게 된다. any를 이 검사 뒤에 세워야 "쓸 수 있는 대역이 하나도
         없음"과 "있는데 이탈 아님"이 구분된다. 앞에 세우면 판정 불가를 정상으로 단정하게 된다. */
      if (!(lim > 0)) return;
      any = true;
      var r = v / lim;
      if (r > maxR) maxR = r;
      if (r > thr) over.push({ k: k, ko: KO[k], v: v, lim: lim, r: r });
    });
    if (!any) return null;                       // 학습된 대역이 하나도 없음 — 판정 불가
    var on = over.length > 0;
    var gi = !on ? 0 : (maxR > GRADE[1] ? 3 : maxR > GRADE[0] ? 2 : 1);
    var detail = over.map(function (o) {
      return o.k + '=' + o.v.toFixed(3) + '/' + o.lim.toFixed(3);
    }).join(' · ');
    return { on: on, gi: gi, over: over, maxR: maxR, detail: detail };
  }
  /* 대역 경계(Hz) — band.js의 bandsFor와 같은 정의. 화면이 "왜 이 대역은 학습이 안 되나"를
     설명하려면 여기서도 필요하다(두 벌이면 어긋나므로 정의는 하나로 두고 band.js가 이걸 쓴다).
     초고주파는 회전주파수와 무관하게 1000 Hz 고정 하한이라, 샘플레이트가 2 kHz 미만이면
     하한이 Nyquist를 넘어 빈 대역이 된다 — 그 태그는 4/5가 정상이고 5/5가 나올 수 없다. */
  function bandEdges(fr, nyq) {
    return [
      [2, Math.max(3, 0.5 * fr)],
      [Math.max(2, 0.5 * fr), 1.5 * fr],
      [1.5 * fr, Math.min(1000, 10 * fr)],
      [Math.min(1000, 10 * fr), 1000],
      [1000, nyq],
    ];
  }
  // 그 대역이 이 샘플레이트로 측정 가능한지 — 하한이 Nyquist 이상이면 빈 대역이다
  function bandMeasurable(bn, fr, fs) {
    var i = BAND_ORDER.indexOf(bn);
    if (i < 0 || !(fs > 0) || !(fr > 0)) return true;   // 판단 불가면 막지 않는다
    var e = bandEdges(fr, fs / 2)[i];
    return e[0] < Math.min(e[1], fs / 2);
  }
  /* 밀도 균일화 — 시각이 있는 표본을 격자 버킷당 한 점으로 솎아 "시간당 표본 수"를 고르게 만든다.
     추출 주기를 바꾸거나 타이머가 몇 시간 멈추면 학습 창 안에서 구간별 밀도가 달라지는데,
     그대로 중앙값·MAD를 내면 촘촘한 구간이 표본을 지배해 그 구간이 곧 기준이 된다
     (앞 12h 1분·뒤 12h 10분이면 앞이 표본의 91%). 설비가 그 사이 달라졌으면 조용히 오염된다.
     버킷 안에서 평균·중앙값으로 뭉치지 않고 대표 한 점을 그대로 쓰는 이유는 산포 보존이다 —
     뭉치면 σ가 줄어 한계가 좁아지고 오경보가 는다.
     rows는 시각 오름차순이어야 한다(bandRaw가 order by TIME으로 준다). */
  function evenSample(rows, gridMs, tKey, vKey) {
    tKey = tKey || 'ms'; vKey = vKey || 'v';
    if (!rows || !rows.length) return [];
    if (!(gridMs > 0)) return rows.map(function (r) { return r[vKey]; });
    var out = [], lastB = null;
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i][tKey];
      if (!isFinite(t)) continue;
      var b = Math.floor(t / gridMs);
      if (b !== lastB) { out.push(rows[i][vKey]); lastB = b; }
    }
    return out;
  }
  /* 판정값 진동 감지 — 같은 태그가 악화·개선을 짧은 간격으로 반복하면 그건 설비 상태가 아니라
     설정이 그 현장에 안 맞는다는 신호다(부하 변동·간헐 운전인데 RMS 구간이 그보다 짧은 경우).
     주기는 추정하지 않고 관측한다 — threshold 이벤트 간격의 중앙값이 곧 진동 주기다.
     3회 미만은 진동이라 부르지 않는다(우연한 왕복과 구분이 안 된다).
     ts는 오름차순 threshold 시각 배열. */
  var FLAP_MIN_ROUND = 3;
  function detectFlap(ts, winMs, now) {
    if (!ts || ts.length < FLAP_MIN_ROUND) return null;
    var lo = now - winMs, hit = [];
    for (var i = 0; i < ts.length; i++) if (ts[i] >= lo) hit.push(ts[i]);
    if (hit.length < FLAP_MIN_ROUND) return null;
    var gaps = [];
    for (i = 1; i < hit.length; i++) gaps.push(hit[i] - hit[i - 1]);
    gaps.sort(function (a, b) { return a - b; });
    var period = gaps[gaps.length >> 1];
    if (!(period > 0)) return null;
    return { round: hit.length, periodMs: period };
  }
  /* 운전 판별 — 값이 정지 수준으로 떨어졌는지. 진동 결함은 스스로 낫지 않으므로,
     설명되지 않는 하락은 대개 설비 정지·센서 이상이다. 그걸 "복귀"로 알리면 틀린 안심을 준다.
     기준(ref)은 학습 μ가 있으면 그것, 없으면 최근 P75 — 학습이 쓰는 참조와 같은 방법이라
     실측에서 두 값이 0.1% 차이였다(정지 판별은 자릿수 판단이라 그 차이가 영향 없다).
     BL_IDLE_FRAC(0.2)을 그대로 쓴다 — 학습에서 정지 구간을 거를 때 쓰는 그 기준이다. */
  function isRunning(val, ref) {
    if (!(ref > 0)) return true;          // 기준이 없으면 막지 않는다(판별 불가 ≠ 정지)
    /* 0.2는 BL_IDLE_FRAC과 같은 값이다 — 학습에서 정지 구간을 거를 때 쓰는 그 기준.
       이 함수는 소스가 서버 TQL에 문자열로 박히므로 바깥 이름을 참조할 수 없다(참조하면
       번들 압축 때 이름이 바뀌어 타이머가 ReferenceError로 죽는다). test-embedsrc.mjs가
       이 값이 BL_IDLE_FRAC과 어긋나지 않는지 확인한다. */
    return val >= ref * 0.2;
  }
  // 정지 판별 기준값 — 학습 μ 우선, 없으면 최근값들의 P75
  function runRef(bl, recent) {
    if (bl && bl.mu > 0) return bl.mu;
    if (!recent || !recent.length) return 0;
    var x = recent.filter(function (v) { return isFinite(v) && v >= 0; }).sort(function (a, b) { return a - b; });
    return x.length ? x[Math.floor(0.75 * (x.length - 1))] : 0;
  }
  /* 구간 RMS — 롤업 버킷들을 합쳐 그 구간 전체의 RMS를 낸다.
     SUMSQ가 이미 Σx²이므로 제곱으로 합치면 원본에서 직접 √(Σx²/N)을 낸 것과 같은 값이다
     (실측 오차 2.2e-16, 부동소수 한계). 버킷 크기가 달라도(실측 418~1582개) cnt 가중으로 정확하다.
     산술평균으로 합치면 다른 양이 되어, 정지·기동이 섞인 구간에서 참 RMS를 20~40% 과소평가한다.

     minCnt: 미완성 버킷 제외 기준. 최신 버킷은 아직 적재 중이라 샘플이 적게 온다
     (실측 875~901개 / 정상 1000개). 그대로 쓰면 판정값이 매번 흔들린다.
     buckets는 {rms, cnt} 배열(bandRaw/rollupTrend의 toBucket 결과 형태). */
  function windowRms(buckets, minCntRatio) {
    if (!buckets || !buckets.length) return null;
    var cnts = [], i;
    for (i = 0; i < buckets.length; i++) if (buckets[i] && buckets[i].cnt > 0) cnts.push(buckets[i].cnt);
    if (!cnts.length) return null;
    cnts.sort(function (a, b) { return a - b; });
    var med = cnts[cnts.length >> 1];
    var floor = med * (minCntRatio == null ? 0.9 : minCntRatio);
    var ss = 0, n = 0, used = 0, sum = 0, haveSum = true;
    for (i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      if (!b || !(b.cnt > 0) || !isFinite(b.rms)) continue;
      if (b.cnt < floor) continue;                 // 미완성 버킷 — 판정에서 제외
      ss += b.rms * b.rms * b.cnt; n += b.cnt; used++;
      if (isFinite(b.sum)) sum += b.sum; else haveSum = false;
    }
    if (!n) return null;
    /* 평균(DC)을 뺀 실효값 — √(Σx²/N − (Σx/N)²). SUM이 없는 옛 호출은 그대로 √(Σx²/N).
       음수가 되는 건 부동소수 오차뿐이라 0으로 막는다. */
    var ms2 = ss / n;
    var rms = haveSum ? Math.sqrt(Math.max(0, ms2 - (sum / n) * (sum / n))) : Math.sqrt(ms2);
    return { rms: rms, used: used, dropped: cnts.length - used, n: n, ac: haveSum };
  }
  /* ── ISO 10816 대역제한(10~1000 Hz) 실효값 ───────────────────────────────

     ISO의 존 경계(1.12/2.80/7.10)는 10~1000 Hz 속도 RMS를 재서 만든 숫자다. 전대역 값을
     그 경계에 대면 다른 양을 재는 것이 된다 — 실측(BEARING:C1, 25.6 kHz)에서 에너지의 82%가
     1 kHz 위에 있어 전대역 RMS가 49% 부풀고 등급이 주의→위험으로 뒤집혔다.

     FFT 대신 시간영역 밴드패스를 쓴다. FFT는 쓰지도 않을 12.8 kHz까지 전부 계산하느라
     goja에서 478 ms가 드는데, 4차 버터워스 밴드패스는 같은 창에서 110 ms이고 FFT 기준값과
     0.16% 안에서 일치한다(1초·25,600 샘플 실측).

     이 함수들은 소스가 서버 TQL에 문자열로 박히므로 바깥 이름을 하나도 쓰지 않는다. */

  // 2차 IIR 섹션 — 계수는 bandpass가 만들어 넘긴다
  function biquad(b0, b1, b2, a1, a2, sig) {
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0, i, xn, yn, out = new Array(sig.length);
    for (i = 0; i < sig.length; i++) {
      xn = sig[i];
      yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xn; y2 = y1; y1 = yn; out[i] = yn;
    }
    return out;
  }
  /* N차 버터워스 밴드패스. 같은 2차 섹션을 쌓으면 통과대역 끝이 깎여 값이 계속 작아진다
     (4차에서 -5%). 극점마다 Q = 1/(2cos(π(2k+1)/2N))를 줘야 통과대역이 평탄해진다. */
  function bandpass(sig, order, fLo, fHi, fs) {
    if (!sig || !sig.length || !(fs > 0)) return null;
    var s = sig, k, Q, w, d;
    for (k = 0; k < order / 2; k++) {
      Q = 1 / (2 * Math.cos(Math.PI * (2 * k + 1) / (2 * order)));
      w = Math.tan(Math.PI * fHi / fs); d = 1 + w / Q + w * w;          // 저역통과
      s = biquad(w * w / d, 2 * w * w / d, w * w / d, 2 * (w * w - 1) / d, (1 - w / Q + w * w) / d, s);
      w = Math.tan(Math.PI * fLo / fs); d = 1 + w / Q + w * w;          // 고역통과
      s = biquad(1 / d, -2 / d, 1 / d, 2 * (w * w - 1) / d, (1 - w / Q + w * w) / d, s);
    }
    return s;
  }
  // 원시 샘플 → ISO 10~1000 Hz RMS. 평균을 먼저 뺀다(ISO는 AC 기준).
  function isoRms(samples, fs) {
    if (!samples || samples.length < 256 || !(fs > 0)) return null;
    var n = samples.length, i, mean = 0;
    for (i = 0; i < n; i++) mean += samples[i];
    mean /= n;
    var x = new Array(n);
    for (i = 0; i < n; i++) x[i] = samples[i] - mean;
    var hi = Math.min(1000, fs / 2 * 0.98);        // Nyquist 바로 아래는 필터가 불안정하다
    var y = bandpass(x, 4, 10, hi, fs);
    if (!y) return null;
    var ss = 0;
    for (i = 0; i < y.length; i++) ss += y[i] * y[i];
    return Math.sqrt(ss / y.length);
  }
  /* 이 샘플레이트에서 대역제한이 의미가 있는가. Nyquist가 1000 Hz 이하면 1 kHz 위가
     애초에 측정되지 않으므로 전대역이 곧 ISO 대역이다(현장 1 kHz 센서가 여기 해당).
     그런 태그는 필터를 돌릴 이유가 없다. */
  function isoNeeded(fs) { return fs > 0 && fs / 2 > 1000; }

  /* 서로를 부르는 함수들을 TQL에 임베드할 소스로 묶는다.

     'var 이름 = ' + fn.toString() 식으로 하나씩 붙이면 압축본에서 죽는다: fn.toString()이
     'function Wt(...)'가 되는데 named function expression의 이름은 자기 안에서만 보이므로,
     이 함수를 부르는 다른 함수의 몸통에 남은 Wt가 바깥에서 안 보인다. 조립 코드가 쓴
     리터럴('var bandpass =')은 미니파이어가 건드리지 않으니 이름이 어긋난 채로 남는다.

     그래서 함수 "선언"들을 한 IIFE에 같이 넣어 서로를 찾게 하고, 밖으로는 압축된 실제
     이름(.name)으로 꺼내 고정된 이름에 붙인다. exports = { 바깥이름: 함수 }. */
  function embedSrc(fns, exports) {
    var keys = Object.keys(exports), parts = ['var __E=(function(){'];
    fns.forEach(function (fn) { parts.push(fn.toString()); });
    parts.push('return {' + keys.map(function (k) { return k + ':' + exports[k].name; }).join(',') + '};');
    parts.push('})();');
    parts.push('var ' + keys.map(function (k) { return k + '=__E.' + k; }).join(', ') + ';');
    return parts.join('\n');
  }
  // ISO 판정 3종 — isoRms → bandpass → biquad로 서로를 부른다
  function isoSrc() {
    return embedSrc([biquad, bandpass, isoRms, isoNeeded], { isoRms: isoRms, isoNeeded: isoNeeded });
  }

  /* 표시 등급 — 세 판정 중 가장 나쁜 것. ISO 존만 쓰면 고주파가 지배하는 센서에서
     베어링이 나빠져도 화면이 계속 양호로 보인다(C1이 그렇다: ISO는 위험이 나올 수 없다).
     무엇이 등급을 올렸는지 함께 돌려준다 — 등급만 보여주면 원인을 화면에서 알 수 없다. */
  function worstGrade(zoneGi, blGi, bandGi) {
    var g = zoneGi || 0, src = 'iso';
    if ((blGi || 0) > g) { g = blGi; src = 'baseline'; }
    if ((bandGi || 0) > g) { g = bandGi; src = 'band'; }
    return { gi: g, src: g > 0 ? src : 'iso' };
  }

  /* 버킷들을 판정 구간 단위로 묶어 구간 RMS 계열을 만든다 — 베이스라인 학습용.
     학습과 판정이 같은 단위여야 μ·σ가 판정값의 분포를 설명한다. 1초 버킷으로 배운 σ로
     10초 구간 값을 재면 기준 구간이 어긋난다(실측 영향은 0.1% 미만이지만 정합성 문제다).
     groupSec개씩 잘라 각 묶음을 windowRms로 합친다. 남는 꼬리는 버린다(불완전 구간). */
  function windowSeries(buckets, groupSec) {
    if (!buckets || !buckets.length) return [];
    var g = Math.max(1, Math.round(groupSec || 1));
    if (g === 1) return buckets.map(function (b) { return b.rms; }).filter(function (v) { return isFinite(v); });
    var out = [];
    for (var i = 0; i + g <= buckets.length; i += g) {
      var r = windowRms(buckets.slice(i, i + g), 0); // 학습은 과거 구간이라 미완성 버킷이 없다
      if (r) out.push(r.rms);
    }
    return out;
  }
  /* 채울 앵커 목록 — 최신에서 과거로, 격자에 스냅해서, 이미 있는 칸은 뺀다.
     · 격자 스냅: 타이머가 찍을 시각과 같은 칸에 놓아야 밀도가 균일해진다(균일화의 전제)
     · 최신 우선: 중간에 멈춰도 채운 쪽이 곧 학습에 쓰는 구간이 된다
     · 보유 칸 제외: TAG 테이블은 같은 NAME+TIME 중복을 막지 않아, 안 빼면 다시 누를 때마다 겹쳐 쌓인다
     have는 { 칸번호: true } — 칸번호는 Math.floor(ms / gridMs). */
  function bandAnchors(nowMs, gridMs, count, have) {
    if (!(gridMs > 0) || !(count > 0)) return [];
    have = have || {};
    var out = [];
    for (var i = 1; i <= count; i++) {
      var b = Math.floor((nowMs - i * gridMs) / gridMs);
      if (!have[b]) out.push(b * gridMs);
    }
    return out;
  }
  /* 서버 감시 TQL에 임베드할 자체 완결형 bandJudge 소스.
     toString()만 쓰면 모듈 스코프 상수(BAND_*)가 따라가지 않아 goja에서 ReferenceError가 난다.
     상수를 클로저 안에 값으로 굽고, baselineLimit만 바깥(monitor.tql이 별도로 임베드)에서 받는다. */
  function bandJudgeSrc() {
    return bandJudge.toString();   // 함수가 자체 완결이라 감쌀 것이 없다
  }
  // DETAIL 문자열 → [{k,ko,v,lim,r}] (이벤트 목록·알림 문구 렌더용)
  function bandParse(detail) {
    if (!detail) return [];
    return String(detail).split('·').map(function (s) {
      var m = /^\s*([a-z]+)\s*=\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(s);
      if (!m) return null;
      var v = parseFloat(m[2]), lim = parseFloat(m[3]);
      return { k: m[1], ko: BAND_KO[m[1]] || m[1], v: v, lim: lim, r: lim > 0 ? v / lim : 0 };
    }).filter(Boolean);
  }
  var BEARING_FS_RATIO = 20;
  function bearingFsOk(fs, bf) {
    if (!bf || !(fs > 0)) return true;
    var top = Math.max(bf.BPFO || 0, bf.BPFI || 0, bf.BSF || 0);
    return !(top > 0) || fs >= top * BEARING_FS_RATIO;
  }
  function bearingMatch(envQ, bf, fr) {
    if (!bf) return { known: false, hit: null, weak: null, negatives: [] };
    var cands = [
      { k: 'BPFO', f: bf.BPFO, tol: 0.02 }, { k: 'BPFI', f: bf.BPFI, tol: 0.02 },
      { k: 'BSF', f: bf.BSF, tol: 0.01 }, { k: 'FTF', f: bf.FTF, tol: 0.01 },
    ];
    if (!envQ || !(envQ.f0 > 0)) return { known: true, hit: null, weak: null, negatives: cands.map(function (c) { return c.k; }) };
    var hit = null, weak = null, negatives = [];
    cands.forEach(function (c) {
      if (!(c.f > 0)) { negatives.push(c.k); return; }
      var rel = Math.abs(envQ.f0 - c.f) / c.f;
      if (rel > c.tol) { negatives.push(c.k); return; }
      if (envQ.harm >= 2) { if (!hit) hit = { key: c.k, freq: c.f, relPct: rel * 100, harm: envQ.harm }; }
      else if (!weak) weak = { key: c.k, freq: c.f, relPct: rel * 100, harm: envQ.harm };
    });
    // 측대역 근거는 반송파가 해당 결함주파수일 때만 성립
    if (hit) hit.sbValid = (hit.key === 'BPFI' && !!(envQ && envQ.sb1x)) ? '1× 측대역 동반(내륜 전형)'
      : (hit.key === 'BPFO' && envQ && envQ.sb1x) ? '측대역 관측 — 외륜은 통상 측대역 없음(재확인 필요)' : '';
    return { known: true, hit: hit, weak: weak, negatives: negatives };
  }

  /* 가속도계 마운팅별 유효 주파수 상한(Hz) — 이 위의 진동은 기계가 아니라 마운팅 자체가 울린 것이다.
     커토그램은 "가장 충격성이 강한 대역"을 고르는데, 마운팅 공진은 정확히 그렇게 보인다 →
     상한을 안 걸면 자석 마운트에서 공진 대역을 골라 포락선 복조까지 그 위에서 하게 된다.
     미상(0)이면 제한하지 않되, 리포트에 "고주파 대역 유효성 미상"으로 남는다. */
  var MOUNT_FMAX = { stud: 10000, adhesive: 5000, magnet: 2000, probe: 1000 };
  function mountFmax(mount) { return MOUNT_FMAX[mount] || 0; }

  /* 벨트 구동 파생 주파수 — 풀리경 두 개면 종동축 1×가 나온다.
     "비동기 기본파 + 자체 하모닉"의 가장 흔한 정체가 종동축이라, 이 두 값만으로 귀속이 닫히는 경우가 많다.
     벨트 통과주파수는 벨트길이(L)가 있어야 계산된다 — 없으면 종동축만 반환. 길이 단위는 풀리경과 같게(mm). */
  function beltFreqs(fr, belt) {
    if (!(fr > 0) || !belt) return null;
    var d1 = Number(belt.d1) || 0, d2 = Number(belt.d2) || 0, L = Number(belt.len) || 0;
    if (!(d1 > 0 && d2 > 0)) return null;
    var out = { driven: fr * (d1 / d2), ratio: d1 / d2 };
    if (L > 0) out.belt = Math.PI * d1 * fr / L; // 벨트속도(π·D1·fr) ÷ 벨트길이
    return out;
  }

  // 커토그램 — 대역별 Spectral Kurtosis(대역통과 신호의 첨도)를 스캔해 "가장 충격성이 강한 대역"을 찾는다.
  // 포락선 복조 대역을 자동 선택하기 위한 앞단. fmaxHz>0이면 그 위 대역은 스캔 자체에서 제외(마운팅 상한).
  // 반환 { levels:[{nb,bwHz,sk:[...]}], best:{loHz,hiHz,center,bw,sk}, fmax, capped }
  function kurtogram(values, fs, fmaxHz) {
    var n = values.length;
    if (n < 512 || !(fs > 0)) return null;
    var m = 1; while (m * 2 <= n) m *= 2;
    var re0 = new Array(m), im0 = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re0[i] = values[i] - mean; im0[i] = 0; }
    fftComplex(re0, im0); // 스펙트럼 1회 계산 후, 대역마다 역FFT만
    var df = fs / m, nyqBin = m / 2;
    // 상한을 스캔 범위에 반영 — 후처리로 거르면 "고른 뒤 버리는" 꼴이라 차선 대역을 못 찾는다
    var nyq = (fmaxHz > 0) ? Math.min(nyqBin, Math.floor(fmaxHz / df)) : nyqBin;
    var capped = nyq < nyqBin;
    if (nyq < 64) return null; // 상한이 너무 낮아 대역을 못 나눔(핸드프로브 + 저샘플링 등)
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
    return { levels: levels, best: best, fmax: nyq * df, capped: capped, nyqFull: nyqBin * df };
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
    // res=제로패딩 후 빈 간격(표시용) · resTrue=창 길이가 정하는 실제 분해능(불확도·측대역 판정 근거)
    return { freqs: freqs, mags: mags, res: res, resTrue: fs / n };
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
    var res0 = freqs.length > 1 ? (freqs[1] - freqs[0]) : 1;
    for (h = 1; h <= nHarm; h++) {
      var t = f0 * h; if (t > fmax) break;
      var tol = Math.max(1.5 * res0, t * 0.01), best = 0;
      for (i = 0; i < freqs.length; i++) if (Math.abs(freqs[i] - t) <= tol && mags[i] > best) best = mags[i];
      if (best > (minMag || 0)) { e += best; cnt++; }
    }
    return { energy: e, count: cnt };
  }
  // 반송파 주변 측대역 에너지 — carrier ± k·spacing (k=1..n), 유의 진폭만
  function sidebandEnergy(freqs, mags, carrier, spacing, n, minMag) {
    if (!(carrier > 0) || !(spacing > 0) || !freqs.length) return 0;
    var e = 0, fmax = freqs[freqs.length - 1], k, i;
    var resS = freqs.length > 1 ? (freqs[1] - freqs[0]) : 1;
    for (k = 1; k <= n; k++) {
      var ts = [carrier - k * spacing, carrier + k * spacing];
      for (var j = 0; j < 2; j++) {
        var t = ts[j]; if (t <= 0 || t > fmax) continue;
        var tol = Math.max(1.5 * resS, t * 0.01), best = 0;
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
    var resO = freqs.length > 1 ? (freqs[1] - freqs[0]) : 1;
    var domOrd = domF != null ? domF / fr : 0, domR = Math.round(domOrd);
    var domSync = domR >= 1 && Math.abs(domOrd - domR) <= Math.max(0.01 * domR, resO / (fr || 1));
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
    else if (oneXn.count >= 4 && !domSync) { out.notes.push('정수배 하모닉 ' + oneXn.count + '개 존재하나 지배 성분이 비동기(' + domOrd.toFixed(2) + '×) — 하모닉만으로 풀림 단정 불가(우선순위는 근거점수 표를 따를 것)'); }
    if (twoX > 0 && oneX > 0 && twoX >= 0.8 * oneX && domSync) { out.notes.push('2×(' + (2 * fr).toFixed(0) + ' Hz)가 1× 이상으로 우세 — 축 정렬 불량 패턴'); picked = picked || '축 정렬 불량'; }
    out.cause = picked;
    return out;
  }

  // 지배 주파수 규칙 진단: 1×/2×/베어링 결함 주파수와 대조 (±max(1.5Hz, 4%))
  function diagnoseDominant(freqs, mags, fr, bf) {
    var domF = null, domM = 0, i;
    for (i = 0; i < freqs.length; i++) if (mags[i] > domM) { domM = mags[i]; domF = freqs[i]; }
    if (domF == null) return null;
    var resD = freqs.length > 1 ? (freqs[1] - freqs[0]) : 1;
    function near(f, ref) { return ref > 0 && Math.abs(f - ref) <= Math.max(1.5 * resD, ref * 0.01); }
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

  /* ---------------- 베이스라인(정상 상태) 학습 — 로버스트 ----------------
     한계 = μ + k·σ 구조는 유지하되 μ·σ를 median / 1.4826·MAD로 추정한다.
     평균·표준편차는 학습 구간에 스파이크 몇 개만 섞여도 σ가 배수로 부풀어
     "이탈을 잡으라고 만든 기준이 이탈을 덮는" 역설이 생긴다(스파이크 3/60개로 한계 3배).
     중앙값 계열은 표본 절반이 오염돼도 유지되고, 1.4826은 정규 등가 스케일 보정이라
     k=3의 "3σ" 의미·저장 포맷 {mu,sigma,k}·UI 표기가 전부 그대로다. */
  var BASELINE_MIN_N = 30; // 최소 표본 — 이보다 적으면 산포 추정 자체가 신뢰 불가
  function median(a) {
    if (!a.length) return NaN;
    var x = a.slice().sort(function (p, q) { return p - q; }), m = x.length >> 1;
    return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
  }
  function baselineFit(vals) {
    var n = vals.length;
    if (n < BASELINE_MIN_N) return null; // 표본 부족 — 학습 불가
    var med = median(vals);
    var sigma = 1.4826 * median(vals.map(function (v) { return Math.abs(v - med); }));
    return { mu: med, sigma: sigma, n: n };
  }
  /* 정상상태 게이트 — 학습 표본에서 정지·과도(기동/정지 램프) 버킷을 미리 제외한다.
     추정식이 아무리 강건해도 표본 절반이 정지 구간이면 median 자체가 내려간다.
     참조 수준은 P75(운전 레벨) — 정지 비중이 높아도 운전 중 수준을 가리키게.
     vals는 시간순이어야 한다(램프 감지가 인접 차분 기반). */
  var BL_IDLE_FRAC = 0.2;  // 참조의 20% 미만 = 정지·아이들
  var BL_RAMP_FRAC = 0.3;  // 인접 버킷 변화가 참조의 30% 초과 = 기동/정지 과도
  /* 이중 수준(정지↔운전) 판정 — 개수 비율만으로는 충격성 신호와 구분되지 않는다.
     실측: 임펄스가 잦은 정상 신호도 중앙값의 3배 위에 16%가 몰리지만 상위군은 중앙값의 5~6배에 그친다.
     정지가 대부분인 창은 상위군(=실제 운전 수준)이 중앙값(=정지 수준)의 수십 배다.
     그래서 "얼마나 많이"와 "얼마나 위에"를 함께 본다. */
  var BL_BIMODAL_FRAC = 0.1;   // 중앙값의 3배 위 표본 비율
  var BL_BIMODAL_RATIO = 10;   // 상위군 중앙값 / 전체 중앙값
  function steadyStateFilter(vals) {
    var n = vals.length;
    if (!n) return { vals: [], idle: 0, ramp: 0, ref: 0, bimodalFrac: 0 };
    /* 이중 수준 감지는 "필터 전" 원본에서 한다 — 창의 대부분이 정지면 P75 참조가 정지 수준에
       붙어 아래 필터가 통째로 무력화되고(운전 버킷이 전부 "과도"로 걸러짐), 필터 후 표본만 보면
       멀쩡해 보인다. 비율과 높이를 함께 봐야 충격성 정상 신호를 오인하지 않는다(BL_BIMODAL_* 주석 참조). */
    var med0 = median(vals), hiVals = [], j;
    for (j = 0; j < n; j++) if (vals[j] > 3 * med0) hiVals.push(vals[j]);
    var bimodalFrac = hiVals.length / n;
    var bimodalRatio = hiVals.length ? median(hiVals) / med0 : 0;
    var bimodal = bimodalFrac > BL_BIMODAL_FRAC && bimodalRatio >= BL_BIMODAL_RATIO;
    var x = vals.slice().sort(function (p, q) { return p - q; });
    var ref = x[Math.floor(0.75 * (n - 1))];
    if (!(ref > 0)) return { vals: vals.slice(), idle: 0, ramp: 0, ref: 0, bimodalFrac: bimodalFrac, bimodalRatio: bimodalRatio, bimodal: bimodal }; // 전부 0 수준 — 거를 기준 없음
    var out = [], idle = 0, ramp = 0, i, thr = ref * BL_RAMP_FRAC;
    for (i = 0; i < n; i++) {
      var v = vals[i];
      if (v < ref * BL_IDLE_FRAC) { idle++; continue; }
      // 양측 검사 — 이전만 보면 완만한 계단 램프가 새고, 스파이크 옆 버킷도 오염돼 있다
      var dPrev = i > 0 ? Math.abs(v - vals[i - 1]) : 0;
      var dNext = i < n - 1 ? Math.abs(vals[i + 1] - v) : 0;
      if (dPrev > thr || dNext > thr) { ramp++; continue; }
      out.push(v);
    }
    return { vals: out, idle: idle, ramp: ramp, ref: ref, bimodalFrac: bimodalFrac, bimodalRatio: bimodalRatio, bimodal: bimodal };
  }
  /* 한계 클램프 — 초안정 신호(σ≈0)에서 한계가 μ에 붙어 노이즈 수준 변동에도 알람이 반복되는
     것을 방지. 최소한 평소의 +20%는 올라야 "이탈"로 본다.
     ⚠이 함수는 소스 문자열로 서버 감시 스크립트에 임베드된다(monitor.js) — 외부 변수 참조 금지. */
  function baselineLimit(bl) {
    if (!bl) return null;
    return Math.max(bl.mu + (bl.k || 3) * bl.sigma, bl.mu * 1.2);
  }

  return {
    ISO_ZONES: ISO_ZONES, UNIT_ZONES: UNIT_ZONES, zonesFor: zonesFor, gradeFor: gradeFor,
    BEARINGS: BEARINGS, bearingFreqs: bearingFreqs, faultFreqSummary: faultFreqSummary,
    toBucket: toBucket, kurtosis: kurtosis, fmt: fmt, timeIndics: timeIndics,
    fftComplex: fftComplex, bandKurtosis: bandKurtosis, amplitudeSpectrum: amplitudeSpectrum, envelopeSpectrum: envelopeSpectrum,
    bandpassSignal: bandpassSignal, kurtogram: kurtogram,
    MOUNT_FMAX: MOUNT_FMAX, mountFmax: mountFmax, beltFreqs: beltFreqs,
    RULESET: RULESET, rulesetFingerprint: rulesetFingerprint,
    bandRms: bandRms, bandRmsMulti: bandRmsMulti, measuredOneX: measuredOneX, envelopeQuant: envelopeQuant, bearingMatch: bearingMatch,
    bearingFsOk: bearingFsOk, BEARING_FS_RATIO: BEARING_FS_RATIO,
    isoRms: isoRms, bandpass: bandpass, biquad: biquad, isoNeeded: isoNeeded, isoSrc: isoSrc, embedSrc: embedSrc, worstGrade: worstGrade,
    bandJudge: bandJudge, bandJudgeSrc: bandJudgeSrc, bandParse: bandParse, evenSample: evenSample, bandAnchors: bandAnchors, bandEdges: bandEdges, bandMeasurable: bandMeasurable, windowRms: windowRms, windowSeries: windowSeries, isRunning: isRunning, runRef: runRef, detectFlap: detectFlap,
    BAND_KO: BAND_KO, BAND_ORDER: BAND_ORDER, BAND_GRADE: BAND_GRADE, BAND_HYST: BAND_HYST, BL_IDLE_FRAC: BL_IDLE_FRAC,
    bandRmsAveraged: bandRmsAveraged, welchSpectrum: welchSpectrum, decimate: decimate,
    convertDomain: convertDomain, convertSpectrumMags: convertSpectrumMags,
    signalQuality: signalQuality, kurtosisSaturation: kurtosisSaturation,
    cepstrumFromSpectrum: cepstrumFromSpectrum, stftGrid: stftGrid, bandEnergies: bandEnergies,
    diagnoseDominant: diagnoseDominant, analyzeSpectrum: analyzeSpectrum, harmonicEnergy: harmonicEnergy,
    baselineFit: baselineFit, baselineLimit: baselineLimit,
    steadyStateFilter: steadyStateFilter, median: median,
    BASELINE_MIN_N: BASELINE_MIN_N, BL_BIMODAL_FRAC: BL_BIMODAL_FRAC, BL_BIMODAL_RATIO: BL_BIMODAL_RATIO
  };
});
