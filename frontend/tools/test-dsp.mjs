// DSP 코어 단위 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.
// 정답을 아는 합성 신호를 넣어 "계산이 물리적으로 맞는가"를 본다.
// 라이브 데이터로는 "그럴듯한 값이 나왔다"까지밖에 확인할 수 없다 — 정현파 100 Hz를 넣으면
// 100 Hz가 나와야 하고, 진폭 2.0이면 스펙트럼 피크도 2.0이어야 한다. 그걸 여기서 못 박는다.
import { mulberry32 } from './_rnd.mjs';
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};
const near = (a, b, tolPct) => Math.abs(a - b) <= Math.abs(b) * (tolPct / 100) + 1e-9;

// ── 신호 생성기 ────────────────────────────────────────────────────────────
const sine = (n, fs, f, amp, phase) => Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / fs + (phase || 0)));
const add = (...arrs) => arrs[0].map((_, i) => arrs.reduce((s, a) => s + a[i], 0));
// 결정론 잡음 — Math.random은 실행마다 결과가 달라져 회귀 판정이 불가능하다
const rnd = mulberry32(12345);
const noise = (n, amp) => Array.from({ length: n }, () => amp * rnd());
const peakOf = (freqs, mags) => { let bi = 0; for (let i = 1; i < mags.length; i++) if (mags[i] > mags[bi]) bi = i; return { f: freqs[bi], m: mags[bi] }; };

const FS = 2048;

// ── 1. amplitudeSpectrum — 주파수와 진폭이 모두 맞아야 한다 ────────────────
{
  const v = sine(FS * 4, FS, 100, 2.0);
  const sp = VC.amplitudeSpectrum(v, FS, 500);
  const p = peakOf(sp.freqs, sp.mags);
  chk(near(p.f, 100, 2), '정현파 100 Hz → 피크 주파수', `${p.f.toFixed(2)} Hz`);
  chk(near(p.m, 2.0, 10), '진폭 2.0 → 피크 진폭(단측 스케일링)', `${p.m.toFixed(3)}`);
  chk(sp.freqs[sp.freqs.length - 1] <= 500 * 1.02, 'maxHz 상한 준수', `최대 ${sp.freqs[sp.freqs.length - 1].toFixed(0)} Hz`);
}

// ── 2. 두 성분 분리 ────────────────────────────────────────────────────────
{
  const v = add(sine(FS * 4, FS, 60, 1.0), sine(FS * 4, FS, 180, 0.5));
  const sp = VC.amplitudeSpectrum(v, FS, 500);
  const at = (f) => { let bi = 0, bd = 1e9; sp.freqs.forEach((x, i) => { const d = Math.abs(x - f); if (d < bd) { bd = d; bi = i; } }); return sp.mags[bi]; };
  chk(near(at(60), 1.0, 12) && near(at(180), 0.5, 12), '두 성분의 진폭비 유지(1.0 : 0.5)',
    `60Hz=${at(60).toFixed(3)} · 180Hz=${at(180).toFixed(3)}`);
}

// ── 3. welchSpectrum — 평균이 잡음을 줄여야 한다 ───────────────────────────
{
  const sig = sine(FS * 8, FS, 100, 1.0);
  const v = add(sig, noise(FS * 8, 1.5));
  const w1 = VC.welchSpectrum(v, FS, 500, 8);     // 블록 8초 = 사실상 1블록
  const w8 = VC.welchSpectrum(v, FS, 500, 1);     // 블록 1초 → 다중 평균
  chk(w8.blocks > w1.blocks, '블록을 줄이면 평균 횟수 증가', `${w1.blocks}회 → ${w8.blocks}회`);
  // 잡음 바닥의 변동(표준편차/평균)이 평균으로 줄어드는지
  const floorVar = (w) => {
    const off = w.freqs.map((f, i) => (Math.abs(f - 100) > 20 ? w.mags[i] : null)).filter((x) => x != null);
    const mu = off.reduce((a, b) => a + b, 0) / off.length;
    return Math.sqrt(off.reduce((a, b) => a + (b - mu) ** 2, 0) / off.length) / mu;
  };
  chk(floorVar(w8) < floorVar(w1), '평균 횟수↑ → 잡음 바닥 변동↓',
    `${floorVar(w1).toFixed(3)} → ${floorVar(w8).toFixed(3)}`);
  chk(near(peakOf(w8.freqs, w8.mags).f, 100, 3), '평균 후에도 신호 주파수 유지');
}

