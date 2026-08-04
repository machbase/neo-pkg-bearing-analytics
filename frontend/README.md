# frontend 개발 가이드

Preact 10 + HTM + preact/compat, Vite 6(singlefile) 스택. 빌드 산출물(index.html + assets)이 패키지 루트로 배포된다.

## 워크플로

```
npm install
npm run dev         # 개발 서버 (포트 7781)
npm run smoke       # 필수: htm은 런타임 파싱이라 빌드 성공 ≠ 템플릿 정상 (전 탭·주요 분기 renderToString + 로직 검사)
npm run build:root  # vite build + dist/ → 패키지 루트 복사 (index.html + main.html)
```

## 검증 도구

`tools/smoke.mjs`만 필수고, 나머지는 건드린 영역에 맞춰 돌린다. 라이브 도구는 Neo(127.0.0.1:5654)가 떠 있어야 한다.

| 도구 | 검증 대상 | Neo 필요 |
| :--- | :--- | :---: |
| `smoke.mjs` | 전 탭·주요 분기 템플릿 렌더 | 아니오 |
| `test-sevgrade.mjs` | 기간 지표 등급·계측 보류 (화면/리포트 동일 규칙) | 아니오 |
| `smoke-live.mjs` | `buildLiveData`·`liveDetail` 실데이터 경로 | 예 |
| `test-judge.mjs` | `judgeTick` 상태머신 시나리오 | 아니오 |
| `test-monitor.mjs` | 서버 판정 TQL 생성기 (dryRun — 실테이블 무변경) | 예 |
| `test-monitor-minified.mjs` | 미니파이 후에도 타이머 TQL이 도는지 (함수명 축약 회귀) | 예 |
| `test-timer-live.mjs` | 타이머가 패키지 경로의 `.tql`을 실제로 실행하는지 종단 | 예 |

서버 감시 코드(`cgi-bin/monitor`·`cgi-bin/notify`)를 고쳤으면 **미니파이 회귀 테스트를 반드시** 돌린다 — 빌드가 `judgeTick`·`shouldNotify` 같은 함수명을 축약해도 생성된 타이머 TQL이 동작해야 한다. 이걸 안 지켜서 서버 모드가 ReferenceError로 죽은 적이 있다.

## 규칙

- `src/view.js`(템플릿)·`src/app.js`(로직)가 **소스**다 — 직접 수정한다. 최초 골격만 프로토타입(`진동 데이터 분석 패키지/진동 분석 패키지.dc.html`)에서 자동 변환했고 그 변환기는 제거했다. dc.html은 디자인 원본으로만 남아 있으며 화면과 동기화되지 않는다(바인딩 70여 개 차이)
- 화면에 값을 새로 내보내려면 `app.js`의 `renderVals()`가 `base.<이름>`을 채우고, `view.js` 상단 구조분해 목록에 그 이름을 **추가해야 한다** — 빠뜨리면 `undefined`로 조용히 렌더된다
- 계산·DB·리포트·알림 로직은 `frontend/`가 아니라 `cgi-bin/`에 둔다. 프론트(Vite import)와 jsh(require) 겸용 UMD이므로 앱과 서버 타이머가 같은 소스를 공유한다 — 규칙을 두 곳에 복사하면 드리프트가 생긴다
- UI 수정 후에는 반드시 `node tools/smoke.mjs` 통과 확인
- 폰트·코디콘·로고는 `public/`에 두어 외부 파일로 유지 (base64 인라인 금지 — 파일 크기 폭증)
