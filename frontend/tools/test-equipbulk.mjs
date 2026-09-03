/* 설비 정보 목록 필터·일괄 적용 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.

   감시 태그는 상한(테이블당 60·전체 100)까지 늘어난다. 목록에 자체 스크롤을 두지 않는 대신
   두 가지로 다룬다: ①손댈 줄만 남기는 필터 ②한 행을 채워 같은 설비로 퍼뜨리는 일괄 적용.

   일괄 적용에서 조용히 깨질 수 있는 곳은 "값이 없는 항목"이다. 원본의 공백까지 복사하면
   대상에 이미 채워 둔 값이 지워진다 — 그래서 값이 있는 항목만 내놓고, 그것만 옮긴다. */
globalThis.window = globalThis;

const DB = (await import('../../cgi-bin/db/db.js')).default;
const TAGS = {
  T1: ['MOTOR_01_X', 'MOTOR_01_Y', 'MOTOR_01_Z', 'PUMP_02_X', 'PUMP_02_Y'],
  T2: ['FAN_09_X', 'FAN_09_Y'],
};
DB.listTags = (table, cap) => Promise.resolve((TAGS[table] || []).slice(0, cap || 20));
DB.tagStats = (table) => {
  const m = {};
  (TAGS[table] || []).forEach((t, i) => { m[t] = { count: 1000, minMs: 1700000000000, maxMs: 1700000600000 + i }; });
  return Promise.resolve(m);
};
DB.rollupTrend = () => Promise.resolve([]);
DB.isNoRollup = () => false;

const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const { buildLiveData } = await import('../src/data/live.js');
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

const data = await buildLiveData(CH, ['T1', 'T2'], {});
const ID = (t, n) => t + ':' + n;
const MX = ID('T1', 'MOTOR_01_X'), MY = ID('T1', 'MOTOR_01_Y'), MZ = ID('T1', 'MOTOR_01_Z');
const PX = ID('T1', 'PUMP_02_X'), FX = ID('T2', 'FAN_09_X');

function mkApp(patch) {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._scheduleDraw = function () {};
  app._toast = function (m) { this._lastToast = m; };
  app._ensureTags = function () {};
  app._blMap = {};
  app.E = CH; app.live = true;
  app.data = data;
  Object.assign(app.state, { ready: true, tab: 'settings', setSection: 'equip', srcSel: ['T1', 'T2'] }, patch || {});
  return app;
}
const rowOf = (vm, id) => (vm.equipRows || []).filter((r) => r.id === id)[0];

// ── 필터 ───────────────────────────────────────────────────────────────────
{
  const app = mkApp();
  const vm = app.renderVals();
  chk(vm.equipRows.length === 7, '필터 없이는 전 태그가 나온다 — 목록 자체를 자르지 않는다', String(vm.equipRows.length));
  const f = {}; (vm.equipFilters || []).forEach((x) => { f[x.label] = x; });
  chk((vm.equipFilters || []).length === 2, '필터는 전체/판정 불가 둘뿐 — 부분집합 관계인 칩을 나란히 두면 같은 수가 두 번 보인다',
    JSON.stringify((vm.equipFilters || []).map((x) => x.label + ':' + x.count)));
  chk(f['전체'] && f['전체'].count === 7, '전체 수를 센다');
  /* "미설정"이 아니라 "판정 불가"를 센다 — 미설정은 OR라 RPM 하나만 넣어도 빠지는데
     그 태그도 격자를 못 그어 등급이 안 선다. 조치로 이어지는 쪽을 남긴다. */
  chk(f['판정 불가'] && f['판정 불가'].count === 7, '회전수·베어링이 없으면 전부 판정 불가');
}
{
  // 회전수만 넣은 줄은 여전히 판정 불가다 — 격자에는 베어링 기하도 있어야 한다
  const app = mkApp({ equipRpm: { [MX]: 1800 } });
  const f = (app.renderVals().equipFilters || []).filter((x) => x.label === '판정 불가')[0];
  chk(f.count === 7, 'RPM만 넣어서는 판정 불가가 줄지 않는다', String(f.count));
}
{
  // 좌측 내비 배지(_equipUnset)와 같은 기준으로 걸러야 배지를 보고 들어온 사람이 그 줄만 본다
  const app = mkApp({ equipRpm: { [MX]: 1800 }, equipBearing: { [MX]: '6208' } });
  const vm = app.renderVals();
  const f = (vm.equipFilters || []).filter((x) => x.label === '판정 불가')[0];
  chk(f.count === 6, '회전수와 베어링을 둘 다 채우면 판정 불가가 줄어든다', String(f.count));

  app.state.equipFilter = 'blocked';
  const vm2 = app.renderVals();
  chk(vm2.equipRows.length === 6 && !rowOf(vm2, MX), '판정 불가 필터는 채운 줄을 뺀다', String(vm2.equipRows.length));
  chk(vm2.equipFilterEmpty === false, '남은 줄이 있으면 빈 상태가 아니다');
}
{
  const ALL = [MX, MY, MZ, PX, ID('T1', 'PUMP_02_Y'), FX, ID('T2', 'FAN_09_Y')];
  const rpm = {}, br = {}; ALL.forEach((id) => { rpm[id] = 1800; br[id] = '6209'; });
  const app = mkApp({ equipRpm: rpm, equipBearing: br, equipFilter: 'blocked' });
  const vm = app.renderVals();
  chk(vm.equipRows.length === 0 && vm.equipFilterEmpty === true, '다 채우면 판정 불가 필터는 빈 상태를 낸다');
  const f = (vm.equipFilters || []).filter((x) => x.label === '판정 불가')[0];
  chk(f.onClick === null, '0건 필터는 눌리지 않는다 — 빈 목록으로 들어가는 길을 막는다');
  vm.onEquipFilterAll();
  chk(app.state.equipFilter === 'all', '빈 상태에서 전체 보기로 돌아온다');
}

