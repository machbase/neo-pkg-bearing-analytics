// 실데이터 어댑터 — cgi-bin의 db(DB 연동)·calc(계산)를 UI 모델로 조립하는 얇은 층.
// SQL/HTTP와 수학은 전부 cgi-bin에 있고, 여기는 화면 모델(equipment/det/trend) 조립만 담당한다.
import DB from '../../../cgi-bin/db/db.js';
import VC from '../../../cgi-bin/calc/calc.js';

const TAGS_PER_TABLE = 20;   // 테이블당 태그 상한
const MAX_EQUIPMENT = 40;    // 전체 설비 상한 (쿼리 폭주 방지)
const ROLLUP_BUCKETS = 720;  // 트렌드 목표 버킷 수
const TREND_CHUNKS = 24;     // 첨도·대역에너지 추이 샘플 청크 수

// db.js 재노출 — app.js가 데이터 진입점을 이 파일 하나로 유지
export const listTagTables = DB.listTagTables;
export const loadConfig = DB.loadConfig;
export const saveConfig = DB.saveConfig;
export const saveConfigPartial = DB.saveConfigPartial;
export const rollupBatch = DB.rollupBatch;
export const listTags = DB.listTags;
export const tagStats = DB.tagStats;
export const rollupTrend = DB.rollupTrend;
export const rawWindow = DB.rawWindow;   // ISO 대역제한 계산용 1초 원본
// 상시감시(P6): 이벤트/판정상태/베이스라인 — 판정은 앱(app._judgeLive), 여기는 영속화 채널
export const ensureMonTables = DB.ensureMonTables;
export const loadEvents = DB.loadEvents;
export const loadEventsRange = DB.loadEventsRange;
export const countEvents = DB.countEvents;
export const runTql = DB.tql; // 알림 발송용 — 서버에서 $.request 실행(브라우저 직접 POST는 CORS·시크릿 노출)
export const loadBaselines = DB.loadBaselines;
export const saveBaseline = DB.saveBaseline;
export const deleteBaseline = DB.deleteBaseline;
export const insertEvent = DB.insertEvent;
export const loadMonState = DB.loadMonState;
export const saveMonState = DB.saveMonState;
// 서버 상시감시(P5): 판정 TQL을 파일로 저장하고 Neo 타이머로 주기 실행 (앱 없이도 감시)
export const createMonitorTimer = DB.createMonitorTimer;
export const timerStates = DB.timerStates;
export const MON_TIMER = DB.MON_TIMER;
export const BAND_TIMER = DB.BAND_TIMER;
export const createBandTimer = DB.createBandTimer;
export const deleteBandTimer = DB.deleteBandTimer;
export const bandTrend = DB.bandTrend;
export const bandBackfill = DB.bandBackfill;
export const bandTimes = DB.bandTimes;
export const bandRaw = DB.bandRaw;
export const deleteMonitorTimer = DB.deleteMonitorTimer;
export const pruneEvents = DB.pruneEvents;
// 리포트 파일 저장/목록/미리보기 (워크스페이스 루트 기준 경로)
export const REPORT_DIR = '/vibration-reports';
export const ensureDir = DB.ensureDir;
export const saveFile = DB.saveFile;
export const listDir = DB.listDir;
export const deleteFile = DB.deleteFile;
export const readFileBlob = DB.readFileBlob;
// 리포트에 내장할 차트 엔진 소스 (cgi-bin은 정적 차단이라 파일 API로 읽는다 — 배포본과 항상 동일)
export function chartLibSrc() {
  return DB.readFileBlob(DB.pkgBase() + '/cgi-bin/chart/chart.js').then(b => b.text());
}

const UNIT_SEC = { sec: 1, min: 60, hour: 3600 };
const UNIT_LABEL = { sec: '초별 (1s)', min: '분별 (1m)', hour: '시간별 (1h)' };

function pickRollupUnit(spanSec) {
  if (spanSec / UNIT_SEC.sec <= ROLLUP_BUCKETS * 1.2) return 'sec';
  if (spanSec / UNIT_SEC.min <= ROLLUP_BUCKETS * 1.2) return 'min';
  return 'hour';
}

