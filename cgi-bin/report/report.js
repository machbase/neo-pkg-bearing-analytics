// report/report.js — 진동 분석 리포트 HTML 조립 (프로토타입 report.html 양식 · 캔버스 실시간 렌더판)
// PNG 박제 대신 차트 엔진(chart.js 소스)과 데이터(JSON)를 파일에 내장 → 저장된 문서에서도
// 휠 줌·드래그·툴팁·테마 연동 리드로우가 동작한다. 파일은 여전히 자립형(외부 참조 없음).
// 보안: 사용자 입력 esc(), 데이터 JSON은 <를 <로 치환, CSP(default none, img data:, style/script inline).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VibeReport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var STATUS_COLOR = { '양호': '#3aa76d', '주의': '#d99a2b', '위험': '#e07b39', '심각': '#e5484d' };
  // 등급어는 아니지만 "보라"는 표시 — 회색으로 내리면 뜻이 정반대로 읽힌다
  var NOTE_BADGE = { '충격성 강함': 1 };

  /* 라이트 팔레트는 테마 토글과 인쇄가 함께 쓴다 — 한 곳에서 고쳐야 화면과 종이가 갈리지 않는다 */
  var LIGHT_VARS = "--bg-primary:#e9ebef;--bg-panel:#fff;--bg-elevated:#f5f6f8;--bg-dropdown:#fff;--bg-hover:rgba(0,0,0,.045);"
    + "--bg-input:rgba(0,0,0,.05);--text-primary:#262831;--text-secondary:#40434e;--text-tertiary:#5f636f;--text-muted:#8a8d99;"
    + "--border-default:rgba(0,0,0,.12);--border-medium:#b9bcc5;--border-faint:rgba(0,0,0,.08)";

  var CSS = [
    ":root{--bg-primary:#1e1e1e;--bg-panel:#252525;--bg-elevated:#2c2c2c;--bg-dropdown:#2d2d2d;--bg-hover:rgba(255,255,255,.08);--bg-input:rgba(255,255,255,.13);--text-primary:#f1f1f1;--text-secondary:#c4c4c4;--text-tertiary:#a3a3a3;--text-muted:#727272;--border-default:rgba(255,255,255,.13);--border-medium:#626263;--border-faint:rgba(255,255,255,.06);--primary:#005fb8;--primary-hover:#0075e2;--radius-sm:4px;--radius-md:8px}",
    ".theme-light{" + LIGHT_VARS + "}",
    "*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.65;font-size:15px}",
    ".page{max-width:1320px;margin:0 auto;padding:40px 28px 56px}",
    ".report-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:4px 0 26px;border-bottom:1px solid var(--border-default);margin-bottom:28px}",
    ".report-header .logo{height:42px;width:auto;flex-shrink:0;margin-top:2px}.theme-light .report-header .logo{filter:brightness(0)}",
    ".hd-right{display:flex;flex-direction:column;align-items:flex-end;gap:16px;flex-shrink:0}",
    ".hd-btns{display:flex;align-items:center;gap:8px}",
    ".theme-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;color:var(--text-secondary);background:var(--bg-input);border:1px solid var(--border-default);border-radius:var(--radius-sm);cursor:pointer}",
    ".theme-btn:hover{border-color:var(--border-medium);color:var(--text-primary)}.theme-btn svg{width:18px;height:18px;display:block}",
    ".theme-btn .ic-sun{display:none}.theme-light .theme-btn .ic-sun{display:block}.theme-light .theme-btn .ic-moon{display:none}",
    ".eyebrow{font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--primary-hover);margin-bottom:10px}",
    "h1{font-size:30px;font-weight:700;line-height:1.2;letter-spacing:-.3px}h1 .hl{color:var(--primary-hover)}",
    ".meta-row{display:flex;flex-wrap:wrap;gap:10px 26px;margin-top:16px;font-size:13px}.meta{display:flex;align-items:baseline;gap:8px}",
    ".meta-k{font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--text-muted)}.meta-v{color:var(--text-secondary)}",
    ".mono{font-family:'D2Coding','Consolas',monospace}",
    ".spec-panel{display:flex;flex-wrap:wrap;background:var(--bg-panel);border:1px solid var(--border-default);border-radius:var(--radius-md);overflow:hidden;margin-bottom:24px}",
    ".spec-col{flex:1 1 0;min-width:150px;padding:18px 22px;border-right:1px solid var(--border-default)}.spec-col:last-child{border-right:none}",
    ".spec-k{font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--text-muted)}",
    ".spec-v{margin-top:7px;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.15}",
    ".section{background:var(--bg-panel);border:1px solid var(--border-default);border-radius:var(--radius-md);padding:24px 26px;margin-bottom:24px}",
    ".section-title{display:flex;align-items:center;flex-wrap:wrap;gap:9px;font-size:17px;font-weight:600;margin-bottom:6px}",
    ".section-title .bar{width:3px;height:16px;border-radius:2px;background:var(--primary)}",
    ".section-desc{font-size:12px;color:var(--text-muted);margin-bottom:14px}.nav-hint{margin-left:auto;font-size:11px;color:var(--text-muted);font-weight:400}.nav-hint b{color:var(--text-tertiary)}",
    ".chart-wrap{position:relative;overflow:hidden}canvas{width:100%;display:block}",
    ".tooltip{position:absolute;pointer-events:none;display:none;z-index:10;background:var(--bg-dropdown);color:var(--text-primary);border:1px solid var(--border-medium);border-radius:var(--radius-sm);padding:7px 10px;font-size:12px;line-height:1.6;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3);font-family:'D2Coding',monospace}",
    ".xline{position:absolute;top:14px;bottom:34px;width:1px;background:rgba(0,117,226,.5);display:none;pointer-events:none}",
    ".legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:10px;font-size:12px;color:var(--text-tertiary)}.legend span{display:inline-flex;align-items:center;gap:7px}.sw{width:14px;height:2px;display:inline-block}",
    ".sev-box{border:1px solid var(--border-faint);border-radius:10px;padding:18px 20px 12px;margin-bottom:14px}",
    ".summary-box{background:var(--bg-panel);border:1px solid var(--border-default);border-radius:var(--radius-md);padding:20px 24px 18px;margin-bottom:24px}",
    "body.view-sum #detail{display:none}",
    "body.view-full .summary-box{display:none}",
    /* 인쇄는 전체 보기로 나간다 — 요약 상자를 같이 실으면 같은 판정이 종이에서 두 번 나온다 */
    "@media print{.summary-box{display:none !important}}",
    ".view-sw{display:inline-flex;border:1px solid var(--border-default);border-radius:var(--radius-sm);overflow:hidden}",
    ".view-btn{padding:0 12px;height:34px;font-size:12px;font-weight:600;color:var(--text-tertiary);background:var(--bg-input);border:none;cursor:pointer}",
    ".view-btn.on{background:var(--primary);color:#fff}",
    ".view-btn+.view-btn{border-left:1px solid var(--border-default)}",
    ".sum-more{margin-top:14px;padding-top:12px;border-top:1px solid var(--border-faint);font-size:11.5px;color:var(--text-muted)}",
    "@media print{#detail{display:block !important}.view-sw{display:none}}",
    ".sum-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:14px;flex-wrap:wrap}",
    ".sum-eyebrow{font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--primary-hover)}",
    ".sum-sub{font-size:11px;color:var(--text-muted)}",
    ".sum-alert{border-radius:8px;padding:11px 14px;margin-bottom:10px;font-size:12.5px;line-height:1.6}",
    ".sum-alert .t{font-weight:700;margin-bottom:3px}.sum-alert .d{color:var(--text-secondary);font-size:12px}",
    ".sum-alert.red{background:rgba(229,72,77,.08);border:1px solid rgba(229,72,77,.45)}.sum-alert.red .t{color:#e5484d}",
    ".sum-alert.amber{background:rgba(199,125,10,.09);border:1px solid rgba(199,125,10,.4)}.sum-alert.amber .t{color:#c77d0a}",
    ".sum-alert.ok{background:rgba(58,167,109,.08);border:1px solid rgba(58,167,109,.35)}.sum-alert.ok .t{color:#3aa76d}",
    ".sum-sec{margin-top:12px}.sum-t{font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:5px}",
    ".sum-t .mut{font-weight:400;color:var(--text-muted)}.amber{color:#c77d0a}",
    ".sum-tbl{width:100%;font-size:12.5px}.sum-tbl td{padding:5px 8px;border-bottom:1px solid var(--border-faint);vertical-align:top}",
    ".sum-tbl .k{width:150px;color:var(--text-secondary)}.sum-tbl .v{width:200px;color:var(--text-primary)}",
    ".sum-tbl .n{color:var(--text-muted);font-size:11.5px;line-height:1.5}",
    ".sum-ol{margin:0 0 0 18px;font-size:12.5px;color:var(--text-secondary);line-height:1.75}",
    ".sum-lines{font-size:12px;color:var(--text-muted);line-height:1.7}.sum-lines b{color:var(--text-secondary)}",
    ".act-card{display:flex;align-items:center;gap:10px;margin-top:12px;padding:12px 14px;border-radius:8px;font-size:13px;font-weight:700;flex-wrap:wrap}",
    ".act-card .ic{font-size:16px}.act-card .nt{font-weight:400;font-size:11.5px;color:var(--text-muted)}",
    ".act-card.ok{background:rgba(58,167,109,.10);border:1px solid rgba(58,167,109,.4);color:#3aa76d}",
    ".act-card.watch{background:rgba(217,154,43,.10);border:1px solid rgba(217,154,43,.4);color:#d99a2b}",
    ".act-card.plan{background:rgba(224,123,57,.10);border:1px solid rgba(224,123,57,.45);color:#e07b39}",
    ".act-card.urgent{background:rgba(229,72,77,.10);border:1px solid rgba(229,72,77,.45);color:#e5484d}",
    ".sum-tbl .rk{display:inline-block;padding:0 6px;border-radius:3px;font-size:10px;font-weight:700;background:var(--primary);color:#fff;vertical-align:middle}",
    ".sum-tbl .lv{font-family:inherit;font-size:11px;color:var(--text-tertiary)}",
    ".sum-div{margin:16px 0 4px;padding-top:12px;border-top:1px dashed var(--border-default);font-size:11px;color:var(--text-muted)}",
    ".sum-alert{position:relative;padding-left:18px}.sum-alert:before{content:'';position:absolute;left:7px;top:12px;bottom:12px;width:4px;border-radius:2px}",
    ".sum-alert.red:before{background:#e5484d}.sum-alert.amber:before{background:#c77d0a}.sum-alert.ok:before{background:#3aa76d}",
    ".sum-alert .t{font-size:15px;letter-spacing:-.2px;display:flex;align-items:center;gap:8px}",
    ".sum-alert .t .dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex-shrink:0}",
    ".sum-alert .t2{font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:3px}",
    ".sum-alert .al-div{height:1px;background:var(--border-faint);margin:12px 0}",
    ".sum-alert.plain{background:transparent;border:none;padding:0}.sum-alert.plain:before{display:none}",
    ".act{margin-top:12px;padding:13px 15px;border-radius:8px;border:1px solid var(--border-default);background:var(--bg-elevated)}",
    ".act .act-h{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:700;letter-spacing:-.2px}",
    ".act .act-ic{font-size:17px;line-height:1}",
    ".act .act-b{margin-top:5px;font-size:12.5px;color:var(--text-secondary);line-height:1.6}",
    ".act .act-x{margin-top:7px;font-size:11.5px;color:var(--text-muted);font-family:'D2Coding',monospace}",
    ".act .act-a{margin-top:7px;padding-top:7px;border-top:1px solid var(--border-faint);font-size:11.5px;color:var(--text-muted)}",
    ".act.hold{border-style:dashed;border-color:var(--border-medium)}.act.hold .act-h{color:var(--text-primary)}",
    ".act.ok{border-color:rgba(58,167,109,.45);background:rgba(58,167,109,.07)}.act.ok .act-h{color:#3aa76d}",
    ".act.watch{border-color:rgba(217,154,43,.45);background:rgba(217,154,43,.07)}.act.watch .act-h{color:#d99a2b}",
    ".act.plan{border-color:rgba(224,123,57,.45);background:rgba(224,123,57,.07)}.act.plan .act-h{color:#e07b39}",
    ".act.urgent{border-color:rgba(229,72,77,.45);background:rgba(229,72,77,.07)}.act.urgent .act-h{color:#e5484d}",
    ".sum-tbl .k-sub{font-size:10.5px;font-weight:400;color:var(--text-muted);margin-top:1px}",
    ".judge-note{margin:2px 0 8px;padding:7px 11px;border-radius:6px;background:var(--bg-input);font-size:12px;color:var(--text-secondary);line-height:1.55}",
    ".judge-note b{color:var(--text-primary)}.judge-note .mut{color:var(--text-muted);font-weight:400}",
    ".sum-tbl .mut{color:var(--text-tertiary)}",
    ".sum-tbl .tag{display:inline-block;margin-left:4px;font-size:10px;font-weight:700;color:var(--text-muted);background:var(--bg-input);border-radius:3px;padding:0 5px;line-height:16px}",
    ".sum-t .mut{font-weight:400;color:var(--text-muted)}",
    ".sum-alert .d+.t2{margin-top:0}",
    ".sum-tbl tr.top td{background:rgba(0,117,226,.06)}.sum-tbl tr.top td:first-child{box-shadow:inset 3px 0 0 var(--primary)}",
    ".sum-more .lnk{color:var(--primary-hover);text-decoration:none}.sum-more .lnk:hover{text-decoration:underline}",
    ".lim-row{display:flex;gap:10px;align-items:baseline;font-size:12px;margin-bottom:5px}",
    ".lim-row .lk{width:104px;flex-shrink:0;color:var(--text-secondary);font-weight:500}",
    ".lim-box{margin-top:2px}",
    ".lim-box .nb-t{font-size:12.5px;font-weight:700;color:var(--text-primary);margin:11px 0 4px}",
    ".lim-box .nb-t:first-child{margin-top:0}",
    ".lim-box .nb-s{font-weight:400;font-size:11.5px;color:var(--text-muted)}",
    ".lim-box .nb-r{margin-left:12px;font-size:12px;color:var(--text-muted);line-height:1.7}",
    ".lim-box .lc{display:inline-block;margin-left:6px;font-size:10px;font-weight:700;color:var(--text-muted);background:var(--bg-input);border-radius:3px;padding:0 5px;line-height:16px;vertical-align:1px}",
    ".pips{display:inline-flex;gap:2px;vertical-align:middle;margin-right:6px}",
    ".pips i{width:8px;height:8px;border-radius:2px;display:inline-block;background:var(--border-medium)}",
    ".pips i.on{background:#d99a2b}.pips i.hi{background:#e07b39}",
    ".cand-sub{font-size:11px;font-weight:400;color:var(--text-muted);margin-top:1px}",
    ".navbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 18px;padding:10px 12px;background:var(--bg-panel);border:1px solid var(--border-default);border-radius:var(--radius-md);box-shadow:0 4px 14px rgba(0,0,0,.28)}",
    ".theme-light .navbar{box-shadow:0 4px 14px rgba(0,0,0,.08)}",
    ".navbar a.on{background:var(--primary);color:#fff;border-color:var(--primary)}",
    ".navbar .nl{font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-right:2px}",
    ".navbar a{padding:0 10px;height:26px;line-height:24px;font-size:12px;color:var(--text-tertiary);background:transparent;border:1px solid var(--border-default);border-radius:4px;text-decoration:none}",
    ".navbar a:hover{background:var(--bg-hover);color:var(--text-primary);border-color:var(--border-medium)}",
    ".zone-lab{font-size:12px;font-weight:600;color:var(--text-tertiary);margin-left:10px;vertical-align:middle}",
    ".gate-box{padding:14px 16px;margin-bottom:10px;border-radius:8px;background:rgba(229,72,77,.07);border:1px solid rgba(229,72,77,.42);font-size:12px;line-height:1.6}",
    ".gate-box.amber{background:rgba(199,125,10,.09);border-color:rgba(199,125,10,.4)}",
    ".gate-box .gb-t{font-size:13.5px;font-weight:700;color:#e5484d;margin-bottom:8px}.gate-box.amber .gb-t{color:#c77d0a}",
    ".gate-box .gb-i{margin:0 0 7px 4px}.gate-box .gb-il{font-weight:600;color:var(--text-primary);font-size:12.5px}",
    ".gate-box .gb-id{margin-left:12px;color:var(--text-muted)}",
    ".gate-box .gb-d{margin-top:8px;color:var(--text-secondary)}",
    ".neg-box{margin-top:14px;padding:14px 16px;border-radius:8px;background:var(--bg-elevated);border:1px solid var(--border-faint);font-size:12px;line-height:1.65}",
    ".neg-box .nb-t{font-weight:700;color:var(--text-secondary);margin:10px 0 3px}.neg-box .nb-t:first-child{margin-top:0}",
    ".neg-box .nb-s{font-weight:400;color:var(--text-muted)}",
    ".neg-box .nb-r{margin-left:12px;color:var(--text-muted)}",
    ".unit-fx{display:inline-block;width:46px;text-align:left;color:var(--text-muted)}",
    "@media print{.navbar{display:none}}",
    /* 종이는 화면 테마와 무관하게 항상 라이트다 — 다크로 보다 눌러도 흰 바탕으로 나가야 하고,
       .theme-light가 켜진 상태까지 선택자에 넣어야 두 경우 모두 같은 값이 된다.
       배경색을 인쇄에 살리려면 print-color-adjust가 필요하다(존 막대·배지가 흰색으로 날아간다). */
    "@media print{:root,.theme-light{" + LIGHT_VARS + ";--bg-primary:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    ".noprint{display:none!important}}",
    /* 종이 여백은 브라우저 인쇄 여백에 맡긴다 — 여기서 또 주면 두 여백이 겹쳐 본문 폭이 좁아진다 */
    "@media print{.page{padding:0 0 10px;max-width:none}}",
    /* 페이지 나눔 — 섹션 통째로 '쪼개지 마라'를 걸면 한 장에 안 들어가는 섹션이 다음 장으로 통째로 밀려
       페이지마다 3분의 1 이상이 빈다. 쪼개지면 안 되는 것은 한 장에 들어가는 작은 단위(차트 한 장, 카드,
       표의 한 행, 재현성 스트립)뿐이고, 긴 섹션은 흘러가게 둔다.
       제목·그룹 머리글은 뒤 내용과 붙여야 한다 — 혼자 페이지 끝에 남으면 무엇의 제목인지 알 수 없다. */
    "@media print{.section{break-inside:auto}",
    ".chart-wrap,.sev-card,.stat-grid,.spec-panel,.build-strip,.gate-box,.summary-box,tr,.ind-row{break-inside:avoid}",
    ".group-hd,.section-title{break-after:avoid}.group-hd{break-inside:avoid}",
    "thead{display:table-header-group}tfoot{display:table-footer-group}",
    /* 스펙 패널은 인쇄 폭이 좁아 22px 값이 칸을 넘어 옆 칸 글자와 겹친다 — 종이에서만 한 단계 줄인다 */
    ".spec-v{font-size:15px}.spec-col{padding:12px 14px;min-width:110px}",
    /* 종이는 화면보다 촘촘하게 — 카드 여백이 화면 기준이면 페이지 수만 늘어난다 */
    ".section{padding:16px 18px;margin-bottom:14px}.spec-panel{margin-bottom:14px}",
    /* 종이는 전부 한 줄에 하나 — 두 장씩 앉히면 칸 폭이 340px로 줄어 눈금·범례가 뭉친다 */
    /* 인쇄는 어차피 1열이라 격자를 쓸 이유가 없다 — 격자 안의 페이지 나눔은 브라우저마다 처리가
       달라 항목이 갈릴 여지가 남는다. 블록 흐름으로 바꾸면 break-inside:avoid가 확실히 지켜진다. */
    ".grid2{display:block}.grid2>.section{margin-bottom:14px}.sev-cards{grid-template-columns:repeat(2,1fr)}",
    /* 캔버스는 그릴 때 잰 폭을 인라인 px로 박는다(chart.js) — 인쇄 여백 설정에 따라 종이 폭이
       그 값과 달라지면 오른쪽에 빈 띠가 남거나 넘친다. 종이에서는 칸을 꽉 채우게 덮어쓴다. */
    "canvas{width:100%!important;height:auto!important}",
    /* 요약 줄만 앞 장에 남고 격자가 다음 장으로 가면 무엇의 요약인지 끊긴다 */
    ".stat-sum,.sec-desc{break-after:avoid}.sec-chart{break-inside:avoid}",
    /* 재현성 스트립은 칸마다 170px을 요구해 종이 폭에서 3+2로 접히고 두 줄이 된다 —
       내용 폭만큼만 잡게 풀면 다섯 칸이 한 줄에 들어간다(문서 끝의 부속 정보라 작게 둔다) */
    ".build-strip{margin-top:14px}.build-strip .bs-i,.build-strip .bs-i.narrow{flex:1 1 auto;padding:8px 11px}",
    ".build-strip .bs-k{font-size:9px}.build-strip .bs-v{font-size:11.5px;margin-top:3px}.build-strip .bs-s{font-size:10px}}",
    "details.adv{margin-bottom:24px}",
    "details.adv>summary{cursor:pointer;font-size:12.5px;color:var(--text-secondary);padding:10px 14px;background:var(--bg-elevated);border:1px solid var(--border-faint);border-radius:8px;list-style:none}",
    "details.adv>summary::-webkit-details-marker{display:none}",
    "details.adv[open]>summary{margin-bottom:14px}",
    "@media print{details.adv[open]>summary,details.adv>summary{display:none}details.adv{display:block}}",
    ".gauge{display:flex;height:30px;border-radius:6px;overflow:hidden;border:1px solid var(--border-faint);margin-top:14px}.gauge .cell{flex:1 1 0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600}",
    ".gauge-lab{display:flex;margin-top:4px;font-size:11px;color:var(--text-muted);font-family:'D2Coding',monospace}.gauge-lab div{flex:1 1 0;text-align:center}",
    ".verdict{display:flex;align-items:baseline;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border-faint);flex-wrap:wrap}",
    "table{width:100%;border-collapse:collapse;font-size:14px}thead th{text-align:left;font-weight:600;color:var(--text-tertiary);font-size:13px;padding:12px 14px;border-bottom:1px solid var(--border-default);white-space:nowrap}",
    "tbody td{padding:12px 14px;border-bottom:1px solid var(--border-faint);color:var(--text-secondary)}tbody tr:last-child td{border-bottom:none}",
    ".num{text-align:right;font-variant-numeric:tabular-nums;font-family:'D2Coding',monospace;white-space:nowrap}",
    ".nw{white-space:nowrap}",
    ".ind-band{margin-top:3px;font-family:'Pretendard',sans-serif;font-size:11.5px;color:var(--text-muted);white-space:nowrap;word-break:keep-all}",
    "body{word-break:keep-all;overflow-wrap:break-word}",
    ".analysis-content p{margin-bottom:12px;line-height:1.7;color:var(--text-secondary);font-size:14px}",
    ".analysis-content .op-h{font-size:13px;font-weight:700;color:var(--text-primary);margin:20px 0 7px;padding-bottom:5px;border-bottom:1px solid var(--border-faint);letter-spacing:.2px}",
    ".analysis-content .op-h:first-child{margin-top:0}",
    ".analysis-content .op-li{display:flex;gap:8px;margin:3px 0 3px 2px;line-height:1.65;font-size:13.5px;color:var(--text-secondary)}",
    ".analysis-content .op-li .op-dot{color:var(--text-muted);flex-shrink:0}",
    ".analysis-content .op-li strong{color:var(--text-primary);font-weight:600}",
    ".analysis-content .op-arrow{margin:1px 0 8px 22px;padding-left:9px;border-left:1px solid var(--border-medium);color:var(--text-tertiary);font-size:12.5px;line-height:1.6}",
    ".analysis-content .op-arrow strong{color:var(--text-secondary);font-weight:600}",
    ".rec-item{margin:10px 0 6px 8px;font-size:14px;color:var(--text-secondary)}.rec-item .no{font-weight:700;color:var(--primary-hover);margin-right:8px}",
    ".build-strip{display:flex;flex-wrap:wrap;gap:1px;margin-top:26px;background:var(--border-faint);border:1px solid var(--border-faint);border-radius:6px;overflow:hidden}",
    ".build-strip .bs-i{flex:1 1 170px;background:var(--bg-panel);padding:11px 14px}",
    ".build-strip .bs-i.narrow{flex:0 1 190px}",
    ".build-strip .bs-k{font-size:9.5px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text-muted)}",
    ".build-strip .bs-v{margin-top:4px;font-size:13px;font-weight:600;color:var(--text-primary);font-family:'D2Coding',monospace;white-space:nowrap}",
    ".build-strip .bs-s{margin-top:2px;font-size:11px;color:var(--text-muted);font-family:'D2Coding',monospace;white-space:nowrap}",
    /* 인쇄 직전 재렌더용 — 캔버스는 그릴 때의 CSS 폭으로 비트맵을 굳히므로, 화면 폭(1300px)으로 그린 뒤
       종이(700px)에서 축소되면 눈금 글자가 절반 크기로 찌그러진다. 그리는 순간에도 종이와 같은
       폭·열수가 되도록 맞춘 다음 다시 그린다. */
    "body.printing .page{max-width:186mm}body.printing .grid2{grid-template-columns:1fr;gap:12px}",
    "body.printing .sev-cards{grid-template-columns:repeat(2,1fr)}",
    ".group-hd{display:flex;align-items:center;gap:10px;margin:4px 0 14px;color:var(--text-primary)}.group-hd .hr{flex:1 1 0;height:1px;background:var(--border-faint)}",
    ".grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:24px;margin-bottom:24px}.grid2 .section{margin-bottom:0}",
    ".sev-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:14px}",
    ".sev-card{padding:13px 14px;border:1px solid var(--border-faint);border-radius:9px;background:var(--bg-elevated)}",
    ".sev-card .lab{font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px}",
    ".sev-card .badge2{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:.3px;margin-left:4px;vertical-align:middle}",
    ".sev-card .val{font-size:26px;font-weight:700;letter-spacing:-.5px;margin-bottom:8px;font-variant-numeric:tabular-nums;color:var(--text-primary)}.sev-card .val .u{font-size:12px;font-weight:500;color:var(--text-muted);margin-left:2px}",
    ".sev-card .foot{display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)}",
    /* 화면과 같은 규칙 — 한 칸 한 줄, 가로 스크롤 없음. 칸은 제 내용 폭으로 시작해 남는 폭을 나눠 갖고,
       폭이 모자라면 넓은 칸부터 줄며 말줄임(전문은 title). 문장은 칸이 아니라 제목 아래 요약 줄이 싣는다. */
    ".stat-sum{font-size:12px;color:var(--text-muted);margin:-2px 0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".stat-grid{display:flex;gap:1px;background:var(--border-faint);border:1px solid var(--border-faint);border-radius:6px;overflow:hidden}",
    ".stat-grid .cell{flex:1 1 auto;min-width:0;background:var(--bg-panel);padding:13px 16px}",
    ".stat-grid .cell .k,.stat-grid .cell .v{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".stat-grid .cell .k{font-size:11px;color:var(--text-muted)}.stat-grid .cell .v{margin-top:5px;font-size:15px;font-weight:600;color:var(--text-primary);font-family:'D2Coding',monospace}",
    // 인쇄에는 hover가 없다 — 잘린 꼬리를 볼 방법이 없으므로 종이에서만 접어서 전부 남긴다
    "@media print{.stat-sum{white-space:normal}.stat-grid{flex-wrap:wrap}.stat-grid .cell .k,.stat-grid .cell .v{white-space:normal;overflow:visible}}",
  ].join('\n');

  // 저장된 리포트 안에서 차트를 그리는 부트 스크립트 (고정 코드 — 사용자 입력 미포함)
  var BOOT = [
    "(function(){",
    "var CH=window.VibeChart, R=window.RPT||{};",
    "function cc(){return document.documentElement.classList.contains('theme-light')",
    " ?{grid:'rgba(35,38,46,0.09)',axis:'#5f636f',axisLine:'#c2c6cd',hint:'#8a8d99',text:'#23262e'}",
    " :{grid:'rgba(255,255,255,0.07)',axis:'#9ba0aa',axisLine:'#4a4a4a',hint:'#6c7079',text:'#f0f1f4'};}",
    "function el(id){return document.getElementById(id);}",
    "function line(id,tip,o,cross){var c=el(id);if(!c||!o.values||!o.values.length)return;",
    " var d=function(s,e){var r=CH.drawLine(c,Object.assign({},o,{values:o.values.slice(s,e),xLabels:o.xLabels.slice(s,e),tipLabels:o.tipLabels?o.tipLabels.slice(s,e):null}),cc());if(r&&tip&&el(tip))CH.addTip(c,el(tip),cross?el(cross):null,r.pts);};",
    " d(0,o.values.length);CH.addZoom(c,o.values.length,d);}",
    "function fftc(id,tip,o){var c=el(id);if(!c||!o.freqs||!o.freqs.length)return;",
    " var d=function(s,e){var r=CH.drawFFT(c,Object.assign({},o,{freqs:o.freqs.slice(s,e),mags:o.mags.slice(s,e)}),cc());if(r&&tip&&el(tip))CH.addTip(c,el(tip),null,r.pts);};",
    " d(0,o.freqs.length);CH.addZoom(c,o.freqs.length,d);}",
    "function drawAll(){",
    " if(R.rms)line('cRms','tRms',{values:R.rms,xLabels:R.xL,tipLabels:R.xT,color:CH.SERIES.rms,height:230,smooth:true,refLines:R.refs,unit:R.unit});",
    " if(R.p2p)line('cP2p','tP2p',{values:R.p2p,xLabels:R.xL,tipLabels:R.xT,color:CH.SERIES.p2p,height:220,smooth:true,zeroBase:true});",
    " if(R.crest)line('cCrest','tCrest',{values:R.crest,xLabels:R.xL,tipLabels:R.xT,color:CH.SERIES.crest,height:220,smooth:true,refLines:[{val:3,color:'#8a8d99',label:'CF=3'},{val:6,color:'#e07b39',label:'CF=6'}]});",
    " if(R.kurt)line('cKurt','tKurt',{values:R.kurt,xLabels:R.kxl,color:'#fdb532',height:220,smooth:true,refLines:[{val:3,color:'#8a8d99',label:'정상=3'},{val:4.5,color:'#e07b39',label:'충격성 경계'}]});",
    /* 범례 클릭 → 그 계열을 빼고 다시 그린다. 축 범위가 남은 계열 기준으로 다시 잡히는 것이
       핵심이다 — 계열만 감추고 축을 그대로 두면 작은 대역은 여전히 바닥에 붙어 보이지 않는다.
       마지막으로 그린 구간(s,e)을 기억해 두어 확대해 둔 상태가 풀리지 않게 한다. */
    " if(R.bands){var cb=el('cBand');if(cb){var hid={},rng=[0,R.kxl.length];",
    "  var db=function(s,e){rng=[s,e];CH.drawMultiLine(cb,{series:R.bands.filter(function(sr){return !hid[sr.label];}).map(function(sr){return {label:sr.label,color:sr.color,vals:sr.vals.slice(s,e)};}),xLabels:R.kxl.slice(s,e),height:220},cc());};",
    "  db(0,R.kxl.length);CH.addZoom(cb,R.kxl.length,db);",
    "  var lg=document.querySelector('[data-toggle=\"cBand\"]');",
    "  if(lg)lg.addEventListener('click',function(ev){var t=ev.target;while(t&&t!==lg&&!t.getAttribute('data-series'))t=t.parentNode;",
    "    if(!t||t===lg)return;var k=t.getAttribute('data-series');",
    "    if(hid[k]){delete hid[k];t.style.opacity='';t.style.textDecoration='';}else{hid[k]=1;t.style.opacity='.35';t.style.textDecoration='line-through';}",
    "    db(rng[0],rng[1]);});}}",
    " if(R.wave)line('cWave','tWave',{values:R.wave.v,xLabels:R.wave.t,color:CH.SERIES.wave,height:240,lw:1.1},'xWave');",
    " if(R.fft)fftc('cFft','tFft',{freqs:R.fft.freqs,mags:R.fft.mags,markers:R.fft.markers,res:R.fft.res,height:280,hideMarkerLabels:true});",
    " if(R.spec){var cs=el('cSpec');if(cs)CH.drawHeat(cs,{grid:R.spec.grid,rows:R.spec.rows,cols:R.spec.cols,fmax:R.spec.fmax,height:200},cc());}",
    " if(R.kurtogram)fftc('cKurtogram',null,{freqs:R.kurtogram.freqs,mags:R.kurtogram.mags,markers:R.kurtogram.markers,res:R.kurtogram.res,height:180,hideMarkerLabels:false});",
    " if(R.env)fftc('cEnv',null,{freqs:R.env.freqs,mags:R.env.mags,markers:R.env.markers,res:1,height:210,hideMarkerLabels:true});",
    " if(R.cep)fftc('cCep',null,{freqs:R.cep.freqs,mags:R.cep.mags,markers:R.cep.markers,res:1,height:200,hideMarkerLabels:true});",
    "}",
    "window.toggleTheme=function(){var r=document.documentElement;r.classList.toggle('theme-light');try{localStorage.setItem('neoVibeReportTheme',r.classList.contains('theme-light')?'light':'dark');}catch(e){}drawAll();};",
    "function applyView(v){var b=document.body;b.classList.toggle('view-sum',v==='sum');b.classList.toggle('view-full',v!=='sum');",
    " var bs=document.querySelectorAll('.view-btn');for(var i=0;i<bs.length;i++)bs[i].classList.toggle('on',bs[i].getAttribute('data-v')===v);",
    " if(v!=='sum')setTimeout(drawAll,0);}",   // 숨김 해제 직후엔 캔버스 폭이 잡힌 뒤 그려야 한다
    "window.setView=function(v){try{localStorage.setItem('neoVibeReportView',v);}catch(e){}applyView(v);};",
    "var _v0='sum';try{_v0=localStorage.getItem('neoVibeReportView')||'sum';}catch(e){}applyView(_v0);",
    "var rt;window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(drawAll,80);});",
    "var navA=[].slice.call(document.querySelectorAll('.navbar a'));",
    "function syncNav(){var y=window.scrollY+120,cur=null;navA.forEach(function(a){var el=document.querySelector(a.getAttribute('href'));if(el&&el.getBoundingClientRect().top+window.scrollY<=y)cur=a;});navA.forEach(function(a){a.classList.toggle('on',a===cur);});}",
    "var st;window.addEventListener('scroll',function(){clearTimeout(st);st=setTimeout(syncNav,60);});syncNav();",
    "window.printReport=function(){window.print();};",
    /* 캔버스는 그릴 때의 테마 색을 픽셀로 굳힌다 — CSS만 라이트로 덮으면 흰 종이에 다크 차트가 찍힌다.
       인쇄 직전에 라이트로 바꿔 다시 그리고, 끝나면 보던 테마로 되돌린다. */
    "var _pDark=false;",
    "window.addEventListener('beforeprint',function(){var b=document.body,r=document.documentElement;",
    " b.classList.remove('view-sum');b.classList.add('view-full');b.classList.add('printing');",
    " _pDark=!r.classList.contains('theme-light');if(_pDark)r.classList.add('theme-light');drawAll();});",
    "window.addEventListener('afterprint',function(){var r=document.documentElement;",
    " document.body.classList.remove('printing');",
    " if(_pDark){r.classList.remove('theme-light');_pDark=false;}",
    " try{applyView(localStorage.getItem('neoVibeReportView')||'sum');}catch(e){applyView('sum');}drawAll();});",
    "drawAll();",
    "})();",
  ].join('\n');

  function sectionOpen(h, title, sub, hint, id, cls) {
    h.push('<div class="section' + (cls ? ' ' + cls : '') + '"' + (id ? ' id="' + id + '"' : '') + '><div class="section-title"><span class="bar"></span> ' + esc(title)
      + (sub ? ' <span style="font-weight:500;color:var(--text-muted);font-size:13px;">' + esc(sub) + '</span>' : '')
      + (hint ? ' <span class="nav-hint">' + hint + '</span>' : '')
      + '</div>');
  }

  var ZOOM_HINT = '<b>휠</b> 확대·축소 · <b>드래그</b> 이동 · <b>더블클릭</b> 리셋';

  function chartSection(h, opts) {
    // opts: {title, sub, hintText(esc필요없는 고정), desc, canvasId, h, tipId, xlineId, legend:[{label,color}]}
    /* 차트 한 장짜리 섹션은 한 페이지에 들어간다 — 통째로 묶어야 제목·설명만 앞 장에 남고
       그림이 다음 장으로 넘어가는 일이 없다(sec-chart는 인쇄 규칙에서만 쓴다). */
    sectionOpen(h, opts.title, opts.sub, opts.hint, null, 'sec-chart');
    if (opts.desc) h.push('<div class="section-desc">' + esc(opts.desc) + '</div>');
    h.push('<div class="chart-wrap"><canvas id="' + opts.canvasId + '" height="' + opts.h + '"></canvas>'
      + (opts.xlineId ? '<div class="xline" id="' + opts.xlineId + '"></div>' : '')
      + (opts.tipId ? '<div class="tooltip" id="' + opts.tipId + '"></div>' : '')
      + '</div>');
    if (opts.legend && opts.legend.length) {
      /* toggle을 준 차트는 범례를 눌러 계열을 끌 수 있다 — 계열이 여럿이면 큰 값이 작은 값을
         눌러 버려서, 끄고 봐야 비로소 작은 대역의 변화가 보인다. */
      h.push('<div class="legend"' + (opts.toggle ? ' data-toggle="' + esc(opts.canvasId) + '"' : '') + '>' + opts.legend.map(function (l) {
        var t = opts.toggle ? ' data-series="' + esc(l.label) + '" style="cursor:pointer;user-select:none" title="클릭하면 숨기거나 다시 표시합니다"' : '';
        return '<span' + t + '><span class="sw" style="background:' + esc(l.color) + ';"></span>' + esc(l.label) + '</span>';
      }).join('') + '</div>');
    }
    h.push('</div>');
  }

  // p: { docNo, alias, tagName, generatedText, logoDataURL, specs, sevMachine, gradeKo, gradeColor,
  //      zones:[문자3], zonesUnit, gradeIdx, verdict, verdictSub, anchorNote, sevCards, stats, statSummary, indics,
  //      opinion, opinionModel, actions, data(RPT — 차트 데이터), chartLibSrc(chart.js 소스),
  //      fftHint, waveDesc, envDesc, cepDesc }
  function buildReportHTML(p) {
    var d = p.data || {};
    // 후보명 "본체(부제)" 분리 — 괄호 안 보조 설명은 작은 글씨로 내려 한 줄을 짧게 유지
    var nameMain = function (f) { var i = f.indexOf('('); return i > 0 ? f.slice(0, i).trim() : f; };
    var nameSub = function (f) { var m = f.match(/\(([^)]*)\)\s*$/); return m ? m[1].replace(/^[^—-]*[—-]\s*/, '') : ''; };
    // 조치 카드 — "그래서 뭘 해야 하나"에 1초 안에 답하는 한 장. 해당하는 것만 크게.
    // 게이트 카드는 A~D 팔레트를 쓰지 않는다(중립색) — 계측 상태를 기계 등급으로 오독하면 안 된다.
    var actionCard = function (a) {
      return '<div class="act ' + esc(a.cls || '') + '">'
        + '<div class="act-h"><span class="act-ic">' + (a.icon || '') + '</span>' + esc(a.title || '') + '</div>'
        + (a.body ? '<div class="act-b">' + esc(a.body) + '</div>' : '')
        + (a.basis ? '<div class="act-x">근거 · ' + esc(a.basis) + '</div>' : '')
        + (a.aside ? '<div class="act-a">' + esc(a.aside) + '</div>' : '')
        + '</div>';
    };
    // ★ 대신 사각 pip — 별은 "평점"으로 읽혀 근거 강도가 등급처럼 오독된다
    var pips = function (n) {
      var o = '<span class="pips">';
      for (var i = 0; i < 5; i++) o += '<i class="' + (i < n ? (n >= 4 ? 'hi' : 'on') : '') + '"></i>';
      return o + '</span>';
    };
    var h = [];
    h.push('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">');
    h.push('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">');
    h.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    h.push('<title>' + esc(p.alias) + ' 진동 분석 리포트</title>');
    h.push("<script>try{if(localStorage.getItem('neoVibeReportTheme')==='light')document.documentElement.classList.add('theme-light');}catch(e){}<\/script>");
    h.push('<style>' + CSS + '</style></head><body><div class="page">');

    // ── 헤더 ──
    h.push('<div class="report-header"><div>');
    h.push('<div class="eyebrow">Vibration Analysis Report</div>');
    h.push('<h1><span class="hl">' + esc(p.alias) + '</span> 진동 분석 리포트</h1>');
    h.push('<div class="meta-row">');
    h.push('<span class="meta"><span class="meta-k">생성</span><span class="meta-v mono">' + esc(p.generatedText) + '</span></span>');
    h.push('<span class="meta"><span class="meta-k">태그</span><span class="meta-v mono">' + esc(p.tagName) + '</span></span>');
    h.push('<span class="meta"><span class="meta-k">문서번호</span><span class="meta-v mono">' + esc(p.docNo) + '</span></span>');
    h.push('</div></div><div class="hd-right">');
    if (p.logoDataURL) h.push('<img class="logo" src="' + p.logoDataURL + '" alt="MACHBASE NEO">');
    h.push('<div class="view-sw"><button class="view-btn on" data-v="sum" onclick="setView(\'sum\')">요약</button><button class="view-btn" data-v="full" onclick="setView(\'full\')">전체</button></div>');
    h.push('<div class="hd-btns">');
    h.push('<button class="theme-btn noprint" onclick="printReport()" title="인쇄 · PDF로 저장">');
    h.push('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>');
    h.push('</button>');
    h.push('<button class="theme-btn noprint" onclick="toggleTheme()" title="라이트/다크 전환">');
    h.push('<svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>');
    h.push('<svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>');
    h.push('</button></div></div></div>');

    // ── 조회 스펙 패널 ──
    h.push('<div class="spec-panel">');
    (p.specs || []).forEach(function (s) {
      // 날짜·시각은 한 덩어리로 — "2025-" / "11-24 10:19"처럼 중간에서 끊기면 읽을 수 없다
      var sv = esc(s.v).split(' ~ ').map(function (x) { return '<span class="nw">' + x + '</span>'; }).join(' ~ ');
      h.push('<div class="spec-col"><div class="spec-k">' + esc(s.k) + '</div><div class="spec-v">' + sv
        + (s.unit ? '<span style="font-size:13px;font-weight:600;color:var(--text-tertiary);margin-left:3px;">' + esc(s.unit) + '</span>' : '') + '</div></div>');
    });
    h.push('</div>');

    // ── 요약 모드 (30초 판독) ────────────────────────────────────────────────
    // 8블록 최소 집합. 순서는 "상태 → 후보"이지 "후보 → 상태"가 아니다 — 평균이 양호한 기계에
    // 결함명이 첫 줄로 오면 거짓 경보가 되고, 다음 진짜 경보가 무시된다.
    // [5]측정 불가·[6]음성 소견·[7]미설명은 게이트와 무관하게 항상 인쇄한다
    // (게이트가 만든 게 아니라 계측 구성·메타데이터가 만든 것이라 센서를 다시 붙여도 남는다).
    // ⚠요약과 심각도 섹션이 함께 쓰므로 요약보다 앞에서 선언한다
    //   (아래에서 var로 선언하면 호이스팅 탓에 요약에서는 undefined가 되어 ISO 행이 통째로 사라진다)
    var isoH = d.iso; // {rms, gradeIdx, gradeKo, color, anaSec, blocks, spread, spreadWarn}
    var sm = d.summary;
    if (sm) {
      h.push('<div class="summary-box">');
      h.push('<div class="sum-hd"><span class="sum-eyebrow">요약</span><span class="sum-sub">30초 판독용 · 근거와 그래프는 아래 상세 분석에 있습니다</span></div>');

      // [1] 최상위 상태 — 게이트·가속도 보류·조치를 한 박스에 묶는다.
      //    셋은 별개 사건이 아니라 "계측을 못 믿는다"는 한 사건의 세 측면이다.
      //    박스를 쪼개면 경고 개수만 늘어 정작 중요한 것이 묻힌다.
      var alerts = [];
      if (sm.gate) {
        alerts.push({ t: '계측 검증 필요 — 결함 진단 보류', head: true, lines: [
          esc(sm.gateReason),
          'Crest 15 초과는 단발 스파이크(ESD·케이블·커넥터·마운트) 시그니처입니다. 시간영역 임펄스는 주파수영역으로 퍼지므로 <b>모든 스펙트럼 피크 진폭이 잠정</b>입니다.',
        ] });
      }
      if (d.levelsOk === false) {
        alerts.push({ t: '가속도 값 게재 보류', lines: ['에너지 중심 f_eff ' + (d.accelFeff / 1000).toFixed(1)
          + ' kHz = Nyquist의 ' + Math.round(d.accelNyqFrac * 100) + '% — 안티에일리어싱 필터·센서 공진 확인 전까지 가속도 값을 쓰지 마십시오'] });
      }

      if (alerts.length) {
        var cls0 = sm.gate ? 'red' : (isoH && isoH.gradeIdx >= 2 ? 'red' : isoH && isoH.gradeIdx === 1 ? 'amber' : 'ok');
        h.push('<div class="sum-alert ' + cls0 + '">');
        alerts.forEach(function (a, ai) {
          if (ai) h.push('<div class="al-div"></div>');
          h.push('<div class="' + (a.head ? 't' : 't2') + '">' + (a.head ? '<span class="dot"></span>' : '') + esc(a.t) + '</div>');
          a.lines.forEach(function (ln) { h.push('<div class="d">' + ln + '</div>'); });
        });
        // 조치 카드 — 박스 안 마지막. 게이트가 조치의 전제이므로 게이트 줄 아래에 온다.
        if (sm.action) h.push(actionCard(sm.action));
        h.push('</div>');
      } else {
        if (sm.action) h.push('<div class="sum-alert plain">' + actionCard(sm.action) + '</div>');
      }

      // [2] 상태 — 규격 판정과 감시 등급은 다른 값이며 한 문장에 섞지 않는다
      h.push('<div class="sum-sec"><div class="sum-t">' + (sm.gate ? '관측값 <span class="mut">— 게이트 적용 중 · 전부 잠정</span>' : '상태') + '</div>');
      // 한 문서에 RMS가 여러 종류라 "주의"와 "위험"이 동시에 보인다 — 판정에 쓰는 값을 못박고 나머지를 참고로 내린다
      /* 등급은 ISO 하나가 만들지 않는다 — 결함 패턴이 게이트이고 ISO는 그 높이를 정한다.
         "ISO가 판정값"이라고 쓰면 진동만 높고 베어링은 멀쩡한 경우를 문서가 설명 못 한다. */
      if (isoH) h.push('<div class="judge-note">등급은 <b>결함 패턴이 켜질 때만</b> 오르고, 그 높이를 '
        + '<b>ISO 대역제한 속도 RMS ' + esc(isoH.rms) + ' ' + esc(p.zonesUnit || 'mm/s') + '</b>가 정합니다'
        + (sm.gate ? ' <span class="mut">— 단, 계측 게이트로 판정 보류</span>' : '')
        + '. ISO 값만 높고 결함 근거가 없으면 등급을 올리지 않습니다 — 원인이 베어링 밖일 수 있습니다. 아래 나머지 값은 참고입니다.</div>');
      h.push('<table class="sum-tbl"><tbody>');
      if (isoH) {
        // 게이트 중에는 "판정"이 아니라 관측값이다 — 라벨·색을 내리고 편향 방향(상한/하한)을 밝힌다.
        // 값을 숨기지는 않는다: 8블록 평균한 대역제한 값이 이 리포트에서 아티팩트에 가장 강건한 숫자다.
        h.push('<tr><td class="k">' + (sm.gate ? 'ISO 대역제한 속도 RMS<div class="k-sub">판정 보류</div>' : 'ISO 10816 판정') + '</td>'
          + '<td class="v">' + (sm.gate
            ? '<span class="mut">' + esc(isoH.gradeKo) + ' 수준</span> · ' + esc(isoH.rms) + ' ' + esc(p.zonesUnit || 'mm/s') + ' <span class="tag">잠정</span>'
            : '<b style="color:' + esc(isoH.color) + ';">' + esc(isoH.gradeKo) + '</b> · ' + esc(isoH.rms) + ' ' + esc(p.zonesUnit || 'mm/s')) + '</td>'
          + '<td class="n">10–1000 Hz 대역제한 · ' + (isoH.blocks || 1) + '블록 평균 · 총 ' + esc(isoH.anaSec) + '초'
          + (sm.winNote ? '<br>' + esc(sm.winNote) : '')
          + (sm.gate && sm.bias ? '<br><span class="amber">' + esc(sm.bias) + '</span>' : '')
          + (isoH.spreadWarn ? '<br><span class="amber">블록간 변동 ×' + esc(isoH.spread) + ' — 정상상태 전제 미충족, 존 판정 잠정</span>' : '') + '</td></tr>');
      }
      if (d.mon) {
        h.push('<tr><td class="k">실시간 감시<div class="k-sub">알람 기준</div></td><td class="v"><b style="color:' + esc(d.mon.color) + ';">' + esc(d.mon.gradeKo) + '</b> · ' + esc(d.mon.rms) + ' ' + esc(d.mon.unit || '') + '</td>'
          + '<td class="n">' + esc(d.mon.basis || '') + (d.mon.src ? ' · 등급 결정: ' + esc(d.mon.src) : '')
          + (d.mon.wide ? '<br><span class="mut">전대역 ' + esc(d.mon.wide) + ' ' + esc(d.mon.unit || '') + ' — 차이는 1 kHz 초과 성분</span>' : '') + (sm.gate ? '<br><span class="amber">\uD83D\uDFE1 게이트 적용 중 — 이 등급도 잠정</span>' : '') + '</td></tr>');
      }
      h.push('<tr><td class="k">회전수</td><td class="v">' + esc(sm.rpmTxt) + '</td><td class="n">차수는 실측 기준</td></tr>');
      h.push('<tr><td class="k">관측 창</td><td class="v">' + esc(sm.obsTxt) + '</td><td class="n">이 창을 넘는 시간 스케일 주장 불가</td></tr>');
      h.push('</tbody></table></div>');

      if (p.actions && p.actions.length) {
        h.push('<div class="sum-sec"><div class="sum-t">지금 할 일</div><ol class="sum-ol">');
        p.actions.slice(0, 3).forEach(function (a) { h.push('<li>' + esc(a.txt) + '</li>'); });
        h.push('</ol></div>');
      }

      // [4] 후보 — 게이트 중이면 제목에 상한을 밝힌다(★ 표시가 상한을 우회하지 않도록)
      if (sm.cands && sm.cands.length) {
        h.push('<div class="sum-sec"><div class="sum-t">' + (sm.gate ? '잠정 후보 <span class="amber">— 진단 보류 중 · 전역 상한 ' + sm.gateCap + '/100</span>' : '결함 후보') + '</div><table class="sum-tbl"><tbody>');
        sm.cands.forEach(function (c, ci) {
          var st = Math.max(0, Math.min(5, Math.round(c.s || 0)));
          // 절대 점수만 보면 "40점이면 약한가?"로 읽힌다 — 상대 등급을 함께 준다
          var lv = c.score == null ? '' : (c.score >= 70 ? '강함' : c.score >= 40 ? '중간' : c.score >= 20 ? '약함' : '근거 부족');
          h.push('<tr class="' + (ci === 0 ? 'top' : '') + '"><td class="k">' + (ci === 0 ? '<span class="rk">1순위</span> ' : '') + esc(nameMain(c.f))
            + (nameSub(c.f) ? '<div class="cand-sub">' + esc(nameSub(c.f)) + '</div>' : '') + '</td>'
            + '<td class="v">' + pips(st) + '<span class="mono">' + (c.score == null ? '—' : c.score + '/100') + '</span>' + (lv ? ' <span class="lv">' + lv + '</span>' : '') + '</td>'
            + '<td class="n">' + esc(c.why || '') + '</td></tr>');
        });
        h.push('</tbody></table></div>');
      }

      // 한계·반대 증거 — 2열(라벨|내용)은 무엇이 제목이고 어디까지가 그 내용인지 구분이 안 된다.
      // 상세의 음성 소견 블록과 같은 구조로 통일: 제목 한 줄 + 그 아래 들여쓴 줄.
      var _um = sm.unmeasurable || [], _ng = d.negatives || [], _ux = d.unexplained || [];
      var limBlk = function (label, n, unit, sub, rows) {
        h.push('<div class="nb-t">' + label + '<span class="lc">' + n + unit + '</span>'
          + (sub ? ' <span class="nb-s">— ' + sub + '</span>' : '') + '</div>');
        rows.forEach(function (r) { h.push('<div class="nb-r">' + r + '</div>'); });
      };
      if (_um.length || _ng.length || _ux.length) {
        h.push('<div class="sum-div">판단의 한계 — 왜 확정하지 못했나</div>');
        h.push('<div class="lim-box">');
        if (_um.length) limBlk('이 측정으론 볼 수 없음', _um.length, '종', '원리상 판별 불가',
          [esc(_um.map(function (u) { return u.f.replace(/\s*\([^)]*\)/, ''); }).join(' · ')), '위상·설비 제원 미입력']);
        if (_ng.length) limBlk('확인했으나 미검출', _ng.length, '건', '반대 증거', _ng.map(function (n) { return esc(n); }));
        if (_ux.length) limBlk('아직 설명 못 한 성분', _ux.length, '개', '사전으로 설명되지 않음',
          [esc(_ux.join(' · ')), '구동 계통도(풀리비·기어비)·인접 기계 확인 시 대부분 해소']);
        h.push('</div>');
      }
      h.push('<div class="sum-more">상세 근거·그래프·LLM 소견은 <a href="#" onclick="setView(\'full\');return false;" class="lnk">전체 보기</a>에서 · 인쇄하면 이 요약 대신 전체 보기가 인쇄됩니다</div>');
      h.push('</div>');
    }
    h.push('<div id="detail">');   // 요약 보기에서 숨겨지는 상세 영역(인쇄 시엔 항상 노출)
    // 바로가기는 상세 상단에 — 요약은 짧게 유지하고, 긴 문서를 여는 쪽에 이동 수단을 둔다
    h.push('<div class="navbar"><span class="nl">바로가기</span>'
      + '<a href="#s-sev">심각도</a><a href="#s-trend">추세</a><a href="#s-spec">스펙트럼</a><a href="#s-evid">결함 근거</a>'
      + (p.opinion ? '<a href="#s-llm">LLM 소견</a>' : '') + '<a href="#s-verdict">권고</a></div>');

    // ── 심각도 평가 ──
    // 헤드라인은 ISO 10816 규격 정의(10–1000 Hz 대역제한 속도 RMS)로 판정 — 광대역 감시 RMS(알람용)와 분리.
    // 감시 등급이 더 높아도 규격 판정은 방어 가능한 값이어야 정비팀 신뢰를 유지한다.
    var hlKo = isoH ? isoH.gradeKo : p.gradeKo, hlColor = isoH ? isoH.color : p.gradeColor, hlIdx = isoH ? isoH.gradeIdx : p.gradeIdx;
    sectionOpen(h, '진동 심각도 평가', null, '<span class="mono">' + esc(p.sevMachine) + '</span>', 's-sev');
    h.push('<div class="sev-box">');
    h.push('<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">' + (isoH
      ? 'ISO 10816 판정 <span style="color:var(--text-tertiary);">· 10–1000 Hz 대역제한 속도 RMS ' + esc(isoH.rms) + ' ' + esc(p.zonesUnit || 'mm/s')
        + (isoH.blocks ? ' · ' + isoH.blocks + '블록 에너지 평균' : '') + (isoH.anaSec ? ' · 총 ' + esc(isoH.anaSec) + '초' : '')
        + (isoH.spread ? ' · 블록간 변동 ×' + esc(isoH.spread) : '') + ' — 규격 정의 물리량 기준</span>'
        + (isoH.spreadWarn ? '<span style="margin-left:6px;color:#c77d0a;font-weight:600;">⚠정상상태 전제 미충족 — 존 판정 잠정</span>' : '')
        + (d.parsevalOk === false ? '<span style="margin-left:6px;color:#e5484d;font-weight:700;">⚠대역 분해 검산 실패(' + esc(d.parsevalErr) + '%) — 해석 전 계측 확인 필요</span>' : '')
      : '종합 위험도 <span style="color:var(--text-tertiary);">· 광대역 최신 순간 RMS(1초 롤업) 존 기준</span>') + '</div>');
    h.push('<span style="font-size:38px;font-weight:800;line-height:1;letter-spacing:-.5px;color:' + esc(hlColor) + '">' + esc(hlKo) + '</span>');
    var Z = p.zones || ['-', '-', '-'];
    var zoneDefs = [
      { ko: '양호', range: '< ' + Z[0] }, { ko: '주의', range: Z[0] + '–' + Z[1] },
      { ko: '위험', range: Z[1] + '–' + Z[2] }, { ko: '심각', range: '> ' + Z[2] },
    ];
    if (isoH) h.push('<span class="zone-lab">ISO 10816 Zone ' + ['A', 'B', 'C', 'D'][isoH.gradeIdx] + '</span>');
    h.push('<div class="gauge">');
    zoneDefs.forEach(function (zz, i) {
      var act = i === hlIdx;
      h.push('<div class="cell" style="' + (act ? 'background:' + STATUS_COLOR[zz.ko] + ';color:#fff;' : 'background:var(--bg-elevated);color:var(--text-muted);') + 'border-right:1px solid var(--border-faint);">' + zz.ko + '</div>');
    });
    h.push('</div><div class="gauge-lab">');
    zoneDefs.forEach(function (zz) { h.push('<div>' + esc(zz.range + (p.zonesUnit ? ' ' + p.zonesUnit : '')) + '</div>'); });
    h.push('</div>');
    if (isoH && d.mon) h.push('<div style="margin-top:8px;font-size:12px;color:var(--text-secondary);">실시간 감시 등급(' + esc(d.mon.rms) + ' ' + esc(d.mon.unit || '') + '): <b style="color:' + esc(d.mon.color) + ';">' + esc(d.mon.gradeKo) + '</b> <span style="color:var(--text-muted);">— ' + esc(d.mon.basis || '') + '</span>'
      + (d.gate ? '<div style="margin-top:3px;color:#c77d0a;">⚠계측 게이트 적용 중 — 이 등급도 잠정입니다'
        + (d.hfFrac > 0.2 ? '. 분석 창(' + esc(d.anaSecTxt) + '초) 광대역 ' + esc(d.velBB) + ' ' + esc(d.mon.unit || '') + ' 기준으로 에너지의 '
          + Math.round(d.hfFrac * 100) + '%가 게재 보류된 1 kHz 초과 대역이며, 그 대역을 제외하면 ' + esc(d.velExHigh) + ' ' + esc(d.mon.unit || '')
          + (d.exHighSameZone === true ? '로 규격 판정과 같은 존입니다' : d.exHighSameZone === false ? '(' + esc(d.exHighZoneKo) + ' 존)입니다' : '입니다')
          + ' — 감시값(1초 롤업)과는 산출 창이 다릅니다' : '') + '</div>' : '') + '</div>');
    h.push('<div class="verdict"><span style="font-weight:700;">' + esc(p.verdict) + '</span><span style="font-size:12px;color:var(--text-tertiary);">' + esc(p.verdictSub) + '</span>'
      + (p.anchorNote ? '<span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">' + esc(p.anchorNote) + '</span>' : '') + '</div>');
    h.push('</div>');
    h.push('<div style="font-size:11px;color:var(--text-muted);margin-bottom:7px;">기간 통계 — 선택한 기간 전체의 롤업 버킷에서 냅니다. 등급이 아닙니다(등급은 위 종합 판정)</div>');
    h.push('<div class="sev-cards">');
    (p.sevCards || []).forEach(function (c) {
      /* 화면과 같은 규칙 — 등급어 배지만 색으로 채우고, 등급이 아닌 배지(참고·잠정)는 테두리만 둔다.
         회색으로 채우면 그 카드가 꺼진 것처럼 읽힌다. 관측 사실(충격성 강함)은 앰버로 채워 눈에 남긴다. */
      var _kg = STATUS_COLOR[c.badgeKo] || (NOTE_BADGE[c.badgeKo] ? '#d99a2b' : '');
      var bc = _kg || 'var(--text-muted)';
      var bstyle = _kg ? 'color:' + bc + ';background:' + bc + '26;' : 'color:' + bc + ';border:1px solid var(--border-medium);';
      h.push('<div class="sev-card"><div class="lab">' + esc(c.label)
        + (c.badgeKo ? '<span class="badge2" style="' + bstyle + '">' + esc(c.badgeKo) + '</span>' : '') + '</div>'
        + '<div class="val">' + esc(c.value) + '<span class="u">' + esc(c.unit || '') + '</span></div>'
        + '<div class="foot"><span>' + esc(c.thr) + '</span><span style="color:' + (c.over ? '#e5484d' : '#3aa76d') + ';font-weight:600;">' + esc(c.arrow + ' ' + c.delta) + '</span></div>'
        + (c.foot2 ? '<div style="margin-top:4px;font-size:10.5px;color:var(--text-muted);line-height:1.45;">' + esc(c.foot2) + '</div>' : '')
        + '</div>');
    });
    h.push('</div></div>');

    // ── 종합 진동 레벨 (물리량별 RMS) — 에너지가 어느 도메인에 있나. 단위가 달라 값 크기 직접 비교는 불가(막대 없음) ──
    if (d.levels) {
      var _lu = [{ u: 'g', l: '가속도', d: '고주파(베어링·기어) · 광대역 변환값 — 미분이 고주파 잡음을 증폭해 과대 가능(방향 참고용)' }, { u: 'mm/s', l: '속도', d: '광대역 — ISO 판정은 10–1000 Hz 대역제한 값(심각도 평가 참조)' }, { u: 'μm', l: '변위', d: '저주파 — 사실상 1× 성분 지배(불균형·정렬 계열 지표)' }];
      var fmtL = function (v) { return (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)); };
      sectionOpen(h, '종합 진동 레벨');
      h.push('<div style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px;">같은 신호를 세 물리량으로 본 RMS · 어느 대역에 에너지가 있는지 방향 파악용 (단위가 달라 값끼리 크기 비교는 하지 않음)</div>');
      h.push('<table><thead><tr><th>물리량</th><th class="num" style="width:150px;">RMS</th><th>관점</th></tr></thead><tbody>');
      _lu.forEach(function (x) {
        if (d.levels[x.u] == null) return;
        var iso = (x.u === (d.natUnit || d.isoUnit));
        // 가속도 에너지 중심이 Nyquist에 근접하면 물리 신호로 볼 수 없다 → 값 대신 보류 사유를 인쇄
        var hold = (x.u === 'g' && d.levelsOk === false);
        var valCell = hold
          ? '<span style="color:#e5484d;font-weight:600;">게재 보류</span>'
          : fmtL(d.levels[x.u]) + ' <span style="color:var(--text-muted);">' + x.u + '</span>';
        var descCell = hold
          ? '에너지 중심 f_eff ' + (d.accelFeff / 1000).toFixed(1) + ' kHz = Nyquist의 ' + Math.round(d.accelNyqFrac * 100) + '% — 안티에일리어싱 필터 부재 시 센서 공진 폴딩 또는 미분 증폭 잡음. 계측 구성 확인 전까지 사용 금지'
          : x.d;
        h.push('<tr><td>' + x.l + (iso ? ' <span style="font-size:10px;color:var(--primary-light);">(센서 원본)</span>' : '') + '</td>'
          + '<td class="num mono">' + valCell + '</td>'
          + '<td style="color:' + (hold ? '#c77d0a' : 'var(--text-muted)') + ';font-size:12px;">' + descCell + '</td></tr>');
      });
      h.push('</tbody></table></div>');
    }

    // ── 계측 경고 — 게이트와 신호 품질은 같은 관측이므로 한 배너로 합친다.
    //    경고 피로는 개수가 아니라 "같은 사실의 반복"에서 온다(빨강은 게이트·가속도 보류 둘만).
    var _qi = (d.quality && d.quality.issues) ? d.quality.issues : [];
    if (d.gate || _qi.length) {
      var redG = !!d.gate;
      h.push('<div class="gate-box' + (redG ? '' : ' amber') + '">');
      h.push('<div class="gb-t">' + (redG ? '계측 검증 필요 — 결함 진단 보류' : '신호 품질 주의') + '</div>');
      // 발화한 검사를 각각 제목+설명으로 — 한 줄로 이어붙이면 무엇이 걸렸는지 안 읽힌다
      _qi.forEach(function (x) {
        var dt = String(x.detail || ''), cut = dt.indexOf('—');
        h.push('<div class="gb-i"><div class="gb-il">' + esc(x.label) + ' — ' + esc(cut > 0 ? dt.slice(0, cut).trim() : dt) + '</div>'
          + (cut > 0 ? '<div class="gb-id">' + esc(dt.slice(cut + 1).trim()) + '</div>' : '') + '</div>');
      });
      h.push('<div class="gb-d">' + (redG
        ? '극단적 Crest/첨도는 베어링 결함(통상 Crest &lt;10)보다 단발 스파이크(ESD·케이블 흔들림·커넥터 접촉·마운트 덜컹임) 시그니처에 가깝습니다. 센서 마운팅·케이블·커넥터 점검 후 재측정을 권장하며, 아래 결함 후보·근거 점수는 계측 검증 전까지 <b>잠정 참고용</b>입니다.'
        : '측정 신뢰도 저하 — 아래 판정은 센서 점검 전 잠정입니다.') + '</div></div>');
    }

    // ── 통계 요약 ──
    sectionOpen(h, '통계 요약');
    if (p.statSummary) h.push('<div class="stat-sum" title="' + esc(p.statSummary) + '">' + esc(p.statSummary) + '</div>');
    h.push('<div class="stat-grid">');
    (p.stats || []).forEach(function (s) {
      h.push('<div class="cell"><div class="k" title="' + esc(s.k) + '">' + esc(s.k) + '</div>'
        + '<div class="v" title="' + esc(s.t || s.v) + '">' + esc(s.v) + '</div></div>');
    });
    h.push('</div></div>');

    // ── 추세 분석 ──
    h.push('<div class="group-hd" id="s-trend"><span style="font-size:13px;font-weight:700;letter-spacing:.6px;">추세 분석</span><span style="font-size:11px;color:var(--text-muted);">시간에 따른 지표 변화 · 열화 진행 추적</span><span class="hr"></span></div>');
    if (d.rms) chartSection(h, { title: 'RMS 추이', sub: 'ISO 10816 존 기준선', hint: ZOOM_HINT, canvasId: 'cRms', h: 230, tipId: 'tRms' });
    var g2 = [];
    if (d.p2p) g2.push({ title: 'Peak-to-Peak 추이', canvasId: 'cP2p', h: 220, tipId: 'tP2p' });
    if (d.crest) g2.push({ title: 'Crest Factor 추이', sub: '충격성 지표', canvasId: 'cCrest', h: 220, tipId: 'tCrest' });
    if (d.kurt) g2.push({ title: '첨도 추이', sub: 'Kurtosis · 3 = 정상', canvasId: 'cKurt', h: 220, tipId: 'tKurt' });
    if (d.bands) g2.push({ title: '결함 대역 에너지 추이', sub: 'Band Energy', canvasId: 'cBand', h: 220, toggle: true, legend: d.bands.map(function (b) { return { label: b.label, color: b.color }; }) });
    if (g2.length) {
      h.push('<div class="grid2">');
      g2.forEach(function (c) { chartSection(h, c); });
      h.push('</div>');
    }

    // ── 스펙트럼 분석 ──
    var _duTag = (d.dispUnit && d.natUnit && d.dispUnit !== d.natUnit) ? '<span style="font-size:11px;font-weight:700;color:var(--primary-light);background:rgba(0,108,210,.14);padding:1px 7px;border-radius:4px;">표시 물리량: ' + esc(d.dispUnit) + ' (' + esc(d.natUnit) + '에서 변환)</span>' : (d.dispUnit ? '<span style="font-size:11px;color:var(--text-muted);">표시 물리량: ' + esc(d.dispUnit) + '</span>' : '');
    h.push('<div class="group-hd" id="s-spec"><span style="font-size:13px;font-weight:700;letter-spacing:.6px;">스펙트럼 분석</span><span style="font-size:11px;color:var(--text-muted);">주파수 성분 분해 · 결함 가설 탐색</span><span class="hr"></span>' + _duTag + '</div>');
    // 기본 노출은 2개. 게이트가 걸리면 그 근거가 시간영역에 있으므로 파형이 FFT보다 위다
    // — 단발 임펄스는 주파수영역에서 평탄하게 퍼져 FFT에는 원인이 보이지 않는다.
    var _wave = function () { if (d.wave) chartSection(h, { title: '원시 파형', sub: 'Raw Waveform', hint: ZOOM_HINT, desc: p.waveDesc, canvasId: 'cWave', h: 240, tipId: 'tWave', xlineId: 'xWave' }); };
    var _fft = function () {
      if (!d.fft) return;
      chartSection(h, {
        title: 'FFT 주파수 스펙트럼', hint: '<span class="mono">' + esc(p.fftHint || '') + '</span>', desc: '주파수별 성분 분해 · 결함 주파수와 대조해 가설 수립(확정은 다축·위상 필요)',
        canvasId: 'cFft', h: 280, tipId: 'tFft',
        legend: (d.fft.markers || []).filter(function (m) { return m.kind !== 'h'; }).map(function (m) { return { label: m.label + ' ' + m.freq.toFixed(1) + ' Hz', color: m.kind === 'f' ? '#e5646a' : '#8a8f99' }; }),
      });
    };
    if (d.gate) { _wave(); _fft(); } else { _fft(); _wave(); }
    // 나머지는 접되 요약줄에 숫자를 남긴다 — 접힌 줄만 읽어도 무엇이 있는지 알아야 "안 본 것"이 되지 않는다.
    // 전체 보기에서는 접지 않는다 — 요약/전체 토글이 이미 "짧게 보기"를 담당한다.
    if (d.spec) chartSection(h, { title: '스펙트로그램', sub: '시간×주파수', desc: '충격이 특정 시각에 몰렸는지(계측 사고) 구간에 고르게 퍼졌는지(기계 현상) 판별 · 밝을수록 강한 성분', canvasId: 'cSpec', h: 200 });
    /* 커토그램은 **참고**다 — 복조는 고정 1~5 kHz에서 한다(첨도 최대화가 안티에일리어싱 잡음·
       인버터 스위칭 대역에 붙잡혀 검출이 54%→11%로 떨어졌다). 화면은 이미 "(고정)"이라 적는데
       리포트만 옛 문구가 남아 "판정이 SK 최댓값 대역에서 나왔다"고 읽히고 있었다. */
    if (d.kurtogram) chartSection(h, { title: '대역별 충격성', sub: 'Kurtogram · Spectral Kurtosis', desc: (d.kurtogram.best ? '충격성 최대 대역 ' + (d.kurtogram.best.loHz / 1000).toFixed(1) + '–' + (d.kurtogram.best.hiHz / 1000).toFixed(1) + ' kHz (SK ' + d.kurtogram.best.sk.toFixed(1) + ') · 참고용 — 복조는 고정 1–5 kHz에서 합니다 · 마운팅이 자석이면 2 kHz 초과 분석은 무효' : '충격성이 가장 강한 대역 자동 탐색'), canvasId: 'cKurtogram', h: 180 });
    if (d.env) chartSection(h, { title: '포락선 스펙트럼', sub: 'Envelope · 고정 1–5 kHz 대역으로 복조(커토그램은 참고)', desc: p.envDesc, canvasId: 'cEnv', h: 210 });
    if (d.cep) chartSection(h, { title: '켑스트럼', sub: 'Cepstrum', desc: p.cepDesc, canvasId: 'cCep', h: 200 });

    // ── 지표 요약 ──
    sectionOpen(h, '지표 요약');
    h.push('<table><thead><tr><th>지표</th><th class="num" style="width:200px;white-space:nowrap;">측정값</th><th>비고</th></tr></thead><tbody>');
    (p.indics || []).forEach(function (it) {
      // 값과 단위를 분리해 고정폭으로 — 숫자 열이 흔들리지 않게. 단위 없는 지표는 "무차원"
      var uKnown = /^(mm\/s|g|μm)$/.test(it.hint || '') ? it.hint : '';
      var band = (!uKnown && it.hint) ? it.hint : '';   // 밴드 해석(계측 아티팩트 의심 등)은 값과 줄을 나눈다
      h.push('<tr><td>' + esc(it.k) + '</td><td class="num"><span class="nw">' + esc(it.v) + ' <span class="unit-fx">' + esc(uKnown || '무차원') + '</span></span>'
        + (band ? '<div class="ind-band">' + esc(band) + '</div>' : '') + '</td>'
        + '<td style="font-size:12px;color:var(--text-muted);">' + esc(it.desc || '') + '</td></tr>');
    });
    h.push('</tbody></table></div>');

    // ── 결함 근거 강도 (Evidence) — 규칙 기반 자동 산출. LLM 소견 위에 배치해 "근거→해석" 순서 ──
    if (d.evidence && d.evidence.length) {
      var starOf = function (s) { s = Math.max(0, Math.min(5, Math.round(s))); return '★★★★★'.slice(0, s) + '☆☆☆☆☆'.slice(0, 5 - s); };
      sectionOpen(h, '결함 근거 강도', '근거 점수(Evidence Score, 0~100) · 높은 순 = 우선순위', null, 's-evid');
      h.push('<div style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px;">동기/비동기 피크·충격성·대역 에너지 등 실제 지표에서 규칙으로 산출한 <b>근거 점수(Evidence Score)</b>입니다 — <b>확률(%)이 아닙니다</b>. "근거" 열에 점수를 만든 가점 내역을 그대로 공개합니다.</div>');
      /* 1순위 점수가 채택 임계에 못 미치면 그 사실을 표 위에 적는다 — 표는 점수 순으로 정렬되므로
         약한 후보도 맨 위에 놓이고, 그러면 판정문이 원인을 안 짚었는데도 표만 원인을 지목한 것처럼 읽힌다. */
      if (d.evidWeak) {
        h.push('<div style="font-size:11px;color:#c77d0a;margin:-6px 0 10px;padding:7px 10px;border:1px solid rgba(199,125,10,.35);border-radius:6px;">'
          + '<b>유력 후보 없음</b> — 1순위 점수가 원인 채택 기준에 못 미칩니다. 아래는 <b>상대 순위일 뿐 원인 지목이 아닙니다</b>.</div>');
      }
      h.push('<table><thead><tr><th>결함 후보</th><th style="width:120px;">근거 강도</th><th class="num" style="width:66px;">근거점수</th><th>근거 내역 (가점 합산)</th></tr></thead><tbody>');
      d.evidence.forEach(function (c, i) {
        var sc = c.score != null ? c.score : c.s * 20;
        var detail = c.na ? '<span style="color:#c77d0a;">' + esc(c.caveat || '판별 조건 미충족') + '</span> — 점수 산정 대상 아님(볼 수 없는 것이지 가능성이 낮은 것이 아님)'
          : (c.breakdown ? esc(c.breakdown) : esc(c.why)) + (c.caveat ? ' <span style="color:#c77d0a;">· ' + esc(c.caveat) + '</span>' : '');
        // na = 근거 부족이 아니라 "이 측정 구성으론 볼 수 없음"(위상·축방향 필요) — 낮은 점수와 구분해 표기
        var starCell = c.na ? '<span style="font-size:11px;color:var(--text-muted);">측정 불가</span>' : '<span style="letter-spacing:1px;">' + starOf(c.s) + '</span>';
        h.push('<tr><td>' + (i === 0 ? '<b>' + esc(c.f) + '</b>' : esc(c.f)) + '</td>'
          + '<td class="mono" style="color:' + (c.s >= 4 ? '#e07b39' : c.s >= 3 ? '#d99a2b' : 'var(--text-muted)') + ';">' + starCell + '</td>'
          + '<td class="num mono" style="color:' + (sc >= 70 ? '#e07b39' : sc >= 40 ? '#d99a2b' : 'var(--text-muted)') + ';">' + (c.na ? '—' : sc + '<span style="color:var(--text-muted);font-size:10px;">/100</span>') + '</td>'
          + '<td style="font-size:12px;color:var(--text-muted);">' + detail + '</td></tr>');
      });
      h.push('</tbody></table></div>'); // ⚠table을 닫지 않으면 섹션 div가 조기 종료돼 뒤 블록이 카드 밖으로 밀려난다
    }

    // 음성 소견·미설명 성분·미입력 메타데이터 — LLM이 빠뜨려도 리포트에는 남도록 결정론적으로 인쇄
    // 제목 + 들여쓴 줄 — 항목마다 한 줄씩 세워야 "몇 건인지"가 눈에 들어온다
    var negBlk = [];
    /* 대역 베이스라인 이탈 — 감시가 본 것을 문서에도 남긴다. 위 대역 분배는 ISO 방법(10–1000 Hz)이라
       마운팅 상한 위 대역이 표에 없고, 그 대역은 결함 대역 탐색에서도 빠진다. 여기에 안 적으면
       "상승은 있었는데 아무 데도 안 적힌" 구간이 생겨, 센서 부착 불량도 베어링 초기 결함도 놓친다. */
    if (d.bandDev && d.bandDev.rows && d.bandDev.rows.length) {
      var _bdOver = d.bandDev.rows.filter(function (r) { return r.over; });
      var _bdRows = _bdOver.length
        ? _bdOver.map(function (r) { return r.ko + '  ×' + r.r + '  (' + r.v + ' → 한계 ' + r.lim + ')' + (r.soft ? '  ⚠마운팅 상한 초과 — 잠정' : ''); })
        : ['전 ' + d.bandDev.rows.length + '개 대역 정상 — 평소 대비 한계 미만'];
      if (_bdOver.some(function (r) { return r.soft; })) {
        _bdRows.push('잠정 대역은 마운팅' + (d.bandDev.mount ? '(' + d.bandDev.mount + ')' : '') + ' 유효 상한'
          + (d.bandDev.fmaxKHz ? ' ' + d.bandDev.fmaxKHz + ' kHz' : '') + '를 넘어 결함 대역 탐색에서 제외된 구간입니다. '
          + '상승은 사실이나 설비 진동인지 센서 부착부 공진인지 구분할 수 없습니다 — 정비 전 센서 부착 상태를 먼저 확인하세요.');
      }
      negBlk.push({ t: '대역 베이스라인 이탈', sub: '학습된 한계(μ+kσ) 대비 비율 · ×1이 판정선', rows: _bdRows });
    }
    if (d.negatives && d.negatives.length) negBlk.push({ t: '음성 소견', sub: '찾았으나 없음 · 반대 증거', rows: d.negatives });
    if (d.unexplained && d.unexplained.length) negBlk.push({ t: '미설명 성분', sub: '사전으로 설명되지 않음', rows: [d.unexplained.join(' · '), '구동 계통도(풀리비·기어비)·인접 기계 확인 시 대부분 해소'] });
    if (d.missing && d.missing.length) negBlk.push({ t: '미입력 메타데이터와 그 영향', sub: '', rows: d.missing });
    if (d.acq) negBlk.push({ t: '스펙트럼 취득 조건', sub: '', rows: [
      '창 ' + (d.acq.winSec || 0).toFixed(2) + '초 · 분해능 ' + (d.acq.res || 0).toFixed(2) + ' Hz · ' + (d.acq.window || 'Hann') + ' · 평균 ' + (d.acq.averages || 1) + '회'
        + ((d.acq.averages || 1) < 2 ? ' (단일 블록 — 충격성 신호에서 진폭이 스파이크에 좌우됨)' : (d.acq.averages || 1) < 8 ? ' (평균 8회 미만 — 측대역·저주파 정밀 진단 기준은 8초 창·0.125 Hz·8평균)' : ''),
    ].concat(d.acq.isoBlocks ? ['ISO 판정은 ' + d.acq.isoBlocks + '블록 에너지 평균'] : []) });
    if (negBlk.length) {
      h.push('<div class="neg-box">');
      negBlk.forEach(function (b) {
        h.push('<div class="nb-t">' + esc(b.t) + (b.sub ? ' <span class="nb-s">— ' + esc(b.sub) + '</span>' : '') + '</div>');
        b.rows.forEach(function (r) { h.push('<div class="nb-r">' + esc(r) + '</div>'); });
      });
      h.push('</div>');
    }

    // ── 심층 분석 (LLM 소견) ──
    if (p.opinion) {
      sectionOpen(h, '심층 분석', 'LLM 소견' + (p.opinionModel ? ' · ' + p.opinionModel : ''), null, 's-llm');
      h.push('<div class="analysis-content">');
      // 인라인 마크다운 변환: **굵게** → <strong>, `코드` → <code> (먼저 esc 후 마커만 치환)
      var inlineMd = function (s) {
        return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
      };
      // 색 위계: 소제목(밝음) > 불릿 본문(보통) > 근거 수치(볼드) · 결론(→)은 강조색으로 따로 세운다.
      // 전부 같은 밝기면 위계가 사라져 "다 중요해 보이는데 아무것도 안 읽히는" 상태가 된다.
      var pushBullet = function (txt) {
        // LLM이 "관측 — 판단. → 결론"을 한 줄에 붙여 쓰므로, 화살표에서 잘라 결론을 아래 줄로 내린다
        // "0.538→1.88"처럼 숫자 사이 화살표는 범위 표기다 — 공백으로 둘러싸인 " → "만 결론 마커로 본다
        var m = /\s→\s/.exec(txt);
        var head = m ? txt.slice(0, m.index).trim() : txt;
        var tail = m ? txt.slice(m.index + m[0].length).trim() : '';
        h.push('<div class="op-li"><span class="op-dot">•</span><span>' + inlineMd(head) + '</span></div>');
        if (tail) h.push('<div class="op-arrow">→ ' + inlineMd(tail) + '</div>');
      };
      String(p.opinion).split(String.fromCharCode(10)).forEach(function (ln) {
        var t = ln.trim();
        if (!t) return;
        var mh = t.match(/^#{1,3}\s+(.*)/);
        if (mh) { h.push('<div class="op-h">' + inlineMd(mh[1].trim()) + '</div>'); return; }
        var mb = t.match(/^[-*•]\s+(.*)/);
        if (mb) { pushBullet(mb[1]); return; }
        if (/^→/.test(t)) { h.push('<div class="op-arrow">' + inlineMd(t) + '</div>'); return; }
        var mn = t.match(/^(\d+)\.\s+(.*)/);
        if (mn) { pushBullet(t); return; }
        h.push('<p>' + inlineMd(t) + '</p>');
      });
      h.push('</div></div>');
    }

    // ── 종합 소견 및 권고사항 ──
    sectionOpen(h, '종합 소견 및 권고사항', null, null, 's-verdict');
    (p.actions || []).forEach(function (a, i) {
      h.push('<div class="rec-item"><span class="no">' + (i + 1) + '.</span>' + esc(a.txt) + '</div>');
    });
    h.push('<div style="margin-top:14px;padding:11px 14px;border-radius:8px;background:rgba(217,154,43,0.10);border:1px solid rgba(217,154,43,0.30);font-size:12px;line-height:1.6;color:var(--text-secondary)">측정 한계: 본 리포트는 단일 채널·단일 방향 진동 데이터 기반이며 위상(phase) 정보가 없고 회전속도는 스펙트럼 실측이 가능하면 실측값을, 불가하면 명판값을 기준으로 합니다(본문 [회전수] 표기 참조). 결함 메커니즘 중 불평형·정렬불량·굽음·소프트풋은 위상·축방향 없이는 원리상 <b>측정 불가</b>이고, 베어링·벨트·베인 등은 품번·제원·날개수 같은 <b>설비 정보가 없어 대조 자체가 불가</b>합니다(둘 다 가능성이 낮은 것이 아니라 볼 수 없는 것입니다). 그 외 후보는 <b>가설</b>이며, 이상 신호에 대한 <b>조사 필요 플래그</b>로 활용하십시오. 확정 진단에는 다축·위상 측정과 정비 담당자 확인이 필요합니다.</div>');
    h.push('</div>');

    h.push('</div>'); // #detail 닫기
    // 재현성 스트립 — 같은 설비의 두 리포트가 다를 때, 데이터가 달라진 건지 엔진이 달라진 건지 가른다.
    // 지문(fp)은 실제 판정 임계에서 계산되므로 버전을 올리는 걸 잊어도 동작이 바뀌면 달라진다.
    if (p.build) {
      // 라벨(작고 흐림) < 값(크고 밝음) < 보조(작고 흐림) — 세 단계로 시선을 태운다
      h.push('<div class="build-strip">');
      (p.build.cells || []).filter(function (c) { return c.v; }).forEach(function (c) {
        h.push('<div class="bs-i' + (c.narrow ? ' narrow' : '') + '"><div class="bs-k">' + esc(c.k) + '</div>'
          + '<div class="bs-v">' + esc(c.v) + '</div>'
          + (c.subs || []).map(function (x) { return '<div class="bs-s">' + esc(x) + '</div>'; }).join('') + '</div>');
      });
      h.push('</div>');
    }
    h.push('</div>');

    // ── 차트 엔진 + 데이터 + 부트 (자립 렌더) ──
    h.push('<script>' + String(p.chartLibSrc || '') + '<\/script>');
    h.push('<script>window.RPT = ' + JSON.stringify(d).replace(/</g, '\\u003c') + ';<\/script>');
    h.push('<script>' + BOOT + '<\/script>');
    h.push('</body></html>');
    return h.join('\n');
  }

  return { esc: esc, buildReportHTML: buildReportHTML };
});
