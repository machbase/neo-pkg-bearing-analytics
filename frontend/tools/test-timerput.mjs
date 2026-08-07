// 타이머 등록 경로 검사 — 오프라인. npm run smoke에 포함.
// 핵심 주장: 지울 것이 없으면 지우러 가지 않는다.
// Neo는 없는 타이머 DELETE에 500을 준다. 첫 등록이 늘 그 경우라, 새 설치가 감시를 켜는 순간
// 감시·대역·감시자가 빨간 요청을 하나씩 남긴다 — 동작은 멀쩡해서 오히려 고장으로 읽힌다.
globalThis.window = globalThis;
const DB = (await import('../../cgi-bin/db/db.js')).default;

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};

// ── Neo 대역(帶域) 흉내 — 요청을 기록하고 실제 서버처럼 답한다 ─────────────
let listed = {};        // 지금 등록돼 있는 타이머
let listOk = true;      // 목록 조회가 되는가
let createOk = true;    // 생성이 성공하는가
let seen = [], noise = 0;   // noise = 서버가 5xx로 답한 횟수
const res = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
globalThis.fetch = (url, opts) => {
  const m = (opts && opts.method) || 'GET';
  seen.push(m + ' ' + url);
  if (url === '/web/api/login') return res({ success: true, accessToken: 'tok' });
  if (url.startsWith('/web/api/files')) return res({ success: true });
  if (url === '/web/api/timers' && m === 'GET') {
    if (!listOk) { noise++; return res({ success: false, reason: 'boom' }, false); }
    return res({ data: Object.keys(listed).map((n) => ({ name: n, state: 'RUNNING' })) });
  }
  if (url === '/web/api/timers' && m === 'POST') {
    if (!createOk) return res({ success: false, reason: 'duplicate name' });
    listed[JSON.parse(opts.body).name] = true;
    return res({ success: true });
  }
  if (m === 'DELETE') {
    const name = url.split('/').pop();
    if (!listed[name]) { noise++; return res({ success: false, reason: 'not found' }, false); }  // Neo가 500을 주는 자리
    delete listed[name];
    return res({ success: true });
  }
  return res({ success: true });
};
const run = async (setup, known, opt) => {
  listed = {}; listOk = true; createOk = !(opt && opt.createFails); seen = []; noise = 0;
  Object.assign(listed, setup || {});
  seen = [];  // 로그인·인증파일 확인은 첫 회차에만 나므로 계산에서 뺀다
  await DB.createMonitorTimer('SQL()', '@every 10s', known).catch((e) => { seen.push('THROW ' + e.message); });
  return {
    del: seen.filter((s) => s.startsWith('DELETE')).length,
    get: seen.filter((s) => s === 'GET /web/api/timers').length,
    post: seen.filter((s) => s === 'POST /web/api/timers').length,
    file: seen.filter((s) => s.includes('/cgi-bin/monitor.tql')).length,
    threw: seen.some((s) => s.startsWith('THROW')),
    noise, seen,
  };
};
await run({}, 'absent');   // 로그인 왕복을 미리 끝내 둔다 — 이후 계산에 섞이지 않게

// ── 1. 켜는 순간 — 없다는 것을 이미 안다 ──────────────────────────────────
{
  const r = await run({}, 'absent');
  chk(r.file === 1 && r.post === 1, 'TQL을 쓰고 등록한다', `파일 ${r.file} · 등록 ${r.post}`);
  chk(r.del === 0, '없는 타이머를 지우러 가지 않는다', `DELETE ${r.del}건`);
  chk(r.get === 0, '아는 것을 다시 조회하지 않는다', `GET ${r.get}건`);
  chk(r.noise === 0, '5xx 응답이 하나도 없다', `${r.noise}건`);
}

// ── 2. 설정을 바꿔 다시 굽는다 — 우리가 만든 것이 돌고 있다 ────────────────
{
  const r = await run({ NEO_VIBE_MONITOR: true }, 'present');
  chk(r.del === 1 && r.post === 1, '있는 것을 지우고 다시 만든다', `DELETE ${r.del} · POST ${r.post}`);
  chk(r.get === 0, '아는 상태면 조회하지 않는다', `GET ${r.get}건`);
  chk(r.noise === 0, '5xx 응답 없음', `${r.noise}건`);
}

// ── 3. 모르는 상태(앱을 새로 열었다) — 한 번 읽고 판단한다 ─────────────────
{
  const r = await run({}, null);
  chk(r.get === 1 && r.del === 0 && r.post === 1, '목록에 없으면 삭제를 건너뛴다', `GET ${r.get} · DELETE ${r.del}`);
  chk(r.noise === 0, '5xx 응답 없음', `${r.noise}건`);

  const r2 = await run({ NEO_VIBE_MONITOR: true }, null);
  chk(r2.get === 1 && r2.del === 1 && r2.post === 1, '목록에 있으면 지운 뒤 만든다', `GET ${r2.get} · DELETE ${r2.del}`);
  chk(r2.noise === 0, '5xx 응답 없음', `${r2.noise}건`);
}

