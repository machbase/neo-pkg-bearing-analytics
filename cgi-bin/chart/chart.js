// chart/chart.js — 캔버스 차트 렌더러 + 숫자/시간 포맷터 + 팔레트
// 렌더 전용(데이터 생성 없음) · 그리기 함수만 DOM(canvas) 의존 — 포맷·시간대 함수는 node에서도 동작
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeChart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 등급 색(양호·주의·위험·심각) — 화면 공용, 리포트 팔레트(--k-ok·warn·risk·crit)와 같은 값 ----------------
     · 테마별 두 벌 — 다크는 어두운 바탕용 고채도, 라이트는 흰 바탕 대비용 저명도
     · STATUS는 setGradeTheme이 제자리 교체(참조 보관한 쪽도 같은 값) */
  var GRADE_TONES = {
    dark: [['#71e071', 'rgba(113,224,113,0.14)'], ['#ffd23f', 'rgba(255,210,63,0.14)'], ['#ff8c1a', 'rgba(255,140,26,0.14)'], ['#ff4060', 'rgba(255,64,96,0.14)']],
    light: [['#2a8f3a', 'rgba(42,143,58,0.12)'], ['#b58900', 'rgba(181,137,0,0.12)'], ['#d44a00', 'rgba(212,74,0,0.12)'], ['#9f1239', 'rgba(159,18,57,0.12)']],
  };
  var STATUS = [
    { key: 'Good', ko: '양호' }, { key: 'Warning', ko: '주의' },
    { key: 'Danger', ko: '위험' }, { key: 'Critical', ko: '심각' }
  ];
  function setGradeTheme(light) {
    var t = GRADE_TONES[light ? 'light' : 'dark'];
    for (var i = 0; i < STATUS.length; i++) { STATUS[i].color = t[i][0]; STATUS[i].soft = t[i][1]; }
  }
  setGradeTheme(false);


  /* ---------------- number/time format ---------------- */
  function fmt(v) {
    if (v == null || isNaN(v)) return '–';
    var a = Math.abs(v);
    if (a >= 10000) return (v / 1000).toFixed(1) + 'K';
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }
  function z2(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------------- 표시 시간대 ----------------
     · 계산·조회는 전부 에포크 ms, 표시·날짜 경계(하루 시작·달력)만 이 시간대로 변환
     · ''이면 브라우저 시간 */
  var _tz = '', _tzFmt = {};
  var WD_IDX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function zoneOk(z) { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (e) { return false; } }
  function setZone(z) { _tz = (z && zoneOk(z)) ? String(z) : ''; }
  function getZone() { return _tz; }
  // 실제 적용 중인 IANA 이름(브라우저 시간이면 브라우저가 알려 주는 이름)
  function zoneName() {
    if (_tz) return _tz;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }
  // ms → 그 시간대 달력 값 {Y, M(1~12), D, h, m, s, ms, wd(0=일)}
  function parts(ms) {
    var d = new Date(ms);
    if (!_tz) return { Y: d.getFullYear(), M: d.getMonth() + 1, D: d.getDate(), h: d.getHours(), m: d.getMinutes(), s: d.getSeconds(), ms: d.getMilliseconds(), wd: d.getDay() };
    var f = _tzFmt[_tz] || (_tzFmt[_tz] = new Intl.DateTimeFormat('en-US', { timeZone: _tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }));
    var o = {};
    f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return { Y: +o.year, M: +o.month, D: +o.day, h: (+o.hour) % 24, m: +o.minute, s: +o.second, ms: d.getMilliseconds(), wd: WD_IDX[o.weekday] };
  }
  // 그 순간의 UTC 오프셋(ms, 동쪽 +)
  function offsetMs(ms) {
    if (!_tz) return -new Date(ms).getTimezoneOffset() * 60000;
    var p = parts(ms), base = Math.floor(ms / 1000) * 1000;
    return Date.UTC(p.Y, p.M - 1, p.D, p.h, p.m, p.s) - base;
  }
  // 그 시간대 달력 값 → ms(월 1~12, 범위 밖 값은 Date처럼 이월). DST 경계는 오프셋 두 번 계산으로 보정
  function makeTime(Y, M, D, h, m, s, msec) {
    if (!_tz) return new Date(Y, M - 1, D, h || 0, m || 0, s || 0, msec || 0).getTime();
    var guess = Date.UTC(Y, M - 1, D, h || 0, m || 0, s || 0, msec || 0);
    var t = guess - offsetMs(guess);
    return guess - offsetMs(t);
  }
  // 'YYYY-MM-DD[ T]HH:MM[:SS[.mmm]]' → ms(그 시간대 기준), 형식이 아니면 NaN
  function parseDT(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/.exec(String(s || ''));
    if (!m) return NaN;
    return makeTime(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[7] ? +(m[7] + '00').slice(0, 3) : 0);
  }
  function startOfDay(ms) { var p = parts(ms); return makeTime(p.Y, p.M, p.D, 0, 0, 0, 0); }
  // 'UTC+09:00' 형식
  function offsetLabel(ms) {
    var o = Math.round(offsetMs(ms == null ? Date.now() : ms) / 60000), a = Math.abs(o);
    return 'UTC' + (o < 0 ? '-' : '+') + z2(Math.floor(a / 60)) + ':' + z2(a % 60);
  }

  function fmtClock(ms) { var p = parts(ms); return z2(p.h) + ':' + z2(p.m); }
  function fmtMD(ms) { var p = parts(ms); return p.M + '/' + p.D; }
  function fmtDT(ms) { var p = parts(ms); return p.Y + '-' + z2(p.M) + '-' + z2(p.D) + ' ' + z2(p.h) + ':' + z2(p.m); }
  function fmtFull(ms) { var p = parts(ms); return fmtDT(ms) + ':' + z2(p.s) + '.' + String(p.ms).padStart(3, '0'); }
  // 시간축 눈금 — 구간 길이에 맞춘 단위
  function fmtTick(ms, span) {
    var p = parts(ms);
    if (span < 20 * 60000) return z2(p.h) + ':' + z2(p.m) + ':' + z2(p.s);
    if (span < 86400000) return z2(p.h) + ':' + z2(p.m);
    if (span < 3 * 86400000) return p.M + '/' + p.D + ' ' + z2(p.h) + ':' + z2(p.m);
    return p.M + '/' + p.D;
  }
  function ago(ms, now) {
    var s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 3) return '방금'; if (s < 60) return s + '초 전';
    if (s < 3600) return Math.round(s / 60) + '분 전';
    if (s < 86400) return Math.round(s / 3600) + '시간 전';
    return Math.round(s / 86400) + '일 전';
  }

  /* 스파크라인 — 최소~최대를 높이에 꽉 채움. 변동이 수준 대비 무시할 만하면 평평하게(죽은 센서 잡음 확대 방지)
     기준 0.2% = 계측 게이트 플랫라인 판정과 같은 값 */
  function sparkPath(vals, w, h, pad) {
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var peak = Math.max(Math.abs(mn), Math.abs(mx));
    if ((mx - mn) <= (peak > 0 ? 0.002 * peak : 0)) mx = mn;   // 전부 같은 값으로 취급 → 가운데 평평한 선
    var r = (mx - mn) || 1;
    var n = vals.length, step = (w - pad * 2) / (n - 1);
    var pts = vals.map(function (v, i) { return (pad + step * i).toFixed(1) + ',' + (pad + (h - pad * 2) * (1 - (v - mn) / r)).toFixed(1); });
    var line = pts.join(' ');
    var area = 'M' + pts[0] + ' L' + pts.join(' L') + ' L' + (pad + step * (n - 1)).toFixed(1) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';
    return { line: line, area: area };
  }

  /* ================= CHART ENGINE (canvas) ================= */
  var FONT = "Pretendard, -apple-system, sans-serif";
  var MONO = "D2Coding, monospace";
  var SERIES = { wave: '#4199ff', rms: '#2fb7a6', p2p: '#8b7ff0', crest: '#e0913a', fft: '#e5646a', fc: '#fdb532' };

  function setup(canvas, cssH) {
    if (!canvas) return null;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.parentElement.getBoundingClientRect().width || canvas.parentElement.clientWidth || 600;
    var h = cssH;
    canvas.width = Math.max(2, w * dpr); canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; }
  function movAvg(vals, w) { var out = new Array(vals.length), s = 0, q = []; for (var i = 0; i < vals.length; i++) { q.push(vals[i]); s += vals[i]; if (q.length > w) s -= q.shift(); out[i] = s / q.length; } return out; }

  function drawLine(canvas, o, CC) {
    var c = setup(canvas, o.height); if (!c) return; var ctx = c.ctx, W = c.w, H = c.h;
    var pad = { t: 14, r: o.padR != null ? o.padR : 16, b: 34, l: 58 };
    var cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var vals = o.values, n = vals.length; ctx.clearRect(0, 0, W, H);
    if (n < 2) { ctx.fillStyle = CC.hint; ctx.font = '13px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('데이터 없음', W / 2, H / 2); return; }
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (o.refLines) o.refLines.forEach(function (r) { mx = Math.max(mx, r.val); });
    var m = (mx - mn) * 0.12 || 1; mn = o.zeroBase ? 0 : mn - m; mx += m; var range = mx - mn || 1, step = cw / (n - 1);
    // 시간축(선택): times + xFrom/xTo 있으면 실제 시각 위치(데이터 없는 구간은 빈 채로), 없으면 등간격(인덱스)
    var tAxis = !!(o.times && o.times.length === n && o.xTo > o.xFrom);
    var X = tAxis
      ? function (i) { return pad.l + cw * (o.times[i] - o.xFrom) / (o.xTo - o.xFrom); }
      : function (i) { return pad.l + step * i; };
    ctx.strokeStyle = CC.grid; ctx.lineWidth = 1; ctx.fillStyle = CC.axis; ctx.font = '10px ' + MONO; ctx.textAlign = 'right';
    for (var i = 0; i <= 5; i++) { var y = pad.t + ch - ch * i / 5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText(fmt(mn + range * i / 5), pad.l - 8, y + 3); }
    if (o.refLines) o.refLines.forEach(function (r) { var ry = pad.t + ch - (r.val - mn) / range * ch; if (ry > pad.t && ry < pad.t + ch) { ctx.strokeStyle = r.color; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(pad.l, ry); ctx.lineTo(W - pad.r, ry); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = r.color; ctx.font = '9px ' + FONT; ctx.textAlign = 'right'; ctx.fillText(r.label, W - pad.r - 2, ry - 3); } });
    var dense = o.smooth && n > 240, smW = Math.max(5, Math.round(n / 90));
    var sv = dense ? movAvg(vals, smW) : vals;
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t - 1, cw, ch + 2); ctx.clip();
    if (dense) {
      var loA = new Array(n), hiA = new Array(n);
      for (var ii = 0; ii < n; ii++) { var s0 = Math.max(0, ii - smW), e0 = Math.min(n - 1, ii + smW), lm = Infinity, hm = -Infinity; for (var jj = s0; jj <= e0; jj++) { if (vals[jj] < lm) lm = vals[jj]; if (vals[jj] > hm) hm = vals[jj]; } loA[ii] = lm; hiA[ii] = hm; }
      ctx.beginPath();
      for (var hb = 0; hb < n; hb++) { var hx = X(hb), hy = pad.t + ch - (hiA[hb] - mn) / range * ch; if (hb === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy); }
      for (var lb = n - 1; lb >= 0; lb--) { ctx.lineTo(X(lb), pad.t + ch - (loA[lb] - mn) / range * ch); }
      ctx.closePath(); ctx.fillStyle = o.color + '22'; ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(X(0), pad.t + ch);
      for (var a = 0; a < n; a++) ctx.lineTo(X(a), pad.t + ch - (vals[a] - mn) / range * ch);
      ctx.lineTo(X(n - 1), pad.t + ch); ctx.closePath();
      var g = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch); g.addColorStop(0, o.color + '38'); g.addColorStop(1, o.color + '04'); ctx.fillStyle = g; ctx.fill();
    }
    ctx.beginPath(); for (var b = 0; b < n; b++) { var x = X(b), yy = pad.t + ch - (sv[b] - mn) / range * ch; if (b === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    ctx.strokeStyle = o.color; ctx.lineWidth = o.lw || 1.8; ctx.stroke();
    ctx.restore();
    // x labels
    ctx.fillStyle = CC.axis; ctx.font = '9px ' + MONO;
    if (tAxis) {
      // 시간축: xFrom~xTo 균등 분할 눈금에 라벨(데이터가 몰려도 안 겹침)
      var span = o.xTo - o.xFrom, TICKS = Math.max(2, Math.min(6, Math.floor(cw / 96)));
      var tf = function (ms) { return fmtTick(ms, span); };
      for (var k = 0; k <= TICKS; k++) {
        var lt = tf(o.xFrom + span * (k / TICKS));
        if (k === 0) { ctx.textAlign = 'left'; ctx.fillText(lt, pad.l, H - pad.b + 16); }
        else if (k === TICKS) { ctx.textAlign = 'right'; ctx.fillText(lt, W - pad.r, H - pad.b + 16); }
        else { ctx.textAlign = 'center'; ctx.fillText(lt, pad.l + cw * (k / TICKS), H - pad.b + 16); }
      }
    } else {
      ctx.textAlign = 'center';
      var ls = Math.max(1, Math.floor(n / 7)), last = '', rEdge = W - pad.r;
      for (var q = 0; q < n; q += ls) {
        if (o.xLabels[q] === last) continue;
        var lx = X(q), ltl = o.xLabels[q], hw = ctx.measureText(ltl).width / 2;
        if (lx - hw < pad.l) { ctx.textAlign = 'left'; ctx.fillText(ltl, pad.l, H - pad.b + 16); }
        else if (lx + hw > rEdge) { ctx.textAlign = 'right'; ctx.fillText(ltl, rEdge, H - pad.b + 16); }
        else { ctx.textAlign = 'center'; ctx.fillText(ltl, lx, H - pad.b + 16); }
        last = ltl;
      }
    }
    ctx.strokeStyle = CC.axisLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ch); ctx.lineTo(W - pad.r, pad.t + ch); ctx.stroke();
    var pts = vals.map(function (v, i) { var dv = sv[i]; return { x: X(i), y: pad.t + ch - (dv - mn) / range * ch, label: '<b>' + (o.tipLabels ? o.tipLabels[i] : o.xLabels[i]) + '</b><br>' + fmt(dv) + (o.unit ? ' ' + o.unit : '') }; });
    return { pts: pts, geom: { pad: pad, cw: cw, ch: ch, mn: mn, range: range, W: W, H: H, step: step } };
  }

  function drawBar(canvas, o, CC) {
    var c = setup(canvas, o.height); if (!c) return; var ctx = c.ctx, W = c.w, H = c.h;
    var pad = { t: 12, r: 16, b: 34, l: 58 }, cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var n = o.values.length; ctx.clearRect(0, 0, W, H); if (!n) return;
    var mx = niceMax(Math.max.apply(null, o.values) * 1.1), bw = Math.max(1.5, cw / n - 2);
    ctx.strokeStyle = CC.grid; ctx.fillStyle = CC.axis; ctx.font = '10px ' + MONO; ctx.textAlign = 'right';
    for (var i = 0; i <= 4; i++) { var y = pad.t + ch - ch * i / 4; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText(fmt(mx * i / 4), pad.l - 8, y + 3); }
    var pts = [];
    o.values.forEach(function (v, i) { var x = pad.l + cw / n * i, bh = v / mx * ch, y = pad.t + ch - bh; var g = ctx.createLinearGradient(0, y, 0, pad.t + ch); g.addColorStop(0, o.color); g.addColorStop(1, o.color + '55'); ctx.fillStyle = g; ctx.fillRect(x, y, bw, bh); pts.push({ x: x + bw / 2, y: y, label: '<b>' + (o.tipLabels ? o.tipLabels[i] : o.xLabels[i]) + '</b><br>' + fmt(v) + (o.unit ? ' ' + o.unit : '') }); });
    ctx.fillStyle = CC.axis; ctx.font = '9px ' + MONO; ctx.textAlign = 'center';
    var ls = Math.max(1, Math.floor(n / 7)), last = '';
    for (var q = 0; q < n; q += ls) { if (o.xLabels[q] !== last) { ctx.fillText(o.xLabels[q], pad.l + cw / n * q + bw / 2, H - pad.b + 16); last = o.xLabels[q]; } }
    ctx.strokeStyle = CC.axisLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ch); ctx.lineTo(W - pad.r, pad.t + ch); ctx.stroke();
    return { pts: pts };
  }

  /* 다중 시리즈 라인 (대역 에너지 추이 등) */
  function drawMultiLine(canvas, o, CC) {
    var c = setup(canvas, o.height); if (!c) return; var ctx = c.ctx, W = c.w, H = c.h;
    var pad = { t: 14, r: 16, b: 34, l: 58 }, cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var n = o.xLabels.length; ctx.clearRect(0, 0, W, H); if (n < 2) return;
    var mn = Infinity, mx = -Infinity;
    o.series.forEach(function (s) { for (var i2 = 0; i2 < s.vals.length; i2++) { if (s.vals[i2] < mn) mn = s.vals[i2]; if (s.vals[i2] > mx) mx = s.vals[i2]; } });
    /* 그릴 값 없음(범례로 계열 전부 끔·미학습 계열 필터) — 기준선 있으면 0 축, 없으면 중단(눈금 -Infinity 방지) */
    if (!isFinite(mn) || !isFinite(mx)) { if (!o.refLines) return; mn = 0; mx = 0; }
    // 기준선도 축 범위에 포함(계열이 모두 기준선 아래여도 기준선 표시)
    if (o.refLines) o.refLines.forEach(function (r) { mx = Math.max(mx, r.val); });
    var m = (mx - mn) * 0.12 || 1; mn = 0; mx += m; var range = mx - mn || 1, step = cw / (n - 1);
    // 시간축(선택) — drawLine과 동일 규칙: times+xFrom/xTo가 오면 실제 시각 위치, 없으면 등간격
    var tAxis = !!(o.times && o.times.length === n && o.xTo > o.xFrom);
    var X = tAxis
      ? function (i) { return pad.l + cw * (o.times[i] - o.xFrom) / (o.xTo - o.xFrom); }
      : function (i) { return pad.l + step * i; };
    ctx.strokeStyle = CC.grid; ctx.lineWidth = 1; ctx.fillStyle = CC.axis; ctx.font = '10px ' + MONO; ctx.textAlign = 'right';
    for (var i = 0; i <= 5; i++) { var y = pad.t + ch - ch * i / 5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText(fmt(mn + range * i / 5), pad.l - 8, y + 3); }
    if (o.refLines) o.refLines.forEach(function (r) {
      var ry = pad.t + ch - (r.val - mn) / range * ch;
      if (ry <= pad.t || ry >= pad.t + ch) return;
      ctx.strokeStyle = r.color; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, ry); ctx.lineTo(W - pad.r, ry); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = r.color; ctx.font = '9px ' + FONT; ctx.textAlign = 'right';
      ctx.fillText(r.label, W - pad.r - 2, ry - 3);
    });
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t - 1, cw, ch + 2); ctx.clip();
    var mDense = n > 240, mW = Math.max(5, Math.round(n / 90));
    o.series.forEach(function (s) {
      var vv = mDense ? movAvg(s.vals, mW) : s.vals;
      ctx.beginPath();
      for (var b = 0; b < n; b++) { var x = X(b), yy = pad.t + ch - (vv[b] - mn) / range * ch; if (b === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.6; ctx.setLineDash(s.dash || []); ctx.stroke(); ctx.setLineDash([]);
    });
    ctx.restore();
    ctx.fillStyle = CC.axis; ctx.font = '9px ' + MONO;
    if (tAxis) {
      // 시간축: xFrom~xTo 균등 분할 눈금 (데이터가 몰려도 안 겹침) — drawLine과 동일
      var span = o.xTo - o.xFrom, TICKS = Math.max(2, Math.min(6, Math.floor(cw / 96)));
      var tf = function (ms) { return fmtTick(ms, span); };
      for (var k = 0; k <= TICKS; k++) {
        var lt = tf(o.xFrom + span * (k / TICKS));
        if (k === 0) { ctx.textAlign = 'left'; ctx.fillText(lt, pad.l, H - pad.b + 16); }
        else if (k === TICKS) { ctx.textAlign = 'right'; ctx.fillText(lt, W - pad.r, H - pad.b + 16); }
        else { ctx.textAlign = 'center'; ctx.fillText(lt, pad.l + cw * (k / TICKS), H - pad.b + 16); }
      }
    } else {
      ctx.textAlign = 'center';
      var ls = Math.max(1, Math.floor(n / 7)), last = '', rEdge = W - pad.r;
      for (var q = 0; q < n; q += ls) {
        if (o.xLabels[q] === last) continue;
        var lx = X(q), ltl = o.xLabels[q], hw = ctx.measureText(ltl).width / 2;
        if (lx - hw < pad.l) { ctx.textAlign = 'left'; ctx.fillText(ltl, pad.l, H - pad.b + 16); }
        else if (lx + hw > rEdge) { ctx.textAlign = 'right'; ctx.fillText(ltl, rEdge, H - pad.b + 16); }
        else { ctx.textAlign = 'center'; ctx.fillText(ltl, lx, H - pad.b + 16); }
        last = ltl;
      }
    }
    ctx.strokeStyle = CC.axisLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ch); ctx.lineTo(W - pad.r, pad.t + ch); ctx.stroke();
  }

  function drawHeat(canvas, o, CC) {
    var c = setup(canvas, o.height); if (!c) return; var ctx = c.ctx, W = c.w, H = c.h;
    var pad = { t: 8, r: 10, b: 22, l: 46 }, cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    ctx.clearRect(0, 0, W, H);
    var rows = o.rows, cols = o.cols, cellW = cw / cols, cellH = ch / rows, max = 0;
    for (var t = 0; t < rows; t++) for (var q = 0; q < cols; q++) if (o.grid[t][q] > max) max = o.grid[t][q];
    for (var t2 = 0; t2 < rows; t2++) for (var c2 = 0; c2 < cols; c2++) { var v = o.grid[t2][c2] / (max || 1); ctx.fillStyle = heatColor(v); ctx.fillRect(pad.l + c2 * cellW, pad.t + (rows - 1 - t2) * cellH, cellW + 0.6, cellH + 0.6); }
    ctx.fillStyle = CC.axis; ctx.font = '9px ' + MONO; ctx.textAlign = 'left';
    ctx.fillText('0', pad.l, H - 7); ctx.textAlign = 'right'; ctx.fillText(Math.round(o.fmax) + ' Hz', W - pad.r, H - 7);
    ctx.textAlign = 'right'; ctx.fillStyle = CC.axis; ctx.fillText('now', pad.l - 6, pad.t + 8); ctx.fillText('과거', pad.l - 6, pad.t + ch - 1);
    return { geom: { pad: pad, cw: cw, ch: ch, W: W, H: H } };
  }
  function heatColor(v) {
    var stops = [[26, 28, 36], [0, 55, 110], [0, 140, 190], [250, 190, 60], [235, 75, 60]];
    var x = v * (stops.length - 1), i = Math.max(0, Math.min(stops.length - 2, Math.floor(x))), f = x - i, a = stops[i], b = stops[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  function drawFFT(canvas, o, CC) {
    var r = drawLine(canvas, { values: o.mags, xLabels: o.freqs.map(function (f) { return f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f) + ''; }), tipLabels: o.freqs.map(function (f) { return f.toFixed(1) + ' Hz'; }), color: SERIES.fft, height: o.height, unit: '', zeroBase: true, lw: 1.4, padR: 16 }, CC);
    if (!r || !o.markers) return r;
    var ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* 가로축 = 넘어온 구간 [freqs[0], freqs[끝]](확대 시 0 Hz 아님) — 마커도 같은 비율로 배치해야 해당 빈 위에 섬 */
    var G = r.geom, fmaxIdx = o.freqs.length - 1, maxF = o.freqs[fmaxIdx], minF = o.freqs[0], spanF = maxF - minF;
    var mkSorted = o.markers.slice().sort(function (a, b) { return a.freq - b.freq; }), prevX = -999, off = 0;
    ctx.save(); ctx.beginPath(); ctx.rect(G.pad.l, G.pad.t - 1, G.cw, G.ch + 2); ctx.clip();
    mkSorted.forEach(function (mk) {
      if (mk.freq > maxF || mk.freq < minF) return;
      var x = G.pad.l + (spanF > 0 ? (mk.freq - minF) / spanF : 0) * G.cw;
      if (x - prevX < 16) off = (off + 12) % 36; else off = 0; prevX = x;
      var topY = G.pad.t;
      if (o.hideMarkerLabels) {
        var bi = 0, bd = 1e9;
        for (var ii = 0; ii < o.freqs.length; ii++) { var dd = Math.abs(o.freqs[ii] - mk.freq); if (dd < bd) { bd = dd; bi = ii; } }
        var pv = 0;
        for (var jj = Math.max(0, bi - 2); jj <= Math.min(o.mags.length - 1, bi + 2); jj++) { if (o.mags[jj] > pv) pv = o.mags[jj]; }
        topY = Math.max(G.pad.t, G.pad.t + G.ch - (pv - G.mn) / G.range * G.ch - 14);
      }
      ctx.strokeStyle = mk.kind === 'x' ? CC.axis : (mk.kind === 'f' ? 'rgba(229,100,106,0.6)' : (mk.kind === 'h' ? 'rgba(120,140,170,0.28)' : 'rgba(120,140,170,0.55)'));
      ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, G.pad.t + G.ch); ctx.lineTo(x, topY); ctx.stroke(); ctx.setLineDash([]);
      if (o.hideMarkerLabels) return;
      ctx.save(); ctx.translate(x, G.pad.t + 2 + off); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = mk.kind === 'x' ? CC.axis : (mk.kind === 'f' ? '#e5646a' : (mk.kind === 'h' ? 'rgba(150,165,190,0.5)' : CC.hint));
      ctx.font = (mk.kind === 'f' ? 'bold ' : '') + '9px ' + FONT; ctx.textAlign = 'right'; ctx.fillText(mk.label, -2, 3); ctx.restore();
    });
    ctx.restore();
    return r;
  }

  function drawForecast(canvas, o, CC) {
    var c = setup(canvas, o.height); if (!c) return; var ctx = c.ctx, W = c.w, H = c.h;
    var pad = { t: 16, r: 16, b: 34, l: 58 }, cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var all = o.actual.concat(o.fc); var msMin = all[0].ms, msMax = all[all.length - 1].ms;
    var vmax = 0; o.actual.forEach(function (p) { vmax = Math.max(vmax, p.v); }); o.band.forEach(function (p) { vmax = Math.max(vmax, p.hi); }); vmax = Math.max(vmax, o.threshold) * 1.12;
    var xOf = function (ms) { return pad.l + (ms - msMin) / (msMax - msMin) * cw; }, yOf = function (v) { return pad.t + ch - v / vmax * ch; };
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = CC.grid; ctx.fillStyle = CC.axis; ctx.font = '10px ' + MONO; ctx.textAlign = 'right';
    for (var i = 0; i <= 5; i++) { var y = pad.t + ch - ch * i / 5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText(fmt(vmax * i / 5), pad.l - 8, y + 3); }
    // 신뢰 밴드
    ctx.beginPath(); o.band.forEach(function (p, i) { var x = xOf(p.ms), y = yOf(p.hi); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    for (var b = o.band.length - 1; b >= 0; b--) ctx.lineTo(xOf(o.band[b].ms), yOf(o.band[b].lo));
    ctx.closePath(); ctx.fillStyle = o.color + '22'; ctx.fill();
    // 임계선
    var ty = yOf(o.threshold); ctx.strokeStyle = '#e5484d'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(pad.l, ty); ctx.lineTo(W - pad.r, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#e5484d'; ctx.font = '9px ' + FONT; ctx.textAlign = 'right'; ctx.fillText('Danger ' + fmt(o.threshold) + (o.unit ? ' ' + o.unit : ''), W - pad.r - 2, ty - 3);
    // 실적선
    ctx.beginPath(); o.actual.forEach(function (p, i) { var x = xOf(p.ms), y = yOf(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.strokeStyle = SERIES.rms; ctx.lineWidth = 1.8; ctx.stroke();
    // 예측선(점선)
    ctx.beginPath(); o.fc.forEach(function (p, i) { var x = xOf(p.ms), y = yOf(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.strokeStyle = o.color; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    // 교차 마커
    if (o.crossMs) { var cx = xOf(o.crossMs), cyy = yOf(o.crossV); ctx.fillStyle = '#e5484d'; ctx.beginPath(); ctx.arc(cx, cyy, 4.5, 0, 7); ctx.fill(); ctx.strokeStyle = CC.text; ctx.lineWidth = 1.5; ctx.stroke(); }
    // "now" 구분선
    var nowX = xOf(o.actual[o.actual.length - 1].ms); ctx.strokeStyle = CC.axisLine; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(nowX, pad.t); ctx.lineTo(nowX, pad.t + ch); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = CC.hint; ctx.font = '9px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('현재', nowX, pad.t - 4);
    // x labels
    ctx.fillStyle = CC.axis; ctx.font = '9px ' + MONO; ctx.textAlign = 'center';
    for (var t = 0; t <= 5; t++) { var ms = msMin + (msMax - msMin) * t / 5; ctx.fillText(fmtMD(ms), pad.l + cw * t / 5, H - pad.b + 16); }
    ctx.strokeStyle = CC.axisLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ch); ctx.lineTo(W - pad.r, pad.t + ch); ctx.stroke();
  }

  /* ---- tooltip + crosshair ---- */
  function addTip(canvas, tipEl, crossEl, pts) {
    if (!canvas || !tipEl || !pts) return;
    canvas.onmousemove = function (e) {
      var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, best = null, bd = 1e9;
      pts.forEach(function (p) { var d = Math.abs(p.x - mx); if (d < bd) { bd = d; best = p; } });
      if (best && bd < 60) {
        tipEl.innerHTML = best.label; tipEl.style.display = 'block';
        var tx = best.x + 14; if (tx + 150 > r.width) tx = best.x - 150;
        tipEl.style.left = tx + 'px'; tipEl.style.top = Math.max(2, best.y - 30) + 'px';
        if (crossEl) { crossEl.style.display = 'block'; crossEl.style.left = best.x + 'px'; }
      } else { tipEl.style.display = 'none'; if (crossEl) crossEl.style.display = 'none'; }
    };
    canvas.onmouseleave = function () { tipEl.style.display = 'none'; if (crossEl) crossEl.style.display = 'none'; };
  }

  /* ---- zoom/pan (휠 확대 · 드래그 이동 · 더블클릭 리셋) ----
     확대 구간은 캔버스에 보존 — 같은 데이터(key·길이) 재그리기 시 이어받음(라이브 갱신 중 확대 유지) */
  function zoomRange(canvas, fullLen, key) {
    var p = canvas && canvas._zoom;
    if (p && p.fullLen === fullLen && p.key === key && (p.st.s > 0 || p.st.e < fullLen)) return { s: p.st.s, e: p.st.e };
    return { s: 0, e: fullLen };
  }
  // 그리기 + 확대/이동 부착 — 이어받을 구간 있으면 그 구간으로 그림
  function zoomDraw(canvas, fullLen, drawFn, key) {
    if (!canvas) return;
    var r = zoomRange(canvas, fullLen, key);
    drawFn(r.s, r.e);
    addZoom(canvas, fullLen, drawFn, key);
  }
  function addZoom(canvas, fullLen, drawFn, key) {
    if (!canvas) return;
    var st = zoomRange(canvas, fullLen, key);
    if (canvas._zoom) { var z = canvas._zoom; canvas.removeEventListener('wheel', z.w); canvas.removeEventListener('dblclick', z.d); canvas.removeEventListener('mousedown', z.md); z.mu(); }
    function onWheel(ev) { ev.preventDefault(); var r = canvas.getBoundingClientRect(), mx = ev.clientX - r.left, cw = r.width - 74, n = st.e - st.s, ratio = Math.max(0, Math.min(1, (mx - 58) / cw)), zf = ev.deltaY > 0 ? 1.3 : 0.75, nn = Math.round(n * zf); if (nn < 6) nn = 6; if (nn >= fullLen) { st.s = 0; st.e = fullLen; drawFn(0, fullLen); return; } var center = st.s + Math.round(n * ratio), ns = Math.round(center - nn * ratio); if (ns < 0) ns = 0; var ne = ns + nn; if (ne > fullLen) { ne = fullLen; ns = ne - nn; } st.s = Math.max(0, ns); st.e = ne; drawFn(st.s, st.e); }
    function onDbl() { st.s = 0; st.e = fullLen; drawFn(0, fullLen); }
    var drag = { on: false };
    /* 창(window) 리스너는 끄는 동안만 — 상시 부착하면 캔버스가 사라져도(탭 전환) 창이 붙잡아 차트 데이터와 함께 누적 */
    function onDown(ev) { if (st.e - st.s >= fullLen) return; drag.on = true; drag.x = ev.clientX; drag.s = st.s; drag.e = st.e; canvas.style.cursor = 'grabbing'; window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); }
    function onMove(ev) { if (!drag.on) return; var r = canvas.getBoundingClientRect(), cw = r.width - 74, n = drag.e - drag.s, shift = Math.round(-(ev.clientX - drag.x) / cw * n), ns = drag.s + shift, ne = drag.e + shift; if (ns < 0) { ns = 0; ne = n; } if (ne > fullLen) { ne = fullLen; ns = fullLen - n; } st.s = ns; st.e = ne; drawFn(ns, ne); }
    function onUp() { drag.on = false; canvas.style.cursor = 'crosshair'; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('dblclick', onDbl); canvas.addEventListener('mousedown', onDown);
    canvas._zoom = { fullLen: fullLen, key: key, st: st, w: onWheel, d: onDbl, md: onDown, mm: onMove, mu: onUp };
    canvas.style.cursor = 'crosshair';
  }

  return {
    STATUS: STATUS, SERIES: SERIES, setGradeTheme: setGradeTheme,
    fmt: fmt, fmtClock: fmtClock, fmtMD: fmtMD, fmtDT: fmtDT, fmtFull: fmtFull, ago: ago,
    setZone: setZone, getZone: getZone, zoneName: zoneName, zoneOk: zoneOk, parts: parts, offsetMs: offsetMs, offsetLabel: offsetLabel,
    makeTime: makeTime, parseDT: parseDT, startOfDay: startOfDay, fmtTick: fmtTick,
    sparkPath: sparkPath,
    drawLine: drawLine, drawBar: drawBar, drawMultiLine: drawMultiLine, drawHeat: drawHeat,
    drawFFT: drawFFT, drawForecast: drawForecast, addTip: addTip, addZoom: addZoom, zoomDraw: zoomDraw
  };
});
