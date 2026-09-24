// calc/calc.js — 진동 계산 코어 (순수 JS · fetch/DOM 없음)
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
   * 판정에 영향을 주는 상수들에서 계산한 해시 — 지문이 다르면 엔진이, 같은데 결과가 다르면 데이터가 달라진 것.
   * ⚠판정에 영향을 주는 상수를 바꾸면 이 목록에도 반영할 것.
   */
  var RULESET = '2026.08b';
  function rulesetFingerprint() {
    var p = [
      'iso:10-1000', 'isoBlocks:8', 'parseval:0.03',
      'crest:15', 'kurt:25', 'crestBands:5/8/15', 'kurtBands:4/10/25',
      'matchTol:0.01', 'bpfTol:0.02', 'harm:2', 'ordTolRel:0.01',
      'satMinSpanMin:' + SAT_MIN_SPAN_MIN,
      'mountFmax:10000/5000/2000/1000', 'bandSoft:edgeHi>fmax/capWarn',
      'bl:mad1.4826/idle0.2/ramp0.3/margin0.2/bimodal0.1x10',
      'bearingFsRatio:20', 'aliasFmax:0.8nyq/half', 'winMs:exact', 'bandGrade:1.5/3.0/hyst0.9',
      'bandLimGate:>0', 'evalWin:rms/partialCnt0.9',
      /* 아래는 2026.08에 바뀐 판정 규칙 — 지문이 따라가지 않으면 예전 리포트와 비교할 때
         기준이 바뀐 것을 "데이터만 달라졌다"로 오독한다(지문의 존재 이유가 그것이다). */
      'isoZoneUnit:mm/s-always', 'isoConvert:accel-integrate/disp-differentiate',
      'axes:iso+baseline+band+pattern', 'patAxis:evid>=' + EVID_ADOPT + '/cap1/gateOff',
      'avgGraded:false', 'crestArtifact:needRawGate', 'kgNyqFrac:' + KG_NYQ_FRAC, 'bandAx:freq+env',
      /* 2026.08b — 진단 복조 대역을 커토그램에서 저역 고정으로 바꾸고, 측대역 빗 채택 경로를 더했다.
         같은 데이터라도 판정이 달라지므로 지문이 따라가야 예전 리포트와 비교가 성립한다. */
      'demodFix:' + DEMOD_FIX.join('-'), 'comb:' + COMB_ADOPT + '/m' + COMB_M,
    ].join('|');
    var hsh = 2166136261; // FNV-1a
    for (var i = 0; i < p.length; i++) { hsh ^= p.charCodeAt(i); hsh = (hsh * 16777619) >>> 0; }
    return hsh.toString(36).slice(0, 6);
  }

  /* ---------------- ISO 10816 / 단위별 존 ---------------- */
  var ISO_ZONES = { I: [0.71, 1.8, 4.5], II: [1.12, 2.8, 7.1], III: [1.8, 4.5, 11.2], IV: [2.8, 7.1, 18.0] };
  var UNIT_ZONES = { 'mm/s': null, 'g': [0.5, 1.0, 2.0], 'μm': [12, 25, 50] };
  // 이 위의 Crest는 기계 신호로 설명되지 않는다 — 스파이크성 잡음(ESD·케이블·접촉) 시그니처.
  // gateFromRaw도 같은 경계를 쓰는데 그쪽은 TQL에 통째로 임베드되어 바깥 이름을 참조할 수 없다.
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
    '22218': { n: 14, Bd: 20.0, Pd: 130, phi: 12 }, '23124': { n: 17, Bd: 25.0, Pd: 165, phi: 10 },
    'NU312': { n: 12, Bd: 20.0, Pd: 96.5, phi: 0 }, 'NU316': { n: 11, Bd: 26.0, Pd: 127, phi: 0 },
    // NASA/IMS 공개 베어링 데이터셋의 시험 베어링 — 열당 롤러 16개(복열), 2.815"/0.331" → mm
    'ZA-2115': { n: 16, Bd: 8.407, Pd: 71.501, phi: 15.17 },
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

  /* 결함 주파수의 회전주파수 배수 계수 — 호출측이 그때그때 실측 fr을 곱해 쓴다(명판 기준 고정 방지). 형상이 없으면 null. */
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
  // /db/query 롤업 행 r=[ms, SUMSQ, COUNT, MIN, MAX, SUM?] → {ms, rms, p2p, crest, cnt(, sum)}
  // SUM이 있으면 windowRms가 평균(DC)을 뺀 AC 실효값을 낸다.
  function toBucket(r) {
    var cnt = r[2];
    if (!cnt) return null;
    var rms = Math.sqrt(Math.max(0, r[1]) / cnt);
    var mn = r[3], mx = r[4];
    var b = { ms: r[0], rms: rms, p2p: mx - mn, crest: rms > 0 ? Math.max(Math.abs(mn), Math.abs(mx)) / rms : 0, cnt: cnt, mn: mn, mx: mx };
    if (r.length > 5 && isFinite(r[5])) b.sum = r[5];
    return b;
  }

  /* 기간 지표 4종 — 상세분석 화면과 리포트가 같은 값을 쓰도록 한 곳에서 낸다.
      · 넷 다 graded:false — 등급은 앵커 축(ISO·결함 패턴·베이스라인·대역)이 정한다
      · 대표값은 P95 — 최댓값은 값·초과 횟수만 싣는다(n.wMax·n.overBC)
      · Crest 기준은 샘플 수의 함수 √(2·ln N), 15 초과는 badge 처리
      · 변화율은 관측 창 60분 미만이면 기준선 자체가 없다
     badge가 비어 있지 않을 때만 화면에 배지가 뜬다. 라벨·서식은 부르는 쪽 몫이다. */
  function sevMetrics(roll, o) {
    o = o || {}; roll = roll || [];
    var zones = o.zones || [0, 0, 0], gate = !!o.gate, i;
    // 버킷 rms(√(Σx²/N))는 DC 포함 → 평균을 빼 AC 실효값으로. Crest의 peak도 평균 기준으로 잰다.
    var rms = [], crestA = [], cnt = 0;
    for (i = 0; i < roll.length; i++) {
      var b0 = roll[i];
      var m0 = (b0 && b0.cnt > 0 && isFinite(b0.sum)) ? b0.sum / b0.cnt : 0;
      var ac0 = Math.sqrt(Math.max(0, b0.rms * b0.rms - m0 * m0));
      if (!isFinite(ac0) || (!isFinite(b0.sum) && ac0 === 0)) ac0 = b0.rms;   // SUM 없는 옛 버킷은 그대로
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
    var cExp = Math.sqrt(2 * Math.log(perBucket));
    var durMin = roll.length > 1 ? (roll[roll.length - 1].ms - roll[0].ms) / 60000 : 0;
    var graded = durMin >= 60;
    // 계측을 못 믿는 동안은 어느 지표도 등급어를 쓰지 않는다 — 자기 배지가 이미 있으면 그게 우선이다
    var hold = function (own) { return own || (gate ? '잠정' : ''); };
    return {
      /* 평균은 등급 기준이 아니다 — 조용한 구간이 고진동 구간을 희석해 "평소 괜찮다"로 읽히게 한다.
         최댓값을 등급 없이 사실만 내는 것과 같은 이유이고 방향만 반대다(최댓값은 과대, 평균은 과소). */
      avg: { value: wAvg, thr: zones[1], graded: false, grade: gradeFor(wAvg, zones), badge: hold('') },
      /* P95도 등급을 갖지 않는다 — 카드는 광대역·원본 단위이고 등급은 ISO 대역제한·속도라
         기준이 다르다. 카드에 등급어를 달면 "P95 양호인데 종합 심각"이 한 화면에 남는다.
         노출량 통계로는 그대로 쓸모가 있어 값과 기준은 유지한다. */
      p95: { value: rP95, thr: zones[1], graded: false, grade: gradeFor(rP95, zones), badge: hold('') },
      /* 배지는 대표값(P95)으로 판단한다 — 최댓값으로 달면 단발 스파이크 하나에 붙는다.
         다만 최댓값이 아티팩트 경계를 넘었다는 사실은 각주가 밝혀야 한다: 판정은 P95로 하면서
         근거로 최댓값을 인쇄하면 P95만 경계 아래인 구간에서 화면이 스스로 어긋난다. */
      /* 아티팩트로 단정하려면 원시 파형 게이트(gate)가 함께 걸려야 한다. 롤업 버킷의 Crest는
         버킷 안에 충격이 몰린 실제 결함에서도 크게 나온다 — 내륜 결함 확정 채널이 1시간 버킷에서
         24.8로 나왔다. 게이트 없이 큰 것은 "충격성이 강하다"까지만 말할 수 있고, 결함인지
         계측 잡음인지는 포락선이 결함 주파수에 정렬되는지로 갈린다. */
      /* note: 등급어도 아니고 "판정에 쓰지 마라"도 아닌 세 번째 부류 — 관측 사실이다.
         회색(잠정·참고·아티팩트)은 "무시해도 됨"으로 읽히는데 충격성 강함은 정반대다. */
      /* Crest도 등급을 갖지 않는다 — 기준 √(2·ln N)은 가우시안 잡음의 기대 최댓값인데
         진동은 꼬리가 두꺼워 버킷이 길수록 실측이 기대를 계속 초과한다. 같은 3일 구간이
         분 롤업에서 7.40(기준 4.46), 시간 롤업에서 8.09(기준 4.83)로 나와 등급이 주의→위험으로
         넘어간다 — 데이터가 아니라 자가 바뀐 것이고, 롤업 단위는 기간 길이가 자동으로 고른다.
         값·기준·각주는 그대로 두고 등급 주장만 내려놓는다. */
      crest: { value: cP95, thr: cExp, artifact: CREST_ARTIFACT, graded: false,
        grade: cP95 < cExp ? 0 : cP95 < 8 ? 1 : cP95 < CREST_ARTIFACT ? 2 : 3,
        badge: cP95 > CREST_ARTIFACT ? (gate ? '계측 아티팩트 의심' : '충격성 강함') : hold(''),
        note: cP95 > CREST_ARTIFACT && !gate },
      trend: { value: wTrend, thr: 2.0, graded: graded,
        grade: graded ? (wTrend < 1.3 ? 0 : wTrend < 2 ? 1 : 3) : 0, badge: hold('') },
      n: { cnt: cnt, buckets: roll.length, perBucket: perBucket, cExp: cExp, durMin: durMin,
        overBC: overBC, wAvg: wAvg, wMin: wMin, wMax: wMax, wCrest: wCrest, wTrend: wTrend, rMed: pctl(rms, 0.5) },
    };
  }

  /* 기간 내 "지속된 최악" — 스칼라 하나로 기간을 대표할 때 백분위(P95)를 쓰면 안 되는 이유가 있다:
     P95는 기간 길이에 따라 허용하는 시간이 달라진다(1시간이면 3분, 34일이면 41시간).
     같은 배지가 기간마다 다른 물리를 뜻하게 되므로, 기준은 시간 단위여야 불변이다.

     개수와 시간을 함께 요구한다 — 개수만 보면 수집 간격에 따라 뜻하는 시간이 달라지고
     (10분 간격이면 3개=30분), 시간만 보면 드문 수집에서 표본 1개도 안 되는 창이 되어
     단발 튐에 뚫린다. 시간 쪽 기준은 새 상수를 만들지 않고 감시의 확정 유지시간을 그대로 쓴다.

     갭(수집 중단)을 건너뛴 연속은 연속이 아니다 — 버킷 간격의 배수를 넘으면 구간을 끊는다.
     반환 { v, ms, n, durMs } — v는 그 창에서 계속 넘고 있던 수준(창 안 최솟값)이고
     ms는 그 창의 끝 시각이다. "언제부터"가 없으면 기간 등급은 조치로 이어지지 않는다. */
  var DWELL_MIN_N = 3;             // 2개는 우연과 구분이 안 된다 — 추세로 볼 수 있는 최소선
  var DWELL_GAP_MULT = 3;          // 버킷 간격의 이 배수를 넘으면 수집이 끊긴 것으로 본다
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
      // 창을 넓혀 가며 "창 안 최솟값"의 최댓값을 찾는다 — 그 값이 그 창 내내 유지된 수준이다
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
    // 밴드폭은 range와 σ 중 좁은 쪽 — range만 쓰면 단발 스파이크가 range를 키워 나머지 신호가 클리핑으로 오분류된다.
    var b = Math.min(range * 0.005, std * 0.05) || range * 0.005;
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
    if (crest > 15) { issues.push({ key: 'spike', label: '단발 스파이크 의심', detail: 'Crest ' + crest.toFixed(1) + ' — 결함 신호(통상 <10)보다 스파이크성 잡음(ESD·케이블·접촉) 시그니처에 가깝습니다' }); }
    if (kurt > 25) { issues.push({ key: 'kurtx', label: '극단 첨도', detail: 'Kurtosis ' + kurt.toFixed(1) + ' — 소수 샘플이 지배하는 신호, 계측 아티팩트 가능성 — 센서·마운팅 확인 필요' }); }
    /* 판정을 막는 사유 — 감시(gateFromBuckets·gateFromRaw)와 같은 목록이어야 한다(다르면 감시·상세분석 판정이 갈린다).
       ⚠배열은 함수 안에 둔다 — 이 함수는 서버 TQL에 문자열로 임베드되어 바깥 이름(GATE_BLOCK)을 쓸 수 없다. */
    var BLOCK = ['flatline', 'sparse', 'spike', 'kurtx', 'clip', 'dc'];
    for (i = 0; i < issues.length; i++) if (BLOCK.indexOf(issues[i].key) >= 0) gate = true;
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
  /* 단위 → [SI 배율, order]. 표시값 × 배율 = SI(m/s²·m/s·m).
     ⚠ 표를 함수 안에 둔다 — convertDomain이 서버 TQL에 임베드되므로(convSrc) 모듈 상수를 참조하면
        압축본에서 이름이 어긋나 서버에서만 ReferenceError가 난다. */
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
    /* 적분 시 저주파 드리프트 컷 — 1/ω 이득 때문에 DC 근처 잡음이 속도에서 폭발한다.
       회전수 상대(fr×0.3)로 잡되 **10 Hz를 넘기지 않는다**: ISO 10816/20816 대역이 10 Hz부터라
       그 위로 자르면 규격 대역을 스스로 깎는다(3600 rpm이면 컷 18 Hz → 10~18 Hz가 97% 소실).
       10 Hz 아래 드리프트는 뒤따르는 ISO 대역제한이 어차피 걷어낸다. */
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
  // 스펙트럼(진폭) 물리량 변환 — 서버 FFT mags를 표시 단위로. |(iω)^d| = ω^d 스케일.
  function convertSpectrumMags(mags, freqs, fromUnit, toUnit) {
    var uf = unitScale(fromUnit), ut = unitScale(toUnit);
    if (!uf || !ut || uf[1] === ut[1]) return mags.slice(0);
    var d = ut[1] - uf[1], sc = uf[0] / ut[0];
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

  /* 여러 대역의 RMS를 FFT 한 번으로 — Parseval 정리로 주파수영역에서 제곱합을 내 대역별 역FFT를 생략한다.
     bands: [[lo,hi], …] → 같은 순서의 RMS 배열(bandRms와 동일 값). */
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
  /* 미매칭은 negatives로 돌려 보고하되 "반대 증거"로 쓰지 않는다 — 포락선의 지배 피크가
     결함주파수가 아니었다는 뜻이고, 열화 말기에는 결함주파수가 흐려지므로 결함이 확정된
     베어링에서도 이 상태가 나온다(실측: 내륜 결함 확정 채널의 말기가 그랬다). */
  // 측대역은 반송파가 그 결함주파수일 때만 근거: 내륜=BPFI±1×, 전동체=BSF±FTF, 외륜=측대역 없음.
  /* 포락선 복조로 베어링 결함을 볼 수 있는 최소 샘플레이트 = 최고 결함주파수의 20배.
     그 미만은 "미검출"이 아니라 "측정 불가"로 다룬다(반대 증거로 쓰지 않는다). */
  /* ---------------- 대역 이탈 판정 ----------------
     학습된 한계(μ+kσ) 대비 비율로 등급을 매기고, 상관된 대역들은 설비 단위 이벤트 하나로 합성한다.
     복귀는 ×0.9 히스테리시스. */
  var BAND_KO = { sub: '서브동기', one: '1× 대역', fault: '결함 대역', high: '고주파', vh1: '1~2 kHz', vh2: '2~4 kHz', vh3: '4~8 kHz', vh4: '8 kHz+',
    envPkRel: '주기성', envBPFO: 'BPFO(외륜)', envBPFI: 'BPFI(내륜)', envBSF: 'BSF(볼)', envFTF: 'FTF(케이지)', envF0: '반복주파수', envHarm: '하모닉 수', fr: '회전주파수' };
  /* 주파수 대역 8칸 — bandEnergy의 출력 순서이자 bandEdges의 인덱스와 1:1이다.
     대역 경계·측정 가능성을 인덱스로 따지는 곳은 반드시 이 목록을 써야 한다(BAND_ORDER는 더 길다). */
  var BAND_FREQ = ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4'];
  /* 판정 계열 — 대역 8칸 + 포락선 4. 학습·판정·삭제가 이 목록을 돈다.
     포락선 쪽은 주파수 대역이 아니라 복조 스펙트럼에서 읽은 값이라 경계가 없다.
     envF0(반복주파수)·envHarm(개수)·envFTF·fr은 여기 없다 — 저장은 하되 판정하지 않는다(BAND_CTX).
     FTF를 뺀 이유는 0.4×fr이라 오일훨(0.38~0.48×)과 겹쳐 오탐이 되기 때문이고, F0·harm은
     "몇 Hz인가·몇 개인가"라 커지는 게 나쁜 값이 아니라서다. */
  var BAND_ORDER = BAND_FREQ.concat(['envPkRel', 'envBPFO', 'envBPFI', 'envBSF']);
  var BAND_CTX = ['fr', 'envF0', 'envHarm', 'envFTF'];
  /* 이름이 바뀌기 전 학습값 — 삭제 경로에서만 쓴다. 목록에서 빠진 뒤에도 표에 남으면
     아무도 안 보는 행이 영영 쌓인다. */
  var BAND_LEGACY = ['vhigh'];
  var BAND_GRADE = [1.5, 3.0];   // ×1.0~1.5 주의 · 1.5~3.0 위험 · 3.0~ 심각
  var BAND_HYST = 0.9;           // 복귀 판정 배수
  // 포락선 결함주파수 1·2순위가 이 비율 안이면 종류를 단정하지 않는다(둘 다 적는다)
  var ENV_TYPE_MARGIN = 0.8;
  /* now: {대역:값} · bls: {대역:{mu,sigma,k}} · wasOn: 직전 이탈 여부(히스테리시스용)
     반환 { on, gi, over:[{k,ko,v,lim,r,soft}], maxR, soft, detail } — detail은 이벤트 DETAIL 컬럼에 그대로 들어간다.
     ⚠소스가 통째로 서버 TQL에 임베드되므로(monitor.js) 바깥 이름을 쓰지 않는다 — 상수·한계식을 안에서 재선언.
     softKeys: 마운팅 유효 상한을 넘어 확정 근거로 못 쓰는 대역 키들(softBands 산출) —
     그 대역만 이탈이면 등급 상한 '주의'(잠정), 확정 대역이 함께 이탈이면 등급은 그쪽 배수로만 정한다. */
  function bandJudge(now, bls, wasOn, softKeys, latchIn, nowMs) {
    if (!now || !bls) return null;
    // TQL 임베드라 바깥 BAND_ORDER·BAND_KO를 못 쓴다 — 아래 사본은 모듈 목록과 항상 같아야 한다.
    var ORDER = ['sub', 'one', 'fault', 'high', 'vh1', 'vh2', 'vh3', 'vh4', 'envPkRel', 'envBPFO', 'envBPFI', 'envBSF'];
    /* 포락선 계열은 되돌아가지 않는다 — 스폴은 메워지지 않고, 신호만 부하·윤활·센서 각도에
       따라 묻힌다. 그래서 "지금 안 보인다"를 "없어졌다"로 읽으면 안 된다: 한 번 넘으면
       최고 배수와 최초 시각을 기억해 유지한다(latch). 주파수 대역은 반대다 — 부하에 따라
       정상적으로 오르내리므로 "지금 큰가"가 맞는 질문이다. 리셋은 재학습에서만 한다. */
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
      // 한계 0(빈 대역이 μ=0·σ=0으로 학습된 것)은 판정 제외. any는 이 검사 뒤에 세워야 "판정 가능 대역 없음"과 "이탈 아님"이 구분된다.
      if (!(lim > 0)) return;
      any = true;
      var r = v / lim, sf = !!SOFT[k], isEnv = !!ENVK[k];
      if (isEnv && r > thr) {
        if (!latch[k]) latch[k] = { r: r, at: nowMs || 0 };
        else if (r > latch[k].r) latch[k] = { r: r, at: latch[k].at };
      }
      // 포락선은 기억한 최고 배수로 판정한다 — 지금 값이 내려와도 결함은 남아 있다
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
      // 기억으로 유지되는 항목은 그 사실을 적는다 — 지금 값과 판정 배수가 다르므로
      return o.k + '=' + o.v.toFixed(3) + '/' + o.lim.toFixed(3) + (o.soft ? '(잠정)' : '')
        + (o.latched ? '(이력 ×' + o.r.toFixed(2) + ')' : '');
    }).join(' · ');
    /* 두 축을 갈라 낸다 — 주파수 대역은 "이 지점 진동이 커졌나", 포락선 결함주파수는
       "이 베어링이 상했나"로 서로 다른 질문에 답한다. 최댓값 하나로 뭉치면 비특이적 대역이
       특이적 계열을 덮는다: 실측에서 정상 베어링이 vh2 ×3.97(옆 베어링 결함이 축을 타고 전파)로
       결함 베어링(×2.35)보다 높게 나왔다. 포락선만 보면 정상 최대 1.26 / 결함 최소 1.42로 갈린다.
       등급 자체는 여전히 최댓값이다(worstGrade 원칙) — 갈라 내는 것은 원인 표시다. */
    var ENVF = { envBPFO: 1, envBPFI: 1, envBSF: 1 };
    var envR = 0, envK = '', env2R = 0, env2K = '', freqR = 0, freqK = '', oi;
    for (oi = 0; oi < over.length; oi++) {
      var ov2 = over[oi];
      if (ENVF[ov2.k]) {
        if (ov2.r > envR) { env2R = envR; env2K = envK; envR = ov2.r; envK = ov2.k; }
        else if (ov2.r > env2R) { env2R = ov2.r; env2K = ov2.k; }
      } else if (ov2.r > freqR) { freqR = ov2.r; freqK = ov2.k; }
    }
    /* 1·2순위가 근접하면 종류를 단정하지 않는다 — 실측에서 BPFO 1.42 / BSF 1.39(2% 차)를
       "외륜"으로 단정하고 있었다. "상했다"는 맞게 말하되 "어디가"는 근거가 설 때만 말한다.
       어느 쪽이든 베어링 교체라 정비 계획은 이것만으로도 선다 — 종류는 근본원인 분석용이다. */
    var envAmbig = envR > 0 && env2R > 0 && env2R >= envR * ETM;   // 모듈 ENV_TYPE_MARGIN과 같은 값(테스트가 대조)
    return { on: on, gi: gi, over: over, maxR: maxR, soft: on && !nHard, detail: detail, latch: latch,
      envR: envR, envKey: envK, envAlt: envAmbig ? env2K : '', freqR: freqR, freqKey: freqK };
  }
  /* 대역 경계(Hz) — 정의는 여기 하나뿐이고 band.js(bandsFor)가 이걸 쓴다.
     초고주파는 1000 Hz 고정 하한이라 샘플레이트가 낮으면 하한이 Nyquist를 넘는 빈 대역이 생긴다. */
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
  /* 그 대역이 이 샘플레이트로 측정 가능한지 — 하한이 Nyquist 이상이면 빈 대역.
     포락선 계열은 경계가 없어 통과시킨다(그래서 BAND_ORDER가 아니라 BAND_FREQ로 찾는다). */
  function bandMeasurable(bn, fr, fs) {
    var i = BAND_FREQ.indexOf(bn);
    if (i < 0 || !(fs > 0) || !(fr > 0)) return true;   // 판단 불가·대역 아님이면 막지 않는다
    var e = bandEdges(fr, fs / 2)[i];
    return e[0] < Math.min(e[1], fs / 2);
  }
  /* softBands: 마운팅 유효 상한(mountFmax)을 넘거나 걸치는 대역 키들 — 판정에서 '잠정'으로 낮출 대상.
     마운팅 미상(fmax=0)이면 빈 배열(제한 없음). */
  /* demodBand: 포락선 복조 대역 — 마운팅 유효 상한 아래 최상위 옥타브 [cap/2, cap] 고정.
     추세 비교를 위해 앵커마다 대역을 바꾸지 않는다(커토그램은 그 순간의 진단용).
     대역이 바뀌면(마운팅 변경 등) 그 계열은 과거와 이어지지 않아 재학습이 필요하다. */
  function demodBand(fs, mount) {
    var nyq = fs / 2;
    if (!(nyq > 0)) return null;
    var fmax = mountFmax(mount), cap = fmax > 0 ? Math.min(fmax, nyq) : nyq;
    if (!(cap >= 400)) return null;   // 상단이 400 Hz도 안 되면 베어링 공진을 담는 대역이 아니다
    return [cap / 2, cap];
  }
  function softBands(fr, fs, mount) {
    var fmax = mountFmax(mount);
    if (!(fmax > 0) || !(fs > 0) || !(fr > 0)) return [];
    // 주파수 대역만 대상이다 — 포락선 계열은 상한을 이미 복조 대역(demodBand)에서 잘라 두었다
    var e = bandEdges(fr, fs / 2), out = [];
    for (var i = 0; i < BAND_FREQ.length; i++) if (e[i] && e[i][1] > fmax) out.push(BAND_FREQ[i]);
    return out;
  }
  /* 밀도 균일화 — 격자 버킷당 표본 한 점만 남겨 "시간당 표본 수"를 고르게 만든다(밀도 편중이 중앙값·MAD를 지배하는 것 방지).
     버킷 안에서 평균으로 뭉치지 않고 한 점을 그대로 쓴다 — 뭉치면 σ가 줄어 한계가 좁아지고 오경보가 는다.
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
  /* 판정값 진동(플래핑) 감지 — 악화·개선을 짧은 간격으로 반복하는 태그를 찾는다(설정이 현장에 안 맞는다는 신호).
     주기 = threshold 이벤트 간격의 중앙값, 3회 미만은 진동으로 치지 않는다. ts는 오름차순 threshold 시각 배열. */
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
  /* 운전 판별 — 값이 정지 수준으로 떨어졌는지(설명되지 않는 하락을 "복귀"로 알리지 않기 위한 판별).
     기준(ref)은 학습 μ 우선, 없으면 최근 P75. 비율은 BL_IDLE_FRAC(0.2)과 같은 값. */
  function isRunning(val, ref) {
    if (!(ref > 0)) return true;          // 기준이 없으면 막지 않는다(판별 불가 ≠ 정지)
    // 0.2 = BL_IDLE_FRAC과 같은 값 — TQL 임베드라 바깥 이름을 참조할 수 없어 값으로 쓴다.
    return val >= ref * 0.2;
  }
  /* 버킷의 AC 실효값 배열 — 정지 판별의 참조값을 판정값(AC)과 같은 양으로 맞춘다.
     DC 포함 rms를 섞어 비교하면 오프셋이 있는 센서가 항상 정지로 읽힌다. */
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
  /* 구간 RMS — 롤업 버킷들을 cnt 가중 이차평균으로 합친다(SUMSQ 기반이라 원본에서 직접 낸 √(Σx²/N)과 같은 값).
     산술평균으로 합치면 정지·기동이 섞인 구간에서 참 RMS를 과소평가한다.
     minCntRatio: 미완성(아직 적재 중인) 버킷 제외 기준. buckets는 {rms, cnt(, sum)} 배열(toBucket 결과 형태). */
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
     ISO 존 경계는 10~1000 Hz 속도 RMS 기준이라 전대역 값을 그 경계에 대면 다른 양을 재는 것이 된다.
     필터는 FFT가 아니라 4차 버터워스 시간영역 밴드패스(더 싸고 FFT 기준값과 사실상 일치).
     이 함수들은 소스가 서버 TQL에 문자열로 임베드되므로 바깥 이름을 하나도 쓰지 않는다. */

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
  /* ── 계측 게이트 ─────────────────────────────────────────────────────────
     들어온 파형이 기계 신호인지 계측 문제인지 판별한다(판정 앞단의 garbage-in 방어).
     플랫라인·DC는 롤업 집계만으로 매 판정마다 보고, 클리핑·스파이크·첨도는 원본 파형이 있을 때만 본다.
     반환 null(이상 없음) 또는 { key, label, detail, gi } — 플랫라인은 위험(2), 나머지는 주의(1). */

  var GATE_FLAT_RATIO = 0.002;   // σ가 peak의 0.2% 미만이면 상수나 다름없다
  var GATE_DC_RATIO = 3;         // 평균이 σ의 3배를 넘으면 기준선이 어긋난 것
  /* 판정을 막는 계측 사유(심각한 것부터) — 감시·상세분석·리포트 공용.
     signalQuality·gateFromRaw는 TQL 임베드라 같은 배열 사본을 함수 안에 갖는다(항상 이 목록과 동일해야 함). */
  var GATE_BLOCK = ['flatline', 'sparse', 'spike', 'kurtx', 'clip', 'dc'];

  /* 롤업 버킷만으로 보는 게이트 — 추가 조회 0회.
     σ는 windowRms가 이미 내는 AC 실효값이고, peak은 버킷의 MIN/MAX에서 나온다. */
  function gateFromBuckets(buckets, ac) {
    if (!buckets || !buckets.length || !(ac >= 0)) return null;
    // TQL 임베드라 상수를 안에서 재선언 — GATE_FLAT_RATIO·GATE_DC_RATIO와 항상 같은 값이어야 한다.
    var FLAT = 0.002, DCR = 3;
    var peak = 0, sum = 0, n = 0, i, b, haveSum = true;
    for (i = 0; i < buckets.length; i++) {
      b = buckets[i];
      if (!b || !(b.cnt > 0)) continue;
      if (isFinite(b.mn)) peak = Math.max(peak, Math.abs(b.mn));
      if (isFinite(b.mx)) peak = Math.max(peak, Math.abs(b.mx));
      if (isFinite(b.sum)) sum += b.sum; else haveSum = false;
      n += b.cnt;
    }
    if (!n) return null;
    /* 플랫라인 — 값이 거의 안 변한다. 설비 정지와 다르다: 정지는 값이 작아도 흔들리고,
       죽은 센서는 상수를 뱉는다. 이걸 정지로 읽으면 그 태그는 영구 무감시가 된다. */
    if (peak === 0 || ac < 1e-9 || ac < FLAT * peak) {
      return { key: 'flatline', label: '플랫라인', gi: 2,
        detail: 'σ ' + ac.toFixed(5) + ' / peak ' + peak.toFixed(3) + ' — 값이 거의 변하지 않음, 센서 정지·케이블 탈락 의심' };
    }
    if (haveSum) {
      var mean = sum / n;
      if (Math.abs(mean) > DCR * ac) {
        return { key: 'dc', label: 'DC 드리프트', gi: 1,
          detail: '평균 ' + mean.toFixed(3) + ' / σ ' + ac.toFixed(3) + ' — 기준선이 0에서 크게 벗어남' };
      }
    }
    return null;
  }

  /* 원본 파형이 있을 때만 볼 수 있는 게이트 — signalQuality의 판정을 이벤트 형태로 옮긴다.
     같은 임계를 쓰므로 화면(상세분석)과 알람이 같은 기준으로 계측을 본다. */
  function gateFromRaw(values, fs) {
    var q = signalQuality(values, fs);
    if (!q) return null;
    var issues = q.issues || [], i, j;
    /* 판정을 막는 사유만, 심각한 것부터 — 목록은 GATE_BLOCK에서 dc 제외(DC는 롤업 게이트가 먼저 봐 중복 이벤트 방지),
       Crest·첨도 제외(결함일 수도 계측 문제일 수도 있어 impactEvidence로 근거만 붙인다).
       ⚠배열을 함수 안에 두는 이유는 signalQuality와 같다(서버 TQL 임베드). */
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

  /* 충격성 근거 — 이벤트에 붙이는 설명이지 판정이 아니다.
     Crest·첨도로 대역 에너지 상승이 임펄스성(베어링·기어)인지 광대역(캐비테이션·유동 등)인지 가른다.
     경계 8 = 정상 랜덤 신호 기대 최대(3.9~4.5)와 베어링 결함 통상 범위(5~10) 사이. >15는 계측 확인 권고(막지는 않음). */
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

  /* 계측 이상 상태기 — 진동 판정과 같은 홀드 규칙을 쓴다.
     단발 스파이크 한 번으로 알리면 그것도 폭주다(escHold). 해제도 지속을 요구한다(recHold) —
     없으면 경계에서 오가는 신호가 매번 새 이벤트가 된다. */
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

  // 대역제한이 의미 있는 샘플레이트인가 — Nyquist ≤ 1000 Hz면 전대역이 곧 ISO 대역이라 필터 불필요.
  function isoNeeded(fs) { return fs > 0 && fs / 2 > 1000; }
  /* ISO 계산 생략 판단 — 구간 내 최대 초 버킷 RMS를 상한으로 쓴다(어떤 1초 창의 RMS도 이를 못 넘고,
     대역제한은 에너지를 빼기만 하므로 ISO는 그보다 작다). 버킷이 없으면 건너뛰지 않는다. */
  function isoSkippable(buckets, zone0) {
    if (!(zone0 > 0) || !buckets || !buckets.length) return false;
    var mx = 0;
    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      if (b && isFinite(b.rms) && b.rms > mx) mx = b.rms;
    }
    return mx > 0 && mx < zone0;
  }

  /* 샘플레이트 추정 — 이웃 표본 시각 차이(Δt)의 중앙값의 역수("초당 행 수"는 주기 기록·중복 적재에서 틀린다).
     tsUs: 시각 오름차순 정수 마이크로초(ms는 고주파 간격이 0으로 뭉개지고, ns는 JS 안전 정수를 넘는다).
     간격 30개 미만이면 0을 돌려 호출측이 다른 방법으로 넘어가게 한다. */
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

  /* 서로를 부르는 함수들을 TQL 임베드용 소스로 묶는다 — 함수 선언들을 한 IIFE에 같이 넣어
     압축 후에도 서로를 찾게 하고, 밖으로는 압축된 실제 이름(.name)으로 꺼내 고정 이름에 붙인다.
     exports = { 바깥이름: 함수 }. (fn.toString()을 하나씩 붙이면 압축본에서 이름이 어긋나 죽는다) */
  function embedSrc(fns, exports) {
    var keys = Object.keys(exports), parts = ['var __E=(function(){'];
    fns.forEach(function (fn) { parts.push(fn.toString()); });
    parts.push('return {' + keys.map(function (k) { return k + ':' + exports[k].name; }).join(',') + '};');
    parts.push('})();');
    parts.push('var ' + keys.map(function (k) { return k + '=__E.' + k; }).join(', ') + ';');
    return parts.join('\n');
  }
  // ISO 판정 — isoRms → bandpass → biquad로 서로를 부른다. isoNeeded·isoSkippable은 지름길 판단.
  function isoSrc() {
    return embedSrc([biquad, bandpass, isoRms, isoNeeded, isoSkippable],
      { isoRms: isoRms, isoNeeded: isoNeeded, isoSkippable: isoSkippable });
  }
  /* 결함 패턴 임베드 — 서버 타이머가 감시에서 포락선을 돌리려면 FFT 계열이 통째로 필요하다.
     envelopeSpectrum→analyticEnvelope→fftComplex, targetedMatch→gridScore가 서로를 이름으로
     부르므로 한 스코프로 묶는다. 상수(ENV_MODE·TGT_H·TGT_S)도 같이 실어야 몸통이 참조할 수 있다.
     ⚠ goja는 앱(V8)보다 100~400배 느리다 — 16,384 표본에서 855 ms다. 그래서 감시는 25회전
        창(MON_REV)을 쓰고 대역과 같은 10분 주기로 돈다. */
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
  /* 계측 게이트 임베드 — gateFromRaw가 signalQuality를, signalQuality가 kurtosis를 이름으로
     부른다. 압축되면 그 이름들이 바뀌므로 한 스코프에 같이 넣어야 한다(embedSrc가 그 일을 한다). */
  function gateSrc() {
    return embedSrc([kurtosis, signalQuality, gateFromBuckets, gateFromRaw, sensorTick, impactEvidence],
      { gateFromBuckets: gateFromBuckets, gateFromRaw: gateFromRaw, sensorTick: sensorTick, impactEvidence: impactEvidence });
  }
  /* 단위 변환·ISO 대역 평균 임베드 — ISO 존은 속도 규격이라 서버 감시도 가속도·변위 원본을 앱과 같은
     함수로 속도로 바꾼 뒤 잰다. convertDomain→unitScale·fftComplex, bandRmsAveraged→bandRms→
     bandpassSignal→fftComplex로 서로를 부르므로 한 스코프로 묶는다.
     FFT를 두 번 도는 변환이라 goja에서 무겁다 — 호출측(monitor.js)이 TTL로 빈도를 묶는다. */
  function convSrc() {
    return embedSrc([unitScale, fftComplex, convertDomain, bandpassSignal, bandRms, bandRmsAveraged],
      { convertDomain: convertDomain, bandRmsAveraged: bandRmsAveraged });
  }

  /* 판정을 막은 사유 하나 — 심각한 것부터. 화면이 "무엇 때문에 보류인지" 적을 때 쓴다.
     감시가 이미 사유를 알고 있으면(mon) 그걸 우선한다 — 감시는 1초 창, 상세는 분석 창이라
     같은 순간에도 서로 다른 것을 볼 수 있고, 화면에 붙는 문구는 감시가 멈춘 이유여야 한다. */
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

  /* 표시 등급 — 넘어온 축 중 가장 나쁜 것. 무엇이 등급을 올렸는지(src)를 함께 돌려준다.
     ⚠ 호출측은 진폭 세 축(ISO·베이스라인·대역)을 0으로 넘기고 패턴 축만 태운다 — 등급을 켜는 것은
     결함 패턴 하나이고(patternGate) 나머지 셋은 근거로만 표시된다. 최댓값 규칙 자체는 남겨 둔다:
     축을 되살릴 때 합성 규칙을 다시 만들지 않게. */
  function worstGrade(zoneGi, blGi, bandGi, patGi) {
    var g = zoneGi || 0, src = 'iso';
    if ((blGi || 0) > g) { g = blGi; src = 'baseline'; }
    if ((bandGi || 0) > g) { g = bandGi; src = 'band'; }
    if ((patGi || 0) > g) { g = patGi; src = 'pattern'; }
    return { gi: g, src: g > 0 ? src : 'iso' };
  }
  /* 근거 채택 점수 — 판정문이 원인을 **지목**하는 문턱이고, 등급 게이트가 아니다.
     등급은 patternGrade(targetedMatch 배수)가 정한다: 둘을 한 값에 묶으면 검출기가 달라
     감시와 상세가 같은 신호에 다른 등급을 낸다. 원인 이름은 등급이 켜졌을 때만 쓰이므로
     "원인을 지목해 놓고 양호"가 화면에 남지는 않는다. */
  var EVID_ADOPT = 55;
  /* 감시·상세가 공유하는 게이트 규칙 — 결함 패턴이 켜고 ISO가 높이를 정한다.
     베이스라인 축이 이미 쓰는 관용구와 같다(blGi = 켜지면 max(1, isoGi)).
     ISO를 독립 축으로 두면 이 풀에서 단독 오탐 69%가 그대로 등급이 된다(게이트로 바꾸면 4%).
     그리고 머신 클래스를 잘못 잡아도 오탐이 안 흔들린다 — ISO가 경보를 켜지 않으므로. */
  function patternGate(patOn, isoGi) {
    return patOn ? Math.max(1, isoGi || 0) : 0;
  }
  /* 이번 판정 회차의 등급 후보(rg)와 회차 식별자(cyc) — 앱 감시·서버 감시가 이 함수 하나로 정한다(patSrc 임베드).
     결함 패턴을 잴 수 있는 태그(capable: 회전수·기하 있음)인데 이번에 결과가 없으면(첫 측정 전·조회 실패·
     표본 부족) "판정 보류"다 — 직전 등급과 직전 회차를 그대로 넘겨 judgeTick이 전이하지 않게 한다.
     패턴 없음(=양호)으로 읽으면 회차 식별자도 없어 틱마다 새 회차로 세어지고, 몇 초 만에 거짓 복귀가 확정된 뒤
     다음 측정에서 다시 악화 알림이 나간다.
     pat: {on, at} | null · prev: 직전 판정 상태 | null · hG: 높이(ISO 존 등급) → {rg, cyc, miss} */
  function patternRound(pat, capable, prev, hG) {
    if (!pat && capable) {
      return { rg: prev ? (prev.g || 0) : 0, cyc: (prev && prev.cyc != null) ? prev.cyc : null, miss: true };
    }
    return { rg: patternGate(!!(pat && pat.on), hG), cyc: pat ? (pat.at || null) : null, miss: false };
  }
  /* 결함 패턴 축의 채택 판정 — 감시·상세·서버가 **같은 검출기(targetedMatch)**를 쓰고
     창 길이만 다르다. r은 그 격자 배수이고, 임계는 창에 맞춘 짝이다:
     25회전 MON_ADOPT 3.0 · 100회전 TGT_ADOPT 4.0(같은 오탐률 4%에 맞춘 값).
     창이 짧으면 점수 분포가 내려가므로 임계를 같이 낮춰야 두 화면이 같은 답을 낸다.
     ⚠ thr에 기본값을 두지 않는다 — 호출측이 자기 창의 임계를 밝히지 않으면 판정하지 않는다.
     기본값이 있으면 창이 바뀔 때 조용히 틀린 임계로 판정한다.
     상한은 '주의'(patternGate) — 패턴은 "무엇이 상했나"를 말하고 "얼마나 급한가"는 진폭 축이 말한다.
     계측 게이트 중에는 스펙트럼 진폭 자체를 못 믿으므로 이 축을 비운다. */
  function patternGrade(r, gate, thr) {
    return (gate || !(thr > 0) || !(r >= thr)) ? 0 : 1;
  }

  /* 버킷들을 판정 구간 단위로 묶어 구간 RMS 계열을 만든다(베이스라인 학습용) — 학습과 판정의 단위를 맞춘다.
     groupSec개씩 잘라 각 묶음을 windowRms로 합치고, 남는 꼬리(불완전 구간)는 버린다. */
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
  // DETAIL 문자열 → [{k,ko,v,lim,r,soft}] (이벤트 목록·알림 문구 렌더용)
  function bandParse(detail) {
    if (!detail) return [];
    return String(detail).split('·').map(function (s) {
      // 대역 이름에 숫자가 들어간다(vh1~vh4) — [a-z]만 받으면 옥타브 대역이 통째로 안 읽힌다
      var m = /^\s*([a-z][a-z0-9]*)\s*=\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(s);
      if (!m) return null;
      var v = parseFloat(m[2]), lim = parseFloat(m[3]);
      // 잠정 표식은 저장된 이벤트에서도 읽혀야 한다 — 며칠 뒤에 목록을 보는 사람도 근거의 등급을 알아야 한다
      return { k: m[1], ko: BAND_KO[m[1]] || m[1], v: v, lim: lim, r: lim > 0 ? v / lim : 0, soft: /\(잠정\)/.test(s) };
    }).filter(Boolean);
  }
  /* 켑스트럼 프리화이트닝 — 포락선을 뜨기 **전에** 결정론적 성분을 지운다.
     축 관련 성분(1×·2×·편심·정렬불량·기어메시)은 진폭이 커서 베어링 특성주파수를 덮는다.
     실측에서 미검출의 43%가 정확히 그 상황이었다(포락선 지배가 1×·2×·서브동기).
     구현은 표준형 — 스펙트럼의 진폭을 1로 눌러 위상만 남긴다.

     ⚠ **이 파이프라인에서는 손해다. 판정 경로에 쓰지 말 것.**
     실측(공개셋 5종 554케이스, 오탐 1/124 고정): 검출 54% → 29%. 전 부위에서 나빠졌다
     (외륜 68→42% · 내륜 51→26% · 구름체 30→7%).
     이유: 복조 대역이 1 kHz 고역통과라 **축 관련 이산 성분은 이미 걸러져 있다.**
     포락선을 덮는 1×는 저주파 성분이 아니라 고주파 반송파의 **진폭 변조**이고,
     반송파 스펙트럼을 평탄화해도 변조는 그대로 남는다. 반면 공진이 만든 대역 성형은
     화이트닝이 지워 버려 SNR만 잃는다. 문헌의 CPW는 대역통과 전 단계를 전제한다.

     같은 이유로 **포락선의 정수 차수(k×1×) 억제도 실패**했다(54% → 45~48%).
     16볼 베어링의 BPFO가 7.09×처럼 정수에 가까워, 축 계열을 지우면 진짜 근거도 함께 지워진다.

     함수는 남겨 둔다 — 대역통과 없이 원신호를 볼 때나 가변속 조건에서는 유효할 수 있다. */
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

  /* 진단용 복조 대역 — 커토그램이 고른 대역보다 저역 고정이 낫다는 것이 실측 결과다.
     커토그램은 첨도를 최대화하므로 베어링과 무관한 대역에 붙잡힌다: Nyquist 롤오프(잡음)뿐 아니라
     인버터 구동기의 스위칭 대역도 그렇다. 회전수를 900/1500 rpm으로 바꿔 재보면 그 성분은
     차수가 바뀌고 절대 주파수(52.5 Hz)가 그대로였다 — 기계가 아니라는 뜻이다.
     공개셋 5종 554케이스: 커토그램 검출 11% → 저역 고정 28%(정상 오탐 2%→3%, 종류 적중 90%→95%).
     둘 다 보는 하이브리드는 검출이 32%로 조금 오르는 대신 오탐이 6%로 배가 돼 버렸다.
     한계: 검증 풀에 대형 설비가 없다. 베어링 공진이 8~15 kHz에 있는 기계는 이 대역이 놓친다. */
  /* 포락선 산출 방식 — 'rect'(정류 |x|) | 'env'(해석신호 |z|) | 'sq'(제곱 포락선 SES).
     오래 문서엔 '힐베르트'라 적혀 있었는데 구현은 정류였다. 셋을 같은 오탐률(4/124)에 고정해 재보니
     검출 rect 240 / **env 244** / sq 222(427건 중)로 해석 신호가 이겨서 'env'로 왔다.
     정류가 하모닉을 인공적으로 만든다는 통념은 이 데이터에서 성립하지 않았다 — AM 합성 검사에서
     정류는 하모닉을 안 만들고 오히려 제곱 포락선이 만들었다(200Hz/100Hz = 0.15).
     H는 세 방식 모두 4가 최적이라 정류 탓에 부풀려진 값이 아니다. */
  /* 임베드되는 함수 몸통이 쓰는 상수는 이 함수 하나가 들고 있다 — 몸통이 바깥 이름을 참조하면
     TQL 쪽에서 그 이름을 만들어 줄 수 없다. 압축이 변수 이름을 바꾸는데 embedSrc가 되살릴 수
     있는 것은 함수 .name뿐이고, 객체 속성 이름은 압축되지 않는다. 그래서 상수를 함수가
     돌려주는 객체의 속성으로 두고, 이 함수를 fns에 같이 실어 선언과 호출이 같은 이름으로
     압축되게 한다. 값의 정의는 여기 한 곳뿐이고 모듈 상수도 여기서 갈라져 나온다. */
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

  /* 측대역 무리 판독 — "지배 피크 하나"가 원리적으로 놓치는 경우를 메운다.
     결함이 하중대를 드나들면 충격 크기가 변조돼 에너지가 측대역으로 퍼지고 중앙 피크가 서지 않는다:
       내륜   BPFI ± k·1×   (결함이 축과 함께 돈다)
       구름체 BSF  ± k·FTF   (결함이 케이지와 함께 돈다)
       외륜   변조 없음      (결함이 하중대에 고정) ← 그래서 외륜만 단일 피크로 잘 잡혔다
     그래서 중앙 하나가 아니라 빗(comb) 전체의 진폭 평균을 스펙트럼 중앙값 대비로 본다.
     임계 COMB_ADOPT는 정상에서 오탐 3%가 되는 지점이고, 데이터셋 하나씩 빼고 다시 맞춰도
     5.25~6.08 안에 머물러 특정 풀에 붙은 값이 아니다(leave-one-dataset-out).
     실측 효과: 내륜 7%→22%(종류 적중 24/25). **구름체는 여전히 못 잡는다** — 임계를 넘긴 건들이
     BSF가 아니라 BPFO를 고르는 오귀속이라 검출률만 오른 것처럼 보인다. */
  var COMB_ADOPT = 6.0;
  var COMB_M = 3;          // 측대역 차수 ±3 — 더 넓히면 배경까지 긁어 비율이 부풀려진다
  /* 빗 에너지 비 — 각 자리에서 허용오차 안의 최댓값을 집어 평균 내고 스펙트럼 중앙값으로 나눈다.
     퇴화 신호(백색잡음·복조 대역 무성분·양자화·센서정지)의 귀무값이 1.5~2.4로, 임계 6은 2.5~4배 마진이다.
     최댓값 집기 편향(약 1.8배)은 중앙값 정규화가 대체로 흡수한다.
     남은 계통 오차는 **창 길이 의존성**이다 — tol이 분해능을 따라가 창이 길수록 귀무값이 20%가량 오른다.
     샘플레이트·창 길이가 크게 다른 설비에 배포하면 임계가 조금씩 어긋난다(정규화 개선이 남은 과제).
     decoy(엉뚱한 자리에 같은 빗) 정규화는 Δ=1×에서 배경에도 1× 계열이 깔려 신호까지 죽어 쓸 수 없었다. */
  function combRatio(sp, f, delta, med, res) {
    if (!(f > 0) || !(med > 0) || !sp || !sp.freqs.length) return { r: 0, lines: 0, relPct: 0 };
    var top = sp.freqs[sp.freqs.length - 1], sum = 0, n = 0, lines = 0, ctrOff = 0, m, t, tol, best, j;
    for (m = -COMB_M; m <= COMB_M; m++) {
      t = f + m * delta;
      if (t < 2 || t > top) continue;
      // 측대역 간격이 분해능보다 좁으면 이웃끼리 같은 빈을 집는다 — 세지 않는다
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
  /* 표적 우선 대조 — 지배 피크 하나를 후보와 맞춰 보는 대신 **후보 자리를 각각 보러 간다**.
     지배 피크만 보면 포락선을 축 성분(1×·2×)이 차지한 순간 결함주파수를 한 번도 못 본 채 떨어진다.
     실측: 미검출 231건의 43%가 그 경우였다(1× 29%·2× 8%·서브동기 6%).

     세 후보에 **같은 구조의 통계**를 쓴다 — 하모닉 열 × 측대역(변조가 있는 계열만):
       외륜   BPFO   h=1..4, 측대역 없음  (결함이 하중대에 고정 → 변조 없음)
       내륜   BPFI   h=1..4, ±1×          (결함이 축과 함께 하중대를 드나듦)
       구름체 2×BSF  h=1..4, ±FTF         (결함이 케이지와 함께 드나듦)
     ⚠ BPFO = n×FTF 는 **정확한 항등식**이다 — 구름체의 FTF 격자가 n번째 자리마다 BPFO 하모닉과
     겹친다. 구름체가 BPFO로 귀속되는 것은 오귀속이 아니라 기하학적 필연이고, 통계 구조를
     맞춰도 없어지지 않는다(siteUnknown으로 부위를 단정하지 않는 이유가 이것이다).
     구조가 다르면 순위가 물리가 아니라 귀무분포 모양을 재게 된다.

     공개셋 5종 554케이스에서 **이 축 단독**: 검출 30%→52%, 정상 오탐 3/124.
     (docs의 4/124는 지배피크 폴백까지 포함한 전체 파이프라인 값이다 — 같은 양이 아니다.)
     H와 임계는 leave-one-dataset-out으로 확인했다 — **5폴드**(Paderborn 두 속도는 같은 베어링이라
     한 폴드로 합침) 전부 H=4를 고르고 임계가 4.00~4.48에 머문다. 홀드아웃 검출 51%.
     포락선 상한 계수를 4·6·8로 바꿔도 H=4가 계속 최적이라 경계 산물이 아니다.
     H가 튜닝 대상인 것은 통계 설계의 약점이다 — r이 평균이라 약한 고차 자리가 점수를 끌어내린다.
     다만 무정보 자리를 중립으로 만드는 쪽(국소 잡음층 정규화·Stouffer 결합)은 재보니 더 나빴다.
     ⚠ 지수분포 귀무를 가정한 Fisher 결합은 −2ln p = 2·peak/μ라 **비의 평균에 상수배**다 —
     국소 정규화와 순위가 같아지므로 다른 귀무 모형 없이는 시험한 것이 아니다.
     허용오차 1%가 최적이다 — 0.5%로 좁히면 슬립을 못 따라가고, 2~3%로 넓히면 우연 일치가 는다. */
  /* 감시용 결함 패턴 창 — 상세분석은 100회전인데 감시는 25회전을 쓴다.
     서버 타이머(goja)가 앱보다 100~400배 느려서 100회전이면 91태그 한 회차가 756초로
     10분 주기를 넘긴다(126%). 25회전이면 167초(28%)이고, 검출은 66%→59%로 7%p만 준다.
     50회전은 검출이 25회전과 같은데(59%) 비용만 2배라 중간값을 둘 이유가 없다.
     감시는 트리거이고 확정은 상세분석이 100회전으로 한다 — 놓치지만 않으면 짧아도 된다. */
  var MON_REV = 25;
  /* 창이 짧으면 점수 분포가 내려간다 — 임계를 같이 낮추지 않으면 감시가 조용해진다.
     같은 오탐률(4%)에 맞춘 값: 100회전 3.88 · 25회전 3.03. */
  var MON_ADOPT = 3.0;
  var TGT_ADOPT = patConst().ADOPT;   // 소수 둘째 자리는 표본 124건의 분위수 해상도(0.8%p)가 지지하지 않는다
  var TGT_H = patConst().H, TGT_S = patConst().S;
  function gridScore(sp, f, delta, med, res, hMax) {
    if (!(f > 0) || !(med > 0) || !sp || !sp.freqs.length) return { r: 0, lines: 0, relPct: 0 };
    var top = sp.freqs[sp.freqs.length - 1], sum = 0, n = 0, lines = 0, ctrOff = 0, h, m, t, tol, best, j;
    var _C = patConst();
    var _H = hMax > 0 ? hMax : _C.H;   // 실험 하네스가 H를 흔들 수 있게 — 기본은 TGT_H
    for (h = 1; h <= _H; h++) {
      for (m = -_C.S; m <= _C.S; m++) {
        // 측대역은 변조 계열에만, 그리고 간격이 분해능보다 넓을 때만 (좁으면 이웃이 같은 빈을 집는다)
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
    /* 구름체(BSF)가 이겨도 **부위를 단정하지 않는다** — 실측에서 구름체 라벨 적중이 0/9였고,
       반대로 내륜·외륜 7건이 구름체로 잘못 갔다. 검출은 살리고 주장만 내린다.
       물리적으로도 결함 구름체는 레이스를 함께 상하게 하므로 "부위 미상"이 정직하다. */
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
    /* 채택 조건: 비율이 임계 이상 + 실제로 빗일 것(간격이 있고 선이 3개 이상).
       Δ=0인 후보(BPFO)는 일곱 자리가 전부 같은 주파수라 빗이 아니다 — 그쪽은 지배 피크 경로가 담당한다.
       임계 6은 leave-one-dataset-out으로 5.25~6.08에 머물러 특정 풀에 붙은 값이 아니고,
       퇴화 신호(백색잡음·대역 무성분·양자화·센서정지)의 귀무값이 1.5~2.4라 마진이 2.5~4배다. */
    best.adopted = best.r >= COMB_ADOPT && best.delta > 0 && best.lines >= 3;
    return best;
  }

  /* 포락선 스펙트럼 상한 — 500 Hz 고정은 고속 기계의 내륜을 **원리적으로** 배제한다.
     채택이 하모닉 2개를 요구하는데 BPFI가 5.4×fr이면 2차가 10.8×fr이라,
     3000 rpm에서 542 Hz로 이미 500 Hz 밖이다. 그러면 harm은 영원히 1이고 늘 weak으로 떨어진다.
     그래서 후보 주파수에서 역산한다 — 최고 후보의 4배파까지. 베어링 미지정이면 500 Hz. */
  function envMaxFor(bf, fr, fs) {
    var top = bf ? Math.max(bf.BPFI || 0, 2 * (bf.BSF || 0), bf.BPFO || 0) : 0;
    /* 계수 6 — 4로 두면 최고 후보(대개 BPFI)의 5차가 항상 상한 밖이라 H를 올려도
       BPFO에만 검정점이 늘어난다. 그러면 H가 물리가 아니라 이 상한과 교락된다.
       6×로 넓혀 세 후보가 같은 조건에서 경쟁하게 한다(실측: 같은 H=4에서 52%→54%). */
    var want = top > 0 ? 6 * top : Math.max(500, 12 * (fr || 0));
    return Math.min(Math.max(500, want), (fs || 0) > 0 ? fs * 0.4 : want);
  }

  var BEARING_FS_RATIO = 20;
  function bearingFsOk(fs, bf) {
    if (!bf || !(fs > 0)) return true;
    var top = Math.max(bf.BPFO || 0, bf.BPFI || 0, bf.BSF || 0);
    return !(top > 0) || fs >= top * BEARING_FS_RATIO;
  }
  /* res: 포락선 스펙트럼의 빈 간격(Hz). 허용오차는 이보다 좁을 수 없다 —
     FTF는 14.8 Hz대라 ±1%가 0.15 Hz인데 빈 간격이 0.625 Hz면 참값이 어느 빈에도 안 떨어져
     원리적으로 매칭이 불가능하다(실측: 0.45× 하모닉 4개가 잡히는데도 FTF 미검출).
     같은 규칙을 _evidence의 magNear가 이미 쓴다 — max(1.5×분해능, f×상대오차). */
  function bearingMatch(envQ, bf, fr, res, sb) {
    if (!bf) return { known: false, hit: null, weak: null, negatives: [] };
    /* FTF(케이지 통과주파수)는 결함 후보가 아니다 — 케이지는 정상 베어링에서도 항상 돌기 때문에
       0.45×는 상태와 무관하게 관측된다(실측: 정상 채널이 초기부터 0.45× 하모닉 3개를 계속 냈다).
       분해능 하한을 넣어 매칭이 되게 만들면 정상 베어링이 곧바로 베어링 결함으로 잡힌다.
       관측 사실은 cage로 따로 돌려주고, 근거 점수에는 넣지 않는다. */
    /* 구름체 결함은 자전 1회에 내륜·외륜을 각각 한 번씩 때리므로 2×BSF가 지배하는 것이 관례다 —
       CWRU 공식 결함주파수표도 구름체를 4.7135×(=2×BSF)로 적는다. 기본파만 보면 그 경우를 놓친다.
       3배파 이상은 넣지 않는다: 후보를 늘릴수록 우연 일치가 늘어난다(다중비교). */
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
      // 지배 성분이 없어도 측대역 무리는 설 수 있다 — 변조가 심하면 중앙이 배경에 묻힌다
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
    // 같은 계열의 다른 배수가 맞았으면 그 계열은 음성 소견이 아니다(2×BSF가 맞고 기본파가 어긋난 경우)
    negatives = uniq(negatives).filter(function (k2) { return !matched[k2]; });
    /* 지배 피크가 없어도 표적 자리에 하모닉·측대역 격자가 서면 채택한다.
       변조된 결함(내륜·구름체)은 원리적으로 중앙 피크가 안 서고, 포락선을 축 성분이 차지하면
       외륜조차 지배 피크가 아니다. 순서: 단일 피크 매칭이 우선, 없을 때만 격자를 본다
       (같은 근거를 두 번 세지 않는다). */
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

  /* 가속도계 마운팅별 유효 주파수 상한(Hz) — 이 위의 성분은 기계가 아니라 마운팅 공진일 수 있다.
     미상(0)이면 제한하지 않되, 리포트에 "고주파 대역 유효성 미상"으로 남는다. */
  var MOUNT_FMAX = { stud: 10000, adhesive: 5000, magnet: 2000, probe: 1000 };
  function mountFmax(mount) { return MOUNT_FMAX[mount] || 0; }
  /* 커토그램 탐색 상한의 절대 하한 — Nyquist 바로 아래(안티에일리어싱 저지대역)를 늘 고르는 문제.
     이유는 "에너지가 작아서"가 아니다(첨도는 척도 불변이다). 이 구현이 **복소 포락선이 아니라
     실수 대역통과 신호**에 첨도를 걸기 때문이다 — 순수 정현파의 첨도는 1.5라, 이산 성분(공진·하모닉)이
     있는 대역은 첨도가 아래로 끌리고, 톤이 없는 저지대역(임펄스 누설만 생존)은 위로 간다.
     즉 목적함수가 공진 대역에 계통적으로 불리하다. 상한은 증상을 누르는 임시 방편이다.
     실측(CWRU 12 kHz, 결함 18파일): 상한 없으면 전부 5813~6000 Hz를 골라 종류 적중 0/18,
     Nyquist의 80%로 자르면 7/18. 마운팅·에일리어싱 상한과 무관하게 항상 적용해야 한다 —
     마운팅 미지정 태그가 정확히 이 구간에 빠진다. */
  var KG_NYQ_FRAC = 0.8;

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
  /* 대역 첨도의 대상 — 'real'(실수 대역통과) | 'env'(|z|) | 'ck'(복소 SK: E|z|⁴/(E|z|²)²−2).
     'real'은 엄밀히는 Antoni의 SK가 아니다. 다만 셋 다 복조 대역 선택에는 쓰지 않는다 —
     어느 정의로 고쳐도 12~16 kHz대를 골라 검출이 6~7%에 머문다(고정 1~5 kHz는 57%).
     커토그램은 "어느 대역이 충격적인가"를 보여주는 진단 정보로만 쓴다. */
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
        /* 'real'은 음의 주파수를 같이 남겨 실수 신호를 만들고, 나머지는 양의 주파수만 2배 해
           해석 신호를 만든다 — 후자라야 허수부가 힐베르트 변환이 되어 |z|가 진짜 포락선이다. */
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

  // 포락선 스펙트럼: 해석 신호 포락선의 저주파 스펙트럼 — 베어링 충격 반복 주파수 복조.
  // band({loHz,hiHz})를 주면 그 대역만 통과시킨 뒤 복조한다 — 제품은 고정 1~5 kHz를 넘긴다.
  /* 해석 신호(힐베르트)의 포락선. 대역통과와 한 번의 FFT로 같이 처리한다 —
     양의 주파수만 남기고 2배 하면 허수부가 곧 힐베르트 변환이다.
     역FFT는 켤레 트릭으로 하되 **실수부만 취하면 안 된다** — 해석 신호의 스펙트럼은
     에르미트가 아니므로 허수부가 진짜 정보다. */
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

  /* 포락선 스펙트럼. mode:
       'rect' — |x| 전파 정류. 반송파가 0을 지날 때 같이 0으로 떨어져 포락선을 봉우리에서만 스친다.
                요철이 2×반송파에 있어 저역만 취하면 대체로 걸러지지만, 복조 대역이 넓으면
                대역 내 성분끼리의 차주파수가 포락선 대역 안으로 떨어진다.
       'env'  — 해석 신호의 |z| = √(x² + H{x}²). 선형 연산이라 곱 성분을 안 만든다(기본값).
       'sq'   — |z|². 없는 하모닉을 만든다(AM에서 2차/1차 = 0.15) — 쓰지 않는다. */
  function envelopeSpectrum(values, fs, maxHz, band, mode) {
    var n = values.length;
    if (n < 64) return { freqs: [], mags: [], res: 1 };
    var md = mode || patConst().MODE;
    var top = Math.min(maxHz || 500, fs * 0.4);
    if (md !== 'rect') {
      /* 대역이 없으면 전대역 해석 신호로 간다 — 저샘플 태그에서 고정 대역이 성립하지 않을 때 여기다.
         정류로 물러서면 그 태그만 다른 방법으로 재게 되어 판정 경로가 둘로 갈린다. */
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
     한계 = μ + k·σ, μ·σ는 median / 1.4826·MAD로 추정(평균·표준편차는 스파이크 몇 개로 σ가 부풀어 이탈을 덮는다).
     1.4826은 정규 등가 스케일 보정이라 "3σ" 의미·저장 포맷 {mu,sigma,k}·UI 표기가 그대로다. */
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
  /* 이중 수준(정지↔운전) 판정 — "얼마나 많이"(비율)와 "얼마나 위에"(상위군/중앙값 배율)를 함께 본다.
     비율만으로는 충격성 정상 신호와 구분되지 않는다. */
  var BL_BIMODAL_FRAC = 0.1;   // 중앙값의 3배 위 표본 비율
  var BL_BIMODAL_RATIO = 10;   // 상위군 중앙값 / 전체 중앙값
  function steadyStateFilter(vals) {
    var n = vals.length;
    if (!n) return { vals: [], idle: 0, ramp: 0, ref: 0, bimodalFrac: 0 };
    // 이중 수준 감지는 "필터 전" 원본에서 — 정지가 대부분이면 P75 참조가 정지 수준에 붙어 아래 필터가 무력화된다.
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
    toBucket: toBucket, sevMetrics: sevMetrics, kurtosis: kurtosis, fmt: fmt, timeIndics: timeIndics,
    fftComplex: fftComplex, bandKurtosis: bandKurtosis, amplitudeSpectrum: amplitudeSpectrum, envelopeSpectrum: envelopeSpectrum, analyticEnvelope: analyticEnvelope, ENV_MODE: ENV_MODE, SK_MODE: SK_MODE,
    MON_REV: MON_REV, MON_ADOPT: MON_ADOPT, patternGate: patternGate, patternRound: patternRound, patSrc: patSrc,
    bandpassSignal: bandpassSignal, kurtogram: kurtogram,
    MOUNT_FMAX: MOUNT_FMAX, mountFmax: mountFmax, KG_NYQ_FRAC: KG_NYQ_FRAC, beltFreqs: beltFreqs,
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
