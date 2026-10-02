/* 미지원 컬럼 구성 table 차단 — 오프라인(Neo 불필요) · npm run smoke 포함
   · TAG table 컬럼 이름은 역할 키워드로 정해져 자유, 앱 조회는 NAME·TIME·VALUE 고정 → 선택 전에 차단·사유 표시
   · 스키마 미확인 시 차단 안 함, 저장된 미지원 선택·전체 선택에서 제외, 스키마 SQL은 콤마 조인 */
globalThis.window = globalThis;
import renderToString from 'preact-render-to-string';

const { view } = await import('../src/view.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const SQL = (await import('../../cgi-bin/db/sql.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const SCHEMAS = {
  BEARING: ['NAME', 'TIME', 'VALUE'],
  VIBE_TEST: ['NAME', 'TIME', 'VALUE'],
  SENSOR_TEST: ['DEVICE_ID', 'TS', 'READING'],   // 셋 다 다름
  SENSOR_DATA: ['DEVICE_ID', 'TIME', 'TEMPERATURE'], // 시간만 같음
  TAG: ['NAME', 'TIMEVALUE', 'VALUE'],           // 시간만 다름
};
const mk = (schemas, sel) => {
  const a = new App({ defaultTab: 'settings', seed: 1, equipmentCount: 1 });
  a.setState = function (s) { Object.assign(this.state, s); };
  a._scheduleDraw = () => {}; a._ensureTags = () => {};
  a.E = CH; a.live = true; a.forceUpdate = () => {};
  a.toasts = []; a._toast = function (m, k) { this.toasts.push({ m, k }); };
  a.data = { now: Date.now(), equipment: [], events: [], reports: [] };
  a.liveTables = Object.keys(SCHEMAS);
  a.liveSchemas = schemas;
  Object.assign(a.state, { ready: true, tab: 'settings', setSection: 'source', srcSel: sel || [] });
  return a;
};

// ── 차단 판정 ──────────────────────────────────────────────────────────────
{
  const a = mk(SCHEMAS);
  chk(a._srcBlock('BEARING') === '', '표준 스키마는 막지 않는다');
  chk(!!a._srcBlock('SENSOR_TEST'), '세 컬럼이 모두 다르면 막는다');
  chk(!!a._srcBlock('SENSOR_DATA'), '태그·값 컬럼이 다르면 막는다');
  chk(!!a._srcBlock('TAG'), '시간 컬럼만 달라도 막는다 — 조회는 TIME을 그대로 쓴다');
  chk(/DEVICE_ID · TS · READING/.test(a._srcBlock('SENSOR_TEST')),
    '무엇을 쓰는 table인지 사유에 적는다', a._srcBlock('SENSOR_TEST'));
}
// ── 스키마 미확인(권한·구버전)이면 차단 안 함 ────────────────────────
{
  const a = mk(null);
  chk(a._srcBlock('SENSOR_TEST') === '', '스키마를 모르면 막지 않는다 — 모른다고 못 쓰게 하면 되던 것이 안 된다');
}
// ── 토글 차단 ──────────────────────────────────────────────────
{
  const a = mk(SCHEMAS);
  a._toggleSrcTable('SENSOR_TEST');
  chk(a.state.srcSel.indexOf('SENSOR_TEST') < 0, '막힌 table은 선택되지 않는다', JSON.stringify(a.state.srcSel));
  chk(a.toasts.length === 1 && /미지원/.test(a.toasts[0].m), '왜 안 되는지 알린다', a.toasts[0] && a.toasts[0].m);
  a._toggleSrcTable('BEARING');
  chk(a.state.srcSel.indexOf('BEARING') >= 0, '정상 table은 그대로 선택된다');
}
// ── 저장돼 있던 미지원 선택 제외 ───────────────────────────────
{
  const a = mk(null, ['BEARING', 'SENSOR_TEST']);
  a.liveSchemas = SCHEMAS;
  // _loadSchemas 제외 로직과 같은 판정 — 조회 없이 결과만 확인
  const drop = a.state.srcSel.filter((t) => !!a._srcBlock(t));
  chk(drop.length === 1 && drop[0] === 'SENSOR_TEST', '저장돼 있던 미지원 table을 골라낸다', JSON.stringify(drop));
}
// ── 전체 선택은 선택 가능한 것만 ──────────────────────────────────
{
  const a = mk(SCHEMAS);
  const v = a.renderVals();
  v.onSrcSelectAll();
  const sel = a.state.srcSel;
  chk(sel.indexOf('SENSOR_TEST') < 0 && sel.indexOf('TAG') < 0,
    '전체 선택에 미지원 table이 섞이지 않는다 — 섞이면 저장 직후 조회가 실패한다', JSON.stringify(sel));
  chk(sel.length === 2, '고를 수 있는 것만 담긴다', JSON.stringify(sel));
}
// ── 화면에 사유 표시 ──────────────────────────────────────────────────
{
  const a = mk(SCHEMAS);
  const html = renderToString(view(a.renderVals()));
  chk(html.indexOf('DEVICE_ID · TS · READING') >= 0, '목록에 사유가 렌더된다');
  chk(/disabled/.test(html), '체크박스가 비활성으로 렌더된다');
}
// ── SQL은 콤마 조인(명시적 3단 JOIN은 이 빌드에서 실패) ──────
{
  const s = SQL.tagSchemas('SYS');
  chk(!/\bJOIN\b/i.test(s), '명시적 JOIN을 쓰지 않는다 — 3단이면 TK_ID is not resolved로 깨진다', s.slice(0, 60));
  chk(/M\$SYS_COLUMNS/.test(s) && /c\.ID < 3/.test(s), '앞 세 컬럼만 읽는다');
  chk(/TYPE = 6/.test(s), 'TAG table만 대상으로 한다');
}

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
