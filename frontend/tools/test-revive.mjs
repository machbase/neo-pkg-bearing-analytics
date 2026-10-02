/* 태그 되살아남 차단 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 학습값(BASELINE)·판정 상태(MONSTATE)는 '테이블:태그' 키라 태그 삭제 후에도 남음 → 같은 이름 새 설비에 옛 μ·σ 적용 위험
   · 학습값 가진 처음 보는 태그는 사람 확인 전까지 학습 기반 판정 중단(ISO 존은 유지)
   · 오판 방지: 알던 태그·첫 실행·로드 전·테이블 선택 해제·조회 실패는 제외 */
globalThis.window = globalThis;
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const Mock = (await import('./mock.js')).default;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

function makeApp(patch) {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._scheduleDraw = function () {};
  app._toast = function () {};
  app._persistView = function () { return Promise.resolve(); };   // 저장은 검사 대상 아님
  app._syncMonitorTimer = function () { return Promise.resolve(); };
  app.E = CH; app.live = true;
  app.data = Mock.generateData(7, 3);
  app.data.equipment.forEach((e) => { e.fs = 25600; });
  // _activeEqs는 srcSel(선택 테이블)로 거름 — 안 채우면 감시 대상 0개
  const tables = [...new Set(app.data.equipment.map((e) => e.table))];
  Object.assign(app.state, { ready: true, srcSel: tables }, patch || {});
  return app;
}
const keyOf = (app, i) => { const e = app.data.equipment[i]; return e.table + ':' + e.name; };

// ── 처음 보는 태그인데 학습값 있음 = 되살아남 ──────────────────────────
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0), k1 = keyOf(app, 1);
  app._blMap = { [k0]: { mu: 2.1, sigma: 0.2, k: 3, at: 1 } };   // k0만 학습 이력 있음
  app.state.knownTags = ['OTHER:TAG'];                            // 목록은 있고 이 셋은 그 안에 없음
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(app._isRevived(k0), '학습값이 남아 있는 처음 보는 태그는 확인 대기', JSON.stringify(app.state.revived));
  chk(!app._isRevived(k1), '학습값 없는 새 태그는 그냥 통과');
  chk(eqs.every((e) => app.state.knownTags.indexOf(e.table + ':' + e.name) >= 0), '현재 태그가 knownTags에 기록된다', String(app.state.knownTags.length));
}

// ── 이미 알던 태그는 제외 (평범한 재시작) ───────────────────────
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0);
  app._blMap = { [k0]: { mu: 2.1, sigma: 0.2, k: 3, at: 1 } };
  app.state.knownTags = eqs.map((e) => e.table + ':' + e.name);   // 여태 보던 태그들
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(!app._isRevived(k0), '알던 태그는 학습값이 있어도 확인을 묻지 않는다 — 매 부팅마다 물으면 안 된다');
}

// ── 대역 학습만 있어도 감지 ──────────────────────────────────────────────
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0);
  app._blMap = { [k0 + ':fault']: { mu: 1.0, sigma: 0.1, k: 3 } };   // RMS는 미학습, 대역만 학습
  app.state.knownTags = ['OTHER:TAG'];
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(app._isRevived(k0), '대역 학습값만 남아 있어도 확인 대기', JSON.stringify(app.state.revived));
}

// ── 사라진 태그의 표시 정리 ──────────────────────────────────────────
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const gone = eqs[0].table + ':GHOST_TAG';   // 선택된 테이블 안에서 사라진 태그
  app._blMap = {};
  app.state.knownTags = eqs.map((e) => e.table + ':' + e.name).concat([gone]);
  app.state.revived = { [gone]: 1 };
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(!app.state.revived[gone], '지금 없는 태그의 확인 표시는 지운다');
  chk(app.state.knownTags.indexOf(gone) < 0, '사라진 태그는 knownTags에서 빠진다 — 다시 나타나면 잡히도록');
}

// ── 확인 대기 중에는 학습값을 서버에 굽지 않음 ───────────────────────────
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0), k1 = keyOf(app, 1);
  const bl = { mu: 2.1, sigma: 0.2, k: 3, at: 1 };
  app._blMap = { [k0]: bl, [k1]: bl };
  app.state.baselines = app._blMap;
  app.state.revived = { [k0]: Date.now() };
  const spec = app._monSpec();
  const t0 = spec.tags.find((t) => t.tbl + ':' + t.tag === k0);
  const t1 = spec.tags.find((t) => t.tbl + ':' + t.tag === k1);
  chk(t0 && t0.bl === null, '확인 대기 태그는 서버 TQL에 베이스라인이 안 실린다', JSON.stringify(t0 && t0.bl));
  chk(t0 && t0.bb === null, '대역 기준도 안 실린다');
  chk(t1 && t1.bl && t1.bl.mu === 2.1, '다른 태그는 그대로 실린다', JSON.stringify(t1 && t1.bl));
  /* 존 경계는 학습과 무관한 절대 기준이라 계속 판정 — 멈추면 확인 지연 동안 감시 공백 */
  chk(t0 && Array.isArray(t0.zones) && t0.zones.length === 3, 'ISO 존 경계는 그대로 실린다 — 절대 기준이라 계속 판정');
}

// ── 베이스라인 로드 전에는 판단 보류 ─────────────────────────────────
/* 판단 근거가 학습값 유무라 로드 전 호출 시 전부 "학습값 없음"으로 보여 아무것도 안 걸림 */
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0);
  app._blMap = undefined;              // 아직 로드 전
  app.state.knownTags = ['OTHER:TAG'];
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(!app._isRevived(k0) && app.state.knownTags.length === 1,
    '베이스라인 로드 전에는 아무것도 판단하지 않는다 (knownTags도 안 굳힌다)',
    JSON.stringify(app.state.knownTags));
  // 로드 후 호출 시 감지
  app._blMap = { [k0]: { mu: 2.1, sigma: 0.2, k: 3, at: 1 } };
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(app._isRevived(k0), '로드 후에 부르면 확인 대기로 잡힌다');
}

