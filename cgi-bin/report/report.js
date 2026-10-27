// report/report.js — 진동 분석 리포트 HTML 조립
// 차트 엔진(chart.js 소스)·데이터(JSON)를 파일에 내장 → 저장 문서에서도 줌·툴팁·테마 리드로우 동작(외부 참조 없음)
// 보안: 사용자 입력 esc(), 데이터 JSON의 <는 \u003c로 치환, CSP(default none, img data:, style/script inline)
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

  var GRADE_KO = ['양호', '주의', '위험', '심각'];
  // ISO 10816 존 — 규격 정의어(등급어와 다른 말 — 두 축 혼동 방지)
  var ISO_ZONE = [
    { k: 'A', ko: '신규 설비 수준' }, { k: 'B', ko: '장기 운전 가능' },
    { k: 'C', ko: '제한 운전' }, { k: 'D', ko: '손상 우려' },
  ];
  var NA_SHORT = { gate: '계측 이상', data: '스펙트럼 없음', sleeve: '저널 베어링' };

  // ISO 값의 막대 위치(%) — 4칸 등폭, 칸 안은 경계 사이 선형(D칸 끝 = 마지막 경계 2배)
  function isoPinPct(v, z, zi) {
    if (!(v >= 0) || !z || !(zi >= 0 && zi <= 3)) return null;
    var lo = [0, z[0], z[1], z[2]][zi], hi = [z[0], z[1], z[2], z[2] * 2][zi];
    var f = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0;
    return Math.max(0.5, Math.min(99.5, (zi + f) * 25));
  }

  // 이름 끝 괄호 풀이 제거 — '베어링(Bearing)' → '베어링', 결함주파수 약어('외륜(BPFO)')는 유지
  function shortName(f) { return String(f || '').replace(/\s*\((?![A-Z0-9]+\))[^)]*\)\s*$/, ''); }

  /* 심각도 패널 모델 — 리포트·앱 상세 화면 공용(문구·구조 일치)
     · o: gi 판정 등급 · gradeKo · judge(판정 값) · iso {idx 존, val 값 문구} 또는 null · zones 경계 문자열 3개 · unit
     · judge.byZone = 결함 패턴이 있을 때 존별 등급(정본 규칙 VC.patternGate에서 산출)
     · step = 네 등급 중 위치(1~4, 판정 불가는 0) · 반환 문구는 이스케이프 전 평문 */
  function sevModel(o) {
    var J = o.judge || {}, iso = o.iso || null, Z = o.zones || ['-', '-', '-'];
    var byZ = J.byZone || null, gk = o.gradeKo, zk = iso ? ISO_ZONE[iso.idx] : null;
    var why = null;
    if (J.patNa) {
      // 못 잰 사유별 문구 — gate(계측 이상) · data(스펙트럼 없음) · sleeve(저널 베어링) · 그 외(회전수·베어링 없음)
      why = {
        text: J.patWhy === 'gate' ? '계측 이상으로 결함 패턴 판정 안 함 — 센서·케이블·마운팅 점검 후 재확인'
          : J.patWhy === 'data' ? '이 구간 파형으로 결함 패턴 계산 불가 — 다른 기간으로 재확인'
            : J.patWhy === 'sleeve' ? '저널(sleeve) 베어링은 결함 패턴 판정 대상 아님 — 진동 크기는 ISO 존으로 확인'
              : '회전수·베어링 정보가 없어 결함 패턴 판정 불가 — 설정 → 설비 정보에 명판 회전수·베어링 품번 입력',
        note: iso ? '참고: 진동 크기 ' + zk.k + ' 구간(' + iso.val + ')이지만 이 값만으로는 베어링 상태 판단 불가' : '',
      };
    } else if (J.isoOnly > 0 && iso) {
      why = {
        text: '진동 크기 ' + zk.k + ' 구간(' + iso.val + ')으로 높지만 베어링 결함 패턴이 없어 등급 미반영 — 원인이 베어링 밖일 가능성 큼',
        note: '확인할 것: 불평형 · 정렬불량 · 체결 풀림 · 유체력(캐비테이션·서징) — 위상·축방향 측정 없이는 이 도구로 판별 불가',
      };
    } else if (J.patOn && iso) {
      why = {
        text: iso.idx === 0 ? '진동 크기 정상(ISO A 구간) · 베어링 결함주파수 성분 먼저 출현'
          : '베어링 결함주파수 성분 출현 · 진동 크기 ISO ' + zk.k + ' 구간(' + zk.ko + ')',
        note: '',
      };
    } else if (J.patOn) {
      why = { text: '결함 패턴 출현 · ISO 값 계산 불가로 진동 크기 미반영', note: '' };
    }
    var pat = J.patNa
      ? { pills: [{ label: '미측정 · ' + (NA_SHORT[J.patWhy] || '회전수·베어링 정보 없음'), on: true, tone: -1 }],
        fact: J.patWhy === 'sleeve' ? '구름베어링 결함주파수 없음 — 이 축으로 등급 미부여' : '결함 패턴 미측정 — 등급 미부여' }
      : { pills: [{ label: '없음', on: !J.patOn, tone: 0 }, { label: (J.patOn && shortName(J.site)) || '있음', on: !!J.patOn, tone: o.gi }],
        fact: J.patOn ? '결함주파수 근거 있음 — 진동이 작아도 등급 발동'
          : '결함주파수 근거 없음 — 진동 크기와 무관하게 양호' };
    // 같은 등급이 이어지는 존은 한 칸으로 묶음(A·B → 주의 한 번)
    var res = [], i;
    if (byZ) for (i = 0; i < 4; i++) {
      var last = res[res.length - 1];
      if (last && last.gi === byZ[i]) { last.span++; last.to = i; } else res.push({ gi: byZ[i], ko: GRADE_KO[byZ[i]], span: 1, from: i, to: i });
    }
    var live = !!(J.patOn && !J.patNa && iso);
    res.forEach(function (r) { r.on = live && iso.idx >= r.from && iso.idx <= r.to; });
    return {
      ko: J.patNa ? (J.patWhy === 'gate' ? '판정 보류' : J.patWhy === 'sleeve' ? '판정 대상 아님' : '판정 못 함') : gk,
      tone: J.patNa ? -1 : o.gi, step: J.patNa ? 0 : o.gi + 1, why: why, pat: pat,
      iso: {
        val: iso ? iso.val : '',
        pos: (iso && typeof J.isoPos === 'number' && isFinite(J.isoPos)) ? J.isoPos : null,
        zones: ISO_ZONE.map(function (z, k) {
          return { k: z.k, ko: z.ko, cur: !!iso && iso.idx === k,
            range: k === 0 ? '0 – ' + Z[0] : k === 3 ? Z[2] + (o.unit ? ' ' + o.unit : '') + ' 이상' : Z[k - 1] + ' – ' + Z[k] };
        }),
        res: res,
        resCap: '결함 패턴이 있을 때의 판정 등급' + (J.patNa ? ' — 지금은 결함 패턴을 재지 못함' : J.patOn ? '' : ' — 지금은 결함 패턴이 없어 해당 없음'),
      },
    };
  }

  // 판정 제목 — 등급은 베어링 결함 패턴이 발동(gi > 0)하므로 부위 세분(내륜 등) 대신 '베어링 결함 + 단계' · 상세분석·리포트 공용
  function sevTitle(gi, judge, held, verdict) {
    var J = judge || {};
    return (J.patOn && !J.patNa && !held && gi > 0) ? '베어링 결함 ' + ['', '초기 징후', '진행 단계', '심각 단계'][Math.min(3, gi)] : verdict;
  }
  // 근거 점수 강도 — 상세분석·리포트 공용
  function evidLevel(s) { return s == null ? '' : s >= 70 ? '강함' : s >= 40 ? '중간' : s >= 20 ? '약함' : '근거 부족'; }

  // 아이콘 — 인라인 SVG(아이콘 폰트 미내장, CSP 안에서 자립)
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var ICON = {
    warn: SVG + '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/></svg>',
    ok: SVG + '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 9.8"/></svg>',
    check: SVG + '<path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    tools: SVG + '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 2l1.9 5.6L18.5 9.5l-5.6 1.9L11 17l-1.9-5.6L3.5 9.5l5.6-1.9z"/><path d="M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
    arrow: SVG + '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
    print: SVG + '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
    theme: SVG + '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>',
  };
  // 등급 색 부류 — 0~3 등급, 그 외(판정 불가·보류)는 중립
  function tone(gi) { return gi >= 0 && gi <= 3 ? 't' + gi : 'tn'; }

  // 라이트 팔레트 — 테마 토글·인쇄 공용
  var LIGHT = '--k-bg:#eceef1;--k-panel:#ffffff;--k-elev:#f3f4f6;--k-ink:#262831;--k-ink2:#40434e;--k-ink3:#5f636f;--k-ink4:#8a8d99;'
    + '--k-bd2:#b9bcc5;--k-track:#dfe1e6;--k-bd:rgba(0,0,0,.12);--k-bd3:rgba(0,0,0,.08);--k-link:#005fb8;'
    + '--k-warn:#b58900;--k-ok:#2a8f3a;--k-risk:#d44a00;--k-crit:#9f1239;--k-logo:none';

  var CSS = [
    ":root{--k-bg:#1e1e1e;--k-panel:#252525;--k-elev:#2c2c2c;--k-ink:#f1f1f1;--k-ink2:#c4c4c4;--k-ink3:#a3a3a3;--k-ink4:#727272;"
      + "--k-bd:rgba(255,255,255,.13);--k-bd2:#626263;--k-bd3:rgba(255,255,255,.08);--k-track:#3c3c3c;--k-link:#4199ff;"
      + "--k-warn:#ffd23f;--k-ok:#71e071;--k-risk:#ff8c1a;--k-crit:#ff4060;--k-logo:brightness(1.5) saturate(1.2)}",
    ".theme-light{" + LIGHT + "}",
    ".t0{--tc:var(--k-ok);--ts:rgba(113,224,113,.12)}.t1{--tc:var(--k-warn);--ts:rgba(255,210,63,.12)}"
      + ".t2{--tc:var(--k-risk);--ts:rgba(255,140,26,.12)}.t3{--tc:var(--k-crit);--ts:rgba(255,64,96,.12)}.tn{--tc:var(--k-ink3);--ts:var(--k-elev)}",
    "*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}",
    "body{background:var(--k-bg);color:var(--k-ink);font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;font-size:13px;line-height:1.6;word-break:keep-all;overflow-wrap:break-word}",
    "a{color:var(--k-link);text-decoration:none}a:hover{text-decoration:underline}",
    ".mono{font-family:D2Coding,Consolas,monospace}.m2{color:var(--k-ink2)}.m3{color:var(--k-ink3)}.s12{font-size:12px}.tc{color:var(--tc)}",
    ".wrap{max-width:1240px;margin:0 auto;padding:32px 24px 56px;display:flex;flex-direction:column;gap:20px}",
    ".vcol{display:flex;flex-direction:column}.g4{gap:4px}.g8{gap:8px}.g10{gap:10px}.g12{gap:12px}.g14{gap:14px}.g16{gap:16px}",
    ".sb{display:flex;justify-content:space-between;align-items:baseline;gap:8px 12px;flex-wrap:wrap}",
    // 머리
    ".hd{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}",
    ".hd-l{display:flex;flex-direction:column;gap:10px;min-width:0}.logo{height:28px;width:auto;align-self:flex-start;filter:var(--k-logo)}",
    ".ttl{font-size:30px;font-weight:700;line-height:1.2}.ttl .mono{color:var(--k-link)}",
    ".hm{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:12px;color:var(--k-ink3)}.hm.ids{font-family:D2Coding,Consolas,monospace}",
    ".hm.sp{gap:4px 14px;margin-top:-6px}.hm .v{font-family:D2Coding,Consolas,monospace;color:var(--k-ink)}",
    ".hbtn{display:flex;gap:8px}",
    ".theme-btn{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:6px;border:1px solid var(--k-bd);background:var(--k-elev);color:var(--k-ink2);cursor:pointer}",
    ".theme-btn:hover{color:var(--k-ink);border-color:var(--k-bd2)}.theme-btn svg{width:20px;height:20px;display:block}",
    // 탭(요약/전체 분석)
    ".tabs{display:flex;border-bottom:1px solid var(--k-bd)}",
    ".tab{background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;padding:10px 16px;color:var(--k-ink3);font:600 13px Pretendard,'Malgun Gothic',sans-serif;cursor:pointer}",
    ".tab.on{border-bottom-color:#005fb8;color:var(--k-ink)}",
    "body.view-sum #full,body.view-full #sum{display:none}",
    // 카드
    ".card{background:var(--k-panel);border:1px solid var(--k-bd);border-radius:8px}.pad{padding:18px 20px}.ct{font-size:15px;font-weight:600}",
    ".g2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}",
    // 등급 배지·판정문·단계
    ".gb{display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--ts);border:1px solid var(--tc);border-radius:4px;color:var(--tc);flex-shrink:0}",
    ".gb svg{width:22px;height:22px}.gb span{font-size:30px;font-weight:700;line-height:1;white-space:nowrap}",
    ".vd{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.vd-t{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 280px}",
    ".vd-h{font-size:17px;font-weight:700}.vd-s{color:var(--k-ink2)}.vd-n{font-size:12px;color:var(--k-ink3)}",
    ".steps{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--k-ink3)}",
    ".bars{display:grid;grid-template-columns:repeat(4,20px);gap:2px}.bars span{height:4px;border-radius:2px;background:var(--k-bd)}.bars span.on{background:var(--tc)}",
    ".facts{display:flex;align-items:center;gap:8px 20px;flex-wrap:wrap;font-size:12px;color:var(--k-ink3)}.facts .v{font-family:D2Coding,Consolas,monospace;color:var(--k-ink)}",
    ".todo{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--k-elev);border-radius:4px}",
    ".todo svg{width:16px;height:16px;color:var(--k-link);flex-shrink:0;margin-top:2px}.todo .k{font-size:12px;color:var(--k-ink3);flex-shrink:0;margin-top:1px}",
    ".alert{display:flex;flex-direction:column;gap:3px;padding:10px 14px;border-radius:4px;border:1px solid var(--tc);background:var(--ts)}.alert .h{font-weight:700;color:var(--tc)}.alert .d{font-size:12px;color:var(--k-ink2)}",
    // 요약 카드
    ".kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.kpi{display:flex;flex-direction:column;gap:6px;padding:16px 18px}",
    ".kpi.over{border-color:var(--k-warn)}.kpi .h{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--k-ink3)}.kpi .h b{font-weight:600}",
    ".kpi .n{font-family:D2Coding,Consolas,monospace;font-size:30px;font-weight:700;line-height:1.1}.kpi.over .n{color:var(--k-warn)}",
    ".kpi .n small{font-size:13px;color:var(--k-ink3);font-weight:400}.kpi .f{font-size:12px;color:var(--k-ink3)}",
    ".cand{display:flex;flex-direction:column;gap:4px}.cand .top{display:flex;justify-content:space-between;gap:8px}",
    ".bar{height:6px;border-radius:3px;background:var(--k-bd3)}.bar i{display:block;height:100%;border-radius:3px;background:var(--k-ink2)}.bar.hot i{background:var(--tc)}",
    ".cand-f{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--k-ink3);padding-top:8px;border-top:1px solid var(--k-bd3)}",
    ".lim{display:grid;grid-template-columns:40px minmax(0,1fr);gap:10px;padding:10px 0;border-bottom:1px solid var(--k-bd3)}.lim:last-child{border-bottom:none}",
    ".lim .c{font-family:D2Coding,Consolas,monospace;font-size:17px;font-weight:700;white-space:nowrap}.lim .c small{margin-left:2px;font-family:Pretendard,'Malgun Gothic',sans-serif;font-size:12px;font-weight:400;color:var(--k-ink3)}.lim .t{font-weight:600}.lim .d{font-size:12px;color:var(--k-ink3)}",
    ".adv{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:baseline}.no{font-family:D2Coding,Consolas,monospace;color:var(--k-link);font-weight:700}",
    // 항목은 보조 글자색 — 절·카드 제목(기본 글자색)과 구분
    ".adv .tx{color:var(--k-ink2)}.adv .why{display:block;margin-top:2px;font-size:12px;color:var(--k-ink3)}.adv .tg{font-size:12px;color:var(--k-ink3);white-space:nowrap}.adv .tg.tc{color:var(--tc)}",
    // 세부 조치 번호는 순서만 — 색은 오른쪽 꼬리표(점검=등급색)에만
    ".adv .no{color:var(--k-ink3)}",
    ".chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border:1px solid var(--k-bd);border-radius:3px;font-family:D2Coding,Consolas,monospace;font-size:12px;color:var(--k-ink2)}",
    ".chip svg{width:14px;height:14px;color:var(--k-link)}.tent{font-size:12px;font-weight:600;color:var(--k-warn)}.llm-sum{font-size:13px;line-height:1.7;color:var(--k-ink2)}",
    // 전체 분석 — 절을 한 줄로 쌓음(번호는 절 머리에)
    ".secs{display:flex;flex-direction:column;gap:40px;min-width:0}.sec{display:flex;flex-direction:column;gap:14px;scroll-margin-top:16px}",
    ".sh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid var(--k-bd)}",
    ".sh .n{font-family:D2Coding,Consolas,monospace;color:var(--k-link)}.sh .t{font-size:17px;font-weight:700}.sh .s{font-size:12px;color:var(--k-ink3)}",
    // 01 심각도
    ".sv-act{display:flex;flex-direction:column;gap:12px;padding:14px 20px 16px;border-bottom:1px solid var(--k-bd3)}",
    ".sv-top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:18px 20px;border-bottom:1px solid var(--k-bd3)}",
    ".sv-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr)}.sv-c{display:flex;flex-direction:column;gap:10px;padding:18px 20px;min-width:0}",
    ".sv-c+.sv-c{border-left:1px solid var(--k-bd3);gap:12px}.sv-ch{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--k-ink3)}",
    ".sv-ch b{font-size:13px;font-weight:600;color:var(--k-ink)}.sv-ch b span{font-weight:400;color:var(--k-ink3)}.sv-ch .v{font-family:D2Coding,Consolas,monospace;font-weight:700;color:var(--k-ink)}",
    ".pills{display:flex;gap:8px;flex-wrap:wrap}.pill{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border:1px solid var(--k-bd2);border-radius:4px;font-size:12px;color:var(--k-ink3)}",
    ".pill.on{border-color:var(--tc);background:var(--ts);color:var(--tc);font-weight:600}.pill svg{width:13px;height:13px}",
    ".zones{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}.zn{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;color:var(--k-ink3)}",
    ".zn .b{position:relative;height:6px;border-radius:3px;background:var(--k-track)}.zn.cur .b{background:#005fb8}",
    ".zn .pin{position:absolute;top:-5px;width:2px;height:16px;margin-left:-1px;background:var(--k-ink)}",
    ".zn.cur{color:var(--k-ink);font-weight:600}.zn .r{font-family:D2Coding,Consolas,monospace;font-weight:400;color:var(--k-ink3)}.zn.cur .r{color:var(--k-ink2)}",
    ".map{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:-4px 0 -6px;text-align:center;font-size:12px;color:var(--k-ink4)}.sv-ch .now{color:var(--tc)}",
    ".res{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;font-size:12px;font-weight:600}",
    ".res div{display:flex;align-items:center;justify-content:center;height:26px;border-radius:4px;border:1px solid var(--k-bd);color:var(--tc)}.res div.on{background:var(--ts);border-color:var(--tc)}",
    // 지표 표·근거 표 — 좁은 화면은 표 안에서 가로 스크롤
    ".tbl{overflow-x:auto}.tbl .r{display:grid;gap:12px;padding:10px 16px;border-top:1px solid var(--k-bd3);align-items:baseline;min-width:620px}",
    ".tbl .r.hd{padding:8px 16px;background:var(--k-elev);border-top:none;font-size:12px;color:var(--k-ink3)}",
    ".mt .r{grid-template-columns:minmax(0,1.4fr) 110px 100px 80px minmax(0,2fr)}.mt .num{text-align:right;font-family:D2Coding,Consolas,monospace}.mt .nt{font-size:12px;color:var(--k-ink3)}",
    ".mt .over{color:var(--k-warn);font-weight:700}.mt .st{font-weight:600}",
    ".et .r{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,2.4fr);gap:16px;padding:12px 16px;align-items:center}.et .r.dim{color:var(--k-ink3)}",
    ".et .sc{display:flex;align-items:center;gap:8px}.et .sc .bar{flex:1}.et .sc .mono{width:24px;text-align:right}.et .bd{font-size:12px;color:var(--k-ink2)}.et .pt{font-size:11px;color:var(--k-ink4)}.et .r.dim .bd{color:var(--k-ink3)}",
    ".note{font-size:12px;color:var(--k-ink3)}.note.warn{color:var(--k-warn)}",
    // 계측 경고 — 게이트면 빨강, 품질 주의면 앰버. 참고 사유는 상자 밖 한 줄
    ".gate-box{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-radius:8px;border:1px solid var(--tc);background:var(--ts)}",
    ".gate-box .gb-t{font-size:14px;font-weight:700;color:var(--tc)}.gate-box .gb-il{font-weight:600}.gate-box .gb-id{margin-left:12px;font-size:12px;color:var(--k-ink3)}",
    ".gate-box .gb-d{font-size:12px;color:var(--k-ink2)}.q-note{font-size:12px;color:var(--k-ink3)}",
    // 차트 카드
    // 차트 격자 — 폭과 무관하게 2열(4장 = 2×2) · 홀수면 마지막 장은 한 줄 전체. 근거 카드(.lcg)는 폭 따라 열 수
    ".cg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cg>.chc:last-child:nth-child(odd){grid-column:1/-1}"
      + ".lcg{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.chc{display:flex;flex-direction:column;gap:8px;padding:14px 16px;min-width:0}",
    ".chc .t{font-weight:600}.chc .t .en{margin-left:6px;font-size:12px;font-weight:400;color:var(--k-ink3)}.chc .d{font-size:12px;color:var(--k-ink3)}",
    ".chart-wrap{position:relative;overflow:hidden}canvas{width:100%;display:block}",
    ".tooltip{position:absolute;pointer-events:none;display:none;z-index:10;background:var(--k-elev);color:var(--k-ink);border:1px solid var(--k-bd2);border-radius:4px;padding:7px 10px;font-size:12px;line-height:1.6;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3);font-family:D2Coding,Consolas,monospace}",
    ".xline{position:absolute;top:14px;bottom:34px;width:1px;background:rgba(0,117,226,.5);display:none;pointer-events:none}",
    ".legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--k-ink3)}.legend span{display:inline-flex;align-items:center;gap:7px}.sw{width:14px;height:2px;display:inline-block}",
    // FFT 기준 주파수 목록 — 근거 성분은 테두리
    ".mkl{display:flex;flex-wrap:wrap;gap:6px 18px;padding-top:10px;border-top:1px solid var(--k-bd3);font-size:12px;color:var(--k-ink3)}.mkl>span{display:inline-flex;align-items:center;gap:6px}",
    ".mkl b{color:var(--k-ink2);font-weight:600}.mkl .mono{color:var(--k-ink3)}.mkl .hit{margin:-2px -7px;padding:1px 6px;border:1px solid #e5646a;border-radius:3px}.mkl .hit b{color:#e5646a}",
    ".rng{display:flex;gap:4px}.rng button{padding:2px 10px;border:1px solid var(--k-bd);border-radius:3px;background:none;color:var(--k-ink3);font:12px D2Coding,Consolas,monospace;cursor:pointer}.rng button.on{border-color:var(--k-link);color:var(--k-ink)}",
    ".lst{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--k-ink2)}",
    ".disc{padding:12px 14px;background:var(--k-panel);border:1px solid var(--k-bd3);border-radius:4px;font-size:12px;color:var(--k-ink3)}",
    // 06 LLM 소견
    ".llm-key{display:flex;flex-direction:column;gap:8px;padding:16px 18px;background:var(--k-elev);border:1px solid var(--k-bd);border-radius:8px}.llm-key .x{font-size:15px;line-height:1.7}",
    ".op{display:grid;grid-template-columns:120px minmax(0,1fr);gap:16px;padding:14px 18px}.op+.op{border-top:1px solid var(--k-bd3)}.op .lb{font-weight:600}",
    ".op .its{display:flex;flex-direction:column;gap:10px;min-width:0}.op .it{display:flex;flex-direction:column;gap:2px}",
    ".op .cc{display:flex;align-items:flex-start;gap:4px;font-size:12px;color:var(--k-ink3)}.op .cc svg{width:12px;height:12px;margin-top:3px;flex-shrink:0}",
    ".op b{font-family:D2Coding,Consolas,monospace}",
    // 측정 정보(재현성)
    ".meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:var(--k-bd3);border:1px solid var(--k-bd);border-radius:8px;overflow:hidden}",
    ".meta>div{display:flex;flex-direction:column;gap:4px;padding:14px 18px;background:var(--k-panel)}",
    ".meta .k{font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--k-ink4)}",
    ".meta .v{font-family:D2Coding,Consolas,monospace;font-size:13px;font-weight:700}.meta .s{font-family:D2Coding,Consolas,monospace;font-size:12px;color:var(--k-ink3)}",
    "@media (max-width:900px){"
      + ".sv-cols{grid-template-columns:minmax(0,1fr)}.sv-c+.sv-c{border-left:none;border-top:1px solid var(--k-bd3)}.op{grid-template-columns:minmax(0,1fr);gap:6px}}",
    "@media (max-width:640px){.wrap{padding:20px 14px 40px}.cg,.g2{grid-template-columns:minmax(0,1fr)}.ttl{font-size:24px}}",
    /* 인쇄 — 테마 무관 라이트, 전체 분석만(요약·탭·버튼 제외)
       print-color-adjust 없으면 배경색(배지·막대)이 빠짐 · 작은 단위만 분할 금지
       측정 정보는 칸 수와 무관하게 한 줄(내용 폭대로)
       짧은 값은 안 꺾고 긴 줄(.wr)만 단어 단위로 꺾음 — 보고서 ID·모델명이 중간에서 잘리지 않게 */
    "@media print{:root,.theme-light{" + LIGHT + ";--k-bg:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}"
      + ".noprint,.tabs,#sum{display:none!important}#full{display:block!important}.rng button:not(.on){display:none!important}"
      + ".meta{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:auto}.meta>div{padding:8px 9px}.meta .k{font-size:9px;letter-spacing:.3px}"
      + ".meta .v{font-size:10.5px;white-space:nowrap}.meta .s{font-size:9.5px;white-space:nowrap}.meta .wr{white-space:normal;word-break:keep-all;overflow-wrap:anywhere}"
      + ".wrap{padding:0 0 10px;max-width:none}.secs{gap:22px}.card,.chc,.kpi,.sv-top,.sv-cols,.tbl .r,.op,.meta,.gate-box,.llm-key{break-inside:avoid}.sh{break-after:avoid}"
      + ".tbl .r{min-width:0}canvas{width:100%!important;height:auto!important}}",
    // 인쇄 직전 재렌더용 — 캔버스 비트맵은 그릴 때 폭으로 고정되므로 종이 폭·열 수로 다시 그림
    "body.printing .wrap{max-width:186mm}body.printing .cg{grid-template-columns:1fr}",
  ].join('\n');

  // 저장된 리포트 안에서 차트를 그리는 부트 스크립트 (고정 코드 — 사용자 입력 미포함)
  var BOOT = [
    "(function(){",
    "var CH=window.VibeChart, R=window.RPT||{};",
    // 차트 눈금·툴팁 시각 = 리포트를 만든 시간대(여는 사람의 브라우저 시간과 무관)
    "if(CH&&CH.setZone&&R.tz) CH.setZone(R.tz);",
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
    "var FFT_FULL=false;",
    "window.setFftRange=function(f){FFT_FULL=!!f;var bs=document.querySelectorAll('.rng button');for(var i=0;i<bs.length;i++)bs[i].classList.toggle('on',(bs[i].getAttribute('data-f')==='1')===FFT_FULL);drawAll();};",
    "function drawAll(){",
    " if(R.rms)line('cRms','tRms',{values:R.rms,xLabels:R.xL,tipLabels:R.xT,color:CH.SERIES.rms,height:180,smooth:true,refLines:R.refs,unit:R.unit});",
    " if(R.p2p)line('cP2p','tP2p',{values:R.p2p,xLabels:R.xL,tipLabels:R.xT,color:CH.SERIES.p2p,height:180,smooth:true,zeroBase:true});",
    " if(R.crest)line('cCrest','tCrest',{values:R.crest,xLabels:R.xL,tipLabels:R.xT,color:CH.SERIES.crest,height:180,smooth:true,refLines:[{val:3,color:'#8a8d99',label:'CF=3'},{val:6,color:'#e07b39',label:'CF=6'}]});",
    " if(R.kurt)line('cKurt','tKurt',{values:R.kurt,xLabels:R.kxl,color:'#fdb532',height:180,smooth:true,refLines:[{val:3,color:'#8a8d99',label:'정상=3'},{val:4.5,color:'#e07b39',label:'충격성 경계'}]});",
    // 범례 클릭 → 그 계열을 빼고 다시 그림(축 범위도 재계산). 마지막 구간(s,e)을 기억해 확대 상태 유지
    " if(R.bands){var cb=el('cBand');if(cb){var hid={},rng=[0,R.kxl.length];",
    "  var db=function(s,e){rng=[s,e];CH.drawMultiLine(cb,{series:R.bands.filter(function(sr){return !hid[sr.label];}).map(function(sr){return {label:sr.label,color:sr.color,dash:sr.dash,vals:sr.vals.slice(s,e)};}),xLabels:R.kxl.slice(s,e),height:200},cc());};",
    "  db(0,R.kxl.length);CH.addZoom(cb,R.kxl.length,db);",
    "  var lg=document.querySelector('[data-toggle=\"cBand\"]');",
    "  if(lg&&!lg._on){lg._on=1;lg.addEventListener('click',function(ev){var t=ev.target;while(t&&t!==lg&&!t.getAttribute('data-series'))t=t.parentNode;",
    "    if(!t||t===lg)return;var k=t.getAttribute('data-series');",
    "    if(hid[k]){delete hid[k];t.style.opacity='';t.style.textDecoration='';}else{hid[k]=1;t.style.opacity='.35';t.style.textDecoration='line-through';}",
    "    db(rng[0],rng[1]);});}}}",
    " if(R.wave)line('cWave','tWave',{values:R.wave.v,xLabels:R.wave.t,color:CH.SERIES.wave,height:160,lw:1.1},'xWave');",
    // FFT — 기본은 상세분석 기본 범위(dispHz, 결함 주파수가 보이는 대역), 전대역 버튼이면 Nyquist까지
    " if(R.fft){var fe=R.fft.freqs.length;if(!FFT_FULL&&R.fft.dispHz>0)for(var fi=0;fi<fe;fi++)if(R.fft.freqs[fi]>R.fft.dispHz){fe=fi;break;}",
    "  fftc('cFft','tFft',{freqs:R.fft.freqs.slice(0,fe),mags:R.fft.mags.slice(0,fe),markers:[],res:R.fft.res,height:240});}",
    " if(R.spec){var cs=el('cSpec');if(cs)CH.drawHeat(cs,{grid:R.spec.grid,rows:R.spec.rows,cols:R.spec.cols,fmax:R.spec.fmax,height:160},cc());}",
    " if(R.kurtogram)fftc('cKurtogram',null,{freqs:R.kurtogram.freqs,mags:R.kurtogram.mags,markers:R.kurtogram.markers,res:R.kurtogram.res,height:160,hideMarkerLabels:false});",
    " if(R.env)fftc('cEnv',null,{freqs:R.env.freqs,mags:R.env.mags,markers:R.env.markers,res:1,height:160,hideMarkerLabels:true});",
    "}",
    "window.toggleTheme=function(){var r=document.documentElement;r.classList.toggle('theme-light');try{localStorage.setItem('neoVibeReportTheme',r.classList.contains('theme-light')?'light':'dark');}catch(e){}drawAll();};",
    "function applyView(v){var b=document.body;b.classList.toggle('view-sum',v==='sum');b.classList.toggle('view-full',v!=='sum');",
    " var bs=document.querySelectorAll('.tab');for(var i=0;i<bs.length;i++)bs[i].classList.toggle('on',bs[i].getAttribute('data-v')===v);",
    " if(v!=='sum')setTimeout(drawAll,0);}",   // 숨김 해제 후 캔버스 폭이 잡힌 뒤 그림
    "window.setView=function(v){try{localStorage.setItem('neoVibeReportView',v);}catch(e){}applyView(v);};",
    // 요약의 '근거 보기'·'심층 분석 보기' — 전체 분석으로 바꾼 뒤 그 절로
    "window.goSec=function(id){window.setView('full');setTimeout(function(){var e=el(id);if(e)e.scrollIntoView();},30);return false;};",
    "var _v0='sum';try{_v0=localStorage.getItem('neoVibeReportView')||'sum';}catch(e){}applyView(_v0);",
    "var rt;window.addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(drawAll,80);});",
    "window.printReport=function(){window.print();};",
    // 캔버스는 테마 색이 픽셀로 고정 — 인쇄 직전 라이트로 다시 그리고, 끝나면 원래 테마로 복귀
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

  // 절 머리 — 번호 · 제목 · 보조 설명(고정 HTML 허용: extra)
  function secHead(no, title, sub, extra) {
    return '<div class="sh"><span class="n">' + no + '</span><span class="t">' + esc(title) + '</span>'
      + (extra || '') + (sub ? '<span class="s">' + esc(sub) + '</span>' : '') + '</div>';
  }
  /* 차트 카드 — opts: {title, en(영문명), right(고정 HTML), desc(무엇을 보여주는지 한 줄), canvasId, h, tipId, xlineId, legend:[{label,color,dash}], toggle}
     제목 형식은 상세분석 차트와 같음(한글 + 영문명) */
  function chartHead(title, en, right) {
    return '<div class="sb"><span class="t">' + esc(title) + (en ? '<span class="en">' + esc(en) + '</span>' : '') + '</span>'
      + (right ? '<span class="s12 m3">' + right + '</span>' : '') + '</div>';
  }
  function chartCard(opts) {
    var o = '<div class="card chc">' + chartHead(opts.title, opts.en, opts.right);
    if (opts.desc) o += '<div class="d">' + esc(opts.desc) + '</div>';
    o += '<div class="chart-wrap"><canvas id="' + opts.canvasId + '" height="' + opts.h + '"></canvas>'
      + (opts.xlineId ? '<div class="xline" id="' + opts.xlineId + '"></div>' : '')
      + (opts.tipId ? '<div class="tooltip" id="' + opts.tipId + '"></div>' : '') + '</div>';
    if (opts.legend && opts.legend.length) {
      // toggle 차트는 범례 클릭으로 계열 on/off
      o += '<div class="legend"' + (opts.toggle ? ' data-toggle="' + esc(opts.canvasId) + '"' : '') + '>' + opts.legend.map(function (l) {
        var t = opts.toggle ? ' data-series="' + esc(l.label) + '" style="cursor:pointer;user-select:none" title="클릭하면 숨김 · 다시 누르면 표시"' : '';
        var sw = l.dash ? 'height:0;border-top:2px dashed ' + esc(l.color) + ';background:none;' : 'background:' + esc(l.color) + ';';
        return '<span' + t + '><span class="sw" style="' + sw + '"></span>' + esc(l.label) + '</span>';
      }).join('') + '</div>';
    }
    return o + '</div>';
  }

  // LLM 소견 파싱 — "## 섹션" · 불릿(• - * 1.) · " → 결론"(있을 때만) · "핵심 요약:" 문단
  function parseOpinion(text) {
    var secs = [], cur = null, key = '', inKey = false;
    var item = function (t) {
      if (!cur) { cur = { label: '소견', items: [] }; secs.push(cur); }
      // " → "(양옆 공백)에서 결론 분리 — 숫자 사이 "→"는 범위 표기라 제외
      var m = /\s→\s/.exec(t);
      cur.items.push(m ? { fact: t.slice(0, m.index).trim(), concl: t.slice(m.index + m[0].length).trim() } : { fact: t, concl: '' });
    };
    String(text || '').split('\n').forEach(function (ln) {
      var t = ln.trim().replace(/([^.\s])\.$/, '$1'); // 개조식 — 줄 끝 마침표 제거(모델이 지시를 어겨도)
      if (!t) { inKey = false; return; }
      var mh = t.match(/^#{1,3}\s+(.*)/);
      if (mh) { inKey = false; cur = { label: mh[1].replace(/\*\*/g, '').trim(), items: [] }; secs.push(cur); return; }
      var body = t.replace(/^(?:[-*•]|\d+[.)])\s+/, '');
      var mk = body.replace(/\*\*/g, '').match(/^핵심\s*요약\s*[:：]\s*(.*)/);
      if (mk) { key = mk[1].trim(); inKey = true; return; }
      if (inKey && body === t) { key += ' ' + t; return; }
      inKey = false;
      if (/^→/.test(t) && cur && cur.items.length) { cur.items[cur.items.length - 1].concl = t.replace(/^→\s*/, ''); return; }
      item(body);
    });
    return { key: key.trim(), secs: secs.filter(function (s) { return s.items.length; }) };
  }
  // 인라인 마크다운 — **굵게**만(먼저 esc 후 마커 치환)
  function md(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }
  // 세부 조치 꼬리표(tag 없는 옛 페이로드용) — 문구로 분류(점검은 등급색)
  function advTag(t) {
    if (/입력|계통도|품번|날개수|제원|구동방식/.test(t)) return { k: '정보 입력' };
    if (/위상|축방향|재측정|센서|마운팅|케이블|취득 조건/.test(t)) return { k: '계측 보강' };
    if (/정기 점검/.test(t)) return { k: '정기 점검', hot: true };
    if (/점검|교체|윤활|정지/.test(t)) return { k: '점검', hot: true };
    return null;
  }
  // 세부 조치 행 — 할 일 + 이유(brief면 할 일만) · 꼬리표는 항목 것(옛 페이로드는 문구로 추정), 점검류만 등급색
  function advRows(actions, gi, brief) {
    return (actions || []).map(function (a, i) {
      var tg = a.tag ? { k: a.tag, hot: /점검/.test(a.tag) } : advTag(a.txt || '');
      return '<div class="adv ' + tone(gi) + '"><span class="no">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span class="tx">' + esc(a.txt)
        + (!brief && a.why ? '<span class="why">' + esc(a.why) + '</span>' : '') + '</span>'
        + (tg ? '<span class="tg' + (tg.hot ? ' tc' : '') + '">' + tg.k + '</span>' : '<span></span>') + '</div>';
    }).join('');
  }

  // p: { docNo, alias, tagName, generatedText, logoDataURL, specs, sevMachine, gradeKo, gradeIdx, isoClass,
  //      zones:[문자3], zonesUnit, verdict, verdictSub, anchorBrief{at,note}, judge, sevCards,
  //      opinion, opinionModel, actions, build, data(RPT — 차트 데이터), chartLibSrc(chart.js 소스), fftHint, envBand }
  function buildReportHTML(p) {
    var d = p.data || {};
    var sm = d.summary || {};
    var isoH = d.iso; // {rms, disp, conv, gradeIdx, gradeKo, anaSec, blocks, spread, spreadWarn}
    /* ISO 값 표기 — 원본 단위(disp: 같은 10–1000 Hz 대역 RMS), 가속도·변위 설비(conv)의 존 판정은 속도 환산
       disp 없는 옛 페이로드는 속도 값 그대로 */
    var isoTxt = isoH ? (isoH.disp || (isoH.rms + ' ' + (p.zonesUnit || 'mm/s'))) : '';
    var isoBasis = isoH ? '10–1000 Hz 대역제한 ' + (isoH.conv ? 'RMS · 존은 속도 환산' : '속도 RMS') : '';
    var J = p.judge || {};
    var SM = sevModel({ gi: p.gradeIdx, gradeKo: p.gradeKo, judge: J, iso: isoH ? { idx: isoH.gradeIdx, val: isoTxt } : null, zones: p.zones, unit: p.zonesUnit });
    var gi = SM.tone, gate = !!(sm.gate || d.gate);
    // 판정 제목 — 등급은 베어링 결함 패턴이 발동(gi > 0)하므로 부위 세분(내륜 등) 대신 '베어링 결함 + 단계'
    var vTitle = sevTitle(gi, J, gate, p.verdict);
    // 측정 불가 묶음 — 사유 첫 구절별로 이름을 모음: '불평형 · 정렬불량 — 위상·축방향 데이터 없음'
    var naGroups = function (list) {
      var gs = [];
      list.forEach(function (u) {
        var r = String(u.why || '').split(' — ')[0] || '설비 정보 미입력', g = null;
        gs.forEach(function (x) { if (x.r === r) g = x; });
        if (!g) gs.push(g = { r: r, f: [] });
        g.f.push(shortName(u.f));
      });
      return gs.map(function (g) { return g.f.join(' · ') + ' — ' + g.r; });
    };
    var cards = p.sevCards || [];
    var cardOf = function (re) { for (var i = 0; i < cards.length; i++) if (re.test(cards[i].label || '')) return cards[i]; return null; };
    // 기준 대조 — 등급 없는 카드는 over가 늘 거짓이라 값·기준 숫자로 판단, 기준이 "기준 < X" 꼴이 아니면 null
    var numOf = function (s) { var m = /-?\d+(?:\.\d+)?/.exec(String(s || '').replace(/,/g, '')); return m ? parseFloat(m[0]) : NaN; };
    var cmpOf = function (c) {
      if (!c || !/^기준 </.test(c.thr || '')) return null;
      var v = numOf(c.value), t = numOf(c.thr);
      return isFinite(v) && isFinite(t) ? !!(c.over || v > t) : null;
    };
    // 후보는 근거 점수가 선 것만(0점은 '근거 없음'으로 묶음)
    var cands = (sm.cands || []).filter(function (c) { return c.score == null || c.score > 0; });
    var top = cands[0] || null;
    var lvOf = evidLevel;
    // LLM 소견은 보조 — 1순위 근거가 '강함'(70) 미만이거나 계측 게이트면 잠정
    var OP = p.opinion ? parseOpinion(p.opinion) : null;
    var tentative = gate || !top || !(top.score >= 70);
    var opKey = OP ? (OP.key || (OP.secs[0] && OP.secs[0].items[0] ? OP.secs[0].items[0].fact : '')) : '';
    var badge = function () {
      return '<div class="gb ' + tone(gi) + '">' + (gi > 0 ? ICON.warn : gi === 0 ? ICON.ok : '') + '<span>' + esc(SM.ko) + '</span></div>';
    };
    var steps = function () {
      if (!SM.step) return '';
      var b = '';
      for (var k = 1; k <= 4; k++) b += '<span' + (k <= SM.step ? ' class="on"' : '') + '></span>';
      return '<span class="steps ' + tone(gi) + '">단계<span class="bars">' + b + '</span><span class="mono" style="color:var(--k-ink)">' + SM.step + '/4</span></span>';
    };
    var why = SM.why ? '<div class="vd-s">' + esc(SM.why.text) + '</div>' + (SM.why.note ? '<div class="vd-n">' + esc(SM.why.note) + '</div>' : '') : '';
    var splitVal = function (s) { var t = String(s || ''), i = t.indexOf(' '); return i > 0 ? [t.slice(0, i), t.slice(i)] : [t, '']; };

    var h = [];
    h.push('<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">');
    h.push('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">');
    h.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    h.push('<title>' + esc(p.alias) + ' 진동 분석 리포트</title>');
    h.push("<script>try{if(localStorage.getItem('neoVibeReportTheme')==='light')document.documentElement.classList.add('theme-light');}catch(e){}<\/script>");
    h.push('<style>' + CSS + '</style></head><body class="view-sum"><div class="wrap">');

    // ── 머리 ──
    h.push('<header class="hd"><div class="hd-l">');
    if (p.logoDataURL) h.push('<img class="logo" src="' + p.logoDataURL + '" alt="MACHBASE NEO">');
    h.push('<div class="ttl"><span class="mono">' + esc(p.alias) + '</span> 진동 분석 리포트</div>');
    h.push('<div class="hm ids"><span>' + esc(p.generatedText) + '</span><span>' + esc(p.tagName) + '</span><span>' + esc(p.docNo) + '</span></div>');
    if ((p.specs || []).length) {
      h.push('<div class="hm sp">' + p.specs.map(function (s) {
        return '<span>' + esc(s.k) + ' <span class="v">' + esc(s.v) + (s.unit ? esc(s.unit) : '') + '</span></span>';
      }).join('') + '</div>');
    }
    h.push('</div><div class="hbtn noprint">');
    h.push('<button class="theme-btn" onclick="printReport()" title="인쇄 · PDF로 저장">' + ICON.print + '</button>');
    h.push('<button class="theme-btn" onclick="toggleTheme()" title="라이트/다크 전환">' + ICON.theme + '</button>');
    h.push('</div></header>');
    h.push('<div class="tabs"><button class="tab on" data-v="sum" onclick="setView(\'sum\')">요약</button><button class="tab" data-v="full" onclick="setView(\'full\')">전체 분석</button></div>');

    // ── 요약 ─────────────────────────────────────────────────────────────
    h.push('<div id="sum" class="vcol g16">');
    // 판정 — 등급·판정문·사유, 계측 경고, 지금 할 일, 근거 사실
    h.push('<section class="card pad vcol g16"><div class="vd">' + badge() + '<div class="vd-t"><div class="vd-h">' + esc(vTitle) + '</div>' + why + '</div></div>');
    if (gate) {
      h.push('<div class="alert t3"><div class="h">계측 검증 필요 — 결함 진단 보류</div><div class="d">' + esc(sm.gateReason || '') + '</div>'
        + '<div class="d">Crest 15 초과 = 단발 스파이크(ESD·케이블·커넥터·마운트) 시그니처 · 시간영역 임펄스가 주파수영역으로 퍼져 <b>모든 스펙트럼 피크 진폭 잠정</b></div></div>');
    }
    if (d.levelsOk === false) {
      h.push('<div class="alert t1"><div class="h">가속도 값 게재 보류</div><div class="d">에너지 중심 f_eff ' + ((d.accelFeff || 0) / 1000).toFixed(1)
        + ' kHz = Nyquist의 ' + Math.round((d.accelNyqFrac || 0) * 100) + '% — 안티에일리어싱 필터·센서 공진 확인 전까지 가속도 값 사용 금지</div></div>');
    }
    var act = sm.action || ((p.actions || [])[0] ? p.actions[0].txt : '');
    // 지금 할 일 · 근거 사실 — 심각도 절 머리에도 같은 줄(인쇄는 전체 분석만 나감)
    var todoHtml = act ? '<div class="todo">' + ICON.tools + '<span class="k">지금 할 일</span><b>' + esc(act) + '</b></div>' : '';
    var facts = [];
    if (top && top.score != null) facts.push('<span>근거 점수 <span class="v">' + top.score + '/100</span> · ' + (gate ? '잠정 · 전역 상한 ' + esc(sm.gateCap) : lvOf(top.score)) + '</span>');
    var ab = p.anchorBrief;
    if (ab && ab.at) facts.push('<span>판정 기준 <span class="v">' + esc(ab.at) + '</span>' + (ab.note ? ' · ' + esc(ab.note) : '') + '</span>');
    h.push(todoHtml);
    if (SM.step || facts.length) h.push('<div class="facts">' + (SM.step ? steps() : '') + facts.join('') + '</div>');
    h.push('</section>');

    // LLM 소견(요약) — 판정 바로 아래, 핵심 요약 한 문단
    if (OP && opKey) {
      h.push('<section class="card pad vcol g10"><div class="sb" style="align-items:center"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="ct">LLM 소견</span>'
        + (p.opinionModel ? '<span class="chip">' + ICON.spark + esc(p.opinionModel) + '</span>' : '') + (tentative ? '<span class="tent">잠정 판정</span>' : '') + '</div>'
        + '<a href="#llm" class="s12" onclick="return goSec(\'llm\')">심층 분석 보기</a></div><div class="llm-sum">' + md(opKey) + '</div></section>');
    }

    /* 핵심 수치 3장 — ISO 판정값 · Crest P95 · 광대역 RMS
       꼬리표 색: ISO는 존, 등급 없는 카드는 기준 대조(이내 초록 · 초과 주황), 예외 배지(잠정 등)는 중립 */
    var kCrest = cardOf(/^Crest/), kRms = cardOf(/^P95 RMS/);
    var kTag = function (c, over) {
      if (c.badgeKo) return '<b' + (over ? ' class="tc"' : '') + '>' + esc(c.badgeKo) + '</b>';
      return over == null ? '<b></b>' : '<b class="tc' + (over ? '' : ' t0') + '">' + (over ? '기준 초과' : '기준 이내') + '</b>';
    };
    var thrOf = function (c) { return String(c.thr || '').replace(/^기준 < /, '기준 '); };
    var kpis = [];
    if (isoH) {
      var zk = ISO_ZONE[isoH.gradeIdx] || { k: '-' };
      var nextB = isoH.gradeIdx < 3 && p.zones ? ' · ' + ISO_ZONE[isoH.gradeIdx + 1].k + ' 경계 ' + esc(p.zones[isoH.gradeIdx]) : '';
      var iv = splitVal(isoTxt);
      kpis.push('<div class="card kpi"><div class="h"><span>ISO 판정값</span>' + (gate ? '<b>판정 보류</b>' : '<b class="tc ' + tone(isoH.gradeIdx) + '">' + zk.k + ' 구간</b>') + '</div>'
        + '<div class="n">' + esc(iv[0]) + '<small>' + esc(iv[1]) + '</small></div>'
        + '<div class="f">10–1000 Hz ' + (isoH.conv ? 'RMS · 존은 속도 환산' : '속도 RMS') + nextB + (gate && sm.bias ? ' · ' + esc(sm.bias) : '') + '</div></div>');
    }
    var crestOver = cmpOf(kCrest);
    if (kCrest) {
      kpis.push('<div class="card kpi' + (crestOver ? ' over t1' : '') + '"><div class="h"><span>Crest Factor P95</span>' + kTag(kCrest, crestOver) + '</div>'
        + '<div class="n">' + esc(kCrest.value) + '</div><div class="f">' + esc(thrOf(kCrest)) + (crestOver ? ' · 충격성 성분 존재' : '') + '</div></div>');
    }
    if (kRms) {
      var bcN = /B\/C 초과 (\d+\/\d+)/.exec(kRms.foot2 || ''), rmsOver = cmpOf(kRms);
      kpis.push('<div class="card kpi' + (rmsOver ? ' over t1' : '') + '"><div class="h"><span>광대역 RMS P95</span>' + kTag(kRms, rmsOver) + '</div>'
        + '<div class="n">' + esc(kRms.value) + '<small> ' + esc(kRms.unit || '') + '</small></div>'
        + '<div class="f">감시용 · ' + esc(thrOf(kRms)) + (bcN ? ' · 초과 ' + bcN[1] : '') + '</div></div>');
    }
    if (kpis.length) h.push('<section class="kpis">' + kpis.join('') + '</section>');

    // 결함 후보 · 판단의 한계
    var evid = d.evidence || [];
    var evNa = evid.filter(function (c) { return c.na; });
    var evZero = evid.filter(function (c) { return !c.na && !(c.score > 0); });
    var _um = sm.unmeasurable || [], _ng = d.negatives || [], _ux = d.unexplained || [];
    h.push('<section class="g2">');
    h.push('<div class="card pad vcol g14"><div class="sb"><span class="ct">' + (gate ? '잠정 후보' : '결함 후보') + '</span><span class="s12 m3">'
      + (gate ? '진단 보류 중 · 전역 상한 ' + esc(sm.gateCap) + '/100' : '근거 점수 · 확률 아님') + '</span></div><div class="vcol g12">');
    if (!cands.length) h.push('<div class="note">근거 점수를 받은 후보 없음</div>');
    cands.forEach(function (c, i) {
      var sc = c.score != null ? c.score : 0;
      var hot = i === 0 && sc >= 40;
      h.push('<div class="cand"><div class="top"><span style="font-weight:600">' + esc(shortName(c.f)) + '</span><span class="mono">' + (c.score == null ? '—' : c.score) + '</span></div>'
        + '<div class="bar' + (hot ? ' hot ' + (sc >= 70 ? 't2' : 't1') : '') + '"><i style="width:' + Math.max(0, Math.min(100, sc)) + '%"></i></div>'
        + (c.why ? '<div class="s12 m3">' + esc(c.why) + '</div>' : '') + '</div>');
    });
    h.push('<div class="cand-f"><span>' + [evZero.length ? '그 외 ' + evZero.length + '종 근거 없음' : '', evNa.length ? evNa.length + '종 측정 불가' : ''].filter(Boolean).join(' · ')
      + '</span><a href="#evidence" onclick="return goSec(\'evidence\')">근거 보기</a></div></div></div>');
    h.push('<div class="card pad vcol g14"><span class="ct">판단의 한계</span><div class="vcol">');
    // 왼쪽 숫자는 개수 — 단위(종·개)를 붙여 순번으로 읽히지 않게
    var limRow = function (n, u, t, dd) { return '<div class="lim"><span class="c">' + n + '<small>' + u + '</small></span><div><div class="t">' + t + '</div><div class="d">' + [].concat(dd).map(esc).join('<br>') + '</div></div></div>'; };
    if (_um.length) h.push(limRow(_um.length, '종', '측정 불가', naGroups(_um)));
    // 미검출은 짧은 이름(옛 페이로드는 전문), 미설명은 주파수만
    var _ns = (d.negShort && d.negShort.length === _ng.length) ? d.negShort : _ng;
    if (_ng.length) h.push(limRow(_ng.length, '종', '확인했으나 미검출', _ns.join(' · ')));
    if (_ux.length) h.push(limRow(_ux.length, '개', '미설명 성분', _ux.map(function (s) { var v = parseFloat(s); return isFinite(v) ? v.toFixed(1) : s; }).join(' · ') + ' Hz — 출처 확인 필요'));
    if (!_um.length && !_ng.length && !_ux.length) h.push('<div class="note">기록된 한계 없음</div>');
    h.push('</div></div></section>');

    // 세부 조치 — 요약은 할 일만(이유는 전체 분석)
    h.push('<section class="card pad vcol g12"><span class="ct">세부 조치</span><div class="vcol g8">'
      + ((p.actions || []).length ? advRows(p.actions, gi, true) : '<div class="note">추가 조치 없음 — 지금 할 일대로 운전</div>') + '</div></section>');
    h.push('</div>');

    // ── 전체 분석 ──────────────────────────────────────────────────────────
    // 절 번호 — 절 머리(01 심각도 …)용. 측정 정보는 머리 없는 꼬리 칸이라 번호 없음
    var order = ['severity', 'trend', 'spectrum', 'evidence', 'advice'];
    if (OP) order.push('llm');
    var noOf = function (id) { var i = order.indexOf(id); return i < 0 ? '' : (i < 9 ? '0' : '') + (i + 1); };
    h.push('<div id="full"><div class="secs">');

    // 01 심각도
    h.push('<section id="severity" class="sec">' + secHead(noOf('severity'), '심각도', '결함 패턴이 등급을 발동하고, 진동 크기가 높이를 결정'));
    var rule = J.patNa ? '결함 패턴 미측정 → ' + SM.ko
      : (J.patOn ? '결함 패턴 있음' : '결함 패턴 없음') + (isoH ? ' + ISO ' + (ISO_ZONE[isoH.gradeIdx] || { k: '-' }).k + ' 구간' : '') + ' → ' + SM.ko;
    // 사유 문장은 판정식이 못 담는 경우만(미측정 사유 · 패턴 없는 고진동 · ISO 미계산) — 요약 탭과 중복 방지
    h.push('<div class="card"><div class="sv-top">' + badge() + '<div class="vd-t"><span class="vd-h">' + esc(vTitle) + '</span><span class="vd-n">' + esc(rule) + '</span>'
      + (J.patOn && isoH ? '' : why) + '</div>' + steps() + '</div>');
    // 요약 판정 카드와 같은 지금 할 일 · 근거 사실(단계는 위 오른쪽)
    if (todoHtml || facts.length) h.push('<div class="sv-act">' + todoHtml + (facts.length ? '<div class="facts">' + facts.join('') + '</div>' : '') + '</div>');
    h.push('<div class="sv-cols"><div class="sv-c"><div class="sv-ch"><b>결함 패턴</b><span>발동 여부</span></div><div class="pills">');
    SM.pat.pills.forEach(function (q) {
      h.push(q.on ? '<span class="pill on ' + tone(q.tone) + '">' + (q.tone >= 0 ? ICON.check : '') + esc(shortName(q.label)) + '</span>' : '<span class="pill">' + esc(q.label) + '</span>');
    });
    h.push('</div><div class="s12 m2">' + esc(SM.pat.fact) + '</div></div>');
    h.push('<div class="sv-c"><div class="sv-ch"><b>진동 크기 <span>ISO 10816' + (p.isoClass ? ' Class ' + esc(p.isoClass) : '') + '</span></b><span class="v">' + esc(isoTxt || 'ISO 값 없음') + '</span></div>');
    if (!isoH) h.push('<div class="note">원시 파형 부족 — 10–1000 Hz 대역제한 RMS 계산 불가</div>');
    if (isoH && isoH.spreadWarn) h.push('<div class="note warn">⚠ 정상상태 전제 미충족(블록간 변동 ×' + esc(isoH.spread) + ') — 존 판정 잠정</div>');
    if (d.parsevalOk === false) h.push('<div class="note warn">⚠ 대역 분해 검산 실패(' + esc(d.parsevalErr) + '%) — 해석 전 계측 확인 필요</div>');
    h.push('<div class="zones">');
    SM.iso.zones.forEach(function (z, k) {
      // 현재 존 안의 값 위치 — 전체 막대 위치(4칸 등폭)를 칸 안 비율로
      var pin = (z.cur && SM.iso.pos != null) ? '<span class="pin" style="left:' + Math.max(1, Math.min(99, (SM.iso.pos - 25 * k) * 4)).toFixed(1) + '%"></span>' : '';
      h.push('<div class="zn' + (z.cur ? ' cur' : '') + '"><div class="b">' + pin + '</div><span class="nm">' + z.k + ' ' + esc(z.ko) + '</span><span class="r">' + esc(z.range) + '</span></div>');
    });
    h.push('</div>');
    /* 판정 등급 — 존 막대와 같은 급의 머리 + 존→등급 화살표(존 막대를 등급으로 오독 방지)
       오른쪽은 지금 상태: 현재 등급 · 미측정 · 패턴 없음 */
    if (SM.iso.res.length) {
      var resNow = J.patNa ? '지금은 결함 패턴 미측정'
        : !J.patOn ? '지금은 결함 패턴이 없어 해당 없음'
          : isoH ? '현재 <b class="now ' + tone(gi) + '">' + esc(SM.ko) + '</b>' : 'ISO 값 없음';
      h.push('<div class="map"><span>↓</span><span>↓</span><span>↓</span><span>↓</span></div>'
        + '<div class="sv-ch"><b>판정 등급 <span>결함 패턴이 있을 때 · 위 구간별</span></b><span>' + resNow + '</span></div><div class="res">');
      SM.iso.res.forEach(function (r) {
        h.push('<div class="' + tone(r.gi) + (r.on ? ' on' : '') + '" style="grid-column:span ' + r.span + '">' + esc(r.ko) + (r.on ? ' · 현재' : '') + '</div>');
      });
      h.push('</div>');
    }
    h.push('</div></div></div>');
    // 계측 경고 — 게이트·신호 품질을 한 상자로(게이트면 빨강, 아니면 앰버), 참고 사유는 상자 밖 한 줄
    var _qa = (d.quality && d.quality.issues) ? d.quality.issues : [];
    var _qi = _qa.filter(function (x) { return !x.info; }), _qn = _qa.filter(function (x) { return x.info; });
    if (d.gate || _qi.length) {
      h.push('<div class="gate-box ' + (d.gate ? 't3' : 't1') + '"><div class="gb-t">' + (d.gate ? '계측 검증 필요 — 결함 진단 보류' : '신호 품질 주의') + '</div>');
      _qi.forEach(function (x) {
        var dt = String(x.detail || ''), cut = dt.indexOf('—');
        h.push('<div class="gb-i"><div class="gb-il">' + esc(x.label) + ' — ' + esc(cut > 0 ? dt.slice(0, cut).trim() : dt) + '</div>'
          + (cut > 0 ? '<div class="gb-id">' + esc(dt.slice(cut + 1).trim()) + '</div>' : '') + '</div>');
      });
      h.push('<div class="gb-d">' + (d.gate
        ? '극단적 Crest/첨도 — 베어링 결함(통상 Crest &lt;10)보다 단발 스파이크(ESD·케이블 흔들림·커넥터 접촉·마운트 덜컹임) 시그니처에 가까움 · 센서 마운팅·케이블·커넥터 점검 후 재측정 권장 · 결함 후보·근거 점수는 계측 검증 전까지 <b>잠정 참고용</b>'
        : '측정 신뢰도 저하 — 센서 점검 전까지 판정 잠정') + '</div></div>');
    }
    if (_qn.length) h.push('<div class="q-note">ⓘ ' + esc(_qn.map(function (x) { return x.label + ': ' + x.detail; }).join(' · ')) + '</div>');
    /* 지표 표 — 지표 · 값 · 기준 · 상태 · 비고. 비고는 짧게(전문은 마우스를 올리면)
       상태색: ISO는 존, 등급 없는 지표는 이내 초록 · 초과 주황 · 비교 안 함 중립(광대역에 등급어 금지) */
    var mrow = function (name, val, crit, st, note, cls, tip) {
      return '<div class="r"><span' + (cls && cls.name ? ' style="font-weight:600"' : '') + '>' + name + '</span><span class="num' + (cls && cls.over ? ' over' : '') + '">' + val + '</span>'
        + '<span class="num m3">' + crit + '</span><span class="st' + (cls && cls.t ? ' ' + cls.t + ' tc' : ' m3') + '">' + st + '</span>'
        + '<span class="nt"' + (tip ? ' title="' + tip + '"' : '') + '>' + note + '</span></div>';
    };
    h.push('<div class="card tbl mt"><div class="r hd"><span>지표</span><span style="text-align:right">값</span><span style="text-align:right">기준</span><span>상태</span><span>비고</span></div>');
    if (isoH) {
      h.push(mrow('ISO 판정값', esc(isoTxt), esc((SM.iso.zones[isoH.gradeIdx] || {}).range || '—'), gate ? '판정 보류' : (ISO_ZONE[isoH.gradeIdx] || { k: '-' }).k,
        esc('등급 근거 · 10–1000 Hz ' + (isoH.conv ? 'RMS · 존은 속도 환산' : '속도 RMS') + ' · ' + (isoH.blocks || 1) + '블록 평균' + (isoH.anaSec ? ' · ' + isoH.anaSec + ' s' : '')
          + (gate && sm.bias ? ' · ' + sm.bias : '')),
        { name: 1, t: gate ? '' : tone(isoH.gradeIdx) },
        esc([isoBasis, isoH.spread ? '블록간 변동 ×' + isoH.spread : '', sm.winNote || ''].filter(Boolean).join(' · '))));
    }
    // 등급 없는 기간 지표 — Crest · 광대역 P95 · 변화율 순, 평균 RMS는 광대역 행 비고로
    [[/^Crest/, 'Crest Factor P95'], [/^P95 RMS/, '광대역 RMS P95'], [/^변화율/, '변화율']].forEach(function (row) {
      var c = cardOf(row[0]);
      if (!c) return;
      var cr = /^기준 /.test(c.thr || '') ? String(c.thr).replace(/^기준\s*/, '') : '—';
      var ex = c.noJudge && !c.badgeKo ? null : cmpOf(c);
      var st = c.noJudge && !c.badgeKo ? '판단 안 함' : c.badgeKo || (ex ? '초과' : ex === false ? '이내' : '비교 안 함');
      var t = c.badgeKo ? ((c.note || /초과/.test(c.badgeKo)) ? 't1' : '') : ex ? 't1' : ex === false ? 't0' : '';
      var full = (cr === '—' && c.thr ? c.thr + (c.foot2 ? ' · ' : '') : '') + (c.foot2 || '');
      h.push(mrow(esc(row[1]), esc(c.value) + (c.unit ? ' ' + esc(c.unit) : ''), esc(cr), esc(st), esc(c.brief || full), { over: ex, t: t }, c.brief ? esc(full) : ''));
    });
    h.push('</div>');
    h.push('</section>');

    // 02 추세
    h.push('<section id="trend" class="sec">' + secHead(noOf('trend'), '추세', '시간에 따른 지표 변화 · 휠 확대 · 드래그 이동 · 더블클릭 리셋'));
    var tr = [];
    // 차트 제목·설명은 상세분석 차트와 같은 말
    if (d.rms) tr.push(chartCard({ title: 'RMS 추이', en: 'ISO 10816 존 기준선', desc: '진동 에너지(실효값)의 시간 변화 · ISO 존 기준선 대비 심각도 추적', canvasId: 'cRms', h: 180, tipId: 'tRms' }));
    if (d.p2p) tr.push(chartCard({ title: 'Peak-to-Peak 추이', desc: '최대-최소 진폭의 폭 · 순간 충격·부딪힘의 크기', canvasId: 'cP2p', h: 180, tipId: 'tP2p' }));
    if (d.crest) tr.push(chartCard({ title: 'Crest Factor 추이', right: crestOver ? '<span style="color:var(--k-warn)">P95 기준 초과</span>' : '',
      desc: '피크/RMS 비 · 파형의 뾰족함(충격성 결함 지표)', canvasId: 'cCrest', h: 180, tipId: 'tCrest' }));
    if (d.kurt) tr.push(chartCard({ title: '첨도 추이', en: 'Kurtosis', desc: '파형 뾰족함의 통계 지표 · 3 = 정상(정규분포) · 클수록 충격성 결함', canvasId: 'cKurt', h: 180, tipId: 'tKurt' }));
    if (tr.length) h.push('<div class="cg">' + tr.join('') + '</div>');
    if (d.bands) h.push(chartCard({ title: '결함 대역 에너지 추이', en: 'Band Energy', right: '범례를 누르면 계열을 숨김',
      desc: '주파수 대역별 에너지의 시간 변화 · 결함 대역 상승 = 결함 성장', canvasId: 'cBand', h: 200, toggle: true,
      legend: d.bands.map(function (b) { return { label: b.label, color: b.color, dash: !!b.dash }; }) }));
    if (!tr.length && !d.bands) h.push('<div class="note">추세를 그릴 롤업 데이터 없음</div>');
    h.push('</section>');

    // 03 스펙트럼
    var duTag = (d.dispUnit && d.natUnit && d.dispUnit !== d.natUnit) ? '표시 물리량 ' + d.dispUnit + ' (' + d.natUnit + '에서 변환)' : (d.dispUnit ? '표시 물리량 ' + d.dispUnit : '');
    h.push('<section id="spectrum" class="sec">' + secHead(noOf('spectrum'), '스펙트럼', '주파수 성분 분해 · 결함 주파수와 대조' + (duTag ? ' · ' + duTag : '')));
    if (d.fft) {
      // 근거가 가리킨 결함주파수만 강조 — 부위 이름, 1순위 후보 근거, 근거표 1순위 순으로 약어 탐색
      var hitSrc = [J.site, top && top.why, evid[0] && (evid[0].breakdown || evid[0].why)].join(' ');
      var hitCode = (/\b(BPFO|BPFI|BSF|FTF)\b/.exec(hitSrc) || [])[1] || '';
      var isHit = function (m) { return !!hitCode && String(m.label).indexOf(hitCode) === 0; };
      var mks = (d.fft.markers || []).filter(function (m) { return m.kind !== 'h'; });
      // 기준 주파수 목록(회전 배수·베어링 결함주파수) — 약어 · 뜻 · 주파수, 차트엔 선을 긋지 않음(저주파에 몰려 겹침)
      var MK_KO = { '1×': ['회전', '축 회전 주파수'], '2×': ['회전 2배', '축 회전 2배'], BPFO: ['외륜', '외륜 결함 주파수'], BPFI: ['내륜', '내륜 결함 주파수'],
        BSF: ['전동체', '전동체(볼) 결함 주파수'], FTF: ['케이지', '케이지 주파수'] };
      var kHz = function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz'; };
      var rngOn = d.fft.nyqHz > d.fft.dispHz * 1.05 && d.fft.dispHz > 0;
      // 회전수 기준(실측·명판·종동축 환산) — 기준 주파수 목록이 이 값에서 나옴
      h.push('<div class="card chc">' + chartHead('FFT 주파수 스펙트럼', '', esc([sm.rpmTxt ? '회전수 ' + sm.rpmTxt : '', p.fftHint || ''].filter(Boolean).join(' · ')))
        + '<div class="d">진동을 주파수별 성분으로 분해 · 아래는 이 설비의 기준 주파수(회전 배수 · 베어링 결함) · 테두리 = 근거가 가리킨 성분</div>'
        + (rngOn ? '<div class="rng"><button class="on" data-f="0" onclick="setFftRange(0)">기본 0–' + kHz(d.fft.dispHz) + '</button>'
          + '<button data-f="1" onclick="setFftRange(1)">전대역 0–' + kHz(d.fft.nyqHz) + '</button></div>' : '')
        + '<div class="chart-wrap"><canvas id="cFft" height="240"></canvas><div class="tooltip" id="tFft"></div></div>'
        + (mks.length ? '<div class="mkl">' + mks.map(function (m) {
          var ko = MK_KO[m.label] || ['', ''];
          var hit = isHit(m);
          return '<span' + (hit ? ' class="hit"' : '') + (ko[1] ? ' title="' + esc(ko[1] + (hit ? ' · 근거가 가리킨 성분' : '')) + '"' : '') + '>'
            + '<b>' + esc(m.label) + '</b>' + (ko[0] ? esc(ko[0]) : '') + '<span class="mono">' + m.freq.toFixed(1) + ' Hz</span>' + '</span>';
        }).join('') + '</div>' : '') + '</div>');
    }
    var sp = [];
    if (d.wave) {
      var wt = d.wave.t || [], wSec = wt.length ? (parseFloat(wt[wt.length - 1]) - parseFloat(wt[0])) / 1000 : 0;
      sp.push(chartCard({ title: '원시 파형', en: 'Raw Waveform', right: wSec > 0 ? '<span class="mono">' + wSec.toFixed(1) + ' s</span>' : '',
        desc: '센서가 측정한 순간 진동 값 · 충격·주기성 패턴을 눈으로 확인', canvasId: 'cWave', h: 160, tipId: 'tWave', xlineId: 'xWave' }));
    }
    if (d.spec) sp.push(chartCard({ title: '스펙트로그램', en: 'Spectrogram', desc: '스펙트럼의 시간 변화 · 밝을수록 강한 성분 — 결함 대역이 언제부터 자랐는지 확인', canvasId: 'cSpec', h: 160 }));
    // 복조 대역 — 고정 대역이 안 서는 샘플레이트면 전대역
    if (d.env) sp.push(chartCard({ title: '포락선 분석', en: 'Envelope', right: '<span class="mono">' + (p.envBand ? '복조 ' + esc(p.envBand) : '전대역 복조') + '</span>',
      desc: '충격이 반복되는 주파수를 복조 · 베어링 결함 주파수 자리에 피크가 서면 해당 부위 의심', canvasId: 'cEnv', h: 160 }));
    if (d.kurtogram) {
      var kb = d.kurtogram.best;
      sp.push(chartCard({ title: '대역별 충격성', en: 'Kurtogram', right: kb ? '<span class="mono">peak ' + (kb.loHz / 1000).toFixed(1) + '–' + (kb.hiHz / 1000).toFixed(1) + ' kHz · SK ' + kb.sk.toFixed(1) + '</span>' : '',
        desc: '주파수 대역별 충격성 · 가장 두드러진 대역 표시 · 참고용(복조엔 안 씀)', canvasId: 'cKurtogram', h: 160 }));
    }
    if (sp.length) h.push('<div class="cg">' + sp.join('') + '</div>');
    if (!d.fft && !sp.length) h.push('<div class="note">스펙트럼을 만들 원시 파형 없음</div>');
    h.push('</section>');

    // 04 결함 근거 — 규칙 기반 근거 점수(확률 아님), 가점 내역 공개
    h.push('<section id="evidence" class="sec">' + secHead(noOf('evidence'), '결함 근거', '규칙 기반 근거 점수 0–100 · 확률이 아님'));
    var evScored = evid.filter(function (c) { return !c.na && c.score > 0; });
    // 1순위가 원인 확정 기준 미달 — 등급(결함 패턴)과 별개임을 밝혀 요약 판정문과 엇갈려 읽히지 않게
    if (d.evidWeak) h.push('<div class="note">' + (evScored[0] ? '1순위 ' + evScored[0].score + '점으로 ' : '') + '원인 확정 기준' + (d.evidAdopt ? '(' + d.evidAdopt + '점)' : '')
      + ' 미달 — 등급은 결함 패턴이 정함(이 표는 원인 순위)</div>');
    if (evid.length) {
      h.push('<div class="card tbl et"><div class="r hd"><span>결함 후보</span><span>근거 점수</span><span>근거 내역</span></div>');
      // 가점 내역 — 항목 뒤 가점은 작게, 합계는 점수 칸에 있어 생략
      var gainHtml = function (c) {
        if (c.gains && c.gains.length) return c.gains.map(function (g) { return esc(g.t) + ' <span class="pt">+' + g.p + '</span>'; }).join(' · ');
        return esc(String(c.breakdown || c.why || '').replace(/\s*=\s*\d+$/, ''));
      };
      evScored.forEach(function (c, i) {
        var sc = c.score;
        h.push('<div class="r"><span style="font-weight:600">' + esc(shortName(c.f)) + '</span><div class="sc"><div class="bar' + (i === 0 && sc >= 40 ? ' hot ' + (sc >= 70 ? 't2' : 't1') : '') + '"><i style="width:' + Math.min(100, sc) + '%"></i></div><span class="mono">' + sc + '</span></div>'
          + '<span class="bd">' + gainHtml(c) + '</span></div>');
      });
      // 근거 없음 — 구성상 해당 없는 후보(구름베어링의 오일 휠 등)는 따로 표시
      if (evZero.length) h.push('<div class="r dim"><span>근거 없음 ' + evZero.length + '종</span><span class="mono">0</span><span class="bd">'
        + esc(evZero.map(function (c) { return shortName(c.f) + (/해당 없음/.test(c.caveat || '') ? '(해당 없음)' : ''); }).join(' · ')) + '</span></div>');
      if (evNa.length) h.push('<div class="r dim"><span>측정 불가 ' + evNa.length + '종</span><span class="s12">점수 대상 아님</span><span class="bd">'
        + naGroups(evNa.map(function (c) { return { f: c.f, why: c.caveat }; })).map(esc).join('<br>') + '</span></div>');
      h.push('</div>');
    } else h.push('<div class="note">근거 점수를 계산할 스펙트럼 없음</div>');
    // 반대 증거·미설명·대역 이탈·미입력 정보 — LLM과 무관하게 결정론적으로 인쇄
    var lc = [];
    var lcard = function (t, rows, foot, tip) {
      return '<div class="card chc"><span class="t">' + esc(t) + '</span><div class="lst"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + rows.map(function (r) { return '<span>' + esc(r) + '</span>'; }).join('') + '</div>'
        + (foot ? '<div class="d">' + esc(foot) + '</div>' : '') + '</div>';
    };
    // 미검출은 '무엇 → 뜻' 한 줄(옛 페이로드는 전문), 미설명은 주파수 오름차순(배수는 마우스를 올리면)
    if (_ng.length) lc.push(lcard('미검출 · 반대 증거', (d.negCard && d.negCard.length === _ng.length) ? d.negCard : _ng));
    if (_ux.length) {
      var uxHz = _ux.map(function (s) { return parseFloat(s); }).filter(function (v) { return isFinite(v); }).sort(function (a, b) { return a - b; });
      lc.push(lcard('미설명 성분', [uxHz.length === _ux.length ? uxHz.map(function (v) { return v.toFixed(1); }).join(' · ') + ' Hz' : _ux.join(' · ')],
        '어디서 오는지 확인하면 대부분 해소(' + noOf('advice') + ' 세부 조치)', _ux.join(' · ')));
    }
    if (d.bandDev && d.bandDev.rows && d.bandDev.rows.length) {
      var bdO = d.bandDev.rows.filter(function (r) { return r.over; });
      var bdR = bdO.length ? bdO.map(function (r) { return r.ko + '  ×' + r.r + '  (' + r.v + ' → 한계 ' + r.lim + ')' + (r.soft ? '  ⚠마운팅 상한 초과 — 잠정' : ''); })
        : ['전 ' + d.bandDev.rows.length + '개 대역 정상 — 평소 대비 한계 미만'];
      lc.push(lcard('대역 베이스라인 이탈', bdR, bdO.some(function (r) { return r.soft; })
        ? '잠정 대역은 마운팅' + (d.bandDev.mount ? '(' + d.bandDev.mount + ')' : '') + ' 유효 상한' + (d.bandDev.fmaxKHz ? ' ' + d.bandDev.fmaxKHz + ' kHz' : '')
          + '를 넘은 구간 · 상승은 사실이나 설비 진동인지 센서 부착부 공진인지 구분 불가 — 정비 전 센서 부착 상태 먼저 확인'
        : '학습된 한계(μ+kσ) 대비 비율 · ×1이 판정선'));
    }
    // 미입력 정보 — 설정에서 채울 수 있는 항목(취득 조건은 측정 정보 칸)
    if (d.missing && d.missing.length) lc.push(lcard('미입력 정보와 그 영향', d.missing));
    if (lc.length) h.push('<div class="lcg">' + lc.join('') + '</div>');
    // 이 리포트의 판단 한계 — 근거 절 끝(조치로 읽히지 않게)
    h.push('<div class="disc">단일 채널 · 단일 방향 · 위상 없음 · 불평형·정렬불량·굽음·소프트풋은 원리상 판별 불가 · 측정 불가는 가능성이 낮은 게 아니라 볼 수 없는 것 · 그 외 후보는 가설 · 확정 진단은 정비 담당자 현장 확인 필요</div>');
    h.push('</section>');

    // 05 세부 조치 — 지금 할 일(심각도 절)을 실행하는 방법과 진단을 보완할 일
    h.push('<section id="advice" class="sec">' + secHead(noOf('advice'), '세부 조치', '지금 할 일을 실행하는 방법 · 판정을 보완할 일'));
    h.push((p.actions || []).length ? '<div class="vcol g8">' + advRows(p.actions, gi) + '</div>' : '<div class="note">추가 조치 없음 — 지금 할 일대로 운전</div>');
    h.push('</section>');

    // 06 LLM 소견 — 규칙 기반 판정을 설비 담당자 말로 푼 보조 소견(지금 상태 · 그렇게 보는 이유 · 권장 행동)
    if (OP) {
      h.push('<section id="llm" class="sec">' + secHead(noOf('llm'), 'LLM 소견', '규칙 기반 지표를 해석한 보조 소견 · 판정 근거 아님',
        p.opinionModel ? '<span class="chip">' + ICON.spark + esc(p.opinionModel) + '</span>' : ''));
      if (OP.key) h.push('<div class="llm-key"><div style="display:flex;align-items:center;gap:8px"><span class="s12 m3" style="font-weight:600">핵심 요약</span>' + (tentative ? '<span class="tent">잠정 판정</span>' : '') + '</div><div class="x">' + md(OP.key) + '</div></div>');
      h.push('<div class="card">');
      OP.secs.forEach(function (s) {
        h.push('<div class="op"><span class="lb">' + esc(s.label) + '</span><div class="its">' + s.items.map(function (it) {
          return '<div class="it"><span>' + md(it.fact) + '</span>' + (it.concl ? '<span class="cc">' + ICON.arrow + '<span>' + md(it.concl) + '</span></span>' : '') + '</div>';
        }).join('') + '</div></div>');
      });
      h.push('</div></section>');
    }
    h.push('</div></div>'); // .secs · #full

    // 측정 정보 — 두 리포트 차이가 데이터 때문인지 엔진 때문인지 구분(지문은 판정 임계에서 계산)
    if (p.build) {
      var mcells = (p.build.cells || []).filter(function (c) { return c.v; });
      /* 같은 신호의 물리량별 광대역 RMS(분석 창) — 센서 원본 단위가 값, 나머지는 보조 줄
         단위가 달라 크기 비교 대상 아님 · 가속도는 에일리어싱 의심이면 게재 보류 */
      if (d.levels) {
        var fmtL = function (v) { return (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)); };
        var natU = d.natUnit || d.isoUnit;
        var lvs = ['mm/s', 'g', 'μm'].filter(function (u) { return d.levels[u] != null; }).map(function (u) {
          return { u: u, t: u === 'g' && d.levelsOk === false ? 'g 게재 보류' : fmtL(d.levels[u]) + ' ' + u };
        });
        lvs.sort(function (a, b) { return (b.u === natU) - (a.u === natU); });
        if (lvs.length) {
          var lvCell = { k: 'Broadband RMS', v: lvs[0].t, subs: lvs.slice(1).map(function (x) { return x.t; }) };
          var acqAt = -1;
          mcells.forEach(function (c, i) { if (c.k === 'Acquisition') acqAt = i; });
          mcells.splice(acqAt >= 0 ? acqAt + 1 : mcells.length, 0, lvCell);
        }
      }
      // 20자 넘는 줄만 .wr(인쇄 한 줄 배치에서 꺾여도 되는 줄)
      var mspan = function (cls, x) { x = String(x); return '<span class="' + cls + (x.length > 20 ? ' wr' : '') + '">' + esc(x) + '</span>'; };
      h.push('<footer id="meta" class="meta">' + mcells.map(function (c) {
        return '<div><span class="k">' + esc(c.k) + '</span>' + mspan('v', c.v) + (c.subs || []).map(function (x) { return mspan('s', x); }).join('') + '</div>';
      }).join('') + '</footer>');
    }
    h.push('</div>');

    // ── 차트 엔진 + 데이터 + 부트 (자립 렌더) ──
    h.push('<script>' + String(p.chartLibSrc || '') + '<\/script>');
    h.push('<script>window.RPT = ' + JSON.stringify(d).replace(/</g, '\\u003c') + ';<\/script>');
    h.push('<script>' + BOOT + '<\/script>');
    h.push('</body></html>');
    return h.join('\n');
  }

  return { esc: esc, buildReportHTML: buildReportHTML, sevModel: sevModel, isoPinPct: isoPinPct, sevTitle: sevTitle, evidLevel: evidLevel };
});
