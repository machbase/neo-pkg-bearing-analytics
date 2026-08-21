// 4축을 OR로 묶었을 때의 오탐 — 지금까지 공개한 3%는 **베어링 축 하나**의 값이다.
// worstGrade는 최댓값이라 축이 늘면 등급은 올라가기만 한다: 합집합 오탐은 반드시 더 높다.
// "숫자가 없다"가 아니라 **나빠지는 방향이 확정된 미측정**이라, 재기 전에는 알림을 켜면 안 된다.
//
// 축별로 무엇을 재는가:
//   ISO   — 10~1000 Hz 대역제한 속도 vs 클래스 존 (학습 불필요)
//   패턴  — 결함주파수 격자 채택 (학습 불필요)
//   베이스라인 — 그 태그 정상 표본의 μ+kσ를 넘는가 (학습 필요 → 정상 케이스로 자가학습)
//   대역  — 대역별 정상 한계 배수 (학습 필요 → 같은 방식)
// 학습 두 축은 **같은 데이터셋의 다른 정상 케이스**로 학습해 leave-one-out으로 판정한다.
import fs from 'node:fs';
import path from 'node:path';
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Band = (await import('../../cgi-bin/monitor/band.js')).default;
const ROOT = process.argv[2] || process.env.VIBE_DATASETS || 'D:/vibe-datasets/conv';
const REV = 100, HARD_CAP = 262144;
if (!fs.existsSync(ROOT)) { console.log(`데이터 없음 (${ROOT}) — 건너뜀`); process.exit(0); }
const readF64 = (p, n) => {
  const buf = fs.readFileSync(p); const k = Math.min(n, buf.byteLength / 8);
  const out = new Array(k); for (let i = 0; i < k; i++) out[i] = buf.readDoubleLE(i * 8); return out;
};

const DATASETS = fs.readdirSync(ROOT).filter((d) => !/_seq$/.test(d) && fs.existsSync(path.join(ROOT, d, 'index.json')));
const rows = [];
for (const ds of DATASETS) {
  const dir = path.join(ROOT, ds);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const name of Object.keys(meta.cases)) {
    const c = meta.cases[name];
    if (!c.geo || !c.rpm || !c.fs) continue;
    const fp = path.join(dir, name + '.f64');
    if (!fs.existsSync(fp)) continue;
    const need = Math.round(c.fs * REV / (c.rpm / 60));
    const v = readF64(fp, Math.min(HARD_CAP, fs.statSync(fp).size / 8, Math.max(16384, need)));
    if (v.length < 4096) continue;
    const fr = c.rpm / 60, bf = VC.bearingFreqs(c.rpm, c.geo), nyq = c.fs / 2;

    // ── 패턴 축
    const band = VC.demodFixed(c.fs);
    let pat = 0;
    if (band) {
      const env = VC.envelopeSpectrum(v, c.fs, VC.envMaxFor(bf, fr, c.fs), band);
      const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
      pat = t ? t.r || 0 : 0;
    }
    // ── ISO 축 (검증셋 단위는 g — 속도로 변환해 대역제한)
    const vel = c.unit === 'mm/s' ? v : VC.convertDomain(v, c.fs, 'g', 'mm/s', fr);
    const iso = VC.bandRmsAveraged(vel, c.fs, 10, 1000, 8).rms;
    // ── 베이스라인 축 재료 (광대역 AC RMS)
    let m = 0; for (let i = 0; i < v.length; i++) m += v[i]; m /= v.length;
    let ss = 0; for (let i = 0; i < v.length; i++) { const d = v[i] - m; ss += d * d; }
    const ac = Math.sqrt(ss / v.length);
    // ── 대역 축 재료 (대역별 RMS)
    const bands = Band.bandsFor(fr, nyq).map((b) => [Math.min(b[0], nyq), Math.min(b[1], nyq)]);
    const br = VC.bandRmsMulti(vel, c.fs, bands);
    rows.push({ ds, label: c.label, pat, iso, ac, br });
  }
  console.log(`  ${ds} 완료`);
}
console.log('');

const G = ['양호', '주의', '위험', '심각'];
/* ISO 머신 클래스는 설비 크기가 정한다. 검증 풀은 전부 소형 시험대라 Class I이 원칙인데,
   실제 정상 시험대가 Class I 존 A(0.71 mm/s)를 상시 넘는 채널이 있어 민감도를 함께 잰다.
   현장에서 클래스를 잘못 잡으면 그대로 재현되는 실패라 숫자를 남긴다. */