// mock generateData와 동일한 모양의 data 객체를 실데이터로 조립
export async function buildLiveData(E, tables, cfg) {
  cfg = cfg || {};
  const equipment = [];
  let nowMs = 0;

  for (const table of tables) {
    if (equipment.length >= MAX_EQUIPMENT) break;
    let tags, stats;
    try { tags = await DB.listTags(table, TAGS_PER_TABLE); } catch (e) { continue; } // META 없으면 스킵
    try { stats = await DB.tagStats(table); } catch (e) { stats = {}; }
    for (const tag of tags) {
      if (equipment.length >= MAX_EQUIPMENT) break;
      const st = stats[tag];
      if (!st || !st.count || !st.maxMs) continue;
      nowMs = Math.max(nowMs, st.maxMs);
      const id = table + ':' + tag;
      const spanSec = Math.max(1, (st.maxMs - st.minMs) / 1000);
      const cls = (cfg.equipCls || {})[id] || 'II'; // 판정 폴백 (UI 표시는 미선택)
      const unit = (cfg.equipUnit || {})[id] || 'mm/s';
      const model = (cfg.equipBearing || {})[id] || ''; // 미지정이면 결함주파수 마커 없음
      const geo = model ? (VC.BEARINGS[model] || Object.assign({}, (cfg.equipGeo || {})[id] || { n: 0, Bd: 0, Pd: 0, phi: 0 })) : { n: 0, Bd: 0, Pd: 0, phi: 0 };
      equipment.push({
        id, table, name: tag, alias: (cfg.aliases || {})[id] || tag,
        unit, cls, baseCls: cls,
        rpm: Number((cfg.equipRpm || {})[id]) || 1800,
        bearing: Object.assign({ model }, geo),
        // 계측·구동 메타 — 전부 선택. 없으면 엔진이 해당 후보를 "볼 수 없음"으로 처리한다(0점이 아니다).
        meta: Object.assign({ lineHz: Number(cfg.lineHz) || 60 }, (cfg.equipMeta || {})[id] || {}),
        fault: null,
        fs: Math.round(st.count / spanSec),
        stat: st, lastSeen: st.maxMs,
        rms: 0, sparkVals: [], spark: { line: '', area: '' },
        rollup: [], rollupStepSec: 3600, rollupLabel: UNIT_LABEL.hour,
        zones: VC.zonesFor(unit, cls), grade: 0,
      });
    }
  }
  if (!equipment.length) return { now: 0, equipment: [], events: [], reports: [] };

  await Promise.all(equipment.map(async eq => {
    const st = eq.stat;
    const spanSec = Math.max(1, (st.maxMs - st.minMs) / 1000);
    // rollup 미지원(폴백) 테이블은 원본 스캔이라 행 예산(약 5백만)으로 조회 구간을 캡
    const capSec = Math.max(300, Math.round(5e6 / Math.max(1, eq.fs)));
    const truncCapMs = capSec * 1000;
    let unit = pickRollupUnit(spanSec);
    let stepSec = UNIT_SEC[unit];
    let fromMs = Math.max(st.minMs, st.maxMs - ROLLUP_BUCKETS * stepSec * 1000);
    try {
      eq.rollup = await DB.rollupTrend(eq.table, eq.name, unit, fromMs, st.maxMs, { truncCapMs });
      // 폴백이 확인되면(스캔 캡 적용) 캡 구간 기준으로 단위 재선정 → 버킷 밀도 복구
      if (DB.isNoRollup(eq.table)) {
        const unit2 = pickRollupUnit(Math.min(spanSec, capSec));
        if (unit2 !== unit) {
          unit = unit2; stepSec = UNIT_SEC[unit];
          fromMs = Math.max(st.minMs, st.maxMs - Math.min(capSec, ROLLUP_BUCKETS * stepSec) * 1000);
          eq.rollup = await DB.rollupTrend(eq.table, eq.name, unit, fromMs, st.maxMs, { truncCapMs });
        }
        eq.rollupLabel = UNIT_LABEL[unit] + ' · 원본 집계';
      } else {
        eq.rollupLabel = UNIT_LABEL[unit]; // ' · 자동' 접미는 화면(detSpec)이 붙인다 — 중복 금지
      }
      eq.rollupStepSec = stepSec;
    } catch (e) { eq.rollup = []; }
    try {
      const spark = await DB.rollupTrend(eq.table, eq.name, 'sec', st.maxMs - 36000, st.maxMs);
      eq.sparkVals = spark.map(b => b.rms);
      // 샘플레이트 추정 개선: 전체 평균(갭 포함, 과소 추정)보다 초당 버킷 건수의 중앙값이 정확
      const cnts = spark.map(b => b.cnt).filter(c => c > 0).sort((a, b) => a - b);
      if (cnts.length >= 5) eq.fs = cnts[Math.floor(cnts.length / 2)];
    } catch (e) { eq.sparkVals = []; }
    if (!eq.sparkVals.length && eq.rollup.length) eq.sparkVals = eq.rollup.slice(-36).map(b => b.rms);
    eq.rms = eq.sparkVals.length ? eq.sparkVals[eq.sparkVals.length - 1] : (eq.rollup.length ? eq.rollup[eq.rollup.length - 1].rms : 0);
    eq.spark = E.sparkPath(eq.sparkVals.length ? eq.sparkVals : [0, 0], 132, 40, 3);
    eq.grade = VC.gradeFor(eq.rms, eq.zones);
  }));

  return { now: nowMs, equipment, events: [], reports: [] };
}

function fmtHz(hz) { return hz >= 1000 ? (hz / 1000).toFixed(1) + 'kHz' : Math.round(hz) + 'Hz'; }
export function emptyDet(eq) {
  return {
    raw: { times_ms: [], values: [], fs: eq.fs || 0 },
    fft: { freqs: [], mags: [], markers: [], res: 1, dispHz: 0, nyqHz: 0 },
    envelope: { freqs: [], mags: [], markers: [], hint: '', fault: false },
    cepstrum: { freqs: [], mags: [], markers: [], note: '' },
    spectro: { grid: [], rows: 0, cols: 0, fmax: 0 }, spectroFull: null,
    kurtogram: null, dispUnit: eq.unit || 'mm/s', natUnit: eq.unit || 'mm/s',
    quality: { ok: true, issues: [], severe: false, gate: false }, levels: null,
    isoRms: null, anaSec: 0, frMeas: null, envQ: null, bearMatch: null, acq: null,
    isoBlocks: 0, isoSpread: 1, bandSet: null, parseval: null, ordSpec: null,
    levelsBandHz: null, accelBound: null, levelsOk: true, accelRatio: 0, accelFeff: 0, accelNyqFrac: 0,
    hfEnergyFrac: 0, velExHigh: 0,
    indics: [],
    bandKurt: null, spectral: { notes: [], cause: null },
  };
}

