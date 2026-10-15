// 실데이터 어댑터 — cgi-bin의 db(DB 연동)·calc(계산)를 UI 모델로 조립하는 얇은 층
// SQL/HTTP·수학은 cgi-bin 담당, 여기는 화면 모델(equipment/det/trend) 조립만
import DB from '../../../cgi-bin/db/db.js';
import VC from '../../../cgi-bin/calc/calc.js';
import Band from '../../../cgi-bin/monitor/band.js';

// 표시 상한(권장) — 병목은 서버 상시감시(monitor.tql)
const TAGS_PER_TABLE = 60;   // 테이블당 태그 상한
const MAX_EQUIPMENT = 100;   // 전체 설비 상한
const TAG_SCAN_MAX = 100000; // 상한 판정용 전체 조회 — 조회 뒤 상한 적용해야 누락 수 집계 가능
export const CAPS = { perTable: TAGS_PER_TABLE, total: MAX_EQUIPMENT };
/* 판정 앵커 스윕 개수 — 늘리면 짧은 이상 누락은 줄지만 조회가 선형 증가 */
const SWEEP_N = 8;
const ROLLUP_BUCKETS = 720;  // 트렌드 목표 버킷 수
const TREND_CHUNKS = 24;     // 첨도·대역에너지 추이 샘플 청크 수
/* 주파수 대역 8칸 색 — 칸마다 하나(VC.BAND_FREQ 순서), 한 차트에 함께 그려져 겹치면 구분 불가 */
const BAND_COLOR = ['#4199ff', '#2fb7a6', '#e5646a', '#8b7ff0', '#fdb532', '#e27bc4', '#8fc93a', '#b07b4f'];
/* 포락선 계열 — 대역(주파수축)과 다른 계통(복조 스펙트럼), 같은 차트에서 점선으로 구분 */
const ENV_COLOR = ['#9aa4b2', '#d9534f', '#c77dff', '#2a9d8f'];
const ENV_DASH = [5, 3];

// db.js 재노출 — app.js가 데이터 진입점을 이 파일 하나로 유지
export const listTagTables = DB.listTagTables;
export const tagSchemas = DB.tagSchemas;
export const loadConfig = DB.loadConfig;
export const saveConfig = DB.saveConfig;
export const saveConfigPartial = DB.saveConfigPartial;
export const rollupBatch = DB.rollupBatch;
export const listTags = DB.listTags;
export const tagStats = DB.tagStats;
export const rollupTrend = DB.rollupTrend;
export const rawWindow = DB.rawWindow;   // 원시 파형 구간(분석 창·추이 청크·ISO 계산 공용)
// 상시감시 영속화 — 이벤트·판정상태·베이스라인(판정은 app._judgeLive)
export const ensureMonTables = DB.ensureMonTables;
export const loadEvents = DB.loadEvents;
export const loadEventsRange = DB.loadEventsRange;
export const countEvents = DB.countEvents;
export const runTql = DB.tql; // 알림 발송용 — 서버에서 $.request 실행(브라우저 직접 POST는 CORS·시크릿 노출)
export const loadBaselines = DB.loadBaselines;
export const saveBaseline = DB.saveBaseline;
export const deleteBaseline = DB.deleteBaseline;
export const insertEvent = DB.insertEvent;
export const insertBandPoint = DB.insertBandPoint;
export const loadMonState = DB.loadMonState;
export const saveMonState = DB.saveMonState;
// 신원 — JWT sub는 식별용, 실제 실행 계정은 whoami()로 확인
export const jwtUser = DB.jwtUser;
export const sessionJwt = DB.sessionJwt;
export const whoami = DB.whoami;
export const setUser = DB.setUser;
export const getUser = DB.getUser;
export const configDir = DB.configDir;
export const migrateConfigToDb = DB.migrateConfigToDb;
export const checkAppDb = DB.checkAppDb;
export const setupSql = DB.setupSql;
export const createAppDb = DB.createAppDb;
export const appDb = DB.appDb;
export const storePrefix = DB.storePrefix;
export const listUsers = DB.listUsers;
export const grantTo = DB.grantTo;
export const revokeFrom = DB.revokeFrom;
export const accessStatus = DB.accessStatus;
export const userKeyPrefix = DB.userKeyPrefix;
export const configTable = DB.configTable;
export const srcMapOf = DB.srcMapOf;
export const onAuthFail = DB.onAuthFail;

// 서버 상시감시 — 판정 TQL 파일 + Neo 타이머 주기 실행(앱 없이 감시)
export const pkgBase = DB.pkgBase;
export const createMonitorTimer = DB.createMonitorTimer;
export const timerStates = DB.timerStates;
// 타이머 이름은 계정 확정 후 결정 — 상수로 내보내면 로드 시점 값에 고정됨
export const monTimer = DB.monTimer;
export const bandTimer = DB.bandTimer;
export const wdTimer = DB.wdTimer;
export const deleteWdTimer = DB.deleteWdTimer;
export const createBandTimer = DB.createBandTimer;
export const deleteBandTimer = DB.deleteBandTimer;
export const bandTrend = DB.bandTrend;
export const bandBackfill = DB.bandBackfill;
export const bandTimes = DB.bandTimes;
export const bandRaw = DB.bandRaw;
export const bandLatest = DB.bandLatest;
// 앵커 시점 대역값 룩백 — 서버 감시 기본 대역 룩백과 동일(추출 주기보다 넉넉해야 앵커 누락 없음)
const BAND_AT_LOOKBACK_MS = 7200000;
export const deleteMonitorTimer = DB.deleteMonitorTimer;
// 데이터 관리(설정) — 패키지가 만든 테이블의 현황·삭제 전 건수
export const usageStats = DB.usageStats;
export const countRange = DB.countRange;
export const tagUsage = DB.tagUsage;
export const deleteEventsRange = DB.deleteEventsRange;
export const deleteEventsOfTag = DB.deleteEventsOfTag;
export const deleteBandRange = DB.deleteBandRange;
export const deleteBandOfTag = DB.deleteBandOfTag;
export const deleteMonState = DB.deleteMonState;
/* 리포트 저장 경로 — 워크스페이스 루트 /<계정 소문자>/vibration-reports/(패키지 업데이트에 안 지워짐), 계정 미확정이면 REPORT_ROOT */
export const REPORT_ROOT = '/vibration-reports';   // 계정 구분 없는 평면 경로
export function reportDir() {
  const u = DB.getUser();
  return u ? '/' + u.toLowerCase() + '/vibration-reports' : REPORT_ROOT;
}
export const ensureDir = DB.ensureDir;
export const saveFile = DB.saveFile;
export const listDir = DB.listDir;
export const deleteFile = DB.deleteFile;
export const readFileBlob = DB.readFileBlob;
// 리포트에 내장할 차트 엔진 소스 (cgi-bin은 정적 차단이라 파일 API로 읽음 — 배포본과 항상 동일)
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

