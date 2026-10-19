/* ROLLUP 없는 TAG table 안내 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 사전 확인: 없는 태그로 조회해 롤업 유무 판정(스캔 없음), 다른 오류는 판정 보류
   · 상세분석: 원본 집계면 최근 2시간 창으로 줄이고 단위도 그 창 기준으로 선정, 사양 칸 아래 안내
   · 설정: 데이터 소스 목록 배지·설명, 서버 감시 모드에서 제외 table 경고 */
globalThis.window = globalThis;
import renderToString from 'preact-render-to-string';

// 롤업 없는 table(HI*)은 ROLLUP 조회에 ERR-2685, ERR_TBL은 다른 오류
const sqls = [];
globalThis.fetch = async (url) => {
  const sql = decodeURIComponent((String(url).match(/q=([^&]*)/) || [])[1] || '');
  sqls.push(sql);
  const json = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
  if (/from HI\w*/.test(sql) && /ROLLUP\(/.test(sql)) return json({ success: false, reason: 'MACHCLI-ERR-2685, There are no applicable ROLLUP tables.' });
  if (/from ERR_TBL/.test(sql)) return json({ success: false, reason: 'MACHCLI-ERR-2025, Table ERR_TBL does not exist.' });
  if (/V\$HI\w*_STAT/.test(sql)) return json({ success: true, data: { rows: [['t1', 1000, Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 13, 9)]] } });
  return json({ success: true, data: { rows: [] } });
};

