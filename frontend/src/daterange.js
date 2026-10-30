// 기간 선택 위젯 — 트리거 버튼 + 팝오버 달력(화면 공용)
// 고른 값은 '적용' 시에만 onApply로 전달(편집 중 조회 없음, 취소 시 원래 기간 유지)
import { Component } from 'preact/compat';
import { html } from './html.js';
import CH from '../../cgi-bin/chart/chart.js';
import { T, getLang } from './i18n.js';

/* 열린 팝오버 수 — app.js 틱이 참조해 열려 있는 동안 자동 갱신 중지(고르는 중 값 되돌림 방지) */
export var pickerOpen = { n: 0 };

// 요일·달 제목은 언어별 표기 — 낱자 키('일'·'월')는 '일(day)'·'월(month)'과 겹침
var WD = { ko: ['일', '월', '화', '수', '목', '금', '토'], en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], ja: ['日', '月', '火', '水', '木', '金', '土'] };
var MON_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthTitle(y, m) {
  var l = getLang();
  return l === 'en' ? MON_EN[m - 1] + ' ' + y : l === 'ja' ? y + '年' + m + '月' : y + '년 ' + m + '월';
}
var CELL = 30;           // 날짜 칸 너비(px) — 달 하나 = 7칸
var MONTH_W = CELL * 7;
var PANEL_PAD = 14;
var MONTH_GAP = 18;

function pad(n) { return (n < 10 ? '0' : '') + n; }
// 날짜 계산은 전부 표시 시간대 기준(CH.parts·makeTime) — 브라우저 시간과 다를 수 있음
// 'YYYY-MM-DD[THH:MM]' → ms
function parseLocal(s) { return CH.parseDT(s); }
function fmtVal(ms, withTime) {
  var p = CH.parts(ms);
  var s = p.Y + '-' + pad(p.M) + '-' + pad(p.D);
  return withTime ? s + 'T' + pad(p.h) + ':' + pad(p.m) : s;
}
function dayStart(ms) { return CH.startOfDay(ms); }
function monthStart(ms) { var p = CH.parts(ms); return CH.makeTime(p.Y, p.M, 1); }
function addMonths(ms, n) { var p = CH.parts(ms); return CH.makeTime(p.Y, p.M + n, 1); }
function hhmm(ms) { var p = CH.parts(ms); return pad(p.h) + ':' + pad(p.m); }
// 날짜(그 날 0시) + 'HH:MM' → ms, 시각 형식이 불완전하면 fb 사용
function joinTime(dayMs, t, fb) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) m = /^(\d{1,2}):(\d{2})$/.exec(fb);
  var p = CH.parts(dayStart(dayMs));
  return CH.makeTime(p.Y, p.M, p.D, m ? Math.min(23, +m[1]) : 0, m ? Math.min(59, +m[2]) : 0);
}
/* 펼칠 달 — 두 달이면 끝 달을 오른쪽에(데이터가 과거 방향이라 앞달을 왼쪽에 미리 표시) */
function viewFor(fromMs, toMs, months) {
  return months === 2 ? addMonths(monthStart(toMs), -1) : monthStart(fromMs);
}
function spanText(ms) {
  if (!(ms > 0)) return '';
  var mi = Math.round(ms / 60000);
  if (mi < 60) return T('{0}분', mi);
  var h = ms / 3600000;
  if (h < 48) return T('{0}시간', h < 10 ? h.toFixed(1) : String(Math.round(h)));
  var d = h / 24;
  return T('{0}일', d < 10 ? d.toFixed(1) : String(Math.round(d)));
}
/* 팝오버 시각 입력 여부 — mode='date'면 기본 날짜만, showTime으로 재지정
   (일 단위로 고르되 값은 날짜+시각 형식으로 내보내는 자리 있음) */
function useTime(p) { return p.showTime != null ? !!p.showTime : p.mode !== 'date'; }
// 하루 경계(00:00~23:59)에 맞는 구간 여부 — 달력으로 고른 구간 판별
function dayBounded(f, t) {
  var a = CH.parts(f), b = CH.parts(t);
  return a.h === 0 && a.m === 0 && b.h === 23 && b.m === 59;
}
// 트리거 버튼 기간 문구 — 연도 항상 표기
function rangeLabel(f, t, withTime) {
  var one = function (ms) {
    var p = CH.parts(ms);
    var s = p.Y + '-' + pad(p.M) + '-' + pad(p.D);
    return withTime ? s + ' ' + pad(p.h) + ':' + pad(p.m) : s;
  };
  return one(f) + ' ~ ' + one(t);
}