export function liveMarkers(eq, maxHz) {
  const fr = eq.rpm / 60;
  const markers = [
    { freq: fr, label: '1×', kind: 'x' },
    { freq: 2 * fr, label: '2×', kind: 'x' },
    { freq: 3 * fr, label: '3×', kind: 'h' },
  ];
  if (eq.bearing && eq.bearing.n > 0) {
    const bf = VC.bearingFreqs(eq.rpm, eq.bearing);
    markers.push(
      { freq: bf.BPFO, label: 'BPFO', kind: 'fq' },
      { freq: bf.BPFI, label: 'BPFI', kind: 'fq' },
      { freq: bf.BSF, label: 'BSF', kind: 'fq' },
      { freq: bf.FTF, label: 'FTF', kind: 'fq' }
    );
  }
  return markers.filter(m => m.freq > 0 && m.freq <= maxHz);
}

// 분석 창(초) — "몇 초"가 아니라 목표 샘플 수 기준이라 fs 무관하게 일관(8kHz 절벽 없음).
//  · 기본 16,384 샘플 (FFT 해상도 vs 조회·연산 비용 균형)
//  · RPM이 있으면 최소 REV_MIN 회전 담기게 상향(고fs+저rpm 대비, 최대 65,536) — 저속 회전체의
//    포락선·측대역 분해에 필요. 회전이 느릴수록 창이 자동으로 길어진다.
//  · 저속 fs는 16k 채우는 데 시간이 길어지므로 시간 상한(20초)으로만 제한(데이터 적어 비용은 낮음).
// FFT 블록 크기는 분석기 관례대로 16,384 샘플(= 6,400 라인)로 고정한다.
// 분해능(Δf = fs/N)을 높이는 방법은 블록을 키우는 게 아니라 "보는 대역을 좁히는 것"이다 —
// 실제 분석기의 줌 FFT와 같은 원리로, 저주파 차수 해석은 대역통과 후 데시메이션한 fsLo에서 같은 16k 블록을 쓴다.
//   · 표시 FFT : 16,384 @ 25.6 kHz → 0.64초 · Δf 1.56 Hz (전대역 관측용)
//   · 차수 해석: 16,384 @ 3.2 kHz(÷8 데시메이션) → 5.12초 · Δf 0.195 Hz (측대역·슬립 판정용)
// 총 창은 이 블록을 50% 중첩으로 ANA_BLOCKS개 담을 만큼만 받는다(충격성 신호의 진폭 안정화).
const ANA_BLOCK_N = 16384;   // 분석기 관례: 블록당 샘플 수(6,400 라인)
const ANA_BLOCKS = 8;        // 평균 블록 수(50% 중첩) — N_MAX 2^19와 맞물려 실제 평균 7회
const ANA_DEC_FS = 3000;     // 차수 해석용 목표 데시메이션 레이트(≥1 kHz 대역 확보)
function anaWindowSec(fs, rpm) {
  /* N_MAX는 대역통과 FFT가 실제로 쓰는 2의 거듭제곱 상한과 맞춘다 — 더 받아봐야 잘려서 버려진다.
     2^18(25.6kHz에서 10.2초)이면 16k 블록이 3개밖에 안 들어가 평균 3회에 그친다. 2^19로 올리면
     20.5초 창에 7회 평균이 되고, 분해능(0.195 Hz)은 블록 크기가 정하므로 그대로다.
     실측(BEARING:C1): 평균 3→7회, 블록간 변동 ×1.06→×1.19, 조회 435→990ms.
     ⚠더 늘리지 않는 이유 — 36초에서 변동이 ×1.51까지 벌어진다. 정상상태를 벗어난 구간을 평균하면
     평균 횟수는 늘어도 서로 다른 운전 상태가 섞여 결과가 흐려진다. 규격 목표(0.125Hz·8평균)를
     이 설비에서 채우려면 46초가 필요한데, 그건 정상상태 전제를 깬다. */
  const T_MAX = 22, REV_MIN = 6, N_MAX = 1 << 19;
  const fr = rpm > 0 ? rpm / 60 : 0;
  const dec = Math.max(1, Math.floor(fs / ANA_DEC_FS));
  // 데시메이션 후 16k 블록 하나가 차지하는 원시 구간 × 중첩 개수
  const blockSec = (ANA_BLOCK_N * dec) / fs;
  let sec = blockSec * (1 + (ANA_BLOCKS - 1) * 0.5);
  if (fr > 0) sec = Math.max(sec, REV_MIN / fr);
  sec = Math.min(T_MAX, sec, N_MAX / fs);
  return sec;
}