const CLASSES = { I: [0.71, 1.8, 4.5], II: [1.12, 2.8, 7.1], III: [1.8, 4.5, 11.2] };
const K = 3;                                  // 베이스라인 kσ (제품 기본)
const BAND_MULT = 2.0;                        // 대역 한계 배수 (제품 기본과 같은 자리)

/* 학습 두 축은 **같은 데이터셋의 다른 정상 케이스**로 학습한다(leave-one-out).
   자기 자신을 학습에 넣으면 자기 기준을 자기가 만들어 오탐이 구조적으로 0이 된다. */
const byDs = {};
for (const r of rows) { (byDs[r.ds] = byDs[r.ds] || []).push(r); }

for (const [CLS, ZL] of Object.entries(CLASSES)) {
const axes = { iso: 0, pat: 0, bl: 0, band: 0 };
const pair = {}, uni = { n: 0, hit: 0 };
let healthyN = 0;
const detAx = { iso: 0, pat: 0, bl: 0, band: 0 }, detUni = { n: 0, hit: 0 };

for (const r of rows) {
  const peers = byDs[r.ds].filter((x) => x.label === 'none' && x !== r);
  const on = {};
  on.iso = VC.gradeFor(r.iso, ZL) > 0;
  on.pat = r.pat >= VC.TGT_ADOPT;
  if (peers.length >= 4) {
    const a = peers.map((x) => x.ac);
    const mu = a.reduce((s, x) => s + x, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - mu) * (x - mu), 0) / a.length);
    on.bl = r.ac > mu + K * sd;
    on.band = r.br.some((val, i) => {
      const p = peers.map((x) => x.br[i]).filter((x) => x > 0);
      if (p.length < 4) return false;
      const pm = p.reduce((s, x) => s + x, 0) / p.length;
      return pm > 0 && val > pm * BAND_MULT;
    });
  } else { on.bl = false; on.band = false; }

  const anyOn = on.iso || on.pat || on.bl || on.band;
  if (r.label === 'none') {
    healthyN++;
    for (const k of Object.keys(axes)) if (on[k]) axes[k]++;
    uni.n++; if (anyOn) uni.hit++;
    for (const a of ['iso', 'pat', 'bl', 'band']) for (const b of ['iso', 'pat', 'bl', 'band']) {
      if (a >= b) continue; const key = a + '+' + b;
      pair[key] = pair[key] || 0; if (on[a] || on[b]) pair[key]++;
    }
  } else {
    for (const k of Object.keys(detAx)) if (on[k]) detAx[k]++;
    detUni.n++; if (anyOn) detUni.hit++;
  }
}

const pct = (a, b) => `${a}/${b} (${Math.round(a / b * 100)}%)`;
console.log(`정상 ${healthyN}건 · 결함 ${detUni.n}건 · 학습 두 축은 같은 데이터셋의 다른 정상 케이스로 학습(leave-one-out)\n`);
console.log('축                단독 오탐        단독 검출');
const LBL = { iso: 'ISO 존', pat: '결함 패턴', bl: '베이스라인', band: '대역' };
for (const k of ['iso', 'pat', 'bl', 'band']) {
  console.log(LBL[k].padEnd(16) + pct(axes[k], healthyN).padEnd(17) + pct(detAx[k], detUni.n));
}
console.log('');
console.log('두 축 OR 조합       오탐');
for (const k of Object.keys(pair).sort((a, b) => pair[a] - pair[b])) {
  const [a, b] = k.split('+');
  console.log((LBL[a] + '+' + LBL[b]).padEnd(20) + pct(pair[k], healthyN));
}
console.log('');
console.log('─────────────────────────────────────');
/* 조합별 — 감시(3축)와 상세분석(4축)이 다른 축 구성을 쓴다. 어느 조합이 어떤 값을 내는지 나란히 본다. */
const COMBOS = [
  ['감시 현행 (ISO+베이스라인+대역)', ['iso', 'bl', 'band']],
  ['상세 (옛 4축 OR)', ['iso', 'pat', 'bl', 'band']],
  ['ISO 빼기 (패턴+베이스라인+대역)', ['pat', 'bl', 'band']],
  ['패턴+베이스라인', ['pat', 'bl']],
  ['상세 현행 — 패턴 게이트', ['pat']],
];
/* 감시 전용 — 감시에는 결함 패턴 축이 없다(서버 TQL이 포락선을 안 돌린다).
   대신 베이스라인·대역이 **기계별 학습값**이라 ISO와 성격이 다르다: "규격 대비"가 아니라 "평소 대비"다.
   그래서 감시의 게이트 후보는 학습 두 축이고, ISO는 상세분석과 같이 높이만 정하면 된다. */
