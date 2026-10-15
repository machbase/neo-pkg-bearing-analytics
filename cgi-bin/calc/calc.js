// calc/calc.js — 진동 계산 코어 (순수 JS · fetch/DOM 없음)
// 프론트(Vite import)·jsh(require) 겸용 UMD — 계산 로직 단일 소스
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
   * 판정 상수들의 해시 — 지문 다름=엔진 변경, 지문 같은데 결과 다름=데이터 변경
   * ⚠판정 상수 변경 시 이 목록에도 반영할 것
   */
  var RULESET = '2026.08b';
  function rulesetFingerprint() {
    var p = [
      'iso:10-1000', 'isoBlocks:8', 'parseval:0.03',
      'crest:15', 'kurt:25', 'dcGate:drift0.5/rev10/spr4/levelInfo', 'crestBands:5/8/15', 'kurtBands:4/10/25',
      'matchTol:0.01', 'bpfTol:0.02', 'harm:2', 'ordTolRel:0.01',
      'satMinSpanMin:' + SAT_MIN_SPAN_MIN,
      'mountFmax:10000/5000/2000/1000', 'bandSoft:edgeHi>fmax/capWarn',
      'bl:mad1.4826/idle0.2/ramp0.3/margin0.2/bimodal0.1x10',
      'bearingFsRatio:20', 'aliasFmax:0.8nyq/half', 'winMs:exact', 'bandGrade:1.5/3.0/hyst0.9',
      'bandLimGate:>0', 'evalWin:rms/partialCnt0.9',
      'isoZoneUnit:mm/s-always', 'isoConvert:accel-integrate/disp-differentiate',
      'axes:iso+baseline+band+pattern', 'patAxis:evid>=' + EVID_ADOPT + '/cap1/gateOff',
      'avgGraded:false', 'crestArtifact:needRawGate', 'crestThr:sqrt2lnN+1/imp<=10s', 'trend:ungraded/x2/run0.2', 'kgNyqFrac:' + KG_NYQ_FRAC, 'bandAx:freq+env',
      'demodFix:' + DEMOD_FIX.join('-'), 'comb:' + COMB_ADOPT + '/m' + COMB_M,
    ].join('|');
    var hsh = 2166136261; // FNV-1a
    for (var i = 0; i < p.length; i++) { hsh ^= p.charCodeAt(i); hsh = (hsh * 16777619) >>> 0; }
    return hsh.toString(36).slice(0, 6);
  }

  /* ---------------- ISO 10816 / 단위별 존 ---------------- */
  var ISO_ZONES = { I: [0.71, 1.8, 4.5], II: [1.12, 2.8, 7.1], III: [1.8, 4.5, 11.2], IV: [2.8, 7.1, 18.0] };
  var UNIT_ZONES = { 'mm/s': null, 'g': [0.5, 1.0, 2.0], 'μm': [12, 25, 50] };
  // 이 위 Crest = 스파이크성 잡음(ESD·케이블·접촉) 시그니처
  // signalQuality도 같은 경계 사용 — TQL 임베드라 값(15)으로 직접 씀
  var CREST_ARTIFACT = 15;
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
    // NASA/IMS 공개 베어링 데이터셋의 시험 베어링 — 열당 롤러 16개(복열), 2.815"/0.331" → mm
    'ZA-2115': { n: 16, Bd: 8.407, Pd: 71.501, phi: 15.17 },
    'sleeve': { n: 0, Bd: 0, Pd: 0, phi: 0 }
  };
  /* 폐기 롤러 품번 — 롤러 수 출처 없음(±1이면 결함주파수 6~9% 이동), 옛 설정 이관(app normCfg) 전용·신규 선택 불가 */
  var RETIRED_BEARINGS = {
    '22218': { n: 14, Bd: 20.0, Pd: 130, phi: 12 }, '23124': { n: 17, Bd: 25.0, Pd: 165, phi: 10 },
    'NU312': { n: 12, Bd: 20.0, Pd: 96.5, phi: 0 }, 'NU316': { n: 11, Bd: 26.0, Pd: 127, phi: 0 },
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

  /* 결함 주파수의 fr 배수 계수 — 호출측이 실측 fr을 곱해 사용(명판 고정 방지). 형상 없으면 null */
  function faultCoeffs(b) {
    if (!b || !(b.n > 0) || !(b.Pd > 0)) return null;
    var ratio = (b.Bd / b.Pd) * Math.cos((b.phi || 0) * Math.PI / 180);
    return {
      O: (b.n / 2) * (1 - ratio),
      I: (b.n / 2) * (1 + ratio),
      B: b.Bd > 0 ? (b.Pd / (2 * b.Bd)) * (1 - ratio * ratio) : 0,
      F: 0.5 * (1 - ratio),
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
  // /db/query 롤업 행 r=[ms, SUMSQ, COUNT, MIN, MAX, SUM?] → {ms, rms, p2p, crest, cnt, mn, mx(, sum)}
  // SUM 있으면 windowRms가 DC 뺀 AC 실효값 산출
  function toBucket(r) {
    var cnt = r[2];
    if (!cnt) return null;
    var rms = Math.sqrt(Math.max(0, r[1]) / cnt);
    var mn = r[3], mx = r[4];
    var b = { ms: r[0], rms: rms, p2p: mx - mn, crest: rms > 0 ? Math.max(Math.abs(mn), Math.abs(mx)) / rms : 0, cnt: cnt, mn: mn, mx: mx };
    if (r.length > 5 && isFinite(r[5])) b.sum = r[5];
    return b;
  }

  /* 기간 지표 4종(avg·p95·crest·trend) — 상세분석·리포트 공용, 전부 graded:false(등급은 앵커 축 몫)
     badge 있을 때만 화면 배지, 라벨·서식은 호출측 몫 */
  function sevMetrics(roll, o) {
    o = o || {}; roll = roll || [];
    var zones = o.zones || [0, 0, 0], gate = !!o.gate, i;
    // 버킷 rms는 DC 포함 → 평균 빼 AC 실효값으로. Crest peak도 평균 기준
    var rms = [], crestA = [], cnt = 0;
    for (i = 0; i < roll.length; i++) {
      var b0 = roll[i];
      var m0 = (b0 && b0.cnt > 0 && isFinite(b0.sum)) ? b0.sum / b0.cnt : 0;
      var ac0 = Math.sqrt(Math.max(0, b0.rms * b0.rms - m0 * m0));
      if (!isFinite(ac0) || (!isFinite(b0.sum) && ac0 === 0)) ac0 = b0.rms;   // SUM 없는 버킷은 rms 그대로
      rms.push(ac0);
      var pk0 = (isFinite(b0.mn) && isFinite(b0.mx)) ? Math.max(Math.abs(b0.mn - m0), Math.abs(b0.mx - m0)) : null;
      crestA.push(pk0 != null && ac0 > 1e-12 ? pk0 / ac0 : b0.crest);
      cnt += (b0.cnt || 0);
    }
    var mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; };
    var pctl = function (a, p) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0; };
    var q4 = Math.max(1, Math.floor(rms.length / 4));
    var prevQ = mean(rms.slice(-2 * q4, -q4));
    var wTrend = prevQ > 0 ? mean(rms.slice(-q4)) / prevQ : 1;
    var wAvg = mean(rms), rP95 = pctl(rms, 0.95), cP95 = pctl(crestA, 0.95);
    var wMax = rms.length ? Math.max.apply(null, rms) : 0;
    var wMin = rms.length ? Math.min.apply(null, rms) : 0;
    var wCrest = crestA.length ? Math.max.apply(null, crestA) : 0;
    var overBC = 0;
    for (i = 0; i < rms.length; i++) if (rms[i] > zones[1]) overBC++;
    var perBucket = Math.max(2, roll.length ? Math.round((cnt || roll.length * (o.fs || 1)) / roll.length) : (o.fs || 1));
    var cExp = Math.sqrt(2 * Math.log(perBucket)), cThr = cExp + 1;
    var durMin = roll.length > 1 ? (roll[roll.length - 1].ms - roll[0].ms) / 60000 : 0;
    var stepSec = 0;   // 버킷 길이 = 이웃 간격 최솟값(수집 끊김 무관)
    for (i = 1; i < roll.length; i++) { var dts = (roll[i].ms - roll[i - 1].ms) / 1000; if (dts > 0 && (!stepSec || dts < stepSec)) stepSec = dts; }
    var impOk = !stepSec || stepSec <= 10;   // 버킷 10초 초과면 충격성 판단 안 함(긴 버킷은 부하 변동이 Crest를 키움)
    /* 변화율 비교 조건 — 관측 60분 이상 + 두 구간 모두 운전(기준=창 P95, 정지·기동 혼입 시 ×20도 나옴) */
    var winOk = durMin >= 60, lastQ = mean(rms.slice(-q4));
    var cmp = winOk && isRunning(prevQ, rP95) && isRunning(lastQ, rP95);
    // 계측 게이트 중엔 등급어 대신 '잠정' — 자기 배지 있으면 그것 우선
    var hold = function (own) { return own || (gate ? '잠정' : ''); };
    return {
      /* 평균은 등급 기준 아님 — 조용한 구간이 고진동 구간을 희석해 과소평가 */
      avg: { value: wAvg, thr: zones[1], graded: false, grade: gradeFor(wAvg, zones), badge: hold('') },
      /* P95도 등급 없음 — 카드는 광대역·원본 단위, 등급은 ISO 대역제한·속도라 기준 불일치. 값·기준은 노출량 통계로 유지 */
      p95: { value: rP95, thr: zones[1], graded: false, grade: gradeFor(rP95, zones), badge: hold('') },
      /* Crest — 등급 없음(√(2·ln N) 기준이 롤업 길이에 좌우), 배지는 P95 기준
         '계측 아티팩트'는 원시 파형 게이트 동반 시만, 없으면 '충격성 강함'(note) */
      crest: { value: cP95, thr: cThr, artifact: CREST_ARTIFACT, graded: false, impOk: impOk,
        grade: !impOk || cP95 < cThr ? 0 : cP95 < 8 ? 1 : cP95 < CREST_ARTIFACT ? 2 : 3,
        badge: cP95 > CREST_ARTIFACT ? (gate ? '계측 아티팩트 의심' : '충격성 강함') : hold(''),
        note: cP95 > CREST_ARTIFACT && !gate },
      trend: { value: wTrend, thr: 2.0, graded: false, grade: 0, winOk: winOk, cmp: cmp, over: cmp && wTrend > 2,
        badge: cmp && wTrend > 2 ? '×2 초과' : hold('') },
      n: { cnt: cnt, buckets: roll.length, perBucket: perBucket, cExp: cExp, cThr: cThr, stepSec: stepSec, durMin: durMin,
        overBC: overBC, wAvg: wAvg, wMin: wMin, wMax: wMax, wCrest: wCrest, wTrend: wTrend, rMed: pctl(rms, 0.5) },
    };
  }

  /* 기간 내 지속된 최악 — 개수(minN)·시간(holdMs) 동시 충족 창의 최솟값 중 최대, 버킷 간격×DWELL_GAP_MULT 넘는 갭에서 끊음
     반환 { v, ms(창 끝), n, durMs } */
  var DWELL_MIN_N = 3;             // 추세로 볼 최소 개수(2개는 우연과 구분 불가)
  var DWELL_GAP_MULT = 3;          // 버킷 간격의 이 배수 초과 = 수집 끊김
  function dwellWorst(roll, holdMs, minN) {
    if (!roll || roll.length < 1) return null;
    var need = Math.max(minN || DWELL_MIN_N, 1);
    var step = 0, i;
    for (i = 1; i < roll.length; i++) {
      var d = roll[i].ms - roll[i - 1].ms;
      if (d > 0 && (!step || d < step)) step = d;
    }
    if (!step) step = 1000;
    var gapMax = step * DWELL_GAP_MULT;
    var best = null, run = [];
    var flush = function () {
      if (run.length < need) { run = []; return; }
      // 창을 넓혀 가며 "창 안 최솟값"의 최댓값 탐색 — 그 창 내내 유지된 수준
      var j, k;
      for (j = 0; j + need <= run.length; j++) {
        var mn = Infinity, endK = j;
        for (k = j; k < run.length; k++) {
          if (run[k].v < mn) mn = run[k].v;
          endK = k;
          var span = run[endK].ms - run[j].ms + step;
          if ((k - j + 1) >= need && span >= (holdMs || 0)) {
            if (!best || mn > best.v) best = { v: mn, ms: run[endK].ms, n: k - j + 1, durMs: span };
          }
        }
      }
      run = [];
    };
    for (i = 0; i < roll.length; i++) {
      var b = roll[i];
      if (!b || !(b.rms >= 0) || !isFinite(b.rms)) { flush(); continue; }
      if (run.length && (b.ms - run[run.length - 1].ms) > gapMax) flush();
      run.push({ v: b.rms, ms: b.ms });
    }
    flush();
    return best;
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
    // 힌트는 참조 정상범위 밴드(단일 임계면 정상 기계도 경보) — 첨도는 비단조(말기엔 3 근처로 회귀)
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

  // 밴드 커토시스: ≥loHz만 남긴 신호의 커토시스 — 회전 성분 제거로 베어링·기어 충격의 임펄스성만 평가
  // 저주파 빈 0 → 역FFT(켤레 트릭)로 시간영역 복원
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

  // 신호 품질 체크 — 분석 전 garbage-in 방어(sparse·flatline·clip·dc·dcoff(참고)·spike·kurtx)
  //  fr: 회전 Hz — 구간당 10회전·회전당 4샘플 이상일 때만 dc 판단
  //  반환 { ok, issues:[{key,label,detail,info?}], severe(판정 신뢰 불가), gate(판정 보류) }
  function signalQuality(values, fs, fr) {
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
    // clip: 최고치 밴드가 바로 아래 밴드보다 과밀 = 평평한 꼭대기(사인은 밀도비 ≈2.4라 미해당)
    // 밴드폭은 range·σ 중 좁은 쪽 — range만 쓰면 단발 스파이크가 range를 키워 클리핑 오분류
    var b = Math.min(range * 0.005, std * 0.05) || range * 0.005;
    function inBand(lo, hi) { var c = 0; for (var j = 0; j < n; j++) if (values[j] >= lo && values[j] < hi) c++; return c; }
    var topMax = inBand(mx - b, mx + 1e-9), nextMax = inBand(mx - 2 * b, mx - b);
    var topMin = inBand(mn - 1e-9, mn + b), nextMin = inBand(mn + b, mn + 2 * b);
    var clipMax = topMax > 0.03 * n && topMax > 4 * (nextMax + 1);
    var clipMin = topMin > 0.03 * n && topMin > 4 * (nextMin + 1);
    if (clipMax || clipMin) issues.push({ key: 'clip', label: '클리핑(포화)', detail: '파형 꼭대기가 잘렸습니다 — 측정범위 초과, 진폭 과소·가짜 고주파 위험' });
    // 일정한 DC — 참고만(MEMS 가속도계 중력축·근접 변위센서의 갭 전압)
    if (Math.abs(mean) > 3 * std) {
      issues.push({ key: 'dcoff', info: true, label: 'DC 성분', detail: '평균이 진동 σ의 ' + (Math.abs(mean) / std).toFixed(0)
        + '배 — DC 결합 센서(MEMS 가속도계 중력축·근접 변위센서)면 정상입니다. 판정값은 DC를 뺀 값입니다' });
    }
    // DC 드리프트 — 구간 평균의 흔들림 > 구간 안 σ의 0.5배(RMS 12% 이상 과대), gateFromBuckets와 같은 규칙
    var nSeg = fr > 0 && fs >= 4 * fr ? Math.min(8, Math.floor(n / fs * fr / 10)) : 0;
    if (nSeg >= 3) {
      var segN = Math.floor(n / nSeg), sw = 0, sb = 0, k;
      for (k = 0; k < nSeg; k++) {
        var s0 = 0, s2 = 0;
        for (i = k * segN; i < (k + 1) * segN; i++) { s0 += values[i]; s2 += values[i] * values[i]; }
        var sm = s0 / segN;
        sw += Math.max(0, s2 / segN - sm * sm); sb += (sm - mean) * (sm - mean);
      }
      sw = Math.sqrt(sw / nSeg); sb = Math.sqrt(sb / nSeg);
      if (sw > 0 && sb > 0.5 * sw) {
        issues.push({ key: 'dc', label: 'DC 드리프트', detail: '구간 평균의 흔들림이 진동 σ의 ' + (sb / sw).toFixed(2)
          + '배 — 센서 바이어스·케이블·마운트 이상 의심, RMS 과대 가능' });
      }
    }
    // 계측 아티팩트: 극단 Crest/첨도 = 단발 스파이크(ESD·케이블·커넥터) 시그니처(베어링 결함은 통상 Crest<10)
    var peakAC = Math.max(Math.abs(mx - mean), Math.abs(mn - mean));
    var crest = std > 1e-12 ? peakAC / std : 0, kurt = kurtosis(values), gate = false;
    if (crest > 15) { issues.push({ key: 'spike', label: '단발 스파이크 의심', detail: 'Crest ' + crest.toFixed(1) + ' — 결함 신호(통상 <10)보다 스파이크성 잡음(ESD·케이블·접촉) 시그니처에 가깝습니다' }); }
    if (kurt > 25) { issues.push({ key: 'kurtx', label: '극단 첨도', detail: 'Kurtosis ' + kurt.toFixed(1) + ' — 소수 샘플이 지배하는 신호, 계측 아티팩트 가능성 — 센서·마운팅 확인 필요' }); }
    /* 판정 차단 사유 — GATE_BLOCK과 같은 목록 유지(다르면 감시·상세 판정 불일치)
       ⚠서버 TQL 임베드용 — 배열은 함수 안에 둘 것(바깥 이름 참조 불가) */
    var BLOCK = ['flatline', 'sparse', 'spike', 'kurtx', 'clip', 'dc'];
    var real = 0;
    for (i = 0; i < issues.length; i++) {
      if (BLOCK.indexOf(issues[i].key) >= 0) gate = true;
      if (!issues[i].info) real++;
    }
    return { ok: real === 0, issues: issues, severe: false, gate: gate };
  }

  // 첨도 포화 감지 — 첨도 고점 대비 하락 + RMS 유지/상승이면 "회복 아님(결함 확산 말기)" 경고
  //  kurtSeries·rmsSeries: 시간순 배열. 반환 { flag, msg }
  //  spanMin: 관측 구간(분) — SAT_MIN_SPAN_MIN 미만이면 운전조건 변화로 안내(말기 확산은 주·월 단위 추세에서만 성립)
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
    // 같은 구간 RMS 유지/상승이어야 "회복 아님"
    // ⚠ kurt·rms 배열 길이가 다를 수 있음(청크 수 vs 버킷 수) → 시간 비율로 같은 시점끼리 비교
    var r = (rmsSeries || []).filter(function (x) { return isFinite(x); });
    if (r.length >= 3) {
      var rPeak = r[Math.round(pi / (k.length - 1) * (r.length - 1))], rCur = r[r.length - 1];
      if (rCur < rPeak * 0.9) return { flag: false }; // RMS도 내렸으면 진짜 회복(일시 스파이크 등)
    }
    return { flag: true, msg: '첨도가 고점(' + pk.toFixed(1) + ')에서 ' + cur.toFixed(1) + '로 하락했으나 RMS는 유지·상승 — "회복"이 아니라 결함 확산(말기)일 수 있습니다. 포락선·RMS를 함께 확인하세요.' };
  }

  // 물리량 변환 — 가속도(g)↔속도(mm/s)↔변위(μm). 주파수 영역에서 (iω)^Δorder 적용 → 역FFT
  //  · 주파수 영역이라 적분 상수 드리프트 누적 없음
  //  · 적분(order↓) 시 저주파 드리프트 고역통과 제거, 미분(order↑)은 필터 불필요
  //  · order: 변위=0 · 속도=1 · 가속도=2. SI 변환 → 계수 적용 → 표시 단위 복귀
  /* 단위 → [SI 배율, order]. 표시값 × 배율 = SI(m/s²·m/s·m)
     ⚠ convSrc로 서버 TQL 임베드 — 표는 함수 안에 둘 것(모듈 상수 참조 시 압축본 ReferenceError) */
  function unitScale(u) {
    var T = { 'g': [9.80665, 2], 'mm/s': [1e-3, 1], 'μm': [1e-6, 0] };
    return T[u] || null;
  }
  function convertDomain(values, fs, fromUnit, toUnit, fr) {
    if (fromUnit === toUnit) return values.slice(0);
    var uf = unitScale(fromUnit), ut = unitScale(toUnit);
    if (!uf || !ut || uf[1] === ut[1]) return values.slice(0);
    var sFrom = uf[0], sTo = ut[0], d = ut[1] - uf[1];
    var n = values.length, m = 1; while (m * 2 <= n) m *= 2;
    if (m < 16 || !(fs > 0)) return values.slice(0);
    var re = new Array(m), im = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re[i] = (values[i] - mean) * sFrom; im[i] = 0; }
    fftComplex(re, im);
    var df = fs / m, integ = d < 0;
    /* 적분 시 저주파 드리프트 컷(1/ω 이득으로 DC 근처 잡음 폭발) — fr×0.3, 2~10 Hz로 제한
       10 Hz 상한: ISO 10816/20816 대역 하한(그 아래는 ISO 대역제한이 걸러냄) */
    var hpBin = integ ? Math.max(1, Math.round(Math.min(10, Math.max(2, (fr || 0) * 0.3)) / df)) : 0;
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
  // 스펙트럼(진폭) 물리량 변환 — 서버 FFT mags → 표시 단위, |(iω)^d| = ω^d 스케일
  function convertSpectrumMags(mags, freqs, fromUnit, toUnit) {
    var uf = unitScale(fromUnit), ut = unitScale(toUnit);
    if (!uf || !ut || uf[1] === ut[1]) return mags.slice(0);
    var d = ut[1] - uf[1], sc = uf[0] / ut[0];
    return mags.map(function (mg, i) { var w = 2 * Math.PI * freqs[i]; return w > 0 ? mg * sc * Math.pow(w, d) : 0; });
  }

  // 대역통과: [loHz,hiHz] 밖 빈 제거 후 역FFT → 그 대역만 남은 실신호(양측 대칭 유지)
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

  // 대역제한 RMS — FFT 대역통과 후 실효값(ISO 10816/20816은 10–1000 Hz 대역제한 속도 RMS 기준)
  function bandRms(values, fs, loHz, hiHz) {
    var bp = bandpassSignal(values, fs, loHz, hiHz);
    var s = 0, i; for (i = 0; i < bp.length; i++) s += bp[i] * bp[i];
    return bp.length ? Math.sqrt(s / bp.length) : 0;
  }

  /* 여러 대역 RMS를 FFT 한 번으로 — Parseval로 주파수영역 제곱합(대역별 역FFT 생략)
     bands: [[lo,hi], …] → 같은 순서의 RMS 배열(bandRms와 동일 값) */
  function bandRmsMulti(values, fs, bands) {
    var n = values.length, m = 1; while (m * 2 <= n) m *= 2;
    if (m < 16 || !(fs > 0) || !bands || !bands.length) return (bands || []).map(function () { return 0; });
    var re = new Array(m), im = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re[i] = values[i] - mean; im[i] = 0; }
    fftComplex(re, im);
    // 단측 파워 |X(k)|² 선계산, 대역마다 합만
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

  /* 1× 실측 — 입력 RPM ±tol% 안 로컬 최대 + 포물선 보간(band.js meas1x와 같은 규칙)
     · 채택: 주변 중앙값×floorMul(단일 8·Welch 4) 이상 + 저주파 최댓값 2% 이상, 계통주파수 1.5 분해능 안이면 거부
     res: 실제 분해능(없으면 빈 간격). 반환 { f, rpm } 또는 null(입력 RPM 유지) */
  function measuredOneX(freqs, mags, frNom, tolPct, lineHz, res, floorMul) {
    if (!(frNom > 0) || !freqs || freqs.length < 8) return null;
    var f0 = freqs[0], df = freqs[1] - freqs[0], tol = (tolPct || 5) / 100, k;
    if (!(df > 0)) return null;
    var at = function (f) { return Math.round((f - f0) / df); };
    var i0 = Math.max(1, Math.ceil((frNom * (1 - tol) - f0) / df)), i1 = Math.min(freqs.length - 2, Math.floor((frNom * (1 + tol) - f0) / df));
    if (i1 <= i0) return null;   // 분해능 부족
    var bi = -1, bm = 0;
    for (k = i0; k <= i1; k++) if (mags[k] > bm) { bm = mags[k]; bi = k; }
    if (bi < 1) return null;
    var y0 = mags[bi - 1], y1 = bm, y2 = mags[bi + 1];
    if (y0 > y1 || y2 > y1) return null;   // 창 경계의 사면(봉우리 아님)
    var w = (i1 - i0 + 1) * 3, nb = [];
    for (k = Math.max(0, i0 - w); k <= Math.min(freqs.length - 1, i1 + w); k++) nb.push(mags[k]);
    nb.sort(function (p, q) { return p - q; });
    if (!(y1 >= (nb[nb.length >> 1] || 0) * (floorMul || 8))) return null;
    var lf = 0;
    for (k = Math.max(0, at(2)); k <= Math.min(freqs.length - 1, at(10 * frNom)); k++) if (mags[k] > lf) lf = mags[k];
    if (!(y1 >= lf * 0.02)) return null;
    var den = y0 - 2 * y1 + y2, d = den !== 0 ? (y0 - y2) / (2 * den) : 0;
    if (!(d > -1 && d < 1)) d = 0;
    var f = freqs[bi] + d * df;
    if (lineHz > 0 && Math.abs(f - lineHz) <= 1.5 * (res || df)) return null;
    return { f: f, rpm: f * 60 };
  }

  // 포락선 스펙트럼 정량 — 지배 반복주파수 f0·차수(f0/1×)·하모닉 수·1× 측대역 유무
  // 하모닉≥2면 일관된 반복 충격(consistent), 미만은 단발 스파이크와 구분 불가
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

  // 대역제한 RMS의 N블록 에너지 평균 — ISO 판정은 정상상태·충분한 평균 전제(단일 블록은 스파이크에 흔들림)
  // 반환 { rms, blocks, spread } — spread=블록 간 최대/최소 비(정상상태 판단용)
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

  // Welch 평균 스펙트럼 — 블록 분할 + 50% 중첩 + Hann 평균(충격성 신호의 1블록 진폭 흔들림 방지)
  // 반환 { freqs, mags, res, resTrue, blocks } — mags는 파워 평균 후 제곱근
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

  // 데시메이션(정수 배수 추출) — ⚠호출 전 대역제한 필수(폴딩 방지)
  function decimate(values, factor) {
    var f = Math.max(1, Math.floor(factor));
    if (f === 1) return values.slice(0);
    var out = [];
    for (var i = 0; i < values.length; i += f) out.push(values[i]);
    return out;
  }

  /* ---------------- 대역 이탈 판정 ----------------
     학습 한계(μ+kσ) 대비 비율로 등급, 이탈 대역들은 설비 단위 이벤트 하나로 합성. 복귀는 ×0.9 히스테리시스 */
  var BAND_KO = { sub: '서브동기', one: '1× 대역', fault: '결함 대역', high: '고주파', vh1: '1~2 kHz', vh2: '2~4 kHz', vh3: '4~8 kHz', vh4: '8 kHz+',
    envPkRel: '주기성', envBPFO: 'BPFO(외륜)', envBPFI: 'BPFI(내륜)', envBSF: 'BSF(볼)', envFTF: 'FTF(케이지)', envF0: '반복주파수', envHarm: '하모닉 수', fr: '회전주파수' };
  /* 주파수 대역 8칸 — bandEnergy 출력 순서·bandEdges 인덱스와 1:1
     경계·측정 가능성을 인덱스로 따질 땐 이 목록 사용(BAND_ORDER는 더 김) */
  var BAND_FREQ = ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4'];
  /* 판정 계열 — 대역 8칸 + 포락선 4(복조 스펙트럼 값이라 경계 없음). 학습·판정·삭제가 이 목록 순회
     BAND_CTX는 저장만·판정 제외 — FTF는 0.4×fr로 오일휩(0.38~0.48×)과 겹침, F0·harm은 커져도 나쁜 값 아님 */
  var BAND_ORDER = BAND_FREQ.concat(['envPkRel', 'envBPFO', 'envBPFI', 'envBSF']);
  var BAND_CTX = ['fr', 'envF0', 'envHarm', 'envFTF'];
  /* 구 대역 이름 — 삭제 경로 전용(표에 남은 학습 행 정리) */
  var BAND_LEGACY = ['vhigh'];
  var BAND_GRADE = [1.5, 3.0];   // ×1.0~1.5 주의 · 1.5~3.0 위험 · 3.0~ 심각
  var BAND_HYST = 0.9;           // 복귀 판정 배수
  // 포락선 결함주파수 1·2순위가 이 비율 안이면 종류 단정 안 함(둘 다 표기)
  var ENV_TYPE_MARGIN = 0.8;
  /* now: {대역:값} · bls: {대역:{mu,sigma,k}} · wasOn: 직전 이탈 여부(히스테리시스용)
     softKeys: 마운팅 유효 상한 초과 대역(softBands) — 그것만 이탈이면 상한 '주의', 확정 대역 동반 시 그쪽 배수로 등급
     latchIn·nowMs: 포락선 래치 상태·현재 시각
     반환 { on, gi, over, maxR, soft, detail, latch, envR, envKey, envAlt, freqR, freqKey } — detail은 이벤트 DETAIL 컬럼 값
     ⚠서버 TQL 임베드(bandJudgeSrc) — 바깥 이름 참조 금지, 상수·한계식 안에서 재선언 */
  function bandJudge(now, bls, wasOn, softKeys, latchIn, nowMs) {
    if (!now || !bls) return null;
    // TQL 임베드용 BAND_ORDER·BAND_KO 사본 — 모듈 목록과 동일 유지
    var ORDER = ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4', 'envPkRel', 'envBPFO', 'envBPFI', 'envBSF'];
    /* 포락선 계열은 래치 — 스폴은 안 메워지고 신호만 묻히므로 한 번 넘으면 최고 배수·최초 시각 유지
       주파수 대역은 부하 따라 오르내리므로 현재값으로 판정. 래치 리셋은 재학습에서만 */
    var ENVK = { envPkRel: 1, envBPFO: 1, envBPFI: 1, envBSF: 1 };
    var latch = {}, _lk;
    if (latchIn) for (_lk in latchIn) if (latchIn[_lk] && latchIn[_lk].r > 0) latch[_lk] = { r: latchIn[_lk].r, at: latchIn[_lk].at || 0 };
    var KO = { sub: '서브동기', one: '1× 대역', fault: '결함 대역', high: '고주파', vh1: '1~2 kHz', vh2: '2~4 kHz', vh3: '4~8 kHz', vh4: '8 kHz+',
      envPkRel: '주기성', envBPFO: 'BPFO(외륜)', envBPFI: 'BPFI(내륜)', envBSF: 'BSF(볼)' };
    var GRADE = [1.5, 3.0], HYST = 0.9, ETM = 0.8;
    var thr = wasOn ? HYST : 1.0;
    var SOFT = {}, si;
    if (softKeys) for (si = 0; si < softKeys.length; si++) SOFT[softKeys[si]] = 1;
    var over = [], maxR = 0, hardMaxR = 0, any = false;
    ORDER.forEach(function (k) {
      var v = now[k], b = bls[k];
      if (!(v > 0) || !b) return;
      var lim = b ? Math.max(b.mu + (b.k || 3) * b.sigma, b.mu * 1.2) : null;   // baselineLimit과 같은 식
      // 한계 0(빈 대역 학습값)은 판정 제외 — any는 이 검사 뒤에 세움("판정 가능 대역 없음"과 "이탈 아님" 구분)
      if (!(lim > 0)) return;
      any = true;
      var r = v / lim, sf = !!SOFT[k], isEnv = !!ENVK[k];
      if (isEnv && r > thr) {
        if (!latch[k]) latch[k] = { r: r, at: nowMs || 0 };
        else if (r > latch[k].r) latch[k] = { r: r, at: latch[k].at };
      }
      // 포락선은 래치된 최고 배수로 판정
      var eff = (isEnv && latch[k]) ? Math.max(r, latch[k].r) : r;
      if (eff > maxR) maxR = eff;
      if (!sf && eff > hardMaxR) hardMaxR = eff;
      if (eff > thr) over.push({ k: k, ko: KO[k], v: v, lim: lim, r: eff, soft: sf,
        latched: isEnv && r <= thr, at: (isEnv && latch[k]) ? latch[k].at : 0 });
    });
    if (!any) return null;                       // 학습된 대역이 하나도 없음 — 판정 불가
    var on = over.length > 0;
    var nHard = 0;
    for (si = 0; si < over.length; si++) if (!over[si].soft) nHard++;
    var giHard = !nHard ? 0 : (hardMaxR > GRADE[1] ? 3 : hardMaxR > GRADE[0] ? 2 : 1);
    var gi = !on ? 0 : (giHard || 1);            // 잠정 대역만 이탈 → '주의'가 상한
    var detail = over.map(function (o) {
      // 래치 유지 항목은 이력 배수 표기(현재값과 판정 배수가 다름)
      return o.k + '=' + o.v.toFixed(3) + '/' + o.lim.toFixed(3) + (o.soft ? '(잠정)' : '')
        + (o.latched ? '(이력 ×' + o.r.toFixed(2) + ')' : '');
    }).join(' · ');
    /* 주파수 대역(진동 증가)과 포락선 결함주파수(베어링 손상) 축 분리 — 합치면 비특이적 대역이 특이적 계열을 덮음
       등급은 최댓값, 분리는 원인 표시용 */
    var ENVF = { envBPFO: 1, envBPFI: 1, envBSF: 1 };
    var envR = 0, envK = '', env2R = 0, env2K = '', freqR = 0, freqK = '', oi;
    for (oi = 0; oi < over.length; oi++) {
      var ov2 = over[oi];
      if (ENVF[ov2.k]) {
        if (ov2.r > envR) { env2R = envR; env2K = envK; envR = ov2.r; envK = ov2.k; }
        else if (ov2.r > env2R) { env2R = ov2.r; env2K = ov2.k; }
      } else if (ov2.r > freqR) { freqR = ov2.r; freqK = ov2.k; }
    }
    /* 1·2순위 근접 시 종류 단정 안 함(envAlt에 2순위) — 손상 여부만 확정, 부위는 근거 설 때만 */
    var envAmbig = envR > 0 && env2R > 0 && env2R >= envR * ETM;   // 모듈 ENV_TYPE_MARGIN과 같은 값
    return { on: on, gi: gi, over: over, maxR: maxR, soft: on && !nHard, detail: detail, latch: latch,
      envR: envR, envKey: envK, envAlt: envAmbig ? env2K : '', freqR: freqR, freqKey: freqK };
  }
  /* 대역 경계(Hz) — band.js bandsFor에 같은 정의 사본 있음(동일 유지)
     vh 대역은 고정 경계라 저샘플레이트에선 하한이 Nyquist 넘는 빈 대역 발생 */
  function bandEdges(fr, nyq) {
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
  /* 대역 측정 가능 여부 — 하한 ≥ Nyquist면 빈 대역. 포락선 계열은 경계 없어 통과(BAND_FREQ로 조회) */
  function bandMeasurable(bn, fr, fs) {
    var i = BAND_FREQ.indexOf(bn);
    if (i < 0 || !(fs > 0) || !(fr > 0)) return true;   // 판단 불가·대역 아님이면 통과
    var e = bandEdges(fr, fs / 2)[i];
    return e[0] < Math.min(e[1], fs / 2);
  }
  /* 포락선 복조 대역 — 마운팅 유효 상한 아래 최상위 옥타브 [cap/2, cap] 고정(추세 비교용, 앵커마다 안 바꿈)
     마운팅 변경 등으로 대역이 바뀌면 재학습 필요 */
  function demodBand(fs, mount) {
    var nyq = fs / 2;
    if (!(nyq > 0)) return null;
    var fmax = mountFmax(mount), cap = fmax > 0 ? Math.min(fmax, nyq) : nyq;
    if (!(cap >= 400)) return null;   // 상단 400 Hz 미만은 베어링 공진 대역 아님
    return [cap / 2, cap];
  }
  /* 마운팅 유효 상한(mountFmax)을 넘거나 걸치는 대역 키들 — 판정에서 '잠정'으로 낮출 대상
     마운팅 미상(fmax=0)이면 빈 배열(제한 없음) */
  function softBands(fr, fs, mount) {
    var fmax = mountFmax(mount);
    if (!(fmax > 0) || !(fs > 0) || !(fr > 0)) return [];
    // 주파수 대역만 대상 — 포락선 계열은 demodBand에서 상한 적용됨
    var e = bandEdges(fr, fs / 2), out = [];
    for (var i = 0; i < BAND_FREQ.length; i++) if (e[i] && e[i][1] > fmax) out.push(BAND_FREQ[i]);
    return out;
  }
  /* 밀도 균일화 — 격자 버킷당 첫 표본 한 점만 유지(밀도 편중이 중앙값·MAD 지배 방지)
     평균으로 뭉치지 않음(σ가 줄어 한계가 좁아짐). rows는 시각 오름차순 필수 */
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
  /* 판정 플래핑 감지 — 악화·개선을 짧은 간격으로 반복하는 태그(설정 부적합 신호)
     주기 = threshold 이벤트 간격 중앙값, FLAP_MIN_ROUND 미만은 제외. ts는 오름차순 threshold 시각 배열 */
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
  /* 운전 판별 — 정지 수준 하락을 "복귀"로 알리지 않기 위함. ref=운전 기준 수준(runRef 또는 창 P95) */
  function isRunning(val, ref) {
    if (!(ref > 0)) return true;          // 기준 없으면 운전으로 간주(판별 불가 ≠ 정지)
    // 0.2 = BL_IDLE_FRAC — TQL 임베드라 값으로 씀
    return val >= ref * 0.2;
  }
  /* 버킷 AC 실효값 배열 — 정지 판별 참조값을 판정값(AC)과 같은 양으로(DC 섞으면 오프셋 센서가 정지로 읽힘) */
  function acVals(buckets) {
    var out = [];
    for (var i = 0; i < (buckets || []).length; i++) {
      var b = buckets[i];
      if (!b || !(b.cnt > 0) || !isFinite(b.rms)) continue;
      if (isFinite(b.sum)) {
        var mean = b.sum / b.cnt;
        out.push(Math.sqrt(Math.max(0, b.rms * b.rms - mean * mean)));
      } else out.push(b.rms);
    }
    return out;
  }

  // 정지 판별 기준값 — 학습 μ 우선, 없으면 최근값들의 P75
  function runRef(bl, recent) {
    if (bl && bl.mu > 0) return bl.mu;
    if (!recent || !recent.length) return 0;
    var x = recent.filter(function (v) { return isFinite(v) && v >= 0; }).sort(function (a, b) { return a - b; });
    return x.length ? x[Math.floor(0.75 * (x.length - 1))] : 0;
  }
  /* 구간 RMS — 버킷을 cnt 가중 이차평균으로 합침(원본 √(Σx²/N)과 같은 값, 산술평균은 과소평가)
     minCntRatio: 미완성(적재 중) 버킷 제외 기준(중앙 cnt 대비). buckets는 toBucket 결과 형태 */
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
    /* DC 뺀 실효값 √(Σx²/N − (Σx/N)²), SUM 없으면 √(Σx²/N). 음수(부동소수 오차)는 0으로 */
    var ms2 = ss / n;
    var rms = haveSum ? Math.sqrt(Math.max(0, ms2 - (sum / n) * (sum / n))) : Math.sqrt(ms2);
    return { rms: rms, used: used, dropped: cnts.length - used, n: n, ac: haveSum };
  }
  /* ── ISO 10816 대역제한(10~1000 Hz) 실효값 ───────────────────────────────
     · ISO 존 경계는 10~1000 Hz 속도 RMS 기준(전대역 값과 다른 양)
     · 필터는 4차 버터워스 시간영역 밴드패스(FFT보다 싸고 값 사실상 일치)
     · 서버 TQL 임베드(isoSrc) — 바깥 이름 참조 금지 */

  // 2차 IIR 섹션 — 계수는 bandpass가 전달
  function biquad(b0, b1, b2, a1, a2, sig) {
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0, i, xn, yn, out = new Array(sig.length);
    for (i = 0; i < sig.length; i++) {
      xn = sig[i];
      yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xn; y2 = y1; y1 = yn; out[i] = yn;
    }
    return out;
  }
  /* N차 버터워스 밴드패스 — 극점마다 Q = 1/(2cos(π(2k+1)/2N))(같은 섹션 반복이면 통과대역 끝이 깎임) */
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
  // 원시 샘플 → ISO 10~1000 Hz RMS(평균 제거 — ISO는 AC 기준)
  function isoRms(samples, fs) {
    if (!samples || samples.length < 256 || !(fs > 0)) return null;
    var n = samples.length, i, mean = 0;
    for (i = 0; i < n; i++) mean += samples[i];
    mean /= n;
    var x = new Array(n);
    for (i = 0; i < n; i++) x[i] = samples[i] - mean;
    var hi = Math.min(1000, fs / 2 * 0.98);        // Nyquist 바로 아래는 필터 불안정
    var y = bandpass(x, 4, 10, hi, fs);
    if (!y) return null;
    var ss = 0;
    for (i = 0; i < y.length; i++) ss += y[i] * y[i];
    return Math.sqrt(ss / y.length);
  }
  /* ── 계측 게이트 ─────────────────────────────────────────────────────────
     · 파형이 기계 신호인지 계측 문제인지 판별(판정 앞단 garbage-in 방어)
     · 플랫라인·DC는 롤업 집계로 매 판정, 클리핑 등은 원본 파형 있을 때만
     · 반환 null(이상 없음) 또는 { key, label, detail, gi } — 플랫라인·데이터 부족은 위험(2), 나머지는 주의(1) */

  var GATE_FLAT_RATIO = 0.002;   // σ < peak의 0.2% = 사실상 상수
  var GATE_DRIFT_RATIO = 0.5;    // 버킷 평균 흔들림 > 버킷 안 σ의 0.5배 = 기준선 흔들림(창 RMS 12% 이상 과대)
  var GATE_DRIFT_REVS = 10;      // 버킷당 회전수 하한 — 미만이면 실제 진동이 버킷 평균을 흔듦
  /* 판정 차단 계측 사유(심각한 순) — 감시·상세분석·리포트 공용
     signalQuality는 TQL 임베드라 함수 안에 같은 사본 보유(동일 유지) */
  var GATE_BLOCK = ['flatline', 'sparse', 'spike', 'kurtx', 'clip', 'dc'];

  /* 롤업 버킷만으로 보는 게이트(추가 조회 없음) — ac=windowRms의 AC 실효값(σ), peak=버킷 MIN/MAX, fr=회전 Hz
     · 일정한 DC는 막지 않음 — 판정값(ISO·포락선·대역)은 대역 필터·평균 제거라 무관, DC 결합 센서는 늘 DC 보유
     · 막는 것은 버킷 평균의 흔들림(센서 바이어스·케이블·마운트 회전) — 버킷당 10회전 이상일 때만, 회전수 없으면 판단 안 함
     · 회전당 4샘플 미만(느린 값 태그)은 판단 안 함 — 버킷 안 σ가 진동을 못 담아 0에 가까움 */
  function gateFromBuckets(buckets, ac, fr) {
    if (!buckets || !buckets.length || !(ac >= 0)) return null;
    // TQL 임베드라 상수 재선언 — GATE_FLAT_RATIO·GATE_DRIFT_RATIO·GATE_DRIFT_REVS와 동일 유지
    var FLAT = 0.002, DRIFT = 0.5, REVS = 10;
    var peak = 0, n = 0, i, b, haveSum = true, used = [], step = 0, cmin = Infinity;
    for (i = 0; i < buckets.length; i++) {
      b = buckets[i];
      if (!b || !(b.cnt > 0)) continue;
      if (isFinite(b.mn)) peak = Math.max(peak, Math.abs(b.mn));
      if (isFinite(b.mx)) peak = Math.max(peak, Math.abs(b.mx));
      if (!isFinite(b.sum) || !isFinite(b.rms)) haveSum = false;
      if (used.length) { var dt = b.ms - used[used.length - 1].ms; if (dt > 0 && (!step || dt < step)) step = dt; }
      n += b.cnt;
      if (b.cnt < cmin) cmin = b.cnt;
      used.push(b);
    }
    if (!n) return null;
    /* 플랫라인 — 정지(작아도 흔들림)와 달리 죽은 센서는 상수 출력. 정지로 읽으면 영구 무감시 */
    if (peak === 0 || ac < 1e-9 || ac < FLAT * peak) {
      return { key: 'flatline', label: '플랫라인', gi: 2,
        detail: 'σ ' + ac.toFixed(5) + ' / peak ' + peak.toFixed(3) + ' — 값이 거의 변하지 않음, 센서 정지·케이블 탈락 의심' };
    }
    // DC 드리프트 — 버킷 평균들의 흔들림(σ_m) vs 버킷 안 σ(σ_w), 버킷 길이 = 이웃 간격 최솟값
    if (haveSum && used.length >= 3 && fr > 0 && fr * step / 1000 >= REVS && cmin >= 4 * fr * step / 1000) {
      var tot = 0, w = 0, bm = 0, m;
      for (i = 0; i < used.length; i++) tot += used[i].sum;
      var mu = tot / n;
      for (i = 0; i < used.length; i++) {
        b = used[i]; m = b.sum / b.cnt;
        w += b.cnt * Math.max(0, b.rms * b.rms - m * m);
        bm += b.cnt * (m - mu) * (m - mu);
      }
      w = Math.sqrt(w / n); bm = Math.sqrt(bm / n);
      if (w > 0 && bm > DRIFT * w) {
        return { key: 'dc', label: 'DC 드리프트', gi: 1,
          detail: '1초 평균의 흔들림 ' + bm.toFixed(3) + ' = 진동 σ ' + w.toFixed(3) + '의 ' + (bm / w).toFixed(2)
            + '배 — 센서 바이어스·케이블·마운트 이상 의심(일정한 DC는 정상)' };
      }
    }
    return null;
  }

  /* 원본 파형 게이트 — signalQuality 판정을 이벤트 형태로(같은 임계라 상세분석·알람 기준 일치) */
  function gateFromRaw(values, fs) {
    var q = signalQuality(values, fs);
    if (!q) return null;
    var issues = q.issues || [], i, j;
    /* 차단 사유만 심각한 순 — GATE_BLOCK에서 dc(롤업 게이트 담당)·spike·kurtx(impactEvidence로 근거만) 제외
       ⚠서버 TQL 임베드 — 배열은 함수 안에 */
    var order = ['flatline', 'sparse', 'clip'];
    for (i = 0; i < order.length; i++) {
      for (j = 0; j < issues.length; j++) {
        if (issues[j].key === order[i]) {
          var sev = order[i] === 'flatline' || order[i] === 'sparse';
          return { key: issues[j].key, label: issues[j].label, gi: sev ? 2 : 1, detail: issues[j].detail };
        }
      }
    }
    return null;
  }

  /* 충격성 근거 — 이벤트 설명용(판정 아님). Crest·첨도로 임펄스성(베어링·기어) vs 광대역(캐비테이션·유동) 구분
     경계 8 = 랜덤 신호 기대 최대(3.9~4.5)와 베어링 결함 통상 범위(5~10) 사이. >15는 계측 확인 권고(차단 안 함) */
  function impactEvidence(values, fs) {
    var n = (values || []).length;
    if (n < 64) return null;
    var i, sum = 0;
    for (i = 0; i < n; i++) sum += values[i];
    var mean = sum / n, ss = 0, pk = 0;
    for (i = 0; i < n; i++) { var d = values[i] - mean; ss += d * d; if (Math.abs(d) > pk) pk = Math.abs(d); }
    var sd = Math.sqrt(ss / n);
    if (!(sd > 1e-12)) return null;
    var crest = pk / sd, kurt = kurtosis(values);
    var kind = (crest >= 8 || kurt >= 8) ? '충격성' : '광대역';
    var txt = 'Crest ' + crest.toFixed(1) + ' · 첨도 ' + kurt.toFixed(1) + ' → ' + kind;
    if (crest > 15 || kurt > 25) txt += ' (단발성이 강함 — 마운팅·커넥터도 확인)';
    return { crest: crest, kurt: kurt, kind: kind, text: txt };
  }

  /* 계측 이상 상태기 — 진동 판정과 같은 홀드 규칙: 발생 escHold·해제 recHold 지속 요구(단발·경계 왕복 이벤트 폭주 방지) */
  function sensorTick(prev, bad, now, cfg) {
    cfg = cfg || {};
    var p = prev || {}, events = [];
    var on = !!p.sf, since = p.sfs != null ? p.sfs : null, clr = p.sfc != null ? p.sfc : null;
    if (bad) {
      clr = null;
      if (!on) {
        if (since == null) since = now;
        if (now - since >= (cfg.escHold || 0)) {
          on = true;
          events.push({ etype: 'sensor_fault', gi: bad.gi, detail: bad.label + ' — ' + bad.detail });
        }
      }
    } else {
      since = null;
      if (on) {
        if (clr == null) clr = now;
        if (now - clr >= (cfg.recHold || 0)) { on = false; clr = null; events.push({ etype: 'sensor_ok', gi: 0, detail: '계측 정상 복귀' }); }
      }
    }
    var next = { sf: on ? 1 : 0 };
    if (since != null) next.sfs = since;
    if (clr != null) next.sfc = clr;
    return { on: on, next: next, events: events };
  }

  // 대역제한 필요 여부 — Nyquist ≤ 1000 Hz면 전대역이 곧 ISO 대역
  function isoNeeded(fs) { return fs > 0 && fs / 2 > 1000; }
  /* ISO 계산 생략 판단 — 최대 버킷 RMS < 존 경계면 생략(대역제한은 에너지를 빼기만 해 ISO ≤ 버킷 RMS). 버킷 없으면 생략 안 함 */
  function isoSkippable(buckets, zone0) {
    if (!(zone0 > 0) || !buckets || !buckets.length) return false;
    var mx = 0;
    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      if (b && isFinite(b.rms) && b.rms > mx) mx = b.rms;
    }
    return mx > 0 && mx < zone0;
  }

  /* 샘플레이트 추정 — 이웃 Δt 중앙값의 역수("초당 행 수"는 주기 기록·중복 적재에서 틀림)
     · tsUs: 오름차순 정수 μs(ms는 고주파 간격이 0으로 뭉개짐, ns는 JS 안전 정수 초과)
     · 간격 30개 미만이면 0(호출측 폴백) */
  function fsFromTimes(tsUs) {
    if (!tsUs || tsUs.length < 2) return 0;
    var d = [], i, v;
    for (i = 1; i < tsUs.length; i++) {
      v = tsUs[i] - tsUs[i - 1];
      if (v > 0 && isFinite(v)) d.push(v);
    }
    if (d.length < 30) return 0;
    d.sort(function (a, b) { return a - b; });
    var m = d[Math.floor(d.length / 2)];
    return m > 0 ? Math.round(1e6 / m) : 0;
  }

  /* 서로 부르는 함수들을 TQL 임베드용 소스로 묶음 — 한 IIFE에 넣고 압축된 실제 이름(.name)을 고정 이름에 연결
     exports = { 바깥이름: 함수 }. fn.toString() 개별 연결은 압축본에서 이름 불일치 */
  function embedSrc(fns, exports) {
    var keys = Object.keys(exports), parts = ['var __E=(function(){'];
    fns.forEach(function (fn) { parts.push(fn.toString()); });
    parts.push('return {' + keys.map(function (k) { return k + ':' + exports[k].name; }).join(',') + '};');
    parts.push('})();');
    parts.push('var ' + keys.map(function (k) { return k + '=__E.' + k; }).join(', ') + ';');
    return parts.join('\n');
  }
  // ISO 판정 임베드 — isoRms → bandpass → biquad 호출 체인, isoNeeded·isoSkippable은 지름길 판단
  function isoSrc() {
    return embedSrc([biquad, bandpass, isoRms, isoNeeded, isoSkippable],
      { isoRms: isoRms, isoNeeded: isoNeeded, isoSkippable: isoSkippable });
  }
  /* 결함 패턴 임베드 — 서버 감시 포락선용 FFT 계열을 한 스코프로(서로 이름으로 호출), 몸통이 쓰는 상수도 함께 실음 */
  function patSrc() {
    return 'var ENV_MODE=' + JSON.stringify(ENV_MODE) + ';var TGT_H=' + TGT_H + ';var TGT_S=' + TGT_S
      + ';var MON_ADOPT=' + MON_ADOPT + ';var MON_REV=' + MON_REV
      + ';var DEMOD_FIX=' + JSON.stringify(DEMOD_FIX) + ';var BEARING_FS_RATIO=' + BEARING_FS_RATIO
      + ';var TGT_ADOPT=' + TGT_ADOPT + ';var COMB_ADOPT=' + COMB_ADOPT + ';var COMB_M=' + COMB_M + ';'
      + embedSrc([patConst, fftComplex, amplitudeSpectrum, analyticEnvelope, envelopeSpectrum, bandpassSignal,
        gridScore, targetedMatch, bearingFreqs, envMaxFor, demodFixed, patternGate, patternGrade, patternRound],
      { envelopeSpectrum: envelopeSpectrum, targetedMatch: targetedMatch, bearingFreqs: bearingFreqs,
        envMaxFor: envMaxFor, demodFixed: demodFixed, patternGate: patternGate, patternGrade: patternGrade,
        patternRound: patternRound });
  }
  /* 계측 게이트 임베드 — gateFromRaw → signalQuality → kurtosis 호출 체인을 한 스코프로 */
  function gateSrc() {
    return embedSrc([kurtosis, signalQuality, gateFromBuckets, gateFromRaw, sensorTick, impactEvidence],
      { gateFromBuckets: gateFromBuckets, gateFromRaw: gateFromRaw, sensorTick: sensorTick, impactEvidence: impactEvidence });
  }
  /* 단위 변환·ISO 대역 평균 임베드 — 서버 감시도 앱과 같은 함수로 속도 변환 후 ISO 측정
     FFT 2회라 goja에서 무거움 — 호출측(monitor.js)이 TTL로 빈도 제한 */
  function convSrc() {
    return embedSrc([unitScale, fftComplex, convertDomain, bandpassSignal, bandRms, bandRmsAveraged],
      { convertDomain: convertDomain, bandRmsAveraged: bandRmsAveraged });
  }

  /* 판정 보류 사유 하나(심각한 순) — 화면 보류 문구용. 감시 사유(mon) 우선(감시·상세 창이 달라 감시가 멈춘 이유를 표시) */
  function gateReason(quality, mon) {
    if (mon && mon.key) return { key: mon.key, label: mon.label, detail: mon.detail, src: 'mon' };
    if (!quality || !quality.gate) return null;
    var issues = quality.issues || [], i, j;
    for (i = 0; i < GATE_BLOCK.length; i++) {
      for (j = 0; j < issues.length; j++) {
        if (issues[j].key === GATE_BLOCK[i]) {
          return { key: issues[j].key, label: issues[j].label, detail: issues[j].detail, src: 'det' };
        }
      }
    }
    return null;
  }

  /* 표시 등급 — 넘어온 축 중 최악 + 등급을 올린 축(src)
     ⚠ 호출측은 진폭 세 축(ISO·베이스라인·대역)을 0으로 넘기고 패턴 축만 사용(나머지는 근거 표시용) */
  function worstGrade(zoneGi, blGi, bandGi, patGi) {
    var g = zoneGi || 0, src = 'iso';
    if ((blGi || 0) > g) { g = blGi; src = 'baseline'; }
    if ((bandGi || 0) > g) { g = bandGi; src = 'band'; }
    if ((patGi || 0) > g) { g = patGi; src = 'pattern'; }
    return { gi: g, src: g > 0 ? src : 'iso' };
  }
  /* 근거 채택 점수 — 판정문이 원인을 지목하는 문턱(등급 게이트 아님, 등급은 patternGrade). 원인명은 등급 켜졌을 때만 표시 */
  var EVID_ADOPT = 55;
  /* 감시·상세 공유 게이트 규칙 — 결함 패턴이 켜고 ISO가 높이 결정(ISO 단독으로는 경보 안 켬 → 머신 클래스 오설정에도 오탐 불변) */
  function patternGate(patOn, isoGi) {
    return patOn ? Math.max(1, isoGi || 0) : 0;
  }
  /* 판정 회차의 등급 후보(rg)·회차 식별자(cyc) — 앱·서버 감시 공용(patSrc 임베드)
     · capable(회전수·기하 있음)인데 결과 없음 = 판정 보류 → 직전 등급·회차 유지(양호로 읽으면 거짓 복귀 후 재악화 알림)
     · pat: {on, at} | null, prev: 직전 판정 상태 | null, hG: 높이(ISO 존 등급) → {rg, cyc, miss} */
  function patternRound(pat, capable, prev, hG) {
    if (!pat && capable) {
      return { rg: prev ? (prev.g || 0) : 0, cyc: (prev && prev.cyc != null) ? prev.cyc : null, miss: true };
    }
    return { rg: patternGate(!!(pat && pat.on), hG), cyc: pat ? (pat.at || null) : null, miss: false };
  }
  /* 결함 패턴 축 채택 — 감시·상세·서버 모두 targetedMatch, 창 길이만 다름
     · r=격자 배수, thr=창에 맞춘 임계(25회전 MON_ADOPT · 100회전 TGT_ADOPT)
     · ⚠ thr 기본값 없음 — 호출측이 창 임계를 안 주면 판정 안 함(창 변경 시 틀린 임계 방지)
     · 반환 0/1(켜짐 여부, 높이는 patternGate가 ISO로 결정), 계측 게이트 중엔 0 */
  function patternGrade(r, gate, thr) {
    return (gate || !(thr > 0) || !(r >= thr)) ? 0 : 1;
  }

  /* 베이스라인 학습용 구간 RMS 계열 — groupSec개씩 windowRms로 합쳐 판정과 단위 일치, 불완전 꼬리는 버림 */
  function windowSeries(buckets, groupSec) {
    if (!buckets || !buckets.length) return [];
    var g = Math.max(1, Math.round(groupSec || 1));
    if (g === 1) return buckets.map(function (b) { return b.rms; }).filter(function (v) { return isFinite(v); });
    var out = [];
    for (var i = 0; i + g <= buckets.length; i += g) {
      var r = windowRms(buckets.slice(i, i + g), 0); // 과거 구간이라 미완성 버킷 없음
      if (r) out.push(r.rms);
    }
    return out;
  }
  /* 채울 앵커 목록 — 최신→과거, 격자 스냅, 보유 칸 제외
     · 격자 스냅: 타이머 시각과 같은 칸이어야 밀도 균일
     · 최신 우선: 중간에 멈춰도 채운 쪽이 학습 구간
     · 보유 칸 제외: TAG 테이블은 NAME+TIME 중복을 막지 않음
     have: { 칸번호: true }, 칸번호 = Math.floor(ms / gridMs) */
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
  /* 서버 감시 TQL 임베드용 bandJudge 소스 — 상수·한계식을 내장한 자체 완결형이라 toString 그대로 */
  function bandJudgeSrc() {
    return bandJudge.toString();
  }
  // DETAIL 문자열 → [{k,ko,v,lim,r,soft}] (이벤트 목록·알림 문구 렌더용)
  function bandParse(detail) {
    if (!detail) return [];
    return String(detail).split('·').map(function (s) {
      // 대역 이름에 숫자 포함(vh1~vh4)
      var m = /^\s*([a-z][a-z0-9]*)\s*=\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(s);
      if (!m) return null;
      var v = parseFloat(m[2]), lim = parseFloat(m[3]);
      // 저장된 이벤트에서도 잠정 표식 복원
      return { k: m[1], ko: BAND_KO[m[1]] || m[1], v: v, lim: lim, r: lim > 0 ? v / lim : 0, soft: /\(잠정\)/.test(s) };
    }).filter(Boolean);
  }
  /* 켑스트럼 프리화이트닝 — 스펙트럼 진폭을 1로 눌러 위상만 남김(축 관련 결정론적 성분 제거)
     · ⚠ 판정 경로에 쓰지 말 것 — 복조 대역이 1 kHz 고역통과라 축 성분은 이미 걸러지고, 화이트닝은 공진 대역 성형만 지워 SNR 손실
     · 대역통과 없는 원신호·가변속 조건용 */
  function prewhiten(values) {
    var n = values.length;
    if (n < 64) return values;
    var N = 1; while (N < n) N <<= 1;
    var re = new Array(N), im = new Array(N), i, mean = 0;
    for (i = 0; i < n; i++) mean += values[i];
    mean /= n;
    for (i = 0; i < N; i++) { re[i] = i < n ? values[i] - mean : 0; im[i] = 0; }
    fftComplex(re, im);
    for (i = 0; i < N; i++) {
      var m = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      if (m > 1e-12) { re[i] /= m; im[i] /= m; } else { re[i] = 0; im[i] = 0; }
    }
    for (i = 0; i < N; i++) im[i] = -im[i];      // 역FFT = 켤레·정FFT·켤레·/N
    fftComplex(re, im);
    var out = new Array(n);
    for (i = 0; i < n; i++) out[i] = re[i] / N;
    return out;
  }

  /* 패턴 판정 상수 단일 정의처 — MODE: 포락선 방식('rect'|'env'|'sq'), DEMOD: 고정 복조 대역(Hz, 공진 8~15 kHz 설비는 놓칠 수 있음)
     · 임베드 몸통은 반환 속성으로 상수 참조(압축 후에도 속성명 보존), 모듈 상수도 여기서 파생 */
  function patConst() {
    return { MODE: 'env', DEMOD: [1000, 5000], H: 4, S: 1, ADOPT: 4.0 };
  }
  var ENV_MODE = patConst().MODE;
  var DEMOD_FIX = patConst().DEMOD;
  function demodFixed(fs) {
    var nyq = fs / 2, df = patConst().DEMOD;
    if (!(nyq > 0) || df[1] > nyq * 0.95) return null;  // 이 샘플링에선 성립하지 않는 대역
    return { loHz: df[0], hiHz: df[1] };
  }

  /* 측대역 빗 판독 — 변조된 결함(중앙 피크 부재) 보완: 내륜 BPFI±k·1×, 구름체 BSF±k·FTF, 외륜 변조 없음
     빗 진폭 평균 ÷ 스펙트럼 중앙값으로 판정 */
  var COMB_ADOPT = 6.0;
  var COMB_M = 3;          // 측대역 차수 ±3(넓히면 배경까지 긁어 비율 과대)
  /* 빗 에너지 비 — 각 자리 허용오차 안 최댓값의 평균 ÷ 스펙트럼 중앙값
     ⚠ 창 길이 의존 — tol이 분해능을 따라가 창이 길수록 귀무값 상승(샘플레이트·창 길이가 크게 다르면 임계 어긋남) */
  function combRatio(sp, f, delta, med, res) {
    if (!(f > 0) || !(med > 0) || !sp || !sp.freqs.length) return { r: 0, lines: 0, relPct: 0 };
    var top = sp.freqs[sp.freqs.length - 1], sum = 0, n = 0, lines = 0, ctrOff = 0, m, t, tol, best, j;
    for (m = -COMB_M; m <= COMB_M; m++) {
      t = f + m * delta;
      if (t < 2 || t > top) continue;
      // 측대역 간격 < 2×분해능이면 제외(이웃이 같은 빈을 집음)
      if (m !== 0 && Math.abs(delta) < 2 * res) continue;
      tol = Math.max(1.5 * res, t * 0.01);
      best = 0;
      for (j = 0; j < sp.freqs.length; j++) {
        if (Math.abs(sp.freqs[j] - t) <= tol && sp.mags[j] > best) {
          best = sp.mags[j];
          if (m === 0) ctrOff = Math.abs(sp.freqs[j] - t);
        }
      }
      sum += best; n++;
      if (best > med * 2) lines++;
    }
    return { r: n ? (sum / n) / med : 0, lines: lines, relPct: f > 0 ? ctrOff / f * 100 : 0 };
  }
  /* 감시용 결함 패턴 창 — 상세분석 100회전, 감시 25회전
     서버 타이머(goja) 부하로 10분 주기 안에 들도록 짧은 창 사용 — 감시는 트리거, 확정은 상세분석 */
  var MON_REV = 25;
  /* 짧은 창은 점수 분포가 낮아 임계도 같이 낮춤(100회전과 같은 오탐률 기준) */
  var MON_ADOPT = 3.0;
  var TGT_ADOPT = patConst().ADOPT;
  var TGT_H = patConst().H, TGT_S = patConst().S;
  /* 표적 우선 대조 — 후보 자리별 하모닉 열 × 측대역 격자(BPFO · BPFI ±1× · 2×BSF ±FTF), 허용오차 1%
     ⚠ BPFO = n×FTF 항등식 → BSF 승리 시 siteUnknown */
  function gridScore(sp, f, delta, med, res, hMax) {
    if (!(f > 0) || !(med > 0) || !sp || !sp.freqs.length) return { r: 0, lines: 0, relPct: 0 };
    var top = sp.freqs[sp.freqs.length - 1], sum = 0, n = 0, lines = 0, ctrOff = 0, h, m, t, tol, best, j;
    var _C = patConst();
    var _H = hMax > 0 ? hMax : _C.H;   // hMax: 하모닉 수 오버라이드(기본 patConst().H)
    for (h = 1; h <= _H; h++) {
      for (m = -_C.S; m <= _C.S; m++) {
        // 측대역은 변조 계열·간격 ≥ 2×분해능일 때만(좁으면 이웃이 같은 빈)
        if (m !== 0 && (!(delta > 0) || Math.abs(delta) < 2 * res)) continue;
        t = h * f + m * delta;
        if (t < 2 || t > top) continue;
        tol = Math.max(1.5 * res, t * 0.01);
        best = 0;
        for (j = 0; j < sp.freqs.length; j++) {
          if (Math.abs(sp.freqs[j] - t) <= tol && sp.mags[j] > best) {
            best = sp.mags[j];
            if (h === 1 && m === 0) ctrOff = Math.abs(sp.freqs[j] - t);
          }
        }
        sum += best; n++;
        if (best > med * 2) lines++;
      }
    }
    return { r: n ? (sum / n) / med : 0, lines: lines, relPct: f > 0 ? ctrOff / f * 100 : 0 };
  }
  function targetedMatch(env, bf, fr, res, hMax) {
    if (!env || !env.freqs || env.freqs.length < 16 || !bf || !(fr > 0)) return null;
    var sorted = env.mags.slice().sort(function (a, b) { return a - b; });
    var med = sorted[Math.floor(sorted.length / 2)] || 0;
    if (!(med > 0)) return null;
    var cands = [
      { k: 'BPFO', f: bf.BPFO, d: 0, ord: 1 },
      { k: 'BPFI', f: bf.BPFI, d: fr, ord: 1 },
      { k: 'BSF', f: 2 * bf.BSF, d: bf.FTF, ord: 2 },
    ];
    var best = null, i, c, g;
    for (i = 0; i < cands.length; i++) {
      c = cands[i];
      if (!(c.f > 0)) continue;
      g = gridScore(env, c.f, c.d, med, res, hMax);
      if (!best || g.r > best.r) {
        best = { key: c.k, freq: c.f, ord: c.ord, delta: c.d, r: g.r, lines: g.lines, relPct: g.relPct };
      }
    }
    if (!best) return null;
    best.adopted = best.r >= patConst().ADOPT;
    /* BSF 승리 시 부위 미상 처리 — 검출은 유지, 부위 주장만 내림(구름체 결함은 레이스도 함께 손상) */
    best.siteUnknown = best.key === 'BSF';
    return best;
  }

  function sidebandMatch(env, bf, fr, res) {
    if (!env || !env.freqs || env.freqs.length < 16 || !bf || !(fr > 0)) return null;
    var sorted = env.mags.slice().sort(function (a, b) { return a - b; });
    var med = sorted[Math.floor(sorted.length / 2)] || 0;
    if (!(med > 0)) return null;
    var cands = [
      { k: 'BPFO', f: bf.BPFO, d: 0, ord: 1 },
      { k: 'BPFI', f: bf.BPFI, d: fr, ord: 1 },
      { k: 'BSF', f: bf.BSF, d: bf.FTF, ord: 1 },
      { k: 'BSF', f: 2 * bf.BSF, d: bf.FTF, ord: 2 },
    ];
    var best = null, i, c, q;
    for (i = 0; i < cands.length; i++) {
      c = cands[i];
      if (!(c.f > 0)) continue;
      q = combRatio(env, c.f, c.d, med, res);
      if (!best || q.r > best.r) {
        best = { key: c.k, freq: c.f, ord: c.ord, delta: c.d, r: q.r, lines: q.lines, relPct: q.relPct };
      }
    }
    if (!best) return null;
    /* 채택: 비율 ≥ COMB_ADOPT + 실제 빗(간격 있음·선 3개 이상)
       Δ=0 후보(BPFO)는 빗이 아님 — 지배 피크 경로 담당 */
    best.adopted = best.r >= COMB_ADOPT && best.delta > 0 && best.lines >= 3;
    return best;
  }

  /* 포락선 스펙트럼 상한 — 후보 주파수에서 역산(고정 500 Hz면 고속 기계 BPFI 2차가 범위 밖)
     최고 후보 × 6, 베어링 미지정이면 max(500, 12×fr). 상한 fs×0.4 */
  function envMaxFor(bf, fr, fs) {
    var top = bf ? Math.max(bf.BPFI || 0, 2 * (bf.BSF || 0), bf.BPFO || 0) : 0;
    /* 계수 6 — 세 후보가 같은 하모닉 수로 경쟁하도록(좁으면 최고 후보의 고차가 상한 밖으로 밀림) */
    var want = top > 0 ? 6 * top : Math.max(500, 12 * (fr || 0));
    return Math.min(Math.max(500, want), (fs || 0) > 0 ? fs * 0.4 : want);
  }

  /* 포락선 복조로 베어링 결함을 볼 최소 샘플레이트 = 최고 결함주파수 × 20 — 미만은 "측정 불가"(반대 증거 아님) */
  var BEARING_FS_RATIO = 20;
  function bearingFsOk(fs, bf) {
    if (!bf || !(fs > 0)) return true;
    var top = Math.max(bf.BPFO || 0, bf.BPFI || 0, bf.BSF || 0);
    return !(top > 0) || fs >= top * BEARING_FS_RATIO;
  }
  /* 포락선 반복주파수 ↔ 베어링 결함주파수 대조 — 허용오차 ±1%(BPFO/BPFI는 케이지 슬립 감안 ±2%)
     · 채택 = 매칭 + 하모닉 2개 이상(단일 피크는 우연 일치와 구분 불가), 미달은 weak
     · 미매칭은 negatives로 보고하되 반대 증거 아님(열화 말기엔 결함주파수가 흐려짐)
     res: 포락선 빈 간격(Hz) — 허용오차 하한 max(1.5×res, f×상대오차)(app.js _evidence magNear와 같은 규칙) */
  function bearingMatch(envQ, bf, fr, res, sb) {
    if (!bf) return { known: false, hit: null, weak: null, negatives: [] };
    /* FTF는 결함 후보 아님(정상 베어링에서도 늘 관측) — 관측 사실은 cage로 따로 반환, 근거 점수 제외 */
    /* 구름체는 자전 1회에 내·외륜을 한 번씩 때려 2×BSF가 지배적 — 기본파·2배파만 후보(3배파 이상은 다중비교로 우연 일치 증가) */
    var cands = [
      { k: 'BPFO', f: bf.BPFO, tol: 0.02 }, { k: 'BPFI', f: bf.BPFI, tol: 0.02 },
      { k: 'BSF', f: bf.BSF, tol: 0.01 }, { k: 'BSF', f: 2 * bf.BSF, tol: 0.01, ord: 2 },
    ];
    var cage = null;
    if (bf.FTF > 0 && envQ && envQ.f0 > 0) {
      var ct = Math.max(bf.FTF * 0.01, 1.5 * (res > 0 ? res : 0));
      if (Math.abs(envQ.f0 - bf.FTF) <= ct) {
        cage = { freq: bf.FTF, relPct: Math.abs(envQ.f0 - bf.FTF) / bf.FTF * 100, harm: envQ.harm };
      }
    }
    var uniq = function (a2) { var o = {}, r2 = [], i2; for (i2 = 0; i2 < a2.length; i2++) if (!o[a2[i2]]) { o[a2[i2]] = 1; r2.push(a2[i2]); } return r2; };
    if (!envQ || !(envQ.f0 > 0)) {
      // 지배 성분 없어도 측대역 채택 가능(변조가 심하면 중앙이 배경에 묻힘)
      var only = (sb && sb.adopted)
        ? { key: sb.key, freq: sb.freq, relPct: sb.relPct, harm: sb.lines, ord: sb.ord, via: 'sideband', ratio: sb.r, sbValid: '', siteUnknown: !!sb.siteUnknown }
        : null;
      return { known: true, hit: only, weak: null, cage: cage, sideband: sb || null,
        negatives: only ? [] : uniq(cands.map(function (c) { return c.k; })) };
    }
    var hit = null, weak = null, negatives = [], matched = {};
    cands.forEach(function (c) {
      if (!(c.f > 0)) { negatives.push(c.k); return; }
      var absTol = Math.max(c.f * c.tol, 1.5 * (res > 0 ? res : 0));
      var rel = Math.abs(envQ.f0 - c.f) / c.f;
      if (Math.abs(envQ.f0 - c.f) > absTol) { negatives.push(c.k); return; }
      matched[c.k] = 1;
      if (envQ.harm >= 2) { if (!hit) hit = { key: c.k, freq: c.f, relPct: rel * 100, harm: envQ.harm, ord: c.ord || 1 }; }
      else if (!weak) weak = { key: c.k, freq: c.f, relPct: rel * 100, harm: envQ.harm, ord: c.ord || 1 };
    });
    // 같은 계열 다른 배수가 맞았으면 음성 소견에서 제외(2×BSF만 맞은 경우 등)
    negatives = uniq(negatives).filter(function (k2) { return !matched[k2]; });
    /* 단일 피크 매칭 없을 때만 격자(sb) 채택 — 변조 결함·축 성분 지배 시 중앙 피크 부재 대응, 중복 계수 방지 */
    if (!hit && sb && sb.adopted) {
      hit = { key: sb.key, freq: sb.freq, relPct: sb.relPct, harm: sb.lines, ord: sb.ord, via: 'sideband', ratio: sb.r, siteUnknown: !!sb.siteUnknown };
      matched[sb.key] = 1;
      negatives = negatives.filter(function (k2) { return !matched[k2]; });
    }
    // 측대역 근거는 반송파가 해당 결함주파수일 때만 성립
    if (hit) hit.sbValid = (hit.key === 'BPFI' && !!(envQ && envQ.sb1x)) ? '1× 측대역 동반(내륜 전형)'
      : (hit.key === 'BPFO' && envQ && envQ.sb1x) ? '측대역 관측 — 외륜은 통상 측대역 없음(재확인 필요)' : '';
    return { known: true, hit: hit, weak: weak, cage: cage, negatives: negatives, sideband: sb || null };
  }

  /* 가속도계 마운팅별 유효 주파수 상한(Hz) — 초과 성분은 마운팅 공진 가능. 미상(0)이면 제한 없음 */
  var MOUNT_FMAX = { stud: 10000, adhesive: 5000, magnet: 2000, probe: 1000 };
  function mountFmax(mount) { return MOUNT_FMAX[mount] || 0; }
  /* 커토그램 탐색 상한 = Nyquist × 이 비율 — 마운팅 상한과 무관하게 항상 적용
     실수 대역통과 첨도는 톤 있는 대역에 불리해(정현파 첨도 1.5) Nyquist 바로 아래 저지대역을 고르는 문제 방지 */
  var KG_NYQ_FRAC = 0.8;

  /* 센서 축 회전수 — 벨트 종동측 센서면 종동축, 아니면 입력 RPM(모터)
     · 종동축 = 잰 값(belt.drivenRpm) 우선, 없으면 입력 RPM × D1/D2(풀리 환산)
     · 종동측인데 둘 다 없으면 0 — 모터 회전수 대조 시 우연 일치 방지
     반환 { rpm, src: 'motor'|'measured'|'pulley'|'missing' } */
  function shaftRpm(rpm, meta) {
    var m = meta || {}, b = m.belt || {}, r = Number(rpm) || 0;
    if (m.drive !== 'belt' || m.sensorPos !== 'driven') return { rpm: r, src: 'motor' };
    var dr = Number(b.drivenRpm) || 0;
    if (dr > 0) return { rpm: dr, src: 'measured' };
    var d1 = Number(b.d1) || 0, d2 = Number(b.d2) || 0;
    if (r > 0 && d1 > 0 && d2 > 0) return { rpm: Math.round(r * d1 / d2 * 10) / 10, src: 'pulley' };
    return { rpm: 0, src: 'missing' };
  }

  /* 벨트 구동 파생 주파수 — 반대쪽 축 1×(비동기 기본파의 흔한 정체)·벨트 통과주파수
     · fr = 센서 축 1×, onDriven이면 센서가 종동축 → 반대쪽은 모터(fr × D2/D1), 벨트 속도는 π·D2·fr
     · 벨트 통과주파수는 벨트길이(len) 있을 때만 — 단위는 풀리경과 같게(mm) */
  function beltFreqs(fr, belt, onDriven) {
    if (!(fr > 0) || !belt) return null;
    var d1 = Number(belt.d1) || 0, d2 = Number(belt.d2) || 0, L = Number(belt.len) || 0;
    if (!(d1 > 0 && d2 > 0)) return null;
    var ratio = onDriven ? d2 / d1 : d1 / d2;
    var out = { other: fr * ratio, ratio: ratio, otherKo: onDriven ? '모터' : '종동축' };
    if (L > 0) out.belt = Math.PI * (onDriven ? d2 : d1) * fr / L; // 벨트속도 ÷ 벨트길이
    return out;
  }

  // 커토그램 — 대역별 Spectral Kurtosis 스캔으로 가장 충격성 강한 대역 탐색(진단 정보 전용, 복조 대역 선택엔 미사용)
  // fmaxHz>0이면 그 위 대역은 스캔에서 제외(마운팅 상한)
  // 반환 { levels:[{nb,bwHz,sk:[...]}], best:{loHz,hiHz,center,bw,sk,nb}, fmax, capped, nyqFull }
  /* 대역 첨도 대상 — 'real'(실수 대역통과, 엄밀한 Antoni SK 아님) | 'env'(|z|) | 'ck'(복소 SK: E|z|⁴/(E|z|²)²−2) */
  var SK_MODE = 'real';
  function kurtogram(values, fs, fmaxHz, mode) {
    var n = values.length;
    if (n < 512 || !(fs > 0)) return null;
    var m = 1; while (m * 2 <= n) m *= 2;
    var re0 = new Array(m), im0 = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re0[i] = values[i] - mean; im0[i] = 0; }
    fftComplex(re0, im0); // 스펙트럼 1회 계산 후, 대역마다 역FFT만
    var df = fs / m, nyqBin = m / 2;
    // 상한을 스캔 범위에 반영(후처리로 거르면 차선 대역 못 찾음)
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
        /* 'real'은 음의 주파수도 남겨 실수 신호, 나머지는 양의 주파수만 ×2 → 해석 신호(|z| = 포락선) */
        var _md = mode || SK_MODE;
        if (_md === 'real') {
          for (var k = lo; k <= hi; k++) { re[k] = re0[k]; im[k] = im0[k]; re[m - k] = re0[m - k]; im[m - k] = im0[m - k]; }
        } else {
          for (var k2 = lo; k2 <= hi; k2++) { re[k2] = 2 * re0[k2]; im[k2] = 2 * im0[k2]; }
        }
        for (j = 0; j < m; j++) im[j] = -im[j];
        fftComplex(re, im);
        var bp = new Array(m), fe = 0, v;
        if (_md === 'real') {
          for (j = 0; j < m; j++) { bp[j] = re[j] / m; fe += bp[j] * bp[j]; }
          v = Math.sqrt(fe / m) > 1e-9 ? kurtosis(bp) : 0; // 대역 에너지 없으면 0
        } else {
          var s2 = 0, s4 = 0;
          for (j = 0; j < m; j++) {
            var a2 = (re[j] * re[j] + im[j] * im[j]) / (m * m);   // |z|²
            bp[j] = Math.sqrt(a2); fe += a2; s2 += a2; s4 += a2 * a2;
          }
          s2 /= m; s4 /= m;
          if (!(Math.sqrt(fe / m) > 1e-9) || !(s2 > 1e-18)) v = 0;
          else v = (_md === 'ck') ? (s4 / (s2 * s2) - 2) : kurtosis(bp);
        }
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

  /* 해석 신호(힐베르트) 포락선 — 대역통과와 FFT 1회로 처리(양의 주파수만 ×2 → 허수부가 힐베르트 변환)
     ⚠ 역FFT 후 실수부만 취하지 말 것 — 해석 신호 스펙트럼은 에르미트가 아님 */
  function analyticEnvelope(values, fs, loHz, hiHz) {
    var n = values.length, m = 1; while (m * 2 <= n) m *= 2;
    if (m < 16 || !(fs > 0)) return null;
    var re = new Array(m), im = new Array(m), i, mean = 0;
    for (i = 0; i < m; i++) mean += values[i]; mean /= m;
    for (i = 0; i < m; i++) { re[i] = values[i] - mean; im[i] = 0; }
    fftComplex(re, im);
    var df = fs / m, lo = Math.max(1, Math.round(loHz / df)), hi = Math.min(m / 2 - 1, Math.round(hiHz / df));
    if (!(hi > lo)) return null;
    for (var k = 0; k < m; k++) {
      if (k >= lo && k <= hi) { re[k] *= 2; im[k] *= 2; } else { re[k] = 0; im[k] = 0; }
    }
    for (i = 0; i < m; i++) im[i] = -im[i];
    fftComplex(re, im);
    var out = new Array(m);
    for (i = 0; i < m; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / m;
    return out;
  }

  /* 포락선 스펙트럼 — 베어링 충격 반복 주파수 복조. band({loHz,hiHz}) 주면 그 대역만 통과 후 복조(제품은 고정 1~5 kHz)
     mode:
       'rect' — |x| 전파 정류(복조 대역이 넓으면 대역 내 차주파수가 포락선 대역에 섞임)
       'env'  — 해석 신호 |z| = √(x² + H{x}²), 곱 성분 없음(기본값)
       'sq'   — |z|², 없는 하모닉 생성 — 쓰지 않음 */
  function envelopeSpectrum(values, fs, maxHz, band, mode) {
    var n = values.length;
    if (n < 64) return { freqs: [], mags: [], res: 1 };
    var md = mode || patConst().MODE;
    var top = Math.min(maxHz || 500, fs * 0.4);
    if (md !== 'rect') {
      /* 대역 없으면(저샘플 태그) 전대역 해석 신호 — 정류로 물러서면 판정 경로가 둘로 갈림 */
      var _lo = (band && band.hiHz > band.loHz) ? band.loHz : 1;
      var _hi = (band && band.hiHz > band.loHz) ? band.hiHz : fs * 0.45;
      var a = analyticEnvelope(values, fs, _lo, _hi);
      if (a) {
        if (md === 'sq') for (var j = 0; j < a.length; j++) a[j] = a[j] * a[j];
        return amplitudeSpectrum(a, fs, top);
      }
    }
    var src = (band && band.hiHz > band.loHz) ? bandpassSignal(values, fs, band.loHz, band.hiHz) : values;
    var env = new Array(src.length), i;
    for (i = 0; i < src.length; i++) env[i] = Math.abs(src[i]);
    if (md === 'sq') for (i = 0; i < env.length; i++) env[i] = env[i] * env[i];
    return amplitudeSpectrum(env, fs, top);
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

  // STFT 스펙트로그램: grid[시간(과거→현재)][주파수], rows×cols — chart.js drawHeat 포맷
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

  // 특정 주파수의 하모닉 열 에너지 — f0, 2f0, … nf0 (±tol)에서 유의 진폭(>minMag)만 합산·계수
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
  // 스펙트럼 패턴 진단(단일 피크 대조 보강): 하모닉 열·측대역으로 풀림/정렬/베어링 결함 패턴 검출
  // 노이즈 플로어 오검출 방지 — 유의 임계(최대피크 8% & 중앙값 4배) 넘는 피크만 하모닉으로 인정
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
    // 지배 피크 동기성 — 풀림(정수배 하모닉 열)은 지배 성분이 동기일 때만(비동기면 베어링·벨트 등)
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

  // 지배 주파수 규칙 진단: 1×/2×/베어링 결함 주파수와 대조 (±max(1.5×분해능, 1%))
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
     · 한계 = μ + k·σ, μ=median · σ=1.4826·MAD(평균·표준편차는 스파이크에 σ가 부풀어 이탈을 덮음)
     · 1.4826 = 정규 등가 스케일 보정("3σ" 의미·저장 포맷 {mu,sigma,k} 유지) */
  var BASELINE_MIN_N = 30; // 최소 표본(미만이면 산포 추정 신뢰 불가)
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
  /* 정상상태 게이트 — 학습 표본에서 정지·과도(기동/정지 램프) 버킷 제외(정지 구간이 많으면 median 자체가 하락)
     참조 수준 P75(운전 레벨). vals는 시간순 필수(램프 감지가 인접 차분 기반) */
  var BL_IDLE_FRAC = 0.2;  // 참조의 20% 미만 = 정지·아이들
  var BL_RAMP_FRAC = 0.3;  // 인접 버킷 변화가 참조의 30% 초과 = 기동/정지 과도
  /* 이중 수준(정지↔운전) 판정 — 비율과 배율(상위군/중앙값)을 함께 봄(비율만이면 충격성 정상 신호와 구분 불가) */
  var BL_BIMODAL_FRAC = 0.1;   // 중앙값의 3배 위 표본 비율
  var BL_BIMODAL_RATIO = 10;   // 상위군 중앙값 / 전체 중앙값
  function steadyStateFilter(vals) {
    var n = vals.length;
    if (!n) return { vals: [], idle: 0, ramp: 0, ref: 0, bimodalFrac: 0 };
    // 이중 수준 감지는 필터 전 원본에서(정지가 대부분이면 P75가 정지 수준에 붙음)
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
      // 양측 검사 — 이전만 보면 완만한 계단 램프·스파이크 옆 버킷이 샘
      var dPrev = i > 0 ? Math.abs(v - vals[i - 1]) : 0;
      var dNext = i < n - 1 ? Math.abs(vals[i + 1] - v) : 0;
      if (dPrev > thr || dNext > thr) { ramp++; continue; }
      out.push(v);
    }
    return { vals: out, idle: idle, ramp: ramp, ref: ref, bimodalFrac: bimodalFrac, bimodalRatio: bimodalRatio, bimodal: bimodal };
  }
  /* 한계 클램프 — 최소 μ×1.2(σ≈0 초안정 신호의 노이즈 알람 반복 방지)
     ⚠서버 감시 스크립트에 소스 임베드(monitor.js limitSrc) — 외부 변수 참조 금지 */
  function baselineLimit(bl) {
    if (!bl) return null;
    return Math.max(bl.mu + (bl.k || 3) * bl.sigma, bl.mu * 1.2);
  }

  return {
    ISO_ZONES: ISO_ZONES, UNIT_ZONES: UNIT_ZONES, zonesFor: zonesFor, gradeFor: gradeFor,
    BEARINGS: BEARINGS, RETIRED_BEARINGS: RETIRED_BEARINGS, bearingFreqs: bearingFreqs, faultFreqSummary: faultFreqSummary,
    toBucket: toBucket, sevMetrics: sevMetrics, kurtosis: kurtosis, fmt: fmt, timeIndics: timeIndics,
    fftComplex: fftComplex, bandKurtosis: bandKurtosis, amplitudeSpectrum: amplitudeSpectrum, envelopeSpectrum: envelopeSpectrum, analyticEnvelope: analyticEnvelope, ENV_MODE: ENV_MODE, SK_MODE: SK_MODE,
    MON_REV: MON_REV, MON_ADOPT: MON_ADOPT, patternGate: patternGate, patternRound: patternRound, patSrc: patSrc,
    bandpassSignal: bandpassSignal, kurtogram: kurtogram,
    MOUNT_FMAX: MOUNT_FMAX, mountFmax: mountFmax, KG_NYQ_FRAC: KG_NYQ_FRAC, beltFreqs: beltFreqs, shaftRpm: shaftRpm,
    RULESET: RULESET, rulesetFingerprint: rulesetFingerprint,
    bandRms: bandRms, bandRmsMulti: bandRmsMulti, measuredOneX: measuredOneX, envelopeQuant: envelopeQuant, bearingMatch: bearingMatch,
    bearingFsOk: bearingFsOk, BEARING_FS_RATIO: BEARING_FS_RATIO,
    sidebandMatch: sidebandMatch, combRatio: combRatio, demodFixed: demodFixed, envMaxFor: envMaxFor, COMB_ADOPT: COMB_ADOPT, DEMOD_FIX: DEMOD_FIX,
    targetedMatch: targetedMatch, gridScore: gridScore, TGT_ADOPT: TGT_ADOPT, prewhiten: prewhiten,
    isoRms: isoRms, bandpass: bandpass, biquad: biquad, isoNeeded: isoNeeded, isoSkippable: isoSkippable, fsFromTimes: fsFromTimes, isoSrc: isoSrc, embedSrc: embedSrc, worstGrade: worstGrade,
    patternGrade: patternGrade, EVID_ADOPT: EVID_ADOPT,
    dwellWorst: dwellWorst, DWELL_MIN_N: DWELL_MIN_N,
    acVals: acVals, gateFromBuckets: gateFromBuckets, gateFromRaw: gateFromRaw, sensorTick: sensorTick, impactEvidence: impactEvidence, gateSrc: gateSrc,
    convSrc: convSrc, unitScale: unitScale,
    GATE_BLOCK: GATE_BLOCK, gateReason: gateReason,
    bandJudge: bandJudge, bandJudgeSrc: bandJudgeSrc, bandParse: bandParse, evenSample: evenSample, bandAnchors: bandAnchors, bandEdges: bandEdges, bandMeasurable: bandMeasurable, softBands: softBands, demodBand: demodBand, faultCoeffs: faultCoeffs, windowRms: windowRms, windowSeries: windowSeries, isRunning: isRunning, runRef: runRef, detectFlap: detectFlap,
    BAND_KO: BAND_KO, BAND_ORDER: BAND_ORDER, BAND_FREQ: BAND_FREQ, BAND_CTX: BAND_CTX, BAND_LEGACY: BAND_LEGACY, BAND_GRADE: BAND_GRADE, BAND_HYST: BAND_HYST, ENV_TYPE_MARGIN: ENV_TYPE_MARGIN, BL_IDLE_FRAC: BL_IDLE_FRAC,
    bandRmsAveraged: bandRmsAveraged, welchSpectrum: welchSpectrum, decimate: decimate,
    convertDomain: convertDomain, convertSpectrumMags: convertSpectrumMags,
    signalQuality: signalQuality, kurtosisSaturation: kurtosisSaturation,
    cepstrumFromSpectrum: cepstrumFromSpectrum, stftGrid: stftGrid,
    diagnoseDominant: diagnoseDominant, analyzeSpectrum: analyzeSpectrum, harmonicEnergy: harmonicEnergy,
    baselineFit: baselineFit, baselineLimit: baselineLimit,
    steadyStateFilter: steadyStateFilter, median: median,
    BASELINE_MIN_N: BASELINE_MIN_N, BL_BIMODAL_FRAC: BL_BIMODAL_FRAC, BL_BIMODAL_RATIO: BL_BIMODAL_RATIO
  };
});
