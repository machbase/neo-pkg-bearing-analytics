// 측대역 무리 판독과 복조 대역 고정(합성 신호) — 오프라인(Neo 불필요) · npm run smoke 포함
// · 계산 의도만 확인, 실데이터 성적은 tools/verify-datasets.mjs 담당
import { mulberry32 } from './_rnd.mjs';
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const FS = 25600, RPM = 1500, FR = RPM / 60, N = 65536;
const GEO = { n: 9, Bd: 0.3126, Pd: 1.537, phi: 0 };
const BF = VC.bearingFreqs(RPM, GEO);

const rnd = mulberry32(987654321);

/** 반복 충격을 공진(3 kHz)에 실음, modHz>0이면 그 주파수로 진폭 변조(변조 = 측대역) */
function impacts(rateHz, modHz, depth, noise) {
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    const ph = (t * rateHz) % 1;
    const ring = ph < 0.05 ? Math.exp(-ph * 400) * Math.sin(2 * Math.PI * 3000 * t) : 0;
    const m = modHz > 0 ? (1 + depth * Math.sin(2 * Math.PI * modHz * t)) : 1;
    out[i] = m * ring + (noise || 0) * rnd();
  }
  return out;
}
const envOf = (v) => VC.envelopeSpectrum(v, FS, VC.envMaxFor(BF, FR, FS), VC.demodFixed(FS));
const tgtOf = (v) => { const e = envOf(v); return VC.targetedMatch(e, BF, FR, e.resTrue || e.res); };

// ── 1. 복조 대역 고정 ──────────────────────────────────────────────────────
{
  const b = VC.demodFixed(25600);
  chk(!!b && b.loHz === 1000 && b.hiHz === 5000, '충분한 샘플링에서 고정 대역 1~5 kHz', JSON.stringify(b));
  // 5 kHz 상단이 Nyquist에 닿으면 고정 대역 불성립(null → 전대역 복조)
  chk(VC.demodFixed(8000) === null, '저샘플링(8 kHz)에서는 고정 대역이 성립하지 않아 null');
  chk(VC.demodFixed(12000) !== null, 'CWRU급 12 kHz는 성립(Nyquist 6 kHz > 5 kHz)');
}

// ── 2. 변조된 내륜 — 지배 피크 없어도 측대역 빗 성립 ─────────────────
{
  const v = impacts(BF.BPFI, FR, 0.95, 0.02);
  const env = envOf(v);
  const res = env.resTrue || env.res;
  const sb = VC.sidebandMatch(env, BF, FR, res);
  chk(sb && sb.key === 'BPFI', '1× 변조된 BPFI 충격 → 빗이 BPFI를 고른다', sb && `${sb.key} r=${sb.r.toFixed(1)}`);
  chk(sb && sb.adopted, '채택된다 — 지배 피크가 서지 않아도 빗으로 잡는다', sb && `r=${sb.r.toFixed(1)} 선 ${sb.lines}개`);
}

// ── 3. 정상 신호는 미채택 ─────────────────────────────────────
{
  // 결함 충격 없는 회전 성분 + 잡음 — 판별자는 정상 신호에서 먼저 검증
  const v = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    v[i] = 0.5 * Math.sin(2 * Math.PI * FR * t) + 0.2 * Math.sin(2 * Math.PI * 2 * FR * t) + 0.3 * rnd();
  }
  const env = envOf(v);
  const sb = VC.sidebandMatch(env, BF, FR, env.resTrue || env.res);
  /* falsification — 결함 없으면 미채택
     ⚠ 난수 생성기가 진짜 잡음일 때만 유효(주기가 짧은 LCG는 하모닉 숲을 만들어 오발) — _rnd.mjs 참조 */
  chk(sb && !sb.adopted, '결함 충격이 없으면 채택되지 않는다', sb && `r=${sb.r.toFixed(2)} < ${VC.COMB_ADOPT}`);
}

// ── 4. 채택 순서 — 단일 피크가 먼저, 빗은 그것이 없을 때만 ────────────────
{
  // 변조 없는 외륜: 지배 피크가 서므로 via 없음(같은 근거 이중 계산 방지)
  const v = impacts(BF.BPFO, 0, 0, 0.02);
  const env = envOf(v);
  const res = env.resTrue || env.res;
  const envQ = VC.envelopeQuant(env.freqs, env.mags, FR);
  const sb = VC.sidebandMatch(env, BF, FR, res);
  const bm = VC.bearingMatch(envQ, BF, FR, res, sb);
  chk(!bm.hit || !bm.hit.via, 'Δ=0인 외륜은 빗이 아니라 지배 피크 경로가 담당한다', bm.hit ? (bm.hit.via || '(dominant)') : '(미검출)');
  chk(!!bm.sideband, '빗 결과 자체는 계산되어 근거로 실린다');
}
{
  const v = impacts(BF.BPFI, FR, 0.95, 0.02);
  const env = envOf(v);
  const res = env.resTrue || env.res;
  const envQ = VC.envelopeQuant(env.freqs, env.mags, FR);
  const sb = VC.sidebandMatch(env, BF, FR, res);
  const bm = VC.bearingMatch(envQ, BF, FR, res, sb);
  chk(bm.hit && bm.hit.key === 'BPFI', '변조된 내륜이 채택된다', bm.hit && `${bm.hit.key} via=${bm.hit.via || 'dominant'}`);
  chk(bm.sideband && bm.sideband.r > 0, 'bearingMatch가 빗 결과를 그대로 실어 보낸다(리포트 근거용)');
}

