// 목(데모) 데이터 생성기 — 테스트 전용(앱 번들 미포함), 차트는 chart·계산은 calc 모듈 사용
import CH from '../../cgi-bin/chart/chart.js';
import VC from '../../cgi-bin/calc/calc.js';

const { fmt, sparkPath, STATUS } = CH;
const { ISO_ZONES, UNIT_ZONES, zonesFor, gradeFor, bearingFreqs, BEARINGS, faultFreqSummary } = VC;

  /* ---------------- PRNG (deterministic) ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rnd) { return (rnd() + rnd() + rnd() + rnd() - 2) / 2; }

  /* ================= DATA GENERATION ================= */
  var CATALOG = [
    { alias: '1호기 급수펌프', name: 'PUMP.FW01.DE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 1780, cls: 'II', bearing: { model: '6312', n: 8, Bd: 22.2, Pd: 97.0, phi: 0 }, base: 0.9, trend: 0.4, fault: 'imbalance', line: 'A라인' },
    { alias: '2호기 급수펌프', name: 'PUMP.FW02.DE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 1780, cls: 'II', bearing: { model: '6312', n: 8, Bd: 22.2, Pd: 97.0, phi: 0 }, base: 3.1, trend: 2.2, fault: 'bearing-outer', line: 'A라인' },
    { alias: '송풍기 A', name: 'FAN.SA.NDE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 1180, cls: 'III', bearing: { model: '6316', n: 8, Bd: 26.5, Pd: 123, phi: 0 }, base: 1.3, trend: 0.3, fault: 'imbalance', line: 'A라인' },
    { alias: '송풍기 B', name: 'FAN.SB.NDE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 1180, cls: 'III', bearing: { model: '6316', n: 8, Bd: 26.5, Pd: 123, phi: 0 }, base: 4.9, trend: 3.4, fault: 'looseness', line: 'B라인' },
    { alias: '냉각탑 팬', name: 'FAN.CT01.DE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 590, cls: 'III', bearing: { model: '22218', n: 14, Bd: 20.0, Pd: 130, phi: 12 }, base: 1.1, trend: 0.2, fault: 'imbalance', line: '유틸리티' },
    { alias: '1호 압축기', name: 'COMP.C1.DE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 2970, cls: 'II', bearing: { model: '6311', n: 8, Bd: 20.6, Pd: 90.0, phi: 0 }, base: 2.0, trend: 0.8, fault: 'misalign', line: 'A라인' },
    { alias: '2호 압축기', name: 'COMP.C2.DE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 2970, cls: 'II', bearing: { model: '6311', n: 8, Bd: 20.6, Pd: 90.0, phi: 0 }, base: 6.4, trend: 5.1, fault: 'bearing-inner', line: 'B라인' },
    { alias: '컨베이어 모터', name: 'MOTOR.CV03.DE', table: 'MOTOR_CURRENT', unit: 'mm/s', rpm: 1465, cls: 'I', bearing: { model: '6208', n: 9, Bd: 12.7, Pd: 60.0, phi: 0 }, base: 0.7, trend: 0.15, fault: 'imbalance', line: 'B라인' },
    { alias: '분쇄기 주축', name: 'MILL.M1.DE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 990, cls: 'IV', bearing: { model: '23124', n: 17, Bd: 25.0, Pd: 165, phi: 10 }, base: 3.0, trend: 1.1, fault: 'looseness', line: 'C라인' },
    { alias: '원심분리기', name: 'CENT.X2.NDE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 3540, cls: 'II', bearing: { model: '6310', n: 8, Bd: 19.0, Pd: 82.0, phi: 0 }, base: 2.4, trend: 1.6, fault: 'imbalance', line: 'C라인' },
    { alias: '진공펌프', name: 'VPUMP.V1.DE', table: 'SENSOR_DATA', unit: 'mm/s', rpm: 1750, cls: 'I', bearing: { model: '6206', n: 9, Bd: 9.5, Pd: 46.0, phi: 0 }, base: 0.6, trend: 0.1, fault: 'imbalance', line: '유틸리티' },
    { alias: '유압유닛 모터', name: 'HYD.HU2.DE', table: 'SENSOR_DATA', unit: 'g', rpm: 1760, cls: 'II', bearing: { model: '6209', n: 9, Bd: 12.7, Pd: 65.0, phi: 0 }, base: 0.42, trend: 0.35, fault: 'bearing-outer', line: 'B라인' },
    { alias: '터빈 저널베어링', name: 'TURB.T1.JB', table: 'SENSOR_DATA', unit: 'μm', rpm: 3600, cls: 'IV', bearing: { model: 'sleeve', n: 0, Bd: 0, Pd: 0, phi: 0 }, base: 22, trend: 8, fault: 'imbalance', line: '발전' },
    { alias: '감속기 GB-1', name: 'GEAR.GB1.HS', table: 'GEARBOX_VIB', unit: 'g', rpm: 1470, cls: 'III', bearing: { model: '6313', n: 8, Bd: 23.8, Pd: 102, phi: 0 }, base: 0.55, trend: 0.22, fault: 'gear', line: 'C라인' },
    { alias: '발전기 로터 DE', name: 'GEN.G1.DE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 3600, cls: 'IV', bearing: { model: 'sleeve', n: 0, Bd: 0, Pd: 0, phi: 0 }, base: 2.2, trend: 0.6, fault: 'imbalance', line: '발전' },
    { alias: '배기팬', name: 'FAN.EX2.NDE', table: 'SENSOR_DATA', unit: 'mm/s', rpm: 880, cls: 'III', bearing: { model: '6314', n: 8, Bd: 25.0, Pd: 110, phi: 0 }, base: 1.6, trend: 0.5, fault: 'misalign', line: '유틸리티' },
    { alias: '순환수펌프', name: 'PUMP.CW1.DE', table: 'SENSOR_DATA', unit: 'mm/s', rpm: 1180, cls: 'II', bearing: { model: '6315', n: 8, Bd: 25.0, Pd: 115, phi: 0 }, base: 1.0, trend: 0.25, fault: 'imbalance', line: '유틸리티' },
    { alias: '보일러 급수펌프', name: 'PUMP.BF1.DE', table: 'VIBRATION_RAW', unit: 'mm/s', rpm: 2950, cls: 'II', bearing: { model: '6313', n: 8, Bd: 23.8, Pd: 102, phi: 0 }, base: 4.1, trend: 2.8, fault: 'bearing-outer', line: '발전' },
    { alias: '냉동기 컴프', name: 'CHIL.CH1.DE', table: 'SENSOR_DATA', unit: 'mm/s', rpm: 1480, cls: 'II', bearing: { model: '6310', n: 8, Bd: 19.0, Pd: 82.0, phi: 0 }, base: 1.4, trend: 0.35, fault: 'imbalance', line: '유틸리티' },
    { alias: '집진기 팬', name: 'FAN.DC1.NDE', table: 'BEARING_TEMP', unit: 'mm/s', rpm: 1780, cls: 'III', bearing: { model: '6316', n: 8, Bd: 26.5, Pd: 123, phi: 0 }, base: 2.6, trend: 1.9, fault: 'looseness', line: 'C라인' }
  ];

  var ROLLUP_H = 720; // 30일 × 시간별


  function generateData(seed) {
    var rnd = mulberry32(seed || 42);
    var now = Date.now();
    var t0 = now - (ROLLUP_H - 1) * 3600 * 1000;
    var equipment = CATALOG.slice(0, arguments[1] || CATALOG.length).map(function (m, idx) {
      var zones = zonesFor(m.unit, m.cls);
      var rollup = [];
      var rmsArr = [], peakArr = [], crestArr = [];
      // 시계열: base + 완만한 상승추세 + 일주기 + 노이즈, 추세 클수록 후반 급상승
      var accel = m.trend;
      for (var i = 0; i < ROLLUP_H; i++) {
        var frac = i / (ROLLUP_H - 1);
        var trendComp = accel * Math.pow(frac, 1.9);
        var daily = 0.06 * m.base * Math.sin(i / 24 * 2 * Math.PI + idx);
        var noise = gauss(rnd) * 0.05 * (m.base + accel);
        var rms = Math.max(0.02, m.base + trendComp + daily + noise);
        // crest: 충격성 결함이면 후반 상승(3~6)
        var crestBase = (m.fault.indexOf('bearing') === 0 || m.fault === 'gear' || m.fault === 'looseness') ? 2.6 : 1.7;
        var crest = crestBase + (m.fault.indexOf('bearing') === 0 || m.fault === 'gear' ? frac * 3.0 : frac * 0.5) + gauss(rnd) * 0.12;
        crest = Math.max(1.42, crest);
        var peak = rms * crest;
        var p2p = peak * 2 * (0.92 + rnd() * 0.12);
        rollup.push({ ms: t0 + i * 3600 * 1000, rms: rms, p2p: p2p, crest: crest });
        rmsArr.push(rms); peakArr.push(peak); crestArr.push(crest);
      }
      var cur = rollup[ROLLUP_H - 1];
      var grade = gradeFor(cur.rms, zones);
      var stats = {
        count: ROLLUP_H * 3600, // raw 샘플 근사(수신 건수)
        avg: rmsArr.reduce(function (a, b) { return a + b; }, 0) / ROLLUP_H,
        min: Math.min.apply(null, rmsArr),
        max: Math.max.apply(null, rmsArr)
      };
      // 변화율: 최근 24h 대비 이전 24h 평균 배수
      var last24 = rmsArr.slice(-24).reduce(function (a, b) { return a + b; }, 0) / 24;
      var prev24 = rmsArr.slice(-48, -24).reduce(function (a, b) { return a + b; }, 0) / 24;
      var trendRatio = prev24 > 0 ? last24 / prev24 : 1;
      var indicators = {
        avg_rms: { value: stats.avg, thr: zones[1], grade: gradeFor(stats.avg, zones) },
        peak_rms: { value: Math.max.apply(null, peakArr), thr: zones[2], grade: gradeFor(cur.rms, zones) },
        crest: { value: crestArr[ROLLUP_H - 1], thr: 3.0, grade: crestArr[ROLLUP_H - 1] < 3 ? 0 : crestArr[ROLLUP_H - 1] < 6 ? 2 : 3 },
        trend: { value: trendRatio, thr: 2.0, grade: trendRatio < 1.3 ? 0 : trendRatio < 2 ? 1 : 3 }
      };
      var spark = sparkPath(rmsArr.slice(-36), 132, 40, 3);
      return {
        id: 'eq' + (idx + 1), alias: m.alias, name: m.name, unit: m.unit, rpm: m.rpm, cls: m.cls, baseCls: m.cls,
        bearing: m.bearing, fault: m.fault, line: m.line, table: m.table, zones: zones,
        rms: cur.rms, peak: indicators.peak_rms.value, crest: cur.crest, trendRatio: trendRatio,
        grade: grade, lastSeen: now - Math.round(rnd() * 90 + 8) * 1000,
        spark: spark, sparkVals: rmsArr.slice(-36),
        rollup: rollup, stats: stats, indicators: indicators
      };
    });

    // 이벤트 생성 (grade>=1 위주)
    // 실제 앱이 만드는 유형만
    var TYPES = [{ k: 'threshold', ko: '임계 초과' }, { k: 'baseline', ko: '베이스라인 이탈' },
      { k: 'band', ko: '대역 이탈' }, { k: 'recovery', ko: '정상 복귀' }];
    var events = [];
    equipment.forEach(function (eq) {
      var nEv = eq.grade === 0 ? (rnd() < 0.25 ? 1 : 0) : eq.grade + Math.round(rnd() * 2);
      for (var i = 0; i < nEv; i++) {
        var ty = TYPES[Math.floor(rnd() * TYPES.length)];
        var ageH = Math.round(rnd() * 120);
        var g = Math.max(1, Math.min(3, eq.grade - Math.round(rnd())));
        var base = ty.k === 'threshold' ? eq.zones[1] : ty.k === 'baseline' ? eq.stats.avg * 0.8 : 1.0;
        var val = base * (1.1 + rnd() * 0.9);
        events.push({
          id: 'ev' + events.length, ms: now - ageH * 3600 * 1000, tagId: eq.id, tagAlias: eq.alias, tagName: eq.name,
          type: ty.k, typeKo: ty.ko, unit: eq.unit,
          value: val, base: base, grade: g, status: ageH < 26 && rnd() < 0.7 ? 'new' : (rnd() < 0.4 ? 'new' : 'ack')
        });
      }
    });
    events.sort(function (a, b) { return b.ms - a.ms; });

    // 리포트 보관함
    var reports = [
      { id: 'r1', ms: now - 2 * 86400e3, tags: ['2호 압축기', '송풍기 B'], period: '최근 7일', llm: true },
      { id: 'r2', ms: now - 5 * 86400e3, tags: ['A라인 전체 (6)'], period: '최근 30일', llm: true },
      { id: 'r3', ms: now - 9 * 86400e3, tags: ['보일러 급수펌프'], period: '최근 7일', llm: false },
      { id: 'r4', ms: now - 16 * 86400e3, tags: ['2호기 급수펌프', '유압유닛 모터'], period: '2026-06 월간', llm: true }
    ];

    return { equipment: equipment, events: events, reports: reports, now: now, t0: t0 };
  }

  /* ---- 상세: raw 파형 + FFT (선택 태그에서 지연 생성) ---- */
  function buildDetail(eq) {
    var bf = eq.bearing.n ? bearingFreqs(eq.rpm, eq.bearing) : { fr: eq.rpm / 60, x1: eq.rpm / 60, x2: eq.rpm / 30 };
    var fr = bf.fr;
    var sev = eq.grade;
    // 스펙트럼 성분 [freq, amp]
    var comps = [[fr, eq.rms * 0.9], [2 * fr, eq.rms * (eq.fault === 'misalign' ? 0.85 : 0.32)], [3 * fr, eq.rms * 0.14]];
    var markers = [{ freq: fr, label: '1×', kind: 'x' }, { freq: 2 * fr, label: '2×', kind: 'x' }];
    if (eq.bearing.n) {
      if (eq.fault === 'bearing-outer') { comps.push([bf.BPFO, eq.rms * (0.4 + sev * 0.22)], [2 * bf.BPFO, eq.rms * 0.22]); markers.push({ freq: bf.BPFO, label: 'BPFO', kind: 'f' }, { freq: bf.BPFI, label: 'BPFI', kind: 'fq' }, { freq: bf.BSF, label: 'BSF', kind: 'fq' }, { freq: bf.FTF, label: 'FTF', kind: 'fq' }); }
      else if (eq.fault === 'bearing-inner') { comps.push([bf.BPFI, eq.rms * (0.4 + sev * 0.22)], [bf.BPFI + fr, eq.rms * 0.18], [bf.BPFI - fr, eq.rms * 0.18]); markers.push({ freq: bf.BPFO, label: 'BPFO', kind: 'fq' }, { freq: bf.BPFI, label: 'BPFI', kind: 'f' }, { freq: bf.BSF, label: 'BSF', kind: 'fq' }, { freq: bf.FTF, label: 'FTF', kind: 'fq' }); }
      else if (eq.fault === 'gear') { var gmf = fr * 23; comps.push([gmf, eq.rms * (0.5 + sev * 0.2)], [gmf + fr, eq.rms * 0.2], [gmf - fr, eq.rms * 0.2]); markers.push({ freq: gmf, label: 'GMF', kind: 'f' }); }
      else if (eq.fault === 'looseness') { for (var h = 4; h <= 8; h++) comps.push([h * fr, eq.rms * 0.18 * (sev / 3)]); markers.push({ freq: bf.BPFO, label: 'BPFO', kind: 'fq' }, { freq: bf.BPFI, label: 'BPFI', kind: 'fq' }); }
      else if (eq.fault === 'imbalance') { comps[0][1] = eq.rms * 1.2; }
    }
    // raw 파형
    var fs = 2560, N = 1024, dt = 1 / fs, times_ms = [], values = [];
    var rndW = mulberry32(eq.id.length * 7 + eq.rpm);
    var impactEvery = eq.bearing.n && eq.fault.indexOf('bearing') === 0 ? Math.round(fs / (eq.fault === 'bearing-outer' ? bf.BPFO : bf.BPFI)) : 0;
    for (var i = 0; i < N; i++) {
      var t = i * dt, v = 0;
      for (var c = 0; c < comps.length; c++) v += comps[c][1] * Math.sin(2 * Math.PI * comps[c][0] * t + c);
      if (impactEvery && i % impactEvery < 6) v += eq.rms * (1.2 + sev * 0.4) * Math.exp(-(i % impactEvery) * 0.9) * (i % impactEvery === 0 ? 1 : 0.7);
      v += gauss(rndW) * eq.rms * 0.12;
      times_ms.push(i * dt * 1000); values.push(v);
    }
    // FFT 스펙트럼(직접 합성: 성분마다 가우시안 피크 + 노이즈 플로어)
    var maxMk = markers.reduce(function (a, mk2) { return Math.max(a, mk2.freq); }, 0);
    for (var ci = 0; ci < comps.length; ci++) maxMk = Math.max(maxMk, comps[ci][0]);
    var fmax = Math.max(200, Math.min(1000, maxMk * 1.7)), res = Math.max(0.5, fmax / 600), freqs = [], mags = [];
    var floor = eq.rms * 0.05;
    for (var f = 0; f <= fmax; f += res) {
      var mag = floor * (0.6 + rndW() * 0.8);
      for (var c2 = 0; c2 < comps.length; c2++) {
        var d = f - comps[c2][0], w = Math.max(1.2, comps[c2][0] * 0.012);
        mag += comps[c2][1] * Math.exp(-(d * d) / (2 * w * w));
      }
      freqs.push(f); mags.push(mag);
    }
    markers.push({ freq: 3 * fr, label: '3×', kind: 'h' }, { freq: 4 * fr, label: '4×', kind: 'h' }, { freq: 5 * fr, label: '5×', kind: 'h' });
    var fftO = { freqs: freqs, mags: mags, markers: markers, res: res };
    return { raw: { times_ms: times_ms, values: values, fs: fs }, fft: fftO, envelope: envSpectrum(eq, bf, fr, sev), spectro: spectroGrid(eq, fftO), cepstrum: cepstrum(eq, fftO), indics: specIndics(eq, fftO, values) };
  }

  /* 포락선(envelope) 스펙트럼 합성: 베어링 결함 주파수 하모닉(내륜은 ±fr 측대역 추가) */
  function envSpectrum(eq, bf, fr, sev) {
    var ff = 0, flab = '';
    if (eq.bearing.n) { if (eq.fault === 'bearing-outer') { ff = bf.BPFO; flab = 'BPFO'; } else if (eq.fault === 'bearing-inner') { ff = bf.BPFI; flab = 'BPFI'; } }
    var fmax = ff ? Math.min(ff * 3.6, 900) : Math.min(fr * 10, 300);
    var res = Math.max(0.5, fmax / 400), freqs = [], mags = [], rnd = mulberry32(eq.id.length * 13 + eq.rpm + 3), floor = 0.02 + 0.008 * sev, peaks = [];
    if (ff) {
      for (var h = 1; h <= 5; h++) peaks.push([h * ff, (0.85 / h) * (0.45 + sev * 0.2)]);
      if (eq.fault === 'bearing-inner') { for (var s = 1; s <= 3; s++) { peaks.push([s * ff + fr, 0.28 / s]); peaks.push([s * ff - fr, 0.28 / s]); } }
    }
    var markers = ff ? [{ freq: ff, label: flab, kind: 'f' }, { freq: 2 * ff, label: '2×', kind: 'fq' }, { freq: 3 * ff, label: '3×', kind: 'fq' }] : [];
    for (var f = 0; f <= fmax; f += res) {
      var m = floor * (0.6 + rnd() * 0.8);
      for (var p = 0; p < peaks.length; p++) { var d = f - peaks[p][0], w = Math.max(0.8, peaks[p][0] * 0.008); m += peaks[p][1] * Math.exp(-(d * d) / (2 * w * w)); }
      freqs.push(f); mags.push(m);
    }
    return { freqs: freqs, mags: mags, markers: markers, fault: ff ? flab : null, hint: ff ? (flab + ' 하모닉이 포락선에 뚜렷 → ' + (eq.fault === 'bearing-outer' ? '외륜' : '내륜') + ' 결함 특징') : '모델된 구름결함 없음 · 포락선 평태' };
  }

  /* 스펙트로그램(워터폴): 시간(세로) × 주파수(가로) × 강도, 시간·등급 따라 강도 증가 */
  function spectroGrid(eq, fftO) {
    var rows = 22, cols = 52, fmax = fftO.freqs[fftO.freqs.length - 1], grid = [], rnd = mulberry32(eq.id.length * 17 + eq.rpm + 5), sev = eq.grade;
    for (var t = 0; t < rows; t++) {
      var grow = 0.3 + 0.7 * (t / (rows - 1)) * (0.5 + sev * 0.16), row = [];
      for (var c = 0; c < cols; c++) { var f = c / (cols - 1) * fmax, idx = Math.min(fftO.mags.length - 1, Math.round(f / fftO.res)); var v = fftO.mags[idx] * grow + (rnd() - 0.5) * 0.015; row.push(v < 0 ? 0 : v); }
      grid.push(row);
    }
    return { grid: grid, rows: rows, cols: cols, fmax: fmax };
  }

  /* 켑스트럼: 스펙트럼 로그의 역변환, 라모닉(rahmonic) 피크 = 주기적 성분 간격(측대역·하모닉) */
  function cepstrum(eq, fftO) {
    var mags = fftO.mags, res = fftO.res, fr = eq.rpm / 60, logm = new Array(mags.length);
    for (var i = 0; i < mags.length; i++) logm[i] = Math.log(mags[i] + 1e-6);
    var qmax = Math.min(120, 3000 / fr), qn = 180, quef = [], vals = [];
    for (var qi = 1; qi <= qn; qi++) { var qms = qmax * qi / qn, q = qms / 1000, sacc = 0; for (var f = 0; f < logm.length; f++) sacc += logm[f] * Math.cos(2 * Math.PI * (f * res) * q); quef.push(qms); vals.push(Math.abs(sacc) / logm.length); }
    var T = 1000 / fr, markers = [{ freq: T, label: '1/1×', kind: 'f' }];
    if (T * 2 < qmax) markers.push({ freq: T * 2, label: '2/1×', kind: 'fq' });
    return { freqs: quef, mags: vals, markers: markers, note: T.toFixed(1) + 'ms = 회전 1주기 · 라모닉 피크는 주기적 성분 간격을 나타냄' };
  }

  /* 진단 지표: 대역 RMS · 커토시스(시간축, 베어링 충격성) · 고주파 대역비 */
  function specIndics(eq, fftO, wave) {
    var mags = fftO.mags, freqs = fftO.freqs, e = 0, cnt = 0;
    for (var i = 0; i < mags.length; i++) if (freqs[i] >= 10) { e += mags[i] * mags[i]; cnt++; }
    var bandRms = Math.sqrt(e / (cnt || 1));
    var wm = 0; for (var j = 0; j < wave.length; j++) wm += wave[j]; wm /= wave.length;
    var w2 = 0, w4 = 0; for (var k = 0; k < wave.length; k++) { var d = wave[k] - wm; w2 += d * d; w4 += d * d * d * d; } w2 /= wave.length; w4 /= wave.length;
    var kurt = w2 > 0 ? w4 / (w2 * w2) : 0;
    var split = 0.6 * freqs[freqs.length - 1], hi = 0, tot = 0; for (var m = 0; m < mags.length; m++) { var p = mags[m] * mags[m]; tot += p; if (freqs[m] > split) hi += p; }
    var hfr = tot > 0 ? hi / tot : 0;
    return [{ k: '대역 RMS 10–1kHz', v: fmt(bandRms) + ' ' + eq.unit, desc: '표준 진동 대역의 전체 에너지 · 전반적 진동 세기' }, { k: '커토시스 Kurtosis', v: kurt.toFixed(2), hint: kurt > 4 ? '충격성 높음' : '정상범위', desc: '파형의 뾰족함 · 3이면 정상, 클수록 충격성(베어링 결함)' }, { k: '고주파 대역비', v: (hfr * 100).toFixed(1) + '%', desc: '고주파 성분 비중 · 초기 베어링·마찰 결함에 민감' }];
  }

  /* 적응 롤업: 시간별 롤업을 보간해 분별/10분별 세밀 롤업 합성 (결정적) */
  function fineRollup(eq, stepMin, hours) {
    var hourly = eq.rollup, n = hourly.length, out = [];
    var pts = Math.round(hours * 60 / stepMin), lastMs = hourly[n - 1].ms;
    var rnd = mulberry32(eq.id.length * 37 + eq.rpm + stepMin);
    for (var i = pts - 1; i >= 0; i--) {
      var ms = lastMs - i * stepMin * 60000;
      var hIdx = (n - 1) - (lastMs - ms) / 3600000;
      var i0 = Math.max(0, Math.floor(hIdx)), i1 = Math.min(n - 1, i0 + 1), f = hIdx - i0;
      var a = hourly[i0], b = hourly[i1];
      out.push({
        ms: ms,
        rms: Math.max(0.01, (a.rms + (b.rms - a.rms) * f) * (1 + (rnd() - 0.5) * 0.06)),
        p2p: Math.max(0.01, (a.p2p + (b.p2p - a.p2p) * f) * (1 + (rnd() - 0.5) * 0.06)),
        crest: Math.max(1.5, (a.crest + (b.crest - a.crest) * f) * (1 + (rnd() - 0.5) * 0.05))
      });
    }
    return out;
  }

  /* ---- 추이 확장: 첨도(Kurtosis) · 대역 에너지 (rollup 시간축 정렬) ---- */
  function buildTrends(eq, roll) {
    roll = roll || eq.rollup;
    var n = roll.length, rnd = mulberry32(eq.id.length * 29 + eq.rpm + 7), sev = eq.grade;
    var kurt = [], b1 = [], bf = [], bh = [];
    for (var i = 0; i < n; i++) {
      var prog = n > 1 ? i / (n - 1) : 0, r = roll[i];
      kurt.push(3 + Math.max(0, (r.crest - 3.6)) * 1.5 + (rnd() - 0.5) * 0.5);
      b1.push(r.rms * 0.55 * (1 + (rnd() - 0.5) * 0.10));
      bf.push(r.rms * (0.08 + 0.16 * sev * prog) * (1 + (rnd() - 0.5) * 0.18));
      bh.push(r.rms * (0.05 + 0.05 * sev * prog) * (1 + (rnd() - 0.5) * 0.22));
    }
    return { kurt: kurt, bands: [
      { label: '1× 회전 성분', color: '#4199ff', vals: b1 },
      { label: '결함 대역', color: '#e5646a', vals: bf },
      { label: '고주파 대역', color: '#8b7ff0', vals: bh }
    ] };
  }

  /* ---- 진단: 추세 예측(선형 추세 + 신뢰밴드 + 임계 교차) ---- */
  function buildForecast(eq) {
    var hist = eq.rollup.slice(-96); // 최근 96h
    var n = hist.length;
    // 선형회귀 (x=시간 index)
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) { var y = hist[i].rms; sx += i; sy += y; sxx += i * i; sxy += i * y; }
    var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), intc = (sy - slope * sx) / n;
    // 잔차 표준편차
    var ss = 0; for (var j = 0; j < n; j++) { var e = hist[j].rms - (intc + slope * j); ss += e * e; }
    var resStd = Math.sqrt(ss / Math.max(1, n - 2));
    var dtms = 3600 * 1000, lastMs = hist[n - 1].ms;
    var actual = hist.map(function (h) { return { ms: h.ms, v: h.rms }; });
    var H = 168; // 7일 예측
    var fc = [], band = [];
    var thr = eq.zones[2]; // Danger 경계(C/D)
    var crossMs = null, crossV = null;
    for (var k = 0; k <= H; k++) {
      var xi = n - 1 + k, v = intc + slope * xi, ms = lastMs + k * dtms;
      var se = resStd * Math.sqrt(1 + (k / 24)); // 밴드 확장
      fc.push({ ms: ms, v: Math.max(0, v) });
      band.push({ ms: ms, lo: Math.max(0, v - 1.96 * se), hi: v + 1.96 * se });
      if (crossMs == null && v >= thr && slope > 0) { crossMs = ms; crossV = v; }
    }
    var mape = (resStd / (sy / n) * 100);
    return {
      actual: actual, fc: fc, band: band, threshold: thr, crossMs: crossMs, crossV: crossV,
      slope: slope, model: 'Holt 선형추세', mape: mape, unit: eq.unit,
      rising: slope > 0.0005
    };
  }

export default {
  generateData, buildDetail, fineRollup, buildTrends, buildForecast,
};
