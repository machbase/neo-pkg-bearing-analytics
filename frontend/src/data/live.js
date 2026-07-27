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
export const rollupBatch = DB.rollupBatch;
export const listTags = DB.listTags;
export const tagStats = DB.tagStats;
export const rollupTrend = DB.rollupTrend;
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
    quality: { ok: true, issues: [], severe: false }, levels: null,
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
function anaWindowSec(fs, rpm) {
  const N_TARGET = 16384, N_MAX = 65536, T_MAX = 20, REV_MIN = 6;
  const fr = rpm > 0 ? rpm / 60 : 0;
  let n = N_TARGET;
  if (fr > 0) n = Math.min(N_MAX, Math.max(n, Math.ceil((REV_MIN / fr) * fs)));
  return Math.min(T_MAX, n / fs);
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

  // 메인 FFT는 서버(TQL FFT) — 위 원시 구간과 같은 창·같은 시점.
  // 전대역(Nyquist)까지 받아 둔다 → 표시는 기본 dispHz까지만, 전대역 토글 시 재조회 없이 즉시 펼침.
  try {
    const sp = await DB.fftSpectrum(eq.table, eq.name, end - winSec * 1000, end, 1, nyqHz);
    const fmags = dispUnit !== natUnit ? VC.convertSpectrumMags(sp.mags, sp.freqs, natUnit, dispUnit) : sp.mags; // 스펙트럼도 표시 물리량으로
    det.fft = { freqs: sp.freqs, mags: fmags, res: sp.res, markers: liveMarkers(eq, nyqHz), dispHz, nyqHz };
  } catch (e) { det.fft.markers = liveMarkers(eq, nyqHz); det.fft.dispHz = dispHz; det.fft.nyqHz = nyqHz; }
  // 스펙트럼 패턴 분석(하모닉 열·측대역) — 단일 피크 대조 보강
  det.spectral = det.fft.freqs.length ? VC.analyzeSpectrum(det.fft.freqs, det.fft.mags, fr, bfTop) : { notes: [], cause: null };

  if (anaVals.length) {
    // 커토그램 — 가장 충격성이 강한 대역을 자동 탐색해 포락선 복조 대역으로 사용(고정 대역보다 정확)
    const kg = VC.kurtogram(anaVals, fs);
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
    const env = VC.envelopeSpectrum(anaVals, fs, envMax, kg && kg.best);
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

    // 스펙트로그램 (STFT) — 기본(dispHz)+전대역(nyqHz) 두 그리드를 미리 계산해 토글이 즉시 되게
    det.spectro = VC.stftGrid(anaVals, fs, dispHz, 22, 52);
    det.spectroFull = (nyqHz > dispHz * 1.05) ? VC.stftGrid(anaVals, fs, nyqHz, 22, 52) : det.spectro;

    // 시간영역 지표 (표시 물리량 기준)
    det.indics = VC.timeIndics(anaVals, dispUnit);
    // 밴드 커토시스 — 회전 성분 제거 후 고주파 임펄스성(베어링·기어 결함 특이도↑)
    const loHz = Math.min(fs * 0.3, Math.max(500, 8 * fr));
    det.bandKurt = VC.bandKurtosis(anaVals, fs, loHz);
  }

  // 켑스트럼 — 서버 FFT 스펙트럼의 log-FFT (quefrency ms)
  if (det.fft.freqs.length) {
    const cep = VC.cepstrumFromSpectrum(det.fft.mags, det.fft.res, 100);
    det.cepstrum = {
      freqs: cep.freqs, mags: cep.mags,
      markers: fr > 0 ? [{ freq: 1000 / fr, label: '1/1×', kind: 'f' }] : [],
      note: '하모닉·측대역의 간격을 quefrency(ms)로 표시 · 1/1× = ' + (1000 / fr).toFixed(1) + ' ms 라모닉 확인',
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