// ── 5. 여러 시드에서 falsification 유지 (한 시드는 우연 가능) ──────
{
  let worst = 0, worstSeed = 0;
  for (const sd of [1, 42, 2026, 987654321, 20260815]) {
    const g = mulberry32(sd);
    const v = new Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / FS;
      v[i] = 0.5 * Math.sin(2 * Math.PI * FR * t) + 0.2 * Math.sin(2 * Math.PI * 2 * FR * t) + 0.3 * g();
    }
    const env = envOf(v);
    const sb = VC.sidebandMatch(env, BF, FR, env.resTrue || env.res);
    if (sb && sb.r > worst) { worst = sb.r; worstSeed = sd; }
  }
  chk(worst < VC.COMB_ADOPT, '시드 5개 전부에서 정상 신호가 임계를 못 넘는다', `최악 r=${worst.toFixed(2)} (seed ${worstSeed})`);
}

// ── 6. 측대역 간격이 분해능보다 좁으면 제외 ────────────────────────
{
  const env = envOf(impacts(BF.BPFI, FR, 0.95, 0.02));
  const sorted = env.mags.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  // 분해능이 간격보다 크면 이웃 선이 같은 빈을 집음 — 중앙만 셈
  const wide = VC.combRatio(env, BF.BPFI, FR, med, FR);          // res = Δ → 측대역 제외
  const fine = VC.combRatio(env, BF.BPFI, FR, med, env.resTrue || env.res);
  chk(fine.lines > wide.lines, '분해능이 충분해야 측대역까지 센다 — 좁으면 중앙만 남는다', `${fine.lines} > ${wide.lines}`);
}

// ── 7. 베어링 미지정이면 판정 없음 ─────────────────────────────
{
  chk(VC.sidebandMatch(envOf(impacts(120, 0, 0, 0.02)), null, FR, 1) === null, '기하가 없으면 빗 판정 자체가 없다');
  const bm = VC.bearingMatch({ f0: 100, order: 4, harm: 3 }, null, FR, 1, { adopted: true, key: 'BPFI', freq: 1, lines: 5, r: 99, relPct: 0, ord: 1 });
  chk(bm.known === false && !bm.hit, '품번 미지정이면 빗이 아무리 세도 채택하지 않는다');
}

// ── 8. 표적 우선 대조 — 지배 피크가 축 성분이어도 결함 자리 확인 ─────────
{
  /* 포락선을 1×가 지배하게 한 뒤 BPFO 충격 혼합 — 지배 피크 방식은 f0=1×로 대조 실패, 표적 방식은 BPFO 자리 직접 확인 */
  const g = mulberry32(7);
  const v = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    const ph = (t * BF.BPFO) % 1;
    const ring = ph < 0.05 ? Math.exp(-ph * 400) * Math.sin(2 * Math.PI * 3000 * t) : 0;
    /* 저주파 정현파는 복조 대역(1~5 kHz)에서 걸러짐 → 대역 안 반송파를 1×로 진폭변조해 포락선에 1× 실음 */
    const am = 0.4 * (1 + 0.9 * Math.sin(2 * Math.PI * FR * t)) * Math.sin(2 * Math.PI * 3500 * t);
    v[i] = ring + am + 0.02 * g();
  }
  const env = envOf(v);
  const q = VC.envelopeQuant(env.freqs, env.mags, FR);
  const tg = VC.targetedMatch(env, BF, FR, env.resTrue || env.res);
  chk(Math.abs(q.order - 1) < 0.15, '지배 피크가 1×에 잡혀 있다 — 표적 방식이 필요한 상황', `지배 ${q.order.toFixed(2)}×`);
  chk(tg && tg.key === 'BPFO' && tg.adopted, '표적 방식은 그래도 BPFO를 찾아낸다', tg && `${tg.key} r=${tg.r.toFixed(1)}`);
}

// ── 9. 구름체는 부위 단정 안 함 ────────────────────────────────────
{
  const tg = { key: 'BSF', freq: 100, ord: 2, r: 9, lines: 5, relPct: 0, adopted: true, siteUnknown: true };
  const bm = VC.bearingMatch({ f0: 0 }, BF, FR, 1, tg);
  chk(bm.hit && bm.hit.siteUnknown, 'BSF 채택 시 부위 미상 표식이 붙는다 — 검출은 살리고 주장만 내린다');
  const tg2 = { key: 'BPFO', freq: 100, ord: 1, r: 9, lines: 5, relPct: 0, adopted: true, siteUnknown: false };
  chk(!VC.bearingMatch({ f0: 0 }, BF, FR, 1, tg2).hit.siteUnknown, '외륜은 부위를 단정한다');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