// 실데이터로 화면 data 객체 조립(테스트용 tools/mock.js generateData와 같은 모양)
export async function buildLiveData(E, tables, cfg) {
  cfg = cfg || {};
  const equipment = [];
  let nowMs = 0;
  /* 상한에 걸려 빠진 태그 집계 — 화면 경고용 + _catalogTick이 잘린 태그를 새 태그로 오인해 재적재 반복하는 것 방지(droppedKeys)
     상한은 태그 목록 전부 받은 뒤 적용(전체 수 집계) */
  const cap = { perTable: [], dropped: 0, droppedKeys: {}, eligible: 0, shown: 0, byTotal: false };
  /* 목록·통계 조회 실패 테이블 — 그 태그들이 결과에서 빠지므로 호출측에 반환(재적재는 이전 데이터 유지 후 재시도) */
  const failed = [];

  for (const table of tables) {
    let tags, stats;
    try { tags = await DB.listTags(table, TAG_SCAN_MAX); } catch (e) { failed.push(table); continue; }
    try { stats = await DB.tagStats(table); } catch (e) { failed.push(table); continue; }
    // 데이터 없는 태그는 상한과 무관하게 제외 — 잘린 것으로 세지 않음
    const cands = tags.filter(t => { const st = stats[t]; return st && st.count && st.maxMs; });
    const room = Math.max(0, MAX_EQUIPMENT - equipment.length);
    const take = Math.min(cands.length, TAGS_PER_TABLE, room);
    cap.eligible += cands.length;
    cap.shown += take;
    if (take < cands.length) {
      const byTotal = room < Math.min(cands.length, TAGS_PER_TABLE); // 테이블당 상한이 아니라 전체 상한에 걸림
      cap.perTable.push({ table, shown: take, total: cands.length, byTotal });
      cap.dropped += cands.length - take;
      if (byTotal) cap.byTotal = true;
      for (const t of cands.slice(take)) cap.droppedKeys[table + ':' + t] = 1;
    }
    for (const tag of cands.slice(0, take)) {
      const st = stats[tag];
      nowMs = Math.max(nowMs, st.maxMs);
      const id = table + ':' + tag;
      const spanSec = Math.max(1, (st.maxMs - st.minMs) / 1000);
      const cls = (cfg.equipCls || {})[id] || 'II'; // 판정 폴백 (UI 표시는 미선택)
      const unit = (cfg.equipUnit || {})[id] || 'mm/s';
      const model = (cfg.equipBearing || {})[id] || ''; // 미지정이면 결함주파수 마커 없음
      // 직접 입력은 저장된 형상(품번 name 포함), 빠진 칸은 0
      const geo = model ? (VC.BEARINGS[model] || Object.assign({ n: 0, Bd: 0, Pd: 0, phi: 0 }, (cfg.equipGeo || {})[id] || {})) : { n: 0, Bd: 0, Pd: 0, phi: 0 };
      // 계측·구동 메타 — 전부 선택. 없으면 엔진이 해당 후보를 "볼 수 없음"으로 처리(0점 아님)
      const meta = Object.assign({ lineHz: Number(cfg.lineHz) || 60 }, (cfg.equipMeta || {})[id] || {});
      const rpmIn = Number((cfg.equipRpm || {})[id]) || 0;
      // 센서 축 회전수 한 곳에서 — 감시·상세·리포트·서버·LLM이 모두 eq.rpm을 씀
      const sh = VC.shaftRpm(rpmIn, meta);
      equipment.push({
        id, table, name: tag, alias: (cfg.aliases || {})[id] || tag,
        unit, cls, baseCls: cls,
        /* 회전수 추측 금지 — 폴백값은 극수가 다른 설비에서 결함주파수 격자·대역 경계가 통째로 어긋남
           미입력은 0 → 회전수 의존 축이 "측정 불가"로 빠짐. rpmMotor = 입력값(벨트 진단용) */
        rpm: sh.rpm, rpmMotor: rpmIn, rpmSrc: sh.src,
        bearing: Object.assign({ model }, geo),
        meta,
        fault: null,
        fs: Math.round(st.count / spanSec),
        stat: st, lastSeen: st.maxMs,
        rms: 0, sparkVals: [], spark: { line: '', area: '' },
        rollup: [], rollupStepSec: 3600, rollupLabel: UNIT_LABEL.hour,
        zones: VC.zonesFor(unit, cls), grade: 0,
      });
    }
  }
  if (!equipment.length) return { now: 0, equipment: [], events: [], reports: [], cap, failed };

  /* 트렌드·스파크는 NAME IN 배치 조회(태그별 개별 조회는 서버 직렬 처리로 태그 수 비례 지연)
     묶음 단위 = (테이블 × 롤업단위) — 단위는 태그별 데이터 기간으로 정해져 같은 테이블 안에서도 다를 수 있음 */
  const groups = {};
  const sparkBy = {};   // 테이블별 스파크 기준 시각(가장 최근 데이터) — 직전 60초를 초 버킷으로
  for (const eq of equipment) {
    const st = eq.stat;
    const spanSec = Math.max(1, (st.maxMs - st.minMs) / 1000);
    const unit = pickRollupUnit(spanSec);
    eq._unit = unit;
    eq._span = spanSec;
    // rollup 미지원(폴백) 테이블은 원본 스캔이라 행 예산(약 5백만)으로 조회 구간을 캡
    eq._capSec = Math.max(300, Math.round(5e6 / Math.max(1, eq.fs)));
    eq._from = Math.max(st.minMs, st.maxMs - ROLLUP_BUCKETS * UNIT_SEC[unit] * 1000);
    const k = eq.table + '|' + unit;
    const g = groups[k] || (groups[k] = { table: eq.table, unit, eqs: [], from: Infinity, to: 0, capSec: Infinity });
    g.eqs.push(eq);
    g.from = Math.min(g.from, eq._from);
    g.to = Math.max(g.to, st.maxMs);
    g.capSec = Math.min(g.capSec, eq._capSec);   // 폴백 캡은 묶음 내 최솟값
    sparkBy[eq.table] = Math.max(sparkBy[eq.table] || 0, st.maxMs);
  }

  const jobs = [];
  for (const g of Object.values(groups)) {
    const names = g.eqs.map(e => e.name);
    jobs.push((async () => {
      let unit = g.unit, stepSec = UNIT_SEC[unit], from = g.from;
      let byTag;
      try {
        byTag = await DB.rollupBatch(g.table, names, unit, from, g.to, { truncCapMs: g.capSec * 1000 });
        // 폴백이 확인되면(스캔 캡 적용) 캡 구간 기준으로 단위 재선정 → 버킷 밀도 복구
        if (DB.isNoRollup(g.table)) {
          const unit2 = pickRollupUnit(Math.min(g.eqs[0]._span, g.capSec));
          if (unit2 !== unit) {
            unit = unit2; stepSec = UNIT_SEC[unit];
            from = Math.max(g.from, g.to - Math.min(g.capSec, ROLLUP_BUCKETS * stepSec) * 1000);
            byTag = await DB.rollupBatch(g.table, names, unit, from, g.to, { truncCapMs: g.capSec * 1000 });
          }
        }
      } catch (e) { byTag = {}; }
      const label = DB.isNoRollup(g.table) ? UNIT_LABEL[unit] + ' · 원본 집계'
        : UNIT_LABEL[unit];   // ' · 자동' 접미는 화면(detSpec) 담당 — 중복 금지
      g.eqs.forEach(eq => {
        // 묶음 창은 태그별 창의 합집합 — 자기 구간 이전 버킷 제거
        const cut = Math.max(from, eq._from);
        eq.rollup = (byTag[eq.name] || []).filter(b => b.ms >= cut);
        eq.rollupStepSec = stepSec;
        eq.rollupLabel = label;
      });
    })());
  }
  for (const table of Object.keys(sparkBy)) {
    const anchor = sparkBy[table];
    const eqs = equipment.filter(e => e.table === table);
    jobs.push((async () => {
      let byTag;
      try { byTag = await DB.rollupBatch(table, eqs.map(e => e.name), 'sec', anchor - 60000, anchor, { truncCapMs: 60000 }); }
      catch (e) { byTag = {}; }
      /* 샘플레이트 추정 — 1순위 표본 간격(Δt) 중앙값("초당 행 수"는 주기 기록·중복 적재에서 틀림)
         폴백: 초당 버킷 건수 중앙값 → 전체 평균(count/span) */
      await Promise.all(eqs.map(async eq => {
        const spark = byTag[eq.name] || [];
        eq.sparkBuf = spark;   // 카드 스파크라인 최근 60초 — 판정 틱이 이어 붙임
        eq.sparkVals = spark.map(b => b.rms);
        const st = eq.stat;
        // 조회 실패 시 폴백으로 진행(태그 하나의 실패가 적재 전체를 막지 않게)
        let times = null;
        try { times = await DB.sampleTimes(eq.table, eq.name, st.maxMs - 1000, st.maxMs, 2000); } catch (e) { times = null; }
        const fsDt = times ? VC.fsFromTimes(times) : 0;
        if (fsDt > 0) { eq.fs = fsDt; return; }
        const cnts = spark.map(b => b.cnt).filter(c => c > 0).sort((a, b) => a - b);
        if (cnts.length >= 5) eq.fs = cnts[Math.floor(cnts.length / 2)];
      }));
    })());
  }
  await Promise.all(jobs);

  /* 마무리(조회 없음, 값 조립만) — 스파크가 빈 태그(테이블 기준 시각보다 한참 뒤처진 정지 태그)는 트렌드 꼬리로 대체 */
  equipment.forEach(eq => {
    if (!eq.sparkVals || !eq.sparkVals.length) eq.sparkVals = eq.rollup.slice(-36).map(b => b.rms);
    eq.rms = eq.sparkVals.length ? eq.sparkVals[eq.sparkVals.length - 1] : (eq.rollup.length ? eq.rollup[eq.rollup.length - 1].rms : 0);
    eq.spark = E.sparkPath(eq.sparkVals.length ? eq.sparkVals : [0, 0], 132, 40, 3);
    eq.grade = VC.gradeFor(eq.rms, eq.zones);
    delete eq._unit; delete eq._span; delete eq._capSec; delete eq._from;
  });

  return { now: nowMs, equipment, events: [], reports: [], cap, failed };
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
    isoRms: null, isoRaw: null, anaSec: 0, frMeas: null, envQ: null, bearMatch: null, sideband: null, demodSrc: '', acq: null, bandAt: null,
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

// 분석 창(초) — 데시메이션 후 16k 블록 50% 중첩 ANA_BLOCKS개 길이, RPM 있으면 REV_TARGET 회전까지 상향 · 상한 T_MAX초·N_MAX 샘플
const ANA_BLOCK_N = 16384;   // 분석기 관례: 블록당 샘플 수(6,400 라인)
const ANA_BLOCKS = 8;        // 평균 블록 수(50% 중첩)
const ANA_DEC_FS = 3000;     // 차수 해석용 목표 데시메이션 레이트(≥1 kHz 대역 확보)
function anaWindowSec(fs, rpm) {
  /* N_MAX = 대역통과 FFT가 쓰는 2의 거듭제곱 상한(더 받으면 잘려 버려짐)
     ⚠더 늘리지 말 것 — 창이 길수록 서로 다른 운전 상태가 섞여 정상상태 전제가 깨짐 */
  /* REV_TARGET — 포락선 측대역 분해에 필요한 회전 수(샘플 수 고정이면 설비마다 회전 수가 달라짐)
     저속 설비는 T_MAX에 걸려 못 채울 수 있음(정상상태 우선) */
  const T_MAX = 22, REV_TARGET = 100, N_MAX = 1 << 19;
  const fr = rpm > 0 ? rpm / 60 : 0;
  const dec = Math.max(1, Math.floor(fs / ANA_DEC_FS));
  // 데시메이션 후 16k 블록 하나가 차지하는 원시 구간 × 중첩 개수
  const blockSec = (ANA_BLOCK_N * dec) / fs;
  let sec = blockSec * (1 + (ANA_BLOCKS - 1) * 0.5);
  if (fr > 0) sec = Math.max(sec, REV_TARGET / fr);
  sec = Math.min(T_MAX, sec, N_MAX / fs);
  return sec;
}

/* 기간 내 판정 앵커 후보 스윕 — 끝 한 점만 보면 그 순간이 정지·무부하일 때 파손 중이어도 양호로 나옴
   기간을 N등분해 각 점의 판정 재료만 반환(등급은 존·임계를 가진 화면 쪽에서) */
export async function sweepAnchors(E, eq, fromMs, toMs, n) {
  const fsz = Math.max(1, eq.fs || 1);
  const fr = eq.rpm / 60;
  const natUnit = eq.unit || 'mm/s';
  const winSec = anaWindowSec(fsz, eq.rpm);
  const N = Math.max(2, Math.min(16, n || SWEEP_N));
  const lo = Math.max(fromMs, (eq.stat && eq.stat.minMs) || fromMs);
  const hi = Math.min(toMs, (eq.lastSeen || toMs) + 1);
  if (!(hi > lo)) return { anchors: [], scanned: 0 };
  const bf = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;

  /* 후보 시각 = 각 조각의 끝(시작점이면 조각 데이터를 못 봄), 마지막 후보 = 기간 끝 앵커 */
  const times = [];
  for (let i = 1; i <= N; i++) times.push(Math.round(lo + (hi - lo) * (i / N)));

  const out = [];
  const seen = {};
  for (let i = 0; i < times.length; i++) {
    let at = times[i];
    let w = { values: [] };
    try { w = await DB.rawWindow(eq.table, eq.name, at - winSec * 1000, at, 0); } catch (e) { /* 아래에서 되짚음 */ }
    /* liveDetail과 같은 되짚기 — 간헐 수집에서 후보 시각이 수집 공백이면 창이 빔
       하한은 조각의 시작(더 물리면 앞 조각과 중복 집계) */
    if (!w.values.length) {
      const segLo = i === 0 ? lo : times[i - 1];
      try {
        const lastMs = await DB.lastSampleMs(eq.table, eq.name, segLo, at);
        if (lastMs != null) {
          at = lastMs + 1000;
          w = await DB.rawWindow(eq.table, eq.name, at - winSec * 1000, at, 0);
        }
      } catch (e) { /* 되짚기 실패는 무시 */ }
    }
    if (!w.values.length) { out.push({ at, empty: true }); continue; }
    if (seen[at]) continue;   // 되짚기가 같은 표본으로 모이면 한 번만 집계
    seen[at] = 1;
    const v = w.values;
    let m = 0; for (let j = 0; j < v.length; j++) m += v[j]; m /= v.length;
    let ss = 0; for (let j = 0; j < v.length; j++) { const d = v[j] - m; ss += d * d; }
    const acRms = Math.sqrt(ss / v.length);
    const vel = natUnit === 'mm/s' ? v : VC.convertDomain(v, fsz, natUnit, 'mm/s', fr);
    const isoRms = VC.bandRmsAveraged(vel, fsz, 10, 1000, 8).rms;
    let patScore = 0, patKey = '';
    if (bf) {
      const band = VC.demodFixed(fsz);
      if (band) {
        const env = VC.envelopeSpectrum(v, fsz, VC.envMaxFor(bf, fr, fsz), band);
        const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
        if (t) { patScore = t.r || 0; patKey = t.key || ''; }
      }
    }
    out.push({ at, acRms, isoRms, patScore, patKey, n: v.length, quality: VC.signalQuality(v, fsz, fr) });
  }
  return { anchors: out, scanned: out.length, winSec };
}

/* 감시용 결함 패턴 한 태그 — 상세분석(liveDetail)의 축소판(채택 여부만)
   MON_REV 회전 원시 파형 → 포락선 → 격자 대조까지만. 창이 비면 liveDetail·sweepAnchors와 같은 되짚기 */
export async function monPattern(eq, atMs) {
  const fs_ = Math.max(1, eq.fs || 1), fr = eq.rpm / 60;
  if (!(fr > 0) || !(eq.bearing && eq.bearing.n > 0)) return null;   // 회전수·기하 없으면 격자 불가
  /* 고정 대역(1–5 kHz)이 Nyquist 밖이면 전대역 복조(상세분석과 같은 규칙) — demodSrc로 근거 약함 표시 */
  const band = VC.demodFixed(fs_) || null;
  const bf = VC.bearingFreqs(eq.rpm, eq.bearing);
  /* 필요 표본 수 기준 — 벽시계 밀도가 fs와 다른 태그(타임스탬프가 퍼진 적재·재생 데이터)는 시간 창만으로 표본 부족
     시간 창으로 먼저 읽고 모자라면 창을 넓혀 재조회 */
  const need = Math.max(4096, Math.round(fs_ * VC.MON_REV / fr));
  const secs = Math.min(22, VC.MON_REV / fr);
  let end = atMs || eq.lastSeen || Date.now();
  const grab = async (sec) => { try { return await DB.rawWindow(eq.table, eq.name, end - sec * 1000, end, 0); } catch (e) { return { values: [] }; } };
  let w = await grab(secs);
  if (!w.values.length) {
    try {
      const last = await DB.lastSampleMs(eq.table, eq.name, end - 6 * 3600000, end);
      if (last != null) { end = last + 1000; w = await grab(secs); }
    } catch (e) { /* 되짚기 실패는 무시 */ }
  }
  /* 창 확장은 최대 2회 — 창이 길수록 서로 다른 운전 상태가 섞여 정상상태 전제가 깨짐 */
  for (let k = 0; k < 2 && w.values.length && w.values.length < need; k++) {
    const wide = Math.min(600, secs * Math.ceil(need / Math.max(1, w.values.length)) * 1.2);
    const w2 = await grab(wide);
    if (w2.values.length <= w.values.length) break;
    w = w2;
  }
  if (w.values.length < 4096) return null;
  if (w.values.length > need) w = { values: w.values.slice(w.values.length - need) };   // 최신 쪽 사용
  const env = VC.envelopeSpectrum(w.values, fs_, VC.envMaxFor(bf, fr, fs_), band);
  const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
  const r = t ? (t.r || 0) : 0;
  /* 등급 높이용 ISO도 같은 파형에서 측정 — 한 등급은 한 시점에서(10초 축 ISO와 10분 주기 패턴의 시간축 불일치 방지) */
  let isoRms = null;
  try {
    const vel = (eq.unit === 'mm/s') ? w.values : VC.convertDomain(w.values, fs_, eq.unit || 'mm/s', 'mm/s', fr);
    isoRms = VC.bandRmsAveraged(vel, fs_, 10, 1000, 8).rms;
  } catch (e) { /* 측정 실패 시 null — 호출측이 높이 0으로 처리 */ }
  // 상세와 같은 검출기 — 창이 MON_REV 회전이라 임계만 MON_ADOPT
  return { on: VC.patternGrade(r, false, VC.MON_ADOPT) > 0, r: r, key: t ? t.key || '' : '', at: end, n: w.values.length, iso: isoRms,
    demodSrc: band ? 'fixed' : 'wideband' };
}

// 상세분석 상세 데이터 — 파형·FFT(서버) + 포락선·켑스트럼·스펙트로그램(클라이언트 계산)
// anchorMs: 분석 기준점(선택 기간의 끝·이벤트 시각), 없으면 최신 데이터(eq.lastSeen)
// fromMs: 앵커 스냅의 하한 = 선택 기간의 시작(밖으로 물리면 선택 구간 아닌 파형 표시)
export async function liveDetail(E, eq, anchorMs, viewUnit, fromMs) {
  const det = emptyDet(eq);
  const fs = Math.max(1, eq.fs || 1);
  let end = anchorMs || eq.lastSeen; // 추세 구간의 끝(또는 이벤트 시각)에 스펙트럼 정렬
  const fr = eq.rpm / 60;
  const natUnit = eq.unit || 'mm/s';
  const dispUnit = (viewUnit && ['g', 'mm/s', 'μm'].indexOf(viewUnit) >= 0) ? viewUnit : natUnit; // 표시 물리량
  det.dispUnit = dispUnit; det.natUnit = natUnit;
  det.anchorMs = end;   // 이 상세의 기준 시점 — 판정·latch 시각은 이 값 사용(기간과 일치)
  const bfTop = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
  const nyqHz = Math.max(50, Math.floor(fs * 0.45)); // 물리 상한(Nyquist 마진) = 전대역
  // 기본 표시 상한: 설비 맞춤 — 회전수(25×)·베어링(3×BPFI) 필요만큼, 최소 1kHz, Nyquist로 캡
  // 전대역 토글로 nyqHz까지 펼침
  const dispHz = Math.max(50, Math.min(nyqHz, Math.max(1000, 25 * fr, 3 * (bfTop ? bfTop.BPFI : 0))));

  // 분석용 원시 구간 — 파형·포락선·스펙트로그램·지표 공용(같은 시점)
  const winSec = anaWindowSec(fs, eq.rpm);
  let ana = { times_ms: [], values: [] };
  try { ana = await DB.rawWindow(eq.table, eq.name, end - winSec * 1000, end, 0); } catch (e) { /* 없음 */ }

  /* 창이 비면 표본이 있는 마지막 초까지 1회 되짚기(간헐 수집에서 앵커가 수집 공백에 떨어지는 경우)
     하한은 선택 기간의 시작 — 구간 안에 표본이 없으면 빈 채로(화면 배너 표시) */
  const searchFrom = (fromMs != null && isFinite(fromMs)) ? fromMs : ((eq.stat && eq.stat.minMs) || end);
  if (!ana.values.length && searchFrom < end) {
    try {
      const lastMs = await DB.lastSampleMs(eq.table, eq.name, searchFrom, end);
      if (lastMs != null && lastMs + 1000 < end) {
        end = lastMs + 1000; // 초 버킷 시작 → 그 1초를 통째로 포함
        ana = await DB.rawWindow(eq.table, eq.name, end - winSec * 1000, end, 0);
      }
    } catch (e) { /* 되짚기 실패 시 빈 창 그대로 진행 */ }
  }
  // 신호 품질 체크 — 원시(변환 전) 신호 기준. garbage-in 방어 배너용
  if (ana.values.length) det.quality = VC.signalQuality(ana.values, fs, fr);

  // 3도메인 종합 레벨(RMS) — 원시 신호를 가속도/속도/변위로 변환해 각 RMS. "에너지가 어느 도메인에 있나" 표지용
  if (ana.values.length) {
    const rmsOf = function (a) { let n = a.length, m = 0, i; for (i = 0; i < n; i++) m += a[i]; m /= n; let ss = 0; for (i = 0; i < n; i++) { const dd = a[i] - m; ss += dd * dd; } return Math.sqrt(ss / n); };
    const lv = {};
    ['g', 'mm/s', 'μm'].forEach(function (uu) { const v = uu === natUnit ? ana.values : VC.convertDomain(ana.values, fs, natUnit, uu, fr); lv[uu] = rmsOf(v); });
    det.levels = lv;
    det.levelsBandHz = [0, Math.round(fs * 0.5)]; // 광대역(전대역) 변환값임을 라벨로 명시
    det.anaSec = ana.values.length / fs; // 분석 창 길이(초) — 원시파형 RMS와 롤업 평균 차이 설명 라벨용

    // ── 저주파 분석 파이프라인(단일 소스) ──────────────────────────────────────
    // ISO 판정·대역 RMS·차수 피크·1× 실측을 같은 시계열·같은 방법으로(파이프라인이 섞이면 부분 대역 > 전체 대역 검산 실패)
    const velVals = natUnit === 'mm/s' ? ana.values : VC.convertDomain(ana.values, fs, natUnit, 'mm/s', fr);
    // ISO 10816 = 10–1000 Hz 대역제한 속도 RMS · 정상상태 충분 평균(단일 블록 금지)
    const isoAvg = VC.bandRmsAveraged(velVals, fs, 10, 1000, 8);
    det.isoRms = isoAvg.rms;
    // 표시용 — 같은 대역·같은 방법의 원본 단위 RMS(가속도·변위 설비는 존 판정만 속도 환산)
    det.isoRaw = natUnit === 'mm/s' ? isoAvg.rms : VC.bandRmsAveraged(ana.values, fs, 10, 1000, 8).rms;
    det.isoBlocks = isoAvg.blocks;
    det.isoSpread = isoAvg.spread; // 블록 간 변동 — 정상상태 여부(변동 크면 규격 전제 미충족)
    // 대역 RMS 집합 — ISO와 같은 대역제한 RMS라 제곱합이 전체와 정합(Parseval 자기검사)
    if (fr > 0) {
      // 대역 5개를 FFT 한 번으로(bandRms 반복 호출 시 같은 신호를 5번 FFT)
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
      // 자기검사: 부분 대역 제곱합 ≈ 전체 대역(2–10 Hz 제외분만큼 약간 작을 수 있음)
      det.parseval = { sumSq, isoRms: det.isoRms, relErr: rel, ok: rel < 0.03 };
      if (!det.parseval.ok) console.warn('[vibe] 대역 분해 검증 실패', det.parseval);
      // 가속도 물리 상한 검산 — 각 대역 에너지를 대역 최고 주파수에 몰아 미분 이득 최대화한 값(초과 = 미분·양자화 잡음 수치)
      // ⚠상한은 Nyquist까지 덮을 것 — 1 kHz에서 끊으면 정당한 고주파 성분도 위반 처리
      const nyq = _nyq0;
      const vhigh = _br[4];   // 위 bandRmsMulti에서 함께 구한 1kHz~Nyquist 대역
      det.bandSet.vhigh = vhigh;
      const capF = [Math.max(3, 0.5 * fr), 1.5 * fr, Math.min(1000, 10 * fr), 1000, nyq];
      const parts = [bset.sub, bset.one, bset.fault, bset.high, vhigh];
      let accCap = 0;
      parts.forEach(function (r, i) { const a = 2 * Math.PI * capF[i] * (r * 1e-3); accCap += a * a; });
      det.accelBound = Math.sqrt(accCap) / 9.80665; // g 단위 상한(전대역)
      // ⚠상한 비교는 정의상 거의 항상 통과 — 판별은 가속도 에너지 중심 주파수 f_eff = a / (2π·v_high)
      //   Nyquist 근접 = AA 필터 부재·센서 공진 폴딩·미분 증폭
      det.accelRatio = det.accelBound > 0 ? lv['g'] / det.accelBound : 0;
      det.accelFeff = vhigh > 0 ? (lv['g'] * 9.80665) / (2 * Math.PI * (vhigh * 1e-3)) : 0;
      det.accelNyqFrac = nyq > 0 ? det.accelFeff / nyq : 0;
      // 감시(광대역) 등급이 '게재 보류된 >1kHz 대역'에 얼마나 기대는지 — 잠정 표기의 근거
      var vbb = lv['mm/s'] || 0;
      det.hfEnergyFrac = vbb > 0 ? Math.min(1, (vhigh * vhigh) / (vbb * vbb)) : 0;
      det.velExHigh = Math.sqrt(Math.max(0, vbb * vbb - vhigh * vhigh));
      // 에너지 중심 > Nyquist의 80%면 물리 신호로 보기 어려움 → 값 게재 보류
      det.levelsOk = !(det.accelNyqFrac > 0.8) && !(lv['g'] > det.accelBound * 1.05);
    }
    // 차수 해석용 Welch 평균 스펙트럼 — 대역제한 후 데시메이션(폴딩 방지) → 블록 평균
    const anaBand = VC.bandpassSignal(velVals, fs, 1, Math.min(1200, fs * 0.4));
    const dec = Math.max(1, Math.floor(fs / ANA_DEC_FS));
    const loVals = VC.decimate(anaBand, dec), fsLo = fs / dec;
    // 블록 = 관례 16,384 샘플, 데이터 부족 시 가진 길이에서 최대 블록
    const blkN = Math.min(ANA_BLOCK_N, Math.max(1024, Math.floor(loVals.length / 1.5)));
    /* 정상상태 가드 — 블록별 RMS 변동이 크면(서로 다른 운전 상태) 앞쪽 절반만 평균(평균 횟수보다 정상상태 전제 우선) */
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

  /* 앵커 시점의 대역·포락선 값 — 헤드라인 등급이 선택 기간을 따르도록 대역 축도 그 시점 기준(최신값 아님) */
  try {
    const _bk = VC.BAND_ORDER.map((bn) => eq.table + ':' + eq.name + ':' + bn);
    const _bv = await DB.bandLatest(_bk, end - BAND_AT_LOOKBACK_MS, end);
    const _at = {};
    VC.BAND_ORDER.forEach((bn) => {
      const v2 = _bv[eq.table + ':' + eq.name + ':' + bn];
      if (v2 != null && isFinite(v2)) _at[bn] = v2;
    });
    det.bandAt = Object.keys(_at).length ? _at : null;
  } catch (e) { det.bandAt = null; }

  // 표시용 메인 FFT는 서버(TQL FFT) — 분석 창의 끝에 맞춰 같은 시점
  // ⚠분석 창 전체를 쓰면 포인트 수 폭증(리포트 비대·캔버스 렌더 실패) → 16k 블록 한 개 길이로 제한(판정은 det.ordSpec 담당)
  const fftSec = Math.min(winSec, ANA_BLOCK_N / fs);   // 16,384 샘플 = 6,400 라인(분석기 관례)
  try {
    const sp = await DB.fftSpectrum(eq.table, eq.name, end - fftSec * 1000, end, 1, nyqHz);
    const fmags = dispUnit !== natUnit ? VC.convertSpectrumMags(sp.mags, sp.freqs, natUnit, dispUnit) : sp.mags; // 스펙트럼도 표시 물리량으로 변환
    det.fft = { freqs: sp.freqs, mags: fmags, res: sp.res, markers: liveMarkers(eq, nyqHz), dispHz, nyqHz };
  } catch (e) { det.fft.markers = liveMarkers(eq, nyqHz); det.fft.dispHz = dispHz; det.fft.nyqHz = nyqHz; }
  /* 1× 실측 — 입력 RPM ±5% 창의 유의 피크(슬립 ≤5%), Welch 평균 스펙트럼
     · 바닥 배수 4, 계통주파수 겹침 거부 · 분해능 = 불확도 → tol 함께 실음 */
  const oSpec = det.ordSpec;
  det.frMeas = oSpec ? VC.measuredOneX(oSpec.freqs, oSpec.mags, fr, 5, (eq.meta || {}).lineHz || 60, oSpec.resTrue || oSpec.res, 4) : null;
  if (det.frMeas) {
    var uncHz = oSpec.resTrue || oSpec.res || 0;   // 창 길이가 정하는 실제 분해능 = 불확도
    det.frMeas.tolHz = uncHz;
    det.frMeas.rpmTol = uncHz * 60;
    det.frMeas.distinct = Math.abs(det.frMeas.f - fr) > uncHz;
  }
  // 스펙트럼 패턴 분석(하모닉 열·측대역) — _evidence와 같은 스펙트럼(ordSpec)·같은 1× 기준(지배 차수 이중 표기 방지)
  const frUseSpec = (det.frMeas && det.frMeas.f) || fr;
  det.spectral = (det.ordSpec && det.ordSpec.freqs.length)
    ? VC.analyzeSpectrum(det.ordSpec.freqs, det.ordSpec.mags, frUseSpec, bfTop)
    : (det.fft.freqs.length ? VC.analyzeSpectrum(det.fft.freqs, det.fft.mags, frUseSpec, bfTop) : { notes: [], cause: null });
  // 스펙트럼 취득 조건 — 창·분해능·윈도우·평균 횟수(측대역 부재·실측 회전수 주장의 한계)
  det.acq = {
    winSec: winSec, window: 'Hann', overlapPct: 50,
    blockSec: oSpec ? 1 / (oSpec.resTrue || oSpec.res || 1) : 0,   // 블록 길이 = 1/실제분해능
    res: oSpec ? (oSpec.resTrue || oSpec.res) : (det.fft.res || 0),  // 차수 해석 실제 분해능(창 길이 기준)
    resBin: oSpec ? oSpec.res : (det.fft.res || 0),                  // 제로패딩 후 빈 간격(표시용)
    averages: oSpec ? oSpec.blocks : 1,                    // 차수 해석 평균 블록 수
    dispRes: det.fft.res || 0,                             // 표시 FFT(서버) 분해능 — 단일 블록
    dispSec: fftSec,                                       // 표시 FFT 창(분석 창과 다름)
    isoBlocks: det.isoBlocks || 0,
  };

  if (anaVals.length) {
    // 고주파 작업(커토그램·스펙트로그램·밴드커토시스)은 대역이 관건 — 계산량 억제 위해 앞부분(HF_MAX)만
    // 포락선은 회전 수 확보 위해 ENV_MAX_N까지 사용(자르면 저속 설비 손해)
    /* 판정 입력은 자연 단위(센서 원단위) — 표시 단위 변환(적분·미분)이 들어가면 화면 토글이 결함 등급을 바꿈
       파형·스펙트로그램은 표시 단위 그대로 */
    const natWin = ana.values;
    const HF_MAX = 65536;
    const hfVals = anaVals.length > HF_MAX ? anaVals.slice(0, HF_MAX) : anaVals;        // 스펙트로그램(표시)
    const hfNat = natWin.length > HF_MAX ? natWin.slice(0, HF_MAX) : natWin;            // 커토그램(판정 후보)
    const ENV_MAX_N = 1 << 19;
    const envVals = natWin.length > ENV_MAX_N ? natWin.slice(0, ENV_MAX_N) : natWin;    // 포락선(판정)
    // 커토그램 — 가장 충격성 강한 대역 탐색·표시용(복조 대역으로는 미사용)
    // 마운팅 상한 초과 대역은 스캔 제외(마운팅 공진)
    const mFmax = VC.mountFmax(eq.meta && eq.meta.mount);
    det.mount = (eq.meta && eq.meta.mount) || '';
    det.mountFmax = mFmax;
    /* 에일리어싱 상한(마운팅과 별개) — f_eff > Nyquist의 80%면 AA 필터 불신 → 탐색 상한을 Nyquist 절반으로 */
    const nyqHzA = fs / 2;
    const aliasSuspect = det.accelNyqFrac > 0.8;
    const aFmax = aliasSuspect ? nyqHzA * 0.5 : 0;
    /* 안티에일리어싱 롤오프 상한 — 항상 적용(실수 대역통과 첨도가 톤 없는 저지대역을 고르는 문제 방지) */
    const rFmax = nyqHzA * VC.KG_NYQ_FRAC;
    const caps = [mFmax, aFmax, rFmax].filter((x) => x > 0);
    const kFmax = caps.length ? Math.min.apply(null, caps) : 0;
    det.aliasFmax = aFmax;
    det.rollFmax = rFmax;
    det.kgFmax = kFmax;
    det.kgCapSrc = kFmax === 0 ? ''
      : (kFmax === aFmax ? 'alias' : (kFmax === mFmax ? 'mount' : 'rolloff'));
    const kg = VC.kurtogram(hfNat, fs, kFmax);
    det.kgCapped = !!(kg && kg.capped);
    if (kg && kg.best) {
      const lv = kg.levels.filter(l => l.nb === kg.best.nb)[0] || kg.levels[kg.levels.length - 1];
      const bw = kg.fmax / lv.nb;
      det.kurtogram = {
        freqs: lv.sk.map((_, i) => (i + 0.5) * bw), mags: lv.sk, res: bw, best: kg.best, fmax: kg.fmax,
        markers: [{ freq: kg.best.center, label: '최적', kind: 'f' }],
      };
    }

    /* 포락선 스펙트럼 — 고정 대역(1~5 kHz) 복조
       · 결함주파수·측대역 간격은 명판 RPM 기준(실측 1×는 분해능만큼 흔들려 BPFI 배수에서 허용오차 이탈) */
    const bfEnv = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    const envMax = VC.envMaxFor(bfEnv, fr, fs);   // 고속 기계 BPFI 2차까지 담는 상한
    const fixBand = VC.demodFixed(fs);
    // 고정 대역 불성립(5 kHz > Nyquist)이면 전대역 복조 — demodSrc='wideband'로 근거 약함 표시
    const demod = fixBand || null;
    det.demodSrc = fixBand ? 'fixed' : 'wideband';
    const env = VC.envelopeSpectrum(envVals, fs, envMax, demod);
    const bf = bfEnv;
    const envDx = env.freqs.length ? VC.diagnoseDominant(env.freqs, env.mags, fr, bf) : null;
    const bandTxt = demod
      ? ' · 복조 대역 ' + fmtHz(demod.loHz) + '–' + fmtHz(demod.hiHz) + '(고정)'
      : ' · 복조 대역 없음 — 샘플레이트 ' + fmtHz(fs) + '로는 고정 대역(1–5 kHz)이 성립하지 않아 전대역으로 복조합니다';
    det.envelope = {
      freqs: env.freqs, mags: env.mags, res: env.res,   // res: 결함주파수 대조 허용오차의 하한
      markers: liveMarkers(eq, envMax).filter(m => m.kind === 'fq' || m.label === '1×'),
      fault: !!(envDx && envDx.cause),
      hint: (envDx && envDx.hit
        ? '포락선 지배 주파수 ' + envDx.domF.toFixed(1) + ' Hz — ' + envDx.hit + ' (' + (envDx.cause || '') + ')'
        : '해석 신호(|z|) 포락선의 저주파 스펙트럼 · 충격 반복 주파수 복조') + bandTxt,
    };
    // 포락선 정량 — 반복주파수·하모닉 수·1× 측대역. 하모닉≥2 = 일관된 반복 충격
    det.envQ = VC.envelopeQuant(env.freqs, env.mags, fr);
    // 결함주파수 대조(표적 우선 targetedMatch → bearingMatch) — negatives는 음성 소견으로 인쇄
    // 포락선 분해능 함께 전달(허용오차 하한)
    const _frUse = fr;   // 명판 — 스윕과 같은 기준
    const _resU = env.resTrue || env.res;
    det.sideband = bf ? VC.targetedMatch(env, bf, _frUse, _resU) : null;
    det.bearMatch = VC.bearingMatch(det.envQ, bf, _frUse, _resU, det.sideband);

    // 스펙트로그램 (STFT) — 기본(dispHz)+전대역(nyqHz) 두 그리드 선계산(토글 즉시 반영)
    det.spectro = VC.stftGrid(hfVals, fs, dispHz, 22, 52);
    det.spectroFull = (nyqHz > dispHz * 1.05) ? VC.stftGrid(hfVals, fs, nyqHz, 22, 52) : det.spectro;

    // 시간영역 지표 (표시 물리량 기준)
    det.indics = VC.timeIndics(anaVals, dispUnit);
    // 밴드 커토시스 — 회전 성분 제거 후 고주파 임펄스성(베어링·기어 결함 특이도↑)
    const loHz = Math.min(fs * 0.3, Math.max(500, 8 * fr));
    /* 밴드 커토시스도 판정 입력이라 자연 단위(convertDomain은 주파수 의존 적분·미분이라 파형 모양이 바뀜) */
    det.bandKurt = VC.bandKurtosis(hfNat, fs, loHz);
  }

  // 켑스트럼 — 서버 FFT 스펙트럼의 log-FFT (quefrency ms)
  if (det.fft.freqs.length) {
    const cep = VC.cepstrumFromSpectrum(det.fft.mags, det.fft.res, 100);
    // 라모닉 피크 검출 여부를 문구에 표기(마커 ≠ 피크 존재)
    // 기준 1×는 실측 우선, 없으면 명판 기준임을 문구에 명시
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
        + (det.frMeas ? '실측 1× 기준' : eq.rpmSrc === 'pulley' ? '종동축 1×(풀리 환산) 기준' : eq.rpmSrc === 'measured' ? '종동축 1×(입력값) 기준' : '명판 1× 기준') + ') — 해당 quefrency 하모닉 '
        + (found ? '검출됨(중앙값 4배 초과)' : '미검출'),
    };
  }

  return det;
}

// 첨도·대역 에너지 추이 — 트렌드 구간을 등분한 원시 청크 샘플링으로 계산
export async function loadTrendChunks(E, eq, roll) {
  if (!roll.length) return { kurt: [], bands: [], xLabels: null };
  const fs = Math.max(1, eq.fs || 1);
  const chunkSec = Math.min(1, Math.max(0.1, 4096 / fs)); // 청크당 ~4,096 샘플(첨도 통계 안정)
  const fr = eq.rpm / 60;
  const fromMs = roll[0].ms, toMs = roll[roll.length - 1].ms;
  const n = Math.min(TREND_CHUNKS, roll.length);
  const kurt = [], xLabels = [], xTips = [], times = [];
  const bandVals = VC.BAND_FREQ.map(() => []);
  const jobs = [];
  const step = n > 1 ? (toMs - fromMs) / (n - 1) : 0;
  /* 간헐 수집 대응 — 앵커가 비면 이전의 표본 있는 마지막 초로 당겨 측정
     하한은 직전 앵커까지(더 가면 앵커끼리 같은 구간 중복). 빈 앵커에서만 조회 */
  const grab = async (at) => {
    let w = null;
    try { w = await DB.rawWindow(eq.table, eq.name, at - chunkSec * 1000, at + 1000, 0); } catch (e) { /* 아래에서 되짚음 */ }
    if (w && w.values.length >= 64) return { at, w };
    const lo = Math.max(fromMs, at - (step || (toMs - fromMs)));
    let snapped = null;
    try { snapped = await DB.lastSampleMs(eq.table, eq.name, lo, at); } catch (e) { /* 없음 */ }
    if (!snapped) return { at, w: w || { values: [], failed: true } };
    try {
      const w2 = await DB.rawWindow(eq.table, eq.name, snapped - chunkSec * 1000, snapped + 1000, 0);
      return { at: snapped, w: w2 };
    } catch (e) { return { at: snapped, w: { values: [], failed: true } }; }
  };
  for (let i = 0; i < n; i++) {
    jobs.push(grab(fromMs + (toMs - fromMs) * (n === 1 ? 1 : i / (n - 1))));
  }
  const chunks = await Promise.all(jobs);
  /* 실패 사유 집계 — 조회 실패·데이터 없음·표본 부족은 사용자 조치가 다름(재시도 / 기간 변경 / 센서 사양) */
  let cErr = 0, cEmpty = 0, cFew = 0;
  chunks.forEach(({ w }) => {
    if (w.failed) cErr++;
    else if (!w.values.length) cEmpty++;
    else if (w.values.length < 64) cFew++;
  });
  chunks.forEach(({ at, w }) => {
    if (w.values.length < 64) return;

    // 알람과 같은 함수로 계산(값이 두 벌이면 알람·차트 불일치)
    const be = Band.bandEnergy(w.values, fs, fr, fs / 2, { lineHz: (eq.meta || {}).lineHz || 60 });
    /* 대역 에너지는 창당 256샘플 필요, 첨도는 64샘플 — 대역 불가여도 첨도는 유지, 대역만 null(x축 길이 맞춤) */
    kurt.push(VC.kurtosis(w.values));
    if (be) be.vals.forEach((v, i) => bandVals[i].push(v));
    else bandVals.forEach((a) => a.push(null));
    xLabels.push(E.fmtMD(at));
    xTips.push(E.fmtDT(at));
    times.push(at); // 시간축 배치용 (청크 실제 시각 — 부족 청크는 건너뛰어 값 배열과 길이 일치)
  });
  /* 포락선 계열은 서버 저장값 읽기(재계산하면 판정값과 화면값이 두 벌)
     저장 간격이 청크보다 성김 → 청크 시각마다 가장 가까운 값, gapMs 넘게 떨어지면 null(없는 구간 연결 방지) */
  const envBands = [];
  if (times.length) {
    const key = eq.table + ':' + eq.name;
    const gapMs = Math.max(600000, (toMs - fromMs) / Math.max(1, times.length));
    const rows = await Promise.all(VC.BAND_ORDER.slice(VC.BAND_FREQ.length).map((bn) =>
      DB.bandTrend(key + ':' + bn, eq._unit || 'min', fromMs, toMs).catch(() => [])));
    rows.forEach((series, i) => {
      if (!series.length) return;   // 품번 미지정·추출 미사용 — 계열 없음
      const bn = VC.BAND_ORDER[VC.BAND_FREQ.length + i];
      let p = 0;
      const vals = times.map((t) => {
        while (p + 1 < series.length && Math.abs(series[p + 1].ms - t) <= Math.abs(series[p].ms - t)) p++;
        return Math.abs(series[p].ms - t) <= gapMs ? series[p].v : null;
      });
      if (vals.some((v) => v != null)) envBands.push({ key: bn, label: VC.BAND_KO[bn] || bn, color: ENV_COLOR[i % ENV_COLOR.length], dash: ENV_DASH, vals });
    });
  }
  /* 빈 차트 사유 반환 — 요구 표본 수가 달라(첨도 64 · 대역 FFT 256) 차트별로 따로 */
  const fsTxt = Math.round(fs) + ' Hz';
  const winSec = chunkSec + 1; // rawWindow 창 = [at-chunkSec, at+1s]
  const kurtNote = kurt.length ? ''
    : cErr >= n / 2
      ? '원시 데이터 조회에 실패했습니다 (' + cErr + '/' + n + ' 지점) — 잠시 후 새로고침하세요.'
      : cEmpty >= cFew
        /* 대부분 지점이 빔 = 데이터가 구간 일부에만 있음 → 구간 좁히기 안내 */
        ? '선택 구간의 ' + cEmpty + '/' + n + ' 지점에 원시 파형이 없습니다 — 데이터가 있는 구간으로 좁혀 보세요.'
        : '표본이 부족해 계산할 수 없습니다 — 분석 창(' + winSec.toFixed(1) + '초)당 64샘플이 필요한데 이 태그는 약 ' + fsTxt + '입니다.';
  const bandHas = bandVals.some((a) => a.some((v) => v != null));
  const bandNote = (bandHas || envBands.length) ? ''
    : (kurt.length
      ? '샘플레이트가 낮아 대역 분석을 할 수 없습니다 — 대역 FFT에는 분석 창당 256샘플이 필요한데 이 태그는 약 ' + fsTxt + '입니다(최소 128 Hz).'
      : kurtNote);
  return {
    kurtNote, bandNote,
    kurt,
    // key 포함 — 배수 축 표시 시 계열 베이스라인 조회용(라벨은 한글이라 불가)
    bands: VC.BAND_FREQ.map((bn, i) => ({ key: bn, label: VC.BAND_KO[bn] || bn, color: BAND_COLOR[i % BAND_COLOR.length], vals: bandVals[i] }))
      .concat(envBands),
    xLabels, xTips, times,
  };
}
