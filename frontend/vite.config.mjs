import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

// 패키지 버전은 하드코딩하지 않고 package.json에서 주입 — 두 곳에 적으면 반드시 어긋난다
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// base './' — Neo가 /web/apps/neo-pkg-vibe-analytics/ 하위 경로로 서빙하므로
// public 자산(폰트/코디콘/로고) 링크가 상대경로여야 한다.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: { __PKG_VERSION__: JSON.stringify(PKG.version || '0.0.0') },
  build: {
    target: 'es2018',
    // cgi-bin/lib의 UMD(CommonJS) 모듈을 번들에 포함하기 위해 — 기본값은 node_modules만 변환
    commonjsOptions: { include: [/node_modules/, /cgi-bin/] },
  },
  server: { fs: { allow: ['..'] } },
});