// ── 첫 실행 — 지워진 적 없는 태그는 묻지 않음 ──────────────────────────
/* 첫 실행엔 knownTags 없음 — "처음 보는 태그"로 판단하면 학습된 전 태그가 확인 대상 → 현재 목록을 그대로 굳힘 */
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0);
  app._blMap = { [k0]: { mu: 2.1, sigma: 0.2, k: 3, at: 1 } };
  app.state.knownTags = null;          // 아직 목록을 만든 적 없음(설정에 저장된 적 없음)
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(!app._isRevived(k0), '첫 실행에는 학습값이 있어도 묻지 않는다', JSON.stringify(app.state.revived));
  chk(Array.isArray(app.state.knownTags) && app.state.knownTags.length === 3,
    '첫 실행은 현재 태그를 그대로 아는 목록으로 굳힌다', String(app.state.knownTags && app.state.knownTags.length));
  // 이후 학습값 가진 새 태그가 나타나면 확인 요청
  app._blMap['GHOST:G1'] = { mu: 1, sigma: 0.1, k: 3 };
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name).concat(['GHOST:G1']), [...new Set(eqs.map((e) => e.table))].concat(['GHOST']));
  chk(app._isRevived('GHOST:G1'), '목록이 굳은 뒤에 나타난 태그는 묻는다');
}

// ── 테이블 선택 해제·재선택은 되살아남 아님 ─────────────────────────
/* _activeEqs는 선택 테이블로 거름 — 테이블을 뺐다 넣으면 태그가 목록에서 빠졌다 돌아오지만 설비 변경 아님 */
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0);
  const tbl = eqs[0].table;
  app._blMap = {};
  eqs.forEach((e) => { app._blMap[e.table + ':' + e.name] = { mu: 2, sigma: 0.2, k: 3, at: 1 }; });
  app.state.knownTags = eqs.map((e) => e.table + ':' + e.name);
  // 테이블 선택 해제 — 그 테이블 태그는 목록에서 빠짐
  app.state.srcSel = (app.state.srcSel || []).filter((t) => t !== tbl);
  app._checkRevived(eqs.filter((e) => e.table !== tbl).map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(app.state.knownTags.indexOf(k0) >= 0, '선택 해제된 테이블의 태그는 아는 목록에 남는다', String(app.state.knownTags.length));
  // 다시 선택
  app.state.srcSel = [...new Set(eqs.map((e) => e.table))];
  app._checkRevived(eqs.map((e) => e.table + ':' + e.name), app.state.srcSel);
  chk(!app._isRevived(k0), '테이블을 다시 선택해도 확인을 묻지 않는다', JSON.stringify(app.state.revived));
}

// ── 앱이 도는 동안 사라졌다 돌아온 경우 (재시작 없이) ─────────────────────
/* 카탈로그 틱(10초)에서도 같은 검사 — 부팅 때만 검사하면 실행 중 사라졌다 돌아온 태그가 통과 */
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0);
  const tables = [...new Set(eqs.map((e) => e.table))];
  const allKeys = eqs.map((e) => e.table + ':' + e.name);
  app._blMap = { [k0]: { mu: 2.1, sigma: 0.2, k: 3, at: 1 } };
  app.state.knownTags = allKeys.slice();
  // ① 조회 결과에서 k0 빠짐 = 사라짐
  app._checkRevived(allKeys.filter((k) => k !== k0), tables);
  chk(app.state.knownTags.indexOf(k0) < 0, '도는 중에 사라지면 아는 목록에서 빠진다');
  chk(!app._isRevived(k0), '사라진 동안에는 묻지 않는다 — 물어볼 대상이 없다');
  // ② 재등장
  app._checkRevived(allKeys, tables);
  chk(app._isRevived(k0), '돌아오면 재시작 없이 그 자리에서 확인을 묻는다', JSON.stringify(app.state.revived));
}

// ── 조회 실패 테이블은 사라짐으로 보지 않음 ─────────────────────────
/* 일시적 조회 실패(수집기 재시작 등)를 삭제로 오판하면 멀쩡한 학습이 확인 대상이 됨 */
{
  const app = makeApp();
  const eqs = app.data.equipment;
  const k0 = keyOf(app, 0);
  const tbl = eqs[0].table;
  const allKeys = eqs.map((e) => e.table + ':' + e.name);
  app._blMap = { [k0]: { mu: 2.1, sigma: 0.2, k: 3, at: 1 } };
  app.state.knownTags = allKeys.slice();
  // tbl 조회가 실패해 범위에서 빠진 상황
  const okTables = [...new Set(eqs.map((e) => e.table))].filter((t) => t !== tbl);
  app._checkRevived(allKeys.filter((k) => !k.startsWith(tbl + ':')), okTables);
  chk(app.state.knownTags.indexOf(k0) >= 0, '조회 실패 테이블의 태그는 목록에 남는다');
  app._checkRevived(allKeys, [...new Set(eqs.map((e) => e.table))]);
  chk(!app._isRevived(k0), '조회가 회복돼도 확인을 묻지 않는다');
}

// ── 확인 처리 ──────────────────────────────────────────────────────────────
{
  const app = makeApp();
  const k0 = keyOf(app, 0);
  app.state.revived = { [k0]: 1 };
  app._keepLearned(k0);
  chk(!app._isRevived(k0), '"같은 설비 — 유지"는 표시만 지운다');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