const MON = [
  ['감시 현행 (ISO OR 베이스라인 OR 대역)', ['iso', 'bl', 'band']],
  ['베이스라인 게이트만', ['bl']],
  ['베이스라인 OR 대역 게이트', ['bl', 'band']],
  ['+ 패턴까지 (서버 부하 감수)', ['bl', 'band', 'pat']],
];
/* 2단계 — 감시는 실시간이라 태그마다 포락선을 상시 돌릴 수 없다.
   싼 축(베이스라인·대역)이 상시 훑고, **걸린 것만** 포락선을 한 번 돌려 확인한다.
   포락선 비용이 경보 후보 수에 비례하므로 상시 부하는 지금과 같다. */
/* 세 축(ISO·베이스라인·대역)을 "종합 상태"로 묶는 방법 — OR 말고도 여러 가지다.
   OR은 축이 늘수록 오탐이 더해지므로, 합의를 요구하거나 역할을 나누는 쪽을 같이 잰다. */
const COMP = [
  ['OR  (하나라도 켜지면)', null, 'or'],
  ['2 of 3 (둘 이상 합의)', null, 'maj'],
  ['AND (셋 다 켜져야)', null, 'and'],
  ['(베이스라인 OR 대역) 게이트 + ISO 높이', null, 'gate'],
  ['ISO OR (베이스라인 AND 대역)', null, 'isoOrBoth'],
];
const TWO = [
  ['1단계: 베이스라인', ['bl'], null],
  ['1단계: 베이스라인 OR 대역', ['bl', 'band'], null],
  ['2단계: 베이스라인 → 패턴 확인', ['bl'], 'pat'],
  ['2단계: (베이스라인 OR 대역) → 패턴 확인', ['bl', 'band'], 'pat'],
];
console.log('조합                              오탐              검출');
const ALL = COMBOS.concat([['', null]]).concat(MON).concat([['', null]]).concat(TWO).concat([['', null]]).concat(COMP);
for (const [ko, ks, confirm] of ALL) {
  if (!ks && !confirm) { console.log('  ──────────────────────────────'); continue; }
  let fp = 0, det = 0;
  for (const r of rows) {
    const peers2 = byDs[r.ds].filter((x) => x.label === 'none' && x !== r);
    const o = {};
    o.iso = VC.gradeFor(r.iso, ZL) > 0;
    o.pat = r.pat >= VC.TGT_ADOPT;
    if (peers2.length >= 4) {
      const a2 = peers2.map((x) => x.ac);
      const mu2 = a2.reduce((s2, x) => s2 + x, 0) / a2.length;
      const sd2 = Math.sqrt(a2.reduce((s2, x) => s2 + (x - mu2) * (x - mu2), 0) / a2.length);
      o.bl = r.ac > mu2 + K * sd2;
      o.band = r.br.some((val, i) => {
        const pp = peers2.map((x) => x.br[i]).filter((x) => x > 0);
        if (pp.length < 4) return false;
        const pm = pp.reduce((s2, x) => s2 + x, 0) / pp.length;
        return pm > 0 && val > pm * BAND_MULT;
      });
    } else { o.bl = false; o.band = false; }
    let on;
    if (!ks) {   // 세 축 종합 규칙
      const c = (o.iso ? 1 : 0) + (o.bl ? 1 : 0) + (o.band ? 1 : 0);
      on = confirm === 'or' ? c > 0
        : confirm === 'maj' ? c >= 2
        : confirm === 'and' ? c === 3
        : confirm === 'gate' ? (o.bl || o.band)          // ISO는 높이만 — 켜지 못함
        : confirm === 'isoOrBoth' ? (o.iso || (o.bl && o.band))
        : false;
    } else {
      /* confirm이 있으면 1단계가 켠 것만 2단계로 확인한다 — 둘 다 맞아야 경보다. */
      on = ks.some((k) => o[k]) && (!confirm || o[confirm]);
    }
    if (r.label === 'none') { if (on) fp++; } else if (on) det++;
  }
  console.log(ko.padEnd(34) + pct(fp, healthyN).padEnd(18) + pct(det, detUni.n));
}
console.log('');
console.log('4축 합집합 오탐   ' + pct(uni.hit, uni.n));
console.log('4축 합집합 검출   ' + pct(detUni.hit, detUni.n));
console.log('(참고) 베어링 축만 오탐 ' + pct(axes.pat, healthyN) + ' · 검출 ' + pct(detAx.pat, detUni.n));
}
