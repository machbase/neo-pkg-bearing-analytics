// 실데이터 어댑터 — cgi-bin의 db(DB 연동)·calc(계산)를 UI 모델로 조립하는 얇은 층.
// SQL/HTTP와 수학은 전부 cgi-bin에 있고, 여기는 화면 모델(equipment/det/trend) 조립만 담당한다.
import DB from '../../../cgi-bin/db/db.js';
import VC from '../../../cgi-bin/calc/calc.js';
import Band from '../../../cgi-bin/monitor/band.js';

/* 표시 상한 — 병목은 앱이 아니라 서버 상시감시(monitor.tql)다. 앱 판정 틱은 배치 조회라 여유롭지만,
   서버 TQL은 태그마다 문장을 실행하고 경보 구간의 태그는 ISO 대역제한까지 계산해 훨씬 비싸다.
   넘치면 죽는 대신 회차를 건너뛰고 경고하므로(monitor.js) 이 값은 "안전 한계"가 아니라 "권장 상한"이다.
   실제 소요는 설치마다 다르다 — 서버가 회차 소요를 심박(__hb.ms)에 남기고, 주기의 70%를 넘으면 화면이 경고한다. */
const TAGS_PER_TABLE = 60;   // 테이블당 태그 상한
const MAX_EQUIPMENT = 100;   // 전체 설비 상한
const TAG_SCAN_MAX = 100000; // 상한 판정용 전체 조회 — 상한을 조회 뒤에 적용해야 몇 개가 빠졌는지 셀 수 있다
export const CAPS = { perTable: TAGS_PER_TABLE, total: MAX_EQUIPMENT };
/* 판정 앵커 스윕 개수 — 8개면 6일 구간에서 18시간 간격이다. 늘리면 짧은 이상을
   놓칠 확률이 줄지만 조회가 선형으로 는다(개당 약 34 ms). */
const SWEEP_N = 8;
const ROLLUP_BUCKETS = 720;  // 트렌드 목표 버킷 수
const TREND_CHUNKS = 24;     // 첨도·대역에너지 추이 샘플 청크 수
// 대역 계열 색 — BAND_FREQ 순서. 저주파에서 고주파로 갈수록 따뜻한 쪽으로 옮겨 간다
const BAND_COLOR = ['#4199ff', '#2fb7a6', '#e5646a', '#8b7ff0', '#fdb532'];
/* 포락선 계열은 대역과 다른 계통의 값이라(주파수축이 아니라 복조 스펙트럼) 색도 갈라 둔다 —
   같은 팔레트를 돌려 쓰면 범례에서 "고주파"와 "BPFO"가 같은 색으로 나와 축이 같은 줄로 읽힌다. */
