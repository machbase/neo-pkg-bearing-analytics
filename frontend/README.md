# frontend 개발 가이드

Preact 10 + HTM + preact/compat, Vite 6(singlefile) 스택. 빌드 산출물(index.html + assets)이 패키지 루트로 배포된다.

## 워크플로

```
npm install
npm run convert     # 프로토타입 dc.html → src/view.js + src/app.js 재생성 (인자 생략 시 레포의 "진동 데이터 분석 패키지" 폴더 사용)
node tools/smoke.mjs  # 필수: htm은 런타임 파싱이라 빌드 성공 ≠ 템플릿 정상 (전 탭 19분기 renderToString)
npm run build:root  # vite build + dist/ → 패키지 루트 복사
```

## 규칙

- `src/view.js`·`src/app.js`는 **생성물** — 직접 수정하지 말고 프로토타입(dc.html) 수정 후 `npm run convert`로 재생성
- UI 수정 후에는 반드시 `node tools/smoke.mjs` 통과 확인
- 폰트·코디콘·로고·report.html은 `public/`에 두어 외부 파일로 유지 (base64 인라인 금지 — 파일 크기 폭증)
- 작업은 이 레포(neo-pkg-replication)에서 하고, 완료되면 레포 루트의 `node sync-to-public.mjs`로 정식 패키지(public/neo-pkg-vibe-analytics)에 반영
