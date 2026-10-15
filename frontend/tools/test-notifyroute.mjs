/* 알림 라우팅과 묶음 발송 — 오프라인(Neo 불필요) · npm run smoke 포함
 * · 감시 이상(두절·계측)은 등급 라우팅과 별개 스위치, 복귀는 등급 행 없어도 발송, 조짐(observe) 미발송
 * · 같은 회차 다발 이벤트는 유형별 묶음(채널 한도 대응), 기본 라우팅 '주의'·'감시 이상' 즉시
 * · 서버 임베드 소스가 평가·호출까지 동작(모듈 스코프 상수 미참조)
 */
import Notify from '../../cgi-bin/notify/notify.js';

let pass = 0, fail = 0;
const chk = (ok, msg, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (got ? ' — ' + got : '')); ok ? pass++ : fail++; };

const CFG = (routes) => ({ channels: { webhook: { on: true, to: 'https://hooks.slack.com/services/x' } }, routes: routes });
const OFF_ALL = { '주의': { timing: '알림 안 함' }, '위험': { timing: '알림 안 함' }, '심각': { timing: '알림 안 함' } };

// ── 감시 건강은 등급 라우팅과 무관 ─────────────────────────────────
{
  // 등급 셋을 전부 꺼도 '감시 이상'이 켜져 있으면 두절·계측 발송
  const cfg = CFG(Object.assign({}, OFF_ALL, { '감시 이상': { timing: '즉시' } }));
  ['signal_lost', 'sensor_fault', 'sensor_ok'].forEach((et) => {
    chk(Notify.shouldNotify('주의', et, 'webhook', cfg), `${et}는 등급 라우팅이 다 꺼져도 발송된다`);
  });
  chk(!Notify.shouldNotify('주의', 'threshold', 'webhook', cfg), '설비 등급은 그대로 등급 라우팅을 탄다');
}
{
  // 반대로 '감시 이상'을 끄면 등급이 다 켜져 있어도 미발송 — 자기 스위치로 분리
  const cfg = CFG({ '주의': { timing: '즉시' }, '위험': { timing: '즉시' }, '심각': { timing: '즉시' }, '감시 이상': { timing: '알림 안 함' } });
  chk(!Notify.shouldNotify('주의', 'signal_lost', 'webhook', cfg), '감시 이상을 끄면 두절은 안 나간다');
  chk(Notify.shouldNotify('주의', 'threshold', 'webhook', cfg), '그래도 설비 등급은 나간다');
}
// 복귀 통지는 등급 '양호'라 표에 행 없음 — 예외 처리로 해제 통지 누락 방지
{
  const cfg = CFG({ '위험': { timing: '즉시' } });
  chk(Notify.shouldNotify('양호', 'recovery', 'webhook', cfg), '정상 복귀는 등급 행이 없어도 발송된다');
}

/* 조짐(observe)은 확정 전이라 미발송 — 뚫리면 2회차 확정 규칙이 알림 건수를 못 줄임
   shouldNotify·planNotifications 양쪽 확인(거르기가 뚫려도 묶기에서 살아나면 안 됨) */
{
  const cfg = CFG({ '주의': { timing: '즉시' }, '위험': { timing: '즉시' }, '심각': { timing: '즉시' } });
  ['주의', '위험', '심각'].forEach((g) => {
    chk(!Notify.shouldNotify(g, 'observe', 'webhook', cfg), `조짐(${g})은 웹훅으로 안 나간다`);
  });
  chk(Notify.shouldNotify('주의', 'threshold', 'webhook', cfg), '확정은 나간다 — 막는 것은 조짐뿐이다');
  const evs = [
    { etype: 'observe', typeKo: '관찰', gradeKo: '주의', table: 'T', tag: 'a', alias: 'a' },
    { etype: 'threshold', typeKo: '임계 초과', gradeKo: '주의', table: 'T', tag: 'b', alias: 'b' },
  ];
  const msgs = Notify.planNotifications(evs, cfg, 'webhook', '-');
  chk(msgs.length === 1 && /임계 초과/.test(msgs[0].subject), '같은 회차에 조짐과 확정이 섞이면 확정만 발송',
    msgs.map((m) => m.subject).join(' / ') || '0건');
}

// ── 묶음 — 빈도 아닌 동시성 억제 ────────────────────────────────
const lost = (n, tbl) => Array.from({ length: n }, (_, i) => ({
  etype: 'signal_lost', typeKo: '신호 두절', gradeKo: '주의', detail: '6분 무수신',
  table: tbl, tag: 't' + i, alias: 't' + i,
}));
const ON = CFG({ '주의': { timing: '즉시' }, '감시 이상': { timing: '즉시' } });