// ── 4. envelopeSpectrum — AM 신호의 변조 주파수를 복조해야 한다 ────────────
// 반송파 500 Hz를 37 Hz로 진폭변조 → 포락선에 37 Hz가 나와야 한다(베어링 결함의 원리).
{
  const n = FS * 4;
  const carrier = sine(n, FS, 500, 1.0);
  const modul = Array.from({ length: n }, (_, i) => 1 + 0.8 * Math.sin(2 * Math.PI * 37 * i / FS));
  const v = carrier.map((x, i) => x * modul[i]);
  const env = VC.envelopeSpectrum(v, FS, 200, null);
  const p = peakOf(env.freqs, env.mags);
  chk(near(p.f, 37, 5), 'AM 500Hz×37Hz → 포락선이 변조 주파수 검출', `${p.f.toFixed(2)} Hz`);
  const q = VC.envelopeQuant(env.freqs, env.mags, 10);
  chk(q && q.f0 > 0 && near(q.f0, 37, 5), 'envelopeQuant가 같은 반복주파수 보고', q && `f0=${q.f0.toFixed(2)} 하모닉 ${q.harm}`);
}

// ── 5. kurtogram — 충격이 실린 대역을 골라야 한다 ──────────────────────────
{
  const n = 8192;
  const base = sine(n, FS, 50, 1.0);
  // 700 Hz 링잉 임펄스를 20 Hz 주기로 — 700 Hz 부근 대역이 선택돼야 한다
  const imp = Array.from({ length: n }, (_, i) => {
    const t = i / FS, dt = t - Math.floor(t * 20) / 20;
    return 3 * Math.exp(-300 * dt) * Math.sin(2 * Math.PI * 700 * dt);
  });
  const kg = VC.kurtogram(add(base, imp), FS);
  chk(!!(kg && kg.best), '커토그램 최적 대역 산출');
  if (kg && kg.best) {
    const c = kg.best.center;
    chk(c > 400 && c < 1000, '충격 링잉(700 Hz)이 실린 대역을 선택', `중심 ${c.toFixed(0)} Hz`);
  }
  // 상한을 걸면 그 아래에서만 고른다
  const kgCap = VC.kurtogram(add(base, imp), FS, 300);
  chk(!kgCap || !kgCap.best || kgCap.best.hiHz <= 300 * 1.05, '상한 지정 시 그 위 대역 미선택',
    kgCap && kgCap.best ? `${kgCap.best.hiHz.toFixed(0)} Hz` : 'null');
}

// ── 6. bandpassSignal · decimate ───────────────────────────────────────────
{
  const v = add(sine(4096, FS, 50, 1.0), sine(4096, FS, 800, 1.0));
  const bp = VC.bandpassSignal(v, FS, 20, 200);
  const sp = VC.amplitudeSpectrum(bp, FS, 1000);
  const at = (f) => { let bi = 0, bd = 1e9; sp.freqs.forEach((x, i) => { const d = Math.abs(x - f); if (d < bd) { bd = d; bi = i; } }); return sp.mags[bi]; };
  chk(at(50) > at(800) * 10, '대역통과: 통과대역 보존 · 저지대역 감쇠',
    `50Hz=${at(50).toFixed(3)} vs 800Hz=${at(800).toFixed(4)}`);

  const d2 = VC.decimate(sine(4096, FS, 100, 1.0), 2);
  chk(Math.abs(d2.length - 2048) <= 1, 'decimate(2) 길이 절반', `${d2.length}`);
  const spD = VC.amplitudeSpectrum(d2, FS / 2, 500);
  chk(near(peakOf(spD.freqs, spD.mags).f, 100, 3), 'decimate 후 주파수 보존', `${peakOf(spD.freqs, spD.mags).f.toFixed(2)} Hz`);
}

