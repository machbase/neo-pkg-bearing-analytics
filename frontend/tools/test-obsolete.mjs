/* 업데이트 고아 파일 정리 — 오프라인(Neo 불필요) · npm run smoke 포함
   · scripts/obsolete.json 항목이 레포에 없음(있으면 업데이트가 쓰는 파일을 지움)·중복 없음·정리 규칙 통과
   · 정리 스크립트 동작과 거부 규칙(절대경로·'..'·보호 경로와 그 상위) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { runCleanup, judge, PROTECTED } = require(path.join(ROOT, 'scripts', 'cleanup.js'));

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};

// ── 실제 목록 ───────────────────────────────────────────────────────────
{
  let list = null, err = '';
  try { list = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'obsolete.json'), 'utf8')).remove; } catch (e) { err = e.message; }
  chk(Array.isArray(list) && list.length > 0, 'obsolete.json 을 읽는다', err || (list && list.length + '개'));
  list = list || [];
  const bad = list.map((p) => [p, judge(p, ROOT).verdict]).filter(([, v]) => v !== 'ok');
  chk(bad.length === 0, '모든 항목이 정리 규칙을 통과한다(보호 경로·패키지 밖이 아님)', bad.map((b) => b.join('=')).join(', '));
  const alive = list.filter((p) => fs.existsSync(path.join(ROOT, p)));
  chk(alive.length === 0, '목록의 경로가 레포에 없다 — 있으면 업데이트가 쓰는 파일을 지운다', alive.join(', '));
  const dup = list.filter((p, i) => list.indexOf(p) !== i);
  chk(dup.length === 0, '중복 항목이 없다', dup.join(', '));
  chk(PROTECTED.indexOf('cgi-bin/tql') >= 0, '계정별 타이머 스크립트 폴더는 보호된다');
  const inst = fs.readFileSync(path.join(ROOT, 'scripts', 'install.js'), 'utf8');
  chk(/require\('\.\/cleanup'\)\.runCleanup\(PKG_ROOT\)/.test(inst), 'install.js 가 설치·업데이트 때 정리를 부른다');
}

// ── 정리 동작 — 임시 폴더에서 ─────────────────────────────────────────────
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'obsolete-'));
  const root = path.join(base, 'pkg');
  const put = (rel, body) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body || 'x'); };
  put('old/a.txt'); put('old/dir/b.txt'); put('old/dir/c.txt');
  put('cgi-bin/tql/JOY/monitor.tql'); put('cgi-bin/config/equipment.json'); put('scripts/install.js'); put('keep.txt');
  fs.writeFileSync(path.join(base, 'outside.txt'), 'x');
  put('scripts/obsolete.json', JSON.stringify({ remove: [
    'old/a.txt', 'old/dir/', 'missing.txt',
    '../outside.txt', path.join(base, 'outside.txt'), 'old/../keep.txt', '',
    'cgi-bin/tql', 'cgi-bin/tql/JOY/monitor.tql', 'cgi-bin', 'cgi-bin/config/equipment.json', 'scripts', 'scripts/install.js',
  ] }));
  const s = runCleanup(root);
  const ex = (rel) => fs.existsSync(path.join(root, rel));
  chk(!ex('old/a.txt') && !ex('old/dir'), '목록의 파일과 폴더를 지운다', JSON.stringify(s));
  chk(s.removed === 2 && s.absent === 1 && s.failed === 0, '없는 항목은 건너뛰고 센다');
  chk(fs.existsSync(path.join(base, 'outside.txt')) && ex('keep.txt'), "패키지 밖·'..' 경로는 거부한다");
  chk(ex('cgi-bin/tql/JOY/monitor.tql') && ex('cgi-bin/config/equipment.json') && ex('scripts/install.js'),
    '보호 경로는 목록에 있어도 지우지 않는다 — 그 상위 폴더(cgi-bin·scripts)를 적어도 마찬가지');
  chk(s.refused === 10, '거부한 항목 수', s.refused);
  fs.rmSync(path.join(root, 'scripts', 'obsolete.json'));
  const s2 = runCleanup(root);
  chk(s2.removed === 0 && s2.failed === 0, '목록이 없으면 아무것도 하지 않는다(설치를 막지 않는다)');
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
