/* 알림 라우팅과 묶음 발송.
 *
 * 실측이 만든 테스트다:
 *   · 이력 signal_lost 271건 · sensor_fault 4건 → 웹훅 발송 **0건**
 *     (두절의 gi=1이 '주의' 라우팅을 타고 기본값 '알림 안 함'에 걸렸다. 감시가 눈을 감아도 아무도 몰랐다)
 *   · threshold 1339건 중 1336건이 '주의' — 게이트 구조에서 주의는 "결함 패턴이 잡혔다"는 뜻이다
 *   · 09:27에 91건 · 12:07에 60건이 **같은 분에** 났다 — 하나씩 보내면 채널 한도에 걸려 일부만 도착한다
 */
import Notify from '../../cgi-bin/notify/notify.js';

let pass = 0, fail = 0;
const chk = (ok, msg, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (got ? ' — ' + got : '')); ok ? pass++ : fail++; };

const CFG = (routes) => ({ channels: { webhook: { on: true, to: 'https://hooks.slack.com/services/x' } }, routes: routes });
const OFF_ALL = { '주의': { timing: '알림 안 함' }, '위험': { timing: '알림 안 함' }, '심각': { timing: '알림 안 함' } };

// ── 감시 건강은 등급 라우팅과 무관하다 ─────────────────────────────────
{
  // 등급 셋을 전부 꺼도, '감시 이상'이 켜져 있으면 두절·계측은 나가야 한다
  const cfg = CFG(Object.assign({}, OFF_ALL, { '감시 이상': { timing: '즉시' } }));
  ['signal_lost', 'sensor_fault', 'sensor_ok'].forEach((et) => {
    chk(Notify.shouldNotify('주의', et, 'webhook', cfg), `${et}는 등급 라우팅이 다 꺼져도 발송된다`);
  });
  chk(!Notify.shouldNotify('주의', 'threshold', 'webhook', cfg), '설비 등급은 그대로 등급 라우팅을 탄다');
}
{
  // 반대로 '감시 이상'을 끄면 등급이 다 켜져 있어도 안 나가야 한다 — 자기 스위치로 완전히 갈렸는가
  const cfg = CFG({ '주의': { timing: '즉시' }, '위험': { timing: '즉시' }, '심각': { timing: '즉시' }, '감시 이상': { timing: '알림 안 함' } });
  chk(!Notify.shouldNotify('주의', 'signal_lost', 'webhook', cfg), '감시 이상을 끄면 두절은 안 나간다');
  chk(Notify.shouldNotify('주의', 'threshold', 'webhook', cfg), '그래도 설비 등급은 나간다');
}
// 복귀 통지는 등급이 '양호'라 표에 행이 없다 — 예외가 살아 있어야 이탈만 알리고 해제는 영영 안 가는 일이 없다
{
  const cfg = CFG({ '위험': { timing: '즉시' } });
  chk(Notify.shouldNotify('양호', 'recovery', 'webhook', cfg), '정상 복귀는 등급 행이 없어도 발송된다');
}

/* 조짐(observe)은 확정 전이라 발송하지 않는다.
   이게 뚫리면 2회차 확정 규칙이 알림 건수를 못 줄인다 — 라벨만 '관찰'로 바뀔 뿐이다.
   shouldNotify와 planNotifications 양쪽을 본다: 거르기가 뚫려도 묶기에서 살아나면 안 된다. */
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

// ── 묶음 — 빈도가 아니라 동시성을 막는다 ────────────────────────────────
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
  // 유형이 섞이면 유형별로 갈라 묶는다 — "두절 91대"와 "계측 이상 7대"는 조치가 다르다
  const evs = lost(20, 'A').concat(Array.from({ length: 7 }, (_, i) => ({
    etype: 'sensor_fault', typeKo: '계측 이상', gradeKo: '위험', detail: '플랫라인', table: 'B', tag: 's' + i, alias: 's' + i,
  })));
  const msgs = Notify.planNotifications(evs, ON, 'webhook', '-');
  chk(msgs.length === 2, '유형이 섞이면 유형별 묶음', msgs.length + '건');
  chk(msgs.some((m) => /신호 두절 20대/.test(m.text)) && msgs.some((m) => /계측 이상 7대/.test(m.text)), '각 유형의 규모가 따로 나온다');
}
{
  // 라우팅에 걸린 것은 묶음에도 안 들어간다 — 거르기가 묶기보다 먼저다
  const cfg = CFG(Object.assign({}, OFF_ALL, { '감시 이상': { timing: '알림 안 함' } }));
  chk(Notify.planNotifications(lost(50, 'A'), cfg, 'webhook', '-').length === 0, '꺼진 유형은 묶음도 안 만든다');
}

// ── 기본 라우팅 — 게이트 구조에서 '주의'는 결함 검출이다 ─────────────────
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const m = /var ROUTE_DEFAULT_TIMING = \{([^}]*)\}/.exec(src);
  chk(!!m, '기본 라우팅 표가 있다');
  chk(/'주의':\s*'즉시'/.test(m[1]), "기본값 '주의'가 즉시 — 끄면 검출의 99.8%가 묻힌다(실측 1336/1339)");
  chk(/'감시 이상':\s*'즉시'/.test(m[1]), "기본값 '감시 이상'이 즉시");
  // notify.js의 HEALTH_KEY와 앱의 행 이름이 어긋나면 조용히 아무것도 안 나간다(서버 임베드라 에러도 안 뜬다)
  const nsrc = (await import('node:fs')).readFileSync(new URL('../../cgi-bin/notify/notify.js', import.meta.url), 'utf8');
  const hk = /var HEALTH_KEY = '([^']+)'/.exec(nsrc);
  chk(!!hk && new RegExp("var HEALTH_ROUTE = '" + hk[1] + "'").test(src), '앱의 행 이름과 notify의 HEALTH_KEY가 같다', hk ? hk[1] : '(없음)');
  // "전부 알림 안 함" 경고는 등급 행만 봐야 한다 — 감시 이상이 기본 즉시라 함께 세면 영영 안 뜬다
  chk(/routeNoneWarn[^\n]*GRADE_ROUTES/.test(src), '전부 꺼짐 경고는 등급 행만 본다');
}

// ── 서버 임베드 — toString은 모듈 스코프를 안 가져간다 ──────────────────
/* 앱은 멀쩡한데 서버 타이머에서만 ReferenceError가 나는 함정이다(BUNDLE_MIN이 실제로 그랬다).
   임베드 소스를 그대로 평가해 **호출까지** 해 봐야 잡힌다 — 이름이 들어 있는지만 봐서는 못 잡는다. */
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
    // 조짐 차단이 임베드본에 안 실리면 앱은 조용한데 서버 타이머만 계속 쏜다(실사용 모드가 서버다)
    chk(api.sn('주의', 'observe', 'webhook', CFG({ '주의': { timing: '즉시' } })) === false,
      '서버 shouldNotify도 조짐을 막는다');
  }
  // 함수 안 상수와 밖으로 내보낸 사본이 어긋나면 앱과 서버가 다른 임계로 묶는다
  const inner = /var BUNDLE_MIN = (\d+);/.exec(src);
  chk(!!inner && Number(inner[1]) === Notify.BUNDLE_MIN, 'BUNDLE_MIN 사본이 함수 안 값과 같다',
    inner ? inner[1] + ' vs ' + Notify.BUNDLE_MIN : '(없음)');
}

console.log(`\nnotify route: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