const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const DB = (await import('../../cgi-bin/db/db.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};
const H = 3600000;

// ── 사전 확인 ──────────────────────────────────────────────────────────────
{
  sqls.length = 0;
  chk(await DB.probeRollup('HI') === false, '롤업 없는 table은 없음으로 판정');
  chk(DB.isNoRollup('HI'), '판정 결과를 폴백 기억에도 넣는다 — 이후 조회가 실패를 한 번 더 겪지 않게');
  chk(/NAME='__rollup_probe__'/.test(sqls[0]), '없는 태그로 조회 — 데이터 스캔 없이 판정', sqls[0].slice(0, 80));
  chk(await DB.probeRollup('BEARING') === true && !DB.isNoRollup('BEARING'), '롤업 있는 table은 있음');
  const n = sqls.length;
  await DB.probeRollup('HI'); await DB.probeRollup('BEARING');
  chk(sqls.length === n, '판정은 기억 — 다시 조회하지 않는다');
  chk(await DB.probeRollup('ERR_TBL') === null && !DB.isNoRollup('ERR_TBL'), '다른 오류는 판정 보류(롤업 없음으로 단정 안 함)');
  const m = sqls.length;
  await DB.probeRollup('ERR_TBL');
  chk(sqls.length === m + 1, '보류된 table은 다음에 다시 확인');
}

// ── 확인 범위 ──────────────────────────────────────────────────────────────
{
  const { App: A0 } = await import('../src/app.js');
  const a = new A0({ seed: 1, equipmentCount: 1 });
  a.forceUpdate = () => {};
  a.liveTables = ['HI3', 'HI4', 'BAD'];
  a.liveSchemas = { HI3: ['NAME', 'TIME', 'VALUE'], HI4: ['NAME', 'TIME', 'VALUE'], BAD: ['DEVICE_ID', 'TS', 'READING'] };
  sqls.length = 0;
  await a._loadRollups(['HI3']);
  chk(sqls.length === 1 && /from HI3 /.test(sqls[0]), '목록을 주면 그 table만 확인 — 부팅은 선택 table만', sqls.map((x) => x.match(/from (\w+)/)[1]).join(','));
  sqls.length = 0;
  await a._loadRollups();
  const tbls = sqls.map((x) => (x.match(/from (\w+)/) || [])[1]);
  chk(tbls.indexOf('HI4') >= 0 && tbls.indexOf('BAD') < 0 && tbls.indexOf('HI3') < 0,
    '전체 확인은 컬럼 미지원 table을 빼고, 이미 판정한 table은 다시 묻지 않는다', tbls.join(','));
}

const NOW = Date.UTC(2026, 7, 13, 9, 0, 0);
const mk = (tab, st) => {
  const a = new App({ defaultTab: tab, seed: 42, equipmentCount: 3 });
  a.setState = function (s) { Object.assign(this.state, s); };
  a._scheduleDraw = () => {}; a._toast = () => {}; a._ensureTags = () => {};
  a.E = CH; a.live = true; a.forceUpdate = () => {};
  return a;
};

// ── 조회 창 ────────────────────────────────────────────────────────────────
{
  const a = mk('detail');
  Object.assign(a.state, { period: '7d' });
  const st = { minMs: NOW - 30 * 24 * H, maxMs: NOW };
  const w0 = a._rollWindow(NOW, st, 'detail');
  chk(w0.unit === 'hour' && !w0.raw && !/원본/.test(w0.label), '롤업 있으면 7일은 시간 단위 그대로', w0.label);
  const w = a._rollWindow(NOW, st, 'detail', true);
  chk(w.toMs - w.fromMs === 2 * H && w.capped, '원본 집계면 최근 2시간으로 줄인다', (w.toMs - w.fromMs) / H + 'h');
  chk(w.unit === 'sec', '단위는 줄인 창 기준 — 시간 단위로 2시간이면 점 두세 개뿐', w.unit);
  chk(/원본 집계/.test(w.label), '단위 표기에 원본 집계를 붙인다', w.label);
  Object.assign(a.state, { period: '1h' });
  const w1 = a._rollWindow(NOW, st, 'detail', true);
  chk(w1.raw && !w1.capped, '2시간 이내 기간은 줄이지 않는다');
}
// 첫 조회에서 롤업 없음이 드러난 경우 — 줄인 창으로 다시 조회
{
  const a = mk('detail');
  Object.assign(a.state, { period: '7d' });
  a.data = { now: NOW, equipment: [], events: [], reports: [] };
  sqls.length = 0;
  const rf = await a._rollForAsync({ id: 'HI2:t1', table: 'HI2', name: 't1', lastSeen: NOW }, 'detail');
  const trunc = sqls.filter((s) => /DATE_TRUNC/.test(s));
  chk(rf.raw && rf.capped && /원본 집계/.test(rf.label), '결과에 원본 집계·축소 여부가 실린다', rf.label);
  chk(trunc.length >= 1 && /DATE_TRUNC\('sec'/.test(trunc[trunc.length - 1]), '재조회는 초 단위', (trunc[trunc.length - 1] || '').slice(0, 40));
  chk(rf.toMs - rf.fromMs === 2 * H, '표시 구간도 줄인 창', (rf.toMs - rf.fromMs) / H + 'h');
}

// ── 상세분석 안내 ──────────────────────────────────────────────────────────
const mkDetail = (rf) => {
  const a = mk('detail');
  const d = Mock.generateData(42, 3);
  d.equipment.forEach((e) => { e.fs = 25600; });
  a.data = d;
  a.liveTables = ['VIBRATION_RAW'];
  const eq = d.equipment[0];
  Object.assign(a.state, { ready: true, tab: 'detail', period: '7d', srcSel: a.liveTables.slice(), selTag: eq.id, events: [], reports: [] });
  a._detailCache[eq.id] = {
    state: 'ready', det: Mock.buildDetail(eq), key: a._detailKey(), anchor: a._detailAnchorMs(eq),
    viewUnit: a.state.viewUnit || null, gate: null, eqSnap: Object.assign({}, eq), snapNow: d.now,
  };
  a._rfCache = {};
  a._rfCache[eq.id + '|7d|'] = Object.assign({ roll: [], stepSec: 1, clock: true, state: 'ready', fromMs: d.now - 2 * H, toMs: d.now }, rf);
  return a;
};
{
  const v = mkDetail({ label: '초별 (1s) · 원본 집계', raw: true, capped: true }).renderVals();
  chk(/최근 2시간만/.test(v.rollupNote) && /ROLLUP을 만들면/.test(v.rollupNote), '줄였으면 줄였다고, 푸는 방법까지 적는다', v.rollupNote);
  const html = renderToString(view(v));
  chk(html.indexOf('최근 2시간만 표시합니다') >= 0, '사양 칸 아래에 렌더된다');
  chk(html.indexOf('초별 (1s) · 원본 집계') >= 0, '롤업 단위 칸에 원본 집계 표기');
  const v2 = mkDetail({ label: '초별 (1s) · 원본 집계', raw: true, capped: false }).renderVals();
  chk(/2시간보다 긴 기간/.test(v2.rollupNote), '안 줄였으면 긴 기간의 동작만 알린다', v2.rollupNote);
  const v3 = mkDetail({ label: '시간별 (1h)', raw: false, capped: false }).renderVals();
  chk(v3.rollupNote === '' && renderToString(view(v3)).indexOf('ROLLUP이 없는') < 0, '롤업 있는 table에는 안내 없음');
}

// ── 설정 — 데이터 소스·알람 ───────────────────────────────────────────────
const mkSet = (sec, sel, mode) => {
  const a = mk('settings');
  a.data = { now: NOW, equipment: [], events: [], reports: [] };
  a.liveTables = ['BEARING', 'HI'];
  a.liveSchemas = { BEARING: ['NAME', 'TIME', 'VALUE'], HI: ['NAME', 'TIME', 'VALUE'] };
  Object.assign(a.state, { ready: true, tab: 'settings', setSection: sec, srcSel: sel, monMode: mode || 'app' });
  return a;
};
{
  const v = mkSet('source', ['BEARING', 'HI']).renderVals();
  const t = (n) => v.srcTables.find((x) => x.name === n);
  chk(t('HI').noRollup && !t('BEARING').noRollup, '롤업 없는 table만 표시', JSON.stringify(v.srcTables.map((x) => [x.name, x.noRollup])));
  chk(!t('HI').blocked, '막지는 않는다 — 원본 집계로 동작은 한다');
  chk(/HI/.test(v.srcNoRollNote) && /서버 감시/.test(v.srcNoRollNote) && /2시간/.test(v.srcNoRollNote), '선택했으면 무엇이 제한되는지 적는다', v.srcNoRollNote);
  const html = renderToString(view(v));
  chk(html.indexOf('ROLLUP 없음') >= 0 && html.indexOf(v.srcNoRollNote) >= 0, '목록 배지·설명이 렌더된다');
  const v2 = mkSet('source', ['BEARING']).renderVals();
  chk(v2.srcNoRollNote === '', '선택 안 했으면 설명은 없다(배지는 남음)');
  chk(renderToString(view(v2)).indexOf('ROLLUP 없음') >= 0, '고르기 전에도 배지로 알 수 있다');
}
{
  const vs = mkSet('monitor', ['BEARING', 'HI'], 'server').renderVals();
  const hs = renderToString(view(vs));
  chk(hs.indexOf('서버 감시에서 빠지는 테이블: HI') >= 0, '서버 감시 모드에서 제외 table 경고', vs.srvNoRollWarn);
  const ha = renderToString(view(mkSet('monitor', ['BEARING', 'HI'], 'app').renderVals()));
  chk(ha.indexOf('서버 감시에서 빠지는') < 0, '앱 감시 모드에서는 경고 없음 — 앱 감시는 원본 집계로 판정');
  const hb = renderToString(view(mkSet('monitor', ['BEARING'], 'server').renderVals()));
  chk(hb.indexOf('서버 감시에서 빠지는') < 0, '롤업 있는 table만 고르면 경고 없음');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