// ── 7. bandRms · Parseval — 대역 제곱합 = 전대역 ───────────────────────────
{
  const v = add(sine(FS * 4, FS, 30, 1.0), sine(FS * 4, FS, 300, 0.6), sine(FS * 4, FS, 700, 0.4));
  const tot = VC.bandRms(v, FS, 1, FS / 2 - 1);
  const parts = [VC.bandRms(v, FS, 1, 100), VC.bandRms(v, FS, 100, 500), VC.bandRms(v, FS, 500, FS / 2 - 1)];
  const sumSq = Math.sqrt(parts.reduce((a, b) => a + b * b, 0));
  chk(near(sumSq, tot, 5), 'Parseval: 분할 대역 제곱합 = 전대역 RMS',
    `Σ=${sumSq.toFixed(4)} vs 전체=${tot.toFixed(4)}`);
  // 정현파 진폭 A의 RMS = A/√2
  const one = VC.bandRms(sine(FS * 4, FS, 100, 2.0), FS, 1, FS / 2 - 1);
  chk(near(one, 2.0 / Math.SQRT2, 5), '정현파 RMS = 진폭/√2', `${one.toFixed(4)} (기대 ${(2 / Math.SQRT2).toFixed(4)})`);
}

// ── 8. convertDomain — 적분/미분이 물리적으로 맞아야 한다 ──────────────────
// 가속도 a = A·sin(ωt) → 속도 진폭 = A/ω. 단위 변환(g→mm/s)까지 포함해 검증.
{
  const f = 50, w = 2 * Math.PI * f, A = 1.0;           // 1 g 진폭
  const acc = sine(FS * 4, FS, f, A);
  const vel = VC.convertDomain(acc, FS, 'g', 'mm/s', f);
  const velRms = VC.bandRms(vel, FS, 10, 500);
  const expect = (A * 9806.65 / w) / Math.SQRT2;         // g→mm/s² 후 적분 → RMS
  chk(near(velRms, expect, 12), '가속도→속도 적분(1/ω)이 물리값과 일치',
    `${velRms.toFixed(2)} mm/s (기대 ${expect.toFixed(2)})`);
}

// ── 9. cepstrum — 하모닉 열의 간격을 되찾아야 한다 ─────────────────────────
{
  const f0 = 40, n = FS * 4;
  const v = add(...[1, 2, 3, 4, 5].map((k) => sine(n, FS, f0 * k, 1 / k)));
  const sp = VC.amplitudeSpectrum(v, FS, 500);
  const cep = VC.cepstrumFromSpectrum(sp.mags, sp.res, 100);
  if (cep.freqs.length) {
    const p = peakOf(cep.freqs, cep.mags);          // freqs는 quefrency(ms)
    chk(near(p.f, 1000 / f0, 12), `하모닉 간격 ${f0} Hz → 라모닉 ${(1000 / f0).toFixed(1)} ms`, `${p.f.toFixed(2)} ms`);
  } else chk(false, '켑스트럼 산출');
}

// ── 10. bandKurtosis · kurtosis ────────────────────────────────────────────
{
  const n = 8192;
  const pure = sine(n, FS, 50, 1.0);
  chk(near(VC.kurtosis(pure), 1.5, 20), '정현파 커토시스 = 1.5(이론값)', VC.kurtosis(pure).toFixed(3));
  // 균일분포의 첨도는 1.8이다(3은 정규분포). Box-Muller로 정규잡음을 만들어 3을 확인한다.
  chk(near(VC.kurtosis(noise(n, 1)), 1.8, 15), '균일잡음 커토시스 = 1.8(이론값)', VC.kurtosis(noise(n, 1)).toFixed(3));
  const gauss = Array.from({ length: n }, () => {
    let u = 0, v = 0; while (u === 0) u = (rnd() + 1) / 2; while (v === 0) v = (rnd() + 1) / 2;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  });
  chk(near(VC.kurtosis(gauss), 3.0, 20), '정규잡음 커토시스 ≈ 3', VC.kurtosis(gauss).toFixed(3));
  /* 밴드 커토시스 — 고주파 대역만 남긴 신호의 첨도.
     기준 신호에 약간의 광대역 잡음을 섞는다: 순수 정현파는 컷오프 위 에너지가 0이라
     함수가 null을 반환하는 게 정상이고(비교 대상이 없음), 그러면 대조 자체가 성립하지 않는다. */
  const bkBase = add(pure, noise(n, 0.08));
  const imp = Array.from({ length: n }, (_, i) => {
    const t = i / FS, dt = t - Math.floor(t * 15) / 15;
    return 5 * Math.exp(-400 * dt) * Math.sin(2 * Math.PI * 600 * dt);
  });
  const bkClean = VC.bandKurtosis(bkBase, FS, 300);
  const bkImp = VC.bandKurtosis(add(bkBase, imp), FS, 300);
  chk(bkClean != null && bkImp != null && bkImp > bkClean * 2, '고주파 임펄스 → 밴드 커토시스 급증',
    `${bkClean == null ? 'null' : bkClean.toFixed(2)} → ${bkImp == null ? 'null' : bkImp.toFixed(2)}`);
  chk(VC.bandKurtosis(pure, FS, 300) == null, '컷오프 위 에너지가 없으면 null 반환(계산 거부)');
}

