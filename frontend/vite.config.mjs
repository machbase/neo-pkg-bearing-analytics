import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

// 패키지 버전은 package.json에서 주입(하드코딩 금지 — 이중 관리 시 불일치)
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// base './' — Neo가 /web/apps/neo-pkg-bearing-analytics/ 하위 경로로 서빙 → public 자산(폰트/코디콘/로고) 링크는 상대경로
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: { __PKG_VERSION__: JSON.stringify(PKG.version || '0.0.0') },
  build: {
    target: 'es2018',
    // cgi-bin의 UMD(CommonJS) 모듈도 번들 변환 대상에 포함(기본값은 node_modules만)
    commonjsOptions: { include: [/node_modules/, /cgi-bin/] },
  },
  server: { fs: { allow: ['..'] } },
});