{
  const msgs = Notify.planNotifications(lost(3, 'VIBE_PU'), ON, 'webhook', '2026-08-28 12:07');
  chk(msgs.length === 3, `${Notify.BUNDLE_MIN}건 미만은 개별 발송 — 태그·사유가 보이는 게 낫다`, msgs.length + '건');
}
{
  const evs = lost(38, 'VIBE_PU').concat(lost(25, 'VIBE_LOAD'), lost(16, 'NASA_BEARING'), lost(12, 'VIBE_XJTU'));
  const msgs = Notify.planNotifications(evs, ON, 'webhook', '2026-08-28 12:07');
  chk(msgs.length === 1, '91건은 묶음 1건 — 채널 한도(Slack 초당 1건)를 넘지 않는다', msgs.length + '건');
  const t = msgs[0].text;
  chk(/신호 두절 91대/.test(t), '규모(91대)를 먼저 적는다', t.split('\n')[0]);
  chk(/VIBE_PU 38/.test(t) && /VIBE_LOAD 25/.test(t), '분포를 많은 순으로 적는다');
  chk(/외 12/.test(t), '상위 3개 밖은 "외 N"으로 접는다 — 다 나열하면 잘려서 규모를 오독한다');
  chk(/6분 무수신/.test(t), '같은 유형이라 사유는 하나로 충분하다');
}
{
  // 유형이 섞이면 유형별 묶음 — "두절"과 "계측 이상"은 조치가 다름
  const evs = lost(20, 'A').concat(Array.from({ length: 7 }, (_, i) => ({
    etype: 'sensor_fault', typeKo: '계측 이상', gradeKo: '위험', detail: '플랫라인', table: 'B', tag: 's' + i, alias: 's' + i,
  })));
  const msgs = Notify.planNotifications(evs, ON, 'webhook', '-');
  chk(msgs.length === 2, '유형이 섞이면 유형별 묶음', msgs.length + '건');
  chk(msgs.some((m) => /신호 두절 20대/.test(m.text)) && msgs.some((m) => /계측 이상 7대/.test(m.text)), '각 유형의 규모가 따로 나온다');
}
{
  // 라우팅에 걸린 것은 묶음에서도 제외 — 거르기가 묶기보다 먼저
  const cfg = CFG(Object.assign({}, OFF_ALL, { '감시 이상': { timing: '알림 안 함' } }));
  chk(Notify.planNotifications(lost(50, 'A'), cfg, 'webhook', '-').length === 0, '꺼진 유형은 묶음도 안 만든다');
}

// ── 기본 라우팅 — 게이트 구조에서 '주의' = 결함 검출 ─────────────────
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const m = /var ROUTE_DEFAULT_TIMING = \{([^}]*)\}/.exec(src);
  chk(!!m, '기본 라우팅 표가 있다');
  chk(/'주의':\s*'즉시'/.test(m[1]), "기본값 '주의'가 즉시 — 끄면 검출의 99.8%가 묻힌다(실측 1336/1339)");
  chk(/'감시 이상':\s*'즉시'/.test(m[1]), "기본값 '감시 이상'이 즉시");
  // notify.js HEALTH_KEY와 앱 행 이름 불일치 시 에러 없이 미발송(서버 임베드)
  const nsrc = (await import('node:fs')).readFileSync(new URL('../../cgi-bin/notify/notify.js', import.meta.url), 'utf8');
  const hk = /var HEALTH_KEY = '([^']+)'/.exec(nsrc);
  chk(!!hk && new RegExp("var HEALTH_ROUTE = '" + hk[1] + "'").test(src), '앱의 행 이름과 notify의 HEALTH_KEY가 같다', hk ? hk[1] : '(없음)');
  // "전부 알림 안 함" 경고는 등급 행만 확인 — 감시 이상(기본 즉시)까지 세면 영영 안 뜸
  chk(/routeNoneWarn[^\n]*GRADE_ROUTES/.test(src), '전부 꺼짐 경고는 등급 행만 본다');
}

// ── 서버 임베드 — toString은 모듈 스코프 미포함 ──────────────────
/* 서버 타이머에서만 나는 ReferenceError 함정 — 임베드 소스를 평가해 호출까지 해야 잡힘(이름 존재 검사로는 불가) */
{
  const src = Notify.serverSrc();
  let api = null, err = '';
  try { api = new Function(src + '; return { pn: planNotifications, sn: shouldNotify, bm: bundleMessage };')(); }
  catch (e) { err = e.message; }
  chk(!!api, '임베드 소스가 평가된다', err);
  if (api) {
    const cfg = CFG({ '감시 이상': { timing: '즉시' } });
    let out = null;
    try { out = api.pn(lost(9, 'T'), cfg, 'webhook', '-'); } catch (e) { err = e.message; }
    chk(!!out, '서버에서 planNotifications가 실행된다 — 바깥 상수를 참조하면 여기서 터진다', err);
    chk(out && out.length === 1 && /신호 두절 9대/.test(out[0].text), '서버 묶음 결과가 앱과 같다');
    chk(api.sn('주의', 'signal_lost', 'webhook', cfg) === true, '서버 shouldNotify도 감시 이상을 안다');
    // 조짐 차단이 임베드본에도 있어야 서버 타이머 미발송(실사용 모드가 서버)
    chk(api.sn('주의', 'observe', 'webhook', CFG({ '주의': { timing: '즉시' } })) === false,
      '서버 shouldNotify도 조짐을 막는다');
  }
  // 함수 안 상수와 내보낸 사본 불일치 시 앱·서버 묶음 임계가 갈림
  const inner = /var BUNDLE_MIN = (\d+);/.exec(src);
  chk(!!inner && Number(inner[1]) === Notify.BUNDLE_MIN, 'BUNDLE_MIN 사본이 함수 안 값과 같다',
    inner ? inner[1] + ' vs ' + Notify.BUNDLE_MIN : '(없음)');
}

console.log(`\nnotify route: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
