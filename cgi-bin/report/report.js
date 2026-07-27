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

  var CSS = [
    ":root{--bg-primary:#1e1e1e;--bg-panel:#252525;--bg-elevated:#2c2c2c;--bg-dropdown:#2d2d2d;--bg-hover:rgba(255,255,255,.08);--bg-input:rgba(255,255,255,.13);--text-primary:#f1f1f1;--text-secondary:#c4c4c4;--text-tertiary:#a3a3a3;--text-muted:#727272;--border-default:rgba(255,255,255,.13);--border-medium:#626263;--border-faint:rgba(255,255,255,.06);--primary:#005fb8;--primary-hover:#0075e2;--radius-sm:4px;--radius-md:8px}",
    ".theme-light{--bg-primary:#e9ebef;--bg-panel:#fff;--bg-elevated:#f5f6f8;--bg-dropdown:#fff;--bg-hover:rgba(0,0,0,.045);--bg-input:rgba(0,0,0,.05);--text-primary:#262831;--text-secondary:#40434e;--text-tertiary:#5f636f;--text-muted:#8a8d99;--border-default:rgba(0,0,0,.12);--border-medium:#b9bcc5;--border-faint:rgba(0,0,0,.08)}",
    "*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.65;font-size:15px}",
    ".page{max-width:1320px;margin:0 auto;padding:40px 28px 56px}",
    ".report-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:4px 0 26px;border-bottom:1px solid var(--border-default);margin-bottom:28px}",
    ".report-header .logo{height:42px;width:auto;flex-shrink:0;margin-top:2px}.theme-light .report-header .logo{filter:brightness(.18)}",
    ".hd-right{display:flex;flex-direction:column;align-items:flex-end;gap:16px;flex-shrink:0}",
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
    ".gauge{display:flex;height:30px;border-radius:6px;overflow:hidden;border:1px solid var(--border-faint);margin-top:14px}.gauge .cell{flex:1 1 0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600}",
    ".gauge-lab{display:flex;margin-top:4px;font-size:11px;color:var(--text-muted);font-family:'D2Coding',monospace}.gauge-lab div{flex:1 1 0;text-align:center}",
    ".verdict{display:flex;align-items:baseline;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border-faint);flex-wrap:wrap}",
    "table{width:100%;border-collapse:collapse;font-size:14px}thead th{text-align:left;font-weight:600;color:var(--text-tertiary);font-size:13px;padding:12px 14px;border-bottom:1px solid var(--border-default);white-space:nowrap}",
    "tbody td{padding:12px 14px;border-bottom:1px solid var(--border-faint);color:var(--text-secondary)}tbody tr:last-child td{border-bottom:none}",
    ".num{text-align:right;font-variant-numeric:tabular-nums;font-family:'D2Coding',monospace}",
    ".analysis-content p{margin-bottom:12px;line-height:1.7;color:var(--text-secondary);font-size:14px}",
    ".rec-item{margin:10px 0 6px 8px;font-size:14px;color:var(--text-secondary)}.rec-item .no{font-weight:700;color:var(--primary-hover);margin-right:8px}",
    ".footer{margin-top:32px;padding-top:14px;border-top:1px solid var(--border-default);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--text-muted)}",
    ".group-hd{display:flex;align-items:center;gap:10px;margin:4px 0 14px;color:var(--text-primary)}.group-hd .hr{flex:1 1 0;height:1px;background:var(--border-faint)}",
    ".grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:24px;margin-bottom:24px}.grid2 .section{margin-bottom:0}",
    ".sev-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:14px}",
    ".sev-card{padding:13px 14px;border:1px solid var(--border-faint);border-radius:9px;background:var(--bg-elevated)}",
    ".sev-card .lab{font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px}",
    ".sev-card .badge2{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:.3px;margin-left:4px;vertical-align:middle}",
    ".sev-card .val{font-size:26px;font-weight:700;letter-spacing:-.5px;margin-bottom:8px;font-variant-numeric:tabular-nums;color:var(--text-primary)}.sev-card .val .u{font-size:12px;font-weight:500;color:var(--text-muted);margin-left:2px}",
    ".sev-card .foot{display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)}",
    ".stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:var(--border-faint);border:1px solid var(--border-faint);border-radius:6px;overflow:hidden}",
    ".stat-grid .cell{background:var(--bg-panel);padding:13px 16px}.stat-grid .cell .k{font-size:11px;color:var(--text-muted)}.stat-grid .cell .v{margin-top:5px;font-size:16px;font-weight:600;color:var(--text-primary);font-family:'D2Coding',monospace}",
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
    " if(R.bands){var cb=el('cBand');if(cb){var db=function(s,e){CH.drawMultiLine(cb,{series:R.bands.map(function(sr){return {label:sr.label,color:sr.color,vals:sr.vals.slice(s,e)};}),xLabels:R.kxl.slice(s,e),height:220},cc());};db(0,R.kxl.length);CH.addZoom(cb,R.kxl.length,db);}}",
    " if(R.wave)line('cWave','tWave',{values:R.wave.v,xLabels:R.wave.t,color:CH.SERIES.wave,height:240,lw:1.1},'xWave');",
    " if(R.fft)fftc('cFft','tFft',{freqs:R.fft.freqs,mags:R.fft.mags,markers:R.fft.markers,res:R.fft.res,height:280,hideMarkerLabels:true});",
    " if(R.spec){var cs=el('cSpec');if(cs)CH.drawHeat(cs,{grid:R.spec.grid,rows:R.spec.rows,cols:R.spec.cols,fmax:R.spec.fmax,height:200},cc());}",
    " if(R.kurtogram)fftc('cKurtogram',null,{freqs:R.kurtogram.freqs,mags:R.kurtogram.mags,markers:R.kurtogram.markers,res:R.kurtogram.res,height:180,hideMarkerLabels:false});",
    " if(R.env)fftc('cEnv',null,{freqs:R.env.freqs,mags:R.env.mags,markers:R.env.markers,res:1,height:210,hideMarkerLabels:true});",
    " if(R.cep)fftc('cCep',null,{freqs:R.cep.freqs,mags:R.cep.mags,markers:R.cep.markers,res:1,height:200,hideMarkerLabels:true});",
    "}",
    "window.toggleTheme=function(){var r=document.documentElement;r.classList.toggle('theme-light');try{localStorage.setItem('neoVibeReportTheme',r.classList.contains('theme-light')?'light':'dark');}catch(e){}drawAll();};",
    "var rt;window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(drawAll,80);});",
    "drawAll();",
    "})();",
  ].join('\n');

  function sectionOpen(h, title, sub, hint) {
    h.push('<div class="section"><div class="section-title"><span class="bar"></span> ' + esc(title)
      + (sub ? ' <span style="font-weight:500;color:var(--text-muted);font-size:13px;">' + esc(sub) + '</span>' : '')
      + (hint ? ' <span class="nav-hint">' + hint + '</span>' : '')
      + '</div>');
  }

  var ZOOM_HINT = '<b>휠</b> 확대·축소 · <b>드래그</b> 이동 · <b>더블클릭</b> 리셋';

  function chartSection(h, opts) {
    // opts: {title, sub, hintText(esc필요없는 고정), desc, canvasId, h, tipId, xlineId, legend:[{label,color}]}
    sectionOpen(h, opts.title, opts.sub, opts.hint);
    if (opts.desc) h.push('<div class="section-desc">' + esc(opts.desc) + '</div>');
    h.push('<div class="chart-wrap"><canvas id="' + opts.canvasId + '" height="' + opts.h + '"></canvas>'
      + (opts.xlineId ? '<div class="xline" id="' + opts.xlineId + '"></div>' : '')
      + (opts.tipId ? '<div class="tooltip" id="' + opts.tipId + '"></div>' : '')
      + '</div>');
    if (opts.legend && opts.legend.length) {
      h.push('<div class="legend">' + opts.legend.map(function (l) {
        return '<span><span class="sw" style="background:' + esc(l.color) + ';"></span>' + esc(l.label) + '</span>';
      }).join('') + '</div>');
    }
    h.push('</div>');
  }

  // p: { docNo, alias, tagName, generatedText, logoDataURL, specs, sevMachine, gradeKo, gradeColor,
  //      zones:[문자3], zonesUnit, gradeIdx, verdict, verdictSub, sevCards, stats, indics,
  //      opinion, opinionModel, actions, data(RPT — 차트 데이터), chartLibSrc(chart.js 소스),
  //      fftHint, waveDesc, envDesc, cepDesc }
  function buildReportHTML(p) {
    var d = p.data || {};
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
    h.push('<button class="theme-btn" onclick="toggleTheme()" title="라이트/다크 전환">');
    h.push('<svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>');
    h.push('<svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>');
    h.push('</button></div></div>');

    // ── 조회 스펙 패널 ──
    h.push('<div class="spec-panel">');
    (p.specs || []).forEach(function (s) {
      h.push('<div class="spec-col"><div class="spec-k">' + esc(s.k) + '</div><div class="spec-v">' + esc(s.v)
        + (s.unit ? '<span style="font-size:13px;font-weight:600;color:var(--text-tertiary);margin-left:3px;">' + esc(s.unit) + '</span>' : '') + '</div></div>');
    });
    h.push('</div>');

    // ── 심각도 평가 ──
    sectionOpen(h, '진동 심각도 평가', null, '<span class="mono">' + esc(p.sevMachine) + '</span>');
    h.push('<div class="sev-box">');
    h.push('<div style="font-size:11px;color:var(--text-muted);margin-bottom:3px;">종합 위험도 <span style="color:var(--text-tertiary);">· ISO 10816 최신 순간 RMS(1초 롤업) 존 기준 — 평균이 낮아도 순간·상승 추세로 등급이 오릅니다</span></div>');
    h.push('<span style="font-size:38px;font-weight:800;line-height:1;letter-spacing:-.5px;color:' + esc(p.gradeColor) + '">' + esc(p.gradeKo) + '</span>');
    var Z = p.zones || ['-', '-', '-'];
    var zoneDefs = [
      { ko: '양호', range: '< ' + Z[0] }, { ko: '주의', range: Z[0] + '–' + Z[1] },
      { ko: '위험', range: Z[1] + '–' + Z[2] }, { ko: '심각', range: '> ' + Z[2] },
    ];
    h.push('<div class="gauge">');
    zoneDefs.forEach(function (zz, i) {
      var act = i === p.gradeIdx;
      h.push('<div class="cell" style="' + (act ? 'background:' + STATUS_COLOR[zz.ko] + ';color:#fff;' : 'background:var(--bg-elevated);color:var(--text-muted);') + 'border-right:1px solid var(--border-faint);">' + zz.ko + '</div>');
    });
    h.push('</div><div class="gauge-lab">');
    zoneDefs.forEach(function (zz) { h.push('<div>' + esc(zz.range + (p.zonesUnit ? ' ' + p.zonesUnit : '')) + '</div>'); });
    h.push('</div>');
    h.push('<div class="verdict"><span style="font-weight:700;">' + esc(p.verdict) + '</span><span style="font-size:12px;color:var(--text-tertiary);">' + esc(p.verdictSub) + '</span></div>');
    h.push('</div>');
    h.push('<div class="sev-cards">');
    (p.sevCards || []).forEach(function (c) {
      var bc = STATUS_COLOR[c.badgeKo] || '#8a8f99';
      h.push('<div class="sev-card"><div class="lab">' + esc(c.label)
        + '<span class="badge2" style="color:' + bc + ';background:' + bc + '26;">' + esc(c.badgeKo) + '</span></div>'
        + '<div class="val">' + esc(c.value) + '<span class="u">' + esc(c.unit || '') + '</span></div>'
        + '<div class="foot"><span>' + esc(c.thr) + '</span><span style="color:' + (c.over ? '#e5484d' : '#3aa76d') + ';font-weight:600;">' + esc(c.arrow + ' ' + c.delta) + '</span></div></div>');
    });
    h.push('</div></div>');

    // ── 종합 진동 레벨 (물리량별 RMS) — 에너지가 어느 도메인에 있나. 단위가 달라 값 크기 직접 비교는 불가(막대 없음) ──
    if (d.levels) {
      var _lu = [{ u: 'g', l: '가속도', d: '고주파(베어링·기어)' }, { u: 'mm/s', l: '속도', d: 'ISO 10816 판정 기준' }, { u: 'μm', l: '변위', d: '저주파(불균형·정렬)' }];
      var fmtL = function (v) { return (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)); };
      sectionOpen(h, '종합 진동 레벨');
      h.push('<div style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px;">같은 신호를 세 물리량으로 본 RMS · 어느 대역에 에너지가 있는지 방향 파악용 (단위가 달라 값끼리 크기 비교는 하지 않음)</div>');
      h.push('<table><thead><tr><th>물리량</th><th class="num" style="width:150px;">RMS</th><th>관점</th></tr></thead><tbody>');
      _lu.forEach(function (x) {
        if (d.levels[x.u] == null) return;
        var iso = (x.u === (d.natUnit || d.isoUnit));
        h.push('<tr><td>' + x.l + (iso ? ' <span style="font-size:10px;color:var(--primary-light);">(센서 원본)</span>' : '') + '</td>'
          + '<td class="num mono">' + fmtL(d.levels[x.u]) + ' <span style="color:var(--text-muted);">' + x.u + '</span></td>'
          + '<td style="color:var(--text-muted);font-size:12px;">' + x.d + '</td></tr>');
      });
      h.push('</tbody></table></div>');
    }

    // ── 측정 신뢰도·해석 경고 (신호 품질 이상·첨도 포화) ──
    if (d.quality && d.quality.issues && d.quality.issues.length) {
      h.push('<div style="display:flex;gap:9px;padding:11px 13px;margin-bottom:10px;border-radius:8px;background:rgba(199,125,10,.1);border:1px solid rgba(199,125,10,.4);font-size:12px;line-height:1.55;"><b style="color:#c77d0a;">⚠ 신호 품질 경고</b>&nbsp; ' + esc(d.quality.issues.map(function (x) { return x.label + ': ' + x.detail; }).join(' · ')) + ' — 측정 신뢰도 저하, 아래 판정은 센서 점검 전 잠정입니다.</div>');
    }
    if (d.kurtWarn) {
      h.push('<div style="display:flex;gap:9px;padding:11px 13px;margin-bottom:10px;border-radius:8px;background:rgba(199,125,10,.1);border:1px solid rgba(199,125,10,.35);font-size:12px;line-height:1.55;"><b style="color:#c77d0a;">⚠ 첨도 포화 주의</b>&nbsp; ' + esc(d.kurtWarn) + '</div>');
    }

    // ── 통계 요약 ──
    sectionOpen(h, '통계 요약');
    h.push('<div class="stat-grid">');
    (p.stats || []).forEach(function (s) { h.push('<div class="cell"><div class="k">' + esc(s.k) + '</div><div class="v">' + esc(s.v) + '</div></div>'); });
    h.push('</div></div>');

    // ── 추세 분석 ──
    h.push('<div class="group-hd"><span style="font-size:13px;font-weight:700;letter-spacing:.6px;">추세 분석</span><span style="font-size:11px;color:var(--text-muted);">시간에 따른 지표 변화 · 열화 진행 추적</span><span class="hr"></span></div>');
    if (d.rms) chartSection(h, { title: 'RMS 추이', sub: 'ISO 10816 존 기준선', hint: ZOOM_HINT, canvasId: 'cRms', h: 230, tipId: 'tRms' });
    var g2 = [];
    if (d.p2p) g2.push({ title: 'Peak-to-Peak 추이', canvasId: 'cP2p', h: 220, tipId: 'tP2p' });
    if (d.crest) g2.push({ title: 'Crest Factor 추이', sub: '충격성 지표', canvasId: 'cCrest', h: 220, tipId: 'tCrest' });
    if (d.kurt) g2.push({ title: '첨도 추이', sub: 'Kurtosis · 3 = 정상', canvasId: 'cKurt', h: 220, tipId: 'tKurt' });
    if (d.bands) g2.push({ title: '결함 대역 에너지 추이', sub: 'Band Energy', canvasId: 'cBand', h: 220, legend: d.bands.map(function (b) { return { label: b.label, color: b.color }; }) });
    if (g2.length) {
      h.push('<div class="grid2">');
      g2.forEach(function (c) { chartSection(h, c); });
      h.push('</div>');
    }

    // ── 스펙트럼 분석 ──
    var _duTag = (d.dispUnit && d.natUnit && d.dispUnit !== d.natUnit) ? '<span style="font-size:11px;font-weight:700;color:var(--primary-light);background:rgba(0,108,210,.14);padding:1px 7px;border-radius:4px;">표시 물리량: ' + esc(d.dispUnit) + ' (' + esc(d.natUnit) + '에서 변환)</span>' : (d.dispUnit ? '<span style="font-size:11px;color:var(--text-muted);">표시 물리량: ' + esc(d.dispUnit) + '</span>' : '');
    h.push('<div class="group-hd"><span style="font-size:13px;font-weight:700;letter-spacing:.6px;">스펙트럼 분석</span><span style="font-size:11px;color:var(--text-muted);">주파수 성분 분해 · 결함 원인 지목</span><span class="hr"></span>' + _duTag + '</div>');
    if (d.wave) chartSection(h, { title: '원시 파형', sub: 'Raw Waveform', hint: ZOOM_HINT, desc: p.waveDesc, canvasId: 'cWave', h: 240, tipId: 'tWave', xlineId: 'xWave' });
    if (d.fft) chartSection(h, {
      title: 'FFT 주파수 스펙트럼', hint: '<span class="mono">' + esc(p.fftHint || '') + '</span>', desc: '주파수별 성분 분해 · 결함 주파수와 대조해 원인 지목',
      canvasId: 'cFft', h: 280, tipId: 'tFft',
      legend: (d.fft.markers || []).filter(function (m) { return m.kind !== 'h'; }).map(function (m) { return { label: m.label + ' ' + m.freq.toFixed(1) + ' Hz', color: m.kind === 'f' ? '#e5646a' : '#8a8f99' }; }),
    });
    if (d.spec) chartSection(h, { title: '스펙트로그램', sub: '시간×주파수', desc: '결함 대역이 언제부터 자랐는지 확인 · 밝을수록 강한 성분', canvasId: 'cSpec', h: 200 });
    if (d.kurtogram) chartSection(h, { title: '결함 대역 탐색', sub: 'Kurtogram · Spectral Kurtosis', desc: (d.kurtogram.best ? '충격성 최대 대역 ' + (d.kurtogram.best.loHz / 1000).toFixed(1) + '–' + (d.kurtogram.best.hiHz / 1000).toFixed(1) + ' kHz (SK ' + d.kurtogram.best.sk.toFixed(1) + ') → 포락선을 이 대역으로 복조' : '충격성이 가장 강한 대역 자동 탐색'), canvasId: 'cKurtogram', h: 180 });
    if (d.env) chartSection(h, { title: '포락선 스펙트럼', sub: 'Envelope', desc: p.envDesc, canvasId: 'cEnv', h: 210 });
    if (d.cep) chartSection(h, { title: '켑스트럼', sub: 'Cepstrum', desc: p.cepDesc, canvasId: 'cCep', h: 200 });

    // ── 지표 요약 ──
    sectionOpen(h, '지표 요약');
    h.push('<table><thead><tr><th>지표</th><th class="num" style="width:170px;">측정값</th><th>비고</th></tr></thead><tbody>');
    (p.indics || []).forEach(function (it) {
      h.push('<tr><td>' + esc(it.k) + '</td><td class="num">' + esc(it.v + (it.hint ? ' · ' + it.hint : '')) + '</td><td style="font-size:12px;color:var(--text-muted);">' + esc(it.desc || '') + '</td></tr>');
    });
    h.push('</tbody></table></div>');

    // ── 결함 근거 강도 (Evidence) — 규칙 기반 자동 산출. LLM 소견 위에 배치해 "근거→해석" 순서 ──
    if (d.evidence && d.evidence.length) {
      var starOf = function (s) { s = Math.max(0, Math.min(5, Math.round(s))); return '★★★★★'.slice(0, s) + '☆☆☆☆☆'.slice(0, 5 - s); };
      sectionOpen(h, '결함 근거 강도', '측정 지표 기반 자동 산출 · ★ 높은 순 = 우선순위');
      h.push('<div style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px;">동기/비동기 피크·충격성·대역 에너지 등 실제 지표에서 규칙으로 산출한 후보별 근거 강도입니다(임의 확률 아님).</div>');
      h.push('<table><thead><tr><th>결함 후보</th><th style="width:120px;">근거 강도</th><th class="num" style="width:56px;">점수</th><th>근거</th></tr></thead><tbody>');
      d.evidence.forEach(function (c, i) {
        var sc = c.score != null ? c.score : c.s * 20;
        h.push('<tr><td>' + (i === 0 ? '<b>' + esc(c.f) + '</b>' : esc(c.f)) + '</td>'
          + '<td class="mono" style="color:' + (c.s >= 4 ? '#e07b39' : c.s >= 3 ? '#d99a2b' : 'var(--text-muted)') + ';letter-spacing:1px;">' + starOf(c.s) + '</td>'
          + '<td class="num mono" style="color:' + (sc >= 70 ? '#e07b39' : sc >= 40 ? '#d99a2b' : 'var(--text-muted)') + ';">' + sc + '</td>'
          + '<td style="font-size:12px;color:var(--text-muted);">' + esc(c.why) + '</td></tr>');
      });
      h.push('</tbody></table></div>');
    }

    // ── 심층 분석 (LLM 소견) ──
    if (p.opinion) {
      sectionOpen(h, '심층 분석', 'LLM 소견' + (p.opinionModel ? ' · ' + p.opinionModel : ''));
      h.push('<div class="analysis-content">');
      // 인라인 마크다운 변환: **굵게** → <strong>, `코드` → <code> (먼저 esc 후 마커만 치환)
      var inlineMd = function (s) {
        return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
      };
      // 줄 단위: ## 소제목 / -·•·* 불릿 / → 결론 / 1. 우선순위 / 그 외 문단 (모두 인라인 마크다운 적용)
      String(p.opinion).split('\n').forEach(function (ln) {
        var t = ln.trim();
        if (!t) return;
        var mh = t.match(/^#{1,3}\s+(.*)/);
        if (mh) { h.push('<h4 style="font-size:15px;font-weight:700;margin:18px 0 6px;color:var(--text-primary)">' + inlineMd(mh[1].trim()) + '</h4>'); return; }
        var mb = t.match(/^[-*•]\s+(.*)/);
        if (mb) { h.push('<div style="display:flex;gap:7px;margin:2px 0 2px 6px;line-height:1.6;"><span style="color:var(--text-muted);flex-shrink:0;">•</span><span>' + inlineMd(mb[1]) + '</span></div>'); return; }
        if (/^→/.test(t)) { h.push('<div style="margin:4px 0 8px 6px;padding-left:8px;border-left:2px solid var(--primary-light);color:var(--text-primary);font-weight:600;line-height:1.6;">' + inlineMd(t) + '</div>'); return; }
        var mn = t.match(/^(\d+)\.\s+(.*)/);
        if (mn) { h.push('<div style="margin:8px 0 3px;font-weight:700;line-height:1.6;">' + inlineMd(t) + '</div>'); return; }
        h.push('<p>' + inlineMd(t) + '</p>');
      });
      h.push('</div></div>');
    }

    // ── 종합 소견 및 권고사항 ──
    sectionOpen(h, '종합 소견 및 권고사항');
    (p.actions || []).forEach(function (a, i) {
      h.push('<div class="rec-item"><span class="no">' + (i + 1) + '.</span>' + esc(a.txt) + '</div>');
    });
    h.push('<div style="margin-top:14px;padding:11px 14px;border-radius:8px;background:rgba(217,154,43,0.10);border:1px solid rgba(217,154,43,0.30);font-size:12px;line-height:1.6;color:var(--text-secondary)">측정 한계: 본 리포트는 단일 채널·단일 방향 진동 데이터 기반이며 위상(phase) 정보가 없고 회전속도는 명판값 기준입니다. 결함 메커니즘(불평형·정렬불량·풀림 등)은 위상·다축 측정 없이는 구분이 어려워 <b>가설</b>이며, 이상 신호에 대한 <b>조사 필요 플래그</b>로 활용하십시오. 확정 진단에는 다축·위상 측정과 정비 담당자 확인이 필요합니다.</div>');
    h.push('</div>');

    h.push('<div class="footer"><span>Machbase Neo 데이터 기반으로 생성 되었습니다.</span><span class="mono">' + esc(p.docNo) + '</span></div>');
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
