/* 스펙트럼 결함주파수 마커 위치 — 확대 구간(freqs[s..e])에서 마커가 선 위 같은 주파수 점과 같은 x에 서는지
   · 구간 밖 마커 미표시, 첫 빈이 0 Hz가 아닌 전체 보기도 확인(흉내 캔버스로 그리기 호출 기록)
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};

// 그리기 호출 기록용 흉내 캔버스 — 마커는 점선([4,3]) 직후 moveTo로 식별
function fakeCanvas() {
  const log = [];
  let dash = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'setLineDash') return (d) => { dash = d; };
      if (k === 'moveTo') return (x, y) => { log.push({ dash: dash.join(','), x, y }); };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const canvas = { style: {}, parentElement: { getBoundingClientRect: () => ({ width: 600 }), clientWidth: 600 }, getContext: () => ctx };
  return { canvas, markers: () => log.filter((e) => e.dash === '4,3').map((e) => e.x) };
}
const CC = { grid: '#333', axis: '#999', axisLine: '#444', hint: '#777', text: '#eee' };
const near = (a, b) => Math.abs(a - b) < 0.01;

// ── 확대 — 500~1000 Hz만 넘어온 경우 ────────────────────────────────────
{
  const all = Array.from({ length: 1001 }, (_, i) => i);          // 0..1000 Hz, 1 Hz 간격
  const s = 500, freqs = all.slice(s), mags = freqs.map((f) => (f === 750 ? 5 : 1));
  const fc = fakeCanvas();
  const r = CH.drawFFT(fc.canvas, { freqs, mags, height: 200, hideMarkerLabels: true,
    markers: [{ freq: 750, label: 'BPFO', kind: 'f' }, { freq: 29, label: '1×', kind: 'x' }, { freq: 1200, label: 'BPFI', kind: 'f' }] }, CC);
  const xs = fc.markers();
  const pt750 = r.pts[750 - s];
  chk(xs.length === 1, '확대 구간 밖의 마커(29 Hz·1200 Hz)는 그리지 않는다', xs.length + '개');
  chk(xs.length && near(xs[0], pt750.x), '750 Hz 마커가 선 위 750 Hz 점과 같은 x에 선다', xs[0] && xs[0].toFixed(1) + ' vs ' + pt750.x.toFixed(1));
  const G = r.geom;
  chk(xs.length && near((xs[0] - G.pad.l) / G.cw, 0.5), '500~1000 Hz에서 750 Hz는 가운데(50%)다 — 0 Hz 기준이면 75%에 선다', ((xs[0] - G.pad.l) / G.cw).toFixed(3));
}
// ── 전체 보기 — 첫 빈이 0이 아닌 경우(Neo FFT)도 빈 위에 표시 ─────────────
{
  const freqs = Array.from({ length: 200 }, (_, i) => 5 * (i + 1)), mags = freqs.map(() => 1);   // 5..1000 Hz
  const fc = fakeCanvas();
  const r = CH.drawFFT(fc.canvas, { freqs, mags, height: 200, hideMarkerLabels: true, markers: [{ freq: 500, label: '2×', kind: 'x' }] }, CC);
  const xs = fc.markers();
  chk(xs.length === 1 && near(xs[0], r.pts[99].x), '전체 보기에서도 마커가 해당 빈(500 Hz) 위에 선다', xs[0] && xs[0].toFixed(1) + ' vs ' + r.pts[99].x.toFixed(1));
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
