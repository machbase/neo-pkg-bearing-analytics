// 측대역 무리 판독과 복조 대역 고정 — 합성 신호로 물리를 못 박는다.
// 실데이터 성적은 tools/verify-datasets.mjs가 재고, 여기는 "계산이 의도대로인가"만 본다.
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

/** 반복 충격을 공진(3 kHz)에 실어 보낸다. modHz>0이면 그 주파수로 진폭 변조 — 변조가 곧 측대역이다 */
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
  // 5 kHz 상단이 Nyquist에 닿으면 그 대역은 성립하지 않는다 — 커토그램으로 되돌아가야 한다
  chk(VC.demodFixed(8000) === null, '저샘플링(8 kHz)에서는 고정 대역이 성립하지 않아 null');
  chk(VC.demodFixed(12000) !== null, 'CWRU급 12 kHz는 성립(Nyquist 6 kHz > 5 kHz)');
}

// ── 2. 변조된 내륜 — 지배 피크는 안 서도 측대역 빗은 선다 ─────────────────
{
  const v = impacts(BF.BPFI, FR, 0.95, 0.02);
  const env = envOf(v);
  const res = env.resTrue || env.res;
  const sb = VC.sidebandMatch(env, BF, FR, res);
  chk(sb && sb.key === 'BPFI', '1× 변조된 BPFI 충격 → 빗이 BPFI를 고른다', sb && `${sb.key} r=${sb.r.toFixed(1)}`);
  chk(sb && sb.adopted, '채택된다 — 지배 피크가 서지 않아도 빗으로 잡는다', sb && `r=${sb.r.toFixed(1)} 선 ${sb.lines}개`);
}

// ── 3. 정상 신호에서는 채택되지 않는다 ─────────────────────────────────────
{
  // 결함 충격이 없는 회전 성분 + 잡음 — 판별자를 제안하기 전에 정상에서 먼저 재는 것이 이 프로젝트 규칙이다
  const v = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    v[i] = 0.5 * Math.sin(2 * Math.PI * FR * t) + 0.2 * Math.sin(2 * Math.PI * 2 * FR * t) + 0.3 * rnd();
  }
  const env = envOf(v);
  const sb = VC.sidebandMatch(env, BF, FR, env.resTrue || env.res);
  /* falsification — 결함이 없으면 안 걸려야 한다.
     ⚠ 이 검사는 난수 생성기가 진짜 잡음일 때만 유효하다. 예전 LCG는 주기가 1만으로 붕괴해
     분석창 안에서 여섯 번 반복되는 주기 신호였고, 그 하모닉 숲 때문에 r이 11까지 올라
     "빗은 잡음에도 걸린다"는 잘못된 결론으로 이 기능이 폐기됐었다. _rnd.mjs 주석 참조. */
  chk(sb && !sb.adopted, '결함 충격이 없으면 채택되지 않는다', sb && `r=${sb.r.toFixed(2)} < ${VC.COMB_ADOPT}`);
}

// ── 4. 채택 순서 — 단일 피크가 먼저, 빗은 그것이 없을 때만 ────────────────
{
  // 변조 없는 외륜: 지배 피크가 서므로 via가 붙지 않아야 한다(같은 근거를 두 번 세면 안 된다)
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

// ── 7. 여러 시드에서 falsification이 버티는가 (한 시드는 우연일 수 있다) ──────
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

// ── 5. 측대역 간격이 분해능보다 좁으면 세지 않는다 ────────────────────────
{
  const env = envOf(impacts(BF.BPFI, FR, 0.95, 0.02));
  const sorted = env.mags.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  // 분해능을 간격보다 크게 주면 이웃 선이 같은 빈을 집는다 — 그때는 중앙만 세야 한다
  const wide = VC.combRatio(env, BF.BPFI, FR, med, FR);          // res = Δ → 측대역 제외
  const fine = VC.combRatio(env, BF.BPFI, FR, med, env.resTrue || env.res);
  chk(fine.lines > wide.lines, '분해능이 충분해야 측대역까지 센다 — 좁으면 중앙만 남는다', `${fine.lines} > ${wide.lines}`);
}

// ── 6. 베어링 미지정이면 아무것도 하지 않는다 ─────────────────────────────
{
  chk(VC.sidebandMatch(envOf(impacts(120, 0, 0, 0.02)), null, FR, 1) === null, '기하가 없으면 빗 판정 자체가 없다');
  const bm = VC.bearingMatch({ f0: 100, order: 4, harm: 3 }, null, FR, 1, { adopted: true, key: 'BPFI', freq: 1, lines: 5, r: 99, relPct: 0, ord: 1 });
  chk(bm.known === false && !bm.hit, '품번 미지정이면 빗이 아무리 세도 채택하지 않는다');
}

// ── 8. 표적 우선 대조 — 지배 피크가 축 성분이어도 결함 자리를 본다 ─────────
{
  /* 1× 성분을 크게 얹어 포락선을 지배하게 만든 뒤 BPFO 충격을 섞는다.
     지배 피크 방식은 f0=1×를 집어 후보 대조에 실패하지만 표적 방식은 BPFO 자리를 직접 본다.
     실측에서 미검출의 43%가 정확히 이 상황이었다(포락선 지배가 1×·2×·서브동기). */
  const g = mulberry32(7);
  const v = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / FS;
    const ph = (t * BF.BPFO) % 1;
    const ring = ph < 0.05 ? Math.exp(-ph * 400) * Math.sin(2 * Math.PI * 3000 * t) : 0;
    /* 1×를 포락선에서 지배하게 만들려면 저주파 정현파를 더하면 안 된다 — 복조 대역(1~5 kHz)이
       그걸 걸러 버린다. 대역 안 반송파를 1×로 진폭변조해야 포락선에 1×가 실린다. */
    const am = 0.4 * (1 + 0.9 * Math.sin(2 * Math.PI * FR * t)) * Math.sin(2 * Math.PI * 3500 * t);
    v[i] = ring + am + 0.02 * g();
  }
  const env = envOf(v);
  const q = VC.envelopeQuant(env.freqs, env.mags, FR);
  const tg = VC.targetedMatch(env, BF, FR, env.resTrue || env.res);
  chk(Math.abs(q.order - 1) < 0.15, '지배 피크가 1×에 잡혀 있다 — 표적 방식이 필요한 상황', `지배 ${q.order.toFixed(2)}×`);
  chk(tg && tg.key === 'BPFO' && tg.adopted, '표적 방식은 그래도 BPFO를 찾아낸다', tg && `${tg.key} r=${tg.r.toFixed(1)}`);
}

// ── 9. 구름체는 부위를 단정하지 않는다 ────────────────────────────────────
{
  const tg = { key: 'BSF', freq: 100, ord: 2, r: 9, lines: 5, relPct: 0, adopted: true, siteUnknown: true };
  const bm = VC.bearingMatch({ f0: 0 }, BF, FR, 1, tg);
  chk(bm.hit && bm.hit.siteUnknown, 'BSF 채택 시 부위 미상 표식이 붙는다 — 검출은 살리고 주장만 내린다');
  const tg2 = { key: 'BPFO', freq: 100, ord: 1, r: 9, lines: 5, relPct: 0, adopted: true, siteUnknown: false };
  chk(!VC.bearingMatch({ f0: 0 }, BF, FR, 1, tg2).hit.siteUnknown, '외륜은 부위를 단정한다');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
