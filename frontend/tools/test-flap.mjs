/* 반복 악화 감지 — 최근 2시간 임계 초과 이벤트 3회 이상이면 카드에 "등급 반복 N회" 배지
   · 감지는 DB 이벤트 별도 조회(화면 목록 무관), 1분 간격, 카탈로그 틱에서 호출(앱·서버 모드 공통)
   · 배지 클릭 = 마지막 악화 시점 상세분석 열기(설정 변경 없음)
   오프라인(Neo 불필요) · npm run smoke 포함 */
import fs from 'node:fs';

globalThis.window = globalThis;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const MIN = 60000;

function mkApp() {
  const app = new App({ defaultTab: 'monitor', defaultTheme: 'dark', seed: 42, equipmentCount: 6 });
  app.setState = function (s) { Object.assign(this.state, s); };
  app._scheduleDraw = function () {};
  app.forceUpdate = function () {};
  app.E = CH; app.live = true;
  const d = Mock.generateData(42, 6);
  d.equipment.forEach((e) => { e.fs = 25600; });
  app.data = d;
  Object.assign(app.state, { ready: true, srcSel: [...new Set(d.equipment.map((e) => e.table))], events: [] });
  return app;
}

// 감지 — DB 행 모양(etype·tbl·tag·ts)으로 들어온 최근 이벤트
{
  const app = mkApp();
  const now = Date.now();
  const calls = [];
  const rows = [
    { etype: 'threshold', tbl: 'T', tag: 'A', ts: now - 90 * MIN },
    { etype: 'threshold', tbl: 'T', tag: 'A', ts: now - 60 * MIN },
    { etype: 'threshold', tbl: 'T', tag: 'A', ts: now - 30 * MIN },
    { etype: 'observe', tbl: 'T', tag: 'A', ts: now - 20 * MIN },
    { etype: 'threshold', tbl: 'T', tag: 'B', ts: now - 50 * MIN },
    { etype: 'threshold', tbl: 'T', tag: 'B', ts: now - 10 * MIN },
    { etype: 'threshold', tbl: 'T', tag: 'C', ts: now - 200 * MIN },
    { etype: 'threshold', tbl: 'T', tag: 'C', ts: now - 190 * MIN },
    { etype: 'threshold', tbl: 'T', tag: 'C', ts: now - 5 * MIN },
  ];
  app._recentEvents = (from, to, cap) => { calls.push({ from, to, cap }); return Promise.resolve(rows); };
  await app._refreshFlap();
  const f = app._flap || {};
  chk(Object.keys(f).join() === 'T:A', '임계 초과 3회 이상인 태그만 — 관찰 이벤트·2회·2시간 밖은 제외', Object.keys(f).join());
  chk(f['T:A'] && f['T:A'].round === 3 && f['T:A'].periodMs === 30 * MIN && f['T:A'].lastMs === now - 30 * MIN,
    '반복 횟수·주기·마지막 악화 시각', JSON.stringify(f['T:A']));
  chk(calls.length === 1 && Math.abs(calls[0].from - (now - 120 * MIN)) < 5000 && calls[0].cap >= 1000,
    '최근 2시간을 따로 조회(화면 목록의 기간·200건 제한과 무관)', JSON.stringify(calls[0]));

  await app._refreshFlap();
  chk(calls.length === 1, '1분 안의 재호출은 조회하지 않음');
  app._flapAt = Date.now() - 61000;
  await app._refreshFlap();
  chk(calls.length === 2, '1분 지나면 다시 조회');

  app.live = false; app._flapAt = 0;
  await app._refreshFlap();
  chk(calls.length === 2, '라이브가 아니면 조회 안 함');
}

// 카드 배지 — 문구와 클릭 동작
{
  const app = mkApp();
  const eq = app.data.equipment[0];
  const T = Date.now() - 10 * MIN;
  app._flap = { [eq.table + ':' + eq.name]: { round: 4, periodMs: 20 * MIN, lastMs: T } };
  let goto = null, applied = 0;
  app._gotoDetail = (id, at) => { goto = { id, at }; };
  app._applyNow = () => { applied++; return Promise.resolve(true); };
  const ev0 = app.state.evalWindow;
  const card = (app.renderVals().cards || []).find((c) => c.flap);
  chk(card && card.flap.text === '등급 반복 4회', '배지 문구', card && card.flap.text);
  const tip = card ? card.flap.tip : '';
  chk(/약 20분 주기/.test(tip) && /결함 근거/.test(tip) && /상세분석/.test(tip) && !/RMS 구간/.test(tip),
    '툴팁 — 결함 근거가 기준선 근처에서 오가는 상태·상세분석 안내, RMS 구간 처방 없음');
  let stopped = false;
  if (card) card.flap.onOpen({ stopPropagation() { stopped = true; } });
  chk(goto && goto.id === eq.id && goto.at === T && stopped, '클릭 — 마지막 악화 시점 상세분석 열기', JSON.stringify(goto));
  chk(applied === 0 && app.state.evalWindow === ev0 && typeof app._applyFlapFix === 'undefined', '클릭해도 설정을 바꾸지 않음');
}

// 호출 위치 — 판정 루프(앱 모드 전용)가 아니라 카탈로그 틱(두 모드)
{
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const cat = /_catalogTick\(\) \{[\s\S]*?\n  \}/.exec(src);
  const judge = /_judgeLive\(\) \{[\s\S]*?\n  \}/.exec(src);
  chk(cat && /this\._refreshFlap\(\)/.test(cat[0]), '카탈로그 틱에서 감지 — 서버 모드에서도 동작');
  chk(judge && !/_refreshFlap/.test(judge[0]), '판정 루프에서는 부르지 않음');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
