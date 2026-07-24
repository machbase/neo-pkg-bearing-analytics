// dist/ 전체(index.html + public 자산)를 패키지 루트로 복사한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
const pkgRoot = path.join(__dirname, '..', '..');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html not found — run vite build first');
  process.exit(1);
}
fs.cpSync(dist, pkgRoot, { recursive: true });
// Neo 앱 런처는 main.html을 연다(llm-chat도 index/main 이중 복사) — 동일 내용으로 생성
fs.copyFileSync(path.join(pkgRoot, 'index.html'), path.join(pkgRoot, 'main.html'));
console.log('deployed dist/ ->', pkgRoot, '(+ main.html)');