// 상세분석 상세 데이터 — 파형·FFT(서버) + 포락선·켑스트럼·스펙트로그램(클라이언트 계산)
// anchorMs: 분석 기준점(선택 기간의 끝·이벤트 시각). 없으면 최신 데이터(eq.lastSeen).
export async function liveDetail(E, eq, anchorMs, viewUnit) {
  const det = emptyDet(eq);
  const fs = Math.max(1, eq.fs || 1);
  const end = anchorMs || eq.lastSeen; // 추세가 보여주는 구간의 끝(또는 이벤트 시각)에 스펙트럼을 맞춘다
  const fr = eq.rpm / 60;
  const natUnit = eq.unit || 'mm/s';
  const dispUnit = (viewUnit && ['g', 'mm/s', 'μm'].indexOf(viewUnit) >= 0) ? viewUnit : natUnit; // 표시 물리량
  det.dispUnit = dispUnit; det.natUnit = natUnit;
  const bfTop = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
  const nyqHz = Math.max(50, Math.floor(fs * 0.45)); // 물리 상한(Nyquist 마진) = 전대역
  // 기본 표시 상한(A): 설비 맞춤 — 회전수(25×)·베어링(3×BPFI)이 필요로 하는 만큼만, 최소 1kHz, Nyquist로 캡.
  // 대부분 1kHz(저주파 결함에 집중), 고속·고주파 결함 설비만 자동으로 넓어진다. 전대역 토글로 nyqHz까지 펼침.
  const dispHz = Math.max(50, Math.min(nyqHz, Math.max(1000, 25 * fr, 3 * (bfTop ? bfTop.BPFI : 0))));

  // 분석용 원시 구간 — 목표 16k 샘플 창(FFT·파형·포락선·스펙트로그램·켑스트럼·지표 공용, 같은 시점)
  const winSec = anaWindowSec(fs, eq.rpm);
  let ana = { times_ms: [], values: [] };
  try { ana = await DB.rawWindow(eq.table, eq.name, end - winSec * 1000, end, 0); } catch (e) { /* 없음 */ }
  // 신호 품질 체크 — 원시(변환 전) 신호 기준. garbage-in 방어 배너용
  if (ana.values.length) det.quality = VC.signalQuality(ana.values, fs);

  // 3도메인 종합 레벨(RMS) — 원시 신호를 가속도/속도/변위로 변환해 각 RMS. "에너지가 어느 도메인에 있나" 표지용
  if (ana.values.length) {
    const rmsOf = function (a) { let n = a.length, m = 0, i; for (i = 0; i < n; i++) m += a[i]; m /= n; let ss = 0; for (i = 0; i < n; i++) { const dd = a[i] - m; ss += dd * dd; } return Math.sqrt(ss / n); };
    const lv = {};
    ['g', 'mm/s', 'μm'].forEach(function (uu) { const v = uu === natUnit ? ana.values : VC.convertDomain(ana.values, fs, natUnit, uu, fr); lv[uu] = rmsOf(v); });
    det.levels = lv;
    det.levelsBandHz = [0, Math.round(fs * 0.5)]; // 광대역(전대역) 변환값임을 라벨로 못박는다
    det.anaSec = ana.values.length / fs; // 분석 창 길이(초) — "원시파형 RMS가 3분 평균과 왜 다른가" 라벨용

    // ── 저주파 분석 파이프라인(단일 소스) ──────────────────────────────────────
    // ISO 판정·대역 RMS·차수 피크·1× 실측을 "같은 시계열·같은 방법"으로 뽑는다.
    // 서로 다른 파이프라인(서버 FFT vs 클라이언트 대역통과)에서 뽑으면 부분 대역이 전체 대역을
    // 넘는 검산 실패가 생기고, 그 위의 모든 해석이 근거를 잃는다.
    const velVals = natUnit === 'mm/s' ? ana.values : VC.convertDomain(ana.values, fs, natUnit, 'mm/s', fr);
    // ISO 10816 = 10–1000 Hz 대역제한 속도 RMS · 정상상태 충분 평균(단일 블록 금지)
    const isoAvg = VC.bandRmsAveraged(velVals, fs, 10, 1000, 8);
    det.isoRms = isoAvg.rms;
    det.isoBlocks = isoAvg.blocks;
    det.isoSpread = isoAvg.spread; // 블록 간 변동 — 정상상태 여부(변동 크면 규격 전제 미충족)
    // 대역 RMS 집합 — ISO와 같은 방법(대역제한 RMS)이라 제곱합이 전체와 정합한다(Parseval 자기검사 가능)
    if (fr > 0) {
      // 대역 5개를 FFT 한 번으로 — 대역마다 bandRms를 부르면 같은 신호를 5번 FFT한다(53만 샘플이면 0.25초).
      const _nyq0 = fs * 0.5;
      const _bands = [
        [2, Math.max(3, 0.5 * fr)],
        [Math.max(2, 0.5 * fr), 1.5 * fr],
        [1.5 * fr, Math.min(1000, 10 * fr)],
        [Math.min(1000, 10 * fr), 1000],
        [1000, _nyq0],
      ];
      const _br = VC.bandRmsMulti(velVals, fs, _bands);
      const bset = { sub: _br[0], one: _br[1], fault: _br[2], high: _br[3] };
      det.bandSet = bset;
      const sumSq = Math.sqrt(bset.sub * bset.sub + bset.one * bset.one + bset.fault * bset.fault + bset.high * bset.high);
      const rel = det.isoRms > 0 ? Math.abs(sumSq - det.isoRms) / det.isoRms : 0;
      // 자기검사: 부분 대역의 제곱합은 전체 대역과 일치해야 한다(2–10 Hz 제외분 때문에 약간 작을 수 있음)
      det.parseval = { sumSq, isoRms: det.isoRms, relErr: rel, ok: rel < 0.03 };
      if (!det.parseval.ok) console.warn('[vibe] 대역 분해 검증 실패', det.parseval);
      // 가속도 물리 상한 검산 — 각 대역 에너지를 그 대역의 "최고 주파수"에 전부 몰아넣어 미분 이득을
      // 최대화해도 넘을 수 없는 값. 초과하면 시간영역 미분·양자화 잡음이 만든 수치다("부정확"이 아니라 "불가능").
      // ⚠상한은 반드시 Nyquist까지 덮어야 한다 — 1 kHz에서 끊으면 정당한 고주파 성분까지 위반으로 잡힌다.
      const nyq = _nyq0;
      const vhigh = _br[4];   // 위 bandRmsMulti에서 함께 구한 1kHz~Nyquist 대역
      det.bandSet.vhigh = vhigh;
      const capF = [Math.max(3, 0.5 * fr), 1.5 * fr, Math.min(1000, 10 * fr), 1000, nyq];
      const parts = [bset.sub, bset.one, bset.fault, bset.high, vhigh];
      let accCap = 0;
      parts.forEach(function (r, i) { const a = 2 * Math.PI * capF[i] * (r * 1e-3); accCap += a * a; });
      det.accelBound = Math.sqrt(accCap) / 9.80665; // g 단위 상한(전대역)
      // ⚠상한 비교만으로는 병리를 못 잡는다 — 상한은 각 대역 에너지를 그 대역 상단에 몰아 만든 값이라
      // 정의상 항상 참이다(양자화 잡음도 통과). 정보량이 큰 것은 "가속도 에너지 중심 주파수"다:
      //   f_eff = a / (2π·v_high). 이 값이 Nyquist에 근접하면 AA 필터 부재·센서 공진 폴딩·미분 증폭이다.
      det.accelRatio = det.accelBound > 0 ? lv['g'] / det.accelBound : 0;
      det.accelFeff = vhigh > 0 ? (lv['g'] * 9.80665) / (2 * Math.PI * (vhigh * 1e-3)) : 0;
      det.accelNyqFrac = nyq > 0 ? det.accelFeff / nyq : 0;
      // 감시(광대역) 등급이 '게재 보류된 >1kHz 대역'에 얼마나 기대는지 — 잠정 표기의 근거
      var vbb = lv['mm/s'] || 0;
      det.hfEnergyFrac = vbb > 0 ? Math.min(1, (vhigh * vhigh) / (vbb * vbb)) : 0;
      det.velExHigh = Math.sqrt(Math.max(0, vbb * vbb - vhigh * vhigh));
      // 에너지 중심이 Nyquist의 80%를 넘으면 물리 신호로 보기 어렵다 → 값 게재 보류
      det.levelsOk = !(det.accelNyqFrac > 0.8) && !(lv['g'] > det.accelBound * 1.05);
    }
    // 차수 해석용 Welch 평균 스펙트럼 — 대역제한 후 데시메이션(폴딩 방지) → 블록 평균
    const anaBand = VC.bandpassSignal(velVals, fs, 1, Math.min(1200, fs * 0.4));
    const dec = Math.max(1, Math.floor(fs / ANA_DEC_FS));
    const loVals = VC.decimate(anaBand, dec), fsLo = fs / dec;
    // 블록 = 관례 16,384 샘플(가능하면). 데이터가 모자라면 가진 길이에서 최대 블록으로 낮춘다.
    const blkN = Math.min(ANA_BLOCK_N, Math.max(1024, Math.floor(loVals.length / 1.5)));
    /* 정상상태 가드 — 블록별 RMS가 크게 흔들리면 평균해봐야 서로 다른 운전 상태를 섞는 것이다.
       그럴 땐 앞쪽(최신 앵커 기준 연속 구간) 절반만 써서 "같은 상태끼리" 평균한다.
       평균 횟수보다 정상상태 전제가 먼저다 — 규격이 요구하는 것도 "정상상태 충분 평균"이지
       "무조건 8회"가 아니다. */
    const _bl = Math.round(blkN), _hop = Math.floor(_bl / 2), _br = [];
    for (let s = 0; s + _bl <= loVals.length; s += _hop) {
      let ss = 0; for (let i = s; i < s + _bl; i++) ss += loVals[i] * loVals[i];
      _br.push(Math.sqrt(ss / _bl));
    }
    const _spread = _br.length > 1 ? Math.max(..._br) / Math.max(1e-12, Math.min(..._br)) : 1;
    const anaVals2 = (_spread > 1.5 && loVals.length > _bl * 2)
      ? loVals.slice(0, Math.max(_bl * 2, Math.floor(loVals.length / 2)))
      : loVals;
    const wel = VC.welchSpectrum(anaVals2, fsLo, Math.min(1000, fsLo * 0.4), blkN / fsLo);
    if (wel.freqs.length) det.ordSpec = { freqs: wel.freqs, mags: wel.mags, res: wel.res, resTrue: wel.resTrue, blocks: wel.blocks, fsLo, decim: dec, blockSpread: _spread, trimmed: anaVals2.length < loVals.length };
  }

  // 물리량 변환(선택) — 원시 파형을 표시 물리량으로 1회 변환 → 파형·포락선·커토그램·스펙트로그램·지표가 공유
  const anaVals = (dispUnit !== natUnit && ana.values.length) ? VC.convertDomain(ana.values, fs, natUnit, dispUnit, fr) : ana.values;

  // 표시용 파형 (≤6000pt 다운샘플) — 변환된 신호 기준(시각은 인덱스 정렬)
  if (anaVals.length) {
    const stride = Math.max(1, Math.ceil(anaVals.length / 6000));
    const t = [], v = [];
    for (let i = 0; i < anaVals.length; i += stride) { t.push(ana.times_ms[i]); v.push(anaVals[i]); }
    det.raw = { times_ms: t, values: v, fs };
  }

  // 표시용 메인 FFT는 서버(TQL FFT) — 분석 창의 끝에 맞춰 같은 시점을 본다.
  // ⚠분석 창(수십 초)을 그대로 쓰면 전대역 포인트 수가 nyqHz×창초 = 10만 개를 넘어 리포트가 수 MB로 부풀고
  //   캔버스 렌더가 죽는다. 차수·ISO 판정은 이미 det.ordSpec(Welch 평균)이 담당하므로
  //   표시용은 포인트 예산(FFT_MAX_PTS)으로 창을 역산해 뽑는다. 저샘플레이트 태그는 자동으로 더 긴 창을 쓴다.
  const fftSec = Math.min(winSec, ANA_BLOCK_N / fs);   // 16,384 샘플 = 6,400 라인(분석기 관례)
  try {
    const sp = await DB.fftSpectrum(eq.table, eq.name, end - fftSec * 1000, end, 1, nyqHz);
    const fmags = dispUnit !== natUnit ? VC.convertSpectrumMags(sp.mags, sp.freqs, natUnit, dispUnit) : sp.mags; // 스펙트럼도 표시 물리량으로
    det.fft = { freqs: sp.freqs, mags: fmags, res: sp.res, markers: liveMarkers(eq, nyqHz), dispHz, nyqHz };
  } catch (e) { det.fft.markers = liveMarkers(eq, nyqHz); det.fft.dispHz = dispHz; det.fft.nyqHz = nyqHz; }
  // 스펙트럼 패턴 분석(하모닉 열·측대역) — EVIDENCE와 같은 스펙트럼·같은 1× 기준으로 돌린다.
  // 서버 단일블록 FFT + 명판 fr로 돌리면 같은 리포트에 지배 차수가 두 개(0.60× vs 0.62×) 생긴다.
  // (아래 det.ordSpec/det.frMeas 산출 뒤로 이동 — 순서 의존)
  // 1× 실측 — 명판 RPM ±5% 창의 유의 피크로 실제 회전주파수 확정(유도전동기 슬립은 통상 ≤5%).
  // 차수 해석 전체가 1× 위에 서므로 Welch 평균 스펙트럼(고분해능)에서 잡는다.
  // ⚠분해능이 곧 불확도: Δf=1 Hz면 ±60 rpm이라 명판값과 구분되지 않는다 → tol을 함께 싣는다.
  const oSpec = det.ordSpec;
  det.frMeas = oSpec ? VC.measuredOneX(oSpec.freqs, oSpec.mags, fr, 5) : null;
  if (det.frMeas) {
    var uncHz = oSpec.resTrue || oSpec.res || 0;   // 창 길이가 정하는 실제 분해능 = 불확도
    det.frMeas.tolHz = uncHz;
    det.frMeas.rpmTol = uncHz * 60;
    det.frMeas.distinct = Math.abs(det.frMeas.f - fr) > uncHz;
  }
  const frUseSpec = (det.frMeas && det.frMeas.f) || fr;
  det.spectral = (det.ordSpec && det.ordSpec.freqs.length)
    ? VC.analyzeSpectrum(det.ordSpec.freqs, det.ordSpec.mags, frUseSpec, bfTop)
    : (det.fft.freqs.length ? VC.analyzeSpectrum(det.fft.freqs, det.fft.mags, frUseSpec, bfTop) : { notes: [], cause: null });
  // 스펙트럼 취득 조건 — 창·분해능·윈도우·평균 횟수. 측대역 부재/실측 회전수 주장의 한계를 규정한다.
  det.acq = {
    winSec: winSec, window: 'Hann', overlapPct: 50,
    blockSec: oSpec ? 1 / (oSpec.resTrue || oSpec.res || 1) : 0,   // 블록 길이 = 1/실제분해능
    res: oSpec ? (oSpec.resTrue || oSpec.res) : (det.fft.res || 0),  // 차수 해석 실제 분해능(창 길이 기준)
    resBin: oSpec ? oSpec.res : (det.fft.res || 0),                  // 제로패딩 후 빈 간격(표시용)
    averages: oSpec ? oSpec.blocks : 1,                    // 차수 해석 평균 블록 수
    dispRes: det.fft.res || 0,                             // 표시 FFT(서버) 분해능 — 단일 블록
    dispSec: fftSec,                                       // 표시 FFT 창(분석 창과 다름 — 포인트 예산으로 역산)
    isoBlocks: det.isoBlocks || 0,
  };

  if (anaVals.length) {
    // 고주파 작업(커토그램·포락선·스펙트로그램·밴드커토시스)은 분해능이 아니라 대역이 관건이라
    // 전체 창을 다 쓸 필요가 없다 — 창이 길어져도 계산량이 폭발하지 않도록 앞부분만 사용.
    const HF_MAX = 65536;
    const hfVals = anaVals.length > HF_MAX ? anaVals.slice(0, HF_MAX) : anaVals;
    // 커토그램 — 가장 충격성이 강한 대역을 자동 탐색해 포락선 복조 대역으로 사용(고정 대역보다 정확).
    // 마운팅 상한을 넘는 대역은 스캔에서 제외한다: 자석 마운트의 2kHz 이상 융기는 기계가 아니라
    // 마운팅이 울린 것이라, 그 위를 고르면 포락선 복조 전체가 가짜 대역에서 돌아간다.
    const mFmax = VC.mountFmax(eq.meta && eq.meta.mount);
    det.mount = (eq.meta && eq.meta.mount) || '';
    det.mountFmax = mFmax;
    /* 에일리어싱 상한 — 마운팅과 별개 조건이다. 가속도 에너지 중심(f_eff)이 Nyquist에 붙어 있으면
       안티에일리어싱 필터를 못 믿는다는 뜻이고, 접힌 성분은 원래 주파수가 아닌 자리에 나타난다.
       "가속도 값 게재 보류"를 띄우면서 6.5kHz 커토그램 대역을 그대로 쓰면 앞뒤가 안 맞는다 —
       값을 못 믿는 이유가 그 대역이 가짜일 수 있다는 것이기 때문이다.
       f_eff가 Nyquist의 80%를 넘으면 탐색 상한을 Nyquist의 절반으로 낮춰 접힘 영향이 큰 상단을 뺀다. */
    const nyqHzA = fs / 2;
    const aliasSuspect = det.accelNyqFrac > 0.8;
    const aFmax = aliasSuspect ? nyqHzA * 0.5 : 0;
    // 둘 중 낮은 쪽이 실제 상한 (0 = 제한 없음)
    const kFmax = (mFmax > 0 && aFmax > 0) ? Math.min(mFmax, aFmax) : (mFmax || aFmax);
    det.aliasFmax = aFmax;
    det.kgFmax = kFmax;
    det.kgCapSrc = kFmax === 0 ? '' : (aFmax > 0 && (mFmax === 0 || aFmax <= mFmax) ? 'alias' : 'mount');
    const kg = VC.kurtogram(hfVals, fs, kFmax);
    det.kgCapped = !!(kg && kg.capped);
    if (kg && kg.best) {
      const lv = kg.levels.filter(l => l.nb === kg.best.nb)[0] || kg.levels[kg.levels.length - 1];
      const bw = kg.fmax / lv.nb;
      det.kurtogram = {
        freqs: lv.sk.map((_, i) => (i + 0.5) * bw), mags: lv.sk, res: bw, best: kg.best, fmax: kg.fmax,
        markers: [{ freq: kg.best.center, label: '최적', kind: 'f' }],
      };
    }

    // 포락선 스펙트럼 (커토그램 최적 대역으로 복조 — 없으면 전대역 정류)
    const envMax = Math.min(500, fs * 0.4);
    const env = VC.envelopeSpectrum(hfVals, fs, envMax, kg && kg.best);
    const bf = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    const envDx = env.freqs.length ? VC.diagnoseDominant(env.freqs, env.mags, fr, bf) : null;
    const bandTxt = (kg && kg.best) ? ' · 대역 ' + fmtHz(kg.best.loHz) + '–' + fmtHz(kg.best.hiHz) + '(SK ' + kg.best.sk.toFixed(1) + ')' : '';
    det.envelope = {
      freqs: env.freqs, mags: env.mags,
      markers: liveMarkers(eq, envMax).filter(m => m.kind === 'fq' || m.label === '1×'),
      fault: !!(envDx && envDx.cause),
      hint: (envDx && envDx.hit
        ? '포락선 지배 주파수 ' + envDx.domF.toFixed(1) + ' Hz — ' + envDx.hit + ' (' + (envDx.cause || '') + ')'
        : '정류(|x|) 신호의 저주파 스펙트럼 · 충격 반복 주파수 복조') + bandTxt,
    };
    // 포락선 정량 — 반복주파수·하모닉 수·1× 측대역. 하모닉≥2 = "일관된 반복 충격"(베어링 근거의 결정 검사)
    det.envQ = VC.envelopeQuant(env.freqs, env.mags, (det.frMeas && det.frMeas.f) || fr);
    // 결함주파수 대조 — 매칭 없이는 베어링 가점 불가. negatives(미검출)는 음성 소견으로 인쇄한다.
    det.bearMatch = VC.bearingMatch(det.envQ, bf, (det.frMeas && det.frMeas.f) || fr);

    // 스펙트로그램 (STFT) — 기본(dispHz)+전대역(nyqHz) 두 그리드를 미리 계산해 토글이 즉시 되게
    det.spectro = VC.stftGrid(hfVals, fs, dispHz, 22, 52);
    det.spectroFull = (nyqHz > dispHz * 1.05) ? VC.stftGrid(hfVals, fs, nyqHz, 22, 52) : det.spectro;

    // 시간영역 지표 (표시 물리량 기준)
    det.indics = VC.timeIndics(anaVals, dispUnit);
    // 밴드 커토시스 — 회전 성분 제거 후 고주파 임펄스성(베어링·기어 결함 특이도↑)
    const loHz = Math.min(fs * 0.3, Math.max(500, 8 * fr));
    det.bandKurt = VC.bandKurtosis(hfVals, fs, loHz);
  }

  // 켑스트럼 — 서버 FFT 스펙트럼의 log-FFT (quefrency ms)
  if (det.fft.freqs.length) {
    const cep = VC.cepstrumFromSpectrum(det.fft.mags, det.fft.res, 100);
    // 라모닉 "확인"은 검출한 뒤에만 쓸 수 있는 말이다 — 마커를 찍는 것과 피크가 있는 것은 다르다.
    // 기준 1×는 명판이 아니라 실측(있으면)을 쓴다. 없으면 명판 기준임을 문구에 밝힌다.
    const frUse = (det.frMeas && det.frMeas.f) || fr;
    const qms = frUse > 0 ? 1000 / frUse : 0;
    let found = false;
    if (qms > 0 && cep.freqs.length) {
      const sorted = cep.mags.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)] || 0;
      const step = cep.freqs.length > 1 ? (cep.freqs[1] - cep.freqs[0]) : 1;
      for (let i = 0; i < cep.freqs.length; i++) {
        if (Math.abs(cep.freqs[i] - qms) <= Math.max(step, qms * 0.03) && cep.mags[i] > med * 4) { found = true; break; }
      }
    }
    det.cepstrum = {
      freqs: cep.freqs, mags: cep.mags,
      markers: frUse > 0 ? [{ freq: qms, label: '1/1×', kind: 'f' }] : [],
      note: '하모닉·측대역 간격을 quefrency(ms)로 표시 · 1/1× = ' + qms.toFixed(1) + ' ms('
        + (det.frMeas ? '실측 1× 기준' : '명판 1× 기준') + ') — 해당 quefrency 라모닉 '
        + (found ? '검출됨(중앙값 4배 초과)' : '미검출'),
    };
  }

  return det;
}

