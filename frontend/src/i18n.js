/* 화면 언어 — 한국어 원문이 키, en·ja 사전에 없으면 원문 그대로
   · 자리표시 {0}{1}… 은 T()의 뒤 인자 순서
   · 저장은 localStorage(토큰 입력 전 화면에서도 바꿈), 없으면 브라우저 언어 · 지원 밖이면 영어
   · 알림·LLM 프롬프트·서버 타이머 문구는 한국어 유지 — 화면과 같은 생성 함수를 부르는 곳은 withLang('ko', …)
   · 리포트는 한국어로 조립하고 report.js가 생성 시작 때 언어로 번역(앱의 _rptI18n) */
import EN from './i18n/en.js';
import JA from './i18n/ja.js';
import TxCore from '../../cgi-bin/i18n/tx.js';

// 이름은 각 언어 표기 — 못 읽는 언어로 바꿔도 되돌릴 수 있게
export var LANGS = [
  { id: 'ko', label: '한국어', short: 'KO' },
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'ja', label: '日本語', short: 'JA' },
];
var DICTS = { en: EN, ja: JA };
var STORAGE_KEY = 'vibeLang';

function isLang(v) { return v === 'ko' || v === 'en' || v === 'ja'; }

// 브라우저 밖(테스트·서버)은 한국어 — 기존 검사가 한국어 문구를 단언함
function detect() {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return 'ko';
  var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (var i = 0; i < list.length; i++) {
    var base = String(list[i] || '').toLowerCase().slice(0, 2);
    if (isLang(base)) return base;
  }
  return 'en';
}

function read() {
  try { var saved = localStorage.getItem(STORAGE_KEY); if (isLang(saved)) return saved; } catch (e) {}
  return detect();
}

var current = read();
var listeners = [];

export function getLang() { return current; }

export function setLang(lang) {
  if (!isLang(lang) || lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  listeners.slice().forEach(function (fn) { fn(lang); });
}

export function onLangChange(fn) {
  listeners.push(fn);
  return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
}

export function initLang() { if (typeof document !== 'undefined') document.documentElement.lang = current; }

// 엔진·프롬프트처럼 화면 언어와 무관하게 한국어여야 하는 동기 구간 · 리포트 번역기처럼 특정 언어로 고정할 때도
export function withLang(lang, fn) {
  var prev = current;
  current = lang;
  try { return fn(); } finally { current = prev; }
}

function fill(s, args) {
  return s.replace(/\{(\d+)\}/g, function (m, i) { return i < args.length ? String(args[i]) : m; });
}

function lookup(key) {
  var d = DICTS[current];
  return d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : null;
}

/* 같은 한국어가 뜻이 갈리면 키 끝에 {#문맥} — 한국어 출력에서는 지움(예: '선택{#입력란}' = 선택 입력란 placeholder)
   빈 번역('')도 유효 — 영어에 없는 수량 접미사('개' 등) */
var CTX = /\{#[^}]*\}/g;

export function T(key) {
  var args = Array.prototype.slice.call(arguments, 1);
  var hit = current === 'ko' ? null : lookup(key);
  var s = hit != null ? hit : key.replace(CTX, '');
  // 인자도 tx — 엔진·공유 모듈이 만든 한국어 값(계측 사유·등급어·대역명 등)이 번역 문장 안에 섞이지 않게
  return args.length ? fill(s, current === 'ko' ? args : args.map(tx)) : s;
}

// 상태에 저장해 두고 그리는 문구(인증·권한·발송 결과 등) — 한국어로 저장, 표시할 때 tx() → 저장 뒤 언어를 바꿔도 따라감
export function Tk() {
  var args = arguments;
  return withLang('ko', function () { return T.apply(null, args); });
}

/* 이미 만들어진 문구 번역 — 진단 엔진 결과·저장된 이벤트 사유·공유 모듈(calc 등)처럼 T()를 못 거친 값
   알고리즘은 cgi-bin/i18n/tx.js(서버 감시 알림과 공용) — 언어별 엔진(캐시 포함)을 처음 쓸 때 만듦 */
var HAN = /[가-힣]/;
var _eng = {};
function engine() { return _eng[current] || (_eng[current] = TxCore.makeTx(DICTS[current] || {}, current === 'en')); }

export function tx(s) {
  if (current === 'ko' || typeof s !== 'string' || !s || !HAN.test(s)) return s;
  return engine().tx(s);
}

// 언어별 사전 — 서버 감시 알림용 부분 사전(TxCore.pickFor) 만들 때
export function dictOf(lang) { return DICTS[lang] || null; }

// 표시 전용 모델(리포트 sevModel·진단 근거 목록 등)의 문자열 전부를 tx — 원본은 그대로(판정 비교용)
export function txAll(v) {
  if (current === 'ko' || v == null) return v;
  if (typeof v === 'string') return tx(v);
  if (Array.isArray(v)) return v.map(txAll);
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = txAll(v[k]); });
    return o;
  }
  return v;
}