// ── 11. bearingFreqs — 공식대로 계산되는가 ─────────────────────────────────
{
  const b = { n: 9, Bd: 9.5, Pd: 46.0, phi: 0 }, rpm = 1800, fr = rpm / 60;
  const f = VC.bearingFreqs(rpm, b);
  const ratio = b.Bd / b.Pd;
  chk(near(f.BPFO, (b.n / 2) * fr * (1 - ratio), 0.1), 'BPFO = (Z/2)·n·(1−d/D)', f.BPFO.toFixed(2));
  chk(near(f.BPFI, (b.n / 2) * fr * (1 + ratio), 0.1), 'BPFI = (Z/2)·n·(1+d/D)', f.BPFI.toFixed(2));
  chk(near(f.FTF, (fr / 2) * (1 - ratio), 0.1), 'FTF = (n/2)(1−d/D)', f.FTF.toFixed(2));
  chk(f.BPFI > f.BPFO && f.FTF < fr, '대소 관계: BPFI > BPFO · FTF < 1×');
}

// ── 12. measuredOneX — 명판 근처 실측 피크를 찾아야 한다 ───────────────────
{
  const v = add(sine(FS * 4, FS, 29.2, 1.0), sine(FS * 4, FS, 150, 0.3));
  const sp = VC.amplitudeSpectrum(v, FS, 300);
  const m = VC.measuredOneX(sp.freqs, sp.mags, 30, 10);   // 명판 30 Hz ±10%
  chk(m && near(m.f, 29.2, 3), '명판 30 Hz → 실측 29.2 Hz 검출', m ? `${m.f.toFixed(2)} Hz` : 'null');
}

// ── 13. stftGrid — 격자 크기와 시간 진행 ───────────────────────────────────
{
  const n = FS * 4;
  // 전반부 100 Hz, 후반부 300 Hz → 스펙트로그램이 변화를 담아야 한다
  const v = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * (i < n / 2 ? 100 : 300) * i / FS));
  const g = VC.stftGrid(v, FS, 500, 16, 32);
  chk(g.rows === 16 && g.cols === 32, 'STFT 격자 크기 지정대로', `${g.rows}×${g.cols}`);
  chk(Array.isArray(g.grid) && g.grid.length === 16 && g.grid[0].length === 32, 'STFT grid 2차원 배열 형태');
  /* 시간에 따라 주파수가 이동하는 것을 실제로 담는지 — 스펙트로그램의 존재 이유.
     축 배치: grid[행=시간][열=주파수]. 열 c의 주파수 = c/(cols-1) × fmax. */
  const colOf = (hz) => Math.round(hz / g.fmax * (g.cols - 1));
  const rowPeakCol = (r) => { let bi = 0; for (let c = 1; c < g.cols; c++) if (g.grid[r][c] > g.grid[r][bi]) bi = c; return bi; };
  const early = rowPeakCol(1), late = rowPeakCol(g.rows - 2);
  chk(Math.abs(early - colOf(100)) <= 2 && Math.abs(late - colOf(300)) <= 2,
    '전반부 100 Hz → 후반부 300 Hz 이동을 격자가 반영',
    `초반 col ${early}(기대 ${colOf(100)}) · 후반 col ${late}(기대 ${colOf(300)})`);
}

// ── 14. signalQuality 게이트 ───────────────────────────────────────────────
{
  const clean = add(sine(4096, FS, 50, 1.0), noise(4096, 0.05));
  const spiky = clean.slice(); spiky[1000] = 60; spiky[2500] = -55;
  const q1 = VC.signalQuality(clean, FS), q2 = VC.signalQuality(spiky, FS);
  chk(!q1.gate, '정상 신호는 게이트 미발동');
  chk(q2.gate, '단발 스파이크는 게이트 발동');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
