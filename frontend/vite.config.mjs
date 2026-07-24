import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base './' — Neo가 /web/apps/neo-pkg-vibe-analytics/ 하위 경로로 서빙하므로
// public 자산(폰트/코디콘/로고) 링크가 상대경로여야 한다.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2018',
    // cgi-bin/lib의 UMD(CommonJS) 모듈을 번들에 포함하기 위해 — 기본값은 node_modules만 변환
    commonjsOptions: { include: [/node_modules/, /cgi-bin/] },
  },
  server: { fs: { allow: ['..'] } },
});
