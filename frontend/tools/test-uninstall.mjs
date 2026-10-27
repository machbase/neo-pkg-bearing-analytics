/* 패키지 제거 스크립트(scripts/uninstall.js) — 타이머 자동 삭제 없이 안내만
   · 서버 호출·로그인 없음(타이머 API는 계정별 API 토큰 전용)
   · 코드에 계정·비밀번호·토큰 없음, 남은 타이머 처리 안내 출력
   jsh 모듈 없이 실행 · 오프라인(Neo 불필요) · npm run smoke 포함 */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../../scripts/uninstall.js', import.meta.url), 'utf8');
let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};

// ── 코드에 자격증명·서버 호출 없음 ──────────────────────────────────────
chk(!/MANAGER/i.test(SRC) && !/'SYS'/.test(SRC) && !/neo-auth/.test(SRC) && !/password/i.test(SRC) && !/nt_[A-Za-z0-9]/.test(SRC),
  '코드에 기본 계정·비밀번호·토큰 없음');
chk(!/require\s*\(/.test(SRC) && !/\/web\/|\/db\//.test(SRC), 'jsh 모듈·서버 경로를 쓰지 않음');

// ── 실행 — require가 호출되면 실패로 기록 ───────────────────────────────
const out = [], required = [];
const req = (n) => { required.push(n); throw new Error('module not allowed: ' + n); };
let threw = null;
try { new Function('require', 'console', SRC)(req, { println: (s) => out.push(String(s)) }); } catch (e) { threw = e; }
const text = out.join('\n');
chk(!threw, '오류 없이 끝남(제거를 막지 않음)', threw && threw.message);
chk(required.length === 0, '모듈 로드 없음', required.join(','));
chk(/uninstalled/.test(text), '제거 완료 문구');
chk(/NEO_BEARING_\*/.test(text) && /STOP, not found/.test(text), '남은 타이머가 다음 회차에 멈춘다는 안내');
chk(/Neo 타이머 화면에서 계정마다 NEO_BEARING_\* 항목을 삭제/.test(text), '타이머 화면에서 삭제하라는 안내');
chk(/다시 설치한 뒤 앱을 열면/.test(text), '재설치 시 앱이 다시 등록한다는 안내');

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
