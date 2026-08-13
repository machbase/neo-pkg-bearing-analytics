// 화면 로직 — 이 파일이 소스다. renderVals()가 view.js에 넘길 값을 만든다.
// (최초 골격만 프로토타입 dc.html에서 자동 변환했고, 그 변환기는 지금 없다.)
import { Component } from 'preact/compat';
import { view } from './view.js';
import { listTagTables, tagSchemas, listTags, tagStats, rollupTrend, loadConfig, saveConfig, saveConfigPartial, buildLiveData, liveDetail, emptyDet, rollupBatch, loadTrendChunks , timerStates, MON_TIMER, BAND_TIMER, WD_TIMER, createWdTimer, deleteWdTimer, rawWindow, CAPS, pkgBase} from './data/live.js';
import { ensureMonTables, loadEventsRange, countEvents, loadBaselines, saveBaseline, deleteBaseline, insertEvent, loadMonState, saveMonState, createMonitorTimer, deleteMonitorTimer, createBandTimer, deleteBandTimer, bandRaw, bandLatest, bandTrend, bandBackfill, bandTimes } from './data/live.js';
import { usageStats, countRange, tagUsage, deleteEventsRange, deleteEventsOfTag, deleteBandRange, deleteBandOfTag, deleteMonState } from './data/live.js';
import { runTql } from './data/live.js';
import Monitor from '../../cgi-bin/monitor/monitor.js';
import Band from '../../cgi-bin/monitor/band.js';
import Watchdog from '../../cgi-bin/monitor/watchdog.js';
import Notify from '../../cgi-bin/notify/notify.js';
// 별칭 편집이 한 번에 그리는 줄 수 — 목록 자체는 전부이고, 넘치는 만큼은 검색으로 좁혀 찾는다
var ALIAS_ROWS_MAX = 200;
var GRADE_WORDS = ['양호', '주의', '위험', '심각']; // 이벤트 GRADE 저장·표시용(인덱스 ↔ 단어)
// 대역 학습 기간 — 표본이 성겨서 RMS보다 긴 선택지가 필요하다. 1시간은 어떤 추출 주기로도
// 최소 표본(30)을 못 채워 아예 넣지 않는다(10분 주기면 6개).
var BAND_WIN_H = { '6h': 6, '24h': 24, '3d': 72, '7d': 168 };
var ISO_WIN_MS = 1000;      // ISO 대역제한 계산에 쓰는 원본 창 — 1초면 10 Hz가 10주기 들어간다
var ISO_TTL_MS = 30000;     // 태그당 재계산 최소 간격 — 경계를 오가도 원본 조회가 폭주하지 않게
/* 원본으로 본 계측 판정(스파이크·클리핑)의 유효기간. 원본은 알람 조건이 섰을 때만 받으므로,
   이상이 멎어 값이 경계 아래로 내려가면 다시 볼 기회가 없다 — 시각을 안 찍으면 그 판정이
   영구히 남아 배지가 안 떨어진다. 재측정 주기(TTL)의 2배가 지나면 무효로 본다. */
var GATE_RAW_TTL_MS = 60000;
/* 조용한 태그의 ISO 재측정 주기. 알람 근처면 30초(ISO_TTL_MS)로 빠르게 따라가고, 양호하면
   이 주기로만 갱신한다 — 값이 안 변하는 태그에 매 틱 원본을 받을 이유가 없다(태그당 20~210 ms).
   건너뛰지 않고 재는 이유는 카드의 큰 숫자를 항상 같은 양(ISO 대역제한)으로 두기 위해서다:
   상한값(전대역)으로 대신하면 고주파가 많은 센서가 조용한데도 크게 보여 카드끼리 비교가 깨진다. */
var ISO_TTL_QUIET_MS = 300000;
/* 감시가 죽었을 때 스스로 다시 등록하는 한도. Neo 타이머는 스크립트가 한 번 던지면 STOP으로
   두고 재시도하지 않아, 순간적인 연결 실패(소켓 고갈 등) 하나가 감시를 영구히 끈다.
   그렇다고 무한히 재시도하면 안 된다 — 스크립트가 깨진 경우는 몇 번을 등록해도 같은 자리에서
   죽는데, 그때마다 배너가 "복구했다"로 바뀌면 진짜 고장이 가려진다. 그래서 횟수를 제한하고
   소진되면 손을 떼고 사유를 그대로 보여준다. */
/* 감시자 주기 — 하는 일이 남의 심박 조회뿐이라 짧게 잡아도 부담이 없다. 앱이 닫혀 있을 때
   감시가 죽으면 이 주기 안에 되살아난다. */
/* 대역 추출 한 태그당 예상 소요(초) — 원본 조회 + FFT(32,768점).
   주기를 고를 때 "이 설치에서 한 회차가 몇 초인지"를 계산하는 데 쓴다. */
var BAND_TAG_SEC = 0.9;
/* "타이머가 없는 것이 맞는 상태"를 나타내는 서명. 서명을 null로 두면 다음 확인 때 또 지우러
   가는데, 없는 타이머 DELETE는 Neo가 500을 돌려준다 — 새 설치에서 10초마다 실패 요청 세 건이
   영원히 나가고, 그 소음이 진짜 오류를 덮는다. 한 번 지웠으면 지웠다고 기억한다. */
var SIG_NONE = '(none)';
var WD_TICK_MS = 300000;
var WD_SCHED = '@every 5m';
var RECOVER_MAX = 3;
var RECOVER_GAP_MS = 120000;      // 시도 간격 — 등록 직후엔 아직 첫 회차가 안 돌았을 수 있다
var RECOVER_CALM_MS = 1800000;    // 이만큼 조용하면 처음부터 다시 센다

/* 저장·복원하는 설정 키 — state 키와 이름이 같다.
   저장(_cfgFromState)과 복원(_applyLive)이 이 한 목록을 공유한다(따로 적으면 저장만 되고 복원이 안 되는 키가 생긴다).
   여기 추가한 키는 db.js CONFIG_FILES에도 넣어야 파일에 실제로 쓰인다. */
var CFG_KEYS = ['srcSel', 'machineClass', 'classThresh', 'unitThresh',
  'equipCls', 'equipRpm', 'equipBearing', 'equipGeo', 'equipUnit', 'equipMeta', 'lineHz', 'cardOrder',
  'knownTags', 'revived',
  'evalWindow', 'monitorOn', 'notifCh', 'notifTo', 'routes', 'aliases',
  'monitorInterval', 'monMode', 'escHold', 'recHold', 'renotify', 'bandOn', 'bandInterval', 'bandWin',
  'llmProvider', 'llmKeys', 'llmModels', 'ollamaUrl', 'genLLM'];
/* 일괄 적용 항목 ↔ 설정 입력칸 — 칩 하나가 입력칸 하나다(뷰모델과 적용이 같은 표를 쓴다).
   형상·벨트는 값마다 칸이 따로라 여기서도 따로 다룬다. */
var GEO_F = { geoN: 'n', geoBd: 'Bd', geoPd: 'Pd', geoPhi: 'phi' };
var BELT_F = { beltD1: 'd1', beltD2: 'd2', beltLen: 'len' };
/* on/off 스위치의 트랙·손잡이 — 네 곳(알람·대역·알림채널·리포트 LLM)이 같은 물건이므로 한 곳에서 만든다.
   손잡이는 두 테마 모두 흰색이라 꺼진 트랙에 흰 계열 표면색(--bg-elevated 등)을 쓰면 안 된다:
   라이트에서 그 값이 순백이라 손잡이가 트랙에 묻혀 켜짐/꺼짐이 구분되지 않는다. */
function SWITCH_TRACK(on) {
  return 'width: 40px; height: 23px; border-radius: 12px; position: relative; cursor: pointer; transition: background .15s;'
    + ' flex-shrink: 0; background: ' + (on ? 'var(--primary-base)' : 'var(--switch-off)') + ';';
}
function SWITCH_KNOB(on) {
  return 'position: absolute; top: 3px; left: ' + (on ? '20px' : '3px') + '; width: 17px; height: 17px; border-radius: 50%;'
    + ' background: var(--switch-knob); box-shadow: 0 1px 2px var(--switch-knob-shadow); transition: left .15s;';
}
/* 대역 추출 주기 — 10분 아래를 두지 않는다. 추출 창이 2^15 샘플 고정이라 샘플레이트가 낮으면
   실제 길이가 분 단위가 되고(128 Hz면 4.3분), 그보다 짧은 주기는 같은 구간을 겹쳐 잰다.
   짧은 간격 표본은 서로 상관이 강해 개수만 늘고 σ 추정이 나아지지도 않는다.
   급격한 이상은 광대역 감시(monitor.tql, 초 단위)가 따로 보므로 안전이 깎이지 않는다. */
var IV_KO = { '10m': '10분', '30m': '30분', '1h': '1시간' };
// 사람이 읽는 소요 시간 — 초/분/시간 한 단위만(정밀도보다 감이 중요)
function fmtDur(ms) {
  if (!(ms > 0)) return '0초';
  var s = Math.round(ms / 1000);
  if (s < 60) return s + '초';
  var m = Math.round(s / 60);
  if (m < 60) return m + '분';
  return (m / 60).toFixed(m % 60 ? 1 : 0) + '시간';
}
/* 학습 시점 표기 — "언제 배운 기준인지"는 값 자체만큼 중요하다. 설비를 정비했거나 운전 조건이
   바뀐 뒤의 기준은 더 이상 정상을 대표하지 않는데, 값만 보면 그걸 알 수 없다. */
function agoText(ms) {
  if (!(ms > 0)) return '';
  var d = Date.now() - ms;
  if (d < 60000) return '방금';
  if (d < 3600000) return Math.round(d / 60000) + '분 전';
  if (d < 86400000) return Math.round(d / 3600000) + '시간 전';
  var days = Math.round(d / 86400000);
  return days < 30 ? days + '일 전' : Math.round(days / 30) + '개월 전';
}
// 오래된 기준은 색으로도 드러낸다 — 30일이면 그 사이 정비가 있었을 가능성이 높다
function agoStale(ms) { return ms > 0 && Date.now() - ms > 30 * 86400000; }
var BAND_PER_MS = 1250;   // 앵커 하나 예상 소요
var BAND_CHUNK = 20;      // 한 요청에 담는 앵커 수 (약 25초 — 타임아웃 여유 안에서 왕복 낭비를 줄인다)
var BAND_CHUNK_GAP = 400; // 청크 사이 쉼 — 감시 타이머에 자리를 내준다
var TYPEKO = { threshold: '임계 초과', sustained: '상태 지속', recovery: '정상 복귀', improve: '상태 개선', signal_lost: '신호 두절', sensor_fault: '계측 이상', sensor_ok: '계측 복귀', baseline: '베이스라인 이탈', band: '대역 이탈', bandrec: '대역 복귀' };
/* 생성된 TQL의 짧은 지문(FNV-1a) — 서버 타이머 재굽기 판단에 쓴다.
   길이만 비교하면 같은 길이의 다른 코드를 놓친다. 충돌 확률보다 "안 구워지는 것"이 위험하다. */
function srcSig(s) {
  var h = 2166136261, i;
  for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h.toString(36);
}
// 심각도별 기본 라우팅 — 채널만 켜면 위험·심각은 바로 알림이 가야 한다(주의는 소음이라 기본 꺼짐).
// 사용자가 한 번이라도 건드린 심각도는 저장된 값이 그대로 우선한다.
var ROUTE_ORDER = ['주의', '위험', '심각'];
/* 심각도별 기본 알림 방식 — 발송 여부는 timing 하나로만 정한다(채널이 웹훅 하나라 별도 체크박스는 이중 부정이 된다). */
var ROUTE_DEFAULT_TIMING = { '주의': '알림 안 함', '위험': '즉시', '심각': '즉시' };
function routesWithDefaults(routes) {
  var out = {};
  ROUTE_ORDER.forEach(function (k) {
    var r = (routes || {})[k];
    out[k] = r ? r : { timing: ROUTE_DEFAULT_TIMING[k] };
  });
  return out;
}
// 조회 기간 프리셋(시간 단위). 짧은 창일수록 고해상도 버킷(≤2h=초·≤3d=분)이 잡힌다.
var PERIOD_H = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 };
// 계측 게이트 발동 시 전 결함 후보에 적용하는 근거점수 상한 — 게이트는 전역 상태이며 특정 후보만 누르면
// 검증되지 않은 후보가 자동으로 1위로 올라온다(단발 임펄스는 스펙트럼 전체 진폭을 오염시킴).
var GATE_CAP = 40;
// 알람 시나리오 지속시간(진입 확인·복귀 유지·지속 재알림)의 코드→ms 변환
var DUR_MS = { '0': 0, '1s': 1000, '3s': 3000, '5s': 5000, '10s': 10000, '30s': 30000, '1m': 60000, '2m': 120000, '5m': 300000, '10m': 600000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '6h': 21600000 };
/* 프리셋에 없는 값은 "<초>s" 형태로 저장한다(예: 900s = 15분) — 진동 주기가 현장마다 달라
   고정 후보로는 못 덮기 때문이다. 파싱을 여기 한 곳에 두어 저장·판정·표시가 같은 규칙을 쓴다. */
function durMs(s) {
  if (DUR_MS[s] != null) return DUR_MS[s];
  var m = /^(\d+)s$/.exec(String(s || ''));
  return m ? +m[1] * 1000 : 0;
}
// ms → 사람이 읽는 라벨 (직접 입력값도 초/분/시간으로 보여준다)
/* 경과 시간·구간 길이 표기. 소수를 쓰지 않는다 — "6.2분 전"은 읽는 사람이 소수점을 분으로
   환산하게 만들고(0.2분이 12초라는 것을 계산해야 한다), 있지도 않은 정밀도를 주장한다.
   대신 아래 단위를 붙인다: 1시간 54분. 서버 판정기의 durAgo와 같은 규칙이어야 한다
   (이벤트 DETAIL과 화면이 같은 사건을 다르게 적으면 같은 것인지 알 수 없다). */
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
/* 판정 틱과 카탈로그 틱을 분리한다 — 태그 증감은 사람이 하는 일이라 매 판정마다 확인할 이유가 없다.
   판정 조회는 배치(NAME IN)로 묶어 테이블당 1회다. */
var CAT_TICK_MS = 10000;   // 카탈로그(태그 증감) 확인 주기
/* RMS 구간의 끝을 지금으로 잡으면 마지막 버킷이 아직 적재 중이다.
   여유를 두고 조회하고, 미완성 버킷은 windowRms가 cnt로 걸러낸다. */
var WIN_LAG_MS = 4000;
// 순수 판정 상태머신 — 한 태그의 한 틱. 앱·서버 타이머 공통 규칙의 단일 출처(서버 TQL도 이 로직을 미러링).
//  prev: 직전 MONSTATE(없으면 null·falsy) · rg: 원시 등급(0~3) · breach: 베이스라인 이탈 · now: ms
//  cfg: { escHold, recHold, reno:{1:ms,2:ms,3:ms} }  (전부 ms · reno 0=끔)
//  반환: { next, events:[{etype, gi}] } — etype: threshold(악화)·sustained(지속)·recovery(정상복귀)·baseline
function judgeTick(prev, rg, breach, now, cfg, bandState, run) {
  var events = [], next;
  /* run=false면 판정을 얼린다 — 설비 정지·센서 이상으로 값이 떨어진 것을 "개선"으로 읽으면 안 된다.
     진동 결함은 스스로 낫지 않으므로, 설명되지 않는 하락은 대개 측정 대상을 잃은 것이다.
     상태를 그대로 들고 있어야 재가동 시 "나빴다"는 사실이 남는다(양호로 리셋되면 이력이 사라진다). */
  if (run === false) {
    next = prev ? {
      g: prev.g, since: prev.since != null ? prev.since : now, cand: prev.g, candSince: prev.candSince != null ? prev.candSince : now,
      lastRe: prev.lastRe != null ? prev.lastRe : now, b: prev.b, bb: prev.bb, alarmG: prev.alarmG, imp: prev.imp,
    } : { g: 0, since: now, cand: 0, candSince: now, lastRe: now, b: false };
    if (prev && prev.bcs != null) next.bcs = prev.bcs;
    return { next: next, events: events, frozen: true };
  }
  if (!prev) {
    // 최초 관측 — 즉시 확정. 이미 나쁘면 현재 나쁨을 알려야 하므로 기록
    next = { g: rg, since: now, cand: rg, candSince: now, lastRe: now, b: breach };
    if (rg > 0) { events.push({ etype: 'threshold', gi: rg }); next.alarmG = rg; }
  } else if (rg === prev.g) {
    // 확정 등급 유지 — 후보 해제, 지속 재알림 검사
    var lastRe = prev.lastRe != null ? prev.lastRe : (prev.since != null ? prev.since : now);
    next = { g: prev.g, since: prev.since != null ? prev.since : now, cand: prev.g, candSince: prev.since || now, lastRe: lastRe, b: breach, alarmG: prev.alarmG, imp: prev.imp };
    if (prev.g > 0) {
      var ivr = cfg.reno[prev.g] || 0;
      if (ivr > 0 && now - lastRe >= ivr) { events.push({ etype: 'sustained', gi: prev.g }); next.lastRe = now; }
    }
  } else {
    // 후보 전이 (rg != prev.g) — 방향별 지속시간 요구(악화=진입 확인, 개선=복귀 유지)
    var hold = rg > prev.g ? cfg.escHold : cfg.recHold;
    /* 개선 방향으로 계속 내려가는 중에는 후보 시각을 유지한다 — 등급이 매 틱 달라진다고 리셋하면
       심각→위험→주의→양호처럼 단계적으로 좋아질 때 recHold를 영영 못 채워 복귀가 안 난다.
       "더 나빠졌을 때"만 후보를 새로 잡는다(악화는 확인이 필요하므로). */
    var down = rg < prev.g && prev.cand != null && rg <= prev.cand;
    var candSince = (prev.cand === rg || down) ? (prev.candSince != null ? prev.candSince : now) : now;
    if (now - candSince >= hold) {
      next = { g: rg, since: now, cand: rg, candSince: now, lastRe: now, b: breach, alarmG: prev.alarmG, imp: prev.imp };
      if (rg > prev.g) { events.push({ etype: 'threshold', gi: rg }); next.alarmG = rg; next.imp = 0; }   // 악화 — 새 에피소드
      else {
        /* 개선을 두 순간으로 나눈다 — 운영자에게 의미가 다르기 때문이다.
             improve  : 알람 수준에서 벗어남 → 우선순위 하향, 긴급 대응 해제
             recovery : 완전 정상 도달       → 작업지시 종료
           하나로 합치면 "recovery(위험)"처럼 등급과 뜻이 어긋나고, 단계마다 내면
           심각→위험→주의→양호에서 3건이 되어 소음이 된다. 에피소드당 각 1건씩만 낸다.
           양호 도달만 복귀로 보면 존 경계 위에 상주하는 설비는 영영 해제되지 않는다 — improve가 그걸 메운다. */
        var aG = prev.alarmG || 0;
        if (rg === 0 && aG > 0) {
          events.push({ etype: 'recovery', gi: 0 });
          next.alarmG = 0; next.imp = 0;
        } else if (aG > 0 && rg < aG && !prev.imp) {
          events.push({ etype: 'improve', gi: rg });
          next.imp = 1;                       // 에피소드당 1건 — alarmG는 유지해 복귀도 날 수 있게
        }
      }
    } else {
      // 유지 시간 미달 — 확정 등급 유지, 후보만 추적
      next = { g: prev.g, since: prev.since != null ? prev.since : now, cand: rg, candSince: candSince, lastRe: prev.lastRe != null ? prev.lastRe : (prev.since != null ? prev.since : now), b: breach, alarmG: prev.alarmG, imp: prev.imp };
    }
  }
  /* 베이스라인 이탈 — 등급 전이와 독립. 진입은 escHold, 해제(재무장)는 recHold를 요구한다.
     해제에 지속 요구가 없으면 한계 근처를 오가는 신호가 매번 새 이탈로 잡히고,
     한계가 대개 μ×1.2라 부하 변동만으로도 넘으므로 진입 쪽에도 지속 요구가 필요하다.
     bos = 이탈 후보가 시작된 시각 · bcs = 해제 후보가 시작된 시각. */
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
  if (nowB && !wasB) events.push({ etype: 'baseline', gi: Math.max(1, rg) });
  next.b = nowB;
  if (bos != null) next.bos = bos;
  if (bcs != null) next.bcs = bcs;
  /* 대역 이탈 — 설비당 1건으로 합성해서 넘어온다(bandState: {on, gi} 또는 null).
     상관된 대역(fault+high+vhigh 등)은 한 결함의 세 표현이라 따로 알리면 알람이 3배가 된다.
     시간 홀드를 걸지 않는 이유: 대역 추출이 이미 분 단위 주기라 여기서 더 늦추면 반응이 30분을 넘는다.
     대신 복귀 판정에 히스테리시스(×0.9)를 둬서 한계 근처 진동으로 이벤트가 반복되지 않게 한다. */
  if (bandState) {
    var pb = !!(prev && prev.bb);
    if (bandState.on && !pb) events.push({ etype: 'band', gi: bandState.gi });
    else if (!bandState.on && pb) events.push({ etype: 'bandrec', gi: 0 });
    next.bb = bandState.on;
  } else if (prev) next.bb = prev.bb;
  return { next: next, events: events };
}
export { judgeTick, durMs }; // 테스트·서버 타이머 재사용
import VC from '../../cgi-bin/calc/calc.js';
import LLM from '../../cgi-bin/llm/llm.js';
import Report from '../../cgi-bin/report/report.js';
import { REPORT_DIR, ensureDir, saveFile, listDir, deleteFile, readFileBlob, chartLibSrc } from './data/live.js';
import CH from '../../cgi-bin/chart/chart.js';
// E(구 vibe-engine) = 이제 차트 모듈만 (목데이터 제거 — 라이브 전용, mock은 frontend/tools/에 테스트용으로만 잔존)
var ENGINE = CH;

export class App extends Component {
  constructor(props) {
    super(props);
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('vibeTheme'); } catch (e) {}
    var theme = savedTheme ? (savedTheme === 'light' ? 'light' : 'dark') : ((props && props.defaultTheme === 'light') ? 'light' : 'dark');
    this.state = {
      ready: false, tab: (props && props.defaultTab) || 'monitor', theme: theme,
      configured: true, monitorOn: true,
      selTag: null, period: '1h', from: '', to: '', // 기본 1시간 — 진동은 짧은 창이라야 초 단위 해상도가 잡힌다
      /* 직접 입력 기간의 초안(D 접미사). 네이티브 피커에는 확인 단추가 없어 날짜·시·분을 고르는 동안
         값이 여러 번 바뀌는데, 그때마다 커밋하면 중간값으로 조회가 나가고 무엇이 반영됐는지도 알 수 없다.
         고르는 동안은 여기에만 담고 '적용'에서 from/to로 옮긴다. null = 미편집(커밋값을 그대로 보여준다). */
      fromD: null, toD: null,
      diagTag: null, evtTag: 'all', evtType: 'all', evtScope: 'today', // 이벤트 목록 기간: today | 7d | all
      detailAnchor: null, // 스펙트럼 분석 기준 시각 — 이벤트 클릭 시 그 시각, 아니면 선택 기간 끝
      fftFull: false, // FFT·스펙트로그램 주파수 범위: false=기본(dispHz) · true=전대역(Nyquist)
      viewUnit: null, // 상세분석 표시 물리량: null=센서 원단위 · 'g'/'mm/s'/'μm'로 적분/미분 변환
      events: [], reports: [],
      setSection: 'source', machineClass: '', gradeFilter: null, // 선택 UI는 저장 전 미선택 (판정 폴백은 Class II)
      /* 모니터링 테이블 필터 — 화면 상태다(CFG_KEYS에 없다). 감시 대상을 영구히 정하는 것은
         설정 → 데이터 소스이고 그 값은 서버 타이머에도 구워진다. 여기는 잠깐 좁혀 보는 수단이라
         저장하지 않는다.
         고른 것이 아니라 숨긴 것을 기억한다 — 기본이 '전체 선택'이라, 고른 목록을 들고 있으면
         나중에 생긴 테이블이 그 목록에 없어서 말없이 화면에서 빠진다(감시는 도는데 카드가 없다).
         빈 배열 = 전체 표시. */
      tblHide: [], tblOpen: false, tblQuery: '',
      equipBearing: {}, equipRpm: {}, equipAdv: {}, equipGeo: {}, equipUnit: {},
      // 설비 정보 목록의 화면 상태 — 저장 대상이 아니다(CFG_KEYS에 없다)
      equipFilter: 'all',  // 'all' | 'unset' | 'incomplete'
      equipBulk: null,     // 일괄 적용 패널 {id, scope, fields} — 한 번에 한 행만 연다
      // 계측·구동 메타 {mount,drive,belt:{d1,d2,len},vanes} — 전부 선택 입력. 없으면 엔진이 "볼 수 없음"으로 처리한다.
      equipMeta: {}, lineHz: '60',
      bandOn: false, bandHide: {}, bandInterval: '10m', bandBusy: {}, bandFill: null, bandCov: null, bandIvOpen: false, bandIvNext: '10m', bandIvAct: 'keep', // 계통주파수는 설비마다 묻지 않는다(국가 계통) — 전역 기본 60Hz
      equipCls: {}, classThresh: {}, unitThresh: {},
      llmProvider: '', llmConfigured: false, llmTesting: false, llmTest: null,
      llmKeys: {}, llmModels: {}, ollamaUrl: 'http://127.0.0.1:11434',
      genRunning: false, genStep: 0, genTags: [], genLLM: false,
      // 리포트 탭 조회 기간 — 상세분석(period/from/to)과 분리. 대상 태그가 없으면 기간도 없다('')
      genPeriod: '', genFrom: '', genTo: '', genFromD: null, genToD: null,
      dirty: false, toast: null, pendingNav: null, monitorInterval: '3s', cardSize: 232,
      notifCh: { webhook: false }, // 알람 채널은 웹훅 하나 — 이메일·SMS는 발송 수단이 없다(저장본 잔존 키는 무시됨)
      notifTo: { webhook: '' }, // 발송 대상 URL
      notifTest: null, // 테스트 발송 결과 {ch, ok, msg}
      routes: {}, // 심각도별 라우팅 {심각도: {email,slack,sms,timing}} — 기본 전부 비활성
      /* 서버 타이머는 앱을 닫아도 계속 도는 상주물이라 말없이 만들지 않는다 — 설정에서
         고른 뒤에 생기고, 끄면 지운다. 대신 앱 모드로 두면 화면을 닫는 순간 감시가 멈추므로
         그 사실을 배너로 남긴다(고른 사람도 몇 주 뒤엔 잊는다). */
      monMode: 'app', // 감시 방식: 'app'(앱 열린 동안만) | 'server'(Neo 타이머 상시)
      // 알람 시나리오 파라미터 (앱·서버 타이머 공통 규칙)
      escHold: '1m',  // 진입 확인 시간 — 이상이 이만큼 이어져야 알린다(단발 스파이크 차단)
      recHold: '5m',  // 복귀 유지 시간 — '정상 복귀' 알람 전 정상 지속 요구
      /* 지속 재알림은 기본 끔 — 진동 결함은 정비 전까지 몇 주 이어지므로 시간 기반 반복은
         같은 사실을 수백 번 통지한다(위험 1시간 주기면 7일에 168회, 30일이면 720회).
         새 정보가 없는 통지가 쌓이면 정작 봐야 할 새 이벤트가 묻힌다.
         "지금 무엇이 나쁜가"는 모니터링 탭이 답하고, 반복이 필요하면 묶음 알림이 맞는 형태다. */
      renotify: { '주의': '0', '위험': '0', '심각': '0' }, // 심각도별 지속 재알림 주기 (0=끔)
      aliases: {}, // 태그 별칭 {"TABLE:TAG": 별칭}
      srcSel: [], evalWindow: '10s', // 소스 기본값 = 미선택 · evalWindow=RMS 구간(판정 주기 이상)
      srcNotice: '', // 데이터 소스 변동(테이블/태그 제거) 감지 배너 문구
      /* 설비 카드 순서 — 드래그로 바꾼다. 기본은 심각도 내림차순이지만, 현장에서 늘 먼저 보는
         설비는 등급과 무관하게 앞에 두고 싶을 때가 있다. 저장된 순서에 없는 태그는 뒤에 붙는다. */
      cardOrder: [], cardDragId: null, cardPreview: null,
      knownTags: null, revived: {},   // 태그 되살아남 추적 — null이면 아직 목록을 만든 적 없음
      tagQuery: '',  // 별칭 편집 태그 검색어 — 저장 대상이 아닌 화면 상태
      aliasShown: ALIAS_ROWS_MAX,  // 별칭 편집에서 지금까지 그린 줄 수 — 바닥에 닿을 때마다 늘어난다
      srcCap: null,   // 표시 상한에 걸려 감시에서 빠진 태그 집계 (buildLiveData가 채운다) — null이면 잘린 것 없음
      health: null,   // 감시 살아있음 확인 결과 — null이면 이상 없음
      blWin: '24h', blK: '3', baselines: {}, blBusy: {}, // 베이스라인 학습 (판정기준 카드)
      /* 대역 학습 기간을 따로 둔다 — 같은 기간이라도 표본 밀도가 864배 다르다.
         RMS는 판정 구간 단위(24h→8,640개)로 촘촘하지만 대역은 추출 주기 단위(10분이면 24h→144개)다.
         공유하면 "최근 1시간으로 배우겠다"는 RMS에 타당한 선택이 대역 학습을 6개로 만들어 깨뜨린다. */
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
  componentDidMount() { window.addEventListener('resize', this._onResize); this._poll(); this._clk = setInterval(this._clock.bind(this), 1000); this._clock(); this._initTip(); }
  /* data-tip 커스텀 툴팁 — 네이티브 title은 ~1초 지연이 있고 스타일(색·크기)을 못 바꾼다.
     fixed 싱글턴이라 표의 overflow 스크롤 컨테이너에도 잘리지 않는다. 지연 없이 즉시 표시. */
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
    // 스크롤하면 앵커가 움직이므로 숨긴다 · 창 밖으로 나가도 숨긴다
    document.addEventListener('scroll', function () { tip.style.display = 'none'; }, true);
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) tip.style.display = 'none'; });
  }
  _clock() { var el = document.getElementById('vclock'); if (!el) return; var d = new Date(); function z(n){return n<10?'0'+n:''+n;} el.textContent = d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds()); }
  componentWillUnmount() { window.removeEventListener('resize', this._onResize); if (this._raf) clearTimeout(this._raf); if (this._pt) clearTimeout(this._pt); if (this._tt) clearTimeout(this._tt); if (this._live) clearInterval(this._live); if (this._clk) clearInterval(this._clk); if (this._gt) clearTimeout(this._gt); if (this._resyncT) clearTimeout(this._resyncT); }
  _poll() { this._boot(ENGINE); } // 모듈 import라 로드 대기 불필요 (구 window.VibeEngine 폴링 제거)
  // 라이브 부팅: Neo API가 닿고 TAG 테이블이 있으면 실데이터, 아니면 mock(데모) 폴백
  _boot(E) {
    var self = this;
    this.E = E;
    loadConfig().catch(function () { return null; })
      .then(function (cfg0) {
        var cfg = cfg0 || {};
        /* 옛 설정 이관 — evalWindow는 'now'/'6h'/'24h'/'7d'(집계 대상 기간)였고 지금은 RMS 구간 길이다.
           그대로 두면 셀렉트에 없는 값이 되어 화면이 비고 durMs가 0이 된다.
           'now'는 최신 1초 하나를 뜻했는데 그 동작 자체를 없앴으므로(데이터 90%가 판정에서 빠졌다)
           기본 구간으로 올린다. 나머지 옛 값도 판정 구간으로는 과하게 길어 기본값으로 맞춘다. */
        if (!DUR_MS[cfg.evalWindow] || cfg.evalWindow === '0') cfg.evalWindow = '10s';
        if (durMs(cfg.evalWindow) > 3600000) cfg.evalWindow = '10s';
        if (!DUR_MS[cfg.monitorInterval]) cfg.monitorInterval = '3s';
        // 옛 설정의 1분·5분은 추출 창보다 짧을 수 있어 10분으로 올린다(IV_KO 주석 참조)
        if (cfg.bandInterval === '1m' || cfg.bandInterval === '5m') cfg.bandInterval = '10m';
        // 옛 기본값(진입 즉시)과 정확히 같을 때만 새 기본으로 올린다 — 사용자가 일부러 고른 값은 건드리지 않는다.
        if (cfg.escHold === '0') cfg.escHold = '1m';
        /* 라우팅 이관 — 옛 저장본의 webhook:false·'무시'는 전부 '알림 안 함'으로 옮긴다
           (꺼둔 의도가 보존되어야 이관 후 조용히 켜지는 일이 없다). */
        if (cfg.routes) Object.keys(cfg.routes).forEach(function (k) {
          var r = cfg.routes[k];
          if (!r || typeof r !== 'object') return;
          if (r.webhook === false || r.timing === '무시') r.timing = '알림 안 함';
          if (!r.timing) r.timing = ROUTE_DEFAULT_TIMING[k] || '즉시';
          delete r.webhook; delete r.email; delete r.sms;
        });
        if (!Array.isArray(cfg.cardOrder)) cfg.cardOrder = [];   // 설비 카드 순서 — 없으면 심각도순
        /* knownTags가 없으면 '첫 실행'이다 — 빈 배열(아는 태그가 하나도 없음)과 구분해야 한다.
           둘을 같게 두면 이 기능이 처음 도는 순간 학습된 모든 태그가 "처음 보는 태그"로 걸린다. */
        if (!Array.isArray(cfg.knownTags)) cfg.knownTags = null;
        if (!cfg.revived || typeof cfg.revived !== 'object') cfg.revived = {};
        delete cfg.evalAgg;                     // 집계 방식은 제거됨 — 구간 RMS가 곧 집계
        /* 지속 재알림 옛 기본값(위험 1시간·심각 30분)은 끔으로 옮긴다 — 규모가 커지면 폭주한다.
           옛 기본값과 정확히 같을 때만 바꾼다(사용자가 직접 고른 값은 유지). */
        var _rn = cfg.renotify;
        if (_rn && _rn['주의'] === '0' && _rn['위험'] === '1h' && _rn['심각'] === '30m') {
          cfg.renotify = { '주의': '0', '위험': '0', '심각': '0' };
        }
        /* 대역 학습 기간이 없던 설정은 RMS 기간을 물려받는다 — 그때까지 같은 값을 쓰고 있었으므로.
           단 '1h'는 어떤 추출 주기로도 표본이 모자라 학습이 안 되니 6시간으로 올린다. */
        if (!BAND_WIN_H[cfg.bandWin]) cfg.bandWin = (cfg.blWin === '1h' || !cfg.blWin) ? '6h' : cfg.blWin;
        return listTagTables().catch(function () { return null; })
          .then(function (tables) { return [cfg, tables]; });
      })
      .then(function (r) {
        var cfg = r[0], tables = r[1];
        if (!tables || !tables.length) { self._initEmpty('DB에서 TAG 테이블을 찾지 못했습니다 — 연결 상태를 확인하세요'); return; }
        self.live = true;
        self.liveTables = tables;
        self._loadSchemas(); // 컬럼 구성 — 선택 목록에서 미지원 table을 막는다(부팅을 막지는 않는다)
        ensureMonTables().catch(function () {}); // 상시감시 저장소(LOOKUP) 존재 보장 — 신규 설치 대비
        // 저장된 선택이 없으면 아무것도 선택하지 않은 상태로 시작 (설정 → 데이터 소스에서 선택)
        var sel = (cfg.srcSel || []).filter(function (t) { return tables.indexOf(t) >= 0; });
        buildLiveData(E, sel, cfg).then(function (data) {
          self.data = data;
          self._applyLive(data, cfg, sel);
        }).catch(function (e) { console.warn('[vibe] live build failed', e); self._initEmpty('데이터 적재 실패: ' + (e.message || e)); });
      });
  }
  _applyLive(d, cfg, sel) {
    var E = this.E;
    var sorted = d.equipment.slice().sort(function (a, b) { return b.grade - a.grade || (b.rms / b.zones[2]) - (a.rms / a.zones[2]); });
    sorted.forEach(function (e, i) { e.order = i; });
    var worst = sorted[0] || null;
    var now = d.now || Date.now();
    var anchor = worst && worst.lastSeen ? worst.lastSeen : now; // 기간 기본값도 선택 태그 데이터 기준
    var initP = this._periodFor(worst, '1h'); // 첫 태그 데이터가 1시간 미만이면 전체로
    var initR = worst ? this._periodRange(worst, initP) : { from: this._dtVal(anchor - 3600000), to: this._dtVal(anchor) };
    var patch = {
      ready: true, srcSel: sel, srcCap: d.cap || null, selTag: worst ? worst.id : null, diagTag: worst ? worst.id : null, events: [], reports: [],
      genTags: [], genPeriod: '', genFrom: '', genTo: '', genFromD: null, genToD: null, // 리포트 대상 태그는 기본 미선택 → 기간도 아직 없음
      period: initP, from: initR.from, to: initR.to, fromD: null, toD: null,
    };
    // 저장된 설정 복원 (state 키와 1:1)
    CFG_KEYS.forEach(function (k) {
      if (k === 'srcSel') return;             // 위에서 실제 테이블 목록과 대조해 이미 넣었다
      if (cfg[k] != null) patch[k] = cfg[k];
    });
    this.setState(patch);
    this._loadReports();
    var self = this;
    // 판정 상태·베이스라인 로드 후 따라잡기 판정 — 앱이 닫혀 있던 사이의 순변화를 이벤트로 소급
    Promise.all([
      loadMonState().then(function (m) { self._monState = m; }).catch(function () { self._monState = {}; }),
      this._loadBaselines(),
    ]).then(function () {
      /* 되살아남 검사는 반드시 베이스라인을 읽은 뒤에 — 학습값이 있는지가 판단 근거인데,
         로드 전에 부르면 전부 "학습값 없음"으로 보여 아무것도 안 걸린다.
         그리고 따라잡기 판정보다 먼저 — 확인 대기 태그는 옛 기준으로 소급 판정하면 안 된다. */
      self._checkRevived(sorted.map(function (e) { return e.table + ':' + e.name; }), sel);
      return self._judgeLive(true);
    }).then(function () { self._loadEventsLive(); });
    if (this._live) clearInterval(this._live);
    this._startTimers();
  }
  // 설정 저장 후 재적재 (소스 테이블 변경 반영)
  _reloadLive() {
    var self = this, E = this.E;
    if (!this.live) return;
    if (this._live) clearInterval(this._live);
    this._detailCache = {}; this._rfCache = {}; this._trCacheL = {};
    this._tickCostMs = null;  // 감시 대상이 바뀌면 옛 소요는 근거가 아니다 — 다시 잰다
    this._tagCache = {}; // 재적재 시 별칭 편집 태그 목록도 새로 조회 (새 태그 반영)
    this._noticeMuted = false;
    this.setState({ ready: false, srcNotice: '' });
    var sel = this.state.srcSel || [];
    buildLiveData(E, sel, this._cfgFromState()).then(function (data) {
      if (!data.now) data.now = self.data && self.data.now ? self.data.now : Date.now();
      self.data = data; // 빈 선택도 그대로 반영 (모니터링 빈 상태 표시)
      var sorted = self.data.equipment.slice().sort(function (a, b) { return b.grade - a.grade; });
      sorted.forEach(function (e, i) { e.order = i; });
      /* 첫 화면에서 바로 운전 상태를 구한다 — 판정 틱은 주기(iv)가 지나야 처음 돌기 때문에,
         여기서 안 구하면 두절 설비도 그 사이엔 배지 없이 정상처럼 보인다(가장 위험한 오해를
         켤 때마다 몇 초씩 재현하는 셈). 두절은 lastSeen과 지금의 차이라 방금 받은 데이터로
         이미 계산되는 값이다 — 저장해 둘 것이 아니라 늦게 구하던 것을 제때 구하면 된다. */
      self._refreshRunState(self.data.now || Date.now());
      // 사용자가 고른 태그가 아직 있으면 유지, 없어졌으면 worst로 — 재적재 때마다 선택이 튕기지 않게
      var keep = self.state.selTag && sorted.some(function (e) { return e.id === self.state.selTag; });
      self.setState({ ready: true, srcCap: data.cap || null, selTag: keep ? self.state.selTag : (sorted.length ? sorted[0].id : null) });
      self._loadEventsLive();
      self._startTimers();
    }).catch(function (e) { self.setState({ ready: true }); self._toast('재적재 실패: ' + e.message, 'err'); });
  }
  // 5초 주기 라이브 갱신 — 통계 뷰(V$_STAT, 초경량) 기반 변동 감지:
  //  · 태그별 MAX_TIME이 전진했을 때만 해당 태그의 새 구간을 sec-롤업으로 갱신 (실시간·과거 벌크 유입 모두 감지)
  //  · 통계에 처음 보는 태그가 나타나면 자동 재적재 (테이블 변동 반영)
  /* 타이머 두 개 — 판정과 카탈로그. 하나로 묶으면 태그 증감 확인이 판정 주기마다 붙어 조회의 대부분을 차지한다. */
  _startTimers() {
    var self = this;
    if (this._live) clearInterval(this._live);
    if (this._cat) clearInterval(this._cat);
    var iv = durMs(this.state.monitorInterval) || 3000;
    this._live = setInterval(function () { self._tickLive(); }, iv);
    this._cat = setInterval(function () { self._catalogTick(); }, CAT_TICK_MS);
  }
  /* 판정 틱 — RMS 구간만큼의 롤업 버킷을 테이블당 한 번에 받아 태그별로 나눠 담고 판정한다.
     · 배치 조회(NAME IN)라 비용이 태그 수가 아니라 테이블 수에 비례한다
     · 태그 증감 확인(tagStats)은 여기서 하지 않는다 — _catalogTick이 따로 본다
     · 화면은 이 틱 끝에서 갱신한다. 별도 조회가 없으므로 갱신을 자주 해도 비용이 없다 */
  _tickLive() {
    var self = this, E = this.E, S = this.state;
    if (!this.live || !this.data || this._ticking) return;
    if (this.state.tab !== 'monitor' && !this.state.monitorOn) return; // 알람 켜져 있으면 어느 탭에서든 판정 지속
    this._ticking = true;
    var winMs = Math.max(durMs(S.evalWindow) || 10000, durMs(S.monitorInterval) || 3000);
    var now = Date.now(), from = now - winMs - WIN_LAG_MS;
    var byTable = {};
    this._activeEqs().forEach(function (eq) { (byTable[eq.table] = byTable[eq.table] || []).push(eq); });
    var failed = [];
    var _t0 = Date.now();   // 이 틱이 실제로 얼마나 걸리는지 — 부하 안내는 상수가 아니라 이 값을 쓴다
    var jobs = Object.keys(byTable).map(function (table) {
      var eqs = byTable[table];
      return rollupBatch(table, eqs.map(function (e) { return e.name; }), 'sec', from, now)
        .then(function (byTag) {
          eqs.forEach(function (eq) {
            var buckets = byTag[eq.name] || [];
            if (!buckets.length) return;                  // 정지 설비 — 직전 값 유지
            /* 구간 판정용 버킷: 구간 길이만큼만 남긴다(여유분은 미완성 버킷 판별에만 쓰인 뒤 버려진다).
               windowRms가 cnt로 미완성을 걸러내므로 여기서 자르지 않고 시각으로 자른다. */
            var cut = now - winMs;
            eq.secBuckets = buckets.filter(function (b) { return b.ms >= cut; });
            var last = buckets[buckets.length - 1];
            eq.lastSeen = last.ms;
            eq.rms = last.rms;                            // 최신 1초(표시 보조·폴백용)
            eq.sparkVals = buckets.map(function (b) { return b.rms; }).slice(-36);
            eq.spark = E.sparkPath(eq.sparkVals.length ? eq.sparkVals : [0, 0], 132, 40, 3);
            eq.grade = self._severityOf(eq);               // 화면 등급도 판정값 기준 — 표시·이벤트 일치
            if (last.ms > self.data.now) self.data.now = last.ms;
          });
        }).catch(function () { failed.push(table); });
    });
    Promise.all(jobs).then(function () {
      self._ticking = false;
      /* 조회 부하를 실측해 둔다(지수평활). 상수로 추정하면 로컬 Neo에서 잰 값이 원격·저사양
         설치에서 그대로 틀린다 — 부하 경고는 그 환경의 실제 소요로 판단해야 의미가 있다. */
      var _el = Date.now() - _t0;
      self._tickCostMs = self._tickCostMs == null ? _el : self._tickCostMs * 0.7 + _el * 0.3;
      if (failed.length && !self.state.srcNotice && !self._noticeMuted) {
        self.setState({ srcNotice: '데이터 소스 조회 실패 — ' + failed.join(', ') + ' 확인이 필요합니다.' });
      }
      self._refreshRunState(now);   // 정지·두절 표시용 — 판정과 별개로 서버 모드에서도 화면에 나와야 한다
      self._judgeLive().then(function (n) { if (n) self._loadEventsLive(); }); // 새 이벤트가 났을 때만 목록 갱신
      /* 설정 화면은 이 틱으로 다시 그리지 않는다 — 입력칸이 전부 제어 입력(value=상태)이라
         타이핑 도중 다시 그리면 preact가 옛 상태값을 DOM에 도로 써넣어 입력이 지워진다.
         날짜·시간 입력이 포커스를 쥔 동안도 같다 — 네이티브 피커는 날짜·시·분을 고르는 데 몇 초가
         걸려서, 그 사이 틱 리렌더가 값을 되돌리며 피커를 닫아버린다.
         판정·알림은 그대로 돈다(막는 것은 화면 갱신뿐). */
      var _ae = typeof document !== 'undefined' ? document.activeElement : null;
      var _dtEditing = !!(_ae && _ae.tagName === 'INPUT' && (_ae.type === 'date' || _ae.type === 'datetime-local'));
      if (self.state.tab !== 'settings' && !_dtEditing) self.forceUpdate();
    }).catch(function () { self._ticking = false; });
  }
  /* 설비별 운전 상태 — 정지 / 신호 두절 / 운전 중.

     판정부(_judgeLive)는 서버 모드에서 아예 돌지 않으므로, 표시는 여기서 따로 구한다.
     둘 다 "값이 조용한" 상태지만 뜻이 정반대다:
      · 정지    — 데이터는 들어오는데 값이 정지 수준. 설비가 서 있다.
      · 두절    — 데이터 자체가 안 들어온다. 감시가 눈을 감은 상태이고, 화면은 마지막 값을
                  그대로 들고 있어 아무 표시가 없으면 정상으로 보인다(가장 위험한 오해).
     판정은 두 경우 모두 얼린다 — 정지를 "좋아졌다"로 읽으면 복귀 알림이 나가고
     사람은 설비가 고쳐진 줄 안다. */
  _refreshRunState(now) {
    var self = this, S = this.state;
    var iv = durMs(S.monitorInterval) || 3000;
    var lostMs = Math.max(60000, iv * 6);
    var m = {};
    this._activeEqs().forEach(function (eq) {
      var key = eq.table + ':' + eq.name;
      var b = (self._blMap || S.baselines || {})[key];
      var age = eq.lastSeen > 0 ? (now - eq.lastSeen) : 0;
      var lost = eq.lastSeen > 0 && age > lostMs;
      var val = self._evalValue(eq);
      // 참조값도 AC로 — 버킷 rms(DC 포함)와 비교하면 오프셋이 있는 센서가 항상 정지로 읽힌다
      var run = !lost && VC.isRunning(val, VC.runRef(b, VC.acVals(eq.secBuckets)));
      /* 계측 이상 — 지금 버킷으로 직접 본다. 판정 상태(MONSTATE.sf)를 읽으면 서버 모드에서
         갱신되지 않는다(앱은 그 표를 부팅 때 한 번만 읽는다). 배지는 "지금 상태"라 즉시 보이고,
         이벤트는 1분 지속을 요구한다 — 배지가 먼저 뜨고 확정이 뒤따르는 순서가 맞다.

         플랫라인은 값이 낮아 "정지"로 보이지만 뜻이 정반대다 — 정지는 설비가 선 것이고,
         플랫라인은 센서가 죽어 그 태그가 무기한 무감시가 된 상태다. */
      var live = lost ? null : (VC.gateFromBuckets(eq.secBuckets, val) || self._rawGate(key));
      var gate = live ? { label: live.label, detail: live.detail } : null;
      if (gate) run = false;                 // 계측을 못 믿는 동안은 판정 동결(배지도 정지보다 우선)
      m[key] = { lost: lost, run: run, age: age, gate: gate };
    });
    this._runState = m;
    /* 서버 모드는 _judgeLive가 즉시 리턴하므로 표시 등급을 계산할 곳이 여기밖에 없다.
       안 하면 카드·KPI·필터가 폴백(전대역 존 등급)으로 떨어져, ISO 대역제한도 세 판정 합성도
       화면에 반영되지 않는다 — 서버 모드가 실사용 모드이므로 그러면 작업이 통째로 안 보인다.
       앱 모드에서는 _judgeLive가 홀드까지 반영한 등급을 쓰므로 여기서 덮지 않는다. */
    if (this.state.monMode === 'server' && this.state.monitorOn) this._refreshDisplayGrade();
  }
  /* 이벤트를 내지 않고 표시 등급만 구한다 — 판정과 같은 세 축, 같은 값.
     이벤트 발화는 서버 타이머가 하고, 앱은 같은 규칙으로 화면만 맞춘다. */
  _refreshDisplayGrade() {
    var self = this, S = this.state;
    this._refreshBandNow();             // 최신 대역값 — 판정 경로와 같은 캐시를 쓴다
    if (!this._gradeState) this._gradeState = {};
    this._activeEqs().forEach(function (eq) {
      var key = eq.table + ':' + eq.name;
      var wide = self._evalValue(eq);
      if (!isFinite(wide)) return;
      var revived = self._isRevived(key);
      var b = (self._blMap || S.baselines || {})[key];
      var iso = self._isoValue(eq, wide);
      var isoV = iso.pending ? wide : iso.v;                 // 계산 전에는 상한값으로 둔다
      var zg = VC.gradeFor(isoV, eq.zones);
      var lim = revived ? null : VC.baselineLimit(b);
      var bg = (lim != null && wide > lim) ? Math.max(1, zg) : 0;
      var bnow = (self._bandNow || {})[key];
      var bj = (bnow && !revived) ? VC.bandJudge(bnow, self._bandBaselines(eq), false, self._softBands(eq)) : null;
      var wg = VC.worstGrade(zg, bg, bj && bj.on ? bj.gi : 0);
      /* 카드가 세 축을 한 줄로 보여주려면 각 축의 "값"이 필요하다 — 등급만으로는
         왜 그 등급인지 설명이 안 된다. 베이스라인은 한계 대비 배수, 대역은 최대 배수. */
      wg.iso = isoV; wg.wide = wide; wg.limited = VC.isoNeeded(eq.fs); wg.basis = iso.basis || 'wide';
      wg.blR = (lim != null && lim > 0) ? wide / lim : null;
      wg.bandR = bj ? bj.maxR : null;
      self._gradeState[key] = wg;
    });
  }
  /* 카탈로그 틱 — 태그 추가·삭제만 본다. 판정 틱과 분리한 이유는 비용과 빈도가 다르기 때문이다.
     이름만 받아 집합 비교하고(2,510태그에서도 130ms · 태그 수 무관), 실제로 늘었을 때만
     tagStats로 데이터 유무를 확인해 편입한다. 사라진 것은 조회 없이 알림만 띄운다. */
  /* 감시가 살아 있는지 확인한다 — 화면에서 "조용함 = 정상"과 "조용함 = 감시가 죽음"을 구분하려고.

     서버 모드는 신호가 둘이다.
      · 타이머 상태 — 등록은 성공하고 첫 실행에서 죽는 경우가 있다(임베드 코드 오류 등).
        그때 state가 'STOP, <에러>'로 오므로 사유까지 그대로 보여준다.
      · 심박(__hb) — 타이머는 RUNNING인데 실제로는 아무것도 안 하는 경우를 잡는다.
        데이터 유입이 끊기면 전 태그를 건너뛰어 판정 0건이 되는데, 타이머 상태만으로는 정상으로 보인다.
     앱 모드는 타이머가 없으니 마지막 판정 시각만 본다. 탭이 가려져 있으면 브라우저가 타이머를
     늦추므로(정상 동작) 보이는 동안만, 넉넉한 기준으로 판단한다. */
  _healthTick() {
    var self = this, S = this.state;
    if (!this.live) return Promise.resolve();
    if (!S.monitorOn) { if (this.state.health) this.setState({ health: null }); return Promise.resolve(); }
    /* 대역 추출은 앱 감시 모드에서도 서버 타이머로 돈다(추세는 앱이 닫혀도 이어져야 하므로) —
       그래서 앱 모드여도 켜져 있으면 타이머 상태를 봐야 한다. 심박(__hb)은 감시 타이머가
       쓰는 것이라 서버 모드에서만 의미가 있다. */
    var srv = S.monMode === 'server';
    if (!srv && !S.bandOn) { this._applyHealth(null, null); return Promise.resolve(); }
    return Promise.all([
      timerStates(),
      srv ? loadMonState().catch(function () { return null; }) : Promise.resolve(null),
    ]).then(function (r) { self._applyHealth(r[0], (r[1] || {}).__hb || null); })
      .catch(function () {});
  }
  _applyHealth(timers, hb) {
    var self = this, S = this.state, now = Date.now();
    var iv = durMs(S.monitorInterval) || 3000;
    var warns = [];
    var reMon = function () { self._toast('서버 감시를 다시 등록합니다'); self._specSig = null; self._syncMonitorTimer(); };
    var reBand = function () { self._toast('대역 추출을 다시 등록합니다'); self._bandSig = null; self._syncBandTimer(); };
    /* 자동 복구 대상 — 켜둔 설정인데 스스로 멈춘 타이머는 둘 다 같은 처지다.
       복구 후 문구만 다르다: 감시가 없던 구간은 판정이 통째로 없고, 대역 추출이 없던 구간은
       대역 값이 안 쌓여 세 축 중 하나가 조용히 빠진다. 어느 쪽이든 그 시간의 침묵은 근거가 아니다. */
    var MON_T = { key: 'mon', recK: 'recovered', toast: '서버 감시가 멈춰 자동으로 다시 등록합니다',
      sync: function () { self._specSig = null; self._syncMonitorTimer(true); },
      rec: function (ago, why) { return '서버 감시가 ' + ago + ' 전 멈췄다가 자동으로 복구됐습니다 — ' + why
        + '. 그 사이 판정이 없었으므로 이 구간의 "이상 없음"은 확인된 것이 아닙니다'; } };
    var BAND_T = { key: 'band', recK: 'bandrecovered', toast: '대역 추출이 멈춰 자동으로 다시 등록합니다',
      sync: function () { self._bandSig = null; self._syncBandTimer(true); },
      rec: function (ago, why) { return '대역 추출이 ' + ago + ' 전 멈췄다가 자동으로 복구됐습니다 — ' + why
        + '. 그 사이 대역 값이 쌓이지 않아 대역 기준이 판정에서 빠져 있었습니다'; } };
    var dead = null, dband = null;   // 죽었다고 볼 사유 — 자동 복구가 이걸 받아 판단한다
    if (S.monMode === 'server') {
      if (!timers) {
        warns.push({ k: 'unknown', lv: 'warn', text: '감시 타이머 상태를 확인할 수 없습니다 — Neo 연결을 확인하세요' });
      } else {
        var t = timers[MON_TIMER];
        if (!t) {
          warns.push({ k: 'nomon', lv: 'err', text: '서버 감시 타이머가 등록되어 있지 않습니다 — 감시가 돌지 않습니다', act: '다시 등록', onAct: reMon });
        } else if (!/^RUNNING/.test(t.state || '')) {
          // state는 'STOP, ReferenceError: ...' 처럼 사유까지 담겨 온다 — 그대로 보여준다
          dead = { k: 'stopped', text: '서버 감시가 멈춰 있습니다 — ' + (t.state || '상태 불명'), why: t.state || '상태 불명' };
        }
      }
      // 심박 — 판정 주기의 6배를 넘겼으면 타이머가 RUNNING이어도 실제로는 돌지 않는 것이다
      if (hb && hb.t) {
        var age = now - hb.t;
        if (age > Math.max(60000, iv * 6)) {
          // 타이머는 RUNNING인데 판정이 안 도는 경우 — STOP과 같은 조치(재등록)를 쓴다
          var _st = '마지막 판정이 ' + durKo(age) + ' 전입니다 (주기 ' + S.monitorInterval + ')';
          if (!dead) dead = { k: 'stale', text: _st, why: _st };
        } else if (hb.n === 0) {
          warns.push({ k: 'nodata', lv: 'warn', text: '판정 대상이 0개입니다 — 감시 태그에 새 데이터가 들어오는지 확인하세요' });
        }
        /* 회차가 주기에 근접하면 곧 겹친다 — 겹친 회차는 잠금에 막혀 통째로 건너뛰므로,
           타이머는 RUNNING인데 실제 판정 주기만 조용히 2배·3배로 늘어난다. 그 전에 알린다. */
        if (hb.ms != null && hb.ms > iv * 0.7) {
          warns.push({
            k: 'slowtick', lv: hb.ms >= iv ? 'err' : 'warn',
            text: '서버 감시 1회차가 ' + (hb.ms / 1000).toFixed(1) + '초 걸립니다 (주기 ' + S.monitorInterval + ' · 태그 ' + hb.n + '개)'
              + (hb.ms >= iv ? ' — 회차가 겹쳐 일부 주기를 건너뜁니다. 주기를 늘리거나 감시 태그를 줄이세요.' : ' — 주기를 늘리는 것을 권합니다.'),
            act: '설정 열기', onAct: function () { self.setState({ tab: 'settings', setSection: 'monitor' }); },
          });
        }
      }
      /* 타이머 상태를 못 읽었으면(timers null) 복구도 "복구됐다"는 말도 하지 않는다 —
         모르는 것을 살아났다고 적으면 배너가 거짓말을 한다. */
      if (timers) {
        var _rw = this._recoverWarn(MON_T, dead, now, reMon);
        if (_rw) warns.push(_rw);
      }
    }
    if (S.monMode !== 'server' && this._lastJudgeAt
      && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) {
      var lag = now - this._lastJudgeAt;
      if (lag > Math.max(60000, iv * 20)) {
        warns.push({ k: 'applag', lv: 'warn', text: '앱 판정이 ' + durKo(lag) + ' 동안 멈춰 있습니다 — 탭을 다시 열거나 새로고침하세요' });
      }
    }
    /* 대역 추출은 감시 모드를 안 가린다 — 서버 감시를 꺼도 알람이 켜져 있으면 계속 돈다.
       그래서 확인·복구도 모드 분기 밖에 둔다. 서버 분기 안에 두면 앱 모드 사용자는 대역이
       죽어도 모른 채, 세 축 중 하나가 빠진 판정을 "이상 없음"으로 보게 된다. */
    if (S.bandOn && timers) {
      var b = timers[BAND_TIMER];
      if (!b) warns.push({ k: 'noband', lv: 'warn', text: '대역 추출 타이머가 등록되어 있지 않습니다', act: '다시 등록', onAct: reBand });
      else if (!/^RUNNING/.test(b.state || '')) dband = { k: 'bandstop', text: '대역 추출이 멈춰 있습니다 — ' + (b.state || '상태 불명'), why: b.state || '상태 불명' };
      var _bw = this._recoverWarn(BAND_T, dband, now, reBand);
      if (_bw) warns.push(_bw);
    } else if (!S.bandOn && this._recover) { delete this._recover.band; }   // 꺼둔 기능의 흔적은 남기지 않는다
    /* 표시 상한에 걸려 감시에서 빠진 태그 — 알람이 안 오는 이유가 "정상이라서"가 아닌 경우다.
       화면에 없다는 것만으로는 감시 밖인지 알 수 없으므로, 빠진 수를 여기서 명시한다. */
    var _cap = S.srcCap;
    if (_cap && _cap.dropped > 0) {
      warns.push({
        k: 'cap', lv: 'warn',
        text: '태그 ' + _cap.dropped + '개가 표시 상한(테이블당 ' + CAPS.perTable + '개 · 전체 ' + CAPS.total
          + '개)을 넘어 감시에서 빠져 있습니다 — 감시 중인 태그는 ' + _cap.shown + '개입니다',
        act: '설정에서 확인', onAct: function () { self.setState({ tab: 'settings', setSection: 'source' }); },
      });
    }
    /* 되살아난 태그 — 사람이 확인해 줘야 학습 기반 판정이 재개된다.
       데이터만으로는 같은 설비인지 알 수 없으므로(이름이 유일한 단서다) 묻는 수밖에 없다. */
    var revKeys = Object.keys(S.revived || {});
    if (revKeys.length) {
      var alias = function (k) { return (S.aliases || {})[k] || k.split(':')[1] || k; };
      warns.push({
        k: 'revived', lv: 'warn',
        text: revKeys.length === 1
          ? alias(revKeys[0]) + ' — 새로 추가된 태그에 예전 학습값이 남아 있습니다. 이전과 같은 설비인지 확인해 주세요'
          : '새로 추가된 태그 ' + revKeys.length + '개에 예전 학습값이 남아 있습니다. 이전과 같은 설비인지 확인해 주세요',
        act: '설정에서 확인', onAct: function () { self.setState({ tab: 'settings', setSection: 'criteria' }); },
      });
    }
    var sig = warns.map(function (w) { return w.k + ':' + w.text; }).join('|');
    if (sig === this._healthSig) return;      // 같은 상태면 리렌더하지 않는다
    this._healthSig = sig;
    this.setState({ health: warns.length ? warns : null });
  }
  /* 죽었으면 다시 등록하고, 살아났으면 "죽었었다"는 사실을 남긴다.
     복구했다고 조용히 넘기지 않는 이유는 감시가 끊겼던 구간이 데이터에 구멍으로 남기 때문이다 —
     그 시간의 "알람 없음"은 정상이라는 뜻이 아니다. */
  _recoverWarn(tgt, dead, now, manual) {
    var all = this._recover || (this._recover = {});
    var R = all[tgt.key] || (all[tgt.key] = { n: 0, at: 0, why: '' });
    // 오래 조용했으면 시도 횟수를 처음부터 — 몇 달에 한 번 나는 순간 장애까지 누적하면
    // 정작 필요할 때 남은 시도가 없다
    if (R.at && now - R.at > RECOVER_CALM_MS) { R.n = 0; R.at = 0; R.why = ''; }
    if (!dead) {
      if (!R.n) return null;
      return { k: tgt.recK, lv: 'warn', text: tgt.rec(durKo(now - R.at), R.why) };
    }
    if (R.n >= RECOVER_MAX) {
      return { k: dead.k, lv: 'err', text: dead.text + ' · 자동 복구 ' + R.n + '회로 살아나지 않았습니다 — 사유를 확인하세요',
        act: '다시 등록', onAct: manual };
    }
    // 방금 시도했으면 결과를 기다린다 — 등록 직후엔 아직 첫 회차가 안 돌았을 수 있다
    if (R.at && now - R.at < RECOVER_GAP_MS) {
      return { k: dead.k, lv: 'err', text: dead.text + ' · 자동 복구 ' + R.n + '회 시도, 결과를 기다리는 중입니다',
        act: '다시 등록', onAct: manual };
    }
    R.n++; R.at = now; R.why = dead.why;
    this._toast(tgt.toast);
    tgt.sync();
    return { k: dead.k, lv: 'warn', text: dead.text + ' · 자동으로 다시 등록했습니다 (' + R.n + '/' + RECOVER_MAX + ')' };
  }
  _catalogTick() {
    var self = this;
    this._healthTick();
    if (!this.live || !this.data || this._cating) return Promise.resolve();
    this._cating = true;
    var byTable = {};
    this._activeEqs().forEach(function (eq) { (byTable[eq.table] = byTable[eq.table] || []).push(eq.name); });
    var added = false, gone = false, failed = [];
    var liveKeys = [], okTables = [];      // 되살아남 검사용 — 실제로 조회에 성공한 테이블만
    /* 표시 상한에 걸려 빠진 태그는 '새 태그'가 아니다 — 다시 불러와도 또 잘리기 때문이다.
       이걸 안 빼면 상한을 넘긴 순간부터 매 틱 재적재가 걸려 끝나지 않는다. */
    var capped = (this.state.srcCap && this.state.srcCap.droppedKeys) || {};
    var jobs = Object.keys(byTable).map(function (table) {
      var known = byTable[table];
      return listTags(table, 100000).then(function (names) {
        okTables.push(table);
        var have = {}, live = {};
        known.forEach(function (n) { have[n] = true; });
        names.forEach(function (n) { live[n] = true; });
        known.forEach(function (n) { if (!live[n]) gone = true; });
        // 되살아남 검사도 감시 대상만 본다 — 잘린 태그를 확인 대기로 걸면 설정 화면에 없는 태그를 가리킨다
        names.forEach(function (n) { if (have[n] && !capped[table + ':' + n]) liveKeys.push(table + ':' + n); });
        var fresh = names.filter(function (n) { return !have[n] && !capped[table + ':' + n]; });
        if (!fresh.length) return;
        /* 처음 보는 이름은 데이터가 있을 때만 '새 태그'다 — 메타(_<table>_meta)에는 데이터를 지워도
           이름이 남고, 적재는 통계가 없는 태그를 제외한다(live.js). 그 이름을 새 태그로 세면
           다시 불러와도 또 빠져 매 틱 재적재가 끝나지 않는다.
           통계 조회가 실패하면 이번 틱은 판단하지 않는다 — 없는 것으로 치면 같은 반복이 된다. */
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
      /* 되살아남 검사 — 부팅 때만 하면 앱이 도는 동안 사라진 태그가 목록에 남아, 그 태그가
         돌아와도 "아는 태그"로 통과한다. 조회에 성공한 테이블 범위 안에서만 비교한다
         (조회 실패한 테이블의 태그를 사라진 것으로 처리하면 멀쩡한 학습을 되살아남으로 오판한다). */
      if (okTables.length) self._checkRevived(liveKeys, okTables);
      if (added && !self._reloadPending) {
        self._reloadPending = true;
        self._toast('새 태그 감지 — 데이터를 다시 불러옵니다');
        setTimeout(function () { self._reloadPending = false; self._reloadLive(); }, 400);
        return;
      }
      // 제거는 자동 반영하지 않고 알림만 — 사용자가 '다시 불러오기'로 확정 (일시 소실 시 선택 보존)
      if ((gone || failed.length) && !self.state.srcNotice && !self._noticeMuted) {
        self.setState({ srcNotice: '데이터 소스 변동 감지 — 선택된 테이블 또는 태그가 제거되었거나 비어 있습니다.' });
        return;
      }
      /* 서버 모드: 감시 대상이 바뀌었으면 TQL을 다시 굽는다. 태그 목록도 TQL에 값으로 구워지므로
         이게 없으면 새로 생긴 설비가 무감시로 방치된다. 서명이 같으면 아무것도 하지 않는다. */
      self._syncMonitorTimer(true);
      self._syncBandTimer(true);
      self._syncWdTimer(true);
    }).catch(function () { self._cating = false; });
  }
  // 현재 state → 설정 객체 (저장·재적재 공용 — 두 경로가 어긋나면 별칭 미적용 같은 버그가 된다)
  _cfgFromState() {
    var S = this.state, o = {};
    CFG_KEYS.forEach(function (k) { o[k] = S[k]; });
    return o;
  }
  /* 표시에만 영향을 주는 설정(카드 순서 등)은 이걸로 저장한다 — 타이머를 다시 굽지 않는다.
     _persistCfg는 판정에 쓰이는 값이 바뀔 때용이라 서버 TQL 재등록과 토스트가 따라붙는다. */
  _persistView(keys, ov) {
    var self = this;
    // ov로 값을 직접 넘긴다 — setState 직후엔 state가 아직 옛 값이라 그대로 읽으면 한 박자 전 순서가 저장된다
    return saveConfigPartial(Object.assign(this._cfgFromState(), ov || {}), keys)
      .catch(function (e) { self._toast('설정 저장 실패: ' + (e.message || e), 'err'); });
  }
  _persistCfg() {
    var self = this;
    return saveConfig(this._cfgFromState())
      .then(function () { return self._syncMonitorTimer(); }) // 저장 후 서버 타이머 생성/삭제 반영
      .then(function () { return self._syncBandTimer(); })      // 대역 추출 타이머도 함께
      .then(function () { return self._syncWdTimer(); })        // 감시자도 — 감시가 꺼지면 같이 지워진다
      .catch(function (e) { self._toast('설정 저장 실패: ' + (e.message || e), 'err'); });
  }
  // 현재 설정 → 서버 판정 TQL 스펙 (태그·존·베이스라인 + 시나리오 파라미터 ms)
  _monSpec() {
    var self = this, S = this.state;
    var tags = this._activeEqs().map(function (eq) {
      var b = (self._blMap || S.baselines || {})[eq.table + ':' + eq.name];
      // 대역 베이스라인도 같이 굽는다 — 없으면 null이라 서버가 대역 판정을 조용히 건너뛴다
      var bb = null, bbSrc = self._bandBaselines(eq);
      if (bbSrc) {
        bb = {};
        Object.keys(bbSrc).forEach(function (k) { bb[k] = { mu: bbSrc[k].mu, sigma: bbSrc[k].sigma, k: bbSrc[k].k || 3 }; });
      }
      return {
        tbl: eq.table, tag: eq.name, alias: eq.alias || eq.name, unit: eq.unit || '', // 알림 문구용
        fs: eq.fs || 0,                       // ISO 대역제한 판단·필터 설계에 필요
        /* 마운팅 상한 초과 대역 — 서버는 bandEdges를 부를 수 없다(bandJudge가 자체 완결형이라
           바깥 이름을 참조하면 첫 회차에서 죽는다). 앱이 계산해 값으로 구워 넣는다. */
        soft: self._softBands(eq),
        // 확인 대기 중인 태그는 학습값을 굽지 않는다 — 서버도 같은 이유로 멈춰야 한다
        zones: eq.zones, bl: (b && !self._isRevived(eq.table + ':' + eq.name)) ? { mu: b.mu, sigma: b.sigma, k: b.k || 3 } : null,
        bb: self._isRevived(eq.table + ':' + eq.name) ? null : bb,
      };
    });
    return {
      judgeSrc: judgeTick.toString(), // 앱과 동일 규칙을 서버에 그대로 임베드 (드리프트 0)
      limitSrc: VC.baselineLimit.toString(), // 한계식(클램프 포함)도 같은 방식 — 앱/서버 판정식 단일 소스
      bandSrc: VC.bandJudgeSrc(), // 대역 판정도 동일 소스(상수 포함 자체 완결형)
      winSrc: VC.windowRms.toString(), // 구간 RMS도 같은 함수 — 앱/서버 판정값 단일 소스
      // 정지·두절 판별도 같은 함수 — 없으면 서버가 설비 정지를 "좋아졌다"로 읽어 복귀 알림을 낸다
      runSrc: VC.isRunning.toString(),
      refSrc: VC.runRef.toString(),
      /* ISO 존 판정 — 세 함수가 서로를 이름으로 부르므로 calc가 한 스코프로 묶어 준다
         (따로 붙이면 압축된 몸통 안 이름과 어긋나 TQL에서 죽는다). */
      isoSrc: VC.isoSrc(),
      /* 계측 게이트 — 파형이 계측 문제로 보이면 서버도 진동 판정을 멈추고 계측 이상으로 알린다.
         gateFromRaw→signalQuality→kurtosis로 서로를 부르므로 calc가 한 스코프로 묶어 준다. */
      gateSrc: VC.gateSrc(),
      isoTtlMs: ISO_TTL_MS, isoWinMs: ISO_WIN_MS,
      tickMs: durMs(S.monitorInterval) || 3000,   // 두절 기준(주기의 6배)의 근거
      winMs: Math.max(durMs(S.evalWindow) || 10000, durMs(S.monitorInterval) || 3000),
      lagMs: WIN_LAG_MS,
      bandOrder: VC.BAND_ORDER,
      // 대역 추출 주기의 4배를 룩백으로 — 한두 번 걸러도 마지막 값을 놓치지 않는다
      bandWinMs: Math.max(3600000, durMs(S.bandInterval) * 4),
      tags: tags,
      cfg: { escHold: durMs(S.escHold), recHold: durMs(S.recHold),
        reno: { 1: durMs((S.renotify || {})['주의']), 2: durMs((S.renotify || {})['위험']), 3: durMs((S.renotify || {})['심각']) } },
      notify: { src: Notify.serverSrc(), cfg: this._notifyCfg() }, // 발송도 앱과 같은 함수로
      wd: this._wdSpec('mon'),   // 대역 추출이 멎으면 여기서 되살린다
    };
  }
  /* 감시자와 감시 대상들이 서로를 보는 고리. 앱 자동 복구는 앱이 열려 있을 때만 돌므로
     서버 쪽에도 감시자가 필요하다. 별개 프로세스라 한쪽이 죽어도 다른 쪽이 남는다.

       NEO_VIBE_WD(5분)  → 감시·대역 추출을 본다
       감시(10초)·대역(10분) → 감시자를 본다

     감시자를 따로 둔 이유는 감시의 생존이 대역 추출 같은 선택 기능의 on/off에 걸리면 안 되기
     때문이다. 대역 추출은 원인 분석용이고, 감시가 살아있는지는 안전 기능이다.
     죽었다고 볼 기준은 상대의 주기에서 나온다 — 감시는 앱과 같은 규칙(주기의 6배), 대역 추출은
     한 회차가 길고 건너뛰는 회차도 있어 넉넉히 3배·최소 30분, 감시자는 하는 일이 적어 3배. */
  /* 브라우저가 접속한 포트는 "힌트"일 뿐이다 — 우리가 필요한 건 서버가 자기 자신을 부르는
     포트인데, 리버스 프록시가 끼면 둘이 다르다(:8080으로 보이지만 Neo는 5654). 브라우저는
     그 뒤를 볼 수 없고 서버의 127.0.0.1을 찔러볼 수도 없다(mixed content·다른 호스트).
     확인은 jsh 쪽에서 한다 — 거기선 127.0.0.1이 Neo 자신이다. 여기서는 힌트만 넘긴다. */
  _wdBase() {
    var port = String((typeof location !== 'undefined' && location.port) || '5654');
    return { port: port, base: 'http://127.0.0.1:' + port,
      authPath: '/work' + pkgBase() + '/cgi-bin/config/neo-auth.json',
      // 확정된 포트를 남길 자리 — 언인스톨은 앱이 없는 시점에 돌아서 이 파일로만 알 수 있다
      endpointPath: '/work' + pkgBase() + '/cgi-bin/config/neo-endpoint.json' };
  }
  _wdTarget(who) {
    var S = this.state;
    var tick = durMs(S.monitorInterval) || 3000;
    var bandIv = durMs(S.bandInterval) || 600000;
    var common = { gap: 300000, max: 3, calm: 3600000 };
    if (who === 'mon') return Object.assign({ peer: MON_TIMER, hb: '__hb', key: '__wd_mon', stale: Math.max(60000, tick * 6) }, common);
    if (who === 'band') return Object.assign({ peer: BAND_TIMER, hb: '__hbband', key: '__wd_band', stale: Math.max(1800000, bandIv * 3) }, common);
    return Object.assign({ peer: WD_TIMER, hb: '__hbwd', key: '__wd_wd', stale: Math.max(900000, WD_TICK_MS * 3) }, common);
  }
  /* who = 이 TQL이 누구인가. 자기 자신은 안 본다(죽은 자가 자기를 되살릴 수는 없다). */
  _wdSpec(who) {
    var S = this.state;
    if (!S.monitorOn) return null;
    var srv = S.monMode === 'server';
    var band = !!S.bandOn;
    if (who === 'wd') {
      if (!srv && !band) return null;
      var tg = [];
      if (srv) tg.push(this._wdTarget('mon'));
      if (band) tg.push(this._wdTarget('band'));
      return Object.assign(this._wdBase(), { targets: tg, selfHb: '__hbwd' });
    }
    // 감시·대역 추출은 감시자만 본다 — 서로를 겹쳐 보면 같은 상대를 두 곳에서 되살린다
    if (!this._wdSpec('wd')) return null;
    return Object.assign(this._wdBase(), { targets: [this._wdTarget('wd')], selfHb: who === 'band' ? '__hbband' : '__hb' });
  }
  // 타이머 목록 조회 — 테스트가 갈아끼울 수 있도록 메서드로 감싼다
  _timerStates() { return timerStates(); }
  /* 타이머를 지우고 "없는 것이 맞다"고 기억한다.

     지우기 전에 있는지 먼저 본다 — 없는 타이머를 지우면 Neo가 500을 돌려주고, 새 설치는
     이 경로를 10초마다 지나가므로 실패 요청이 화면을 덮는다(그걸 고장으로 읽는다).
     그리고 한 번 확인했으면 기억한다: 상태가 바뀌기 전에는 조회조차 하지 않는다.
     상태를 못 읽었으면(연결 실패) 그냥 지워 본다 — 남아서 도는 것보다 낫다. */
  _dropTimer(sigKey, del, name) {
    if (this[sigKey] === SIG_NONE) return Promise.resolve();
    var self = this;
    return this._timerStates().then(function (m) {
      if (m && name && !m[name]) { self[sigKey] = SIG_NONE; return true; }   // 애초에 없다
      return del().then(function (r) { self[sigKey] = SIG_NONE; return r; });
    });
  }
  /* 등록 직전에 "지금 그 타이머가 있는가"를 아는 만큼만 알려준다 — 서명이 그 기억이다.
     SIG_NONE은 없음을 확인한 상태(끄면 여기로 온다), 서명 문자열은 우리가 만든 것이 도는 상태,
     null은 모름(앱을 새로 열었거나 직전 등록이 실패했다). 모르면 등록 쪽이 목록을 읽는다. */
  _timerKnown(sigKey) {
    var s = this[sigKey];
    return s === SIG_NONE ? 'absent' : (s ? 'present' : null);
  }
  /* 감시자 타이머 생성/삭제 — 감시가 꺼져 있으면 볼 것이 없으니 지운다(고아 방지). */
  _syncWdTimer(silent) {
    var self = this, S = this.state;
    if (!this.live) return Promise.resolve();
    var spec = this._wdSpec('wd');
    if (!spec || !spec.targets.length) return this._dropTimer('_wdSig', deleteWdTimer, WD_TIMER);
    var tql = Watchdog.buildWatchdogTql(spec);
    var sig = JSON.stringify(spec) + '|' + WD_SCHED + '|' + srcSig(tql);
    if (silent && sig === this._wdSig) return Promise.resolve();
    var known = this._timerKnown('_wdSig');   // 새 서명을 넣기 전에 읽는다 — 넣고 나면 항상 '있음'이 된다
    this._wdSig = sig;
    return createWdTimer(tql, WD_SCHED, known)
      .then(function () { if (!silent) self._toast('감시자 켜짐 · ' + WD_SCHED, 'ok'); })
      .catch(function (e) { self._wdSig = null; if (!silent) self._toast('감시자 설정 실패: ' + (e.message || e), 'err'); });
  }
  /* 서버 상시감시 타이머 생성/삭제 — 앱 모드/알람 OFF면 삭제(고아 방지).
     TQL은 자체 완결형이라 태그 목록·존·베이스라인이 값으로 구워진다 → 그 값들이 바뀌면 다시 구워야
     화면과 서버 판정이 일치한다. 설정 저장 외에도 베이스라인 학습·태그 증감에서 호출되므로,
     silent=true면 토스트를 생략하고 실제 변경이 있을 때만 재등록한다(재등록 사이 판정 주기가 빈다). */
  _syncMonitorTimer(silent) {
    var self = this, S = this.state;
    if (!this.live) return Promise.resolve();
    if (S.monMode !== 'server' || !S.monitorOn) return this._dropTimer('_specSig', deleteMonitorTimer, MON_TIMER);
    var spec = this._monSpec();
    var sched = { '1s': '@every 1s', '3s': '@every 3s', '5s': '@every 5s', '10s': '@every 10s', '30s': '@every 30s', '1m': '@every 1m', '10m': '@every 10m' }[S.monitorInterval] || '@every 3s';
    if (!spec.tags.length) {
      return this._dropTimer('_specSig', deleteMonitorTimer, MON_TIMER)
        .then(function () { if (!silent) self._toast('감시할 태그가 없어 서버 감시를 만들지 않았습니다', 'warn'); });
    }
    /* 서명에 생성된 TQL 자체를 넣는다 — 설정뿐 아니라 코드가 바뀌어도 다시 구워야 한다
       (설정값만 서명하면 패키지 업데이트 후에도 옛 TQL이 계속 돈다). */
    var tql = Monitor.buildMonitorTql(spec);
    var sig = JSON.stringify(spec.tags) + '|' + JSON.stringify(spec.cfg) + '|' + sched + '|' + spec.bandWinMs + '|' + spec.winMs
      + '|' + srcSig(tql);
    if (silent && sig === this._specSig) return Promise.resolve(); // 변경 없음 — 굽지 않는다
    /* 임베드 소스를 미리 실행해 본다 — 타이머는 등록은 성공하고 첫 실행에서 죽으므로
       여기서 막지 않으면 감시가 멈춘 것을 아무도 모른다.
       검증 실패 시 기존 타이머는 건드리지 않는다 — 망가진 것으로 갈아끼우느니 옛 것이 도는 편이 낫다. */
    var bad = Monitor.validateSpec(spec);
    if (bad) {
      this._specSig = null;
      console.error('[vibe] 서버 감시 코드 검증 실패', bad);
      this._toast('서버 감시 코드 검증 실패 — 타이머를 바꾸지 않았습니다: ' + bad, 'err');
      return Promise.resolve();
    }
    return createMonitorTimer(tql, sched, this._timerKnown('_specSig'))
      .then(function () { self._specSig = sig; if (!silent) self._toast('서버 상시감시 켜짐 · ' + sched, 'ok'); })
      .catch(function (e) { self._specSig = null; if (!silent) self._toast('서버 감시 설정 실패: ' + (e.message || e), 'err'); });
  }
  /* ---- 상시감시(P6): 앱 내 판정 — 앱이 열려 있는 동안 주기 평가 (타이머/서버 상주 없음) ----
     이벤트·판정상태·베이스라인은 LOOKUP에 저장되어 세션 간 연속 — 재시작 시 마지막 상태와 비교해
     닫혀 있던 사이의 순변화를 따라잡기 판정으로 소급한다(닫힌 사이의 일시 스파이크는 미포착). */
  // 판정: 심각도 평가와 동일한 값(_evalValue: 평가 윈도우+집계) 기준. 지속시간 개념을 넣은 상태머신.
  //  · 악화(등급 상승)  — escHold(진입 확인) 이상 지속되면 확정 → 'threshold' 이벤트
  //  · 지속(같은 등급)  — renotify[등급] 주기마다 → 'sustained' 이벤트 (0=끔)
  //  · 복귀(→ 양호)     — recHold(복귀 유지) 이상 정상 지속되면 확정 → 'recovery' 이벤트
  //  · 완화(나쁨→덜나쁨) — recHold 후 조용히 상태만 갱신 (알림 없음)
  //  · 베이스라인 이탈(μ+kσ) — 학습 태그에 온셋 시 'baseline' 이벤트 (등급 전이와 독립)
  //  MONSTATE에 후보(cand/candSince)·마지막 알림(lastRe)까지 저장 → 서버 타이머(무상태 실행)와 규칙 동일.
  _judgeLive(force) {
    var self = this, S = this.state;
    if (!this.live || !S.monitorOn || !this.data) return Promise.resolve();
    if (S.monMode === 'server') return Promise.resolve(); // 서버 타이머가 판정 — 앱은 표시만(이중발화 방지)
    this._lastJudgeAt = Date.now();   // 앱 모드 심박 — 판정이 실제로 돌고 있는지 배너가 이걸 본다
    var nowW = Date.now();   // 주기는 _startTimers의 타이머가 정한다 — 여기서 다시 스로틀하지 않는다
    var iv = durMs(S.monitorInterval) || 3000;
    if (!this._monState) this._monState = {};
    var cfg = {
      escHold: durMs(S.escHold), recHold: durMs(S.recHold),
      reno: { 1: durMs((S.renotify || {})['주의']), 2: durMs((S.renotify || {})['위험']), 3: durMs((S.renotify || {})['심각']) },
    };
    var jobs = [], nEv = 0;
    var zoneLim = function (eq, g) { return g > 0 ? eq.zones[g - 1] : eq.zones[0]; };
    // 최신 대역값 적재 — 판정 주기(10초)보다 추출 주기(10분)가 훨씬 느리므로 여기서 매번 읽지 않고
    // 캐시를 쓴다. 추출 주기의 절반이 지났을 때만 갱신한다(불필요한 조회 방지).
    this._refreshBandNow();
    this._activeEqs().forEach(function (eq) {
      var key = eq.table + ':' + eq.name;
      var b = (self._blMap || S.baselines || {})[key];
      var wide = self._evalValue(eq);       // 전대역 AC RMS — 평가 윈도우 전체의 실효값
      if (!isFinite(wide)) return;
      /* 존 판정과 베이스라인 판정은 서로 다른 값을 본다.

         존은 ISO 절대 기준이라 표준이 정의한 양(10~1000 Hz)을 써야 한다.
         베이스라인은 자기 학습값 대비라 전대역이 맞다 — 어느 주파수든 평소보다 커지면 잡히는
         가장 넓은 그물이고, 여기까지 대역제한을 걸면 1 kHz 위에서 자라는 결함을 놓친다.
         "존 양호인데 베이스라인 이탈" 조합은 그 자체가 진단 정보다 — 초과분이 1 kHz 위에 있다는 뜻. */
      var iso = self._isoValue(eq, wide);
      var prevG = (self._monState[key] || {}).g || 0;
      var val = iso.pending ? null : iso.v;                  // 존 판정값
      var rg = iso.pending ? prevG : VC.gradeFor(val, eq.zones);
      var cur = wide;                                        // 베이스라인 판정값
      /* 되살아난 태그(지웠다 다시 등록)는 확인 전까지 학습 기반 판정을 멈춘다 — 옛 설비의
         기준으로 새 설비를 재면 조용히 틀린다. ISO 존은 절대 기준이라 계속 돈다. */
      var revived = self._isRevived(key);
      var lim = revived ? null : VC.baselineLimit(b); // 미학습이면 null — 클램프 포함(서버 스크립트와 같은 함수)
      var breach = lim != null && isFinite(cur) && cur > lim;
      var prev = self._monState[key];
      /* 운전 판별 — 값이 정지 수준이면 판정을 얼린다(설비 정지·센서 이상을 개선으로 읽지 않도록).
         기준은 학습 μ, 없으면 최근 sec 버킷 P75(학습이 쓰는 참조와 같은 방법). */
      /* 정지 여부는 주파수와 무관하므로 전대역으로 본다. 참조값도 AC라야 한다 —
         버킷 rms는 DC를 포함해서, 오프셋이 있는 센서는 운전 중에도 정지로 읽힌다. */
      var run = VC.isRunning(wide, VC.runRef(b, VC.acVals(eq.secBuckets)));
      /* 신호 두절 — 새 데이터가 안 들어온 지 오래면 감시가 눈을 감은 상태다.
         값을 그대로 들고 있으면 화면은 계속 정상으로 보인다(최악의 실패 모드).
         판정 주기의 6배를 넘기면 두절로 본다 — 한두 번 거른 것과 구분하기 위해. */
      var lost = eq.lastSeen > 0 && (nowW - eq.lastSeen) > Math.max(60000, iv * 6);
      if (lost) run = false;
      /* 계측 게이트 — 두절 확인 뒤, 진동 판정 앞.

         파형이 기계 신호가 아니라 계측 문제로 보이면 진동 판정을 멈추고 계측 이상으로 따로 알린다.
         이게 없으면 커넥터 접촉이 "심각"으로 나가고(과대), 클리핑은 조용히 지나간다(과소) —
         틀리는 방향이 일정하지도 않아 어느 쪽으로도 못 믿는다.

         두절이면 볼 파형 자체가 없으므로 건너뛴다. 순서가 뒤바뀌면 두절 태그가 "샘플 부족"으로
         계측 이상 판정을 받는다. */
      var bad = null;
      if (!lost) {
        bad = VC.gateFromBuckets(eq.secBuckets, wide);      // 플랫라인·DC — 롤업만으로, 조회 0회
        if (!bad) bad = self._rawGate(key);                  // 클립·스파이크·첨도 — 원본 받았을 때만
      }
      var sens = VC.sensorTick(prev, bad, nowW, cfg);
      if (sens.on) run = false;                              // 계측을 못 믿는 동안은 판정 동결
      // 대역 판정 — 추출 타이머가 적재한 최신 대역값 vs 대역별 베이스라인. 설비당 1건으로 합성된다.
      var bj = null, bnow = (self._bandNow || {})[key];
      if (bnow && !revived && !sens.on) bj = VC.bandJudge(bnow, self._bandBaselines(eq), !!(prev && prev.bb), self._softBands(eq));
      var r = judgeTick(prev, rg, breach, nowW, cfg, bj, run);
      // 계측 이상·복귀는 진동 이벤트와 별개 축이라 그대로 이어 붙인다
      sens.events.forEach(function (ev) { r.events.push(ev); });
      r.next.sf = sens.next.sf;
      if (sens.next.sfs != null) r.next.sfs = sens.next.sfs;
      if (sens.next.sfc != null) r.next.sfc = sens.next.sfc;
      /* 두절은 상태가 바뀔 때만 알린다 — 매 틱 알리면 그 자체가 폭주가 된다.
         복구는 데이터가 다시 들어오면 자연히 판정이 재개되므로 별도 이벤트를 두지 않는다. */
      if (lost && !(prev && prev.lost)) r.events.push({ etype: 'signal_lost', gi: 1 });
      r.next.lost = lost ? 1 : 0;
      nEv += r.events.length;
      var _imp = self._impactOf(key), _impTxt = _imp ? _imp.text : '';
      r.events.forEach(function (ev) {
        var isBand = ev.etype === 'band' || ev.etype === 'bandrec';
        // 이벤트에 실린 값은 그 판정이 실제로 본 값이어야 한다 — 나중에 왜 났는지 설명할 수 있게
        var isSens = ev.etype === 'sensor_fault' || ev.etype === 'sensor_ok';
        var ev_val = isBand ? (bj ? bj.maxR : 0) : isSens ? 0 : ev.etype === 'baseline' ? cur : (val != null ? val : wide);
        var ev_lim = isBand ? 1 : isSens ? 0 : ev.etype === 'baseline' ? lim : ev.etype === 'recovery' ? eq.zones[0] : zoneLim(eq, ev.gi);
        jobs.push(insertEvent({
          eid: key + ':' + nowW + ':' + ev.etype, ts: nowW, tbl: eq.table, tag: eq.name, etype: ev.etype,
          grade: GRADE_WORDS[ev.gi], val: ev_val, lim: ev_lim,
          /* 두절은 지표값이 없다 — val/lim에 들어가는 0은 자리를 비울 수 없어 넣은 값이지 측정값이 아니다.
             무엇이 일어났는지는 "얼마나 안 들어왔나"뿐이라 그것을 DETAIL에 적는다(서버 판정기와 같은 문구). */
          /* 대역·베이스라인 이벤트에는 충격성 근거를 덧붙인다 — 같은 에너지 상승이라도
             임펄스인지 광대역 잡음인지에 따라 볼 곳이 다르다(베어링 vs 유동·부착). */
          detail: ev._detail = (ev.etype === 'band' ? [(bj ? bj.detail : ''), _impTxt].filter(Boolean).join(' · ')
            : ev.etype === 'baseline' ? _impTxt
            : isSens ? (ev.detail || '')
            : ev.etype === 'signal_lost' ? durKo(nowW - eq.lastSeen) + ' 무수신' : ''),
        }).catch(function () {}));
        self._notifyEvent(eq, ev, ev_val, ev_lim, nowW); // 라우팅에 걸리면 알림 발송(_detail 포함 — 이벤트와 같은 사유)
      });
      /* 표시 등급 — 세 판정 중 가장 나쁜 것과 그 원인. 카드·KPI·필터가 이걸 쓴다.
         존만 쓰면 고주파가 지배하는 센서에서 베어링이 나빠져도 화면이 양호로 남는다. */
      if (!self._gradeState) self._gradeState = {};
      var _wg = VC.worstGrade(r.next.g, r.next.b ? Math.max(1, r.next.g) : 0, bj && bj.on ? bj.gi : 0);
      // 화면이 판정값과 세 축을 그대로 보여주도록 — 등급을 만든 축이 어느 것인지도 함께
      _wg.iso = val; _wg.wide = wide; _wg.limited = VC.isoNeeded(eq.fs); _wg.basis = iso.basis || 'wide';
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
    this._refreshFlap();
    return Promise.all(jobs).then(function () { return nEv; });
  }
  _loadEventsLive() {
    var self = this, S = this.state;
    if (!this.live) return;
    // 이벤트 TS는 판정 시각(벽시계)이라 스코프도 벽시계 기준 — data.now(데이터 최신 시각)로 자르면
    // 데이터가 과거인 소스에서 '오늘'이 데이터 날짜로 밀리고, 데이터 시각 이후 발생한 이벤트는 '전체'에서도 사라진다
    var now = Date.now();
    var scope = S.evtScope || 'today';
    var d = new Date(now); d.setHours(0, 0, 0, 0); // 오늘 00:00(로컬)
    var from = scope === 'today' ? d.getTime() : scope === '7d' ? now - 7 * 86400000 : 0;
    var to = now + 300000; // 서버 타이머가 찍은 이벤트의 시계 오차(+5분)까지 포함
    var cap = 200; // 목록은 최근 200건만 렌더(성능) — 개수는 아래 countEvents로 정확히
    var typeF = (S.evtType && S.evtType !== 'all') ? S.evtType : null;
    var tagF = null;
    if (S.evtTag && S.evtTag !== 'all') {
      var feq = ((this.data && this.data.equipment) || []).filter(function (e) { return e.id === S.evtTag; })[0];
      if (feq) tagF = { tbl: feq.table, tag: feq.name };
    }
    countEvents(from, to, typeF, tagF ? tagF.tbl : null, tagF ? tagF.tag : null)
      .then(function (n) { self._evtTotal = n; self.forceUpdate(); }).catch(function () { self._evtTotal = null; });
    loadEventsRange(from, to, cap).then(function (rows) {
      var byKey = {};
      ((self.data && self.data.equipment) || []).forEach(function (e) { byKey[e.table + ':' + e.name] = e; });

      var evs = rows.map(function (r) {
        var eq = byKey[r.tbl + ':' + r.tag];
        return {
          id: r.eid, ms: r.ts, tagId: eq ? eq.id : null,
          tagAlias: eq ? (eq.alias || eq.name) : r.tag, tagName: r.tag,
          type: r.etype, typeKo: TYPEKO[r.etype] || r.etype, unit: eq ? eq.unit : '',
          value: r.val, base: r.lim, grade: Math.max(0, GRADE_WORDS.indexOf(r.grade)),
          // 대역 이벤트는 값이 "배수"라 단위가 없고, 어느 대역이 걸렸는지는 DETAIL에 있다
          bands: r.detail ? VC.bandParse(r.detail) : null,
          detail: r.detail || '',   // 두절의 무수신 시간처럼 대역이 아닌 유형도 DETAIL을 쓴다
        };
      });
      self._evtCapped = rows.length >= cap; // 전체 하드캡 도달 표시용
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
    var self = this, S = this.state, E = this.E;
    var fromMs = new Date(S.csvFrom + 'T00:00:00').getTime();
    var toMs = new Date(S.csvTo + 'T23:59:59.999').getTime();
    if (!(fromMs <= toMs)) { this._toast('기간이 올바르지 않습니다 (시작 ≤ 종료)', 'warn'); return; }
    var aliasOf = function (r) { return (S.aliases || {})[r.tbl + ':' + r.tag] || ''; };
    loadEventsRange(fromMs, toMs).then(function (rows) {
      if (!rows.length) { self._toast('해당 기간에 이벤트가 없습니다', 'warn'); return; }
      var content, mime, ext;
      /* 시각은 초까지 — 같은 분에 여러 이벤트가 나면 화면 표기(분)로는 파일에서 순서를 구분할 수 없다.
         화면은 지금대로 분까지가 적당하므로 내보내기에서만 늘린다. */
      var ts = function (ms) { return E.fmtFull(ms).slice(0, 19); };
      // 상세 — 알람이 실제로 들고 있는 내용(대역 이탈의 대역별 값·한계, 두절의 무수신 시간)
      var det = function (r) { return r.detail || ''; };
      if (S.dlFmt === 'json') {
        content = JSON.stringify(rows.map(function (r) {
          return { time: ts(r.ts), table: r.tbl, tag: r.tag, alias: aliasOf(r), type: TYPEKO[r.etype] || r.etype, grade: r.grade, value: r.val, limit: r.lim, detail: det(r) };
        }), null, 2);
        mime = 'application/json'; ext = 'json';
      } else {
        var cell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var lines = ['시각,테이블,태그,별칭,유형,등급,지표값,기준값,상세'];
        rows.forEach(function (r) { lines.push([ts(r.ts), r.tbl, r.tag, aliasOf(r), TYPEKO[r.etype] || r.etype, r.grade, r.val, r.lim, det(r)].map(cell).join(',')); });
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
  /* ── 태그 되살아남 차단 ──────────────────────────────────────────────────

     학습값(NEO_VIBE_BASELINE)과 판정 상태(NEO_VIBE_MONSTATE)는 '테이블:태그' 문자열 하나를
     키로 쓴다. 태그를 지워도 이 LOOKUP 행들은 남는다 — TAG 테이블에서만 사라지기 때문이다.
     나중에 같은 이름으로 다른 설비를 붙이면 옛 μ·σ가 말없이 적용된다.

     어느 쪽으로 틀리는지도 나쁘다: 새 설비가 더 조용하면 옛 μ가 높아 이탈이 영영 안 잡히고
     (조용한 실패), 더 시끄러우면 계속 이탈로 떠서 알람이 폭주한다. 화면에는 그냥 "학습됨"이다.

     데이터만으로는 같은 설비인지 알 수 없으므로(이름이 유일한 단서다) 사람에게 묻는다.
     확인 전까지 그 태그의 베이스라인·대역 판정은 멈춘다 — ISO 존은 절대 기준이라 계속 돈다. */
  _checkRevived(keys, scopeTables) {
    var self = this, S = this.state;
    /* 베이스라인을 아직 안 읽었으면 판단할 수 없다 — 이때 돌면 전부 "학습값 없음"으로 보여
       조용히 아무것도 안 걸린다. _blMap이 없으면 미로드, 빈 객체({})면 로드했는데 학습값이
       하나도 없는 것이라 구분된다. */
    if (!this._blMap) return;
    var cur = {}, curKeys = [];
    (keys || []).forEach(function (k) { if (!cur[k]) { cur[k] = 1; curKeys.push(k); } });

    /* 첫 실행 — 지금 있는 태그를 그대로 '아는 태그'로 굳히고 아무것도 묻지 않는다.
       여기서 물으면 지워진 적도 없는 태그까지 전부 확인 대상이 된다. */
    if (!Array.isArray(S.knownTags)) {
      this.setState({ knownTags: curKeys });
      this._persistView(['knownTags'], { knownTags: curKeys });
      return;
    }

    /* 비교 범위는 '지금 선택된 테이블'로 제한한다. 설정에서 테이블 선택을 뺐다 넣으면
       그 테이블의 태그가 목록에서 빠졌다 돌아오는데, 그건 화면 설정이지 설비가 바뀐 게 아니다.
       선택 밖 테이블의 키는 건드리지 않고 그대로 둔다. */
    var sel = {};
    (scopeTables || S.srcSel || []).forEach(function (t) { sel[t] = 1; });
    var inScope = function (k) { return !!sel[k.slice(0, k.indexOf(':'))]; };

    var known = {};
    S.knownTags.forEach(function (k) { known[k] = 1; });
    var rev = Object.assign({}, S.revived || {}), changed = false, now = Date.now();
    curKeys.forEach(function (k) {
      // 아는 태그가 아닌데 학습값이 남아 있다 = 지웠다 다시 등록됐다는 뜻이다
      if (!known[k] && self._hasLearned(k) && !rev[k]) { rev[k] = now; changed = true; }
    });
    // 선택 범위 안에서 사라진 태그만 목록에서 뺀다 — 다시 나타나면 위 검사에 걸리도록
    var nextKnown = S.knownTags.filter(function (k) { return cur[k] || !inScope(k); });
    curKeys.forEach(function (k) { if (nextKnown.indexOf(k) < 0) nextKnown.push(k); });
    // 지금 없는 태그의 확인 표시는 정리한다
    Object.keys(rev).forEach(function (k) { if (!cur[k]) { delete rev[k]; changed = true; } });

    var same = nextKnown.length === S.knownTags.length
      && nextKnown.every(function (k, i2) { return k === S.knownTags[i2]; });
    if (!changed && same) return;
    this.setState({ knownTags: nextKnown, revived: rev });
    this._persistView(['knownTags', 'revived'], { knownTags: nextKnown, revived: rev });
  }
  // 이 태그에 학습값이 있는가 — RMS 베이스라인 또는 대역 베이스라인 아무거나
  _hasLearned(key) {
    var m = this._blMap || this.state.baselines || {};
    if (m[key]) return true;
    for (var i = 0; i < VC.BAND_ORDER.length; i++) if (m[key + ':' + VC.BAND_ORDER[i]]) return true;
    return false;
  }
  // 확인 대기 중인가 — 그 동안 베이스라인·대역 판정을 멈춘다
  _isRevived(key) { return !!(this.state.revived || {})[key]; }
  /* 같은 설비가 맞다 — 표시만 지우고 학습값을 그대로 쓴다 */
  _keepLearned(key) {
    var rev = Object.assign({}, this.state.revived || {});
    delete rev[key];
    this.setState({ revived: rev });
    this._persistView(['revived'], { revived: rev });
    this._toast('기존 학습값을 계속 사용합니다');
    this._syncMonitorTimer(true);
  }
  /* 한꺼번에 유지 — 태그를 여러 개 다시 등록하면 수십 개가 한 번에 확인 대기로 뜬다.
     하나씩 누르게 두면 확인이 일이 되고, 일이 되면 안 보고 누르게 된다.
     낱개로 부르지 않고 따로 두는 이유는 저장·타이머 재등록을 N번 하지 않기 위해서다. */
  _keepAllLearned() {
    var n = Object.keys(this.state.revived || {}).length;
    if (!n) return;
    this.setState({ revived: {} });
    this._persistView(['revived'], { revived: {} });
    this._toast(n + '개 태그의 기존 학습값을 계속 사용합니다');
    this._syncMonitorTimer(true);
  }
  /* 다른 설비다 — 학습값(RMS+대역 6건)과 판정 상태를 지우고 재학습을 받게 한다.
     대역 시계열은 지우지 않는다: 옛 값이 남아도 학습을 다시 하면 그 창만 쓰므로 판정엔 안 섞이고,
     지우면 되돌릴 수 없다. 정리는 고아 데이터 화면에서 따로 하게 한다. */
  _resetLearned(key) {
    var self = this;
    var jobs = [deleteBaseline(key).catch(function () {})];
    // 옛 이름(vhigh)도 같이 지운다 — 목록에서 빠진 뒤에도 표에 남으면 아무도 안 보는 행이 쌓인다
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
  // 정상 상태 학습: 태그의 정상 기간을 sec 롤업으로 조회 → μ·σ 적합 → NEO_VIBE_BASELINE 저장.
  //  · 해상도는 sec 고정 — 판정 값(eq.rms=최신 sec 버킷)과 학습 통계의 해상도를 일치시킨다.
  //  · 학습 구간(blWin)은 "얼마나 긴 정상 기간을 학습할지"만 결정(대표성 knob), 해상도와 무관.
  /* 베이스라인 맵·진행중 표시의 동시 갱신 —
     전체 학습은 태그마다 병렬로 끝나는데, setState는 배치되어 각 완료 콜백이 "아직 앞 태그가
     반영되지 않은" state를 복사한다. 그래서 Object.assign({}, state.baselines)로 병합하면
     마지막에 끝난 태그가 앞선 결과를 덮어써 한 태그만 학습된 것처럼 보인다(DB엔 전부 저장됨).
     누적은 동기적으로 갱신되는 _blMap/_busyMap에 하고, state에는 그 사본만 넣는다. */
  _blMerge(entries, dropKeys) {
    var m = this._blMap || Object.assign({}, this.state.baselines || {});
    if (entries) Object.keys(entries).forEach(function (k) { m[k] = entries[k]; });
    if (dropKeys) dropKeys.forEach(function (k) { delete m[k]; });
    this._blMap = m;
    return Object.assign({}, m); // 사본을 넘겨야 preact가 변경을 감지한다
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
  _learnBaseline(eq) {
    var self = this, S = this.state;
    var key = eq.table + ':' + eq.name;
    if (this._isBusy('blBusy', key)) return;
    var H = { '1h': 1, '6h': 6, '24h': 24 }[S.blWin] || 24;
    var to = eq.lastSeen || Date.now(), from = to - H * 3600000;
    this._busySet('blBusy', key, true);
    function unbusy() { self._busySet('blBusy', key, false); }
    // 학습 단위를 판정 구간과 맞춘다 — μ·σ가 실제 판정값의 분포를 설명해야 한다
    var winSec = Math.round(Math.max(durMs(S.evalWindow) || 10000, durMs(S.monitorInterval) || 3000) / 1000);
    rollupTrend(eq.table, eq.name, 'sec', from, to).then(function (buckets) {
      var vals = VC.windowSeries(buckets, winSec);
      // 정상상태 게이트 — 정지·기동/정지 램프 버킷은 학습에서 제외. 섞이면 median이 내려가거나
      // 산포가 부풀어 한계가 오염된다. 뭘 걸렀는지는 결과에 남긴다(조용히 거르면 μ를 설명 못 한다).
      var ss = VC.steadyStateFilter(vals);
      var fit = VC.baselineFit(ss.vals);
      var exTxt = (ss.idle || ss.ramp) ? ' · 제외 ' + (ss.idle + ss.ramp) + '개(정지 ' + ss.idle + '·과도 ' + ss.ramp + ')' : '';
      // 창의 대부분이 정지면 게이트 참조(P75)까지 정지 수준에 붙어 "정지=정상"을 학습한다 — 결과를 버린다.
      // 비율과 높이를 함께 본다(충격성 정상 신호는 상위군이 중앙값의 몇 배에 그쳐 여기 안 걸린다).
      if (ss.bimodal) throw new Error('학습 구간이 정지↔운전 두 수준으로 갈라져 있습니다(상위 수준 표본 '
        + Math.round(ss.bimodalFrac * 100) + '%, 중앙값의 ' + Math.round(ss.bimodalRatio) + '배) — 정상 운전이 대부분인 기간으로 다시 학습하세요');
      if (!fit) throw new Error('정상상태 표본 ' + ss.vals.length + '개 (최소 ' + VC.BASELINE_MIN_N + '개 필요' + exTxt + ') — 판정 구간 ' + winSec + '초로 묶어 세므로, 학습 창을 늘리거나 판정 구간을 줄이세요');
      var ms = buckets.map(function (b) { return b.ms; });
      var spanMin = ms.length ? Math.round((Math.max.apply(null, ms) - Math.min.apply(null, ms)) / 60000) : 0;
      var k = parseFloat(self.state.blK) || 3;
      // ex(제외 내역)는 부가 필드 — 저장 포맷의 기존 키(mu/sigma/k/n)는 그대로라 구버전 판정과 호환
      var obj = { mu: +fit.mu.toFixed(4), sigma: +fit.sigma.toFixed(4), k: k, n: fit.n, spanMin: spanMin, unit: 'sec', win: S.blWin, evalWin: winSec, at: Date.now() };
      if (ss.idle || ss.ramp) obj.ex = { idle: ss.idle, ramp: ss.ramp };
      return saveBaseline(key, obj).then(function () {
        var ent = {}; ent[key] = obj;
        self.setState({ baselines: self._blMerge(ent) });
        unbusy();
        self._resyncMonSoon(); // 서버 모드면 새 μ·σ로 TQL 재생성 — 안 하면 타이머가 옛 한계로 판정
        self._toast((eq.alias || eq.name) + ' 베이스라인 학습 완료 · μ ' + obj.mu.toFixed(2) + ' / σ ' + obj.sigma.toFixed(2) + exTxt + (spanMin < 10 ? ' · 구간 짧음(참고용)' : ''), spanMin < 10 ? 'warn' : 'ok');
      });
    }).catch(function (e) {
      unbusy();
      self._toast('베이스라인 학습 실패: ' + (e.message || e), 'err');
    });
  }
  /* 대역 베이스라인 학습 — NEO_VIBE_BAND에 쌓인 대역 시계열로 대역마다 μ·σ를 학습한다.
     전체 RMS 학습과 같은 함수(steadyStateFilter → baselineFit)를 쓴다. 대역값은 이미 대역제한된
     스칼라 시계열이라 구조가 같고, 정지 구간 제외·스파이크 내성도 그대로 필요하다.
     키는 "테이블:태그:대역" — 기존 NEO_VIBE_BASELINE에 그대로 들어간다(스키마 변경 없음). */
  _learnBandBaseline(eq) {
    var self = this, S = this.state;
    var base = eq.table + ':' + eq.name;
    var H = BAND_WIN_H[S.bandWin] || 24;   // 대역 전용 기간 — RMS와 표본 밀도가 달라 따로 둔다
    /* 창의 끝은 벽시계가 아니라 그 태그의 마지막 데이터다(_learnBaseline과 같은 규칙).
       적재가 끝난 테이블은 대역 앵커도 그 시점에 멈춰 있어, 벽시계로 잡으면 창이 통째로
       데이터 뒤에 놓여 "값 없음"이 된다. */
    var to = eq.lastSeen || Date.now(), from = to - H * 3600000;
    var k = parseFloat(S.blK) || 3;
    var grid = durMs(S.bandInterval); // 밀도 균일화 격자 = 의도된 추출 주기
    return Promise.all(VC.BAND_ORDER.map(function (bn) {
      var key = base + ':' + bn;
      return bandRaw(key, from, to).then(function (rows) {
        var raw = rows.filter(function (r) { return isFinite(r.v); });
        /* 행이 하나도 없는 것과 0만 쌓인 것은 원인이 다르다 — 앞은 추출이 안 돌았거나 기간이
           짧은 것이고, 뒤는 그 대역을 원리적으로 못 재는 것이다. 한 문구로 묶으면 대역 추출을
           켠 적도 없는 태그에 "Nyquist보다 높습니다"라고 말하게 된다. */
        if (!raw.length) return { bn: bn, err: '값 없음 — 대역 추출이 돌지 않았거나 학습 기간에 쌓인 값이 없습니다' };
        /* 추출 주기를 격자로 밀도를 고른다 — 주기 변경·타이머 중단으로 구간별 밀도가 달라지면
           촘촘한 구간이 표본을 지배해 그 구간이 곧 기준이 된다(그래서 학습이 조용히 오염된다). */
        var vals = VC.evenSample(raw, grid);
        var ss = VC.steadyStateFilter(vals);
        if (ss.bimodal) return { bn: bn, err: '정지↔운전 두 수준' };
        /* 값이 전부 0인 대역은 학습하지 않는다 — 그 대역이 Nyquist 위라 측정 자체가 불가능한 경우다
           (예: 1× 30 Hz면 초고주파 하한이 990 Hz인데 302 Hz 샘플링은 151 Hz까지만 본다).
           그대로 배우면 μ=0·σ=0 → 한계 0이 되어 0보다 큰 값이 한 번만 나와도 이탈로 잡힌다. */
        var nz = ss.vals.filter(function (v) { return v > 0; });
        // 값이 없는 이유가 계열마다 다르다 — 대역은 샘플레이트, 포락선은 설정이다
        if (!nz.length) return { bn: bn, err: VC.BAND_FREQ.indexOf(bn) >= 0
          ? '측정 범위 밖 — 대역 하한이 Nyquist보다 높습니다'
          : '값 없음 — 베어링 품번 미지정이거나 복조 대역이 성립하지 않습니다' };
        var fit = VC.baselineFit(ss.vals);
        if (!fit) return { bn: bn, err: '표본 ' + ss.vals.length + '개(최소 ' + VC.BASELINE_MIN_N + ')' };
        var obj = { mu: +fit.mu.toFixed(5), sigma: +fit.sigma.toFixed(5), k: k, n: fit.n, band: bn, at: Date.now(),
          raw: raw.length, grid: grid }; // 솎기 전 표본 수 — 균일화가 얼마나 걷어냈는지 툴팁에 보여준다
        return saveBaseline(key, obj).then(function () { return { bn: bn, obj: obj }; });
      }).catch(function (e) { return { bn: bn, err: e.message || String(e) }; });
    })).then(function (res) {
      var ok = res.filter(function (r) { return r.obj; });
      var ent = {};
      ok.forEach(function (r) { ent[base + ':' + r.bn] = r.obj; });
      self.setState({ baselines: self._blMerge(ent) });
      return { ok: ok.length, fail: res.filter(function (r) { return r.err; }) };
    });
  }
  /* 최신 대역값 캐시 — 추출은 10분 주기인데 판정은 10초마다 돈다. 매 판정마다 조회하면
     아무것도 안 바뀐 값을 60번 다시 읽는다. 추출 주기의 절반이 지났을 때만 갱신한다. */
  _refreshBandNow() {
    var self = this, S = this.state;
    if (!S.bandOn) { this._bandNow = null; return; }
    var iv = durMs(S.bandInterval || '10m') || 600000;
    var now = Date.now();
    if (this._bandNowAt && now - this._bandNowAt < iv / 2) return;
    if (this._bandNowBusy) return;
    this._bandNowBusy = true;
    this._bandNowAt = now;
    var eqs = this._activeEqs();
    /* 설비 × 판정 계열 최신 1건씩 — 조회는 설비당 1회(계열 전부를 NAME IN 한 번에).
       계열마다 따로 물으면 문장 수가 태그수 × 계열수라, 계열이 늘 때마다 그만큼 늘어난다. */
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
  // 학습 실행 래퍼 — 진행 표시와 결과 토스트를 붙인다(학습 자체는 _learnBandBaseline)
  _runBandLearn(eq) {
    var self = this, key = eq.table + ':' + eq.name;
    if (this._isBusy('bandBusy', key)) return;
    this._busySet('bandBusy', key, true);
    function unbusy() { self._busySet('bandBusy', key, false); }
    this._learnBandBaseline(eq).then(function (r) {
      unbusy();
      var nm = eq.alias || eq.name;
      if (r.ok === 0) {
        /* 사유가 대역마다 다를 수 있다 — 저속 샘플링 태그는 고주파 대역만 "측정 범위 밖"이고
           나머지는 "값 없음"이다. 첫 번째를 대표로 쓰면 소수 사유가 전체를 대변해 엉뚱한 곳을
           고치게 된다(실제로 값이 없는 태그에 Nyquist 이야기를 했다). 가장 많은 사유를 고른다. */
        var cnt = {}, why = '사유 불명', top = 0;
        r.fail.forEach(function (f) { var e2 = f.err || ''; cnt[e2] = (cnt[e2] || 0) + 1; if (cnt[e2] > top) { top = cnt[e2]; why = e2; } });
        self._toast(nm + ' 대역 학습 불가 — ' + why + (r.fail.length > top ? ' (' + top + '/' + r.fail.length + ')' : ''), 'warn');
      } else {
        self._toast(nm + ' 대역 베이스라인 ' + r.ok + '/' + VC.BAND_ORDER.length + ' 학습 완료'
          + (r.fail.length ? ' · ' + r.fail.length + '개 대역 실패' : ''), r.fail.length ? 'warn' : 'ok');
        self._resyncMonSoon(); // 서버 모드면 새 대역 기준으로 감시 TQL을 다시 굽는다
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
        self._resyncMonSoon(); // 서버 TQL에 구워진 옛 기준을 걷어낸다
      });
  }
  // 설비의 대역 베이스라인 묶음 — 학습된 것만 담는다(하나도 없으면 판정 불가)
  /* 판정에 실제로 쓰이는 대역 기준만 돌려준다 — 한계가 0이면 bandJudge가 건너뛰므로
     학습된 것으로 세면 "5/5 학습됨"인데 실제로는 4개만 판정하는 거짓 표시가 된다.
     (대역 하한이 Nyquist보다 높으면 값이 항상 0이라 μ=0·σ=0으로 저장된 옛 데이터가 있다.) */
  _bandBaselines(eq) {
    var m = this._blMap || this.state.baselines || {}, base = eq.table + ':' + eq.name, out = null;
    VC.BAND_ORDER.forEach(function (bn) {
      var b = m[base + ':' + bn];
      if (b && VC.baselineLimit(b) > 0) { out = out || {}; out[bn] = b; }
    });
    return out;
  }
  /* 이 태그에서 값을 확정 근거로 쓸 수 없는 대역 — 가속도계 마운팅 유효 상한을 넘는 칸들.
     fr은 _bandSpec과 같은 규칙으로 고른다: 대역 경계를 그 fr로 구워 적재했으므로,
     여기서 다른 fr을 쓰면 판정이 실제 적재된 것과 다른 경계를 가정하게 된다.
     마운팅은 저장본(eq.meta)보다 화면 상태를 먼저 본다 — 고른 즉시 판정에 반영되어야
     설정 화면의 "그 위 대역은 제외됩니다" 안내와 실제 동작이 어긋나지 않는다. */
  _softBands(eq) {
    var det = (this._detailCache[eq.id] || {}).det;
    var fr = (det && det.frMeas && det.frMeas.f > 0) ? det.frMeas.f : (eq.rpm / 60);
    var mount = ((this.state.equipMeta || {})[eq.id] || {}).mount || (eq.meta || {}).mount;
    return VC.softBands(fr, eq.fs, mount);
  }
  /* 대역 추출 타이머 — 판정 타이머와 같은 서명 비교 방식. 태그가 늘거나 회전수 설정이 바뀌면
     다시 굽는다(대역 경계가 1× 상대라 RPM이 바뀌면 다른 주파수를 재게 된다).
     판정 타이머와 분리한 이유는 주기 차이다 — 판정 10초 / 대역 추출은 태그당 FFT라 10분. */
  /* 대역 추출 대상 — 대역 경계가 1× 상대라 회전주파수(RPM 또는 실측 1×)가 없으면 정의할 수 없다.
     조용히 거르면 "왜 6개 중 1개만 채워지나"를 알 수 없으므로 제외 사유를 함께 돌려준다. */
  /* 이 태그의 베어링 형상 — 카탈로그 품번이면 표에서, 직접 입력이면 저장된 형상에서.
     품번이 없거나 슬리브(구름체가 없다)면 결함주파수 자체가 정의되지 않는다. */
  _bearingGeo(eq) {
    var S = this.state, model = (S.equipBearing || {})[eq.id] || '';
    if (!model || model === 'sleeve') return null;
    return VC.BEARINGS[model] || Object.assign({}, eq.bearing, (S.equipGeo || {})[eq.id] || {});
  }
  _bandSpec() {
    var self = this;
    var all = this._activeEqs().map(function (eq) {
      var det = (self._detailCache[eq.id] || {}).det;
      // 실측 1×가 있으면 그걸 쓴다 — 명판과 다르면 대역이 통째로 어긋난다
      var fr = (det && det.frMeas && det.frMeas.f > 0) ? det.frMeas.f : (eq.rpm / 60);
      var mount = ((self.state.equipMeta || {})[eq.id] || {}).mount || (eq.meta || {}).mount;
      return { tbl: eq.table, tag: eq.name, fr: Math.round(fr * 100) / 100, fs: eq.fs,
        /* 복조 대역은 설정에서만 정해지는 값이라 앵커마다 같다 — 추세가 성립하려면 고정이어야 한다.
           결함주파수는 굽지 않고 계수만 굽는다: 서버가 앵커마다 fr을 실측하므로 그때 곱해야 따라간다. */
        demod: VC.demodBand(eq.fs, mount), bf: VC.faultCoeffs(self._bearingGeo(eq)),
        stat: eq.stat || null, label: self._tagLabel(eq) };
    });
    var skipped = all.filter(function (t) { return !(t.fs > 0 && t.fr > 0); })
      .map(function (t) { return { label: t.label, why: !(t.fr > 0) ? 'RPM 미설정' : '샘플레이트 불명' }; });
    return { tags: all.filter(function (t) { return t.fs > 0 && t.fr > 0; }), skipped: skipped, total: all.length, wd: this._wdSpec('band') };
  }
  /* 과거 채우기(백필) 계획 — 어디까지 채울지와 얼마나 걸릴지를 먼저 계산한다.
     상한은 학습 창이다. 그보다 긴 구간은 지금 소비처가 없다(추세 차트가 생기면 그때 올린다).
     간격은 반드시 추출 주기와 같게 — 다르면 백필 구간이 표본을 지배해 학습이 편향된다. */
  /* ov(override)를 받는 이유: setState가 배치되어 값을 바꾼 직후에는 this.state가 아직 옛 값이다.
     그대로 계획을 세우면 "24시간으로 바꿨는데 표본 칩은 /432(3일 기준)"처럼 한 박자 늦는다.
     렌더 콜백에 기대지 않고 새 값을 직접 넘겨 타이밍 의존을 없앤다. */
  _bandPlan(ov) {
    var S = this.state, spec = this._bandSpec();
    ov = ov || {};
    var iv = durMs(ov.bandInterval || S.bandInterval) || 600000;
    var H = BAND_WIN_H[ov.bandWin || S.bandWin] || 24;   // 채울 구간도 대역 학습 기간에 맞춘다
    var span = H * 3600000;
    var perTag = Math.floor(span / iv);
    /* 창의 끝을 태그의 마지막 데이터에 맞춘다 — 벽시계로 잡으면 적재가 끝난 테이블에서
       창이 통째로 데이터 뒤에 놓여 아무것도 못 센다.
       원본이 없는 시각은 band.js가 조용히 건너뛰므로 그대로 두면 "완료 0개"가 되고 이유를 알 수 없다.
       RMS 학습(_learnBaseline)이 이미 eq.lastSeen을 쓰는 규칙이라 여기서도 같게 맞춘다.
       라이브 테이블은 lastSeen ≈ 지금이라 동작이 그대로다. */
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
      // 태그마다 창이 다르다 — 조회는 가장 이른 시작으로 한 번에 하고, 세는 것은 태그별 창에서 한다
      per: per, ends: ends, froms: froms, oldest: oldest,
      perTag: perTag, total: total, etaMs: total * BAND_PER_MS, minN: VC.BASELINE_MIN_N };
  }
  /* 채움 현황 — 태그별로 학습 창 안에 어느 격자 칸이 이미 채워져 있는지.
     TAG 테이블은 같은 NAME+TIME 중복 삽입을 막지 않으므로, 이걸 모르면 다시 채울 때마다
     같은 시각이 겹쳐 쌓인다(학습은 균일화가 막아주지만 저장과 추세는 그대로 오염된다).
     타이머가 쓴 값과 채우기가 쓴 값을 구분하지 않는다 — 중요한 건 "그 칸이 찼는가"뿐이다. */
  _refreshBandCov(ov) {
    var self = this, plan = this._bandPlan(ov);
    if (!this.live || !plan.tags.length) { this.setState({ bandCov: null }); return Promise.resolve(); }
    var now = Date.now(), probe = VC.BAND_FREQ[0];
    var keys = plan.tags.map(function (t) { return t.tbl + ':' + t.tag + ':' + probe; });
    // 조회는 가장 이른 창 시작부터 한 번에 — 태그마다 창이 달라(적재가 끝난 시점이 다르다) 세는 것만 나눈다
    return bandTimes(keys, plan.oldest, now).then(function (m) {
      var cov = {};
      plan.tags.forEach(function (t) {
        var key = t.tbl + ':' + t.tag, set = {}, n = 0;
        var lo = plan.froms[key], hi = plan.ends[key];
        (m[key + ':' + probe] || []).forEach(function (ms) {
          if (ms < lo || ms > hi) return;   // 다른 태그의 창에 걸친 값은 이 태그의 채움이 아니다
          var b = Math.floor(ms / plan.iv);
          if (!set[b]) { set[b] = 1; n++; }
        });
        cov[key] = { set: set, have: n, need: plan.per[key] };
      });
      self.setState({ bandCov: cov });
      return cov;
    }).catch(function () { self.setState({ bandCov: null }); });
  }
  /* 백필 실행 — 최신에서 과거 방향으로, 청크로 나눠 돈다.
     · 최신 우선이라 중간에 멈춰도 채워진 부분이 곧 학습에 쓸 수 있는 구간이다(과거부터 채우면 쓸모없다)
     · 청크 사이에 쉬는 이유는 감시 타이머를 굶기지 않기 위해서다 — 백필하느라 실시간 판정이 밀리면 본말전도
     · 이미 값이 있는 시각은 건너뛴다(재실행·이어하기가 공짜가 되도록) */
  _runBandBackfill() {
    var self = this, S = this.state;
    var plan = this._bandPlan();
    if (!plan.tags.length) { this._toast('대역을 추출할 태그가 없습니다', 'warn'); return Promise.resolve(); }
    var now = Date.now();
    this._bfCancel = false;
    /* 이미 찬 칸은 건너뛴다 — 그래서 태그를 새로 추가하고 다시 눌러도 그 태그만 채워진다.
       중단 후 이어하기도 같은 이유로 공짜다. 현황을 먼저 읽고 계획을 세운다. */
    return this._refreshBandCov().then(function (cov) {
      var jobs = [], total = 0;
      // 태그별 앵커 목록(최신 → 과거). 격자에 스냅해 타이머가 찍을 시각과 같은 위치에 놓는다.
      plan.tags.forEach(function (t) {
        var k = t.tbl + ':' + t.tag;
        var had = ((cov || {})[k] || {}).set || {};
        /* 앵커의 기준 시각은 벽시계가 아니라 그 태그의 마지막 데이터다 — 적재가 끝난 테이블에서
           벽시계로 잡으면 원본이 없는 구간을 채우려 들고, band.js가 전부 건너뛰어 0개로 끝난다. */
        var anchors = VC.bandAnchors(plan.ends[k] || now, plan.iv, plan.per[k] || 0, had);
        if (anchors.length) { jobs.push({ t: t, anchors: anchors }); total += anchors.length; }
      });
      if (!total) { self._toast('이미 다 채워져 있습니다 — 새로 계산할 구간이 없습니다', 'ok'); return; }
      return self._bfRun(jobs, total, now, plan, cov);
    });
  }
  _bfRun(jobs, total, now, plan, cov) {
    var self = this, minN = plan.minN;
    /* "학습 가능"은 진행률이 아니라 태그별 보유량으로 판단한다 — 전체의 절반을 채웠어도
       한 태그만 몰려 있으면 나머지는 여전히 학습이 안 된다. 가장 적은 태그를 기준으로 본다. */
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
      var tql = Band.buildBandTql({ tags: [job.t], anchors: chunk, nowMs: now });
      return bandBackfill(tql).then(function (nOk) {
        // 서버가 실제로 저장한 개수를 쓴다 — 원본이 없는 구간은 조용히 건너뛰므로 요청 수와 다를 수 있다
        var got = isFinite(nOk) && nOk > 0 ? Math.min(nOk, chunk.length) : 0;
        done += chunk.length;
        gain[job.t.tbl + ':' + job.t.tag] += got;
        self.setState({ bandFill: { done: done, total: total,
          eta: Math.max(0, total - done) * BAND_PER_MS, learnable: minHave() >= minN } });
        // 청크 사이 한 박자 — 감시 타이머에 자리를 내준다
        return new Promise(function (r) { setTimeout(r, BAND_CHUNK_GAP); }).then(function () { return step(ji, ai + BAND_CHUNK); });
      }).catch(function () { done += chunk.length; return step(ji, ai + BAND_CHUNK); }); // 한 청크 실패는 건너뛴다(구멍은 균일화가 흡수)
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
  /* 진동 감지 — 판정 루프에서 돈다. 알람 설정과 무관하게 항상 계산해 두고 화면은 읽기만 한다
     (렌더마다 이벤트 전체를 훑으면 태그 수 × 이벤트 수가 되고, 탭을 옮기면 사라진다).
     같은 태그가 악화를 짧은 간격으로 반복하면 설비 상태보다 설정 문제일 때가 많다. */
  _refreshFlap() {
    var byTag = {};
    (this.state.events || []).forEach(function (ev) {
      if (ev.etype !== 'threshold') return;
      (byTag[ev.tbl + ':' + ev.tag] = byTag[ev.tbl + ':' + ev.tag] || []).push(ev.ts);
    });
    var now = Date.now(), out = {};
    Object.keys(byTag).forEach(function (k) {
      byTag[k].sort(function (a, b) { return a - b; });
      var d = VC.detectFlap(byTag[k], 2 * 3600000, now);
      if (d) out[k] = d;
    });
    this._flap = out;
  }
  _cancelBandBackfill() { this._bfCancel = true; }
  // 진동 배지에서 바로 RMS 구간을 올린다 — 설정 탭까지 찾아가지 않아도 되게
  _applyFlapFix(needMin) {
    var self = this;
    var v = Math.round(needMin * 60) + 's';
    this.setState({ evalWindow: v, dirty: true });
    this._persistCfg().then(function () {
      self._toast('RMS 구간을 ' + needMin + '분으로 변경했습니다 — 판정값이 그 구간으로 평균됩니다', 'ok');
    });
  }
  /* 주기를 바꾸면 무엇이 달라지는지 — 숫자로 먼저 보여준다.
     특히 "학습 창 안 표본 수"는 조합에 따라 최소 표본(30)에 못 미쳐 학습이 아예 안 되는데,
     그걸 눌러본 뒤에 실패로 알게 되면 늦다. */
  _bandIvFacts(next, cur) {
    var S = this.state, iv = durMs(next) || 600000, nTags = cur.tags.length;
    var H = BAND_WIN_H[S.bandWin] || 24;   // 대역 학습 기간 — 여기서 RMS 기간을 쓰면 표본 수가 틀린다
    var n = Math.floor(H * 3600000 / iv);
    var round = nTags * BAND_PER_MS, duty = iv > 0 ? round / iv * 100 : 0;
    return [
      { k: '대역 학습 표본', v: n + '개 (현재 ' + cur.perTag + '개) · 최소 ' + VC.BASELINE_MIN_N, warn: n < VC.BASELINE_MIN_N },
      { k: '회차당 소요', v: fmtDur(round) + ' · ' + nTags + '개 태그' },
      { k: '서버 점유율', v: duty >= 100 ? '주기 초과 — 다음 회차를 밀어냅니다' : duty.toFixed(0) + '%', warn: duty >= 50 },
      { k: '최소 학습 소요', v: n < VC.BASELINE_MIN_N ? '학습 불가' : fmtDur(VC.BASELINE_MIN_N * iv) + ' 후 (채우기 없이)' , warn: n < VC.BASELINE_MIN_N },
    ];
  }
  // 주기 확정 — 선택한 이전 구간 처리까지 수행한 뒤 타이머를 새 주기로 다시 굽는다
  _applyBandInterval() {
    var self = this, S = this.state, next = S.bandIvNext, act = S.bandIvAct || 'keep';
    // 주기가 바뀌면 격자가 달라져 보유 칸이 다시 계산된다 — 반영 후에 읽는다(배치 지연 회피)
    this.setState({ bandInterval: next, bandIvOpen: false, dirty: true });
    this._refreshBandCov({ bandInterval: next });
    var after = function () {
      return self._syncBandTimer().then(function () { return self._syncMonitorTimer(true); });
    };
    if (act === 'reset') {
      var eqs = this._activeEqs();
      return Promise.all(eqs.map(function (eq) { return self._delBandBaseline(eq); })).then(after)
        .then(function () { self._toast('추출 주기 ' + (IV_KO[next] || next) + ' · 대역 베이스라인 초기화됨', 'ok'); });
    }
    if (act === 'refill') return after().then(function () { return self._runBandBackfill(); });
    return after().then(function () { self._toast('추출 주기 ' + (IV_KO[next] || next) + '로 변경', 'ok'); });
  }
  _syncBandTimer(silent) {
    var self = this, S = this.state;
    if (!this.live) return Promise.resolve();
    // 대역 추출은 서버 감시 여부와 무관하게 "알람이 켜져 있으면" 돈다 — 추세는 앱이 닫혀도 이어져야 한다
    if (!S.monitorOn || !S.bandOn) return this._dropTimer('_bandSig', deleteBandTimer, BAND_TIMER);
    var spec = this._bandSpec();
    var sched = '@every ' + (S.bandInterval || '10m');
    if (!spec.tags.length) return this._dropTimer('_bandSig', deleteBandTimer, BAND_TIMER);
    // 판정 타이머와 같은 이유로 생성된 TQL을 서명에 넣는다 — 코드가 바뀌면 다시 구워야 한다
    var tql = Band.buildBandTql(spec);
    var sig = JSON.stringify(spec.tags) + '|' + sched + '|' + srcSig(tql);
    if (silent && sig === this._bandSig) return Promise.resolve();
    return createBandTimer(tql, sched, this._timerKnown('_bandSig'))
      .then(function () { self._bandSig = sig; if (!silent) self._toast('대역 추출 켜짐 · ' + sched, 'ok'); })
      .catch(function (e) { self._bandSig = null; if (!silent) self._toast('대역 추출 설정 실패: ' + (e.message || e), 'err'); });
  }
  /* 서버 타이머 재동기화 예약 — 전체 학습은 태그마다 병렬로 끝나므로 그때마다 구우면 N번 재등록된다.
     짧게 디바운스해 마지막 한 번만 굽는다(재등록 사이 판정 주기가 비는 것을 최소화). */
  _resyncMonSoon() {
    var self = this;
    if (this.state.monMode !== 'server' || !this.state.monitorOn) return;
    if (this._resyncT) clearTimeout(this._resyncT);
    this._resyncT = setTimeout(function () { self._resyncT = null; self._syncMonitorTimer(true); }, 800);
  }
  // 학습 가능 여부(프록시) — 데이터 구간이 최소 표본(초) 이상인지. 진동 데이터는 밀도가 높아 구간(초)≈sec 버킷 수.
  // 미달이면 "학습 불가"로 보고 경고 카운트에서 제외(실제 표본 미달은 학습 시 min 30으로 재검증).
  _blSpanSec(eq) { return eq && eq.stat ? (eq.stat.maxMs - eq.stat.minMs) / 1000 : 0; }
  _blLearnable(eq) { return this._blSpanSec(eq) >= VC.BASELINE_MIN_N; }
  _delBaseline(key, eq) {
    var self = this;
    deleteBaseline(key).then(function () {
      var m = Object.assign({}, self.state.baselines); delete m[key];
      self._blMap = m;
      self.setState({ baselines: m });
      self._resyncMonSoon(); // 삭제도 판정 기준 변경 — 타이머가 지워진 베이스라인으로 계속 판정하면 안 된다
      self._toast((eq ? (eq.alias || eq.name) : key) + ' 베이스라인 삭제됨');
    }).catch(function (e) { self._toast('삭제 실패: ' + (e.message || e), 'err'); });
  }
  // DB가 닿지 않거나 테이블이 없을 때 — 빈 라이브 상태로 시작 (설정 → 데이터 소스 유도)
  _initEmpty(msg) {
    var E = this.E, now = Date.now();
    this.live = true;
    this.data = { now: now, equipment: [], events: [], reports: [] };
    this.setState({
      ready: true, srcSel: [], selTag: null, diagTag: null, events: [], reports: [], genTags: [],
      genPeriod: '', genFrom: '', genTo: '', genFromD: null, genToD: null,
      from: this._dtVal(now - PERIOD_H['1h'] * 3600000), to: this._dtVal(now), fromD: null, toD: null,
    });
    if (msg) this._toast(msg, 'warn');
  }
  componentDidUpdate() { this._scheduleDraw(); }
  _scheduleDraw() { var self = this; if (this._raf) clearTimeout(this._raf); this._raf = setTimeout(function () { self._draw(); }, 32); }
  cc() { var l = this.state.theme === 'light'; return { grid: l ? 'rgba(35,38,46,0.09)' : 'rgba(255,255,255,0.07)', axis: l ? '#5f636f' : '#9ba0aa', axisLine: l ? '#c2c6cd' : '#4a4a4a', hint: l ? '#8a8d99' : '#6c7079', text: l ? '#23262e' : '#f0f1f4' }; }
  _num(n) { return Math.round(n).toLocaleString('en-US'); }
  _eq(id) { if (!this.data) return null; for (var i = 0; i < this.data.equipment.length; i++) if (this.data.equipment[i].id === id) return this.data.equipment[i]; return null; }
  _activeEq(id) { var a = this._activeEqs(); if (!a.length) return null; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return a.slice().sort(function (x, y) { return (x.order || 0) - (y.order || 0); })[0]; }
  // 스펙트럼 분석 기준 시각 — 이벤트 클릭 시 그 시각, 아니면 선택 기간의 끝. 데이터 범위로 클램프.
  _detailAnchorMs(eq) {
    var S = this.state, a = S.detailAnchor;
    if (a == null) { var t = Date.parse(S.to); if (isFinite(t)) a = t; } // 선택 기간의 끝
    if (a == null) a = eq.lastSeen || (this.data && this.data.now); // 최후 폴백(안정값 — Date.now() 금지: 매 렌더 재캡처 유발)
    if (eq.lastSeen && a > eq.lastSeen) a = eq.lastSeen; // 미래 데이터 없음
    var mn = eq.stat && eq.stat.minMs;
    if (mn && a < mn) a = mn;
    return a;
  }
  _detail(eq) {
    if (this.live) {
      var anchor = this._detailAnchorMs(eq), vu = this.state.viewUnit || null, self = this;
      var c = this._detailCache[eq.id];
      if (c && (c.anchor !== anchor || c.viewUnit !== vu)) { delete this._detailCache[eq.id]; c = null; } // 기준 시각·표시 물리량 바뀌면 재캡처
      if (!c) {
        // 순수 스냅샷: 캡처 시점의 등급·RMS·기준시각을 함께 고정 → 재캡처 전까지 상세분석 전체가 불변
        c = this._detailCache[eq.id] = { state: 'loading', det: emptyDet(eq), eqSnap: Object.assign({}, eq), snapNow: (this.data && this.data.now) || Date.now(), anchor: anchor, viewUnit: vu };
        liveDetail(this.E, eq, anchor, vu).then(function (det) {
          c.det = det; c.state = 'ready';
          if (det.raw && !det.raw.values.length) self._toast('선택 구간에 원시 파형이 없습니다 · 마지막 수집 ' + (eq.lastSeen ? self.E.fmtDT(eq.lastSeen) : '-'), 'warn');
          self.forceUpdate();
        }).catch(function (e) { c.state = 'error'; self._toast('상세분석 조회 실패 — 네트워크·DB 상태 확인 후 새로고침하세요', 'err'); self.forceUpdate(); console.warn('[vibe] detail load failed', e); });
      }
      return c.det;
    }
    return emptyDet(eq);
  }
  _forecast(eq) { return { crossMs: null }; } // 예측 기능 제외 확정
  _trends(eq, roll) {
    if (this.live) {
      // 라이브: 트렌드 구간을 등분한 원시 청크 샘플링(첨도·대역에너지) — 비동기 로드 후 재드로우
      if (!this._trCacheL) this._trCacheL = {};
      var key = eq.id + ':' + (roll.length ? roll[0].ms + '-' + roll[roll.length - 1].ms : '0');
      var c = this._trCacheL[key], self = this;
      if (!c) {
        c = this._trCacheL[key] = { kurt: [], bands: [], xLabels: [], xTips: [], state: 'loading' };
        loadTrendChunks(this.E, eq, roll).then(function (tr) {
          Object.assign(c, tr, { state: 'ready' });
          self._scheduleDraw();
        }).catch(function (e) { c.state = 'error'; console.warn('[vibe] trend chunks failed', e); });
      }
      return c;
    }
    return { kurt: [], bands: [], xLabels: [] };
  }
  // 조회 기간 → 롤업 창(시작·종료·단위) 계산. 구간 길이에 맞춰 버킷 단위를 골라 과다 버킷을 막는다.
  _rollWindow(now, st, scope) {
    var S = this.state, rep = scope === 'report'; // 상세분석과 리포트는 조회 기간이 서로 독립
    var p = (rep ? S.genPeriod : S.period) || '1h';
    var fromMs, toMs = now;
    if (p === 'all') {
      fromMs = (st && st.minMs) ? st.minMs : now - PERIOD_H['7d'] * 3600000; // 데이터 전 구간
    } else if (p === 'custom') {
      // 직접 입력은 날짜+시각(datetime) — 짧은 창을 정확히 지정해 초 단위 해상도까지 볼 수 있다
      /* 리포트는 적용 전 초안도 인정한다 — 날짜를 고르고 '적용'을 누르지 않은 채 생성하면
         화면에 보이는 것과 다른 구간으로 리포트가 나가기 때문이다. 상세분석은 커밋값만 쓴다
         (조회 캐시 키가 커밋값이라, 초안을 섞으면 키와 내용이 어긋난다). */
      var cf = Date.parse(rep ? (S.genFromD != null ? S.genFromD : S.genFrom) : S.from);
      var ct = Date.parse(rep ? (S.genToD != null ? S.genToD : S.genTo) : S.to);
      fromMs = !isNaN(cf) ? cf : now - PERIOD_H['7d'] * 3600000;
      if (!isNaN(ct)) toMs = ct;
    } else fromMs = now - (PERIOD_H[p] || 1) * 3600000;
    if (!(toMs > fromMs)) fromMs = toMs - 3600000;
    // 단위 사다리 — 각 티어의 버킷 수 상한을 묶어 DB·렌더 비용을 일정하게 유지 (구간이 아무리 길어도 상한 안)
    //   ~2시간 초별(≤7,200) / ~5일 분별(≤7,200) / ~1년 시간별(≤8,760) / ~10년 일별(≤3,650) / 그 이상 월별(100년=1,200)
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
  // 렌더용 동기 래퍼 — 기간별로 캐시하고, 없으면 비동기 조회 후 재드로우 (부팅 프리로드 슬라이스 대신 실조회)
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
  // detIn: 이미 계산된 상세(리포트는 리포트 기간 끝을 앵커로 쓴다). 넘기지 않으면 화면 기준으로 다시 찾는데,
  // 그 경우 앵커가 달라져 _detail이 캐시를 버리고 emptyDet을 돌려주므로 판정이 통째로 빈 데이터 위에서 나온다.
  _dx(eq, detIn) { return this._dxLive(eq, detIn); }
  // 라이브 진단: FFT 지배 주파수를 1×/2×/베어링 결함 주파수와 대조하는 규칙 판정
  _dxLive(eq, detIn) {
    var E = this.E, det = detIn || this._detail(eq), g = E.STATUS[eq.grade];
    var ev = [], verdict, fr = eq.rpm / 60;
    var bf = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
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
    // 규칙 패턴(동기 하모닉)으로 원인이 안 잡혀도 "원인 미상"으로 끝내지 않고 근거 강도 1순위를 채택 — 상단 판정과 아래 근거표의 정합성
    var evx = det.fft.freqs.length ? this._evidence(eq, det) : null;
    if (!cause && evx) {
      var t = evx.top;
      if (t && t.score >= 55) {
        if (/베어링/.test(t.f)) cause = '베어링 충격성 의심' + (evx.hasBearing ? '' : ' (베어링 형식 미지정 — 확정 불가)');
        else if (/벨트|Sub-sync/.test(t.f)) cause = '비동기·sub-synchronous 성분 의심 (벨트·오일훨 등)';
        else if (/풀림/.test(t.f)) cause = '기계적 풀림 의심';
        else if (/정렬/.test(t.f)) cause = '축 정렬 불량 의심';
        else if (/불평형/.test(t.f)) cause = '질량 불평형 의심';
      }
    }
    if (eq.grade === 0) verdict = '뚜렷한 결함 징후 없음 — 정상 운전';
    else verdict = (cause || '이상 진동 — 다축 정밀 측정 권장') + ' — ' + (eq.grade >= 3 ? '심각 단계' : eq.grade === 2 ? '진행 단계' : '초기 징후');
    // 계측 게이트: 계측 문제로 보이는 파형은 결함이 아닐 수 있음 — 진단보다 검증이 먼저.
    // 사유를 문구에 넣는다(클리핑·DC·스파이크는 값이 틀리는 방향이 서로 다르다).
    var _gr = VC.gateReason(det.quality, null);
    if (_gr) verdict = '계측 검증 필요(' + _gr.label + ') — 결함 진단 보류 · 센서·케이블·마운팅 점검';
    var acts = this._buildActions(eq, det, dom, cause, evx);
    return {
      verdict: verdict,
      sub: (eq.alias || eq.name) + ' · ' + (eq.bearing && eq.bearing.n ? '베어링 ' + eq.bearing.model : '베어링 미지정') + ' · ' + eq.rpm + ' RPM'
        + (det.frMeas ? '(실측 ' + Math.round(det.frMeas.rpm) + ')' : '')
        + ((det.isoRms != null && eq.unit === 'mm/s') ? ' · ISO Zone ' + ['A', 'B', 'C', 'D'][VC.gradeFor(det.isoRms, eq.zones)] : ''),
      color: g.color, soft: g.soft, gradeKo: g.ko,
      evidence: ev,
      actions: acts.map(function (t, i) { return { no: (i + 1) + '.', txt: t }; }),
    };
  }
  // 증거 기반 권고 — 진단 결과(원인·지배주파수·지표·추세)에서 조치 생성. 등급 고정 템플릿 대신 실제 정황 인용.
  // 정상에 가까울수록 붙일 증거가 없어 항목이 줄어든다(양호 등급이면 유지 1줄).
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
    // 계측 게이트 — 진단 전에 계측을 의심하라: 스파이크성 신호면 검증이 1순위
    if (gate) a.push('계측 검증 우선 — 극단 Crest/첨도는 스파이크성 잡음(ESD·케이블·접촉) 시그니처와 구분 불가. 센서 마운팅·케이블·커넥터 점검 후 재측정');
    var isoOk = det.isoRms != null && eq.unit === 'mm/s';
    var jg = isoOk ? VC.gradeFor(det.isoRms, eq.zones) : eq.grade;
    var jSrc = isoOk ? 'ISO 대역제한 판정' : '심각도 판정 RMS';
    /* 게이트가 켜져 있으면 "기계 상태" 조치를 일절 내지 않는다 — 결함 지목뿐 아니라 존 기반 권고도.
       헤드라인이 "진단 보류"인데 아래에 "다음 정기 점검 시 확인"이 있으면, 정비팀은 조치 목록만 보고
       점검 일정에 넣고 끝낸다. 센서는 아무도 안 본다. 게이트는 전역 상태다(R6). */
    if (gate) {
      // 메타데이터 입력은 "확정 불가" 후보 대부분을 푸는 유일한 조치다 — 목록 상한에 잘리지 않도록 앞으로 올린다.
      // 문구는 근거표가 이미 알고 있는 막힌 사유에서 만든다 — "무엇을 채우면 무엇이 열리는지"가 1:1로 붙어야 실행된다.
      a.push(this._metaAction(evx));
      a.push('재측정 시 취득 조건 상향: 8초 창 · 0.125 Hz 분해능 · Hanning 50% 중첩 · 8회 평균(측대역·저주파 진단 조건)');
      if (tr && tr.pct > 10) a.push('추세는 계측 검증 후 재평가 — 스파이크성 신호가 섞이면 RMS 추세 자체가 왜곡됨');
      // 존 판정은 "보류 중"임을 밝히고 값만 참고로 넘긴다 — 지금 조치를 정하는 근거로 쓰면 안 된다
      a.push('계측 검증 후 존 판정 재평가 — 현재 관측값은 ' + (isoOk ? this.E.fmt(det.isoRms) + ' ' + eq.unit + '(' + ['양호', '주의', '위험', '심각'][jg] + ' 수준)' : this.E.STATUS[jg].ko) + '이나 아티팩트가 섞여 있어 상한값입니다');
      return a.slice(0, 5);
    }
    // 시급성은 규격 판정(ISO 대역제한) 기준. 광대역 감시 등급이 더 높으면 그 사실만 따로 적는다
    // — 순간·광대역 값으로 "위험 설비"를 선언하면 거짓 경보가 되고, 다음 진짜 경보가 무시된다.
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
    // 증상별 (충격성 — 밴드 커토시스 우선)
    // 샘플레이트가 결함주파수를 못 따라가면 "포락선 분석하라"가 실행 불가능한 조치가 된다 —
    // 그럴 땐 분석이 아니라 계측 사양부터 올려야 한다.
    if (impulsive) {
      var _bf = (eq.bearing && eq.bearing.n > 0) ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
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
    // 메타데이터 부재는 게이트 유무와 무관하게 후보를 '측정 불가'로 만든다 — 무엇을 채우면 닫히는지 항상 안내
    if (!hasBearing || (evx && evx.unmeasurable && evx.unmeasurable.length)) a.push(this._metaAction(evx));
    // 지배 주파수 불일치 (패턴도 못 잡은 경우만)
    if (dom && !dom.hit && !cause && eq.grade >= 1) a.push('지배 주파수 ' + dom.domF.toFixed(1) + ' Hz가 1×/2×·베어링 주파수와 불일치 — 비동기 성분(유체·구조 공진 등) 확인');
    return a.slice(0, 5);
  }
  // 근거표의 "측정 불가" 사유 → 무엇을 입력하면 어느 후보가 열리는지로 변환.
  // 근거표와 권고가 따로 놀면 "막힌 건 아는데 뭘 해야 하는지 모르는" 리포트가 된다.
  _metaAction(evx) {
    var NEED = [
      { re: /품번/, item: '베어링 품번', opens: '베어링' },
      { re: /날개수/, item: '임펠러 날개수', opens: '베인/블레이드 통과' },
      { re: /계통주파수/, item: '계통주파수', opens: '전기적' },
      { re: /벨트 제원|풀리경/, item: '벨트 제원(풀리경·벨트길이)', opens: '벨트·풀리' },
      { re: /위상|축방향/, item: '위상·축방향 측정', opens: '불평형·정렬불량' },
    ];
    // evx.unmeasurable은 이름 문자열 배열이라 사유가 없다 — 사유는 conf[].caveat에 있다
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
    delete this._detailCache[id]; this._rfCache = {}; // 열 때 그 순간의 신선한 스냅샷(파형·추세 모두)을 잡도록 캐시 무효화
    var patch = { tab: 'detail', selTag: id, dxAiText: null, dxOpen: false, detailAnchor: atMs || null };
    if (atMs) { // 이벤트 시점 보기 — 그 시각 앞뒤 30분을 직접 입력 구간으로(초 단위 해상도), 스펙트럼은 그 시각에 고정
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
  // 트렌드 버킷의 실제 시간 범위 텍스트 — 폴백 캡 등으로 요청 기간과 다를 수 있어 실구간을 보여준다
  // 선택한 조회 기간 전체를 구간으로 표시 (데이터가 그보다 좁은지는 차트의 빈 구간으로 드러난다)
  _rangeText(roll, fallback, win) {
    var E = this.E;
    if (win && win.fromMs && win.toMs) return E.fmtDT(win.fromMs) + ' ~ ' + E.fmtDT(win.toMs);
    if (!roll || !roll.length) return fallback;
    return E.fmtDT(roll[0].ms) + ' ~ ' + E.fmtDT(roll[roll.length - 1].ms);
  }
  // 설비 정보 미설정 여부 — 하나도 지정이 없으면 true(전부 기본값으로 도는 중)
  // 마운팅은 포함하되 구동·날개수는 뺀다: 해당 없는 설비가 많아 전부 넣으면 점이 안 꺼져 잔소리가 된다.
  _equipUnset(id) {
    var S = this.state;
    return !((S.equipCls || {})[id] || (S.equipRpm || {})[id] || (S.equipBearing || {})[id] || (S.equipUnit || {})[id]
      || ((S.equipMeta || {})[id] || {}).mount);
  }
  _llmCfg() {
    var S = this.state;
    return { provider: S.llmProvider, apiKey: (S.llmKeys || {})[S.llmProvider] || '', model: (S.llmModels || {})[S.llmProvider] || '', baseURL: S.ollamaUrl };
  }
  // 실제 호출될 프로바이더·모델 표시 문자열 — 모델 미입력 시 기본값임을 병기
  _llmLabel() {
    var S = this.state, names = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama' };
    if (!names[S.llmProvider]) return '';
    return names[S.llmProvider] + ' · ' + this._llmModelText();
  }
  _llmModelText() {
    var S = this.state, typed = (S.llmModels || {})[S.llmProvider] || '';
    var m = LLM.activeModel(this._llmCfg());
    return m ? m + (typed ? '' : ' (기본값)') : '';
  }
  // 사용 가능한 프로바이더 = 키가 저장된 것 (ollama는 키가 없으므로 모델 입력 또는 현재 선택 시 포함)
  _llmProviders() {
    var S = this.state, keys = S.llmKeys || {};
    return ['claude', 'openai', 'gemini', 'ollama'].filter(function (p) {
      if (p === 'ollama') return !!(S.llmModels || {}).ollama || S.llmProvider === 'ollama';
      return !!keys[p];
    });
  }
  // 리포트/상세분석의 프로바이더 드롭다운 — 즉시 적용·즉시 저장, 이전 프로바이더의 소견·테스트 상태는 무효화
  _pickLlmProvider(p) {
    var self = this;
    if (!p || p === this.state.llmProvider) return;
    this.setState({ llmProvider: p, llmConfigured: false, llmTest: null, dxAiText: null });
    setTimeout(function () { self._persistCfg(); }, 0);
  }
  /* ---- LLM 소견: 상세분석 전 차트의 실측값을 데이터팩으로 묶어 전문가 리포트 생성 ---- */
  // FFT 상위 피크(로컬 최대) N개 — 진폭 내림차순
  _topPeaks(freqs, mags, n) {
    var peaks = [], i;
    for (i = 1; i < freqs.length - 1; i++) if (mags[i] > mags[i - 1] && mags[i] >= mags[i + 1]) peaks.push({ f: freqs[i], m: mags[i] });
    if (!peaks.length && freqs.length) { var mi = 0; for (i = 0; i < mags.length; i++) if (mags[i] > mags[mi]) mi = i; peaks.push({ f: freqs[mi], m: mags[mi] }); }
    peaks.sort(function (a, b) { return b.m - a.m; });
    /* 인접 빈 병합 — 국소 최대 판정만으로는 잡음이 섞인 스펙트럼에서 한 성분의 주엽 안에
       최대가 두 번 설 수 있다(오르내림이 미세하게 반복될 때). 그러면 같은 성분이 두 개로 세어져
       "비동기 N개" 다중성과 미설명 성분 목록이 부풀어 진짜 성분이 묻힌다.
       분리 기준은 Hann 창 주엽 폭(≈4빈)보다 좁은 3빈 — 그보다 가까우면 같은 성분으로 본다.
       (Welch 평균으로 매끄러운 스펙트럼에서는 대개 발동하지 않는 방어적 가드다.) */
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
  // 상세분석 전 차트/지표의 실측값을 한 덩어리 텍스트로 (LLM 근거용)
  // 구조화 근거(Evidence) — LLM이 숫자를 직접 해석하는 대신 "이미 분류·정리된 feature"를 받게 한다.
  // 동기/비동기 분류 + 라벨된 지표 + 규칙 기반 결함별 근거 강도(★, 임의 % 방지). 반환 { block, conf }
  _evidence(eq, det) {
    var self = this, E = this.E, u = eq.unit;
    // 1× 기준: 명판 RPM은 동기속도(슬립 미반영)라 스펙트럼 실측 피크가 있으면 그것을 차수 기준으로 쓴다
    var frNom = eq.rpm / 60, frM = det.frMeas, fr = (frM && frM.f) || frNom;
    var gate = !!(det.quality && det.quality.gate); // 계측 아티팩트 게이트 — 스파이크성 신호면 진단 보류
    var star = function (s) { s = Math.max(0, Math.min(5, Math.round(s))); return '★★★★★'.slice(0, s) + '☆☆☆☆☆'.slice(0, 5 - s); };
    // 1) 피크 동기/비동기 분류 — 차수 해석은 Welch 평균 스펙트럼(고분해능·블록 평균) 기준.
    //    표시용 서버 FFT는 단일 블록이라 충격성 신호에서 피크 진폭이 스파이크에 좌우된다.
    var spec = (det.ordSpec && det.ordSpec.freqs.length) ? det.ordSpec : det.fft;
    var peaks = (spec && spec.freqs.length) ? this._topPeaks(spec.freqs, spec.mags, 6) : [];
    // 동기 판정은 절대 오차가 아니라 상대 오차 — 절대값(±0.06)이면 1×는 ±6%로 헐겁고 6×는 ±1%로 빡빡해진다
    var ordTol = function (r) { return Math.max(0.01 * r, (spec && spec.res ? spec.res : 1) / (fr || 1)); };
    var cls = function (f) { if (!(fr > 0)) return { o: 0, sync: false, r: 0 }; var o = f / fr, r = Math.round(o); return { o: o, sync: r >= 1 && Math.abs(o - r) <= ordTol(r), r: r }; };
    var syncP = [], asyncP = [];
    peaks.forEach(function (p) { var c = cls(p.f); (c.sync ? syncP : asyncP).push({ f: p.f, o: c.o, r: c.r, m: p.m }); });
    var domO = peaks.length && fr > 0 ? peaks[0].f / fr : 0, domSync = peaks.length ? cls(peaks[0].f).sync : false;
    var domSub = domO > 0.4 && domO < 0.9, subAny = asyncP.some(function (p) { return p.o > 0.4 && p.o < 0.9; });
    var pk = function (a) { return a.map(function (p) { return p.f.toFixed(1) + 'Hz(' + p.o.toFixed(2) + '×)'; }).join(', ') || '없음'; };
    // 지배 피크가 아니어도 1×·2× 성분이 스펙트럼에 존재하는지 — "동기 피크 없음" 오해 방지("30Hz 있는데?")
    var peakMag = 0, i0; for (i0 = 0; i0 < (spec ? spec.mags.length : 0); i0++) if (spec.mags[i0] > peakMag) peakMag = spec.mags[i0];
    // 매칭 허용오차는 참조 규칙대로 ±1%(최소 분해능 1.5빈) — 3~4%는 우연 일치를 대량 생산한다
    var sRes = (spec && spec.res) || 1;
    var sResTrue = (spec && spec.resTrue) || sRes;   // 제로패딩 전 = 창 길이가 정하는 실제 분해능(불확도·측대역 판정 근거)
    var magNear = function (f) { if (!(f > 0) || !spec) return 0; var tol = Math.max(1.5 * sRes, f * 0.01), b = 0, i; for (i = 0; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - f) <= tol && spec.mags[i] > b) b = spec.mags[i]; return b; };
    var has1x = magNear(fr) > peakMag * 0.05, has2xE = magNear(2 * fr) > peakMag * 0.05;
    // 동기 피크 표기: 지배 피크에 정수배가 없더라도 1×·2× 성분이 있으면 "존재하나 비지배"로 (관측되지 않음과 구분)
    var syncTxt = syncP.length ? pk(syncP) : ((has1x || has2xE) ? '지배 피크 중 없음 · 1×' + (has2xE ? '·2×' : '') + ' 성분은 존재하나 지배적이지 않음' : '관측되지 않음');
    // 2) 대역 분배 — ISO 판정과 "같은 방법(대역제한 RMS)·같은 시계열"에서 뽑은 값만 쓴다.
    //    에너지 비율이므로 선형 합이 아니라 제곱합으로 정규화한다(RMS를 그냥 더하면 비율이 틀어진다).
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
    // 4) 포락선 ↔ 결함주파수 대조. 매칭(+하모닉 2개) 없이는 베어링 가점 불가 — 미매칭은 반대 증거.
    var bf = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    var bm = det.bearMatch || VC.bearingMatch(det.envQ, bf, fr);
    var envLine = !bm.known ? 'BPFO/BPFI/BSF/FTF 미상 (베어링 품번 미지정 — 대조 자체가 불가. 반복 성분이 있어도 베어링 근거로 쓸 수 없음)'
      : bm.hit ? '포락선 반복이 ' + bm.hit.key + '(' + bm.hit.freq.toFixed(1) + ' Hz)와 일치 — 오차 ' + bm.hit.relPct.toFixed(1) + '% · 하모닉 ' + bm.hit.harm + '개' + (bm.hit.sbValid ? ' · ' + bm.hit.sbValid : '')
        : bm.weak ? bm.weak.key + '(' + bm.weak.freq.toFixed(1) + ' Hz)에 근접하나 하모닉 ' + bm.weak.harm + '개 — 우연 일치와 구분 불가(가점 없음)'
          : '결함주파수 전부 미검출: ' + bm.negatives.join('/') + ' — 음성 소견(반대 증거)';
    // 5) 결함별 근거 강도 (규칙 기반) — 각 근거의 가점(0~100)을 누적해 투명 점수화. tags=점수를 만든 근거, s=★(0~5)
    var has2x = syncP.some(function (p) { return Math.abs(p.o - 2) < 0.1; });
    var mk = function (f, parts, caveat) { // parts: [[조건, 점수, 태그]…]
      var sc = 0, tags = [], bd = []; parts.forEach(function (p) { if (p[0]) { sc += p[1]; tags.push(p[2]); bd.push(p[2] + ' +' + p[1]); } });
      sc = Math.max(0, Math.min(100, sc));
      // 0점은 "가능성 전무"로 오해됨 — 실제는 근거 부족. 태그 없으면 그 취지를 명시.
      // breakdown = 점수를 만든 가점 내역(설명 가능한 AI) · caveat = 확정 제약(예: 베어링 미지정)
      return { f: f, score: sc, s: Math.round(sc / 20), tags: tags, caveat: caveat || '',
        breakdown: bd.length ? bd.join(' · ') + ' = ' + sc : '현재 근거 부족',
        why: (tags.length ? tags.join('·') : '현재 근거 부족') + (caveat ? ' · ' + caveat : '') };
    };
    // 임펄스성 = SK·Kurtosis·Crest가 모두 반영하는 "하나의 관측" — 중복 가점 대신 최댓값 기반 단일항(상한 40)
    var impScore = sk > 20 ? 40 : sk > 8 ? 25 : (kurtW > 10 || bk > 10) ? 18 : (kurtW > 4 || bk > 4 || crestW > 5) ? 12 : 0;
    var impTag = '임펄스성(단일항: SK ' + sk.toFixed(0) + '·Kurt ' + kurtW.toFixed(0) + '·Crest ' + crestW.toFixed(1) + ' 중 최강 기준)';
    // 포락선 반복성 — 반복 충격의 존재. 단, "무엇의" 결함인지는 결함주파수 매칭이 있어야 말할 수 있다.
    var eQ = det.envQ, envRep = !!(eQ && eQ.consistent), envTxt = eQ && eQ.f0 > 0 ? eQ.f0.toFixed(1) + 'Hz(' + eQ.order.toFixed(2) + '×)·하모닉 ' + eQ.harm + '개' : '';
    var matched = !!(bm && bm.hit); // 결함주파수 매칭 + 하모닉 2개 — 베어링 가점의 유일한 근거
    // 계측 구성·메타데이터 유무 — 판별 가능성을 정하는 값이라 후보 정의보다 먼저 선언한다
    var hasPhase = false, hasAxial = false;            // 단채널 1방향(위상·타코·축방향 없음)
    var meta = eq.meta || {};
    var nVanes = Number(meta.vanes) || 0, hasVanes = nVanes > 0;
    var lineHz = Number(meta.lineHz) || 60, hasLineHz = true; // 전역 설정값(기본 60)
    // 벨트는 풀리경 두 개면 종동축 1×가 나온다. 벨트 통과주파수까지 보려면 벨트길이가 더 필요.
    var beltF = meta.drive === 'belt' ? VC.beltFreqs(fr, meta.belt) : null;
    var hasBeltSpec = !!beltF, hasBeltLen = !!(beltF && beltF.belt > 0);
    // 차수비 사전 — 좁은 5종으로는 이 데이터의 유력 가설(오일훨·베인패스·종동축 등)을 표현할 수 없다.
    var ordHit = function (lo, hi) { return peaks.some(function (p) { return fr > 0 && p.f / fr >= lo && p.f / fr <= hi; }); };
    var domOil = domO >= 0.38 && domO <= 0.48, anyOil = ordHit(0.38, 0.48);
    // 특정 주파수 "자신의" 하모닉 개수 — 벨트/기어 판정은 그 주파수의 하모닉 열이 근거여야 한다(남의 하모닉 차용 금지).
    // 유의 임계는 노이즈 플로어 오검출 방지용으로 max(피크 8%, 중앙값 4배).
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
    // 전기적 결함의 정통 성분은 2×계통주파수 — 계통을 알면 한쪽(120Hz)만 보고, 반대쪽 오검출이 사라진다
    var elecF = 2 * lineHz;
    var elec = peaks.some(function (p) { return Math.abs(p.f - elecF) < Math.max(1.5, elecF * 0.01); });
    // 베인 통과 = #날개 × 1×. 날개수를 알면 그 차수만 본다 — 모르면 "3× 이상 정수배 관측"까지가 한계다.
    /* 기어 메시 — 잇수 × 1×. 베인 통과와 계산식은 같지만 진단이 다르다:
       메시 주파수만 있는 것은 정상 기어에서도 늘 보이는 성분이고, 결함 근거가 되려면
       1× 간격 측대역이 함께 있어야 한다(치면 손상이 회전마다 하중을 변조하기 때문).
       그래서 measTooth(구동방식이 기어일 때만) + 측대역 확인을 둘 다 요구한다. */
    var isGear = meta.drive === 'gear';
    var meshF = (isGear && nVanes > 0) ? nVanes * fr : 0;
    var meshHit = meshF > 0 ? peaks.filter(function (p) { return Math.abs(p.f - meshF) <= ordTol(nVanes) * fr; })[0] : null;
    // 메시 ±1× 측대역 — 스펙트럼에서 직접 확인한다(포락선 측대역과 다른 축)
    var meshSb = 0;
    if (meshHit && fr > 0) {
      [-1, 1].forEach(function (s) { if (magNear(meshF + s * fr) > harmThr) meshSb++; });
    }
    var vaneF = hasVanes ? nVanes * fr : 0;
    var vane = hasVanes
      ? peaks.some(function (p) { return vaneF > 0 && Math.abs(p.f - vaneF) <= ordTol(nVanes) * fr; })
      : peaks.some(function (p) { var o = p.f / fr, r = Math.round(o); return fr > 0 && r >= 3 && Math.abs(o - r) <= ordTol(r); });
    // 벨트 대조 — 종동축 1×(풀리비)와 벨트 통과주파수. 둘 다 fr 기준 절대주파수로 비교한다.
    var beltTol = fr > 0 ? ordTol(1) * fr : 0;
    var drivenHit = beltF ? peaks.filter(function (p) { return Math.abs(p.f - beltF.driven) <= Math.max(beltTol, beltF.driven * 0.02); })[0] : null;
    var beltHit = (beltF && beltF.belt > 0) ? peaks.filter(function (p) { return Math.abs(p.f - beltF.belt) <= Math.max(beltTol, beltF.belt * 0.02); })[0] : null;
    var drivenHarm = drivenHit ? harmOf(drivenHit.f) : 0;
    // 지배 비동기 피크가 곧 종동축이면 "정체 미상"이 아니다 — 귀속이 닫힌다
    var domIsDriven = !!(beltF && peaks.length && !domSync
      && Math.abs(peaks[0].f - beltF.driven) <= Math.max(beltTol, beltF.driven * 0.02));
    var conf = [
      mk('불평형(Imbalance)', [[domSync && Math.abs(domO - 1) < 0.1, 55, '1× 동기 지배'], [Math.abs(domO - 1) < 0.1 && frac(0) > 0.5, 30, '1× 대역 우세']]),
      mk('정렬불량(Misalignment)', [[has2x, 40, '2× 동기 성분'], [has2x && frac(1) > 0.4, 30, '결함대역 우세']]),
      mk('기계적 풀림(Looseness)', [[domSync && syncP.length >= 3, 55, '정수배 하모닉 다수'], [domSync && syncP.length === 2, 25, '하모닉 일부'], [domSync && subAny, 15, 'subharmonic']], domSync ? '' : '비동기 지배 — 하모닉 근거 약함'),
      mk('베어링(Bearing)', [[matched, 45, bm.hit ? bm.hit.key + ' 일치(오차 ' + bm.hit.relPct.toFixed(1) + '%)·하모닉 ' + bm.hit.harm + '개' : ''],
        [matched && !!(bm.hit && bm.hit.sbValid), 10, bm.hit && bm.hit.sbValid],
        [matched && impScore > 0, Math.min(25, impScore), '임펄스성 보강(매칭 확인 후)']],
        !bm.known ? '베어링 품번 미지정 — 결함주파수 대조 불가라 원리상 귀속 불가'
          : (!matched ? '결함주파수 미매칭 — 반대 증거(' + (bm.weak ? bm.weak.key + ' 근접하나 하모닉 부족' : bm.negatives.join('/') + ' 미검출') + ')' : '')),
      // 벨트도 베어링과 같은 규칙을 받는다 — 벨트 제원이 없으면 벨트주파수 대조가 불가하므로 별도 후보로
      // 점수를 주지 않고, 아래 "종동축·인접 회전원"이 그 관측(비동기 기본파+자체 하모닉)을 대표한다.
      // 한쪽만 면제하면 같은 관측에서 두 후보가 1·2위를 차지해 근거 없는 우선순위가 생긴다.
      // 벨트 "결함"의 근거는 벨트 통과주파수뿐이다. 종동축 1× 일치는 벨트가 상했다는 뜻이 아니라
      // 비동기 성분의 정체가 밝혀졌다는 뜻이므로, 아래 독립 회전원 항목의 귀속으로만 쓴다(R3와 같은 원칙).
      /* ⚠mk의 세 요소(조건·점수·근거문구)는 전부 먼저 계산된다 — 조건이 거짓이어도 문구는 만들어진다.
         그래서 문구도 조건과 같은 것을 확인해야 한다: 벨트길이만 보고 beltHit을 참조하면
         "제원은 있는데 벨트 주파수에 피크가 없는" 설비에서 리포트 생성이 통째로 죽는다. */
      mk('벨트·풀리(Belt)', [[!!beltHit && harmOf(beltHit.f) >= 2, 35, (beltHit && hasBeltLen) ? '벨트 통과주파수 ' + beltF.belt.toFixed(1) + 'Hz 일치 · 하모닉 ' + harmOf(beltHit.f) + '개' : ''],
        [!!beltHit && harmOf(beltHit.f) < 2, 12, '벨트 통과주파수 근처 성분(하모닉 부족)']],
        !hasBeltSpec ? '벨트 제원(풀리경) 미입력 — 벨트주파수 대조 불가'
          : (!hasBeltLen ? '벨트길이 미입력 — 벨트 통과주파수 대조 불가(풀리비로 종동축만 대조됨)' : '')),
      // FTF=(n/2)(1−(d/D)cosα)이고 구름베어링 d/D는 대부분 0.15~0.25 → FTF는 품번을 몰라도 0.35~0.45×에 갇힌다.
      // 베어링을 통째로 '측정 불가'로 돌리면 품번 없이도 가능한 이 판정까지 버리게 된다.
      mk('케이지 결함(FTF 추정)', [[domO >= 0.35 && domO <= 0.45, 30, '지배 ' + domO.toFixed(2) + '× — FTF 이론 구간(0.35~0.45×, 품번 무관)'], [!(domO >= 0.35 && domO <= 0.45) && ordHit(0.35, 0.45), 12, '0.35~0.45× 성분 관측']], '확정에는 포락선에서 FTF 하모닉 확인 필요 — 가설'),
      mk('오일 훨(Oil whirl)', [[domOil, 45, '지배 ' + domO.toFixed(2) + '× — 오일훨 정통 구간(0.38~0.48×)'], [!domOil && anyOil, 15, '0.38~0.48× 성분 관측']], '유막 베어링 여부·기동정지 추적 필요 — 가설'),
      // 비동기 기본파 + 자체 하모닉 열 = 다른 회전원(벨트 종동축·인접 기계·기어 종동축)의 1×와 그 하모닉.
      // 페르소나 사전: "비정수 비동기 → 종동축(풀리비·기어비)·인접 기계·유막 — 구동 계통도 한 장이면 대부분 닫힌다"
      mk('독립 회전원(종동축·인접 기계)', [[!domSync && domHarm >= 3, 40, '비동기 기본파 ' + (peaks.length ? peaks[0].f.toFixed(1) : '?') + 'Hz(' + domO.toFixed(2) + '×)의 자체 하모닉 ' + domHarm + '개 — 독립 회전원 시그니처(≈' + (peaks.length ? Math.round(peaks[0].f * 60) : 0) + ' rpm)'],
        [!domSync && domHarm === 2, 18, '비동기 기본파의 하모닉 2개'],
        // 풀리비를 알면 이 성분이 "누구인지"가 닫힌다 — 점수가 아니라 귀속이 바뀌는 자리다
        [domIsDriven, 15, beltF ? '벨트 종동축 1× ' + beltF.driven.toFixed(1) + 'Hz(풀리비 ' + beltF.ratio.toFixed(2) + ')와 일치 — 귀속 확정' : '']],
        domIsDriven ? '' : '구동 계통도(풀리비·기어비)·인접 기계 배치 확인 필요 — 이 한 장이면 귀속이 닫힘'),
      mk('베인/블레이드 통과(Vane pass)', [[hasVanes && vane, 35, '#날개 ' + nVanes + ' × 1× = ' + vaneF.toFixed(1) + 'Hz 일치'],
        [!hasVanes && vane, 20, '정수배 3× 이상 성분 관측']],
        hasVanes ? '' : '임펠러 날개수 미입력 — #날개×1× 대조 불가라 확정 불능'),
      // 기어 결함 — 메시 주파수만으로는 정상 기어와 구분되지 않는다. 측대역이 결정 검사다.
      mk('기어 메시(Gear mesh)', [
        [!!meshHit && meshSb >= 2, 40, meshF > 0 ? '메시 ' + meshF.toFixed(1) + 'Hz(잇수 ' + nVanes + '×1×) 일치 · 1× 간격 측대역 양측 확인 — 치면 손상 시그니처' : ''],
        [!!meshHit && meshSb === 1, 20, '메시 주파수 일치 · 측대역 한쪽만 — 확정 부족'],
        [!!meshHit && meshSb === 0, 8, '메시 주파수 관측 · 측대역 없음 — 정상 기어에서도 나타나는 성분'],
      ], (isGear && nVanes > 0) ? '' : '기어 구동·잇수 미입력 — 메시 주파수 대조 불가'),
      mk('전기적(Electrical)', [[elec, 20, elecF.toFixed(0) + ' Hz(2×계통 ' + lineHz + 'Hz) 근처 성분 관측']], '확정에는 전원 차단 시 소멸 시험 필요 — 가설'),
    ];
    // "해당 없음"은 "볼 수 없음"과 다르다 — 직결 기계에 벨트 후보를 "측정 불가"로 남기면
    // 목록만 늘어나고, 정작 계측 구성 때문에 못 보는 항목(불평형·정렬)이 묻힌다. 구성상 없는 건 뺀다.
    if (meta.drive && meta.drive !== 'belt') conf = conf.filter(function (c) { return !/^벨트·풀리/.test(c.f); });
    // 미설명 성분 — 사전 어느 항목으로도 설명되지 않은 비동기 피크. 삭제하지 않고 인쇄한다.
    // (동기 하모닉·오일훨 구간·subharmonic·sub-sync 가설이 집은 성분은 "설명 시도됨"으로 보고 제외)
    var explained = function (o) {
      var r = Math.round(o);
      return (r >= 1 && Math.abs(o - r) <= ordTol(r)) || (o >= 0.38 && o <= 0.48)
        || (Math.abs(o - 0.5) <= ordTol(1)) || (domSub && Math.abs(o - domO) < 0.02);
    };
    var unexplained = asyncP.filter(function (p) { return !explained(p.o); })
      .map(function (p) { return p.f.toFixed(1) + 'Hz(' + p.o.toFixed(2) + '×)'; });
    // 판별 가능성은 "점수"가 아니라 "계측 구성"이 정한다 — 위상·축방향이 없으면 40점이든 12점이든 똑같이
    // 판별 불가다. 점수 임계로 na를 정하면 점수가 높아질수록 "볼 수 없음" 표시가 사라지는 역전이 생긴다.
    // 판별 불가 사유는 두 종류다: ①계측 구성(위상·축방향) ②메타데이터 부재(품번·날개수·계통주파수·벨트제원).
    // 둘 다 "봤는데 아니다"가 아니라 "볼 수 없다"이므로 0점을 주면 안 된다 — 점수를 매기지 않고 사유를 적는다.
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
    // 샘플레이트가 결함주파수 대비 부족하면 "미검출"이 아니라 "측정 불가"다 — 볼 수 없는 것을
    // 못 봤다고 반대 증거로 쓰면 있는 결함을 없다고 말하게 된다(R7).
    var fsOk = VC.bearingFsOk(eq.fs, bf);
    if (!fsOk && bf) {
      var topBf = Math.max(bf.BPFO || 0, bf.BPFI || 0, bf.BSF || 0);
      naIf(function (c) { return /^베어링/.test(c.f); },
        '샘플레이트 부족 — fs ' + self._num(eq.fs) + ' Hz로는 결함주파수 ' + topBf.toFixed(0) + ' Hz의 포락선 복조 불가(최소 '
          + self._num(Math.round(topBf * VC.BEARING_FS_RATIO)) + ' Hz 필요)');
    }
    naIf(function (c) { return /^베인/.test(c.f) && !hasVanes; }, '임펠러 날개수 미입력 — #날개×1× 대조 불가');
    // 기어는 "구동방식=기어 + 잇수" 둘 다 있어야 대조 가능. 구동방식이 기어가 아니면 해당 없음이라 후보에서 뺀다.
    naIf(function (c) { return /^기어 메시/.test(c.f) && !(isGear && nVanes > 0); },
      isGear ? '잇수 미입력 — 메시 주파수(잇수×1×) 대조 불가' : '기어 구동 여부 미입력 — 메시 주파수 대조 불가');
    if (meta.drive && meta.drive !== 'gear') conf = conf.filter(function (c) { return !/^기어 메시/.test(c.f); });
    // 벨트 결함은 벨트 통과주파수로만 판별된다 → 길이가 없으면 풀리경이 있어도 "볼 수 없음"이다.
    // 구동방식이 벨트가 아니라고 입력된 경우는 "해당 없음"이라 후보에서 아예 빼는 게 맞다.
    naIf(function (c) { return /^벨트·풀리/.test(c.f) && !hasBeltLen; },
      meta.drive && meta.drive !== 'belt' ? '벨트 구동이 아님 — 해당 없음'
        : (!hasBeltSpec ? '벨트 제원(풀리경·벨트길이) 미입력 — 벨트주파수 대조 불가' : '벨트길이 미입력 — 벨트 통과주파수 대조 불가'));
    // 계측 게이트는 전역 상태다(R6). 시간영역 단발 임펄스는 주파수영역에서 평탄한 광대역으로 퍼지므로
    // 임펄스성뿐 아니라 모든 스펙트럼 피크의 진폭이 잠정이다 → 특정 후보만 캡하면 미검증 후보가 1위로 올라온다.
    if (gate) {
      conf.forEach(function (c) {
        if (c.na || c.score == null) return;
        if (c.score > GATE_CAP) { c.breakdown += ' → 전역 상한 ' + GATE_CAP + '(계측 게이트)'; c.score = GATE_CAP; }
        c.s = Math.round(c.score / 20);
        // 잠정 표기는 상단 배너에서 한 번만 — 행마다 반복하면 정작 중요한 경고가 묻힌다
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
      /* 평균 횟수 평가는 "규격 숫자에 닿았는가"가 아니라 "이 설비에서 더 평균할 수 있었는가"로 한다.
         규격이 요구하는 것도 정상상태에서의 충분 평균이지 무조건 8회가 아니다 — 정상상태를 벗어난
         구간까지 끌어와 8회를 채우면 서로 다른 운전 상태를 섞어 결과가 오히려 흐려진다.
         그래서 블록간 변동이 작으면 "이 설비의 상한"으로, 크면 그 사실 자체를 경고로 적는다. */
      + (function () {
        var n = acq.averages || 1, sp = (det.ordSpec && det.ordSpec.blockSpread) || 0;
        if (n < 2) return ' — ⚠단일 블록: 충격성 신호에서 어느 스파이크가 걸렸느냐로 진폭이 변합니다';
        if (det.ordSpec && det.ordSpec.trimmed) return ' — 블록간 변동 ×' + sp.toFixed(2) + '으로 정상상태 전제가 흔들려 앞구간만 평균(창 전체를 쓰면 다른 운전 상태가 섞임)';
        if (n >= 8) return '';
        if (sp > 0 && sp < 1.25) return ' — 정상상태(블록간 변동 ×' + sp.toFixed(2) + ') 유지 범위에서의 평균 상한. 더 늘리려면 관측 창을 넓혀야 하는데 이 설비는 그 구간에서 정상상태를 벗어납니다';
        return ' — 평균 8회 미만(측대역·저주파 정밀 진단 기준은 8초 창·0.125 Hz·8평균)';
      })()
      + (acq.isoBlocks ? ' · ISO 판정은 ' + acq.isoBlocks + '블록 에너지 평균' : ''));
    // 실측 회전수는 분해능이 곧 불확도(Δf=1Hz → ±60rpm) — 명판과의 차이가 불확도 안이면 "확정"이 아니다
    B.push('■ 회전수: 명판 ' + eq.rpm + ' RPM(1× ' + frNom.toFixed(1) + ' Hz) · 1× 실측 ' + (frM
      ? frM.f.toFixed(1) + ' ± ' + (frM.tolHz || 0).toFixed(2) + ' Hz (' + Math.round(frM.rpm) + ' ± ' + Math.round(frM.rpmTol || 0) + ' RPM)'
        + (frM.distinct ? ' — 명판과 유의하게 다름, 차수는 실측 기준' : ' — 불확도가 명판과의 차이보다 커서 명판값과 구분 불가(차수 해석 시 이 오차를 감안)')
      : '유의 피크 없음 — 명판 기준 차수(슬립·오차 가능성 유의)'));
    B.push('■ 동기 피크(정수배): ' + syncTxt);
    B.push('■ 비동기 피크(비정수배): ' + pk(asyncP));
    B.push('■ 지배 성분: ' + (domSync ? '동기(정수배)' : '비동기') + ' ' + domO.toFixed(2) + '× · 상위 ' + peaks.length + '개 중 동기 ' + syncP.length + '/비동기 ' + asyncP.length + (domSub ? ' · sub-synchronous 지배' : '') + ((has1x || has2xE) && !syncP.length ? ' (1×·2×는 존재하나 비지배)' : ''));
    B.push('■ 측대역: ' + (eQ && eQ.sb1x ? '포락선에서 1× 간격 측대역 관측(단, 반송파가 결함주파수로 확인돼야 결함 근거가 됨)' : '미검출(주의: 분해능 ' + (sResTrue ? sResTrue.toFixed(2) : '?') + ' Hz라 이보다 좁은 간격은 물리적 부재가 아니라 분해능 한계로 안 보이는 것)') + ' · subharmonic(0.5×류): ' + (subAny ? '있음' : '없음'));
    // 측대역은 반송파가 결함주파수일 때만 근거 — 반송파 미상이면 "관측"까지만 적고 내륜/외륜을 말하지 않는다
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
    // 메타데이터 미입력이 무엇을 무효로 만드는지 선언(0단계) — 없는 항목은 "확정 불가"의 절반을 차지한다
    var missing = [];
    if (!bf) missing.push('베어링 품번(→ BPFO/BPFI/BSF/FTF 대조 불가)');
    if (!det.mount) missing.push('마운팅 방식(→ ' + (det.kurtogram && det.kurtogram.best && det.kurtogram.best.loHz > 2000 ? (det.kurtogram.best.loHz / 1000).toFixed(1) + ' kHz 대역 분석이 자석 마운트면 무효' : '고주파 대역 유효성 미상') + ')');
    missing.push('계측 방향(H/V/A)·위상(→ 불평형·정렬·굽음 판별 불가)');
    if (!meta.drive) missing.push('구동방식(직결/벨트/기어 → 비동기 성분 귀속 불가)');
    else if (meta.drive === 'belt' && !hasBeltLen) missing.push('벨트길이(→ 벨트 통과주파수 대조 불가)');
    if (!hasVanes) missing.push('날개수(→ 베인 통과 확정 불가)');
    B.push(missing.length ? '■ 미입력 메타데이터와 그 영향: ' + missing.join(' · ') : '■ 메타데이터: 필요한 항목 입력 완료 — 위 판정은 계측 구성 한계(단채널·위상 없음)만 남습니다');
    // 결함 대역 탐색 상한이 실제로 대역을 잘랐다면 그 사실 자체가 판정 근거다 — 조용히 자르면 안 된다.
    // 상한은 마운팅과 에일리어싱 두 갈래이며 둘 중 낮은 쪽이 적용된다(서로 독립 조건).
    if (det.kgFmax > 0 || det.mountFmax > 0 || det.aliasFmax > 0) {
      var _cap = [];
      if (det.mountFmax > 0) _cap.push('마운팅(' + det.mount + ') ' + (det.mountFmax / 1000).toFixed(1) + ' kHz');
      if (det.aliasFmax > 0) _cap.push('에일리어싱 의심(f_eff가 Nyquist의 ' + Math.round(det.accelNyqFrac * 100) + '%) ' + (det.aliasFmax / 1000).toFixed(1) + ' kHz');
      B.push('■ 결함 대역 탐색 상한: ' + (_cap.join(' · ') || '없음')
        + (det.kgFmax > 0 ? ' → 적용 ' + (det.kgFmax / 1000).toFixed(1) + ' kHz(' + (det.kgCapSrc === 'alias' ? '에일리어싱' : '마운팅') + ' 기준)' : '')
        + (det.kgCapped ? ' · 그 위 대역은 탐색에서 제외' : ' · 샘플링 상 제외된 대역 없음')
        + (det.kurtogram && det.kurtogram.best ? ' · 선택 대역 ' + (det.kurtogram.best.loHz / 1000).toFixed(1) + '–' + (det.kurtogram.best.hiHz / 1000).toFixed(1) + ' kHz' : ''));
    }
    /* 대역 베이스라인 이탈 — 감시가 이미 아는 관측이다. 여기까지 오지 않으면 리포트는
       "상한 위는 탐색에서 뺐다"고만 말하고 그 자리에서 무엇이 올랐는지는 말하지 못한다.
       위의 대역 분배는 ISO 방법(10–1000 Hz)이라 상한 위 대역이 표에 아예 없다 —
       빼놓고 침묵하면 정비팀은 센서 부착 불량도 베어링 초기 결함도 알 수 없다. */
    var bnow = (this._bandNow || {})[eq.table + ':' + eq.name], bbls = this._bandBaselines(eq);
    var softM = {};
    this._softBands(eq).forEach(function (k) { softM[k] = 1; });
    var bandDev = null;
    if (bnow && bbls) {
      bandDev = [];
      VC.BAND_ORDER.forEach(function (bn) {
        var v = bnow[bn], b = bbls[bn], lim = b ? VC.baselineLimit(b) : 0;
        if (!(v > 0) || !(lim > 0)) return;   // 학습 없음·측정 불가 대역은 비교 자체가 성립하지 않는다
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
    // 음성 소견(R4) — "찾았으나 없었다"는 보고할 결과다
    var negatives = [];
    if (bm.known && !bm.hit) negatives.push('베어링 결함주파수 ' + bm.negatives.join('/') + ' 미검출' + (bm.weak ? '(' + bm.weak.key + ' 근접하나 하모닉 ' + bm.weak.harm + '개로 부족)' : ''));
    if (!syncP.length) negatives.push('지배 피크 중 정수배 동기 성분 없음');
    if (!subAny) negatives.push('0.5× subharmonic 미검출');
    if (!eQ || !eQ.sb1x) negatives.push('포락선 1× 측대역 미검출(단, 분해능 ' + (sResTrue || 0).toFixed(2) + ' Hz 한계 내 — 이보다 좁은 간격은 원리상 관측 불가)');
    else if (!(bm && bm.hit)) negatives.push('측대역은 관측되나 반송파가 결함주파수로 확인되지 않아 결함 귀속 불가');
    if (!elec) negatives.push('100/120 Hz(2×계통주파수) 근처 성분 미검출 — 전기적 결함 정황 없음(전원 차단 시험으로 확정)');
    if (!vane) negatives.push('3× 이상 정수배 성분 미검출 — 베인/블레이드 통과 정황 없음');
    // 기어는 "메시는 있는데 측대역이 없다"가 유의미한 음성 소견이다 — 정상 기어의 모습이기 때문
    if (meshF > 0 && !meshHit) negatives.push('기어 메시 ' + meshF.toFixed(0) + ' Hz(잇수 ' + nVanes + '×1×) 미검출');
    else if (meshHit && meshSb === 0) negatives.push('기어 메시는 관측되나 1× 간격 측대역 없음 — 정상 기어 범위(치면 손상 정황 없음)');
    if (negatives.length) B.push('■ 음성 소견(찾았으나 없음 — 반대 증거): ' + negatives.join(' · '));
    if (unexplained.length) B.push('■ 미설명 성분(사전으로 설명되지 않음 — 삭제하지 않고 남김): ' + unexplained.join(', ') + ' — 구동 계통도(풀리비·기어비)·인접 기계·유막 확인 시 대부분 해소');
    var confLines = conf.map(function (c) {
      return '■ ' + c.f + ' ' + (c.na ? '측정 불가 — 점수 없음(' + (c.caveat || '판별 조건 미충족') + ')' : star(c.s) + ' · 근거점수 ' + c.score + '/100 [' + c.breakdown + ']' + (c.caveat ? ' · ' + c.caveat : ''));
    });
    var unmeasurable = conf.filter(function (c) { return c.na; }).map(function (c) { return c.f; });
    return { block: B.join('\n'), confLines: confLines.join('\n'), conf: conf, top: conf[0], impulsive: impulsive,
      hasBearing: !!bf, domSync: domSync, gate: gate, frMeas: frM,
      // bandDev는 프롬프트뿐 아니라 HTML까지 간다 — 프롬프트에만 넣으면 정비팀이 받는 문서에는 없다
      bandDev: bandDev, mountFmax: det.mountFmax || 0, mount: det.mount || '',
      negatives: negatives, unmeasurable: unmeasurable, unexplained: unexplained, missing: missing, acq: acq };
  }
  // 첨도 포화 판정(첨도 추이+RMS 추이) — 화면 경고·LLM 소견·리포트 공용
  _kurtSat(eq) {
    var rf = this._rollFor(eq), tr = this._trends(eq, rf.roll);
    if (!tr || !tr.kurt || tr.kurt.length < 6) return { flag: false };
    // 관측 구간을 함께 넘긴다 — 첨도 비단조성(말기 확산)은 주·월 단위 추세에서만 성립
    var rl = rf.roll || [], spanMin = rl.length > 1 ? (rl[rl.length - 1].ms - rl[0].ms) / 60000 : 0;
    return VC.kurtosisSaturation(tr.kurt, rl.map(function (r) { return r.rms; }), spanMin);
  }
  _opinionPack(eq, det, sat) {
    var self = this, E = this.E, fr = eq.rpm / 60, u = eq.unit, L = [];
    L.push('[설비] ' + (eq.alias || eq.name) + ' (' + eq.name + ') · ' + eq.rpm + ' RPM (1×=' + fr.toFixed(1) + ' Hz, 2×=' + (2 * fr).toFixed(1) + ' Hz) · ISO Class ' + eq.cls + ' · 단위 ' + u);
    var bf = eq.bearing && eq.bearing.n > 0 ? VC.bearingFreqs(eq.rpm, eq.bearing) : null;
    L.push('[베어링] ' + (bf ? eq.bearing.model + ' · BPFO ' + bf.BPFO.toFixed(1) + ' / BPFI ' + bf.BPFI.toFixed(1) + ' / BSF ' + bf.BSF.toFixed(1) + ' / FTF ' + bf.FTF.toFixed(1) + ' Hz' : '미지정 (결함 주파수 대조 불가)'));
    // ISO 규격 판정(10–1000 Hz 대역제한 속도 RMS)과 실시간 감시(광대역 1초 RMS)는 다른 물리량 — 분리 표기
    var isoOk = det.isoRms != null && u === 'mm/s';
    if (isoOk) {
      var isoG = VC.gradeFor(det.isoRms, eq.zones);
      // R10: 경계 대비 여유가 측정 불확도(단일 블록 ±10% 수준)보다 작으면 단정하지 않는다
      var nearZ = null;
      eq.zones.forEach(function (z, zi) { if (Math.abs(det.isoRms - z) / z < 0.10) nearZ = ['A/B', 'B/C', 'C/D'][zi]; });
      L.push('[ISO 10816 판정 — 규격 기준] 대역제한(10–1000 Hz) 속도 RMS ' + E.fmt(det.isoRms) + ' mm/s(' + (det.isoBlocks || 1) + '블록 에너지 평균 · 총 ' + (det.anaSec ? det.anaSec.toFixed(1) : '?') + '초' + (Math.round((det.isoSpread || 1) * 100) / 100 >= 1.5 ? ' · ⚠블록간 변동 ×' + det.isoSpread.toFixed(2) + ' — 정상상태 전제 미충족, 존 판정 잠정' : ' · 블록간 변동 ×' + (det.isoSpread || 1).toFixed(2)) + ') → Zone ' + ['A(양호)', 'B(주의)', 'C(위험)', 'D(심각)'][isoG] + ' · 존 경계 A/B ' + E.fmt(eq.zones[0]) + ', B/C ' + E.fmt(eq.zones[1]) + ', C/D ' + E.fmt(eq.zones[2]) + ' — ISO 상태 판정은 이 값으로 하세요'
        + (nearZ ? ' ⚠' + nearZ + ' 경계 대비 여유 10% 미만 — 불확도 안이라 존을 단정하지 말고 "경계 근접"으로 쓰고 정상상태 다중 평균 재측정을 권하세요' : ''));
      L.push('[실시간 감시 — 알람 기준(규격 판정 아님)] 광대역 최신 1초 RMS ' + E.fmt(eq.rms) + ' ' + u + ' → 감시 등급 ' + E.STATUS[eq.grade].ko + ' — 고주파 포함 광대역이라 ISO 값보다 클 수 있음. 알람·추세 감시용');
    } else {
      L.push('[현재 심각도] 심각도 판정 RMS = 최신 1초 RMS(현재 시점, 롤업 마지막 버킷) ' + E.fmt(eq.rms) + ' ' + u + ' — 등급을 정하는 값(평균/최대와 별개). 존 경계 A/B ' + E.fmt(eq.zones[0]) + ', B/C ' + E.fmt(eq.zones[1]) + ', C/D ' + E.fmt(eq.zones[2]) + ' ' + u + ' · 등급 ' + E.STATUS[eq.grade].ko);
    }
    if (det.levels) {
      // 가속도는 미분 이득이 f에 비례해 고주파 양자화 잡음을 증폭한다 → 대역 분포로 계산한 물리 상한을
      // 넘으면 "부정확"이 아니라 "불가능"이므로 값을 게재하지 않는다(검산 실패를 조용히 흘리지 않는다).
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
    if (det.quality && !det.quality.ok) L.push('[⚠신호 품질] ' + det.quality.issues.map(function (x) { return x.label; }).join(', ') + ' 감지 — 측정 신뢰도 저하, 아래 판정은 신중히 해석할 것');
    return L.join('\n');
  }
  // 소견 프롬프트 — 판정(검산·결함주파수 매칭·게이트)은 결정론 엔진이 끝냈고, LLM은 "규율 있게 서술"만 한다.
  // 엔진이 넘기는 상태값(gate/iso/monitor/negative/unmeasurable/unexplained/window)이 각 규칙의 근거가 된다.
  _opinionPrompt(eq, det, dx, sat) {
    var E = this.E, ev = this._evidence(eq, det);
    var rl = eq.rollup || [], winMin = rl.length > 1 ? Math.round((rl[rl.length - 1].ms - rl[0].ms) / 60000) : 0;
    var isoOk = det.isoRms != null && eq.unit === 'mm/s';
    var isoZone = isoOk ? ['A(양호)', 'B(주의)', 'C(위험)', 'D(심각)'][VC.gradeFor(det.isoRms, eq.zones)] : '-';
    var S = [];
    S.push('[엔진 판정 상태 — 이 값들은 이미 결정된 결과입니다. 재해석·재계산하지 말고 그대로 인용하세요]');
    S.push('· gate.tripped = ' + (ev.gate ? 'true' : 'false') + (ev.gate ? ' · 사유: 극단 Crest/첨도 — 단발 스파이크 시그니처와 구분 불가(전역 적용)' : ''));
    S.push('· iso = ' + (isoOk ? E.fmt(det.isoRms) + ' mm/s → Zone ' + isoZone + ' (10–1000 Hz 대역제한 속도 RMS · ' + (det.isoBlocks || 1) + '블록 에너지 평균 · 총 ' + (det.anaSec || 0).toFixed(1) + '초 · 블록간 변동 ×' + (det.isoSpread || 1).toFixed(2) + ')' : '산정 불가(센서 단위가 속도가 아님)'));
    S.push('· monitor = ' + E.fmt(eq.rms) + ' ' + eq.unit + ' → 감시 등급 ' + E.STATUS[eq.grade].ko + ' (광대역 최신 1초 RMS · 알람용, 규격 판정 아님)');
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
    var det = this._detail(eq), dx = this._dx(eq, det);
    var p = this._opinionPrompt(eq, det, dx, this._kurtSat(eq));
    llm.complete(p).then(function (txt) { self.setState({ dxAiText: txt || '__fallback__' }); })
      .catch(function (e) { console.warn('[vibe] llm opinion failed', e); self.setState({ dxAiText: '__fallback__' }); self._toast('LLM 소견 생성 실패: ' + (e.message || e), 'err'); });
  }
  _win() {
    if (this.state.period === 'custom') {
      var f = Date.parse(this.state.from), t = Date.parse(this.state.to);
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
    // 추세 차트 x축 범위: 전체 보기면 선택한 조회 기간 전체(데이터 없는 구간은 빈 채로), 줌 중이면 그 구간
    var xWin = function (s, e) {
      var full = s === 0 && e >= roll.length;
      return { xFrom: (full && rf.fromMs) ? rf.fromMs : tMs[s], xTo: (full && rf.toMs) ? rf.toMs : tMs[Math.max(s, e - 1)] };
    };
    var C = function (id) { return document.getElementById(id); };
    /* 확대 구간 승계 키 — 태그·기간·기준시각·표시 물리량이 그대로면 다시 그려도 확대를 유지한다.
       상세분석은 캡처한 스냅샷이라 라이브 틱에 데이터가 바뀌지 않는데, 화면 갱신마다 전체 구간으로
       되돌리면 확대해 놓고 들여다볼 수가 없다(몇 초마다 원래 크기로 돌아간다). */
    var zk = [eq.id, this.state.period, this.state.from, this.state.to, this._detailAnchorMs(eq), this.state.viewUnit || ''].join('|');
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
      // 전대역 토글: 기본은 dispHz까지만 표시, 켜면 전대역(Nyquist)까지. 데이터는 이미 전대역이라 재조회 없음.
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
    // 라이브 트렌드는 청크 샘플 시각축(tr.xLabels), mock은 롤업 시각축(xL)
    var kxl = (tr && tr.xLabels && tr.xLabels.length) ? tr.xLabels : xL;
    var kxt = (tr && tr.xTips && tr.xTips.length) ? tr.xTips : xT;
    // 청크 트렌드도 실제 시각 위치에 배치 — RMS 등과 같은 기간 축을 쓰도록
    var kTs = (tr && tr.times && tr.times.length) ? tr.times : tMs;
    var kWin = function (s, e) {
      var full = s === 0 && e >= kTs.length;
      return { xFrom: (full && rf.fromMs) ? rf.fromMs : kTs[s], xTo: (full && rf.toMs) ? rf.toMs : kTs[Math.max(s, e - 1)] };
    };
    if (kurtC && tr && tr.kurt && tr.kurt.length) {
      var kV = tr.kurt;
      var dk = function (s, e) { var w = kWin(s, e); var r = E.drawLine(kurtC, { values: kV.slice(s, e), times: kTs.slice(s, e), xFrom: w.xFrom, xTo: w.xTo, xLabels: kxl.slice(s, e), tipLabels: kxt.slice(s, e), color: '#fdb532', height: 220, smooth: true, refLines: [{ val: 3, color: '#8a8d99', label: '정상=3' }, { val: 4.5, color: '#e07b39', label: '충격성 경계' }] }, CC); if (r) E.addTip(kurtC, C('vt-kurt'), null, r.pts); };
      E.zoomDraw(kurtC, kV.length, dk, zk);
    }
    var band = bandC;
    // 꺼둔 계열은 그리지도 않는다 — 축 범위도 남은 계열 기준으로 다시 잡혀야 작은 대역이 보인다
    var _hide = this.state.bandHide || {};
    if (tr && tr.bands && tr.bands.length) this._lastBandSeries = tr.bands.map(function (x) { return { key: x.key, label: x.label, color: x.color }; });
    if (band && tr && tr.bands && tr.bands.length && tr.bands[0].vals.length) {
      /* 배수 축 — 각 계열을 자기 베이스라인 한계로 나눈다. 원값은 계열 간 크기가 네 자릿수까지
         벌어져(저주파 0.0016 vs 고주파 0.42) 작은 대역이 바닥에 붙는다. 나누면 전부 무차원이라
         한 축에서 비교되고, ×1 기준선이 곧 판정선이라 "알람은 났는데 차트엔 안 보인다"가 사라진다.
         물리량을 대역마다 다르게 주는 대신 이 길을 택한 이유: 단위를 나누면 축을 공유할 수 없어
         비교가 오히려 더 안 되고, 뭉쳐진 스칼라를 사후 변환하면 대역 중심주파수 가정이 들어간다. */
      var _bl = this._bandBaselines(eq) || {};
      var _norm = !!this.state.bandNorm;
      var bS = tr.bands.filter(function (s) { return !_hide[s.label]; }).map(function (s) {
        if (!_norm) return { label: s.label, color: s.color, vals: s.vals };
        var lim = s.key ? VC.baselineLimit(_bl[s.key]) : 0;
        // 학습이 없는 계열은 나눌 기준이 없다 — 1로 눌러 그리면 "정상"으로 읽히므로 아예 뺀다
        if (!(lim > 0)) return null;
        return { label: s.label, color: s.color, vals: s.vals.map(function (v) { return v == null ? null : v / lim; }) };
      }).filter(Boolean);
      var refs = _norm ? [{ val: 1, color: '#e07b39', label: '알람 기준' }] : null;
      var db = function (s, e) { var w = kWin(s, e); E.drawMultiLine(band, { series: bS.map(function (sr) { return { label: sr.label, color: sr.color, vals: sr.vals.slice(s, e) }; }), times: kTs.slice(s, e), xFrom: w.xFrom, xTo: w.xTo, xLabels: kxl.slice(s, e), height: 220, refLines: refs }, CC); };
      E.zoomDraw(band, kxl.length, db, zk);
    }
  }
  /* 오류는 읽고 조치해야 하는 정보라 더 오래 둔다 — 사유·발생 위치가 실리면 2.6초로는 다 읽지 못한다.
     (성공 알림은 짧게 두어야 화면을 가리지 않는다) */
  _toast(msg, kind) {
    var self = this;
    this.setState({ toast: { msg: msg, kind: kind || 'ok' } });
    clearTimeout(this._tt);
    this._tt = setTimeout(function () { self.setState({ toast: null }); }, kind === 'err' ? 9000 : 2600);
  }
  // 네이티브 날짜·시각 피커는 바깥을 눌러야 닫힌다 — 포커스를 떼는 것이 유일한 프로그램적 닫기 수단
  _closePicker() { try { var a = document.activeElement; if (a && a.blur) a.blur(); } catch (e) {} }
  toggleTheme() { var n = this.state.theme === 'light' ? 'dark' : 'light'; try { localStorage.setItem('vibeTheme', n); } catch (e) {} this.setState({ theme: n }); }
  _setEquipBearing(id, v) { var m = Object.assign({}, this.state.equipBearing); m[id] = v; this.setState({ equipBearing: m }); }
  _setEquipRpm(id, v) { var m = Object.assign({}, this.state.equipRpm); m[id] = v; this.setState({ equipRpm: m }); }
  _toggleEquipAdv(id) { var m = Object.assign({}, this.state.equipAdv); m[id] = !m[id]; this.setState({ equipAdv: m }); }
  _setEquipGeo(id, key, v) { var m = Object.assign({}, this.state.equipGeo); var g = Object.assign({}, m[id]); g[key] = Number(v) || 0; m[id] = g; this.setState({ equipGeo: m }); }
  // 계측·구동 메타 — mount/drive는 문자열, vanes는 수, belt는 하위 객체(d1/d2/len)
  _setEquipMeta(id, key, v) {
    var m = Object.assign({}, this.state.equipMeta), g = Object.assign({}, m[id]);
    if (key === 'vanes') g.vanes = Number(v) || 0;
    else g[key] = v;
    m[id] = g; this.setState({ equipMeta: m, dirty: true });
  }
  _setEquipBelt(id, key, v) {
    var m = Object.assign({}, this.state.equipMeta), g = Object.assign({}, m[id]);
    g.belt = Object.assign({}, g.belt); g.belt[key] = Number(v) || 0;
    m[id] = g; this.setState({ equipMeta: m, dirty: true });
  }
  /* 일괄 적용 — 한 설비의 X/Y/Z 채널은 RPM·베어링·마운팅이 전부 같다. 상한(100태그)까지 한 줄씩
     채우게 두면 같은 값을 수십 번 입력하는 일이 된다. 한 행을 채운 뒤 같은 설비·테이블로 퍼뜨린다. */
  // 같은 설비 추정 — 태그명의 마지막 구분자 앞까지(MOTOR_01_X → MOTOR_01). 구분자가 없으면 빈 문자열
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
  /* 값이 있는 항목만 복사한다 — 원본의 공백까지 옮기면 대상에 이미 채워 둔 값이 조용히 지워진다.
     그래서 패널도 원본에 값이 있는 항목만 내놓는다(뷰모델). */
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
      /* 값 하나가 항목 하나다 — 여럿을 묶으면 대상이 따로 넣어 둔 값이 함께 덮이고,
         칩에도 값이 다 안 들어가 무엇이 복사되는지 안 보인다. */
      var _g = (S.equipGeo || {})[srcId] || {}, gp = null;
      Object.keys(GEO_F).forEach(function (k) {
        if (!fields[k]) return;
        gp = gp || Object.assign({}, geo[id]);
        gp[GEO_F[k]] = _g[GEO_F[k]] || 0;   // 접촉각 0°는 유효값이라 truthy로 거르지 않는다
      });
      if (gp) geo[id] = gp;
      var sm = (S.equipMeta || {})[srcId] || {}, mp = null;
      if (fields.mount && sm.mount) { mp = Object.assign({}, meta[id]); mp.mount = sm.mount; }
      if (fields.drive && sm.drive) { mp = mp || Object.assign({}, meta[id]); mp.drive = sm.drive; }
      if (fields.vanes && sm.vanes > 0) { mp = mp || Object.assign({}, meta[id]); mp.vanes = sm.vanes; }
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
  /* 고를 수 없는 table의 사유 — 없으면 빈 문자열.
     카탈로그는 TYPE=6(TAG)만 보고 전부 올리는데, 이 앱의 조회는 NAME·TIME·VALUE를 그대로 쓴다.
     다른 이름을 쓰는 table은 태그 목록부터 실패하므로, 고르고 저장한 뒤에 실패를 만나는 대신 여기서 막는다.
     스키마를 못 읽었으면(권한·구버전) 막지 않는다 — 모른다고 못 쓰게 하면 되던 것이 안 되는 쪽이 더 나쁘다. */
  _srcBlock(name) {
    var cols = (this.liveSchemas || {})[name];
    if (!cols || cols.length < 3) return '';
    var need = ['NAME', 'TIME', 'VALUE'];
    var ok = need.every(function (k, i) { return String(cols[i] || '').toUpperCase() === k; });
    return ok ? '' : '컬럼 구성 미지원 (' + cols.slice(0, 3).join(' · ') + ') — 이 앱은 NAME · TIME · VALUE만 조회합니다';
  }
  /* 컬럼 구성을 한 번에 읽어 둔다(테이블당 왕복 없음). 실패하면 조용히 넘어가 전부 선택 가능 상태를 유지한다.
     이미 선택돼 있던 미지원 table은 여기서 뺀다 — 남겨두면 매 틱 조회가 실패한다. */
  _loadSchemas() {
    var self = this;
    return tagSchemas().then(function (m) {
      self.liveSchemas = m || {};
      var sel = self.state.srcSel || [];
      var drop = sel.filter(function (t) { return !!self._srcBlock(t); });
      if (drop.length) {
        self.setState({ srcSel: sel.filter(function (t) { return drop.indexOf(t) < 0; }) });
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
      /* 테이블의 태그를 전부 받는다(상한을 크게 넘긴다) — 이 목록은 감시 대상이 아니라
         "이 테이블에 무엇이 있는가"를 보여주는 자리라 감시 상한으로 자르면 안 된다. */
      listTags(tb, 100000).then(function (tags) { self._tagCache[tb] = tags; self.forceUpdate(); }).catch(function () {});
    });
  }
  _activeEqs() { var sel = this.state.srcSel || []; return this.data.equipment.filter(function (e) { return sel.indexOf(e.table) >= 0; }); }
  // 태그 표시 라벨 통일: 별칭 (태그명), 별칭 없으면 태그명만
  _tagLabel(e) { return e.alias && e.alias !== e.name ? e.alias + ' (' + e.name + ')' : e.name; }
  /* 판정값 — RMS 구간의 실효값 하나. 표시·판정·이벤트가 모두 이 값을 쓴다.
     구간을 좁게(1초) 두면 잡음이 그대로 등급을 흔들고, ISO가 요구하는 "정상상태 대표값"이 아니게 된다.
     eq.secBuckets는 판정 틱이 채워 넣는 최근 롤업 버킷들(그 구간 길이만큼).
     아직 안 채워졌으면 eq.rms(최신 1초)로 폴백 — 첫 틱 전이나 조회 실패 시. */
  _evalValue(eq) {
    var r = VC.windowRms(eq.secBuckets);
    return r ? r.rms : eq.rms;
  }
  /* ── ISO 존 판정값 ────────────────────────────────────────────────────────

     ISO 존 경계는 10~1000 Hz 속도 RMS 기준이라, 전대역 값을 대면 다른 양을 재게 된다
     (고주파 에너지가 많은 센서에서 등급이 뒤집힌다).

     그렇다고 매 판정마다 원본을 받아 필터를 돌리면 비싸다. 대신 상한 성질을 쓴다:
     에너지는 더해지기만 하므로 항상 ISO ≤ 전대역이다. 단 비교하는 창을 맞춰야 한다 —
     ISO는 최근 1초에서 재고 판정값은 평가창 전체(기본 10초)의 실효값이라, 평가창 값을
     경계에 대면 조용한 9초 뒤 마지막 1초만 튄 경우를 양호로 확정해 버린다.
     그래서 구간 안 가장 큰 초 버킷을 상한으로 쓴다(isoSkippable).

     경계를 넘은 태그만 1초 원본 + 4차 밴드패스로 정확히 잰다. 결과는 태그당 30초 캐시한다.
     반환 { v, pending } — pending이면 아직 계산 전이라 존 등급을 올리지 않고 직전 값을 유지한다
     (전대역 값으로 대신 판정하면 고치려던 그 헛알람이 그대로 난다). */
  _isoValue(eq, wide) {
    if (!isFinite(wide)) return { v: wide, pending: false, basis: 'wide' };
    // 이 샘플레이트에 1 kHz 위가 없으면 전대역이 곧 ISO 대역이다
    if (!VC.isoNeeded(eq.fs)) return { v: wide, pending: false, basis: 'wide' };   // 1 kHz 위가 없어 전대역이 곧 ISO
    // 구간 안 가장 큰 초 버킷도 경계 아래면 어떤 1초 창의 ISO도 그보다 작다 — 계산 없이 양호 확정
    var key = eq.table + ':' + eq.name;
    if (!this._isoCache) this._isoCache = {};
    var c = this._isoCache[key], now = Date.now();
    /* 알람이 임박했으면 빨리 따라가고(30초), 조용하면 드물게만 갱신한다(5분).
       임박 판단은 두 갈래다 — 전대역이 존 경계를 넘었거나(상한 성질로 양호가 안 깨짐),
       베이스라인 한계를 넘었거나(그 한계는 존 경계보다 낮을 수 있다). */
    var near = !VC.isoSkippable(eq.secBuckets, eq.zones[0]) || this._alarmNear(eq, wide);
    if (c && now - c.at < (near ? ISO_TTL_MS : ISO_TTL_QUIET_MS)) return { v: c.v, pending: false, basis: 'iso' };
    this._isoRefresh(eq, key, now);
    // 아직 한 번도 못 쟀으면 전대역을 임시로 쓴다 — pending이라 등급은 직전 값을 유지한다
    return c ? { v: c.v, pending: false, basis: 'iso' } : { v: wide, pending: true, basis: 'wide' };
  }
  // 베이스라인 쪽으로 알람이 날 상황인가 — 그때도 원본을 받아 계측을 확인한다
  // 원본으로 본 계측 판정 — 유효기간이 지났으면 없는 것으로 본다(딱지가 안 떨어지는 것을 막는다)
  // 충격성 근거 — 게이트와 같은 유효기간을 쓴다(오래된 근거를 이벤트에 붙이지 않는다)
  _impactOf(key) {
    var e = (this._impact || {})[key];
    if (!e) return null;
    if (Date.now() - e.at > GATE_RAW_TTL_MS) { delete this._impact[key]; return null; }
    return e.e;
  }
  _rawGate(key) {
    var e = (this._gateRaw || {})[key];
    if (!e) return null;
    if (Date.now() - e.at > GATE_RAW_TTL_MS) { delete this._gateRaw[key]; return null; }
    return e.g;
  }
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
        var v = VC.isoRms(w && w.values, eq.fs);
        if (v != null) self._isoCache[key] = { v: v, at: Date.now() };
        /* 같은 샘플로 계측 게이트도 본다 — 클리핑·스파이크·첨도는 파형 모양이라 원본이
           있어야 보이고, 원본을 받는 시점이 곧 알람이 날 조건이 선 시점이다. 공짜로 얹는다. */
        if (!self._gateRaw) self._gateRaw = {};
        var g = (w && w.values) ? VC.gateFromRaw(w.values, eq.fs) : null;
        // 시각을 함께 남긴다 — 다시 볼 기회가 없어도 오래되면 스스로 무효가 되게
        if (g) self._gateRaw[key] = { g: g, at: Date.now() }; else delete self._gateRaw[key];
        /* 충격성 근거 — 같은 샘플로 Crest·첨도를 재 둔다. 판정이 아니라 이벤트에 붙일 설명이다:
           대역이 올랐을 때 임펄스(베어링·기어) 때문인지 넓게 퍼진 잡음(유동·부착 이완)인지 가른다. */
        if (!self._impact) self._impact = {};
        var im = (w && w.values) ? VC.impactEvidence(w.values, eq.fs) : null;
        if (im) self._impact[key] = { e: im, at: Date.now() }; else delete self._impact[key];
      })
      .catch(function () {})
      .then(function () { self._isoBusy[key] = false; });
  }
  /* 표시 등급 — 세 판정 중 가장 나쁜 것. ISO 존만 쓰면 고주파가 지배하는 센서에서
     베어링이 나빠져도 카드가 계속 양호로 보인다(C1은 ISO로 위험이 나올 수 없다). */
  _severityOf(eq) {
    var st = (this._gradeState || {})[eq.table + ':' + eq.name];
    if (st) return st.gi;
    return VC.gradeFor(this._evalValue(eq), eq.zones);   // 판정 전(부팅 직후)에는 전대역 기준
  }
  /* 판정 보류 — 지금 등급을 매기지 않는 상태. 셋 다 카드의 숫자가 이 설비를 대표하지 않는다:
      · 계측 이상 — 파형을 못 믿는다(과대일 수도 과소일 수도 있다)
      · 신호 두절 — 마지막으로 받은 옛 값이다
      · 정지      — 들어오는 건 주변 진동·구조 전달이지 이 설비의 상태가 아니다
     그래서 등급 칩을 "판정 보류"로 두고 등급 집계에서도 뺀다. 조치는 셋이 다르므로
     배지는 따로 유지한다 — 정지는 할 일이 없고, 나머지 둘은 지금 사람이 가야 한다. */
  _holdOf(eq) {
    var rs = (this._runState || {})[eq.table + ':' + eq.name];
    if (!rs) return null;
    if (rs.lost) return { kind: 'lost', label: '신호 두절' };
    if (rs.gate) return { kind: 'gate', label: rs.gate.label || '계측 이상' };
    if (!rs.run) return { kind: 'stop', label: '정지' };
    return null;
  }
  _gradeSrc(eq) { return ((this._gradeState || {})[eq.table + ':' + eq.name] || {}).src || 'iso'; }
  /* 사용자 임계값은 "입력한 문자열 그대로" 저장된다(THRESH_RAW) — 판정에 쓸 때 여기서 숫자로 만든다.
     비었거나 숫자가 아니면 규격 기본값으로 되돌린다. 옛 설정은 숫자로 저장돼 있어 그대로 통과한다. */
  _effZones(eq) {
    var S = this.state;
    var num = function (v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; };
    if (eq.unit === 'mm/s') {
      var d = VC.ISO_ZONES[eq.cls] || VC.ISO_ZONES.II, o = S.classThresh[eq.cls] || [];
      return [num(o[0], d[0]), num(o[1], d[1]), num(o[2], d[2])];
    }
    var du = VC.zonesFor(eq.unit, eq.cls), ou = S.unitThresh[eq.unit] || [];
    return [num(ou[0], du[0]), num(ou[1], du[1]), num(ou[2], du[2])];
  }
  _setEquipCls(id, v) { var m = Object.assign({}, this.state.equipCls); m[id] = v; this.setState({ equipCls: m, dirty: true }); }
  _setEquipUnit(id, v) { var m = Object.assign({}, this.state.equipUnit); if (v) m[id] = v; else delete m[id]; this.setState({ equipUnit: m, dirty: true }); }
  /* 입력한 문자열을 그대로 담는다 — 키 입력마다 parseFloat로 정규화하면 소수점을 칠 수 없다.
     htm이 preact/compat에 묶여 있어 onChange가 키 입력마다 발화하는데, 그때 "1." → 1로 바뀌어
     화면에 다시 써지면서 점이 지워진다(1.12 같은 값이 입력 자체가 불가능했다).
     숫자로 만드는 일은 값을 쓰는 곳(_effZones) 한 곳에서만 한다. 빈 칸은 null = 기본값 사용. */
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
  // 그 태그에서 실제로 쓸 수 있는 기간 — 데이터가 want보다 짧으면 '전체'로 보정
  // (비활성 프리셋이 선택돼 있는 모순 상태 방지)
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
  // 앵커 태그(들)의 데이터 범위 — 여러 태그면 합집합(가장 이른 시작 ~ 가장 늦은 끝, 최장 스팬)
  // 스팬을 아는 태그가 하나도 없으면 Infinity = 프리셋을 막지 않는다
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
  // 기간 프리셋 칩 — 데이터 구간보다 긴 것은 비활성(레이아웃은 고정, 데이터가 쌓이면 버튼이 켜질 뿐).
  // who = 비활성 툴팁에서 어느 태그 기준인지 밝히는 말 · scope = 'report'면 리포트 탭 기간 상태를 쓴다
  _presetChips(eqs, who, scope) {
    var self = this, S = this.state, sp = this._presetSpan(eqs), rep = scope === 'report';
    var cur = rep ? S.genPeriod : S.period;
    // 프리셋을 고르면 직접 입력 초안은 버린다 — 남겨두면 '직접 입력'으로 돌아왔을 때 옛 편집이 되살아난다
    var put = function (p, fromV, toV) {
      self.setState(rep ? { genPeriod: p, genFrom: fromV, genTo: toV, genFromD: null, genToD: null }
        : { period: p, from: fromV, to: toV, fromD: null, toD: null });
    };
    var spanTxt = sp.spanH === Infinity ? '알 수 없음'
      : sp.spanH < 1 ? Math.max(1, Math.round(sp.spanH * 60)) + '분'
        : sp.spanH < 48 ? sp.spanH.toFixed(1) + '시간' : (sp.spanH / 24).toFixed(1) + '일';
    return [['1h', '1시간'], ['6h', '6시간'], ['24h', '24시간'], ['all', '전체'], ['custom', '직접 입력']].map(function (p) {
      var a = cur === p[0];
      var need = PERIOD_H[p[0]];
      var dis = need != null && sp.spanH < need; // 데이터가 그 길이에 못 미치면 선택 불가
      return {
        label: p[1],
        title: dis ? who + '의 데이터는 ' + spanTxt + '뿐이라 선택할 수 없습니다' : '',
        onClick: function () {
          if (dis) { self._toast('데이터가 부족합니다', 'warn'); return; }
          if (p[0] === 'custom' && cur === 'custom') return; // 이미 직접 입력 — 사용자가 넣은 값 보존
          var s2 = self._presetSpan(eqs); // 클릭 시점 기준으로 다시 (라이브로 lastSeen이 전진한다)
          var toMs = s2.toMs || self.data.now;
          // 직접 입력으로 들어갈 땐 직전 프리셋이 뜻하던 구간을 그대로 구체화해 채운다
          var len = p[0] === 'custom' ? cur : p[0];
          var fromMs = (PERIOD_H[len] == null)
            ? (s2.minMs || toMs - PERIOD_H['24h'] * 3600000) // all
            : toMs - PERIOD_H[len] * 3600000;
          put(p[0], self._dtVal(fromMs), self._dtVal(toMs));
        },
        style: 'padding: 6px 13px; background: ' + (a ? 'var(--primary-base)' : 'transparent') + '; color: ' + (a ? '#fff' : 'var(--text-secondary)') + '; border: none; border-right: 1px solid var(--border-default); font-size: 12px; font-weight: ' + (a ? '600' : '500') + ';' + (dis ? ' opacity: .35; cursor: default;' : ' cursor: pointer;')
      };
    });
  }
  // 대상 태그가 바뀌면 리포트 기간도 그 태그(들)에 맞춰 다시 잡는다.
  // 하나도 없으면 기간 자체를 비운다 — 기준이 없는데 구간만 떠 있으면 그게 오해의 출발점이었다
  _setGenTags(ids) {
    var self = this, S = this.state;
    var eqs = (ids || []).map(function (id) { return self._eq(id); }).filter(Boolean);
    if (!eqs.length) { this.setState({ genTags: ids || [], genPeriod: '', genFrom: '', genTo: '', genFromD: null, genToD: null }); return; }
    if (S.genPeriod === 'custom') { this.setState({ genTags: ids }); return; } // 직접 입력 값은 사용자 것
    var sp = this._presetSpan(eqs);
    var want = S.genPeriod || '1h';
    var need = PERIOD_H[want];
    if (need != null && sp.spanH < need) want = 'all'; // 데이터보다 긴 프리셋이 선택돼 있던 모순 상태 방지
    var toMs = sp.toMs || this.data.now;
    var fromMs = (PERIOD_H[want] == null) ? (sp.minMs || toMs - PERIOD_H['24h'] * 3600000) : toMs - PERIOD_H[want] * 3600000;
    this.setState({ genTags: ids, genPeriod: want, genFrom: this._dtVal(fromMs), genTo: this._dtVal(toMs), genFromD: null, genToD: null });
  }
  _toggleGenTag(id) { var g = this.state.genTags.slice(), i = g.indexOf(id); if (i >= 0) g.splice(i, 1); else g.push(id); this._setGenTags(g); }
  // 리포트 생성 — 선택 태그별로: 데이터 조회(0) → 지표 계산(1) → 소견 생성(2, 옵션) → 저장(3)
  // 저장: <워크스페이스 루트>/vibration-reports/RPT_<태그>_<기간>_<생성일시>[_LLM].html (파일 API)
  // 생성 중단 — 누르는 즉시 끝난다: 화면은 바로 대기 상태로 돌아가고, LLM 요청은 실제로 끊고(AbortController),
  // 실행 토큰(_genRun)을 올려 그 뒤로는 어떤 파일도 저장되지 않게 한다. 이미 저장된 리포트만 남는다
  _cancelGen() {
    if (!this.state.genRunning) return;
    this._genRun = (this._genRun || 0) + 1; // 진행 중이던 체인은 이 시점부터 전부 무효
    if (this._genAC) { try { this._genAC.abort(); } catch (e) { /* 이미 끝난 요청 */ } this._genAC = null; }
    this.setState({ genRunning: false, genStep: 0 });
    this._toast('생성 중단 · ' + (this._genSaved || 0) + '건 저장됨', 'warn');
    this._loadReports();
  }
  _genReport() {
    var self = this, S = this.state;
    if (!S.genTags.length) { this._toast('태그를 1개 이상 선택하세요', 'warn'); return; }
    if (S.genRunning) return;
    var run = this._genRun = (this._genRun || 0) + 1;
    this._genSaved = 0;
    this._genLlmErr = null;
    this._genFails = [];
    this._genAC = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    this.setState({ genRunning: true, genStep: 0 });
    var ids = S.genTags.slice();
    ensureDir(REPORT_DIR)
      .then(function () {
        return ids.reduce(function (chain, id) {
          return chain.then(function () {
            if (self._genRun !== run) return null; // 중단됨 — 남은 태그는 시작하지 않는다
            var eq = self._eq(id);
            if (!eq) return null;
            return self._genOne(eq, run).then(function () { self._genSaved++; })
              /* 한 태그가 실패해도 나머지는 만든다 — 여러 태그를 고른 실행에서 하나 때문에 전부 잃으면
                 처음부터 다시 돌려야 한다. 대신 어느 태그가 왜 실패했는지를 남긴다: 원문 메시지만으로는
                 (예: "Cannot read properties of undefined") 어느 설비의 어떤 데이터가 원인인지 알 수 없다. */
              .catch(function (e) {
                if (e && e.__abort) throw e; // 중단은 실패가 아니다 — 바깥에서 처리한다
                console.error('[vibe] report failed · tag=' + eq.name + ' table=' + eq.table, e);
                /* 발생 위치를 화면에도 싣는다 — 콘솔을 열 수 없는 환경(현장 PC·태블릿)에서는
                   "Cannot read properties of undefined" 같은 메시지만으로는 어디인지 알 수 없다.
                   번들이 한 파일이라 줄:열만 있으면 함수를 특정할 수 있다. */
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
        if (self._genRun !== run) return; // 중단 처리는 _cancelGen이 이미 끝냈다
        self._genAC = null;
        self.setState({ genRunning: false, genStep: 0 });
        var _f = self._genFails;
        if (_f.length) {
          self._toast('리포트 ' + self._genSaved + '건 저장 · ' + _f.length + '건 실패 — ' + _f[0].tag + ': ' + _f[0].msg
            + (_f[0].at ? '  [' + _f[0].at + ']' : '') + (_f.length > 1 ? ' 외 ' + (_f.length - 1) + '건' : ''), 'err');
        } else if (self._genLlmErr) self._toast('리포트 ' + self._genSaved + '건 저장 — LLM 소견 실패로 지표만 저장됨 · ' + self._genLlmErr, 'err');
        else self._toast('리포트 ' + self._genSaved + '건 저장 · vibration-reports/');
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
  /* ── 데이터 관리(설정) ──────────────────────────────────────────────────────
     이 패키지가 만든 테이블 4개의 현황을 보여주고, 삭제를 사용자가 실행하게 한다.

     자동 삭제(RETENTION)를 쓰지 않는다 — 정책은 DB 전역 객체라 패키지를 지워도 남고,
     조용히 지워진 데이터는 사라진 사실조차 화면에 안 남는다. 대신 지울 양을 먼저 세어
     보여주고 확인을 받는다.

     테이블 유형마다 지울 수 있는 범위가 다르다는 점이 이 화면의 핵심 제약이다:
      · EVENTS(LOG)  — 가장 오래된 쪽부터 연속으로만. 구간 지정 불가
      · BAND(TAG)    — 기간·태그 자유
      · LOOKUP 둘    — 키 단위
     그래서 버튼을 테이블마다 다르게 낸다. 안 되는 것은 숨기지 않고 흐리게 두어 이유를 밝힌다. */
  _refreshUsage() {
    var self = this;
    if (!this.live) return Promise.resolve();
    this.setState({ usageBusy: true });
    // 태그별 보유량은 총계와 함께 읽는다 — 화면이 "감시 대상 밖 N건"을 표에 바로 적어야 한다
    return Promise.all([usageStats(), tagUsage().catch(function () { return null; })])
      .then(function (r) { self.setState({ usage: r[0], tagUsage: r[1], usageBusy: false }); })
      .catch(function (e) { self.setState({ usageBusy: false }); self._toast('현황 조회 실패: ' + (e.message || e), 'err'); });
  }
  /* 감시 대상 밖 태그의 데이터를 지운다 — 대역 계열 전부 + 이벤트 + 판정 상태.
     삭제 순서는 데이터 먼저, 태그 이름(메타)은 그 뒤다. 메타 정리는 "데이터가 하나도 안 남은
     이름"만 지우므로 순서가 바뀌면 아무것도 안 지워지고 철거한 설비가 목록에 계속 남는다
     (db.deleteBandOfTag·deleteEventsOfTag가 그 순서를 갖고 있다).
     학습값은 여기서 건드리지 않는다 — 태그당 몇 행이라 늘지 않고, 같은 이름이 돌아오면
     되살아남 확인이 오용을 막는다. */
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
      // 화면이 보는 판정 상태 캐시도 같이 비운다 — 안 비우면 지운 태그가 '감시 대상 밖'으로 계속 세진다
      rows.forEach(function (r) { if (self._monState) delete self._monState[r.key]; });
      self._toast(one ? rows[0].key + ' 데이터를 지웠습니다' : rows.length + '개 태그의 데이터를 지웠습니다', 'ok');
      self.setState({ orphanBusy: null });
      return self._refreshUsage();
    }).catch(function (e) {
      self.setState({ orphanBusy: null });
      self._toast('정리 실패: ' + (e.message || e), 'err');
    });
  }
  /* 삭제 확인 — 고른 조건으로 실제 건수를 먼저 센 뒤에 대화상자를 연다.
     세기 전에 열면 사용자가 "얼마나 지워지는지 모른 채" 확인을 누르게 된다. */
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
  /* 확인받은 삭제를 실행한다. 되돌릴 수 없으므로 여기까지 오는 길은 하나뿐이다 —
     날짜 고르기 → 실제 건수 세기 → 확인. 실행 뒤에는 현황을 다시 읽어 화면 숫자를 맞춘다.

     TAG 표는 삭제 직후 NAME 인덱스 반영에 약간 시차가 있어 바로 다시 세면 옛 숫자가 나온다.
     잠깐 기다렸다 갱신한다 — 사용자에겐 "지웠는데 그대로"로 보이기 때문이다. */
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
        if (!isBand) self._loadEventsLive();          // 목록도 지운 뒤 상태로 맞춘다
        return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return self._refreshUsage(); });
      })
      .catch(function (e) {
        self.setState({ purge: null, purgeTyped: null });
        self._toast('삭제 실패: ' + (e.message || e), 'err');
      });
  }
  /* 감시 대상 밖 판정 상태 정리 — 넷 중 유일하게 되살릴 수 있는 데이터라 확인 없이 지운다.
     지워도 다음 판정 주기에 다시 만들어지므로 잃는 것이 없다(학습값은 반대라 여기에 없다). */
  _cleanMonStateOrphans() {
    var self = this, S = this.state;
    var live = {};
    (this.data ? this._activeEqs() : []).forEach(function (e) { live[e.table + ':' + e.name] = 1; });
    var keys = Object.keys(this._monState || {}).filter(function (k) { return !live[k]; });
    if (!keys.length) { this._toast('정리할 항목이 없습니다'); return Promise.resolve(); }
    return keys.reduce(function (pr, k) {
      return pr.then(function () { return deleteMonState(k).catch(function () { }); });
    }, Promise.resolve()).then(function () {
      keys.forEach(function (k) { delete self._monState[k]; });
      self._toast(keys.length + '개 정리했습니다', 'ok');
      return self._refreshUsage();
    });
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
    /* 감시 대상 밖 태그의 보유량 — 설비를 철거했거나 센서를 뗐는데 이력만 남은 경우다.
       기간 삭제로는 못 지운다(멀쩡한 다른 태그까지 같이 지워진다). 총계만 보여주면 정리할
       대상을 고를 수가 없어서 태그별로 센다. */
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
        id: 'events', name: '이벤트 이력', table: 'NEO_VIBE_EVENTS', kind: 'TAG',
        stat: this._num(u.events.rows || 0) + '건 · ' + span(u.events.span)
          + (orphanTot.events ? ' · 감시 대상 밖 ' + this._num(orphanTot.events) + '건' : ''),
        note: '알람 이력입니다. 지우면 그 기간을 다룬 리포트를 다시 만들 수 없습니다. 설비를 철거했다면 그 태그의 이력만 따로 지울 수 있습니다.',
        act: { label: '기간 삭제…', danger: true, sub: '기간 안 모든 태그', onClick: function () { openPick('events'); } },
        act2: orphanRows.length ? { label: '태그별 정리…', onClick: openOrphan } : null,
      },
      {
        id: 'band', name: '대역 에너지 추이', table: 'NEO_VIBE_BAND', kind: 'TAG',
        stat: this._num(u.band.rows || 0) + '행 · ' + span(u.band.span)
          + (orphanTot.band ? ' · 감시 대상 밖 ' + this._num(orphanTot.band) + '행' : ''),
        note: '대역 이탈 판정과 추세 차트가 쓰는 데이터입니다. 넷 중 유일하게 시간에 비례해 커집니다 — 학습에 쓰인 구간을 지우면 대역 베이스라인을 다시 학습해야 합니다.',
        act: { label: '기간 삭제…', danger: true, sub: '학습 구간 포함 주의', onClick: function () { openPick('band'); } },
        act2: orphanRows.length ? { label: '태그별 정리…', onClick: openOrphan } : null,
      },
      {
        id: 'monstate', name: '판정 상태', table: 'NEO_VIBE_MONSTATE', kind: 'LOOKUP',
        stat: this._num(u.monstate.rows || 0) + '행' + (msOrphan ? ' · 감시 대상 밖 ' + msOrphan + '행' : ''),
        note: '직전 판정 결과입니다. 지워도 다음 판정 주기에 다시 만들어집니다 — 넷 중 유일하게 잃을 것이 없는 데이터라 확인 없이 정리합니다.',
        // 되살릴 수 있는 데이터라 확인 대화상자를 두지 않는다(다른 둘과 다른 점이다)
        act: msOrphan
          ? { label: '안 쓰는 데이터 정리', danger: false, sub: '확인 없이 즉시 실행', onClick: function () { self._cleanMonStateOrphans(); } }
          : null,
      },
    ] : [];
    /* 학습값(NEO_VIBE_BASELINE)은 여기에 행을 두지 않는다 — 이 화면이 다루는 것은 "쌓여서 지워야 하는 것"인데
       학습값은 재학습이 같은 키를 덮어써 늘지 않고(태그당 최대 6행), 상한까지 채워도 150 KB 남짓이다.
       감시 대상에서 빠진 키는 아무도 읽지 않으며(판정은 활성 설비 기준으로만 조회), 같은 이름 태그가
       돌아오면 되살아남 확인이 오용을 막는다. 표가 있다는 사실만 각주로 남기고 관리는 판정 기준에서 한다. */
    base.dataFootnote = u
      ? '학습값(NEO_VIBE_BASELINE · ' + this._num(u.baseline.rows || 0) + '행)은 재학습이 같은 자리를 덮어써 늘지 않습니다 — 정리 대상이 아니라 판정 기준에서 관리합니다.'
      : '';
    base.onGoCriteria = function () { self.setState({ setSection: 'criteria' }); self._refreshBandCov(); };
    /* 태그별 정리 — 기간 삭제로는 못 하는 일이다. 설비 하나를 철거했는데 그 이력만 지우려면
       기간으로는 멀쩡한 다른 태그까지 같이 지워진다.
       확인 절차를 기간 삭제만큼 무겁게 두지 않는 이유: 대상이 이미 감시 목록 밖이라 판정에
       쓰이지 않고, 무엇이 몇 건 지워지는지가 목록에 그대로 적혀 있다. */
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
    /* 기간 고르기 — 기본은 보관 중인 전체 구간(min~max)이다. 사용자는 여기서 좁힌다.
       "전체가 기본"이 위험해 보이지만, 실행 직전에 표 이름을 직접 입력해야 하고 그 화면이
       삭제 건수와 '삭제 후 남는 데이터 0건'을 크게 보여준다 — 모르고 지나갈 수 있는 구조가 아니다.
       보관 정보가 없으면(데이터 없음) 빈칸으로 두고 버튼을 잠근다: 지울 것이 없다. */
    var pick = S.purgePick;
    base.purgePickShow = !!pick;
    base.purgePickTitle = pick === 'band' ? '대역 에너지 추이 삭제' : '이벤트 이력 삭제';
    var _sp = pick === 'band' ? (u && u.band.span) : (u && u.events.span);
    var _hasSpan = !!(_sp && _sp.from > 0 && _sp.to > 0);
    base.purgeFrom = S.purgeFrom || (_hasSpan ? this._dtVal(_sp.from).slice(0, 10) : '');
    base.purgeTo = S.purgeTo || (_hasSpan ? this._dtVal(_sp.to).slice(0, 10) : '');
    base.purgePickReady = !!(base.purgeFrom && base.purgeTo);
    base.purgeHaveText = _sp && _sp.from > 0
      ? '보관 중: ' + E.fmtDT(_sp.from).slice(0, 10) + ' ~ ' + E.fmtDT(_sp.to).slice(0, 10) : '';
    base.onPurgeFrom = function (ev) { self.setState({ purgeFrom: ev.target.value }); };
    base.onPurgeTo = function (ev) { self.setState({ purgeTo: ev.target.value }); };
    base.onPurgePickCancel = function () { self.setState({ purgePick: null, purgeFrom: null, purgeTo: null }); };
    base.onPurgePickNext = function () {
      if (!base.purgePickReady) { self._toast('시작·종료 날짜를 모두 고르세요', 'warn'); return; }
      // 종료일은 그날 23:59:59.999까지 포함 — 사용자는 "그날까지"로 읽는다
      var a = Date.parse(base.purgeFrom + 'T00:00:00'), b = Date.parse(base.purgeTo + 'T23:59:59.999');
      if (!isFinite(a) || !isFinite(b)) { self._toast('날짜를 확인하세요', 'warn'); return; }
      if (a > b) { self._toast('기간이 올바르지 않습니다 (시작 ≤ 종료)', 'warn'); return; }
      self.setState({ purgePick: null });
      self._askPurge(pick, a, b);
    };
    // 확인 대화상자 — 건수를 센 뒤에만 삭제 버튼이 살아난다
    var p = S.purge;
    base.purgeShow = !!p;
    if (p) {
      var isBand = p.kind === 'band';
      base.purgeTitle = isBand ? '대역 에너지 추이 삭제' : '이벤트 이력 삭제';
      base.purgeSub = isBand ? 'NEO_VIBE_BAND' : 'NEO_VIBE_EVENTS';
      var unit = isBand ? '행' : '건';
      base.purgeWhen = E.fmtDT(p.fromMs).slice(0, 10) + ' ~ ' + E.fmtDT(p.toMs).slice(0, 10);
      base.purgeCounting = !!p.counting;
      base.purgeN = p.counting ? '—' : this._num(p.n || 0) + unit;
      base.purgeKeep = p.counting ? '—' : '삭제 후 남는 데이터 ' + this._num(p.keep || 0) + unit;
      base.purgeNone = !p.counting && !p.n;
      base.purgeAsk = '정말 삭제하시겠습니까?';
      /* 결과를 항목으로 나눠 적는다 — 한 문단으로 뭉치면 마지막 줄(내보내기 권장)이 묻힌다.
         마지막 항목은 경고가 아니라 대안이라 톤을 달리한다(tip). */
      base.purgeBullets = isBand
        ? [{ t: '영구 삭제되며 복구할 수 없습니다' },
          { t: '학습에 쓰인 구간이 포함되면 대역 베이스라인을 다시 학습해야 합니다' },
          { t: '추세 차트에서 이 구간이 비어 보입니다' }]
        : [{ t: '영구 삭제되며 복구할 수 없습니다' },
          { t: '이 기간을 다룬 리포트는 다시 만들 수 없습니다' },
          { t: '기간 조회에서 이 구간은 빈 결과로 나옵니다' },
          { t: '삭제 전 이벤트 기록 내보내기로 저장한 뒤 제거하는 것을 권장합니다', tip: true }];
      /* 마지막 관문 — 테이블 이름을 직접 입력해야 버튼이 열린다.
         버튼 하나로 끝나면 확인 대화상자가 "누르는 절차"가 되어 버린다. 되돌릴 수 없는 삭제라
         손이 한 번 더 가게 만든다(건수·기간을 다시 읽게 되는 부수 효과가 더 크다). */
      base.purgeTable = isBand ? 'NEO_VIBE_BAND' : 'NEO_VIBE_EVENTS';
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
  /* 기간 지표 카드 4장 — 상세분석과 리포트가 같은 문구·같은 배지를 쓰도록 여기서 조립한다.
     값·등급은 VC.sevMetrics가 정하고, 여기는 서식과 각주만 붙인다.
     반환은 중립 모양이라 화면(색 입힘)과 리포트(HTML)가 각자 자기 필드로 옮겨 쓴다. */
  _sevCards(m, unit, held) {
    var E = this.E, n = m.n;
    var mk = function (label, d, u, prefix) {
      var over = d.value > d.thr;
      return { label: label, grade: d.grade, badgeKo: d.badge || E.STATUS[d.grade].ko, override: !!d.badge,
        valueText: (prefix || '') + E.fmt(d.value), unit: u || '',
        thrText: '기준 < ' + (prefix || '') + E.fmt(d.thr),
        over: over, arrow: over ? '▲' : '▼', deltaText: E.fmt(Math.abs(d.value - d.thr)), foot2: '' };
    };
    var c = [
      mk('평균 RMS · 1초 롤업(광대역)', m.avg, unit),
      mk('P95 RMS · 1초 롤업(광대역)', m.p95, unit),
      mk('Crest P95 · 롤업', m.crest, ''),
      mk('변화율 (최근 1/4 ÷ 직전 1/4)', m.trend, '', '×'),
    ];
    c[0].foot2 = 'ISO 판정은 별도(10–1000 Hz 대역제한 평균) — 이 값은 광대역 감시용';
    // 최댓값은 등급 없이 사실만 — 최댓값을 쓸 때는 발생 횟수를 함께 적는다
    c[1].foot2 = '최댓값 ' + E.fmt(n.wMax) + ' ' + unit + '(등급 없음) · B/C 초과 ' + n.overBC + '/' + n.buckets + '버킷';
    c[2].foot2 = '기준 = √(2·ln N) = ' + n.cExp.toFixed(1) + ' (N=버킷당 ' + this._num(n.perBucket) + '샘플) · 최댓값 ' + n.wCrest.toFixed(1);
    if (!m.trend.graded) {
      c[3].thrText = '관측 ' + Math.round(n.durMin) + '분 — 등급 없음(정상상태·동일 계측조건 전제 미충족)';
      c[3].over = false; c[3].arrow = ''; c[3].deltaText = '';
    }
    /* 계측 사유가 값을 어느 방향으로 틀었는지 그 카드에 적는다 — 방향을 모르면 낮은 값이
       "조용하다"로 읽힌다. 클리핑은 꼭대기를 잘라 Crest와 진폭을 함께 낮춘다. */
    if (held && held.key === 'clip') {
      c[2].foot2 = '클리핑은 꼭대기를 잘라 Crest를 낮춥니다 — 이 값이 낮은 것은 정상이라는 뜻이 아닙니다';
      c[1].foot2 = c[1].foot2 + ' · 클리핑으로 진폭이 과소일 수 있습니다';
    } else if (held && held.key === 'dc') {
      c[0].foot2 = 'DC 드리프트로 기준선이 어긋나 RMS가 과대일 수 있습니다 — 계측 확인 후 재평가';
    }
    return c;
  }
  _genOne(eq, run) {
    var self = this, S = this.state, E = this.E;
    var live = function () { if (self._genRun !== run) throw { __abort: true }; }; // 중단된 실행이면 여기서 끝
    this.setState({ genStep: 0 });
    // 리포트도 선택 기간의 롤업을 직접 조회(렌더용 비동기 캐시에 의존하지 않음)
    return this._rollForAsync(eq, 'report').then(function (rf) {
    live();
    var roll = rf.roll;
    var anchor = rf.toMs || eq.lastSeen; // 리포트 스펙트럼도 리포트 기간의 끝에 맞춘다
    var vu = self.state.viewUnit || null; // 리포트도 현재 표시 물리량(가속도/속도/변위)으로 생성
    var c = self._detailCache[eq.id];
    var detP = (c && c.state === 'ready' && c.anchor === anchor && c.viewUnit === vu) ? Promise.resolve(c.det) : liveDetail(E, eq, anchor, vu);
    // 이 태그에 실제로 적용된 구간 — 프리셋은 태그마다 창을 다시 잡으므로 리포트 탭의 genFrom/genTo(앵커 값)를 그대로 쓰면 안 된다
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
      var dx = self._dx(eq, det);   // 리포트 앵커로 만든 det를 그대로 — 재조회하면 캐시가 버려진다

      // 기간 지표 — 상세분석 화면과 같은 함수(VC.sevMetrics). 등급·임계 규칙은 calc가 단독으로 갖는다.
      var _held = VC.gateReason(det.quality, null);   // 리포트는 분석 창만 본다(감시 상태는 별도 행에 싣는다)
      var _gate = !!_held;
      var m = VC.sevMetrics(roll, { zones: eq.zones, fs: eq.fs, gate: _gate });
      var n = m.n, wAvg = n.wAvg, wMax = n.wMax, wMin = n.wMin, wTrend = n.wTrend, cnt = n.cnt;
      var rP95 = m.p95.value, cP95 = m.crest.value, cExp = n.cExp;
      // 차트 계열용 원시 배열 — 지표(m)와 달리 버킷을 그대로 싣는다
      var rms = roll.map(function (r) { return r.rms; });
      var p2pV = roll.map(function (r) { return r.p2p; });
      var crestA = roll.map(function (r) { return r.crest; });
      var sevCards = self._sevCards(m, eq.unit, _held).map(function (c) {
        return { label: c.label, badgeKo: c.badgeKo, value: c.valueText, unit: c.unit,
          thr: c.thrText, over: c.over, arrow: c.arrow, delta: c.deltaText, foot2: c.foot2 };
      });
      // 통계 요약은 "진단에 쓰이는 값"만 — COUNT/AVG/MIN/MAX는 스펙 패널과 중복이고 MIN은 정지 구간이 섞이면 의미가 없다.
      // 표준편차는 Crest가 큰 신호에서 스파이크 하나에 지배되므로 넣지 않는다(계측 문제를 기계 상태로 읽게 됨).
      var stats = [
        { k: '중앙값 RMS', v: E.fmt(n.rMed) + ' ' + eq.unit },
        { k: 'P95 RMS', v: E.fmt(rP95) + ' ' + eq.unit },
        { k: 'B/C 초과 버킷', v: n.overBC + '/' + n.buckets + ' (' + (n.buckets ? (n.overBC / n.buckets * 100).toFixed(1) : '0') + '%)' },
        { k: 'Crest P95', v: cP95.toFixed(2) + ' (기준 ' + cExp.toFixed(1) + ')' },
        { k: '변화율', v: '×' + wTrend.toFixed(2) + (m.trend.graded ? '' : ' · 등급 없음') },
        { k: '관측 창', v: Math.round(n.durMin) + '분 · ' + n.buckets + '버킷' },
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
        live(); // 소견까지 받았어도 중단됐으면 버린다
        self.setState({ genStep: 3 });
        // 차트는 PNG가 아니라 데이터+엔진을 내장 — 저장된 문서에서 캔버스 실시간 렌더(줌/툴팁/테마)
        var useClock = rf.clock;
        var xL = roll.map(function (r) { return useClock ? E.fmtClock(r.ms) : E.fmtMD(r.ms); });
        var xT = roll.map(function (r) { return E.fmtDT(r.ms); });
        var refs = [
          { val: eq.zones[0], color: '#3aa76d', label: 'A/B ' + E.fmt(eq.zones[0]) },
          { val: eq.zones[1], color: '#d99a2b', label: 'B/C ' + E.fmt(eq.zones[1]) },
          { val: eq.zones[2], color: '#e07b39', label: 'C/D ' + E.fmt(eq.zones[2]) },
        ];
        var kxl = (tr.xLabels && tr.xLabels.length) ? tr.xLabels : xL;
        // 차트 계열(롤업·추세 청크 의존)만 여기서 만들고, eq·det로 정해지는 나머지는 _reportMeta가 준다.
        // 검증 하네스도 같은 메서드를 부르므로 필드가 한쪽에만 생기는 일이 구조적으로 없다.
        var data = Object.assign({
          refs: refs, xL: xL, xT: xT, kxl: kxl,
          rms: rms.length ? rms : null,
          p2p: rms.length ? p2pV : null,
          crest: rms.length ? crestA : null,
          kurt: (tr.kurt && tr.kurt.length) ? tr.kurt : null,
          bands: (tr.bands && tr.bands.length && tr.bands[0].vals.length) ? tr.bands : null,
        }, self._reportMeta(eq, det, _ev, _rptSat));

        var genMs = Date.now();
        function z(n) { return n < 10 ? '0' + n : '' + n; }
        var gd = new Date(genMs);
        var ts = '' + gd.getFullYear() + z(gd.getMonth() + 1) + z(gd.getDate()) + '_' + z(gd.getHours()) + z(gd.getMinutes()) + z(gd.getSeconds());
        var docNo = 'VBR-' + ts.replace('_', '-');
        var html = Report.buildReportHTML({
          docNo: docNo, alias: eq.alias || eq.name, tagName: eq.table + ' · ' + eq.name,
          generatedText: E.fmtDT(genMs), logoDataURL: logo,
          specs: specs, sevMachine: eq.name + ' · Class ' + eq.cls + ' · ' + eq.rpm + ' RPM' + (det.frMeas ? ' (실측 ' + Math.round(det.frMeas.rpm) + ')' : ''),
          gradeKo: dx.gradeKo, gradeColor: dx.color,
          zones: [E.fmt(eq.zones[0]), E.fmt(eq.zones[1]), E.fmt(eq.zones[2])], zonesUnit: eq.unit, gradeIdx: eq.grade,
          verdict: dx.verdict, verdictSub: dx.sub, sevCards: sevCards, stats: stats,
          indics: det.indics,
          opinion: opinion, opinionModel: opinion ? ((S.llmModels || {})[S.llmProvider] || S.llmProvider) : null,
          actions: dx.actions,
          data: data, chartLibSrc: chartSrc,
          // 재현성 도장의 모델명은 실제로 소견을 낸 경우에만 — 실패했는데 모델을 적으면 없는 근거를 주장하게 된다
          build: self._reportBuild(eq, det, docNo,
            opinion ? String((S.llmModels || {})[S.llmProvider] || S.llmProvider).replace(':', ' ').replace(/(\d+)\s*b$/i, '$1B') : ''),
          fftHint: det.fft.freqs.length ? '해상도 ' + det.fft.res.toFixed(2) + ' Hz' : '',
          waveDesc: det.raw.values.length ? (det.raw.fs / 1000).toFixed(2) + ' kHz 캡처 · 분석 창 ' + (det.anaSec ? det.anaSec.toFixed(1) : '?') + '초(최신 시점 앵커) — 이 창의 지표는 3분 추세 평균과 다른 값' : '',
          envDesc: det.envelope.hint, cepDesc: det.cepstrum.note,
        });
        // 파일명은 짧게(태그_생성일시) — 기간·별칭·LLM 여부는 .index.json에 기록해 보관함 컬럼 유지
        var fname = eq.name.replace(/[^A-Za-z0-9._-]/g, '-') + '_' + ts + '.html';
        live(); // 쓰기 직전 마지막 확인 — 중단 후에는 파일이 생기지 않는다
        return saveFile(REPORT_DIR + '/' + fname, html, 'text/html').then(function () {
          return self._updateReportIndex(function (idx) {
            idx[fname] = { tag: eq.alias || eq.name, from: winFrom, to: winTo, llm: !!opinion, ms: genMs };
          });
        });
      });
    });
    });
  }
  /* 리포트용 LLM 소견 한 건. 결말이 넷(끔·미설정·호출 실패·빈 응답)인데 전부 소견 없음으로 수렴하므로,
     실패한 셋은 반드시 _genLlmErr에 사유를 남긴다 — 조용히 null이 되면 리포트에는 결정론 소견(종합 소견·
     근거표·권고)이 그대로 실려 LLM이 쓴 것처럼 보이고, 사용자는 "켰는데 지표만"의 이유를 알 수 없다.
     소견이 없어도 리포트 자체는 낸다(지표·근거·권고는 LLM과 무관하게 완결된다). */
  _reportOpinion(eq, det, dx, sat, winFrom, winTo) {
    var self = this, S = this.state;
    if (!S.genLLM) return Promise.resolve(null);
    // 프로바이더 미선택·API 키 없음 — 호출 자체가 없어 아래 catch에 걸리지 않는다.
    // 설정에서 프로바이더만 바꿔 새 프로바이더의 키가 비어 있을 때가 대표적인 경로다.
    var llm = LLM.createLLM(this._llmCfg());
    if (!llm) { this._genLlmErr = 'LLM 미설정 — 설정 → LLM 연동에서 프로바이더와 API 키를 확인하세요'; return Promise.resolve(null); }
    return llm.complete(this._opinionPrompt(eq, det, dx, sat) + '\n[조회 기간] ' + winFrom + ' ~ ' + winTo,
      { signal: this._genAC && this._genAC.signal })
      // 빈 응답은 어느 프로바이더도 예외로 던지지 않는다(전부 ''를 돌려준다) — 여기서 실패로 바꾼다
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
  /* 리포트 data 중 eq·det·근거만으로 정해지는 부분(요약 8블록·ISO·재현성 바 등)을 한 곳에 모은다.
     _genOne과 검증 하네스(tools/verify-summary.mjs)가 같은 것을 쓰게 하기 위한 추출 — 두 벌로 두면
     한쪽에 필드를 추가해도 다른 쪽은 모르고, 검사기가 "실제와 다른 것"을 통과시킨다(실제로 세 번 어긋났다).
     차트 계열(rms/p2p/kurt/bands·축 라벨)은 롤업·추세 청크에 의존하므로 _genOne에 남긴다. */
  _reportMeta(eq, det, ev, rptSat) {
    var self = this, E = this.E;
    var roll = eq.rollup || [];
    // 지표는 화면·리포트와 같은 함수에서 — 여기서 따로 계산하면 요약 문구만 옛 기준으로 남는다
    var _m = VC.sevMetrics(roll, { zones: eq.zones, fs: eq.fs, gate: !!(det.quality && det.quality.gate) });
    var cP95 = _m.crest.value, cExp = _m.n.cExp, nTot = _m.n.perBucket;
    var wAvg = _m.n.wAvg, _durMinT = _m.n.durMin;
    return {
      unit: eq.unit, dispUnit: det.dispUnit, natUnit: det.natUnit,
      wave: det.raw.values.length ? { t: det.raw.times_ms.map(function (m) { return m.toFixed(0); }), v: det.raw.values } : null,
      fft: det.fft.freqs.length ? { freqs: det.fft.freqs, mags: det.fft.mags, markers: det.fft.markers, res: det.fft.res } : null,
      spec: det.spectro.rows ? det.spectro : null,
      env: det.envelope.freqs.length ? { freqs: det.envelope.freqs, mags: det.envelope.mags, markers: det.envelope.markers, hint: det.envelope.hint } : null,
      cep: det.cepstrum.freqs.length ? { freqs: det.cepstrum.freqs, mags: det.cepstrum.mags, markers: det.cepstrum.markers } : null,
      kurtogram: (det.kurtogram && det.kurtogram.freqs.length) ? { freqs: det.kurtogram.freqs, mags: det.kurtogram.mags, markers: det.kurtogram.markers, res: det.kurtogram.res, best: det.kurtogram.best } : null,
      quality: (det.quality && !det.quality.ok) ? det.quality : null,
      kurtWarn: rptSat && rptSat.flag ? rptSat.msg : null,
      levels: det.levels, isoUnit: eq.unit, isoZoneBC: E.fmt(eq.zones[1]),
      evidence: ev.conf, negatives: ev.negatives, unexplained: ev.unexplained, missing: ev.missing, acq: ev.acq,
      /* 대역 이탈은 감시가 아는 관측이라 리포트 본문까지 실어야 한다 — 위 대역 분배는 ISO 방법이라
         1 kHz까지이고, 마운팅 상한 위 대역은 결함 대역 탐색에서도 빠져 어디에도 안 남는다. */
      bandDev: (ev.bandDev && ev.bandDev.length)
        ? { rows: ev.bandDev.map(function (d) { return { ko: d.ko, v: E.fmt(d.v), lim: E.fmt(d.lim), r: d.r.toFixed(2), over: d.r > 1, soft: d.soft }; }),
          mount: ev.mount, fmaxKHz: ev.mountFmax > 0 ? (ev.mountFmax / 1000).toFixed(1) : '' }
        : null,
      // 요약 모드(30초 판독용) — 게이트 상태에 따라 첫 줄이 바뀐다. 측정 불가·음성 소견·미설명은
      // 게이트와 무관하게 항상 인쇄한다(계측 구성·메타데이터가 만든 것이라 센서를 다시 붙여도 남는다).
      summary: (function () {
        var kurtW = 0; (det.indics || []).forEach(function (x) { if (/Kurtosis|커토시스/.test(x.k)) kurtW = parseFloat(x.v) || 0; });
        var scored = ev.conf.filter(function (c) { return !c.na; });
        var gateReasonTxt = 'Crest P95 ' + cP95.toFixed(2) + ' · 파형 첨도 ' + kurtW.toFixed(1) + ' (기준 ' + cExp.toFixed(1) + ' = √(2·ln ' + self._num(nTot) + '))';
        return {
          gate: !!(det.quality && det.quality.gate),
          gateReason: gateReasonTxt,
          gateCap: GATE_CAP,
          cands: scored.slice(0, 3).map(function (c) { return { f: c.f, score: c.score, s: c.s, why: (c.tags && c.tags.length ? c.tags[0] : c.why) }; }),
          unmeasurable: ev.conf.filter(function (c) { return c.na; }).map(function (c) { return { f: c.f, why: c.caveat || '' }; }),
          rpmTxt: det.frMeas ? Math.round(det.frMeas.rpm) + ' ± ' + Math.round(det.frMeas.rpmTol || 0) + ' rpm (명판 ' + eq.rpm + ')' : '명판 ' + eq.rpm + ' rpm (실측 피크 없음)',
          obsTxt: Math.round(_durMinT) + '분 · ' + roll.length + '버킷',
          acqTxt: '8초 창 · 0.125 Hz · Hanning 50% 중첩 · 8회 평균',
          // 조치 카드 1장 — 해당하는 것만 크게. 근거 줄에는 "등급"이 아니라 값·대역·평균 조건·경계까지의
          // 거리를 적는다("근거: Zone D"는 등급으로 등급을 설명하는 순환이라 근거가 아니다).
          action: (function () {
            var isoOk2 = det.isoRms != null && eq.unit === 'mm/s';
            // 게이트는 "기계 상태"가 아니라 "측정 상태" — A~D 팔레트를 쓰면 5번째 등급으로 오독된다
            if (det.quality && det.quality.gate) {
              return { kind: 'gate', cls: 'hold', icon: '⏸', title: '계측 검증 후 재측정 — 기계 상태 미판정',
                body: '센서 마운팅·케이블·커넥터를 점검하고 같은 지점에서 재측정하십시오. 이 리포트의 결함 판정은 운전 판단 근거가 아닙니다.',
                basis: gateReasonTxt + ' — 단발 스파이크 시그니처' };
            }
            if (!isoOk2) return null;
            var g = VC.gradeFor(det.isoRms, eq.zones), x = det.isoRms, z = eq.zones;
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
            card.kind = 'zone';
            // 블록간 변동이 크면 경계까지의 여유가 불확도 안에 든다 → 단정하지 않는다(R10)
            if (Math.round((det.isoSpread || 1) * 100) / 100 >= 1.5) card.title += ' (잠정)';
            // 광대역이 규격 판정보다 높을 때만 — 등급을 올리는 근거가 아님을 못 박는다
            if (eq.grade > g) card.aside = '광대역 감시는 ' + E.STATUS[eq.grade].ko + '(' + E.fmt(eq.rms) + ' ' + eq.unit + ') — 전체 에너지의 '
              + Math.round((det.hfEnergyFrac || 0) * 100) + '%가 10–1000 Hz 밖입니다. 등급이 아니라 알람 임계·협대역 감시 전환 검토 사항입니다.';
            return card;
          })(),
          // 게이트 편향 방향 — 가산형은 값이 상한, 감산형은 하한. 숨기지 말고 어느 쪽 한계인지 적는다.
          bias: (function () {
            var ks = ((det.quality && det.quality.issues) || []).map(function (i) { return i.key; });
            if (ks.indexOf('flatline') >= 0 || ks.indexOf('clip') >= 0 || ks.indexOf('sparse') >= 0)
              return '센서 정지·포화는 진폭을 과소 표시합니다 — 이 값은 하한, 실제는 이상일 수 있습니다.';
            if (ks.indexOf('spike') >= 0 || ks.indexOf('kurtx') >= 0)
              return '아티팩트는 에너지를 더하기만 합니다 — 이 값은 상한, 실제 기계 상태는 이하입니다.';
            return '';
          })(),
          // 1단계 검산: 롤업 평균과 ISO 8블록 평균이 배수로 벌어지면 "창이 다른 것"을 해석 전에 밝힌다
          winNote: (function () {
            if (!(det.isoRms > 0) || !(wAvg > 0)) return '';
            var r = det.isoRms / wAvg;
            if (r < 1.5 && r > 0.67) return '';
            return '롤업 평균 ' + E.fmt(wAvg) + ' 대비 ×' + r.toFixed(2) + ' — 창이 다릅니다(롤업=관측 ' + Math.round(_durMinT) + '분 전체, ISO=최신 시점 앵커 ' + (det.isoBlocks || 1) + '블록).';
          })(),
        };
      })(),
      // ISO 규격 판정(10–1000 Hz 대역제한)과 실시간 감시 등급(광대역)을 분리해 헤드라인 정합성 확보
      iso: (det.isoRms != null && eq.unit === 'mm/s') ? (function () { var g = VC.gradeFor(det.isoRms, eq.zones); return { rms: E.fmt(det.isoRms), gradeIdx: g, gradeKo: E.STATUS[g].ko, color: E.STATUS[g].color, anaSec: det.anaSec ? det.anaSec.toFixed(1) : '',
        blocks: det.isoBlocks || 0, spread: det.isoSpread ? det.isoSpread.toFixed(2) : '', spreadWarn: Math.round((det.isoSpread || 1) * 100) / 100 >= 1.5 }; })() : null,
      levelsOk: det.levelsOk !== false, accelFeff: det.accelFeff || 0, accelNyqFrac: det.accelNyqFrac || 0,
      hfFrac: det.hfEnergyFrac || 0, velExHigh: det.velExHigh ? E.fmt(det.velExHigh) : '',
      velBB: det.levels ? E.fmt(det.levels['mm/s']) : '', anaSecTxt: det.anaSec ? det.anaSec.toFixed(1) : '',
      exHighSameZone: (det.velExHigh != null && det.isoRms != null) ? (VC.gradeFor(det.velExHigh, eq.zones) === VC.gradeFor(det.isoRms, eq.zones)) : null,
      exHighZoneKo: det.velExHigh != null ? E.STATUS[VC.gradeFor(det.velExHigh, eq.zones)].ko : '',
      parsevalOk: !det.parseval || det.parseval.ok !== false, parsevalErr: det.parseval ? (det.parseval.relErr * 100).toFixed(1) : '',
      /* 감시 블록 — 리포트에 "지금 감시가 뭐라고 보고 있나"를 싣는다.
         감시도 ISO 대역제한 구간 RMS를 쓰므로, 값과 설명이 어긋나지 않게 실제 판정값·근거를 그대로 넘긴다. */
      mon: (function () {
        var gs = (self._gradeState || {})[eq.table + ':' + eq.name] || {};
        var gi = self._severityOf(eq);
        var v = isFinite(gs.iso) ? gs.iso : eq.rms;
        return {
          rms: E.fmt(v), gradeKo: E.STATUS[gi].ko, color: E.STATUS[gi].color, unit: eq.unit,
          /* 대역제한을 안 걸었으면 그 이유까지 적는다. 샘플레이트를 모르는 것과 1 kHz 위가
             없는 것은 다르다 — 전자에서 "성분 없음"이라고 쓰면 못 본 것을 없다고 단언하게 된다. */
          basis: gs.limited ? 'ISO 10~1000 Hz 대역제한 구간 RMS'
            : (eq.fs > 0 ? '전대역 구간 RMS(샘플레이트 ' + self._num(eq.fs) + ' Hz — 1 kHz 위를 측정하지 않음)'
              : '전대역 구간 RMS(샘플레이트 불명 — 대역제한 미적용)'),
          src: { iso: 'ISO 존', baseline: '베이스라인 이탈', band: '대역 이탈' }[gs.src] || 'ISO 존',
          wide: isFinite(gs.wide) ? E.fmt(gs.wide) : null,
        };
      })(),
      gate: !!(det.quality && det.quality.gate),
      rpmMeas: det.frMeas ? Math.round(det.frMeas.rpm) : null,
    };
  }
  /* 리포트 재현성 정보 — "지난달 리포트와 왜 다른가"에 답하는 유일한 근거.
     셀마다 핵심값(v) 한 줄 + 보조줄(subs)로 나눠 시선이 값 → 보조 순으로 흐르게 한다. */
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
    return readFileBlob(REPORT_DIR + '/.index.json')
      .then(function (b) { return b.text(); }).then(function (t) { return JSON.parse(t); })
      .catch(function () { return {}; })
      .then(function (idx) {
        mutate(idx);
        return saveFile(REPORT_DIR + '/.index.json', JSON.stringify(idx, null, 2), 'application/json');
      });
  }
  // 보관함 = vibration-reports/ 디렉터리 목록 + .index.json 메타 (구 RPT_ 파일명 인코딩도 지원)
  _loadReports() {
    var self = this;
    var idxP = readFileBlob(REPORT_DIR + '/.index.json')
      .then(function (b) { return b.text(); }).then(function (t) { return JSON.parse(t); })
      .catch(function () { return {}; });
    Promise.all([listDir(REPORT_DIR).catch(function () { return []; }), idxP]).then(function (r) {
      var children = r[0], idx = r[1];
      function ymd(s) { return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
      var reps = (children || []).filter(function (f) { return !f.isDir && /\.html$/i.test(f.name); })
        .map(function (f) {
          var meta = idx[f.name];
          if (meta) return { id: f.name, fname: f.name, ms: meta.ms || f.lastModifiedUnixMillis || 0, tags: [meta.tag], period: meta.from + ' ~ ' + meta.to, llm: !!meta.llm };
          var m = /^RPT_(.+)_(\d{8})-(\d{8})_(\d{8})_(\d{6})(_LLM)?\.html$/.exec(f.name); // 구버전 파일명
          return {
            id: f.name, fname: f.name, ms: f.lastModifiedUnixMillis || 0,
            tags: [m ? m[1] : f.name.replace(/\.html$/i, '')], period: m ? ymd(m[2]) + ' ~ ' + ymd(m[3]) : '-', llm: !!(m && m[6]),
          };
        }).sort(function (a, b) { return b.ms - a.ms; });
      self.setState({ reports: reps });
    });
  }
  // 리포트는 새 탭에서 연다 — iframe 미리보기는 폭이 좁아 그리드·차트가 실제와 다르게 접히고
  // 인쇄·테마 토글·앵커 이동이 중첩 스크롤 안에 갇힌다. 자립형 HTML이라 그대로 열면 된다.
  _openReport(r) {
    var self = this;
    if (this._rvBlobUrl) { URL.revokeObjectURL(this._rvBlobUrl); this._rvBlobUrl = null; }
    readFileBlob(REPORT_DIR + '/' + r.fname).then(function (blob) {
      self._rvBlobUrl = URL.createObjectURL(blob);
      var w = window.open(self._rvBlobUrl, '_blank');
      if (!w) { self._toast('팝업이 차단되었습니다 — 브라우저에서 허용 후 다시 시도하세요', 'err'); return; }
      // blob URL은 문서가 로드된 뒤 회수해야 안전(즉시 revoke하면 새 탭이 빈 화면)
      setTimeout(function () { if (self._rvBlobUrl) { URL.revokeObjectURL(self._rvBlobUrl); self._rvBlobUrl = null; } }, 60000);
    }).catch(function (e) { self._toast('리포트 열기 실패: ' + (e && e.message || e), 'err'); });
  }
  _delReport(id) {
    var self = this;
    deleteFile(REPORT_DIR + '/' + id)
      .then(function () { return self._updateReportIndex(function (idx) { delete idx[id]; }).catch(function () {}); })
      .then(function () { self._toast('리포트 삭제됨'); self._loadReports(); })
      .catch(function (e) { self._toast('삭제 실패: ' + (e && e.message || e), 'err'); });
  }
  // 헤더 알람 pill 토글 — 설정탭의 저장 버튼 흐름과 달리 즉시 적용·즉시 저장
  _toggleMonitorNow() {
    var self = this, on = !this.state.monitorOn;
    this.setState({ monitorOn: on });
    setTimeout(function () {
      self._persistCfg(); // setState 반영 후 저장
      if (self.state.monitorOn) self._judgeLive(true).then(function () { self._loadEventsLive(); }); // 켜는 즉시 1회 판정
    }, 0);
    this._toast(on ? '알람이 켜졌습니다' : '알람이 꺼졌습니다 — 임계를 넘어도 알림이 발송되지 않습니다', on ? 'ok' : 'warn');
  }
  _navTo(id) {
    if (this.state.tab === 'settings' && this.state.dirty && id !== 'settings') { this.setState({ pendingNav: id }); return; }
    // 설정탭 진입 시 테이블·태그 목록 최신화 (부팅 후 추가/삭제된 것 반영)
    if (id === 'settings' && this.live) {
      var self = this;
      listTagTables().then(function (t) { self.liveTables = t; self._loadSchemas(); self.forceUpdate(); }).catch(function () {});
      this._ensureTags(this.state.srcSel, true);
      // 별칭 편집은 스크롤한 만큼 줄을 누적해 두므로, 들어올 때마다 처음 분량으로 되돌린다
      // (검색어는 남긴다 — 입력칸에 그대로 보이는 값이라 사라지면 오히려 놀란다)
      this.setState({ aliasShown: ALIAS_ROWS_MAX });
    }
    this.setState({ tab: id });
    this._scrollTop();
  }
  _scrollTop() { setTimeout(function () { var m = document.querySelector('main'); if (m) m.scrollTop = 0; }, 30); }
  _confirmNav(action) { var p = this.state.pendingNav; if (action === 'save') { this.setState({ dirty: false, tab: p, pendingNav: null }); this._persistCfg(); this._toast('설정이 저장되었습니다'); if (this.live) this._reloadLive(); } else if (action === 'discard') { this.setState({ dirty: false, tab: p, pendingNav: null }); } else { this.setState({ pendingNav: null }); } }
  _markDirty() { if (!this.state.dirty) this.setState({ dirty: true }); }
  _saveSettings() { this.setState({ dirty: false }); this._persistCfg(); this._toast('설정이 저장되었습니다'); if (this.live) this._reloadLive(); }
  // 알림 설정(채널·라우팅) — 앱 발송과 서버 타이머 생성이 같은 모양을 쓴다
  _notifyCfg() {
    var S = this.state, ch = S.notifCh || {}, to = S.notifTo || {};
    return {
      channels: { webhook: { on: !!ch.webhook, to: to.webhook || '' } },
      routes: routesWithDefaults(S.routes), // 미설정 심각도는 기본값 적용 (UI 체크 상태와 동일)
    };
  }
  // 이벤트 1건 발송 — 라우팅에 걸릴 때만. 폭주 방지는 판정 상태머신(진입확인·재알림주기·복귀유지)이 이미 담당한다.
  _notifyEvent(eq, ev, val, lim, nowMs) {
    var cfg = this._notifyCfg(), gradeKo = GRADE_WORDS[ev.gi];
    if (!Notify.shouldNotify(gradeKo, ev.etype, 'webhook', cfg)) return;
    var to = cfg.channels.webhook.to;
    var msg = Notify.eventMessage({
      alias: eq.alias || eq.name, tag: eq.name, table: eq.table,
      typeKo: TYPEKO[ev.etype] || ev.etype, gradeKo: gradeKo,
      // etype·detail — 값 줄이 유형마다 다르다(계측 이상은 사유만, 대역은 비율만). 없으면 옛 틀로 찍힌다.
      etype: ev.etype, detail: ev._detail || ev.detail || '',
      val: val, lim: lim, unit: eq.unit, timeText: this.E.fmtDT(nowMs || Date.now()),
    });
    runTql(Notify.buildWebhookTql(to, Notify.payloadFor(msg, to))).catch(function () {});
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
    LLM.testConnection(this._llmCfg()).then(function (r) {
      self.setState({ llmTesting: false, llmTest: { ok: true, msg: '응답 ' + r.ms + 'ms · "' + r.sample + '"' }, llmConfigured: true });
      self._toast('LLM 연결 성공');
    }).catch(function (e) {
      self.setState({ llmTesting: false, llmTest: { ok: false, msg: String(e && e.message || e) }, llmConfigured: false });
      self._toast('LLM 연결 실패', 'err');
    });
  }
  renderVals() {
    var self = this, S = this.state, E = this.E, isL = S.theme === 'light';
    var base = {
      rootClass: isL ? 'theme-light' : '',
      themeIcon: 'color-mode',
      logoFilter: isL ? '' : 'filter: brightness(1.15);',
      monitorText: S.monitorOn ? 'ON' : 'OFF',
      monitorDotColor: S.monitorOn ? '#3aa76d' : '#6c7079',
      monitorDotRing: S.monitorOn ? 'rgba(58,167,109,.18)' : 'rgba(120,120,120,.15)',
      // 알람 ON일 때 감시 방식 배지 — 서버 상시(파랑, 앱 닫아도 동작) vs 앱(회색, 열린 동안만)
      monModeBadgeShow: S.monitorOn,
      monModeBadgeText: S.monMode === 'server' ? '서버 상시' : '앱',
      // 두 모드 모두 파란 배지 — 문구('서버 상시'/'앱')로 구분되므로 색은 통일
      monModeBadgeStyle: 'font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; color: var(--primary-light); background: rgba(0,108,210,.14); border: 1px solid rgba(0,108,210,.3);',
      monPillTitle: S.monitorOn
        ? (S.monMode === 'server' ? '서버 상시 감시 — 앱을 닫아도 Neo 타이머가 계속 감지합니다' : '앱 감시 — 앱이 열려 있는 동안만 감지합니다')
        : '클릭하여 알람 켜기/끄기',
      goSettings: function () { self._navTo('settings'); },
      onToggleMonitor: function () { self._toggleMonitorNow(); },
      toggleTheme: function () { self.toggleTheme(); },
      settingsActiveStyle: S.tab === 'settings' ? 'border-color: var(--primary-light); color: var(--text-primary);' : '',
      navTabs: [{ id: 'monitor', label: '모니터링', icon: 'dashboard' }, { id: 'detail', label: '상세분석', icon: 'graph-line' }, { id: 'report', label: '리포트 생성', icon: 'file' }].map(function (t) {
        var a = S.tab === t.id;
        return { label: t.label, icon: t.icon, onClick: function () { self._navTo(t.id); }, style: 'display: inline-flex; align-items: center; gap: 7px; height: 52px; padding: 0 14px; background: transparent; border: none; border-bottom: 2px solid ' + (a ? 'var(--primary-light)' : 'transparent') + '; color: ' + (a ? 'var(--text-primary)' : 'var(--text-tertiary)') + '; font-size: 13px; font-weight: ' + (a ? '600' : '500') + '; cursor: pointer;' };
      }),
      notReady: !S.ready,
      isMonitor: S.ready && S.tab === 'monitor', isDetail: S.ready && S.tab === 'detail',
      isDiag: S.ready && S.tab === 'diag', isReport: S.ready && S.tab === 'report', isSettings: S.ready && S.tab === 'settings',
      toast: S.toast, toastMsg: S.toast ? S.toast.msg : '',
      toastIcon: S.toast && S.toast.kind === 'err' ? 'error' : (S.toast && S.toast.kind === 'warn' ? 'warning' : 'check'),
      // 오류 토스트에는 발생 위치까지 실리므로 길어질 수 있다 — 화면 밖으로 나가지 않게 폭을 묶는다
      toastStyle: 'position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); z-index: 100; display: flex; align-items: flex-start; gap: 9px; padding: 11px 18px; border-radius: 8px; font-size: 13px; font-weight: 500; color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.35); animation: vtoast .25s cubic-bezier(.21,1.02,.73,1); max-width: min(880px, calc(100vw - 40px)); line-height: 1.5; word-break: break-word; background: ' + (S.toast && S.toast.kind === 'err' ? 'var(--toast-err)' : (S.toast && S.toast.kind === 'warn' ? 'var(--toast-warn)' : 'var(--toast-ok)')) + ';'
    };
    base.showAdvanced = true; // 라이브도 전체 그래프 복원(포락선·켑스트럼·스펙트로그램·첨도·대역 — 실계산)
    base.indicsTitle = this.live ? '진단 지표 (시간영역)' : '스펙트럴 진단 지표';
    base.indicsDesc = this.live ? '원시 파형 구간에서 직접 산출한 충격·에너지 특성 지표' : '스펙트럼에서 직접 산출된 충격·에너지 특성 지표';
    if (!S.ready || !this.data) return base;
    this.data.equipment.forEach(function (e) { e.cls = S.equipCls[e.id] || e.baseCls || e.cls; e.zones = self._effZones(e); e.grade = VC.gradeFor(e.rms, e.zones); });
    var eqsAll = this._activeEqs(), counts = [0, 0, 0, 0];
    /* 테이블 필터 — 모니터링 화면에서만 모집단을 좁힌다(판정 대상은 그대로다).

       등급 필터와 성격이 다르다. 등급은 KPI가 세어 둔 것 중 하나를 집는 것이라 KPI 숫자는
       그대로여야 하고, 테이블은 모집단 자체를 줄이는 것이라 KPI도 같이 줄어야 한다 —
       안 그러면 "심각 2"라고 떠 있는데 목록이 비어 그 숫자를 못 믿게 된다.
       설정에서 소스를 뺀 테이블이 필터에 남아 있으면 무시한다(선택은 저장되지 않는다). */
    var _hide = (S.tblHide || []).filter(function (t) { return (S.srcSel || []).indexOf(t) >= 0; });
    var eqs = _hide.length ? eqsAll.filter(function (e) { return _hide.indexOf(e.table) < 0; }) : eqsAll;
    /* 판정 보류는 등급으로 세지 않는다 — 못 믿는 값으로 매긴 등급이 "위험 5대"에 섞이면
       그 숫자를 못 믿게 된다. 대신 자기 칸에서 세고, 내역(사유별)은 호버로 내린다. */
    var holdN = 0, holdBy = { gate: 0, lost: 0, stop: 0 };
    eqs.forEach(function (e) {
      var h = self._holdOf(e);
      if (h) { holdN++; holdBy[h.kind]++; return; }
      counts[self._severityOf(e)]++;
    });
    base.sumTotal = eqs.length;
    base.onTotalClick = function () { self.setState({ gradeFilter: null }); };
    base.totalStyle = 'flex: 1 1 0; min-width: 118px; padding: 14px 18px; border: none; border-right: 1px solid var(--border-default); background: transparent; text-align: left; cursor: pointer; font-family: inherit;';
    var kpiDef = [{ g: 0, label: '양호', color: '#3aa76d' }, { g: 1, label: '주의', color: '#d99a2b' }, { g: 2, label: '위험', color: '#e07b39' }, { g: 3, label: '심각', color: '#e5484d' }];
    /* 판정 보류 칸 — 클릭하면 그 태그만 걸러진다(다른 등급 칸과 같은 동작).
       색은 심각도 팔레트를 쓰지 않는다. 감시 상태이지 설비 상태가 아니라서, 같은 색을 쓰면
       "위험보다 덜 나쁜 등급"으로 읽힌다. */
    kpiDef.push({ g: 'hold', label: '판정 보류', color: 'var(--text-muted)' });
    base.kpiCells = kpiDef.map(function (k) {
      var act = S.gradeFilter === k.g;
      if (k.g === 'hold') {
        return { label: k.label, color: k.color, count: holdN, active: act,
          tip: '지금 등급을 매기지 않는 설비입니다 — 카드의 값이 그 설비를 대표하지 않습니다.'
            + '\n\n계측 이상 ' + holdBy.gate + '대 — 파형을 못 믿습니다. 센서·케이블 확인이 필요합니다.'
            + '\n신호 두절 ' + holdBy.lost + '대 — 데이터가 안 들어옵니다. 수집 경로 확인이 필요합니다.'
            + '\n정지 ' + holdBy.stop + '대 — 설비가 서 있습니다. 조치는 필요 없고, 운전이 재개되면 판정도 재개됩니다.',
          style: 'flex: 1 1 0; min-width: 96px; padding: 14px 18px; border: none; border-right: 1px solid var(--border-default); background: ' + (act ? 'rgba(0,108,210,.10)' : 'transparent') + '; text-align: left; cursor: pointer; font-family: inherit;' + (act ? ' box-shadow: inset 0 -2px 0 var(--primary-light);' : ''),
          onClick: function () { self.setState({ gradeFilter: act ? null : 'hold' }); } };
      }
      return { label: k.label, color: k.color, count: counts[k.g], active: act,
        style: 'flex: 1 1 0; min-width: 96px; padding: 14px 18px; border: none; border-right: 1px solid var(--border-default); background: ' + (act ? 'rgba(0,108,210,.10)' : 'transparent') + '; text-align: left; cursor: pointer; font-family: inherit;' + (act ? ' box-shadow: inset 0 -2px 0 var(--primary-light);' : ''),
        onClick: function () { self.setState({ gradeFilter: act ? null : k.g }); } };
    });
    /* 이 둘은 필터를 따라가지 않는다 — 빈 상태 화면은 "감시할 설비가 없다"는 뜻이라,
       필터로 0이 된 것을 그렇게 보여주면 소스를 다시 고르라고 엉뚱한 안내를 하게 된다.
       설정의 태그 수(activeCount)도 모니터링 화면 필터와 무관한 값이다. */
    base.activeCount = eqsAll.length;
    base.monEmpty = eqsAll.length === 0;
    base.monEventsShow = base.isMonitor && !base.monEmpty;
    base.detailShow = base.isDetail && !base.monEmpty; base.detailEmptyShow = base.isDetail && base.monEmpty;
    base.diagShow = base.isDiag && !base.monEmpty; base.diagEmptyShow = base.isDiag && base.monEmpty;
    base.reportShow = base.isReport && !base.monEmpty; base.reportEmptyShow = base.isReport && base.monEmpty;
    /* 테이블 필터 UI — 소스가 둘 이상일 때만 나온다. 하나뿐인 설치에서는 늘 같은 값만 든
       칩이 되어 화면 소음이 된다. 태그 수를 함께 적는 이유는 0개인 테이블(선택은 했는데 데이터가
       없는 경우)을 고르면 목록이 비는데, 그것이 필터 탓인지 설비가 없는 탓인지 구분하려면
       고르기 전에 수가 보여야 하기 때문이다. */
    var _tblAll = (S.srcSel || []).slice().sort();
    var _tblCnt = {};
    eqsAll.forEach(function (e) { _tblCnt[e.table] = (_tblCnt[e.table] || 0) + 1; });
    var _q = String(S.tblQuery || '').trim().toLowerCase();
    // 검색은 지금 보이는 목록만 바꾼다 — 걸린 필터는 건드리지 않는다(찾다가 필터가 풀리면 놀란다)
    var _tblShown = _q ? _tblAll.filter(function (t) { return t.toLowerCase().indexOf(_q) >= 0; }) : _tblAll;
    var _vis = _tblAll.filter(function (t) { return _hide.indexOf(t) < 0; });
    base.tblFilterShow = _tblAll.length >= 2;
    base.tblOpen = !!S.tblOpen;
    /* 버튼은 "무엇을 하는 것인지"를 말해야 한다 — 이름만 적으면 누르는 것이 아니라 읽는 것으로
       보인다. 기본은 전부 켜져 있으므로 그때는 수 대신 '전체'라고 적는다: 5/5는 세어 보게 만들고,
       좁혀 놓았을 때만 분수가 뜻을 갖는다(숫자 하나만 적으면 고른 수인지 있는 수인지 모른다). */
    base.tblAllOn = _hide.length === 0;
    base.tblSelCount = _vis.length;
    base.tblTotal = _tblAll.length;
    base.tblCaption = base.tblAllOn ? '전체 테이블 표시 중' : '';
    base.tblTip = '표시할 테이블만 고릅니다 — 화면만 좁힐 뿐,\n감시·알람은 선택한 소스 전체에서 그대로 돕니다.';
    base.tblQuery = S.tblQuery || '';
    base.onTblQuery = function (ev) { self.setState({ tblQuery: ev.target.value }); };
    // 열고 닫을 때 검색어를 비운다 — 다시 열었을 때 목록이 잘려 있으면 없는 테이블로 읽힌다
    base.onTblOpen = function () { self.setState({ tblOpen: !S.tblOpen, tblQuery: '' }); };
    base.onTblClose = function () { self.setState({ tblOpen: false, tblQuery: '' }); };
    /* 고르는 즉시 반영된다 — 확인 버튼을 두지 않는다. 이 필터는 보기만 바꾸고 판정에는
       영향이 없어서, 잘못 골라도 되돌리는 값이 싸다(칩의 ×가 항상 옆에 있다). */
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
    /* 전체 선택·해제는 "지금 보이는 것"에 대해서다 — 검색으로 걸러 놓고 누르면 화면 밖의 것까지
       바뀌는 쪽이 더 놀랍다. 검색어가 없으면 그대로 전체가 된다. */
    base.onTblSelectAll = function () {
      self.setState({ tblHide: (self.state.tblHide || []).filter(function (t) { return _tblShown.indexOf(t) < 0; }) });
    };
    base.onTblClearAll = function () {
      var h = (self.state.tblHide || []).slice();
      _tblShown.forEach(function (t) { if (h.indexOf(t) < 0) h.push(t); });
      self.setState({ tblHide: h });
    };
    /* 하나도 안 남기면 카드가 없다 — 그 자리를 비워 두면 필터 탓인지 설비가 없는 탓인지
       구분이 안 된다. 빈 상태 화면(monEmpty)은 소스 문제를 말하는 자리라 여기서 쓸 수 없다. */
    base.tblNoneShow = base.isMonitor && _tblAll.length > 0 && _vis.length === 0;
    /* 칩은 앞의 몇 개만 내놓고 나머지는 +N으로 접는다 — 테이블이 늘어날수록 제목줄이 통째로
       칩에 먹힌다. +N은 목록을 다시 여는 버튼이다(접힌 것이 무엇인지는 거기서 보면 된다).
       전부 켜져 있을 때는 칩 대신 문구 하나만 둔다 — 있는 것을 다 나열하는 칩은 정보가 아니다. */
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
    base.lastEventText = S.events.length ? E.ago(S.events[0].ms, Date.now()) + ' · ' + S.events[0].tagAlias : '없음'; // 이벤트는 벽시계 기준
    base.srcNotice = S.srcNotice;
    /* 감시 이상 배너 — 알람이 안 오는 이유가 "정상이라서"인지 "감시가 죽어서"인지 알려준다.
       err는 감시가 실제로 멈춘 상태, warn은 의심스러운 상태. */
    base.healthWarns = (S.health || []).map(function (w) {
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
        var sel = (self.state.srcSel || []).filter(function (x) { return t.indexOf(x) >= 0; });
        self.setState({ srcSel: sel });
        // 사용자가 변동을 확정한 시점 — 적재 후 감시 대상을 즉시 맞춘다(다음 틱을 기다리지 않게)
        setTimeout(function () { self._reloadLive(); self._resyncMonSoon(); }, 0);
      }).catch(function () { self._reloadLive(); });
    };
    base.onSrcDismiss = function () { self._noticeMuted = true; self.setState({ srcNotice: '' }); };
    base.cardSize = S.cardSize;
    base.gridCols = 'repeat(auto-fill, minmax(' + S.cardSize + 'px, 1fr))';
    base.onCardSize = function (ev) { self.setState({ cardSize: parseInt(ev.target.value, 10) }); };
    var sparkH = Math.round(Math.min(120, Math.max(38, S.cardSize * 0.2)));
    /* 카드 순서 — 저장된 사용자 순서가 있으면 그것을 먼저 따르고, 거기 없는 태그는 뒤에
       심각도순(e.order)으로 붙인다. 새 설비가 생겨도 맨 뒤에 조용히 들어와 기존 배치가 안 흐트러진다.
       기본(순서 없음)은 지금까지와 같은 심각도 내림차순이다. */
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
      // 등급 필터에는 보류가 안 걸린다 — 그 등급으로 세지 않았으므로 카드에도 안 나와야 일관된다
      sorted = sorted.filter(function (e) { return !self._holdOf(e) && self._severityOf(e) === S.gradeFilter; });
    }
    base.filterNotice = S.gradeFilter === 'hold' ? ('판정 보류 ' + sorted.length + '대만 표시 중')
      : (S.gradeFilter !== null && S.gradeFilter !== undefined) ? (E.STATUS[S.gradeFilter].ko + ' ' + sorted.length + '대만 표시 중') : '';
    base.onClearFilter = function () { self.setState({ gradeFilter: null }); };
    base.cards = sorted.map(function (e) {
      var g = E.STATUS[self._severityOf(e)];
      /* 판정 보류면 색도 전부 중립으로 바꾼다 — 칩만 회색이고 테두리·스파크가 등급색이면
         "계측 이상인데 초록"이 되어 화면이 정상이라고 말하는 셈이다. 색은 등급을 매겼을 때만 쓴다. */
      if (self._holdOf(e)) g = { ko: '판정 보류', color: 'var(--text-muted)', soft: 'var(--bg-elevated)' };
      /* 진동 배지 — 악화·개선을 짧은 간격으로 반복하면 설비 상태가 아니라 설정 문제일 수 있다.
         주기는 관측값(threshold 간격 중앙값)이고, 그 주기를 덮는 RMS 구간을 권고한다. */
      var _fl = (self._flap || {})[e.table + ':' + e.name];   // 판정 루프가 계산해 둔 값
      var flap = null;
      if (_fl) {
        /* 권고 구간은 관측 주기에서 바로 나온다 — 프리셋 목록에서 고르지 않는다.
           진동 주기는 현장마다 다르므로(부하 변동·간헐 운전 주기) 고정 후보로는 못 덮는다. */
        var _needMin = Math.ceil(_fl.periodMs / 60000);
        flap = {
          text: '진동 ' + _fl.round + '회',
          tip: '최근 2시간에 등급 악화가 ' + _fl.round + '회 반복됐습니다 (약 ' + _needMin + '분 주기).'
            + '\n\n판정값이 주기적으로 오가는 것은 설비 상태보다 설정 문제일 때가 많습니다 — 부하 변동이나 간헐 운전인데 RMS 구간이 그보다 짧은 경우입니다.'
            + '\n\nRMS 구간을 ' + _needMin + '분 이상으로 늘리면 하나의 상태로 합쳐집니다(반응은 그만큼 느려집니다).'
            + '\n실제 결함이라면 그대로 두고 원인을 확인하십시오.',
          needMin: _needMin,
          onFix: function (ev3) { ev3.stopPropagation(); self._applyFlapFix(_needMin); },
        };
      }
      /* 운전 상태 배지 — 두절은 화면에 반드시 나와야 한다. 값이 멈춘 채 남아 있어
         아무 표시가 없으면 "정상이라 조용한 것"으로 읽힌다. 정지는 판정이 얼어 있다는 표시다. */
      var _rs = (self._runState || {})[e.table + ':' + e.name];
      var runBadge = null;
      if (_rs && _rs.lost) {
        runBadge = { text: '신호 두절', err: true,
          tip: '새 데이터가 ' + durKo(_rs.age) + ' 동안 들어오지 않았습니다.'
            + '\n\n화면의 값은 마지막으로 받은 값이라 현재 상태가 아닙니다. 판정도 멈춰 있습니다.'
            + '\n센서·수집기·네트워크를 확인하십시오.' };
      } else if (_rs && _rs.gate) {
        /* 계측 이상 — 정지보다 먼저 본다. 플랫라인은 값이 낮아 정지처럼 보이지만 뜻이 정반대다:
           정지는 설비가 선 것이고(재개되면 판정도 재개), 플랫라인은 센서가 죽어 그 태그가
           무기한 무감시가 된 상태다. 회색 "정지"에 묻히면 아무도 안 본다. */
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
      /* 등급을 올린 판정이 무엇인지 — 등급만 보여주면 원인을 화면에서 알 수 없다.
         ISO가 올린 경우는 표시하지 않는다(그게 기본이라 매 카드에 붙으면 잡음이 된다). */
      var _gs = (self._gradeState || {})[e.table + ':' + e.name] || {};
      var srcKo = { baseline: '베이스라인', band: '대역' }[_gs.src];
      var gradeNote = (_gs.gi > 0 && srcKo) ? srcKo : '';
      /* 판정 보류면 등급 칩을 대체한다 — 못 믿는 값으로 매긴 등급을 그대로 두면
         "계측 이상인데 양호"처럼 화면이 자기 모순을 말한다. 직전 확정 등급은 호버로 남긴다. */
      var _hold = self._holdOf(e);
      var _ms = (self._monState || {})[e.table + ':' + e.name];
      var holdTip = '';
      if (_hold) {
        gradeNote = '';
        holdTip = '지금 등급을 매기지 않습니다 — ' + _hold.label + ' 상태라 이 값이 설비를 대표하지 않습니다.';
        if (_ms && _ms.g != null) {
          holdTip += '\n\n직전 확정 ' + (GRADE_WORDS[_ms.g] || '-')
            + (_ms.since ? ' · ' + agoText(_ms.since) : '');
        }
      }
      /* 판정값 — 존은 ISO 대역제한 값으로 매겨진다. 대역제한이 걸린 태그는 두 값을 함께 보여야
         "존은 양호인데 베이스라인 이탈"이 고주파 성장 신호로 읽힌다. */
      /* 큰 숫자는 등급을 만든 값(판정값)이고, 라벨이 그게 어떤 양인지 말한다.
         ISO 계산을 건너뛴 구간(양호 확정)에서는 전대역이므로 그렇게 적는다 — 정의가 상태에
         따라 바뀌는 것을 숨기면 그 숫자가 무엇인지 알 수 없다. */
      var mainVal = (_gs.iso != null && isFinite(_gs.iso)) ? _gs.iso : e.rms;   // null은 isFinite를 통과한다
      /* 라벨은 "어느 대역에서 잰 값인가"다 — 원인이 아니다. 주파수로 적으면 그 뜻이 표기 자체로
         드러난다. Nyquist가 1 kHz 이하인 태그는 전대역이 곧 ISO 대역이라 실제 범위를 적는다. */
      var _nyq = e.fs > 0 ? Math.round(e.fs / 2) : 0;
      var mainUnit = (_gs.basis === 'iso') ? '10~1000 Hz'
        : _nyq > 0 ? ('2~' + _nyq + ' Hz') : '전대역';
      /* 나머지 두 축은 카드에 안 적는다 — 신규 설치에서는 대부분 미학습이라 거의 모든 카드가
         '베이스라인 — 대역 —'이 되어 잡음이 된다. "왜 이 등급인가"는 등급 칩의 원인 표시로
         답이 되고, "얼마나"는 상세분석의 몫이다. 값은 버리지 않고 호버로 내린다. */
      var _ax = [];
      if (_gs.blR != null && isFinite(_gs.blR)) _ax.push('베이스라인 한계 대비 ×' + _gs.blR.toFixed(1));
      if (_gs.bandR != null && isFinite(_gs.bandR)) _ax.push('대역 최대 ×' + _gs.bandR.toFixed(1));
      var valTip = '';
      if (_gs.limited && _gs.iso != null && isFinite(_gs.iso) && isFinite(_gs.wide)) {
        valTip = 'ISO 10~1000 Hz  ' + E.fmt(_gs.iso) + ' ' + (e.unit || '')
          + '\n전대역          ' + E.fmt(_gs.wide) + ' ' + (e.unit || '')
          + '\n\n존 등급은 ISO 대역제한 값으로 매깁니다 — 표준의 존 경계가 10~1000 Hz 기준이라 전대역 값을 대면 다른 양을 재게 됩니다.'
          + '\n베이스라인 이탈은 전대역으로 봅니다 — 어느 주파수든 평소보다 커지면 잡히도록.'
          + '\n\n두 값 차이가 크면 1 kHz 위(충격·베어링·기어)에 에너지가 몰려 있다는 뜻입니다.';
      }
      if (_ax.length) valTip = (valTip ? valTip + '\n\n' : '') + _ax.join('\n');
      /* 큰 글씨는 사용자가 붙인 별칭, 작은 글씨는 실제 태그명이다. 소스가 둘 이상이면 테이블까지
         적는다 — 판정 키는 '테이블:태그'라 서로 다른 설비인데, 이름이 같으면 카드가 똑같이 보인다
         (별칭 기본값이 태그명이라 기본 상태가 그렇다). */
      return { mainUnit: mainUnit, hold: !!_hold, holdTip: holdTip, gradeNote: gradeNote, valTip: valTip, runBadge: runBadge, flap: flap, id: e.id, alias: e.alias || e.name, name: e.name,
        sub: e.name + (base.tblFilterShow ? ' (' + e.table + ')' : ''), unit: e.unit, cls: e.cls, gradeKo: g.ko, gradeColor: g.color, gradeSoft: g.soft, rmsText: E.fmt(mainVal), sparkLine: e.spark.line, sparkArea: e.spark.area, sparkColor: g.color, sparkFill: g.soft, sparkH: sparkH, lastText: E.ago(e.lastSeen, self.data.now), onClick: function () { self._gotoDetail(e.id); }, cardStyle: 'border-left: 3px solid ' + g.color + ';' };
    });
    /* 설비 카드 드래그 — 놓는 순간 순서를 바꾸고 저장한다.
       순서는 화면에 보이는 카드만이 아니라 저장된 전체 목록을 기준으로 다시 만든다
       (필터가 걸려 있어도 안 보이는 카드의 상대 순서가 흐트러지지 않게). */
    /* 드래그 중에는 미리보기 순서를 그대로 렌더한다 — 끌고 간 자리에 카드가 실제로 들어가고
       양옆이 밀리는 게 보여야 어디에 놓이는지 알 수 있다(선만 그으면 결과를 상상해야 한다).
       놓을 때 그 순서를 확정하고, 취소하면 원래대로 돌아간다. */
    base.cardDrag = {
      onStart: function (id) {
        return function (ev) {
          // 시작 시점의 전체 순서를 고정해 둔다 — 드래그 중 심각도가 바뀌어도 흔들리지 않게
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
          // 같은 결과면 setState를 건너뛴다 — dragover는 초당 수십 번 발생한다
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
          self._persistView(['cardOrder'], { cardOrder: arr });   // 순서만 파일에 반영 — 타이머도, 설정 탭의 미저장 편집도 건드리지 않는다
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
    base.periodPresets = this._presetChips([this._activeEq(S.selTag)], '이 태그', 'detail');
    var custom = S.period === 'custom';
    var _dtTxt = function (s) { return String(s || '').replace('T', ' '); }; // 표시용(입력값의 T 제거)
    /* 직접 입력은 초안 → '적용' 두 단계로 받는다. 네이티브 피커에는 확인 단추가 없어서 날짜·시·분을
       고르는 사이 값이 서너 번 바뀌는데, 바뀔 때마다 커밋하면 중간 구간으로 조회가 나가고
       사용자는 무엇이 반영됐는지 알 수 없다. 적용 단추가 곧 피커를 닫는 수단이기도 하다. */
    var pFrom = S.fromD != null ? S.fromD : S.from;
    var pTo = S.toD != null ? S.toD : S.to;
    base.periodFrom = pFrom; base.periodTo = pTo;
    var _fD = Date.parse(pFrom), _tD = Date.parse(pTo);
    var dateInvalid = custom && !isNaN(_fD) && !isNaN(_tD) && _tD < _fD;
    base.dateStyle = 'height: 34px; padding: 0 10px; border-radius: 6px; border: 1px solid ' + (dateInvalid ? '#e5484d' : 'var(--border-medium)') + '; background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);' + (custom ? '' : ' opacity: .5; pointer-events: none;');
    var pDirty = custom && ((S.fromD != null && S.fromD !== S.from) || (S.toD != null && S.toD !== S.to));
    base.periodApplyShow = custom;
    base.periodApplyOff = !pDirty || dateInvalid;
    base.periodBad = dateInvalid ? '시작이 종료보다 늦습니다' : '';
    base.periodApplyStyle = 'height: 34px; padding: 0 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: ' + (base.periodApplyOff ? 'default' : 'pointer')
      + '; border: 1px solid ' + (base.periodApplyOff ? 'var(--border-default)' : 'var(--primary-base)')
      + '; background: ' + (base.periodApplyOff ? 'var(--bg-elevated)' : 'var(--primary-base)')
      + '; color: ' + (base.periodApplyOff ? 'var(--text-muted)' : '#fff') + ';';
    base.onFromChange = function (ev) { if (S.period !== 'custom') return; self.setState({ fromD: ev.target.value }); };
    base.onToChange = function (ev) { if (S.period !== 'custom') return; self.setState({ toD: ev.target.value }); };
    base.onPeriodApply = function () {
      if (dateInvalid) { self._toast('시작 시각이 종료보다 늦습니다', 'warn'); return; }
      if (!pDirty) return;
      self._closePicker();
      self.setState({ from: pFrom, to: pTo, fromD: null, toD: null });
      self._toast('조회 기간 적용됨 · ' + _dtTxt(pFrom) + ' ~ ' + _dtTxt(pTo));
    };
    // Enter로도 확정 — 피커를 열어둔 채 키보드로 끝내는 흐름
    base.onPeriodKey = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); base.onPeriodApply(); } };
    base.onRefresh = function () { var eq2 = self._activeEq(self.state.selTag); if (eq2) { delete self._detailCache[eq2.id]; } self._rfCache = {}; self._trCacheL = {}; self._toast('새로고침 완료 · ' + E.fmtClock(Date.now())); self.setState({ dxOpen: false, dxAiText: null }); };
    var eq = this._activeEq(S.selTag);
    if (eq) {
    base.selTag = eq.id;
    var det = this._detail(eq); // 라이브 eq로 캐시 로드 + 스냅샷 프리즈
    var _dc = this._detailCache[eq.id];
    if (_dc && _dc.eqSnap) eq = _dc.eqSnap; // 이후 게이지·판정·진단·추세는 캡처 스냅샷 값 사용(실시간 미반영)
    /* 계산이 끝나기 전에는 그 사실을 밝힌다. 파형·스펙트럼·계측 검증은 조회 뒤에야 나오는데,
       그동안 화면은 경고 없이 멀쩡해 보여 "이상 없음"으로 읽힌다 — 클리핑 같은 계측 이상 경고가
       몇 초 뒤에야 뜨는 구간이 정확히 그 오독이 일어나는 구간이다. */
    base.detBusy = !!(_dc && _dc.state === 'loading');
    base.detBusyText = '분석 중 — 파형·스펙트럼과 계측 검증을 계산하고 있습니다. 아래 판정은 계산이 끝난 뒤 확정됩니다.';
    // 캡처 실패·빈 구간은 카드가 말없이 비므로 배너로 밝힌다 — 설비 문제인지 데이터 문제인지를 화면이 답한다
    base.detWarn = (_dc && _dc.state === 'error') ? '상세분석 조회에 실패했습니다 — 네트워크·DB 상태를 확인하고 새로고침하세요.'
      : (_dc && _dc.state === 'ready' && det.raw && !det.raw.values.length)
        ? '선택 구간에 원시 파형이 없습니다 — 파형·스펙트럼 카드가 비어 있습니다. 마지막 수집: ' + (eq.lastSeen ? E.fmtDT(eq.lastSeen) : '알 수 없음')
        : '';
    /* 계측 보류 — 감시가 본 사유를 우선한다. 감시는 1초 창(+롤업 버킷), 상세는 분석 창이라
       같은 순간에도 한쪽만 걸릴 수 있는데, 화면에 붙는 문구는 판정이 실제로 멈춘 이유여야 한다.
       둘 다 걸리지 않았을 때만 보류가 아니다(OR) — 한쪽만 보면 카드와 상세가 또 갈린다. */
    var _held = VC.gateReason(det.quality, ((this._runState || {})[eq.table + ':' + eq.name] || {}).gate);
    // 기간 지표 — 리포트와 같은 함수(VC.sevMetrics). 화면이 따로 계산하면 같은 설비가 두 등급으로 보인다.
    var _rf = this._rollFor(eq), _roll = _rf.roll;
    var _m = VC.sevMetrics(_roll, { zones: eq.zones, fs: eq.fs, gate: !!_held });
    var _n = _m.n;   // 통계 요약이 중앙값·P95로 바뀌며 평균·최소·최대 지역변수는 쓰이지 않는다
    // 버킷 cnt가 비어 있으면(폴백 집계) 롤업 단위 초를 건수로 갈음한다 — 스펙 패널의 '데이터 건수'용
    var _wCount = _n.cnt || _roll.length * _rf.stepSec;
    // 첨도 포화 경고 — 첨도 추이가 고점 대비 하락하나 RMS는 유지/상승이면 "회복 아님(말기)" 주의
    var _sat = this._kurtSat(eq);
    base.kurtWarnShow = !!_sat.flag; base.kurtWarn = _sat.msg || '';
    base.detTitle = eq.alias || eq.name; base.detName = eq.name; base.detUnit = eq.unit;
    base.detSpec = [
      { k: '데이터 건수', v: this._num(_wCount) + ' 건' },
      { k: '표시 구간', v: this._rangeText(_roll, S.from + ' ~ ' + S.to, _rf) },
      { k: '샘플레이트', v: (det.raw.fs / 1000).toFixed(2) + ' kHz' },
      { k: '롤업 단위', v: _rf.label }
    ];
    var g = E.STATUS[eq.grade];
    /* 보류 중에는 등급어를 지우지 않고 색만 내린다 — 정비에는 "모른다"보다 "마지막으로 무엇이었나"가
       쓸모 있다. 대신 색과 게이지가 그 등급을 현재 상태로 주장하지 않게 한다. */
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
    base.sevReco = _held ? '센서·케이블·마운팅 점검 후 재측정'
      : { 0: '정상 운전 유지 · 예방관리 지속', 1: '모니터링 강화 권고', 2: '조기 점검 권고 · 측정 주기 단축', 3: '긴급 점검 · 중요도 따라 정지 검토' }[eq.grade];
    base.sevMachine = eq.name + ' · Class ' + eq.cls + ' · ' + eq.rpm + ' RPM';
    base.sevZones = [
      { ko: '양호', color: '#3aa76d', range: '< ' + E.fmt(eq.zones[0]) },
      { ko: '주의', color: '#d99a2b', range: E.fmt(eq.zones[0]) + '–' + E.fmt(eq.zones[1]) },
      { ko: '위험', color: '#e07b39', range: E.fmt(eq.zones[1]) + '–' + E.fmt(eq.zones[2]) },
      { ko: '심각', color: '#e5484d', range: '> ' + E.fmt(eq.zones[2]) }
    /* 보류 중이면 해당 칸을 채우지 않고 테두리만 남긴다 — 채운 칸은 "지금 여기"로 읽히는데,
       그 등급은 계측이 멈추기 직전 값이다. */
    ].map(function (z, i) {
      var a = i === eq.grade, hold = a && base.sevHold;
      return { ko: z.ko, range: z.range,
        cellStyle: 'flex: 1; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; box-sizing: border-box; color: '
          + (hold ? '#8a8f99' : a ? '#fff' : 'var(--text-muted)')
          + '; background: ' + (a && !hold ? z.color : 'var(--bg-elevated)')
          + '; border-right: 1px solid var(--border-light);' + (hold ? ' box-shadow: inset 0 0 0 1.5px #8a8f99;' : ''),
        labStyle: 'flex: 1; text-align: center; font-size: 10px; color: var(--text-muted);' };
    });
    base.sevCards = this._sevCards(_m, eq.unit, _held).map(function (c) {
      var gg = E.STATUS[c.grade];
      // 등급어가 아닌 배지(잠정·참고·계측 아티팩트)에 등급 색을 입히면 색이 등급을 주장하게 된다
      return Object.assign({}, c, {
        badgeColor: c.override ? '#8a8f99' : gg.color,
        badgeSoft: c.override ? 'rgba(138,143,153,0.15)' : gg.soft,
        arrowColor: c.over ? '#e5484d' : '#3aa76d',
        style: 'border-left: 3px solid ' + (c.override ? '#8a8f99' : gg.color) + ';' });
    });
    /* 통계 요약 — 리포트와 같은 지표를 쓴다. COUNT/AVG/MIN/MAX는 진동 데이터에서 오해를 만든다:
        · MIN은 정지 구간이 섞이면 그 구간의 값이라 설비 상태와 무관하다
        · MAX는 단일 극단치(계측 스파이크 하나)에 좌우된다 — 심각도의 근거가 못 된다
        · AVG는 간헐 고진동을 평탄화해 "평소 괜찮다"로 읽히게 한다
       그래서 중앙값·P95로 대표값을 잡고, 최댓값은 "몇 개 버킷이 넘었나"로 바꿔 빈도를 같이 적는다.
       Crest는 창 크기에 따라 기대치가 달라지므로 √(2·ln N) 기준을 함께 보여준다. */
    var _rP95 = _m.p95.value, _cP95 = _m.crest.value;
    base.statRows = [
      { k: '중앙값 RMS', v: E.fmt(_n.rMed) + ' ' + eq.unit },
      { k: 'P95 RMS', v: E.fmt(_rP95) + ' ' + eq.unit },
      { k: 'B/C 초과 버킷', v: _n.overBC + '/' + _n.buckets + ' (' + (_n.buckets ? (_n.overBC / _n.buckets * 100).toFixed(1) : '0') + '%)' },
      { k: 'Crest P95', v: _cP95.toFixed(2) + ' (기준 ' + _n.cExp.toFixed(1) + ')' },
      { k: '변화율', v: '×' + _n.wTrend.toFixed(2) + (_m.trend && _m.trend.graded ? '' : ' · 등급 없음') },
      { k: '관측 창', v: Math.round(_n.durMin) + '분 · ' + _n.buckets + '버킷' },
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
    // 커토그램 — 결함 대역 자동 탐색 (포락선 앞단). 결과가 있을 때만 카드 노출
    base.kurtogramShow = !!(det.kurtogram && det.kurtogram.freqs.length);
    if (det.kurtogram && det.kurtogram.best) {
      var _khz = function (h) { return h >= 1000 ? (h / 1000).toFixed(1) + 'kHz' : Math.round(h) + 'Hz'; };
      var _kb = det.kurtogram.best;
      base.kurtogramHint = '가장 충격성이 강한 대역 ' + _khz(_kb.loHz) + '–' + _khz(_kb.hiHz) + ' · SK ' + _kb.sk.toFixed(1) + ' → 포락선을 이 대역으로 복조 (SK 클수록 결함 충격성↑)';
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
    base.qualityShow = !_q.ok && _q.issues.length > 0;
    base.qualitySevere = !!_q.severe;
    base.qualityText = _q.issues.map(function (x) { return x.label + ': ' + x.detail; }).join(' · ');
    base.envHint = det.envelope.hint; base.envFault = det.envelope.fault;
    base.envMarkers = det.envelope.markers.map(function (m) { return { label: m.label, freq: m.freq.toFixed(1) + ' Hz', color: m.kind === 'f' ? '#e5646a' : 'var(--text-muted)' }; });
    base.cepNote = det.cepstrum.note;
    var dx = this._dx(eq, det);
    base.dxVerdict = dx.verdict; base.dxSub = dx.sub; base.dxGradeKo = dx.gradeKo; base.dxColor = dx.color; base.dxSoft = dx.soft;
    /* 계산 전 판정은 빈 스펙트럼 위에서 나온 것이라 "정상"으로 보인다 — 결론 자리에 결론 대신
       진행 중임을 적는다. 등급 뱃지는 RMS 실측이라 그대로 둔다(계산과 무관하게 이미 확정된 값). */
    if (base.detBusy) { base.dxVerdict = '분석 중…'; base.dxSub = '스펙트럼·계측 검증 계산이 끝나면 판정이 확정됩니다'; }
    base.dxEvidence = dx.evidence; base.dxActions = dx.actions;
    base.dxAiIdle = !S.dxAiText || S.dxAiText === '__fallback__'; base.dxAiLoading = S.dxAiText === '__loading__'; base.dxAiFallback = S.dxAiText === '__fallback__';
    var llmOk = !!LLM.createLLM(this._llmCfg());
    base.dxLlmModel = llmOk ? this._llmLabel() : '';
    var provNames = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama' };
    base.llmProvOptions = this._llmProviders().map(function (p) { return { id: p, label: provNames[p] }; });
    base.llmProvsAvail = base.llmProvOptions.length > 0;
    base.llmProviderSel = S.llmProvider;
    base.onLlmProvPick = function (ev) { self._pickLlmProvider(ev.target.value); };
    base.dxAiText = (S.dxAiText && S.dxAiText !== '__loading__' && S.dxAiText !== '__fallback__') ? S.dxAiText : '';
    base.dxAiSections = this._parseOpinion(base.dxAiText); // 소제목 있는 상세 리포트형 렌더용
    base.onDxExplain = function () { self._dxExplain(eq); };
    base.specIndics = det.indics.map(function (d) { return { k: d.k, v: d.v, hint: d.hint || '', desc: d.desc || '' }; });
    base.detBearing = eq.bearing.n ? ('베어링 ' + eq.bearing.model + ' · N=' + eq.bearing.n) : '슬리브 베어링';
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
    var _wallNow = Date.now(); // 이벤트 TS는 벽시계 — 경과시간·24h 집계도 벽시계로 센다
    base.diag24Count = evs.filter(function (e) { return (_wallNow - e.ms) <= 86400000; }).length;
    var eta = null;
    eqs.forEach(function (e) { if (e.grade >= 1) { var f = self._forecast(e); if (f.crossMs && (!eta || f.crossMs < eta.ms)) eta = { ms: f.crossMs, alias: e.alias || e.name }; } });
    base.diagEta = eta ? E.fmtMD(eta.ms) + '경' : '해당 없음';
    base.diagEtaSub = eta ? eta.alias : '예측 구간 내 없음';
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
    base.dlOpen = S.dlOpen; base.csvFrom = S.csvFrom; base.csvTo = S.csvTo; base.dlFmt = S.dlFmt;
    base.onCsvFrom = function (ev) { self.setState({ csvFrom: ev.target.value }); };
    base.onCsvTo = function (ev) { self.setState({ csvTo: ev.target.value }); };
    base.onDlFmt = function (ev) { self.setState({ dlFmt: ev.target.value }); };
    base.onCloseDownload = function () { self.setState({ dlOpen: false }); };
    base.onDoDownload = function () { self._exportEvents(); };
    base.stopClick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); };
    base.evtTagOptions = [{ id: 'all', label: '전체 태그' }].concat(eqs.map(function (e) { return { id: e.id, label: self._tagLabel(e) }; }));
    // 실제로 생성되는 유형만 — 'spectrum'은 생성 코드가 없어 고르면 항상 0건이었다
    base.evtTypeOptions = [{ id: 'all', label: '전체 유형' }].concat(
      Object.keys(TYPEKO).map(function (k) { return { id: k, label: TYPEKO[k] }; }));
    base.evtEmpty = fEvs.length === 0;
    base.evtCount = this._evtTotal != null ? this._evtTotal : fEvs.length; // 스코프·필터 내 실제 총 건수(목록은 200캡)
    function _scroller(el) { var p = el ? el.parentElement : null; while (p) { if (p.scrollHeight > p.clientHeight + 4) { var ov = getComputedStyle(p).overflowY; if (ov === 'auto' || ov === 'scroll' || p.tagName === 'MAIN') return p; } p = p.parentElement; } return document.scrollingElement || document.documentElement; }
    function _jump(id) { return function () { var el = document.getElementById(id); if (!el) return; var c = _scroller(el); c.scrollTo({ top: c.scrollTop + el.getBoundingClientRect().top - c.getBoundingClientRect().top - 66, behavior: 'smooth' }); }; }
    base.dxOpen = !!S.dxOpen;
    var _snap = this._detailCache[S.selTag];
    base.dxStamp = this.live ? (E.fmtDT((_snap && _snap.anchor) || (_snap && _snap.snapNow) || this.data.now) + ' 시점 스냅샷 · 새로고침 시 갱신') : (E.fmtDT(this.data.now).slice(0, 10) + ' 측정 스냅샷 (0.4 s 캡처) 기준 자동 판정');
    base.dxToggleLabel = S.dxOpen ? '종합 분석 접기' : '종합 분석 펼치기';
    base.onToggleDx = function () { self.setState({ dxOpen: !self.state.dxOpen }); };
    base.evtRows = fEvs.map(function (e) {
      var g = E.STATUS[e.grade];
      /* 상세 — "얼마나"를 앞에, 그 근거를 뒤에. 열이 반쯤 산문이라 숫자열로 세울 수 없고,
         행마다 앞에 오는 것이 달라지면 왼쪽 끝을 훑어 내려갈 수가 없다.
          · 대역   — 값이 "한계 대비 비율"이라 단위가 없다(mm/s를 붙이면 절대값으로 오독된다)
          · 두절   — 지표값 자체가 없다. 0을 보여주면 "0을 측정했다"로 읽히므로 무수신 시간만 쓴다
          · 나머지 — 판정값과 그때 넘은 기준 */
      var isBand = e.type === 'band' || e.type === 'bandrec';
      var valText, noteText;
      /* 이탈한 대역이 전부 마운팅 상한 위면 '잠정'을 붙인다 — 등급이 '주의'로 묶인 이유가
         진동이 작아서가 아니라 값을 확정 근거로 못 쓰기 때문임을 목록에서 바로 읽어야 한다. */
      var _bSoft = !!(e.bands && e.bands.length) && e.bands.every(function (b) { return b.soft; });
      if (isBand) {
        valText = '×' + (e.value || 0).toFixed(2);
        noteText = (e.bands && e.bands.length)
          ? e.bands.length + '개 대역(' + e.bands.map(function (b) { return b.ko; }).join('·') + ')' + (_bSoft ? ' · 잠정' : '')
          : '전 대역 정상';
      } else if (e.type === 'signal_lost') {
        valText = e.detail || '무수신';   // 옛 이벤트는 DETAIL이 비어 있다 — 시간 없이 사실만
        noteText = '';
      } else {
        valText = E.fmt(e.value) + ' ' + e.unit;
        noteText = '기준 ' + E.fmt(e.base);
      }
      return { id: e.id, timeText: E.fmtDT(e.ms), agoText: E.ago(e.ms, _wallNow), tagAlias: e.tagAlias, tagName: e.tagName, typeKo: e.typeKo, valText: valText, noteText: noteText, gradeKo: g.ko, gradeColor: g.color, gradeSoft: g.soft,
        bandTip: (isBand && e.bands && e.bands.length)
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
    // 리포트 기간 — 앵커는 '대상 태그'. 하나도 없으면 기준이 없으니 기간 UI 자체를 내린다
    var _genEqs = S.genTags.map(function (id) { return self._eq(id); }).filter(Boolean);
    var _genCustom = S.genPeriod === 'custom';
    base.genPeriodNone = !_genEqs.length;
    base.genPeriodShow = !!_genEqs.length;
    base.genPeriodCustomShow = !!_genEqs.length && _genCustom;
    base.genPeriodPresetShow = !!_genEqs.length && !_genCustom;
    base.genPeriodPresets = this._presetChips(_genEqs, '대상 태그', 'report');
    // 프리셋은 태그마다 그 태그의 최신 데이터 기준으로 창을 다시 잡으므로(_rollForAsync) 절대 시각 대신 상대 표현으로 쓴다
    base.genPeriodSummary = S.genPeriod === 'all' ? '각 태그의 데이터 전체 구간'
      : PERIOD_H[S.genPeriod] ? '각 태그의 최신 데이터 기준 · 최근 ' + ({ '1h': '1시간', '6h': '6시간', '24h': '24시간' }[S.genPeriod] || S.genPeriod)
        : '기간을 선택하세요';
    // 상세분석과 같은 초안 → '적용' 흐름 (위 periodApply 주석 참조)
    var gFrom = S.genFromD != null ? S.genFromD : S.genFrom;
    var gTo = S.genToD != null ? S.genToD : S.genTo;
    base.genPeriodFrom = gFrom; base.genPeriodTo = gTo;
    var _gfD = Date.parse(gFrom), _gtD = Date.parse(gTo);
    var genDateInvalid = _genCustom && !isNaN(_gfD) && !isNaN(_gtD) && _gtD < _gfD;
    // 좁은 사이드 칼럼용 — datetime-local은 내재 최소폭이 커서 그냥 두면 카드를 넘친다
    base.genDateStyle = 'height: 34px; padding: 0 10px; border-radius: 6px; border: 1px solid ' + (genDateInvalid ? '#e5484d' : 'var(--border-medium)') + '; background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); width: 100%; min-width: 0; box-sizing: border-box;';
    var gDirty = _genCustom && ((S.genFromD != null && S.genFromD !== S.genFrom) || (S.genToD != null && S.genToD !== S.genTo));
    base.genApplyOff = !gDirty || genDateInvalid;
    base.genPeriodBad = genDateInvalid ? '시작이 종료보다 늦습니다' : '';
    base.genApplyStyle = 'height: 32px; padding: 0 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: ' + (base.genApplyOff ? 'default' : 'pointer')
      + '; border: 1px solid ' + (base.genApplyOff ? 'var(--border-default)' : 'var(--primary-base)')
      + '; background: ' + (base.genApplyOff ? 'var(--bg-elevated)' : 'var(--primary-base)')
      + '; color: ' + (base.genApplyOff ? 'var(--text-muted)' : '#fff') + ';';
    base.onGenFromChange = function (ev) { self.setState({ genFromD: ev.target.value }); };
    base.onGenToChange = function (ev) { self.setState({ genToD: ev.target.value }); };
    base.onGenPeriodApply = function () {
      if (genDateInvalid) { self._toast('시작 시각이 종료보다 늦습니다', 'warn'); return; }
      if (!gDirty) return;
      self._closePicker();
      self.setState({ genFrom: gFrom, genTo: gTo, genFromD: null, genToD: null });
      self._toast('리포트 기간 적용됨 · ' + _dtTxt(gFrom) + ' ~ ' + _dtTxt(gTo));
    };
    base.onGenPeriodKey = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); base.onGenPeriodApply(); } };
    // LLM 기능 게이트 = "설정 존재"(ollama 또는 API 키) — 연결 테스트는 검증용일 뿐 게이트 아님
    // (테스트 성공 여부는 세션 한정이라 새로고침 후 토글이 잠기는 문제가 있었다)
    var llmReady = !!LLM.createLLM(this._llmCfg());
    base.genLLM = S.genLLM; base.genLLMConfigured = llmReady;
    base.genToggleStyle = SWITCH_TRACK(S.genLLM && llmReady) + (llmReady ? '' : ' opacity: .5;');
    base.genKnobStyle = SWITCH_KNOB(S.genLLM && llmReady);
    /* 이 토글은 설정 탭 밖(리포트 탭)에 있어 '저장' 버튼을 거치지 않으므로 누른 즉시 저장한다.
       단 저장은 _persistView로 — 리포트 생성에만 쓰는 값이라 판정·감시와 무관한데,
       _persistCfg를 쓰면 감시·대역·감시자 타이머를 전부 다시 구워 "감시자 켜짐" 토스트까지 뜬다. */
    base.onToggleGenLLM = function () {
      if (!llmReady) { self._toast('LLM 미설정 · ⚙ 설정에서 구성하세요', 'warn'); return; }
      var on = !S.genLLM;
      self.setState({ genLLM: on });
      self._persistView(['genLLM'], { genLLM: on }); // setState 직후라 값을 직접 넘긴다
    };
    base.genLLMNotice = llmReady ? '' : 'LLM 미설정 — ⚙ 설정 → LLM 연동 구성 시 활성화';
    base.genRunning = S.genRunning;
    base.genSteps = ['데이터 조회', '지표 계산', '소견 생성', '저장'].map(function (l, i) { var st = i < S.genStep ? 'done' : (i === S.genStep ? 'active' : 'pending'); return { label: l, num: st === 'done' ? '✓' : (i + 1), dotStyle: 'width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; ' + (st === 'done' ? 'background: #2e7d5b; color: #fff;' : st === 'active' ? 'background: var(--primary-base); color: #fff;' : 'background: var(--bg-elevated); color: var(--text-muted); border: 1px solid var(--border-default);'), labelStyle: 'font-size: 13px; color: ' + (st === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)') + '; font-weight: ' + (st === 'active' ? '600' : '500') + ';' }; });
    base.onGenReport = function () { self._genReport(); };
    base.genBtnLabel = S.genRunning ? '생성 중…' : '리포트 생성';
    // 생성 중단 — 단계 목록 아래. 누르면 즉시 끝나므로 대기 라벨이 따로 없다
    base.genCancelLabel = '생성 중단';
    base.genCancelStyle = 'width: 100%; height: 34px; margin-top: 14px; border-radius: 6px; border: 1px solid var(--border-medium); background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer;';
    base.onCancelGen = function () { self._cancelGen(); };
    base.genBtnStyle = 'width: 100%; height: 40px; border-radius: 6px; border: none; font-size: 13px; font-weight: 600; color: #fff; background: var(--primary-base); cursor: ' + ((S.genTags.length === 0 || S.genRunning) ? 'not-allowed' : 'pointer') + '; opacity: ' + ((S.genTags.length === 0 || S.genRunning) ? '.5' : '1') + ';';
    var RPP = 10, rpTotal = Math.max(1, Math.ceil(S.reports.length / RPP)), rpPg = Math.min(S.rpPage || 0, rpTotal - 1);
    base.rpPagerShow = S.reports.length > RPP;
    base.rpPageText = (rpPg + 1) + ' / ' + rpTotal;
    base.onRpPrev = function () { self.setState({ rpPage: Math.max(0, rpPg - 1) }); };
    base.onRpNext = function () { self.setState({ rpPage: Math.min(rpTotal - 1, rpPg + 1) }); };
    base.rpBtnStyle = 'width: 28px; height: 28px; border-radius: 5px; border: 1px solid var(--border-default); background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer;';
    base.reportRows = S.reports.slice(rpPg * RPP, rpPg * RPP + RPP).map(function (r) { var pd = { '최근 24시간': 1, '최근 7일': 7, '최근 30일': 30 }[r.period]; var pLabel = pd ? (E.fmtDT(r.ms - pd * 86400000).slice(0, 10) + ' ~ ' + E.fmtDT(r.ms).slice(0, 10) + ' (' + (pd === 1 ? '24시간' : pd + '일') + ')') : r.period; return { id: r.id, dateText: E.fmtDT(r.ms), tagsText: r.tags.join(', '), period: pLabel, llmText: r.llm ? 'LLM 소견' : '지표만', llmBg: r.llm ? 'rgba(0,108,210,.14)' : 'rgba(255,255,255,.07)', llmColor: r.llm ? 'var(--primary-light)' : 'var(--text-muted)', onOpen: function () { self._openReport(r); }, onDelete: function () { self.setState({ delRep: r }); } }; });
    base.reportEmpty = S.reports.length === 0;
    // 모달 내부 클릭이 오버레이 닫기로 번지지 않게 막는다 — 오버레이 닫기를 쓰는 모든 모달이 공유
    base.stopClick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); };
    // 리포트 삭제 확인 — 보관함 파일은 복구할 수 없어 즉시 지우지 않는다
    base.delRepOpen = !!S.delRep;
    if (S.delRep) {
      base.delRepName = S.delRep.fname;
      base.delRepDate = E.fmtDT(S.delRep.ms);
      base.onDelRepCancel = function () { self.setState({ delRep: null }); };
      base.onDelRepDo = function () { var r = S.delRep; self.setState({ delRep: null }); self._delReport(r.id); };
    }

    this._vmSettings(base, eqs);


    return base;
  }

  /* 설정 탭 뷰모델 — renderVals에서 분리. 설정 화면만으로 350줄이라 한 함수에 두면
     다른 탭을 고칠 때도 이 덩어리를 헤집게 된다. base를 받아 채우는 형태는 그대로 두었다
     (호출 순서 의존이 남아 있어 반환형으로 바꾸면 동작이 달라질 위험이 있다). */
  _vmSettings(base, eqs) {
    var self = this, S = this.state;
    // 설비 정보 미설정 태그(새 태그) 감지 — Class/RPM/베어링 어느 것도 지정 안 됐으면 기본값 적용 중 = 업데이트 필요
    var _unsetCnt = 0;
    eqs.forEach(function (e2) { if (self._equipUnset(e2.id)) _unsetCnt++; });
    // 베이스라인 미학습 태그 감지 — 학습 가능한데 미학습인 것만 카운트(학습 불가=데이터 부족 태그는 제외)
    var _blUnCnt = 0, _blOldCnt = 0;
    var _blAll = self._blMap || S.baselines || {};
    eqs.forEach(function (e2) {
      var k2 = e2.table + ':' + e2.name;
      if (!_blAll[k2] && self._blLearnable(e2)) _blUnCnt++;
      /* 오래된 기준 — 설비 정비나 운전 조건 변경 뒤의 기준은 정상을 대표하지 않는다.
         자동 재학습은 하지 않는다(결함이 자라는 중에 갱신하면 그 결함을 정상으로 흡수한다).
         대신 설정 화면에 안 들어가도 보이게 배지로 올린다. */
      if (_blAll[k2] && agoStale(_blAll[k2].at)) { _blOldCnt++; return; }
      var _bb = self._bandBaselines(e2);
      if (_bb && VC.BAND_ORDER.some(function (bn) { return _bb[bn] && agoStale(_bb[bn].at); })) _blOldCnt++;
    });
    base.blOldCnt = _blOldCnt;
    base.equipUnsetDot = _unsetCnt > 0 || _blUnCnt > 0 || _blOldCnt > 0; // 헤더 ⚙ 표시등
    base.setNav = [{ id: 'source', label: '데이터 소스', icon: 'database' }, { id: 'equip', label: '설비 정보', icon: 'settings-gear' }, { id: 'criteria', label: '판정 기준', icon: 'dashboard' }, { id: 'monitor', label: '알람 설정', icon: 'pulse' }, { id: 'llm', label: 'LLM 연동', icon: 'sparkle' }, { id: 'data', label: '데이터 관리', icon: 'trash' }].map(function (n) { var a = S.setSection === n.id; var bd = (n.id === 'equip' && _unsetCnt > 0) ? '미설정 ' + _unsetCnt
        : (n.id === 'criteria' && _blUnCnt > 0) ? '미학습 ' + _blUnCnt
          : (n.id === 'criteria' && _blOldCnt > 0) ? '재학습 ' + _blOldCnt : ''; return { label: n.label, icon: n.icon, badge: bd, onClick: function () { self.setState({ setSection: n.id }); if (n.id === 'criteria') self._refreshBandCov(); if (n.id === 'data') self._refreshUsage(); }, style: 'display: flex; align-items: center; gap: 9px; padding: 9px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; border-left: 2px solid ' + (a ? 'var(--primary-light)' : 'transparent') + '; background: ' + (a ? 'var(--overlay-hover)' : 'transparent') + '; color: ' + (a ? 'var(--text-primary)' : 'var(--text-tertiary)') + '; font-weight: ' + (a ? '600' : '500') + ';' }; });
    base.secSource = S.setSection === 'source'; base.secEquip = S.setSection === 'equip'; base.secCriteria = S.setSection === 'criteria'; base.secMonitor = S.setSection === 'monitor'; base.secLlm = S.setSection === 'llm';
    base.secData = S.setSection === 'data';
    if (base.secData) this._dataVals(base);
    base.mcOptions = ['I', 'II', 'III', 'IV'].map(function (c) { var a = S.machineClass === c; return { label: 'Class ' + c, onClick: function () { self.setState({ machineClass: c, dirty: true }); }, style: 'flex: 1; text-align: center; padding: 10px 6px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: ' + (a ? '600' : '500') + '; border: 1px solid ' + (a ? 'var(--primary-base)' : 'var(--border-default)') + '; background: ' + (a ? 'rgba(0,108,210,.1)' : 'var(--bg-elevated)') + '; color: ' + (a ? 'var(--primary-light)' : 'var(--text-secondary)') + ';' }; });
    var mz = self._effZones({ unit: 'mm/s', cls: S.machineClass });
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
    // 전체 선택은 고를 수 있는 것만 — 미지원 table까지 담으면 저장 직후 조회가 실패한다
    var _srcOk = base.srcTables.filter(function (t) { return !t.blocked; }).map(function (t) { return t.name; });
    base.srcSelAllLabel = _srcOk.length && S.srcSel.length === _srcOk.length ? '전체 해제' : '전체 선택';
    base.onSrcSelectAll = function () {
      self.setState({ srcSel: S.srcSel.length === _srcOk.length ? [] : _srcOk.slice(), dirty: true });
    };
    base.srcTotal = base.srcTables.length;
    base.srcSelCount = base.srcTables.filter(function (t) { return t.checked; }).length;
    /* 상한 안내 — 잘린 게 있을 때만 나온다. 어느 테이블이 몇 개 잘렸는지까지 적는다:
       "몇 개 빠졌다"만으로는 어떤 테이블의 선택을 풀어야 자리가 나는지 알 수 없다. */
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
    // 상한에 걸려 감시에서 빠진 태그도 목록에는 나온다 — 다만 별칭을 달아도 쓰이지 않으므로 표시한다
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
    /* 검색 — 목록이 수십 줄이 되면 스크롤로 특정 태그를 찾는 게 사실상 불가능하다.
       원명·별칭 어느 쪽으로도 찾는다. */
    var _tq = (S.tagQuery || '').trim().toLowerCase();
    var _hit = _tq
      ? aliasRows.filter(function (r) { return r.name.toLowerCase().indexOf(_tq) >= 0 || (r.alias || '').toLowerCase().indexOf(_tq) >= 0; })
      : aliasRows;
    /* 처음에는 일부만 그리고, 바닥에 닿으면 이어 붙인다 — 태그 2,510개짜리 테이블이면 입력칸
       2,510개가 한 번에 DOM에 깔려 설정 화면이 굳는다. 페이지 번호를 쓰지 않는 이유는 이 목록의
       주 작업이 '쭉 훑으며 이름 붙이기'라서다: 페이지를 넘기면 포커스와 미저장 편집이 끊긴다.
       특정 태그를 찾는 일은 검색이 맡는다. */
    var _shown = Math.max(ALIAS_ROWS_MAX, S.aliasShown || 0);
    base.aliasRows = _hit.slice(0, _shown);
    var _rest = _hit.length - base.aliasRows.length;
    base.aliasMoreText = _rest > 0 ? '아래로 더 내리면 ' + _rest + '개가 이어집니다' : '';
    base.onAliasScroll = function (ev) {
      var el = ev.target;
      if (_hit.length <= _shown) return;                                  // 다 그렸다
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 80) return;  // 아직 바닥이 아니다
      self.setState({ aliasShown: _shown + ALIAS_ROWS_MAX });
    };
    base.tagQuery = S.tagQuery || '';
    // 검색어가 바뀌면 처음부터 — 앞 검색에서 늘려 둔 줄 수를 그대로 쓰면 필요 없이 무겁다
    base.onTagQuery = function (ev) { self.setState({ tagQuery: ev.target.value, aliasShown: ALIAS_ROWS_MAX }); };
    base.aliasCountText = _tq ? _hit.length + ' / ' + aliasRows.length + '개' : aliasRows.length + '개';
    base.aliasEmpty = _tq && !_hit.length;
    base.bModelOptions = Object.keys(VC.BEARINGS).concat(['직접 입력']);
    var _eqRows = eqs.map(function (e) {
      // 표시값: 사용자 지정 없으면 빈(미선택) — 내부 판정은 폴백(II/1800/mm\/s/베어링 미지정)으로 이미 동작
      var selCls = (S.equipCls || {})[e.id] || '';
      var selUnit = (S.equipUnit || {})[e.id] || '';
      var selRpm = (S.equipRpm || {})[e.id] != null ? String(S.equipRpm[e.id]) : '';
      var model = (S.equipBearing || {})[e.id] || '';
      var rpm = Number(selRpm) || e.rpm; // 계산용 (폴백 1800)
      var noBearing = !model;
      var isCustom = !noBearing && !VC.BEARINGS[model];
      var geo = noBearing ? { n: 0, Bd: 0, Pd: 0, phi: 0 } : (VC.BEARINGS[model] || Object.assign({}, e.bearing, S.equipGeo[e.id] || {}));
      var isSleeveB = model === 'sleeve', isCatalogB = !noBearing && !isCustom && geo.n > 0;
      var meta = (S.equipMeta || {})[e.id] || {}, belt = meta.belt || {};
      // 마운팅을 고르면 그 자리에서 "무엇이 달라지는지"를 보여준다 — 안 보이면 아무도 채우지 않는다
      var mFmax = VC.mountFmax(meta.mount);
      var kgBest = (self._detailCache[e.id] && self._detailCache[e.id].det && self._detailCache[e.id].det.kurtogram || {}).best;
      var mountNote = !meta.mount
        ? '마운팅 미상 — 고주파 대역의 유효성을 판단할 수 없어 커토그램 선택 대역을 그대로 신뢰합니다.'
        : '유효 상한 ' + (mFmax / 1000).toFixed(1) + ' kHz — 그 위 대역은 마운팅 공진일 수 있어 결함 대역 탐색에서 제외됩니다.'
          + (kgBest && kgBest.loHz > mFmax ? ' 현재 선택 대역 ' + (kgBest.loHz / 1000).toFixed(1) + ' kHz는 상한을 넘어 재선택됩니다.' : '');
      // 완성도 = 항상 해당되는 항목만(품번·마운팅·구동) + 벨트를 골랐으면 풀리경까지
      var setItems = [!!model, !!meta.mount, !!meta.drive];
      if (meta.drive === 'belt') setItems.push(!!(Number(belt.d1) > 0 && Number(belt.d2) > 0));
      var setTotal = setItems.length, setDone = setItems.filter(Boolean).length;
      var sum = VC.faultFreqSummary(rpm, geo);
      // 자동 계산 칩에도 설명을 단다 — BPFO 같은 약어는 값이 보여도 "그래서 뭘 뜻하나"가 안 읽힌다
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
        clsOptions: [{ v: '', l: '— 선택 —' }, { v: 'I', l: 'I · 소형' }, { v: 'II', l: 'II · 중형' }, { v: 'III', l: 'III · 대형·강성' }, { v: 'IV', l: 'IV · 대형·연성' }],
        rpm: selRpm, bModel: model,
        isCustom: isCustom, isSleeve: isSleeveB, isCatalog: isCatalogB, freqChips: freqChips, geoCells: geoCells, adv: !!S.equipAdv[e.id],
        // 라벨은 상태와 무관하게 하나 — 직접 입력이라는 사실은 옆의 베어링 모델 셀렉트가 이미 말한다.
        // 버튼 이름이 행마다 다르면 다른 기능으로 읽힌다(같은 패널이 열린다).
        advLabel: S.equipAdv[e.id] ? '닫기' : '설정',
        bN: geo.n, bBd: geo.Bd, bPd: geo.Pd, bPhi: geo.phi,
        bModelOptions: base.bModelOptions,
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
        onGeoN: function (ev) { self._setEquipGeo(e.id, 'n', ev.target.value); },
        onGeoBd: function (ev) { self._setEquipGeo(e.id, 'Bd', ev.target.value); },
        onGeoPd: function (ev) { self._setEquipGeo(e.id, 'Pd', ev.target.value); },
        onGeoPhi: function (ev) { self._setEquipGeo(e.id, 'phi', ev.target.value); },
        // 계측·구동 — 평상시 채울 건 마운팅·구동 두 개뿐. 나머지는 해당 설비에서만 뜬다.
        mMount: meta.mount || '', mDrive: meta.drive || '', mVanes: meta.vanes ? String(meta.vanes) : '',
        mBeltD1: belt.d1 ? String(belt.d1) : '', mBeltD2: belt.d2 ? String(belt.d2) : '', mBeltLen: belt.len ? String(belt.len) : '',
        isBelt: meta.drive === 'belt', isGear: meta.drive === 'gear',
        mountNote: mountNote, mountUnset: !meta.mount,
        // 완성도 배지 — 접힌 상태에서 "안에 더 있다"를 드러내는 유일한 신호. 세는 항목은 설비 종류와
        // 무관하게 항상 해당되는 것만: 날개수는 회전기계 중 일부만 해당해서 넣으면 영영 안 채워진다.
        setCount: setDone, setTotal: setTotal, setIncomplete: setDone < setTotal,
        mountOptions: [{ v: '', l: '— 미상 —' }, { v: 'stud', l: '스터드(나사)' }, { v: 'adhesive', l: '접착' }, { v: 'magnet', l: '자석' }, { v: 'probe', l: '핸드프로브' }],
        driveOptions: [{ v: '', l: '— 미상 —' }, { v: 'direct', l: '직결' }, { v: 'belt', l: '벨트·풀리' }, { v: 'gear', l: '기어' }],
        beltRatio: (belt.d1 > 0 && belt.d2 > 0) ? '종동축 1× ' + (sum.fr * belt.d1 / belt.d2).toFixed(1) + ' Hz (비 ' + (belt.d1 / belt.d2).toFixed(2) + ')' : '',
        vaneNote: meta.vanes > 0 ? '베인 통과 ' + (sum.fr * meta.vanes).toFixed(1) + ' Hz' : '',
        onMount: function (ev) { self._setEquipMeta(e.id, 'mount', ev.target.value); },
        onDrive: function (ev) { self._setEquipMeta(e.id, 'drive', ev.target.value); },
        onVanes: function (ev) { self._setEquipMeta(e.id, 'vanes', ev.target.value); },
        onBeltD1: function (ev) { self._setEquipBelt(e.id, 'd1', ev.target.value); },
        onBeltD2: function (ev) { self._setEquipBelt(e.id, 'd2', ev.target.value); },
        onBeltLen: function (ev) { self._setEquipBelt(e.id, 'len', ev.target.value); },
      };
    });
    /* 목록 필터 — 태그가 상한(100개)까지 차면 "어느 줄을 손봐야 하나"가 목록만 봐서는 안 보인다.
       좌측 내비 배지와 같은 기준(_equipUnset)으로 걸러, 배지를 보고 들어온 사람이 그 줄만 바로 본다.
       목록에 자체 스크롤을 두지 않는 이유는 이 표가 행을 펼치기 때문이다 — 고정 높이 안에서
       펼치면 펼친 내용이 갇힌다. 길이는 필터로 줄이고 스크롤은 페이지에 맡긴다. */
    var _eqFilter = S.equipFilter || 'all';
    var _eqMatch = { unset: function (r) { return r.unset; } };
    var _chip = function (a, dead) {
      return 'display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 6px; font-size: 12px; font-weight: '
        + (a ? '600' : '500') + '; cursor: ' + (dead ? 'default' : 'pointer') + '; border: 1px solid '
        + (a ? 'var(--primary-base)' : 'var(--border-light)') + '; background: ' + (a ? 'rgba(0,108,210,.1)' : 'var(--bg-elevated)')
        + '; color: ' + (a ? 'var(--primary-light)' : (dead ? 'var(--text-muted)' : 'var(--text-secondary)')) + ';';
    };
    /* 필터는 하나만 둔다 — "미설정"과 "설정 미완료"를 나란히 두면 이름이 비슷한 데다 앞의 것이
       뒤의 것에 포함되는 부분집합이라 같은 수가 두 번 보인다. 덜 채운 줄은 필터가 아니라 그
       행의 n/N 배지가 짚어 준다(어느 항목이 비었는지는 그 자리에서 펼쳐 봐야 하는 정보다). */
    base.equipFilters = [
      { k: 'all', label: '전체', n: _eqRows.length, tip: '' },
      { k: 'unset', label: '미설정', n: _unsetCnt, tip: '단위·Class·RPM·베어링·마운팅 어느 것도 지정하지 않아 기본값(Class II · 1800 rpm · mm/s)으로 판정 중인 태그입니다. 좌측 "미설정" 배지와 같은 기준·같은 수입니다.' },
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
    /* 일괄 적용 패널 — 열린 한 행에만 붙인다. 대상 후보는 좁은 것부터 늘어놓고 가장 좁은 것을
       기본으로 둔다: 넓은 쪽이 기본이면 한 번의 실수로 목록 전체를 덮어쓴다. */
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
      // 목록 전체는 테이블 범위와 실제로 다를 때만 — 테이블이 하나뿐이면 같은 선택지가 둘이 된다
      var _sameAsTbl = _idsShown.length === _idsTbl.length && _idsShown.every(function (id) { return _idsTbl.indexOf(id) >= 0; });
      if (_idsShown.length > 1 && !_sameAsTbl) _scopes.push({ v: 'shown', label: _eqFilter === 'all' ? '목록 전체' : '지금 걸러진 목록', ids: _idsShown });
      /* _vmSettings는 한 함수 안에서 var를 수백 줄에 걸쳐 쓴다 — 흔한 이름(_cur 등)을 쓰면 뒤쪽
         선언과 같은 바인딩이 되어, 여기서 만든 핸들러가 나중에 덮인 값을 잡는다(에러 없이 무동작).
         이 블록의 이름은 그래서 전용 접두어를 붙인다. */
      var _bkScope = null;
      _scopes.forEach(function (s) { if (s.v === _bulk.scope) _bkScope = s; });
      if (!_bkScope) _bkScope = _scopes[0] || null;
      var _sm = (S.equipMeta || {})[_bulk.id] || {}, _sbelt = _sm.belt || {};
      var MOUNT_KO = { stud: '스터드', adhesive: '접착', magnet: '자석', probe: '핸드프로브' };
      var DRIVE_KO = { direct: '직결', belt: '벨트·풀리', gear: '기어' };
      var _fSel = _bulk.fields || {};
      /* 칩 하나 = 설정 입력칸 하나. 여럿을 한 칩에 묶으면 ①값이 다 안 들어가 무엇이 복사되는지
         보이지 않고 ②일부만 켜는 선택이 사라진다(마운팅만 같고 날개수는 다른 설비가 흔하다).
         벨트 제원은 구동이 벨트일 때만, 형상 네 칸은 직접 입력일 때만 나온다 — 그때만 입력칸이다. */
      var _sgeo = (S.equipGeo || {})[_bulk.id] || {};
      var _custom = (S.equipBearing || {})[_bulk.id] === '직접 입력';
      var _isBelt = _sm.drive === 'belt', _isGear = _sm.drive === 'gear';
      var _mm = function (v) { return v > 0 ? v + ' mm' : ''; };
      var _fields = [
        { k: 'unit', label: '단위', val: (S.equipUnit || {})[_bulk.id] || '' },
        { k: 'cls', label: 'Class', val: (S.equipCls || {})[_bulk.id] || '' },
        { k: 'rpm', label: 'RPM', val: (S.equipRpm || {})[_bulk.id] ? (S.equipRpm[_bulk.id] + ' rpm') : '' },
        { k: 'bearing', label: '베어링', val: (S.equipBearing || {})[_bulk.id] || '' },
        { k: 'geoN', label: '볼 수 n', val: (_custom && _sgeo.n > 0) ? String(_sgeo.n) : '' },
        { k: 'geoBd', label: '볼경 Bd', val: _custom ? _mm(_sgeo.Bd) : '' },
        { k: 'geoPd', label: '피치경 Pd', val: _custom ? _mm(_sgeo.Pd) : '' },
        // 접촉각은 0°(깊은홈 볼베어링)가 정상값이라 형상이 있으면 값과 무관하게 내놓는다
        { k: 'geoPhi', label: '접촉각 φ', val: (_custom && _sgeo.n > 0) ? (_sgeo.phi || 0) + '°' : '' },
        { k: 'mount', label: '계측', val: MOUNT_KO[_sm.mount] || '' },
        { k: 'drive', label: '구동', val: DRIVE_KO[_sm.drive] || '' },
        { k: 'beltD1', label: '풀리 D1', val: _isBelt ? _mm(_sbelt.d1) : '' },
        { k: 'beltD2', label: '풀리 D2', val: _isBelt ? _mm(_sbelt.d2) : '' },
        { k: 'beltLen', label: '벨트길이', val: _isBelt ? _mm(_sbelt.len) : '' },
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
    /* 설비 정보 항목별 호버 도움말(네이티브 title). 라벨 달린 조각("확인 방법 · …")으로 조립하면
       툴팁에서 뚝뚝 끊겨 읽히므로, 각 항목을 완결된 문장 한 덩어리로 쓴다.
       공통 뼈대: ①무엇인지 ②어디서 알아내는지 ③비우면 어떻게 되는지. */
    base.helpTip = {
      '단위': '센서가 저장하는 물리량입니다. mm/s는 속도, g는 가속도, μm는 변위이며, 데이터를 넣을 때 이미 정해진 값이라 모르면 계측 담당자에게 확인하세요. ISO 10816 존 판정은 속도(mm/s) 기준이고, 다른 단위를 고르면 단위별 임계값으로 판정합니다.',
      'Class': 'ISO 10816 기계 등급으로, 기계의 출력과 기초 강성에 따라 정합니다. I은 소형(15 kW 이하), II는 중형(15~75 kW), III·IV는 대형(각각 강성·연성 기초)입니다. 같은 진동값이라도 등급에 따라 양호/위험 판정이 달라집니다. 비워두면 Class II 기준(1.12 / 2.80 / 7.10 mm/s)으로 판정합니다.',
      'RPM': '명판에 적힌 회전수입니다. 정확할 필요는 없습니다 — 스펙트럼에서 이 값의 ±12% 안을 뒤져 회전 피크를 찾고, 또렷하게 잡히면 실측값을 씁니다(슬립·부하로 인한 2~5% 차이는 자동 보정). 대신 자릿수는 맞아야 합니다: 3600 rpm 설비에 1800을 넣으면 찾는 범위 자체가 빗나가 실측이 안 되고, 모든 주파수 해석과 대역 경계가 절반으로 어긋납니다. 비워두면 1800 rpm으로 가정합니다.',
      '베어링 모델': '설치된 구름베어링의 품번입니다. 베어링 외륜의 각인이나 정비 이력에서 확인할 수 있습니다. 품번을 고르면 결함 주파수(BPFO/BPFI/BSF/FTF)가 자동 계산되어 베어링 결함을 판정할 수 있게 됩니다. 저널(유막) 베어링이면 sleeve를, 목록에 없는 품번이면 직접 입력을 고르세요. 비워두면 베어링 결함은 판정하지 않습니다.',
      '마운팅 방식': '센서를 기계에 붙인 방법입니다. 나사로 고정했으면 스터드, 본드로 붙였으면 접착, 자석이면 자석, 손으로 대고 재면 핸드프로브를 고르세요. 방식에 따라 믿을 수 있는 주파수 상한이 달라서(스터드 10, 접착 5, 자석 2, 프로브 1 kHz) 그보다 높은 대역은 기계가 아니라 마운팅이 울린 것으로 보고 결함 탐색에서 제외합니다. 모르면 비워두세요. 대신 고주파 분석을 제한 없이 신뢰하게 되므로, 자석 마운트라면 꼭 선택하는 것이 좋습니다.',
      '구동방식': '모터의 힘이 기계로 전달되는 방식입니다. 축이 커플링으로 바로 이어져 있으면 직결, 벨트가 보이면 벨트, 기어박스를 거치면 기어입니다. 벨트를 고르고 풀리 지름을 넣으면 종동축 회전수가 계산되어, 정체를 알 수 없던 진동 성분이 종동축 것인지 밝힐 수 있습니다.',
      '날개수 · 잇수': '펌프나 팬이면 임펠러 날개 개수, 기어 구동이면 잇수입니다. 명판이나 사양서에서 확인하세요. 날개수에 회전수를 곱한 것이 베인 통과 주파수이며, 이 성분이 크면 유동 이상이나 간극 문제를 가리킵니다. 모르면 반드시 비워두세요. 추측으로 넣으면 그 값이 그대로 판정 근거가 됩니다.',
      '벨트 제원': '풀리 두 개의 바깥지름과 벨트 총길이입니다. 풀리 지름은 자로 재면 되고, 벨트 길이는 벨트 옆면의 각인(예: A-50, 5V1200)에서 확인합니다. 지름 두 개만 있으면 종동축 회전수가 나오고, 길이까지 있으면 벨트 자체 결함(균열·결손)의 주파수도 계산됩니다.',
      /* 툴팁 문구는 전부 여기(helpTip)에 둔다 — 마크업에 직접 쓰면 줄바꿈을 넣을 방법이 없다.
         data-tip은 textContent로 렌더되므로 &#10; 같은 HTML 엔티티가 디코딩되지 않고 그대로 보인다.
         일반 JS 문자열이라 \n이 실제 줄바꿈으로 들어간다. */
      '대역 추출 주기': '대역 에너지는 시간·일 단위로 변하는 값이라 평상시엔 10분이면 충분합니다. 급변하는 사고는 전체 RMS 알람이 10초 주기로 따로 잡습니다.'
        + '\n\n다만 베이스라인 학습에는 표본 30개가 필요해 10분 주기면 5시간이 걸립니다. 처음 도입할 때는 과거 채우기로 지난 구간을 소급 추출하면 기다리지 않고 바로 학습할 수 있습니다.'
        + '\n\n40대 기준 서버 부하 — 10분 5.5% · 30분 1.8% · 1시간 0.9%',
      '전원 계통주파수': '모터에 공급되는 상용전원의 주파수로, 한국은 60 Hz입니다. 전기적 결함은 이 값의 2배(120 Hz)에서 나타나며, 기계적 결함과 달리 회전수가 변해도 움직이지 않는 것이 구분 기준입니다. 입력된 RPM이 다른 계통의 동기속도에 맞으면 경고를 표시합니다.',
      // 직접 입력(베어링 형상) — 네 값 모두 제조사 카탈로그의 기하 제원 표에 있다
      '볼 수 n': '전동체(볼 또는 롤러)의 개수입니다. 베어링 제조사 카탈로그의 형상 제원에서 확인합니다. 네 값이 모두 있어야 결함 주파수가 계산됩니다.',
      '볼경 Bd': '전동체 하나의 지름(mm)입니다. 카탈로그의 ball diameter 항목입니다.',
      '피치경 Pd': '전동체들의 중심을 잇는 원의 지름(mm)입니다. 카탈로그의 pitch diameter 항목이며, 대략 (내경+외경)÷2입니다.',
      '접촉각 φ': '전동체가 궤도면과 닿는 각도입니다. 깊은홈 볼베어링은 0°, 앵귤러 콘택트는 15~40°입니다. 모르면 0으로 두세요.',
      // 판정 기준 — 존 경계(ISO 10816)와 베이스라인 통계. 잘못 만져도 에러 없이 판정만 바뀌는 값들이라
      // "이 값이 뭘 가르나"와 "바꾸면 어떻게 되나"를 반드시 적는다.
      'A/B': 'A(양호)와 B(주의)를 가르는 경계입니다. A는 신품 수준의 진동, B는 제한 없이 장기 운전할 수 있는 수준입니다. 측정값이 이 값을 넘으면 상태가 주의로 표시됩니다.',
      'B/C': 'B(주의)와 C(위험)를 가르는 경계입니다. C부터는 장기 운전에 부적합한 수준이라 알람과 조치 권고가 여기서 갈립니다. 세 경계 중 실무에서 가장 중요한 값입니다.',
      'C/D': 'C(위험)와 D(심각)를 가르는 경계입니다. D는 기계에 손상을 일으킬 수 있는 수준으로, 긴급 점검 대상입니다.',
      '임계 초기화': '수정한 임계값을 ISO 10816 기본값으로 되돌립니다. 값을 직접 수정하면 그때부터는 규격이 아니라 사용자 정의 기준으로 판정한다는 점을 유의하세요.',
      '정상 학습 기간': '이 구간의 데이터를 "정상 상태"로 간주해 중심(μ)과 평소 변동(σ)을 학습합니다. 정지·기동 구간과 순간 스파이크는 자동으로 걸러지지만, 결함이 이미 진행 중인 기간으로 학습하면 그 결함이 정상 기준이 됩니다 — 정상 운전이 확실한 기간을 고르세요. 길수록 다양한 운전 상태가 포함돼 기준이 견고해집니다.',
      'k (σ 배수)': '평소 변동(σ)의 몇 배까지를 정상으로 볼지 정하는 값입니다. k=3이면 정상 데이터의 약 99.7%가 한계 안에 들어옵니다. 낮추면 민감해져 급증을 일찍 잡는 대신 오탐이 늘고, 높이면 그 반대입니다. 확신이 없으면 3을 그대로 두세요.',
      // 알람 — 주기·윈도우·집계는 이름만으로 구분이 안 되는 세 값이라 관계를 명시한다
      '판정 주기': '얼마나 자주 판정하는지입니다.\n3초면 3초마다 한 번씩, 그때까지의 RMS 구간을 평가합니다.\n\n짧게 하면 변화를 빨리 알지만 조회가 그만큼 늘어납니다. 조회는 테이블당 한 번이라 태그 수와는 무관합니다.',
      '평가 주기': '얼마나 자주 판정하는지입니다.\n3초면 3초마다 한 번씩, 그때까지의 RMS 구간을 평가합니다.',
      '대역 학습 기간': '대역별 정상 기준을 배울 구간입니다. 베이스라인과 따로 두는 이유는 표본 밀도가 달라서입니다 — 대역은 추출 주기마다 하나씩만 생깁니다(10분 주기면 24시간에 144개).',
      'RMS 구간': '이 구간에 들어온 원본 전체로 실효값 하나를 냅니다. 길면 짧은 진동이 하나의 상태로 합쳐지고, 짧으면 변화를 잘게 봅니다.',
    };
    // 계통주파수는 입력받되 RPM으로 검산한다 — 유도전동기 동기속도(120·f/극수)는 계통에 묶여 있어
    // 1800/3600은 60Hz, 1500/3000은 50Hz 계열이다. 자동으로 바꾸지는 않는다(사용자 입력이 우선).
    base.lineHzHint = (function () {
      var votes = { 50: 0, 60: 0 };
      eqs.forEach(function (e) {
        var r = Number((S.equipRpm || {})[e.id]); // 명판 입력값만 — 폴백 1800으로는 세지 않는다
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
    // 국내는 60 Hz 단일 계통이라 평소엔 컨트롤을 숨긴다(사실상 고정). 단 ①이미 50으로 설정됐거나
    // ②입력 RPM들이 다른 계통 동기속도에 맞으면 — 고정 전제가 틀렸다는 신호 — 그때만 경고와 함께 노출.
    base.lineHzShow = base.lineHz !== '60' || !!(base.lineHzHint && base.lineHzHint.warn);
    base.unitOptions = ['mm/s', 'g', 'μm'];
    var _clsList = ['I', 'II', 'III', 'IV'];
    /* 입력칸에는 사용자가 친 문자열을 그대로 되돌려준다 — 여기서 _effZones(파싱된 숫자)를 쓰면
       "1." 을 치는 순간 1로 바뀌어 화면에 써지면서 점이 지워진다. 안 고친 칸만 기본값을 보여준다. */
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
    /* 초기화도 다른 편집과 같은 취급 — 저장해야 확정된다.
       dirty를 안 세우면 저장 안내가 안 떠서, 되돌린 뒤 그냥 나가면 조용히 없던 일이 된다
       (화면은 기본값인데 저장된 값은 옛 값이라 다음에 들어오면 되살아난다). */
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
      // 한 줄에 들어가도록 핵심값(한계·μ·σ)만 남기고, 표본·구간·제외 내역은 호버로 내린다.
      // 줄바꿈되면 목록의 행 높이가 들쭉날쭉해져 여러 태그를 훑기 어렵다.
      /* 되살아난 태그 — 지웠다 다시 등록돼 옛 학습값이 남아 있는 상태.
         같은 설비인지 데이터로는 알 수 없으므로(이름이 유일한 단서다) 사람에게 묻고,
         답할 때까지 베이스라인·대역 판정을 멈춰 둔다. */
      var revived = !!(S.revived || {})[key];
      var status, color, statusTip = '';
      if (revived) {
        status = '학습값이 남아 있습니다 — 이전과 같은 설비인가요?';
        color = '#d99a2b';
        statusTip = '방금 추가된 이 태그에 예전 학습값(μ·σ)이 그대로 남아 있습니다.'
          + '\n\n같은 설비라면 그대로 쓰면 되지만, 다른 설비에 같은 이름을 붙인 것이라면 남의 기준으로 판정하게 됩니다.'
          + '\n새 설비가 더 조용하면 이탈이 영영 안 잡히고, 더 시끄러우면 알람이 계속 뜹니다. 둘 다 화면에는 "학습됨"으로만 보입니다.'
          + '\n\n확인할 때까지 베이스라인·대역 판정을 멈춥니다. ISO 존 등급은 절대 기준이라 계속 판정합니다.'
          + (b && b.at ? '\n\n남아 있는 학습값: μ ' + b.mu.toFixed(3) + ' · ' + self.E.fmtDT(b.at) + ' 학습' : '');
      }
      else if (busy) { status = '학습 중…'; color = 'var(--primary-light)'; }
      else if (b) {
        var ex = (b.ex && (b.ex.idle || b.ex.ramp)) ? ((b.ex.idle || 0) + (b.ex.ramp || 0)) : 0;
        status = '한계 ' + VC.baselineLimit(b).toFixed(2) + ' ' + eq.unit
          + ' · μ ' + b.mu.toFixed(2) + ' σ ' + b.sigma.toFixed(2) + ' (k=' + b.k + ')'
          + (weak ? ' · 참고용' : '');
        statusTip = '한계 = μ + kσ (최소 μ의 1.2배). 이 값을 넘으면 베이스라인 이탈 이벤트가 생성됩니다.'
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
      } else { status = '미학습'; statusTip = '학습하지 않아도 임계(존 경계) 감지는 정상 동작합니다. 학습하면 평소 대비 급증까지 감지합니다.'; color = 'var(--text-muted)'; }
      /* 되살아난 태그의 두 갈래 — 같은 설비면 유지, 다른 설비면 초기화.
         답할 때까지 판정이 멈춰 있으므로 두 버튼 다 즉시 반영된다. */
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
    /* 대역 범례 — 계열 8개가 한 축에 겹치면 작은 대역이 큰 대역에 눌려 안 보인다.
       눌러서 끄면 축 범위가 남은 계열 기준으로 다시 잡혀 그 대역의 변화가 드러난다. */
    var _bh = S.bandHide || {};
    base.bandLegend = (this._lastBandSeries || []).map(function (sr) {
      return { label: sr.label, color: sr.color, on: !_bh[sr.label],
        onClick: function () { var h = Object.assign({}, self.state.bandHide || {}); if (h[sr.label]) delete h[sr.label]; else h[sr.label] = 1; self.setState({ bandHide: h }); } };
    });
    /* 배수 축 토글 — 계열마다 크기가 네 자릿수까지 벌어져 원값으로는 작은 대역이 안 보인다.
       배수로 보면 전부 무차원이라 한 축에서 비교되고, ×1이 곧 판정선이다.

       그릴 수 있는 계열 수를 그리기 전에 센다. 그림 그리는 쪽에서 세어 두면 그 값을 읽는 것은
       다음 렌더라, 토글한 회차의 안내가 한 박자 늦은 사실을 말한다(학습이 없는데 있다고 한다). */
    var _nEq = this._activeEq(S.selTag);
    var _nBl = _nEq ? (this._bandBaselines(_nEq) || {}) : {};
    var _nAll = (this._lastBandSeries || []).length;
    var _nOk = (this._lastBandSeries || []).filter(function (sr) { return sr.key && VC.baselineLimit(_nBl[sr.key]) > 0; }).length;
    /* 나누는 수는 평소(μ)가 아니라 알람이 나는 값(max(μ+kσ, μ×1.2))이다. 그래서 1.0이 곧
       알람선이고, 0.88은 "평소의 0.88배"가 아니라 "알람 기준의 88%"다 — 평소보다 높을 수 있다.
       "한계"·"μ+kσ" 같은 말 대신 알람으로 부르는 이유가 그것이다: 사용자가 이 눈금에서 알고 싶은
       것은 통계량이 아니라 "알람까지 얼마나 남았나"다. */
    base.bandNorm = !!S.bandNorm;
    base.bandNormReady = _nOk > 0;
    base.bandNormLabel = base.bandNorm ? '원값으로 보기' : '알람 기준으로 보기';
    /* 학습이 하나도 없으면 켜지 않는다 — 켜면 나눌 기준이 없어 빈 차트가 나오는데, 그건
       "정상"으로 읽히거나 고장으로 읽힌다. 무엇이 필요한지 말해 주고 원값을 유지한다. */
    base.onBandNorm = function () {
      if (!self.state.bandNorm && !(_nOk > 0)) {
        self._toast('대역 베이스라인 학습이 필요한 기능입니다 — 판정 기준에서 먼저 학습하세요', 'warn');
        return;
      }
      self.setState({ bandNorm: !self.state.bandNorm });
    };
    // 일부만 학습됐으면 그대로 그리되 몇 개가 왜 빠졌는지 말해 준다
    base.bandNormNote = (base.bandNorm && _nOk)
      ? '알람이 나는 값을 1.0으로 놓고 본 비율 — 1.0을 넘으면 이탈'
        + (_nOk < _nAll ? ' · 학습되지 않은 ' + (_nAll - _nOk) + '개 계열은 빠집니다' : '')
      : '';
    base.onBlLearnAll = function () { blEqs.forEach(function (eq) { if (self._blLearnable(eq)) self._learnBaseline(eq); }); };
    /* 확인 대기 중인 태그 수 — 목록을 훑지 않고도 "몇 개가 막혀 있는지" 보이게 한다.
       답할 때까지 그 태그들은 학습 기반 판정이 멈춰 있다. */
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
    var llmReady2 = !!LLM.createLLM(this._llmCfg());
    base.llmStatusText = (S.llmConfigured ? '연결됨' : (llmReady2 ? '설정됨 · 테스트 권장' : '미설정')) + (llmReady2 ? ' — ' + this._llmLabel() : '');
    base.llmStatusColor = S.llmConfigured ? '#3aa76d' : (llmReady2 ? '#d99a2b' : 'var(--text-muted)');
    base.monitorOn = S.monitorOn;
    base.monToggleStyle = SWITCH_TRACK(S.monitorOn);
    base.monKnobStyle = SWITCH_KNOB(S.monitorOn);
    base.onMonToggle = function () { self.setState({ monitorOn: !S.monitorOn, dirty: true }); };
    /* 판정 주기(얼마나 자주)와 RMS 구간(얼마나 넓게)은 다른 축이다.
       구간이 주기보다 짧으면 그 사이 데이터가 판정에 한 번도 안 들어간다 — 주기보다 짧은 구간은 고를 수 없게 막는다. */
    var _ivMs = durMs(S.monitorInterval) || 3000;
    base.evalWindow = S.evalWindow;
    /* 프리셋 + 직접 입력 — 진동 주기는 현장마다 다르므로(부하 변동·간헐 운전 주기)
       고정 후보로는 못 덮는다. 감지가 "N분 이상"을 권고하면 그 값을 바로 넣을 수 있어야 한다. */
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
      // 직접 입력으로 전환 — 현재 값을 분으로 환산해 시작점으로 둔다
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
    // 알람 동작(시나리오) — 진입 확인·복귀 유지·지속 재알림
    base.escHold = S.escHold; base.recHold = S.recHold;
    base.escHoldOptions = [{ v: '0', l: '즉시' }, { v: '30s', l: '30초' }, { v: '1m', l: '1분' }, { v: '2m', l: '2분' }, { v: '5m', l: '5분' }];
    base.recHoldOptions = [{ v: '0', l: '즉시' }, { v: '1m', l: '1분' }, { v: '5m', l: '5분' }, { v: '10m', l: '10분' }];
    base.onEscHold = function (ev) { self.setState({ escHold: ev.target.value, dirty: true }); };
    base.onRecHold = function (ev) { self.setState({ recHold: ev.target.value, dirty: true }); };
    var RENO_OPTS = [{ v: '0', l: '끔' }, { v: '30m', l: '30분' }, { v: '1h', l: '1시간' }, { v: '2h', l: '2시간' }, { v: '6h', l: '6시간' }];
    base.renotifyOptions = RENO_OPTS;
    // 베이스라인 미학습 경고(판정기준 카드) — 학습 가능한데 미학습인 태그 수 (setNav의 _blUnCnt와 동일 기준)
    base.monBlUnlearned = _blUnCnt;
    base.monBlNotice = _blUnCnt > 0;
    var _wl = durKo(durMs(S.evalWindow));
    base.evalBasisText = _wl + ' 구간 RMS';
    /* 주기를 바꾸면 조회 부하가 그만큼 달라진다 — 미리 보여준다.
       값은 판정 틱이 실제로 잰 소요(_tickCostMs)를 쓴다. 첫 틱 전에는 태그 수 선형 모델로 추정하되,
       이 상수는 환경에 따라 크게 달라지므로 추정은 잠깐만 쓰인다. */
    var _nTbl = (S.srcSel || []).length || 1;
    var _nTag = this._activeEqs().length;
    var _measured = this._tickCostMs != null;
    var _cost = Math.round(_measured ? this._tickCostMs : _nTbl * 5 + _nTag * 0.35);
    var _duty = _ivMs > 0 ? _cost / _ivMs * 100 : 0;
    base.evalLoadText = '조회에 회차당 ' + _cost + 'ms' + (_measured ? '(실측)' : '(예상)')
      + '가 걸려 주기의 ' + _duty.toFixed(0) + '%를 씁니다'
      + (_duty >= 100 ? ' — 다음 회차를 밀어냅니다. 주기를 늘리십시오.' : ' — 주기를 늘리는 것을 권합니다.');
    base.evalLoadWarn = _duty >= 50;
    // 구간이 주기보다 짧으면 데이터에 구멍이 생긴다 — 저장 전에 화면에서 막는다
    base.evalWinBad = durMs(S.evalWindow) < _ivMs;
    /* 학습 구간이 지금과 달라도 배너를 띄우지 않는다 — 값 차이가 무시할 수준이라
       고칠 것 없는 경고가 진짜 경고를 묻는다. 정보는 태그별 툴팁에 "N초 구간 기준"으로 남긴다. */
    /* 채널은 웹훅 하나다 — jsh에 SMTP가 없어 직접 발송은 불가능하고,
       되는 길(HTTP API·자동화 도구 경유)은 전부 웹훅 URL로 표현된다. */
    base.notifChannels = [
      { key: 'webhook', label: '웹훅', hint: 'Slack · Teams · Discord · Google Chat · 자체 엔드포인트 — 이메일·문자는 n8n 등 자동화 도구를 이 URL로 받아 중계', ph: 'https://hooks.slack.com/services/…', ready: true }
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
    /* 심각도별 알림 — 방식(즉시/알림 안 함)과 재알림 주기를 한 표에.
       같은 심각도 3행을 두 카드에 따로 그리던 것을 합쳤다(사용자 제안).
       재알림은 '알림 안 함'이어도 남겨 둔다 — sustained 이벤트는 발송과 별개로 이력에 쌓인다. */
    var ROUTE_META = [{ ko: '주의', color: '#d99a2b' }, { ko: '위험', color: '#e07b39' }, { ko: '심각', color: '#e5484d' }];
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
        reno: (S.renotify || {})[mt.ko] || '0',
        onReno: function (ev) { var all = Object.assign({}, S.renotify); all[mt.ko] = ev.target.value; self.setState({ renotify: all, dirty: true }); },
      };
    });
    // 채널은 켰는데 전 심각도가 '알림 안 함' — 한 건도 안 나가는 상태라 경고
    base.routeNoneWarn = !!S.notifCh.webhook && !ROUTE_ORDER.some(function (k) { return _routes[k].timing === '즉시'; });
    /* 대역 베이스라인 — 베이스라인 카드와 같은 형태(태그별 상태 + 학습/삭제).
       자동 학습을 하지 않는 이유: 데이터가 쌓였다고 알아서 학습하면 그 순간 설비가 이상해도
       그것을 "정상"으로 굳힌다. "지금이 정상이다"는 사람이 판단해야 하고, 그 판단을 버튼으로 받는다. */
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
        /* 분모는 "측정 가능한 대역 수"다 — 샘플레이트가 낮아 존재하지 않는 대역까지 세면
           영영 도달할 수 없는 5/5를 목표로 보여주게 된다(1 kHz 샘플링이면 초고주파가 빈 대역). */
        var _d0 = (self._detailCache[eq.id] || {}).det;
        var _fr0 = (_d0 && _d0.frMeas && _d0.frMeas.f > 0) ? _d0.frMeas.f : (eq.rpm / 60);
        /* 분모 = 주파수 대역 + 이 태그에서 성립하는 포락선 계열. 분자(learned)가 포락선까지 세므로
           분모가 대역 8개만 세면 12/8처럼 분자가 분모를 넘는다. 포락선은 복조 대역이 성립해야
           주기성 1계열이 생기고, 베어링 품번까지 있으면 결함주파수 3계열이 더 생긴다. */
        var _mnt = ((S.equipMeta || {})[eq.id] || {}).mount || (eq.meta || {}).mount;
        var envAble = VC.demodBand(eq.fs, _mnt) ? (1 + (VC.faultCoeffs(self._bearingGeo(eq)) ? 3 : 0)) : 0;
        var able = VC.BAND_FREQ.filter(function (bn) { return VC.bandMeasurable(bn, _fr0, eq.fs); }).length + envAble;
        status = learned + '/' + able + ' 계열 학습됨 · ' + parts.map(function (bn) { return VC.BAND_KO[bn]; }).join('·');
        tip = parts.map(function (bn) {
          var b = bls[bn];
          return VC.BAND_KO[bn] + '  μ ' + b.mu.toFixed(4) + ' · σ ' + b.sigma.toFixed(4) + ' → 한계 ' + VC.baselineLimit(b).toFixed(4) + '  (표본 ' + (b.n || '?') + ')';
        }).join('\n');
        /* 빠진 대역과 그 이유 — 학습된 것만 나열하면 "왜 4/5냐"를 물어봐야 알 수 있다.
           측정 불가(대역 하한이 Nyquist 이상)는 고칠 수 없는 것이므로 그렇게 말해준다. */
        var miss = VC.BAND_ORDER.filter(function (bn) { return !bls[bn]; });
        if (miss.length) {
          tip += '\n\n학습 안 됨\n' + miss.map(function (bn) {
            // 대역 경계는 주파수 대역(BAND_FREQ)에만 있다 — 포락선 계열은 인덱스가 8 이상이라 경계가 없다
            var fi = VC.BAND_FREQ.indexOf(bn);
            var e = (fi >= 0 && _fr0 > 0 && eq.fs > 0) ? VC.bandEdges(_fr0, eq.fs / 2)[fi] : null;
            if (e && !VC.bandMeasurable(bn, _fr0, eq.fs)) {
              return VC.BAND_KO[bn] + '  측정 불가 — 하한 ' + Math.round(e[0]) + ' Hz > Nyquist '
                + Math.round(eq.fs / 2) + ' Hz (샘플레이트 ' + eq.fs + ' Hz)';
            }
            if (fi < 0 && !VC.demodBand(eq.fs, _mnt)) return VC.BAND_KO[bn] + '  복조 대역 불성립 — 샘플레이트가 낮거나 마운팅 상한이 낮습니다';
            if ((bn === 'envBPFO' || bn === 'envBPFI' || bn === 'envBSF') && !VC.faultCoeffs(self._bearingGeo(eq)))
              return VC.BAND_KO[bn] + '  베어링 품번 미지정 — 설비 정보에서 품번을 넣으면 쌓이기 시작합니다';
            return VC.BAND_KO[bn] + '  표본 부족 또는 학습 실패';
          }).join('\n');
        }
        tip += '\n\n이 한계를 넘으면 대역 이탈 이벤트가 생성됩니다. 배수 ×1.5 이상이면 위험, ×3.0 이상이면 심각입니다.';
        var _ats = parts.map(function (bn) { return bls[bn].at || 0; }).filter(Boolean);
        var _at = _ats.length ? Math.max.apply(null, _ats) : 0;
        if (_at) tip += '\n\n학습 시점 ' + self.E.fmtDT(_at)
          + (agoStale(_at) ? '\n⚠한 달이 넘었습니다 — 그 사이 정비나 운전 조건 변경이 있었다면 다시 학습하십시오.' : '');
        _bandAt = _at;
        color = learned < VC.BAND_ORDER.length ? '#d99a2b' : 'var(--text-secondary)';
      } else {
        status = '미학습 — 대역 이탈 판정 안 함';
        tip = '대역값이 최소 ' + VC.BASELINE_MIN_N + '개 쌓여야 학습됩니다. 추출 주기 10분이면 약 5시간, 1분이면 30분이 걸립니다.';
        color = 'var(--text-muted)';
      }
      /* 채움 칩 — 학습 창 안이 얼마나 찼는지. 학습 상태와는 별개다:
         "안 찼다"는 재료가 없다는 뜻이고 "미학습"은 재료는 있는데 기준을 안 잡았다는 뜻이라,
         둘을 한 줄로 합치면 무엇을 해야 할지 알 수 없다. */
      var cv = (S.bandCov || {})[base2];
      var fill = null;
      if (cv) {
        var enough = cv.have >= VC.BASELINE_MIN_N;
        /* 분모를 안 보여준다 — 격자 경계 때문에 100%는 원리적으로 안 나온다
           (창 시작이 칸 중간을 자르고, 지금 칸은 아직 추출 전이며 직전 칸은 적재 지연).
           판단에 필요한 건 "학습에 충분한가"이므로 상태와 개수만 남긴다. */
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
    /* 채우기 대상 — 회전주파수가 없으면 대역을 정의할 수 없어 제외된다.
       화면에 안 쓰면 "왜 6개 중 1개만 채워지나"를 알 수 없다.
       plan은 아래 과거 채우기 블록에서 선언되므로 여기서는 따로 구한다(호이스팅 함정 회피). */
    var _bplan = self._bandPlan(), _skip = _bplan.skipped || [];
    base.bandFillTargets = _bplan.tags.length + '/' + (_bplan.tagTotal || _bplan.tags.length);
    base.bandFillSkipTip = _skip.length
      ? '제외 ' + _skip.length + '개 — ' + _skip.map(function (x) { return x.label + ' (' + x.why + ')'; }).join(', ')
        + '\n\n대역 경계가 회전주파수의 배수로 정의되므로(0.5× · 1.5× · 10×) RPM 없이는 대역을 나눌 수 없습니다. 설비 정보에서 RPM을 입력하십시오.'
      : '';
    /* 추출 주기 × 학습 기간 = 표본 수. 두 값이 다른 카드에 있어 관계가 안 보이는데,
       곱이 최소 표본에 못 미치면 학습이 실패한다 — 눌러보고 알게 되지 않도록 미리 보여준다. */
    var _bIv = durMs(S.bandInterval) || 600000;
    var _bH = BAND_WIN_H[S.bandWin] || 24;
    var _bN = Math.floor(_bH * 3600000 / _bIv);
    var _bOk = _bN >= VC.BASELINE_MIN_N;
    base.bandWin = S.bandWin || '24h';
    base.bandWinOptions = [{ v: '6h', l: '최근 6시간' }, { v: '24h', l: '최근 24시간' },
      { v: '3d', l: '최근 3일' }, { v: '7d', l: '최근 7일' }];
    /* 기간이 바뀌면 칸 수가 달라지므로 현황을 다시 읽는다 — 단 setState 콜백에서 읽어야 한다.
       preact의 setState는 배치되어, 바로 뒤에서 조회하면 _bandPlan이 아직 옛 기간을 본다
       (24시간으로 바꿨는데 칩은 /432를 보여주는 식으로 한 박자 늦는다). */
    base.onBandWin = function (ev) {
      var v = ev.target.value;
      self.setState({ bandWin: v, dirty: true });
      self._refreshBandCov({ bandWin: v });   // 새 값으로 바로 — state 반영을 기다리지 않는다
    };
    base.bandSampleWarn = !_bOk;
    // 표본 수는 추출 주기 × 학습 기간의 곱이라 두 값을 같이 보여줘야 왜 부족한지 알 수 있다
    base.bandSampleText = (IV_KO[S.bandInterval] || S.bandInterval) + '마다 추출하므로 표본 ' + _bN + '개'
      + (_bOk ? '' : ' — 최소 ' + VC.BASELINE_MIN_N + '개가 필요해 학습되지 않습니다. 추출 주기를 줄이거나 학습 기간을 늘리십시오.');
    // RMS 쪽 표본도 같은 방식으로 — 판정 구간 단위로 묶어 세므로 구간이 길면 표본이 준다
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
    // 남은 칸 기준으로 안내한다 — 이미 찬 칸은 다시 계산하지 않으므로 "전체 개수"는 사실과 다르다
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
        /* 채우는 구간은 대역 학습 기간이다(_bandPlan이 BAND_WIN_H를 쓴다) — 문구도 그 값을 말해야 한다.
           베이스라인 기간을 말하면 실제 동작과 다른 안내가 된다. */
        : left === 0 ? '최근 ' + _bandWinKo + ' 구간이 모두 채워져 있습니다 · 태그 ' + fullTags + '개.'
          : '이미 쌓인 원본에서 최근 ' + _bandWinKo + '을 ' + base.bandIntervalKo
            + ' 간격으로 계산합니다 · 남은 ' + left + '개 · 약 ' + fmtDur(left * BAND_PER_MS)
            + (fullTags ? ' (태그 ' + fullTags + '개는 이미 완료 — 건너뜁니다)' : '')
            + '. 최신부터 채우므로 중간에 멈춰도 채운 만큼 학습에 씁니다.';
    base.bandFillNone = left === 0 && !!covM;
    // 행에는 결론만 — 근거(무엇을 어떻게 채우는지)는 위 설명 툴팁으로 내린다
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
    /* 회차보다 짧은 주기는 고를 수 없게 한다 — 태그가 많으면 한 회차(태그당 약 1초)가 주기를 넘겨
       회차가 겹쳐 서로 밀다가 한 번도 완주하지 못한다.
       못 쓰는 선택지는 잠그고 이유를 라벨에 적되, 규모에 따라 달라지는 값이라 목록에서 빼지는 않는다. */
    var _bandN = (this._bandSpec().tags || []).length;
    var _passSec = Math.round(_bandN * BAND_TAG_SEC);
    base.bandPassSec = _passSec;
    base.bandIvOptions = [
      { v: '10m', l: '10분', sec: 600 }, { v: '30m', l: '30분', sec: 1800 }, { v: '1h', l: '1시간', sec: 3600 },
    ].map(function (o) {
      // 여유 2배 — 딱 맞으면 태그가 몇 개만 늘어도 바로 겹친다
      var bad = _passSec > 0 && o.sec < _passSec * 2;
      return { v: o.v, l: bad ? o.l + ' — 회차(' + _passSec + '초)보다 짧음' : o.l, disabled: bad };
    });
    base.bandIvHint = _passSec > 0
      ? '감시 태그 ' + _bandN + '개 → 한 회차 약 ' + _passSec + '초. 그보다 짧은 주기는 회차가 겹쳐 아무것도 쌓이지 않습니다.'
      // 10분이 하한인 이유를 여기서 한 번 말한다 — 선택지에서 사라진 것을 사용자가 설명 없이 마주치지 않게
      : '추출 창이 샘플레이트에 따라 최대 4분대라 그보다 짧은 주기는 같은 구간을 겹쳐 잽니다. 급격한 이상은 광대역 감시가 초 단위로 따로 봅니다.';
    /* 드롭다운에서 고르면 바로 적용하지 않고 확인 절차를 연다 — 주기를 바꾸면 이전 구간과
       밀도가 갈려 학습이 편향될 수 있고, 이미 채운 값의 간격과도 어긋난다. */
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
    base.routeTimings = ['즉시', '알림 안 함']; // 묶음(digest)은 미구현 — 동작 안 하는 선택지를 두지 않는다
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
