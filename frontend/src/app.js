// 화면 로직 — renderVals()가 view.js에 넘길 값 생성
import { Component } from 'preact/compat';
import { view } from './view.js';
import { pickerOpen } from './daterange.js';
import { listTagTables, tagSchemas, listTags, tagStats, rollupTrend, loadConfig, saveConfig, saveConfigPartial, buildLiveData, liveDetail, sweepAnchors, monPattern, emptyDet, rollupBatch, loadTrendChunks , timerStates, monTimer, bandTimer, wdTimer, deleteWdTimer, rawWindow, CAPS, pkgBase} from './data/live.js';
import { ensureMonTables, loadEventsRange, countEvents, loadBaselines, saveBaseline, deleteBaseline, insertEvent, insertBandPoint, loadMonState, saveMonState, createMonitorTimer, deleteMonitorTimer, createBandTimer, deleteBandTimer, bandRaw, bandLatest, bandTrend, bandBackfill, bandTimes } from './data/live.js';
import { usageStats, countRange, tagUsage, deleteEventsRange, deleteEventsOfTag, deleteBandRange, deleteBandOfTag, deleteMonState } from './data/live.js';
import { runTql } from './data/live.js';
import { jwtUser, sessionJwt, whoami, onAuthFail, setUser, checkAppDb, setupSql, createAppDb, appDb, storePrefix, userKeyPrefix, configTable, srcMapOf, listUsers, grantTo, revokeFrom, accessStatus, migrateConfigToDb } from './data/live.js';
import Monitor from '../../cgi-bin/monitor/monitor.js';
import Band from '../../cgi-bin/monitor/band.js';
import Notify from '../../cgi-bin/notify/notify.js';
// 별칭 편집이 한 번에 그리는 줄 수 — 넘치는 분은 검색으로 좁힘
var ALIAS_ROWS_MAX = 200;
var GRADE_WORDS = ['양호', '주의', '위험', '심각']; // 이벤트 GRADE 저장·표시용(인덱스 ↔ 단어)
// 대역 학습 기간 — 1시간은 최소 표본(30) 미달이라 제외
var BAND_WIN_H = { '6h': 6, '24h': 24, '3d': 72, '7d': 168 };
var ISO_WIN_MS = 1000;      // ISO 대역제한 계산용 원본 창(10 Hz 10주기)
var ISO_TTL_MS = 30000;     // 태그당 재계산 최소 간격 — 경계 왕복 시 원본 조회 폭주 방지
/* 원본 기반 계측 판정(스파이크·클리핑) 유효기간(재측정 TTL의 2배)
   원본은 알람 조건 때만 받아 재확인 기회 없음 → 만료 없으면 배지 영구 잔류 */
var GATE_RAW_TTL_MS = 60000;
/* 양호 태그의 ISO 재측정 주기(알람 근처는 ISO_TTL_MS) — 카드 값을 항상 ISO 대역제한으로 유지 */
var ISO_TTL_QUIET_MS = 300000;
// 대역+패턴 축의 태그당 예상 소요(초, 서버 기준) — 주기 선택 시 회차 소요 계산용
var BAND_TAG_SEC = 0.9 + 0.35;
// '타이머 없음이 정상' 서명 — null이면 매 확인마다 없는 타이머 DELETE(Neo 500) 반복
var SIG_NONE = '(none)';
// 건강 배너 지속 조건 — 일시 실패와 실제 두절 구분용
var TIMER_MISS_MIN = 3;   // 연속 실패 이 횟수부터 '모름' 표시(그전엔 직전 상태 유지)
var PAT_ZERO_MS = 900000; // 패턴 측정 태그 0개 지속 시 알림 기준(추출 주기보다 여유)
var FLAP_WIN_MS = 2 * 3600000; // 반복 악화 감지 창
// 시간대 목록 폴백 — Intl.supportedValuesOf 미지원 브라우저용 주요 지역
var TZ_FALLBACK = ['Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland'];
// 서버 타이머 회차 문제 코드 → 배너(서버 errAdd와 같은 코드)
var ST_ERR = {
  state_read: { lv: 'err', text: function () { return '직전 판정 상태를 읽지 못해 회차를 건너뛰었습니다 — DB 연결을 확인하세요'; } },
  tag_fail: { lv: 'warn', text: function (n) { return '태그 ' + n + '개 처리 실패 — 다음 회차에 다시 시도합니다'; } },
  round: { lv: 'err', text: function () { return '회차가 오류로 끝났습니다'; } },
};
var FLAP_REFRESH_MS = 60000;   // 반복 악화 조회 간격
var SLOW_WIN_N = 7;       // 회차 소요 표본 창
var SLOW_MIN_N = 3;       // 판단 시작 최소 표본 수
var SLOW_ON = 0.7;        // 주기 대비 — 켜는 문턱
var SLOW_OFF = 0.55;      //            끄는 문턱(히스테리시스)
/* 감시 자동 재등록 한도 — Neo 타이머는 한 번 throw하면 STOP·재시도 없음
   스크립트 결함은 재등록해도 반복 실패 → 횟수 제한, 소진 시 중단·사유 표시 */
var RECOVER_MAX = 3;
var RECOVER_GAP_MS = 120000;      // 시도 간격 — 등록 직후 첫 회차 미실행 가능
var RECOVER_CALM_MS = 1800000;    // 이만큼 조용하면 횟수 초기화
// 입력 회전수 점검 — 실측 1×와 이 비율 넘게 다르면 상세분석 경고(동기속도 입력 등). 부하 변동(~1.5%)보다 크게
var RPM_WARN_FRAC = 0.02;

/* 저장·복원 설정 키(state 키와 동일 이름)
   - _cfgFromState·_applyLive가 이 목록 공유
   - 추가 시 db.js CONFIG_FILES에도 등록 필요 */
var CFG_KEYS = ['srcSel', 'displayTz', 'machineClass', 'classThresh', 'unitThresh',
  'equipCls', 'equipRpm', 'equipBearing', 'equipGeo', 'equipUnit', 'equipMeta', 'lineHz', 'cardOrder',
  'knownTags', 'revived',
  'evalWindow', 'monitorOn', 'notifCh', 'notifTo', 'routes', 'aliases',
  'monitorInterval', 'monMode', 'renotify', 'bandOn', 'bandInterval', 'bandWin',
  'llmProvider', 'llmKeys', 'llmModels', 'ollamaUrl', 'genLLM'];
// 설정 폼 편집 키 — '저장 안 함'의 되돌림 대상(나머지는 즉시 저장 값)
var FORM_KEYS = CFG_KEYS.filter(function (k) { return ['cardOrder', 'knownTags', 'revived', 'genLLM'].indexOf(k) < 0; });
function cfgClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
// 일괄 적용 항목 ↔ 설정 입력칸(칩 하나 = 입력칸 하나). 형상·벨트는 값별 칸이라 별도
var GEO_F = { geoName: 'name', geoN: 'n', geoBd: 'Bd', geoPd: 'Pd', geoPhi: 'phi' };
var BELT_F = { beltD1: 'd1', beltD2: 'd2', beltLen: 'len', beltRpm: 'drivenRpm' };
/* on/off 스위치 트랙·손잡이 — 네 곳 공용
   손잡이가 흰색이라 꺼진 트랙에 흰 계열 표면색(--bg-elevated 등) 금지(라이트 테마서 구분 불가) */
function SWITCH_TRACK(on) {
  return 'width: 40px; height: 23px; border-radius: 12px; position: relative; cursor: pointer; transition: background .15s;'
    + ' flex-shrink: 0; background: ' + (on ? 'var(--primary-base)' : 'var(--switch-off)') + ';';
}
function SWITCH_KNOB(on) {
  return 'position: absolute; top: 3px; left: ' + (on ? '20px' : '3px') + '; width: 17px; height: 17px; border-radius: 50%;'
    + ' background: var(--switch-knob); box-shadow: 0 1px 2px var(--switch-knob-shadow); transition: left .15s;';
}
// 대역 추출 주기 라벨 — 10분 하한: 추출 창(2^15 샘플)이 저샘플레이트서 분 단위라 짧으면 구간 중복
var IV_KO = { '10m': '10분', '30m': '30분', '1h': '1시간' };
// 소요 시간 표기 — 초/분/시간 한 단위만
function fmtDur(ms) {
  if (!(ms > 0)) return '0초';
  var s = Math.round(ms / 1000);
  if (s < 60) return s + '초';
  var m = Math.round(s / 60);
  if (m < 60) return m + '분';
  return (m / 60).toFixed(m % 60 ? 1 : 0) + '시간';
}
// 학습 시점 표기 — 정비·운전조건 변경 뒤 기준의 유효성 판단용
function agoText(ms) {
  if (!(ms > 0)) return '';
  var d = Date.now() - ms;
  if (d < 60000) return '방금';
  if (d < 3600000) return Math.round(d / 60000) + '분 전';
  if (d < 86400000) return Math.round(d / 3600000) + '시간 전';
  var days = Math.round(d / 86400000);
  return days < 30 ? days + '일 전' : Math.round(days / 30) + '개월 전';
}
// 30일 넘은 기준 강조 — 그사이 정비 가능성
function agoStale(ms) { return ms > 0 && Date.now() - ms > 30 * 86400000; }
var BAND_PER_MS = 1250;   // 앵커 하나 예상 소요
var BAND_CHUNK = 20;      // 한 요청당 앵커 수 — 타임아웃 안에서 왕복 최소화
var BAND_CHUNK_GAP = 400; // 청크 간 휴지 — 감시 타이머 양보
/* 현재 발화하는 이벤트 유형(필터 목록 출처)
   - 등급 이벤트: 추출 주기 패턴 축 / 계측 이벤트: 10초 축
   - 베이스라인·대역은 상태만 추적(옛 이력 라벨은 TYPEKO에 유지) */
var EVT_LIVE_TYPES = ['observe', 'threshold', 'sustained', 'improve', 'recovery', 'sensor_fault', 'sensor_ok', 'signal_lost'];
// 등급을 올린 축의 표시 이름 — 단일 출처(사본 두면 축 추가 시 배지 빈칸·오표기)
var GRADE_SRC_KO = { iso: 'ISO 존', baseline: '베이스라인', band: '대역·포락선', pattern: '결함 패턴' };
var TYPEKO = { observe: '관찰', threshold: '임계 초과', sustained: '상태 지속', recovery: '정상 복귀', improve: '상태 개선', signal_lost: '신호 두절', sensor_fault: '계측 이상', sensor_ok: '계측 복귀', baseline: '베이스라인 이탈', band: '대역 이탈', bandrec: '대역 복귀' };
/* 등급 이벤트(값=판정값) 유형 — 가속도·변위 설비 행은 원본 단위라 기준 숫자 없음
   근거는 DETAIL 머리의 'ISO <존> 구간'(_judgeLive·monitor.js) */
var GRADE_ETYPES = { observe: 1, threshold: 1, sustained: 1, improve: 1, recovery: 1 };
/* 리포트 새 탭 틀 — 본문은 샌드박스 iframe(불투명 오리진)에서만 실행
   ⚠ allow-same-origin·allow-top-navigation·allow-popups 금지 — 콘솔 토큰 탈취·콘솔 창 이동 가능 */
var REPORT_SANDBOX = 'allow-scripts allow-modals';
function reportShell(title, src) {
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + esc(title) + '</title>'
    + '<style>html,body{margin:0;height:100%;background:#1a1b1e}iframe{display:block;border:0;width:100%;height:100%}</style></head>'
    + '<body><iframe sandbox="' + REPORT_SANDBOX + '" src="' + esc(src) + '"></iframe></body></html>';
}
function natRow(etype, unit) { return !!GRADE_ETYPES[etype] && !!unit && unit !== 'mm/s'; }
// 생성 TQL 지문(FNV-1a) — 서버 타이머 재굽기 판단용
function srcSig(s) {
  var h = 2166136261, i;
  for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h.toString(36);
}
/* 라우팅 행 — 설비 등급 3행 + 감시 건강(두절·계측 이상) 1행
   - 건강 분리 — 두절이 '주의' 행을 타면 그 행이 꺼질 때 두절 알림 누락
   - ⚠ '감시 이상'은 notify.js shouldNotify의 HEALTH_KEY와 일치 필요(서버 TQL 임베드 값) */
var GRADE_ROUTES = ['주의', '위험', '심각'];
var HEALTH_ROUTE = '감시 이상';
var ROUTE_ORDER = GRADE_ROUTES.concat([HEALTH_ROUTE]);
/* 기본 알림 방식 — 발송 여부는 timing 하나로 결정(사용자가 바꾼 행은 저장값 우선)
   '주의'도 즉시 — 게이트 구조에서 주의 = 결함 패턴 검출 */
var ROUTE_DEFAULT_TIMING = { '주의': '즉시', '위험': '즉시', '심각': '즉시', '감시 이상': '즉시' };
// 미설정 행 채우기는 notify.notifyCfgFrom 단일 경로 — 서버 발송과 같은 함수라 화면·발송 일치
var ROUTE_DEFS = { order: ROUTE_ORDER, timing: ROUTE_DEFAULT_TIMING };
// 설정 영역(db CONFIG_FILES 도메인) → [화면 이름, 설정 탭 섹션] — 손상 안내의 수정 위치 표시용
var CFG_DOMAIN_UI = { source: ['데이터 소스', 'source'], equipment: ['설비 정보', 'equip'], criteria: ['판정 기준', 'criteria'],
  monitor: ['알람 설정', 'monitor'], llm: ['LLM 연동', 'llm'] };
function routesWithDefaults(routes) {
  return Notify.notifyCfgFrom({ routes: routes }, ROUTE_DEFS).routes;
}
// 조회 기간 프리셋(시간) — 짧을수록 고해상도 버킷(≤2h=초·≤3d=분)
var PERIOD_H = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 };
// 계측 게이트 발동 시 전 결함 후보 근거점수 상한 — 게이트는 전역 상태라 일부만 누르면 미검증 후보가 1위로 상승
var GATE_CAP = 40;
// 알람 시나리오 지속시간(진입 확인·복귀 유지·지속 재알림) 코드 → ms
var DUR_MS = { '0': 0, '1s': 1000, '3s': 3000, '5s': 5000, '10s': 10000, '30s': 30000, '1m': 60000, '2m': 120000, '5m': 300000, '10m': 600000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '6h': 21600000 };
// 프리셋 외 값은 '<초>s'로 저장(예: 900s) — 파싱 단일 출처(저장·판정·표시 공용)
function durMs(s) {
  if (DUR_MS[s] != null) return DUR_MS[s];
  var m = /^(\d+)s$/.exec(String(s || ''));
  return m ? +m[1] * 1000 : 0;
}
/* 경과 시간·구간 길이 표기 — 소수 없이 하위 단위 병기(1시간 54분)
   ⚠ 서버 판정기 durAgo와 같은 규칙 유지(이벤트 DETAIL과 화면 일치) */
function durKo(ms) {
  if (!(ms > 0)) return '0';
  if (ms < 60000) return Math.round(ms / 1000) + '초';
  if (ms < 3600000) { var m = Math.round(ms / 60000); return m >= 60 ? '1시간' : m + '분'; }
  if (ms < 86400000) {
    var h = Math.floor(ms / 3600000), hm = Math.round((ms % 3600000) / 60000);
    if (hm === 60) { h++; hm = 0; }
    return h + '시간' + (hm ? ' ' + hm + '분' : '');
  }
  var d = Math.floor(ms / 86400000), dh = Math.round((ms % 86400000) / 3600000);
  if (dh === 24) { d++; dh = 0; }
  return d + '일' + (dh ? ' ' + dh + '시간' : '');
}
// 판정 틱과 카탈로그(태그 증감) 틱 분리 — 태그 증감은 드묾
var CAT_TICK_MS = 10000;   // 카탈로그(태그 증감) 확인 주기
// 불러오기 실패 재시도 — 10초부터 2배씩, 5분 상한
var LOAD_RETRY_MS = 10000, LOAD_RETRY_MAX_MS = 300000;
// 탭·PC 조율 — 담당 기록 만료, 새로 잡은 뒤 확인까지 대기(동시 부팅 경합)
var LEAD_TTL_MS = 30000, LEAD_CONFIRM_MS = 1500;
// 이벤트 목록 갱신 간격 — 서버 타이머·다른 탭이 기록한 이벤트 반영
var EVT_POLL_MS = 30000;
// 저장된 설정 정리 — 옛 값 이관·기본값(부팅·다른 곳 저장분 다시 읽기 공용)
function normCfg(cfg0) {
  var cfg = cfg0 || {};
  // 옛 설정 이관 — evalWindow는 RMS 구간 길이. 해석 불가·0·과도하게 긴 값은 기본 구간으로(직접 입력 '900s' 등은 유지)
  if (!(durMs(cfg.evalWindow) > 0)) cfg.evalWindow = '10s';
  if (durMs(cfg.evalWindow) > 3600000) cfg.evalWindow = '10s';
  if (!DUR_MS[cfg.monitorInterval]) cfg.monitorInterval = '3s';
  // 목록에서 빠진 1분·5분 주기 → 10분(IV_KO 하한)
  if (cfg.bandInterval === '1m' || cfg.bandInterval === '5m') cfg.bandInterval = '10m';
  // 라우팅 이관 — 옛 webhook:false·'무시'는 '알림 안 함'으로(꺼둔 의도 보존)
  if (cfg.routes) Object.keys(cfg.routes).forEach(function (k) {
    var r = cfg.routes[k];
    if (!r || typeof r !== 'object') return;
    if (r.webhook === false || r.timing === '무시') r.timing = '알림 안 함';
    if (!r.timing) r.timing = ROUTE_DEFAULT_TIMING[k] || '즉시';
    delete r.webhook; delete r.email; delete r.sms;
  });
  if (!Array.isArray(cfg.cardOrder)) cfg.cardOrder = [];   // 설비 카드 순서 — 없으면 심각도순
  // knownTags 없음 = 첫 실행(null) — 빈 배열과 구분(안 하면 학습된 태그 전부가 새 태그로 걸림)
  if (!Array.isArray(cfg.knownTags)) cfg.knownTags = null;
  if (!cfg.revived || typeof cfg.revived !== 'object') cfg.revived = {};
  delete cfg.evalAgg;                     // 옛 집계 방식 키 제거(구간 RMS가 곧 집계)
  // 지속 재알림 옛 기본값(주의 0·위험 1h·심각 30m)과 정확히 같을 때만 전부 끔으로 이관(사용자 선택값 유지)
  var _rn = cfg.renotify;
  if (_rn && _rn['주의'] === '0' && _rn['위험'] === '1h' && _rn['심각'] === '30m') {
    cfg.renotify = { '주의': '0', '위험': '0', '심각': '0' };
  }
  // 대역 학습 기간 없으면 RMS 기간 승계 — 단 '1h'는 표본 부족이라 6시간
  if (!BAND_WIN_H[cfg.bandWin]) cfg.bandWin = (cfg.blWin === '1h' || !cfg.blWin) ? '6h' : cfg.blWin;
  // 목록에서 뺀 베어링 품번 — 직접 입력으로 이관(품번은 품번 칸, 형상은 옛 목록 값 — 이미 넣은 형상은 유지). 판정 불변
  Object.keys(cfg.equipBearing || {}).forEach(function (id) {
    var name = cfg.equipBearing[id], old = VC.RETIRED_BEARINGS[name];
    if (!old) return;
    var g = (cfg.equipGeo || {})[id];
    cfg.equipBearing = Object.assign({}, cfg.equipBearing);
    cfg.equipBearing[id] = '직접 입력';
    cfg.equipGeo = Object.assign({}, cfg.equipGeo);
    cfg.equipGeo[id] = Object.assign({ name: name }, (g && g.n > 0) ? g : old);
  });
  return cfg;
}
// 테이블 조회 실패 오류 — 누락 테이블 이름 포함(배너가 원인 후보로 표시)
function loadError(tables) {
  var e = new Error('테이블 조회 실패: ' + tables.join(', '));
  e.tables = tables.slice();
  return e;
}
// RMS 구간 끝 여유 — 마지막 버킷 적재 중(미완성 버킷은 windowRms가 cnt로 거름)
var WIN_LAG_MS = 4000;
// 카드 스파크라인 길이 — 틱 조회는 RMS 구간뿐이라 받은 1초 버킷을 누적해 유지
var SPARK_MS = 60000;
/* 스파크라인 버퍼 병합 — 같은 시각은 새 버킷으로 교체(적재 중이던 미완성 버킷 갱신), 최신 기준 spanMs만 남김 */
function mergeSpark(buf, buckets, spanMs) {
  var m = {}, out = [];
  (buf || []).concat(buckets || []).forEach(function (b) { if (b && isFinite(b.rms)) m[b.ms] = b; });
  Object.keys(m).forEach(function (k) { out.push(m[k]); });
  out.sort(function (a, b) { return a.ms - b.ms; });
  var cut = out.length ? out[out.length - 1].ms - spanMs : 0;
  return out.filter(function (b) { return b.ms > cut; });
}
// 계측 이상 확정·복귀 — 10초 축 판정이라 시간 기준(스파이크 한 번에 센서 고장 판정 방지)
var SENSOR_HOLD_MS = 60000;    // 계측 이상 확정
var SENSOR_CLEAR_MS = 300000;  // 계측 복귀
// 등급 이벤트 사유 문구 — VALUE의 ISO 값은 등급 근거가 아니므로(게이트=결함 패턴) 격자 점수·부위 기재
function judgeDetail(ev, pat, imp) {
  var p = [];
  if (pat && pat.r != null) p.push('격자 ' + Number(pat.r).toFixed(1));
  /* 부위 표기 — 구름체(BSF)는 레이스 손상이 동반돼 부위 단정 안 함(calc siteUnknown과 같은 규칙)
     ⚠ 서버 TQL 임베드 — 표는 함수 안에 */
  var SITE = { BPFO: '외륜(BPFO)', BPFI: '내륜(BPFI)', BSF: '부위 미상(구름체 후보)' };
  if (pat && pat.key) p.push(SITE[pat.key] || pat.key);
  if (ev.etype === 'observe') p.push('1회차 — 확정 전');
  else if (ev.etype === 'threshold') p.push('2회 연속 확정');
  else if (ev.etype === 'sustained') p.push('지속 재알림');
  else if (ev.etype === 'recovery' && ev.epMs > 0) p.push(durKo(ev.epMs) + ' 만에 복귀');
  /* 충격성은 값만 기재(판정 단어 없음) — 상세분석이 다른 창·임계로 같은 말을 써 충돌 방지
     '판정 창' 명시 — 기간 카드 Crest P95(롤업 버킷 분포)와 구분 */
  if (imp) p.push('판정 창 Crest ' + imp.crest.toFixed(1) + ' · 첨도 ' + imp.kurt.toFixed(1));
  return p.join(' · ');
}
/* 순수 판정 상태머신 — 한 태그의 한 틱, 앱·서버 타이머 공통 규칙의 단일 출처
   prev: 직전 MONSTATE(없으면 falsy) · rg: 원시 등급(0~3) · breach: 베이스라인 이탈 · now: ms
   cfg: { reno:{1:ms,2:ms,3:ms} } (재알림 주기 · 0=끔)
   cyc: 이 rg를 만든 패턴 측정 시각 — 회차 계수 기준(틱 10초 ≠ 패턴 10분)
   반환: { next, events:[{etype, gi, ...}] }
     observe(조짐) · threshold(확정) · sustained(지속) · improve(완화) · recovery(정상복귀)
   - 확정은 시간 아닌 연속 회차 기준 — 판정이 추출 주기로 돌아 분 단위 설정은 무의미
   - 첫 단발은 대개 헛경보 → observe로만 기록 */
function judgeTick(prev, rg, breach, now, cfg, bandState, run, cyc) {
  /* ⚠ 상수는 함수 안에 둠 — 서버 TQL에 문자열 임베드되어 바깥 이름 참조 시 서버에서만 ReferenceError */
  var CONFIRM_N = 2;   // 확정 연속 회차 — 악화·복귀 공통(대칭)
  var events = [], next;
  /* run=false면 판정 동결 — 정지·센서 이상으로 인한 하락을 '개선'으로 오독 방지
     상태 유지로 재가동 시 이전 악화 이력 보존 */
  if (run === false) {
    next = prev ? {
      g: prev.g, since: prev.since != null ? prev.since : now, cand: prev.g, candSince: prev.candSince != null ? prev.candSince : now,
      candN: prev.candN, epAt: prev.epAt, cyc: prev.cyc,
      lastRe: prev.lastRe != null ? prev.lastRe : now, b: prev.b, bb: prev.bb, alarmG: prev.alarmG, imp: prev.imp,
    } : { g: 0, since: now, cand: 0, candSince: now, lastRe: now, b: false };
    if (prev && prev.bcs != null) next.bcs = prev.bcs;
    return { next: next, events: events, frozen: true };
  }
  var stale = !!(prev && cyc != null && prev.cyc != null && prev.cyc === cyc);
  if (stale) {
    // 같은 패턴 측정 — 전이 판단 생략, 시간 기준 지속 재알림만 평가
    next = {
      g: prev.g, since: prev.since != null ? prev.since : now, cand: prev.cand, candSince: prev.candSince,
      candN: prev.candN, epAt: prev.epAt, cyc: prev.cyc, lastRe: prev.lastRe != null ? prev.lastRe : now,
      b: breach, bb: prev.bb, alarmG: prev.alarmG, imp: prev.imp,
    };
    if (prev.g > 0) {
      var ivrS = cfg.reno[prev.g] || 0;
      if (ivrS > 0 && now - next.lastRe >= ivrS) { events.push({ etype: 'sustained', gi: prev.g }); next.lastRe = now; }
    }
  } else if (!prev) {
    /* 최초 관측 — 나쁘면 조짐(observe)만, 확정은 다음 회차
       즉시 확정 시 감시를 켜는 순간 나쁜 태그 전부가 동시 알람 */
    next = { g: 0, since: now, cand: rg, candSince: now, candN: 1, cyc: cyc, lastRe: now, b: breach };
    if (rg > 0) events.push({ etype: 'observe', gi: rg });
  } else if (rg === prev.g) {
    // 확정 등급 유지 — 후보 해제, 지속 재알림 검사
    var lastRe = prev.lastRe != null ? prev.lastRe : (prev.since != null ? prev.since : now);
    next = { g: prev.g, since: prev.since != null ? prev.since : now, cand: prev.g, candSince: prev.since || now, candN: 0, epAt: prev.epAt, cyc: cyc, lastRe: lastRe, b: breach, alarmG: prev.alarmG, imp: prev.imp };
    if (prev.g > 0) {
      var ivr = cfg.reno[prev.g] || 0;
      if (ivr > 0 && now - lastRe >= ivr) { events.push({ etype: 'sustained', gi: prev.g }); next.lastRe = now; }
    }
  } else {
    /* 후보 전이(rg != prev.g) — 같은 후보 CONFIRM_N 회차 연속 시 확정
       - 개선 방향 연속 하강은 후보를 이어 셈(단계적 호전 때 회차 리셋으로 복귀 누락 방지)
       - 악화 시에만 후보 새로 잡음 */
    var down = rg < prev.g && prev.cand != null && rg <= prev.cand;
    var same = prev.cand === rg || down;
    var candSince = same ? (prev.candSince != null ? prev.candSince : now) : now;
    // candN 0 = 후보 없음(확정 등급 유지 중) — `|| 1` 금지(첫 회차가 2로 세어져 즉시 확정)
    var candN = same ? ((prev.candN || 0) + 1) : 1;
    /* 조짐 — 양호에서 처음 벗어나는 회차(확정 전이라 웹훅 없음, 이력·화면만)
       에피소드 중 추가 악화(주의→위험)엔 미부착 */
    if (candN === 1 && prev.g === 0 && rg > 0) events.push({ etype: 'observe', gi: rg });
    if (candN >= CONFIRM_N) {
      next = { g: rg, since: now, cand: rg, candSince: now, candN: 0, cyc: cyc, lastRe: now, b: breach, alarmG: prev.alarmG, imp: prev.imp };
      if (rg > prev.g) {   // 악화
        events.push({ etype: 'threshold', gi: rg });
        // 에피소드 시작 = 양호를 벗어난 시각(since는 승격 때 리셋되므로 별도 유지)
        next.epAt = prev.alarmG ? (prev.epAt != null ? prev.epAt : now) : now;
        next.alarmG = rg; next.imp = 0;
      }
      else {
        /* 개선을 두 이벤트로 구분 — 에피소드당 각 1건
             improve  : 알람 수준 이탈 → 우선순위 하향, 긴급 대응 해제
             recovery : 완전 정상 도달 → 작업지시 종료
           존 경계에 상주하는 설비도 improve로 해제 가능 */
        var aG = prev.alarmG || 0;
        if (rg === 0 && aG > 0) {
          // 복귀 이벤트에 에피소드 길이 기재
          events.push({ etype: 'recovery', gi: 0, epMs: prev.epAt != null ? (now - prev.epAt) : 0 });
          next.alarmG = 0; next.imp = 0;
        } else if (aG > 0 && rg < aG && !prev.imp) {
          events.push({ etype: 'improve', gi: rg });
          next.imp = 1;                       // 에피소드당 1건 — alarmG 유지(복귀 이벤트 가능)
        }
      }
    } else {
      // 회차 미달 — 확정 등급 유지, 후보만 추적(candN 유지로 다음 회차에 이어 셈)
      next = { g: prev.g, since: prev.since != null ? prev.since : now, cand: rg, candSince: candSince, candN: candN, epAt: prev.epAt, cyc: cyc, lastRe: prev.lastRe != null ? prev.lastRe : (prev.since != null ? prev.since : now), b: breach, alarmG: prev.alarmG, imp: prev.imp };
    }
  }
  /* 베이스라인 이탈 — 등급 전이와 독립. 진입 escHold·해제(재무장) recHold 지속 요구(한계 근처 반복 이탈 방지)
     bos = 이탈 후보 시작 시각 · bcs = 해제 후보 시작 시각 */
  var wasB = !!(prev && prev.b), bcs = prev ? prev.bcs : null, bos = prev ? prev.bos : null, nowB = wasB;
  if (breach) {
    bcs = null;
    if (wasB) nowB = true;
    else {
      if (bos == null) bos = now;
      if (now - bos >= (cfg.escHold || 0)) { nowB = true; bos = null; }
    }
  } else {
    bos = null;
    if (wasB) {
      if (bcs == null) bcs = now;
      if (now - bcs >= (cfg.recHold || 0)) { nowB = false; bcs = null; }
    }
  }
  /* 베이스라인은 이벤트 없음 — 판정값이 10초 축 RMS라 10분 축 등급 이벤트와 시간축 혼재 방지
     상태는 next.b로 근거표·카드에 표시(⚠ 비베어링 원인의 진폭 상승은 화면에서만 확인 가능) */
  next.b = nowB;
  if (bos != null) next.bos = bos;
  if (bcs != null) next.bcs = bcs;
  /* 대역 이탈 — 설비당 1건으로 합성해 전달(bandState: {on, gi} 또는 null)
     이벤트 없이 상태만 추적(8계열 개별 비교라 다중비교 오탐) — 근거표에서 원인 계열 식별용 */
  if (bandState) next.bb = bandState.on;
  else if (prev) next.bb = prev.bb;
  return { next: next, events: events };
}
/* 서버 임베드용 자체 완결 소스 — durKo를 한 스코프에 묶음
   toString 단독 전달 시 압축이 durKo 이름을 바꿔 서버에서만 ReferenceError */
function detailSrc() { return VC.embedSrc([durKo, judgeDetail], { judgeDetail: judgeDetail }); }

export { judgeTick, durMs, detailSrc, normCfg, mergeSpark }; // 테스트·서버 타이머 재사용
import VC from '../../cgi-bin/calc/calc.js';
import LLM from '../../cgi-bin/llm/llm.js';
import Report from '../../cgi-bin/report/report.js';
import { REPORT_ROOT, reportDir, ensureDir, saveFile, listDir, deleteFile, readFileBlob, chartLibSrc } from './data/live.js';
import CH from '../../cgi-bin/chart/chart.js';
// 차트 모듈 — 부팅 시 this.E로 사용
var ENGINE = CH;

export class App extends Component {
  constructor(props) {
    super(props);
    // 이 탭 식별자 — 담당 기록·저장 표시의 주인 구분
    this._tabId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    var self0 = this;
    this._onStorage = function () { self0._checkIdentity(); };   // 다른 탭의 로그인 변화 즉시 감지
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('vibeTheme'); } catch (e) {}
    var theme = savedTheme ? (savedTheme === 'light' ? 'light' : 'dark') : ((props && props.defaultTheme === 'light') ? 'light' : 'dark');
    this.state = {
      ready: false, tab: (props && props.defaultTab) || 'monitor', theme: theme,
      user: '', authMsg: '', cfgFail: null,
      needsDb: false, dbExists: false, dbSetup: null, dbWhy: '', dbAdmin: false, dbBusy: false,
      grantUsers: null, grantStatus: null, grantBusy: '', grantAsk: '', grantMsg: '',
      configured: true, monitorOn: true,
      selTag: null, period: '1h', from: '', to: '', // 기본 1시간 — 짧은 창이라야 초 단위 해상도
      diagTag: null, evtTag: 'all', evtType: 'all', evtScope: 'today', // 이벤트 목록 기간: today | 7d | all
      detailAnchor: null, // 스펙트럼 분석 기준 시각 — 이벤트 클릭 시 그 시각, 아니면 선택 기간 끝
      fftFull: false, // FFT·스펙트로그램 주파수 범위: false=기본(dispHz) · true=전대역(Nyquist)
      viewUnit: null, // 상세분석 표시 물리량: null=센서 원단위 · 'g'/'mm/s'/'μm'로 적분/미분 변환
      events: [], reports: [],
      setSection: 'source', machineClass: '', gradeFilter: null, // 선택 UI는 저장 전 미선택 (판정 폴백은 Class II)
      /* 모니터링 테이블 필터 — 저장 안 하는 화면 상태(영구 감시 대상은 설정 → 데이터 소스)
         숨긴 목록을 기억(선택 목록이면 새 테이블이 말없이 빠짐). 빈 배열 = 전체 표시 */
      tblHide: [], tblOpen: false, tblQuery: '',
      equipBearing: {}, equipRpm: {}, equipAdv: {}, equipGeo: {}, equipUnit: {},
      // 설비 정보 목록의 화면 상태 — 저장 대상 아님(CFG_KEYS 외)
      equipFilter: 'all',  // 'all' | 'unset' | 'incomplete'
      equipBulk: null,     // 일괄 적용 패널 {id, scope, fields} — 한 번에 한 행만
      // 계측·구동 메타 {mount,drive,belt:{d1,d2,len},vanes} — 전부 선택 입력, 없으면 엔진이 '볼 수 없음' 처리
      equipMeta: {}, lineHz: '60', // 계통주파수 — 설비별 아닌 전역(기본 60Hz)
      bandOn: false, bandHide: {}, bandInterval: '10m', bandBusy: {}, bandFill: null, bandCov: null, bandIvOpen: false, bandIvNext: '10m', bandIvAct: 'keep',
      equipCls: {}, classThresh: {}, unitThresh: {},
      llmProvider: '', llmConfigured: false, llmTesting: false, llmTest: null,
      llmKeys: {}, llmModels: {}, ollamaUrl: 'http://127.0.0.1:11434',
      genRunning: false, genStep: 0, genTags: [], genLLM: false,
      // 리포트 탭 조회 기간 — 상세분석(period/from/to)과 분리, 대상 태그 없으면 ''
      genPeriod: '', genFrom: '', genTo: '',
      dirty: false, toast: null, pendingNav: null, monitorInterval: '3s', cardSize: 232,
      notifCh: { webhook: false }, // 알람 채널은 웹훅 하나(저장본 잔존 키 무시)
      notifTo: { webhook: '' }, // 발송 대상 URL
      notifTest: null, // 테스트 발송 결과 {ch, ok, msg}
      routes: {}, // 심각도별 라우팅 {심각도: {timing}} — 미설정 행은 ROUTE_DEFAULT_TIMING
      // 서버 타이머는 앱 종료 후에도 상주 → 설정에서 고를 때만 생성·끄면 삭제. 앱 모드는 화면 닫으면 감시 중단(배너 표시)
      monMode: 'app', // 감시 방식: 'app'(앱 열린 동안만) | 'server'(Neo 타이머 상시)
      // 알람 시나리오 파라미터 (앱·서버 타이머 공통 규칙)
      // 지속 재알림 — 확정 뒤 침묵하면 단발 여부 판단 불가, 등급이 급할수록 짧게
      renotify: { '주의': '2h', '위험': '1h', '심각': '30m' },
      aliases: {}, // 태그 별칭 {"TABLE:TAG": 별칭}
      srcSel: [], displayTz: '', evalWindow: '10s', // 소스 기본값 = 미선택 · evalWindow=RMS 구간(판정 주기 이상)
      srcNotice: '', // 데이터 소스 변동(테이블/태그 제거) 감지 배너 문구
      idSwitch: null, // 다른 계정으로 로그인됨 — 그 계정 이름(이 탭의 쓰기 중단·새로고침 안내)
      loadFail: null, // 불러오기 실패 — { why, tables, missing, tries, nextAt }. 옛 데이터로 감시하며 재시도 중
      // 설비 카드 순서(드래그) — 기본은 심각도 내림차순, 저장 순서에 없는 태그는 뒤에
      cardOrder: [], cardDragId: null, cardPreview: null,
      knownTags: null, revived: {},   // 태그 되살아남 추적 — null이면 아직 목록을 만든 적 없음
      tagQuery: '',  // 별칭 편집 태그 검색어 — 저장 대상이 아닌 화면 상태
      aliasShown: ALIAS_ROWS_MAX,  // 별칭 편집에서 그린 줄 수 — 바닥 도달 시 증가
      srcCap: null,   // 표시 상한에 걸려 감시에서 빠진 태그 집계(buildLiveData가 채움) — null이면 잘린 것 없음
      health: null,   // 감시 살아있음 확인 결과 — null이면 이상 없음
      blWin: '24h', blK: '3', baselines: {}, blBusy: {}, // 베이스라인 학습 (판정기준 카드)
      // 대역 학습 기간 별도 — 대역 표본은 추출 주기 단위라 RMS보다 훨씬 성김
      bandWin: '24h',
      dlOpen: false, csvFrom: '', csvTo: '', dlFmt: 'csv' // 이벤트 내보내기 모달(기간·형식)
    };
    this._c = {}; this._detailCache = {}; this._fcCache = {}; this._raf = null;
    this.live = false; this.liveTables = [];
    var self = this;
    this._onResize = function () { self._scheduleDraw(); };
    ['wave', 'rms', 'p2p', 'crest', 'fft', 'fc'].forEach(function (k) {
      self['ref_' + k] = function (el) { self._c[k] = el; };
      self['reftip_' + k] = function (el) { self._c[k + '_tip'] = el; };
    });
    this._refWaveCross = function (el) { self._c.wave_cross = el; };
  }
  componentDidMount() { window.addEventListener('resize', this._onResize); window.addEventListener('storage', this._onStorage); this._poll(); this._clk = setInterval(this._clock.bind(this), 1000); this._clock(); this._initTip(); }
  /* data-tip 커스텀 툴팁 — 네이티브 title의 지연·스타일 제약 회피
     fixed 싱글턴이라 overflow 스크롤 컨테이너에서도 안 잘림 */
  _initTip() {
    if (typeof document === 'undefined' || this._tipEl) return;
    var tip = document.createElement('div');
    Object.assign(tip.style, {
      position: 'fixed', display: 'none', zIndex: '9999', pointerEvents: 'none',
      background: 'var(--bg-elevated)', color: 'var(--text-primary)',
      border: '1px solid var(--border-medium)', borderRadius: '7px',
      padding: '10px 13px', fontSize: '12px', lineHeight: '1.7', whiteSpace: 'pre-line',
      boxShadow: '0 6px 20px rgba(0,0,0,.35)', letterSpacing: '-.1px',
    });
    document.body.appendChild(tip);
    this._tipEl = tip;
    document.addEventListener('mouseover', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      var txt = t && t.getAttribute('data-tip');
      if (!txt) { tip.style.display = 'none'; return; }
      tip.textContent = txt;
      tip.style.maxWidth = Math.min(380, window.innerWidth - 24) + 'px';
      tip.style.display = 'block';
      var r = t.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      var x = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
      var y = r.bottom + 8;
      if (y + th > window.innerHeight - 8) y = Math.max(8, r.top - th - 8); // 아래 공간 없으면 위로
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    // 스크롤·창 밖 이탈 시 숨김
    document.addEventListener('scroll', function () { tip.style.display = 'none'; }, true);
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) tip.style.display = 'none'; });
  }
  // 헤더 시계 — 표시 시간대, 브라우저 시간이 아니면 오프셋 병기
  _clock() { var el = document.getElementById('vclock'); if (!el) return; var now = Date.now(); el.textContent = CH.fmtFull(now).slice(0, 19) + (CH.getZone() ? ' ' + CH.offsetLabel(now) : ''); }
  componentWillUnmount() { window.removeEventListener('resize', this._onResize); window.removeEventListener('storage', this._onStorage); if (this._raf) clearTimeout(this._raf); if (this._pt) clearTimeout(this._pt); if (this._tt) clearTimeout(this._tt); if (this._live) clearInterval(this._live); if (this._clk) clearInterval(this._clk); if (this._gt) clearTimeout(this._gt); if (this._resyncT) clearTimeout(this._resyncT); if (this._loadRetryT) clearTimeout(this._loadRetryT); }
  _poll() { this._boot(ENGINE); } // 모듈 import라 로드 대기 불필요
  // 신원 확인 우선 — 세션 없으면 서버 호출 금지(헤더 없는 요청은 기본 신원으로 통과됨)
  _boot(E) {
    var self = this;
    this.E = E;
    var who = jwtUser();
    if (!who) { this._initNoAuth('Neo 콘솔에 로그인되어 있지 않습니다'); return; }
    onAuthFail(function () { self._onAuthLost(); });
    // 세션 sub와 실제 실행 계정 대조 — 불일치 시 남의 권한으로 도는 상태라 차단
    whoami().then(function (user) {
      if (user !== who) {
        self._initNoAuth('로그인 계정(' + who + ')과 실제 실행 계정(' + user + ')이 다릅니다 — 관리자에게 알리세요');
        return null;
      }
      self.user = user;
      setUser(user);
      self.setState({ user: user, authMsg: '' });
      // 앱 저장소는 전용 DB의 계정 스키마 — DB 없음·권한 없음이면 관리자용 SQL 안내
      return checkAppDb().then(function (usable) {
        if (!usable) { self._initNeedsDb(); return false; }
        return ensureMonTables()
          .then(function () { return migrateConfigToDb(); })
          .then(function () { return true; })
          // DB는 있는데 실패 = 권한 문제 — 안내 분기
          .catch(function (e) { self._initNeedsDb((e && e.message) || String(e), true); return false; });
      });
    }).then(function (ok) {
      if (ok) self._bootAs(E);
      // 권한 부여 대상 계정 목록 — 저장소 준비 여부와 무관하게 관리자에게 필요
      if (self.state.user === 'SYS') self._loadGrantUsers();
    }).catch(function (e) {
      self._initNoAuth('로그인 계정을 확인하지 못했습니다 — ' + ((e && e.message) || e));
    });
  }
  // 인증 전/끊김 화면 — 조회 없이 설정 화면만, 사유 표시로 빈 화면과 구분
  _initNoAuth(why) {
    this.live = false;
    this.data = { now: Date.now(), equipment: [], events: [], reports: [] };
    if (this._live) clearInterval(this._live);
    if (this._cat) clearInterval(this._cat);
    this.setState({
      ready: true, authMsg: why || '인증이 필요합니다', user: '',
      srcSel: [], selTag: null, diagTag: null, events: [], reports: [],
      tab: 'settings', setSection: 'source',
    });
  }
  /* 설정 읽기 실패 화면 — 데이터·타이머 미기동, 사유별 다음 행동만 제공
     - 조회 실패: 재시도만(재설정 권유 시 멀쩡한 설정 삭제 위험)
     - 조각 손상: 해당 영역만 기본값으로 여는 길 추가
     - 세션 끊김이면 인증 화면 우선 */
  _initCfgFail(err) {
    if (this.state.authMsg) return;
    this.live = false;
    this._cfgOk = false;
    this.data = { now: Date.now(), equipment: [], events: [], reports: [] };
    if (this._live) clearInterval(this._live);
    if (this._cat) clearInterval(this._cat);
    this.setState({
      ready: true, srcSel: [], selTag: null, diagTag: null, events: [], reports: [], tab: 'monitor',
      cfgFail: { kind: (err && err.kind) || 'query', msg: (err && err.message) || String(err), domains: (err && err.domains) || [] },
    });
  }
  _retryCfg() {
    this.setState({ cfgFail: null, ready: false });
    this._bootAs(this.E);
  }
  // 손상 영역만 기본값으로 열기 — 누름만으로는 저장 없음, 사용자가 확인·저장할 때 기록
  _repairCfg() {
    var self = this, doms = ((this.state.cfgFail || {}).domains || []).slice();
    this.setState({ cfgFail: null, ready: false });
    loadConfig({ allowBroken: true }).then(function (cfg0) {
      self._cfgFresh = false;
      self._bootWith(cfg0 || {});
      var ui = CFG_DOMAIN_UI[doms[0]] || CFG_DOMAIN_UI.source;
      self.setState({ tab: 'settings', setSection: ui[1] });
      self._toast(doms.map(function (d) { return (CFG_DOMAIN_UI[d] || [d])[0]; }).join('·')
        + ' 설정을 기본값으로 열었습니다 — 확인 후 저장하면 복구됩니다', 'warn');
    }, function (err) { self._initCfgFail(err); });
  }
  // 설정 저장 잠금 — 걸려 있으면 사유 알림 후 true(_bootWith 참조)
  _cfgLocked(silent) {
    if (!this._checkIdentity()) {
      if (!silent) this._toast('다른 계정으로 로그인되어 저장하지 않았습니다 — 새로고침하세요', 'err');
      return true;
    }
    if (this._cfgOk) return false;
    if (!silent) this._toast('설정을 불러오지 못한 상태라 저장하지 않았습니다 — 새로고침 후 다시 시도하세요', 'err');
    return true;
  }
  _initNeedsDb(why, hasDb) {
    this.live = false;
    this.data = { now: Date.now(), equipment: [], events: [], reports: [] };
    if (this._live) clearInterval(this._live);
    if (this._cat) clearInterval(this._cat);
    this.setState({
      ready: true, needsDb: true, dbExists: !!hasDb, dbSetup: setupSql(), dbWhy: why || '',
      dbAdmin: (this.state.user === 'SYS'),
      srcSel: [], selTag: null, diagTag: null, events: [], reports: [],
      tab: 'settings', setSection: 'source',
    });
  }
  // 저장소 생성 후 부팅 이어감 — 권한 없으면 서버 거부 사유 표시
  _makeDb() {
    var self = this;
    if (this.state.dbBusy) return;
    this.setState({ dbBusy: true });
    createAppDb()
      .then(function () { return self._resumeAfterDb(); })
      .catch(function (e) {
        self.setState({ dbBusy: false, dbWhy: (e && e.message) || String(e) });
        self._toast('저장소를 만들지 못했습니다 — 아래 SQL 을 관리자에게 요청하세요', 'err');
      });
  }
  // 저장소 준비 재확인 — 직접 생성 불가 계정의 권한 수령 확인용
  _checkDb() {
    var self = this;
    if (this.state.dbBusy) return;
    this.setState({ dbBusy: true });
    checkAppDb().then(function (ok) {
      if (!ok) {
        self.setState({ dbBusy: false });
        self._toast('아직 준비되지 않았습니다', 'warn');
        return;
      }
      return self._resumeAfterDb();
    }).catch(function (e) {
      self.setState({ dbBusy: false });
      self._toast('확인 실패: ' + ((e && e.message) || e), 'err');
    });
  }
  /* 계정 권한 — 계정 목록·권한 상태는 데이터 소스 화면을 처음 열 때 조회(force = 다시 읽기)
     상태 조회 실패는 null(목록은 표시, 상태 칸만 비움) */
  _loadGrantUsers(force) {
    var self = this;
    // 조회 중 다시 읽기 요청은 끝난 뒤 한 번 더(부여·회수 직후 갱신 누락 방지)
    if (this._grantLoading) { if (force) this._grantReload = true; return; }
    if (this.state.grantUsers && !force) return;
    this._grantLoading = true;
    var done = function () {
      self._grantLoading = false;
      if (self._grantReload) { self._grantReload = false; self._loadGrantUsers(true); }
    };
    Promise.all([listUsers(), accessStatus().catch(function () { return null; })])
      .then(function (r) { self.setState({ grantUsers: r[0], grantStatus: r[1] }); done(); })
      .catch(function (e) {
        var why = (e && e.message) || e, S0 = self.state;
        // 다시 읽기 실패 — 기존 목록·직전 결과 문구 유지
        if (S0.grantUsers && S0.grantUsers.length) self.setState({ grantMsg: (S0.grantMsg ? S0.grantMsg + ' · ' : '') + '상태를 다시 읽지 못했습니다 — ' + why });
        else self.setState({ grantUsers: [], grantStatus: null, grantMsg: '계정 목록을 읽지 못했습니다 — ' + why });
        done();
      });
  }
  // 권한 부여·회수 공용 — 실패는 문장별 사유 표시(재실행 무해), 끝나면 상태 다시 읽기
  _grantRun(u, revoke) {
    var self = this, ko = revoke ? '회수' : '부여';
    if (!u || this.state.grantBusy) return;
    this.setState({ grantBusy: u, grantAsk: '', grantMsg: '' });
    (revoke ? revokeFrom : grantTo)(u).then(function (r) {
      self.setState({ grantBusy: '',
        grantMsg: r.failed ? u + ' — ' + (r.total - r.failed) + '/' + r.total + ' 적용, 실패: ' + r.reasons[0]
          : u + (revoke ? ' 의 권한을 회수했습니다' : ' 에 권한을 부여했습니다') + ' (' + r.total + '건)' });
      self._toast(u + ' 권한 ' + ko + ' 완료', r.failed ? 'warn' : 'ok');
      self._loadGrantUsers(true);
    }).catch(function (e) {
      self.setState({ grantBusy: '', grantMsg: '실패 — ' + ((e && e.message) || e) });
      self._toast('권한 ' + ko + ' 실패', 'err');
      self._loadGrantUsers(true);
    });
  }
  // 저장소 생성 뒤 — 테이블 생성·설정 이관 위해 부팅 처음부터 재실행
  _resumeAfterDb() {
    this.setState({ needsDb: false, dbBusy: false, dbWhy: '' });
    this._boot(ENGINE);
  }
  // 세션 도중 토큰 만료 — 폴링 중단(미중단 시 매 주기 401)
  _onAuthLost() {
    if (this.state.authMsg) return;
    this._initNoAuth('세션이 만료되었습니다 — Neo 콘솔에서 다시 로그인한 뒤 새로고침하세요');
  }
  /* 부팅 — 설정 읽기 결과(db.loadConfig)로 분기
     읽음·저장 이력 없음은 그대로 부팅, 실패는 기본값 대체 없이 사유 화면(_initCfgFail) */
  _bootAs(E) {
    var self = this;
    this.E = E;
    this._cfgOk = false;
    loadConfig().then(function (cfg0) {
      self._cfgFresh = !cfg0;
      self._bootWith(cfg0);
    }, function (err) { self._initCfgFail(err); });
  }
  /* 설정 저장 잠금(_cfgOk)은 읽은 설정이 state에 들어간 뒤(_applyLive)에만 해제
     그 전 state는 기본값이라 저장 시 실제 설정 덮어씀. 저장 이력 없음(cfg0 null)이면 즉시 해제 */
  _bootWith(cfg0) {
    var self = this, E = this.E;
    this._cfgOk = !cfg0;
    Promise.resolve(cfg0)
      .then(function (cfg0) {
        var cfg = normCfg(cfg0);
        return listTagTables().catch(function () { return null; })
          .then(function (tables) { return [cfg, tables]; });
      })
      .then(function (r) {
        var cfg = r[0], tables = r[1];
        if (!tables || !tables.length) { self._initEmpty('DB에서 TAG 테이블을 찾지 못했습니다 — 연결 상태를 확인하세요'); return; }
        self.live = true;
        self.liveTables = tables;
        self._loadSchemas(); // 컬럼 구성 — 선택 목록에서 미지원 테이블 차단(부팅은 비차단)
        ensureMonTables().catch(function () {}); // 상시감시 표 존재 보장 — 신규 설치 대비
        // 저장된 선택 없으면 미선택으로 시작(설정 → 데이터 소스에서 선택)
        var sel = (cfg.srcSel || []).filter(function (t) { return tables.indexOf(t) >= 0; });
        buildLiveData(E, sel, cfg).then(function (data) {
          var failed = data.failed || [];
          self.data = data;
          self._loadedSel = sel.filter(function (t) { return failed.indexOf(t) < 0; });
          // 실패 표시 먼저 — _applyLive의 틱이 서버 타이머 동기화 때 빠진 테이블을 '태그 없음'으로 읽어 삭제하지 않도록
          if (failed.length) self._onLoadFail(loadError(failed), sel);
          self._applyLive(data, cfg, sel);
        }).catch(function (e) { console.warn('[vibe] live build failed', e); self._initEmpty('데이터 적재 실패: ' + (e.message || e)); });
      });
  }
  _applyLive(d, cfg, sel) {
    var E = this.E;
    // 기본 기간 글자를 만들기 전에 저장된 표시 시간대부터 — 늦으면 기본 기간이 옛 시간대로 적힘
    CH.setZone((cfg && cfg.displayTz) || '');
    var sorted = d.equipment.slice().sort(function (a, b) { return b.grade - a.grade || (b.rms / b.zones[2]) - (a.rms / a.zones[2]); });
    sorted.forEach(function (e, i) { e.order = i; });
    var worst = sorted[0] || null;
    var now = d.now || Date.now();
    var anchor = worst && worst.lastSeen ? worst.lastSeen : now; // 기간 기본값도 선택 태그 데이터 기준
    var initP = this._periodFor(worst, '1h'); // 첫 태그 데이터가 1시간 미만이면 전체로
    var initR = worst ? this._periodRange(worst, initP) : { from: this._dtVal(anchor - 3600000), to: this._dtVal(anchor) };
    var patch = {
      ready: true, srcSel: sel, srcCap: d.cap || null, selTag: worst ? worst.id : null, diagTag: worst ? worst.id : null, events: [], reports: [],
      genTags: [], genPeriod: '', genFrom: '', genTo: '', // 리포트 대상 태그는 기본 미선택 → 기간도 아직 없음
      period: initP, from: initR.from, to: initR.to,
    };
    // 저장된 설정 복원 (state 키와 1:1)
    CFG_KEYS.forEach(function (k) {
      if (k === 'srcSel') return;             // 실제 테이블 목록과 대조해 위에서 설정함
      if (cfg[k] != null) patch[k] = cfg[k];
    });
    // 적용본은 setState 대기 없이 즉시 설정 — 곧 켜지는 판정·타이머가 읽음
    var applied = {}, S0 = this.state;
    CFG_KEYS.forEach(function (k) { applied[k] = (k in patch) ? patch[k] : S0[k]; });
    this._applied = cfgClone(applied);
    this._applyZone();
    this.setState(patch);
    this._cfgOk = true;   // 읽은 설정 반영 완료 — 이후 저장 허용
    this._loadReports();
    var self = this;
    // 담당 정하기 전엔 쓰기 없음 — 동시에 연 탭이 따라잡기 판정을 겹쳐 하지 않게
    this._lead = false; this._leadAt = 0; this._cfgSeen = null;
    /* 로드 후 첫 판정 = 따라잡기 — 저장된 판정 상태와 비교해 앱이 닫혀 있던 사이 변화 소급(불러오기 실패 테이블은 복구 뒤 정기 판정이 소급) */
    Promise.all([
      this._coordTick().then(function () {
        return loadMonState().then(function (m) { self._monState = m; }).catch(function () { self._monState = {}; });
      }),
      this._loadBaselines(),
    ]).then(function () {
      /* 되살아남 검사 순서 — 베이스라인 로드 뒤(학습값 유무가 근거), 따라잡기 판정 전(확인 대기 태그 소급 판정 방지)
         조회 실패 테이블은 범위 제외 — 사라진 것으로 치면 되살아남 오판 */
      self._checkRevived(sorted.map(function (e) { return e.table + ':' + e.name; }),
        sel.filter(function (t) { return (d.failed || []).indexOf(t) < 0; }));
      return self._judgeLive();
    }).then(function () { self._loadEventsLive(); });
    if (this._live) clearInterval(this._live);
    this._startTimers();
  }
  /* 설정 저장 후 재적재(소스 테이블 변경 반영)
     - 실패 시 옛 데이터 유지·판정 재개 후 재시도(적재 중 판정 틱이 멈춰 있어 재개 안 하면 감시 중단)
     - quiet: 재시도용 — 적재 중 화면 전환·판정 정지 없음 */
  _reloadLive(quiet) {
    var self = this, E = this.E;
    if (!this.live) return;
    // 중복 실행 없음 — 진행 중 요청은 종료 후 1회로 병합(그 사이 바뀐 선택 반영)
    if (this._reloading) { this._reloadAgain = (this._reloadAgain === 'full' || !quiet) ? 'full' : 'quiet'; return; }
    this._reloading = true;
    if (this._loadRetryT) { clearTimeout(this._loadRetryT); this._loadRetryT = null; }
    if (!quiet) {
      if (this._live) clearInterval(this._live);
      this.setState({ ready: false, srcNotice: '' });
    }
    var AC = this._ac(), sel = (AC.srcSel || []).slice();   // 저장된 선택·설비 설정 사용 — 폼 편집본 배제
    var done = function () {
      self._reloading = false;
      var again = self._reloadAgain;
      self._reloadAgain = null;
      if (again) self._reloadLive(again === 'quiet');
    };
    buildLiveData(E, sel, AC).then(function (data) {
      // 테이블 하나라도 실패면 전체 실패 — 그대로 받으면 해당 카드·서버 감시에서 누락
      if (data.failed && data.failed.length) throw loadError(data.failed);
      self._detailCache = {}; self._rfCache = {}; self._trCacheL = {};
      self._tickCostMs = null;  // 감시 대상 변경 → 소요 재측정
      self._tagCache = {}; // 재적재 시 별칭 편집 태그 목록도 새로 조회 (새 태그 반영)
      self._noticeMuted = false;
      if (!data.now) data.now = self.data && self.data.now ? self.data.now : Date.now();
      self.data = data; // 빈 선택도 그대로 반영 (모니터링 빈 상태 표시)
      var sorted = self.data.equipment.slice().sort(function (a, b) { return b.grade - a.grade; });
      sorted.forEach(function (e, i) { e.order = i; });
      // 첫 화면 운전 상태 즉시 계산 — 판정 틱 전까지 두절 설비가 정상처럼 보이는 것 방지
      self._refreshRunState(self.data.now || Date.now());
      // 고른 태그가 남아 있으면 유지, 없으면 worst로
      var keep = self.state.selTag && sorted.some(function (e) { return e.id === self.state.selTag; });
      self.setState({ ready: true, srcNotice: '', srcCap: data.cap || null, selTag: keep ? self.state.selTag : (sorted.length ? sorted[0].id : null) });
      self._loadedSel = sel;
      self._onLoadOk();
      self._loadEventsLive();
      self._startTimers();
    }).catch(function (e) {
      self.setState({ ready: true });
      self._startTimers();
      self._onLoadFail(e, sel);
    }).then(done, done);
  }
  /* 불러오기 실패 — 옛 데이터로 감시 지속하며 재시도
     _loadFail 동안 서버 타이머 재굽기 금지(_syncMonitorTimer·_syncBandTimer) — 빠진 테이블을 '태그 없음'으로 읽어 타이머 축소 방지 */
  _onLoadFail(e, sel) {
    var self = this;
    var first = !this._loadFail;
    this._loadFail = true;
    var n = this._loadTries = (this._loadTries || 0) + 1;
    var wait = Math.min(LOAD_RETRY_MAX_MS, LOAD_RETRY_MS * Math.pow(2, n - 1));
    var loaded = this._loadedSel || [];
    this.setState({ loadFail: {
      why: (e && e.message) || String(e || ''),
      tables: (e && e.tables) || [],
      missing: (sel || []).filter(function (t) { return loaded.indexOf(t) < 0; }),
      tries: n, nextAt: Date.now() + wait,
    } });
    if (this._loadRetryT) clearTimeout(this._loadRetryT);
    this._loadRetryT = setTimeout(function () { self._loadRetryT = null; self._reloadLive(true); }, wait);
    if (first) this._toast('데이터를 다시 불러오지 못했습니다 — 이전 데이터로 감시하며 재시도합니다', 'err');
  }
  // 불러오기 실패 배너 — 감시 이상 배너와 같은 줄, 감시 유지·누락 범위·복귀 조건 함께 표시
  _loadFailWarns() {
    var self = this, LF = this.state.loadFail;
    if (!LF) return [];
    var t = '데이터를 다시 불러오지 못했습니다 — 화면과 감시는 마지막으로 불러온 데이터로 계속됩니다.';
    if (LF.missing.length) {
      t += ' 아직 못 불러온 테이블(' + LF.missing.join(', ') + ')은 감시되지 않습니다.'
        + ' 선택은 저장되어 있어 다시 저장할 필요는 없습니다.';
    }
    t += ' 재시도 ' + LF.tries + '회 실패 · 다음 시도 ' + CH.fmtFull(LF.nextAt).slice(11, 19) + '.';
    if (LF.tries >= 3 && LF.tables.length) {
      t += ' 계속 실패하면 ' + LF.tables.join(', ') + ' 테이블이 지워졌거나 권한이 없는지 확인하고, 필요하면 설정에서 선택을 해제하세요.';
    }
    if (LF.why) t += ' (' + LF.why + ')';
    return [{ lv: 'err', text: t, act: LF.busy ? '다시 시도 중…' : '지금 다시 시도', onAct: function () {
      if (self.state.loadFail && self.state.loadFail.busy) return;
      self.setState({ loadFail: Object.assign({}, self.state.loadFail, { busy: true }) });
      self._reloadLive(true);
    } }];
  }
  _onLoadOk() {
    var was = this._loadFail;
    this._loadFail = false;
    this._loadTries = 0;
    if (this._loadRetryT) { clearTimeout(this._loadRetryT); this._loadRetryT = null; }
    if (this.state.loadFail) this.setState({ loadFail: null });
    if (was) this._toast('데이터를 다시 불러왔습니다 — 정상 감시로 돌아왔습니다', 'ok');
  }
  // 타이머 2개 — 판정(monitorInterval)·카탈로그(CAT_TICK_MS) 분리(태그 증감 확인이 판정마다 붙지 않도록)
  _startTimers() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this;
    if (this._live) clearInterval(this._live);
    if (this._cat) clearInterval(this._cat);
    var iv = durMs(C.monitorInterval) || 3000;
    this._live = setInterval(function () { self._tickLive(); }, iv);
    this._cat = setInterval(function () { self._catalogTick(); }, CAT_TICK_MS);
  }
  /* 판정 틱 — RMS 구간 롤업 버킷을 테이블당 1회 배치 조회(NAME IN) 후 태그별 판정
     · 태그 증감 확인은 _catalogTick 담당
     · 화면 갱신은 틱 끝에서 */
  _tickLive() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, E = this.E, S = this.state;
    if (!this.live || !this.data || this._ticking) return;
    if (this.state.tab !== 'monitor' && !C.monitorOn) return; // 알람 켜져 있으면 어느 탭에서든 판정 지속
    if (!this._checkIdentity()) return;   // 계정 전환 중 — 조회가 관문에서 막혀 '조회 실패' 배너로 남지 않게
    this._ticking = true;
    var winMs = Math.max(durMs(C.evalWindow) || 10000, durMs(C.monitorInterval) || 3000);
    var now = Date.now(), from = now - winMs - WIN_LAG_MS;
    var byTable = {};
    this._activeEqs().forEach(function (eq) { (byTable[eq.table] = byTable[eq.table] || []).push(eq); });
    var failed = [];
    var _t0 = Date.now();   // 틱 실제 소요 — 부하 안내에 사용
    var jobs = Object.keys(byTable).map(function (table) {
      var eqs = byTable[table];
      return rollupBatch(table, eqs.map(function (e) { return e.name; }), 'sec', from, now)
        .then(function (byTag) {
          eqs.forEach(function (eq) {
            var buckets = byTag[eq.name] || [];
            if (!buckets.length) return;                  // 정지 설비 — 직전 값 유지
            // 구간 판정용 버킷 — 시각 기준으로 구간 길이만 남김(미완성 버킷은 windowRms가 cnt로 거름)
            var cut = now - winMs;
            eq.secBuckets = buckets.filter(function (b) { return b.ms >= cut; });
            var last = buckets[buckets.length - 1];
            eq.lastSeen = last.ms;
            eq.rms = last.rms;                            // 최신 1초(표시 보조·폴백용)
            eq.sparkBuf = mergeSpark(eq.sparkBuf, buckets, SPARK_MS);
            eq.sparkVals = eq.sparkBuf.map(function (b) { return b.rms; });
            eq.spark = E.sparkPath(eq.sparkVals.length ? eq.sparkVals : [0, 0], 132, 40, 3);
            eq.grade = self._severityOf(eq);               // 화면 등급도 판정값 기준 — 표시·이벤트 일치
            if (last.ms > self.data.now) self.data.now = last.ms;
          });
        }).catch(function () { failed.push(table); });
    });
    Promise.all(jobs).then(function () {
      self._ticking = false;
      // 조회 부하 실측(지수평활) — 부하 경고는 설치 환경의 실제 소요로 판단
      var _el = Date.now() - _t0;
      self._tickCostMs = self._tickCostMs == null ? _el : self._tickCostMs * 0.7 + _el * 0.3;
      if (failed.length && !self.state.srcNotice && !self._noticeMuted) {
        self.setState({ srcNotice: '데이터 소스 조회 실패 — ' + failed.join(', ') + ' 확인이 필요합니다.' });
      }
      self._refreshRunState(now);   // 정지·두절 표시용 — 판정과 별개로 서버 모드에서도 필요
      self._judgeLive().then(function (n) { if (n) self._loadEventsLive(); }); // 새 이벤트가 났을 때만 목록 갱신
      /* 화면 재그리기 제외
         - 설정 탭: 제어 입력이라 타이핑 중 재그리기 시 입력 지워짐
         - 기간 달력 열림: 고르는 중 버튼·팝오버 재그리기 방지
         - 상세분석: 캡처 스냅샷 화면(새로고침·태그전환·기간변경으로만 갱신)
         판정·알림은 계속 동작 */
      if (self.state.tab !== 'settings' && self.state.tab !== 'detail' && !pickerOpen.n) self.forceUpdate();
    }).catch(function () { self._ticking = false; });
  }
  /* 설비별 운전 상태 — 정지 / 신호 두절 / 운전 중
     _judgeLive는 서버 모드에서 안 돌아 표시용으로 따로 계산
      · 정지 — 데이터 유입 중, 값이 정지 수준
      · 두절 — 데이터 유입 없음(마지막 값이 남아 표시 없으면 정상처럼 보임)
     둘 다 판정 동결 — 정지를 호전으로 읽으면 거짓 복귀 알림 */
  _refreshRunState(now) {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    var iv = durMs(C.monitorInterval) || 3000;
    var lostMs = Math.max(60000, iv * 6);
    var m = {};
    this._activeEqs().forEach(function (eq) {
      var key = eq.table + ':' + eq.name;
      var b = (self._blMap || S.baselines || {})[key];
      var age = eq.lastSeen > 0 ? (now - eq.lastSeen) : 0;
      var lost = eq.lastSeen > 0 && age > lostMs;
      var val = self._evalValue(eq);
      // 참조값도 AC 기준 — 버킷 rms(DC 포함)와 비교 시 오프셋 센서가 항상 정지로 읽힘
      var run = !lost && VC.isRunning(val, VC.runRef(b, VC.acVals(eq.secBuckets)));
      /* 계측 이상 — 현재 버킷으로 직접 판정(MONSTATE.sf는 부팅 때 1회만 읽어 서버 모드서 미갱신)
         배지는 즉시, 이벤트는 1분 지속 후. 플랫라인은 값이 낮아도 정지 아닌 센서 고장 */
      var live = lost ? null : (VC.gateFromBuckets(eq.secBuckets, val, eq.rpm / 60) || self._rawGate(key));
      var gate = live ? { label: live.label, detail: live.detail } : null;
      if (gate) run = false;                 // 계측을 못 믿는 동안은 판정 동결(배지도 정지보다 우선)
      m[key] = { lost: lost, run: run, age: age, gate: gate };
    });
    var _prev = this._runState;
    this._runState = m;
    // 상세분석은 스냅샷이지만 계측 상태가 캡처 시점과 달라지면 배너(detStale)용으로 1회 재그리기
    if (S.tab === 'detail' && S.selTag) {
      var _de = this._activeEq(S.selTag), _dk = _de && (_de.table + ':' + _de.name);
      var _g0 = _dk && _prev ? (_prev[_dk] || {}).gate : null, _g1 = _dk ? (m[_dk] || {}).gate : null;
      if (_dk && (_g0 && _g0.label) !== (_g1 && _g1.label)) this.forceUpdate();
    }
    /* 표시 등급 — _judgeLive가 안 도는 경우(서버 모드·알람 꺼짐·비담당 탭) 같은 규칙으로 계산 — _severityOf의 게이트 없는 ISO 폴백 방지 */
    if (C.monMode === 'server' || !C.monitorOn || !this._isLead()) this._refreshDisplayGrade();
  }
  // 표시 등급만 계산(이벤트 없음) — 판정과 같은 규칙(결함 패턴 게이트), 발화는 서버 타이머 담당
  _refreshDisplayGrade() {
    var self = this, S = this.state;
    this._refreshBandNow();             // 최신 대역값 — 판정 경로와 같은 캐시
    this._refreshPatNow();              // 결함 패턴 — 등급을 켜는 축이라 표시에도 필요
    if (!this._gradeState) this._gradeState = {};
    this._activeEqs().forEach(function (eq) {
      var key = eq.table + ':' + eq.name;
      var wide = self._evalValue(eq);
      if (!isFinite(wide)) return;
      var revived = self._isRevived(key);
      var b = (self._blMap || S.baselines || {})[key];
      var iso = self._isoValue(eq, wide);
      var isoV = iso.pending ? wide : iso.v;                 // 계산 전에는 상한값
      /* ISO 존은 속도(mm/s) 규격 — 가속도·변위 원본은 변환값(basis='iso')만 사용, 변환 전엔 축 비움
         비운 축은 커버리지로 표시(등급이 조용히 낮아지지 않게) */
      var isoUsable = eq.unit === 'mm/s' || iso.basis === 'iso';
      var zg = isoUsable ? VC.gradeFor(isoV, self._isoZones(eq)) : 0;
      var lim = revived ? null : VC.baselineLimit(b);
      var bnow = (self._bandNow || {})[key];
      var bj = (bnow && !revived) ? VC.bandJudge(bnow, self._bandBaselines(eq), false, self._softBands(eq),
        (self._monState || {})[key] && self._monState[key].elat, Date.now()) : null;
      // 서버 모드도 같은 게이트 규칙(패턴이 켜고 ISO가 높이 결정) — 축 최댓값 사용 시 서버 등급과 불일치
      var _p = (self._patNow || {})[key] || null;
      var _hz = (_p && _p.iso != null) ? VC.gradeFor(_p.iso, self._isoZones(eq)) : zg;
      // 판정과 같은 보류 규칙 — 측정 가능하나 이번에 못 잰 태그는 직전 표시 등급 유지(calc.patternRound)
      var _prevGs = self._gradeState[key];
      var _pr = VC.patternRound(_p, self._patCapable(eq), _prevGs ? { g: _prevGs.gi } : null, _hz);
      var wg = VC.worstGrade(0, 0, 0, _pr.rg);
      // 카드용 축별 값 — 베이스라인은 한계 대비 배수, 대역은 최대 배수, 패턴은 격자 배수(등급은 패턴만, 나머지는 근거)
      wg.iso = isoV; wg.wide = wide; wg.limited = VC.isoNeeded(eq.fs); wg.basis = iso.basis || 'wide';
      wg.isoRaw = iso.pending ? null : iso.vr;   // 화면 표시용 — 같은 대역의 원본 단위 RMS
      wg.isoOk = isoUsable; wg.isoUnit = isoUsable ? 'mm/s' : eq.unit;
      wg.blOk = lim != null; wg.bandOk = !!bj;
      wg.patOk = !!_p; wg.patOn = !!(_p && _p.on); wg.patR = _p ? _p.r : null;
      wg.patMiss = _pr.miss; wg.patWait = _pr.miss && !self._patNow;
      wg.patWide = !!(_p && _p.demodSrc === 'wideband');   // 저샘플 전대역 복조 — 화면이 근거 낮춰 표기
      wg.blR = (lim != null && lim > 0) ? wide / lim : null;
      wg.bandR = bj ? bj.maxR : null;
      self._gradeState[key] = wg;
    });
  }
  /* 감시 생존 확인 — '조용함 = 정상'과 '조용함 = 감시 사망' 구분용
     서버 타이머(판정·대역) 신호 2개
      · 타이머 상태 — 첫 실행에서 죽으면 state가 'STOP, <에러>'(사유 그대로 표시)
      · 회차 상태 기록(__st:mon · __st:band) — 멈춘 회차·처리 0건·문제 코드(ST_ERR)
     앱 모드는 마지막 판정 시각만 확인(탭이 가려지면 브라우저가 타이머를 늦추므로 보이는 동안만, 넉넉한 기준) */
  _healthTick() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    if (!this.live) return Promise.resolve();
    // 알람 꺼져도 대역 추출은 동작 가능 — 그 타이머 상태는 계속 확인
    if (!C.monitorOn && !C.bandOn) { if (this.state.health) this.setState({ health: null }); return Promise.resolve(); }
    // 대역 추출은 앱 모드에서도 서버 타이머로 동작 → 켜져 있으면 타이머·대역 상태 기록 확인
    var srv = C.monMode === 'server';
    if (!srv && !C.bandOn) { this._applyHealth(null, null); return Promise.resolve(); }
    return Promise.all([
      timerStates(),
      (srv || C.bandOn) ? loadMonState().catch(function () { return null; }) : Promise.resolve(null),
    ]).then(function (r) {
      /* 조회 실패 한 번으로 배너 전환 안 함 — 못 읽은 틱은 화면 유지, 연속 TIMER_MISS_MIN회부터 '모름' 표시
         ⚠ 계수는 여기서 — _applyHealth 안에서 세면 '볼 것 없음' 경로(_applyHealth(null,null))의 배너 제거까지 막힘 */
      if (r[0]) self._timersMiss = 0;
      else if ((self._timersMiss = (self._timersMiss || 0) + 1) < TIMER_MISS_MIN) return;
      self._applyHealth(r[0], self._timerStatus(r[1]));
    }).catch(function () {});
  }
  /* 타이머 회차 상태 기록 — MONSTATE 예약 키 __st:mon · __st:band({t, ms, n, pat, err[], nf})
     재등록 전 옛 판정 스크립트는 __hb·__nferr만 남김 → 같은 모양으로 대신 읽음 */
  _timerStatus(m) {
    if (!m) return { mon: null, band: null };
    var mon = m['__st:mon'] || null;
    if (!mon && m.__hb) {
      mon = { t: m.__hb.t, ms: m.__hb.ms, n: m.__hb.n, pat: m.__hb.pat, err: [],
        nf: (m.__nferr && m.__nferr.t > 0) ? m.__nferr : null };
    }
    return { mon: mon, band: m['__st:band'] || null };
  }
  // 상태 기록의 문제 하나 → 배너(코드별 문구는 ST_ERR)
  _stErrWarn(who, key, e) {
    var d = ST_ERR[e && e.c];
    if (!d) return null;
    return { k: 'st:' + key + ':' + e.c, lv: d.lv, text: who + ' — ' + d.text(e.n || 1) + (e.m ? ' (' + e.m + ')' : '') };
  }
  // 최근 회차 소요 중앙값 — 시각(hb.t)이 바뀐 것만 새 표본, 표본 모이기 전엔 null
  _tickMsMedian(hb) {
    if (!hb || hb.ms == null) return null;
    var h = this._msHist || (this._msHist = []);
    if (!h.length || h[h.length - 1].t !== hb.t) {
      h.push({ t: hb.t, ms: hb.ms });
      if (h.length > SLOW_WIN_N) h.shift();
    }
    if (h.length < SLOW_MIN_N) return null;
    var a = h.map(function (x) { return x.ms; }).sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)];
  }
  // 베어링 표시 이름 — 직접 입력은 적어 둔 품번(없으면 '직접 입력')
  _bearingLabel(eq) {
    var b = (eq && eq.bearing) || {};
    return b.name ? b.name + ' (직접 입력)' : (b.model || '');
  }
  // 결함 패턴 측정 가능 태그 — 회전수·구름체 기하 둘 다 필요(monPattern·서버 patValue와 같은 조건, 미끄럼 베어링은 n=0이라 제외)
  _patCapable(eq) { return eq.rpm > 0 && !!(eq.bearing && eq.bearing.n > 0); }
  // 회전수 표기 — 종동측이면 출처 함께(모터 명판과 숫자가 다른 이유)
  _rpmText(eq) {
    var src = eq.rpmSrc;
    return eq.rpm + ' RPM' + (src === 'pulley' ? ' (종동축·풀리 환산)' : src === 'measured' ? ' (종동축·입력값)' : '');
  }
  _patBlocked() {
    var eqs = this.data ? this._activeEqs() : [];
    var noRpm = 0, noGeo = 0;
    eqs.forEach(function (e) {
      if (!(e.rpm > 0)) noRpm++;
      else if (!(e.bearing && e.bearing.n > 0)) noGeo++;
    });
    return { n: noRpm + noGeo, total: eqs.length, noRpm: noRpm, noGeo: noGeo,
      why: (noRpm && noGeo) ? '회전수 ' + noRpm + '대 · 베어링 형식 ' + noGeo + '대 미입력'
        : noRpm ? '회전수 미입력' : '베어링 형식 미입력' };
  }
  _applyHealth(timers, st) {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state, now = Date.now();
    var hb = st ? st.mon : null, sb = st ? st.band : null;   // 판정·대역 회차 상태 기록
    // 놓친 알림 — nf 필드가 없으면(직전 상태 모름) 마지막 값 유지
    if (hb && 'nf' in hb) this._nfLast = hb.nf;
    var nferr = this._nfLast || null;
    var iv = durMs(C.monitorInterval) || 3000;
    var warns = [];
    var reMon = function () { self._toast('서버 감시를 다시 등록합니다'); self._specSig = null; self._syncMonitorTimer(); };
    var reBand = function () { self._toast('대역 추출을 다시 등록합니다'); self._bandSig = null; self._syncBandTimer(); };
    // 자동 복구 대상 — 켜둔 설정인데 스스로 멈춘 타이머. 복구 문구로 공백 구간의 침묵이 근거 아님을 명시
    var MON_T = { key: 'mon', recK: 'recovered', toast: '서버 감시가 멈춰 자동으로 다시 등록합니다',
      sync: function () { self._specSig = null; self._syncMonitorTimer(true); },
      rec: function (ago, why) { return '서버 감시가 ' + ago + ' 전 멈췄다가 자동으로 복구됐습니다 — ' + why
        + '. 그 사이 판정이 없었으므로 이 구간의 "이상 없음"은 확인된 것이 아닙니다'; } };
    var BAND_T = { key: 'band', recK: 'bandrecovered', toast: '대역 추출이 멈춰 자동으로 다시 등록합니다',
      sync: function () { self._bandSig = null; self._syncBandTimer(true); },
      rec: function (ago, why) { return '대역 추출이 ' + ago + ' 전 멈췄다가 자동으로 복구됐습니다 — ' + why
        + '. 그 사이 대역 값이 쌓이지 않아 대역 기준이 판정에서 빠져 있었습니다'; } };
    var dead = null, dband = null;   // 사망 판정 사유 — 자동 복구 입력
    // 감시 타이머 점검은 알람이 켜져 있을 때만 — 알람 OFF면 타이머가 내려가 있는 게 정상(대역 추출만 켠 경우)
    if (C.monMode === 'server' && C.monitorOn) {
      if (!timers) {
        warns.push({ k: 'unknown', lv: 'warn', text: '감시 타이머 상태를 확인할 수 없습니다 — Neo 연결을 확인하세요' });
      } else {
        var t = timers[monTimer()];
        if (!t) {
          warns.push({ k: 'nomon', lv: 'err', text: '서버 감시 타이머가 등록되어 있지 않습니다 — 감시가 돌지 않습니다', act: '다시 등록', onAct: reMon });
        } else if (!/^RUNNING/.test(t.state || '')) {
          // state에 'STOP, ReferenceError: ...'처럼 사유 포함 — 그대로 표시
          dead = { k: 'stopped', text: '서버 감시가 멈춰 있습니다 — ' + (t.state || '상태 불명'), why: t.state || '상태 불명' };
        }
      }
      // 심박 — 판정 주기 6배 초과 시 RUNNING이어도 실제 미동작
      if (hb && hb.t) {
        var age = now - hb.t;
        // 패턴 측정 1건 이상이면 0 홀드 해제 — 옛 0구간이 남아 다음 0에 즉시 뜨는 것 방지
        if (hb.pat > 0) this._patZeroAt = 0;
        if (age > Math.max(60000, iv * 6)) {
          // RUNNING인데 판정 미동작 — STOP과 같은 조치(재등록)
          var _st = '마지막 판정이 ' + durKo(age) + ' 전입니다 (주기 ' + C.monitorInterval + ')';
          if (!dead) dead = { k: 'stale', text: _st, why: _st };
        } else if (hb.pat != null && hb.n > 0 && hb.pat === 0) {
          /* 훑기는 하나 패턴 측정 태그 0 — 등급 축이 비어 알람 불가(다른 검사는 전부 통과해 화면이 조용함)
             홀드(PAT_ZERO_MS) — 패턴은 주기마다 재므로 기동 직후 0은 정상. pat 필드 없는 옛 TQL은 제외 */
          if (!this._patZeroAt) this._patZeroAt = now;
          if (now - this._patZeroAt > PAT_ZERO_MS) {
            warns.push({ k: 'nopat', lv: 'warn',
              text: hb.n + '대를 훑었지만 결함 패턴을 잰 태그가 0입니다 — 등급을 켜는 축이 비어 알람이 날 수 없습니다'
                + '. 회전수·베어링 기하가 없거나, 판정 창에 표본이 모자랍니다',
              act: '설비 정보 열기', onAct: function () { self.setState({ tab: 'settings', setSection: 'equip' }); } });
          }
        } else if (hb.n === 0) {
          warns.push({ k: 'nodata', lv: 'warn', text: '판정 대상이 0개입니다 — 감시 태그에 새 데이터가 들어오는지 확인하세요' });
        }
        /* 회차 소요가 주기에 근접하면 경고 — 겹친 회차는 잠금으로 건너뛰어 실제 주기가 조용히 늘어남
           중앙값 + 히스테리시스(SLOW_ON/OFF) — 회차별 소요 편차로 인한 배너 깜빡임 방지 */
        var _med = this._tickMsMedian(hb);
        if (_med != null) {
          this._slowOn = this._slowOn ? (_med > iv * SLOW_OFF) : (_med > iv * SLOW_ON);
          if (this._slowOn) {
            var _over = _med >= iv;
            warns.push({
              k: 'slowtick', lv: _over ? 'err' : 'warn',
              text: '서버 감시 1회차가 ' + (_med / 1000).toFixed(1) + '초 걸립니다 (최근 회차 중앙값 · 주기 '
                + C.monitorInterval + ' · 태그 ' + hb.n + '개)'
                + (_over ? ' — 회차가 겹쳐 일부 주기를 건너뜁니다. 주기를 늘리거나 감시 태그를 줄이세요.' : ' — 주기를 늘리는 것을 권합니다.'),
              act: '설정 열기', onAct: function () { self.setState({ tab: 'settings', setSection: 'monitor' }); },
            });
          }
        }
      }
      // 발송 설정 읽기 실패 회차 — 이벤트는 기록되나 알림 미발송. 읽기 성공 회차에 서버가 기록 삭제(t:0)
      if (nferr && nferr.t > 0) {
        warns.push({ k: 'nferr', lv: 'err',
          text: '서버 감시가 알림 설정을 읽지 못해 이벤트 ' + (nferr.n || 0) + '건을 알리지 못했습니다 ('
            + durKo(Math.max(0, now - nferr.t)) + ' 전 · ' + (nferr.m || '사유 미상')
            + ') — 이벤트 이력에는 남아 있습니다. 알림 설정을 다시 저장해 보세요',
          act: '알림 설정 열기', onAct: function () { self.setState({ tab: 'settings', setSection: 'monitor' }); } });
      }
      // 회차 문제 — 상태 조회 실패·태그 실패·회차 예외
      ((hb && hb.err) || []).forEach(function (e) { var w = self._stErrWarn('서버 감시', 'mon', e); if (w) warns.push(w); });
      // 타이머 상태 못 읽으면(timers null) 복구·복구 문구 생략 — 모르는 상태를 살아났다고 표시 금지
      if (timers) {
        var _rw = this._recoverWarn(MON_T, dead, now, reMon);
        if (_rw) warns.push(_rw);
      }
    }
    if (C.monMode !== 'server' && C.monitorOn && this._lastJudgeAt
      && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) {
      var lag = now - this._lastJudgeAt;
      if (lag > Math.max(60000, iv * 20)) {
        warns.push({ k: 'applag', lv: 'warn', text: '앱 판정이 ' + durKo(lag) + ' 동안 멈춰 있습니다 — 탭을 다시 열거나 새로고침하세요' });
      }
    }
    // 대역 추출은 감시 모드와 무관하게 동작 → 확인·복구도 모드 분기 밖(앱 모드 사용자도 대역 사망 인지)
    if (C.bandOn && timers) {
      var b = timers[bandTimer()];
      // 없는 사유 구분 — 대상 태그 0이면 앱이 안 구운 것이라 '다시 등록' 무의미 → 설비 정보(RPM)로 안내
      if (!b && this._bandNoTarget) {
        warns.push({ k: 'bandnotarget', lv: 'warn',
          text: '대역 추출이 켜져 있지만 조건을 갖춘 태그가 없어 돌지 않습니다 — ' + (this._bandSkipWhy || '대상 없음')
            + '. 대역 경계가 회전주파수의 배수로 정의되므로 RPM 없이는 대역을 나눌 수 없습니다',
          act: '설비 정보 열기', onAct: function () { self.setState({ tab: 'settings', setSection: 'equip' }); } });
      } else if (!b) warns.push({ k: 'noband', lv: 'warn', text: '대역 추출 타이머가 등록되어 있지 않습니다', act: '다시 등록', onAct: reBand });
      else if (!/^RUNNING/.test(b.state || '')) dband = { k: 'bandstop', text: '대역 추출이 멈춰 있습니다 — ' + (b.state || '상태 불명'), why: b.state || '상태 불명' };
      else if (sb && sb.t) {
        // RUNNING인데 회차 기록이 멈춤 — 추출 주기 3배(최소 30분) 초과 시 정지와 같은 조치(재등록)
        var bIv = durMs(C.bandInterval) || 600000, bAge = now - sb.t;
        if (bAge > Math.max(1800000, bIv * 3)) {
          var _bst = '대역 추출이 ' + durKo(bAge) + ' 동안 회차를 마치지 못했습니다 (주기 ' + (C.bandInterval || '10m') + ')';
          dband = { k: 'bandstale', text: _bst, why: _bst };
        }
      }
      var _bw = this._recoverWarn(BAND_T, dband, now, reBand);
      if (_bw) warns.push(_bw);
      ((sb && sb.err) || []).forEach(function (e) { var w = self._stErrWarn('대역 추출', 'band', e); if (w) warns.push(w); });
    } else if (!C.bandOn && this._recover) { delete this._recover.band; }   // 꺼둔 기능의 흔적 제거
    // 표시 상한으로 감시에서 빠진 태그 수 명시 — 알람 없음이 정상 때문이 아닌 경우
    var _cap = S.srcCap;
    if (_cap && _cap.dropped > 0) {
      warns.push({
        k: 'cap', lv: 'warn',
        text: '태그 ' + _cap.dropped + '개가 표시 상한(테이블당 ' + CAPS.perTable + '개 · 전체 ' + CAPS.total
          + '개)을 넘어 감시에서 빠져 있습니다 — 감시 중인 태그는 ' + _cap.shown + '개입니다',
        act: '설정에서 확인', onAct: function () { self.setState({ tab: 'settings', setSection: 'source' }); },
      });
    }
    // 되살아난 태그 — 같은 설비인지 사람 확인 후 학습 기반 판정 재개(이름 외 단서 없음)
    var revKeys = Object.keys(S.revived || {});
    if (revKeys.length) {
      var alias = function (k) { return (C.aliases || {})[k] || k.split(':')[1] || k; };
      warns.push({
        k: 'revived', lv: 'warn',
        text: revKeys.length === 1
          ? alias(revKeys[0]) + ' — 새로 추가된 태그에 예전 학습값이 남아 있습니다. 이전과 같은 설비인지 확인해 주세요'
          : '새로 추가된 태그 ' + revKeys.length + '개에 예전 학습값이 남아 있습니다. 이전과 같은 설비인지 확인해 주세요',
        act: '설정에서 확인', onAct: function () { self.setState({ tab: 'settings', setSection: 'criteria' }); },
      });
    }
    /* 결함 패턴 축을 세울 수 없는 태그 — 설비 정보 입력으로만 해소되므로 카드 호버 아닌 상시 배너
       ⚠ 서명(sig) 계산 앞에 둘 것 — 뒤에 두면 다른 경고 불변 시 return으로 이 배너 갱신 누락 */
    var _blk = this._patBlocked();
    if (_blk.n) {
      warns.push({ k: 'nogeo', lv: 'warn',
        text: _blk.total + '대 중 ' + _blk.n + '대가 결함 패턴을 못 재 등급이 서지 않습니다 — ' + _blk.why
          + '. 이 설비들의 "이상 없음"은 확인된 것이 아닙니다',
        act: '설비 정보 열기', onAct: function () { self.setState({ tab: 'settings', setSection: 'equip' }); } });
    }
    var sig = warns.map(function (w) { return w.k + ':' + w.text; }).join('|');
    if (sig === this._healthSig) return;      // 같은 상태면 리렌더 생략
    this._healthSig = sig;
    this.setState({ health: warns.length ? warns : null });
  }
  // 죽었으면 재등록, 살아났으면 사망 사실 표시 — 끊긴 구간의 '알람 없음'은 정상 아님
  _recoverWarn(tgt, dead, now, manual) {
    var all = this._recover || (this._recover = {});
    var R = all[tgt.key] || (all[tgt.key] = { n: 0, at: 0, why: '' });
    // 오래 조용했으면 시도 횟수 초기화 — 드문 순간 장애 누적으로 시도 소진 방지
    if (R.at && now - R.at > RECOVER_CALM_MS) { R.n = 0; R.at = 0; R.why = ''; }
    if (!dead) {
      if (!R.n) return null;
      return { k: tgt.recK, lv: 'warn', text: tgt.rec(durKo(now - R.at), R.why) };
    }
    if (R.n >= RECOVER_MAX) {
      return { k: dead.k, lv: 'err', text: dead.text + ' · 자동 복구 ' + R.n + '회로 살아나지 않았습니다 — 사유를 확인하세요',
        act: '다시 등록', onAct: manual };
    }
    // 방금 시도했으면 결과 대기 — 등록 직후 첫 회차 미실행 가능
    if (R.at && now - R.at < RECOVER_GAP_MS) {
      return { k: dead.k, lv: 'err', text: dead.text + ' · 자동 복구 ' + R.n + '회 시도, 결과를 기다리는 중입니다',
        act: '다시 등록', onAct: manual };
    }
    // 자동 복구는 담당 탭만 — 여러 탭·PC가 동시에 재등록하면 등록이 서로 덮임
    if (!this._isLead()) {
      return { k: dead.k, lv: 'err', text: dead.text + ' · 자동 복구는 이 계정의 다른 탭(또는 PC)이 맡습니다',
        act: '다시 등록', onAct: manual };
    }
    R.n++; R.at = now; R.why = dead.why;
    this._toast(tgt.toast);
    tgt.sync();
    return { k: dead.k, lv: 'warn', text: dead.text + ' · 자동으로 다시 등록했습니다 (' + R.n + '/' + RECOVER_MAX + ')' };
  }
  /* ── 탭·PC 조율 ──
     한 계정의 백그라운드 쓰기(앱 모드 판정·알림, 서버 스크립트 재등록·자동 복구, 알던 태그 저장)는 담당 하나만
     · __lead {id, t}: 담당 기록 — LEAD_TTL_MS 넘게 갱신 없으면 이어받음(새로 잡을 땐 기록 뒤 다시 읽어 확인)
     · __cfgv · __blv {id, t}: 설정·학습값 저장 표시 — 다른 곳이 저장했으면 다시 읽음
     사용자가 누르는 작업(설정 저장·학습·리포트)은 어느 탭에서나 가능 */
  /* 담당 여부 — 조율 전(undefined)은 허용(오프라인·단일 경로)
     마지막 갱신이 만료 시간을 넘기면 담당 아님 — 백그라운드 탭 타이머 지연 중 다른 곳이 이어받은 구간의 이중 기록 방지 */
  _isLead() {
    if (this._lead === false) return false;
    return !this._leadAt || Date.now() - this._leadAt <= LEAD_TTL_MS;
  }
  // MONSTATE 읽기·쓰기·설정 다시 읽기·확인 대기 — 테스트 교체용 메서드 래핑
  _monLoad() { return loadMonState(); }
  _monSave(k, o) { return saveMonState(k, o); }
  _cfgLoad() { return loadConfig(); }
  _leadWait() { return new Promise(function (r) { setTimeout(r, LEAD_CONFIRM_MS + Math.random() * 1000); }); }
  _coordTick() {
    var self = this;
    if (!this.live || !this._checkIdentity()) return Promise.resolve();
    if (this._coordP) return this._coordP;   // 진행 중이면 그 결과를 기다림
    this._coordP = this._monLoad().then(function (m) {
      m = m || {};
      var now = Date.now(), L = m.__lead;
      var mine = !!(L && L.id === self._tabId), free = !L || !(L.t > 0) || now - L.t > LEAD_TTL_MS;
      var claim = (mine || free)
        ? self._monSave('__lead', { id: self._tabId, t: now }).then(function () {
          if (mine) return true;
          /* 새로 잡음 — 잠시 뒤 다시 읽어 마지막 기록자만 담당(동시에 연 탭)
             확인되면 판정 상태를 DB 값으로 교체(표시만 하던 동안의 메모리는 옛 값) */
          return self._leadWait().then(function () { return self._monLoad(); }).then(function (m2) {
            var ok = !!(m2 && m2.__lead && m2.__lead.id === self._tabId);
            if (ok) self._monState = m2;
            return ok;
          });
        })
        : Promise.resolve(false);
      return claim.then(function (lead) {
        if (lead) self._leadAt = now;
        self._setLead(lead);
        return self._syncStamps(m);
      });
    }).catch(function () {}).then(function () { self._coordP = null; });
    return this._coordP;
  }
  _setLead(lead) {
    if (lead === this._lead) return;
    this._lead = lead;
    this.forceUpdate();   // 헤더 '보기 전용' 표시
  }
  // 다른 곳의 저장 반영(다시 읽기 끝까지 대기) — 첫 조율은 기준만 기록(방금 읽은 설정·학습값)
  _syncStamps(m) {
    var self = this, cv = m.__cfgv || null, bv = m.__blv || null, jobs = [];
    var ck = cv ? cv.id + '@' + cv.t : '', bk = bv ? bv.id + '@' + bv.t : '';
    if (this._cfgSeen == null) { this._cfgSeen = ck; this._blSeen = bk; return Promise.resolve(); }
    if (ck !== this._cfgSeen) {
      this._cfgSeen = ck;
      if (cv.id !== this._tabId) jobs.push(this._cfgLoad().then(function (cfg) { if (cfg) self._adoptConfig(normCfg(cfg)); }));
    }
    if (bk !== this._blSeen) {
      this._blSeen = bk;
      if (bv.id !== this._tabId) jobs.push(Promise.resolve(this._loadBaselines()));
    }
    return Promise.all(jobs.map(function (p) { return p.catch(function () {}); }));
  }
  // 저장 표시 — 다른 탭·PC가 다음 조율(10초 안)에 다시 읽음
  _bumpStamp(k) {
    if (!this.live) return Promise.resolve();
    var o = { id: this._tabId, t: Date.now() };
    if (k === 'bl') this._blSeen = o.id + '@' + o.t; else this._cfgSeen = o.id + '@' + o.t;
    return this._monSave(k === 'bl' ? '__blv' : '__cfgv', o).catch(function () {});
  }
  // 다른 곳에서 저장된 설정 적용 — 적용본 교체, 편집 중인 폼은 유지(안내), 데이터에 영향 있으면 다시 불러오기
  _adoptConfig(cfg) {
    var prev = this._ac(), tables = this.liveTables || [], dirty = !!this.state.dirty;
    if (cfg.srcSel) cfg.srcSel = cfg.srcSel.filter(function (t) { return tables.indexOf(t) >= 0; });
    this._setApplied(cfg);
    var A = this._ac(), patch = {};
    CFG_KEYS.forEach(function (k) { if ((!dirty || FORM_KEYS.indexOf(k) < 0) && A[k] !== undefined) patch[k] = cfgClone(A[k]); });
    this.setState(patch);
    if (dirty) this._toast('다른 곳에서 설정이 저장되었습니다 — 지금 편집을 저장하면 그 변경을 덮어씁니다', 'warn');
    var DATA_KEYS = ['srcSel', 'equipCls', 'equipRpm', 'equipBearing', 'equipGeo', 'equipUnit', 'equipMeta', 'lineHz', 'aliases'];
    if (DATA_KEYS.some(function (k) { return JSON.stringify(prev[k]) !== JSON.stringify(A[k]); })) this._reloadLive(true);
    else if (prev.monitorInterval !== A.monitorInterval) this._startTimers();
  }
  // 로그인 계정 확인 — 다른 계정이면 이 탭의 쓰기를 모두 멈추고 새로고침 안내(같은 계정 재로그인은 무관)
  _checkIdentity() {
    if (!this.user) return true;
    var who = jwtUser(), bad = !!who && who !== String(this.user).toUpperCase();
    var next = bad ? who : null;
    if (bad) this._lead = false;   // 담당 내려놓음 — 같은 계정의 다른 탭이 이어받음, 원래 계정 복귀 시 다음 조율에서 다시 잡음
    if ((this.state.idSwitch || null) !== next) this.setState({ idSwitch: next });
    return !bad;
  }
  /* 카탈로그 틱 — 감시 상태 점검·탭 조율 + 태그 추가·삭제 확인
     태그: 이름 집합 비교 후 늘었을 때만 tagStats로 데이터 유무 확인·편입, 사라진 것은 알림만 */
  _catalogTick() {
    var self = this;
    if (!this._checkIdentity()) return Promise.resolve();   // 계정 전환 중 — 조회·점검 멈춤(원래 계정 복귀 시 재개)
    this._healthTick();
    var coord = this._coordTick();
    this._refreshFlap();
    // 이벤트 목록 주기 갱신 — 앱은 서버 모드·다른 탭의 기록을 모름(앱 모드 판정 탭은 새 이벤트 때 즉시도 읽음)
    if (Date.now() - (this._evtPollAt || 0) >= EVT_POLL_MS) { this._evtPollAt = Date.now(); this._loadEventsLive(); }
    if (!this.live || !this.data || this._cating) return Promise.resolve();
    this._cating = true;
    var byTable = {};
    this._activeEqs().forEach(function (eq) { (byTable[eq.table] = byTable[eq.table] || []).push(eq.name); });
    var added = false, gone = false, failed = [];
    var liveKeys = [], okTables = [];      // 되살아남 검사용 — 조회 성공 테이블만
    // 표시 상한으로 빠진 태그는 새 태그 아님 — 재적재해도 또 잘려 매 틱 재적재 반복
    var capped = (this.state.srcCap && this.state.srcCap.droppedKeys) || {};
    var jobs = Object.keys(byTable).map(function (table) {
      var known = byTable[table];
      return listTags(table, 100000).then(function (names) {
        okTables.push(table);
        var have = {}, live = {};
        known.forEach(function (n) { have[n] = true; });
        names.forEach(function (n) { live[n] = true; });
        known.forEach(function (n) { if (!live[n]) gone = true; });
        // 되살아남 검사도 감시 대상만 — 잘린 태그를 걸면 설정 화면에 없는 태그를 가리킴
        names.forEach(function (n) { if (have[n] && !capped[table + ':' + n]) liveKeys.push(table + ':' + n); });
        var fresh = names.filter(function (n) { return !have[n] && !capped[table + ':' + n]; });
        if (!fresh.length) return;
        /* 처음 보는 이름은 데이터가 있을 때만 새 태그 — 메타(_<table>_meta)엔 데이터 삭제 후에도 이름 잔존,
           적재는 통계 없는 태그 제외(live.js) → 새 태그로 세면 매 틱 재적재. 통계 조회 실패 틱은 판단 보류 */
        return tagStats(table).catch(function () { return {}; }).then(function (stats) {
          fresh.forEach(function (n) {
            var st = stats[n];
            if (!st || !st.count || !st.maxMs) return;
            liveKeys.push(table + ':' + n);   // 데이터가 있는 새 태그만 되살아남 검사 대상
            added = true;
          });
        });
      }).catch(function () { failed.push(table); });
    });
    return Promise.all(jobs).then(function () {
      self._cating = false;
      // 되살아남 검사 — 실행 중 사라졌다 돌아온 태그 포착용, 조회 성공 테이블 범위만 비교
      if (okTables.length) self._checkRevived(liveKeys, okTables);
      // 불러오기 실패 중엔 재시도가 전체를 읽음 — 여기서 재적재 시 백오프 무시·화면 매번 적재 중
      if (added && !self._reloadPending && !self._loadFail) {
        self._reloadPending = true;
        self._toast('새 태그 감지 — 데이터를 다시 불러옵니다');
        setTimeout(function () { self._reloadPending = false; self._reloadLive(); }, 400);
        return;
      }
      // 제거는 알림만 — 사용자가 '다시 불러오기'로 확정(일시 소실 시 선택 보존)
      if ((gone || failed.length) && !self.state.srcNotice && !self._noticeMuted) {
        self.setState({ srcNotice: '데이터 소스 변동 감지 — 선택된 테이블 또는 태그가 제거되었거나 비어 있습니다.' });
        return;
      }
      /* 서버 모드 — 태그 목록이 TQL에 값으로 구워지므로 감시 대상 변경 시 재굽기(서명 같으면 생략)
         · 담당만 — 여러 탭이 동시에 등록하면 같은 이름 타이머가 두 벌
         · 조율 뒤 — 다른 곳이 방금 저장·재등록한 설정을 옛 설정으로 되돌리지 않게
         · 재적재 중 건너뜀 — 바뀐 선택을 옛 태그 목록으로 굽지 않게 */
      return coord.then(function () {
        if (!self._isLead() || self._reloading) return;
        self._syncMonitorTimer(true);
        self._syncBandTimer(true);
        self._syncWdTimer(true);
      });
    }).catch(function () { self._cating = false; });
  }
  // 현재 state(설정 폼 편집본) → 설정 객체 — 저장용
  _cfgFromState() {
    var S = this.state, o = {};
    CFG_KEYS.forEach(function (k) { o[k] = S[k]; });
    return o;
  }
  /* 적용된 설정 — 판정·서버 타이머·재적재·모니터링 화면 전용
     폼은 입력 즉시 state를 바꾸므로 저장 성공 값만 여기로 반영. 설정 읽기 전엔 state 그대로 */
  _ac() { return this._applied || this.state; }
  /* 표시 시간대 — 적용된 설정(저장본)을 따름, 비었거나 모르는 이름이면 브라우저 시간
     바뀌면 화면의 기간 글자('YYYY-MM-DDTHH:MM')를 새 시간대로 다시 적음 — 같은 순간 유지 */
  _applyZone() {
    var z = this._ac().displayTz || '';
    if (z === CH.getZone()) return;
    var S = this.state, keys = ['from', 'to', 'genFrom', 'genTo'], at = {}, patch = {};
    keys.forEach(function (k) { if (S[k]) at[k] = CH.parseDT(S[k]); });
    CH.setZone(z);
    keys.forEach(function (k) { if (isFinite(at[k])) patch[k] = CH.fmtDT(at[k]).replace(' ', 'T'); });
    if (Object.keys(patch).length) this.setState(patch);
  }
  _setApplied(src, keys) {
    var a = Object.assign({}, this._applied || this._cfgFromState());
    (keys || CFG_KEYS).forEach(function (k) { if (src[k] !== undefined) a[k] = cfgClone(src[k]); });
    this._applied = a;
    this._applyZone();
  }
  // 표시 전용 설정(카드 순서 등) 저장 — 타이머 재굽기 없음(_persistCfg는 판정 값용, 서버 TQL 재등록·토스트 동반)
  _persistView(keys, ov) {
    var self = this;
    if (this._cfgLocked()) return Promise.resolve();
    // setState 직후 state는 옛 값 → ov로 직접 전달
    var obj = Object.assign(this._cfgFromState(), ov || {});
    return saveConfigPartial(obj, keys)
      .then(function () { self._setApplied(obj, keys); self._bumpStamp('cfg'); })
      .catch(function (e) { self._toast('설정 저장 실패: ' + (e.message || e), 'err'); });
  }
  /* 설정 폼 밖에서 즉시 적용하는 값(헤더 알람 토글·진동 배지 RMS 구간·대역 추출 주기) — 그 키만 저장·적용
     전체 저장 시 설정 탭의 미저장 편집까지 포함됨. 편집본에도 같은 값 반영(다음 저장 때 되돌림 방지) */
  _applyNow(ov) {
    var self = this, keys = Object.keys(ov), prev = {}, A = this._ac();
    if (this._cfgLocked()) return Promise.resolve(false);
    keys.forEach(function (k) { prev[k] = cfgClone(A[k]); });
    // 선적용 — 저장 왕복 대기 없음, 저장 실패 시 되돌림
    this._setApplied(ov, keys);
    this.setState(ov);
    return saveConfigPartial(ov, keys).then(function () {
      self._bumpStamp('cfg');
      // 타이머 동기화 실패는 저장 실패 아님 — 다음 10초 점검이 재굽기
      return self._syncMonitorTimer(true)
        .then(function () { return self._syncBandTimer(true); })
        .catch(function () {})
        .then(function () { return true; });
    }, function (e) {
      self._setApplied(prev, keys);
      self.setState(prev);
      self._toast('설정 저장 실패: ' + (e.message || e), 'err');
      return false;
    });
  }
  _persistCfg() {
    var self = this;
    if (this._cfgLocked()) return Promise.resolve(false);
    var cfg = this._cfgFromState();
    return saveConfig(cfg)
      .then(function () { self._setApplied(cfg); self._bumpStamp('cfg'); return self._syncMonitorTimer(); }) // 저장 후 서버 타이머 생성/삭제 반영
      .then(function () { return self._syncBandTimer(); })      // 대역 추출 타이머도 함께
      .then(function () { return self._syncWdTimer(); })        // 감시자 타이머 잔존분 삭제
      .then(function () { self._cfgFresh = false; return true; })
      .catch(function (e) { self._toast('설정 저장 실패: ' + (e.message || e), 'err'); return false; });
  }
  // 현재 설정 → 서버 판정 TQL 스펙 (태그·존·베이스라인 + 시나리오 파라미터 ms)
  _monSpec() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    // 서버 TQL용 저장소 위치·행 키 접두 — 표는 공용(SYS 스키마) 한 벌, 계정 구분은 키 접두(하나만 틀려도 남의 행 접근)
    var tblPrefix = storePrefix(), keyPrefix = userKeyPrefix(), srcMap = srcMapOf(C.srcSel || []);
    var tags = this._activeEqs().map(function (eq) {
      var b = (self._blMap || S.baselines || {})[eq.table + ':' + eq.name];
      // 대역 베이스라인도 굽기 — null이면 서버가 대역 판정 건너뜀
      var bb = null, bbSrc = self._bandBaselines(eq);
      if (bbSrc) {
        bb = {};
        Object.keys(bbSrc).forEach(function (k) { bb[k] = { mu: bbSrc[k].mu, sigma: bbSrc[k].sigma, k: bbSrc[k].k || 3 }; });
      }
      return {
        tbl: eq.table, tag: eq.name, alias: eq.alias || eq.name, unit: eq.unit || '', // 알림 문구용
        fs: eq.fs || 0,                       // ISO 대역제한 판단·필터 설계용
        // 마운팅 상한 초과 대역 — bandJudge가 자체 완결형이라 서버에서 bandEdges 호출 불가 → 앱 계산값 굽기
        soft: self._softBands(eq),
        // 결함 패턴 격자용 회전수·기하 — 하나라도 없으면 patValue null(= 판정 불가, 화면 커버리지로 표시)
        rpm: eq.rpm > 0 ? eq.rpm : 0,
        geo: (eq.bearing && eq.bearing.n > 0)
          ? { n: eq.bearing.n, Bd: eq.bearing.Bd, Pd: eq.bearing.Pd, phi: eq.bearing.phi || 0 } : null,
        // zones = 원본 단위 존(조용함 판단) · isoZones = ISO 등급용 mm/s 존(앱 _isoZones와 같은 값)
        zones: eq.zones, isoZones: self._isoZones(eq),
        // 확인 대기 태그는 학습값 굽지 않음(앱과 동일)
        bl: (b && !self._isRevived(eq.table + ':' + eq.name)) ? { mu: b.mu, sigma: b.sigma, k: b.k || 3 } : null,
        bb: self._isRevived(eq.table + ':' + eq.name) ? null : bb,
      };
    });
    return {
      tblPrefix: tblPrefix, keyPrefix: keyPrefix, srcMap: srcMap,
      judgeSrc: judgeTick.toString(), // 앱과 동일 규칙 서버 임베드
      detailSrc: detailSrc(), // 이벤트 사유 문구도 같은 함수(durKo 포함 자체 완결형)
      limitSrc: VC.baselineLimit.toString(), // 한계식(클램프 포함)도 같은 방식 — 앱/서버 판정식 단일 소스
      bandSrc: VC.bandJudgeSrc(), // 대역 판정도 동일 소스(상수 포함 자체 완결형)
      winSrc: VC.windowRms.toString(), // 구간 RMS도 같은 함수 — 앱/서버 판정값 단일 소스
      // 정지·두절 판별도 같은 함수 — 없으면 서버가 설비 정지를 호전으로 읽어 복귀 알림
      runSrc: VC.isRunning.toString(),
      refSrc: VC.runRef.toString(),
      // ISO 존 판정 — 세 함수가 서로 이름 호출 → calc가 한 스코프로 묶음(따로 붙이면 압축 이름 불일치로 TQL 사망)
      isoSrc: VC.isoSrc(),
      // 가속도·변위 원본을 속도로 바꾸는 함수와 패턴 높이용 대역 평균 — 앱과 같은 소스
      convSrc: VC.convSrc(),
      // 계측 게이트 — 계측 문제 파형이면 서버도 판정 중단·계측 이상 알림(상호 호출 함수라 calc가 한 스코프로 묶음)
      gateSrc: VC.gateSrc(),
      // 결함 패턴 — 등급 축이라 앱과 같은 소스, 재계산 간격은 대역 추출 주기와 동일(둘 다 원시 파형 조회)
      patSrc: VC.patSrc(),
      patTtlMs: durMs(C.bandInterval || '10m') || 600000,
      isoTtlMs: ISO_TTL_MS, isoQuietMs: ISO_TTL_QUIET_MS, isoWinMs: ISO_WIN_MS,
      tickMs: durMs(C.monitorInterval) || 3000,   // 두절 기준(주기 6배)용
      // 알림 문구 시각의 표시 시간대 오프셋 — 서머타임으로 바뀌면 스크립트 서명이 달라져 다시 구움
      tzOffsetMin: Math.round(CH.offsetMs(Date.now()) / 60000),
      winMs: Math.max(durMs(C.evalWindow) || 10000, durMs(C.monitorInterval) || 3000),
      lagMs: WIN_LAG_MS,
      bandOrder: VC.BAND_ORDER,
      // 룩백 = 대역 추출 주기 4배(최소 1시간) — 한두 번 누락돼도 마지막 값 확보
      bandWinMs: Math.max(3600000, durMs(C.bandInterval) * 4),
      tags: tags,
      cfg: { escHold: SENSOR_HOLD_MS, recHold: SENSOR_CLEAR_MS,
        reno: { 1: durMs((C.renotify || {})['주의']), 2: durMs((C.renotify || {})['위험']), 3: durMs((C.renotify || {})['심각']) } },
      // 발송도 앱과 같은 함수 — 웹훅 URL 미포함(스크립트는 파일 API로 타 계정 열람 가능), 서버가 발송 때 계정 설정 표에서 읽음
      notify: { src: Notify.serverSrc(), cfgTable: configTable(), defs: ROUTE_DEFS },
    };
  }
  // 타이머 목록 조회 — 테스트 교체용 메서드 래핑
  _timerStates() { return timerStates(); }
  /* 타이머 삭제 후 '없음이 정상' 기억(SIG_NONE이면 조회도 생략)
     삭제 전 존재 확인 — 없는 타이머 DELETE는 Neo 500. 상태 조회 실패 시엔 그냥 삭제 시도 */
  _dropTimer(sigKey, del, name) {
    if (this[sigKey] === SIG_NONE) return Promise.resolve();
    var self = this;
    return this._timerStates().then(function (m) {
      if (m && name && !m[name]) { self[sigKey] = SIG_NONE; return true; }   // 이미 없음
      return del().then(function (r) { self[sigKey] = SIG_NONE; return r; });
    });
  }
  // 감시자 타이머는 사용 안 함 — 잔존분 삭제(감시·대역 TQL이 회차 전체를 try/catch로 감싸 STOP 없음)
  _syncWdTimer() {
    if (!this.live || this._cfgLocked(true)) return Promise.resolve();
    return this._dropTimer('_wdSig', deleteWdTimer, wdTimer());
  }

  /* 서버 상시감시 타이머 생성/삭제 — 앱 모드·알람 OFF면 삭제(고아 방지)
     TQL 자체 완결형이라 태그·존·베이스라인이 값으로 구워짐 → 값 변경 시 재굽기
     silent=true: 토스트 생략, 실제 변경 때만 재등록(재등록 사이 판정 주기 공백) */
  _syncMonitorTimer(silent) {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    // 설정 반영 전엔 굽지 않음 — 기본값(앱 감시)이 서버 타이머 삭제
    if (!this.live || this._cfgLocked(true)) return Promise.resolve();
    if (C.monMode !== 'server' || !C.monitorOn) return this._dropTimer('_specSig', deleteMonitorTimer, monTimer());
    // 불러오기 불완전 동안 굽지 않음 — 빠진 테이블을 '태그 없음'으로 읽어 타이머 축소 방지
    if (this._loadFail) return Promise.resolve();
    var spec = this._monSpec();
    var sched = { '1s': '@every 1s', '3s': '@every 3s', '5s': '@every 5s', '10s': '@every 10s', '30s': '@every 30s', '1m': '@every 1m', '10m': '@every 10m' }[C.monitorInterval] || '@every 3s';
    if (!spec.tags.length) {
      return this._dropTimer('_specSig', deleteMonitorTimer, monTimer())
        .then(function () { if (!silent) self._toast('감시할 태그가 없어 서버 감시를 만들지 않았습니다', 'warn'); });
    }
    // 서명에 생성 TQL 자체 포함 — 코드 변경(패키지 업데이트)에도 재굽기
    var tql = Monitor.buildMonitorTql(spec);
    var sig = JSON.stringify(spec.tags) + '|' + JSON.stringify(spec.cfg) + '|' + sched + '|' + spec.bandWinMs + '|' + spec.winMs
      + '|' + srcSig(tql);
    if (silent && sig === this._specSig) return Promise.resolve(); // 변경 없음 — 굽기 생략
    /* 임베드 소스 사전 실행 검증 — 타이머는 등록 성공 후 첫 실행에서 죽어 사망이 드러나지 않음
       검증 실패 시 기존 타이머 유지 */
    var bad = Monitor.validateSpec(spec);
    if (bad) {
      this._specSig = null;
      console.error('[vibe] 서버 감시 코드 검증 실패', bad);
      this._toast('서버 감시 코드 검증 실패 — 타이머를 바꾸지 않았습니다: ' + bad, 'err');
      return Promise.resolve();
    }
    return createMonitorTimer(tql, sched)
      .then(function () { self._specSig = sig; if (!silent) self._toast('서버 상시감시 켜짐 · ' + sched, 'ok'); })
      .catch(function (e) { self._specSig = null; if (!silent) self._toast('서버 감시 설정 실패: ' + (e.message || e), 'err'); });
  }
  /* 앱 내 판정 — 앱 모드에서 주기 평가(규칙은 judgeTick, 서버 타이머와 동일)
     · 회차 = 결함 패턴 측정(추출 주기), 계측·두절은 10초 축
     · MONSTATE에 후보·마지막 알림 저장 → 재시작 시 따라잡기 소급 */
  _judgeLive() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    if (!this.live || !C.monitorOn || !this.data) return Promise.resolve();
    if (C.monMode === 'server') return Promise.resolve(); // 서버 타이머가 판정 — 앱은 표시만(이중발화 방지)
    if (!this._isLead() || !this._checkIdentity()) return Promise.resolve();   // 담당 탭만 판정·기록(계정당 알림 하나)
    this._lastJudgeAt = Date.now();   // 앱 모드 심박 — 배너의 판정 동작 확인용
    var nowW = Date.now();   // 주기는 _startTimers 타이머가 결정(추가 스로틀 없음)
    var iv = durMs(C.monitorInterval) || 3000;
    if (!this._monState) this._monState = {};
    // 확정은 회차 기준 — 시간 상수는 계측 이상(sensorTick)·베이스라인 이탈 진입/해제용
    var cfg = {
      escHold: SENSOR_HOLD_MS, recHold: SENSOR_CLEAR_MS,
      reno: { 1: durMs((C.renotify || {})['주의']), 2: durMs((C.renotify || {})['위험']), 3: durMs((C.renotify || {})['심각']) },
    };
    var jobs = [], nEv = 0;
    var zoneLim = function (zs, g) { return g > 0 ? zs[g - 1] : zs[0]; };
    // 최신 대역값(주기 절반마다 다시 읽기)·결함 패턴(추출 주기마다 측정) — 캐시 사용
    this._refreshBandNow();
    this._refreshPatNow();
    this._activeEqs().forEach(function (eq) {
      var key = eq.table + ':' + eq.name;
      var b = (self._blMap || S.baselines || {})[key];
      var wide = self._evalValue(eq);       // 전대역 AC RMS — 평가 윈도우 전체의 실효값
      if (!isFinite(wide)) return;
      /* 존 판정과 베이스라인 판정은 다른 값 사용
         - 존: ISO 절대 기준 → 표준 정의 대역(10~1000 Hz)
         - 베이스라인: 자기 학습값 대비 → 전대역(1 kHz 위 결함도 포착)
         '존 양호 + 베이스라인 이탈' = 초과분이 1 kHz 위라는 진단 정보 */
      var iso = self._isoValue(eq, wide);
      var prevG = (self._monState[key] || {}).g || 0;
      var val = iso.pending ? null : iso.v;                  // 존 판정값
      // ISO 존은 속도(mm/s) 규격 — 가속도·변위 원본은 변환값(basis='iso')만 사용, 변환 전엔 직전 등급 유지
      var isoUsableW = eq.unit === 'mm/s' || iso.basis === 'iso';
      /* 등급은 결함 패턴이 켤 때만 상승, ISO는 높이 결정(ISO 독립 축은 오탐 과다)
         패턴 값은 추출 주기 캐시(_patNow)
         ⚠ 패턴 못 잰 태그(회전수·기하 미입력, 저샘플, 표본 부족)는 등급 불변 — '판정 못 함'으로 커버리지에 표시 */
      var _isoG = (iso.pending || !isoUsableW) ? prevG : VC.gradeFor(val, self._isoZones(eq));
      var _pat = (self._patNow || {})[key] || null;
      // 높이 = 패턴을 잰 그 파형의 ISO(10초 축 ISO면 패턴 주기와 시간축 불일치), 없으면 10초 축 값으로 대체
      var _hv = (_pat && _pat.iso != null) ? _pat.iso : val;   // 높이를 정한 ISO 값 — 이벤트 값 칸에도 이 값
      var _hG = (_pat && _pat.iso != null) ? VC.gradeFor(_pat.iso, self._isoZones(eq)) : _isoG;
      // 측정 가능 태그인데 이번 결과 없음 → 판정 보류(직전 등급·회차 승계로 거짓 복귀 방지, calc.patternRound)
      var _pr = VC.patternRound(_pat, self._patCapable(eq), self._monState[key] || null, _hG);
      var rg = _pr.rg;
      var cur = wide;                                        // 베이스라인 판정값
      // 되살아난 태그는 확인 전까지 학습 기반 판정 중단(ISO 존은 절대 기준이라 계속)
      var revived = self._isRevived(key);
      var lim = revived ? null : VC.baselineLimit(b); // 미학습이면 null — 클램프 포함(서버 스크립트와 같은 함수)
      var breach = lim != null && isFinite(cur) && cur > lim;
      var prev = self._monState[key];
      // 운전 판별 — 정지 수준이면 판정 동결. 전대역 사용, 참조는 학습 μ 또는 최근 sec 버킷 AC(DC 포함 rms면 오프셋 센서가 정지로 읽힘)
      var run = VC.isRunning(wide, VC.runRef(b, VC.acVals(eq.secBuckets)));
      // 신호 두절 — 판정 주기 6배(최소 1분) 무수신(한두 번 누락과 구분)
      var lost = eq.lastSeen > 0 && (nowW - eq.lastSeen) > Math.max(60000, iv * 6);
      if (lost) run = false;
      /* 계측 게이트 — 두절 확인 뒤, 진동 판정 앞
         계측 문제 파형이면 진동 판정 중단·계측 이상으로 별도 알림(접촉 불량 과대·클리핑 과소 방지)
         두절이면 파형이 없어 건너뜀(순서 바뀌면 두절 태그가 '샘플 부족' 계측 이상으로 판정) */
      var bad = null;
      if (!lost) {
        bad = VC.gateFromBuckets(eq.secBuckets, wide, eq.rpm / 60);   // 플랫라인·DC 드리프트 — 롤업만으로, 조회 0회
        if (!bad) bad = self._rawGate(key);                  // 클립·스파이크·첨도 — 원본 받았을 때만
      }
      var sens = VC.sensorTick(prev, bad, nowW, cfg);
      if (sens.on) run = false;                              // 계측을 못 믿는 동안은 판정 동결
      // 대역 판정 — 추출 타이머 적재 최신 대역값 vs 대역별 베이스라인, 설비당 1건으로 합성
      var bj = null, bnow = (self._bandNow || {})[key];
      // elat: 포락선 계열 이탈 이력(최고 배수·최초 시각) — 결함은 되돌아가지 않아 신호가 묻혀도 유지, 되살아난 태그엔 미승계
      if (bnow && !revived && !sens.on) bj = VC.bandJudge(bnow, self._bandBaselines(eq), !!(prev && prev.bb),
        self._softBands(eq), revived ? null : (prev && prev.elat), nowW);
      // 회차 식별자 = 패턴 측정 시각. 측정 불가 태그(회전수·기하 없음)는 null·rg 0 고정이라 전이 없음
      var r = judgeTick(prev, rg, breach, nowW, cfg, bj, run, _pr.cyc);
      // 계측 이상·복귀는 별개 축 — 그대로 이어 붙임
      sens.events.forEach(function (ev) { r.events.push(ev); });
      // 대역 판정 못 한 틱(추출 지연·계측 이상)에도 latch 이력 유지
      var _elat = bj ? bj.latch : (prev && prev.elat);
      if (_elat && Object.keys(_elat).length) r.next.elat = _elat;
      r.next.sf = sens.next.sf;
      if (sens.next.sfs != null) r.next.sfs = sens.next.sfs;
      if (sens.next.sfc != null) r.next.sfc = sens.next.sfc;
      // 두절은 상태 전환 때만 알림, 복구는 판정 재개로 대체(별도 이벤트 없음)
      if (lost && !(prev && prev.lost)) r.events.push({ etype: 'signal_lost', gi: 1 });
      r.next.lost = lost ? 1 : 0;
      nEv += r.events.length;
      r.events.forEach(function (ev) {
        // 이벤트 값 = 판정이 실제로 본 값(사후 설명용)
        var isSens = ev.etype === 'sensor_fault' || ev.etype === 'sensor_ok';
        /* 이벤트 값은 설비 원본 단위(서버 monitor.js와 같은 규칙)
           - 속도 원본: 등급 높이를 정한 ISO 값(패턴을 잰 파형)·경계
           - 가속도·변위 원본: 값은 원본 단위 구간 RMS, 기준은 비우고 근거(ISO 존·결함 패턴)를 DETAIL 머리에 기재 */
        var nat = !isSens && ev.etype !== 'signal_lost' && !!eq.unit && eq.unit !== 'mm/s';
        var ev_val = isSens ? 0 : nat ? wide : (_hv != null ? _hv : wide);
        var ev_lim = (isSens || nat) ? 0 : zoneLim(self._isoZones(eq), ev.etype === 'recovery' ? 0 : ev.gi);
        var _jd = (isSens || ev.etype === 'signal_lost') ? '' : judgeDetail(ev, _pat, self._rawImp(key));
        if (nat) _jd = 'ISO ' + GRADE_WORDS[_hG] + ' 구간' + (_jd ? ' · ' + _jd : '');
        jobs.push(insertEvent({
          eid: key + ':' + nowW + ':' + ev.etype, ts: nowW, tbl: eq.table, tag: eq.name, etype: ev.etype,
          grade: GRADE_WORDS[ev.gi], val: ev_val, lim: ev_lim,
          // 두절은 지표값 없음(val/lim 0은 자리 채움) — 무수신 시간을 DETAIL에 기재(서버 판정기와 같은 문구)
          detail: ev._detail = (isSens ? (ev.detail || '')
            : ev.etype === 'signal_lost' ? durKo(nowW - eq.lastSeen) + ' 무수신'
              : _jd),
        }).catch(function () {}));
        // 회차 큐 적재 — 동시 다발 시 채널 한도 회피(묶음 여부는 notify.planNotifications) · 기준 숫자 없는 행은 lim=null
        self._queueNotify(eq, ev, ev_val, nat ? null : ev_lim, nowW);
      });
      // 표시 등급 — 판정 등급(패턴이 켜고 ISO가 높이 결정)과 원인, 카드·KPI·필터용
      if (!self._gradeState) self._gradeState = {};
      // 카드 등급 = 판정 등급 그대로(베이스라인·대역 최댓값 합성 시 카드·알람 불일치), 축은 아래 필드로 별도 표시
      var _wg = VC.worstGrade(0, 0, 0, r.next.g);
      // 화면용 판정값·네 축 값·등급 원인 축
      _wg.iso = val; _wg.wide = wide; _wg.limited = VC.isoNeeded(eq.fs); _wg.basis = iso.basis || 'wide';
      _wg.isoRaw = iso.pending ? null : iso.vr;   // 화면 표시용 — 같은 대역의 원본 단위 RMS
      _wg.isoOk = isoUsableW && !iso.pending; _wg.isoUnit = isoUsableW ? 'mm/s' : eq.unit;
      _wg.blOk = lim != null; _wg.bandOk = !!bj;
      // 등급을 켠 축(패턴) 값 — 등급 근거 표시. 측정 못 한 태그는 patOk=false로 커버리지에 표시
      _wg.patOk = !!_pat; _wg.patOn = !!(_pat && _pat.on); _wg.patR = _pat ? _pat.r : null;
      _wg.patMiss = _pr.miss; _wg.patWait = _pr.miss && !self._patNow;   // 보류 사유 — 첫 측정 전인지 측정 실패인지
      _wg.patWide = !!(_pat && _pat.demodSrc === 'wideband');
      _wg.blR = (lim != null && lim > 0) ? wide / lim : null;
      _wg.bandR = bj ? bj.maxR : null;
      self._gradeState[key] = _wg;
      var next = r.next;
      // 변경 시에만 저장 (휘발성 값 제외 — g/cand/candSince/lastRe/b 비교)
      var same = prev && prev.g === next.g && prev.cand === next.cand && prev.candSince === next.candSince
        && prev.lastRe === next.lastRe && !!prev.b === !!next.b;
      self._monState[key] = next;
      if (!same) jobs.push(saveMonState(key, next).catch(function () {}));
    });
    // 회차 전체 태그 판정 후 일괄 발송 — '같은 순간'의 경계(태그별 즉시 발송이면 묶음 불가)
    self._flushNotify(nowW);
    return Promise.all(jobs).then(function () { return nEv; });
  }
  /* 이벤트 목록·건수 — 같은 조건(기간·유형·태그, 감시 중인 태그만)으로 DB에서 거름
     · 목록은 조건 안 최근 200건, 건수는 조건 안 전체
     · '최근 이벤트' 칸은 필터 무관 — 필터 걸렸으면 1건 따로 조회
     · 겹친 요청은 마지막 것만 반영(필터 연속 변경), 결과가 같으면 다시 그리지 않음 */
  _loadEventsLive() {
    var self = this, S = this.state;
    if (!this.live || !this.data) return Promise.resolve();
    // 스코프는 벽시계 기준 — 이벤트 TS가 판정 시각이라 data.now로 자르면 과거 데이터 소스서 '오늘'이 밀리고 이후 이벤트 누락
    var now = Date.now();
    var scope = S.evtScope || 'today';
    var from = scope === 'today' ? CH.startOfDay(now) : scope === '7d' ? now - 7 * 86400000 : 0;   // 오늘 = 표시 시간대 0시부터
    var to = now + 300000; // 서버 타이머가 찍은 이벤트의 시계 오차(+5분)까지 포함
    var cap = 200;
    var act = this._activeEqs(), byKey = {};
    act.forEach(function (e) { byKey[e.table + ':' + e.name] = e; });
    var keys = Object.keys(byKey);
    var tagEq = (S.evtTag && S.evtTag !== 'all') ? act.filter(function (e) { return e.id === S.evtTag; })[0] : null;
    if (S.evtTag && S.evtTag !== 'all' && !tagEq) this.setState({ evtTag: 'all' });   // 고른 태그가 감시 대상에서 빠짐 → 전체
    var f = { etype: (S.evtType && S.evtType !== 'all') ? S.evtType : null, keys: tagEq ? [tagEq.table + ':' + tagEq.name] : keys };
    var filtered = !!(f.etype || tagEq);
    var seq = this._evtSeq = (this._evtSeq || 0) + 1;
    if (!keys.length) {   // 감시 태그 없음 — 조회 없이 빈 목록
      this._evtSig = ''; this._evtArr = []; this._evtTotal = 0; this._evtCapped = false; this._lastEvt = null;
      this.setState({ events: this._evtArr });
      return Promise.resolve();
    }
    var toEv = function (r) {
      var eq = byKey[r.tbl + ':' + r.tag];
      return {
        id: r.eid, ms: r.ts, tagId: eq ? eq.id : null,
        tagAlias: eq ? (eq.alias || eq.name) : r.tag, tagName: r.tag,
        type: r.etype, typeKo: TYPEKO[r.etype] || r.etype, unit: eq ? eq.unit : '',
        value: r.val, base: r.lim, grade: Math.max(0, GRADE_WORDS.indexOf(r.grade)),
        // 대역 이벤트 값은 배수(단위 없음), 걸린 대역은 DETAIL에
        bands: r.detail ? VC.bandParse(r.detail) : null,
        detail: r.detail || '',   // 두절 무수신 시간 등 대역 외 유형도 DETAIL 사용
      };
    };
    return Promise.all([
      countEvents(from, to, f).catch(function () { return null; }),
      loadEventsRange(from, to, cap, f),
      filtered ? loadEventsRange(from, to, 1, { keys: keys }).catch(function () { return null; }) : null,
    ]).then(function (r) {
      if (seq !== self._evtSeq) return;   // 더 나중 요청이 있음
      var rows = r[1], evs = rows.map(toEv);
      var last = filtered ? (r[2] && r[2][0] ? toEv(r[2][0]) : null) : (evs[0] || null);
      var sig = r[0] + '|' + (last ? last.id : '') + '|' + evs.map(function (e) { return e.id; }).join(',');
      if (sig === self._evtSig && self.state.events === self._evtArr) return;   // 다른 곳이 목록을 비웠으면 다시 채움
      self._evtSig = sig; self._evtArr = evs;
      self._evtTotal = r[0];
      self._evtCapped = rows.length >= cap;
      self._lastEvt = last;
      self.setState({ events: evs });
    }).catch(function () {});
  }
  // 이벤트 내보내기 모달 — 기본 기간 최근 30일 (이벤트 TS와 같은 벽시계 기준)
  _openDownload() {
    var to = Date.now();
    this.setState({ dlOpen: true, dlFmt: 'csv', csvFrom: this.E.fmtDT(to - 30 * 86400000).slice(0, 10), csvTo: this.E.fmtDT(to).slice(0, 10) });
  }
  // 기간 이벤트를 CSV/JSON으로 브라우저 다운로드
  _exportEvents() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state, E = this.E;
    var fromMs = CH.parseDT(S.csvFrom + 'T00:00:00');
    var toMs = CH.parseDT(S.csvTo + 'T23:59:59.999');
    if (!(fromMs <= toMs)) { this._toast('기간이 올바르지 않습니다 (시작 ≤ 종료)', 'warn'); return; }
    var aliasOf = function (r) { return (C.aliases || {})[r.tbl + ':' + r.tag] || ''; };
    loadEventsRange(fromMs, toMs).then(function (rows) {
      if (!rows.length) { self._toast('해당 기간에 이벤트가 없습니다', 'warn'); return; }
      var content, mime, ext;
      // 시각은 초까지 — 같은 분 다건의 순서 구분(화면은 분까지)
      var ts = function (ms) { return E.fmtFull(ms).slice(0, 19); };
      // 상세 — 알람이 실제로 들고 있는 내용(대역 이탈의 대역별 값·한계, 두절의 무수신 시간)
      var det = function (r) { return r.detail || ''; };
      // 원본 단위 행(가속도·변위 설비 등급 이벤트)은 기준 숫자 대신 근거 문구 — 화면과 같은 규칙
      var units = {};
      ((self.data && self.data.equipment) || []).forEach(function (e) { units[e.table + ':' + e.name] = e.unit; });
      var nat = function (r) { return natRow(r.etype, units[r.tbl + ':' + r.tag]); };
      var limOf = function (r) { return nat(r) ? (Notify.basisText(r.detail) || '속도 ISO 기준 판정') : r.lim; };
      if (S.dlFmt === 'json') {
        content = JSON.stringify(rows.map(function (r) {
          return { time: ts(r.ts), table: r.tbl, tag: r.tag, alias: aliasOf(r), type: TYPEKO[r.etype] || r.etype, grade: r.grade, value: r.val,
            limit: nat(r) ? null : r.lim, basis: nat(r) ? limOf(r) : undefined, detail: det(r) };
        }), null, 2);
        mime = 'application/json'; ext = 'json';
      } else {
        var cell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var lines = ['시각,테이블,태그,별칭,유형,등급,지표값,기준값,상세'];
        rows.forEach(function (r) { lines.push([ts(r.ts), r.tbl, r.tag, aliasOf(r), TYPEKO[r.etype] || r.etype, r.grade, r.val, limOf(r), det(r)].map(cell).join(',')); });
        content = '﻿' + lines.join('\r\n'); // BOM — Excel 한글 정상 표시
        mime = 'text/csv;charset=utf-8'; ext = 'csv';
      }
      var url = URL.createObjectURL(new Blob([content], { type: mime }));
      var a = document.createElement('a');
      a.href = url; a.download = 'vibe-events_' + S.csvFrom + '_' + S.csvTo + '.' + ext;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      self.setState({ dlOpen: false });
      self._toast(rows.length + '건 ' + ext.toUpperCase() + ' 다운로드');
    }).catch(function (e) { self._toast('내보내기 실패: ' + (e.message || e), 'err'); });
  }
  /* ── 태그 되살아남 차단 ──
     삭제 후 같은 이름으로 재등장한 태그는 사람 확인 전까지 베이스라인·대역 판정 중단(ISO 존은 계속) — 옛 학습값 오적용 방지 */
  _checkRevived(keys, scopeTables) {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    // 베이스라인 미로드면 판단 불가(_blMap 없음 = 미로드, {} = 로드했으나 학습값 없음)
    if (!this._blMap) return;
    var cur = {}, curKeys = [];
    (keys || []).forEach(function (k) { if (!cur[k]) { cur[k] = 1; curKeys.push(k); } });

    // 첫 실행 — 현재 태그를 '아는 태그'로 확정, 확인 요청 없음
    if (!Array.isArray(S.knownTags)) {
      this.setState({ knownTags: curKeys });
      if (this._isLead()) this._persistView(['knownTags'], { knownTags: curKeys });
      return;
    }

    // 비교 범위는 현재 선택 테이블만 — 선택 해제·재선택은 화면 설정이지 설비 변경 아님(선택 밖 키는 유지)
    var sel = {};
    (scopeTables || C.srcSel || []).forEach(function (t) { sel[t] = 1; });
    var inScope = function (k) { return !!sel[k.slice(0, k.indexOf(':'))]; };

    var known = {};
    S.knownTags.forEach(function (k) { known[k] = 1; });
    var rev = Object.assign({}, S.revived || {}), changed = false, now = Date.now();
    curKeys.forEach(function (k) {
      // 모르는 태그인데 학습값 잔존 = 삭제 후 재등록
      if (!known[k] && self._hasLearned(k) && !rev[k]) { rev[k] = now; changed = true; }
    });
    // 선택 범위 안에서 사라진 태그만 목록에서 제거 — 재등장 시 위 검사에 걸리도록
    var nextKnown = S.knownTags.filter(function (k) { return cur[k] || !inScope(k); });
    curKeys.forEach(function (k) { if (nextKnown.indexOf(k) < 0) nextKnown.push(k); });
    // 현재 없는 태그의 확인 표시 정리
    Object.keys(rev).forEach(function (k) { if (!cur[k]) { delete rev[k]; changed = true; } });

    var same = nextKnown.length === S.knownTags.length
      && nextKnown.every(function (k, i2) { return k === S.knownTags[i2]; });
    if (!changed && same) return;
    this.setState({ knownTags: nextKnown, revived: rev });
    if (this._isLead()) this._persistView(['knownTags', 'revived'], { knownTags: nextKnown, revived: rev });
  }
  // 태그 학습값 유무 — RMS 또는 대역 베이스라인
  _hasLearned(key) {
    var m = this._blMap || this.state.baselines || {};
    if (m[key]) return true;
    for (var i = 0; i < VC.BAND_ORDER.length; i++) if (m[key + ':' + VC.BAND_ORDER[i]]) return true;
    return false;
  }
  // 확인 대기 여부 — 대기 중 베이스라인·대역 판정 중단
  _isRevived(key) { return !!(this.state.revived || {})[key]; }
  // 같은 설비 확인 — 표시만 지우고 학습값 유지
  _keepLearned(key) {
    var rev = Object.assign({}, this.state.revived || {});
    delete rev[key];
    this.setState({ revived: rev });
    this._persistView(['revived'], { revived: rev });
    this._toast('기존 학습값을 계속 사용합니다');
    this._syncMonitorTimer(true);
  }
  // 일괄 유지 — 저장·타이머 재등록 1회(낱개 반복 호출 회피)
  _keepAllLearned() {
    var n = Object.keys(this.state.revived || {}).length;
    if (!n) return;
    this.setState({ revived: {} });
    this._persistView(['revived'], { revived: {} });
    this._toast(n + '개 태그의 기존 학습값을 계속 사용합니다');
    this._syncMonitorTimer(true);
  }
  /* 다른 설비 — 학습값(RMS+대역)·판정 상태 삭제 후 재학습 대기
     대역 시계열은 유지(재학습은 새 창만 사용, 삭제는 비가역) — 정리는 고아 데이터 화면에서 */
  _resetLearned(key) {
    var self = this;
    var jobs = [deleteBaseline(key).catch(function () {})];
    // 옛 이름(BAND_LEGACY)도 삭제 — 방치 행 누적 방지
    VC.BAND_ORDER.concat(VC.BAND_LEGACY).forEach(function (bn) { jobs.push(deleteBaseline(key + ':' + bn).catch(function () {})); });
    jobs.push(saveMonState(key, { g: 0, since: Date.now(), cand: 0, candSince: Date.now(), lastRe: Date.now(), b: false }).catch(function () {}));
    Promise.all(jobs).then(function () {
      var rev = Object.assign({}, self.state.revived || {});
      delete rev[key];
      if (self._monState) delete self._monState[key];
      self.setState({ revived: rev });
      self._persistView(['revived'], { revived: rev });
      return self._loadBaselines();
    }).then(function () {
      self._toast('학습값을 초기화했습니다 — 다시 학습해 주세요');
      self._syncMonitorTimer(true);
    });
  }
  _loadBaselines() {
    var self = this;
    if (!this.live) return Promise.resolve();
    return loadBaselines().then(function (m) { self._blMap = m; self.setState({ baselines: m }); }).catch(function () {});
  }
  /* 베이스라인 맵·진행중 표시 동시 갱신
     병렬 학습 완료 콜백이 배치된 state를 복사하면 마지막 결과가 앞 결과를 덮음
     → 누적은 동기 갱신되는 _blMap/_busyMap에, state엔 사본만 */
  _blMerge(entries, dropKeys) {
    var m = this._blMap || Object.assign({}, this.state.baselines || {});
    if (entries) Object.keys(entries).forEach(function (k) { m[k] = entries[k]; });
    if (dropKeys) dropKeys.forEach(function (k) { delete m[k]; });
    this._blMap = m;
    return Object.assign({}, m); // 사본 전달 — preact 변경 감지용
  }
  _busySet(field, key, on) {
    if (!this._busyMap) this._busyMap = {};
    var m = this._busyMap[field] || Object.assign({}, this.state[field] || {});
    if (on) m[key] = true; else delete m[key];
    this._busyMap[field] = m;
    var patch = {};
    patch[field] = Object.assign({}, m);
    this.setState(patch);
  }
  _isBusy(field, key) { return !!((this._busyMap && this._busyMap[field]) || this.state[field] || {})[key]; }
  /* 정상 상태 학습 — sec 롤업 조회 → μ·σ 적합 → BASELINE 저장
     학습 단위는 판정 구간, blWin은 학습 기간 길이만 결정 */
  _learnBaseline(eq) {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    var key = eq.table + ':' + eq.name;
    if (this._isBusy('blBusy', key)) return;
    var H = { '1h': 1, '6h': 6, '24h': 24 }[S.blWin] || 24;
    var to = eq.lastSeen || Date.now(), from = to - H * 3600000;
    this._busySet('blBusy', key, true);
    function unbusy() { self._busySet('blBusy', key, false); }
    // 학습 단위 = 판정 구간 — μ·σ가 실제 판정값 분포를 대표하도록
    var winSec = Math.round(Math.max(durMs(C.evalWindow) || 10000, durMs(C.monitorInterval) || 3000) / 1000);
    rollupTrend(eq.table, eq.name, 'sec', from, to).then(function (buckets) {
      var vals = VC.windowSeries(buckets, winSec);
      // 정상상태 게이트 — 정지·기동/정지 램프 버킷 제외(한계 오염 방지), 제외 내역은 결과에 기록
      var ss = VC.steadyStateFilter(vals);
      var fit = VC.baselineFit(ss.vals);
      var exTxt = (ss.idle || ss.ramp) ? ' · 제외 ' + (ss.idle + ss.ramp) + '개(정지 ' + ss.idle + '·과도 ' + ss.ramp + ')' : '';
      // 창 대부분이 정지면 참조(P75)가 정지 수준에 붙어 '정지=정상' 학습 → 폐기(비율·높이 함께 판단)
      if (ss.bimodal) throw new Error('학습 구간이 정지↔운전 두 수준으로 갈라져 있습니다(상위 수준 표본 '
        + Math.round(ss.bimodalFrac * 100) + '%, 중앙값의 ' + Math.round(ss.bimodalRatio) + '배) — 정상 운전이 대부분인 기간으로 다시 학습하세요');
      if (!fit) throw new Error('정상상태 표본 ' + ss.vals.length + '개 (최소 ' + VC.BASELINE_MIN_N + '개 필요' + exTxt + ') — 판정 구간 ' + winSec + '초로 묶어 세므로, 학습 창을 늘리거나 판정 구간을 줄이세요');
      var ms = buckets.map(function (b) { return b.ms; });
      var spanMin = ms.length ? Math.round((Math.max.apply(null, ms) - Math.min.apply(null, ms)) / 60000) : 0;
      var k = parseFloat(self.state.blK) || 3;
      // ex(제외 내역)는 부가 필드 — 기존 키(mu/sigma/k/n) 유지로 구버전 판정 호환
      var obj = { mu: +fit.mu.toFixed(4), sigma: +fit.sigma.toFixed(4), k: k, n: fit.n, spanMin: spanMin, unit: 'sec', win: S.blWin, evalWin: winSec, at: Date.now() };
      if (ss.idle || ss.ramp) obj.ex = { idle: ss.idle, ramp: ss.ramp };
      return saveBaseline(key, obj).then(function () {
        var ent = {}; ent[key] = obj;
        self.setState({ baselines: self._blMerge(ent) });
        unbusy();
        self._resyncMonSoon(); // 서버 모드면 새 μ·σ로 TQL 재생성 — 미실행 시 옛 한계로 판정
        self._toast((eq.alias || eq.name) + ' 베이스라인 학습 완료 · μ ' + obj.mu.toFixed(2) + ' / σ ' + obj.sigma.toFixed(2) + exTxt + (spanMin < 10 ? ' · 구간 짧음(참고용)' : ''), spanMin < 10 ? 'warn' : 'ok');
      });
    }).catch(function (e) {
      unbusy();
      self._toast('베이스라인 학습 실패: ' + (e.message || e), 'err');
    });
  }
  /* 대역 베이스라인 학습 — BAND 대역 시계열로 대역별 μ·σ 학습(RMS 학습과 같은 steadyStateFilter → baselineFit)
     키 '테이블:태그:대역'으로 BASELINE에 저장 */
  _learnBandBaseline(eq) {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    var base = eq.table + ':' + eq.name;
    var H = BAND_WIN_H[S.bandWin] || 24;   // 대역 전용 기간 — RMS와 표본 밀도 상이
    // 창 끝 = 태그의 마지막 데이터(벽시계면 적재 끝난 테이블에서 창이 데이터 뒤로 밀려 '값 없음')
    var to = eq.lastSeen || Date.now(), from = to - H * 3600000;
    var k = parseFloat(S.blK) || 3;
    var grid = durMs(C.bandInterval); // 밀도 균일화 격자 = 의도된 추출 주기
    return Promise.all(VC.BAND_ORDER.map(function (bn) {
      var key = base + ':' + bn;
      return bandRaw(key, from, to).then(function (rows) {
        var raw = rows.filter(function (r) { return isFinite(r.v); });
        // 행 없음(추출 미동작·기간 부족)과 0만 쌓임(원리적 측정 불가)은 사유 분리
        if (!raw.length) return { bn: bn, err: '값 없음 — 대역 추출이 돌지 않았거나 학습 기간에 쌓인 값이 없습니다' };
        // 추출 주기 격자로 밀도 균일화 — 촘촘한 구간이 표본을 지배해 기준이 되는 것 방지
        var vals = VC.evenSample(raw, grid);
        var ss = VC.steadyStateFilter(vals);
        if (ss.bimodal) return { bn: bn, err: '정지↔운전 두 수준' };
        // 전부 0인 대역은 학습 제외 — Nyquist 위라 측정 불가, 학습 시 한계 0이라 양수 하나로 이탈
        var nz = ss.vals.filter(function (v) { return v > 0; });
        // 값 없음 사유 — 대역은 샘플레이트, 포락선은 설정
        if (!nz.length) return { bn: bn, err: VC.BAND_FREQ.indexOf(bn) >= 0
          ? '측정 범위 밖 — 대역 하한이 Nyquist보다 높습니다'
          : '값 없음 — 베어링 품번 미지정이거나 복조 대역이 성립하지 않습니다' };
        var fit = VC.baselineFit(ss.vals);
        if (!fit) return { bn: bn, err: '표본 ' + ss.vals.length + '개(최소 ' + VC.BASELINE_MIN_N + ')' };
        var obj = { mu: +fit.mu.toFixed(5), sigma: +fit.sigma.toFixed(5), k: k, n: fit.n, band: bn, at: Date.now(),
          raw: raw.length, grid: grid }; // 솎기 전 표본 수 — 균일화 제거량 툴팁 표시용
        return saveBaseline(key, obj).then(function () { return { bn: bn, obj: obj }; });
      }).catch(function (e) { return { bn: bn, err: e.message || String(e) }; });
    })).then(function (res) {
      var ok = res.filter(function (r) { return r.obj; });
      var ent = {};
      ok.forEach(function (r) { ent[base + ':' + r.bn] = r.obj; });
      self.setState({ baselines: self._blMerge(ent) });
      // 포락선 이탈 이력(elat) 삭제 — 재학습 = 새 평소 선언(베어링 교체 등), latch 해제 유일 지점
      var _ms = (self._monState || {})[base];
      if (_ms && _ms.elat) {
        var _n2 = Object.assign({}, _ms); delete _n2.elat;
        self._monState[base] = _n2;
        saveMonState(base, _n2).catch(function () {});
      }
      return { ok: ok.length, fail: res.filter(function (r) { return r.err; }) };
    });
  }
  // 최신 대역값 캐시 — 판정(10초)보다 추출 주기가 느려 주기 절반 경과 시에만 갱신
  _refreshBandNow() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    if (!C.bandOn) { this._bandNow = null; return; }
    var iv = durMs(C.bandInterval || '10m') || 600000;
    var now = Date.now();
    if (this._bandNowAt && now - this._bandNowAt < iv / 2) return;
    if (this._bandNowBusy) return;
    this._bandNowBusy = true;
    this._bandNowAt = now;
    var eqs = this._activeEqs();
    // 설비 × 판정 계열 최신 1건씩 — 설비당 1회 조회(계열 전부 NAME IN)
    Promise.all(eqs.map(function (eq) {
      var base = eq.table + ':' + eq.name;
      var keys = VC.BAND_ORDER.map(function (bn) { return base + ':' + bn; });
      return bandLatest(keys, now - iv * 3, now).catch(function () { return {}; })
        .then(function (m) {
          var o = null;
          VC.BAND_ORDER.forEach(function (bn) {
            var v = m[base + ':' + bn];
            if (v != null) { o = o || {}; o[bn] = v; }
          });
          return { key: base, bands: o };
        });
    })).then(function (res) {
      var m = {};
      res.forEach(function (r) { if (r.bands) m[r.key] = r.bands; });
      self._bandNow = m;
      self._bandNowBusy = false;
    }).catch(function () { self._bandNowBusy = false; });
  }
  // 최신 결함 패턴 캐시 — 추출 주기마다 측정(서버 patTtlMs와 같은 간격 = 같은 회차 길이). 원시 파형 조회라 10초 판정마다 불가, 급변은 10초 축 담당
  _refreshPatNow() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    /* 알람 꺼져도 동작 — 카드 등급은 알람과 무관하게 게이트 규칙(막으면 게이트 없는 ISO 폴백 등급 노출)
       감시 화면도 안 보고 알람도 꺼져 있으면 중단(원시 파형 조회 비용)
       비울 때 측정 시각도 초기화 — 재가동 시 한 주기 대기로 '첫 측정 대기' 보류 방지 */
    if (!C.monitorOn && S.tab !== 'monitor') { this._patNow = null; this._patNowAt = 0; return; }
    var iv = durMs(C.bandInterval || '10m') || 600000;   // 대역과 같은 주기(둘 다 원시 파형)
    var now = Date.now();
    if (this._patNowAt && now - this._patNowAt < iv) return;
    if (this._patNowBusy) return;
    this._patNowBusy = true;
    this._patNowAt = now;
    var eqs = this._activeEqs();
    var t0 = Date.now();
    Promise.all(eqs.map(function (eq) {
      return monPattern(eq, null).catch(function () { return null; })
        .then(function (p) { return { key: eq.table + ':' + eq.name, pat: p }; });
    })).then(function (res) {
      var m = {};
      res.forEach(function (r) { if (r.pat) m[r.key] = r.pat; });
      self._patNow = m;
      /* 격자 점수 시계열 기록 — 이벤트는 전환 순간만 담아 단발·채택선 근처 구간 누락
         대역·포락선과 같은 표(한 차트에 겹쳐 그리기). 서버 모드는 판정 타이머가 같은 키로 기록, 앱 모드는 담당 탭만 */
      if (C.monMode !== 'server' && self._isLead() && self._checkIdentity()) {
        res.forEach(function (r) {
          if (r.pat && r.pat.r != null) insertBandPoint(r.key + ':pattern', r.pat.at || Date.now(), r.pat.r).catch(function () {});
        });
      }
      self._patTickMs = Date.now() - t0;   // 회차 소요 — 설정 화면의 주기 하한 경고용
      self._patNowBusy = false;
    }).catch(function () { self._patNowBusy = false; });
  }
  // 학습 실행 래퍼 — 진행 표시·결과 토스트(학습 자체는 _learnBandBaseline)
  _runBandLearn(eq) {
    var self = this, key = eq.table + ':' + eq.name;
    if (this._isBusy('bandBusy', key)) return;
    this._busySet('bandBusy', key, true);
    function unbusy() { self._busySet('bandBusy', key, false); }
    this._learnBandBaseline(eq).then(function (r) {
      unbusy();
      var nm = eq.alias || eq.name;
      if (r.ok === 0) {
        // 대역별 사유가 다를 수 있어 최다 사유 표시
        var cnt = {}, why = '사유 불명', top = 0;
        r.fail.forEach(function (f) { var e2 = f.err || ''; cnt[e2] = (cnt[e2] || 0) + 1; if (cnt[e2] > top) { top = cnt[e2]; why = e2; } });
        self._toast(nm + ' 대역 학습 불가 — ' + why + (r.fail.length > top ? ' (' + top + '/' + r.fail.length + ')' : ''), 'warn');
      } else {
        self._toast(nm + ' 대역 베이스라인 ' + r.ok + '/' + VC.BAND_ORDER.length + ' 학습 완료'
          + (r.fail.length ? ' · ' + r.fail.length + '개 대역 실패' : ''), r.fail.length ? 'warn' : 'ok');
        self._resyncMonSoon(); // 서버 모드면 새 대역 기준으로 감시 TQL 재굽기
      }
    }).catch(function (e) {
      unbusy();
      self._toast('대역 학습 실패: ' + (e.message || e), 'err');
    });
  }
  _delBandBaseline(eq) {
    var self = this, base = eq.table + ':' + eq.name;
    Promise.all(VC.BAND_ORDER.concat(VC.BAND_LEGACY).map(function (bn) { return deleteBaseline(base + ':' + bn).catch(function () {}); }))
      .then(function () {
        self.setState({ baselines: self._blMerge(null, VC.BAND_ORDER.map(function (bn) { return base + ':' + bn; })) });
        self._toast((eq.alias || eq.name) + ' 대역 베이스라인 삭제됨');
        self._resyncMonSoon(); // 서버 TQL에 구워진 옛 기준 제거
      });
  }
  // 설비의 판정용 대역 기준 묶음 — 한계 0(Nyquist 위 μ=0·σ=0 저장분)은 bandJudge가 건너뛰므로 제외(없으면 null)
  _bandBaselines(eq) {
    var m = this._blMap || this.state.baselines || {}, base = eq.table + ':' + eq.name, out = null;
    VC.BAND_ORDER.forEach(function (bn) {
      var b = m[base + ':' + bn];
      if (b && VC.baselineLimit(b) > 0) { out = out || {}; out[bn] = b; }
    });
    return out;
  }
  /* 확정 근거로 못 쓰는 대역 — 가속도계 마운팅 유효 상한 초과 칸
     - fr은 _bandTags와 같은 규칙(적재된 대역 경계와 일치 필요)
     - 마운팅은 적용 설정 우선(저장 즉시 반영), 없으면 eq.meta */
  _softBands(eq) {
    var det = (this._detailCache[eq.id] || {}).det;
    var fr = (det && det.frMeas && det.frMeas.f > 0) ? det.frMeas.f : (eq.rpm / 60);
    var mount = ((this._ac().equipMeta || {})[eq.id] || {}).mount || (eq.meta || {}).mount;
    return VC.softBands(fr, eq.fs, mount);
  }
  /* 베어링 형상 — 카탈로그 품번이면 표, 직접 입력이면 저장 형상(품번 없음·슬리브면 null)
     cfg 생략 = 적용 설정(판정용), 설정 화면 미리보기는 편집본(state) 전달 */
  _bearingGeo(eq, cfg) {
    var S = cfg || this._ac(), model = (S.equipBearing || {})[eq.id] || '';
    if (!model || model === 'sleeve') return null;
    return VC.BEARINGS[model] || Object.assign({ n: 0, Bd: 0, Pd: 0, phi: 0 }, (S.equipGeo || {})[eq.id] || {});
  }
  // 대역 추출 대상 태그 선별 — 대역 경계가 1× 상대라 회전주파수·샘플레이트 없으면 제외(사유 함께 반환)
  _bandTags() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this;
    var all = this._activeEqs().map(function (eq) {
      var det = (self._detailCache[eq.id] || {}).det;
      // 실측 1× 우선 — 명판과 다르면 대역 전체 어긋남
      var fr = (det && det.frMeas && det.frMeas.f > 0) ? det.frMeas.f : (eq.rpm / 60);
      var mount = ((C.equipMeta || {})[eq.id] || {}).mount || (eq.meta || {}).mount;
      return { tbl: eq.table, tag: eq.name, fr: Math.round(fr * 100) / 100, fs: eq.fs, lineHz: Number(C.lineHz) || 60,
        // 복조 대역은 설정값이라 앵커 간 고정(추세 성립), 결함주파수는 계수만 굽기(서버가 앵커마다 fr 실측 후 곱함)
        demod: VC.demodBand(eq.fs, mount), bf: VC.faultCoeffs(self._bearingGeo(eq)),
        stat: eq.stat || null, label: self._tagLabel(eq) };
    });
    var skipped = all.filter(function (t) { return !(t.fs > 0 && t.fr > 0); })
      .map(function (t) { return { label: t.label, why: !(t.fr > 0) ? 'RPM 미설정' : '샘플레이트 불명' }; });
    return { tags: all.filter(function (t) { return t.fs > 0 && t.fr > 0; }), skipped: skipped, total: all.length };
  }
  _bandSpec() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var t = this._bandTags();
    return { tags: t.tags, skipped: t.skipped, total: t.total, statusKey: '__st:band',
      tblPrefix: storePrefix(), keyPrefix: userKeyPrefix(), srcMap: srcMapOf(C.srcSel || []) };
  }
  /* 대역 추출 실제 동작 여부 — 켜져 있어도 대상 태그 0이면 타이머 없음
     _syncBandTimer의 결론(_bandNoTarget) 재사용(각자 계산 시 불일치), 판단 전이면 동작으로 간주 */
  _bandLive() { return !!this._ac().bandOn && !this._bandNoTarget; }
  // 대상 0 사유 — 사유별 개수 나열
  _bandNoTargetWhy(spec) {
    var why = {}, n = 0;
    (spec.skipped || []).forEach(function (s2) { if (!why[s2.why]) { why[s2.why] = 0; n++; } why[s2.why]++; });
    var keys = Object.keys(why);
    if (!keys.length) return '선택된 태그가 없습니다';
    return keys.map(function (k) { return k + ' ' + why[k] + '개'; }).join(' · ');
  }
  /* 과거 채우기(백필) 계획 — 채울 범위·소요 선계산
     - 상한 = 학습 창, 간격 = 추출 주기(다르면 백필 구간이 표본 지배)
     - ov: setState 직후 state는 옛 값 → 새 값 직접 전달 */
  _bandPlan(ov) {
    var S = this.state, spec = this._bandTags();
    ov = ov || {};
    // 주기 = 적용값(타이머 격자), 채울 구간 = 폼의 학습 기간(채우기·학습은 설정 화면 버튼)
    var iv = durMs(ov.bandInterval || this._ac().bandInterval) || 600000;
    var H = BAND_WIN_H[ov.bandWin || S.bandWin] || 24;   // 채울 구간 = 대역 학습 기간
    var span = H * 3600000;
    var perTag = Math.floor(span / iv);
    // 창 끝 = 태그의 마지막 데이터(_learnBaseline과 같은 규칙) — 벽시계면 적재 끝난 테이블에서 원본 없는 구간을 잡아 band.js가 전부 건너뜀
    var now = Date.now(), per = {}, ends = {}, froms = {};
    var total = 0, oldest = now;
    spec.tags.forEach(function (t) {
      var mx = t.stat && t.stat.maxMs, mn = t.stat && t.stat.minMs;
      var end = (mx > 0) ? Math.min(now, mx) : now;
      var from = (mn > 0) ? Math.max(end - span, mn) : end - span;
      var n2 = (mx > 0 && mn > 0) ? Math.max(0, Math.floor((end - from) / iv)) : perTag;
      var k = t.tbl + ':' + t.tag;
      per[k] = n2; ends[k] = end; froms[k] = from;
      if (from < oldest) oldest = from;
      total += n2;
    });
    return { tags: spec.tags, skipped: spec.skipped, tagTotal: spec.total, iv: iv, span: span,
      // 태그별 창 상이 — 조회는 가장 이른 시작부터 1회, 계수는 태그별 창에서
      per: per, ends: ends, froms: froms, oldest: oldest,
      perTag: perTag, total: total, etaMs: total * BAND_PER_MS, minN: VC.BASELINE_MIN_N };
  }
  /* 채움 현황 — 태그별 학습 창 안 격자 칸 채움 여부(타이머·채우기 값 구분 없음)
     TAG 테이블은 NAME+TIME 중복 삽입을 막지 않아 재채우기 시 중복 적재 방지용 */
  _refreshBandCov(ov) {
    var self = this, plan = this._bandPlan(ov);
    if (!this.live || !plan.tags.length) { this.setState({ bandCov: null }); return Promise.resolve(); }
    var now = Date.now(), probe = VC.BAND_FREQ[0];
    var keys = plan.tags.map(function (t) { return t.tbl + ':' + t.tag + ':' + probe; });
    // 조회는 가장 이른 창 시작부터 1회, 계수만 태그별 창으로
    return bandTimes(keys, plan.oldest, now).then(function (m) {
      var cov = {};
      plan.tags.forEach(function (t) {
        var key = t.tbl + ':' + t.tag, set = {}, n = 0;
        var lo = plan.froms[key], hi = plan.ends[key];
        (m[key + ':' + probe] || []).forEach(function (ms) {
          if (ms < lo || ms > hi) return;   // 이 태그 창 밖 값 제외
          var b = Math.floor(ms / plan.iv);
          if (!set[b]) { set[b] = 1; n++; }
        });
        cov[key] = { set: set, have: n, need: plan.per[key] };
      });
      self.setState({ bandCov: cov });
      return cov;
    }).catch(function () { self.setState({ bandCov: null }); });
  }
  /* 백필 실행 — 최신 → 과거 방향, 청크 단위
     · 최신 우선 — 중단돼도 채운 부분이 곧 학습 가능 구간
     · 청크 간 휴지 — 감시 타이머 양보
     · 값 있는 시각은 건너뜀(재실행·이어하기 무비용) */
  _runBandBackfill() {
    var self = this, S = this.state;
    var plan = this._bandPlan();
    if (!plan.tags.length) { this._toast('대역을 추출할 태그가 없습니다', 'warn'); return Promise.resolve(); }
    var now = Date.now();
    this._bfCancel = false;
    // 찬 칸은 건너뜀(추가 태그만 채움·이어하기) — 현황 먼저 읽고 계획
    return this._refreshBandCov().then(function (cov) {
      var jobs = [], total = 0;
      // 태그별 앵커 목록(최신 → 과거) — 격자 스냅으로 타이머 시각과 정렬
      plan.tags.forEach(function (t) {
        var k = t.tbl + ':' + t.tag;
        var had = ((cov || {})[k] || {}).set || {};
        // 앵커 기준 = 태그의 마지막 데이터(벽시계면 원본 없는 구간이라 band.js가 전부 건너뜀)
        var anchors = VC.bandAnchors(plan.ends[k] || now, plan.iv, plan.per[k] || 0, had);
        if (anchors.length) { jobs.push({ t: t, anchors: anchors }); total += anchors.length; }
      });
      if (!total) { self._toast('이미 다 채워져 있습니다 — 새로 계산할 구간이 없습니다', 'ok'); return; }
      return self._bfRun(jobs, total, now, plan, cov);
    });
  }
  _bfRun(jobs, total, now, plan, cov) {
    var self = this, minN = plan.minN;
    // 학습 가능 = 태그별 보유량 최솟값 기준(진행률 아님 — 한 태그에 몰리면 나머지는 미달)
    var had = {}, gain = {};
    plan.tags.forEach(function (t) {
      var key = t.tbl + ':' + t.tag;
      had[key] = ((cov || {})[key] || {}).have || 0;
      gain[key] = 0;
    });
    var minHave = function () {
      var m = Infinity;
      Object.keys(had).forEach(function (k) { m = Math.min(m, had[k] + gain[k]); });
      return m === Infinity ? 0 : m;
    };
    this.setState({ bandFill: { done: 0, total: total, eta: total * BAND_PER_MS, learnable: minHave() >= minN } });
    var done = 0;
    function step(ji, ai) {
      if (self._bfCancel || ji >= jobs.length) return Promise.resolve();
      var job = jobs[ji];
      if (ai >= job.anchors.length) return step(ji + 1, 0);
      var chunk = job.anchors.slice(ai, ai + BAND_CHUNK);
      // grid = 앵커 격자 — 서버의 빈 앵커 재확인 범위·기존 칸 판별 단위
      var tql = Band.buildBandTql({ tags: [job.t], anchors: chunk, nowMs: now, grid: plan.iv });
      return bandBackfill(tql).then(function (nOk) {
        // 서버 실제 저장 개수 사용 — 원본 없는 구간은 건너뛰어 요청 수와 다를 수 있음
        var got = isFinite(nOk) && nOk > 0 ? Math.min(nOk, chunk.length) : 0;
        done += chunk.length;
        gain[job.t.tbl + ':' + job.t.tag] += got;
        self.setState({ bandFill: { done: done, total: total,
          eta: Math.max(0, total - done) * BAND_PER_MS, learnable: minHave() >= minN } });
        // 청크 간 휴지 — 감시 타이머 양보
        return new Promise(function (r) { setTimeout(r, BAND_CHUNK_GAP); }).then(function () { return step(ji, ai + BAND_CHUNK); });
      }).catch(function () { done += chunk.length; return step(ji, ai + BAND_CHUNK); }); // 청크 실패는 건너뜀(구멍은 균일화가 흡수)
    }
    return step(0, 0).then(function () {
      var cancelled = self._bfCancel;
      self.setState({ bandFill: null });
      var got = Object.keys(gain).reduce(function (a, k) { return a + gain[k]; }, 0);
      self._toast(cancelled ? '과거 채우기 중지 — 채운 만큼은 그대로 남습니다(다시 누르면 이어서 채웁니다)'
        : got === 0 ? '채울 구간에 원본이 없어 저장된 값이 없습니다 — 해당 태그의 데이터 기간을 확인하세요'
          : '과거 채우기 완료 · ' + got + '개', (cancelled || got === 0) ? 'warn' : 'ok');
      return self._refreshBandCov(); // 현황 표시 갱신
    });
  }
  // 반복 악화 감지 — 최근 2시간 임계 초과 이벤트 별도 조회(화면 목록은 기간·건수 제한), 1분 간격, 앱·서버 모드 공통
  _refreshFlap() {
    var self = this, now = Date.now();
    if (!this.live || this._flapBusy || (this._flapAt && now - this._flapAt < FLAP_REFRESH_MS)) return Promise.resolve();
    this._flapBusy = true;
    // +5분 — 서버 타이머 이벤트의 시계 오차 포함
    return this._recentEvents(now - FLAP_WIN_MS, now + 300000, 2000).then(function (rows) {
      var byTag = {}, out = {};
      rows.forEach(function (r) {
        if (r.etype === 'threshold') (byTag[r.tbl + ':' + r.tag] = byTag[r.tbl + ':' + r.tag] || []).push(r.ts);
      });
      Object.keys(byTag).forEach(function (k) {
        var ts = byTag[k].sort(function (a, b) { return a - b; });
        var d = VC.detectFlap(ts, FLAP_WIN_MS, now);
        if (d) { d.lastMs = ts[ts.length - 1]; out[k] = d; }
      });
      self._flap = out;
      self._flapAt = now;
      self.forceUpdate();
    }).catch(function () {}).then(function () { self._flapBusy = false; });
  }
  // 이벤트 기간 조회 — 테스트 교체용 메서드 래핑
  _recentEvents(from, to, cap) { return loadEventsRange(from, to, cap); }
  _cancelBandBackfill() { this._bfCancel = true; }
  // 주기 변경 영향 수치 — 학습 창 표본이 최소(30) 미달이면 학습 불가를 사전 표시
  _bandIvFacts(next, cur) {
    var S = this.state, iv = durMs(next) || 600000, nTags = cur.tags.length;
    var H = BAND_WIN_H[S.bandWin] || 24;   // 대역 학습 기간(RMS 기간 아님)
    var n = Math.floor(H * 3600000 / iv);
    var round = nTags * BAND_PER_MS, duty = iv > 0 ? round / iv * 100 : 0;
    return [
      { k: '대역 학습 표본', v: n + '개 (현재 ' + cur.perTag + '개) · 최소 ' + VC.BASELINE_MIN_N, warn: n < VC.BASELINE_MIN_N },
      { k: '회차당 소요', v: fmtDur(round) + ' · ' + nTags + '개 태그' },
      { k: '서버 점유율', v: duty >= 100 ? '주기 초과 — 다음 회차를 밀어냅니다' : duty.toFixed(0) + '%', warn: duty >= 50 },
      { k: '최소 학습 소요', v: n < VC.BASELINE_MIN_N ? '학습 불가' : fmtDur(VC.BASELINE_MIN_N * iv) + ' 후 (채우기 없이)' , warn: n < VC.BASELINE_MIN_N },
    ];
  }
  // 주기 확정 — 이전 구간 처리 후 타이머를 새 주기로 재굽기
  _applyBandInterval() {
    var self = this, S = this.state, next = S.bandIvNext, act = S.bandIvAct || 'keep';
    this.setState({ bandIvOpen: false });
    // 주기 변경 = 격자 변경 → 보유 칸 재계산(새 값 직접 전달로 배치 지연 회피)
    this._refreshBandCov({ bandInterval: next });
    // 확정은 즉시 저장·적용 — 저장 대기면 타이머(적용본)와 채운 값(새 주기)의 격자 불일치
    var applied = this._applyNow({ bandInterval: next });
    if (act === 'reset') {
      return applied.then(function (ok) {
        if (!ok) return;
        var eqs = self._activeEqs();
        // 서버 판정 타이머에 구워진 대역 학습값도 삭제 후 재굽기
        return Promise.all(eqs.map(function (eq) { return self._delBandBaseline(eq); }))
          .then(function () { return self._syncMonitorTimer(true); })
          .then(function () { self._toast('추출 주기 ' + (IV_KO[next] || next) + ' · 대역 베이스라인 초기화됨', 'ok'); });
      });
    }
    if (act === 'refill') return applied.then(function (ok) { if (ok) return self._runBandBackfill(); });
    return applied.then(function (ok) { if (ok) self._toast('추출 주기 ' + (IV_KO[next] || next) + '로 변경', 'ok'); });
  }
  // 대역 추출 타이머 — 판정 타이머와 같은 서명 비교, 태그·회전수 변경 시 재굽기(대역 경계가 1× 상대). 주기가 달라 판정 타이머와 분리
  _syncBandTimer(silent) {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this, S = this.state;
    // 설정 반영 전엔 굽지 않음 — 기본값(대역 끔)이 타이머 삭제
    if (!this.live || this._cfgLocked(true)) return Promise.resolve();
    // 대역 추출은 알람과 별개 — bandOn만 확인(알람 꺼도 추세·학습용 값 적재 지속)
    if (!C.bandOn) return this._dropTimer('_bandSig', deleteBandTimer, bandTimer());
    if (this._loadFail) return Promise.resolve();   // 판정 타이머와 같은 이유 — 불완전한 목록으로 굽지 않음
    var spec = this._bandSpec();
    // 대상 유무 먼저 기록 — 비동기 삭제 뒤 기록하면 같은 틱의 후속 판단이 옛 결론 사용
    this._bandNoTarget = !spec.tags.length;
    this._bandSkipWhy = this._bandNoTarget ? this._bandNoTargetWhy(spec) : '';
    var sched = '@every ' + (C.bandInterval || '10m');
    // 대상 0이면 삭제 — 설정은 켜짐인데 타이머가 없으므로 사유 토스트(silent 제외)
    if (!spec.tags.length) {
      var why = this._bandNoTargetWhy(spec);
      if (!silent) this._toast('대역 추출을 켤 수 없습니다 — ' + why, 'warn');
      return this._dropTimer('_bandSig', deleteBandTimer, bandTimer());
    }
    // 서명에 생성 TQL 포함 — 코드 변경 시 재굽기
    var tql = Band.buildBandTql(spec);
    var sig = JSON.stringify(spec.tags) + '|' + sched + '|' + srcSig(tql);
    if (silent && sig === this._bandSig) return Promise.resolve();
    return createBandTimer(tql, sched)
      .then(function () { self._bandSig = sig; if (!silent) self._toast('대역 추출 켜짐 · ' + sched, 'ok'); })
      .catch(function (e) { self._bandSig = null; if (!silent) self._toast('대역 추출 설정 실패: ' + (e.message || e), 'err'); });
  }
  // 서버 타이머 재동기화 예약 — 병렬 학습 완료마다 재등록 방지, 디바운스로 마지막 1회만
  _resyncMonSoon() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var self = this;
    this._bumpStamp('bl');   // 학습값이 바뀜 — 다른 탭·PC가 다시 읽음
    if (C.monMode !== 'server' || !C.monitorOn) return;
    if (this._resyncT) clearTimeout(this._resyncT);
    this._resyncT = setTimeout(function () { self._resyncT = null; self._syncMonitorTimer(true); }, 800);
  }
  // 학습 가능 여부(프록시) — 데이터 구간(초) ≥ 최소 표본(구간(초) ≈ sec 버킷 수), 실제 표본은 학습 시 재검증
  _blSpanSec(eq) { return eq && eq.stat ? (eq.stat.maxMs - eq.stat.minMs) / 1000 : 0; }
  _blLearnable(eq) { return this._blSpanSec(eq) >= VC.BASELINE_MIN_N; }
  _delBaseline(key, eq) {
    var self = this;
    deleteBaseline(key).then(function () {
      var m = Object.assign({}, self.state.baselines); delete m[key];
      self._blMap = m;
      self.setState({ baselines: m });
      self._resyncMonSoon(); // 삭제도 판정 기준 변경 — 서버 TQL 재굽기
      self._toast((eq ? (eq.alias || eq.name) : key) + ' 베이스라인 삭제됨');
    }).catch(function (e) { self._toast('삭제 실패: ' + (e.message || e), 'err'); });
  }
  // DB 미접속·테이블 없음 — 빈 라이브 상태로 시작(설정 → 데이터 소스 유도)
  _initEmpty(msg) {
    var E = this.E, now = Date.now();
    this.live = true;
    this._lead = false;   // 담당은 테이블 선택 뒤 첫 조율에서
    this.data = { now: now, equipment: [], events: [], reports: [] };
    this.setState({
      ready: true, srcSel: [], selTag: null, diagTag: null, events: [], reports: [], genTags: [],
      genPeriod: '', genFrom: '', genTo: '',
      from: this._dtVal(now - PERIOD_H['1h'] * 3600000), to: this._dtVal(now),
    });
    if (msg) this._toast(msg, 'warn');
  }
  componentDidUpdate() {
    this._scheduleDraw();
    // 계정 권한 표 — SYS가 데이터 소스 화면을 처음 열 때 1회 조회
    var S = this.state;
    if (S.tab === 'settings' && S.setSection === 'source' && S.user === 'SYS' && !S.needsDb && !S.grantUsers) this._loadGrantUsers();
    // 직접 입력 선택 직후 — 패널이 그려진 뒤 품번 칸에 커서
    if (this._focusGeoName && typeof document !== 'undefined') {
      var id = this._focusGeoName; this._focusGeoName = null;
      var el = Array.from(document.querySelectorAll('input[data-geo-name]')).filter(function (x) { return x.getAttribute('data-geo-name') === id; })[0];
      if (el) el.focus();
    }
  }
  _scheduleDraw() { var self = this; if (this._raf) clearTimeout(this._raf); this._raf = setTimeout(function () { self._draw(); }, 32); }
  cc() { var l = this.state.theme === 'light'; return { grid: l ? 'rgba(35,38,46,0.09)' : 'rgba(255,255,255,0.07)', axis: l ? '#5f636f' : '#9ba0aa', axisLine: l ? '#c2c6cd' : '#4a4a4a', hint: l ? '#8a8d99' : '#6c7079', text: l ? '#23262e' : '#f0f1f4' }; }
  _num(n) { return Math.round(n).toLocaleString('en-US'); }
  _eq(id) { if (!this.data) return null; for (var i = 0; i < this.data.equipment.length; i++) if (this.data.equipment[i].id === id) return this.data.equipment[i]; return null; }
  _activeEq(id) { var a = this._activeEqs(); if (!a.length) return null; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return a.slice().sort(function (x, y) { return (x.order || 0) - (y.order || 0); })[0]; }
  // 스펙트럼 분석 기준 시각 — 이벤트 클릭 시각 또는 선택 기간 끝, 데이터 범위로 클램프
  _detailAnchorMs(eq) {
    var S = this.state, a = S.detailAnchor;
    // 기간 입력은 분 단위 → 그 분의 끝(+59.999초)까지(이벤트 클릭 detailAnchor는 실제 시각이라 그대로)
    if (a == null) { var t = CH.parseDT(S.to); if (isFinite(t)) a = t + 59999; } // 선택 기간의 끝
    if (a == null) a = eq.lastSeen || (this.data && this.data.now); // 최후 폴백(안정값 — Date.now() 금지: 매 렌더 재캡처 유발)
    // 미래 데이터 없음 — lastSeen(V$STAT MAX_TIME)은 ms 내림값이라 +1ms로 마지막 표본 포함
    if (eq.lastSeen && a > eq.lastSeen) a = eq.lastSeen + 1;
    var mn = eq.stat && eq.stat.minMs;
    if (mn && a < mn) a = mn;
    return a;
  }
  /* 기간 안 판정 앵커 선택 — 창 끝 한 점은 정지·무부하 순간이면 파손 중에도 양호
     스윕은 위치만 결정, 등급은 고른 앵커에서 기존 파이프라인이 산출(측정법 단일화) */
  _pickAnchor(eq, sw, fallback) {
    var live = (sw.anchors || []).filter(function (a) { return !a.empty; });
    if (!live.length) return { at: fallback, sweep: sw };
    // 정지 판정은 기간 자기 대비(설비별 진폭·단위 상이) — 중앙값 5% 미만이면 정지, 전부 정지면 판단 안 함
    var ac = live.map(function (a) { return a.acRms; }).sort(function (x, y) { return x - y; });
    var med = ac[Math.floor(ac.length / 2)] || 0;
    var zones = this._isoZones(eq);
    var self = this;
    var rank = function (a) {
      var iso = VC.gradeFor(a.isoRms, zones), hit = a.patScore >= VC.TGT_ADOPT ? 1 : 0;
      return {
        stopped: med > 0 && a.acRms < 0.05 * med,
        g: VC.patternGate(!!hit, iso),   // 그 지점의 판정 등급(패턴이 켜고 ISO가 높이)
        iso: iso, hit: hit,
        score: a.patScore, rms: a.isoRms, a: a,
      };
    };
    var rs = live.map(rank);
    // 정지 의심 제외 — 전부 정지면 그중에서 선택
    var pool = rs.filter(function (r) { return !r.stopped; });
    if (!pool.length) pool = rs;
    // 판정 등급 → ISO 등급 → 결함 채택 → 점수 순 — 패턴이 어디에도 없으면 진동이 큰 지점
    pool.sort(function (x, y) {
      return (y.g - x.g) || (y.iso - x.iso) || (y.hit - x.hit) || (y.score - x.score) || (y.rms - x.rms);
    });
    var win = pool[0];
    // 같은 수준 지점 수 동반 반환 — 단발·지속 구분용(판정 기준엔 미반영, 단발 진짜 결함 보존), 수준 = 선택을 가른 축
    var lvl = win.g > 0 ? function (r) { return r.g; } : function (r) { return r.iso; };
    var wl = lvl(win);
    return { at: win.a.at, sweep: sw, worst: win, live: live.length,
      atLevel: pool.filter(function (r) { return lvl(r) >= wl; }).length, poolN: pool.length, level: wl,
      stopped: rs.filter(function (r) { return r.stopped; }).length };
  }
  // 상세 취득 단일 경로 — 화면·리포트가 같은 앵커 사용
  _detailAt(eq, fromMs, toMs, vu, useSweep) {
    var self = this;
    if (!useSweep) return Promise.resolve({ at: toMs }).then(function (p) {
      return liveDetail(self.E, eq, p.at, vu, fromMs).then(function (det) { return { det: det, pick: p }; });
    });
    return sweepAnchors(self.E, eq, fromMs, toMs, null)
      .catch(function () { return { anchors: [], scanned: 0 }; })
      .then(function (sw) {
        var p = self._pickAnchor(eq, sw, toMs);
        return liveDetail(self.E, eq, p.at, vu, fromMs).then(function (det) { return { det: det, pick: p }; });
      });
  }
  _anchorNote(snap) {
    if (!this.live || !snap || !snap.anchor) return '';
    var E = this.E, at = E.fmtDT(snap.anchor);
    var p = snap.pick;
    if (!p || !p.worst) return '판정 기준 시각 ' + at;   // 사용자가 이벤트에서 짚은 시각
    var s = '판정 기준 시각 ' + at + ' · 기간 ' + p.live + '곳 중 ';
    // 분포는 이상 수준(level > 0)일 때만 표기
    if (!p.level) s += '가장 나쁜 곳';
    else if (p.atLevel <= 1) s += '이 1곳만 이 수준 — 단발일 수 있습니다';
    else s += p.atLevel + '곳이 이 수준';
    if (p.stopped) s += ' (정지 의심 ' + p.stopped + '곳 제외)';
    return s;
  }
  // 감시가 지금 보고 있는 계측 이상 사유({label,detail}) — 없으면 null
  _gateOf(eq) { return ((this._runState || {})[eq.table + ':' + eq.name] || {}).gate || null; }
  // 재캡처 판단 키 — 사용자 선택값(기간·기준시각·표시 물리량)만(앵커 값은 lastSeen에 연동돼 판정 틱마다 캐시 폐기)
  _detailKey() {
    var S = this.state;
    return [S.period, S.from, S.to, S.detailAnchor == null ? '' : S.detailAnchor, S.viewUnit || ''].join('|');
  }
  _detail(eq) {
    if (this.live) {
      var key = this._detailKey(), vu = this.state.viewUnit || null, self = this;
      var c = this._detailCache[eq.id];
      if (c && c.key !== key) { delete this._detailCache[eq.id]; c = null; } // 조회 기간·기준 시각·표시 물리량이 바뀌면 재캡처
      if (!c) {
        /* 순수 스냅샷 — 캡처 시점 등급·RMS·기준시각·계측 상태(gate) 고정, 재캡처 전까지 불변
           gate도 고정 — 판정 동결 여부가 지표·등급·권고로 전파되므로 */
        var anchor = this._detailAnchorMs(eq);
        var reqFrom = CH.parseDT(this.state.from);
        // 이벤트 클릭으로 지정된 시각은 그대로 — 스윕은 기간 선택 시에만
        var useSweep = this.state.detailAnchor == null;
        c = this._detailCache[eq.id] = { state: 'loading', det: emptyDet(eq), eqSnap: Object.assign({}, eq), snapNow: (this.data && this.data.now) || Date.now(), key: key, anchor: anchor, reqFrom: reqFrom, reqTo: anchor, viewUnit: vu, gate: this._gateOf(eq) };
        this._detailAt(eq, reqFrom, anchor, vu, useSweep).then(function (r) {
          var det = r.det;
          c.det = det; c.state = 'ready'; c.anchor = r.pick.at; c.pick = r.pick;
          if (det.raw && !det.raw.values.length) self._toast('선택 구간에 원시 파형이 없습니다 · 마지막 수집 ' + (eq.lastSeen ? self.E.fmtDT(eq.lastSeen) : '-'), 'warn');
          self.forceUpdate();
        }).catch(function (e) { c.state = 'error'; self._toast('상세분석 조회 실패 — 네트워크·DB 상태 확인 후 새로고침하세요', 'err'); self.forceUpdate(); console.warn('[vibe] detail load failed', e); });
      }
      return c.det;
    }
    return emptyDet(eq);
  }
  _trends(eq, roll) {
    if (this.live) {
      // 트렌드 구간 등분 원시 청크 샘플링(첨도·대역에너지) — 비동기 로드 후 재드로우
      if (!this._trCacheL) this._trCacheL = {};
      var key = eq.id + ':' + (roll.length ? roll[0].ms + '-' + roll[roll.length - 1].ms : '0');
      var c = this._trCacheL[key], self = this;
      if (!c) {
        c = this._trCacheL[key] = { kurt: [], bands: [], xLabels: [], xTips: [], state: 'loading' };
        // 완료 시 캔버스·화면 모두 재그리기 — 카드 안내 문구가 로딩 시점 값에 멈추는 것 방지
        loadTrendChunks(this.E, eq, roll).then(function (tr) {
          Object.assign(c, tr, { state: 'ready' });
          self._scheduleDraw(); self.forceUpdate();
        }).catch(function (e) { c.state = 'error'; self.forceUpdate(); console.warn('[vibe] trend chunks failed', e); });
      }
      return c;
    }
    return { kurt: [], bands: [], xLabels: [] };
  }
  // 조회 기간 → 롤업 창(시작·종료·단위) — 구간 길이별 버킷 단위로 과다 버킷 방지
  _rollWindow(now, st, scope) {
    var S = this.state, rep = scope === 'report'; // 상세분석과 리포트는 조회 기간이 서로 독립
    var p = (rep ? S.genPeriod : S.period) || '1h';
    var fromMs, toMs = now;
    if (p === 'all') {
      fromMs = (st && st.minMs) ? st.minMs : now - PERIOD_H['7d'] * 3600000; // 데이터 전 구간
    } else if (p === 'custom') {
      // 달력으로 고른 구간은 하루 단위(시작일 00:00 ~ 종료일 23:59)
      var cf = CH.parseDT(rep ? S.genFrom : S.from);
      var ct = CH.parseDT(rep ? S.genTo : S.to);
      fromMs = !isNaN(cf) ? cf : now - PERIOD_H['7d'] * 3600000;
      if (!isNaN(ct)) toMs = ct;
    } else fromMs = now - (PERIOD_H[p] || 1) * 3600000;
    // 데이터 범위로 창 축소(빈 여백·해상도 손실 방지) — 겹칠 때만(완전 불일치면 요청과 다른 시기 표시 위험)
    if (st && st.minMs && st.maxMs && toMs > st.minMs && fromMs < st.maxMs) {
      fromMs = Math.max(fromMs, st.minMs);
      toMs = Math.min(toMs, st.maxMs);
    }
    if (!(toMs > fromMs)) fromMs = toMs - 3600000;
    // 단위 사다리 — 티어별 버킷 수 상한으로 DB·렌더 비용 일정
    //   ~2시간 초별(≤7,200) / ~5일 분별(≤7,200) / ~1년 시간별(≤8,760) / ~10년 일별(≤3,650) / 그 이상 월별
    var spanSec = Math.max(1, (toMs - fromMs) / 1000);
    var unit = spanSec <= 2 * 3600 ? 'sec'
      : spanSec <= 5 * 86400 ? 'min'
        : spanSec <= 365 * 86400 ? 'hour'
          : spanSec <= 3650 * 86400 ? 'day' : 'month';
    var stepSec = { sec: 1, min: 60, hour: 3600, day: 86400, month: 2592000 }[unit];
    return { fromMs: fromMs, toMs: toMs, unit: unit, stepSec: stepSec, clock: stepSec <= 60,
      label: { sec: '초별 (1s)', min: '분별 (1m)', hour: '시간별 (1h)', day: '일별 (1d)', month: '월별 (1M)' }[unit] };
  }
  // 선택 기간의 롤업을 DB에서 fresh 조회 (기준점=그 태그의 현재 최신 데이터 시각)
  _rollForAsync(eq, scope) {
    var self = this;
    return tagStats(eq.table).then(function (stats) {
      var st = stats[eq.name];
      var now = (st && st.maxMs) || eq.lastSeen || self.data.now;
      var w = self._rollWindow(now, st, scope);
      return rollupTrend(eq.table, eq.name, w.unit, w.fromMs, w.toMs).then(function (buckets) {
        return { roll: buckets || [], label: w.label, stepSec: w.stepSec, clock: w.clock, fromMs: w.fromMs, toMs: w.toMs };
      });
    });
  }
  // 렌더용 동기 래퍼 — 기간별 캐시, 없으면 비동기 조회 후 재드로우
  _rollFor(eq) {
    if (!this.live) return { roll: [], label: '-', stepSec: 3600, clock: false };
    if (!this._rfCache) this._rfCache = {};
    var S = this.state, self = this;
    var key = eq.id + '|' + S.period + '|' + (S.period === 'custom' ? S.from + '~' + S.to : '');
    var c = this._rfCache[key];
    if (!c) {
      c = this._rfCache[key] = { roll: [], label: '조회 중…', stepSec: 3600, clock: false, state: 'loading', fromMs: null, toMs: null };
      this._rollForAsync(eq, 'detail').then(function (rf) {
        Object.assign(c, rf, { state: 'ready' }); self.forceUpdate();
      }).catch(function (e) { c.state = 'error'; c.label = '조회 실패'; console.warn('[vibe] rollFor failed', e); });
    }
    return { roll: c.roll, label: c.label, stepSec: c.stepSec, clock: c.clock, fromMs: c.fromMs, toMs: c.toMs };
  }
  /* detIn: 계산된 상세(리포트는 리포트 기간 끝 앵커) — 생략 시 화면 기준 재조회라 앵커 불일치로 emptyDet 위 판정
     sev: VC.sevMetrics 결과 — 넘기면 진폭 정상 구간에서도 Crest 초과를 문구에 반영 */
  _dx(eq, detIn, sev) { return this._dxLive(eq, detIn, sev); }
  // 라이브 진단 — 결함 패턴 게이트 등급 + 판정문·근거·권고·커버리지
  _dxLive(eq, detIn, sev) {
    var E = this.E, det = detIn || this._detail(eq), g = E.STATUS[eq.grade];
    var ev = [], verdict, fr = eq.rpm / 60;
    var bf = (eq.bearing && eq.bearing.n > 0 && eq.rpm > 0) ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    var dom = det.fft.freqs.length ? VC.diagnoseDominant(det.fft.freqs, det.fft.mags, fr, bf) : null;
    var sp = det.spectral || { notes: [], cause: null };
    var cause = sp.cause || (dom ? dom.cause : null); // 하모닉 패턴 우선(단일 피크보다 신뢰↑)
    if (dom) ev.push({ src: 'FFT', txt: '지배 주파수 ' + dom.domF.toFixed(1) + ' Hz' + (dom.hit ? ' — ' + dom.hit : '') });
    sp.notes.forEach(function (t) { ev.push({ src: '패턴', txt: t }); });
    if (det.envelope && det.envelope.fault) ev.push({ src: '포락선', txt: det.envelope.hint });
    if (det.bandKurt != null) ev.push({ src: '지표', txt: '밴드 커토시스 ' + det.bandKurt.toFixed(1) + (det.bandKurt > 4.5 ? ' · 고주파 충격성' : '') });
    var kurtIn = det.indics[1];
    if (kurtIn) ev.push({ src: '지표', txt: '커토시스 ' + kurtIn.v + (kurtIn.hint ? ' · ' + kurtIn.hint : '') });
    var crestIn = det.indics[3];
    if (crestIn) ev.push({ src: '지표', txt: 'Crest Factor ' + crestIn.v + (crestIn.hint ? ' · ' + crestIn.hint : '') });
    if (!ev.length) ev.push({ src: '지표', txt: '표시 구간 데이터 없음 — 조회 기간을 확인하세요' });
    // 규칙 패턴 무검출 시 근거 강도 1순위 채택 — 상단 판정과 근거표 일치
    var evx = det.fft.freqs.length ? this._evidence(eq, det) : null;
    if (!cause && evx) {
      var t = evx.top;
      if (t && t.score >= VC.EVID_ADOPT) {
        if (/베어링/.test(t.f)) cause = '베어링 충격성 의심' + (evx.hasBearing ? '' : ' (베어링 형식 미지정 — 확정 불가)');
        else if (/벨트|Sub-sync/.test(t.f)) cause = '비동기·sub-synchronous 성분 의심 (벨트·오일훨 등)';
        else if (/풀림/.test(t.f)) cause = '기계적 풀림 의심';
        else if (/정렬/.test(t.f)) cause = '축 정렬 불량 의심';
        else if (/불평형/.test(t.f)) cause = '질량 불평형 의심';
      }
    }
    /* 결함 패턴 축 — 학습 없는 스펙트럼 절대 판정(진폭 정상이어도 패턴 확실하면 등급 상승)
       감시와 같은 검출기(det.sideband = targetedMatch) → 임계도 짝인 TGT_ADOPT(EVID_ADOPT 사용 시 감시·상세 불일치) */
    var _patOn = VC.patternGrade(det.sideband ? (det.sideband.r || 0) : 0,
      !!(det.quality && det.quality.gate), VC.TGT_ADOPT) > 0;
    // ISO 축 = 앵커 시점 직접 계산값(det.isoRms, mm/s) — 감시 대상 아닌 태그도 즉시 적용
    var isoGi = det.isoRms != null ? VC.gradeFor(det.isoRms, this._isoZones(eq)) : null;
    // 나머지 축도 앵커 시점 기준 — 최신 등급(eq.grade)이면 기간 이동에 미추종(감시 화면 _severityOf는 최신 기준 유지)
    var _bkey = eq.table + ':' + eq.name;
    var _bl = (this._blMap || this.state.baselines || {})[_bkey];
    var _blLim = this._isRevived(_bkey) ? null : VC.baselineLimit(_bl);
    var _acRms = (det.raw && det.raw.values.length) ? (function (a) {
      var m = 0, i; for (i = 0; i < a.length; i++) m += a[i]; m /= a.length;
      var ss = 0; for (i = 0; i < a.length; i++) { var d2 = a[i] - m; ss += d2 * d2; }
      return Math.sqrt(ss / a.length);
    })(det.raw.values) : null;
    var blGi = (_blLim != null && _acRms != null) ? ((_acRms > _blLim) ? Math.max(1, isoGi || 0) : 0) : null;
    var _bandJ = det.bandAt
      ? VC.bandJudge(det.bandAt, this._bandBaselines(eq), false, this._softBands(eq),
        (this._monState || {})[_bkey] && this._monState[_bkey].elat, det.anchorMs || Date.now())
      : null;
    /* 결함 패턴은 게이트 — 결함 유무(이진)만, 급한 정도는 ISO(베이스라인 blGi와 같은 형태)
       - ISO 독립 축은 오탐 과다. ⚠ 비베어링 원인(불평형·정렬불량·풀림)의 고진동은 등급 불변 → 판정문(isoOnly)이 표시
       - 규칙은 정본 함수(VC.patternGate) — 복제 시 감시·상세 등급 불일치. 인자는 이 화면 값(앵커 ISO·100회전 창 판정) */
    var patGi = VC.patternGate(_patOn, isoGi);
    /* 상세분석 게이트는 결함 패턴 하나 — 베이스라인·대역은 학습 의존이라 넣으면 학습 여부로 등급이 갈림
       두 축은 근거로만 표시(켜짐 여부는 blOnly·bandOnly) */
    var wgA = VC.worstGrade(0, 0, 0, patGi);
    var gi = wgA.gi;
    // 등급 미반영 축의 켜짐 사실 보존 — 판정문 표시용
    var isoOnly = (isoGi != null && isoGi > gi) ? isoGi : 0;
    var blOnly = (gi === 0 && (blGi || 0) > 0) ? 1 : 0;                       // 평소 대비 급증
    var bandOnly = (gi === 0 && _bandJ && _bandJ.on && _bandJ.gi > 0) ? 1 : 0; // 대역 이탈
    g = E.STATUS[gi];
    /* 커버리지 — 판정 참여 축 수. 빈 축을 감춘 채 '징후 없음' 단정 금지
       - 필수(ISO·결함 패턴): 학습 불필요, 이 화면으로 완결 / 보강(베이스라인·대역): 평소 대비라 등급 미반영·근거로만
       - 회전수 없으면 결함 패턴·대역은 0점 아닌 측정 불가(1× 상대 정의)
       - 축 이름에 가운뎃점 금지(이름 연결 구분자와 혼동) */
    var _rpmOk = eq.rpm > 0;
    // 결함 패턴 = 회전수·구름체 기하 둘 다 필요(감시 _patCapable과 같은 조건 — 품번 미지정·저널 베어링은 판정 못 함)
    var _patMeta = this._patCapable(eq);
    var coreAx = [
      { ko: 'ISO 존', ok: isoGi != null },
      { ko: '결함 패턴', ok: _patMeta && !!(evx && !evx.gate) },
    ];
    /* 결함 패턴 못 잰 사유 — meta(회전수·품번 없음) · sleeve(저널 베어링, 판정 대상 아님) · gate(계측 이상) · data(스펙트럼 없음)
       판정문·리포트 머리·조치 카드·LLM 근거가 같은 사유를 씀 */
    var _sleeve = _rpmOk && !!(eq.bearing && eq.bearing.model === 'sleeve');
    var patWhy = coreAx[1].ok ? '' : !_patMeta ? (_sleeve ? 'sleeve' : 'meta') : (evx && evx.gate) ? 'gate' : 'data';
    var extraAx = [
      { ko: '베이스라인', ok: blGi != null },
      { ko: '대역', ok: _rpmOk && !!_bandJ },
    ];
    var okOf = function (a) { return a.ok; };
    var koOf = function (a) { return a.ko; };
    var covN = coreAx.filter(okOf).length;
    var covMiss = coreAx.filter(function (a) { return !a.ok; }).map(koOf);
    var extraOn = extraAx.filter(okOf).map(koOf);
    // 진폭 정상 + 충격성(Crest) → '징후 없음' 단정 대신 문구로 표시(등급 미반영 — 저진폭 Crest는 오경보 과다)
    var impulse = gi === 0 && !!(sev && sev.crest && sev.crest.grade > 0);
    if (gi === 0 && (isoOnly > 0 || blOnly || bandOnly)) {
      var _why = [];
      if (blOnly) _why.push('평소 대비 급증');
      if (bandOnly) _why.push('대역 이탈');
      if (isoOnly > 0) _why.push('진동 수준 ' + E.STATUS[isoOnly].ko + ' 구간');
      verdict = '베어링 결함 징후 없음 · ' + _why.join(' · ')
        + ' — 불평형·정렬불량·풀림 등 베어링 외 원인 점검 권장';
    }
    else if (gi === 0) verdict = impulse ? '진폭 정상 · 충격성 신호 존재 — 계측 확인 후 재평가'
      : covN >= coreAx.length ? '뚜렷한 결함 징후 없음 — 정상 운전'
        : '관측 범위 내 이상 없음 — 판정 기준 ' + covN + '/' + coreAx.length;
    else verdict = (cause || '이상 진동 — 다축 정밀 측정 권장') + ' — ' + (gi >= 3 ? '심각 단계' : gi === 2 ? '진행 단계' : '초기 징후');
    // 전대역 복조의 '없음'은 약한 근거(조기 결함 공진 대역이 Nyquist 밖) → 양호 판정일 때만 단서 부기
    if (gi === 0 && det.demodSrc === 'wideband') {
      verdict += ' · 전대역 복조(샘플레이트 ' + Math.round(eq.fs || 0) + ' Hz — 1~5 kHz 대역 불성립)이므로 조기 베어링 결함은 이 판정에 포함되지 않습니다';
    }
    // 계측 게이트 — 계측 문제 파형이면 진단보다 검증 우선, 사유(클리핑·DC·스파이크) 문구 포함
    var _gr = VC.gateReason(det.quality, null);
    if (_gr) { verdict = '계측 검증 필요(' + _gr.label + ') — 결함 진단 보류 · 센서·케이블·마운팅 점검'; impulse = false; }
    // 회전수 미상은 계측 게이트 다음 우선순위
    /* 결함 패턴을 못 세우는 설정(회전수·구름체 기하 없음) — 다른 축 소견이 없을 때만 판정문 대체, 있으면 사유만 덧붙임
       (진동 수준·평소 대비 급증 같은 소견을 지우지 않음) */
    else if (gi === 0 && !_patMeta) {
      var _noPat = !_rpmOk ? '회전수 미상' : _sleeve ? '저널 베어링' : '베어링 품번 미지정';
      if (isoOnly > 0 || blOnly || bandOnly || impulse) verdict += ' · 결함 패턴 판정 불가(' + _noPat + ')';
      else verdict = !_rpmOk ? '회전수 미상 — 주파수 판정 불가(결함 패턴·대역 축 제외) · 설정에서 RPM을 입력하십시오'
        : _sleeve ? '저널(sleeve) 베어링 — 구름베어링 결함주파수가 없어 결함 패턴 판정 대상이 아닙니다'
          : '구름베어링 형상 없음(품번 미지정) — 결함 패턴 판정 불가 · 설정에서 베어링 품번을 입력하십시오';
    }
    var acts = this._buildActions(eq, det, dom, cause, evx);
    return {
      // gi: 패턴 축 반영 등급 — 화면·리포트 공통 사용(판정문·등급 칩 일치)
      verdict: verdict, impulse: impulse, gi: gi, patGi: patGi, gradeSrc: wgA.src,
      isoOnly: isoOnly, isoGi: isoGi, blOnly: blOnly, bandOnly: bandOnly,
      // 진동(주파수 대역)·베어링(포락선 결함주파수) 분리 반환 — 조치가 다르고 대역 배수는 인접 결함 전파로 오염 가능
      bandAx: _bandJ ? { envR: _bandJ.envR, envKey: _bandJ.envKey, envAlt: _bandJ.envAlt, freqR: _bandJ.freqR, freqKey: _bandJ.freqKey } : null,
      cov: { n: covN, total: coreAx.length, missing: covMiss, extra: extraOn, patWhy: patWhy },
      sub: (eq.alias || eq.name) + ' · ' + (eq.bearing && eq.bearing.n ? '베어링 ' + this._bearingLabel(eq) : '베어링 미지정') + ' · ' + this._rpmText(eq)
        + (det.frMeas ? '(실측 ' + Math.round(det.frMeas.rpm) + ')' : '')
        + (det.isoRms != null ? ' · ISO Zone ' + ['A', 'B', 'C', 'D'][VC.gradeFor(det.isoRms, this._isoZones(eq))] : ''),
      color: g.color, soft: g.soft, gradeKo: g.ko,
      evidence: ev,
      actions: acts.map(function (t, i) { return { no: (i + 1) + '.', txt: t }; }),
    };
  }
  // 증거 기반 권고 — 진단 결과(원인·지배주파수·지표·추세)에서 조치 생성, 정상에 가까울수록 항목 감소
  _buildActions(eq, det, dom, cause, evx) {
    var ind = det.indics || [];
    var kurt = ind[1] ? parseFloat(ind[1].v) : 0;
    var crest = ind[3] ? parseFloat(ind[3].v) : 0;
    var bk = det.bandKurt; // 밴드 커토시스(고주파 임펄스성) — 원파형 커토시스보다 결함 특이도↑
    var impulsive = (bk != null && bk > 4.5) || kurt > 4.5 || crest > 6;
    var tr = this._trendDir(eq.rollup);
    var hasBearing = !!(eq.bearing && eq.bearing.n > 0);
    var a = [];
    var gate = !!(det.quality && det.quality.gate);
    // 계측 게이트 — 스파이크성 신호면 검증 1순위
    if (gate) a.push('계측 검증 우선 — 극단 Crest/첨도는 스파이크성 잡음(ESD·케이블·접촉) 시그니처와 구분 불가. 센서 마운팅·케이블·커넥터 점검 후 재측정');
    // det.isoRms는 liveDetail의 속도(mm/s) 변환값 — 원본 단위 무관
    var isoOk = det.isoRms != null;
    var jg = isoOk ? VC.gradeFor(det.isoRms, this._isoZones(eq)) : eq.grade;
    var jSrc = isoOk ? 'ISO 대역제한 판정' : '심각도 판정 RMS';
    // 게이트 켜짐 → 기계 상태 조치 일절 없음(결함 지목·존 권고 포함) — 조치 목록만 보고 센서 점검 누락 방지. 게이트는 전역 상태
    if (gate) {
      // 메타데이터 입력 조치를 앞으로 — 목록 상한 절단 방지, 문구는 근거표의 막힌 사유에서 생성
      a.push(this._metaAction(evx));
      a.push('재측정 시 취득 조건 상향: 8초 창 · 0.125 Hz 분해능 · Hanning 50% 중첩 · 8회 평균(측대역·저주파 진단 조건)');
      if (tr && tr.pct > 10) a.push('추세는 계측 검증 후 재평가 — 스파이크성 신호가 섞이면 RMS 추세 자체가 왜곡됨');
      // 존 판정은 보류 명시·값만 참고
      a.push('계측 검증 후 존 판정 재평가 — 현재 관측값은 ' + (isoOk ? this._isoDisp(eq, det) + '(' + ['양호', '주의', '위험', '심각'][jg] + ' 수준)' : this.E.STATUS[jg].ko) + '이나 아티팩트가 섞여 있어 상한값입니다');
      return a.slice(0, 5);
    }
    // 시급성은 규격 판정(ISO 대역제한) 기준 — 광대역 감시 등급이 더 높으면 그 사실만 별도 기재
    a.push((jg >= 3 ? '긴급 점검 · 설비 중요도·추가 증상 고려해 정지 여부 검토 (심각 존'
      : jg === 2 ? '조기 점검 권장 · 측정 주기 단축으로 추세 감시 (위험 존'
        : jg === 1 ? '모니터링 강화 · 다음 정기 점검 시 확인 (주의 존'
          : '정상 운전 유지 · 예방관리 지속 (양호 존') + ' · ' + jSrc + ' 기준)');
    if (isoOk && eq.grade > jg) a.push('광대역 감시 등급은 ' + this.E.STATUS[eq.grade].ko + '(최신 1초 RMS ' + this.E.fmt(eq.rms) + ' ' + eq.unit + ')로 규격 판정보다 높음 — 고주파 성분 차이. 알람 임계 재검토 또는 협대역 감시 전환 검토');
    // 원인별 (지배 주파수 + 하모닉/측대역 패턴)
    cause = cause || '';
    if (/불평형/.test(cause)) a.push('회전체 밸런싱(현장 동적 균형) 점검 — 1× 성분 지배');
    if (/정렬/.test(cause)) a.push('커플링·축 정렬(레이저 얼라인먼트) 점검 — 2× 성분 우세');
    if (/풀림/.test(cause)) a.push('체결·고정·베어링 하우징 상태 점검 — 1× 하모닉 다수(기계적 풀림 패턴)');
    if (/외륜/.test(cause)) a.push('베어링 외륜 결함(BPFO 하모닉 열) — 교체 검토·윤활 상태 확인');
    if (/내륜/.test(cause)) a.push('베어링 내륜 결함(BPFI 하모닉·측대역) — 교체 검토');
    if (/전동체|볼/.test(cause)) a.push('베어링 전동체 결함(BSF 하모닉) — 교체 검토');
    // 증상별(충격성, 밴드 커토시스 우선) — fs가 결함주파수를 못 따라가면 포락선 분석 대신 계측 사양 상향 권고
    if (impulsive) {
      var _bf = (eq.bearing && eq.bearing.n > 0 && eq.rpm > 0) ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
      var _impTxt = '충격성 신호(' + (bk != null ? '밴드 커토시스 ' + bk.toFixed(1) : '커토시스 ' + kurt.toFixed(1)) + '·Crest ' + crest.toFixed(1) + ')';
      if (_bf && !VC.bearingFsOk(eq.fs, _bf)) {
        var _top = Math.max(_bf.BPFO || 0, _bf.BPFI || 0, _bf.BSF || 0);
        a.push(_impTxt + ' — 원인 규명에 고주파 계측 필요. 현재 fs ' + this._num(eq.fs) + ' Hz로는 포락선 복조 불가(결함주파수 '
          + _top.toFixed(0) + ' Hz · 최소 ' + this._num(Math.round(_top * VC.BEARING_FS_RATIO)) + ' Hz). 휴대형 진동계로 별도 측정 권장');
      } else {
        a.push(_impTxt + ' — 베어링·기어 손상 정밀 점검(포락선·고주파)');
      }
    }
    // 추세 (관측이 짧으면 "단기 상승"으로 — 장기 추세 단정 회피)
    if (tr && tr.pct > 10) {
      var _rl = eq.rollup || [], _durMin = _rl.length > 1 ? (_rl[_rl.length - 1].ms - _rl[0].ms) / 60000 : 0;
      a.push((_durMin < 60 ? '단기 RMS 상승(+' + tr.pct.toFixed(0) + '% · 관측 ' + Math.round(_durMin) + '분, 장기 추세 판단 불가)' : 'RMS 상승 추세(+' + tr.pct.toFixed(0) + '%)') + ' — 측정 주기 단축, 추세 추적으로 진행 여부 확인');
    }
    // 메타데이터 부재 → 후보 '측정 불가' — 채울 항목 항상 안내
    if (!hasBearing || (evx && evx.unmeasurable && evx.unmeasurable.length)) a.push(this._metaAction(evx));
    // 지배 주파수 불일치 (패턴도 못 잡은 경우만)
    if (dom && !dom.hit && !cause && eq.grade >= 1) a.push('지배 주파수 ' + dom.domF.toFixed(1) + ' Hz가 1×/2×·베어링 주파수와 불일치 — 비동기 성분(유체·구조 공진 등) 확인');
    return a.slice(0, 5);
  }
  // 근거표의 '측정 불가' 사유 → 입력 항목과 열리는 후보로 변환
  _metaAction(evx) {
    var NEED = [
      { re: /품번/, item: '베어링 품번', opens: '베어링' },
      { re: /날개수/, item: '임펠러 날개수', opens: '베인/블레이드 통과' },
      { re: /계통주파수/, item: '계통주파수', opens: '전기적' },
      { re: /벨트 제원|풀리경/, item: '벨트 제원(풀리경·벨트길이)', opens: '벨트·풀리' },
      { re: /위상|축방향/, item: '위상·축방향 측정', opens: '불평형·정렬불량' },
    ];
    // 사유는 conf[].caveat에(evx.unmeasurable은 이름 배열뿐)
    var why = ((evx && evx.conf) || []).filter(function (c) { return c.na; }).map(function (c) { return c.caveat || ''; }).join(' ');
    var hit = NEED.filter(function (n) { return n.re.test(why); });
    if (!hit.length) return '설비 메타데이터 입력(베어링 품번 · 마운팅 방식 · 계측 방향 · 구동 계통도 · 날개수 · 계통주파수) — 판정 가능 범위가 넓어집니다';
    return '설비 정보 입력 — ' + hit.map(function (n) { return n.item + '(→ ' + n.opens + ' 판정)'; }).join(' · ')
      + ' · 마운팅 방식(→ 고주파 대역 유효성) — 현재 "측정 불가" ' + hit.length + '종이 이걸로 열립니다';
  }
  // 상세분석 이동 + 조회기간을 해당 태그의 데이터 기준으로 재설정 (카드 클릭·이벤트·태그 선택 공용)
  _gotoDetail(id, atMs) {
    if (!id) return; // 감시 대상에서 빠진 태그의 이벤트 등 — 이동 불가
    var E = this.E, eq = this._eq(id);
    delete this._detailCache[id]; this._rfCache = {}; // 열 때 새 스냅샷(파형·추세)용 캐시 무효화
    var patch = { tab: 'detail', selTag: id, dxAiText: null, dxOpen: false, detailAnchor: atMs || null };
    if (atMs) { // 이벤트 시점 보기 — 앞뒤 30분 직접 구간(초 단위 해상도), 스펙트럼은 그 시각 고정
      patch.period = 'custom';
      patch.from = this._dtVal(atMs - 1800000); patch.to = this._dtVal(atMs + 1800000);
    } else if (eq && eq.lastSeen) {
      // 모니터링 카드에서 들어오면 1시간 기준(데이터가 1시간 미만이면 전체로 보정)
      var pd = this._periodFor(eq, '1h'), rg = this._periodRange(eq, pd);
      patch.period = pd; patch.from = rg.from; patch.to = rg.to;
    }
    this.setState(patch);
    this._scrollTop();
  }
  /* 트렌드 실제 시간 범위 텍스트 — 요청 기간과 다를 수 있어 실구간 표시
     시작은 차트 축과 같은 첫 표본(_xFrom0), 끝은 고른 기간 끝 그대로(이후 빈 구간 = 무수신) */
  _rangeText(roll, fallback, win) {
    var E = this.E;
    if (win && win.fromMs && win.toMs) return E.fmtDT(this._xFrom0(roll, win.fromMs)) + ' ~ ' + E.fmtDT(win.toMs);
    if (!roll || !roll.length) return fallback;
    return E.fmtDT(roll[0].ms) + ' ~ ' + E.fmtDT(roll[roll.length - 1].ms);
  }
  // 추세 축 시작 — 앞쪽이 통째로 비면 첫 표본까지 당김(끝·중간 결측은 무수신 정보라 유지)
  _xFrom0(roll, fromMs) {
    var t0 = (roll && roll.length) ? roll[0].ms : 0;
    return (t0 && fromMs && t0 > fromMs) ? t0 : fromMs;
  }
  // 결함 패턴 축 성립 여부 — 회전수·베어링 기하 둘 다 필요(_equipUnset보다 넓음), 설정 즉시 반영 위해 state 기준
  _patBlockedId(id) {
    var S = this.state;
    var rpm = VC.shaftRpm((S.equipRpm || {})[id], (S.equipMeta || {})[id]).rpm;
    var model = (S.equipBearing || {})[id] || '';
    var geo = model ? (VC.BEARINGS[model] || (S.equipGeo || {})[id] || {}) : {};
    return !(rpm > 0) || !(geo.n > 0);
  }
  // 설비 정보 미설정 — 지정 항목 하나도 없으면 true(마운팅 포함, 구동·날개수는 해당 없는 설비가 많아 제외)
  _equipUnset(id) {
    var S = this.state;
    return !((S.equipCls || {})[id] || (S.equipRpm || {})[id] || (S.equipBearing || {})[id] || (S.equipUnit || {})[id]
      || ((S.equipMeta || {})[id] || {}).mount);
  }
  /* LLM 설정 — 기본은 적용된 설정(저장본): 상세분석·리포트의 호출·표시
     src에 편집본(this.state)을 넘기는 곳은 설정 화면(연결 테스트·상태 표시)뿐 */
  _llmCfg(src) {
    var S = src || this._ac();
    return { provider: S.llmProvider, apiKey: (S.llmKeys || {})[S.llmProvider] || '', model: (S.llmModels || {})[S.llmProvider] || '', baseURL: S.ollamaUrl };
  }
  // 실제 호출될 프로바이더·모델 표시 문자열 — 모델 미입력 시 기본값임을 병기
  _llmLabel(src) {
    var S = src || this._ac(), names = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama' };
    if (!names[S.llmProvider]) return '';
    return names[S.llmProvider] + ' · ' + this._llmModelText(S);
  }
  _llmModelText(src) {
    var S = src || this._ac(), typed = (S.llmModels || {})[S.llmProvider] || '';
    var m = LLM.activeModel(this._llmCfg(S));
    return m ? m + (typed ? '' : ' (기본값)') : '';
  }
  // 사용 가능한 프로바이더 = 키가 저장된 것 (ollama는 키가 없으므로 모델 입력 또는 현재 선택 시 포함)
  _llmProviders() {
    var S = this._ac(), keys = S.llmKeys || {};
    return ['claude', 'openai', 'gemini', 'ollama'].filter(function (p) {
      if (p === 'ollama') return !!(S.llmModels || {}).ollama || S.llmProvider === 'ollama';
      return !!keys[p];
    });
  }
  // 리포트/상세분석의 프로바이더 드롭다운 — 즉시 적용·즉시 저장, 이전 프로바이더의 소견·테스트 상태는 무효화
  _pickLlmProvider(p) {
    var self = this;
    if (!p || p === this._ac().llmProvider) return;
    this.setState({ llmProvider: p, llmConfigured: false, llmTest: null, dxAiText: null });
    this._persistView(['llmProvider'], { llmProvider: p });   // 이 값만 저장 — 설정 탭 미저장 편집 배제
  }
  /* ---- LLM 소견: 상세분석 전 차트의 실측값을 데이터팩으로 묶어 전문가 리포트 생성 ---- */
  // FFT 상위 피크(로컬 최대) N개 — 진폭 내림차순
  _topPeaks(freqs, mags, n) {
    var peaks = [], i;
    for (i = 1; i < freqs.length - 1; i++) if (mags[i] > mags[i - 1] && mags[i] >= mags[i + 1]) peaks.push({ f: freqs[i], m: mags[i] });
    if (!peaks.length && freqs.length) { var mi = 0; for (i = 0; i < mags.length; i++) if (mags[i] > mags[mi]) mi = i; peaks.push({ f: freqs[mi], m: mags[mi] }); }
    peaks.sort(function (a, b) { return b.m - a.m; });
    // 인접 빈 병합 — 잡음 스펙트럼에서 한 성분 주엽 안 이중 최대 방지, 3빈(Hann 주엽 ≈4빈) 이내는 같은 성분
    var resHz = freqs.length > 1 ? (freqs[1] - freqs[0]) : 0;
    var minSep = resHz * 3;
    var merged = [];
    for (i = 0; i < peaks.length; i++) {
      var dup = false;
      for (var j = 0; j < merged.length; j++) {
        if (Math.abs(peaks[i].f - merged[j].f) < minSep) { dup = true; break; } // 이미 더 큰 피크가 잡은 자리
      }
      if (!dup) merged.push(peaks[i]);
      if (merged.length >= (n || 5)) break;
    }
    return merged;
  }
  // 피크 주파수에 근접한 마커(1×/2×/BPFO 등) 라벨 — ±max(1.5Hz, 4%)
  _matchMarker(f, markers) {
    for (var i = 0; i < (markers || []).length; i++) { var r = markers[i].freq; if (r > 0 && Math.abs(f - r) <= Math.max(1.5, r * 0.04)) return markers[i].label; }
    return '';
  }
  // RMS 추세: 롤업 앞1/3 vs 뒤1/3 평균 비교 → 상승/안정/하락 + 변화율
  _trendDir(rollup) {
    if (!rollup || rollup.length < 6) return null;
    var k = Math.max(2, Math.floor(rollup.length / 3));
    function avg(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i].rms; return s / a.length; }
    var first = avg(rollup.slice(0, k)), last = avg(rollup.slice(-k));
    if (!(first > 0)) return null;
    var pct = (last - first) / first * 100;
    return { dir: pct > 10 ? '상승' : pct < -10 ? '하락' : '안정', pct: pct, first: first, last: last };
  }
  // 구조화 근거(Evidence) — 동기/비동기 분류·라벨 지표·결함별 근거 강도(LLM·리포트 공용)
  _evidence(eq, det) {
    var self = this, E = this.E, u = eq.unit;
    // 1× 기준 — 명판 RPM은 동기속도(슬립 미반영)라 실측 피크 우선
    var frNom = eq.rpm / 60, frM = det.frMeas, fr = (frM && frM.f) || frNom;
    var gate = !!(det.quality && det.quality.gate); // 계측 아티팩트 게이트 — 스파이크성 신호면 진단 보류
    var star = function (s) { s = Math.max(0, Math.min(5, Math.round(s))); return '★★★★★'.slice(0, s) + '☆☆☆☆☆'.slice(0, 5 - s); };
    // 1) 피크 동기/비동기 분류 — Welch 평균 스펙트럼 기준(단일 블록 표시 FFT는 충격성 신호서 피크 진폭이 스파이크에 좌우)
    var spec = (det.ordSpec && det.ordSpec.freqs.length) ? det.ordSpec : det.fft;
    var peaks = (spec && spec.freqs.length) ? this._topPeaks(spec.freqs, spec.mags, 6) : [];
    // 동기 판정은 상대 오차 기준(절대 오차면 저차수 헐겁고 고차수 빡빡)
    var ordTol = function (r) { return Math.max(0.01 * r, (spec && spec.res ? spec.res : 1) / (fr || 1)); };
    var cls = function (f) { if (!(fr > 0)) return { o: 0, sync: false, r: 0 }; var o = f / fr, r = Math.round(o); return { o: o, sync: r >= 1 && Math.abs(o - r) <= ordTol(r), r: r }; };
    var syncP = [], asyncP = [];
    peaks.forEach(function (p) { var c = cls(p.f); (c.sync ? syncP : asyncP).push({ f: p.f, o: c.o, r: c.r, m: p.m }); });
    var domO = peaks.length && fr > 0 ? peaks[0].f / fr : 0, domSync = peaks.length ? cls(peaks[0].f).sync : false;
    var domSub = domO > 0.4 && domO < 0.9, subAny = asyncP.some(function (p) { return p.o > 0.4 && p.o < 0.9; });
    var pk = function (a) { return a.map(function (p) { return p.f.toFixed(1) + 'Hz(' + p.o.toFixed(2) + '×)'; }).join(', ') || '없음'; };
    // 비지배 1×·2× 성분 존재 여부 — '동기 피크 없음' 오해 방지
    var peakMag = 0, i0; for (i0 = 0; i0 < (spec ? spec.mags.length : 0); i0++) if (spec.mags[i0] > peakMag) peakMag = spec.mags[i0];
    // 매칭 허용오차 ±1%(최소 1.5빈) — 넓히면 우연 일치 급증
    var sRes = (spec && spec.res) || 1;
    var sResTrue = (spec && spec.resTrue) || sRes;   // 제로패딩 전 = 창 길이가 정하는 실제 분해능(불확도·측대역 판정 근거)
    var magNear = function (f) { if (!(f > 0) || !spec) return 0; var tol = Math.max(1.5 * sRes, f * 0.01), b = 0, i; for (i = 0; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - f) <= tol && spec.mags[i] > b) b = spec.mags[i]; return b; };
    var has1x = magNear(fr) > peakMag * 0.05, has2xE = magNear(2 * fr) > peakMag * 0.05;
    // 동기 피크 표기 — 1×·2× 성분이 있으면 '존재하나 비지배'(미관측과 구분)
    var syncTxt = syncP.length ? pk(syncP) : ((has1x || has2xE) ? '지배 피크 중 없음 · 1×' + (has2xE ? '·2×' : '') + ' 성분은 존재하나 지배적이지 않음' : '관측되지 않음');
    // 2) 대역 분배 — ISO 판정과 같은 방법(대역제한 RMS)·시계열 값, 에너지 비율이라 제곱합 정규화
    var bs = det.bandSet;
    var be = bs ? [bs.one, bs.fault, bs.high, bs.sub] : [0, 0, 0, 0];
    var beE = be.map(function (v) { return v * v; });
    var beT = (beE[0] + beE[1] + beE[2] + beE[3]) || 1;
    var frac = function (i) { return beE[i] / beT; };
    // 3) 충격성 지표 (라벨 구분)
    var kurtW = 0, crestW = 0; (det.indics || []).forEach(function (x) { if (/Kurtosis|커토시스/.test(x.k)) kurtW = parseFloat(x.v) || 0; if (/Crest/.test(x.k)) crestW = parseFloat(x.v) || 0; });
    var bk = det.bandKurt || 0, sk = (det.kurtogram && det.kurtogram.best) ? det.kurtogram.best.sk : 0;
    var crestR = 0; (eq.rollup || []).forEach(function (r) { if (r.crest > crestR) crestR = r.crest; });
    var impulsive = kurtW > 4.5 || bk > 4.5 || sk > 8;
    /* 4) 포락선 ↔ 결함주파수 대조 — 매칭(+하모닉 2개) 없으면 베어링 가점 불가
       미매칭은 반대 증거 아님(열화 말기엔 결함주파수가 흐려짐) */
    var bf = (eq.bearing && eq.bearing.n > 0 && eq.rpm > 0) ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    var bm = det.bearMatch || VC.bearingMatch(det.envQ, bf, fr, det.envelope && det.envelope.res);
    var envLine = !bm.known ? 'BPFO/BPFI/BSF/FTF 미상 (베어링 품번 미지정 — 대조 자체가 불가. 반복 성분이 있어도 베어링 근거로 쓸 수 없음)'
      : bm.hit ? (bm.hit.via === 'sideband'
        // 측대역 채택은 중앙 피크 부재 — '일치'와 다른 문구(더 강한 근거로 오독 방지)
        ? bm.hit.key + '(' + bm.hit.freq.toFixed(1) + ' Hz) 자리의 하모닉·측대역 격자가 배경의 ' + bm.hit.ratio.toFixed(1) + '배 — 선 ' + bm.hit.harm + '개(지배 피크는 서지 않음: 변조된 결함의 전형)'
          // 구름체는 부위 단정 안 함 — 결함 구름체는 레이스 손상 동반
          + (bm.hit.siteUnknown ? ' · 부위 단정 불가(구름체 후보이나 실측 적중이 낮아 레이스 손상 동반 가능)' : '')
        : '포락선 반복이 ' + bm.hit.key + '(' + bm.hit.freq.toFixed(1) + ' Hz)와 일치 — 오차 ' + bm.hit.relPct.toFixed(1) + '% · 하모닉 ' + bm.hit.harm + '개') + (bm.hit.sbValid ? ' · ' + bm.hit.sbValid : '')
        : bm.weak ? bm.weak.key + '(' + bm.weak.freq.toFixed(1) + ' Hz)에 근접하나 하모닉 ' + bm.weak.harm + '개 — 우연 일치와 구분 불가(가점 없음)'
          : '포락선 지배 성분이 결함주파수와 불일치: ' + bm.negatives.join('/') + ' 미지배 — 근거 없음이지 결함 없음이 아님'
            + (bm.cage ? ' · 케이지 통과주파수(FTF ' + bm.cage.freq.toFixed(1) + ' Hz)는 관측되나 정상 베어링에서도 도므로 근거가 아님' : '');
    // 5) 결함별 근거 강도(규칙 기반) — 근거 가점(0~100) 누적 점수화. tags=점수 근거, s=★(0~5)
    var has2x = syncP.some(function (p) { return Math.abs(p.o - 2) < 0.1; });
    var mk = function (f, parts, caveat) { // parts: [[조건, 점수, 태그]…]
      var sc = 0, tags = [], bd = []; parts.forEach(function (p) { if (p[0]) { sc += p[1]; tags.push(p[2]); bd.push(p[2] + ' +' + p[1]); } });
      sc = Math.max(0, Math.min(100, sc));
      // 0점 = 근거 부족 명시(가능성 전무로 오해 방지). breakdown = 가점 내역 · caveat = 확정 제약(예: 베어링 미지정)
      return { f: f, score: sc, s: Math.round(sc / 20), tags: tags, caveat: caveat || '',
        breakdown: bd.length ? bd.join(' · ') + ' = ' + sc : '현재 근거 부족',
        why: (tags.length ? tags.join('·') : '현재 근거 부족') + (caveat ? ' · ' + caveat : '') };
    };
    // 임펄스성 = SK·Kurtosis·Crest 공통의 단일 관측 — 중복 가점 대신 최강 기준 단일항(상한 40)
    var impScore = sk > 20 ? 40 : sk > 8 ? 25 : (kurtW > 10 || bk > 10) ? 18 : (kurtW > 4 || bk > 4 || crestW > 5) ? 12 : 0;
    var impTag = '임펄스성(단일항: SK ' + sk.toFixed(0) + '·Kurt ' + kurtW.toFixed(0) + '·Crest ' + crestW.toFixed(1) + ' 중 최강 기준)';
    // 포락선 반복성 — 반복 충격 존재(무엇의 결함인지는 결함주파수 매칭 필요)
    var eQ = det.envQ, envRep = !!(eQ && eQ.consistent), envTxt = eQ && eQ.f0 > 0 ? eQ.f0.toFixed(1) + 'Hz(' + eQ.order.toFixed(2) + '×)·하모닉 ' + eQ.harm + '개' : '';
    var matched = !!(bm && bm.hit); // 결함주파수 매칭 + 하모닉 2개 — 베어링 가점의 유일한 근거
    // 계측 구성·메타데이터 유무 — 판별 가능성 결정, 후보 정의보다 먼저 선언
    var hasPhase = false, hasAxial = false;            // 단채널 1방향(위상·타코·축방향 없음)
    var meta = eq.meta || {};
    var nVanes = Number(meta.vanes) || 0, hasVanes = nVanes > 0;
    var lineHz = Number(meta.lineHz) || 60, hasLineHz = true; // 전역 설정값(기본 60)
    // 벨트 — 풀리경 둘이면 반대쪽 축 1×(센서가 종동측이면 모터), 벨트 통과주파수는 벨트길이도 필요
    var beltF = meta.drive === 'belt' ? VC.beltFreqs(fr, meta.belt, meta.sensorPos === 'driven') : null;
    var hasBeltSpec = !!beltF, hasBeltLen = !!(beltF && beltF.belt > 0);
    // 차수비 사전 — 오일훨·베인패스·종동축 등 가설 표현용
    var ordHit = function (lo, hi) { return peaks.some(function (p) { return fr > 0 && p.f / fr >= lo && p.f / fr <= hi; }); };
    var domOil = domO >= 0.38 && domO <= 0.48, anyOil = ordHit(0.38, 0.48);
    // 오일훨은 유막 베어링 현상 — 구름베어링 지정 설비는 후보 제외(0.4×대 케이지 귀속 확정), 형식 미지정이면 유지
    var rollingBrg = !!(eq.bearing && eq.bearing.n > 0);
    // 특정 주파수 자신의 하모닉 개수 — 벨트/기어 판정 근거(남의 하모닉 차용 금지). 유의 임계 max(피크 8%, 중앙값 4배)
    var magMed = (function () { var s = (spec && spec.mags ? spec.mags.slice() : []).sort(function (a, b) { return a - b; }); return s.length ? s[Math.floor(s.length / 2)] : 0; })();
    var harmThr = Math.max(peakMag * 0.08, magMed * 4);
    var harmOf = function (f0) {
      if (!(f0 > 0) || !spec || !spec.freqs.length) return 0;
      var cnt = 1;
      for (var h = 2; h <= 4; h++) { if (magNear(h * f0) > harmThr) cnt++; }
      return cnt;
    };
    var domHarm = peaks.length ? harmOf(peaks[0].f) : 0;      // 지배 피크 자신의 하모닉 열
    var subHarm = domSub ? domHarm : 0;
    // 전기적 결함 성분 = 2×계통주파수
    var elecF = 2 * lineHz;
    var elec = peaks.some(function (p) { return Math.abs(p.f - elecF) < Math.max(1.5, elecF * 0.01); });
    // 기어 메시 = 잇수 × 1× — 메시만으론 정상 성분, 결함 근거는 1× 간격 측대역 동반 필요(기어 구동일 때만)
    var isGear = meta.drive === 'gear';
    var meshF = (isGear && nVanes > 0) ? nVanes * fr : 0;
    var meshHit = meshF > 0 ? peaks.filter(function (p) { return Math.abs(p.f - meshF) <= ordTol(nVanes) * fr; })[0] : null;
    // 메시 ±1× 측대역 — 스펙트럼 직접 확인(포락선 측대역과 별개)
    var meshSb = 0;
    if (meshHit && fr > 0) {
      [-1, 1].forEach(function (s) { if (magNear(meshF + s * fr) > harmThr) meshSb++; });
    }
    // 베인 통과 = #날개 × 1× — 날개수 모르면 3× 이상 정수배 관측까지만
    var vaneF = hasVanes ? nVanes * fr : 0;
    var vane = hasVanes
      ? peaks.some(function (p) { return vaneF > 0 && Math.abs(p.f - vaneF) <= ordTol(nVanes) * fr; })
      : peaks.some(function (p) { var o = p.f / fr, r = Math.round(o); return fr > 0 && r >= 3 && Math.abs(o - r) <= ordTol(r); });
    // 벨트 대조 — 반대쪽 축 1×(풀리비)·벨트 통과주파수, fr 기준 절대주파수 비교
    var beltTol = fr > 0 ? ordTol(1) * fr : 0;
    var drivenHit = beltF ? peaks.filter(function (p) { return Math.abs(p.f - beltF.other) <= Math.max(beltTol, beltF.other * 0.02); })[0] : null;
    var beltHit = (beltF && beltF.belt > 0) ? peaks.filter(function (p) { return Math.abs(p.f - beltF.belt) <= Math.max(beltTol, beltF.belt * 0.02); })[0] : null;
    var drivenHarm = drivenHit ? harmOf(drivenHit.f) : 0;
    // 지배 비동기 피크 = 반대쪽 축 1×면 귀속 확정
    var domIsDriven = !!(beltF && peaks.length && !domSync
      && Math.abs(peaks[0].f - beltF.other) <= Math.max(beltTol, beltF.other * 0.02));
    var conf = [
      mk('불평형(Imbalance)', [[domSync && Math.abs(domO - 1) < 0.1, 55, '1× 동기 지배'], [Math.abs(domO - 1) < 0.1 && frac(0) > 0.5, 30, '1× 대역 우세']]),
      mk('정렬불량(Misalignment)', [[has2x, 40, '2× 동기 성분'], [has2x && frac(1) > 0.4, 30, '결함대역 우세']]),
      mk('기계적 풀림(Looseness)', [[domSync && syncP.length >= 3, 55, '정수배 하모닉 다수'], [domSync && syncP.length === 2, 25, '하모닉 일부'], [domSync && subAny, 15, 'subharmonic']], domSync ? '' : '비동기 지배 — 하모닉 근거 약함'),
      mk('베어링(Bearing)', [[matched, 45, bm.hit
        ? (bm.hit.via === 'sideband'
          ? bm.hit.key + ' 측대역 무리(배경의 ' + bm.hit.ratio.toFixed(1) + '배)·선 ' + bm.hit.harm + '개'
          : bm.hit.key + ' 일치(오차 ' + bm.hit.relPct.toFixed(1) + '%)·하모닉 ' + bm.hit.harm + '개')
        : ''],
        [matched && !!(bm.hit && bm.hit.sbValid), 10, bm.hit && bm.hit.sbValid],
        [matched && impScore > 0, Math.min(25, impScore), '임펄스성 보강(매칭 확인 후)']],
        // '반대 증거' 표현 금지 — 지배 피크 불일치일 뿐 결함 없음 아님(열화 말기엔 결함주파수 흐려짐)
        !bm.known ? '베어링 품번 미지정 — 결함주파수 대조 불가라 원리상 귀속 불가'
          : (!matched ? '포락선 지배 성분이 결함주파수와 불일치(' + (bm.weak ? bm.weak.key + ' 근접하나 하모닉 부족' : bm.negatives.join('/') + ' 미지배')
            + ') — 근거 없음이지 결함 없음이 아님'
            + (bm.cage ? ' · 케이지 통과주파수(FTF) 관측 — 정상 베어링에서도 나오므로 근거 아님' : '') : '')),
      /* 벨트·풀리 — 벨트 결함 근거는 벨트 통과주파수뿐(종동축 1× 일치는 아래 독립 회전원 귀속으로만)
         ⚠ mk 인자는 조건과 무관하게 전부 먼저 평가 — 문구도 조건과 같은 것을 확인해야 함(beltHit null 참조 시 리포트 생성 실패) */
      mk('벨트·풀리(Belt)', [[!!beltHit && harmOf(beltHit.f) >= 2, 35, (beltHit && hasBeltLen) ? '벨트 통과주파수 ' + beltF.belt.toFixed(1) + 'Hz 일치 · 하모닉 ' + harmOf(beltHit.f) + '개' : ''],
        [!!beltHit && harmOf(beltHit.f) < 2, 12, '벨트 통과주파수 근처 성분(하모닉 부족)']],
        !hasBeltSpec ? '벨트 제원(풀리경) 미입력 — 벨트주파수 대조 불가'
          : (!hasBeltLen ? '벨트길이 미입력 — 벨트 통과주파수 대조 불가(풀리비로 ' + beltF.otherKo + ' 1×만 대조됨)' : '')),
      // 케이지(FTF) — 구름베어링 d/D 범위상 품번 없이도 0.35~0.45× 구간 판정 가능
      mk('케이지 결함(FTF 추정)', [[domO >= 0.35 && domO <= 0.45, 30, '지배 ' + domO.toFixed(2) + '× — FTF 이론 구간(0.35~0.45×, 품번 무관)'], [!(domO >= 0.35 && domO <= 0.45) && ordHit(0.35, 0.45), 12, '0.35~0.45× 성분 관측']], '확정에는 포락선에서 FTF 하모닉 확인 필요 — 가설'),
      mk('오일 훨(Oil whirl)',
        rollingBrg ? [] : [[domOil, 45, '지배 ' + domO.toFixed(2) + '× — 오일훨 정통 구간(0.38~0.48×)'], [!domOil && anyOil, 15, '0.38~0.48× 성분 관측']],
        rollingBrg ? '구름베어링(' + (this._bearingLabel(eq) || '형식 지정') + ') — 유막 베어링 현상이라 해당 없음'
          : '유막 베어링 여부·기동정지 추적 필요 — 가설'),
      // 독립 회전원 — 비동기 기본파 + 자체 하모닉 열 = 다른 회전원(벨트·기어 종동축·인접 기계)의 1×
      mk('독립 회전원(종동축·인접 기계)', [[!domSync && domHarm >= 3, 40, '비동기 기본파 ' + (peaks.length ? peaks[0].f.toFixed(1) : '?') + 'Hz(' + domO.toFixed(2) + '×)의 자체 하모닉 ' + domHarm + '개 — 독립 회전원 시그니처(≈' + (peaks.length ? Math.round(peaks[0].f * 60) : 0) + ' rpm)'],
        [!domSync && domHarm === 2, 18, '비동기 기본파의 하모닉 2개'],
        // 풀리비 일치 시 귀속 확정
        [domIsDriven, 15, beltF ? '벨트 ' + beltF.otherKo + ' 1× ' + beltF.other.toFixed(1) + 'Hz(풀리비 ' + beltF.ratio.toFixed(2) + ')와 일치 — 귀속 확정' : '']],
        domIsDriven ? '' : '구동 계통도(풀리비·기어비)·인접 기계 배치 확인 필요 — 이 한 장이면 귀속이 닫힘'),
      mk('베인/블레이드 통과(Vane pass)', [[hasVanes && vane, 35, '#날개 ' + nVanes + ' × 1× = ' + vaneF.toFixed(1) + 'Hz 일치'],
        [!hasVanes && vane, 20, '정수배 3× 이상 성분 관측']],
        hasVanes ? '' : '임펠러 날개수 미입력 — #날개×1× 대조 불가라 확정 불능'),
      // 기어 결함 — 측대역이 결정 검사(메시 주파수만으론 정상과 구분 불가)
      mk('기어 메시(Gear mesh)', [
        [!!meshHit && meshSb >= 2, 40, meshF > 0 ? '메시 ' + meshF.toFixed(1) + 'Hz(잇수 ' + nVanes + '×1×) 일치 · 1× 간격 측대역 양측 확인 — 치면 손상 시그니처' : ''],
        [!!meshHit && meshSb === 1, 20, '메시 주파수 일치 · 측대역 한쪽만 — 확정 부족'],
        [!!meshHit && meshSb === 0, 8, '메시 주파수 관측 · 측대역 없음 — 정상 기어에서도 나타나는 성분'],
      ], (isGear && nVanes > 0) ? '' : '기어 구동·잇수 미입력 — 메시 주파수 대조 불가'),
      mk('전기적(Electrical)', [[elec, 20, elecF.toFixed(0) + ' Hz(2×계통 ' + lineHz + 'Hz) 근처 성분 관측']], '확정에는 전원 차단 시 소멸 시험 필요 — 가설'),
    ];
    // 구성상 해당 없는 후보 제외 — 직결 기계의 벨트 후보는 '측정 불가' 아닌 '해당 없음'
    if (meta.drive && meta.drive !== 'belt') conf = conf.filter(function (c) { return !/^벨트·풀리/.test(c.f); });
    // 미설명 성분 — 사전으로 설명 안 된 비동기 피크 표시(동기 하모닉·오일훨 구간·subharmonic·sub-sync 가설 성분은 제외)
    var explained = function (o) {
      var r = Math.round(o);
      return (r >= 1 && Math.abs(o - r) <= ordTol(r)) || (o >= 0.38 && o <= 0.48)
        || (Math.abs(o - 0.5) <= ordTol(1)) || (domSub && Math.abs(o - domO) < 0.02);
    };
    var unexplained = asyncP.filter(function (p) { return !explained(p.o); })
      .map(function (p) { return p.f.toFixed(1) + 'Hz(' + p.o.toFixed(2) + '×)'; });
    /* 판별 가능성은 계측 구성·메타데이터로 결정(①위상·축방향 ②품번·날개수·계통주파수·벨트제원) — 볼 수 없는 후보는 점수 없이 사유 기재 */
    var naIf = function (test, reason) {
      conf.forEach(function (c) {
        if (!test(c)) return;
        c.na = true; c.score = null; c.s = null;
        c.caveat = reason;
        c.breakdown = '측정 불가 — 점수 산정 대상 아님(' + reason + ')';
        c.why = reason + ' — 이 구성·정보로는 볼 수 없음';
      });
    };
    naIf(function (c) { return /^불평형|^정렬불량/.test(c.f) && !(hasPhase && hasAxial); }, '위상·축방향 없이는 원리상 판별 불가');
    naIf(function (c) { return /^베어링/.test(c.f) && !bm.known; }, '베어링 품번 미지정 — BPFO/BPFI/BSF 대조 불가(단, 케이지 FTF는 품번 무관하게 0.35~0.45× 구간 판정이 가능해 별도 후보로 평가함)');
    // 샘플레이트 부족은 미검출 아닌 측정 불가 — 반대 증거로 쓰면 있는 결함을 부정(R7)
    var fsOk = VC.bearingFsOk(eq.fs, bf);
    if (!fsOk && bf) {
      var topBf = Math.max(bf.BPFO || 0, bf.BPFI || 0, bf.BSF || 0);
      naIf(function (c) { return /^베어링/.test(c.f); },
        '샘플레이트 부족 — fs ' + self._num(eq.fs) + ' Hz로는 결함주파수 ' + topBf.toFixed(0) + ' Hz의 포락선 복조 불가(최소 '
          + self._num(Math.round(topBf * VC.BEARING_FS_RATIO)) + ' Hz 필요)');
    }
    naIf(function (c) { return /^베인/.test(c.f) && !hasVanes; }, '임펠러 날개수 미입력 — #날개×1× 대조 불가');
    // 기어는 구동방식=기어 + 잇수 둘 다 필요, 기어 구동 아니면 후보 제외
    naIf(function (c) { return /^기어 메시/.test(c.f) && !(isGear && nVanes > 0); },
      isGear ? '잇수 미입력 — 메시 주파수(잇수×1×) 대조 불가' : '기어 구동 여부 미입력 — 메시 주파수 대조 불가');
    if (meta.drive && meta.drive !== 'gear') conf = conf.filter(function (c) { return !/^기어 메시/.test(c.f); });
    // 벨트 결함은 벨트 통과주파수로만 판별 → 길이 없으면 측정 불가, 벨트 구동 아니면 해당 없음
    naIf(function (c) { return /^벨트·풀리/.test(c.f) && !hasBeltLen; },
      meta.drive && meta.drive !== 'belt' ? '벨트 구동이 아님 — 해당 없음'
        : (!hasBeltSpec ? '벨트 제원(풀리경·벨트길이) 미입력 — 벨트주파수 대조 불가' : '벨트길이 미입력 — 벨트 통과주파수 대조 불가'));
    // 계측 게이트는 전역 상태(R6) — 단발 임펄스가 광대역으로 퍼져 전 피크 진폭이 잠정 → 전 후보 동일 상한(일부만 캡하면 미검증 후보 1위)
    if (gate) {
      conf.forEach(function (c) {
        if (c.na || c.score == null) return;
        if (c.score > GATE_CAP) { c.breakdown += ' → 전역 상한 ' + GATE_CAP + '(계측 게이트)'; c.score = GATE_CAP; }
        c.s = Math.round(c.score / 20);
        // 잠정 표기는 상단 배너 1회(행마다 반복 시 경고 묻힘)
        c.provisional = true;
        c.why = (c.tags.length ? c.tags.join('·') : '현재 근거 부족') + (c.caveat ? ' · ' + c.caveat : '');
      });
    } else {
      conf.forEach(function (c) { if (!c.na && c.score != null) c.why = (c.tags.length ? c.tags.join('·') : '현재 근거 부족') + (c.caveat ? ' · ' + c.caveat : ''); });
    }
    conf.sort(function (a, b) { return (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score); });
    // 6) 텍스트 블록
    var acq = det.acq || {};
    var B = [];
    B.push('■ 취득 조건: 총 창 ' + (det.anaSec || acq.winSec || 0).toFixed(1) + '초 · 블록 ' + (acq.blockSec || 0).toFixed(1) + '초(' + (acq.window || 'Hann') + ' ' + (acq.overlapPct || 50) + '% 중첩) → 분해능 ' + (acq.res || 0).toFixed(2) + ' Hz · 평균 ' + (acq.averages || 1) + '회'
      /* 평균 횟수 평가 — 규격 숫자(8회) 도달이 아닌 '이 설비에서 더 평균 가능했나' 기준
         정상상태 벗어난 구간 포함 시 운전 상태 혼합 → 블록간 변동 작으면 설비 상한, 크면 경고 */
      + (function () {
        var n = acq.averages || 1, sp = (det.ordSpec && det.ordSpec.blockSpread) || 0;
        if (n < 2) return ' — ⚠단일 블록: 충격성 신호에서 어느 스파이크가 걸렸느냐로 진폭이 변합니다';
        if (det.ordSpec && det.ordSpec.trimmed) return ' — 블록간 변동 ×' + sp.toFixed(2) + '으로 정상상태 전제가 흔들려 앞구간만 평균(창 전체를 쓰면 다른 운전 상태가 섞임)';
        if (n >= 8) return '';
        if (sp > 0 && sp < 1.25) return ' — 정상상태(블록간 변동 ×' + sp.toFixed(2) + ') 유지 범위에서의 평균 상한. 더 늘리려면 관측 창을 넓혀야 하는데 이 설비는 그 구간에서 정상상태를 벗어납니다';
        return ' — 평균 8회 미만(측대역·저주파 정밀 진단 기준은 8초 창·0.125 Hz·8평균)';
      })()
      + (acq.isoBlocks ? ' · ISO 판정은 ' + acq.isoBlocks + '블록 에너지 평균' : ''));
    // 실측 회전수 불확도 = 분해능(Δf=1Hz → ±60rpm) — 명판과의 차이가 불확도 안이면 구분 불가
    B.push('■ 회전수: ' + (eq.rpmSrc === 'pulley' || eq.rpmSrc === 'measured' ? self._rpmText(eq) + ' — 모터 ' + eq.rpmMotor + ' RPM' : '명판 ' + eq.rpm + ' RPM') + '(1× ' + frNom.toFixed(1) + ' Hz) · 1× 실측 ' + (frM
      ? frM.f.toFixed(1) + ' ± ' + (frM.tolHz || 0).toFixed(2) + ' Hz (' + Math.round(frM.rpm) + ' ± ' + Math.round(frM.rpmTol || 0) + ' RPM)'
        + (frM.distinct ? ' — 명판과 유의하게 다름, 차수는 실측 기준' : ' — 불확도가 명판과의 차이보다 커서 명판값과 구분 불가(차수 해석 시 이 오차를 감안)')
      : '유의 피크 없음 — 명판 기준 차수(슬립·오차 가능성 유의)'));
    B.push('■ 동기 피크(정수배): ' + syncTxt);
    B.push('■ 비동기 피크(비정수배): ' + pk(asyncP));
    B.push('■ 지배 성분: ' + (domSync ? '동기(정수배)' : '비동기') + ' ' + domO.toFixed(2) + '× · 상위 ' + peaks.length + '개 중 동기 ' + syncP.length + '/비동기 ' + asyncP.length + (domSub ? ' · sub-synchronous 지배' : '') + ((has1x || has2xE) && !syncP.length ? ' (1×·2×는 존재하나 비지배)' : ''));
    B.push('■ 측대역: ' + (eQ && eQ.sb1x ? '포락선에서 1× 간격 측대역 관측(단, 반송파가 결함주파수로 확인돼야 결함 근거가 됨)' : '미검출(주의: 분해능 ' + (sResTrue ? sResTrue.toFixed(2) : '?') + ' Hz라 이보다 좁은 간격은 물리적 부재가 아니라 분해능 한계로 안 보이는 것)') + ' · subharmonic(0.5×류): ' + (subAny ? '있음' : '없음'));
    // 측대역은 반송파가 결함주파수일 때만 근거 — 미상이면 관측까지만(내륜/외륜 미언급)
    B.push('■ 포락선 정량: ' + (eQ && eQ.f0 > 0
      ? '반복주파수 ' + eQ.f0.toFixed(1) + ' Hz(' + eQ.order.toFixed(2) + '×) · 하모닉 ' + eQ.harm + '개 · 1× 측대역 ' + (eQ.sb1x ? '관측' : '미관측')
        + ' → ' + (eQ.consistent ? '일관된 반복 충격은 확인 — 단, 무엇의 결함인지는 결함주파수 매칭이 있어야 말할 수 있음' : '반복성 미확인 — 단발 스파이크와 구분 불가')
      : '유의 반복 성분 없음'));
    B.push('■ 포락선-베어링 대조: ' + envLine);
    B.push('■ Spectral Kurtosis(커토그램): ' + sk.toFixed(1) + (det.kurtogram && det.kurtogram.best ? ' @ ' + (det.kurtogram.best.loHz / 1000).toFixed(1) + '–' + (det.kurtogram.best.hiHz / 1000).toFixed(1) + 'kHz' : ''));
    B.push('■ 대역 분배(속도 RMS · ISO 판정과 동일 방법/시계열 · 에너지 비율): sub(<0.5×) ' + E.fmt(be[3]) + '(' + (frac(3) * 100).toFixed(0) + '%) · 1×대역(0.5~1.5×) ' + E.fmt(be[0]) + '(' + (frac(0) * 100).toFixed(0) + '%) · 결함(1.5~10×) ' + E.fmt(be[1]) + '(' + (frac(1) * 100).toFixed(0) + '%) · 고주파(10×~1kHz) ' + E.fmt(be[2]) + '(' + (frac(2) * 100).toFixed(0) + '%)'
      + (det.parseval ? ' · 검산(허용 3%) ' + (det.parseval.ok ? '통과(제곱합 ' + E.fmt(det.parseval.sumSq) + ' vs 전대역 ' + E.fmt(det.parseval.isoRms) + ', 오차 ' + (det.parseval.relErr * 100).toFixed(1) + '%)' : '⚠실패 — 대역 분해가 전체와 불일치, 아래 비율 해석 금지') : ''));
    B.push('■ 충격성(상관 지표 — 셋은 같은 관측의 세 표현이며 점수엔 단일항 반영): 파형 Kurtosis ' + kurtW.toFixed(1) + ' · Band Kurtosis ' + bk.toFixed(1) + ' · Spectral Kurtosis ' + sk.toFixed(1) + ' · 파형 Crest ' + crestW.toFixed(1) + ' · 롤업 최대 Crest ' + crestR.toFixed(1));
    if (gate) B.push('■ ⚠계측 게이트(전역): 극단 Crest/첨도 — 단발 스파이크(ESD·케이블·접촉) 시그니처와 구분 불가. 시간영역 임펄스는 주파수영역에서 광대역으로 퍼지므로 모든 스펙트럼 피크 진폭도 잠정입니다. 결함 진단 보류, 센서·케이블·마운팅 검증 우선');
    // 미입력 메타데이터와 그로 인해 무효화되는 판정 목록
    var missing = [];
    if (!bf) missing.push('베어링 품번(→ BPFO/BPFI/BSF/FTF 대조 불가)');
    if (!det.mount) missing.push('마운팅 방식(→ ' + (det.kurtogram && det.kurtogram.best && det.kurtogram.best.loHz > 2000 ? (det.kurtogram.best.loHz / 1000).toFixed(1) + ' kHz 대역 분석이 자석 마운트면 무효' : '고주파 대역 유효성 미상') + ')');
    missing.push('계측 방향(H/V/A)·위상(→ 불평형·정렬·굽음 판별 불가)');
    if (!meta.drive) missing.push('구동방식(직결/벨트/기어 → 비동기 성분 귀속 불가)');
    else if (meta.drive === 'belt' && !hasBeltLen) missing.push('벨트길이(→ 벨트 통과주파수 대조 불가)');
    if (!hasVanes) missing.push('날개수(→ 베인 통과 확정 불가)');
    B.push(missing.length ? '■ 미입력 메타데이터와 그 영향: ' + missing.join(' · ') : '■ 메타데이터: 필요한 항목 입력 완료 — 위 판정은 계측 구성 한계(단채널·위상 없음)만 남습니다');
    // 결함 대역 탐색 상한 명시 — 상한 = min(마운팅, 에일리어싱, AA 롤오프)
    if (det.kgFmax > 0 || det.mountFmax > 0 || det.aliasFmax > 0) {
      var _cap = [];
      if (det.mountFmax > 0) _cap.push('마운팅(' + det.mount + ') ' + (det.mountFmax / 1000).toFixed(1) + ' kHz');
      if (det.aliasFmax > 0) _cap.push('에일리어싱 의심(f_eff가 Nyquist의 ' + Math.round(det.accelNyqFrac * 100) + '%) ' + (det.aliasFmax / 1000).toFixed(1) + ' kHz');
      if (det.rollFmax > 0) _cap.push('AA 롤오프(Nyquist의 ' + Math.round(VC.KG_NYQ_FRAC * 100) + '%) ' + (det.rollFmax / 1000).toFixed(1) + ' kHz');
      var _capKo = { mount: '마운팅', alias: '에일리어싱', rolloff: 'AA 롤오프' }[det.kgCapSrc];
      B.push('■ 결함 대역 탐색 상한: ' + (_cap.join(' · ') || '없음')
        + (det.kgFmax > 0 ? ' → 적용 ' + (det.kgFmax / 1000).toFixed(1) + ' kHz' + (_capKo ? '(' + _capKo + ' 기준)' : '') : '')
        + (det.kgCapped ? ' · 그 위 대역은 탐색에서 제외' : ' · 샘플링 상 제외된 대역 없음')
        + (det.kurtogram && det.kurtogram.best ? ' · 선택 대역 ' + (det.kurtogram.best.loHz / 1000).toFixed(1) + '–' + (det.kurtogram.best.hiHz / 1000).toFixed(1) + ' kHz' : ''));
    }
    // 대역 베이스라인 이탈 — ISO 대역 분배(10–1000 Hz)에 없는 상한 위 대역 변화도 리포트에 표시
    var bnow = (this._bandNow || {})[eq.table + ':' + eq.name], bbls = this._bandBaselines(eq);
    var softM = {};
    this._softBands(eq).forEach(function (k) { softM[k] = 1; });
    var bandDev = null;
    if (bnow && bbls) {
      bandDev = [];
      VC.BAND_ORDER.forEach(function (bn) {
        var v = bnow[bn], b = bbls[bn], lim = b ? VC.baselineLimit(b) : 0;
        if (!(v > 0) || !(lim > 0)) return;   // 학습 없음·측정 불가 대역은 비교 제외
        bandDev.push({ k: bn, ko: VC.BAND_KO[bn] || bn, v: v, lim: lim, r: v / lim, soft: !!softM[bn] });
      });
    }
    if (bandDev && bandDev.length) {
      var _dOver = bandDev.filter(function (d) { return d.r > 1; });
      B.push('■ 대역 베이스라인 이탈(학습된 한계 대비 비율 · 알람과 같은 값): '
        + (_dOver.length
          ? _dOver.map(function (d) { return d.ko + ' ×' + d.r.toFixed(2) + (d.soft ? '⚠상한 초과 — 잠정' : ''); }).join(' · ')
            + ' · 나머지 ' + (bandDev.length - _dOver.length) + '개 대역 정상'
          : '전 ' + bandDev.length + '개 대역 정상(최대 ×'
            + bandDev.reduce(function (a, d) { return Math.max(a, d.r); }, 0).toFixed(2) + ')')
        + (_dOver.some(function (d) { return d.soft; })
          ? ' — 잠정 대역은 결함 대역 탐색에서 제외된 구간이다. 상승은 사실이나 설비 진동인지 센서 부착부 공진인지 구분할 수 없으므로, 결함으로 단정하지 말고 센서 부착 상태 확인을 먼저 권고할 것'
          : ''));
    } else {
      B.push('■ 대역 베이스라인 이탈: 비교 불가(' + (!bnow ? '대역 추출 미사용 또는 적재값 없음' : '대역 베이스라인 미학습') + ') — 대역별 변화는 이 리포트의 근거가 아니다');
    }
    // 음성 소견(R4) — '찾았으나 없음'도 보고 대상
    var negatives = [];
    if (bm.known && !bm.hit) negatives.push('베어링 결함주파수 ' + bm.negatives.join('/') + ' 미검출' + (bm.weak ? '(' + bm.weak.key + ' 근접하나 하모닉 ' + bm.weak.harm + '개로 부족)' : ''));
    if (!syncP.length) negatives.push('지배 피크 중 정수배 동기 성분 없음');
    if (!subAny) negatives.push('0.5× subharmonic 미검출');
    if (!eQ || !eQ.sb1x) negatives.push('포락선 1× 측대역 미검출(단, 분해능 ' + (sResTrue || 0).toFixed(2) + ' Hz 한계 내 — 이보다 좁은 간격은 원리상 관측 불가)');
    else if (!(bm && bm.hit)) negatives.push('측대역은 관측되나 반송파가 결함주파수로 확인되지 않아 결함 귀속 불가');
    if (!elec) negatives.push('100/120 Hz(2×계통주파수) 근처 성분 미검출 — 전기적 결함 정황 없음(전원 차단 시험으로 확정)');
    if (!vane) negatives.push('3× 이상 정수배 성분 미검출 — 베인/블레이드 통과 정황 없음');
    // 기어 '메시 있음·측대역 없음'은 정상 기어 소견
    if (meshF > 0 && !meshHit) negatives.push('기어 메시 ' + meshF.toFixed(0) + ' Hz(잇수 ' + nVanes + '×1×) 미검출');
    else if (meshHit && meshSb === 0) negatives.push('기어 메시는 관측되나 1× 간격 측대역 없음 — 정상 기어 범위(치면 손상 정황 없음)');
    if (negatives.length) B.push('■ 음성 소견(찾았으나 없음 — 반대 증거): ' + negatives.join(' · '));
    if (unexplained.length) B.push('■ 미설명 성분(사전으로 설명되지 않음 — 삭제하지 않고 남김): ' + unexplained.join(', ') + ' — 구동 계통도(풀리비·기어비)·인접 기계·유막 확인 시 대부분 해소');
    var confLines = conf.map(function (c) {
      return '■ ' + c.f + ' ' + (c.na ? '측정 불가 — 점수 없음(' + (c.caveat || '판별 조건 미충족') + ')' : star(c.s) + ' · 근거점수 ' + c.score + '/100 [' + c.breakdown + ']' + (c.caveat ? ' · ' + c.caveat : ''));
    });
    var unmeasurable = conf.filter(function (c) { return c.na; }).map(function (c) { return c.f; });
    // 1순위 점수가 채택 기준 미달이면 weakTop 표시 — 점수 순 표의 맨 위를 원인 지목으로 오독 방지
    var _scored = conf.filter(function (c) { return !c.na && c.score != null; });
    return { block: B.join('\n'), confLines: confLines.join('\n'), conf: conf, top: conf[0], impulsive: impulsive,
      weakTop: !(_scored.length && _scored[0].score >= VC.EVID_ADOPT),
      hasBearing: !!bf, domSync: domSync, gate: gate, frMeas: frM,
      // bandDev는 프롬프트·HTML 공용(리포트 문서에도 표시)
      bandDev: bandDev, mountFmax: det.mountFmax || 0, mount: det.mount || '',
      negatives: negatives, unmeasurable: unmeasurable, unexplained: unexplained, missing: missing, acq: acq };
  }
  // 첨도 포화 판정(첨도 추이+RMS 추이) — 화면 경고·LLM 소견·리포트 공용
  _kurtSat(eq) {
    var rf = this._rollFor(eq), tr = this._trends(eq, rf.roll);
    if (!tr || !tr.kurt || tr.kurt.length < 6) return { flag: false };
    // 관측 구간 전달 — 첨도 비단조성(말기 확산)은 주·월 단위 추세에서만 성립
    var rl = rf.roll || [], spanMin = rl.length > 1 ? (rl[rl.length - 1].ms - rl[0].ms) / 60000 : 0;
    return VC.kurtosisSaturation(tr.kurt, rl.map(function (r) { return r.rms; }), spanMin);
  }
  _opinionPack(eq, det, sat) {
    var self = this, E = this.E, fr = eq.rpm / 60, u = eq.unit, L = [];
    L.push('[설비] ' + (eq.alias || eq.name) + ' (' + eq.name + ') · ' + self._rpmText(eq) + ' (1×=' + fr.toFixed(1) + ' Hz, 2×=' + (2 * fr).toFixed(1) + ' Hz) · ISO Class ' + eq.cls + ' · 단위 ' + u);
    var bf = (eq.bearing && eq.bearing.n > 0 && eq.rpm > 0) ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    L.push('[베어링] ' + (bf ? this._bearingLabel(eq) + ' · BPFO ' + bf.BPFO.toFixed(1) + ' / BPFI ' + bf.BPFI.toFixed(1) + ' / BSF ' + bf.BSF.toFixed(1) + ' / FTF ' + bf.FTF.toFixed(1) + ' Hz' : '미지정 (결함 주파수 대조 불가)'));
    // ISO 규격 판정(10–1000 Hz 대역제한 속도 RMS)과 실시간 감시(광대역 1초 RMS)는 다른 물리량 — 분리 표기
    var isoOk = det.isoRms != null && u === 'mm/s';
    if (isoOk) {
      var isoG = VC.gradeFor(det.isoRms, eq.zones);
      // R10: 경계 여유 < 측정 불확도(±10%)면 존 단정 안 함
      var nearZ = null;
      eq.zones.forEach(function (z, zi) { if (Math.abs(det.isoRms - z) / z < 0.10) nearZ = ['A/B', 'B/C', 'C/D'][zi]; });
      L.push('[ISO 10816 판정 — 규격 기준] 대역제한(10–1000 Hz) 속도 RMS ' + E.fmt(det.isoRms) + ' mm/s(' + (det.isoBlocks || 1) + '블록 에너지 평균 · 총 ' + (det.anaSec ? det.anaSec.toFixed(1) : '?') + '초' + (Math.round((det.isoSpread || 1) * 100) / 100 >= 1.5 ? ' · ⚠블록간 변동 ×' + det.isoSpread.toFixed(2) + ' — 정상상태 전제 미충족, 존 판정 잠정' : ' · 블록간 변동 ×' + (det.isoSpread || 1).toFixed(2)) + ') → Zone ' + ['A(양호)', 'B(주의)', 'C(위험)', 'D(심각)'][isoG] + ' · 존 경계 A/B ' + E.fmt(eq.zones[0]) + ', B/C ' + E.fmt(eq.zones[1]) + ', C/D ' + E.fmt(eq.zones[2]) + ' — ISO 상태 판정은 이 값으로 하세요'
        + (nearZ ? ' ⚠' + nearZ + ' 경계 대비 여유 10% 미만 — 불확도 안이라 존을 단정하지 말고 "경계 근접"으로 쓰고 정상상태 다중 평균 재측정을 권하세요' : ''));
      // 감시 등급 출처 명시 — 등급은 결함주파수 격자가 켜고 ISO가 높이 결정(옆 RMS를 등급 근거로 오독 방지)
      L.push('[실시간 감시 — 알람 기준(규격 판정 아님)] 감시 등급 ' + E.STATUS[eq.grade].ko
        + ' — 등급은 결함주파수 격자가 켤 때만 오르고 ISO 값이 그 높이를 정합니다. 아래 광대역 RMS는 등급을 만든 값이 아닙니다'
        + ' · 참고 광대역 최신 1초 RMS ' + E.fmt(eq.rms) + ' ' + u + '(고주파 포함이라 ISO 값보다 클 수 있음)');
    } else {
      L.push('[현재 심각도] 등급 ' + E.STATUS[eq.grade].ko
        + ' — 등급은 결함주파수 격자가 켤 때만 오르고 ISO 존이 그 높이를 정합니다. 아래 RMS는 등급을 만든 값이 아닙니다'
        + ' · 참고 최신 1초 RMS ' + E.fmt(eq.rms) + ' ' + u + ' · 존 경계 A/B ' + E.fmt(eq.zones[0]) + ', B/C ' + E.fmt(eq.zones[1]) + ', C/D ' + E.fmt(eq.zones[2]) + ' ' + u);
    }
    if (det.levels) {
      // 가속도 f_eff가 물리 상한 초과 시 값 미게재 — 미분 이득이 고주파 양자화 잡음 증폭(검산 실패 명시)
      var accTxt = det.levelsOk === false
        ? '게재 보류 — 가속도 에너지 중심 f_eff ' + (det.accelFeff / 1000).toFixed(1) + ' kHz = Nyquist의 ' + (det.accelNyqFrac * 100).toFixed(0) + '%'
          + (det.levels['g'] > det.accelBound ? ' · 대역분포 상한(' + E.fmt(det.accelBound) + ' g) 초과' : '')
          + ' — 안티에일리어싱 필터 부재 시 센서 공진 폴딩 또는 미분 증폭 양자화 잡음. 계측 구성 확인 전까지 가속도 값 사용 금지'
        : E.fmt(det.levels['g']) + ' g(광대역 변환값 · 에너지 중심 ' + (det.accelFeff / 1000).toFixed(1) + ' kHz = Nyquist의 ' + (det.accelNyqFrac * 100).toFixed(0) + '%)';
      L.push('[종합 레벨(물리량별 RMS) — 방향 참고용] 가속도 ' + accTxt + ' · 속도 ' + E.fmt(det.levels['mm/s']) + ' mm/s(광대역 — ISO 판정은 위 [ISO 10816 판정]의 대역제한 값 사용) · 변위 ' + E.fmt(det.levels['μm']) + ' μm(저주파 — 사실상 1× 성분 지배) — 단위가 달라 값 크기 비교 불가');
    }
    var ev = this._evidence(eq, det);
    L.push('[EVIDENCE — 구조화 근거 (아래 분류를 그대로 근거로 사용하세요)]\n' + ev.block);
    L.push('[결함 근거 강도 — 규칙 기반 자동 산출 (근거점수=Evidence Score 0~100, 확률 아님. [] 안은 가점 내역. ★ 높은 순 = 우선순위. 임의 %를 만들지 말고 이 점수·순위를 근거로 설명하세요)]\n' + ev.confLines);
    if (sat && sat.flag) L.push('[⚠첨도 포화 주의] ' + sat.msg);
    if (det.spectral && det.spectral.notes.length) L.push('[스펙트럼 패턴(하모닉·측대역)] ' + det.spectral.notes.join(' · '));
    if (det.envelope && (det.envelope.hint || det.envelope.fault)) L.push('[포락선] ' + (det.envelope.fault ? '결함 의심 — ' : '') + (det.envelope.hint || ''));
    if (det.cepstrum && det.cepstrum.note) L.push('[켑스트럼] ' + det.cepstrum.note);
    var tr = this._trendDir(eq.rollup);
    if (tr) {
      var _rl = eq.rollup || [], _durMin = _rl.length > 1 ? Math.round((_rl[_rl.length - 1].ms - _rl[0].ms) / 60000) : 0;
      var _rlv = _rl.map(function (r) { return r.rms; }), _avg = _rlv.length ? _rlv.reduce(function (a, b) { return a + b; }, 0) / _rlv.length : 0, _mx = _rlv.length ? Math.max.apply(null, _rlv) : 0;
      L.push('[RMS 추세] ' + tr.dir + ' (' + (tr.pct >= 0 ? '+' : '') + tr.pct.toFixed(0) + '% · ' + E.fmt(tr.first) + '→' + E.fmt(tr.last) + ' ' + u + ') · 평균 RMS(롤업) ' + E.fmt(_avg) + ' · 최대 RMS ' + E.fmt(_mx) + ' ' + u + ' · 관측 ' + _durMin + '분' + (_durMin < 60 ? ' (짧아 장기 추세 단정 불가)' : ''));
    }
    if (det.quality && !det.quality.ok) L.push('[⚠신호 품질] ' + det.quality.issues.filter(function (x) { return !x.info; }).map(function (x) { return x.label; }).join(', ') + ' 감지 — 측정 신뢰도 저하, 아래 판정은 신중히 해석할 것');
    return L.join('\n');
  }
  // 소견 프롬프트 — 판정은 결정론 엔진 완료, LLM은 서술만. 엔진 상태값(gate/iso/monitor/negative/unmeasurable/unexplained/window)이 규칙 근거
  _opinionPrompt(eq, det, dx, sat) {
    var E = this.E, ev = this._evidence(eq, det);
    var rl = eq.rollup || [], winMin = rl.length > 1 ? Math.round((rl[rl.length - 1].ms - rl[0].ms) / 60000) : 0;
    var isoOk = det.isoRms != null && eq.unit === 'mm/s';
    var isoZone = isoOk ? ['A(양호)', 'B(주의)', 'C(위험)', 'D(심각)'][VC.gradeFor(det.isoRms, eq.zones)] : '-';
    var S = [];
    S.push('[엔진 판정 상태 — 이 값들은 이미 결정된 결과입니다. 재해석·재계산하지 말고 그대로 인용하세요]');
    S.push('· gate.tripped = ' + (ev.gate ? 'true' : 'false') + (ev.gate ? ' · 사유: 극단 Crest/첨도 — 단발 스파이크 시그니처와 구분 불가(전역 적용)' : ''));
    S.push('· iso = ' + (isoOk ? E.fmt(det.isoRms) + ' mm/s → Zone ' + isoZone + ' (10–1000 Hz 대역제한 속도 RMS · ' + (det.isoBlocks || 1) + '블록 에너지 평균 · 총 ' + (det.anaSec || 0).toFixed(1) + '초 · 블록간 변동 ×' + (det.isoSpread || 1).toFixed(2) + ')' : '산정 불가(센서 단위가 속도가 아님)'));
    S.push('· monitor = 감시 등급 ' + E.STATUS[eq.grade].ko + ' (결함 패턴이 켜고 ISO가 높이를 정함) · 참고 광대역 최신 1초 RMS ' + E.fmt(eq.rms) + ' ' + eq.unit);
    S.push('· window.minutes = ' + winMin + ' (이 창을 넘는 시간 스케일 주장 금지)');
    S.push('· negative[] = ' + (ev.negatives && ev.negatives.length ? ev.negatives.join(' | ') : '없음'));
    S.push('· unmeasurable[] = ' + (ev.unmeasurable && ev.unmeasurable.length ? ev.unmeasurable.join(', ') : '없음'));
    S.push('· unexplained[] = ' + (ev.unexplained && ev.unexplained.length ? ev.unexplained.join(', ') : '없음'));
    S.push('· missing_metadata[] = ' + (ev.missing && ev.missing.length ? ev.missing.join(' | ') : '없음'));
    return '당신은 40년 경력의 설비 진동 분석 기술자입니다.\n'
      + '아래 측정 데이터와 엔진 판정 결과만 근거로 한국어 소견을 작성하세요.\n'
      + '검산·결함주파수 매칭·계측 게이트 판정은 엔진이 이미 끝냈습니다. 당신은 그 결과를 규율 있게 서술합니다.\n\n'
      + '[지켜야 할 규칙]\n'
      + '1) 주어진 값만 인용한다. 결함주파수·회전수·대역값을 새로 만들지 않는다. 계산하지 말고 엔진이 준 숫자를 그대로 쓴다.\n'
      + '2) 엔진의 근거점수와 순위를 재해석하거나 뒤집지 않는다. 그대로 인용한다(근거점수는 0~100 Evidence Score이며 확률이 아니다).\n'
      + '3) gate.tripped=true면 확정형 결론을 쓰지 않는다. "~일 가능성이 가장 높습니다" 금지. "계측 검증 전까지 잠정"으로 맺는다.\n'
      + '4) ISO 판정 등급(iso)과 실시간 감시 등급(monitor)을 반드시 구분해서 쓴다. 두 값을 한 문장에 섞지 않는다. 두 등급이 다르면 "규격 판정 X / 감시 등급 Y — 광대역 고주파 성분 차이"로 한 줄 설명한다.\n'
      + '5) negative[] 목록을 반드시 한 줄 이상 인쇄한다. "찾았으나 없었다"는 보고할 결과다. 생략하지 않는다.\n'
      + '6) unmeasurable[] 항목은 "측정 불가"로만 쓴다. 점수·별점·"근거 부족"·"가능성 낮음" 같은 표현을 쓰지 않는다. 원리상 판별할 수 없는 것이다.\n'
      + '7) unexplained[] 성분을 목록에서 빼지 않는다. "미설명"으로 남기고, 무엇이 있으면 닫히는지(구동 계통도 등)를 적는다.\n'
      + '8) window.minutes를 넘는 시간 스케일을 주장하지 않는다. 창이 60분 미만이면 "말기", "열화 진행", "수개월 내" 같은 표현을 쓰지 않고 "관측 창이 짧아 추세 판단 불가"로 쓴다.\n'
      + '9) 등급을 부풀리지 않는다. 평균이 양호한데 순간값으로 "위험"이라 쓰지 않는다. 조치는 등급에 맞춘다 — "즉시 정지"로 단정하지 말고(정지는 설비 중요도·추가 증상 고려), 위험 등급은 "조기·우선순위 높은 점검", 심각 등급은 "긴급 점검 · 중요도에 따라 정지 여부 검토"로 쓴다.\n'
      + '10) missing_metadata[]가 있으면 [권장 조치]에 "이 항목을 채우면 무엇이 닫히는지"를 한 줄로 적는다.\n'
      + '11) "대역 베이스라인 이탈"에 ⚠상한 초과(잠정) 표시가 있으면, 그 대역의 상승을 결함 근거로 단정하지 않는다. '
        + '상승 사실은 반드시 인쇄하되(빼면 센서 부착 불량도 초기 결함도 보고되지 않는다) "설비 진동인지 센서 부착부 공진인지 구분 불가"로 쓰고, '
        + '[권장 조치] 첫 줄을 "센서 부착 상태 확인"으로 둔다.\n\n'
      + '[출력 형식]\n'
      + '다음 6개 섹션을 순서대로, 각각 "## 소제목" 한 줄로 시작해 작성하세요:\n'
      + '## 진동 상태 요약\n## 시간영역 지표 해석\n## 주파수 분석\n## 결함 메커니즘 추정\n## 추세 및 예후\n## 권장 조치\n'
      + '· 각 섹션 3~5개 불릿(•), 불릿 하나는 한 문장. "→ 결론" 화살표로 판단을 맺는다.\n'
      + '· [결함 메커니즘 추정]은 엔진 순위대로 쓰되 "각 순위를 반드시 별도 줄로" 쓴다(한 줄 몰아쓰기·" / " 구분 금지).\n'
      + '  아래는 형식 예시일 뿐이며 <> 자리에는 반드시 [결함 근거 강도]의 실제 값을 넣는다(예시 숫자를 그대로 쓰지 말 것):\n'
      + '  1. <후보명> (<점수>점, <별>) — <그 후보의 가점 내역에 적힌 근거>\n  2. <후보명> (<점수>점, <별>) — <근거>\n'
      + '· ★는 엔진이 준 별 개수를 그대로 복사한다. 측정 불가 항목은 점수·별 대신 "측정 불가"로 쓰고, 사유는 데이터에 적힌 그 항목의 사유를 그대로 인용한다(위상·축방향 / 베어링 품번 미지정 / 날개수 미입력 등 — 임의로 바꾸지 말 것).\n'
      + '· [권장 조치] 맨 끝에 "핵심 요약:" 2~3문장 한 문단 — (가장 근거점수 높은 후보와 그 근거) + (무엇 때문에 확정 불가) + (다음 단계). gate.tripped=true면 이 문단도 잠정형으로 맺는다.\n\n'
      + '말투: 결론 먼저, 숫자로 말한다. 수식어를 줄이고 단정형으로 쓴다. 과장·감탄을 쓰지 않는다. 한자·중국어를 쓰지 않는다.\n\n'
      + S.join('\n') + '\n\n'
      + '규칙 기반 1차 판정: ' + dx.verdict + '\n\n[측정 데이터]\n' + this._opinionPack(eq, det, sat);
  }
  // "## 소제목" 기준으로 섹션 분리 → [{heading, body}]
  _parseOpinion(text) {
    if (!text) return [];
    var sections = [], cur = null;
    String(text).split('\n').forEach(function (ln) {
      var m = ln.match(/^\s*#{1,3}\s+(.*)/);
      if (m) { cur = { heading: m[1].trim(), body: '' }; sections.push(cur); }
      else if (cur) { cur.body += (cur.body ? '\n' : '') + ln; }
      else if (ln.trim()) { cur = { heading: '', body: ln }; sections.push(cur); }
    });
    sections.forEach(function (s) { s.body = s.body.replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n'); });
    return sections.filter(function (s) { return s.heading || s.body.trim(); });
  }
  _dxExplain(eq) {
    var self = this; this.setState({ dxAiText: '__loading__' });
    var llm = LLM.createLLM(this._llmCfg());
    if (!llm) { setTimeout(function () { self.setState({ dxAiText: '__fallback__' }); }, 300); return; }
    var det = this._detail(eq);
    // 1차 판정은 화면 문구와 동일해야 함 — 지표(_m) 전달 필수
    var _m = VC.sevMetrics(this._rollFor(eq).roll, { zones: eq.zones, fs: eq.fs, gate: !!VC.gateReason(det.quality, null) });
    var dx = this._dx(eq, det, _m);
    var p = this._opinionPrompt(eq, det, dx, this._kurtSat(eq));
    llm.complete(p).then(function (txt) { self.setState({ dxAiText: txt || '__fallback__' }); })
      .catch(function (e) { console.warn('[vibe] llm opinion failed', e); self.setState({ dxAiText: '__fallback__' }); self._toast('LLM 소견 생성 실패: ' + (e.message || e), 'err'); });
  }
  _win() {
    if (this.state.period === 'custom') {
      var f = CH.parseDT(this.state.from), t = CH.parseDT(this.state.to);
      if (!isNaN(f) && !isNaN(t) && t > f) return Math.min(720, Math.max(24, Math.round((t - f) / 3600000)));
      return 720;
    }
    return PERIOD_H[this.state.period] || 168;
  }
  _draw() { if (!this.state.ready) return; if (this.state.tab === 'detail') this._drawDetail(); }
  _drawDetail() {
    var E = this.E, self = this, eq = this._activeEq(this.state.selTag); if (!eq) return; var CC = this.cc();
    var det = this._detail(eq), rf = this._rollFor(eq), roll = rf.roll, useClock = rf.clock;
    var xL = roll.map(function (r) { return useClock ? E.fmtClock(r.ms) : E.fmtMD(r.ms); });
    var xT = roll.map(function (r) { return E.fmtDT(r.ms); });
    var rmsV = roll.map(function (r) { return r.rms; }), p2pV = roll.map(function (r) { return r.p2p; }), crV = roll.map(function (r) { return r.crest; });
    var tMs = roll.map(function (r) { return r.ms; });
    // 추세 x축 범위 — 전체 보기면 조회 기간(앞 빈 구간은 _xFrom0로 당김), 줌 중이면 그 구간. kWin도 같은 시작 사용(롤업·청크 차트 축 일치)
    var xF0 = this._xFrom0(roll, rf.fromMs);
    var xWin = function (s, e) {
      var full = s === 0 && e >= roll.length;
      return { xFrom: (full && xF0) ? xF0 : tMs[s], xTo: (full && rf.toMs) ? rf.toMs : tMs[Math.max(s, e - 1)] };
    };
    var C = function (id) { return document.getElementById(id); };
    // 확대 구간 승계 키 — 태그·기간·기준시각·표시 물리량 불변이면 재그리기에도 확대 유지
    var zk = [eq.id, this._detailKey()].join('|');
    var wave = C('vc-wave');
    if (wave && det.raw.values.length) {
      var wl = det.raw.times_ms.map(function (m) { return m.toFixed(0); }), wt = det.raw.times_ms.map(function (m) { return m.toFixed(1) + ' ms'; });
      var dw = function (s, e) { var r = E.drawLine(wave, { values: det.raw.values.slice(s, e), xLabels: wl.slice(s, e), tipLabels: wt.slice(s, e), color: E.SERIES.wave, height: 240, lw: 1.1, unit: det.dispUnit }, CC); if (r) E.addTip(wave, C('vt-wave'), C('vx-wave'), r.pts); };
      E.zoomDraw(wave, det.raw.values.length, dw, zk);
    }
    var rms = C('vc-rms');
    if (rms && rmsV.length) {
      var refs = [{ val: eq.zones[0], color: '#3aa76d', label: 'A/B ' + E.fmt(eq.zones[0]) }, { val: eq.zones[1], color: '#d99a2b', label: 'B/C ' + E.fmt(eq.zones[1]) }, { val: eq.zones[2], color: '#e07b39', label: 'C/D ' + E.fmt(eq.zones[2]) }];
      var dr = function (s, e) { var w = xWin(s, e); var r = E.drawLine(rms, { values: rmsV.slice(s, e), times: tMs.slice(s, e), xFrom: w.xFrom, xTo: w.xTo, xLabels: xL.slice(s, e), tipLabels: xT.slice(s, e), color: E.SERIES.rms, height: 230, smooth: true, refLines: refs, unit: eq.unit }, CC); if (r) E.addTip(rms, C('vt-rms'), null, r.pts); };
      E.zoomDraw(rms, roll.length, dr, zk);
    }
    var p2p = C('vc-p2p');
    if (p2p && p2pV.length) {
      var dp = function (s, e) { var w = xWin(s, e); var r = E.drawLine(p2p, { values: p2pV.slice(s, e), times: tMs.slice(s, e), xFrom: w.xFrom, xTo: w.xTo, xLabels: xL.slice(s, e), tipLabels: xT.slice(s, e), color: E.SERIES.p2p, height: 220, smooth: true, zeroBase: true }, CC); if (r) E.addTip(p2p, C('vt-p2p'), null, r.pts); };
      E.zoomDraw(p2p, roll.length, dp, zk);
    }
    var crest = C('vc-crest');
    if (crest && crV.length) {
      var cref = [{ val: 3, color: '#8a8d99', label: 'CF=3' }, { val: 6, color: '#e07b39', label: 'CF=6' }];
      var dcf = function (s, e) { var w = xWin(s, e); var r = E.drawLine(crest, { values: crV.slice(s, e), times: tMs.slice(s, e), xFrom: w.xFrom, xTo: w.xTo, xLabels: xL.slice(s, e), tipLabels: xT.slice(s, e), color: E.SERIES.crest, height: 220, smooth: true, refLines: cref }, CC); if (r) E.addTip(crest, C('vt-crest'), null, r.pts); };
      E.zoomDraw(crest, roll.length, dcf, zk);
    }
    var fft = C('vc-fft');
    if (fft && det.fft.freqs.length) {
      // 전대역 토글 — 기본 dispHz까지, 켜면 Nyquist까지(데이터는 전대역이라 재조회 없음)
      var fLen = det.fft.freqs.length, dispEnd = fLen;
      if (!this.state.fftFull && det.fft.dispHz > 0) {
        for (var _i = 0; _i < fLen; _i++) { if (det.fft.freqs[_i] > det.fft.dispHz) { dispEnd = _i; break; } }
      }
      var df = function (s, e) { var r = E.drawFFT(fft, { freqs: det.fft.freqs.slice(s, e), mags: det.fft.mags.slice(s, e), markers: det.fft.markers, res: det.fft.res, height: 280, hideMarkerLabels: true }, CC); if (r) E.addTip(fft, C('vt-fft'), null, r.pts); };
      E.zoomDraw(fft, dispEnd, df, zk);
    }
    var kgc = C('vc-kurtogram');
    if (kgc && det.kurtogram && det.kurtogram.freqs.length) {
      E.drawFFT(kgc, { freqs: det.kurtogram.freqs, mags: det.kurtogram.mags, markers: det.kurtogram.markers, res: det.kurtogram.res, height: 180, hideMarkerLabels: false }, CC);
    }
    var env = C('vc-env');
    if (env && det.envelope.freqs.length) { var de = function (s, e) { E.drawFFT(env, { freqs: det.envelope.freqs.slice(s, e), mags: det.envelope.mags.slice(s, e), markers: det.envelope.markers, res: 1, height: 210, hideMarkerLabels: true }, CC); }; E.zoomDraw(env, det.envelope.freqs.length, de, zk); }
    var cep = C('vc-cep');
    if (cep && det.cepstrum.freqs.length) { var dcp = function (s, e) { E.drawFFT(cep, { freqs: det.cepstrum.freqs.slice(s, e), mags: det.cepstrum.mags.slice(s, e), markers: det.cepstrum.markers, res: 1, height: 200, hideMarkerLabels: true }, CC); }; E.zoomDraw(cep, det.cepstrum.freqs.length, dcp, zk); }
    var spec = C('vc-spec');
    var sg = (this.state.fftFull && det.spectroFull) ? det.spectroFull : det.spectro; // FFT 범위 토글과 연동
    if (spec && sg.rows) E.drawHeat(spec, { grid: sg.grid, rows: sg.rows, cols: sg.cols, fmax: sg.fmax, height: 200 }, CC);
    var kurtC = C('vc-kurt'), bandC = C('vc-band');
    var tr = (kurtC || bandC) ? this._trends(eq, roll) : null;
    // 트렌드 x축 — 청크 샘플 시각(tr.xLabels), 없으면 롤업 시각(xL)
    var kxl = (tr && tr.xLabels && tr.xLabels.length) ? tr.xLabels : xL;
    var kxt = (tr && tr.xTips && tr.xTips.length) ? tr.xTips : xT;
    // 청크 트렌드도 실제 시각 배치 — RMS 등과 같은 기간 축
    var kTs = (tr && tr.times && tr.times.length) ? tr.times : tMs;
    var kWin = function (s, e) {
      var full = s === 0 && e >= kTs.length;
      return { xFrom: (full && xF0) ? xF0 : kTs[s], xTo: (full && rf.toMs) ? rf.toMs : kTs[Math.max(s, e - 1)] };
    };
    if (kurtC && tr && tr.kurt && tr.kurt.length) {
      var kV = tr.kurt;
      var dk = function (s, e) { var w = kWin(s, e); var r = E.drawLine(kurtC, { values: kV.slice(s, e), times: kTs.slice(s, e), xFrom: w.xFrom, xTo: w.xTo, xLabels: kxl.slice(s, e), tipLabels: kxt.slice(s, e), color: '#fdb532', height: 220, smooth: true, refLines: [{ val: 3, color: '#8a8d99', label: '정상=3' }, { val: 4.5, color: '#e07b39', label: '충격성 경계' }] }, CC); if (r) E.addTip(kurtC, C('vt-kurt'), null, r.pts); };
      E.zoomDraw(kurtC, kV.length, dk, zk);
    } else if (kurtC) {
      // 그릴 것 없으면 캔버스 지움 — 옛 픽셀이 새 구간 그래프처럼 남는 것 방지(빈 값이면 drawLine이 지움)
      E.drawLine(kurtC, { values: [], times: [], xLabels: [], height: 220 }, CC);
      // 툴팁 핸들러의 옛 점도 빈 점으로 재등록해 제거
      E.addTip(kurtC, C('vt-kurt'), null, []);
    }
    var band = bandC;
    // 꺼둔 계열 제외 — 축 범위를 남은 계열 기준으로(작은 대역 가시성)
    var _hide = this.state.bandHide || {};
    if (tr && tr.bands && tr.bands.length) this._lastBandSeries = tr.bands.map(function (x) { return { key: x.key, label: x.label, color: x.color, dash: x.dash }; });
    if (band && tr && tr.bands && tr.bands.length && tr.bands[0].vals.length) {
      // 배수 축(bandNorm) — 계열별 베이스라인 한계로 나눠 무차원화, ×1 기준선 = 판정선(원값은 계열 간 크기 차가 커 작은 대역이 바닥에 붙음)
      var _bl = this._bandBaselines(eq) || {};
      var _norm = !!this.state.bandNorm;
      var bS = tr.bands.filter(function (s) { return !_hide[s.label]; }).map(function (s) {
        if (!_norm) return { label: s.label, color: s.color, dash: s.dash, vals: s.vals };
        var lim = s.key ? VC.baselineLimit(_bl[s.key]) : 0;
        // 미학습 계열 제외 — 기준 없이 그리면 정상으로 오독
        if (!(lim > 0)) return null;
        return { label: s.label, color: s.color, dash: s.dash, vals: s.vals.map(function (v) { return v == null ? null : v / lim; }) };
      }).filter(Boolean);
      var refs = _norm ? [{ val: 1, color: '#e07b39', label: '알람 기준' }] : null;
      var db = function (s, e) { var w = kWin(s, e); E.drawMultiLine(band, { series: bS.map(function (sr) { return { label: sr.label, color: sr.color, dash: sr.dash, vals: sr.vals.slice(s, e) }; }), times: kTs.slice(s, e), xFrom: w.xFrom, xTo: w.xTo, xLabels: kxl.slice(s, e), height: 220, refLines: refs }, CC); };
      E.zoomDraw(band, kxl.length, db, zk);
    } else if (band) {
      E.drawMultiLine(band, { series: [], times: [], xLabels: [], height: 220 }, CC); // 위 첨도와 같은 이유로 지움
    }
  }
  // 토스트 표시 시간 — 오류는 사유를 읽도록 길게, 성공은 짧게
  _toast(msg, kind) {
    var self = this;
    this.setState({ toast: { msg: msg, kind: kind || 'ok' } });
    clearTimeout(this._tt);
    this._tt = setTimeout(function () { self.setState({ toast: null }); }, kind === 'err' ? 9000 : 2600);
  }
  toggleTheme() { var n = this.state.theme === 'light' ? 'dark' : 'light'; try { localStorage.setItem('vibeTheme', n); } catch (e) {} this.setState({ theme: n }); }
  // dirty 동시 설정 필수 — 회전수·베어링·형상은 결함 패턴 격자 입력값이라 저장 안내 누락 시 입력 소실
  /* 베어링 모델 — 직접 입력으로 바꾸면 직전 품번의 형상·이름을 직접 입력 값으로 채움(화면에 보이는 값 = 저장되는 값)
     이미 넣어 둔 직접 입력 형상이 있으면 그대로 */
  _setEquipBearing(id, v) {
    var S = this.state, m = Object.assign({}, S.equipBearing), prev = m[id] || '';
    m[id] = v;
    var patch = { equipBearing: m, dirty: true };
    var g0 = (S.equipGeo || {})[id] || {};
    if (v === '직접 입력' && !(g0.n > 0)) {
      var eq = ((this.data && this.data.equipment) || []).filter(function (e) { return e.id === id; })[0];
      var src = VC.BEARINGS[prev] || (eq && eq.bearing && eq.bearing.n > 0 ? eq.bearing : null);
      if (src && src.n > 0) {
        var g = { n: src.n, Bd: src.Bd, Pd: src.Pd, phi: src.phi || 0 };
        var nm = g0.name || (VC.BEARINGS[prev] && prev !== 'sleeve' ? prev : '');
        if (nm) g.name = nm;
        var gm = Object.assign({}, S.equipGeo); gm[id] = g; patch.equipGeo = gm;
      }
    }
    // 직접 입력은 품번·형상 칸이 패널 안에 있어 바로 펼치고 품번 칸에 커서(일괄 적용 경로는 이 함수를 안 거침)
    if (v === '직접 입력') {
      if (!(S.equipAdv || {})[id]) { patch.equipAdv = Object.assign({}, S.equipAdv); patch.equipAdv[id] = true; }
      this._focusGeoName = id;
    }
    this.setState(patch);
  }
  _setEquipRpm(id, v) { var m = Object.assign({}, this.state.equipRpm); m[id] = v; this.setState({ equipRpm: m, dirty: true }); }
  _toggleEquipAdv(id) { var m = Object.assign({}, this.state.equipAdv); m[id] = !m[id]; this.setState({ equipAdv: m }); }
  // 직접 입력 형상 — 숫자 칸, 품번(name)은 글자(40자까지)
  _setEquipGeo(id, key, v) {
    var m = Object.assign({}, this.state.equipGeo), g = Object.assign({}, m[id]);
    if (key === 'name') { var t = String(v || '').trim().slice(0, 40); if (t) g.name = t; else delete g.name; }
    else g[key] = Number(v) || 0;
    m[id] = g; this.setState({ equipGeo: m, dirty: true });
  }
  // 계측·구동 메타 — mount/drive는 문자열, vanes는 수, belt는 하위 객체(d1/d2/len)
  _setEquipMeta(id, key, v) {
    var m = Object.assign({}, this.state.equipMeta), g = Object.assign({}, m[id]);
    if (key === 'vanes') g.vanes = Number(v) || 0;
    else if (key === 'sensorPos') { if (v === 'driven') g.sensorPos = 'driven'; else delete g.sensorPos; }
    else g[key] = v;
    m[id] = g; this.setState({ equipMeta: m, dirty: true });
  }
  _setEquipBelt(id, key, v) {
    var m = Object.assign({}, this.state.equipMeta), g = Object.assign({}, m[id]);
    g.belt = Object.assign({}, g.belt); g.belt[key] = Number(v) || 0;
    m[id] = g; this.setState({ equipMeta: m, dirty: true });
  }
  // 같은 설비 추정(일괄 적용용) — 태그명 마지막 구분자 앞(MOTOR_01_X → MOTOR_01), 구분자 없으면 ''
  _equipPrefix(name) {
    var s = String(name || ''), i = -1;
    ['_', '-', '.', '/', ' '].forEach(function (c) { i = Math.max(i, s.lastIndexOf(c)); });
    return i > 0 ? s.slice(0, i) : '';
  }
  _toggleEquipBulk(id) {
    var b = this.state.equipBulk;
    this.setState({ equipBulk: (b && b.id === id) ? null : { id: id, scope: '', fields: {} } });
  }
  _setEquipBulk(patch) { this.setState({ equipBulk: Object.assign({}, this.state.equipBulk, patch) }); }
  _toggleBulkField(k, cur) {
    var b = this.state.equipBulk; if (!b) return;
    var f = Object.assign({}, b.fields); f[k] = !cur;
    this.setState({ equipBulk: Object.assign({}, b, { fields: f }) });
  }
  // 일괄 적용 — 값 있는 항목만 복사(원본 공백 복사 시 대상의 기존 값 소실, 패널도 값 있는 항목만 표시)
  _applyEquipBulk(srcId, ids, fields) {
    var S = this.state;
    var unit = Object.assign({}, S.equipUnit), cls = Object.assign({}, S.equipCls), rpm = Object.assign({}, S.equipRpm);
    var bear = Object.assign({}, S.equipBearing), geo = Object.assign({}, S.equipGeo), meta = Object.assign({}, S.equipMeta);
    var n = 0;
    (ids || []).forEach(function (id) {
      if (id === srcId) return;
      if (fields.unit && (S.equipUnit || {})[srcId]) unit[id] = S.equipUnit[srcId];
      if (fields.cls && (S.equipCls || {})[srcId]) cls[id] = S.equipCls[srcId];
      if (fields.rpm && (S.equipRpm || {})[srcId]) rpm[id] = S.equipRpm[srcId];
      if (fields.bearing && (S.equipBearing || {})[srcId]) bear[id] = S.equipBearing[srcId];
      // 형상은 값별 개별 항목 — 묶으면 대상의 다른 값까지 덮임
      var _g = (S.equipGeo || {})[srcId] || {}, gp = null;
      Object.keys(GEO_F).forEach(function (k) {
        if (!fields[k]) return;
        gp = gp || Object.assign({}, geo[id]);
        if (k === 'geoName') { if (_g.name) gp.name = _g.name; else delete gp.name; }
        else gp[GEO_F[k]] = _g[GEO_F[k]] || 0;   // 접촉각 0°도 유효값
      });
      if (gp) geo[id] = gp;
      var sm = (S.equipMeta || {})[srcId] || {}, mp = null;
      if (fields.mount && sm.mount) { mp = Object.assign({}, meta[id]); mp.mount = sm.mount; }
      if (fields.drive && sm.drive) { mp = mp || Object.assign({}, meta[id]); mp.drive = sm.drive; }
      if (fields.vanes && sm.vanes > 0) { mp = mp || Object.assign({}, meta[id]); mp.vanes = sm.vanes; }
      if (fields.beltPos) { mp = mp || Object.assign({}, meta[id]); if (sm.sensorPos === 'driven') mp.sensorPos = 'driven'; else delete mp.sensorPos; }
      Object.keys(BELT_F).forEach(function (k) {
        var v = (sm.belt || {})[BELT_F[k]];
        if (!fields[k] || !(v > 0)) return;
        mp = mp || Object.assign({}, meta[id]);
        mp.belt = Object.assign({}, mp.belt); mp.belt[BELT_F[k]] = v;
      });
      if (mp) meta[id] = mp;
      n++;
    });
    this.setState({ equipUnit: unit, equipCls: cls, equipRpm: rpm, equipBearing: bear, equipGeo: geo, equipMeta: meta, equipBulk: null, dirty: true });
    this._toast('태그 ' + n + '개에 적용했습니다');
  }
  _toggleNotifCh(k) { var m = Object.assign({}, this.state.notifCh); m[k] = !m[k]; this.setState({ notifCh: m, dirty: true }); }
  _toggleSrcTable(name) {
    var blocked = this._srcBlock(name);
    if (blocked) { this._toast(name + ' — ' + blocked, 'warn'); return; }
    var s = this.state.srcSel.slice(), i = s.indexOf(name);
    if (i >= 0) s.splice(i, 1); else { s.push(name); this._ensureTags([name]); }
    this.setState({ srcSel: s, dirty: true });
  }
  /* 선택 불가 테이블 사유(없으면 '') — 앱 조회는 NAME·TIME·VALUE 고정이라 다른 컬럼명 테이블은 선택 단계서 차단
     스키마 못 읽으면(권한·구버전) 차단 안 함 */
  _srcBlock(name) {
    var cols = (this.liveSchemas || {})[name];
    if (!cols || cols.length < 3) return '';
    var need = ['NAME', 'TIME', 'VALUE'];
    var ok = need.every(function (k, i) { return String(cols[i] || '').toUpperCase() === k; });
    return ok ? '' : '컬럼 구성 미지원 (' + cols.slice(0, 3).join(' · ') + ') — 이 앱은 NAME · TIME · VALUE만 조회합니다';
  }
  // 컬럼 구성 일괄 조회(실패 시 전부 선택 가능 유지) — 선택된 미지원 테이블은 제외(매 틱 조회 실패 방지)
  _loadSchemas() {
    var self = this;
    return tagSchemas().then(function (m) {
      self.liveSchemas = m || {};
      var sel = self.state.srcSel || [], asel = self._ac().srcSel || [];
      var blocked = function (t) { return !!self._srcBlock(t); }, keep = function (t) { return !blocked(t); };
      var drop = sel.concat(asel).filter(function (t, i, a) { return blocked(t) && a.indexOf(t) === i; });
      if (drop.length) {
        // 편집본·적용본 모두에서 제외(판정은 적용본 기준)
        self.setState({ srcSel: sel.filter(keep) });
        if (self._applied) self._setApplied({ srcSel: asel.filter(keep) }, ['srcSel']);
        self._toast('컬럼 구성이 다른 table을 감시에서 제외했습니다 — ' + drop.join(', '), 'warn');
      }
      self.forceUpdate();
    }).catch(function () { self.liveSchemas = null; });
  }
  // 선택 테이블의 태그 목록 프리페치 — 저장 전에도 별칭 편집에 바로 표시. force=캐시 무시 재조회(설정탭 진입 시)
  _ensureTags(tables, force) {
    var self = this;
    if (!this._tagCache) this._tagCache = {};
    (tables || []).forEach(function (tb) {
      if (self._tagCache[tb] && !force) return;
      if (!self._tagCache[tb]) self._tagCache[tb] = [];
      // 테이블 태그 전부 조회 — 테이블 내용 표시용이라 감시 상한 미적용
      listTags(tb, 100000).then(function (tags) { self._tagCache[tb] = tags; self.forceUpdate(); }).catch(function () {});
    });
  }
  _activeEqs() { var sel = this._ac().srcSel || []; return this.data.equipment.filter(function (e) { return sel.indexOf(e.table) >= 0; }); }
  // 태그 표시 라벨 통일: 별칭 (태그명), 별칭 없으면 태그명만
  _tagLabel(e) { return e.alias && e.alias !== e.name ? e.alias + ' (' + e.name + ')' : e.name; }
  /* 판정값 — RMS 구간 실효값(표시·판정·이벤트 공통), 구간이 짧으면 잡음이 등급을 흔듦
     eq.secBuckets는 판정 틱이 채우는 최근 롤업 버킷, 비었으면 eq.rms(최신 1초) 폴백 */
  _evalValue(eq) {
    var r = VC.windowRms(eq.secBuckets);
    return r ? r.rms : eq.rms;
  }
  /* ── ISO 존 판정값 ──
     ISO 존 경계는 10~1000 Hz 속도 RMS 기준 — 전대역 값 사용 시 고주파 많은 센서서 등급 역전
     1초 원본 + 대역제한으로 계산, 태그별 캐시 — 알람 근처는 ISO_TTL_MS, 조용하면 ISO_TTL_QUIET_MS 주기
     반환 { v: 존 판정용 속도 ISO, vr: 같은 대역 원본 단위 RMS(표시용, 미측정 null), pending, basis }
     pending이면 존 등급 미상승·직전 값 유지(전대역 대체 판정은 헛알람) */
  _isoValue(eq, wide) {
    if (!isFinite(wide)) return { v: wide, vr: wide, pending: false, basis: 'wide' };
    // 1 kHz 위가 없는 샘플레이트면 전대역 = ISO 대역 — 원본이 속도일 때만(가속도·변위는 변환 필요)
    if (!VC.isoNeeded(eq.fs) && eq.unit === 'mm/s') return { v: wide, vr: wide, pending: false, basis: 'wide' };
    var key = eq.table + ':' + eq.name;
    if (!this._isoCache) this._isoCache = {};
    var c = this._isoCache[key], now = Date.now();
    // 알람 임박 판단 — 구간 최대 초 버킷(ISO 상한)의 존 경계 초과 또는 베이스라인 한계 초과(존 경계보다 낮을 수 있음)
    var near = !VC.isoSkippable(eq.secBuckets, eq.zones[0]) || this._alarmNear(eq, wide);
    var vr = c && c.vr != null ? c.vr : null;
    if (c && now - c.at < (near ? ISO_TTL_MS : ISO_TTL_QUIET_MS)) return { v: c.v, vr: vr, pending: false, basis: 'iso' };
    this._isoRefresh(eq, key, now);
    // 미측정이면 전대역 임시 사용 — pending이라 등급은 직전 값 유지
    return c ? { v: c.v, vr: vr, pending: false, basis: 'iso' } : { v: wide, vr: null, pending: true, basis: 'wide' };
  }
  // 원본 기반 계측 판정 — 유효기간 경과 시 무효(배지 잔류 방지)
  _rawGate(key) {
    var e = (this._gateRaw || {})[key];
    if (!e) return null;
    if (Date.now() - e.at > GATE_RAW_TTL_MS) { delete this._gateRaw[key]; return null; }
    return e.g;
  }
  // 원본 기반 충격성 근거 — 게이트와 같은 창·유효기간, 이벤트 DETAIL용(서버도 같은 함수·창이라 두 모드 문구 일치)
  _rawImp(key) {
    var e = (this._impRaw || {})[key];
    if (!e) return null;
    if (Date.now() - e.at > GATE_RAW_TTL_MS) { delete this._impRaw[key]; return null; }
    return e.v;
  }
  // 베이스라인 쪽 알람 임박 여부 — 이때도 원본 조회로 계측 확인
  _alarmNear(eq, wide) {
    var key = eq.table + ':' + eq.name;
    if (this._isRevived(key)) return false;
    var lim = VC.baselineLimit((this._blMap || this.state.baselines || {})[key]);
    return lim != null && wide > lim;
  }
  _isoRefresh(eq, key, now) {
    var self = this;
    if (!this._isoBusy) this._isoBusy = {};
    if (this._isoBusy[key]) return;
    this._isoBusy[key] = true;
    var end = eq.lastSeen || now;
    rawWindow(eq.table, eq.name, end - ISO_WIN_MS, end, 0)
      .then(function (w) {
        // ISO 존은 속도 규격 — 가속도·변위는 속도 변환 후 대역제한(계측 게이트·충격성은 원본 파형 사용)
        var _raw = (w && w.values) || [];
        var _vel = eq.unit === 'mm/s' ? _raw : VC.convertDomain(_raw, eq.fs, eq.unit, 'mm/s', eq.rpm / 60);
        var v = VC.isoRms(_vel, eq.fs);
        // 표시는 원본 단위(vr, 같은 10~1000 Hz 대역), 속도 환산값(v)은 존 판정 전용
        var vr = eq.unit === 'mm/s' ? v : VC.isoRms(_raw, eq.fs);
        if (v != null) self._isoCache[key] = { v: v, vr: vr, at: Date.now() };
        // 같은 샘플로 계측 게이트 판정 — 클리핑·스파이크·첨도는 원본 파형 필요
        if (!self._gateRaw) self._gateRaw = {};
        var g = (w && w.values) ? VC.gateFromRaw(w.values, eq.fs) : null;
        // 시각 기록 — 재확인 기회 없어도 유효기간 경과 시 무효
        if (g) self._gateRaw[key] = { g: g, at: Date.now() }; else delete self._gateRaw[key];
        // 충격성 근거도 같은 파형에서 — 서버 IMP와 같은 함수·창(두 모드 DETAIL 문구 일치)
        if (!self._impRaw) self._impRaw = {};
        var im = (w && w.values) ? VC.impactEvidence(w.values, eq.fs) : null;
        if (im) self._impRaw[key] = { v: im, at: Date.now() }; else delete self._impRaw[key];
      })
      .catch(function () {})
      .then(function () { self._isoBusy[key] = false; });
  }
  // 표시 등급 — 판정 등급(패턴이 켜고 ISO가 높이 결정) 그대로(ISO 존 단독이면 고주파 지배 센서서 베어링 악화 미반영)
  _severityOf(eq) {
    var st = (this._gradeState || {})[eq.table + ':' + eq.name];
    // 판정 전엔 0(_holdOf가 '판정 대기'로 표시) — 전대역 gradeFor 대체 시 게이트 없는 ISO 단독 등급 노출
    return st ? st.gi : 0;
  }
  /* 판정 보류 — 카드 숫자가 설비를 대표하지 않는 상태, 등급 집계에서 제외
      · 계측 이상 — 파형 신뢰 불가
      · 신호 두절 — 마지막 옛 값
      · 정지      — 주변 진동·구조 전달
      · 판정 대기 — 첫 판정 회차 전
      · 결함 패턴 측정 대기·실패 — 직전 등급 유지 중
      · 판정 못 함 — 회전수·베어링 없음
     배지는 구분 유지(정지는 조치 불필요, 계측 이상·두절은 현장 확인 필요) */
  _holdOf(eq) {
    var key = eq.table + ':' + eq.name, rs = (this._runState || {})[key];
    if (rs) {
      if (rs.lost) return { kind: 'lost', label: '신호 두절' };
      if (rs.gate) return { kind: 'gate', label: rs.gate.label || '계측 이상' };
      if (!rs.run) return { kind: 'stop', label: '정지' };
    }
    var gs = (this._gradeState || {})[key];
    if (!gs) return { kind: 'wait', label: '판정 대기' };
    // 측정 가능한데 이번에 못 잰 태그 — 등급은 직전 값 유지 중(calc.patternRound)
    if (gs.patMiss) return { kind: 'patmiss', label: gs.patWait ? '결함 패턴 첫 측정 대기' : '결함 패턴 측정 실패' };
    // 결함 패턴 측정 불가 태그(회전수·기하 없음)도 보류 — 양호 표시 방지, 사유는 카드 호버
    if (gs.patOk === false) return { kind: 'nojudge', label: '판정 못 함' };
    return null;
  }
  /* 원본 단위 존 — 사용자 임계값은 입력 문자열 그대로 저장(_setThreshRaw), 여기서 숫자화(빈 값·비숫자면 규격 기본값)
     cfg 생략 = 적용 설정, 설정 화면 미리보기만 편집본(state) 전달 */
  _effZones(eq, cfg) {
    var S = cfg || this._ac();
    var num = function (v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; };
    if (eq.unit === 'mm/s') {
      var d = VC.ISO_ZONES[eq.cls] || VC.ISO_ZONES.II, o = S.classThresh[eq.cls] || [];
      return [num(o[0], d[0]), num(o[1], d[1]), num(o[2], d[2])];
    }
    var du = VC.zonesFor(eq.unit, eq.cls), ou = S.unitThresh[eq.unit] || [];
    return [num(ou[0], du[0]), num(ou[1], du[1]), num(ou[2], du[2])];
  }
  // ISO 축 전용 존 — 속도(mm/s) 규격이라 원본 단위 무관하게 클래스로 결정(_effZones는 원본 단위 존)
  _isoZones(eq, cfg) {
    var S = cfg || this._ac(), d = VC.ISO_ZONES[eq.cls] || VC.ISO_ZONES.II, o = S.classThresh[eq.cls] || [];
    var num = function (v, dd) { var n = parseFloat(v); return isFinite(n) ? n : dd; };
    return [num(o[0], d[0]), num(o[1], d[1]), num(o[2], d[2])];
  }
  _setEquipCls(id, v) { var m = Object.assign({}, this.state.equipCls); m[id] = v; this.setState({ equipCls: m, dirty: true }); }
  _setEquipUnit(id, v) { var m = Object.assign({}, this.state.equipUnit); if (v) m[id] = v; else delete m[id]; this.setState({ equipUnit: m, dirty: true }); }
  /* 입력 문자열 그대로 저장 — onChange가 키마다 발화해 즉시 parseFloat 시 '1.'의 점이 지워짐
     숫자화는 _effZones 한 곳에서, 빈 칸은 null = 기본값 */
  _setThreshRaw(mapKey, k, i, v) {
    var m = Object.assign({}, this.state[mapKey]);
    var a = (m[k] || []).slice();
    a[i] = String(v).trim() === '' ? null : v;
    m[k] = a;
    var patch = { dirty: true };
    patch[mapKey] = m;
    this.setState(patch);
  }
  _setClassThresh(c, i, v) { this._setThreshRaw('classThresh', c, i, v); }
  _setUnitThresh(u, i, v) { this._setThreshRaw('unitThresh', u, i, v); }
  _periodLabel() {
    var E = this.E, now = this.data ? this.data.now : Date.now();
    var p = this.state.period;
    if (p === 'custom' || p === 'all') return String(this.state.from).replace('T', ' ') + ' ~ ' + String(this.state.to).replace('T', ' ');
    return E.fmtDT(now - (PERIOD_H[p] || 1) * 3600000) + ' ~ ' + E.fmtDT(now);
  }
  // datetime-local 입력값(YYYY-MM-DDTHH:MM)
  _dtVal(ms) { return this.E.fmtDT(ms).replace(' ', 'T'); }
  // 태그에서 실제 쓸 수 있는 기간 — 데이터가 want보다 짧으면 'all'(비활성 프리셋 선택 모순 방지)
  _periodFor(eq, want) {
    want = want || '1h';
    var need = PERIOD_H[want];
    if (need == null) return want; // all·custom은 항상 가능
    if (!eq || !eq.stat || !(eq.stat.maxMs > eq.stat.minMs)) return want;
    return ((eq.stat.maxMs - eq.stat.minMs) / 3600000 < need) ? 'all' : want;
  }
  // 기간에 맞는 from/to (all이면 데이터 전 구간)
  _periodRange(eq, p) {
    var to = eq.lastSeen, minMs = (eq.stat && eq.stat.minMs) || 0;
    var from = (p === 'all') ? (minMs || to - 3600000) : to - (PERIOD_H[p] || 1) * 3600000;
    return { from: this._dtVal(Math.max(minMs, from)), to: this._dtVal(to) };
  }
  // 앵커 태그(들) 데이터 범위 — 여러 태그면 합집합(최장 스팬), 스팬 모르면 Infinity(프리셋 비차단)
  _presetSpan(eqs) {
    var spanH = 0, toMs = 0, minMs = 0, known = false;
    (eqs || []).forEach(function (e) {
      if (!e) return;
      var st = e.stat;
      if (st && st.maxMs > st.minMs) { spanH = Math.max(spanH, (st.maxMs - st.minMs) / 3600000); known = true; }
      if (st && st.minMs) minMs = minMs ? Math.min(minMs, st.minMs) : st.minMs;
      var last = e.lastSeen || (st && st.maxMs) || 0;
      if (last > toMs) toMs = last;
    });
    return { spanH: known ? spanH : Infinity, toMs: toMs, minMs: minMs };
  }
  /* 기간 프리셋 칩 — 데이터 구간보다 긴 것은 비활성(직접 입력은 옆 DateRange 달력 → period=custom)
     who = 비활성 툴팁의 기준 태그 설명 · scope = 'report'면 리포트 탭 기간 상태 사용 */
  _presetChips(eqs, who, scope) {
    var self = this, S = this.state, sp = this._presetSpan(eqs), rep = scope === 'report';
    var cur = rep ? S.genPeriod : S.period;
    var put = function (p, fromV, toV) {
      self.setState(rep ? { genPeriod: p, genFrom: fromV, genTo: toV } : { period: p, from: fromV, to: toV });
    };
    var spanTxt = sp.spanH === Infinity ? '알 수 없음'
      : sp.spanH < 1 ? Math.max(1, Math.round(sp.spanH * 60)) + '분'
        : sp.spanH < 48 ? sp.spanH.toFixed(1) + '시간' : (sp.spanH / 24).toFixed(1) + '일';
    return [['1h', '1시간'], ['6h', '6시간'], ['24h', '24시간'], ['all', '전체']].map(function (p) {
      var a = cur === p[0];
      var need = PERIOD_H[p[0]];
      var dis = need != null && sp.spanH < need; // 데이터가 그 길이에 못 미치면 선택 불가
      return {
        label: p[1],
        title: dis ? who + '의 데이터는 ' + spanTxt + '뿐이라 선택할 수 없습니다' : '',
        onClick: function () {
          if (dis) { self._toast('데이터가 부족합니다', 'warn'); return; }
          var s2 = self._presetSpan(eqs); // 클릭 시점 기준 재계산(lastSeen 전진)
          var toMs = s2.toMs || self.data.now;
          var fromMs = (PERIOD_H[p[0]] == null)
            ? (s2.minMs || toMs - PERIOD_H['24h'] * 3600000) // all
            : toMs - PERIOD_H[p[0]] * 3600000;
          put(p[0], self._dtVal(fromMs), self._dtVal(toMs));
        },
        style: 'padding: 6px 13px; background: ' + (a ? 'var(--primary-base)' : 'transparent') + '; color: ' + (a ? '#fff' : 'var(--text-secondary)') + '; border: none; border-right: 1px solid var(--border-default); font-size: 12px; font-weight: ' + (a ? '600' : '500') + ';' + (dis ? ' opacity: .35; cursor: default;' : ' cursor: pointer;')
      };
    });
  }
  // 대상 태그 변경 시 리포트 기간 재설정 — 태그 없으면 기간도 비움
  _setGenTags(ids) {
    var self = this, S = this.state;
    var eqs = (ids || []).map(function (id) { return self._eq(id); }).filter(Boolean);
    if (!eqs.length) { this.setState({ genTags: ids || [], genPeriod: '', genFrom: '', genTo: '' }); return; }
    if (S.genPeriod === 'custom') { this.setState({ genTags: ids }); return; } // 직접 입력 값은 유지
    var sp = this._presetSpan(eqs);
    var want = S.genPeriod || '1h';
    var need = PERIOD_H[want];
    if (need != null && sp.spanH < need) want = 'all'; // 데이터보다 긴 프리셋 선택 모순 방지
    var toMs = sp.toMs || this.data.now;
    var fromMs = (PERIOD_H[want] == null) ? (sp.minMs || toMs - PERIOD_H['24h'] * 3600000) : toMs - PERIOD_H[want] * 3600000;
    this.setState({ genTags: ids, genPeriod: want, genFrom: this._dtVal(fromMs), genTo: this._dtVal(toMs) });
  }
  _toggleGenTag(id) { var g = this.state.genTags.slice(), i = g.indexOf(id); if (i >= 0) g.splice(i, 1); else g.push(id); this._setGenTags(g); }
  // 생성 중단 — 즉시 대기 상태 복귀, LLM 요청 abort, 실행 토큰(_genRun) 증가로 이후 저장 차단(저장분만 유지)
  _cancelGen() {
    if (!this.state.genRunning) return;
    this._genRun = (this._genRun || 0) + 1; // 진행 중 체인 전부 무효화
    if (this._genAC) { try { this._genAC.abort(); } catch (e) { /* 이미 끝난 요청 */ } this._genAC = null; }
    this.setState({ genRunning: false, genStep: 0 });
    this._toast('생성 중단 · ' + (this._genSaved || 0) + '건 저장됨', 'warn');
    this._loadReports();
  }
  /* 리포트 생성 — 태그별 데이터 조회(0) → 지표 계산(1) → 소견 생성(2, 옵션) → 저장(3)
     저장: <워크스페이스 루트>/<계정>/vibration-reports/<태그>_<생성일시>.html (파일 API) */
  _genReport() {
    var self = this, S = this.state;
    if (!S.genTags.length) { this._toast('태그를 1개 이상 선택하세요', 'warn'); return; }
    if (S.genRunning) return;
    // 데이터 없는 태그는 제외 — 빈 리포트가 '분석했고 이상 없음' 기록으로 남는 것 방지
    var gap = this._genGapIds || [];
    var ids0 = S.genTags.filter(function (id) { return gap.indexOf(id) < 0; });
    if (!ids0.length) { this._toast('선택한 기간에 데이터가 없습니다 — 기간을 데이터가 있는 구간으로 바꾸세요', 'warn'); return; }
    if (ids0.length < S.genTags.length) this._toast((S.genTags.length - ids0.length) + '개 태그는 이 기간에 데이터가 없어 제외합니다', 'warn');
    var run = this._genRun = (this._genRun || 0) + 1;
    this._genSaved = 0;
    this._genLlmErr = null;
    this._genFails = [];
    this._genSkips = [];
    this._genAC = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    this.setState({ genRunning: true, genStep: 0 });
    var ids = ids0; // 데이터 없는 태그는 위에서 제외됨
    ensureDir(reportDir())
      .then(function () {
        return ids.reduce(function (chain, id) {
          return chain.then(function () {
            if (self._genRun !== run) return null; // 중단 — 남은 태그 미시작
            var eq = self._eq(id);
            if (!eq) return null;
            return self._genOne(eq, run).then(function () { self._genSaved++; })
              // 한 태그 실패해도 나머지 진행 — 실패 태그·사유 기록
              .catch(function (e) {
                if (e && e.__abort) throw e; // 중단은 실패 아님 — 바깥에서 처리
                // 데이터 없어 건너뜀도 실패 아님
                if (e && e.__nodata) { self._genSkips.push(eq.alias || eq.name); return null; }
                console.error('[vibe] report failed · tag=' + eq.name + ' table=' + eq.table, e);
                // 발생 위치(줄:열)도 화면에 표시 — 콘솔 없는 환경 대응, 단일 번들이라 함수 특정 가능
                var at = String((e && e.stack) || '').split('\n').slice(1, 3)
                  .map(function (s) { return s.trim().replace(/^at\s+/, '').replace(/^.*\/([^/]+:\d+:\d+)\)?$/, '$1'); })
                  .filter(Boolean).join(' ← ');
                self._genFails.push({ tag: eq.alias || eq.name, msg: String((e && e.message) || e), at: at });
                return null;
              });
          });
        }, Promise.resolve());
      })
      .then(function () {
        if (self._genRun !== run) return; // 중단 처리는 _cancelGen에서 완료
        self._genAC = null;
        self.setState({ genRunning: false, genStep: 0 });
        var _f = self._genFails, _sk = self._genSkips;
        if (!_f.length && _sk.length) {
          self._toast('리포트 ' + self._genSaved + '건 저장 · ' + _sk.length + '건 건너뜀 — ' + _sk.join(', ')
            + ': 선택 기간에 표본이 없습니다', 'warn');
        } else if (_f.length) {
          self._toast('리포트 ' + self._genSaved + '건 저장 · ' + _f.length + '건 실패 — ' + _f[0].tag + ': ' + _f[0].msg
            + (_f[0].at ? '  [' + _f[0].at + ']' : '') + (_f.length > 1 ? ' 외 ' + (_f.length - 1) + '건' : ''), 'err');
        } else if (self._genLlmErr) self._toast('리포트 ' + self._genSaved + '건 저장 — LLM 소견 실패로 지표만 저장됨 · ' + self._genLlmErr, 'err');
        else self._toast('리포트 ' + self._genSaved + '건 저장 · ' + reportDir().replace(/^\//, '') + '/');
        self._loadReports();
      })
      .catch(function (e) {
        if (self._genRun !== run) return;
        self._genAC = null;
        self.setState({ genRunning: false, genStep: 0 });
        self._toast('리포트 생성 실패: ' + (e && e.message || e), 'err');
        self._loadReports();
      });
  }
  /* ── 데이터 관리(설정) ──
     패키지 표 현황·사용자 실행 삭제(삭제 전 건수 확인)
      · EVENTS·BAND(TAG) — 기간·태그 단위
      · LOOKUP 둘        — 키 단위
     불가 동작은 흐리게 표시(이유 명시)
     exact = 삭제 직후 갱신 — V$_STAT 반영 지연으로 옛 건수가 보이지 않게 원본 집계 */
  _refreshUsage(exact) {
    var self = this;
    if (!this.live) return Promise.resolve();
    this.setState({ usageBusy: true });
    // 태그별 보유량도 함께 조회 — '감시 대상 밖 N건' 표시용
    return Promise.all([usageStats(exact), tagUsage(exact).catch(function () { return null; })])
      .then(function (r) { self.setState({ usage: r[0], tagUsage: r[1], usageBusy: false }); })
      .catch(function (e) { self.setState({ usageBusy: false }); self._toast('현황 조회 실패: ' + (e.message || e), 'err'); });
  }
  /* 감시 대상 밖 태그 데이터 삭제 — 대역 계열 전부 + 이벤트 + 판정 상태
     순서: 데이터 먼저, 태그 메타는 뒤(메타 정리는 데이터 0인 이름만 삭제, db.deleteBandOfTag·deleteEventsOfTag가 순서 보장)
     학습값은 유지 — 증가하지 않고, 같은 이름 재등장 시 되살아남 확인이 보호 */
  _purgeOrphan(rows) {
    var self = this;
    if (!rows || !rows.length) return Promise.resolve();
    var one = rows.length === 1;
    this.setState({ orphanBusy: one ? rows[0].key : 'all' });
    return rows.reduce(function (p, r) {
      var parts = r.key.split(':'), tbl = parts[0], tag = parts[1];
      return p.then(function () {
        return Promise.all([
          r.band ? deleteBandOfTag(tbl, tag).catch(function () {}) : null,
          r.events ? deleteEventsOfTag(tbl, tag).catch(function () {}) : null,
          deleteMonState(r.key).catch(function () {}),
        ]);
      });
    }, Promise.resolve()).then(function () {
      // 판정 상태 캐시도 비움 — 지운 태그가 '감시 대상 밖'으로 계속 세지는 것 방지
      rows.forEach(function (r) { if (self._monState) delete self._monState[r.key]; });
      self._toast(one ? rows[0].key + ' 데이터를 지웠습니다' : rows.length + '개 태그의 데이터를 지웠습니다', 'ok');
      self.setState({ orphanBusy: null });
      return self._refreshUsage(true);
    }).catch(function (e) {
      self.setState({ orphanBusy: null });
      self._toast('정리 실패: ' + (e.message || e), 'err');
    });
  }
  // 삭제 확인 — 실제 건수를 먼저 센 뒤 대화상자 표시
  _askPurge(kind, fromMs, toMs) {
    var self = this, S = this.state;
    var u = S.usage || {};
    this.setState({ purge: { kind: kind, fromMs: fromMs, toMs: toMs, counting: true, n: null } });
    return countRange(kind, fromMs, toMs).then(function (n) {
      var tot = kind === 'band' ? ((u.band || {}).rows || 0) : ((u.events || {}).rows || 0);
      self.setState({ purge: { kind: kind, fromMs: fromMs, toMs: toMs, counting: false, n: n, keep: Math.max(0, tot - n) } });
    }).catch(function (e) {
      self.setState({ purge: null });
      self._toast('건수 조회 실패: ' + (e.message || e), 'err');
    });
  }
  _closePurge() { this.setState({ purge: null, purgeTyped: null }); }
  /* 확인된 삭제 실행(날짜 선택 → 건수 확인 → 확인 경로만) — 실행 후 현황 재조회
     TAG 표는 삭제 직후 NAME 인덱스 반영 시차 → 잠시 대기 후 갱신 */
  _runPurge() {
    var self = this, p = this.state.purge;
    if (!p || p.counting || !p.n) return Promise.resolve();
    var isBand = p.kind === 'band';
    var n = p.n;
    this.setState({ purge: Object.assign({}, p, { running: true }) });
    return (isBand ? deleteBandRange(p.fromMs, p.toMs) : deleteEventsRange(p.fromMs, p.toMs))
      .then(function () {
        self.setState({ purge: null, purgeTyped: null });
        self._toast(self._num(n) + (isBand ? '행' : '건') + ' 삭제했습니다', 'ok');
        if (!isBand) self._loadEventsLive();          // 목록도 삭제 후 상태로 갱신
        return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return self._refreshUsage(true); });
      })
      .catch(function (e) {
        self.setState({ purge: null, purgeTyped: null });
        self._toast('삭제 실패: ' + (e.message || e), 'err');
      });
  }
  // 감시 대상 밖 판정 상태 정리 — 다음 판정 주기에 재생성되므로 확인 없이 삭제(학습값은 대상 아님)
  _cleanMonStateOrphans() {
    var self = this, S = this.state;
    var live = {};
    (this.data ? this._activeEqs() : []).forEach(function (e) { live[e.table + ':' + e.name] = 1; });
    // '__' 시작 예약 키(타이머·탭 조율용) 제외 — 태그 키만 정리
    var keys = Object.keys(this._monState || {}).filter(function (k) { return !live[k] && k.indexOf('__') !== 0; });
    if (!keys.length) { this._toast('정리할 항목이 없습니다'); return Promise.resolve(); }
    return keys.reduce(function (pr, k) {
      return pr.then(function () { return deleteMonState(k).catch(function () { }); });
    }, Promise.resolve()).then(function () {
      keys.forEach(function (k) { delete self._monState[k]; });
      self._toast(keys.length + '개 정리했습니다', 'ok');
      return self._refreshUsage();
    });
  }
  // 유저 정보 표시 — 신원은 콘솔 로그인 세션(계정 변경은 Neo 콘솔에서 재로그인)
  _userVals(base) {
    var self = this, S = this.state;
    base.userName = S.user || '';
    base.userAuthMsg = S.authMsg || '';
    base.needsDb = !!S.needsDb;
    base.dbExists = !!S.dbExists;      // 저장소는 있으나 권한 없음 — 안내 분기
    base.dbWhy = S.dbWhy || '';
    // 저장소 준비 후에도 권한 쿼리 표시 유지 — 유저 추가 때마다 필요
    var setup = setupSql();
    base.dbReady = !S.needsDb && !!S.user;
    base.dbAdmin = (S.user === 'SYS');
    base.dbName = setup.db;
    base.dbGrantSql = '-- 권한 주기\n' + setup.grant + '\n\n-- 권한 회수\n' + setup.revoke + '\n\n-- 권한 확인\n' + setup.check;
    /* 계정별 권한 표 — 상태 = 대상 5곳(DB·공용 표 4) 중 권한 있는 곳 수, 다 있으면 회수만·하나도 없으면 부여만
       상태를 못 읽었으면 두 버튼 모두(재실행 무해) */
    var gst = S.grantStatus;
    base.grantLoading = !S.grantUsers;
    base.grantMsg = S.grantMsg || '';
    base.grantBusy = !!S.grantBusy;
    base.onGrantRefresh = function () { self.setState({ grantMsg: '' }); self._loadGrantUsers(true); };
    base.grantRows = (S.grantUsers || []).map(function (u) {
      var st = gst ? (gst[u] || { n: 0, total: 5, timers: 0 }) : null;
      var full = !!st && st.n >= st.total, none = !!st && st.n === 0;
      var tm = st && st.timers > 0 ? st.timers : 0;
      return {
        user: u, busy: S.grantBusy === u, ask: S.grantAsk === u,
        statusText: !st ? '확인 불가' : full ? '권한 있음' : none ? '권한 없음' : '일부만 있음 (' + st.n + '/' + st.total + ')',
        statusColor: !st ? 'var(--text-muted)' : full ? '#3aa76d' : none ? 'var(--text-muted)' : '#d99a2b',
        timersText: tm ? '타이머 ' + tm + '개' : '',
        canGrant: !full, canRevoke: !none,
        askText: (tm ? '이 계정의 이 패키지 타이머 ' + tm + '개는 회수 뒤 매 회차 실패합니다 — 먼저 그 계정으로 알람과 대역 추출을 끄십시오. ' : '')
          + '설정·이벤트·학습값은 지우지 않으며, 다시 권한을 주면 그대로 이어집니다.',
        onGrant: function () { self._grantRun(u, false); },
        onRevoke: function () { self.setState({ grantAsk: u, grantMsg: '' }); },
        onRevokeYes: function () { self._grantRun(u, true); },
        onRevokeNo: function () { self.setState({ grantAsk: '' }); },
      };
    });
    base.dbBusy = !!S.dbBusy;
    base.onMakeDb = function () { self._makeDb(); };
    base.onCheckDb = function () { self._checkDb(); };
    base.appDbName = appDb();
  }
  _dataVals(base) {
    var self = this, S = this.state, E = this.E;
    var u = S.usage;
    base.usageBusy = !!S.usageBusy;
    base.usageReady = !!u;
    base.onUsageRefresh = function () { self._refreshUsage(); };
    var span = function (s) {
      return (s && s.from > 0 && s.to > 0) ? E.fmtDT(s.from).slice(0, 10) + ' ~ ' + E.fmtDT(s.to).slice(0, 10) : '데이터 없음';
    };
    // 감시 대상 밖 키 — 지금 선택된 테이블에 없는 태그의 판정 상태/학습값
    var live = {};
    (this.data ? this._activeEqs() : []).forEach(function (e) { live[e.table + ':' + e.name] = 1; });
    var orphan = function (map) {
      var n = 0;
      Object.keys(map || {}).forEach(function (k) { if (!live[k.split(':').slice(0, 2).join(':')]) n++; });
      return n;
    };
    var msOrphan = orphan(this._monState);
    var openPick = function (kind) { self.setState({ purgePick: kind, purgeFrom: null, purgeTo: null }); };
    // 감시 대상 밖 태그별 보유량 — 철거 설비 이력 정리용(기간 삭제는 다른 태그까지 삭제)
    var tu = S.tagUsage || null;
    var orphanRows = tu ? Object.keys(tu).filter(function (k) { return !live[k]; }).map(function (k) {
      return { key: k, band: tu[k].band || 0, events: tu[k].events || 0 };
    }).filter(function (r) { return r.band || r.events; })
      .sort(function (a, b) { return (b.band + b.events) - (a.band + a.events); }) : [];
    var orphanTot = orphanRows.reduce(function (a, r) { return { band: a.band + r.band, events: a.events + r.events }; }, { band: 0, events: 0 });
    base.orphanCount = orphanRows.length;
    var openOrphan = function () { self.setState({ orphanOpen: true, orphanBusy: null }); };
    base.dataRows = u ? [
      {
        id: 'events', name: '이벤트 이력', table: 'EVENTS', kind: 'TAG',
        stat: this._num(u.events.rows || 0) + '건 · ' + span(u.events.span)
          + (orphanTot.events ? ' · 감시 대상 밖 ' + this._num(orphanTot.events) + '건' : ''),
        note: '알람 이력입니다. 지우면 그 기간을 다룬 리포트를 다시 만들 수 없습니다. 설비를 철거했다면 그 태그의 이력만 따로 지울 수 있습니다.',
        act: { label: '기간 삭제…', danger: true, sub: '기간 안 모든 태그', onClick: function () { openPick('events'); } },
        act2: orphanRows.length ? { label: '태그별 정리…', onClick: openOrphan } : null,
      },
      {
        id: 'band', name: '대역 에너지 추이', table: 'BAND', kind: 'TAG',
        stat: this._num(u.band.rows || 0) + '행 · ' + span(u.band.span)
          + (orphanTot.band ? ' · 감시 대상 밖 ' + this._num(orphanTot.band) + '행' : ''),
        note: '대역 이탈 판정과 추세 차트가 쓰는 데이터입니다. 넷 중 유일하게 시간에 비례해 커집니다 — 학습에 쓰인 구간을 지우면 대역 베이스라인을 다시 학습해야 합니다.',
        act: { label: '기간 삭제…', danger: true, sub: '학습 구간 포함 주의', onClick: function () { openPick('band'); } },
        act2: orphanRows.length ? { label: '태그별 정리…', onClick: openOrphan } : null,
      },
      {
        id: 'monstate', name: '판정 상태', table: 'MONSTATE', kind: 'LOOKUP',
        stat: this._num(u.monstate.rows || 0) + '행' + (msOrphan ? ' · 감시 대상 밖 ' + msOrphan + '행' : ''),
        note: '직전 판정 결과입니다. 지워도 다음 판정 주기에 다시 만들어집니다 — 넷 중 유일하게 잃을 것이 없는 데이터라 확인 없이 정리합니다.',
        // 재생성 가능 데이터라 확인 대화상자 없음
        act: msOrphan
          ? { label: '안 쓰는 데이터 정리', danger: false, sub: '확인 없이 즉시 실행', onClick: function () { self._cleanMonStateOrphans(); } }
          : null,
      },
    ] : [];
    // 학습값(BASELINE)은 행 없이 각주만 — 재학습이 같은 키를 덮어써 증가 없음, 관리는 판정 기준 화면에서
    base.dataFootnote = u
      ? '학습값(BASELINE · ' + this._num(u.baseline.rows || 0) + '행)은 재학습이 같은 자리를 덮어써 늘지 않습니다 — 정리 대상이 아니라 판정 기준에서 관리합니다.'
      : '';
    base.onGoCriteria = function () { self.setState({ setSection: 'criteria' }); self._refreshBandCov(); };
    // 태그별 정리 — 기간 삭제로 불가한 설비 단위 정리, 대상이 감시 밖·건수 명시라 확인 절차는 가볍게
    base.orphanOpen = !!S.orphanOpen;
    base.orphanBusy = S.orphanBusy || null;
    base.orphanRows = orphanRows.map(function (r) {
      var parts = r.key.split(':');
      return {
        key: r.key, table: parts[0], tag: parts[1],
        stat: [r.band ? self._num(r.band) + '행' : '', r.events ? self._num(r.events) + '건' : ''].filter(Boolean).join(' · '),
        busy: S.orphanBusy === r.key,
        onDelete: function () { self._purgeOrphan([r]); },
      };
    });
    base.orphanTotalText = orphanRows.length
      ? orphanRows.length + '개 태그 · 대역 ' + this._num(orphanTot.band) + '행 · 이벤트 ' + this._num(orphanTot.events) + '건'
      : '';
    base.onOrphanClose = function () { self.setState({ orphanOpen: false }); };
    base.onOrphanAll = function () { self._purgeOrphan(orphanRows); };
    // 기간 고르기 — 기본은 보관 전체 구간(min~max), 보관 정보 없으면 빈칸·버튼 잠금(실행 전 표 이름 입력 관문 존재)
    var pick = S.purgePick;
    base.purgePickShow = !!pick;
    base.purgePickTitle = pick === 'band' ? '대역 에너지 추이 삭제' : '이벤트 이력 삭제';
    var _sp = pick === 'band' ? (u && u.band.span) : (u && u.events.span);
    var _hasSpan = !!(_sp && _sp.from > 0 && _sp.to > 0);
    var _pgFrom = S.purgeFrom || (_hasSpan ? this._dtVal(_sp.from).slice(0, 10) : '');
    var _pgTo = S.purgeTo || (_hasSpan ? this._dtVal(_sp.to).slice(0, 10) : '');
    base.purgePickReady = !!(_pgFrom && _pgTo);
    base.purgeHaveText = _sp && _sp.from > 0
      ? '보관 중: ' + E.fmtDT(_sp.from).slice(0, 10) + ' ~ ' + E.fmtDT(_sp.to).slice(0, 10) : '';
    base.purgeRange = {
      from: _pgFrom, to: _pgTo, mode: 'date', full: true,
      minMs: _hasSpan ? _sp.from : 0, maxMs: _hasSpan ? _sp.to : 0,
      placeholder: '지울 기간 선택', title: '지울 기간을 고릅니다',
      onApply: function (f, t) { self.setState({ purgeFrom: f, purgeTo: t }); },
    };
    base.onPurgePickCancel = function () { self.setState({ purgePick: null, purgeFrom: null, purgeTo: null }); };
    base.onPurgePickNext = function () {
      if (!base.purgePickReady) { self._toast('시작·종료 날짜를 모두 고르세요', 'warn'); return; }
      // 종료일은 그날 23:59:59.999까지 포함
      var a = CH.parseDT(_pgFrom + 'T00:00:00'), b = CH.parseDT(_pgTo + 'T23:59:59.999');
      if (!isFinite(a) || !isFinite(b)) { self._toast('날짜를 확인하세요', 'warn'); return; }
      if (a > b) { self._toast('기간이 올바르지 않습니다 (시작 ≤ 종료)', 'warn'); return; }
      self.setState({ purgePick: null });
      self._askPurge(pick, a, b);
    };
    // 확인 대화상자 — 건수 확인 후에만 삭제 버튼 활성
    var p = S.purge;
    base.purgeShow = !!p;
    if (p) {
      var isBand = p.kind === 'band';
      base.purgeTitle = isBand ? '대역 에너지 추이 삭제' : '이벤트 이력 삭제';
      base.purgeSub = isBand ? 'BAND' : 'EVENTS';
      var unit = isBand ? '행' : '건';
      base.purgeWhen = E.fmtDT(p.fromMs).slice(0, 10) + ' ~ ' + E.fmtDT(p.toMs).slice(0, 10);
      base.purgeCounting = !!p.counting;
      base.purgeN = p.counting ? '—' : this._num(p.n || 0) + unit;
      base.purgeKeep = p.counting ? '—' : '삭제 후 남는 데이터 ' + this._num(p.keep || 0) + unit;
      base.purgeNone = !p.counting && !p.n;
      base.purgeAsk = '정말 삭제하시겠습니까?';
      // 결과를 항목별로 — 마지막 항목(내보내기 권장)은 대안이라 tip 톤
      base.purgeBullets = isBand
        ? [{ t: '영구 삭제되며 복구할 수 없습니다' },
          { t: '학습에 쓰인 구간이 포함되면 대역 베이스라인을 다시 학습해야 합니다' },
          { t: '추세 차트에서 이 구간이 비어 보입니다' }]
        : [{ t: '영구 삭제되며 복구할 수 없습니다' },
          { t: '이 기간을 다룬 리포트는 다시 만들 수 없습니다' },
          { t: '기간 조회에서 이 구간은 빈 결과로 나옵니다' },
          { t: '삭제 전 이벤트 기록 내보내기로 저장한 뒤 제거하는 것을 권장합니다', tip: true }];
      // 최종 관문 — 테이블 이름 직접 입력 시에만 버튼 활성(비가역 삭제)
      base.purgeTable = isBand ? 'BAND' : 'EVENTS';
      base.purgeTyped = S.purgeTyped || '';
      base.purgeTypeOk = base.purgeTyped.trim().toUpperCase() === base.purgeTable;
      base.onPurgeType = function (ev) { self.setState({ purgeTyped: ev.target.value }); };
      base.purgeRunning = !!p.running;
      base.purgeReady = !p.counting && !p.running && !!p.n && base.purgeTypeOk;
      base.purgeBtnLabel = p.running ? '삭제 중…'
        : p.counting ? '건수 확인 중…'
          : (p.n ? this._num(p.n) + unit + ' 삭제' : '지울 데이터 없음');
      base.onPurgeCancel = function () { self._closePurge(); };
      base.onPurgeConfirm = function () { if (base.purgeReady) self._runPurge(); };
    }
  }
  // 통계 요약 한 줄 — 문장형 근거(등급 축·이탈 대역·지속 최악) 조립, 화면·리포트 공용(문구 일치)
  _statSummary(eq, det, dx, roll, gi) {
    var E = this.E, S = this.state;
    var g = gi != null ? gi : (dx.gi != null ? dx.gi : (eq.grade || 0));
    var srcKo = GRADE_SRC_KO;
    var bandKo = { sub: '서브동기', one: '1× 대역', fault: '결함 대역', high: '고주파',
      vh1: '1~2 kHz', vh2: '2~4 kHz', vh3: '4~8 kHz', vh4: '8 kHz+',
      envBPFO: 'BPFO(외륜)', envBPFI: 'BPFI(내륜)', envBSF: 'BSF(볼·롤러)' };
    var ax = dx.bandAx, axTxt = [];
    if (ax && ax.freqR > 0) axTxt.push('진동 ×' + ax.freqR.toFixed(2) + ' (' + (bandKo[ax.freqKey] || ax.freqKey) + ')');
    if (ax && ax.envR > 0) {
      var ek = (bandKo[ax.envKey] || ax.envKey)
        + (ax.envAlt ? ' / ' + (bandKo[ax.envAlt] || ax.envAlt) + ' — 구분 불충분' : '');
      axTxt.push('베어링 ×' + ax.envR.toFixed(2) + ' (' + ek + ')');
    }
    // 기간 내 지속된 최악 — 헤드라인은 앵커 시점이라 별도 표시, 시간 기준(dwell)으로 기간 길이 무관. 광대역 원본 단위라 등급 없이 사실만
    var acRms = (det.raw && det.raw.values.length) ? (function (a) {
      var m = 0, i; for (i = 0; i < a.length; i++) m += a[i]; m /= a.length;
      var ss = 0; for (i = 0; i < a.length; i++) { var d2 = a[i] - m; ss += d2 * d2; }
      return Math.sqrt(ss / a.length);
    })(det.raw.values) : null;
    var dw = VC.dwellWorst(roll, SENSOR_HOLD_MS, VC.DWELL_MIN_N);   // 지속 최악 창 — 상수(SENSOR_HOLD_MS)
    var dwTxt = dw
      ? E.fmt(dw.v) + ' ' + eq.unit + ' 이상이 ' + Math.round(dw.durMs / 60000) + '분 지속 (끝 ' + E.fmtDT(dw.ms) + ')'
        + (acRms != null && dw.v > acRms * 1.5 ? ' — 앵커 시점보다 나쁨, 그 구간을 보려면 기간을 좁히십시오' : '')
      : '표본 부족(연속 ' + VC.DWELL_MIN_N + '개 이상 필요)';
    return [
      '등급을 올린 축 ' + (g > 0 ? (srcKo[dx.gradeSrc] || dx.gradeSrc)
        : (dx.cov && (dx.cov.missing || []).indexOf('결함 패턴') >= 0)
          ? '없음(결함 패턴 미측정 — ' + ({ gate: '계측 이상', data: '이 구간 스펙트럼 없음', sleeve: '저널 베어링, 판정 대상 아님' }[dx.cov.patWhy] || '회전수·기하 확인') + ')'
          : '없음(결함 패턴 미검출)'),
      '진동/베어링 ' + (axTxt.join('  ·  ') || '대역 이탈 없음(또는 학습 전)'),
      '지속 최악 ' + dwTxt,
    ].join('  ·  ');
  }
  /* 상세분석 실측 1×로 입력 회전수 저장 — 그 키만 즉시 저장(편집 중인 다른 설비 값은 유지), 저장 뒤 재적재(eq.rpm·상세 캐시 갱신)
     서버 감시·대역 추출은 다음 점검(10초)에 새 회전수로 다시 등록 */
  _setRpmFromMeas(eq, rpm) {
    var self = this;
    // 종동측 센서 — 잰 1×는 종동축 회전수라 모터 RPM이 아닌 종동축 회전수 칸에 저장
    if (eq.rpmSrc === 'pulley' || eq.rpmSrc === 'measured') {
      var put = function (src) {
        var m = Object.assign({}, src || {}), g = Object.assign({}, m[eq.id]);
        g.belt = Object.assign({}, g.belt, { drivenRpm: rpm }); m[eq.id] = g; return m;
      };
      return this._applyNow({ equipMeta: put(this._ac().equipMeta) }).then(function (ok) {
        if (!ok) return false;
        self.setState({ equipMeta: put(self.state.equipMeta) });
        self._toast((eq.alias || eq.name) + ' 종동축 회전수를 ' + rpm + ' rpm으로 저장했습니다 — 측정 시점 부하 기준');
        self._reloadLive(true);
        return true;
      });
    }
    var applied = Object.assign({}, this._ac().equipRpm || {}), draft = Object.assign({}, this.state.equipRpm || {});
    applied[eq.id] = String(rpm); draft[eq.id] = String(rpm);
    return this._applyNow({ equipRpm: applied }).then(function (ok) {
      if (!ok) return false;
      self.setState({ equipRpm: draft });
      self._toast((eq.alias || eq.name) + ' 회전수를 ' + rpm + ' rpm으로 저장했습니다 — 측정 시점 부하 기준');
      self._reloadLive(true);
      return true;
    });
  }
  /* ISO 판정값 표기 — 원본 단위(같은 10~1000 Hz 대역 RMS). 가속도·변위 설비는 존 판정만 속도 환산(det.isoRms)
     환산값에 원본 단위를 붙이면 틀린 숫자 — 원본 값이 없으면 환산값을 속도 단위로 */
  _isoDisp(eq, det) {
    var E = this.E, nat = !!(eq.unit && eq.unit !== 'mm/s');
    if (!nat) return det.isoRms != null ? E.fmt(det.isoRms) + ' mm/s' : '';
    if (det.isoRaw != null && isFinite(det.isoRaw)) return E.fmt(det.isoRaw) + ' ' + eq.unit;
    return det.isoRms != null ? E.fmt(det.isoRms) + ' mm/s(속도 환산)' : '';
  }
  // 변화율 꼬리표 — 등급 대신 비교 성립 여부·기준 초과
  _trendTag(t) {
    if (!t || !t.winOk) return ' · 관측 60분 미만(비교 안 함)';
    if (!t.cmp) return ' · 비교 불가(운전 상태 변화)';
    return t.over ? ' · ×2 초과' : '';
  }
  /* 기간 지표 카드 4장 — 상세분석·리포트 공용(값·등급은 VC.sevMetrics, 여기선 서식·각주만), 반환은 중립 모양
     stepSec: 실제 롤업 단위 — 라벨에 반영(기간에 따라 초·분·시간) */
  _sevCards(m, unit, held, stepSec) {
    var E = this.E, n = m.n;
    var _rollTxt = (function (s) {
      s = Math.round(s || 1);
      return s >= 86400 ? (s / 86400) + '일' : s >= 3600 ? (s / 3600) + '시간' : s >= 60 ? (s / 60) + '분' : s + '초';
    })(stepSec);
    // 등급 없는 카드엔 배지·화살표 없음 — 배지는 예외(계측 게이트 '잠정', '충격성 강함')일 때만
    var mk = function (label, d, u, prefix) {
      var noGrade = d.graded === false, over = !noGrade && d.value > d.thr;
      return { label: label, grade: d.grade, note: !!d.note,
        badgeKo: d.badge || (noGrade ? '' : E.STATUS[d.grade].ko), override: !!d.badge || noGrade,
        valueText: (prefix || '') + E.fmt(d.value), unit: u || '',
        thrText: '기준 < ' + (prefix || '') + E.fmt(d.thr),
        over: over, arrow: noGrade ? '' : (over ? '▲' : '▼'),
        deltaText: noGrade ? '' : E.fmt(Math.abs(d.value - d.thr)), foot2: '' };
    };
    var c = [
      mk('평균 RMS · ' + _rollTxt + ' 롤업(광대역)', m.avg, unit),
      mk('P95 RMS · ' + _rollTxt + ' 롤업(광대역)', m.p95, unit),
      mk('Crest P95 · ' + _rollTxt + ' 롤업', m.crest, ''),
      mk('변화율 (최근 1/4 ÷ 직전 1/4)', m.trend, '', '×'),
    ];
    c[0].foot2 = 'ISO 판정은 별도(10–1000 Hz 대역제한) — 이 값은 광대역 감시용 · 평균은 조용한 구간이 고진동을 희석하므로 등급 없음';
    // 최댓값은 등급 없이 사실만, 발생 횟수 병기
    c[1].foot2 = '최댓값 ' + E.fmt(n.wMax) + ' ' + unit + '(등급 없음) · 광대역 B/C 초과 ' + n.overBC + '/' + n.buckets + '버킷';
    var _cArt = m.crest.artifact || 15;
    c[2].foot2 = '기준 = √(2·ln N) + 1 = ' + n.cThr.toFixed(1) + ' (N=버킷당 ' + this._num(n.perBucket) + '샘플, 잡음만으로는 거의 안 넘는 값) · 최댓값 ' + n.wCrest.toFixed(1)
      + (n.wCrest > _cArt && m.crest.value <= _cArt ? ' — 최댓값은 아티팩트 경계(' + _cArt + ') 초과 · 단발 계측 잡음 가능' : '')
      + (m.crest.impOk ? '' : ' · 버킷이 10초보다 길어 부하 변동이 섞임 — 충격성은 판단하지 않습니다');
    // 변화율 — 등급 없음, 비교가 성립할 때만 기준(×2) 대조
    if (!m.trend.winOk) c[3].thrText = '관측 ' + Math.round(n.durMin) + '분 — 기준선 없음(정상상태·동일 계측조건 전제 미충족)';
    else if (!m.trend.cmp) c[3].thrText = '운전 상태 변화 포함 — 비교 불가(정지·기동 구간이 섞임)';
    // 계측 사유가 값을 튼 방향을 해당 카드에 기재 — 클리핑은 Crest·진폭 과소, DC 드리프트는 RMS 과대
    if (held && held.key === 'clip') {
      c[2].foot2 = '클리핑은 꼭대기를 잘라 Crest를 낮춥니다 — 이 값이 낮은 것은 정상이라는 뜻이 아닙니다';
      c[1].foot2 = c[1].foot2 + ' · 클리핑으로 진폭이 과소일 수 있습니다';
    } else if (held && held.key === 'dc') {
      c[0].foot2 = 'DC 드리프트로 기준선이 어긋나 RMS가 과대일 수 있습니다 — 계측 확인 후 재평가';
    }
    return c;
  }
  _genOne(eq, run) {
    var self = this, S = this.state, E = this.E, LA = this._ac();   // LA: 적용된 설정(LLM 모델 표기)
    var live = function () { if (self._genRun !== run) throw { __abort: true }; }; // 중단된 실행이면 여기서 끝
    this.setState({ genStep: 0 });
    // 리포트도 선택 기간의 롤업을 직접 조회(렌더용 비동기 캐시에 의존하지 않음)
    return this._rollForAsync(eq, 'report').then(function (rf) {
    live();
    var roll = rf.roll;
    // 표본 없으면 건너뜀(실패 아님) — 기간 선택 단계는 전체 범위 겹침만 확인해 중간 공백 구간 통과 가능
    if (!roll.length) { var e0 = new Error('선택 기간에 표본이 없습니다'); e0.__nodata = true; throw e0; }
    var anchor = rf.toMs || eq.lastSeen; // 리포트 스펙트럼도 리포트 기간 끝 기준
    var vu = self.state.viewUnit || null; // 리포트도 현재 표시 물리량(가속도/속도/변위)으로 생성
    var c = self._detailCache[eq.id];
    var _pick = c && c.pick;   // 캐시 사용 시 화면이 고른 앵커 승계
    // 캐시 히트는 요청 창 기준 — 앵커 비교면 스윕이 옮긴 앵커와 항상 불일치
    var detP = (c && c.state === 'ready' && c.reqFrom === rf.fromMs && c.reqTo === anchor && c.viewUnit === vu)
      ? Promise.resolve(c.det)
      : self._detailAt(eq, rf.fromMs, anchor, vu, true).then(function (r) { _pick = r.pick; return r.det; });
    // 이 태그에 실제 적용된 구간 — 프리셋은 태그별로 창을 다시 잡아 genFrom/genTo 그대로 사용 불가
    var winFrom = rf.fromMs ? E.fmtDT(rf.fromMs) : S.genFrom;
    var winTo = rf.toMs ? E.fmtDT(rf.toMs) : S.genTo;
    var trP = loadTrendChunks(E, eq, roll).catch(function () { return { kurt: [], bands: [], xLabels: [] }; });
    return Promise.all([detP, trP, self._logoDataURL(), self._chartLibSrc()]).then(function (rr) {
      live();
      var det = rr[0], tr = rr[1], logo = rr[2], chartSrc = rr[3];
      // 진단이 같은 상세를 보도록 캐시 시드 — 기존 스냅샷 프리즈(eqSnap/snapNow)는 보존
      self._detailCache[eq.id] = Object.assign(
        self._detailCache[eq.id] || { eqSnap: Object.assign({}, eq), snapNow: (self.data && self.data.now) || Date.now() },
        { state: 'ready', det: det, anchor: anchor, viewUnit: vu });
      self.setState({ genStep: 1 });
      // 기간 지표 — 상세분석과 같은 VC.sevMetrics, 판정 문구가 Crest를 인용하므로 판정보다 먼저 계산
      var _held = VC.gateReason(det.quality, null);   // 분석 창 기준(감시 상태는 별도 행)
      var _gate = !!_held;
      var m = VC.sevMetrics(roll, { zones: eq.zones, fs: eq.fs, gate: _gate });
      var dx = self._dx(eq, det, m);   // 리포트 앵커 det 그대로(재조회 시 캐시 폐기)
      var n = m.n, wAvg = n.wAvg, wMax = n.wMax, wMin = n.wMin, wTrend = n.wTrend, cnt = n.cnt;
      var rP95 = m.p95.value, cP95 = m.crest.value;
      // 차트 계열용 원시 배열 — 지표(m)와 달리 버킷 그대로
      var rms = roll.map(function (r) { return r.rms; });
      var p2pV = roll.map(function (r) { return r.p2p; });
      var crestA = roll.map(function (r) { return r.crest; });
      var sevCards = self._sevCards(m, eq.unit, _held, rf.stepSec).map(function (c) {
        return { label: c.label, badgeKo: c.badgeKo, value: c.valueText, unit: c.unit,
          thr: c.thrText, over: c.over, arrow: c.arrow, delta: c.deltaText, foot2: c.foot2 };
      });
      /* 통계 요약은 진단용 값만 — COUNT/AVG/MIN/MAX는 스펙 패널 중복, 표준편차는 스파이크 지배라 제외
         등급 근거인 ISO 판정값(속도) 행 포함 — 나머지 통계는 원본 단위 광대역 */
      var _rzIso = self._isoZones(eq);
      // 칸에는 값만(한 줄), 문장형 근거는 statSummary로 — 화면과 같은 규칙
      var _isoRpt = det.isoRms != null
        ? self._isoDisp(eq, det) + ' · Class ' + eq.cls + ' ' + ['A 양호', 'B 주의', 'C 위험', 'D 심각'][VC.gradeFor(det.isoRms, _rzIso)]
          + (eq.unit && eq.unit !== 'mm/s' ? ' (존 판정은 속도 환산)' : '')
        : '계산 불가';
      var statSummary = self._statSummary(eq, det, dx, roll)
        + (det.isoRms != null && det.isoBlocks > 1 ? '  ·  ISO 판정값 ' + det.isoBlocks + '블록 평균' : '')
        + (det.isoRms == null ? '  ·  ISO 판정값 계산 불가 — 원시 파형 없음' : '');
      var stats = [
        { k: 'ISO 판정값 (등급 근거)', v: _isoRpt },
        { k: '광대역 RMS (등급 없음)', v: '중앙 ' + E.fmt(n.rMed) + ' · P95 ' + E.fmt(rP95) + ' ' + eq.unit },
        { k: 'Crest P95', v: cP95.toFixed(2) + ' (기준 ' + n.cThr.toFixed(1) + ')' },
        { k: '변화율', v: '×' + wTrend.toFixed(2) + self._trendTag(m.trend) },
        { k: '관측 창', v: Math.round(n.durMin) + '분 · ' + n.buckets + '버킷' },
        { k: '광대역 B/C 초과', v: n.overBC + ' (' + (n.buckets ? (n.overBC / n.buckets * 100).toFixed(1) : '0') + '%) · 기준 ' + E.fmt(eq.zones[1]) + ' ' + eq.unit },
      ];
      var specs = [
        { k: '데이터 건수', v: self._num(cnt), unit: '건' },
        { k: '표시 구간', v: self._rangeText(roll, winFrom + ' ~ ' + winTo, rf) },
        { k: '샘플레이트', v: (det.raw.fs / 1000).toFixed(2), unit: 'kHz' },
        { k: '롤업 단위', v: rf.label },
      ];

      self.setState({ genStep: 2 });
      var _rptSat = self._kurtSat(eq); // 첨도 포화 판정을 소견·리포트에 함께
      var _ev = self._evidence(eq, det); // 근거표·음성 소견·미설명 성분을 리포트에도 결정론적으로 인쇄
      var opP = self._reportOpinion(eq, det, dx, _rptSat, winFrom, winTo);

      return opP.then(function (opinion) {
        live(); // 중단됐으면 소견도 폐기
        self.setState({ genStep: 3 });
        // 차트는 데이터+엔진 내장 — 저장된 문서에서 캔버스 실시간 렌더(줌/툴팁/테마)
        var useClock = rf.clock;
        var xL = roll.map(function (r) { return useClock ? E.fmtClock(r.ms) : E.fmtMD(r.ms); });
        var xT = roll.map(function (r) { return E.fmtDT(r.ms); });
        var refs = [
          { val: eq.zones[0], color: '#3aa76d', label: 'A/B ' + E.fmt(eq.zones[0]) },
          { val: eq.zones[1], color: '#d99a2b', label: 'B/C ' + E.fmt(eq.zones[1]) },
          { val: eq.zones[2], color: '#e07b39', label: 'C/D ' + E.fmt(eq.zones[2]) },
        ];
        var kxl = (tr.xLabels && tr.xLabels.length) ? tr.xLabels : xL;
        // 차트 계열(롤업·추세 청크 의존)만 여기서, 나머지는 _reportMeta(검증 하네스와 공용)
        var data = Object.assign({
          refs: refs, xL: xL, xT: xT, kxl: kxl,
          rms: rms.length ? rms : null,
          p2p: rms.length ? p2pV : null,
          crest: rms.length ? crestA : null,
          kurt: (tr.kurt && tr.kurt.length) ? tr.kurt : null,
          bands: (tr.bands && tr.bands.length && tr.bands[0].vals.length) ? tr.bands : null,
        }, self._reportMeta(eq, det, _ev, _rptSat, dx));

        var genMs = Date.now();
        var ts = CH.fmtFull(genMs).slice(0, 19).replace(/[-:]/g, '').replace(' ', '_');
        var docNo = 'VBR-' + ts.replace('_', '-');
        var html = Report.buildReportHTML({
          docNo: docNo, alias: eq.alias || eq.name, tagName: eq.table + ' · ' + eq.name,
          generatedText: E.fmtDT(genMs) + ' (' + (CH.zoneName() || CH.offsetLabel(genMs)) + ')', logoDataURL: logo,
          specs: specs, sevMachine: eq.name + ' · Class ' + eq.cls + ' · ' + self._rpmText(eq) + (det.frMeas ? ' (실측 ' + Math.round(det.frMeas.rpm) + ')' : ''),
          gradeKo: dx.gradeKo, gradeColor: dx.color,
          zones: [E.fmt(_rzIso[0]), E.fmt(_rzIso[1]), E.fmt(_rzIso[2])], zonesUnit: 'mm/s', gradeIdx: dx.gi,
          verdict: dx.verdict,
          // 헤드라인용 판정 값(리포트는 재판정 없이 인쇄) — patOn=결함 패턴 켜짐 · patNa=측정 불가 · isoOnly=등급 미반영 고 ISO 존
          judge: {
            patOn: !!dx.patGi, patNa: !!(dx.cov && (dx.cov.missing || []).indexOf('결함 패턴') >= 0), patWhy: (dx.cov && dx.cov.patWhy) || '',
            isoGi: dx.isoGi != null ? dx.isoGi : null, isoOnly: dx.isoOnly || 0,
            site: (_ev && _ev.top && _ev.top.f) ? _ev.top.f : '',
            score: (_ev && _ev.top && _ev.top.score != null) ? _ev.top.score : null,
            isoRms: det.isoRms != null ? E.fmt(det.isoRms) : '',
          },
          // 스펙트럼 시점 문장 — 화면과 같은 문구
          anchorNote: self._anchorNote({ anchor: (_pick && _pick.at) || anchor, pick: _pick }),
          // 커버리지 기재 — 근거보다 강한 '양호' 주장 방지
          verdictSub: dx.sub + (dx.cov && dx.cov.n < dx.cov.total
            ? ' · 판정 기준 ' + dx.cov.n + '/' + dx.cov.total + '(' + dx.cov.missing.join('·') + ' 미적용)'
            : (dx.cov && dx.cov.extra && dx.cov.extra.length ? ' · 평소 대비 판정 적용(' + dx.cov.extra.join('·') + ')' : '')),
          sevCards: sevCards, stats: stats, statSummary: statSummary,
          indics: det.indics,
          opinion: opinion, opinionModel: opinion ? ((LA.llmModels || {})[LA.llmProvider] || LA.llmProvider) : null,
          actions: dx.actions,
          data: Object.assign({ tz: CH.zoneName() }, data), chartLibSrc: chartSrc,
          // 재현성 도장 모델명은 소견을 실제로 낸 경우만
          build: self._reportBuild(eq, det, docNo,
            opinion ? String((LA.llmModels || {})[LA.llmProvider] || LA.llmProvider).replace(':', ' ').replace(/(\d+)\s*b$/i, '$1B') : ''),
          fftHint: det.fft.freqs.length ? '해상도 ' + det.fft.res.toFixed(2) + ' Hz' : '',
          waveDesc: det.raw.values.length ? (det.raw.fs / 1000).toFixed(2) + ' kHz 캡처 · 분석 창 ' + (det.anaSec ? det.anaSec.toFixed(1) : '?') + '초(최신 시점 앵커) — 이 창의 지표는 3분 추세 평균과 다른 값' : '',
          envDesc: det.envelope.hint, cepDesc: det.cepstrum.note,
        });
        // 파일명은 짧게(태그_생성일시) — 기간·별칭·LLM 여부는 .index.json에 기록해 보관함 컬럼 유지
        var fname = eq.name.replace(/[^A-Za-z0-9._-]/g, '-') + '_' + ts + '.html';
        live(); // 쓰기 직전 중단 확인
        return saveFile(reportDir() + '/' + fname, html, 'text/html').then(function () {
          return self._updateReportIndex(function (idx) {
            idx[fname] = { tag: eq.alias || eq.name, from: winFrom, to: winTo, llm: !!opinion, ms: genMs };
          });
        });
      });
    });
    });
  }
  /* 리포트용 LLM 소견 — 끔·미설정·실패·빈 응답 모두 null, 실패 셋은 _genLlmErr에 사유 기록(결정론 소견이 LLM 소견으로 오인되는 것 방지)
     소견 없어도 리포트는 생성 */
  _reportOpinion(eq, det, dx, sat, winFrom, winTo) {
    var self = this, S = this.state;
    if (!S.genLLM) return Promise.resolve(null);
    // 프로바이더 미선택·API 키 없음 — 호출이 없어 catch에 안 걸리므로 별도 처리
    var llm = LLM.createLLM(this._llmCfg());
    if (!llm) { this._genLlmErr = 'LLM 미설정 — 설정 → LLM 연동에서 프로바이더와 API 키를 확인하세요'; return Promise.resolve(null); }
    return llm.complete(this._opinionPrompt(eq, det, dx, sat) + '\n[조회 기간] ' + winFrom + ' ~ ' + winTo,
      { signal: this._genAC && this._genAC.signal })
      // 빈 응답('')은 예외가 아니므로 여기서 실패 처리
      .then(function (txt) {
        var s = String(txt == null ? '' : txt).trim();
        if (s) return s;
        self._genLlmErr = '모델이 빈 응답을 반환했습니다 — 모델명이 올바른지 확인하세요';
        return null;
      })
      .catch(function (e) {
        if (!(e && e.__abort)) self._genLlmErr = String((e && e.message) || e);
        console.warn('[vibe] report opinion failed', e);
        return null;
      });
  }
  /* 리포트 data 중 eq·det·근거로 정해지는 부분(요약 블록·ISO·재현성 바 등) — _genOne·검증 하네스 공용(필드 불일치 방지)
     차트 계열은 롤업·추세 청크 의존이라 _genOne 담당
     dx 사용 — 조치 카드가 화면과 같은 등급으로 갈리도록 */
  _reportMeta(eq, det, ev, rptSat, dx) {
    var self = this, E = this.E;
    var roll = eq.rollup || [];
    // 지표는 화면·리포트와 같은 함수(VC.sevMetrics)
    var _m = VC.sevMetrics(roll, { zones: eq.zones, fs: eq.fs, gate: !!(det.quality && det.quality.gate) });
    var cP95 = _m.crest.value, cThr = _m.n.cThr, nTot = _m.n.perBucket;
    var wAvg = _m.n.wAvg, _durMinT = _m.n.durMin;
    return {
      unit: eq.unit, dispUnit: det.dispUnit, natUnit: det.natUnit,
      wave: det.raw.values.length ? { t: det.raw.times_ms.map(function (m) { return m.toFixed(0); }), v: det.raw.values } : null,
      fft: det.fft.freqs.length ? { freqs: det.fft.freqs, mags: det.fft.mags, markers: det.fft.markers, res: det.fft.res } : null,
      spec: det.spectro.rows ? det.spectro : null,
      env: det.envelope.freqs.length ? { freqs: det.envelope.freqs, mags: det.envelope.mags, markers: det.envelope.markers, hint: det.envelope.hint } : null,
      cep: det.cepstrum.freqs.length ? { freqs: det.cepstrum.freqs, mags: det.cepstrum.mags, markers: det.cepstrum.markers } : null,
      kurtogram: (det.kurtogram && det.kurtogram.freqs.length) ? { freqs: det.kurtogram.freqs, mags: det.kurtogram.mags, markers: det.kurtogram.markers, res: det.kurtogram.res, best: det.kurtogram.best } : null,
      // 참고 사유(일정한 DC 등)만 있어도 전달 — 경고·참고 구분은 리포트가
      quality: (det.quality && (det.quality.issues || []).length) ? det.quality : null,
      kurtWarn: rptSat && rptSat.flag ? rptSat.msg : null,
      levels: det.levels, isoUnit: eq.unit, isoZoneBC: E.fmt(eq.zones[1]),
      evidence: ev.conf, evidWeak: !!ev.weakTop, negatives: ev.negatives, unexplained: ev.unexplained, missing: ev.missing, acq: ev.acq,
      // 대역 이탈도 본문에 기재 — ISO 대역 분배(1 kHz까지)·결함 대역 탐색에서 빠진 마운팅 상한 위 대역 포함
      bandDev: (ev.bandDev && ev.bandDev.length)
        ? { rows: ev.bandDev.map(function (d) { return { ko: d.ko, v: E.fmt(d.v), lim: E.fmt(d.lim), r: d.r.toFixed(2), over: d.r > 1, soft: d.soft }; }),
          mount: ev.mount, fmaxKHz: ev.mountFmax > 0 ? (ev.mountFmax / 1000).toFixed(1) : '' }
        : null,
      // 요약 모드(30초 판독용) — 첫 줄은 게이트 상태별, 측정 불가·음성 소견·미설명은 항상 인쇄
      summary: (function () {
        var kurtW = 0; (det.indics || []).forEach(function (x) { if (/Kurtosis|커토시스/.test(x.k)) kurtW = parseFloat(x.v) || 0; });
        var scored = ev.conf.filter(function (c) { return !c.na; });
        var gateReasonTxt = 'Crest P95 ' + cP95.toFixed(2) + ' · 파형 첨도 ' + kurtW.toFixed(1) + ' (기준 ' + cThr.toFixed(1) + ' = √(2·ln ' + self._num(nTot) + ') + 1)';
        return {
          gate: !!(det.quality && det.quality.gate),
          gateReason: gateReasonTxt,
          gateCap: GATE_CAP,
          cands: scored.slice(0, 3).map(function (c) { return { f: c.f, score: c.score, s: c.s, why: (c.tags && c.tags.length ? c.tags[0] : c.why) }; }),
          unmeasurable: ev.conf.filter(function (c) { return c.na; }).map(function (c) { return { f: c.f, why: c.caveat || '' }; }),
          rpmTxt: det.frMeas ? Math.round(det.frMeas.rpm) + ' ± ' + Math.round(det.frMeas.rpmTol || 0) + ' rpm (' + (eq.rpmSrc === 'pulley' || eq.rpmSrc === 'measured' ? self._rpmText(eq) : '명판 ' + eq.rpm) + ')' : (eq.rpmSrc === 'pulley' || eq.rpmSrc === 'measured' ? self._rpmText(eq) : '명판 ' + eq.rpm + ' rpm') + ' (실측 피크 없음)',
          obsTxt: Math.round(_durMinT) + '분 · ' + roll.length + '버킷',
          acqTxt: '8초 창 · 0.125 Hz · Hanning 50% 중첩 · 8회 평균',
          // 조치 카드 1장 — 근거 줄엔 등급 대신 값·대역·평균 조건·경계까지 거리(등급으로 등급 설명은 순환)
          action: (function () {
            var isoOk2 = det.isoRms != null && eq.unit === 'mm/s';
            // 게이트 = 측정 상태 — A~D 팔레트 미사용(5번째 등급 오독 방지)
            if (det.quality && det.quality.gate) {
              return { kind: 'gate', cls: 'hold', icon: '⏸', title: '계측 검증 후 재측정 — 기계 상태 미판정',
                body: '센서 마운팅·케이블·커넥터를 점검하고 같은 지점에서 재측정하십시오. 이 리포트의 결함 판정은 운전 판단 근거가 아닙니다.',
                basis: gateReasonTxt + ' — 단발 스파이크 시그니처' };
            }
            if (!isoOk2) return null;
            // 결함 패턴 측정 불가 = 측정 상태 — ISO 값만으로 조치 지시 안 함
            var _covMiss = (dx && dx.cov && dx.cov.missing) || [];
            if (_covMiss.indexOf('결함 패턴') >= 0) {
              var _pw = dx.cov.patWhy;
              if (_pw === 'data') return { kind: 'nojudge', cls: 'hold', icon: '⏸', title: '판정 못 함 — 이 구간의 파형 부족',
                body: '스펙트럼을 만들 데이터가 부족해 베어링 상태를 판정하지 않았습니다. 다른 기간으로 다시 생성하십시오.',
                basis: 'ISO 대역제한 속도 RMS ' + E.fmt(det.isoRms) + ' mm/s — 이 값만으로는 베어링 상태를 말할 수 없습니다' };
              if (_pw === 'sleeve') return { kind: 'nojudge', cls: 'hold', icon: '⏸', title: '결함 패턴 판정 대상 아님 — 저널 베어링',
                body: '구름베어링 결함주파수가 없는 저널(sleeve) 베어링이라 결함 패턴으로 판정하지 않습니다. 진동 크기는 ISO 존으로 확인하십시오.',
                basis: 'ISO 대역제한 속도 RMS ' + E.fmt(det.isoRms) + ' mm/s' };
              return { kind: 'nojudge', cls: 'hold', icon: '⏸', title: '판정 못 함 — 회전수·베어링 정보 필요',
                body: '결함주파수 격자를 세울 수 없어 베어링 상태를 판정하지 않았습니다. 설정 → 설비 정보에 명판 회전수와 베어링 품번을 넣고 다시 생성하십시오.',
                basis: 'ISO 대역제한 속도 RMS ' + E.fmt(det.isoRms) + ' mm/s — 이 값만으로는 베어링 상태를 말할 수 없습니다' };
            }
            var x = det.isoRms, z = eq.zones;
            var _isoG = VC.gradeFor(x, z);
            // 카드는 화면과 같은 등급으로 선택 — ISO로 고르면 진폭만 높은 설비엔 과잉 조치, 저진폭 초기 결함엔 '계속 운전'
            var g = (dx && dx.gi != null) ? dx.gi : _isoG;
            var head = E.fmt(x) + ' mm/s · 10–1000 Hz · ' + (det.isoBlocks || 1) + '블록 평균 · Class ' + eq.cls;
            var crit2 = E.fmt(0.25 * z[1]);   // ISO Criterion II: B/C 경계의 25% 변화가 유의
            var card = [
              { cls: 'ok', icon: '🟢', title: '계속 운전',
                body: '현 측정 주기로 예방관리를 유지하십시오. 다음 측정에서 ' + crit2 + ' mm/s 이상 변하면 원인을 확인하십시오(ISO Criterion II).',
                basis: head + ' · A/B 경계 ' + E.fmt(z[0]) + ' 아래' },
              { cls: 'watch', icon: '🟡', title: '다음 정기 점검 시 확인',
                body: '운전을 계속하되 측정 주기를 유지하고, 다음 정기 점검에 정렬·체결·윤활 육안 확인을 넣으십시오.',
                basis: head + ' · C 경계 ' + E.fmt(z[1]) + '까지 ' + E.fmt(z[1] - x) + ' 남음(' + Math.round((z[1] - x) / z[1] * 100) + '%)' },
              { cls: 'plan', icon: '🟠', title: '계획 정지 시 점검 · 측정 주기 단축',
                body: '장기 운전 부적합 구간입니다. 다음 계획 정지에 점검을 배정하고, 그때까지 측정 주기를 단축해 추세를 감시하십시오.',
                basis: head + ' · D 경계 ' + E.fmt(z[2]) + '까지 ' + E.fmt(z[2] - x) + ' 남음' },
              { cls: 'urgent', icon: '🔴', title: '긴급 점검 · 설비 중요도에 따라 정지 검토',
                body: '점검 일정을 앞당기십시오. 정지 여부는 설비 중요도·예비기 유무·추가 증상(베어링 온도·이음·누유)과 함께 판단하십시오.',
                basis: head + ' · D 경계 ' + E.fmt(z[2]) + ' 초과' },
            ][g];
            // 다섯 번째 카드 — 등급 양호인데 ISO 존 초과(베어링 외 원인), 등급 팔레트 미사용(5번째 심각도 오독 방지)
            if (g === 0 && _isoG > 0) {
              var _bestR = (ev && ev.top && ev.top.score != null) ? ev.top.score : null;
              card = { cls: 'hold', icon: '🔵', title: '베어링 외 원인 점검 — 진폭 확인 필요',
                body: '베어링 결함주파수 자리에 근거가 서지 않아 등급을 올리지 않았습니다. 진동이 높은 것은 사실이므로'
                  + ' 정렬·체결·불평형을 육안·실측으로 확인하고, 필요하면 위상(타코)·축방향 측정을 의뢰하십시오'
                  + ' — 이 셋은 단일 채널·위상 없이는 원리적으로 판별할 수 없습니다.',
                basis: head + ' · ISO 존 ' + ['A', 'B', 'C', 'D'][_isoG] + '(' + E.STATUS[_isoG].ko + ')'
                  + (_bestR != null ? ' · 결함주파수 격자 미채택(최고 ' + _bestR.toFixed(1) + ')' : ' · 결함주파수 격자 미채택') };
            }
            card.kind = 'zone';
            // 블록간 변동 크면 경계 여유가 불확도 안 → 잠정(R10)
            if (Math.round((det.isoSpread || 1) * 100) / 100 >= 1.5) card.title += ' (잠정)';
            // 광대역 감시 등급이 더 높을 때만 부기 — 등급 근거 아님 명시
            if (eq.grade > g) card.aside = '광대역 감시는 ' + E.STATUS[eq.grade].ko + '(' + E.fmt(eq.rms) + ' ' + eq.unit + ') — 전체 에너지의 '
              + Math.round((det.hfEnergyFrac || 0) * 100) + '%가 10–1000 Hz 밖입니다. 등급이 아니라 알람 임계·협대역 감시 전환 검토 사항입니다.';
            return card;
          })(),
          // 게이트 편향 방향 — 가산형은 상한, 감산형은 하한 명시
          bias: (function () {
            var ks = ((det.quality && det.quality.issues) || []).map(function (i) { return i.key; });
            if (ks.indexOf('flatline') >= 0 || ks.indexOf('clip') >= 0 || ks.indexOf('sparse') >= 0)
              return '센서 정지·포화는 진폭을 과소 표시합니다 — 이 값은 하한, 실제는 이상일 수 있습니다.';
            if (ks.indexOf('spike') >= 0 || ks.indexOf('kurtx') >= 0)
              return '아티팩트는 에너지를 더하기만 합니다 — 이 값은 상한, 실제 기계 상태는 이하입니다.';
            return '';
          })(),
          // 1단계 검산 — 롤업 평균과 ISO 블록 평균이 크게 벌어지면 창 차이 명시
          winNote: (function () {
            if (!(det.isoRms > 0) || !(wAvg > 0)) return '';
            var r = det.isoRms / wAvg;
            if (r < 1.5 && r > 0.67) return '';
            return '롤업 평균 ' + E.fmt(wAvg) + ' 대비 ×' + r.toFixed(2) + ' — 창이 다릅니다(롤업=관측 ' + Math.round(_durMinT) + '분 전체, ISO=최신 시점 앵커 ' + (det.isoBlocks || 1) + '블록).';
          })(),
        };
      })(),
      // ISO 규격 판정(10–1000 Hz 대역제한)과 실시간 감시 등급(광대역)을 분리해 헤드라인 정합성 확보
      iso: (det.isoRms != null) ? (function () { var g = VC.gradeFor(det.isoRms, self._isoZones(eq)); return { rms: E.fmt(det.isoRms), disp: self._isoDisp(eq, det), conv: !!(eq.unit && eq.unit !== 'mm/s'), gradeIdx: g, gradeKo: E.STATUS[g].ko, color: E.STATUS[g].color, anaSec: det.anaSec ? det.anaSec.toFixed(1) : '',
        blocks: det.isoBlocks || 0, spread: det.isoSpread ? det.isoSpread.toFixed(2) : '', spreadWarn: Math.round((det.isoSpread || 1) * 100) / 100 >= 1.5 }; })() : null,
      levelsOk: det.levelsOk !== false, accelFeff: det.accelFeff || 0, accelNyqFrac: det.accelNyqFrac || 0,
      hfFrac: det.hfEnergyFrac || 0, velExHigh: det.velExHigh ? E.fmt(det.velExHigh) : '',
      velBB: det.levels ? E.fmt(det.levels['mm/s']) : '', anaSecTxt: det.anaSec ? det.anaSec.toFixed(1) : '',
      exHighSameZone: (det.velExHigh != null && det.isoRms != null) ? (VC.gradeFor(det.velExHigh, eq.zones) === VC.gradeFor(det.isoRms, eq.zones)) : null,
      exHighZoneKo: det.velExHigh != null ? E.STATUS[VC.gradeFor(det.velExHigh, eq.zones)].ko : '',
      parsevalOk: !det.parseval || det.parseval.ok !== false, parsevalErr: det.parseval ? (det.parseval.relErr * 100).toFixed(1) : '',
      // 감시 블록 — 현재 감시 판정값·근거를 리포트에 그대로 기재
      mon: (function () {
        var gs = (self._gradeState || {})[eq.table + ':' + eq.name] || {};
        var gi = self._severityOf(eq);
        // 원본 단위 표기 — 가속도·변위 설비의 gs.iso는 존 판정용 속도 환산값
        var _vi = (eq.unit && eq.unit !== 'mm/s') ? gs.isoRaw : gs.iso;
        var _viOk = _vi != null && isFinite(_vi);
        var v = _viOk ? _vi : eq.rms;
        return {
          rms: E.fmt(v), gradeKo: E.STATUS[gi].ko, color: E.STATUS[gi].color, unit: eq.unit,
          // 대역제한 미적용 사유 구분 — 샘플레이트 불명과 1 kHz 위 없음은 다름(불명인데 '성분 없음' 단언 방지)
          basis: (gs.limited && _viOk) ? 'ISO 10~1000 Hz 대역제한 구간 RMS'
            : gs.limited ? '전대역 구간 RMS(ISO 대역값 계산 전)'
            : (eq.fs > 0 ? '전대역 구간 RMS(샘플레이트 ' + self._num(eq.fs) + ' Hz — 1 kHz 위를 측정하지 않음)'
              : '전대역 구간 RMS(샘플레이트 불명 — 대역제한 미적용)'),
          // 등급 원인 축 — 정본 맵(GRADE_SRC_KO), 양호면 null(report.js가 행 제외)
          src: gi > 0 ? (GRADE_SRC_KO[gs.src] || GRADE_SRC_KO.iso) : null,
          wide: isFinite(gs.wide) ? E.fmt(gs.wide) : null,
        };
      })(),
      gate: !!(det.quality && det.quality.gate),
      rpmMeas: det.frMeas ? Math.round(det.frMeas.rpm) : null,
    };
  }
  // 리포트 재현성 정보 — 셀마다 핵심값(v) + 보조줄(subs)
  _reportBuild(eq, det, docNo, llmName) {
    var self = this, E = this.E;
    var blkN = det.acq ? Math.round((det.acq.blockSec || 0) * (det.ordSpec ? det.ordSpec.fsLo : 0)) : 0;
    return {
      cells: [
        { k: 'Analysis Engine', v: 'v' + (typeof __PKG_VERSION__ !== 'undefined' ? __PKG_VERSION__ : '0.0.0'),
          subs: ['Ruleset ' + VC.RULESET, 'Fingerprint ' + VC.rulesetFingerprint()] },
        { k: 'Standard', v: 'ISO 10816 Class ' + eq.cls,
          subs: ['Thresholds ' + eq.zones.map(function (z) { return E.fmt(z); }).join(' / ') + ' ' + eq.unit] },
        { k: 'Acquisition', v: blkN ? 'FFT ' + self._num(blkN) : '—',
          subs: det.acq ? [(det.acq.res || 0).toFixed(2) + ' Hz', 'Avg ×' + (det.acq.averages || 1) + ' · ISO ' + (det.acq.isoBlocks || 1) + '블록'] : [] },
        { k: 'LLM', v: llmName || '미사용', subs: llmName ? [] : ['규칙 기반만'] },
        { k: 'Report ID', v: docNo, subs: [], narrow: true },
      ],
    };
  }
  // 리포트에 내장할 차트 엔진 소스 (1회 로드 후 캐시)
  _chartLibSrc() {
    if (!this._chartSrcP) this._chartSrcP = chartLibSrc().catch(function () { return ''; });
    return this._chartSrcP;
  }
  // 헤더 로고를 dataURL로 임베드 (리포트는 자립 파일 — 외부 참조 금지)
  _logoDataURL() {
    var self = this;
    if (this._logoB64 !== undefined) return Promise.resolve(this._logoB64);
    return fetch('assets/logo_machbaseNeo_general_a.png')
      .then(function (r) { if (!r.ok) throw new Error('no logo'); return r.blob(); })
      .then(function (b) {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res(fr.result); };
          fr.onerror = function () { res(null); };
          fr.readAsDataURL(b);
        });
      })
      .catch(function () { return null; })
      .then(function (u) { self._logoB64 = u; return u; });
  }
  // 리포트 인덱스(.index.json) 읽기-수정-쓰기 — 파일명은 짧게 유지하고 메타는 여기에
  _updateReportIndex(mutate) {
    return readFileBlob(reportDir() + '/.index.json')
      .then(function (b) { return b.text(); }).then(function (t) { return JSON.parse(t); })
      .catch(function () { return {}; })
      .then(function (idx) {
        mutate(idx);
        return saveFile(reportDir() + '/.index.json', JSON.stringify(idx, null, 2), 'application/json');
      });
  }
  // 보관함 = vibration-reports/ 디렉터리 목록 + .index.json 메타 (구 RPT_ 파일명 인코딩도 지원)
  _loadReports() {
    var self = this;
    var mine = reportDir(), root = REPORT_ROOT;
    // 계정 폴더 선생성 — 없는 경로 조회 시 콘솔 404 잔류 방지(ensureDir은 세션당 1회)
    ensureDir(mine).catch(function () { });   // 실패해도 목록 조회 계속(사유는 저장 때 표시)
    function readIdx(d) {
      return readFileBlob(d + '/.index.json').then(function (b) { return b.text(); })
        .then(function (t) { return JSON.parse(t); }).catch(function () { return {}; });
    }
    /* .index.json은 리포트 파일이 있을 때만 직접 조회 — Neo 파일 목록은 점(.)으로 시작하는 파일을 빼고 줌(목록으로 존재 확인 불가).
       빈 폴더 조회 시 콘솔 404 방지, 메타 없으면 파일명 폴백 */
    function listOf(d) {
      return listDir(d).catch(function () { return []; }).then(function (children) {
        var has = (children || []).some(function (f) { return !f.isDir && /\.html$/i.test(f.name); });
        return (has ? readIdx(d) : Promise.resolve({})).then(function (idx) {
          return { dir: d, children: children, idx: idx };
        });
      });
    }
    var sources = [listOf(mine)];
    // 계정 폴더 이전 리포트도 읽음(같은 이름은 계정 폴더 우선) — 주인 불명이라 관리자(SYS)에게만
    if (mine !== root && this.state.user === 'SYS') sources.push(listOf(root));
    Promise.all(sources).then(function (sets) {
      function ymd(s) { return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
      var seen = {}, reps = [];
      sets.forEach(function (set) {
        (set.children || []).filter(function (f) { return !f.isDir && /\.html$/i.test(f.name); })
          .forEach(function (f) {
            if (seen[f.name]) return;
            seen[f.name] = 1;
            var meta = set.idx[f.name], ms = f.lastModifiedUnixMillis || 0;
            if (meta) {
              reps.push({ id: f.name, fname: f.name, dir: set.dir, ms: meta.ms || ms, tags: [meta.tag], period: meta.from + ' ~ ' + meta.to, llm: !!meta.llm });
              return;
            }
            var m = /^RPT_(.+)_(\d{8})-(\d{8})_(\d{8})_(\d{6})(_LLM)?\.html$/.exec(f.name); // 구버전 파일명
            reps.push({
              id: f.name, fname: f.name, dir: set.dir, ms: ms,
              tags: [m ? m[1] : f.name.replace(/\.html$/i, '')], period: m ? ymd(m[2]) + ' ~ ' + ymd(m[3]) : '-', llm: !!(m && m[6]),
            });
          });
      });
      reps.sort(function (a, b) { return b.ms - a.ms; });
      self.setState({ reports: reps });
    });
  }
  /* 리포트는 새 탭의 샌드박스 iframe에서 열기(REPORT_SANDBOX)
     - 파일 API는 계정 구분이 없어 남의 HTML이 섞일 수 있음 → allow-same-origin 없이 불투명 오리진(토큰·쿠키, 상위 창 이동·팝업 차단)
     - allow-scripts(차트·줌·툴팁)·allow-modals(인쇄) 허용, localStorage 차단이라 테마·보기 선택 미기억
     - 탭은 클릭 직후 동기 오픈(파일 수신 후 열면 팝업 차단) */
  _openReport(r) {
    var self = this;
    var w = window.open('', '_blank');
    if (!w) { this._toast('팝업이 차단되었습니다 — 브라우저에서 허용 후 다시 시도하세요', 'err'); return; }
    if (this._rvBlobUrl) { URL.revokeObjectURL(this._rvBlobUrl); this._rvBlobUrl = null; }
    readFileBlob((r.dir || reportDir()) + '/' + r.fname).then(function (blob) {
      // 서버 형식 무관하게 HTML로 해석(iframe 안에서만 렌더)
      self._rvBlobUrl = URL.createObjectURL(new Blob([blob], { type: 'text/html' }));
      var d = w.document;
      d.open();
      d.write(reportShell(r.fname, self._rvBlobUrl));
      d.close();
      // blob URL은 로드 후 회수(즉시 revoke 시 빈 화면)
      setTimeout(function () { if (self._rvBlobUrl) { URL.revokeObjectURL(self._rvBlobUrl); self._rvBlobUrl = null; } }, 60000);
    }).catch(function (e) {
      try { w.close(); } catch (e2) { /* 이미 닫힘 */ }
      self._toast('리포트 열기 실패: ' + (e && e.message || e), 'err');
    });
  }
  _delReport(id, dir) {
    var self = this;
    deleteFile((dir || reportDir()) + '/' + id)
      .then(function () { return self._updateReportIndex(function (idx) { delete idx[id]; }).catch(function () {}); })
      .then(function () { self._toast('리포트 삭제됨'); self._loadReports(); })
      .catch(function (e) { self._toast('삭제 실패: ' + (e && e.message || e), 'err'); });
  }
  // 헤더 알람 pill 토글 — 설정탭의 저장 버튼 흐름과 달리 즉시 적용·즉시 저장
  _toggleMonitorNow() {
    if (this._cfgLocked()) return;   // 켠 것처럼 보이나 미저장 상태 방지
    var self = this, on = !this._ac().monitorOn;
    this._applyNow({ monitorOn: on }).then(function (ok) {
      if (ok && on) self._judgeLive().then(function () { self._loadEventsLive(); }); // 켜는 즉시 1회 판정
    });
    this._toast(on ? '알람이 켜졌습니다' : '알람이 꺼졌습니다 — 등급은 계속 표시되지만 이벤트 기록과 알림은 멈춥니다', on ? 'ok' : 'warn');
  }
  _navTo(id) {
    if (this.state.tab === 'settings' && this.state.dirty && id !== 'settings') { this.setState({ pendingNav: id }); return; }
    // 설정탭 진입 시 테이블·태그 목록 최신화 (부팅 후 추가/삭제된 것 반영)
    if (id === 'settings' && this.live) {
      var self = this;
      listTagTables().then(function (t) { self.liveTables = t; self._loadSchemas(); self.forceUpdate(); }).catch(function () {});
      this._ensureTags(this.state.srcSel, true);
      // 별칭 편집 누적 줄 수는 진입 시 초기화(검색어는 유지)
      this.setState({ aliasShown: ALIAS_ROWS_MAX });
    }
    this.setState({ tab: id });
    this._scrollTop();
  }
  _scrollTop() { setTimeout(function () { var m = document.querySelector('main'); if (m) m.scrollTop = 0; }, 30); }
  _confirmNav(action) { var self = this; var p = this.state.pendingNav; if (action === 'save') { this.setState({ pendingNav: null }); this._persistCfg().then(function (ok) { if (!ok) return; self.setState({ dirty: false, tab: p }); self._toast('설정이 저장되었습니다'); if (self.live) self._reloadLive(); }); } else if (action === 'discard') { this._discardEdits({ tab: p, pendingNav: null }); } else { this.setState({ pendingNav: null }); } }
  _markDirty() { if (!this.state.dirty) this.setState({ dirty: true }); }
  // 저장 안 함 — 폼 편집을 적용본으로 되돌림(표시만 지우면 편집값이 다음 저장에 포함)
  _discardEdits(extra) {
    var A = this._ac(), back = Object.assign({ dirty: false, equipBulk: null }, extra || {});
    if (this._applied) FORM_KEYS.forEach(function (k) { back[k] = cfgClone(A[k]); });
    this.setState(back);
  }
  _saveSettings() {
    var self = this;
    this._persistCfg().then(function (ok) {
      if (!ok) return;                      // 실패 사유는 _persistCfg가 표시, dirty 유지
      self.setState({ dirty: false });
      self._toast('설정이 저장되었습니다');
      if (self.live) self._reloadLive();
    });
  }
  // 알림 설정(채널·라우팅) — 서버 감시와 같은 notifyCfgFrom으로 해석(미설정 심각도는 기본값)
  _notifyCfg() {
    var C = this._ac();   // 적용된 설정 — 폼의 미저장 편집 배제
    var S = this.state;
    return Notify.notifyCfgFrom({ notifCh: C.notifCh, notifTo: C.notifTo, routes: C.routes }, ROUTE_DEFS);
  }
  /* 발송 대기열 — 실제 발송은 회차 종료 후 _flushNotify가 일괄 처리
     폭주 방지 2겹: 상태머신(시간축) + 묶음(같은 순간 동시 다발) */
  _queueNotify(eq, ev, val, lim, nowMs) {
    if (!this._notifyQ) this._notifyQ = [];
    this._notifyQ.push({
      alias: eq.alias || eq.name, tag: eq.name, table: eq.table,
      typeKo: TYPEKO[ev.etype] || ev.etype, gradeKo: GRADE_WORDS[ev.gi],
      // etype·detail — 유형별 값 줄 형식 결정(계측 이상은 사유만)
      etype: ev.etype, detail: ev._detail || ev.detail || '',
      val: val, lim: lim, unit: eq.unit, timeText: this.E.fmtDT(nowMs || Date.now()),
    });
  }
  // 회차 발송 — 거르기·묶기는 notify 담당(서버 타이머도 같은 함수 임베드)
  _flushNotify(nowMs) {
    var q = this._notifyQ;
    this._notifyQ = null;
    if (!q || !q.length) return;
    var cfg = this._notifyCfg(), to = cfg.channels.webhook.to;
    if (!to) return;
    var msgs = Notify.planNotifications(q, cfg, 'webhook', this.E.fmtDT(nowMs || Date.now()));
    msgs.forEach(function (msg) {
      runTql(Notify.buildWebhookTql(to, Notify.payloadFor(msg, to))).catch(function () {});
    });
  }
  // 채널 테스트 발송 — 알람을 기다리지 않고 설정을 즉시 검증. 발송은 서버(TQL $.request)에서 수행.
  _testNotify(ch) {
    var self = this, to = (this.state.notifTo || {})[ch];
    if (!to) return;
    this.setState({ notifTesting: ch, notifTest: null });
    var msg = Notify.eventMessage({
      alias: '테스트 알림', tag: 'TEST', typeKo: '연결 테스트', gradeKo: '주의',
      val: 1.23, lim: 1.12, unit: 'mm/s', timeText: this.E.fmtDT(Date.now()),
    });
    runTql(Notify.buildWebhookTql(to, Notify.payloadFor(msg, to))).then(function (t) {
      var out = String(t || '').trim();
      var ok = /^OK\b/.test(out);
      self.setState({ notifTesting: null, notifTest: { ch: ch, ok: ok, msg: ok ? '발송 성공 — 수신함을 확인하세요' : '발송 실패 (' + (out || '응답 없음').slice(0, 60) + ')' } });
      self._toast(ok ? '테스트 알림을 보냈습니다' : '테스트 발송 실패', ok ? 'ok' : 'err');
    }).catch(function (e) {
      self.setState({ notifTesting: null, notifTest: { ch: ch, ok: false, msg: '발송 실패: ' + (e.message || e) } });
      self._toast('테스트 발송 실패', 'err');
    });
  }
  _testLLM() {
    var self = this;
    this.setState({ llmTesting: true, llmTest: null });
    LLM.testConnection(this._llmCfg(this.state)).then(function (r) {   // 저장 전 입력값 확인용 — 편집본
      self.setState({ llmTesting: false, llmTest: { ok: true, msg: '응답 ' + r.ms + 'ms · "' + r.sample + '"' }, llmConfigured: true });
      self._toast('LLM 연결 성공');
    }).catch(function (e) {
      self.setState({ llmTesting: false, llmTest: { ok: false, msg: String(e && e.message || e) }, llmConfigured: false });
      self._toast('LLM 연결 실패', 'err');
    });
  }
  renderVals() {
    var self = this, S = this.state, E = this.E, isL = S.theme === 'light';
    var AC = this._ac();   // 헤더·모니터링은 적용 설정 표시(폼 미저장 변경 배제)
    var base = {
      rootClass: isL ? 'theme-light' : '',
      themeIcon: 'color-mode',
      logoFilter: isL ? '' : 'filter: brightness(1.15);',
      monitorText: AC.monitorOn ? 'ON' : 'OFF',
      monitorDotColor: AC.monitorOn ? '#3aa76d' : '#6c7079',
      monitorDotRing: AC.monitorOn ? 'rgba(58,167,109,.18)' : 'rgba(120,120,120,.15)',
      // 알람 ON일 때 감시 방식 배지 — 서버 상시(앱 닫아도 동작) / 앱(열린 동안만)
      monModeBadgeShow: AC.monitorOn,
      // 앱 모드 표시 탭 — 판정·알림은 같은 계정의 담당 탭(또는 PC)이 맡음
      monModeBadgeText: AC.monMode === 'server' ? '서버 상시' : (this._isLead() ? '앱' : '앱 · 보기 전용'),
      // 두 모드 모두 파란 배지 — 문구('서버 상시'/'앱')로 구분되므로 색은 통일
      monModeBadgeStyle: 'font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; color: var(--primary-light); background: rgba(0,108,210,.14); border: 1px solid rgba(0,108,210,.3);',
      monPillTitle: AC.monitorOn
        ? (AC.monMode === 'server' ? '서버 상시 감시 — 앱을 닫아도 Neo 타이머가 계속 감지합니다'
          : this._isLead() ? '앱 감시 — 앱이 열려 있는 동안만 감지합니다'
            : '앱 감시 — 같은 계정의 다른 탭(또는 PC)이 판정·알림을 맡고 이 탭은 결과만 표시합니다. 그 탭이 닫히면 1분 안에 이 탭이 이어받습니다')
        : '클릭하여 알람 켜기/끄기',
      // 다른 계정으로 로그인됨 — 이 탭 쓰기 중단·새로고침 안내(원래 계정으로 돌아오면 사라짐)
      idSwitchShow: !!S.idSwitch,
      idSwitchTo: S.idSwitch || '',
      idSwitchFrom: this.user || '',
      idSwitchMon: !AC.monitorOn ? ''
        : AC.monMode === 'server' ? (this.user || '') + ' 계정의 서버 상시 감시는 그대로 계속됩니다.'
          : (this.user || '') + ' 계정의 앱 감시는 이 탭에서 멈춥니다 — 다른 탭·PC에 ' + (this.user || '') + '(으)로 열린 화면이 있으면 그쪽이 이어받습니다.',
      onIdReload: function () { window.location.reload(); },
      goSettings: function () { self._navTo('settings'); },
      onToggleMonitor: function () { self._toggleMonitorNow(); },
      toggleTheme: function () { self.toggleTheme(); },
      settingsActiveStyle: S.tab === 'settings' ? 'border-color: var(--primary-light); color: var(--text-primary);' : '',
      navTabs: [{ id: 'monitor', label: '모니터링', icon: 'dashboard' }, { id: 'detail', label: '상세분석', icon: 'graph-line' }, { id: 'report', label: '리포트 생성', icon: 'file' }].map(function (t) {
        var a = S.tab === t.id;
        return { label: t.label, icon: t.icon, onClick: function () { self._navTo(t.id); }, style: 'display: inline-flex; align-items: center; gap: 7px; height: 52px; padding: 0 14px; background: transparent; border: none; border-bottom: 2px solid ' + (a ? 'var(--primary-light)' : 'transparent') + '; color: ' + (a ? 'var(--text-primary)' : 'var(--text-tertiary)') + '; font-size: 13px; font-weight: ' + (a ? '600' : '500') + '; cursor: pointer;' };
      }),
      notReady: !S.ready,
      // 설정 읽기 실패 중엔 탭 미표시 — 기본값 화면은 틀린 정보
      isMonitor: S.ready && !S.cfgFail && S.tab === 'monitor', isDetail: S.ready && !S.cfgFail && S.tab === 'detail',
      isDiag: S.ready && !S.cfgFail && S.tab === 'diag', isReport: S.ready && !S.cfgFail && S.tab === 'report',
      isSettings: S.ready && !S.cfgFail && S.tab === 'settings',
      toast: S.toast, toastMsg: S.toast ? S.toast.msg : '',
      toastIcon: S.toast && S.toast.kind === 'err' ? 'error' : (S.toast && S.toast.kind === 'warn' ? 'warning' : 'check'),
      // 오류 토스트는 길어질 수 있어 폭 제한
      toastStyle: 'position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 100; display: flex; align-items: flex-start; gap: 9px; padding: 11px 18px; border-radius: 8px; font-size: 13px; font-weight: 500; color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.35); animation: vtoast .25s cubic-bezier(.21,1.02,.73,1); max-width: min(880px, calc(100vw - 40px)); line-height: 1.5; word-break: break-word; background: ' + (S.toast && S.toast.kind === 'err' ? 'var(--toast-err)' : (S.toast && S.toast.kind === 'warn' ? 'var(--toast-warn)' : 'var(--toast-ok)')) + ';'
    };
    base.showAdvanced = true; // 전체 그래프 표시(포락선·켑스트럼·스펙트로그램·첨도·대역)
    base.indicsTitle = this.live ? '진단 지표 (시간영역)' : '스펙트럴 진단 지표';
    base.indicsDesc = this.live ? '원시 파형 구간에서 직접 산출한 충격·에너지 특성 지표' : '스펙트럼에서 직접 산출된 충격·에너지 특성 지표';
    if (!S.ready || !this.data) return base;
    // 등급은 판정 결과(_severityOf) 그대로 — gradeFor(e.rms)로 재산정 시 모니터링·상세 등급 불일치
    this.data.equipment.forEach(function (e) { e.cls = (AC.equipCls || {})[e.id] || e.baseCls || e.cls; e.zones = self._effZones(e); e.grade = self._severityOf(e); });
    var eqsAll = this._activeEqs(), counts = [0, 0, 0, 0];
    // 테이블 필터 — 모니터링 화면 모집단만 축소(판정 대상 불변), 등급 필터와 달리 KPI도 함께 축소. 소스에서 뺀 테이블은 무시
    var _hide = (S.tblHide || []).filter(function (t) { return (AC.srcSel || []).indexOf(t) >= 0; });
    var eqs = _hide.length ? eqsAll.filter(function (e) { return _hide.indexOf(e.table) < 0; }) : eqsAll;
    // 판정 보류는 등급 집계 제외 — 별도 칸 집계, 사유별 내역은 호버
    var holdN = 0, holdBy = { gate: 0, lost: 0, stop: 0, nojudge: 0, patmiss: 0, wait: 0 };
    eqs.forEach(function (e) {
      var h = self._holdOf(e);
      if (h) { holdN++; holdBy[h.kind]++; return; }
      counts[self._severityOf(e)]++;
    });
    base.sumTotal = eqs.length;
    base.onTotalClick = function () { self.setState({ gradeFilter: null }); };
    base.totalStyle = 'flex: 1 1 0; min-width: 118px; padding: 14px 18px; border: none; border-right: 1px solid var(--border-default); background: transparent; text-align: left; cursor: pointer; font-family: inherit;';
    var kpiDef = [{ g: 0, label: '양호', color: '#3aa76d' }, { g: 1, label: '주의', color: '#d99a2b' }, { g: 2, label: '위험', color: '#e07b39' }, { g: 3, label: '심각', color: '#e5484d' }];
    // 판정 보류 칸 — 클릭 시 해당 태그만 필터, 심각도 팔레트 미사용(감시 상태 ≠ 설비 상태)
    kpiDef.push({ g: 'hold', label: '판정 보류', color: 'var(--text-muted)' });
    base.kpiCells = kpiDef.map(function (k) {
      var act = S.gradeFilter === k.g;
      if (k.g === 'hold') {
        return { label: k.label, color: k.color, count: holdN, active: act,
          tip: '지금 등급을 매기지 않는 설비입니다 — 카드의 값이 그 설비를 대표하지 않습니다.'
            + '\n\n계측 이상 ' + holdBy.gate + '대 — 파형을 못 믿습니다. 센서·케이블 확인이 필요합니다.'
            + '\n신호 두절 ' + holdBy.lost + '대 — 데이터가 안 들어옵니다. 수집 경로 확인이 필요합니다.'
            + '\n정지 ' + holdBy.stop + '대 — 설비가 서 있습니다. 조치는 필요 없고, 운전이 재개되면 판정도 재개됩니다.'
            + '\n판정 못 함 ' + holdBy.nojudge + '대 — 회전수·베어링이 없어 결함주파수 격자를 못 세웁니다. 설비 정보를 채우십시오.'
            + (holdBy.patmiss ? '\n결함 패턴 측정 대기·실패 ' + holdBy.patmiss + '대 — 원본 파형을 이번에 재지 못해 직전 판정을 유지합니다. 다음 추출 주기에 다시 잽니다.' : '')
            + (holdBy.wait ? '\n판정 대기 ' + holdBy.wait + '대 — 첫 판정 회차를 기다리는 중입니다.' : ''),
          style: 'flex: 1 1 0; min-width: 96px; padding: 14px 18px; border: none; border-right: 1px solid var(--border-default); background: ' + (act ? 'rgba(0,108,210,.10)' : 'transparent') + '; text-align: left; cursor: pointer; font-family: inherit;' + (act ? ' box-shadow: inset 0 -2px 0 var(--primary-light);' : ''),
          onClick: function () { self.setState({ gradeFilter: act ? null : 'hold' }); } };
      }
      return { label: k.label, color: k.color, count: counts[k.g], active: act,
        style: 'flex: 1 1 0; min-width: 96px; padding: 14px 18px; border: none; border-right: 1px solid var(--border-default); background: ' + (act ? 'rgba(0,108,210,.10)' : 'transparent') + '; text-align: left; cursor: pointer; font-family: inherit;' + (act ? ' box-shadow: inset 0 -2px 0 var(--primary-light);' : ''),
        onClick: function () { self.setState({ gradeFilter: act ? null : k.g }); } };
    });
    // 빈 상태·activeCount는 테이블 필터 무관 — 필터로 0이 된 것을 '감시 설비 없음'으로 안내 방지
    base.activeCount = eqsAll.length;
    base.monEmpty = eqsAll.length === 0;
    // 저장 이력 없는 계정의 빈 화면은 '처음 설정' 안내
    base.monEmptyFresh = !!this._cfgFresh && !(AC.srcSel || []).length;
    base.monEmptyFail = !!S.loadFail;   // 조회 실패로 빈 상태 — '소스 없음'과 구분
    // 설정 읽기 실패 화면(_initCfgFail) — 조회 실패는 재시도만, 조각 손상은 해당 영역 기본값 열기 추가
    var _cf = S.cfgFail;
    var _cfDoms = (_cf && _cf.domains || []).map(function (d) { return (CFG_DOMAIN_UI[d] || [d])[0]; }).join('·');
    base.cfgFailShow = !!_cf && S.ready;
    base.cfgFailTitle = !_cf ? '' : _cf.kind === 'broken' ? _cfDoms + ' 설정을 읽을 수 없습니다' : '설정을 불러오지 못했습니다';
    base.cfgFailText = !_cf ? '' : _cf.kind === 'broken'
      ? '저장 도중 끊겨 설정 일부가 손상된 것으로 보입니다. 다시 시도해도 같다면 이 영역만 기본값으로 열어 다시 설정하세요 — 나머지 설정은 그대로 불러오고, 누르는 것만으로는 아무것도 저장되지 않습니다.'
      : '일시적인 연결 문제일 수 있습니다. 설정은 DB에 그대로 있으니 다시 시도하세요. 그동안 화면을 기본값으로 띄우지 않는 것은, 그 상태에서 저장하면 실제 설정을 덮어쓰기 때문입니다.';
    base.cfgFailWhy = _cf ? _cf.msg : '';
    base.cfgRepairShow = !!_cf && _cf.kind === 'broken';
    base.cfgRepairLabel = _cfDoms + '만 기본값으로 열기';
    base.onCfgRetry = function () { self._retryCfg(); };
    base.onCfgRepair = function () { self._repairCfg(); };
    base.monEventsShow = base.isMonitor && !base.monEmpty;
    base.detailShow = base.isDetail && !base.monEmpty; base.detailEmptyShow = base.isDetail && base.monEmpty;
    base.diagShow = base.isDiag && !base.monEmpty; base.diagEmptyShow = base.isDiag && base.monEmpty;
    base.reportShow = base.isReport && !base.monEmpty; base.reportEmptyShow = base.isReport && base.monEmpty;
    // 테이블 필터 UI — 소스 2개 이상일 때만, 테이블별 태그 수 표시(0개 테이블 구분)
    var _tblAll = (AC.srcSel || []).slice().sort();
    var _tblCnt = {};
    eqsAll.forEach(function (e) { _tblCnt[e.table] = (_tblCnt[e.table] || 0) + 1; });
    var _q = String(S.tblQuery || '').trim().toLowerCase();
    // 검색은 목록 표시만 좁힘 — 걸린 필터 불변
    var _tblShown = _q ? _tblAll.filter(function (t) { return t.toLowerCase().indexOf(_q) >= 0; }) : _tblAll;
    var _vis = _tblAll.filter(function (t) { return _hide.indexOf(t) < 0; });
    base.tblFilterShow = _tblAll.length >= 2;
    base.tblOpen = !!S.tblOpen;
    // 버튼 문구 — 전부 켜짐이면 '전체', 좁혔을 때만 분수 표기
    base.tblAllOn = _hide.length === 0;
    base.tblSelCount = _vis.length;
    base.tblTotal = _tblAll.length;
    base.tblCaption = base.tblAllOn ? '전체 테이블 표시 중' : '';
    base.tblTip = '표시할 테이블만 고릅니다 — 화면만 좁힐 뿐,\n감시·알람은 선택한 소스 전체에서 그대로 돕니다.';
    base.tblQuery = S.tblQuery || '';
    base.onTblQuery = function (ev) { self.setState({ tblQuery: ev.target.value }); };
    // 열고 닫을 때 검색어 초기화 — 재오픈 시 잘린 목록 오독 방지
    base.onTblOpen = function () { self.setState({ tblOpen: !S.tblOpen, tblQuery: '' }); };
    base.onTblClose = function () { self.setState({ tblOpen: false, tblQuery: '' }); };
    // 선택 즉시 반영(확인 버튼 없음) — 보기만 바뀌고 판정 영향 없음
    var _pick = function (t) {
      var h = (self.state.tblHide || []).slice(), i = h.indexOf(t);
      if (i >= 0) h.splice(i, 1); else h.push(t);
      self.setState({ tblHide: h });
    };
    base.tblOptions = _tblShown.map(function (t) {
      return { name: t, count: _tblCnt[t] || 0, checked: _hide.indexOf(t) < 0,
        onToggle: function () { _pick(t); } };
    });
    base.tblNoMatch = _tblAll.length > 0 && _tblShown.length === 0;
    // 전체 선택·해제는 현재 보이는(검색 결과) 항목만 대상
    base.onTblSelectAll = function () {
      self.setState({ tblHide: (self.state.tblHide || []).filter(function (t) { return _tblShown.indexOf(t) < 0; }) });
    };
    base.onTblClearAll = function () {
      var h = (self.state.tblHide || []).slice();
      _tblShown.forEach(function (t) { if (h.indexOf(t) < 0) h.push(t); });
      self.setState({ tblHide: h });
    };
    // 전부 숨김 안내 — 빈 상태 화면(monEmpty)은 소스 문제용이라 별도
    base.tblNoneShow = base.isMonitor && _tblAll.length > 0 && _vis.length === 0;
    // 칩은 앞 CHIP_MAX개만, 나머지는 +N(목록 재오픈 버튼). 전부 켜짐이면 칩 대신 문구
    var CHIP_MAX = 3;
    base.tblChips = base.tblAllOn ? [] : _vis.slice(0, CHIP_MAX).map(function (t) {
      return { name: t, count: _tblCnt[t] || 0, onRemove: function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        var h = (self.state.tblHide || []).slice();
        if (h.indexOf(t) < 0) h.push(t);
        self.setState({ tblHide: h });
      } };
    });
    base.tblMore = base.tblAllOn ? 0 : Math.max(0, _vis.length - CHIP_MAX);
    base.onTblMore = function () { self.setState({ tblOpen: true, tblQuery: '' }); };
    base.onGoSource = function () { self.setState({ tab: 'settings', setSection: 'source' }); };
    // 최근 이벤트 — 목록 필터 무관(_loadEventsLive가 따로 둠), 조회 전엔 목록 첫 행. 벽시계 기준
    var _le = this._lastEvt !== undefined ? this._lastEvt : (S.events[0] || null);
    base.lastEventText = _le ? E.ago(_le.ms, Date.now()) + ' · ' + _le.tagAlias : '없음';
    base.srcNotice = S.srcNotice;
    // 감시 이상 배너 — 알람 부재가 정상 때문인지 감시 사망 때문인지 표시(err = 실제 정지, warn = 의심)
    base.healthWarns = this._loadFailWarns().concat(S.health || []).map(function (w) {
      return {
        text: w.text,
        err: w.lv === 'err',
        act: w.act || '',
        onAct: w.onAct || null,
        style: 'display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 8px; margin-bottom: 10px; '
          + (w.lv === 'err'
            ? 'background: rgba(224,64,64,0.12); border: 1px solid rgba(224,64,64,0.4);'
            : 'background: rgba(217,154,43,0.12); border: 1px solid rgba(217,154,43,0.35);'),
        iconStyle: 'font-size: 16px; flex-shrink: 0; color: ' + (w.lv === 'err' ? '#e04040' : '#d99a2b') + ';',
      };
    });
    base.onSrcReload = function () {
      self._noticeMuted = false;
      self.setState({ srcNotice: '' });
      listTagTables().then(function (t) {
        self.liveTables = t;
        self._loadSchemas();
        var alive = function (x) { return t.indexOf(x) >= 0; };
        // 사라진 테이블을 편집본·적용본에서 제거(적용본은 메모리만 — 부팅과 같은 거르기), 편집본의 다른 미저장 선택은 유지
        self.setState({ srcSel: (self.state.srcSel || []).filter(alive) });
        self._setApplied({ srcSel: (self._ac().srcSel || []).filter(alive) }, ['srcSel']);
        // 변동 확정 시점 — 재적재 후 감시 대상 즉시 동기화
        setTimeout(function () { self._reloadLive(); self._resyncMonSoon(); }, 0);
      }).catch(function () { self._reloadLive(); });
    };
    base.onSrcDismiss = function () { self._noticeMuted = true; self.setState({ srcNotice: '' }); };
    base.cardSize = S.cardSize;
    base.gridCols = 'repeat(auto-fill, minmax(' + S.cardSize + 'px, 1fr))';
    base.onCardSize = function (ev) { self.setState({ cardSize: parseInt(ev.target.value, 10) }); };
    var sparkH = Math.round(Math.min(120, Math.max(38, S.cardSize * 0.2)));
    // 카드 순서 — 저장된 사용자 순서 우선, 없는 태그는 뒤에 심각도순(e.order)
    var _co = S.cardPreview || S.cardOrder || [];   // 드래그 중에는 미리보기 순서로 렌더
    var _rank = {};
    _co.forEach(function (id, i) { _rank[id] = i; });
    var sorted = eqs.slice().sort(function (a, b) {
      var ra = _rank[a.id], rb = _rank[b.id];
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;              // 지정된 것이 먼저
      if (rb != null) return 1;
      return (a.order || 0) - (b.order || 0); // 나머지는 심각도순
    });
    if (S.gradeFilter === 'hold') sorted = sorted.filter(function (e) { return !!self._holdOf(e); });
    else if (S.gradeFilter !== null && S.gradeFilter !== undefined) {
      // 등급 필터에서 보류 제외 — 집계와 일치
      sorted = sorted.filter(function (e) { return !self._holdOf(e) && self._severityOf(e) === S.gradeFilter; });
    }
    base.filterNotice = S.gradeFilter === 'hold' ? ('판정 보류 ' + sorted.length + '대만 표시 중')
      : (S.gradeFilter !== null && S.gradeFilter !== undefined) ? (E.STATUS[S.gradeFilter].ko + ' ' + sorted.length + '대만 표시 중') : '';
    base.onClearFilter = function () { self.setState({ gradeFilter: null }); };
    base.cards = sorted.map(function (e) {
      var g = E.STATUS[self._severityOf(e)];
      // 판정 보류면 색도 중립 — 등급색 잔존 시 '계측 이상인데 초록' 모순
      if (self._holdOf(e)) g = { ko: '판정 보류', color: 'var(--text-muted)', soft: 'var(--bg-elevated)' };
      // 등급 반복 배지 — 최근 2시간 악화 반복(_refreshFlap), 클릭 시 마지막 악화 시점 상세분석
      var _fl = (self._flap || {})[e.table + ':' + e.name];   // _refreshFlap 결과
      var flap = null;
      if (_fl) {
        var _perMin = Math.ceil(_fl.periodMs / 60000);
        flap = {
          text: '등급 반복 ' + _fl.round + '회',
          tip: '최근 2시간에 등급 악화가 ' + _fl.round + '회 반복됐습니다 (약 ' + _perMin + '분 주기).'
            + '\n결함 근거가 채택 기준선 근처에서 오가는 상태입니다 — 부하가 변하면 결함 신호가 켜졌다 꺼질 수 있습니다.'
            + '\n결함 초기일 수 있으니 설정으로 가리지 말고 원인을 확인하십시오.'
            + '\n\n클릭하면 마지막 악화 시점의 상세분석(결함 근거·포락선 스펙트럼)을 엽니다.',
          onOpen: function (ev3) { ev3.stopPropagation(); self._gotoDetail(e.id, _fl.lastMs); },
        };
      }
      // 운전 상태 배지 — 두절은 반드시 표시(멈춘 값이 정상으로 읽힘), 정지는 판정 동결 표시
      var _rs = (self._runState || {})[e.table + ':' + e.name];
      var runBadge = null;
      if (_rs && _rs.lost) {
        runBadge = { text: '신호 두절', err: true,
          tip: '새 데이터가 ' + durKo(_rs.age) + ' 동안 들어오지 않았습니다.'
            + '\n\n화면의 값은 마지막으로 받은 값이라 현재 상태가 아닙니다. 판정도 멈춰 있습니다.'
            + '\n센서·수집기·네트워크를 확인하십시오.' };
      } else if (_rs && _rs.gate) {
        // 계측 이상은 정지보다 우선 — 플랫라인은 값이 낮아도 센서 고장(무기한 무감시)
        runBadge = { text: '계측 이상', err: true,
          tip: _rs.gate.label + (_rs.gate.detail ? '\n\n' + _rs.gate.detail : '')
            + '\n\n파형을 믿을 수 없어 진동 판정을 멈췄습니다 — 이 상태의 값으로 등급을 매기면'
            + ' 헛경보(접촉·스파이크는 값이 과대)나 놓침(클리핑은 과소)이 됩니다.'
            + '\n센서·케이블·마운팅을 확인하십시오.' };
      } else if (_rs && !_rs.run) {
        runBadge = { text: '정지', err: false,
          tip: '값이 정지 수준입니다(정상 기준의 20% 미만).'
            + '\n\n설비가 서 있는 동안은 판정을 얼립니다 — 정지를 "좋아졌다"로 읽으면 복귀 알림이 나가고, 설비가 고쳐진 것으로 오해하게 됩니다.'
            + '\n운전이 재개되면 판정도 이어서 재개됩니다.' };
      }
      var _gs = (self._gradeState || {})[e.table + ':' + e.name] || {};
      /* 등급 칩 옆 확정 상태 — 카드는 원시 등급이라 웹훅 미발송 이유 표시, 악화·복귀 대칭
           1회차 / N회차  — 확정 전
           N시간째        — 확정 뒤 지속 시간
           복귀 N회차     — 초록이나 아직 확정 전(상태기는 나쁨 유지) */
      var _st = (self._monState || {})[e.table + ':' + e.name];
      var gradeNote = '';
      var _confirmed = _st && _st.g > 0;
      if (_gs.gi > 0) {
        if (_confirmed && _st.since) gradeNote = durKo(Date.now() - _st.since) + '째';
        else gradeNote = (_st && _st.candN > 1) ? (_st.candN + '회차') : '1회차';
      } else if (_confirmed) {
        gradeNote = '복귀 ' + ((_st.candN > 1) ? _st.candN : 1) + '회차';
      }
      // 판정 보류면 등급 칩 대체 — 직전 확정 등급은 호버로
      var _hold = self._holdOf(e);
      var _ms = (self._monState || {})[e.table + ':' + e.name];
      var holdTip = '';
      if (_hold) {
        holdTip = _hold.kind === 'patmiss'
          ? '지금 등급을 새로 매기지 않습니다 — ' + _hold.label + '. 결함 패턴(원본 파형)을 이번에 재지 못해 직전 판정을 그대로 유지합니다.'
            + '\n다음 측정(대역 추출 주기)에서 다시 판정합니다. 이 동안 복귀·악화 알림은 나가지 않습니다.'
          : '지금 등급을 매기지 않습니다 — ' + _hold.label + ' 상태라 이 값이 설비를 대표하지 않습니다.';
        if (_ms && _ms.g != null) {
          holdTip += '\n\n직전 확정 ' + (GRADE_WORDS[_ms.g] || '-')
            + (_ms.since ? ' · ' + agoText(_ms.since) : '');
        }
      }
      /* 큰 숫자 = 판정값(원본 단위) — 가속도·변위 설비는 존 판정을 속도 환산(_gs.iso)으로 하되 표시는 같은 대역 원본 단위 RMS(_gs.isoRaw)
         (환산값에 원본 단위를 붙이면 틀린 숫자) */
      var _isoShow = (e.unit && e.unit !== 'mm/s') ? _gs.isoRaw : _gs.iso;
      var _isoHas = _isoShow != null && isFinite(_isoShow);   // null은 isFinite 통과
      var mainVal = _isoHas ? _isoShow : e.rms;
      // 라벨 = 측정 대역(주파수 표기), Nyquist ≤ 1 kHz 태그는 실제 범위
      var _nyq = e.fs > 0 ? Math.round(e.fs / 2) : 0;
      var mainUnit = (_gs.basis === 'iso' && _isoHas) ? '10~1000 Hz'
        : _nyq > 0 ? ('2~' + _nyq + ' Hz') : '전대역';
      // 베이스라인·대역 값은 카드 대신 호버로(미학습이 대부분이라 카드 잡음)
      var _ax = [];
      // 결함 패턴이 맨 위(등급 축) — 못 잰 경우도 사유 기재(빈칸은 정상으로 오독)
      if (_gs.patOk) _ax.push('결함 패턴 ' + (_gs.patOn ? '검출' : '없음') + (_gs.patR != null ? ' (격자 ' + _gs.patR.toFixed(1) + ')' : '')
        // 전대역 복조는 근거 약함 명시 — 조기 베어링 결함 미검출
        + (_gs.patWide ? ' · 전대역 복조(샘플레이트 부족으로 1–5 kHz 대역 불성립) — 근거 약함, 조기 베어링 결함은 검출되지 않습니다' : ''));
      else if (_gs.patMiss) _ax.push('결함 패턴 — ' + (_gs.patWait ? '첫 측정 대기' : '이번 측정 실패') + ' · 직전 판정 유지');
      else if (_gs.patOk === false) _ax.push('결함 패턴 — 판정 못 함(회전수·기하·샘플레이트 확인)');
      if (_gs.blR != null && isFinite(_gs.blR)) _ax.push('베이스라인 한계 대비 ×' + _gs.blR.toFixed(1));
      if (_gs.bandR != null && isFinite(_gs.bandR)) _ax.push('대역 최대 ×' + _gs.bandR.toFixed(1));
      var valTip = '';
      if (_gs.limited && _isoHas && isFinite(_gs.wide)) {
        valTip = 'ISO 10~1000 Hz  ' + E.fmt(_isoShow) + ' ' + (e.unit || '')
          + '\n전대역          ' + E.fmt(_gs.wide) + ' ' + (e.unit || '')
          + '\n\n존 등급은 ISO 대역제한 값으로 매깁니다 — 표준의 존 경계가 10~1000 Hz 기준이라 전대역 값을 대면 다른 양을 재게 됩니다.'
          + ((e.unit && e.unit !== 'mm/s') ? '\n존 경계는 속도(mm/s) 규격이라 이 설비는 속도로 환산해 비교합니다 — 표시는 원본 단위입니다.' : '')
          + '\n베이스라인 이탈은 전대역으로 봅니다 — 어느 주파수든 평소보다 커지면 잡히도록.'
          + '\n\n두 값 차이가 크면 1 kHz 위(충격·베어링·기어)에 에너지가 몰려 있다는 뜻입니다.';
      }
      if (_ax.length) valTip = (valTip ? valTip + '\n\n' : '') + _ax.join('\n');
      // 카드 클릭 시 감시가 판정한 시점(_patAt)으로 상세 이동 — 없으면(보류) 기간 스윕
      var _patAt = ((self._patNow || {})[e.table + ':' + e.name] || {}).at || null;
      // 큰 글씨 = 별칭, 작은 글씨 = 태그명(소스 2개 이상이면 테이블 병기 — 같은 태그명 구분)
      return { mainUnit: mainUnit, hold: !!_hold, holdTip: holdTip, gradeNote: gradeNote, valTip: valTip, runBadge: runBadge, flap: flap, id: e.id, alias: e.alias || e.name, name: e.name,
        sub: e.name + (base.tblFilterShow ? ' (' + e.table + ')' : ''), unit: e.unit, cls: e.cls, gradeKo: g.ko, gradeColor: g.color, gradeSoft: g.soft, rmsText: E.fmt(mainVal), sparkLine: e.spark.line, sparkArea: e.spark.area, sparkColor: g.color, sparkFill: g.soft, sparkH: sparkH, lastText: E.ago(e.lastSeen, self.data.now), onClick: function () { self._gotoDetail(e.id, _patAt); }, cardStyle: 'border-left: 3px solid ' + g.color + ';' };
    });
    /* 설비 카드 드래그 — 미리보기 순서로 렌더(끌고 간 자리에 실제 삽입), 놓으면 확정·저장, 취소 시 원복
       순서는 저장된 전체 목록 기준(필터로 안 보이는 카드의 상대 순서 유지) */
    base.cardDrag = {
      onStart: function (id) {
        return function (ev) {
          // 시작 시점 전체 순서 고정 — 드래그 중 심각도 변화 무시
          var base0 = (self.state.cardOrder || []).slice();
          sorted.forEach(function (e2) { if (base0.indexOf(e2.id) < 0) base0.push(e2.id); });
          self._dragBase = base0;
          self.setState({ cardDragId: id, cardPreview: base0 });
          if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', id); } catch (e) {} }
        };
      },
      onOver: function (id) {
        return function (ev) {
          ev.preventDefault();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
          var from = self.state.cardDragId;
          if (!from || from === id || !self._dragBase) return;
          var cur = self.state.cardPreview || self._dragBase;
          var arr = self._dragBase.slice();
          var i = arr.indexOf(from), j = arr.indexOf(id);
          if (i < 0 || j < 0) return;
          arr.splice(i, 1); arr.splice(j, 0, from);
          // 같은 결과면 setState 생략 — dragover 고빈도
          if (cur.length === arr.length && cur.every(function (x, k) { return x === arr[k]; })) return;
          self.setState({ cardPreview: arr });
        };
      },
      onDrop: function () {
        return function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var arr = self.state.cardPreview;
          self._dragBase = null;
          if (!arr) { self.setState({ cardDragId: null, cardPreview: null }); return; }
          self.setState({ cardOrder: arr, cardDragId: null, cardPreview: null });
          self._persistView(['cardOrder'], { cardOrder: arr });   // 순서만 저장 — 타이머·설정 탭 미저장 편집 무관
        };
      },
      onEnd: function () { self._dragBase = null; self.setState({ cardDragId: null, cardPreview: null }); },
      dragId: S.cardDragId || null,
    };
    base.tagOptions = eqs.map(function (e) { return { id: e.id, label: self._tagLabel(e) }; });
    base.selTag = S.selTag;
    base.onTagChange = function (ev) {
      var nid = ev.target.value, neq = self._eq(nid);
      delete self._detailCache[nid]; self._rfCache = {}; // 태그 전환 시에도 그 순간 스냅샷 재캡처
      var patch = { selTag: nid, dxAiText: null, dxOpen: false };
      if (neq && neq.lastSeen) { // 조회 기간을 새 태그 기준으로 재설정 (데이터보다 길면 전체로 보정)
        var np = self._periodFor(neq, S.period);
        patch.period = np;
        if (np !== 'custom') { var nr = self._periodRange(neq, np); patch.from = nr.from; patch.to = nr.to; }
      }
      self.setState(patch);
    };
    // 상세분석 기간 — 앵커는 선택 태그 1개
    var _pEq = this._activeEq(S.selTag);
    base.periodPresets = this._presetChips([_pEq], '이 태그', 'detail');
    var _dtTxt = function (s) { return String(s || '').replace('T', ' '); }; // 표시용(입력값의 T 제거)
    // 달력 버튼 표시 구간 — 프리셋은 현재 시각 기준으로 매번 재계산(저장된 from/to는 옛 구간)
    var _pSpan = this._presetSpan([_pEq]);
    var _pNow = this.data ? this.data.now : Date.now();
    var pFrom = S.from, pTo = S.to;
    if (PERIOD_H[S.period]) { pFrom = this._dtVal(_pNow - PERIOD_H[S.period] * 3600000); pTo = this._dtVal(_pNow); }
    // 구간은 팝오버 '적용' 시에만 반영(period=custom) — 조정 중 중간 구간 조회 방지
    base.periodRange = {
      from: pFrom, to: pTo, active: S.period === 'custom', showTime: false,
      minMs: _pSpan.minMs || 0, maxMs: _pSpan.toMs || 0,
      title: '달력에서 조회 기간을 직접 고릅니다',
      onApply: function (f, t) {
        self.setState({ period: 'custom', from: f, to: t });
        self._toast('조회 기간 적용됨 · ' + _dtTxt(f) + ' ~ ' + _dtTxt(t));
      },
    };
    base.onRefresh = function () { var eq2 = self._activeEq(self.state.selTag); if (eq2) { delete self._detailCache[eq2.id]; } self._rfCache = {}; self._trCacheL = {}; self._toast('새로고침 완료 · ' + E.fmtClock(Date.now())); self.setState({ dxOpen: false, dxAiText: null }); };
    var eq = this._activeEq(S.selTag);
    if (eq) {
    base.selTag = eq.id;
    var det = this._detail(eq); // 라이브 eq로 캐시 로드 + 스냅샷 프리즈
    var _dc = this._detailCache[eq.id];
    if (_dc && _dc.eqSnap) eq = _dc.eqSnap; // 이후 게이지·판정·진단·추세는 캡처 스냅샷 값 사용(실시간 미반영)
    // 계산 중 표시 — 계측 검증 전 화면이 '이상 없음'으로 읽히는 것 방지
    base.detBusy = !!(_dc && _dc.state === 'loading');
    base.detBusyText = '분석 중 — 파형·스펙트럼과 계측 검증을 계산하고 있습니다. 아래 판정은 계산이 끝난 뒤 확정됩니다.';
    // 캡처 실패·빈 구간 배너 — 설비 문제와 데이터 문제 구분
    base.detWarn = (_dc && _dc.state === 'error') ? '상세분석 조회에 실패했습니다 — 네트워크·DB 상태를 확인하고 새로고침하세요.'
      : (_dc && _dc.state === 'ready' && det.raw && !det.raw.values.length)
        ? '선택 구간에 원시 파형이 없습니다 — 파형·스펙트럼 카드가 비어 있습니다. 마지막 수집: ' + (eq.lastSeen ? E.fmtDT(eq.lastSeen) : '알 수 없음')
        : '';
    /* 계측 보류 — 감시 사유(캡처 시점 _dc.gate) 우선, 분석 창 사유와 OR(한쪽만 보면 카드·상세 불일치)
       캡처 후 감시 상태가 바뀌면 화면 대신 배너(detStale)로 알림 */
    var _gSnap = (_dc && 'gate' in _dc) ? _dc.gate : this._gateOf(eq);
    var _held = VC.gateReason(det.quality, _gSnap);
    var _gLive = this._gateOf(eq);
    base.detStale = (_dc && _dc.state === 'ready' && (_gSnap && _gSnap.label) !== (_gLive && _gLive.label))
      ? ('감시가 본 계측 상태가 이 스냅샷 이후 달라졌습니다 — 지금: ' + (_gLive ? _gLive.label : '이상 없음')
        + ' / 이 화면: ' + (_gSnap ? _gSnap.label : '이상 없음') + '. 아래 판정은 캡처 시점 기준이며, 새로고침하면 반영됩니다.')
      : '';
    /* 입력 회전수 점검 — 실측 1×가 또렷하고(분해능 밖) 입력과 2% 넘게 다르면 경고
       결함 패턴은 입력 RPM을 허용오차 1%로 대조 → 이대로면 결함을 놓침. 실측값 저장은 사용자 확인 후(측정 시점 부하 기준) */
    var _fm = det.frMeas;
    base.rpmWarn = '';
    if (_fm && _fm.distinct && eq.rpm > 0 && Math.abs(_fm.rpm - eq.rpm) / eq.rpm > RPM_WARN_FRAC) {
      var _rpmM = Math.round(_fm.rpm), _pct = ((_fm.rpm - eq.rpm) / eq.rpm * 100);
      var _drv = eq.rpmSrc === 'pulley' || eq.rpmSrc === 'measured';
      base.rpmWarn = (_drv ? '종동축 회전수 ' + eq.rpm + ' rpm(' + (eq.rpmSrc === 'pulley' ? '풀리 환산' : '입력값') + ')이' : '입력 회전수 ' + eq.rpm + ' rpm이') + ' 스펙트럼에서 잰 ' + _rpmM + ' rpm과 ' + (_pct > 0 ? '+' : '') + _pct.toFixed(1)
        + '% 다릅니다. 결함 패턴은 입력값으로 결함 주파수를 계산해 허용오차 1%로 대조하므로, 이대로면 결함을 놓칠 수 있습니다. ' + (_drv ? '벨트 슬립·풀리 지름(피치 지름 기준인지)을 확인하거나 종동축 회전수를 직접 입력하세요.' : '동기속도(예: 1800)를 넣었다면 정격 회전수로 고치세요.');
      base.rpmWarnAct = '실측값 ' + _rpmM + ' rpm으로 저장';
      base.onRpmWarnAct = function () { self._setRpmFromMeas(eq, _rpmM); };
    }
    // 기간 지표 — 리포트와 같은 함수(VC.sevMetrics)
    var _rf = this._rollFor(eq), _roll = _rf.roll;
    var _m = VC.sevMetrics(_roll, { zones: eq.zones, fs: eq.fs, gate: !!_held });
    // 판정을 게이지보다 먼저 — 게이지·존 막대·권고가 패턴 반영 등급(dx.gi) 사용
    var dx = this._dx(eq, det, _m);
    var _gi = dx.gi != null ? dx.gi : (eq.grade || 0);
    var _n = _m.n;
    // 버킷 cnt 없으면(폴백 집계) 롤업 단위 초로 건수 대체 — 스펙 패널 '데이터 건수'용
    var _wCount = _n.cnt || _roll.length * _rf.stepSec;
    // 첨도 포화 경고 — 첨도 추이가 고점 대비 하락하나 RMS는 유지/상승이면 "회복 아님(말기)" 주의
    var _sat = this._kurtSat(eq);
    base.kurtWarnShow = !!_sat.flag; base.kurtWarn = _sat.msg || '';
    // 추이 차트(원시 청크 기반) 상태 문구 — 계산 중·실패·표본 부족 구분(빈 상자는 '조용함'으로 오독)
    var _tr = this._trends(eq, _roll);
    var _trBusy = _tr && _tr.state === 'loading';
    // 조회 실패와 표본 부족 구분
    var _trErr = _tr && _tr.state === 'error';
    var _trEmpty = function (note) { return _trBusy ? '계산 중…' : _trErr ? '계산에 실패했습니다 — 새로고침으로 다시 시도하세요' : (note || ''); };
    base.kurtNote = (_tr && (_tr.kurt || []).length) ? '' : _trEmpty(_tr && _tr.kurtNote);
    var _bandHas = _tr && (_tr.bands || []).some(function (s) { return (s.vals || []).some(function (v) { return v != null; }); });
    base.bandNote = _bandHas ? '' : _trEmpty(_tr && _tr.bandNote);
    base.detTitle = eq.alias || eq.name; base.detName = eq.name; base.detUnit = eq.unit;
    base.detSpec = [
      { k: '데이터 건수', v: this._num(_wCount) + ' 건' },
      { k: '표시 구간', v: this._rangeText(_roll, S.from + ' ~ ' + S.to, _rf) },
      { k: '샘플레이트', v: (det.raw.fs / 1000).toFixed(2) + ' kHz' },
      { k: '롤업 단위', v: _rf.label }
    ];
    var g = E.STATUS[_gi];
    // 보류 중엔 등급어 유지·색만 중립 — 마지막 판정 정보는 남기되 현재 상태로 주장하지 않음
    base.sevHold = !!_held;
    base.sevHoldWhy = _held ? _held.label : '';
    base.sevHoldDetail = _held ? (_held.detail || '') : '';
    base.sevHoldNote = _held
      ? (_held.src === 'mon' ? '감시가 이 사유로 판정을 동결했습니다 — 모니터링 카드도 같은 상태입니다'
        : '분석 창에서 계측 이상이 보입니다 — 계측 확인 후 재평가하십시오')
      : '';
    base.sevLabel = _held ? ('마지막 판정 · ' + E.ago(eq.lastSeen, this.data.now)) : '종합 위험도';
    base.sevGradeKo = g.ko;
    base.sevColor = _held ? '#8a8f99' : g.color;
    base.sevSoft = _held ? 'rgba(138,143,153,0.16)' : g.soft;
    // 판정 문구가 충격성 지적 시 권고도 동조 — Crest로는 결함·계측 구분 불가라 둘을 가르는 행동 기재
    var _imp = !_held && _gi === 0 && !!(_m.crest && _m.crest.grade > 0);
    base.sevReco = _held ? '센서·케이블·마운팅 점검 후 재측정'
      : _imp ? '포락선에서 베어링 결함 주파수 대조 · 센서·케이블·마운팅 점검'
      : { 0: '정상 운전 유지 · 예방관리 지속', 1: '모니터링 강화 권고', 2: '조기 점검 권고 · 측정 주기 단축', 3: '긴급 점검 · 중요도 따라 정지 검토' }[_gi];
    // 필수 축 누락은 등급 옆에 명시(근거보다 강한 '양호' 방지), 보강 축(학습 필요)은 '더해진 것'으로 표기
    if (!_held && dx.cov) {
      if (dx.cov.n < dx.cov.total) {
        base.sevReco = '판정 기준 ' + dx.cov.n + '/' + dx.cov.total
          + '(' + dx.cov.missing.join('·') + ' 미적용) · ' + base.sevReco;
      } else if (dx.cov.extra && dx.cov.extra.length) {
        base.sevReco = '평소 대비 판정 적용(' + dx.cov.extra.join('·') + ') · ' + base.sevReco;
      }
    }
    base.sevMachine = eq.name + ' · Class ' + eq.cls + ' · ' + self._rpmText(eq);
    // 존 막대는 ISO 속도(mm/s) 눈금, 종합 등급 한 칸만 채움
    var _isoZ = this._isoZones(eq);
    base.sevZoneUnit = 'mm/s';
    base.sevZones = [
      { ko: '양호', color: '#3aa76d', range: '< ' + E.fmt(_isoZ[0]) },
      { ko: '주의', color: '#d99a2b', range: E.fmt(_isoZ[0]) + '–' + E.fmt(_isoZ[1]) },
      { ko: '위험', color: '#e07b39', range: E.fmt(_isoZ[1]) + '–' + E.fmt(_isoZ[2]) },
      // 카드 값은 원본 단위(g·μm)라 존 눈금에 단위 명시
      { ko: '심각', color: '#e5484d', range: '> ' + E.fmt(_isoZ[2]) + ' mm/s' }
    // 보류 중이면 해당 칸 테두리만(채운 칸은 '지금 여기'로 읽힘)
    ].map(function (z, i) {
      var a = i === _gi, hold = a && base.sevHold;
      return { ko: z.ko, range: z.range,
        cellStyle: 'flex: 1; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; box-sizing: border-box; color: '
          + (hold ? '#8a8f99' : a ? '#fff' : 'var(--text-muted)')
          + '; background: ' + (a && !hold ? z.color : 'var(--bg-elevated)')
          + '; border-right: 1px solid var(--border-light);'
          + (hold ? ' box-shadow: inset 0 0 0 1.5px #8a8f99;' : ''),
        labStyle: 'flex: 1; text-align: center; font-size: 10px; color: var(--text-muted);' };
    });
    base.sevCards = this._sevCards(_m, eq.unit, _held, _rf.stepSec).map(function (c) {
      var gg = E.STATUS[c.grade];
      // 배지 색 3부류 — 등급어는 등급색, '판정에 쓰지 마라'(잠정·참고·아티팩트)는 회색, 관측 사실(note — 충격성 강함)은 앰버
      var _bc = c.note ? '#d99a2b' : c.override ? '#8a8f99' : gg.color;
      // 등급 없는 카드(참고·잠정)는 색 막대·배지 채움 없음(구조로 구분), 관측 사실(note)은 앰버 유지
      var _plain = !!c.override && !c.note;
      return Object.assign({}, c, {
        badgeColor: _plain ? 'var(--text-muted)' : _bc,
        badgeSoft: _plain ? 'transparent' : (c.note ? 'rgba(217,154,43,0.16)' : gg.soft),
        badgeBorder: _plain ? 'var(--border-medium)' : 'transparent',
        arrowColor: c.over ? '#e5484d' : '#3aa76d',
        style: _plain ? '' : 'border-left: 3px solid ' + _bc + ';' });
    });
    /* 통계 요약 — 리포트와 같은 지표(중앙값·P95·Crest 기대치 √(2·ln N)·B/C 초과 빈도)
       · ISO 판정값 행 포함, 나머지는 원본 단위 광대역(B/C 초과는 원본 단위 존 기준)
       · 칸엔 값만, 산출 조건은 hover */
    var _rP95 = _m.p95.value, _cP95 = _m.crest.value;
    var _isoNat = !!(eq.unit && eq.unit !== 'mm/s');
    var _isoTxt = det.isoRms != null
      ? this._isoDisp(eq, det) + ' · Class ' + eq.cls + ' ' + ['A 양호', 'B 주의', 'C 위험', 'D 심각'][VC.gradeFor(det.isoRms, _isoZ)]
      : '계산 전';
    var _isoFull = det.isoRms != null
      ? _isoTxt + (det.isoBlocks > 1 ? ' (' + det.isoBlocks + '블록 평균)' : '')
        + (_isoNat ? ' — 10~1000 Hz 원본 단위 RMS, 존 판정은 속도 환산' : '')
      : '계산 전 — 원시 파형 조회 후 확정';
    // 문장형 근거는 제목 아래 한 줄 요약(statSummary), 타일은 값만(6칸)
    var _bcPct = _n.buckets ? (_n.overBC / _n.buckets * 100).toFixed(1) : '0';
    base.statSummary = this._statSummary(eq, det, dx, _roll, _gi);
    base.statRows = [
      { k: 'ISO 판정값 (등급 근거)', v: _isoTxt, t: _isoFull },
      { k: '광대역 RMS (등급 없음)', v: '중앙 ' + E.fmt(_n.rMed) + ' · P95 ' + E.fmt(_rP95) + ' ' + eq.unit },
      { k: 'Crest P95', v: _cP95.toFixed(2) + ' (기준 ' + _n.cThr.toFixed(1) + ')' },
      { k: '변화율', v: '×' + _n.wTrend.toFixed(2) + this._trendTag(_m.trend) },
      { k: '관측 창', v: Math.round(_n.durMin) + '분 · ' + _n.buckets + '버킷' },
      { k: '광대역 B/C 초과', v: _n.overBC + ' (' + _bcPct + '%) · 기준 ' + E.fmt(eq.zones[1]) + ' ' + eq.unit },
    ];
    base.fftMarkers = det.fft.markers.filter(function (m) { return m.kind !== 'h'; }).map(function (m) { return { label: m.label, freq: m.freq.toFixed(1) + ' Hz', color: m.kind === 'f' ? '#e5646a' : (m.kind === 'x' ? 'var(--text-tertiary)' : 'var(--text-muted)') }; });
    // FFT·스펙트로그램 주파수 범위 토글 (연동) — 전대역으로 펼칠 여지가 있을 때만 노출
    base.fftRangeShow = det.fft.nyqHz > det.fft.dispHz * 1.05;
    var _rlabel = function (hz) { return hz >= 1000 ? (Math.round(hz / 100) / 10) + 'kHz' : Math.round(hz) + 'Hz'; };
    base.fftRangeChips = [
      { v: false, l: '기본 0–' + _rlabel(det.fft.dispHz || 1000) },
      { v: true, l: '전대역 0–' + _rlabel(det.fft.nyqHz || 0) },
    ].map(function (o, i) {
      var a = !!S.fftFull === o.v;
      return {
        label: o.l, onClick: function () { self.setState({ fftFull: o.v }); },
        style: 'height: 24px; padding: 0 10px; border: none; font-size: 11px; font-weight: 600; cursor: pointer;'
          + (i === 0 ? ' border-right: 1px solid var(--border-medium);' : '')
          + ' background: ' + (a ? 'var(--primary-base)' : 'transparent') + '; color: ' + (a ? '#fff' : 'var(--text-tertiary)') + ';',
      };
    });
    // 커토그램 — 충격성 최대 대역 표시 전용(복조 미사용), 결과 있을 때만 카드 노출
    base.kurtogramShow = !!(det.kurtogram && det.kurtogram.freqs.length);
    if (det.kurtogram && det.kurtogram.best) {
      var _khz = function (h) { return h >= 1000 ? (h / 1000).toFixed(1) + 'kHz' : Math.round(h) + 'Hz'; };
      var _kb = det.kurtogram.best;
      // 표시 전용(복조 대역 미사용) — 첨도 최대화가 베어링 무관 대역(안티에일리어싱 잡음·인버터 스위칭)에 붙잡힘
      base.kurtogramHint = '가장 충격성이 강한 대역 ' + _khz(_kb.loHz) + '–' + _khz(_kb.hiHz) + ' · SK ' + _kb.sk.toFixed(1)
        + ' · 이 대역은 복조에 쓰지 않습니다 — 첨도 최대화가 고주파 잡음 대역으로 끌려 검출이 57%→6%로 떨어집니다';
    } else base.kurtogramHint = '';
    // 표시 물리량 토글 — 가속도(g)/속도(mm/s)/변위(μm). 센서 원단위가 기본, 나머지는 적분/미분 변환.
    var _natU = det.natUnit || (this._activeEq(S.selTag) || {}).unit || 'mm/s';
    base.unitChips = [{ u: 'g', l: '가속도' }, { u: 'mm/s', l: '속도' }, { u: 'μm', l: '변위' }].map(function (o) {
      var active = (S.viewUnit || _natU) === o.u;
      return {
        label: o.l + (o.u === _natU ? '(원본)' : '') + ' ' + o.u,
        title: o.u === _natU ? '센서가 직접 측정한 원본' : (o.u + '로 변환 — ' + (o.u === 'g' ? '고주파(베어링) 강조' : o.u === 'μm' ? '저주파(불균형) 강조' : '중간 대역')),
        onClick: function () { self.setState({ viewUnit: o.u === _natU ? null : o.u }); },
        style: 'height: 34px; padding: 0 11px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; background: ' + (active ? 'var(--primary-base)' : 'transparent') + '; color: ' + (active ? '#fff' : 'var(--text-tertiary)') + ';',
      };
    });
    // 차트 헤더에 붙일 현재 물리량 태그 — 변환 중이면 눈에 띄게 표시
    var _du = det.dispUnit || _natU;
    base.dispUnitTag = _du === _natU ? _du : (_du + ' · 변환');
    base.dispUnitConverted = _du !== _natU;
    // 신호 품질 배너 — 센서 이상(플랫라인·클리핑·드리프트) 감지 시 최상단 경고. 정상이면 숨김.
    var _q = det.quality || { ok: true, issues: [] };
    var _qReal = _q.issues.filter(function (x) { return !x.info; }), _qInfo = _q.issues.filter(function (x) { return x.info; });
    base.qualityShow = !_q.ok && _qReal.length > 0;
    base.qualitySevere = !!_q.severe;
    base.qualityText = _qReal.map(function (x) { return x.label + ': ' + x.detail; }).join(' · ');
    // 참고 사유(일정한 DC 등) — 경고 아님, 한 줄 안내
    base.qualityNote = _qInfo.map(function (x) { return x.label + ': ' + x.detail; }).join(' · ');
    base.envHint = det.envelope.hint; base.envFault = det.envelope.fault;
    base.envMarkers = det.envelope.markers.map(function (m) { return { label: m.label, freq: m.freq.toFixed(1) + ' Hz', color: m.kind === 'f' ? '#e5646a' : 'var(--text-muted)' }; });
    base.cepNote = det.cepstrum.note;
    base.dxVerdict = dx.verdict; base.dxSub = dx.sub; base.dxGradeKo = dx.gradeKo; base.dxColor = dx.color; base.dxSoft = dx.soft;
    // 계산 전 판정은 빈 스펙트럼 기반 → 결론 대신 진행 중 표시
    if (base.detBusy) { base.dxVerdict = '분석 중…'; base.dxSub = '스펙트럼·계측 검증 계산이 끝나면 판정이 확정됩니다'; }
    base.dxEvidence = dx.evidence; base.dxActions = dx.actions;
    base.dxAiIdle = !S.dxAiText || S.dxAiText === '__fallback__'; base.dxAiLoading = S.dxAiText === '__loading__'; base.dxAiFallback = S.dxAiText === '__fallback__';
    var llmOk = !!LLM.createLLM(this._llmCfg());
    base.dxLlmModel = llmOk ? this._llmLabel() : '';
    var provNames = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama' };
    base.llmProvOptions = this._llmProviders().map(function (p) { return { id: p, label: provNames[p] }; });
    base.llmProvsAvail = base.llmProvOptions.length > 0;
    base.llmProviderSel = this._ac().llmProvider;
    base.onLlmProvPick = function (ev) { self._pickLlmProvider(ev.target.value); };
    base.dxAiText = (S.dxAiText && S.dxAiText !== '__loading__' && S.dxAiText !== '__fallback__') ? S.dxAiText : '';
    base.dxAiSections = this._parseOpinion(base.dxAiText); // 소제목 있는 상세 리포트형 렌더용
    base.onDxExplain = function () { self._dxExplain(eq); };
    base.specIndics = det.indics.map(function (d) { return { k: d.k, v: d.v, hint: d.hint || '', desc: d.desc || '' }; });
    base.detBearing = eq.bearing.n ? ('베어링 ' + this._bearingLabel(eq) + ' · N=' + eq.bearing.n) : '슬리브 베어링';
    base.ref_wave = this.ref_wave; base.reftip_wave = this.reftip_wave; base.refcross_wave = this._refWaveCross;
    base.ref_rms = this.ref_rms; base.reftip_rms = this.reftip_rms;
    base.ref_p2p = this.ref_p2p; base.reftip_p2p = this.reftip_p2p;
    base.ref_crest = this.ref_crest; base.reftip_crest = this.reftip_crest;
    base.ref_fft = this.ref_fft; base.reftip_fft = this.reftip_fft;
    base.ref_fc = this.ref_fc; base.reftip_fc = this.reftip_fc;

    }

    var _actIds = eqs.map(function (e) { return e.id; });
    var evs = S.events.filter(function (e) { return _actIds.indexOf(e.tagId) >= 0; });
    var fEvs = evs.filter(function (e) { return (S.evtTag === 'all' || e.tagId === S.evtTag) && (S.evtType === 'all' || e.type === S.evtType); });
    var _wallNow = Date.now(); // 이벤트 TS는 벽시계 — 경과시간도 벽시계 기준
    // 필터 변경 시 재조회 — 개수(countEvents)가 필터를 반영하므로 목록과 함께 갱신
    base.evtTagFilter = S.evtTag;
    base.onEvtTag = function (ev) { self.setState({ evtTag: ev.target.value }); setTimeout(function () { self._loadEventsLive(); }, 0); };
    base.evtTypeFilter = S.evtType;
    base.onEvtType = function (ev) { self.setState({ evtType: ev.target.value }); setTimeout(function () { self._loadEventsLive(); }, 0); };
    // 이벤트 기간 스코프 칩 — 오늘 / 7일 / 전체 (전체 이력은 내보내기로)
    base.evtScopeChips = [{ v: 'today', l: '오늘' }, { v: '7d', l: '7일' }, { v: 'all', l: '전체' }].map(function (o) {
      var a = S.evtScope === o.v;
      return {
        label: o.l,
        onClick: function () { self.setState({ evtScope: o.v }); setTimeout(function () { self._loadEventsLive(); }, 0); },
        style: 'height: 26px; padding: 0 11px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1px solid ' + (a ? 'var(--primary-light)' : 'var(--border-medium)') + '; background: ' + (a ? 'rgba(0,108,210,.1)' : 'transparent') + '; color: ' + (a ? 'var(--text-primary)' : 'var(--text-tertiary)') + ';',
      };
    });
    base.evtCapped = !!this._evtCapped; // 최근 200건 초과 — 목록은 잘림, 전체는 내보내기
    base.evtEmptyText = S.evtScope === 'today' ? '오늘은 조용합니다 — 발생한 알람이 없습니다'
      : S.evtScope === '7d' ? '최근 7일간 발생한 알람이 없습니다' : '기록된 알람이 없습니다';
    // 이벤트 내보내기(저장) 모달
    base.onOpenDownload = function () { self._openDownload(); };
    base.dlOpen = S.dlOpen; base.dlFmt = S.dlFmt;
    // 이벤트는 날짜 단위 내보내기 — 종료일은 그날 23:59:59.999까지 포함(_exportEvents)
    base.csvRange = {
      from: S.csvFrom, to: S.csvTo, mode: 'date', full: true,
      title: '내보낼 기간을 고릅니다',
      onApply: function (f, t) { self.setState({ csvFrom: f, csvTo: t }); },
    };
    base.onDlFmt = function (ev) { self.setState({ dlFmt: ev.target.value }); };
    base.onCloseDownload = function () { self.setState({ dlOpen: false }); };
    base.onDoDownload = function () { self._exportEvents(); };
    base.stopClick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); };
    base.evtTagOptions = [{ id: 'all', label: '전체 태그' }].concat(eqs.map(function (e) { return { id: e.id, label: self._tagLabel(e) }; }));
    // 실제 발생 유형만 필터 목록에(옛 유형 라벨은 TYPEKO에 유지 — 기존 이력 렌더용)
    base.evtTypeOptions = [{ id: 'all', label: '전체 유형' }].concat(
      EVT_LIVE_TYPES.map(function (k) { return { id: k, label: TYPEKO[k] }; }));
    base.evtEmpty = fEvs.length === 0;
    base.evtCount = this._evtTotal != null ? this._evtTotal : fEvs.length; // 스코프·필터 내 실제 총 건수(목록은 200캡)
    function _scroller(el) { var p = el ? el.parentElement : null; while (p) { if (p.scrollHeight > p.clientHeight + 4) { var ov = getComputedStyle(p).overflowY; if (ov === 'auto' || ov === 'scroll' || p.tagName === 'MAIN') return p; } p = p.parentElement; } return document.scrollingElement || document.documentElement; }
    function _jump(id) { return function () { var el = document.getElementById(id); if (!el) return; var c = _scroller(el); c.scrollTo({ top: c.scrollTop + el.getBoundingClientRect().top - c.getBoundingClientRect().top - 66, behavior: 'smooth' }); }; }
    base.dxOpen = !!S.dxOpen;
    var _snap = this._detailCache[S.selTag];
    base.dxStamp = this.live ? (E.fmtDT((_snap && _snap.anchor) || (_snap && _snap.snapNow) || this.data.now) + ' 시점 스냅샷 · 새로고침 시 갱신') : (E.fmtDT(this.data.now).slice(0, 10) + ' 측정 스냅샷 (0.4 s 캡처) 기준 자동 판정');
    // 등급 산정 시점 명시 — 기간 통계 카드와 등급의 범위 차이 표시
    base.anchorNote = this._anchorNote(_snap);
    base.dxToggleLabel = S.dxOpen ? '종합 분석 접기' : '종합 분석 펼치기';
    base.onToggleDx = function () { self.setState({ dxOpen: !self.state.dxOpen }); };
    base.evtRows = fEvs.map(function (e) {
      var g = E.STATUS[e.grade];
      /* 상세 — 크기 먼저, 근거 뒤
          · 대역   — 한계 대비 비율(단위 없음, mm/s 붙이면 절대값 오독)
          · 두절   — 지표값 없음, 무수신 시간만
          · 계측 이상·복귀 — 지표값 없음, 사유 문구만
          · 나머지 — 판정값과 넘은 기준 */
      var isBand = e.type === 'band' || e.type === 'bandrec';
      var isSens = e.type === 'sensor_fault' || e.type === 'sensor_ok';
      var valText, noteText;
      // 이탈 대역이 전부 마운팅 상한 위면 '잠정' — 확정 근거 불가 표시
      var _bSoft = !!(e.bands && e.bands.length) && e.bands.every(function (b) { return b.soft; });
      if (isBand) {
        valText = '×' + (e.value || 0).toFixed(2);
        noteText = (e.bands && e.bands.length)
          ? e.bands.length + '개 대역(' + e.bands.map(function (b) { return b.ko; }).join('·') + ')' + (_bSoft ? ' · 잠정' : '')
          : '전 대역 정상';
      } else if (e.type === 'signal_lost') {
        valText = e.detail || '무수신';   // DETAIL 빈 옛 이벤트는 '무수신'만
        noteText = '';
      } else if (isSens) {
        // DETAIL = '사유 — 설명' → 칸엔 사유만, 설명은 호버
        valText = (e.detail || e.typeKo).split(' — ')[0];
        noteText = '';
      } else if (natRow(e.type, e.unit)) {
        // 원본 단위 행 — 속도 ISO로 등급을 매겨 원본 단위 기준 숫자 없음, 근거 문구 표기
        valText = E.fmt(e.value) + ' ' + e.unit;
        noteText = Notify.basisText(e.detail) || '속도 ISO 기준 판정';
      } else {
        valText = E.fmt(e.value) + ' ' + e.unit;
        noteText = '기준 ' + E.fmt(e.base);
      }
      return { id: e.id, timeText: E.fmtDT(e.ms), agoText: E.ago(e.ms, _wallNow), tagAlias: e.tagAlias, tagName: e.tagName, typeKo: e.typeKo, valText: valText, noteText: noteText, gradeKo: g.ko, gradeColor: g.color, gradeSoft: g.soft,
        valTip: isSens ? (e.detail && e.detail.indexOf(' — ') >= 0 ? e.detail : '')
          : (isBand && e.bands && e.bands.length)
          ? e.bands.map(function (b) { return b.ko + (b.soft ? '(잠정)' : '') + '  ' + b.v.toFixed(3) + ' → 한계 ' + b.lim.toFixed(3) + '  (×' + b.r.toFixed(2) + ')'; }).join('\n')
            + '\n\n대역 이탈은 학습된 한계(μ+kσ) 대비 비율로 판정합니다 — ×1이 한계이지 평소가 아닙니다(ISO 존과 무관). 함께 오른 대역 조합이 결함 종류를 가리킵니다.'
            + (e.bands.some(function (b) { return b.soft; })
              ? '\n\n(잠정) 표시는 가속도계 마운팅의 유효 주파수 상한을 넘는 대역입니다. 값이 오른 것은 사실이지만 설비 진동인지 센서 부착부 공진인지 구분할 수 없어, 그 대역만 이탈했으면 등급을 주의로 묶습니다. 정비 전 센서 부착 상태를 먼저 확인하세요.'
              : '')
          : '',
        onGo: function () { self._gotoDetail(e.tagId, e.ms); } };
    });
    var deq = this._activeEq(S.diagTag);

    base.reportTags = eqs.map(function (e) { var ck = S.genTags.indexOf(e.id) >= 0; return { id: e.id, alias: e.alias || e.name, nameSub: (e.alias && e.alias !== e.name) ? '(' + e.name + ')' : '', checked: ck, onToggle: function () { self._toggleGenTag(e.id); }, rowStyle: 'display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; background: ' + (ck ? 'rgba(0,108,210,.08)' : 'transparent') + ';', boxStyle: 'width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 1px solid ' + (ck ? 'var(--primary-base)' : 'var(--border-medium)') + '; background: ' + (ck ? 'var(--primary-base)' : 'transparent') + '; color: #fff;' }; });
    base.genTagsCount = S.genTags.length;
    base.genSelAllLabel = S.genTags.length === eqs.length ? '전체 해제' : '전체 선택';
    base.onGenSelectAll = function () { self._setGenTags(S.genTags.length === eqs.length ? [] : eqs.map(function (e) { return e.id; })); };
    // 리포트 기간 — 앵커는 대상 태그, 없으면 기간 UI 숨김
    var _genEqs = S.genTags.map(function (id) { return self._eq(id); }).filter(Boolean);
    var _genCustom = S.genPeriod === 'custom';
    base.genPeriodNone = !_genEqs.length;
    base.genPeriodShow = !!_genEqs.length;
    base.genPeriodCustomShow = !!_genEqs.length && _genCustom;
    base.genPeriodPresets = this._presetChips(_genEqs, '대상 태그', 'report');
    // 프리셋은 태그별 최신 데이터 기준 창(_rollForAsync)이라 상대 표현 사용
    base.genPeriodSummary = S.genPeriod === 'all' ? '각 태그의 데이터 전체 구간'
      : PERIOD_H[S.genPeriod] ? '각 태그의 최신 데이터 기준 · 최근 ' + ({ '1h': '1시간', '6h': '6시간', '24h': '24시간' }[S.genPeriod] || S.genPeriod)
        : '기간을 선택하세요';
    var gFrom = S.genFrom, gTo = S.genTo;
    var _gfD = CH.parseDT(gFrom), _gtD = CH.parseDT(gTo);
    // 데이터 없는 구간 리포트 차단(빈 문서도 기록물로 남음) — 직접 입력만 검사(프리셋은 태그별 최신 데이터 앵커라 비지 않음)
    var _genGaps = (_genCustom && !isNaN(_gfD) && !isNaN(_gtD))
      ? _genEqs.filter(function (e) {
        var st = e.stat;
        if (!st || !(st.maxMs > 0)) return false; // 통계 모르면 비차단
        return st.maxMs < _gfD || st.minMs > _gtD; // 구간과 데이터가 전혀 겹치지 않음
      }) : [];
    base.genNoDataAll = _genGaps.length > 0 && _genGaps.length === _genEqs.length;
    base.genNoDataShow = _genGaps.length > 0;
    if (base.genNoDataShow) {
      var _g0 = _genGaps[0], _gs = _g0.stat;
      base.genNoDataText = (base.genNoDataAll ? '선택한 기간에 데이터가 없습니다' : _genGaps.length + '개 태그는 이 기간에 데이터가 없어 제외됩니다')
        + ' — ' + _genGaps.map(function (e) { return e.alias || e.name; }).join(', ')
        + '. ' + (_g0.alias || _g0.name) + ' 데이터는 ' + E.fmtDT(_gs.minMs) + ' ~ ' + E.fmtDT(_gs.maxMs) + ' 구간에 있습니다.'
        + (base.genNoDataAll ? " '전체' 프리셋을 고르면 각 태그의 데이터 구간에 맞춰집니다." : '');
    }
    this._genGapIds = _genGaps.map(function (e) { return e.id; });
    // 프리셋일 땐 버튼에 절대 시각 미표기 — 태그별 앵커라 한 구간으로 적으면 부정확
    var _gSpan = this._presetSpan(_genEqs);
    base.genRange = {
      from: gFrom, to: gTo, active: _genCustom, full: true, showTime: false,
      label: _genCustom ? '' : '달력으로 직접 고르기',
      minMs: _gSpan.minMs || 0, maxMs: _gSpan.toMs || 0,
      title: '달력에서 리포트 기간을 직접 고릅니다',
      onApply: function (f, t) {
        self.setState({ genPeriod: 'custom', genFrom: f, genTo: t });
        self._toast('리포트 기간 적용됨 · ' + _dtTxt(f) + ' ~ ' + _dtTxt(t));
      },
    };
    base.genPeriodNote = _genCustom ? '선택한 태그 전부에 이 구간이 그대로 적용됩니다' : base.genPeriodSummary;
    // LLM 기능 게이트 = 설정 존재(ollama 또는 API 키) — 연결 테스트 결과는 세션 한정이라 게이트 아님
    var llmReady = !!LLM.createLLM(this._llmCfg());
    base.genLLM = S.genLLM; base.genLLMConfigured = llmReady;
    base.genToggleStyle = SWITCH_TRACK(S.genLLM && llmReady) + (llmReady ? '' : ' opacity: .5;');
    base.genKnobStyle = SWITCH_KNOB(S.genLLM && llmReady);
    // 리포트 탭 토글은 즉시 저장 — _persistView 사용(_persistCfg는 타이머 전부 재굽기·토스트 동반)
    base.onToggleGenLLM = function () {
      if (!llmReady) { self._toast('LLM 미설정 · ⚙ 설정에서 구성하세요', 'warn'); return; }
      var on = !S.genLLM;
      self.setState({ genLLM: on });
      self._persistView(['genLLM'], { genLLM: on }); // setState 직후라 값 직접 전달
    };
    base.genLLMNotice = llmReady ? '' : 'LLM 미설정 — ⚙ 설정 → LLM 연동 구성 시 활성화';
    base.genRunning = S.genRunning;
    base.genSteps = ['데이터 조회', '지표 계산', '소견 생성', '저장'].map(function (l, i) { var st = i < S.genStep ? 'done' : (i === S.genStep ? 'active' : 'pending'); return { label: l, num: st === 'done' ? '✓' : (i + 1), dotStyle: 'width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; ' + (st === 'done' ? 'background: #2e7d5b; color: #fff;' : st === 'active' ? 'background: var(--primary-base); color: #fff;' : 'background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border-default);'), labelStyle: 'font-size: 13px; color: ' + (st === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)') + '; font-weight: ' + (st === 'active' ? '600' : '500') + ';' }; });
    base.onGenReport = function () { self._genReport(); };
    base.genBtnLabel = S.genRunning ? '생성 중…' : '리포트 생성';
    // 생성 중단 — 단계 목록 아래, 즉시 종료라 대기 라벨 없음
    base.genCancelLabel = '생성 중단';
    base.genCancelStyle = 'width: 100%; height: 34px; margin-top: 14px; border-radius: 6px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer;';
    base.onCancelGen = function () { self._cancelGen(); };
    var _genOff = S.genTags.length === 0 || S.genRunning || base.genNoDataAll;
    base.genBtnStyle = 'width: 100%; height: 40px; border-radius: 6px; border: none; font-size: 13px; font-weight: 600; color: #fff; background: var(--primary-base); cursor: ' + (_genOff ? 'not-allowed' : 'pointer') + '; opacity: ' + (_genOff ? '.5' : '1') + ';';
    var RPP = 10, rpTotal = Math.max(1, Math.ceil(S.reports.length / RPP)), rpPg = Math.min(S.rpPage || 0, rpTotal - 1);
    base.rpPagerShow = S.reports.length > RPP;
    base.rpPageText = (rpPg + 1) + ' / ' + rpTotal;
    base.onRpPrev = function () { self.setState({ rpPage: Math.max(0, rpPg - 1) }); };
    base.onRpNext = function () { self.setState({ rpPage: Math.min(rpTotal - 1, rpPg + 1) }); };
    base.rpBtnStyle = 'width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--border-default); background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer;';
    base.reportRows = S.reports.slice(rpPg * RPP, rpPg * RPP + RPP).map(function (r) { var pd = { '최근 24시간': 1, '최근 7일': 7, '최근 30일': 30 }[r.period]; var pLabel = pd ? (E.fmtDT(r.ms - pd * 86400000).slice(0, 10) + ' ~ ' + E.fmtDT(r.ms).slice(0, 10) + ' (' + (pd === 1 ? '24시간' : pd + '일') + ')') : r.period; return { id: r.id, dateText: E.fmtDT(r.ms), nameText: String(r.fname || r.id).replace(/\.html$/i, ''), tagsText: r.tags.join(', '), period: pLabel, llmText: r.llm ? 'LLM 소견' : '지표만', llmBg: r.llm ? 'rgba(0,108,210,.14)' : 'rgba(255,255,255,.07)', llmColor: r.llm ? 'var(--primary-light)' : 'var(--text-muted)', onOpen: function () { self._openReport(r); }, onDelete: function () { self.setState({ delRep: r }); } }; });
    base.reportEmpty = S.reports.length === 0;
    // 모달 내부 클릭의 오버레이 닫기 전파 차단 — 모든 모달 공용
    base.stopClick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); };
    // 리포트 삭제 확인 — 보관함 파일은 복구 불가
    base.delRepOpen = !!S.delRep;
    if (S.delRep) {
      base.delRepName = S.delRep.fname;
      base.delRepDate = E.fmtDT(S.delRep.ms);
      base.onDelRepCancel = function () { self.setState({ delRep: null }); };
      base.onDelRepDo = function () { var r = S.delRep; self.setState({ delRep: null }); self._delReport(r.id, r.dir); };
    }

    this._vmSettings(base, eqs);


    return base;
  }

  // 설정 탭 뷰모델 — base를 받아 채우는 형태(호출 순서 의존 있음)
  _vmSettings(base, eqs) {
    var self = this, S = this.state;
    // 설비 정보 미설정 태그 수 — 지정 항목 없으면 기본값 적용 중
    var _unsetCnt = 0;
    eqs.forEach(function (e2) { if (self._equipUnset(e2.id)) _unsetCnt++; });
    // 판정 불가 태그 수 — 미설정(OR)과 별개, 등급은 회전수·베어링 기하 둘 다 필요
    var _blkCnt = 0;
    eqs.forEach(function (e2) { if (self._patBlockedId(e2.id)) _blkCnt++; });
    // 베이스라인 미학습 태그 수 — 학습 가능한데 미학습인 것만(데이터 부족 태그 제외)
    var _blUnCnt = 0, _blOldCnt = 0;
    var _blAll = self._blMap || S.baselines || {};
    eqs.forEach(function (e2) {
      var k2 = e2.table + ':' + e2.name;
      if (!_blAll[k2] && self._blLearnable(e2)) _blUnCnt++;
      // 오래된 기준 — 자동 재학습 없음(진행 중 결함을 정상으로 흡수), 배지로 표시
      if (_blAll[k2] && agoStale(_blAll[k2].at)) { _blOldCnt++; return; }
      var _bb = self._bandBaselines(e2);
      if (_bb && VC.BAND_ORDER.some(function (bn) { return _bb[bn] && agoStale(_bb[bn].at); })) _blOldCnt++;
    });
    base.blOldCnt = _blOldCnt;
    base.equipUnsetDot = _unsetCnt > 0 || _blkCnt > 0 || _blUnCnt > 0 || _blOldCnt > 0; // 헤더 ⚙ 표시등
    base.setNav = [{ id: 'source', label: '데이터 소스', icon: 'database' }, { id: 'equip', label: '설비 정보', icon: 'settings-gear' }, { id: 'criteria', label: '판정 기준', icon: 'dashboard' }, { id: 'monitor', label: '알람 설정', icon: 'pulse' }, { id: 'llm', label: 'LLM 연동', icon: 'sparkle' }, { id: 'data', label: '데이터 관리', icon: 'trash' }].map(function (n) { var a = S.setSection === n.id; var bd = (n.id === 'equip' && _blkCnt > 0) ? '판정 불가 ' + _blkCnt : (n.id === 'equip' && _unsetCnt > 0) ? '미설정 ' + _unsetCnt
        : (n.id === 'criteria' && _blUnCnt > 0) ? '미학습 ' + _blUnCnt
          : (n.id === 'criteria' && _blOldCnt > 0) ? '재학습 ' + _blOldCnt : ''; return { label: n.label, icon: n.icon, badge: bd, onClick: function () { self.setState({ setSection: n.id }); if (n.id === 'criteria') self._refreshBandCov(); if (n.id === 'data') self._refreshUsage(); }, style: 'display: flex; align-items: center; gap: 9px; padding: 9px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; border-left: 2px solid ' + (a ? 'var(--primary-light)' : 'transparent') + '; background: ' + (a ? 'var(--overlay-hover)' : 'transparent') + '; color: ' + (a ? 'var(--text-primary)' : 'var(--text-tertiary)') + '; font-weight: ' + (a ? '600' : '500') + ';' }; });
    base.secSource = S.setSection === 'source'; base.secEquip = S.setSection === 'equip'; base.secCriteria = S.setSection === 'criteria'; base.secMonitor = S.setSection === 'monitor'; base.secLlm = S.setSection === 'llm';
    base.secData = S.setSection === 'data';
    if (base.secSource) this._userVals(base);
    if (base.secData) this._dataVals(base);
    base.mcOptions = ['I', 'II', 'III', 'IV'].map(function (c) { var a = S.machineClass === c; return { label: 'Class ' + c, onClick: function () { self.setState({ machineClass: c, dirty: true }); }, style: 'flex: 1; text-align: center; padding: 10px 6px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: ' + (a ? '600' : '500') + '; border: 1px solid ' + (a ? 'var(--primary-base)' : 'var(--border-default)') + '; background: ' + (a ? 'rgba(0,108,210,.1)' : 'var(--bg-elevated)') + '; color: ' + (a ? 'var(--primary-light)' : 'var(--text-secondary)') + ';' }; });
    var mz = self._effZones({ unit: 'mm/s', cls: S.machineClass }, S);
    var MC_DESC = { I: ['Class I · 소형 기계', '15 kW 이하의 소형 전동기·펌프 등. 기계가 기초와 일체로 거동하는 설비.'], II: ['Class II · 중형 기계', '15–75 kW급 전동기, 또는 특수 기초에 강체 설치된 300 kW 이하 중형 기계.'], III: ['Class III · 대형 · 강성 기초', '강성(rigid) 기초 위에 설치된 대형 회전기계. 기초가 진동을 거의 흡수하지 않음.'], IV: ['Class IV · 대형 · 연성 기초', '연성(flexible) 기초 위의 대형·고속 터보기계(터빈·발전기 등). 허용 진동 범위가 가장 넓음.'] };
    var md = MC_DESC[S.machineClass];
    base.mcDescTitle = md ? md[0] : '머신 클래스 미선택';
    base.mcDescBody = md ? md[1] : '클래스를 선택하세요 — 미선택 시 Class II 기준으로 판정합니다.';
    base.mcZones = [{ ko: '양호 A/B', color: '#3aa76d', range: '< ' + mz[0] }, { ko: '주의 B/C', color: '#d99a2b', range: mz[0] + '–' + mz[1] }, { ko: '위험 C/D', color: '#e07b39', range: mz[1] + '–' + mz[2] }, { ko: '심각 D', color: '#e5484d', range: '> ' + mz[2] }].map(function (z) { return { ko: z.ko, range: z.range + ' mm/s', barStyle: 'height: 6px; border-radius: 3px; background: ' + z.color + ';', dot: z.color }; });
    base.srcTables = (self.liveTables || []).map(function (name) {
      var on = S.srcSel.indexOf(name) >= 0, blk = self._srcBlock(name);
      return { name: name, kind: 'TAG', checked: on, kindColor: '#005fb8', blocked: !!blk, blockReason: blk,
        onToggle: function () { self._toggleSrcTable(name); } };
    });
    // 전체 선택은 선택 가능한 테이블만(미지원 테이블은 조회 실패)
    var _srcOk = base.srcTables.filter(function (t) { return !t.blocked; }).map(function (t) { return t.name; });
    base.srcSelAllLabel = _srcOk.length && S.srcSel.length === _srcOk.length ? '전체 해제' : '전체 선택';
    base.onSrcSelectAll = function () {
      self.setState({ srcSel: S.srcSel.length === _srcOk.length ? [] : _srcOk.slice(), dirty: true });
    };
    base.srcTotal = base.srcTables.length;
    base.srcSelCount = base.srcTables.filter(function (t) { return t.checked; }).length;
    // 상한 안내 — 잘린 경우만, 테이블별 잘린 수 표시(어느 선택을 풀지 판단용)
    var _cap = S.srcCap;
    base.capShow = !!(_cap && _cap.dropped > 0);
    if (base.capShow) {
      base.capText = '선택한 테이블의 태그 ' + _cap.eligible + '개 중 ' + _cap.shown + '개만 감시하고 있습니다 — '
        + _cap.dropped + '개는 표시 상한(테이블당 ' + CAPS.perTable + '개 · 전체 ' + CAPS.total + '개)을 넘어 빠졌습니다.';
      base.capHint = _cap.byTotal
        ? '전체 상한에 걸렸습니다. 지금 보지 않는 테이블의 선택을 풀면 그만큼 자리가 납니다.'
        : '테이블당 상한에 걸렸습니다. 한 테이블에 ' + CAPS.perTable + '개가 넘는 태그가 있으면 뒤쪽 태그는 감시되지 않습니다.';
      base.capRows = (_cap.perTable || []).map(function (p) {
        return { table: p.table, count: p.shown + ' / ' + p.total + '개', dropped: (p.total - p.shown) + '개 제외' };
      });
    }
    // 별칭 편집: 선택된 테이블의 태그(프리페치 캐시) 기준 — 저장 전에도 표시
    this._ensureTags(S.srcSel);
    var aliasRows = [];
    // 상한으로 감시에서 빠진 태그도 목록 표시 — 별칭 미사용 표시(offCap)
    var _dropped = (S.srcCap && S.srcCap.droppedKeys) || {};
    (S.srcSel || []).forEach(function (tb) {
      ((self._tagCache || {})[tb] || []).forEach(function (tg) {
        var aid = tb + ':' + tg;
        aliasRows.push({
          id: aid, name: tb + ' · ' + tg, alias: (S.aliases || {})[aid] || '', aliasPlaceholder: tg,
          offCap: !!_dropped[aid],
          onAlias: function (ev) {
            var m = Object.assign({}, S.aliases);
            if (ev.target.value) m[aid] = ev.target.value; else delete m[aid];
            self.setState({ aliases: m, dirty: true });
          },
        });
      });
    });
    // 검색 — 원명·별칭 모두 대상
    var _tq = (S.tagQuery || '').trim().toLowerCase();
    var _hit = _tq
      ? aliasRows.filter(function (r) { return r.name.toLowerCase().indexOf(_tq) >= 0 || (r.alias || '').toLowerCase().indexOf(_tq) >= 0; })
      : aliasRows;
    // 점진 렌더 — 처음 ALIAS_ROWS_MAX줄, 바닥 도달 시 추가(대량 입력칸 DOM 방지)
    var _shown = Math.max(ALIAS_ROWS_MAX, S.aliasShown || 0);
    base.aliasRows = _hit.slice(0, _shown);
    var _rest = _hit.length - base.aliasRows.length;
    base.aliasMoreText = _rest > 0 ? '아래로 더 내리면 ' + _rest + '개가 이어집니다' : '';
    base.onAliasScroll = function (ev) {
      var el = ev.target;
      if (_hit.length <= _shown) return;                                  // 전부 렌더됨
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 80) return;  // 바닥 미도달
      self.setState({ aliasShown: _shown + ALIAS_ROWS_MAX });
    };
    base.tagQuery = S.tagQuery || '';
    // 검색어 변경 시 줄 수 초기화
    base.onTagQuery = function (ev) { self.setState({ tagQuery: ev.target.value, aliasShown: ALIAS_ROWS_MAX }); };
    base.aliasCountText = _tq ? _hit.length + ' / ' + aliasRows.length + '개' : aliasRows.length + '개';
    base.aliasEmpty = _tq && !_hit.length;
    base.bModelOptions = Object.keys(VC.BEARINGS).concat(['직접 입력']);
    var _eqRows = eqs.map(function (e) {
      // 표시값: 사용자 지정 없으면 빈칸 — Class·단위는 폴백(II·mm/s)으로 판정, 회전수·베어링은 폴백 없음(회전수 기반 축 "측정 불가")
      var selCls = (S.equipCls || {})[e.id] || '';
      var selUnit = (S.equipUnit || {})[e.id] || '';
      var selRpm = (S.equipRpm || {})[e.id] != null ? String(S.equipRpm[e.id]) : '';
      var model = (S.equipBearing || {})[e.id] || '';
      var meta = (S.equipMeta || {})[e.id] || {}, belt = meta.belt || {};
      // 계산용 — 편집 중 값 우선, 없으면 적용값(미입력 0). 종동측이면 센서 축(종동축) 회전수
      var sh = VC.shaftRpm(Number(selRpm) || (e.rpmMotor != null ? e.rpmMotor : e.rpm), meta), rpm = sh.rpm;
      var noBearing = !model;
      var isCustom = !noBearing && !VC.BEARINGS[model];
      // 직접 입력은 저장될 값만 표시 — 직전 품번 값을 보여 주면 저장 안 된 값이 보임
      var geo = noBearing ? { n: 0, Bd: 0, Pd: 0, phi: 0 } : (VC.BEARINGS[model] || Object.assign({ n: 0, Bd: 0, Pd: 0, phi: 0 }, (S.equipGeo || {})[e.id] || {}));
      var isSleeveB = model === 'sleeve', isCatalogB = !noBearing && !isCustom && geo.n > 0;
      var retired = isCustom && geo.name && VC.RETIRED_BEARINGS[geo.name] ? geo.name : '';
      // 마운팅 선택 효과 즉시 표시
      var mFmax = VC.mountFmax(meta.mount);
      var kgBest = (self._detailCache[e.id] && self._detailCache[e.id].det && self._detailCache[e.id].det.kurtogram || {}).best;
      var mountNote = !meta.mount
        ? '마운팅 미상 — 고주파 대역의 유효성을 판단할 수 없어 상한 없이 전 대역을 그대로 씁니다(커토그램 탐색·대역 근거).'
        : '유효 상한 ' + (mFmax / 1000).toFixed(1) + ' kHz — 그 위 대역은 마운팅 공진일 수 있어 결함 대역 탐색에서 제외됩니다.'
          + (kgBest && kgBest.loHz > mFmax ? ' 현재 선택 대역 ' + (kgBest.loHz / 1000).toFixed(1) + ' kHz는 상한을 넘어 재선택됩니다.' : '');
      // 완성도 = 항상 해당되는 항목만(품번·마운팅·구동) + 벨트를 골랐으면 풀리경까지
      var setItems = [!!model, !!meta.mount, !!meta.drive];
      if (meta.drive === 'belt') setItems.push(!!(Number(belt.d1) > 0 && Number(belt.d2) > 0) || sh.src === 'measured');
      var setTotal = setItems.length, setDone = setItems.filter(Boolean).length;
      var sum = VC.faultFreqSummary(rpm, geo);
      // 자동 계산 칩 설명(약어 의미)
      var freqTip = {
        '1×': '회전주파수 — 축이 1초에 도는 횟수(RPM÷60)입니다. 불평형 등 대부분의 기계 결함이 이 값의 정수배에서 나타나 모든 해석의 기준이 됩니다.',
        '1× 회전': '회전주파수 — 축이 1초에 도는 횟수(RPM÷60)입니다. 불평형 등 대부분의 기계 결함이 이 값의 정수배에서 나타나 모든 해석의 기준이 됩니다.',
        '2×': '회전주파수의 2배 성분입니다. 이 성분이 크면 정렬불량을 의심합니다.',
        'BPFO': '외륜 결함 주파수(Ball Pass Frequency, Outer)입니다. 전동체가 외륜의 흠집을 지날 때마다 충격이 나는 빈도로, 포락선 스펙트럼에서 이 주파수와 그 배수가 보이면 외륜 손상 신호입니다.',
        'BPFI': '내륜 결함 주파수(Ball Pass Frequency, Inner)입니다. 내륜은 축과 함께 돌기 때문에, 이 주파수 양옆에 회전주파수 간격의 측대역을 동반하는 것이 특징입니다.',
        'BSF': '전동체(볼) 결함 주파수(Ball Spin Frequency)입니다. 볼 표면의 흠집이 궤도면에 닿는 빈도로, 볼 자체 손상 시 나타납니다.',
        'FTF': '케이지(리테이너) 회전 주파수(Fundamental Train Frequency)입니다. 보통 회전주파수의 0.35~0.45배이며, 케이지 손상·윤활 불량 시 이 성분이 나타납니다.',
      };
      var mkChip = function (label, val) { return { label: label, val: val, tip: freqTip[label] || '' }; };
      var freqChips = (noBearing || sum.sleeve)
        ? [mkChip('1×', sum.fr.toFixed(1)), mkChip('2×', (2 * sum.fr).toFixed(1))]
        : [mkChip('1× 회전', sum.fr.toFixed(1))].concat(sum.list.map(function (p) { return mkChip(p[0], p[1].toFixed(1)); }));
      var geoCells = [{ k: '볼 수 n', v: '' + geo.n }, { k: '볼경 Bd', v: geo.Bd + ' mm' }, { k: '피치경 Pd', v: geo.Pd + ' mm' }, { k: '접촉각 φ', v: geo.phi + '°' }];
      return {
        id: e.id, name: e.name, alias: e.alias || e.name, unit: selUnit, cls: selCls, unset: self._equipUnset(e.id),
        blocked: self._patBlockedId(e.id),
        clsOptions: [{ v: '', l: '— 선택 —' }, { v: 'I', l: 'I · 소형' }, { v: 'II', l: 'II · 중형' }, { v: 'III', l: 'III · 대형·강성' }, { v: 'IV', l: 'IV · 대형·연성' }],
        rpm: selRpm, bModel: model,
        isCustom: isCustom, isSleeve: isSleeveB, isCatalog: isCatalogB, freqChips: freqChips, geoCells: geoCells, adv: !!S.equipAdv[e.id],
        // 라벨은 상태 무관 단일(행마다 다르면 다른 기능으로 오독)
        advLabel: S.equipAdv[e.id] ? '닫기' : '설정',
        bN: geo.n, bBd: geo.Bd, bPd: geo.Pd, bPhi: geo.phi,
        // 목록에 없는 품번(뺀 프리셋·옛 설정)은 이 행 목록에 넣어 선택 상태 유지 — 없으면 '— 선택 —'으로 보임
        bModelOptions: (isCustom && model !== '직접 입력') ? Object.keys(VC.BEARINGS).concat([model, '직접 입력']) : base.bModelOptions,
        // 직접 입력 항목 글자 — 품번 적었으면 품번, 긴 품번은 잘리므로 전체는 툴팁
        bCustomLabel: isCustom && geo.name ? geo.name + ' (직접)' : '직접 입력',
        bModelTitle: isCustom && geo.name ? geo.name + ' (직접 입력)' : '',
        retiredNote: retired ? retired + '은(는) 제조사·설계(E·CC·CA 등)마다 롤러 수가 달라 목록에서 뺐습니다 — 옛 목록 값을 넣어 두었으니 제조사 카탈로그 값으로 확인하세요' : '',
        onModel: function (ev) { self._setEquipBearing(e.id, ev.target.value); },
        onRpm: function (ev) { self._setEquipRpm(e.id, ev.target.value); },
        onCls: function (ev) { self._setEquipCls(e.id, ev.target.value); },
        onUnit: function (ev) { self._setEquipUnit(e.id, ev.target.value); },
        onToggleAdv: function () { self._toggleEquipAdv(e.id); },
        onToggleBulk: function () { self._toggleEquipBulk(e.id); },
        bulkBtnStyle: 'display: inline-flex; align-items: center; justify-content: center; height: 28px; width: 30px; border-radius: 5px; cursor: pointer; border: 1px solid '
          + (((S.equipBulk || {}).id === e.id) ? 'var(--primary-base)' : 'var(--border-medium)') + '; background: '
          + (((S.equipBulk || {}).id === e.id) ? 'rgba(0,108,210,.1)' : 'var(--bg-elevated)') + '; color: '
          + (((S.equipBulk || {}).id === e.id) ? 'var(--primary-light)' : 'var(--text-muted)') + ';',
        bName: geo.name || '',
        onGeoName: function (ev) { self._setEquipGeo(e.id, 'name', ev.target.value); },
        onGeoN: function (ev) { self._setEquipGeo(e.id, 'n', ev.target.value); },
        onGeoBd: function (ev) { self._setEquipGeo(e.id, 'Bd', ev.target.value); },
        onGeoPd: function (ev) { self._setEquipGeo(e.id, 'Pd', ev.target.value); },
        onGeoPhi: function (ev) { self._setEquipGeo(e.id, 'phi', ev.target.value); },
        // 계측·구동 — 기본은 마운팅·구동, 나머지는 해당 설비에서만 표시
        mMount: meta.mount || '', mDrive: meta.drive || '', mVanes: meta.vanes ? String(meta.vanes) : '',
        mBeltD1: belt.d1 ? String(belt.d1) : '', mBeltD2: belt.d2 ? String(belt.d2) : '', mBeltLen: belt.len ? String(belt.len) : '',
        isBelt: meta.drive === 'belt', isGear: meta.drive === 'gear',
        mountNote: mountNote, mountUnset: !meta.mount,
        // 완성도 배지 — 항상 해당되는 항목만 계수(날개수 등 일부 설비 항목 제외)
        setCount: setDone, setTotal: setTotal, setIncomplete: setDone < setTotal,
        mountOptions: [{ v: '', l: '— 미상 —' }, { v: 'stud', l: '스터드(나사)' }, { v: 'adhesive', l: '접착' }, { v: 'magnet', l: '자석' }, { v: 'probe', l: '핸드프로브' }],
        driveOptions: [{ v: '', l: '— 미상 —' }, { v: 'direct', l: '직결' }, { v: 'belt', l: '벨트·풀리' }, { v: 'gear', l: '기어' }],
        beltRatio: meta.sensorPos === 'driven'
          ? (sh.src === 'missing' ? '풀리경 또는 종동축 회전수가 있어야 결함 패턴을 잴 수 있습니다' : '결함 대조 회전수 ' + sh.rpm + ' rpm (종동축 · ' + (sh.src === 'pulley' ? '풀리 환산' : '입력값') + ')')
          : (belt.d1 > 0 && belt.d2 > 0) ? '종동축 1× ' + (sum.fr * belt.d1 / belt.d2).toFixed(1) + ' Hz (비 ' + (belt.d1 / belt.d2).toFixed(2) + ')' : '',
        // 센서 위치 — 종동측이면 표의 RPM 칸에 꼬리표(그 행은 입력 RPM이 그대로 쓰이지 않음)
        sensorPos: meta.sensorPos === 'driven' ? 'driven' : 'motor', isDriven: meta.drive === 'belt' && meta.sensorPos === 'driven',
        rpmTag: (meta.drive === 'belt' && meta.sensorPos === 'driven') ? '종동' : '',
        rpmTagTip: (meta.drive === 'belt' && meta.sensorPos === 'driven')
          ? (sh.src === 'missing' ? '종동측 센서 — 풀리경이나 종동축 회전수가 없어 결함 패턴을 잴 수 없습니다' : '종동축 ' + sh.rpm + ' rpm으로 대조 (' + (sh.src === 'pulley' ? '풀리비 ' + (belt.d1 / belt.d2).toFixed(3) + ' 환산' : '입력값') + ')')
          : '',
        mBeltRpm: belt.drivenRpm ? String(belt.drivenRpm) : '',
        beltRpmPh: (Number(selRpm) || e.rpmMotor || e.rpm) > 0 && belt.d1 > 0 && belt.d2 > 0
          ? String(Math.round((Number(selRpm) || e.rpmMotor || e.rpm) * belt.d1 / belt.d2 * 10) / 10) + ' (풀리 환산)' : '모르면 비워 두세요',
        onSensorPos: function (ev) { self._setEquipMeta(e.id, 'sensorPos', ev.target.value); },
        onBeltRpm: function (ev) { self._setEquipBelt(e.id, 'drivenRpm', ev.target.value); },
        vaneNote: meta.vanes > 0 ? '베인 통과 ' + (sum.fr * meta.vanes).toFixed(1) + ' Hz' : '',
        onMount: function (ev) { self._setEquipMeta(e.id, 'mount', ev.target.value); },
        onDrive: function (ev) { self._setEquipMeta(e.id, 'drive', ev.target.value); },
        onVanes: function (ev) { self._setEquipMeta(e.id, 'vanes', ev.target.value); },
        onBeltD1: function (ev) { self._setEquipBelt(e.id, 'd1', ev.target.value); },
        onBeltD2: function (ev) { self._setEquipBelt(e.id, 'd2', ev.target.value); },
        onBeltLen: function (ev) { self._setEquipBelt(e.id, 'len', ev.target.value); },
      };
    });
    // 목록 필터 — 판정 불가 줄만 표시(좌측 내비 배지와 같은 기준). 자체 스크롤 없음(행 펼침이 갇힘)
    var _eqFilter = S.equipFilter || 'all';
    var _eqMatch = { blocked: function (r) { return r.blocked; } };
    var _chip = function (a, dead) {
      return 'display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 6px; font-size: 12px; font-weight: '
        + (a ? '600' : '500') + '; cursor: ' + (dead ? 'default' : 'pointer') + '; border: 1px solid '
        + (a ? 'var(--primary-base)' : 'var(--border-light)') + '; background: ' + (a ? 'rgba(0,108,210,.1)' : 'var(--bg-elevated)')
        + '; color: ' + (a ? 'var(--primary-light)' : (dead ? 'var(--text-muted)' : 'var(--text-secondary)')) + ';';
    };
    // 필터는 '판정 불가' 하나만(미설정은 그 부분집합이라 중복) — 덜 채운 줄은 행의 n/N 배지·점이 표시
    base.equipFilters = [
      { k: 'all', label: '전체', n: _eqRows.length, tip: '' },
      { k: 'blocked', label: '판정 불가', n: _blkCnt, tip: '회전수와 베어링 기하가 둘 다 있어야 결함주파수 격자를 세울 수 있습니다. 하나라도 없으면 등급을 켜는 축이 비어 카드가 "판정 보류"로 남습니다(미끄럼 베어링도 구름체가 없어 여기 포함됩니다). 좌측 "판정 불가" 배지와 같은 기준·같은 수입니다.' },
    ].map(function (f) {
      var a = _eqFilter === f.k, dead = f.n === 0 && f.k !== 'all';
      return {
        label: f.label, count: f.n, tip: f.tip || null, style: _chip(a, dead),
        onClick: dead ? null : function () { self.setState({ equipFilter: f.k, equipBulk: null }); },
      };
    });
    var _eqShown = _eqMatch[_eqFilter] ? _eqRows.filter(_eqMatch[_eqFilter]) : _eqRows;
    base.equipRows = _eqShown;
    base.equipFilterEmpty = !_eqShown.length && !!_eqRows.length;
    base.onEquipFilterAll = function () { self.setState({ equipFilter: 'all', equipBulk: null }); };
    // 일괄 적용 패널 — 열린 한 행에만, 대상 범위는 좁은 것부터·가장 좁은 것이 기본(오덮어쓰기 방지)
    var _bulk = S.equipBulk, _bRow = null, _bSrc = null;
    if (_bulk) {
      _eqShown.forEach(function (r) { if (r.id === _bulk.id) _bRow = r; });
      eqs.forEach(function (e) { if (e.id === _bulk.id) _bSrc = e; });
    }
    if (_bRow && _bSrc) {
      var _pfx = self._equipPrefix(_bSrc.name);
      var _idsOf = function (arr) { return arr.map(function (x) { return x.id; }); };
      var _idsPfx = _pfx ? _idsOf(eqs.filter(function (x) { return x.table === _bSrc.table && self._equipPrefix(x.name) === _pfx; })) : [];
      var _idsTbl = _idsOf(eqs.filter(function (x) { return x.table === _bSrc.table; }));
      var _idsShown = _eqShown.map(function (r) { return r.id; });
      var _scopes = [];
      if (_idsPfx.length > 1) _scopes.push({ v: 'prefix', label: '같은 설비 ' + _pfx + '*', ids: _idsPfx });
      if (_idsTbl.length > 1) _scopes.push({ v: 'table', label: '같은 테이블 ' + _bSrc.table, ids: _idsTbl });
      // 목록 전체 범위는 테이블 범위와 다를 때만(중복 선택지 방지)
      var _sameAsTbl = _idsShown.length === _idsTbl.length && _idsShown.every(function (id) { return _idsTbl.indexOf(id) >= 0; });
      if (_idsShown.length > 1 && !_sameAsTbl) _scopes.push({ v: 'shown', label: _eqFilter === 'all' ? '목록 전체' : '지금 걸러진 목록', ids: _idsShown });
      // ⚠ 전용 접두어 변수명(_bk*) — 함수 전체가 var 공유라 흔한 이름은 뒤쪽 선언과 같은 바인딩(핸들러가 덮인 값 참조)
      var _bkScope = null;
      _scopes.forEach(function (s) { if (s.v === _bulk.scope) _bkScope = s; });
      if (!_bkScope) _bkScope = _scopes[0] || null;
      var _sm = (S.equipMeta || {})[_bulk.id] || {}, _sbelt = _sm.belt || {};
      var MOUNT_KO = { stud: '스터드', adhesive: '접착', magnet: '자석', probe: '핸드프로브' };
      var DRIVE_KO = { direct: '직결', belt: '벨트·풀리', gear: '기어' };
      var _fSel = _bulk.fields || {};
      // 칩 하나 = 설정 입력칸 하나(묶으면 값 미표시·부분 선택 불가). 벨트 제원은 벨트 구동일 때만, 형상 네 칸은 직접 입력일 때만
      var _sgeo = (S.equipGeo || {})[_bulk.id] || {};
      var _custom = (S.equipBearing || {})[_bulk.id] === '직접 입력';
      var _isBelt = _sm.drive === 'belt', _isGear = _sm.drive === 'gear';
      var _mm = function (v) { return v > 0 ? v + ' mm' : ''; };
      var _fields = [
        { k: 'unit', label: '단위', val: (S.equipUnit || {})[_bulk.id] || '' },
        { k: 'cls', label: 'Class', val: (S.equipCls || {})[_bulk.id] || '' },
        { k: 'rpm', label: 'RPM', val: (S.equipRpm || {})[_bulk.id] ? (S.equipRpm[_bulk.id] + ' rpm') : '' },
        { k: 'bearing', label: '베어링', val: (S.equipBearing || {})[_bulk.id] || '' },
        { k: 'geoName', label: '품번', val: _custom ? (_sgeo.name || '') : '' },
        { k: 'geoN', label: '볼 수 n', val: (_custom && _sgeo.n > 0) ? String(_sgeo.n) : '' },
        { k: 'geoBd', label: '볼경 Bd', val: _custom ? _mm(_sgeo.Bd) : '' },
        { k: 'geoPd', label: '피치경 Pd', val: _custom ? _mm(_sgeo.Pd) : '' },
        // 접촉각 0°(깊은홈 볼베어링)도 정상값 — 형상 있으면 항상 표시
        { k: 'geoPhi', label: '접촉각 φ', val: (_custom && _sgeo.n > 0) ? (_sgeo.phi || 0) + '°' : '' },
        { k: 'mount', label: '계측', val: MOUNT_KO[_sm.mount] || '' },
        { k: 'drive', label: '구동', val: DRIVE_KO[_sm.drive] || '' },
        { k: 'beltPos', label: '센서 위치', val: _isBelt ? (_sm.sensorPos === 'driven' ? '종동측' : '모터측') : '' },
        { k: 'beltD1', label: '풀리 D1', val: _isBelt ? _mm(_sbelt.d1) : '' },
        { k: 'beltD2', label: '풀리 D2', val: _isBelt ? _mm(_sbelt.d2) : '' },
        { k: 'beltLen', label: '벨트길이', val: _isBelt ? _mm(_sbelt.len) : '' },
        { k: 'beltRpm', label: '종동축 회전수', val: (_isBelt && _sm.sensorPos === 'driven' && _sbelt.drivenRpm > 0) ? _sbelt.drivenRpm + ' rpm' : '' },
        { k: 'vanes', label: _isGear ? '잇수' : '날개수', val: _sm.vanes > 0 ? (_sm.vanes + (_isGear ? '개' : '매')) : '' },
      ].filter(function (f) { return !!f.val; }).map(function (f) {
        var on = _fSel[f.k] === undefined ? true : !!_fSel[f.k];
        return {
          k: f.k, on: on, label: f.label, val: f.val,
          style: 'display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 6px; font-size: 12px; cursor: pointer; border: 1px solid '
            + (on ? 'var(--primary-base)' : 'var(--border-medium)') + '; background: ' + (on ? 'rgba(0,108,210,.08)' : 'transparent')
            + '; color: ' + (on ? 'var(--text-primary)' : 'var(--text-muted)') + ';',
          valStyle: 'font-family: var(--font-mono); font-size: 11px; color: ' + (on ? 'var(--primary-light)' : 'var(--text-muted)') + ';',
          onToggle: function () { self._toggleBulkField(f.k, on); },
        };
      });
      var _eff = {}; _fields.forEach(function (f) { if (f.on) _eff[f.k] = true; });
      var _tgtN = _bkScope ? _bkScope.ids.filter(function (id) { return id !== _bulk.id; }).length : 0;
      var _dis = !_tgtN || !Object.keys(_eff).length;
      _bRow.bulkOpen = true;
      _bRow.bulkNone = !_fields.length;
      _bRow.bulkNoTarget = !_scopes.length;
      _bRow.bulkFields = _fields;
      _bRow.bulkScopes = _scopes.map(function (s) {
        var a = !!_bkScope && s.v === _bkScope.v;
        return { label: s.label + ' · ' + (s.ids.length - 1) + '개', style: _chip(a, false), onClick: function () { self._setEquipBulk({ scope: s.v }); } };
      });
      _bRow.bulkApplyLabel = '태그 ' + _tgtN + '개에 적용';
      _bRow.bulkApplyStyle = 'height: 30px; padding: 0 14px; border-radius: 6px; border: none; font-size: 12px; font-weight: 600; color: #fff; background: '
        + (_dis ? 'var(--border-medium)' : 'var(--primary-base)') + '; cursor: ' + (_dis ? 'default' : 'pointer') + ';';
      _bRow.bulkNote = '대상 태그의 해당 항목을 덮어씁니다. 끈 항목과 이 행에 값이 없는 항목은 건드리지 않습니다.';
      _bRow.onBulkApply = function () { if (_dis || !_bkScope) return; self._applyEquipBulk(_bulk.id, _bkScope.ids, _eff); };
      _bRow.onBulkCancel = function () { self.setState({ equipBulk: null }); };
    }
    base.lineHz = S.lineHz || '60';
    base.onLineHz = function (ev) { self.setState({ lineHz: ev.target.value, dirty: true }); };
    // 표시 시간대 — 목록은 브라우저가 아는 IANA 이름 전체(지원 안 하면 주요 지역), 저장 전에는 미리보기만
    var _tzAll = [];
    try { _tzAll = Intl.supportedValuesOf('timeZone'); } catch (e) { _tzAll = TZ_FALLBACK; }
    var _tzPrev = function (z) {
      try { return new Intl.DateTimeFormat('sv-SE', { timeZone: z || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(Date.now()); }
      catch (e) { return ''; }
    };
    var _tzBrowser = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
    base.tzValue = S.displayTz || '';
    base.tzOptions = [{ v: '', l: '브라우저 시간' + (_tzBrowser ? ' (' + _tzBrowser + ')' : '') }, { v: 'UTC', l: 'UTC' }]
      .concat(_tzAll.filter(function (z) { return z !== 'UTC'; }).map(function (z) { return { v: z, l: z }; }));
    base.tzNow = '지금 ' + _tzPrev(S.displayTz) + ((S.displayTz || '') !== (self._ac().displayTz || '') ? ' · 저장하면 적용됩니다' : '');
    base.onTzChange = function (ev) { self.setState({ displayTz: ev.target.value, dirty: true }); };
    // 설정 항목별 호버 도움말 — 항목마다 완결 문장 · data-tip은 textContent 렌더라 줄바꿈은 \n
    base.helpTip = {
      '단위': '센서가 저장하는 물리량입니다. mm/s는 속도, g는 가속도, μm는 변위이며, 데이터를 넣을 때 이미 정해진 값이라 모르면 계측 담당자에게 확인하세요. 등급의 높이는 속도(mm/s) 기준 ISO 10816 존으로 정하며, 가속도·변위 센서도 값을 속도로 환산해 판정하므로 단위가 틀리면 등급 높이가 틀어집니다.',
      'Class': 'ISO 10816 기계 등급으로, 기계의 출력과 기초 강성에 따라 정합니다. I은 소형(15 kW 이하), II는 중형(15~75 kW), III·IV는 대형(각각 강성·연성 기초)입니다. 같은 진동값이라도 등급에 따라 양호/위험 판정이 달라집니다. 비워두면 Class II 기준(1.12 / 2.80 / 7.10 mm/s)으로 판정합니다.',
      'RPM': '이 계측점 베어링이 달린 축의 실제 운전 회전수입니다. 명판의 정격 회전수(예: 1750)를 넣고 동기속도(1800)는 넣지 마십시오. 결함 패턴은 이 값으로 결함 주파수를 계산해 허용오차 1%로 대조하므로, 1% 넘게 틀리면 결함을 놓칩니다. 스펙트럼에서 잰 실측 회전수는 차수 라벨·스펙트럼 해석에 쓰고, 입력값과 2% 넘게 다르면 상세분석에서 알려 드립니다. 자릿수는 반드시 맞아야 합니다 — 3600 rpm 설비에 1800을 넣으면 모든 주파수 해석과 대역 경계가 절반으로 어긋납니다. 비워 두면 회전수 미상으로 처리해 결함 패턴 판정과 대역 추출이 멈추고 등급이 서지 않습니다.\n\n· 감속기(기어) 출력축의 센서면 그 축의 회전수(모터 회전수 ÷ 감속비)를 넣으십시오.\n· 벨트 구동이면 모터의 정격 회전수를 넣고, 센서가 벨트 반대편(팬·펌프 등)이면 설비 설정의 센서 위치를 종동측으로 고르십시오 — 풀리비로 환산합니다.',
      '베어링 모델': '설치된 구름베어링의 품번입니다. 베어링 외륜의 각인이나 정비 이력에서 확인할 수 있습니다. 품번을 고르면 결함 주파수(BPFO/BPFI/BSF/FTF)가 자동 계산되어 베어링 결함을 판정할 수 있게 됩니다. 저널(유막) 베어링이면 sleeve를, 목록에 없는 품번이면 직접 입력을 고르세요. 비워두면 베어링 결함은 판정하지 않습니다.',
      '마운팅 방식': '센서를 기계에 붙인 방법입니다. 나사로 고정했으면 스터드, 본드로 붙였으면 접착, 자석이면 자석, 손으로 대고 재면 핸드프로브를 고르세요. 방식에 따라 믿을 수 있는 주파수 상한이 달라서(스터드 10, 접착 5, 자석 2, 프로브 1 kHz) 그보다 높은 대역은 기계가 아니라 마운팅이 울린 것으로 보고 결함 탐색에서 제외합니다. 모르면 비워두세요. 대신 고주파 분석을 제한 없이 신뢰하게 되므로, 자석 마운트라면 꼭 선택하는 것이 좋습니다.',
      '구동방식': '모터의 힘이 기계로 전달되는 방식입니다. 축이 커플링으로 바로 이어져 있으면 직결, 벨트가 보이면 벨트, 기어박스를 거치면 기어입니다. 벨트를 고르고 풀리 지름을 넣으면 종동축 회전수가 계산되어, 정체를 알 수 없던 진동 성분이 종동축 것인지 밝힐 수 있습니다.',
      '날개수 · 잇수': '펌프나 팬이면 임펠러 날개 개수, 기어 구동이면 잇수입니다. 명판이나 사양서에서 확인하세요. 날개수에 회전수를 곱한 것이 베인 통과 주파수이며, 이 성분이 크면 유동 이상이나 간극 문제를 가리킵니다. 모르면 반드시 비워두세요. 추측으로 넣으면 그 값이 그대로 판정 근거가 됩니다.',
      '센서 위치': '이 센서가 붙은 축입니다. 모터 쪽 베어링이면 모터측, 벨트 반대편(팬·펌프 등) 베어링이면 종동측을 고릅니다.\n\n종동측이면 결함 패턴·결함 주파수·대역을 종동축 회전수로 계산합니다(모터 RPM × 구동 풀리경 ÷ 종동 풀리경). 회전수가 1~2%만 틀려도 결함 부위 판단이 흔들리므로, 타코미터 등으로 잰 종동축 회전수가 있으면 직접 입력하세요.',
      '벨트 제원': '풀리 두 개의 피치 지름(벨트가 감기는 위치의 지름 — 풀리 각인·카탈로그 값, 바깥지름보다 조금 작음)과 벨트 총길이입니다. 벨트 길이는 벨트 옆면의 각인(예: A-50, 5V1200)에서 확인합니다. 지름 두 개만 있으면 종동축 회전수가 나오고, 길이까지 있으면 벨트 자체 결함(균열·결손)의 주파수도 계산됩니다.',
      '대역 추출 주기': '이 주기마다 결함 패턴을 재서 등급을 매기므로, 등급 확정의 회차 길이도 이 주기가 정합니다. 대역 에너지와 결함 패턴은 시간·일 단위로 변하는 값이라 평상시엔 10분이면 충분합니다. 정지·신호 두절·계측 이상은 판정 주기마다 따로 봅니다.'
        + '\n\n다만 베이스라인 학습에는 표본 30개가 필요해 10분 주기면 5시간이 걸립니다. 처음 도입할 때는 과거 채우기로 지난 구간을 소급 추출하면 기다리지 않고 바로 학습할 수 있습니다.'
        + '\n\n40대 기준 서버 부하 — 10분 5.5% · 30분 1.8% · 1시간 0.9%',
      '전원 계통주파수': '모터에 공급되는 상용전원의 주파수로, 한국은 60 Hz입니다. 전기적 결함은 이 값의 2배(120 Hz)에서 나타나며, 기계적 결함과 달리 회전수가 변해도 움직이지 않는 것이 구분 기준입니다. 입력된 RPM이 다른 계통의 동기속도에 맞으면 경고를 표시합니다.',
      // 직접 입력(베어링 형상) — 제조사 카탈로그 기하 제원 항목
      '품번': '베어링의 제조사·품번입니다(예: SKF 22218 E). 판정에는 쓰지 않고, 상세분석·리포트에 어떤 베어링인지 표시합니다. 형상값은 이 품번의 제조사 카탈로그에서 옮겨 적습니다.',
      '볼 수 n': '전동체(볼 또는 롤러)의 개수입니다. 베어링 제조사 카탈로그의 형상 제원에서 확인합니다. 네 값이 모두 있어야 결함 주파수가 계산됩니다.',
      '볼경 Bd': '전동체 하나의 지름(mm)입니다. 카탈로그의 ball diameter 항목입니다.',
      '피치경 Pd': '전동체들의 중심을 잇는 원의 지름(mm)입니다. 카탈로그의 pitch diameter 항목이며, 대략 (내경+외경)÷2입니다.',
      '접촉각 φ': '전동체가 궤도면과 닿는 각도입니다. 깊은홈 볼베어링은 0°, 앵귤러 콘택트는 15~40°입니다. 모르면 0으로 두세요.',
      // 판정 기준 — 존 경계(ISO 10816)·베이스라인 통계, 잘못 바꿔도 에러 없이 판정만 변하므로 의미·영향 명시
      'A/B': 'A(양호)와 B(주의)를 가르는 경계입니다. A는 신품 수준의 진동, B는 제한 없이 장기 운전할 수 있는 수준입니다. 측정값이 이 값을 넘으면 ISO 존이 B로 표시됩니다. 등급은 결함 패턴이 잡혀야 켜지고 켜지면 최소 주의라, 이 경계는 등급을 바꾸지 않습니다.',
      'B/C': 'B(주의)와 C(위험)를 가르는 경계입니다. C부터는 장기 운전에 부적합한 수준이라 조치 권고가 여기서 갈립니다. 결함 패턴이 잡힌 설비가 이 값을 넘으면 등급이 위험으로 올라갑니다. 세 경계 중 실무에서 가장 중요한 값입니다.',
      'C/D': 'C(위험)와 D(심각)를 가르는 경계입니다. D는 기계에 손상을 일으킬 수 있는 수준으로, 긴급 점검 대상입니다. 결함 패턴이 잡힌 설비가 이 값을 넘으면 등급이 심각으로 올라갑니다.',
      '임계 초기화': '수정한 임계값을 ISO 10816 기본값으로 되돌립니다. 값을 직접 수정하면 그때부터는 규격이 아니라 사용자 정의 기준으로 판정한다는 점을 유의하세요.',
      '정상 학습 기간': '이 구간의 데이터를 "정상 상태"로 간주해 중심(μ)과 평소 변동(σ)을 학습합니다. 정지·기동 구간과 순간 스파이크는 자동으로 걸러지지만, 결함이 이미 진행 중인 기간으로 학습하면 그 결함이 정상 기준이 됩니다 — 정상 운전이 확실한 기간을 고르세요. 길수록 다양한 운전 상태가 포함돼 기준이 견고해집니다.',
      'k (σ 배수)': '평소 변동(σ)의 몇 배까지를 정상으로 볼지 정하는 값입니다. k=3이면 정상 데이터의 약 99.7%가 한계 안에 들어옵니다. 낮추면 민감해져 급증을 일찍 잡는 대신 오탐이 늘고, 높이면 그 반대입니다. 확신이 없으면 3을 그대로 두세요.',
      // 알람 — 주기·구간 관계 명시
      '판정 주기': '얼마나 자주 판정하는지입니다.\n3초면 3초마다 한 번씩, 그때까지의 RMS 구간을 평가합니다.\n\n짧게 하면 변화를 빨리 알지만 조회가 그만큼 늘어납니다. 조회는 테이블당 한 번이라 태그 수와는 무관합니다.',
      '평가 주기': '얼마나 자주 판정하는지입니다.\n3초면 3초마다 한 번씩, 그때까지의 RMS 구간을 평가합니다.',
      '대역 학습 기간': '대역별 정상 기준을 배울 구간입니다. 베이스라인과 따로 두는 이유는 표본 밀도가 달라서입니다 — 대역은 추출 주기마다 하나씩만 생깁니다(10분 주기면 24시간에 144개).',
      'RMS 구간': '이 구간에 들어온 원본 전체로 실효값 하나를 냅니다. 길면 짧은 진동이 하나의 상태로 합쳐지고, 짧으면 변화를 잘게 봅니다.\n\n등급은 이 값이 정하지 않습니다 — 결함 패턴이 추출 주기마다 정하고, 이 값은 운전 여부·신호 두절·계측 이상·평소 대비를 봅니다.',
    };
    // 계통주파수 RPM 검산 — 유도전동기 동기속도(120·f/극수)로 50/60 Hz 계열 추정, 자동 변경 없음(사용자 입력 우선)
    base.lineHzHint = (function () {
      var votes = { 50: 0, 60: 0 };
      eqs.forEach(function (e) {
        var r = Number((S.equipRpm || {})[e.id]); // 입력한 값만(미입력 제외)
        if (!(r > 0)) return;
        [50, 60].forEach(function (f) {
          for (var poles = 2; poles <= 12; poles += 2) {
            if (Math.abs(r - 120 * f / poles) / (120 * f / poles) < 0.03) { votes[f]++; return; }
          }
        });
      });
      var sel = Number(S.lineHz || 60), other = sel === 60 ? 50 : 60;
      if (votes[other] > votes[sel]) return { warn: true, text: '입력된 RPM ' + votes[other] + '건이 ' + other + ' Hz 계통 동기속도에 맞습니다 — 설정 확인 필요' };
      if (votes[sel] > 0) return { warn: false, text: 'RPM ' + votes[sel] + '건과 정합' };
      return null;
    })();
    // 컨트롤은 평소 숨김(국내 60 Hz 단일) — 이미 50 설정이거나 RPM이 다른 계통에 맞을 때만 노출
    base.lineHzShow = base.lineHz !== '60' || !!(base.lineHzHint && base.lineHzHint.warn);
    base.unitOptions = ['mm/s', 'g', 'μm'];
    var _clsList = ['I', 'II', 'III', 'IV'];
    // 입력칸엔 사용자 입력 문자열 그대로(_effZones 파싱값이면 '1.'의 점이 지워짐), 미수정 칸만 기본값
    var rawOf = function (arr, i, d) { var v = arr && arr[i]; return (v == null || v === '') ? d : v; };
    base.threshRows = _clsList.map(function (c) {
      var d = VC.ISO_ZONES[c] || VC.ISO_ZONES.II, o = S.classThresh[c] || [];
      return { label: 'Class ' + c, unit: 'mm/s',
        v0: rawOf(o, 0, d[0]), v1: rawOf(o, 1, d[1]), v2: rawOf(o, 2, d[2]),
        on0: function (ev) { self._setClassThresh(c, 0, ev.target.value); },
        on1: function (ev) { self._setClassThresh(c, 1, ev.target.value); },
        on2: function (ev) { self._setClassThresh(c, 2, ev.target.value); } };
    });
    ['g', 'μm'].forEach(function (u) {
      var du = VC.zonesFor(u, 'II'), ou = S.unitThresh[u] || [];
      var _ud = { g: '가속도', 'μm': '변위' }[u] || '';
      base.threshRows.push({ label: u + ' (' + _ud + ')', unit: u,
        v0: rawOf(ou, 0, du[0]), v1: rawOf(ou, 1, du[1]), v2: rawOf(ou, 2, du[2]),
        on0: function (ev) { self._setUnitThresh(u, 0, ev.target.value); },
        on1: function (ev) { self._setUnitThresh(u, 1, ev.target.value); },
        on2: function (ev) { self._setUnitThresh(u, 2, ev.target.value); } });
    });
    // 초기화도 저장해야 확정 — dirty 설정 필수(없으면 저장 안내 없이 옛 값 부활)
    base.onResetThresh = function () {
      self.setState({ classThresh: {}, unitThresh: {}, dirty: true });
      self._toast('임계값을 기본값으로 되돌렸습니다 — 저장해야 적용됩니다', 'warn');
    };
    // 베이스라인(정상 상태 학습) — 판정기준 카드
    base.blWin = S.blWin; base.onBlWin = function (ev) { self.setState({ blWin: ev.target.value }); };
    base.blK = S.blK; base.onBlK = function (ev) { self.setState({ blK: ev.target.value }); };
    var blEqs = this.data ? this._activeEqs() : [];
    base.blEmpty = blEqs.length === 0;
    base.blRows = blEqs.map(function (eq) {
      var key = eq.table + ':' + eq.name, b = (S.baselines || {})[key], busy = (S.blBusy || {})[key];
      var learnable = self._blLearnable(eq);
      var spanSec = Math.round(self._blSpanSec(eq));
      var weak = b && b.spanMin != null && b.spanMin < 10; // 구간 짧음 → 대표성 낮음(참고용)
      // 상태 한 줄엔 핵심값(한계·μ·σ)만, 표본·구간·제외 내역은 호버(행 높이 일정)
      // 되살아난 태그 — 사람 확인 전까지 베이스라인·대역 판정 중단
      var revived = !!(S.revived || {})[key];
      var status, color, statusTip = '';
      if (revived) {
        status = '학습값이 남아 있습니다 — 이전과 같은 설비인가요?';
        color = '#d99a2b';
        statusTip = '방금 추가된 이 태그에 예전 학습값(μ·σ)이 그대로 남아 있습니다.'
          + '\n\n같은 설비라면 그대로 쓰면 되지만, 다른 설비에 같은 이름을 붙인 것이라면 남의 기준으로 판정하게 됩니다.'
          + '\n새 설비가 더 조용하면 이탈이 영영 안 잡히고, 더 시끄러우면 이탈이 계속 표시됩니다. 둘 다 화면에는 "학습됨"으로만 보입니다.'
          + '\n\n확인할 때까지 베이스라인·대역 판정을 멈춥니다. ISO 존 등급은 절대 기준이라 계속 판정합니다.'
          + (b && b.at ? '\n\n남아 있는 학습값: μ ' + b.mu.toFixed(3) + ' · ' + self.E.fmtDT(b.at) + ' 학습' : '');
      }
      else if (busy) { status = '학습 중…'; color = 'var(--primary-light)'; }
      else if (b) {
        var ex = (b.ex && (b.ex.idle || b.ex.ramp)) ? ((b.ex.idle || 0) + (b.ex.ramp || 0)) : 0;
        status = '한계 ' + VC.baselineLimit(b).toFixed(2) + ' ' + eq.unit
          + ' · μ ' + b.mu.toFixed(2) + ' σ ' + b.sigma.toFixed(2) + ' (k=' + b.k + ')'
          + (weak ? ' · 참고용' : '');
        statusTip = '한계 = μ + kσ (최소 μ의 1.2배). 이 값을 넘으면 카드와 근거표에 베이스라인 이탈로 표시됩니다(등급·알림 없음).'
          + '\n\n중심 μ ' + b.mu.toFixed(3) + ' · 평소 변동 σ ' + b.sigma.toFixed(3) + ' · k ' + b.k
          + (b.n != null ? '\n학습 표본 ' + b.n + '개' : '') + (b.spanMin != null ? ' · 구간 ' + b.spanMin + '분' : '')
          + (ex ? '\n제외 ' + ex + '개 — 정지 ' + (b.ex.idle || 0) + ' · 기동/정지 과도 ' + (b.ex.ramp || 0) : '')
          + (weak ? '\n\n⚠구간이 10분 미만이라 대표성이 낮습니다. 더 긴 정상 운전 구간으로 다시 학습하는 것이 좋습니다.' : '');
        statusTip += (b.at ? '\n\n학습 시점 ' + self.E.fmtDT(b.at)
          + (b.evalWin ? ' · ' + b.evalWin + '초 구간 기준' : '')
          + (agoStale(b.at) ? '\n⚠한 달이 넘었습니다 — 그 사이 정비나 운전 조건 변경이 있었다면 다시 학습하십시오.' : '') : '');
        color = weak ? '#d99a2b' : 'var(--text-secondary)';
      } else if (!learnable) {
        status = '학습 불가 · 데이터 ' + spanSec + '초';
        statusTip = '학습에는 최소 ' + VC.BASELINE_MIN_N + '초(=' + VC.BASELINE_MIN_N + '개 버킷) 분량이 필요합니다. 데이터가 더 쌓인 뒤 다시 시도하세요.';
        color = 'var(--text-muted)';
      } else { status = '미학습'; statusTip = '학습하지 않아도 등급 판정은 정상 동작합니다. 학습하면 평소 대비 급증까지 표시합니다.'; color = 'var(--text-muted)'; }
      // 되살아난 태그 처리 — 같은 설비면 유지, 다른 설비면 초기화(즉시 반영)
      var revActions = revived ? {
        keep: function () { self._keepLearned(key); },
        reset: function () { self._resetLearned(key); },
      } : null;
      return {
        revived: revived, revActions: revActions,
        label: self._tagLabel(eq),
        statusText: status, statusColor: color, statusTip: statusTip,
        ago: (b && b.at) ? agoText(b.at) : '', agoStale: !!(b && agoStale(b.at)),
        hasBl: !!b && !busy,
        learnBtnStyle: 'height: 26px; padding: 0 12px; border-radius: 5px; border: none; font-size: 11px; font-weight: 600; color: #fff; background: var(--primary-base);'
          + (learnable && !busy ? ' cursor: pointer;' : ' opacity: .4; cursor: default;'),
        onLearn: function () { if (!learnable) { self._toast('데이터 부족으로 학습 불가 — 데이터 구간 ' + spanSec + '초 (최소 ' + VC.BASELINE_MIN_N + '초)', 'warn'); return; } self._learnBaseline(eq); },
        onDel: function () { self._delBaseline(key, eq); },
      };
    });
    // 대역 범례 — 클릭으로 계열 끄기(축 범위 재계산으로 작은 대역 가시화)
    var _bh = S.bandHide || {};
    base.bandLegend = (this._lastBandSeries || []).map(function (sr) {
      return { label: sr.label, color: sr.color, dash: !!sr.dash, on: !_bh[sr.label],
        onClick: function () { var h = Object.assign({}, self.state.bandHide || {}); if (h[sr.label]) delete h[sr.label]; else h[sr.label] = 1; self.setState({ bandHide: h }); } };
    });
    /* 배수 축 토글 — 무차원 비교, ×1 = 판정선
       그릴 수 있는 계열 수는 렌더 전에 계산(그리는 쪽에서 세면 한 박자 늦음) */
    var _nEq = this._activeEq(S.selTag);
    var _nBl = _nEq ? (this._bandBaselines(_nEq) || {}) : {};
    var _nAll = (this._lastBandSeries || []).length;
    var _nOk = (this._lastBandSeries || []).filter(function (sr) { return sr.key && VC.baselineLimit(_nBl[sr.key]) > 0; }).length;
    // 나누는 값 = 알람 기준(max(μ+kσ, μ×1.2)) — 1.0이 알람선, 0.88은 '알람 기준의 88%'
    base.bandNorm = !!S.bandNorm;
    base.bandNormReady = _nOk > 0;
    base.bandNormLabel = base.bandNorm ? '원값으로 보기' : '알람 기준으로 보기';
    // 학습 없으면 토글 거부·안내 — 켜면 빈 차트(정상 또는 고장으로 오독)
    base.onBandNorm = function () {
      if (!self.state.bandNorm && !(_nOk > 0)) {
        self._toast('대역 베이스라인 학습이 필요한 기능입니다 — 판정 기준에서 먼저 학습하세요', 'warn');
        return;
      }
      self.setState({ bandNorm: !self.state.bandNorm });
    };
    // 일부만 학습됐으면 빠진 계열 수 안내
    base.bandNormNote = (base.bandNorm && _nOk)
      ? '학습 한계(μ+kσ)를 1.0으로 놓고 본 비율 — 1.0을 넘으면 이탈'
        + (_nOk < _nAll ? ' · 학습되지 않은 ' + (_nAll - _nOk) + '개 계열은 빠집니다' : '')
      : '';
    base.onBlLearnAll = function () { blEqs.forEach(function (eq) { if (self._blLearnable(eq)) self._learnBaseline(eq); }); };
    // 확인 대기 태그 수 — 학습 기반 판정 중단 중인 태그 수 표시
    base.revPending = (base.blRows || []).filter(function (r) { return r.revived; }).length;
    base.onKeepAllRevived = function () { self._keepAllLearned(); };
    base.llmProviders = [['claude', 'Claude'], ['openai', 'OpenAI'], ['gemini', 'Gemini'], ['ollama', 'Ollama']].map(function (p) { var a = S.llmProvider === p[0]; return { label: p[1], onClick: function () { self.setState({ llmProvider: p[0], dirty: true, llmConfigured: false, llmTest: null, dxAiText: null }); }, style: 'flex: 1; text-align: center; padding: 9px 6px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: ' + (a ? '600' : '500') + '; border: 1px solid ' + (a ? 'var(--primary-base)' : 'var(--border-default)') + '; background: ' + (a ? 'rgba(0,108,210,.1)' : 'var(--bg-elevated)') + '; color: ' + (a ? 'var(--primary-light)' : 'var(--text-secondary)') + ';' }; });
    base.isOllama = S.llmProvider === 'ollama';
    base.llmApiKey = (S.llmKeys || {})[S.llmProvider] || '';
    base.onLlmKey = function (ev) { var m = Object.assign({}, S.llmKeys); m[S.llmProvider] = ev.target.value; self.setState({ llmKeys: m, dirty: true, llmConfigured: false, llmTest: null }); };
    base.llmModel = (S.llmModels || {})[S.llmProvider] || '';
    base.llmModelPh = '예: ' + ({ claude: 'claude-haiku-4-5-20251001', openai: 'gpt-5.5-2026-04-23', gemini: 'gemini-3.5-flash', ollama: 'ornith:9b' }[S.llmProvider] || '모델명 입력');
    base.onLlmModel = function (ev) { var m = Object.assign({}, S.llmModels); m[S.llmProvider] = ev.target.value; self.setState({ llmModels: m, dirty: true, llmConfigured: false, llmTest: null }); };
    base.ollamaUrl = S.ollamaUrl;
    base.onOllamaUrl = function (ev) { self.setState({ ollamaUrl: ev.target.value, dirty: true, llmConfigured: false, llmTest: null }); };
    base.llmTesting = S.llmTesting; base.llmTestShow = !!S.llmTest; base.llmTestMsg = S.llmTest ? S.llmTest.msg : ''; base.llmTestColor = S.llmTest ? (S.llmTest.ok ? '#3aa76d' : '#e5484d') : ''; base.llmTestIcon = S.llmTest ? (S.llmTest.ok ? 'pass-filled' : 'error') : '';
    base.onTestLLM = function () { self._testLLM(); };
    // 설정 화면 상태 표시 — 입력 중인 값 기준
    var llmReady2 = !!LLM.createLLM(this._llmCfg(S));
    base.llmStatusText = (S.llmConfigured ? '연결됨' : (llmReady2 ? '설정됨 · 테스트 권장' : '미설정')) + (llmReady2 ? ' — ' + this._llmLabel(S) : '');
    base.llmStatusColor = S.llmConfigured ? '#3aa76d' : (llmReady2 ? '#d99a2b' : 'var(--text-muted)');
    base.monitorOn = S.monitorOn;
    base.monToggleStyle = SWITCH_TRACK(S.monitorOn);
    base.monKnobStyle = SWITCH_KNOB(S.monitorOn);
    base.onMonToggle = function () { self.setState({ monitorOn: !S.monitorOn, dirty: true }); };
    // 판정 주기(빈도)와 RMS 구간(폭)은 별개 축 — 주기보다 짧은 구간은 선택 불가(데이터 누락)
    var _ivMs = durMs(S.monitorInterval) || 3000;
    base.evalWindow = S.evalWindow;
    // 프리셋 + 직접 입력 — 현장마다 적정 RMS 구간 상이
    var _PRE = [{ v: '3s', l: '3초' }, { v: '10s', l: '10초' }, { v: '30s', l: '30초' },
      { v: '1m', l: '1분' }, { v: '5m', l: '5분' }, { v: '10m', l: '10분' }, { v: '30m', l: '30분' }, { v: '1h', l: '1시간' }];
    var _cur = S.evalWindow || '10s';
    var _isCustom = !_PRE.some(function (o) { return o.v === _cur; });
    base.evalWindowOptions = _PRE.map(function (o) { return { v: o.v, l: o.l, disabled: durMs(o.v) < _ivMs }; })
      .concat([{ v: '__custom__', l: '직접 입력', disabled: false }]);
    base.evalWindowSel = _isCustom ? '__custom__' : _cur;
    base.evalWinCustom = _isCustom;
    base.evalWinCustomMin = _isCustom ? String(Math.round(durMs(_cur) / 60000 * 10) / 10) : '';
    base.onEvalWindow = function (ev) {
      var v = ev.target.value;
      if (v !== '__custom__') { self.setState({ evalWindow: v, dirty: true }); return; }
      // 직접 입력 전환 — 현재 값을 분으로 환산해 시작값
      var mins = Math.max(1, Math.round(durMs(_cur) / 60000) || 15);
      self.setState({ evalWindow: (mins * 60) + 's', dirty: true });
    };
    base.onEvalWinMin = function (ev) {
      var mins = parseFloat(ev.target.value);
      if (!(mins > 0)) return;
      self.setState({ evalWindow: Math.round(mins * 60) + 's', dirty: true });
    };
    base.monitorInterval = S.monitorInterval;
    base.onMonitorInterval = function (ev) { self.setState({ monitorInterval: ev.target.value, dirty: true }); };
    // 감시 방식 — 앱 감시(열린 동안만) vs 서버 상시(Neo 타이머, 앱 없어도)
    base.monMode = S.monMode;
    base.serverMon = S.monMode === 'server';
    base.monModeOptions = [
      { v: 'app', label: '앱 감시', desc: '앱이 열려 있는 동안만 판정 (기본)' },
      { v: 'server', label: '서버 상시 감시', desc: 'Neo 타이머로 앱을 닫아도 계속 감지' },
    ].map(function (o) {
      var a = S.monMode === o.v;
      return {
        label: o.label, desc: o.desc,
        onClick: function () { self.setState({ monMode: o.v, dirty: true }); },
        style: 'flex: 1; text-align: left; padding: 12px 14px; border-radius: 8px; cursor: pointer; border: 1px solid ' + (a ? 'var(--primary-light)' : 'var(--border-medium)') + '; background: ' + (a ? 'rgba(0,108,210,.08)' : 'var(--bg-elevated)') + ';',
        titleStyle: 'font-size: 13px; font-weight: 600; color: ' + (a ? 'var(--text-primary)' : 'var(--text-secondary)') + ';',
      };
    });
    // 지속 재알림 주기 선택지
    var RENO_OPTS = [{ v: '0', l: '끔' }, { v: '30m', l: '30분' }, { v: '1h', l: '1시간' }, { v: '2h', l: '2시간' }, { v: '6h', l: '6시간' }];
    base.renotifyOptions = RENO_OPTS;
    // 베이스라인 미학습 경고(판정기준 카드) — 학습 가능한데 미학습인 태그 수 (setNav의 _blUnCnt와 동일 기준)
    base.monBlUnlearned = _blUnCnt;
    base.monBlNotice = _blUnCnt > 0;
    var _wl = durKo(durMs(S.evalWindow));
    base.evalBasisText = _wl + ' 구간 RMS';
    // 판정 주기별 조회 부하 표시 — 실측 소요(_tickCostMs) 우선, 첫 틱 전엔 태그 수 선형 추정
    var _nTbl = (S.srcSel || []).length || 1;
    var _nTag = this._activeEqs().length;
    var _measured = this._tickCostMs != null;
    var _cost = Math.round(_measured ? this._tickCostMs : _nTbl * 5 + _nTag * 0.35);
    var _duty = _ivMs > 0 ? _cost / _ivMs * 100 : 0;
    base.evalLoadText = '조회에 회차당 ' + _cost + 'ms' + (_measured ? '(실측)' : '(예상)')
      + '가 걸려 주기의 ' + _duty.toFixed(0) + '%를 씁니다'
      + (_duty >= 100 ? ' — 다음 회차를 밀어냅니다. 주기를 늘리십시오.' : ' — 주기를 늘리는 것을 권합니다.');
    base.evalLoadWarn = _duty >= 50;
    // 구간 < 주기면 데이터 누락 — 저장 전 화면에서 차단
    base.evalWinBad = durMs(S.evalWindow) < _ivMs;
    // 채널은 웹훅 하나 — jsh에 SMTP 없음, HTTP API·자동화 도구 경유는 전부 웹훅 URL로 표현
    base.notifChannels = [
      { key: 'webhook', label: '웹훅', hint: 'Slack · Discord · Google Chat · 자체 엔드포인트 — 이메일·문자는 n8n 등 자동화 도구를 이 URL로 받아 중계', ph: 'https://hooks.slack.com/services/…', ready: true }
    ].map(function (c) {
      var on = !!S.notifCh[c.key];
      var val = (S.notifTo || {})[c.key] || '';
      var t = (S.notifTest && S.notifTest.ch === c.key) ? S.notifTest : null;
      var usable = c.ready && on && !!val;
      return {
        key: c.key, label: c.label, hint: c.hint, ph: c.ph, on: on, value: val,
        testLabel: S.notifTesting === c.key ? '발송 중…' : '테스트 발송',
        testShow: !!t, testMsg: t ? t.msg : '',
        testMsgStyle: 'font-size: 11px; margin-top: 4px; color: ' + (t && t.ok ? '#3aa76d' : '#e5484d') + ';',
        testBtnStyle: 'height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-weight: 600; white-space: nowrap;' + (usable ? ' cursor: pointer;' : ' opacity: .4; pointer-events: none;'),
        toggleStyle: SWITCH_TRACK(on),
        knobStyle: SWITCH_KNOB(on),
        inputStyle: 'height: 32px; width: 100%; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border-medium); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);' + (on && c.ready ? '' : ' opacity: .4; pointer-events: none;'),
        onToggle: function () { self._toggleNotifCh(c.key); },
        onInput: function (ev) { var m = Object.assign({}, self.state.notifTo); m[c.key] = ev.target.value; self.setState({ notifTo: m, dirty: true, notifTest: null }); },
        onTest: function () { self._testNotify(c.key); },
      };
    });
    /* 심각도별 알림 — 방식(즉시/알림 안 함)과 재알림 주기를 한 표에
       - 재알림은 '알림 안 함'이어도 유지(sustained 이벤트는 이력에 기록)
       - 감시 이상 행은 등급 팔레트 미사용·재알림 칸 비활성(상태 유지 중 이벤트 없음) */
    var ROUTE_META = [{ ko: '주의', color: '#d99a2b' }, { ko: '위험', color: '#e07b39' }, { ko: '심각', color: '#e5484d' },
      { ko: HEALTH_ROUTE, color: 'var(--text-muted)', health: true }];
    var _routes = routesWithDefaults(S.routes); // 화면 상태 = 실제 발송 판정과 동일 소스
    base.alertRows = ROUTE_META.map(function (mt) {
      var r = _routes[mt.ko];
      return {
        ko: mt.ko, color: mt.color,
        timing: r.timing || ROUTE_DEFAULT_TIMING[mt.ko],
        onTiming: function (ev) {
          var all = Object.assign({}, S.routes);
          all[mt.ko] = Object.assign({}, r, { timing: ev.target.value });
          self.setState({ routes: all, dirty: true });
        },
        health: !!mt.health,
        renoNA: !!mt.health,   // 재알림 선택칸 비활성 — 낼 이벤트 없음
        reno: (S.renotify || {})[mt.ko] || '0',
        onReno: function (ev) { var all = Object.assign({}, S.renotify); all[mt.ko] = ev.target.value; self.setState({ renotify: all, dirty: true }); },
      };
    });
    // 확정 시간은 판정 기준의 추출 주기가 결정 — 여기선 결과만 표시(값 이중화 방지)
    var _cIv = durMs(S.bandInterval || '10m') || 600000;
    base.confirmIvKo = durKo(_cIv);
    // 웹훅 도착 시점 요약 — 2회 연속 확정이라 주기의 2배
    base.confirmSumKo = durKo(_cIv * 2);
    // 회차별 동작 표 — 등급 표시 칸은 카드 실제 문구 그대로, 악화·복귀 대칭 두 묶음
    var _AMBER = '#d99a2b', _GREEN = '#3aa76d';
    base.confirmSteps = [
      { head: '이상 진입', color: _AMBER },
      { when: '1회차', what: '등급 표시 · 이력에 관찰로 남김', chip: '표시', sent: false, color: _AMBER, first: true },
      { when: '2회차', what: '확정 — 여기서 알람이 시작됩니다', chip: '확정 표시', sent: true, dot: true, color: _AMBER },
      // 발송 내용만 기재(재알림 주기 값은 아래 심각도별 표)
      { when: '이후', what: '재알림 주기마다 다시 알림', chip: '유지', sent: true, color: _AMBER, last: true },
      { head: '정상 복귀', color: _GREEN },
      { when: '1회차', what: '복귀 관찰 — 확정은 아직 유지', chip: '유지', sent: false, color: _GREEN, first: true },
      { when: '2회차', what: '정상 복귀 — 에피소드 종료', chip: '해제', sent: true, dot: true, color: _GREEN, last: true },
    ];
    // 설정 칸까지 이동·강조 — 렌더 후 찾아야 해 한 틱 지연
    base.onGoBandIv = function () {
      // 섹션만 전환 — 설정값 변경 없음
      self.setState({ setSection: 'criteria' });
      setTimeout(function () {
        var el = document.getElementById('band-iv');
        if (!el) { self._scrollTop(); return; }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 잠깐 테두리 강조 — 강조색(파랑) 사용(빨강은 오류·심각 의미)
        el.style.transition = 'box-shadow .2s, background .2s';
        el.style.borderRadius = '7px'; el.style.padding = '7px 9px'; el.style.margin = '3px -9px 0';
        el.style.boxShadow = '0 0 0 2px var(--primary-light)';
        el.style.background = 'var(--bg-input)';
        setTimeout(function () { el.style.boxShadow = 'none'; el.style.background = 'transparent'; }, 1800);
      }, 60);
    };
    // 채널 켜짐 + 전 등급 행 '알림 안 함' 경고 — 감시 이상 행은 제외(기본 즉시라 경고 무력화)
    base.routeNoneWarn = !!S.notifCh.webhook && !GRADE_ROUTES.some(function (k) { return _routes[k].timing === '즉시'; });
    // 대역 베이스라인 — 태그별 상태 + 학습/삭제, 자동 학습 없음(이상 상태를 정상으로 굳힐 위험 — 사람이 판단)
    var bandEqs = this.data ? this._activeEqs() : [];
    base.bandEmpty = bandEqs.length === 0;
    base.bandRows = bandEqs.map(function (eq) {
      var base2 = eq.table + ':' + eq.name;
      var bls = self._bandBaselines(eq);
      var busy = (S.bandBusy || {})[base2];
      var learned = bls ? Object.keys(bls).length : 0;
      var status, color, tip = '', _bandAt = 0;
      if (busy) { status = '학습 중…'; color = 'var(--primary-light)'; }
      else if (learned) {
        var parts = VC.BAND_ORDER.filter(function (bn) { return bls[bn]; });
        var _d0 = (self._detailCache[eq.id] || {}).det;
        var _fr0 = (_d0 && _d0.frMeas && _d0.frMeas.f > 0) ? _d0.frMeas.f : (eq.rpm / 60);
        // 분모 = 측정 가능 주파수 대역 + 성립 포락선 계열(복조 대역 성립 시 1, 품번 있으면 +3) — 분자(learned)와 같은 기준
        var _mnt = ((S.equipMeta || {})[eq.id] || {}).mount || (eq.meta || {}).mount;
        var envAble = VC.demodBand(eq.fs, _mnt) ? (1 + (VC.faultCoeffs(self._bearingGeo(eq, S)) ? 3 : 0)) : 0;
        var able = VC.BAND_FREQ.filter(function (bn) { return VC.bandMeasurable(bn, _fr0, eq.fs); }).length + envAble;
        status = learned + '/' + able + ' 계열 학습됨 · ' + parts.map(function (bn) { return VC.BAND_KO[bn]; }).join('·');
        tip = parts.map(function (bn) {
          var b = bls[bn];
          return VC.BAND_KO[bn] + '  μ ' + b.mu.toFixed(4) + ' · σ ' + b.sigma.toFixed(4) + ' → 한계 ' + VC.baselineLimit(b).toFixed(4) + '  (표본 ' + (b.n || '?') + ')';
        }).join('\n');
        // 빠진 대역과 사유 표시 — 측정 불가(하한 ≥ Nyquist)는 고칠 수 없음을 명시
        var miss = VC.BAND_ORDER.filter(function (bn) { return !bls[bn]; });
        if (miss.length) {
          tip += '\n\n학습 안 됨\n' + miss.map(function (bn) {
            // 대역 경계는 주파수 대역(BAND_FREQ)만 — 포락선 계열은 경계 없음
            var fi = VC.BAND_FREQ.indexOf(bn);
            var e = (fi >= 0 && _fr0 > 0 && eq.fs > 0) ? VC.bandEdges(_fr0, eq.fs / 2)[fi] : null;
            if (e && !VC.bandMeasurable(bn, _fr0, eq.fs)) {
              return VC.BAND_KO[bn] + '  측정 불가 — 하한 ' + Math.round(e[0]) + ' Hz > Nyquist '
                + Math.round(eq.fs / 2) + ' Hz (샘플레이트 ' + eq.fs + ' Hz)';
            }
            if (fi < 0 && !VC.demodBand(eq.fs, _mnt)) return VC.BAND_KO[bn] + '  복조 대역 불성립 — 샘플레이트가 낮거나 마운팅 상한이 낮습니다';
            if ((bn === 'envBPFO' || bn === 'envBPFI' || bn === 'envBSF') && !VC.faultCoeffs(self._bearingGeo(eq, S)))
              return VC.BAND_KO[bn] + '  베어링 품번 미지정 — 설비 정보에서 품번을 넣으면 쌓이기 시작합니다';
            return VC.BAND_KO[bn] + '  표본 부족 또는 학습 실패';
          }).join('\n');
        }
        tip += '\n\n이 한계를 넘으면 카드와 근거표에 한계 대비 배수로 표시됩니다. 원인 대역을 좁히는 근거이며 등급·알림에는 쓰이지 않습니다.';
        var _ats = parts.map(function (bn) { return bls[bn].at || 0; }).filter(Boolean);
        var _at = _ats.length ? Math.max.apply(null, _ats) : 0;
        if (_at) tip += '\n\n학습 시점 ' + self.E.fmtDT(_at)
          + (agoStale(_at) ? '\n⚠한 달이 넘었습니다 — 그 사이 정비나 운전 조건 변경이 있었다면 다시 학습하십시오.' : '');
        _bandAt = _at;
        color = learned < VC.BAND_ORDER.length ? '#d99a2b' : 'var(--text-secondary)';
      } else {
        status = '미학습 — 대역 이탈 판정 안 함';
        tip = '대역값이 최소 ' + VC.BASELINE_MIN_N + '개 쌓여야 학습됩니다. 추출 주기 10분이면 약 5시간, 30분이면 약 15시간이 걸립니다.';
        color = 'var(--text-muted)';
      }
      // 채움 칩 — 학습 창 채움 정도(학습 상태와 별개: 재료 부족 vs 기준 미설정)
      var cv = (S.bandCov || {})[base2];
      var fill = null;
      if (cv) {
        var enough = cv.have >= VC.BASELINE_MIN_N;
        // 분모 미표시 — 격자 경계상 100% 불가, 학습 충분 여부·개수만
        var near = cv.need > 0 && cv.have >= cv.need - 3;   // 경계 3칸은 정상 결손
        fill = {
          text: (enough ? '표본 ' : '표본 부족 ') + cv.have + '개',
          tip: '학습 기간 ' + cv.need + '칸 중 ' + cv.have + '칸에 대역값이 있습니다.'
            + (near ? '\n비어 있는 칸은 구간 경계와 진행 중인 칸이라 정상입니다.'
              : '\n채우기를 누르면 빈 칸만 계산합니다(이미 있는 칸은 건너뜁니다).')
            + (enough ? '\n\n학습 최소 표본(' + VC.BASELINE_MIN_N + '개)을 넘었습니다.'
              : '\n\n학습에는 최소 ' + VC.BASELINE_MIN_N + '개가 필요합니다.'),
          style: 'font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; white-space: nowrap; cursor: help; '
            + (!enough ? 'color: var(--text-muted); background: var(--bg-elevated);'
              : near ? 'color: var(--ok-text); background: var(--ok-soft);'
                : 'color: #d99a2b; background: rgba(217,154,43,.12);'),
        };
      }
      return {
        label: self._tagLabel(eq), statusText: status, color: color, tip: tip, hasBl: learned > 0 && !busy, fill: fill,
        ago: _bandAt ? agoText(_bandAt) : '', agoStale: agoStale(_bandAt),
        learnBtnStyle: 'height: 26px; padding: 0 12px; border-radius: 5px; border: none; font-size: 11px; font-weight: 600; color: #fff; background: var(--primary-base);'
          + (busy ? ' opacity: .4; cursor: default;' : ' cursor: pointer;'),
        onLearn: function () { self._runBandLearn(eq); },
        onDel: function () { self._delBandBaseline(eq); },
      };
    });
    base.onBandLearnAll = function () { bandEqs.forEach(function (eq) { self._runBandLearn(eq); }); };
    // 한눈에 보는 진척 — 몇 개 태그가 판정 가능한 상태인지
    base.bandLearnedN = (base.bandRows || []).filter(function (r) { return r.hasBl; }).length;
    base.bandTotalN = (base.bandRows || []).length;
    // 채우기 대상 — 회전주파수 없으면 제외(사유 표시). plan은 아래 블록에서 선언되므로 별도 계산(호이스팅 회피)
    var _bplan = self._bandPlan(), _skip = _bplan.skipped || [];
    base.bandFillTargets = _bplan.tags.length + '/' + (_bplan.tagTotal || _bplan.tags.length);
    base.bandFillSkipTip = _skip.length
      ? '제외 ' + _skip.length + '개 — ' + _skip.map(function (x) { return x.label + ' (' + x.why + ')'; }).join(', ')
        + '\n\n대역 경계가 회전주파수의 배수로 정의되므로(0.5× · 1.5× · 10×) RPM 없이는 대역을 나눌 수 없습니다. 설비 정보에서 RPM을 입력하십시오.'
      : '';
    // 켜져 있는데 대상 0이면 타이머 미생성 — 토글·'대상 0/m' 칩만으론 불명이라 경고
    base.bandNoTargetWarn = (S.bandOn && !_bplan.tags.length)
      ? self._bandNoTargetWhy({ skipped: _skip }) : '';
    // 표본 수 = 학습 기간 ÷ 추출 주기 — 최소 표본 미달이면 학습 실패를 사전 표시
    var _bIv = durMs(S.bandInterval) || 600000;
    var _bH = BAND_WIN_H[S.bandWin] || 24;
    var _bN = Math.floor(_bH * 3600000 / _bIv);
    var _bOk = _bN >= VC.BASELINE_MIN_N;
    base.bandWin = S.bandWin || '24h';
    base.bandWinOptions = [{ v: '6h', l: '최근 6시간' }, { v: '24h', l: '최근 24시간' },
      { v: '3d', l: '최근 3일' }, { v: '7d', l: '최근 7일' }];
    // 기간 변경 시 현황 재조회 — setState 배치라 새 값을 직접 전달
    base.onBandWin = function (ev) {
      var v = ev.target.value;
      self.setState({ bandWin: v, dirty: true });
      self._refreshBandCov({ bandWin: v });   // 새 값 직접 전달 — state 반영 대기 없음
    };
    base.bandSampleWarn = !_bOk;
    // 표본 수 안내 — 추출 주기·학습 기간 함께 표시
    base.bandSampleText = (IV_KO[S.bandInterval] || S.bandInterval) + '마다 추출하므로 표본 ' + _bN + '개'
      + (_bOk ? '' : ' — 최소 ' + VC.BASELINE_MIN_N + '개가 필요해 학습되지 않습니다. 추출 주기를 줄이거나 학습 기간을 늘리십시오.');
    // RMS 표본 수 — 판정 구간 단위 계수(구간 길수록 감소)
    var _rH = { '1h': 1, '6h': 6, '24h': 24 }[S.blWin] || 24;
    var _rW = Math.max(durMs(S.evalWindow) || 10000, durMs(S.monitorInterval) || 3000) / 1000;
    base.blSampleText = '판정 구간 ' + _rW + '초 단위로 묶어 표본 ' + Math.floor(_rH * 3600 / _rW) + '개';
    base.bandOn = !!S.bandOn;
    base.onBandToggle = function () { var on = !self.state.bandOn; self.setState({ bandOn: on, dirty: true }); if (on) self._refreshBandCov(); };
    base.bandInterval = S.bandInterval || '10m';
    base.bandIntervalKo = IV_KO[base.bandInterval] || base.bandInterval;
    // ── 과거 채우기 ──
    var plan = this._bandPlan();
    base.bandFill = S.bandFill || null;
    var _bandWinKo = { '6h': '6시간', '24h': '24시간', '3d': '3일', '7d': '7일' }[S.bandWin] || '24시간';
    // 남은 칸 기준 안내 — 찬 칸은 재계산 안 함
    var covM = S.bandCov || null;
    var left = 0, fullTags = 0;
    if (covM) {
      plan.tags.forEach(function (t) {
        var c = covM[t.tbl + ':' + t.tag];
        var miss = c ? Math.max(0, c.need - c.have) : plan.perTag;
        left += miss;
        if (!miss) fullTags++;
      });
    } else left = plan.total;
    base.bandFillDesc = !S.bandOn ? '대역 추출을 켜야 채울 수 있습니다.'
      : !plan.tags.length ? '대역을 추출할 태그가 없습니다.'
        // 채우는 구간 = 대역 학습 기간(_bandPlan의 BAND_WIN_H)
        : left === 0 ? '최근 ' + _bandWinKo + ' 구간이 모두 채워져 있습니다 · 태그 ' + fullTags + '개.'
          : '이미 쌓인 원본에서 최근 ' + _bandWinKo + '을 ' + base.bandIntervalKo
            + ' 간격으로 계산합니다 · 남은 ' + left + '개 · 약 ' + fmtDur(left * BAND_PER_MS)
            + (fullTags ? ' (태그 ' + fullTags + '개는 이미 완료 — 건너뜁니다)' : '')
            + '. 최신부터 채우므로 중간에 멈춰도 채운 만큼 학습에 씁니다.';
    base.bandFillNone = left === 0 && !!covM;
    // 행에는 결론만, 근거는 위 설명 툴팁
    base.bandFillShort = !S.bandOn ? '추출을 켜야 채울 수 있습니다'
      : !plan.tags.length ? '태그 없음'
        : left === 0 ? '완료 · 태그 ' + fullTags + '개'
          : '남은 ' + left + '개 · 약 ' + fmtDur(left * BAND_PER_MS);
    base.bandFillBtnStyle = 'height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-medium); font-size: 11px; font-weight: 600; '
      + (S.bandOn && plan.tags.length && !base.bandFillNone ? 'background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer;' : 'background: transparent; color: var(--text-muted); cursor: not-allowed; opacity: .5;');
    base.bandFillBarStyle = 'height: 100%; border-radius: 3px; background: var(--primary-base); transition: width .2s; width: '
      + (S.bandFill && S.bandFill.total ? Math.round(S.bandFill.done / S.bandFill.total * 100) : 0) + '%;';
    base.bandFillEta = S.bandFill ? fmtDur(S.bandFill.eta) : '';
    base.onBandFill = function () { if (S.bandOn && plan.tags.length) self._runBandBackfill(); };
    base.onBandFillStop = function () { self._cancelBandBackfill(); };
    // ── 주기 변경(확정 절차) ──
    base.bandIvOpen = !!S.bandIvOpen;
    base.bandIvNext = S.bandIvNext || base.bandInterval;
    base.bandIvSame = base.bandIvNext === base.bandInterval;
    base.onBandIvOpen = function () { self.setState({ bandIvOpen: true, bandIvNext: self.state.bandInterval || '10m', bandIvAct: 'keep' }); };
    // 회차보다 짧은 주기는 잠금(회차 겹침으로 미완주) — 규모 의존 값이라 목록에선 유지하고 라벨에 사유
    var _bandN = (this._bandTags().tags || []).length;
    var _passSec = Math.round(_bandN * BAND_TAG_SEC);
    base.bandPassSec = _passSec;
    base.bandIvOptions = [
      { v: '10m', l: '10분', sec: 600 }, { v: '30m', l: '30분', sec: 1800 }, { v: '1h', l: '1시간', sec: 3600 },
    ].map(function (o) {
      // 여유 2배 — 태그 소폭 증가에도 겹침 방지
      var bad = _passSec > 0 && o.sec < _passSec * 2;
      return { v: o.v, l: bad ? o.l + ' — 회차(' + _passSec + '초)보다 짧음' : o.l, disabled: bad };
    });
    // 이 주기는 등급 확정 회차 길이도 결정 — 확정 흐름은 알람 설정 회차 표 참고
    base.bandIvHint = _passSec > 0
      ? '감시 태그 ' + _bandN + '개 → 한 회차 약 ' + _passSec + '초. 회차보다 짧은 주기는 겹쳐서 아무것도 쌓이지 않습니다.'
        + ' 이 주기가 등급 확정의 회차 길이도 정합니다(알람 설정 참고).'
      // 10분 하한 사유 안내
      : '추출 창이 샘플레이트에 따라 최대 4분대라 그보다 짧은 주기는 같은 구간을 겹쳐 잽니다.'
        + ' 이 주기가 등급 확정의 회차 길이도 정합니다 — 정지·신호 두절·계측 이상은 판정 주기마다 따로 봅니다.';
    // 드롭다운 선택 시 확인 절차 — 주기 변경은 이전 구간과 밀도 불일치(학습 편향·채운 값 간격 어긋남)
    base.onBandIvPickDirect = function (ev) {
      var v = ev.target.value;
      if (v === (self.state.bandInterval || '10m')) return;
      self.setState({ bandIvOpen: true, bandIvNext: v, bandIvAct: 'keep' });
    };
    base.onBandIvCancel = function () { self.setState({ bandIvOpen: false }); };
    base.onBandIvPick = function (ev) { self.setState({ bandIvNext: ev.target.value }); };
    base.bandIvFacts = this._bandIvFacts(base.bandIvNext, plan);
    base.bandIvChoices = ['keep', 'refill', 'reset'].map(function (a) {
      var L = { keep: ['그대로 둠', '밀도가 섞이지만 학습 시 균일화로 보정됩니다. 추세 그래프의 해상도만 구간마다 달라집니다.'],
        refill: ['새 주기로 다시 계산', '이전 구간을 새 간격으로 채웁니다 — ' + fmtDur(self._bandPlan().etaMs) + ' 예상. 밀도가 처음부터 균일해집니다.'],
        reset: ['대역 베이스라인 초기화', '학습된 기준을 지우고 새 주기로 다시 모읍니다. 설비 상태가 바뀐 시점이면 이쪽이 맞습니다.'] }[a];
      return { on: (S.bandIvAct || 'keep') === a, label: L[0], desc: L[1],
        onPick: function () { self.setState({ bandIvAct: a }); },
        style: 'display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; margin-bottom: 6px; border-radius: 7px; cursor: pointer; border: 1px solid '
          + ((S.bandIvAct || 'keep') === a ? 'var(--primary-base); background: var(--primary-soft);' : 'var(--border-light); background: transparent;') };
    });
    base.bandIvApplyStyle = 'height: 34px; padding: 0 14px; border-radius: 6px; border: none; font-size: 13px; font-weight: 600; '
      + (base.bandIvSame ? 'background: var(--border-medium); color: var(--text-muted); cursor: not-allowed;' : 'background: var(--primary-base); color: #fff; cursor: pointer;');
    base.onBandIvApply = function () { self._applyBandInterval(); };
    base.bandToggleStyle = SWITCH_TRACK(S.bandOn);
    base.bandKnobStyle = SWITCH_KNOB(S.bandOn);
    base.routeTimings = ['즉시', '알림 안 함']; // 묶음(digest) 미구현 — 무동작 선택지 제외
    base.settingsDirty = S.dirty;
    base.onSaveSettings = function () { self._saveSettings(); };
    base.onFormChange = function () { self._markDirty(); };
    base.pendingNavOpen = !!S.pendingNav;
    base.onConfirmSave = function () { self._confirmNav('save'); };
    base.onConfirmDiscard = function () { self._confirmNav('discard'); };
    base.onConfirmCancel = function () { self._confirmNav('cancel'); };
  }

  render() { return view(this.renderVals()); }
}