// ── 일괄 적용: 대상 범위 ───────────────────────────────────────────────────
{
  const app = mkApp({ equipCls: { [MX]: 'III' }, equipBulk: { id: MX, scope: '', fields: {} } });
  const vm = app.renderVals();
  const r = rowOf(vm, MX);
  chk(!!r && r.bulkOpen === true, '연 행에만 패널이 붙는다');
  chk(!rowOf(vm, MY).bulkOpen, '다른 행에는 붙지 않는다');
  const labels = (r.bulkScopes || []).map((s) => s.label);
  chk(/^같은 설비 MOTOR_01\* · 2개/.test(labels[0] || ''), '가장 좁은 범위(같은 설비)가 먼저 온다', JSON.stringify(labels));
  chk(/^같은 테이블 T1 · 4개/.test(labels[1] || ''), '그 다음이 같은 테이블', JSON.stringify(labels));
  chk(/^목록 전체 · 6개/.test(labels[2] || ''), '테이블이 여럿이면 목록 전체도 고를 수 있다', JSON.stringify(labels));
  chk(r.bulkApplyLabel === '태그 2개에 적용', '기본은 가장 좁은 범위 — 넓은 쪽이 기본이면 한 번의 실수로 전부 덮어쓴다', r.bulkApplyLabel);
}
{
  // 테이블이 하나면 '같은 테이블'과 '목록 전체'가 같은 선택지가 된다 — 하나만 남긴다
  const app = mkApp({ srcSel: ['T1'], equipBulk: { id: MX, scope: '', fields: {} } });
  app.data = await buildLiveData(CH, ['T1'], {});
  const r = rowOf(app.renderVals(), MX);
  chk((r.bulkScopes || []).length === 2, '같은 범위를 두 번 내놓지 않는다', JSON.stringify((r.bulkScopes || []).map((s) => s.label)));
}