const ENV_COLOR = ['#9aa4b2', '#d9534f', '#c77dff', '#2a9d8f'];

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
export const pkgBase = DB.pkgBase;
export const createMonitorTimer = DB.createMonitorTimer;
export const timerStates = DB.timerStates;
export const MON_TIMER = DB.MON_TIMER;
export const BAND_TIMER = DB.BAND_TIMER;
export const WD_TIMER = DB.WD_TIMER;
export const createWdTimer = DB.createWdTimer;
export const deleteWdTimer = DB.deleteWdTimer;
export const createBandTimer = DB.createBandTimer;
export const deleteBandTimer = DB.deleteBandTimer;
export const bandTrend = DB.bandTrend;
export const bandBackfill = DB.bandBackfill;
export const bandTimes = DB.bandTimes;
export const bandRaw = DB.bandRaw;
export const bandLatest = DB.bandLatest;
// 앵커 시점 대역값 룩백 — 서버 감시의 기본 대역 룩백과 같다(추출 주기보다 넉넉해야 앵커를 놓치지 않는다)
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
  /* 상한에 걸려 빠진 태그를 센다. 잘린 사실을 안 올리면 두 가지가 조용히 깨진다:
     ① 사용자는 화면에 없는 태그를 "감시 중인데 정상"으로 읽는다
     ② _catalogTick이 잘린 태그를 매번 '새 태그'로 보고 재적재를 무한 반복한다(droppedKeys가 그 판단 근거다).
     상한은 태그 목록을 다 받은 뒤에 적용한다 — 미리 자르면 전체가 몇 개인지 알 수 없다. */
  const cap = { perTable: [], dropped: 0, droppedKeys: {}, eligible: 0, shown: 0, byTotal: false };

  for (const table of tables) {
    let tags, stats;
    try { tags = await DB.listTags(table, TAG_SCAN_MAX); } catch (e) { continue; } // META 없으면 스킵
    try { stats = await DB.tagStats(table); } catch (e) { stats = {}; }
    // 데이터가 없는 태그는 상한과 무관하게 원래 빠진다 — 잘린 것으로 세면 헛경고가 된다
    const cands = tags.filter(t => { const st = stats[t]; return st && st.count && st.maxMs; });
    const room = Math.max(0, MAX_EQUIPMENT - equipment.length);
    const take = Math.min(cands.length, TAGS_PER_TABLE, room);
    cap.eligible += cands.length;
    cap.shown += take;
    if (take < cands.length) {
      const byTotal = room < Math.min(cands.length, TAGS_PER_TABLE); // 테이블당 상한이 아니라 전체 상한에 걸렸다
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
      const geo = model ? (VC.BEARINGS[model] || Object.assign({}, (cfg.equipGeo || {})[id] || { n: 0, Bd: 0, Pd: 0, phi: 0 })) : { n: 0, Bd: 0, Pd: 0, phi: 0 };
      equipment.push({
        id, table, name: tag, alias: (cfg.aliases || {})[id] || tag,
        unit, cls, baseCls: cls,
        /* 회전수를 추측하지 않는다 — 폴백 1800(60Hz 4극)을 넣으면 2극(3600)·6극(1200) 설비에서
           결함주파수 격자와 대역 경계(0.5×·1.5×·10×)가 통째로 어긋나는데 화면은 평소처럼 등급을 낸다.
           자동 실측 보정은 ±12%만 뒤지므로 1800↔3600은 절대 안 붙는다.
           이 패키지는 불평형·정렬불량을 "0점"이 아니라 "측정 불가"로 내는데, 회전수만 조용히
           추측하면 그 원칙을 스스로 깬다. 0으로 두면 회전수 의존 축이 스스로 빠진다. */
        rpm: Number((cfg.equipRpm || {})[id]) || 0,
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
  if (!equipment.length) return { now: 0, equipment: [], events: [], reports: [], cap };

  /* 트렌드·스파크는 테이블 단위로 한 번에 받는다.
     태그별 개별 조회 대신 NAME IN 배치로 받는다 — 동시에 수백 쿼리가 나가면 서버가 직렬로
     소화하느라 벽시계가 태그 수에 비례해 늘어난다.
     묶음 단위는 (테이블 × 롤업단위) — 단위는 태그의 데이터 기간에서 정해지므로,
     한 테이블 안에서도 어제 붙은 태그와 한 달 된 태그는 단위가 다를 수 있다. */
  const groups = {};
  const sparkBy = {};   // 테이블별 스파크 기준 시각(가장 최근 데이터) — 초 버킷 36개
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
    g.capSec = Math.min(g.capSec, eq._capSec);   // 폴백 캡은 묶음에서 가장 빡빡한 값을 따른다
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
        : UNIT_LABEL[unit];   // ' · 자동' 접미는 화면(detSpec)이 붙인다 — 중복 금지
      g.eqs.forEach(eq => {
        // 묶음 창은 태그별 창의 합집합이라, 자기 구간보다 앞선 버킷이 섞여 올 수 있다
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
      try { byTag = await DB.rollupBatch(table, eqs.map(e => e.name), 'sec', anchor - 36000, anchor, { truncCapMs: 60000 }); }
      catch (e) { byTag = {}; }
      /* 샘플레이트 추정 — 표본 간격(Δt)의 중앙값이 1순위다.

         "초당 행 수"는 기록 밀도라 센서가 얼마나 빠르게 재는지와 다른 양이다: 주기 기록이면
         과소로, 같은 구간이 두 번 적재되면 과대로 나온다 — 둘 다 ISO 대역제한·밴드패스 설계를 통째로 어긋나게 한다.

         Δt를 못 구하면(표본이 얇은 태그) 초당 버킷 건수의 중앙값, 그것도 안 되면 이미 넣어 둔
         전체 평균(count/span) 순으로 물러난다 — 새 조회가 실패해도 옛 동작을 잃지 않게. */
      await Promise.all(eqs.map(async eq => {
        const spark = byTag[eq.name] || [];
        eq.sparkVals = spark.map(b => b.rms);
        const st = eq.stat;
        const fsDt = VC.fsFromTimes(await DB.sampleTimes(eq.table, eq.name, st.maxMs - 1000, st.maxMs, 2000));
        if (fsDt > 0) { eq.fs = fsDt; return; }
        const cnts = spark.map(b => b.cnt).filter(c => c > 0).sort((a, b) => a - b);
        if (cnts.length >= 5) eq.fs = cnts[Math.floor(cnts.length / 2)];
      }));
    })());
  }
  await Promise.all(jobs);

  /* 마무리는 조회가 없다 — 값 조립만 한다.
     스파크가 빈 태그(테이블 기준 시각보다 한참 뒤처진 정지 태그)는 트렌드 꼬리로 대신한다. */
  equipment.forEach(eq => {
    if (!eq.sparkVals || !eq.sparkVals.length) eq.sparkVals = eq.rollup.slice(-36).map(b => b.rms);
    eq.rms = eq.sparkVals.length ? eq.sparkVals[eq.sparkVals.length - 1] : (eq.rollup.length ? eq.rollup[eq.rollup.length - 1].rms : 0);
    eq.spark = E.sparkPath(eq.sparkVals.length ? eq.sparkVals : [0, 0], 132, 40, 3);
    eq.grade = VC.gradeFor(eq.rms, eq.zones);
    delete eq._unit; delete eq._span; delete eq._capSec; delete eq._from;
  });

  return { now: nowMs, equipment, events: [], reports: [], cap };
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
    isoRms: null, anaSec: 0, frMeas: null, envQ: null, bearMatch: null, sideband: null, demodSrc: '', acq: null, bandAt: null,
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
     2^19면 20초급 창에 16k 블록 7회 평균이 들어가고, 분해능은 블록 크기가 정하므로 그대로다.
     ⚠더 늘리지 않는 이유 — 창이 길어질수록 정상상태 전제가 깨져, 평균 횟수는 늘어도
     서로 다른 운전 상태가 섞여 결과가 흐려진다. */
  /* REV_TARGET — 포락선 측대역을 분해하려면 회전을 충분히 봐야 한다.
     샘플 수를 고정하면 데이터셋·설비마다 회전수가 달라진다(64 kHz에서 65,536샘플이면
     1500 rpm은 26회전인데 900 rpm은 15회전뿐이다). 공개셋 554케이스 실측에서
     100회전 기준으로 잡으면 정상 오탐 4%→2%, 종류 적중 93%→95%였다.
     저속 설비는 T_MAX에 걸려 100회전을 못 채운다 — 그건 감수한다(창이 길어지면 정상상태가 깨진다). */
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

/* 기간 안에서 판정에 쓸 앵커 후보들을 훑는다.
   창의 끝 한 점으로 등급을 내면 그 순간이 정지·무부하일 때 설비가 파손 중이어도 양호가 나온다.
   실측으로 확인한 사례 — NASA IMS Set2 B1은 외륜 파손으로 시험이 끝났는데 마지막 두 스냅샷이
   RMS 0.002 g(정지)였고 20분 전은 0.484 g였다. 그 정지 시점의 ISO 값은 0.01 mm/s = 양호다.
   플랫라인 게이트는 상대 기준(std < 0.002·peak)이라 조용해도 잡음 비율이 정상이면 통과시킨다.

   그래서 기간을 등분해 각 점에서 판정 재료만 뽑아 돌려준다. 등급을 여기서 매기지 않는 이유는
   존·임계가 화면 쪽(설비 클래스·베이스라인)에 있어서다 — 재는 곳과 판정하는 곳을 갈라 둔다.
   앵커 하나당 실측 34 ms(포락선이 대부분)라 8개면 300 ms 안쪽이다. */
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

  /* 후보 시각은 구간을 N등분한 각 조각의 끝 — 시작점을 쓰면 조각의 데이터를 하나도 못 본다.
     마지막 후보가 곧 지금까지 쓰던 앵커라, 이 스윕은 옛 동작을 포함한다(나빠질 수 없다).

     ⚠ 롤업 RMS로 "시끄러운 곳"을 지명해 섞는 안을 재고 되물렸다(2026-08-20). 결함 근거는
     확실히 진해졌지만(6.8일 외륜 전 기간 결함점수 2.2→29.0) **오탐이 같이 올라간다** —
     잘 찾을수록 건전 설비의 가장 큰 순간 전이를 찾게 된다. 같은 오탐률(60%)에 맞추면
     균등 89% vs 지명혼합 72%로 균등이 이긴다. 지속성 요건(K곳 이상 도달)으로 오탐을 눌러도
     단발로 서는 진짜 결함이 같이 죽는다(내륜 s1-c5: 심각→양호).
     다시 시도하기 전에 docs/scope.kr.md "시도했다가 물린 것"을 볼 것. */
  const times = [];
  for (let i = 1; i <= N; i++) times.push(Math.round(lo + (hi - lo) * (i / N)));

  const out = [];
  const seen = {};
  for (let i = 0; i < times.length; i++) {
    let at = times[i];
    let w = { values: [] };
    try { w = await DB.rawWindow(eq.table, eq.name, at - winSec * 1000, at, 0); } catch (e) { /* 아래에서 되짚는다 */ }
    /* liveDetail과 같은 되짚기 — 간헐 수집(예: 10분마다 1초)에서는 후보 시각이 수집 공백에
       떨어지는 것만으로 창이 통째로 빈다. 스윕에 이게 없으면 후보 대부분이 빈 채로 버려져
       "기간을 훑었다"는 말이 거짓이 된다(실측: 23분 간격 태그에서 8개 중 7개가 빔).
       하한은 조각의 시작 — 더 뒤로 물리면 앞 조각의 데이터를 다시 보게 되어 같은 점이 두 번 센다. */
    if (!w.values.length) {
      const segLo = i === 0 ? lo : times[i - 1];
      try {
        const lastMs = await DB.lastSampleMs(eq.table, eq.name, segLo, at);
        if (lastMs != null) {
          at = lastMs + 1000;
          w = await DB.rawWindow(eq.table, eq.name, at - winSec * 1000, at, 0);
        }
      } catch (e) { /* 되짚기 실패는 치명적이지 않다 */ }
    }
    if (!w.values.length) { out.push({ at, empty: true }); continue; }
    if (seen[at]) continue;   // 되짚기가 같은 표본으로 모이면 한 번만 센다
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
    out.push({ at, acRms, isoRms, patScore, patKey, n: v.length, quality: VC.signalQuality(v, fsz) });
  }
  return { anchors: out, scanned: out.length, winSec };
}

/* 감시용 결함 패턴 한 태그 — 상세분석(liveDetail)의 축소판이다.
   상세는 100회전에 파형·FFT·켑스트럼·커토그램까지 전부 만드는데, 감시는 **채택 여부만** 필요하다.
   그래서 25회전 원시 파형 → 포락선 → 격자 대조까지만 하고 나머지는 안 만든다.
   창이 비면 liveDetail·sweepAnchors와 같은 되짚기를 한다 — 간헐 수집(예: 10분마다 1초)에서
   "직전 1.6초"가 수집 공백에 떨어지는 것만으로 판정이 조용히 건너뛰어진다. */
export async function monPattern(eq, atMs) {
  const fs_ = Math.max(1, eq.fs || 1), fr = eq.rpm / 60;
  if (!(fr > 0) || !(eq.bearing && eq.bearing.n > 0)) return null;   // 회전수·기하 없으면 격자를 못 세운다
  const band = VC.demodFixed(fs_);
  if (!band) return null;                                            // 샘플레이트가 낮아 고정 대역 불성립
  const bf = VC.bearingFreqs(eq.rpm, eq.bearing);
  /* 필요한 **표본 수**로 잡는다 — 시간 창으로만 잡으면 벽시계 밀도가 샘플레이트와 다른 태그에서
     표본이 모자란다(적재 시 타임스탬프가 퍼진 데이터·재생 데이터가 그렇다: 20,480 표본이
     1분에 퍼져 있으면 341/초라 0.75초 창에 256개뿐이다 — 조용히 판정이 통째로 건너뛰어진다).
     시간 창으로 먼저 읽고, 모자라면 창을 넓혀 다시 읽는다. 연속 수집 태그는 첫 번에 끝난다. */
  const need = Math.max(4096, Math.round(fs_ * VC.MON_REV / fr));
  const secs = Math.min(22, VC.MON_REV / fr);
  let end = atMs || eq.lastSeen || Date.now();
  const grab = async (sec) => { try { return await DB.rawWindow(eq.table, eq.name, end - sec * 1000, end, 0); } catch (e) { return { values: [] }; } };
  let w = await grab(secs);
  if (!w.values.length) {
    try {
      const last = await DB.lastSampleMs(eq.table, eq.name, end - 6 * 3600000, end);
      if (last != null) { end = last + 1000; w = await grab(secs); }
    } catch (e) { /* 되짚기 실패는 치명적이지 않다 */ }
  }
  /* 창을 두 번까지 넓힌다 — 밀도가 60배 낮아도 닿는다. 무한정 넓히지 않는 이유는
     창이 길어질수록 서로 다른 운전 상태가 섞여 정상상태 전제가 깨지기 때문이다. */
  for (let k = 0; k < 2 && w.values.length && w.values.length < need; k++) {
    const wide = Math.min(600, secs * Math.ceil(need / Math.max(1, w.values.length)) * 1.2);
    const w2 = await grab(wide);
    if (w2.values.length <= w.values.length) break;
    w = w2;
  }
  if (w.values.length < 4096) return null;
  if (w.values.length > need) w = { values: w.values.slice(w.values.length - need) };   // 최신 쪽을 쓴다
  const env = VC.envelopeSpectrum(w.values, fs_, VC.envMaxFor(bf, fr, fs_), band);
  const t = VC.targetedMatch(env, bf, fr, env.resTrue || env.res);
  const r = t ? (t.r || 0) : 0;
  /* 등급 높이를 정할 ISO도 **같은 파형에서** 잰다 — 10초 축의 최신 ISO를 쓰면 등급이 10초마다
     움직여, 10분 주기인 패턴과 시간축이 어긋난다. 그러면 이벤트가 어느 시점의 것인지 모호해진다.
     한 등급은 한 시점에서 나와야 한다. */
  let isoRms = null;
  try {
    const vel = (eq.unit === 'mm/s') ? w.values : VC.convertDomain(w.values, fs_, eq.unit || 'mm/s', 'mm/s', fr);
    isoRms = VC.bandRmsAveraged(vel, fs_, 10, 1000, 8).rms;
  } catch (e) { /* 못 재면 null — 호출측이 높이를 0으로 본다 */ }
  return { on: r >= VC.MON_ADOPT, r: r, key: t ? t.key || '' : '', at: end, n: w.values.length, iso: isoRms };
}

// 상세분석 상세 데이터 — 파형·FFT(서버) + 포락선·켑스트럼·스펙트로그램(클라이언트 계산)
// anchorMs: 분석 기준점(선택 기간의 끝·이벤트 시각). 없으면 최신 데이터(eq.lastSeen).
// fromMs: 앵커 스냅의 하한 = 선택 기간의 시작. 창을 이 밖으로 물리면 고른 구간이 아닌 파형을 보여주게 된다.
export async function liveDetail(E, eq, anchorMs, viewUnit, fromMs) {
  const det = emptyDet(eq);
  const fs = Math.max(1, eq.fs || 1);
  let end = anchorMs || eq.lastSeen; // 추세가 보여주는 구간의 끝(또는 이벤트 시각)에 스펙트럼을 맞춘다
  const fr = eq.rpm / 60;
  const natUnit = eq.unit || 'mm/s';
  const dispUnit = (viewUnit && ['g', 'mm/s', 'μm'].indexOf(viewUnit) >= 0) ? viewUnit : natUnit; // 표시 물리량
  det.dispUnit = dispUnit; det.natUnit = natUnit;
  det.anchorMs = end;   // 이 상세가 어느 시점을 본 것인지 — 판정·latch 시각이 이걸 써야 기간과 어긋나지 않는다
  const bfTop = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
  const nyqHz = Math.max(50, Math.floor(fs * 0.45)); // 물리 상한(Nyquist 마진) = 전대역
  // 기본 표시 상한(A): 설비 맞춤 — 회전수(25×)·베어링(3×BPFI)이 필요로 하는 만큼만, 최소 1kHz, Nyquist로 캡.
  // 대부분 1kHz(저주파 결함에 집중), 고속·고주파 결함 설비만 자동으로 넓어진다. 전대역 토글로 nyqHz까지 펼침.
  const dispHz = Math.max(50, Math.min(nyqHz, Math.max(1000, 25 * fr, 3 * (bfTop ? bfTop.BPFI : 0))));

  // 분석용 원시 구간 — 목표 16k 샘플 창(FFT·파형·포락선·스펙트로그램·켑스트럼·지표 공용, 같은 시점)
  const winSec = anaWindowSec(fs, eq.rpm);
  let ana = { times_ms: [], values: [] };
  try { ana = await DB.rawWindow(eq.table, eq.name, end - winSec * 1000, end, 0); } catch (e) { /* 없음 */ }

  /* 창이 비면 표본이 실제로 있는 마지막 초까지 한 번만 되짚는다 — 간헐 수집(예: 10분마다 1초)에서는
     앵커가 수집 공백에 떨어지는 것만으로 파형·스펙트럼이 통째로 빈다.
     되짚기는 빈 창에서만 하므로 연속 수집 태그에는 조회가 붙지 않는다.
     하한은 선택 기간의 시작 — 밖으로 나가면 고르지 않은 구간의 파형을 보여주게 되므로,
     구간 안에 표본이 정말 없으면 빈 채로 둔다(화면이 배너로 밝힌다). */
  const searchFrom = (fromMs != null && isFinite(fromMs)) ? fromMs : ((eq.stat && eq.stat.minMs) || end);
  if (!ana.values.length && searchFrom < end) {
    try {
      const lastMs = await DB.lastSampleMs(eq.table, eq.name, searchFrom, end);
      if (lastMs != null && lastMs + 1000 < end) {
        end = lastMs + 1000; // 초 버킷 시작 → 그 1초를 통째로 담는다
        ana = await DB.rawWindow(eq.table, eq.name, end - winSec * 1000, end, 0);
      }
    } catch (e) { /* 되짚기 실패는 치명적이지 않다 — 빈 창 그대로 진행 */ }
  }
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

  /* 앵커 시점의 대역·포락선 값 — 헤드라인 등급이 선택 기간을 따라가려면 대역 축도 그 시점을
     봐야 한다. 최신 값(app._bandNow)을 쓰면 기간을 과거로 옮겨도 이 축만 현재를 본다.
     룩백은 서버 감시의 기본 대역 룩백과 같게 둔다 — 추출 주기(기본 10분)보다 넉넉해야
     앵커 직전 앵커를 놓치지 않는다. */
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
    /* 커토그램은 대역마다 역FFT를 돌려 길이에 민감하므로 짧게 자른다(표시 전용이라 그래도 된다).
       포락선·측대역 경로는 회전수가 필요하므로 받은 만큼 쓴다 — 여기서 자르면 저속 설비가 손해다. */
    /* 판정에 들어가는 신호는 **자연 단위**(센서 원단위)로 간다 — anaVals는 사용자가 고른 표시
       물리량으로 변환된 것이라, g 센서를 mm/s로 보면 적분(1/ω)이 걸린 신호를 복조하게 되고
       1~5 kHz 대역에 기울기가 얹힌다. 즉 **화면 토글이 결함 등급을 바꾼다.**
       ISO 축이 velVals로 따로 가는 것과 같은 이유다. 파형·스펙트로그램은 보는 것이라 표시 단위 그대로. */
    const natWin = ana.values;
    const HF_MAX = 65536;
    const hfVals = anaVals.length > HF_MAX ? anaVals.slice(0, HF_MAX) : anaVals;        // 스펙트로그램(표시)
    const hfNat = natWin.length > HF_MAX ? natWin.slice(0, HF_MAX) : natWin;            // 커토그램(판정 후보)
    const ENV_MAX_N = 1 << 19;
    const envVals = natWin.length > ENV_MAX_N ? natWin.slice(0, ENV_MAX_N) : natWin;    // 포락선(판정)
    // 커토그램 — 가장 충격성이 강한 대역을 자동 탐색해 화면에 띄운다(복조 대역으로는 쓰지 않는다 — 아래 참조).
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
    /* 안티에일리어싱 롤오프 상한 — 설정이 아니라 신호처리에서 오는 상한이라 조건 없이 항상 건다.
       커토그램이 저지대역을 고르는 이유는 에너지가 작아서가 아니라(첨도는 척도 불변),
       첨도를 복소 포락선이 아닌 실수 대역통과 신호에 걸고 있어 톤 없는 대역이 유리해지기 때문이다.
       실측(CWRU 12 kHz 18파일): 이 상한이 없으면 전부 5813~6000 Hz를 골라 종류 적중 0/18. */
    const rFmax = nyqHzA * VC.KG_NYQ_FRAC;
    const caps = [mFmax, aFmax, rFmax].filter((x) => x > 0);
    const kFmax = caps.length ? Math.min.apply(null, caps) : 0;
    det.aliasFmax = aFmax;
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

    /* 포락선 스펙트럼 — 복조는 저역 고정 대역(1~5 kHz)에서 한다.
       커토그램은 첨도를 최대화하므로 베어링과 무관한 대역에 붙잡힌다(Nyquist 롤오프·인버터 스위칭).
       공개셋 5종 554케이스에서 커토그램 검출 11% vs 저역 고정 28%였다. 커토그램은 계속 계산해
       화면에 띄우되(어느 대역이 충격적인지는 진단 정보다) 복조 대역으로는 쓰지 않는다.
       샘플링이 낮아 고정 대역이 성립하지 않으면 커토그램으로 되돌아간다. */
    /* 결함주파수는 **명판 RPM** 위에 세운다. 1× 실측으로 갈아타면 슬립이 반영돼 좋아질 것 같지만
       실측은 반대였다 — 같은 오탐(1/124)에서 검출이 54% → 31%로 떨어졌다.
       이유: 1× 실측은 분해능만큼 흔들리는데 그 흔들림이 BPFI(≈9×)에서 9배로 증폭돼
       결함주파수가 허용오차(±1~2%)를 벗어난다. 명판은 틀려도 **일관되게** 틀려서 오히려 안정적이다.
       (NASA IMS 내륜은 실측 1×라야 말기 한 장이 잡히는데, 그 한 장을 얻자고 전체를 잃는다.)
       실측 1×(det.frMeas)는 화면 표시와 차수 라벨에만 쓴다.
       ⚠ 이 규칙이 코드에서 깨져 있었다(2026-08-20 수정) — 중심 주파수는 명판인데 측대역 간격만
       실측을 쓰는 혼합 기준이었고, 검증 하네스(verify-datasets.mjs)는 명판으로만 돌았다.
       즉 554케이스 54%가 앱의 실제 동작이 아니었다. 앵커 스윕도 명판을 쓰므로,
       앵커를 고르는 점수와 그 앵커에서 다시 내는 점수의 기준까지 어긋나 있었다. */
    const bfEnv = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    const envMax = VC.envMaxFor(bfEnv, fr, fs);   // 500 고정이면 고속 기계의 BPFI 2차가 잘려 채택이 원천 봉쇄된다
    const fixBand = VC.demodFixed(fs);
    /* 고정 대역이 성립하지 않으면(fs가 낮아 5 kHz가 Nyquist 밖) **커토그램으로 물러서지 않는다.**
       커토그램 대역으로 복조하면 검출이 12%인데 대역통과를 아예 안 걸면 43%다(fs 6.4 kHz 재현 기준).
       어설프게 고르느니 안 고르는 편이 낫다 — 그리고 이래야 커토그램이 "참고용"이라는 화면 문구에
       숨은 예외가 없어진다(전에는 저샘플 태그에서만 몰래 판정에 들어갔다).
       ⚠ 이 경로는 검증 풀에 표본이 없다(554건 중 폴백을 타는 케이스 0건) — 기존 데이터를
       6.4 kHz로 데시메이션해 비교한 값이라 실제 저샘플 장비의 잡음 특성과 같다는 보장은 없다. */
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
    // 포락선 정량 — 반복주파수·하모닉 수·1× 측대역. 하모닉≥2 = "일관된 반복 충격"(베어링 근거의 결정 검사)
    det.envQ = VC.envelopeQuant(env.freqs, env.mags, fr);
    // 결함주파수 대조 — 매칭 없이는 베어링 가점 불가. negatives(미검출)는 음성 소견으로 인쇄한다.
    // 포락선 분해능을 함께 넘긴다 — 허용오차가 빈 간격보다 좁으면 저주파(FTF)는 매칭이 불가능하다
    /* 표적 우선 대조 — 후보 자리를 각각 보러 간다. 지배 피크만 보면 포락선을 축 성분이 차지한
       순간 결함주파수를 못 본 채 떨어진다(미검출의 43%가 그 경우였다). */
    const _frUse = fr;   // 명판 — 하네스·스윕과 같은 기준(위 주석 참조)
    const _resU = env.resTrue || env.res;
    det.sideband = bf ? VC.targetedMatch(env, bf, _frUse, _resU) : null;
    det.bearMatch = VC.bearingMatch(det.envQ, bf, _frUse, _resU, det.sideband);

    // 스펙트로그램 (STFT) — 기본(dispHz)+전대역(nyqHz) 두 그리드를 미리 계산해 토글이 즉시 되게
    det.spectro = VC.stftGrid(hfVals, fs, dispHz, 22, 52);
    det.spectroFull = (nyqHz > dispHz * 1.05) ? VC.stftGrid(hfVals, fs, nyqHz, 22, 52) : det.spectro;

    // 시간영역 지표 (표시 물리량 기준)
    det.indics = VC.timeIndics(anaVals, dispUnit);
    // 밴드 커토시스 — 회전 성분 제거 후 고주파 임펄스성(베어링·기어 결함 특이도↑)
    const loHz = Math.min(fs * 0.3, Math.max(500, 8 * fr));
    /* 밴드 커토시스도 판정(impulsive)에 들어가므로 자연 단위다 — 첨도는 배율에는 불변이지만
       convertDomain은 배율이 아니라 주파수 의존 적분·미분이라 파형 모양 자체를 바꾼다. */
    det.bandKurt = VC.bandKurtosis(hfNat, fs, loHz);
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
        + (det.frMeas ? '실측 1× 기준' : '명판 1× 기준') + ') — 해당 quefrency 하모닉 '
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
  const kurt = [], xLabels = [], xTips = [], times = [];
  const bandVals = VC.BAND_FREQ.map(() => []);
  const jobs = [];
  const step = n > 1 ? (toMs - fromMs) / (n - 1) : 0;
  /* 간헐 수집(예: NASA 베어링 = 10분마다 1초)에서는 균등 간격 앵커가 거의 전부 수집 공백에 떨어진다 —
     4천만 행이 있어도 24개 지점이 모두 빈다. 앵커가 비면 그 이전에서 표본이 실제로 있는 마지막 초로
     당겨 그 자리를 잰다. 뒤지는 하한은 직전 앵커까지 — 더 가면 여러 앵커가 같은 구간을 겹쳐 재고
     추이가 같은 값의 반복이 된다. 되짚기는 빈 앵커에서만 하므로 연속 수집 태그에는 조회가 안 붙는다. */
  const grab = async (at) => {
    let w = null;
    try { w = await DB.rawWindow(eq.table, eq.name, at - chunkSec * 1000, at + 1000, 0); } catch (e) { /* 아래에서 되짚는다 */ }
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
  /* 왜 못 냈는지는 세어 두지 않으면 알 수 없다 — 조회 실패·구간에 데이터 없음·표본 수 부족은
     전부 "값이 안 나온다"로 끝나지만 사용자가 할 일은 완전히 다르다(재시도 / 기간 변경 / 센서 사양). */
  let cErr = 0, cEmpty = 0, cFew = 0;
  chunks.forEach(({ w }) => {
    if (w.failed) cErr++;
    else if (!w.values.length) cEmpty++;
    else if (w.values.length < 64) cFew++;
  });
  chunks.forEach(({ at, w }) => {
    if (w.values.length < 64) return;

    // 알람이 쓰는 바로 그 함수로 구한다 — 같은 이름의 값이 두 벌이면 "알람은 났는데 차트엔 안 보이는" 상태가 된다.
    const be = Band.bandEnergy(w.values, fs, fr, fs / 2);
    /* 대역 에너지는 FFT라 창당 256샘플이 필요하고, 첨도는 표본만 있으면 난다.
       예전엔 대역이 안 나오면 이 청크를 통째로 버려서 첨도까지 함께 사라졌다 —
       샘플레이트가 낮은 태그(예: 44 Hz)에서 두 차트가 나란히 빈 채로 뜨던 원인이다.
       계열 길이는 맞춰야 하므로(x축 공유) 대역만 null로 비운다. */
    kurt.push(VC.kurtosis(w.values));
    if (be) be.vals.forEach((v, i) => bandVals[i].push(v));
    else bandVals.forEach((a) => a.push(null));
    xLabels.push(E.fmtMD(at));
    xTips.push(E.fmtDT(at));
    times.push(at); // 시간축 배치용 (청크 실제 시각 — 데이터 부족 청크는 건너뛰므로 값 배열과 길이 일치)
  });
  /* 포락선 계열은 여기서 계산하지 않고 서버가 쌓아 둔 것을 읽는다.
     다시 계산하면 청크마다 FFT를 두 번 더 돌리는 것도 문제지만, 더 큰 문제는 값이 두 벌이 되는
     것이다 — 서버가 판정에 쓴 값과 다른 값이 화면에 그려지면 "알람은 났는데 차트엔 안 보이는" 상태가 된다.
     저장 간격이 추출 주기(10분 이상)라 청크보다 성기다. 청크 시각마다 가장 가까운 앵커를 골라
     같은 x 격자에 얹되, 한 칸 이상 떨어진 자리는 null로 비운다 — 없는 구간을 이어 그리면
     대역 추출을 켜기 전 기간까지 값이 있는 것처럼 보인다. */
  const envBands = [];
  if (times.length) {
    const key = eq.table + ':' + eq.name;
    const gapMs = Math.max(600000, (toMs - fromMs) / Math.max(1, times.length));
    const rows = await Promise.all(VC.BAND_ORDER.slice(VC.BAND_FREQ.length).map((bn) =>
      DB.bandTrend(key + ':' + bn, eq._unit || 'min', fromMs, toMs).catch(() => [])));
    rows.forEach((series, i) => {
      if (!series.length) return;   // 품번 미지정·추출 미사용 — 계열 자체가 없다
      const bn = VC.BAND_ORDER[VC.BAND_FREQ.length + i];
      let p = 0;
      const vals = times.map((t) => {
        while (p + 1 < series.length && Math.abs(series[p + 1].ms - t) <= Math.abs(series[p].ms - t)) p++;
        return Math.abs(series[p].ms - t) <= gapMs ? series[p].v : null;
      });
      if (vals.some((v) => v != null)) envBands.push({ key: bn, label: VC.BAND_KO[bn] || bn, color: ENV_COLOR[i % ENV_COLOR.length], vals });
    });
  }
  /* 왜 비었는지를 값과 함께 돌려준다 — 계산이 불가능한 것과 아직 안 된 것, 설비가 조용한 것이
     화면에서는 똑같이 빈 상자로 보인다. 사유가 없으면 사용자는 고장을 의심하게 된다.
     두 차트가 요구하는 표본 수가 다르므로(첨도 64 · 대역 FFT 256) 사유도 따로 만든다. */
  const fsTxt = Math.round(fs) + ' Hz';
  const winSec = chunkSec + 1; // rawWindow가 [at-chunkSec, at+1s]로 잡는다
  const kurtNote = kurt.length ? ''
    : cErr >= n / 2
      ? '원시 데이터 조회에 실패했습니다 (' + cErr + '/' + n + ' 지점) — 잠시 후 새로고침하세요.'
      : cEmpty >= cFew
        /* 대부분의 지점이 빈 경우 = 구간은 넓은데 데이터가 일부에만 있다. 표본 수를 탓하면
           센서 사양을 들여다보게 되지만, 실제로 할 일은 데이터가 있는 구간으로 좁히는 것이다. */
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
    // key를 함께 싣는다 — 화면이 배수 축으로 그릴 때 그 계열의 베이스라인을 찾아야 한다(라벨은 한글이라 못 쓴다)
    bands: VC.BAND_FREQ.map((bn, i) => ({ key: bn, label: VC.BAND_KO[bn] || bn, color: BAND_COLOR[i % BAND_COLOR.length], vals: bandVals[i] }))
      .concat(envBands),
    xLabels, xTips, times,
  };
}
