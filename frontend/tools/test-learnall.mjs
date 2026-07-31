// 전체 학습 동시성 검사 — 오프라인(Neo 불필요). npm run smoke에 포함.
// 여러 태그를 병렬 학습하면 setState가 배치되어 각 완료 콜백이 낡은 state를 복사한다.
// Object.assign({}, state.baselines)로 병합하면 마지막에 끝난 태그가 앞선 결과를 덮어써
// "맨 마지막 것만 학습됨"으로 보인다(DB엔 전부 저장되므로 새로고침하면 정상 — 표시만 유실).
globalThis.window = globalThis;
const { App } = await import('../src/app.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// preact를 흉내내는 "배치되는" setState — 실제 렌더 큐처럼 state 반영을 지연시킨다.
// 즉시 반영하는 setState로 테스트하면 이 버그가 통과해 버린다.
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
  // 태그 3개가 "동시에" 끝나는 상황 — 그 사이 state는 한 번도 갱신되지 않는다
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
  // 사본을 넘겨야 preact가 변경을 감지한다 — 같은 참조를 재사용하면 리렌더가 안 뜬다
  chk(patches[0] !== patches[1], '매 병합이 새 객체를 반환(참조 동일성으로 변경 감지)');
  app.flush();
  chk(Object.keys(app.state.baselines).length === 3, 'flush 후 state에도 3건');

  // 삭제도 같은 맵에서 — 삭제 후 다른 태그가 끝나도 되살아나지 않아야 한다
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
  // 중복 클릭 가드가 배치 지연 중에도 동작해야 한다(안 그러면 같은 태그가 두 번 학습된다)
  chk(app._isBusy('blBusy', 'T:B'), '반영 전 재클릭 가드');
  app._busySet('blBusy', 'T:B', false);
  chk(!app._isBusy('blBusy', 'T:B') && app._isBusy('blBusy', 'T:A'), '한 건 해제가 나머지에 영향 없음');
  // blBusy와 bandBusy는 서로 독립이어야 한다
  app._busySet('bandBusy', 'T:A', true);
  chk(app._isBusy('bandBusy', 'T:A') && app._isBusy('blBusy', 'T:A'), '두 맵이 독립');
  app._busySet('bandBusy', 'T:A', false);
  chk(!app._isBusy('bandBusy', 'T:A') && app._isBusy('blBusy', 'T:A'), '한 맵 해제가 다른 맵에 영향 없음');
}

// ── 회귀 대조: 옛 방식이면 실제로 깨지는지 ─────────────────────────────────
// 이 테스트가 진짜 버그를 잡는지 확인한다(통과만 하는 테스트는 쓸모없다)
{
  const state = { baselines: {} };
  const pending = [];
  const oldWay = (k) => {                       // 수정 전 코드 형태
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
