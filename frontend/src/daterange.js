// 기간 선택 위젯 — 트리거 버튼 + 팝오버 달력. 화면 어디서든 같은 방식으로 기간을 고른다.
// 고른 값은 팝오버 안에서만 살아 있고 '적용'을 눌러야 바깥(onApply)으로 나간다 — 날짜와
// 시각을 맞추는 동안 조회가 나가지 않고, 취소하면 원래 기간이 그대로 남는다.
import { Component } from 'preact/compat';
import { html } from './html.js';

/* 팝오버가 열려 있는 동안은 화면 자동 갱신(틱)을 멈추기 위한 열림 수 — 고르는 중에
   버튼이 움직이거나 값이 되돌려지면 안 된다. app.js의 틱이 이 값을 본다. */
export var pickerOpen = { n: 0 };

var WD = ['일', '월', '화', '수', '목', '금', '토'];
var CELL = 30;           // 날짜 칸 너비(px) — 달 하나 = 7칸
var MONTH_W = CELL * 7;
var PANEL_PAD = 14;
var MONTH_GAP = 18;

function pad(n) { return (n < 10 ? '0' : '') + n; }
// 'YYYY-MM-DD[THH:MM]' → 로컬 ms. Date.parse는 날짜만 있으면 UTC로 읽어 하루가 밀린다.
function parseLocal(s) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), 0, 0).getTime();
}
function fmtVal(ms, withTime) {
  var d = new Date(ms);
  var s = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return withTime ? s + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : s;
}
function dayStart(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function monthStart(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function addMonths(ms, n) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); }
function hhmm(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
// 날짜(그 날 0시) + 'HH:MM' → ms. 시각이 덜 적혔으면 fb를 쓴다.
function joinTime(dayMs, t, fb) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) m = /^(\d{1,2}):(\d{2})$/.exec(fb);
  var d = new Date(dayStart(dayMs));
  if (m) d.setHours(Math.min(23, +m[1]), Math.min(59, +m[2]));
  return d.getTime();
}
/* 어느 달을 펼쳐 보일지 — 두 달을 그릴 땐 끝나는 달을 오른쪽에 둔다. 진동 데이터는 늘 과거이고
   구간을 넓힐 때도 뒤로 가므로, 앞달이 왼쪽에 미리 나와 있어야 한 번 더 넘기지 않는다. */
function viewFor(fromMs, toMs, months) {
  return months === 2 ? addMonths(monthStart(toMs), -1) : monthStart(fromMs);
}
function spanText(ms) {
  if (!(ms > 0)) return '';
  var mi = Math.round(ms / 60000);
  if (mi < 60) return mi + '분';
  var h = ms / 3600000;
  if (h < 48) return (h < 10 ? h.toFixed(1) : String(Math.round(h))) + '시간';
  var d = h / 24;
  return (d < 10 ? d.toFixed(1) : String(Math.round(d))) + '일';
}
/* 팝오버에서 시각까지 받을지. mode='date'면 날짜만이 기본이고, showTime으로 뒤집는다 —
   달력은 일 단위로만 고르되 값은 날짜+시각 형식으로 내보내는 자리(조회 기간)가 있다. */
function useTime(p) { return p.showTime != null ? !!p.showTime : p.mode !== 'date'; }
// 하루 경계에 딱 맞는 구간인가 — 달력으로 고른 구간(00:00~23:59)과 그 밖의 구간을 가른다
function dayBounded(f, t) {
  var a = new Date(f), b = new Date(t);
  return a.getHours() === 0 && a.getMinutes() === 0 && b.getHours() === 23 && b.getMinutes() === 59;
}
/* 트리거 버튼에 적을 기간. 연도는 날짜만 고르는 자리(내보내기·삭제)에서 늘 적는다 —
   되돌릴 수 없는 동작에서 "07-01"만 보이면 어느 해인지 짐작해야 한다. */
