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

export function emptyDet(eq) {
  return {
    raw: { times_ms: [], values: [], fs: eq.fs || 0 },
    fft: { freqs: [], mags: [], markers: [], res: 1 },
    envelope: { freqs: [], mags: [], markers: [], hint: '', fault: false },
    cepstrum: { freqs: [], mags: [], markers: [], note: '' },
    spectro: { grid: [], rows: 0, cols: 0, fmax: 0 },
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

// 상세분석 상세 데이터 — 파형·FFT(서버) + 포락선·켑스트럼·스펙트로그램(클라이언트 계산)
export async function liveDetail(E, eq) {
  const det = emptyDet(eq);
  const end = eq.lastSeen;
  const fs = Math.max(1, eq.fs || 1);
  const highFs = fs > 8000;
  const fr = eq.rpm / 60;
  const bfTop = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
  const maxHz = Math.max(50, Math.min(1000, Math.floor(fs * 0.45)));

  // 분석용 원시 구간(전체 해상도) — 스펙트럼 파생 계산의 입력
  const anaSec = highFs ? 1 : 8;
  let ana = { times_ms: [], values: [] };
  try { ana = await DB.rawWindow(eq.table, eq.name, end - anaSec * 1000, end, 0); } catch (e) { /* 없음 */ }

  // 표시용 파형 (≤6000pt 다운샘플)
  if (ana.values.length) {
    const stride = Math.max(1, Math.ceil(ana.values.length / 6000));
    const t = [], v = [];
    for (let i = 0; i < ana.values.length; i += stride) { t.push(ana.times_ms[i]); v.push(ana.values[i]); }
    det.raw = { times_ms: t, values: v, fs };
  }

  // 메인 FFT는 서버(TQL FFT) — 해상도 확보용으로 조금 긴 창
  const fftSec = highFs ? 2 : 8;
  try {
    const sp = await DB.fftSpectrum(eq.table, eq.name, end - fftSec * 1000, end, 1, maxHz);
    det.fft = { freqs: sp.freqs, mags: sp.mags, res: sp.res, markers: liveMarkers(eq, maxHz) };
  } catch (e) { det.fft.markers = liveMarkers(eq, maxHz); }
  // 스펙트럼 패턴 분석(하모닉 열·측대역) — 단일 피크 대조 보강
  det.spectral = det.fft.freqs.length ? VC.analyzeSpectrum(det.fft.freqs, det.fft.mags, fr, bfTop) : { notes: [], cause: null };

  if (ana.values.length) {
    // 포락선 스펙트럼 (정류 신호 저주파 복조 — 베어링 결함 반복 주파수)
    const envMax = Math.min(500, fs * 0.4);
    const env = VC.envelopeSpectrum(ana.values, fs, envMax);
    const bf = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    const envDx = env.freqs.length ? VC.diagnoseDominant(env.freqs, env.mags, fr, bf) : null;
    det.envelope = {
      freqs: env.freqs, mags: env.mags,
      markers: liveMarkers(eq, envMax).filter(m => m.kind === 'fq' || m.label === '1×'),
      fault: !!(envDx && envDx.cause),
      hint: envDx && envDx.hit
        ? '포락선 지배 주파수 ' + envDx.domF.toFixed(1) + ' Hz — ' + envDx.hit + ' (' + (envDx.cause || '') + ')'
        : '정류(|x|) 신호의 저주파 스펙트럼 · 베어링 결함의 충격 반복 주파수를 복조해 표시',
    };

    // 스펙트로그램 (STFT)
    det.spectro = VC.stftGrid(ana.values, fs, maxHz, 22, 52);

    // 시간영역 지표
    det.indics = VC.timeIndics(ana.values, eq.unit);
    // 밴드 커토시스 — 회전 성분 제거 후 고주파 임펄스성(베어링·기어 결함 특이도↑)
    const loHz = Math.min(fs * 0.3, Math.max(500, 8 * fr));
    det.bandKurt = VC.bandKurtosis(ana.values, fs, loHz);
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
  const chunkSec = fs > 8000 ? 0.2 : 1;
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