// ── 일괄 적용: 복사할 항목 ─────────────────────────────────────────────────
{
  const app = mkApp({
    equipUnit: { [MX]: 'g' }, equipCls: { [MX]: 'III' }, equipRpm: { [MX]: '3600' },
    equipBearing: { [MX]: '6205' }, equipMeta: { [MX]: { mount: 'stud', drive: 'belt', belt: { d1: 120, d2: 300, len: 900 } } },
    equipBulk: { id: MX, scope: '', fields: {} },
  });
  const r = rowOf(app.renderVals(), MX);
  const ks = (r.bulkFields || []).map((f) => f.k);
  chk(ks.join(',') === 'unit,cls,rpm,bearing,mount,drive,beltD1,beltD2,beltLen',
    '값이 있는 입력칸마다 항목 하나 — 묶으면 값이 다 안 보인다', ks.join(','));
  chk((r.bulkFields || []).every((f) => f.on), '기본은 전부 켜짐');
  const fv = {}; (r.bulkFields || []).forEach((f) => { fv[f.k] = f.val; });
  chk(fv.mount === '스터드' && fv.drive === '벨트·풀리' && fv.beltD1 === '120 mm' && fv.beltD2 === '300 mm' && fv.beltLen === '900 mm',
    '칩마다 값 하나를 온전히 보여준다', JSON.stringify(fv));
}
{
  // 직접 입력 형상도 네 칸이 각각 항목 — 접촉각 0°는 정상값이라 빠지면 안 된다
  const app = mkApp({
    equipBearing: { [MX]: '직접 입력' }, equipGeo: { [MX]: { n: 9, Bd: 9.5, Pd: 46, phi: 0 } },
    equipBulk: { id: MX, scope: '', fields: {} },
  });
  const r = rowOf(app.renderVals(), MX);
  const fv = {}; (r.bulkFields || []).forEach((f) => { fv[f.k] = f.val; });
  chk(fv.geoN === '9' && fv.geoBd === '9.5 mm' && fv.geoPd === '46 mm' && fv.geoPhi === '0°', '형상 네 칸이 각각 나온다', JSON.stringify(fv));
  r.onBulkApply();
  chk(app.state.equipGeo[MY].n === 9 && app.state.equipGeo[MY].phi === 0, '형상이 그대로 옮겨간다', JSON.stringify(app.state.equipGeo[MY]));
}
{
  // 카탈로그 품번이면 형상은 품번에서 나온다 — 옮길 입력칸이 아니다
  const app = mkApp({
    equipBearing: { [MX]: '6205' }, equipGeo: { [MX]: { n: 9, Bd: 9.5, Pd: 46, phi: 0 } },
    equipBulk: { id: MX, scope: '', fields: {} },
  });
  const ks = (rowOf(app.renderVals(), MX).bulkFields || []).map((f) => f.k);
  chk(ks.join(',') === 'bearing', '카탈로그 베어링은 형상 칩이 없다', ks.join(','));
}
{
  const app = mkApp({ equipCls: { [MX]: 'III' }, equipBulk: { id: MX, scope: '', fields: {} } });
  const r = rowOf(app.renderVals(), MX);
  chk((r.bulkFields || []).length === 1 && r.bulkFields[0].k === 'cls',
    '값이 없는 항목은 아예 내놓지 않는다 — 빈 값을 옮길 수단을 두지 않는다', JSON.stringify((r.bulkFields || []).map((f) => f.k)));
}
{
  const app = mkApp({ equipBulk: { id: MX, scope: '', fields: {} } });
  const r = rowOf(app.renderVals(), MX);
  chk(r.bulkNone === true, '빈 행에서는 복사할 것이 없다고 말한다');
}

