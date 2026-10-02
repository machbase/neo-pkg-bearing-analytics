/* 모니터링 테이블 필터 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 등급 필터는 KPI 불변, 테이블 필터는 모집단 축소(KPI도 축소), 빈 상태 화면(monEmpty)과 구분
   · 판정 대상·설정 태그 수는 필터와 무관, 즉시 반영·칩(3개 + N)·검색·전체 선택/해제
   · 숨긴 목록 저장 — 나중에 생긴 테이블은 자동 표시 */
globalThis.window = globalThis;

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const TABLES = ['VIBRATION_RAW', 'SENSOR_DATA', 'MOTOR_CURRENT', 'GEARBOX_VIB'];
function mkApp(patch) {
  const app = new App({ seed: 11, equipmentCount: 20 });
  app.setState = function (s) { Object.assign(this.state, s); };
  app._scheduleDraw = function () {};
  app._toast = function () {};
  app._persistView = function () { return Promise.resolve(); };
  app.E = CH; app.live = true;
  const d = Mock.generateData(11, 20);
  d.equipment.forEach((e) => { e.fs = 25600; });
  app.data = d;
  app.liveTables = TABLES.slice();
  Object.assign(app.state, { ready: true, tab: 'monitor', monitorOn: true, srcSel: TABLES.slice() }, patch || {});
  return app;
}
const countIn = (app, tbl) => app._activeEqs().filter((e) => e.table === tbl).length;