// ── 4. 목록을 못 읽으면 지워 본다 ──────────────────────────────────────────
{
  /* 남아서 도는 것보다 낫다 — 확인이 안 된다고 손을 놓으면 옛 코드가 계속 판정한다.
     이때만 500이 날 수 있는데, 그건 조회가 이미 실패한 상황이라 소음이 아니라 증상이다. */
  listed = {}; listOk = false; createOk = true; seen = []; noise = 0;
  await DB.createMonitorTimer('SQL()', '@every 10s', null);
  chk(seen.filter((s) => s.startsWith('DELETE')).length === 1, '상태를 모르면 지워 본다');
}

// ── 5. 아는 것이 틀렸으면 실패로 돌려준다 ──────────────────────────────────
{
  /* 다른 세션이 만들어 둔 경우다. 조용히 넘기면 옛 타이머가 새 설정인 척 계속 돈다 —
     호출측이 서명을 비우고 다음 회차에 '모름' 경로로 되돌아오도록 예외를 낸다. */
  const r = await run({ NEO_VIBE_MONITOR: true }, 'absent', { createFails: true });
  chk(r.threw, '생성 실패는 삼키지 않는다', r.seen.join(' · '));
}

// ── 6. 세 타이머가 같은 경로를 쓴다 ────────────────────────────────────────
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
  ['createMonitorTimer', 'createBandTimer', 'createWdTimer'].forEach((fn) => {
    const i = src.indexOf('function ' + fn + '(');
    const body = i >= 0 ? src.slice(i, i + 260) : '';
    chk(i >= 0 && /putTimer\(/.test(body) && /known/.test(body), fn + '이 putTimer로 등록한다');
  });
}

// ── 7. 앱이 아는 것을 실제로 넘기는가 ──────────────────────────────────────
{
  /* 위 검사는 "이렇게 부르면 맞다"까지만 본다. 인자를 안 넘기면 전부 '모름' 경로로 떨어져
     조회가 하나씩 붙는다 — 검사는 통과하는데 요청은 안 줄어든다. */
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const bodyOf = (m) => { const i = app.indexOf('\n  ' + m + '(silent) {'); return i < 0 ? '' : app.slice(i, i + 2600); };
  [['_syncMonitorTimer', 'createMonitorTimer', '_specSig'], ['_syncBandTimer', 'createBandTimer', '_bandSig'],
    ['_syncWdTimer', 'createWdTimer', '_wdSig']].forEach(([m, fn, sig]) => {
    const body = bodyOf(m);
    const call = body.split('\n').find((l) => l.includes(fn + '('));
    chk(body.includes("_timerKnown('" + sig + "')") && !!call && /,\s*[^)]+,\s*[^)]+\)/.test(call),
      m + '이 ' + sig + ' 기억을 등록에 넘긴다', call && call.trim());
  });
  /* 감시자만 서명을 등록 전에 대입한다 — 그 뒤에 읽으면 방금 넣은 값이라 늘 '있음'이 되고,
     첫 등록에서 500이 그대로 난다. */
  const wdBody = bodyOf('_syncWdTimer');
  chk(wdBody.indexOf("_timerKnown('_wdSig')") < wdBody.indexOf('this._wdSig = sig'),
    '감시자는 서명을 넣기 전에 기억을 읽는다');
}

// ── 8. 언인스톨 안전망이 만든 타이머 전부를 지우는가 ──────────────────────
{
  /* 앱을 거치지 않고 Neo UI에서 바로 제거하면 이 스크립트가 유일한 정리 지점이다.
     빠뜨린 타이머는 실행할 TQL이 패키지와 함께 사라진 채로 목록에 남아 주기마다 실패한다.
     이름이 db.js와 갈라져도 같은 결과라 두 목록을 대조한다. */
  const fs = await import('node:fs');
  const db = fs.readFileSync(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
  const un = fs.readFileSync(new URL('../../scripts/uninstall.js', import.meta.url), 'utf8');
  const names = ['MON_TIMER', 'BAND_TIMER', 'WD_TIMER'].map((v) => {
    const m = new RegExp('var ' + v + " = '([^']+)'").exec(db);
    return m && m[1];
  });
  chk(names.every(Boolean), 'db.js에서 타이머 이름 셋을 읽는다', String(names));
  names.forEach((n) => chk(!!n && un.includes("'" + n + "'"), 'uninstall이 ' + n + '을 지운다'));
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