// ── 일괄 적용: 실제 적용 ───────────────────────────────────────────────────
{
  const app = mkApp({
    equipUnit: { [MX]: 'g' }, equipCls: { [MX]: 'III' }, equipRpm: { [MX]: '3600' },
    equipBearing: { [MX]: '6205' }, equipMeta: { [MX]: { mount: 'stud', drive: 'belt', belt: { d1: 120, d2: 300 } } },
    equipBulk: { id: MX, scope: '', fields: {} },
  });
  rowOf(app.renderVals(), MX).onBulkApply();
  const S = app.state;
  chk(S.equipCls[MY] === 'III' && S.equipCls[MZ] === 'III', '같은 설비의 다른 채널에 적용된다');
  chk(S.equipUnit[MY] === 'g' && S.equipRpm[MY] === '3600' && S.equipBearing[MY] === '6205', '고른 항목이 전부 옮겨간다');
  chk(S.equipMeta[MY].mount === 'stud' && S.equipMeta[MY].belt.d1 === 120, '계측·구동은 벨트 제원까지 옮긴다');
  chk(S.equipMeta[MY] !== S.equipMeta[MX] && S.equipMeta[MY].belt !== S.equipMeta[MX].belt,
    '메타는 복사본이어야 한다 — 참조를 공유하면 한 행을 고칠 때 나머지가 함께 바뀐다');
  chk(app.state.equipMeta[MZ].vanes === undefined, '원본에 없는 메타 항목은 만들어 내지 않는다');
  chk(!S.equipCls[PX] && !S.equipCls[FX], '범위 밖 태그는 건드리지 않는다');
  chk(S.equipBulk === null, '적용하면 패널이 닫힌다');
  chk(S.dirty === true, '저장해야 할 변경으로 표시된다');
  chk(/2개/.test(app._lastToast || ''), '몇 개에 적용했는지 알린다', app._lastToast);
}
{
  // 끈 항목은 옮기지 않는다 — 대상마다 다른 값(직접 넣은 RPM)을 지키는 유일한 수단이다
  const app = mkApp({
    equipCls: { [MX]: 'III' }, equipRpm: { [MX]: '3600', [MY]: '900' },
    equipBulk: { id: MX, scope: '', fields: { rpm: false } },
  });
  rowOf(app.renderVals(), MX).onBulkApply();
  chk(app.state.equipCls[MY] === 'III' && app.state.equipRpm[MY] === '900', '끈 항목은 그대로 둔다', app.state.equipRpm[MY]);
}
{
  /* 계측·구동은 항목별로 간다 — 마운팅만 켜고 적용했을 때 대상이 따로 넣어 둔 날개수가
     남아 있어야 한다(통째로 덮으면 사라진다). */
  const app = mkApp({
    equipMeta: { [MX]: { mount: 'stud', drive: 'direct' }, [MY]: { vanes: 7 } },
    equipBulk: { id: MX, scope: '', fields: { drive: false } },
  });
  const r = rowOf(app.renderVals(), MX);
  chk((r.bulkFields || []).map((f) => f.k).join(',') === 'mount,drive', '원본에 없는 날개수는 칩으로 나오지 않는다', JSON.stringify((r.bulkFields || []).map((f) => f.k)));
  r.onBulkApply();
  chk(app.state.equipMeta[MY].mount === 'stud' && app.state.equipMeta[MY].vanes === 7 && !app.state.equipMeta[MY].drive,
    '켠 항목만 덮고 대상의 나머지 메타는 남는다', JSON.stringify(app.state.equipMeta[MY]));
}
{
  // 벨트 제원은 구동에 딸린 값 — 구동이 비면 옮길 수단이 없다
  const app = mkApp({ equipMeta: { [MX]: { belt: { d1: 120, d2: 300 } } }, equipBulk: { id: MX, scope: '', fields: {} } });
  const r = rowOf(app.renderVals(), MX);
  chk(r.bulkNone === true, '구동 없는 벨트 제원만으로는 복사할 항목이 되지 않는다', JSON.stringify((r.bulkFields || []).map((f) => f.k)));
}
{
  // 원본에 없는 항목이 대상의 값을 지우면 안 된다
  const app = mkApp({
    equipCls: { [MX]: 'III' }, equipRpm: { [MY]: '900' }, equipUnit: { [MY]: 'μm' },
    equipBulk: { id: MX, scope: '', fields: {} },
  });
  rowOf(app.renderVals(), MX).onBulkApply();
  chk(app.state.equipRpm[MY] === '900' && app.state.equipUnit[MY] === 'μm',
    '원본이 비었으면 대상 값을 지우지 않는다', JSON.stringify({ rpm: app.state.equipRpm[MY], unit: app.state.equipUnit[MY] }));
}
{
  // 범위를 넓히면 그만큼 간다 (같은 테이블 = 자기 제외 4개)
  const app = mkApp({ equipCls: { [MX]: 'III' }, equipBulk: { id: MX, scope: 'table', fields: {} } });
  const r = rowOf(app.renderVals(), MX);
  chk(r.bulkApplyLabel === '태그 4개에 적용', '고른 범위의 대상 수를 버튼에 적는다 — 누르기 전에 몇 개가 바뀌는지 보인다', r.bulkApplyLabel);
  r.onBulkApply();
  chk(app.state.equipCls[PX] === 'III' && !app.state.equipCls[FX], '같은 테이블까지만 간다');
}
{
  const app = mkApp({ equipCls: { [MX]: 'III' }, equipBulk: { id: MX, scope: '', fields: {} } });
  rowOf(app.renderVals(), MX).onBulkCancel();
  chk(app.state.equipBulk === null && !app.state.equipCls[MY], '취소하면 아무것도 바뀌지 않는다');
}
{
  // 필터를 바꾸면 패널을 닫는다 — 열어 둔 원본 행이 걸러져 사라지면 패널만 떠 있게 된다
  const app = mkApp({ equipCls: { [MX]: 'III' }, equipBulk: { id: MX, scope: '', fields: {} } });
  const vm = app.renderVals();
  (vm.equipFilters || []).filter((x) => x.label === '판정 불가')[0].onClick();
  chk(app.state.equipBulk === null && app.state.equipFilter === 'blocked', '필터를 바꾸면 일괄 적용 패널이 닫힌다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