// ── 1. 소스가 하나면 필터 없음 ───────────────────────────────────────
{
  const one = mkApp({ srcSel: ['VIBRATION_RAW'] });
  const v = one.renderVals();
  chk(v.tblFilterShow === false, '소스가 하나면 필터를 내놓지 않는다 — 늘 같은 값만 든 칩은 소음이다');
  chk(v.cards.length > 0 && !/\(/.test(v.cards[0].sub), '테이블도 안 적는다 — 구분할 것이 없다', v.cards[0].sub);
}

// ── 2. 기본은 전체 선택 ───────────────────────────────────────────────────
{
  const app = mkApp();
  const v = app.renderVals();
  chk(v.tblFilterShow === true, '소스가 둘 이상이면 필터가 나온다');
  chk(v.tblAllOn === true, '기본은 전부 켜져 있다 — 아무것도 안 건드린 화면이 곧 전체 보기다');
  chk(v.tblOptions.every((o) => o.checked), '체크박스도 전부 켜져 있다', v.tblOptions.map((o) => o.name + (o.checked ? '✓' : '✗')).join(' '));
  chk(v.tblCaption === '전체 테이블 표시 중', '전체일 때는 문구로 말한다', v.tblCaption);
  chk(v.tblChips.length === 0 && v.tblMore === 0, '전체일 때 칩은 없다 — 있는 것을 다 나열하는 칩은 정보가 아니다');
  chk(v.cards.length === app._activeEqs().length, '전체 설비가 다 나온다', String(v.cards.length));
  const opt = v.tblOptions.find((o) => o.name === 'VIBRATION_RAW');
  chk(opt.count === countIn(app, 'VIBRATION_RAW'), '테이블마다 태그 수를 적는다', String(opt.count));
  const c0 = v.cards[0];
  const eq0 = app._activeEqs().find((e) => e.id === c0.id);
  chk(c0.sub === eq0.name + ' (' + eq0.table + ')', '작은 글씨는 태그명 (테이블명)', c0.sub);
  chk(c0.alias === (eq0.alias || eq0.name), '큰 글씨는 별칭 그대로', c0.alias);
}

// ── 3. 하나 끄면 모집단·KPI 동반 축소 ─────────────────────────────
{
  const app = mkApp();
  const before = app.renderVals();
  const off = countIn(app, 'SENSOR_DATA');
  app.setState({ tblHide: ['SENSOR_DATA'] });
  const after = app.renderVals();
  chk(after.cards.length === before.cards.length - off, '끈 테이블의 설비만 빠진다', `${before.cards.length} → ${after.cards.length}`);
  chk(after.sumTotal === after.cards.length, 'KPI 전체 수가 필터를 따라간다', `${before.sumTotal} → ${after.sumTotal}`);
  const kpiSum = after.kpiCells.reduce((s, c) => s + c.count, 0);
  chk(kpiSum === after.cards.length, 'KPI 칸의 합도 모집단과 같다 — 숫자와 목록이 어긋나면 KPI를 못 믿는다', `${kpiSum}/${after.cards.length}`);
  chk(after.cards.every((c) => !/\(SENSOR_DATA\)$/.test(c.sub)), '끈 테이블 카드는 하나도 안 남는다');
  chk(after.tblAllOn === false && after.tblCaption === '', '전체 상태가 아니면 문구를 내린다');
  chk(after.tblSelCount === TABLES.length - 1 && after.tblTotal === TABLES.length, '버튼에는 남은 수/전체 수를 적는다', `${after.tblSelCount}/${after.tblTotal}`);
  chk(after.tblChips.length === TABLES.length - 1, '남아 있는 테이블이 칩으로 나온다', after.tblChips.map((c) => c.name).join(','));
}

// ── 4. 필터와 무관해야 하는 것 ──────────────────────────────────────────────
{
  const app = mkApp();
  const all = app._activeEqs().length;
  const before = app.renderVals();
  app.setState({ tblHide: ['GEARBOX_VIB', 'SENSOR_DATA'] });
  const after = app.renderVals();
  chk(after.monEmpty === false, '필터로 좁혀도 빈 상태 화면으로 넘어가지 않는다');
  chk(after.activeCount === before.activeCount, '설정의 태그 수는 화면 필터와 무관하다', `${before.activeCount} → ${after.activeCount}`);
  chk(app._activeEqs().length === all, '판정 대상은 하나도 안 줄어든다 — 화면에서 감췄다고 감시를 멈추면 안 된다', `${all} → ${app._activeEqs().length}`);
  chk(after.detailShow === before.detailShow && after.reportShow === before.reportShow, '다른 탭의 표시 조건도 안 건드린다');
}

// ── 5. 선택 즉시 반영 ───────────────────────────────────────────────
{
  /* 확인 버튼 없음 — 보기만 바꾸고 판정 무관이라 되돌리기 쉬움, 걸린 것은 칩으로 항상 표시·즉시 해제 */
  const app = mkApp();
  let v = app.renderVals();
  const all = v.cards.length;
  v.onTblOpen();
  v = app.renderVals();
  chk(v.tblOpen === true, '버튼을 누르면 열린다');
  v.tblOptions.find((o) => o.name === 'MOTOR_CURRENT').onToggle();
  v = app.renderVals();
  chk(v.cards.length === all - countIn(app, 'MOTOR_CURRENT'), '끄는 즉시 목록에서 빠진다', String(v.cards.length));
  chk(v.tblOpen === true, '고른 뒤에도 열려 있다 — 연달아 고를 수 있어야 한다');
  chk(v.tblChips.some((c) => c.count === countIn(app, 'VIBRATION_RAW')), '칩에도 태그 수를 적는다');
  v.tblOptions.find((o) => o.name === 'MOTOR_CURRENT').onToggle();
  v = app.renderVals();
  chk(v.tblAllOn === true && v.cards.length === all, '다시 켜면 전체로 돌아온다');
}

// ── 6. 칩은 셋까지, 나머지는 +N ───────────────────────────────────────────
{
  /* 테이블이 많으면 제목줄이 칩에 먹힘 → 넷째부터 +N으로 접고, +N은 목록을 다시 여는 버튼 */
  const app = mkApp({ srcSel: TABLES.concat('BEARING_TEMP') });
  app.setState({ tblHide: ['BEARING_TEMP'] });        // 남은 4개
  let v = app.renderVals();
  chk(v.tblChips.length === 3 && v.tblMore === 1, '넷째부터 +1로 접힌다', `칩 ${v.tblChips.length} · +${v.tblMore}`);
  chk(v.tblSelCount === 4, '버튼의 수는 접힌 것까지 센다', String(v.tblSelCount));
  app.setState({ tblHide: ['BEARING_TEMP', 'VIBRATION_RAW'] });   // 남은 3개
  v = app.renderVals();
  chk(v.tblChips.length === 3 && v.tblMore === 0, '셋까지는 그대로 보여준다', `칩 ${v.tblChips.length} · +${v.tblMore}`);
  app.renderVals().onTblMore();
  chk(app.renderVals().tblOpen === true, '+N을 누르면 목록이 다시 열린다');
}

// ── 7. 전부 끄면 전용 안내 ────────────────────────────────────────────
{
  /* 빈 카드 자리로는 필터 탓·설비 부재 구분 불가, monEmpty는 "소스 없음" 전용이라 별도 안내 */
  const app = mkApp();
  let v = app.renderVals();
  const all = v.cards.length;
  v.onTblOpen();
  app.renderVals().onTblClearAll();
  v = app.renderVals();
  chk(v.cards.length === 0 && v.tblNoneShow === true, '하나도 안 남기면 전용 안내가 나온다');
  chk(v.monEmpty === false, '소스 없음 화면과는 다른 자리다');
  chk(v.tblSelCount === 0, '버튼에는 0/N이 뜬다', `${v.tblSelCount}/${v.tblTotal}`);
  v.onTblSelectAll();
  v = app.renderVals();
  chk(v.tblAllOn === true && v.cards.length === all && v.tblNoneShow === false, '전체 선택이면 원래대로 돌아온다', String(v.cards.length));
}

// ── 8. 칩의 ×는 그 테이블만 끔 ──────────────────────────────────────────
{
  const app = mkApp();
  const all = app.renderVals().cards.length;
  const first = app.renderVals().tblOptions[0].name;
  app.renderVals().tblOptions.find((o) => o.name === first).onToggle();   // 하나 꺼서 칩 표시
  const chip = app.renderVals().tblChips[0];
  chip.onRemove();
  const v = app.renderVals();
  chk(v.cards.length === all - countIn(app, first) - countIn(app, chip.name), '칩의 ×는 그 테이블을 목록에서 뺀다', String(v.cards.length));
  chk(v.tblChips.every((c) => c.name !== chip.name), '뺀 테이블은 칩에서 사라진다');
}

// ── 9. 검색 ───────────────────────────────────────────────────────────────
{
  const app = mkApp();
  let v = app.renderVals();
  const all = v.cards.length;
  v.onTblOpen();
  app.renderVals().onTblQuery({ target: { value: 'gear' } });
  v = app.renderVals();
  chk(v.tblOptions.length === 1 && v.tblOptions[0].name === 'GEARBOX_VIB', '대소문자 구분 없이 부분 일치로 거른다', v.tblOptions.map((o) => o.name).join(','));
  chk(v.cards.length === all, '검색만으로는 화면이 안 바뀐다 — 목록을 좁힐 뿐이다');
  /* 전체 선택·해제는 검색으로 보이는 것에만 적용 */
  v.onTblClearAll();
  v = app.renderVals();
  chk(v.cards.length === all - countIn(app, 'GEARBOX_VIB'), '전체 해제는 보이는 것만 끈다', String(v.cards.length));
  app.renderVals().onTblQuery({ target: { value: '없는이름' } });
  v = app.renderVals();
  chk(v.tblOptions.length === 0 && v.tblNoMatch === true, '일치가 없으면 그렇게 말한다');
  chk(v.tblSelCount === TABLES.length - 1, '검색 중에도 걸린 필터는 유지된다', String(v.tblSelCount));
  v.onTblClose();
  chk(app.renderVals().tblQuery === '', '닫으면 검색어를 비운다 — 다시 열었을 때 잘린 목록은 없는 테이블로 읽힌다');
}

// ── 10. 나중에 생긴 테이블은 자동 표시 ──────────────────────────────
{
  /* 숨긴 목록을 저장하는 이유 — 고른 목록을 저장하면 새 테이블이 빠져 감시는 도는데 카드가 없는 상태가 됨 */
  const app = mkApp({ srcSel: ['VIBRATION_RAW', 'SENSOR_DATA'], tblHide: ['SENSOR_DATA'] });
  app.setState({ srcSel: ['VIBRATION_RAW', 'SENSOR_DATA', 'GEARBOX_VIB'] });
  const v = app.renderVals();
  chk(v.tblOptions.find((o) => o.name === 'GEARBOX_VIB').checked === true, '새로 추가된 테이블은 켜진 채로 들어온다');
  chk(v.cards.some((c) => / \(GEARBOX_VIB\)$/.test(c.sub)), '새 테이블 설비가 바로 카드로 나온다');
  chk(v.cards.every((c) => !/ \(SENSOR_DATA\)$/.test(c.sub)), '전에 끈 것은 그대로 꺼져 있다');
}

// ── 11. 소스에서 빠진 테이블이 숨김에 남아 있어도 무해 ─────────────────
{
  const app = mkApp({ srcSel: ['VIBRATION_RAW', 'SENSOR_DATA'], tblHide: ['GEARBOX_VIB'] });
  const v = app.renderVals();
  chk(v.tblAllOn === true && v.cards.length === app._activeEqs().length, '없는 테이블의 숨김은 무시한다', String(v.cards.length));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