function rangeLabel(f, t, withTime, withYear) {
  var thisYear = new Date().getFullYear();
  var one = function (ms) {
    var d = new Date(ms);
    var s = (withYear || d.getFullYear() !== thisYear ? d.getFullYear() + '-' : '') + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return withTime ? s + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : s;
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
  /* 팝오버 높이는 그려 보기 전엔 모르므로 일단 어림값으로 놓고, 그린 뒤 실제 높이로 한 번만
     올려 잡는다 — 화면 아래쪽 트리거(모달 안 등)에서 패널이 잘려 '적용'이 안 보이는 것을 막는다. */
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
    // 펼칠 달을 데이터가 있는 쪽으로 당긴다 — 열자마자 빈 달을 보고 넘겨야 하는 일이 없게
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
    var fmtT = this.props.mode !== 'date'; // 값 형식은 mode가 정한다 — 달력에서 시각을 안 받아도 T HH:MM으로 내보내는 자리가 있다
    this._close();
    if (this.props.onApply) this.props.onApply(fmtVal(r.f, fmtT), fmtVal(r.t, fmtT));
  }
  /* 막힌 동작의 이유를 팝오버 안에 적는다. 토스트가 아니라 여기인 이유는 시선이 달력에 있어서다 —
     화면 아래 토스트는 고르는 중에 눈에 안 들어온다. 다음 동작을 하면 지워진다. */
  _notify(msg) {
    var self = this;
    clearTimeout(this._noticeT);
    this.setState({ notice: msg });
    this._noticeT = setTimeout(function () { self.setState({ notice: '' }); }, 3500);
  }
  /* 달 넘기기. 데이터가 있는 달까지만 가되 화살표를 흐리게 죽이지는 않는다 —
     흐린 단추는 "왜 안 눌리는지"를 사용자가 짚어야 한다. 눌리게 두고 이유를 말한다. */
  _navMonth(dir) {
    var st = this.state, b = this._bounds();
    var edge = dir < 0 ? st.view : addMonths(st.view, st.months - 1);
    var off = dir < 0 ? !!(b.minD && edge <= monthStart(b.minD)) : !!(b.maxD && edge >= monthStart(b.maxD));
    if (off) { this._notify((dir < 0 ? '이전' : '다음') + ' 달에는 데이터가 없습니다'); return; }
    clearTimeout(this._noticeT);
    this.setState({ view: addMonths(st.view, dir), notice: '' });
  }
  // 첫 클릭은 시작, 다음 클릭은 종료 — 시작보다 앞을 누르면 그쪽이 새 시작이 된다
  _pickDay(ms) {
    var st = this.state, b = this._bounds();
    // 데이터 없는 날은 고를 수 없다 — 눌린 것을 무시만 하면 고장으로 읽히므로 이유를 적는다
    if ((b.minD && ms < b.minD) || (b.maxD && ms > b.maxD)) { this._notify('그 날짜에는 데이터가 없습니다'); return; }
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
  // 흘려 적은 시각을 HH:MM으로 되돌린다 ('9' → 09:00, '930' → 09:30, 범위 밖은 자른다)
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
  // 데이터가 있는 날의 범위(일 단위). 0 = 모름 — 모르면 아무것도 막지 않는다
  _bounds() {
    var p = this.props;
    return { minD: p.minMs ? dayStart(p.minMs) : 0, maxD: p.maxMs ? dayStart(p.maxMs) : 0 };
  }
  /* 팝오버 안 빠른 선택 — 날짜만 고르는 곳(모달)엔 프리셋 버튼이 따로 없어 여기가 유일한 지름길이다.
     데이터가 오늘까지 오지 않는 태그(정지 설비·적재가 끝난 표)에서는 오늘을 기준으로 삼을 수 없어
     마지막 데이터 날에 붙이고, 이름도 그렇게 바꿔 적는다 — '오늘'이라 적고 다른 날을 고르면 거짓말이다. */
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
    var back = function (n) { return { label: '최근 ' + n + '일', on: function () { set(end - (n - 1) * 86400000, end, '00:00', endT()); } }; };
    var prev = dayStart(end - 43200000);
    var list = [
      { label: atEnd ? '마지막 날' : '오늘', on: function () { set(end, end, '00:00', endT()); } },
      { label: atEnd ? '그 전날' : '어제', on: function () { set(prev, prev, '00:00', '23:59'); }, off: !!(b.minD && prev < b.minD) },
      back(7), back(30),
    ];
    if (ut) list.push({ label: '하루 전체', on: function () { self.setState({ ft: '00:00', tt: '23:59' }); } });
    return list;
  }
  _month(anchor, key) {
    var self = this, st = this.state, p = this.props;
    var d = new Date(anchor), y = d.getFullYear(), mo = d.getMonth();
    var lead = new Date(y, mo, 1).getDay();
    var days = new Date(y, mo + 1, 0).getDate();
    var today = dayStart(Date.now());
    // 끌어 고르는 중(pick=1)에는 마우스가 가리키는 날까지 미리 칠한다
    var a = st.fromDay, b = (st.pick === 1 && st.hover) ? st.hover : st.toDay;
    var lo = Math.min(a, b), hi = Math.max(a, b);
    var bd = this._bounds(), minD = bd.minD, maxD = bd.maxD;
    var cells = [];
    for (var i = 0; i < lead; i++) cells.push(html`<span></span>`);
    for (var n = 1; n <= days; n++) {
      cells.push((function (dayN) {
        var ms = new Date(y, mo, dayN).getTime();
        var inR = ms >= lo && ms <= hi, edge = ms === lo || ms === hi;
        var wd = new Date(ms).getDay();
        // 데이터가 없는 날은 고를 수 없다 — 골라 봐야 빈 차트·빈 리포트가 나오고, 그것을 "이상 없음"으로 읽는다
        var outside = (minD && ms < minD) || (maxD && ms > maxD);
        /* 밴드 안에서는 주말 색을 쓰지 않는다 — 파란 밴드 위의 파란 토요일은 어느 테마에서도 묻힌다.
           밴드 밖에서만 요일 색이 의미가 있고, 안쪽은 "고른 구간"이라는 것이 먼저다. */
        var color = edge ? '#fff' : outside ? 'var(--text-muted)' : inR ? 'var(--text-primary)'
          : wd === 0 ? 'var(--danger)' : wd === 6 ? 'var(--cal-sat)' : 'var(--text-primary)';
        var bg = edge ? 'var(--cal-edge)' : inR ? 'var(--cal-band)' : 'transparent';
        var style = 'height: 26px; width: ' + CELL + 'px; display: inline-flex; align-items: center; justify-content: center;'
          + ' border: none; border-radius: ' + (edge ? '5px' : inR ? '0' : '5px') + '; font-size: 12px; font-family: var(--font-mono);'
          + ' background: ' + bg + '; color: ' + color + '; font-weight: ' + (edge ? '700' : '400') + ';'
          + (ms === today && !edge ? ' box-shadow: inset 0 0 0 1px var(--border-medium);' : '')
          + (outside ? ' opacity: .4; cursor: default;' : ' cursor: pointer;');
        return html`<button type="button" title=${outside ? '이 날짜에는 데이터가 없습니다' : ''}
          onClick=${function () { self._pickDay(ms); }}
          onMouseEnter=${outside ? null : function () { if (self.state.pick === 1) self.setState({ hover: ms }); }}
          style=${style}>${dayN}</button>`;
      })(n));
    }
    return html`<div key=${key} style="width: ${MONTH_W}px;">
      <div style="text-align: center; font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${y}년 ${mo + 1}월</div>
      <div style="display: grid; grid-template-columns: repeat(7, ${CELL}px);">
        ${WD.map((w, i) => html`<span style="height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; color: ${i === 0 ? 'var(--danger)' : i === 6 ? 'var(--cal-sat)' : 'var(--text-muted)'};">${w}</span>`)}
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
    // 한쪽만 아는 경우도 있다(통계가 시작 시각을 안 줄 때) — 아는 만큼만 적는다
    var hintTxt = p.hint || (bd.minD && bd.maxD ? '데이터 ' + fmtVal(bd.minD, false) + ' ~ ' + fmtVal(bd.maxD, false)
      : bd.maxD ? '데이터 ' + fmtVal(bd.maxD, false) + '까지'
        : bd.minD ? '데이터 ' + fmtVal(bd.minD, false) + '부터' : '');
    var navBtn = function (dir, label, icon) {
      return html`<button type="button" title=${label} onClick=${function () { self._navMonth(dir); }}
        style=${navStyle + ' cursor: pointer;'}><span class="codicon codicon-${icon}" style="font-size: 14px;"></span></button>`;
    };
    return html`
      <div onClick=${this._cancel} style="position: fixed; inset: 0; z-index: 900;"></div>
      <div ref=${function (el) { self._panelEl = el; }} onMouseLeave=${function () { if (st.pick === 1) self.setState({ hover: 0 }); }}
        style="position: fixed; left: ${st.left}px; top: ${st.top}px; width: ${w}px; z-index: 901; box-sizing: border-box; padding: ${PANEL_PAD}px; border-radius: 10px; border: 1px solid var(--border-medium); background: var(--bg-elevated); box-shadow: 0 10px 34px rgba(0,0,0,.45);">
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
          ${navBtn(-1, '이전 달', 'chevron-left')}
          <div style="flex: 1; display: flex; flex-wrap: wrap; justify-content: center; gap: 5px;">
            ${this._quick().map((q) => html`<button type="button" disabled=${!!q.off} onClick=${q.off ? null : q.on}
              style=${chip + (q.off ? ' opacity: .35; cursor: default;' : ' cursor: pointer;')}>${q.label}</button>`)}
          </div>
          ${navBtn(1, '다음 달', 'chevron-right')}
        </div>
        <div style="display: flex; gap: ${MONTH_GAP}px; justify-content: center;">${months}</div>
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-light);">
          <span style="font-size: 11px; color: var(--text-muted);">시작</span>
          <span style="font-size: 12px; font-family: var(--font-mono); color: var(--text-secondary);">${fmtVal(st.fromDay, false)}</span>
          ${(ut) ? html`<input value=${st.ft} maxlength="5" onInput=${this._timeInput('ft')} onBlur=${this._timeFix('ft', '00:00')} onKeyDown=${this._timeKey('ft', '00:00')} style=${timeStyle} />` : null}
          <span style="color: var(--text-muted);">~</span>
          <span style="font-size: 11px; color: var(--text-muted);">종료</span>
          <span style="font-size: 12px; font-family: var(--font-mono); color: var(--text-secondary);">${fmtVal(st.toDay, false)}</span>
          ${(ut) ? html`<input value=${st.tt} maxlength="5" onInput=${this._timeInput('tt')} onBlur=${this._timeFix('tt', '23:59')} onKeyDown=${this._timeKey('tt', '23:59')} style=${timeStyle} />` : null}
        </div>
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
          ${(st.notice) ? html`
            <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--warning);">
              <span class="codicon codicon-info" style="font-size: 12px;"></span>${st.notice}
            </span>` : html`
            <span style="font-size: 11px; color: ${r.bad ? 'var(--danger)' : 'var(--text-muted)'};">
              ${r.bad ? '종료가 시작보다 빠릅니다'
        // 날짜만 고르는 자리는 "며칠치"가 읽고 싶은 값이다 — 하루를 24.0시간으로 적으면 세어야 한다
        : '선택 구간 ' + (ut ? spanText(r.t - r.f) : (Math.round((st.toDay - st.fromDay) / 86400000) + 1) + '일')}
            </span>
            ${(!r.bad && hintTxt) ? html`<span style="font-size: 11px; color: var(--text-muted);">· ${hintTxt}</span>` : null}`}
          <button type="button" onClick=${this._cancel} style="margin-left: auto; height: 30px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--border-default); background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer;">취소</button>
          <button type="button" onClick=${this._apply} disabled=${r.bad} title="고른 기간을 반영합니다 (Enter)" style=${applyStyle}>적용</button>
        </div>
      </div>`;
  }
  render(p, st) {
    var self = this;
    var f = parseLocal(p.from), t = parseLocal(p.to);
    /* 시각은 하루 경계에 안 맞을 때만 적는다 — 달력으로 고른 구간은 날짜만으로 충분하고,
       프리셋·이벤트 클릭처럼 하루 안의 창일 때는 시각을 지우면 무슨 구간인지 알 수 없다. */
    var withT = useTime(p) || (p.mode !== 'date' && !dayBounded(f, t));
    // label을 주면 구간 대신 그것을 적는다 — 태그마다 구간이 다른 프리셋처럼 한 구간으로 적으면 틀리는 자리에 쓴다
    var label = p.label || ((isNaN(f) || isNaN(t)) ? (p.placeholder || '기간 선택') : rangeLabel(f, t, withT, p.mode === 'date'));
    /* 직접 고른 구간임을 알리는 색은 --info를 쓴다 — --primary-base·--primary-light는 흰 바탕 기준
       진한 파랑이라 다크 표면 위에서 대비가 떨어져 탁하게 앉는다(--info는 다크에서 밝은 쪽으로 잡혀 있다).
       글자는 두 테마 모두 --text-primary로 두고, 강조는 옅은 배경과 테두리가 맡는다. */
    var on = !!p.active;
    var btn = 'display: inline-flex; align-items: center; gap: 7px; height: ' + (p.height || 34) + 'px; padding: 0 11px; box-sizing: border-box;'
      + ' border-radius: 6px; border: 1px solid ' + (on ? 'var(--info)' : 'var(--border-medium)') + ';'
      + ' background: ' + (on ? 'rgba(0,108,210,.12)' : 'var(--bg-elevated)') + '; color: var(--text-primary);'
      + ' font-size: 12px; font-family: var(--font-mono); white-space: nowrap;'
      + (p.full ? ' width: 100%; justify-content: flex-start;' : '')
      + (p.disabled ? ' opacity: .5; cursor: default;' : ' cursor: pointer;');
    return html`<span style=${'position: relative;' + (p.full ? ' display: block;' : ' display: inline-block;')}>
      <button type="button" ref=${function (el) { self._btnEl = el; }} onClick=${this._toggle} disabled=${!!p.disabled}
        title=${p.title || '달력에서 기간을 고릅니다'} style=${btn}>
        <span class="codicon codicon-calendar" style="font-size: 13px; color: var(--info);"></span>
        <span>${label}</span>
        <span class="codicon codicon-chevron-down" style="font-size: 12px; margin-left: auto; color: var(--text-muted);"></span>
      </button>
      ${(st.open) ? this._panel() : null}
    </span>`;
  }
}
