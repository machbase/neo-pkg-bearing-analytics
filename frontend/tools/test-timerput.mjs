// 타이머 등록 경로(JSON-RPC 2.0 `POST /db/rpc`, API 토큰) — 오프라인(Neo 불필요) · npm run smoke 포함
// · 경로·메서드·인자 모양·토큰 헤더 고정(다른 경로는 실패 응답 — 삼키면 "타이머 없음"으로 읽혀 매번 재생성)
// · 등록 전 목록 확인, 중복 전부 정지 후 id로 삭제, 삭제 실패 시 등록 중단, 조회 실패는 null
globalThis.window = globalThis;
const TOK = 'nt_t_' + 'T'.repeat(43);
const ls = { accessToken: 'h.' + Buffer.from(JSON.stringify({ sub: 'tester' })).toString('base64') + '.s', 'neo-pkg-bearing-analytics.token.TESTER': TOK };
globalThis.localStorage = { getItem: (k) => (k in ls ? ls[k] : null), setItem() {}, removeItem() {} };
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
const DB = (await import('../../cgi-bin/db/db.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── Neo 흉내 — RPC 호출 기록 + 실제 서버처럼 응답 ─────────────
let listed = {};        // 지금 등록돼 있는 타이머 (name → id)
let nextId = 1;
let listOk = true;      // 목록 조회 성공 여부
let addOk = true;
let deleteWorks = true;   // false면 삭제 요청 무시(증식 재현)
let rpcs = [];          // {method, params}
let files = [];
let http5xx = 0;
let noAuth = 0;      // 토큰 헤더 없이 나간 요청 수

const res = (body, ok = true) => Promise.resolve({
  ok, status: ok ? 200 : 500, json: () => Promise.resolve(body), text: () => Promise.resolve(''),
});
globalThis.fetch = (url, opts) => {
  const m = (opts && opts.method) || 'GET';
  if (((opts && opts.headers) || {}).Authorization !== 'Bearer ' + TOK) noAuth++;
  if (String(url).startsWith('/db/files')) { files.push(m + ' ' + url); return res({ success: true }); }
  if (url !== '/db/rpc') { http5xx++; return res({ success: false }, false); }
  const req = JSON.parse(opts.body);
  rpcs.push({ method: req.method, params: req.params });
  const rpcRes = (result) => res({ jsonrpc: '2.0', id: req.id, result });
  const rpcErr = (message) => res({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message } });
  if (req.method === 'timer.list') {
    if (!listOk) return rpcErr('boom');
    const out = [];
    Object.keys(listed).forEach((nm) => listed[nm].forEach((id) =>
      out.push({ id, name: nm, state: 'RUNNING', task: '/t.tql', schedule: '@every 3s' })));
    return rpcRes(out);
  }
  if (req.method === 'timer.add') {
    if (!addOk) return rpcErr('duplicate name');
    const nm = req.params[0].name;
    (listed[nm] = listed[nm] || []).push(nextId++);
    return rpcRes(1);
  }
  if (req.method === 'timer.stop') return rpcRes(null);
  if (req.method === 'timer.delete') {
    if (!deleteWorks) return rpcRes(null);
    Object.keys(listed).forEach((nm) => {
      listed[nm] = listed[nm].filter((id) => id !== req.params[0]);
      if (!listed[nm].length) delete listed[nm];
    });
    return rpcRes(null);
  }
  return rpcErr('unknown method ' + req.method);
};
const reset = () => { rpcs = []; files = []; http5xx = 0; noAuth = 0; };
const only = (m) => rpcs.filter((r) => r.method === m);

console.log('\n== 첫 등록 — 지울 것이 없다 ==');
{
  reset(); listed = {};
  await DB.createMonitorTimer('SCRIPT({})', '@every 3s');
  chk(files.length === 1 && only('timer.add').length === 1, 'TQL을 쓰고 등록한다', `파일 ${files.length} · 등록 ${only('timer.add').length}`);
  chk(only('timer.delete').length === 0 && only('timer.stop').length === 0, '없는 타이머를 지우러 가지 않는다');
  /* 등록 전 반드시 목록 확인 — 호출측 "없음 확인"만 믿으면 한 번의 오판으로 같은 이름 추가(Neo는 이름 중복 허용) */
  chk(only('timer.list').length === 1, '등록 전에 목록을 확인한다');
  chk(http5xx === 0, '다른 경로로 새지 않는다');
  chk(noAuth === 0, '파일 저장·RPC 모두 토큰을 싣는다', String(noAuth));
}

console.log('\n== 인자 모양 — 여기가 틀리면 조용히 404/Parse error ==');
{
  reset(); listed = {};
  await DB.createMonitorTimer('SCRIPT({})', '@every 7s');
  const add = only('timer.add')[0];
  chk(Array.isArray(add.params), 'params 는 배열이다 (객체면 Parse error)');
  const a = add.params[0];
  chk(a && typeof a.name === 'string' && a.name.length > 0, 'name 을 보낸다', a && a.name);
  chk(a && a.spec === '@every 7s', 'schedule 이 아니라 spec 으로 보낸다', a && JSON.stringify(a.spec));
  chk(a && typeof a.command === 'string' && /\.tql$/.test(a.command), 'path 가 아니라 command 로 보낸다', a && a.command);
  chk(a && a.autoStart === true, 'autoStart 를 켠다');
}

console.log('\n== 이미 있는 것 — 멈추고 지우고 다시 만든다 ==');
{
  reset(); listed = {}; listed[DB.monTimer()] = [42];
  await DB.createMonitorTimer('SCRIPT({})', '@every 3s');
  chk(only('timer.delete').length === 1 && only('timer.add').length === 1, '있는 것을 지우고 다시 만든다',
    `delete ${only('timer.delete').length} · add ${only('timer.add').length}`);
  chk(only('timer.stop').length === 1, '지우기 전에 멈춘다');
  const si = rpcs.findIndex((r) => r.method === 'timer.stop');
  const di = rpcs.findIndex((r) => r.method === 'timer.delete');
  chk(si >= 0 && di > si, '정지가 삭제보다 먼저 간다');
  // 이름 아닌 id로 삭제 — 이름을 보내면 unmarshal 오류로 타이머 잔존
  chk(only('timer.stop')[0].params[0] === 42 && only('timer.delete')[0].params[0] === 42, 'id 로 멈추고 지운다',
    JSON.stringify(only('timer.delete')[0].params));
  chk(http5xx === 0, '다른 경로로 새지 않는다');
}

console.log('\n== 상태를 모를 때 — 목록을 한 번 읽는다 ==');
{
  reset(); listed = {};
  await DB.createMonitorTimer('SCRIPT({})', '@every 3s');
  chk(only('timer.list').length === 1 && only('timer.delete').length === 0, '목록에 없으면 삭제를 건너뛴다',
    `list ${only('timer.list').length} · delete ${only('timer.delete').length}`);

  reset(); listed = {}; listed[DB.monTimer()] = [7];
  await DB.createMonitorTimer('SCRIPT({})', '@every 3s');
  /* 조회 2회 = 삭제 전 1회 + 삭제 확인 1회(확인 없으면 삭제 실패가 중복 등록으로 이어짐) */
  chk(only('timer.list').length === 2 && only('timer.delete').length === 1, '목록에 있으면 지운 뒤 만든다',
    `list ${only('timer.list').length} · delete ${only('timer.delete').length}`);
  chk(only('timer.add').length === 1, '지운 뒤에만 만든다');
}

console.log('\n== 같은 이름이 여러 벌 쌓였을 때 ==');
{
  /* 하나만 지우면 나머지가 같은 TQL을 계속 돌리며 잠금을 서로 뺏음 — 화면엔 정상으로 보임 */
  reset(); listed = {}; listed[DB.monTimer()] = [11, 12, 13];
  await DB.createMonitorTimer('SCRIPT({})', '@every 3s');
  chk(only('timer.delete').length === 3, '중복을 전부 지운다', `delete ${only('timer.delete').length}`);
  chk(only('timer.stop').length === 3, '지우기 전에 각각 멈춘다');
  chk(only('timer.delete').map((r) => r.params[0]).sort().join(',') === '11,12,13', '세 id 를 모두 지운다',
    only('timer.delete').map((r) => r.params[0]).join(','));
  chk(listed[DB.monTimer()].length === 1, '끝나면 한 벌만 남는다', JSON.stringify(listed[DB.monTimer()]));
}

console.log('\n== 지우지 못하면 만들지 않는다 ==');
{
  /* 삭제가 안 듣는 서버에서 그냥 만들면 같은 이름이 계속 증식 — 삭제 확인 후 안 지워졌으면 등록 중단 */
  reset(); listed = {}; listed[DB.monTimer()] = [21];
  const keep = listed[DB.monTimer()].slice();
  const origDel = 'timer.delete';
  deleteWorks = false;                       // 삭제가 무시되는 서버 흉내
  let threw = null;
  await DB.createMonitorTimer('SCRIPT({})', '@every 3s').catch((e) => { threw = e; });
  deleteWorks = true;
  chk(threw !== null, '지우지 못하면 에러로 올린다', threw && String(threw.message).slice(0, 40));
  chk(only('timer.add').length === 0, '지우지 못하면 만들지 않는다 — 여기가 증식의 차단점');
  chk(listed[DB.monTimer()].join(',') === keep.join(','), '원래 있던 것은 그대로 둔다');
}

console.log('\n== 조회가 안 될 때 ==');
{
  reset(); listed = {}; listOk = false;
  await DB.createMonitorTimer('SCRIPT({})', '@every 3s');
  listOk = true;
  // 상태를 모르면 삭제 시도 — 남은 옛 스펙 지속 방지
  chk(only('timer.add').length === 1, '조회 실패해도 등록은 한다');
}

console.log('\n== 생성 실패 ==');
{
  reset(); listed = {}; addOk = false;
  let threw = false;
  await DB.createMonitorTimer('SCRIPT({})', '@every 3s', 'absent').catch(() => { threw = true; });
  addOk = true;
  chk(threw, '생성 실패는 삼키지 않는다 — 호출측이 배너를 띄워야 한다');
}

console.log('\n== 상태 조회 ==');
{
  reset(); listed = {}; listed['NEO_BEARING_MONITOR_JOY'] = [3];
  const m = await DB.timerStates();
  chk(m && m['NEO_BEARING_MONITOR_JOY'] && m['NEO_BEARING_MONITOR_JOY'].state === 'RUNNING', '이름으로 찾을 수 있게 돌려준다');
  chk(m['NEO_BEARING_MONITOR_JOY'].id === 3, 'id 를 같이 준다 — 삭제에 필요하다');
  // 같은 이름이 여럿이면 id 전부 보관 — 하나만 기억하면 나머지 삭제 불가
  reset(); listed = {}; listed['NEO_BEARING_MONITOR_JOY'] = [3, 4, 5];
  const d = await DB.timerStates();
  chk(d['NEO_BEARING_MONITOR_JOY'].ids.join(',') === '3,4,5', '중복된 id 를 모두 돌려준다',
    JSON.stringify(d['NEO_BEARING_MONITOR_JOY'].ids));
  reset(); listOk = false;
  const n = await DB.timerStates();
  listOk = true;
  chk(n === null, '조회 실패는 null(상태 모름) — 빈 목록으로 접지 않는다', String(n));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