// 첨도·대역 에너지 추이 — 트렌드 구간을 등분한 원시 청크 샘플링으로 계산
export async function loadTrendChunks(E, eq, roll) {
  if (!roll.length) return { kurt: [], bands: [], xLabels: null };
  const fs = Math.max(1, eq.fs || 1);
  const chunkSec = Math.min(1, Math.max(0.1, 4096 / fs)); // 청크당 ~4,096 샘플 고정(첨도 통계 안정) — fs 절벽 제거
  const fr = eq.rpm / 60;
  const fromMs = roll[0].ms, toMs = roll[roll.length - 1].ms;
  const n = Math.min(TREND_CHUNKS, roll.length);
  const kurt = [], b1 = [], b2 = [], b3 = [], xLabels = [], xTips = [], times = [];
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const at = fromMs + (toMs - fromMs) * (n === 1 ? 1 : i / (n - 1));
    jobs.push(
      DB.rawWindow(eq.table, eq.name, at - chunkSec * 1000, at + 1000, 0).then(w => ({ at, w }))
        .catch(() => ({ at, w: { values: [] } }))
    );
  }
  const chunks = await Promise.all(jobs);
  chunks.forEach(({ at, w }) => {
    if (w.values.length < 64) return;
    kurt.push(VC.kurtosis(w.values));
    const sp = VC.amplitudeSpectrum(w.values, fs, Math.min(1000, fs * 0.45));
    const be = VC.bandEnergies(sp, fr, fs);
    b1.push(be[0]); b2.push(be[1]); b3.push(be[2]);
    xLabels.push(E.fmtMD(at));
    xTips.push(E.fmtDT(at));
    times.push(at); // 시간축 배치용 (청크 실제 시각 — 데이터 부족 청크는 건너뛰므로 값 배열과 길이 일치)
  });
  return {
    kurt,
    bands: [
      { label: '1× 회전 성분', color: '#4199ff', vals: b1 },
      { label: '결함 대역', color: '#e5646a', vals: b2 },
      { label: '고주파 대역', color: '#8b7ff0', vals: b3 },
    ],
    xLabels, xTips, times,
  };
}
