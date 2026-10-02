// 전체 학습 동시성 — 오프라인(Neo 불필요) · npm run smoke 포함
// · 병렬 학습 완료 콜백이 배치된 setState에서도 서로 덮어쓰지 않음(_blMerge)
// · 진행중 표시(_busySet/_isBusy)가 반영 전에도 동작, 맵 간 독립
globalThis.window = globalThis;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// preact 흉내 "배치" setState — state 반영 지연(즉시 반영이면 덮어쓰기가 안 드러남)
function mkApp() {
  const app = Object.create(App.prototype);
  app.state = { baselines: {}, blBusy: {}, bandBusy: {} };
  app._pending = [];
  app.setState = function (s) { this._pending.push(s); };            // 아직 state에 반영 안 함
  app.flush = function () { this._pending.forEach((s) => Object.assign(this.state, s)); this._pending = []; };
  return app;
}

// ── 병합 헬퍼 ──────────────────────────────────────────────────────────────
{
  const app = mkApp();
  // 태그 3개 "동시" 완료 — 그 사이 state 갱신 없음
  // 실제 호출부와 같은 형태: setState({ baselines: _blMerge(ent) })
  const patches = ['T:A', 'T:B', 'T:C'].map((k) => {
    const ent = {}; ent[k] = { mu: 1, sigma: 0.1, k: 3 };
    const m = app._blMerge(ent);
    app.setState({ baselines: m });
    return m;
  });
  const last = patches[patches.length - 1];
  chk(Object.keys(last).length === 3, '동시 완료 3건이 모두 남음 (덮어쓰기 없음)', Object.keys(last).join(','));
  chk(!!(last['T:A'] && last['T:B'] && last['T:C']), '앞선 태그 결과가 유실되지 않음');
  // preact 변경 감지용 사본 필요(같은 참조면 리렌더 없음)
  chk(patches[0] !== patches[1], '매 병합이 새 객체를 반환(참조 동일성으로 변경 감지)');
  app.flush();
  chk(Object.keys(app.state.baselines).length === 3, 'flush 후 state에도 3건');

  // 삭제도 같은 맵에서 — 삭제 후 다른 태그 완료 시 부활 없음
  const afterDrop = app._blMerge(null, ['T:B']);
  chk(!afterDrop['T:B'] && afterDrop['T:A'] && afterDrop['T:C'], '삭제가 대상만 지움');
  const ent = {}; ent['T:D'] = { mu: 2, sigma: 0.2, k: 3 };
  const afterAdd = app._blMerge(ent);
  chk(!afterAdd['T:B'], '삭제 뒤 다른 태그가 끝나도 지워진 키가 안 되살아남');
}

// ── 진행중 표시 ────────────────────────────────────────────────────────────
{
  const app = mkApp();
  ['T:A', 'T:B', 'T:C'].forEach((k) => app._busySet('blBusy', k, true));
  const busy = app._pending[app._pending.length - 1].blBusy;
  chk(Object.keys(busy).length === 3, '동시 시작 3건 모두 진행중 표시', Object.keys(busy).join(','));
  chk(app._isBusy('blBusy', 'T:A') && app._isBusy('blBusy', 'T:C'), '_isBusy가 반영 전에도 참');
  // 배치 지연 중에도 중복 클릭 가드 동작(같은 태그 이중 학습 방지)
  chk(app._isBusy('blBusy', 'T:B'), '반영 전 재클릭 가드');
  app._busySet('blBusy', 'T:B', false);
  chk(!app._isBusy('blBusy', 'T:B') && app._isBusy('blBusy', 'T:A'), '한 건 해제가 나머지에 영향 없음');
  // blBusy·bandBusy 상호 독립
  app._busySet('bandBusy', 'T:A', true);
  chk(app._isBusy('bandBusy', 'T:A') && app._isBusy('blBusy', 'T:A'), '두 맵이 독립');
  app._busySet('bandBusy', 'T:A', false);
  chk(!app._isBusy('bandBusy', 'T:A') && app._isBusy('blBusy', 'T:A'), '한 맵 해제가 다른 맵에 영향 없음');
}

// ── 대조군: 낡은 state 사본 병합 방식은 실제로 깨지는지 ─────────────────────
// 테스트가 덮어쓰기를 실제로 잡는지 확인
{
  const state = { baselines: {} };
  const pending = [];
  const oldWay = (k) => {                       // Object.assign 사본 병합
    const m = Object.assign({}, state.baselines);
    m[k] = { mu: 1 };
    pending.push(m);
    return m;
  };
  ['T:A', 'T:B', 'T:C'].forEach(oldWay);
  const lastOld = pending[pending.length - 1];
  chk(Object.keys(lastOld).length === 1, '옛 방식은 1건만 남음 — 테스트가 버그를 실제로 잡음', Object.keys(lastOld).join(','));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