export class DateRange extends Component {
  constructor(props) {
    super(props);
    this.state = { open: false, fromDay: 0, toDay: 0, ft: '00:00', tt: '23:59', view: 0, months: 2, pick: 0, hover: 0, left: 0, top: 0, notice: '' };
    this._onKey = this._onKey.bind(this);
    this._toggle = this._toggle.bind(this);
    this._cancel = this._cancel.bind(this);
    this._apply = this._apply.bind(this);
  }
  componentWillUnmount() {
    clearTimeout(this._noticeT);
    if (this.state.open) { pickerOpen.n = Math.max(0, pickerOpen.n - 1); document.removeEventListener('keydown', this._onKey, true); }
  }
  /* 팝오버 높이는 어림값으로 배치 후 그린 뒤 실제 높이로 1회 보정 — 화면 아래쪽 트리거에서 '적용' 잘림 방지 */
  componentDidUpdate() {
    if (!this.state.open || !this._panelEl) return;
    var h = this._panelEl.offsetHeight, vh = window.innerHeight;
    if (this.state.top + h <= vh - 8 || this._fixed) return;
    var r = this._btnEl ? this._btnEl.getBoundingClientRect() : null;
    var top = r && r.top - h - 6 >= 8 ? r.top - h - 6 : Math.max(8, vh - h - 8);
    this._fixed = true;
    this.setState({ top: top });
  }
  _open() {
    var p = this.props, ut = useTime(p);
    var now = Date.now();
    var f = parseLocal(p.from), t = parseLocal(p.to);
    if (isNaN(t)) t = now;
    if (isNaN(f)) f = t - 86400000;
    var months = window.innerWidth < 620 ? 1 : 2;
    var w = PANEL_PAD * 2 + MONTH_W * months + (months - 1) * MONTH_GAP;
    var r = this._btnEl ? this._btnEl.getBoundingClientRect() : { left: 20, right: 20, bottom: 60, top: 20 };
    var left = p.align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    // 펼칠 달을 데이터 있는 쪽으로 당김(열자마자 빈 달 방지)
    var bd = this._bounds();
    var view = viewFor(f, t, months);
    if (bd.maxD) view = Math.min(view, addMonths(monthStart(bd.maxD), -(months - 1)));
    if (bd.minD) view = Math.max(view, monthStart(bd.minD));
    this._fixed = false;
    pickerOpen.n++;
    document.addEventListener('keydown', this._onKey, true);
    this.setState({
      open: true, fromDay: dayStart(f), toDay: dayStart(t),
      ft: ut ? hhmm(f) : '00:00', tt: ut ? hhmm(t) : '23:59',
      view: view, months: months, pick: 0, hover: 0, left: left, top: r.bottom + 6,
    });
  }
  _close() {
    if (!this.state.open) return;
    pickerOpen.n = Math.max(0, pickerOpen.n - 1);
    document.removeEventListener('keydown', this._onKey, true);
    clearTimeout(this._noticeT);
    this.setState({ open: false, hover: 0, notice: '' });
  }
  _toggle() { if (this.props.disabled) return; if (this.state.open) this._close(); else this._open(); }
  _cancel() { this._close(); }
  _onKey(ev) {
    if (!this.state.open) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this._close(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); this._apply(); }
  }
  _range() {
    var st = this.state, ut = useTime(this.props);
    var f = joinTime(st.fromDay, ut ? st.ft : '00:00', '00:00');
    var t = joinTime(st.toDay, ut ? st.tt : '23:59', '23:59');
    return { f: f, t: t, bad: !(t > f) };
  }
  _apply() {
    if (!this.state.open) return;
    var r = this._range();
    if (r.bad) return;
    var fmtT = this.props.mode !== 'date'; // 값 형식은 mode 기준 — 시각 입력이 없어도 T HH:MM으로 내보내는 자리 있음
    this._close();
    if (this.props.onApply) this.props.onApply(fmtVal(r.f, fmtT), fmtVal(r.t, fmtT));
  }
  /* 막힌 동작 이유를 팝오버 안에 표시 — 시선이 달력에 있음, 일정 시간 뒤·다음 동작 시 지움 */
  _notify(msg) {
    var self = this;
    clearTimeout(this._noticeT);
    this.setState({ notice: msg });
    this._noticeT = setTimeout(function () { self.setState({ notice: '' }); }, 3500);
  }
  /* 달 넘기기 — 데이터 있는 달까지만, 화살표는 비활성화 대신 눌렀을 때 이유 표시 */
  _navMonth(dir) {
    var st = this.state, b = this._bounds();
    var edge = dir < 0 ? st.view : addMonths(st.view, st.months - 1);
    var off = dir < 0 ? !!(b.minD && edge <= monthStart(b.minD)) : !!(b.maxD && edge >= monthStart(b.maxD));
    if (off) { this._notify(dir < 0 ? T('이전 달에는 데이터가 없습니다') : T('다음 달에는 데이터가 없습니다')); return; }
    clearTimeout(this._noticeT);
    this.setState({ view: addMonths(st.view, dir), notice: '' });
  }
  // 첫 클릭 시작, 다음 클릭 종료 — 시작보다 앞을 누르면 두 날을 맞바꿔 확정
  _pickDay(ms) {
    var st = this.state, b = this._bounds();
    // 데이터 없는 날은 선택 불가 — 무시하지 않고 이유 표시
    if ((b.minD && ms < b.minD) || (b.maxD && ms > b.maxD)) { this._notify(T('그 날짜에는 데이터가 없습니다')); return; }
    clearTimeout(this._noticeT);
    if (st.pick === 0) this.setState({ fromDay: ms, toDay: ms, pick: 1, hover: ms, notice: '' });
    else if (ms < st.fromDay) this.setState({ fromDay: ms, toDay: st.fromDay, pick: 0, hover: 0, notice: '' });
    else this.setState({ toDay: ms, pick: 0, hover: 0, notice: '' });
  }
  _timeInput(k) {
    var self = this;
    return function (ev) {
      var v = String(ev.target.value || '').replace(/[^\d:]/g, '').slice(0, 5);
      if (/^\d{3,}$/.test(v)) v = v.slice(0, 2) + ':' + v.slice(2);
      var s = {}; s[k] = v; self.setState(s);
    };
  }
  // 입력 시각을 HH:MM으로 정규화 ('9' → 09:00, '930' → 09:30, 범위 밖은 클램프)
  _timeFix(k, fb) {
    var self = this;
    return function (ev) {
      var raw = String(ev.target.value || '').replace(/[^\d]/g, '');
      var s = {};
      if (!raw) { s[k] = fb; self.setState(s); return; }
      var h = raw.length <= 2 ? +raw : +raw.slice(0, raw.length - 2);
      var m = raw.length <= 2 ? 0 : +raw.slice(-2);
      s[k] = pad(Math.min(23, h)) + ':' + pad(Math.min(59, m));
      self.setState(s);
    };
  }
  _timeKey(k, fb) {
    var self = this;
    return function (ev) {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      var cur = /^(\d{1,2}):(\d{2})$/.exec(self.state[k] || fb);
      var mins = cur ? +cur[1] * 60 + +cur[2] : 0;
      mins += (ev.key === 'ArrowUp' ? 1 : -1) * (ev.shiftKey ? 60 : 1);
      mins = (mins + 1440) % 1440;
      var s = {}; s[k] = pad(Math.floor(mins / 60)) + ':' + pad(mins % 60);
      self.setState(s);
    };
  }
  // 데이터 있는 날의 범위(일 단위). 0 = 모름(제한 없음)
  _bounds() {
    var p = this.props;
    return { minD: p.minMs ? dayStart(p.minMs) : 0, maxD: p.maxMs ? dayStart(p.maxMs) : 0 };
  }
  /* 팝오버 빠른 선택 — 데이터가 오늘까지 없는 태그는 마지막 데이터 날 기준(이름도 맞춤) */
  _quick() {
    var self = this, ut = useTime(this.props);
    var b = this._bounds();
    var today = dayStart(Date.now());
    var end = b.maxD ? Math.min(today, b.maxD) : today;
    var atEnd = end !== today;
    var endT = function () { return (ut && !atEnd) ? hhmm(Date.now()) : '23:59'; };
    var set = function (fd, td, ft, tt) {
      if (b.minD) fd = Math.max(b.minD, fd);
      clearTimeout(self._noticeT);
      var s = { fromDay: fd, toDay: td, pick: 0, hover: 0, notice: '', view: viewFor(fd, td, self.state.months) };
      if (ft != null) s.ft = ft;
      if (tt != null) s.tt = tt;
      self.setState(s);
    };
    var back = function (n) { return { label: T('최근 {0}일', n), on: function () { set(end - (n - 1) * 86400000, end, '00:00', endT()); } }; };
    var prev = dayStart(end - 43200000);
    var list = [
      { label: atEnd ? T('마지막 날') : T('오늘'), on: function () { set(end, end, '00:00', endT()); } },
      { label: atEnd ? T('그 전날') : T('어제'), on: function () { set(prev, prev, '00:00', '23:59'); }, off: !!(b.minD && prev < b.minD) },
      back(7), back(30),
    ];
    if (ut) list.push({ label: T('하루 전체'), on: function () { self.setState({ ft: '00:00', tt: '23:59' }); } });
    return list;
  }
  _month(anchor, key) {
    var self = this, st = this.state, p = this.props;
    // 달력 칸 배치는 날짜 산술(시간대 무관 — UTC로 계산), 칸의 ms는 표시 시간대 그 날 0시
    var ap = CH.parts(anchor), y = ap.Y, mo = ap.M - 1;
    var lead = new Date(Date.UTC(y, mo, 1)).getUTCDay();
    var days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    var today = dayStart(Date.now());
    // 시작만 고른 상태(pick=1)엔 마우스가 가리키는 날까지 미리 칠함
    var a = st.fromDay, b = (st.pick === 1 && st.hover) ? st.hover : st.toDay;
    var lo = Math.min(a, b), hi = Math.max(a, b);
    var bd = this._bounds(), minD = bd.minD, maxD = bd.maxD;
    var cells = [];
    for (var i = 0; i < lead; i++) cells.push(html`<span></span>`);
    for (var n = 1; n <= days; n++) {
      cells.push((function (dayN) {
        var ms = CH.makeTime(y, mo + 1, dayN);
        var inR = ms >= lo && ms <= hi, edge = ms === lo || ms === hi;
        var wd = (lead + dayN - 1) % 7;
        // 데이터 없는 날 선택 불가 — 빈 차트·리포트가 "이상 없음"으로 읽히는 것 방지
        var outside = (minD && ms < minD) || (maxD && ms > maxD);
        /* 선택 밴드 안에서는 주말 색 미사용(파란 밴드 위 파란 토요일은 묻힘) */
        var color = edge ? '#fff' : outside ? 'var(--text-muted)' : inR ? 'var(--text-primary)'
          : wd === 0 ? 'var(--danger)' : wd === 6 ? 'var(--cal-sat)' : 'var(--text-primary)';
        var bg = edge ? 'var(--cal-edge)' : inR ? 'var(--cal-band)' : 'transparent';
        var style = 'height: 26px; width: ' + CELL + 'px; display: inline-flex; align-items: center; justify-content: center;'
          + ' border: none; border-radius: ' + (edge ? '5px' : inR ? '0' : '5px') + '; font-size: 12px; font-family: var(--font-mono);'
          + ' background: ' + bg + '; color: ' + color + '; font-weight: ' + (edge ? '700' : '400') + ';'
          + (ms === today && !edge ? ' box-shadow: inset 0 0 0 1px var(--border-medium);' : '')
          + (outside ? ' opacity: .4; cursor: default;' : ' cursor: pointer;');
        return html`<button type="button" title=${outside ? T('이 날짜에는 데이터가 없습니다') : ''}
          onClick=${function () { self._pickDay(ms); }}
          onMouseEnter=${outside ? null : function () { if (self.state.pick === 1) self.setState({ hover: ms }); }}
          style=${style}>${dayN}</button>`;
      })(n));
    }
    return html`<div key=${key} style="width: ${MONTH_W}px;">
      <div style="text-align: center; font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${monthTitle(y, mo + 1)}</div>
      <div style="display: grid; grid-template-columns: repeat(7, ${CELL}px);">
        ${(WD[getLang()] || WD.ko).map((w, i) => html`<span style="height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; color: ${i === 0 ? 'var(--danger)' : i === 6 ? 'var(--cal-sat)' : 'var(--text-muted)'};">${w}</span>`)}
      </div>
      <div style="display: grid; grid-template-columns: repeat(7, ${CELL}px); row-gap: 2px;">${cells}</div>
    </div>`;
  }
  _panel() {
    var self = this, st = this.state, p = this.props, ut = useTime(p);
    var w = PANEL_PAD * 2 + MONTH_W * st.months + (st.months - 1) * MONTH_GAP;
    var r = this._range();
    var timeStyle = 'width: 58px; height: 28px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--border-medium); background: var(--bg-secondary); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); text-align: center;';
    var navStyle = 'width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: 5px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary);';
    var chip = 'height: 24px; padding: 0 9px; border-radius: 12px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 11px;';
    var applyStyle = 'height: 30px; padding: 0 16px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1px solid ' + (r.bad ? 'var(--border-default)' : 'var(--primary-base)')
      + '; background: ' + (r.bad ? 'var(--bg-secondary)' : 'var(--primary-base)') + '; color: ' + (r.bad ? 'var(--text-muted)' : '#fff') + '; cursor: ' + (r.bad ? 'default' : 'pointer') + ';';
    var months = [];
    for (var i = 0; i < st.months; i++) months.push(this._month(addMonths(st.view, i), 'm' + i));
    var bd = this._bounds();
    // 한쪽만 알 때(통계에 시작 시각 없음 등)는 아는 쪽만 표기
    var hintTxt = p.hint || (bd.minD && bd.maxD ? T('데이터 {0} ~ {1}', fmtVal(bd.minD, false), fmtVal(bd.maxD, false))
      : bd.maxD ? T('데이터 {0}까지', fmtVal(bd.maxD, false))
        : bd.minD ? T('데이터 {0}부터', fmtVal(bd.minD, false)) : '');
    var navBtn = function (dir, label, icon) {
      return html`<button type="button" title=${label} onClick=${function () { self._navMonth(dir); }}
        style=${navStyle + ' cursor: pointer;'}><span class="codicon codicon-${icon}" style="font-size: 14px;"></span></button>`;
    };
    return html`
      <div onClick=${this._cancel} style="position: fixed; inset: 0; z-index: 900;"></div>
      <div ref=${function (el) { self._panelEl = el; }} onMouseLeave=${function () { if (st.pick === 1) self.setState({ hover: 0 }); }}
        style="position: fixed; left: ${st.left}px; top: ${st.top}px; width: ${w}px; z-index: 901; box-sizing: border-box; padding: ${PANEL_PAD}px; border-radius: 10px; border: 1px solid var(--border-medium); background: var(--bg-elevated); box-shadow: 0 10px 34px rgba(0,0,0,.45);">
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
          ${navBtn(-1, T('이전 달'), 'chevron-left')}
          <div style="flex: 1; display: flex; flex-wrap: wrap; justify-content: center; gap: 5px;">
            ${this._quick().map((q) => html`<button type="button" disabled=${!!q.off} onClick=${q.off ? null : q.on}
              style=${chip + (q.off ? ' opacity: .35; cursor: default;' : ' cursor: pointer;')}>${q.label}</button>`)}
          </div>
          ${navBtn(1, T('다음 달'), 'chevron-right')}
        </div>
        <div style="display: flex; gap: ${MONTH_GAP}px; justify-content: center;">${months}</div>
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-light);">
          <span style="font-size: 11px; color: var(--text-muted);">${T('시작')}</span>
          <span style="font-size: 12px; font-family: var(--font-mono); color: var(--text-secondary);">${fmtVal(st.fromDay, false)}</span>
          ${(ut) ? html`<input value=${st.ft} maxlength="5" onInput=${this._timeInput('ft')} onBlur=${this._timeFix('ft', '00:00')} onKeyDown=${this._timeKey('ft', '00:00')} style=${timeStyle} />` : null}
          <span style="color: var(--text-muted);">~</span>
          <span style="font-size: 11px; color: var(--text-muted);">${T('종료')}</span>
          <span style="font-size: 12px; font-family: var(--font-mono); color: var(--text-secondary);">${fmtVal(st.toDay, false)}</span>
          ${(ut) ? html`<input value=${st.tt} maxlength="5" onInput=${this._timeInput('tt')} onBlur=${this._timeFix('tt', '23:59')} onKeyDown=${this._timeKey('tt', '23:59')} style=${timeStyle} />` : null}
        </div>
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
          ${(st.notice) ? html`
            <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--warning);">
              <span class="codicon codicon-info" style="font-size: 12px;"></span>${st.notice}
            </span>` : html`
            <span style="font-size: 11px; color: ${r.bad ? 'var(--danger)' : 'var(--text-muted)'};">
              ${r.bad ? T('종료가 시작보다 빠릅니다')
        // 날짜만 고르는 자리는 일수로 표시 — 시간 단위(24.0시간)는 세어야 읽힘
        : T('선택 구간 {0}', ut ? spanText(r.t - r.f) : T('{0}일', Math.round((st.toDay - st.fromDay) / 86400000) + 1))}
            </span>
            ${(!r.bad && hintTxt) ? html`<span style="font-size: 11px; color: var(--text-muted);">· ${hintTxt}</span>` : null}`}
          <button type="button" onClick=${this._cancel} style="margin-left: auto; height: 30px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer;">${T('취소')}</button>
          <button type="button" onClick=${this._apply} disabled=${r.bad} title=${T('고른 기간을 반영합니다 (Enter)')} style=${applyStyle}>${T('적용')}</button>
        </div>
      </div>`;
  }
  render(p, st) {
    var self = this;
    var f = parseLocal(p.from), t = parseLocal(p.to);
    /* 시각 입력 자리는 항상 시각 표기, 그 외(mode='date' 제외)는 하루 경계에 안 맞는 구간(프리셋·이벤트 클릭 등)만 */
    var withT = useTime(p) || (p.mode !== 'date' && !dayBounded(f, t));
    // label 있으면 구간 대신 표기 — 태그마다 구간이 다른 프리셋 등 단일 구간 표기가 틀리는 자리용
    var label = p.label || ((isNaN(f) || isNaN(t)) ? (p.placeholder || T('기간 선택')) : rangeLabel(f, t, withT));
    /* 직접 고른 구간 표시 색은 --info(--primary-*는 다크 표면에서 대비 부족)
       글자는 두 테마 모두 --text-primary, 강조는 옅은 배경·테두리 */
    var on = !!p.active;
    var btn = 'display: inline-flex; align-items: center; gap: 7px; height: ' + (p.height || 34) + 'px; padding: 0 11px; box-sizing: border-box;'
      + ' border-radius: 6px; border: 1px solid ' + (on ? 'var(--info)' : 'var(--border-medium)') + ';'
      + ' background: ' + (on ? 'rgba(0,108,210,.12)' : 'var(--bg-elevated)') + '; color: var(--text-primary);'
      + ' font-size: 12px; font-family: var(--font-mono); white-space: nowrap;'
      + (p.full ? ' width: 100%; justify-content: flex-start;' : '')
      + (p.disabled ? ' opacity: .5; cursor: default;' : ' cursor: pointer;');
    return html`<span style=${'position: relative;' + (p.full ? ' display: block;' : ' display: inline-block;')}>
      <button type="button" ref=${function (el) { self._btnEl = el; }} onClick=${this._toggle} disabled=${!!p.disabled}
        title=${p.title || T('달력에서 기간을 고릅니다')} style=${btn}>
        <span class="codicon codicon-calendar" style="font-size: 13px; color: var(--info);"></span>
        <span>${label}</span>
        <span class="codicon codicon-chevron-down" style="font-size: 12px; margin-left: auto; color: var(--text-muted);"></span>
      </button>
      ${(st.open) ? this._panel() : null}
    </span>`;
  }
}
