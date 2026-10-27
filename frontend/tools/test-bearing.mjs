/* 베어링 설정 — 직접 입력·품번·목록에서 뺀 롤러 품번 이관
   · 직접 입력 전환 시 화면에 보이던 형상(직전 품번 값)이 실제 저장 값
   · 직접 입력 품번 칸 — 상세분석·리포트 표시에 사용, 판정엔 무관
   · 목록에서 뺀 롤러 품번은 직접 입력 + 품번 + 옛 형상값으로 이관(판정 불변), 카탈로그 확인 안내
   · 일괄 적용 — 품번·형상 칩이 함께 복사
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App, normCfg } = await import('../src/app.js');
const { view } = await import('../src/view.js');
const renderToString = (await import('preact-render-to-string')).default;
import fs from 'node:fs';

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const RET = ['22218', '23124', 'NU312', 'NU316'];
const geoOf = (g) => [g.n, g.Bd, g.Pd, g.phi].join('/');
function mkApp(state) {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app.state.user = 'TESTER';   // 토큰·계정 확인을 마친 상태
  app._toast = () => {};
  app.E = Object.assign({}, CH, Mock);
  app.data = Mock.generateData(42, 3);
  Object.assign(app.state, { ready: true, tab: 'settings', setSection: 'equip', srcSel: [...new Set(app.data.equipment.map((e) => e.table))] }, state || {});
  app._applied = Object.assign({}, app.state);
  return app;
}
const rowOf = (app, id) => { const base = {}; app._vmSettings(base, app.data.equipment); return { base, row: base.equipRows.find((r) => r.id === id) }; };

chk(RET.every((m) => !VC.BEARINGS[m] && VC.RETIRED_BEARINGS[m]), '출처 없는 롤러 4종은 목록에서 빠지고 이관용으로만 남음');

// ── 목록에서 뺀 품번 이관 ─────────────────────────────────────────────
{
  const cfg = normCfg({ equipBearing: { 'T:A': '22218', 'T:C': '6206', 'T:D': '23124' },
    equipGeo: { 'T:D': { n: 18, Bd: 24, Pd: 160, phi: 9 } } });
  chk(cfg.equipBearing['T:A'] === '직접 입력' && cfg.equipGeo['T:A'].name === '22218' && geoOf(cfg.equipGeo['T:A']) === geoOf(VC.RETIRED_BEARINGS['22218']),
    '뺀 품번 → 직접 입력 + 품번 칸 "22218" + 옛 형상값', JSON.stringify(cfg.equipGeo['T:A']));
  chk(cfg.equipBearing['T:C'] === '6206' && !cfg.equipGeo['T:C'], '목록에 있는 품번은 그대로');
  chk(geoOf(cfg.equipGeo['T:D']) === '18/24/160/9' && cfg.equipGeo['T:D'].name === '23124', '사용자가 이미 넣은 형상은 유지하고 품번만 채움');
  const again = normCfg(JSON.parse(JSON.stringify(cfg)));
  chk(JSON.stringify(again) === JSON.stringify(cfg), '다시 돌려도 같음(부팅마다 이관해도 무해)');
  const app = mkApp({ equipBearing: cfg.equipBearing, equipGeo: cfg.equipGeo });
  const g = app._bearingGeo({ id: 'T:A' }, cfg);
  const b0 = VC.bearingFreqs(1780, VC.RETIRED_BEARINGS['22218']), b1 = VC.bearingFreqs(1780, g);
  chk(['BPFO', 'BPFI', 'BSF', 'FTF'].every((k) => Math.abs(b0[k] - b1[k]) < 1e-9), '결함주파수 그대로 — 판정 불변', 'BPFO ' + b1.BPFO.toFixed(2));
}
// 설정 화면 — 직접 입력 + 품번 칸 + 확인 안내
{
  const app0 = mkApp();
  const e0 = app0.data.equipment[0];
  const cfg = normCfg({ equipBearing: { [e0.id]: 'NU312' }, equipRpm: { [e0.id]: 1780 } });
  const app = mkApp({ equipBearing: cfg.equipBearing, equipGeo: cfg.equipGeo, equipRpm: cfg.equipRpm });
  const { base, row } = rowOf(app, e0.id);
  chk(row.bModel === '직접 입력' && row.isCustom && row.bName === 'NU312' && row.bN === 12, '선택 상자는 직접 입력, 품번 칸 NU312, 형상 칸 옛 값', row.bModel + ' · ' + row.bName);
  chk(/NU312은\(는\) 제조사·설계/.test(row.retiredNote) && !base.bModelOptions.includes('NU312'), '카탈로그 확인 안내 · 새로 고를 수는 없음');
  chk(app._patBlockedId(e0.id) === false, '결함 패턴 축 그대로 성립');
  app.state.equipAdv = { [e0.id]: true };
  const htm = renderToString(view(app.renderVals()));
  chk(/품번<input[^>]*value="NU312"/.test(htm) && /NU312은\(는\) 제조사·설계/.test(htm), '화면에 품번 칸·안내가 그려짐');
}

// ── 직접 입력으로 바꿀 때 보이던 값이 실제 값 ────────────────────────────
{
  const app = mkApp();
  const e0 = app.data.equipment[0];
  e0.bearing = { model: '6206', n: 9, Bd: 9.5, Pd: 46, phi: 0 };
  Object.assign(app.state, { equipBearing: { [e0.id]: '6206' }, equipGeo: {} });
  app._setEquipBearing(e0.id, '직접 입력');
  const g = app.state.equipGeo[e0.id];
  chk(g && geoOf(g) === '9/9.5/46/0' && g.name === '6206', '6206 → 직접 입력: 화면의 형상·품번이 실제 편집값으로(예전: 화면에만 보이고 저장 안 됨)', JSON.stringify(g));
  const { row } = rowOf(app, e0.id);
  chk(row.bN === 9 && row.bBd === 9.5 && row.bName === '6206', '설정 칸에 보이는 값 = 저장될 값');
  chk(geoOf(app._bearingGeo(e0, app.state)) === '9/9.5/46/0', '판정에 쓰일 형상도 같은 값');

  // 이미 넣어 둔 직접 입력 형상은 덮지 않음
  app.state.equipGeo = { [e0.id]: { n: 11, Bd: 10, Pd: 50, phi: 0, name: 'SKF 6206-2RS' } };
  app.state.equipBearing = { [e0.id]: '6206' };
  app._setEquipBearing(e0.id, '직접 입력');
  chk(app.state.equipGeo[e0.id].n === 11 && app.state.equipGeo[e0.id].name === 'SKF 6206-2RS', '이미 넣어 둔 직접 입력 값은 유지');
  // 저장된 직접 입력 형상이 없으면 0 — 직전 품번 값을 꾸며 보이지 않음
  const app2 = mkApp();
  const e2 = app2.data.equipment[0];
  e2.bearing = { model: '6206', n: 9, Bd: 9.5, Pd: 46, phi: 0 };
  Object.assign(app2.state, { equipBearing: { [e2.id]: '직접 입력' }, equipGeo: {} });
  chk(rowOf(app2, e2.id).row.bN === 0, '저장된 직접 입력 형상이 없으면 0 — 저장 안 된 값을 보여 주지 않음');
  // 품번 칸 입력
  app._setEquipGeo(e0.id, 'name', '  SKF 22218 E  ');
  chk(app.state.equipGeo[e0.id].name === 'SKF 22218 E', '품번은 앞뒤 공백 제거');
  app._setEquipGeo(e0.id, 'name', '');
  chk(!('name' in app.state.equipGeo[e0.id]), '품번을 지우면 항목 삭제');
}

// ── 표의 베어링 모델 상자 — 적어 둔 품번 표시 ─────────────────────────────
{
  const app = mkApp();
  const [a, b] = app.data.equipment;
  Object.assign(app.state, { equipBearing: { [a.id]: '직접 입력', [b.id]: '직접 입력' }, equipGeo: { [a.id]: { n: 9, Bd: 9.5, Pd: 46, phi: 0, name: '1111' }, [b.id]: { n: 9, Bd: 9.5, Pd: 46, phi: 0 } } });
  const ra = rowOf(app, a.id).row, rb = rowOf(app, b.id).row;
  chk(ra.bModel === '직접 입력' && ra.bCustomLabel === '1111 (직접)' && ra.bModelTitle === '1111 (직접 입력)', '품번 있으면 상자 글자 "1111 (직접)" · 전체 이름 툴팁 (값은 그대로 직접 입력)');
  chk(rb.bCustomLabel === '직접 입력' && rb.bModelTitle === '', '품번 없으면 "직접 입력" 그대로');
  const htm = renderToString(view(app.renderVals()));
  chk(/<option[^>]*value="직접 입력"[^>]*>1111 \(직접\)<\/option>/.test(htm) && /data-tip="1111 \(직접 입력\)"/.test(htm), '화면 상자에 품번이 그려짐');
  app.state.equipBearing[a.id] = '6206';
  chk(rowOf(app, a.id).row.bModelTitle === '', '목록 품번을 고르면 적어 둔 품번 표시 안 함');
}

// ── 직접 입력으로 바꾸면 설정 패널이 열림 — 품번·형상 칸이 패널 안 ─────────────
{
  const app = mkApp();
  const [a, b] = app.data.equipment;
  Object.assign(app.state, { equipBearing: { [a.id]: '6206', [b.id]: '6206' }, equipGeo: {}, equipAdv: {} });
  app._setEquipBearing(a.id, '6207');
  chk(!app.state.equipAdv[a.id], '목록 품번으로 바꿀 때는 패널을 열지 않음');
  app._setEquipBearing(a.id, '직접 입력');
  chk(app.state.equipAdv[a.id] === true, '직접 입력을 고르면 그 행의 설정 패널이 열림(예전: 닫힌 채 — 설정 버튼을 따로 눌러야 칸이 보임)');
  chk(!app.state.equipAdv[b.id], '다른 행 패널은 그대로');
  app._setEquipBearing(a.id, '6206');
  chk(app.state.equipAdv[a.id] === true, '목록 품번으로 되돌려도 열린 패널은 그대로(닫기는 사용자가)');
  // 품번 칸에 커서 — 패널이 그려진 뒤(componentDidUpdate) 그 행 품번 칸만
  const focused = [];
  const inp = (id) => ({ getAttribute: () => id, focus: () => focused.push(id) });
  globalThis.document = { querySelectorAll: () => [inp(b.id), inp(a.id)] };
  app._setEquipBearing(a.id, '직접 입력');
  app.componentDidUpdate();
  app.componentDidUpdate();
  delete globalThis.document;
  chk(focused.join() === a.id, '직접 입력을 고르면 그 행 품번 칸에 커서(한 번만)', focused.join());
  app.state.equipBulk = { id: a.id, scope: '', fields: {} };
  app.state.equipBearing[a.id] = '직접 입력';
  app._applyEquipBulk(a.id, [b.id], { bearing: true });
  chk(app.state.equipBearing[b.id] === '직접 입력' && !app.state.equipAdv[b.id], '일괄 적용으로 직접 입력이 복사돼도 대상 패널은 열지 않음');
}

// ── 표시 이름 ─────────────────────────────────────────────────────────
{
  const app = mkApp();
  chk(app._bearingLabel({ bearing: { model: '직접 입력', name: 'SKF 22218 E', n: 17 } }) === 'SKF 22218 E (직접 입력)'
    && app._bearingLabel({ bearing: { model: '직접 입력', n: 9 } }) === '직접 입력'
    && app._bearingLabel({ bearing: { model: '6206', n: 9 } }) === '6206', '상세분석·리포트 표시 — 적어 둔 품번 우선');
  const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  chk((src.match(/this\._bearingLabel\(eq\)/g) || []).length >= 4 && !/'베어링 ' \+ eq\.bearing\.model/.test(src), '표시하는 곳 모두 같은 이름 규칙');
}

// ── 일괄 적용 — 품번·형상 함께 ───────────────────────────────────────────
{
  const app = mkApp();
  const [a, b] = app.data.equipment;
  Object.assign(app.state, { equipBearing: { [a.id]: '직접 입력' }, equipGeo: { [a.id]: { n: 17, Bd: 25, Pd: 165, phi: 10, name: 'SKF 23124 CC' } } });
  app.state.equipBulk = { id: a.id, scope: '', fields: {} };
  const { row } = rowOf(app, a.id);
  const ks = (row.bulkFields || []).map((f) => f.k);
  chk(['bearing', 'geoName', 'geoN', 'geoBd', 'geoPd', 'geoPhi'].every((k) => ks.includes(k)), '일괄 적용 칩에 품번·형상이 나옴', ks.join(','));
  app._applyEquipBulk(a.id, [b.id], { bearing: true, geoName: true, geoN: true, geoBd: true, geoPd: true, geoPhi: true });
  const gb = app.state.equipGeo[b.id];
  chk(app.state.equipBearing[b.id] === '직접 입력' && gb && gb.name === 'SKF 23124 CC' && geoOf(gb) === '17/25/165/10', '대상에 품번·형상이 그대로 복사', JSON.stringify(gb));
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
