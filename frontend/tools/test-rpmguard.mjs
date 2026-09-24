// 회전수 미설정 가드 — 폴백 1800을 넣으면 2극(3600)·6극(1200) 설비에서 결함주파수 격자와
// 대역 경계가 통째로 어긋나는데 화면은 평소처럼 등급을 낸다. 조용한 오진이라 눈에 안 띈다.
globalThis.window = globalThis;
const { App } = await import('../src/app.js');
const CH = (await import('../../cgi-bin/chart/chart.js')).default;
const VC = (await import('../../cgi-bin/calc/calc.js')).default;
const Band = (await import('../../cgi-bin/monitor/band.js')).default;

let fail = 0;
const chk = (c, label, extra) => {
  if (c) console.log('PASS', label, extra === undefined ? '' : extra);
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); }
};

// ── 1× 상대 대역은 회전수 없이 정의되지 않는다 ────────────────────────────────
{
  const nyq = 12800;
  const off = Band.bandsFor(0, nyq);
  const on = Band.bandsFor(30, nyq);
  chk(off.length === on.length, '대역 개수는 그대로 — 배열 모양이 바뀌면 학습·판정이 인덱스로 어긋난다',
    off.length + '/' + on.length);
  /* 폭 0이면 에너지가 0이고, 학습은 전부 0인 대역을 거부하며 판정은 한계 0인 대역을 건너뛴다.
     이미 있는 경로라 별도 분기를 만들지 않는다. */
  chk(off.slice(0, 4).every((b) => b[1] - b[0] === 0),
    '1× 상대 4대역(sub·one·fault·high)은 폭 0 — 추측한 경계로 재느니 안 재는 게 맞다',
    JSON.stringify(off.slice(0, 4)));
  chk(off.slice(4).every((b) => b[1] > b[0]),
    '절대 주파수 대역(vh1~vh4)은 회전수와 무관하므로 그대로 산다', JSON.stringify(off.slice(4)));
  chk(on.slice(0, 4).every((b) => b[1] > b[0]), '회전수가 있으면 네 대역이 정상 폭을 갖는다');
}

// ── 커버리지: 회전수가 없으면 두 축이 "측정 불가"로 빠진다 ────────────────────
{
  const app = new App({ seed: 1, equipmentCount: 1 });
  app.E = CH;
  const base = { id: 'T:x', table: 'T', name: 'x', unit: 'mm/s', cls: 'II', fs: 25600,
    bearing: { model: '직접입력', n: 9, Bd: 7.94, Pd: 39.04, phi: 0 } };
  const noRpm = Object.assign({}, base, { rpm: 0 });
  const withRpm = Object.assign({}, base, { rpm: 1800 });
  // 판정에 필요한 최소 det — 스펙트럼은 비어 있어도 커버리지·판정문 경로는 그대로 돈다
  const emptySp = { freqs: [], mags: [], res: 1 };
  const det = { quality: null, raw: { values: [] }, isoRms: 0.5, indics: [],
    fft: emptySp, env: emptySp, envQ: null, ordSpec: emptySp, bandSet: null,
    bandAt: null, frMeas: null, levels: {}, anchorMs: 1 };

  const a = app._dx(noRpm, det, null);
  const b = app._dx(withRpm, det, null);
  chk(a.cov.missing.indexOf('결함 패턴') >= 0,
    '회전수 없으면 결함 패턴 축이 빠진 것으로 표시된다 — 0점이 아니라 측정 불가', a.cov.missing.join('·'));
  chk(a.cov.extra.indexOf('대역') < 0, '대역 축도 참여하지 않는다', JSON.stringify(a.cov.extra));
  chk(/회전수 미상/.test(a.verdict), '판정문이 사유를 이름으로 말한다', a.verdict);
  chk(!/회전수 미상/.test(b.verdict), '회전수가 있으면 그 문구가 안 뜬다', b.verdict);
}

// ── 결함주파수는 회전수 없이 못 낸다 ──────────────────────────────────────────
{
  const geo = { n: 9, Bd: 7.94, Pd: 39.04, phi: 0 };
  const f0 = VC.bearingFreqs(0, geo), f1 = VC.bearingFreqs(1800, geo);
  chk(!(f0.BPFO > 0), '회전수 0이면 BPFO가 서지 않는다 — 격자가 만들어질 수 없다', String(f0.BPFO));
  chk(f1.BPFO > 0, '회전수가 있으면 BPFO가 선다', f1.BPFO.toFixed(2));
}

// ── 배너가 사라지는가 ────────────────────────────────────────────────────────
/* "회전수를 넣어라"는 배너는 사람이 설비 정보를 채워야만 풀린다. 그 계산이 서명(sig) 검사
   뒤에 있으면, 다른 경고가 그대로일 때 위에서 return 해 배너만 다시 재지 않는다 —
   값을 다 채워도 경고가 남고, 새로 걸린 태그는 반대로 안 뜬다. */
{
  const app = Object.create(App.prototype);
  const eqs = ['s1-c1', 's1-c2'].map((n) => ({
    id: 'NASA_LIVE:' + n, table: 'NASA_LIVE', name: n, alias: n,
    rpm: 0, bearing: { model: '', n: 0 }, lastSeen: Date.now(), stat: {},
  }));
  app.data = { now: Date.now(), equipment: eqs, events: [], reports: [] };
  app.state = { srcSel: ['NASA_LIVE'], equipRpm: {}, equipBearing: {}, equipGeo: {},
    monMode: 'app', monitorInterval: '10s', bandOn: false, knownTags: [], revived: {} };
  app._toast = () => {};
  let health = null;
  app.setState = (o) => { Object.assign(app.state, o); if ('health' in o) health = o.health; };

  app._applyHealth({}, null);
  const nogeo = (health || []).filter((w) => w.k === 'nogeo');
  chk(nogeo.length === 1, '회전수가 없으면 배너가 뜬다', nogeo.length ? nogeo[0].text.slice(0, 40) : '없음');

  // 값을 채운다 — 실제로는 설정 저장 뒤 _reloadLive 가 equipment 를 다시 굽는다
  eqs.forEach((e) => { e.rpm = 1800; e.bearing = { model: '6206', n: 9 }; });
  app._applyHealth({}, null);
  chk((health || []).filter((w) => w.k === 'nogeo').length === 0,
    '값을 채우면 배너가 사라진다 — sig 검사보다 먼저 재야 한다',
    JSON.stringify((health || []).map((w) => w.k)));

  // 반대 방향도 — 한 대만 다시 비면 배너가 돌아와야 한다
  eqs[0].rpm = 0;
  app._applyHealth({}, null);
  const back = (health || []).filter((w) => w.k === 'nogeo');
  chk(back.length === 1 && /1대/.test(back.text || back[0].text),
    '다시 비면 배너가 돌아온다', back.length ? back[0].text.slice(0, 34) : '없음');
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
