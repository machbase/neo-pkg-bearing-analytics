# frontend 개발 가이드

Preact 10 + HTM + preact/compat, Vite 6(singlefile) 스택. 빌드 산출물(index.html + assets)이 패키지 루트로 배포된다.

## 워크플로

```
npm install
npm run dev         # 개발 서버 (포트 7781)
npm run smoke       # 필수: Neo 없이 도는 검사 전부 — 템플릿 렌더(htm은 런타임 파싱이라 빌드 성공 ≠ 템플릿 정상) + 로직 검사
npm run build:root  # vite build + dist/ → 패키지 루트 복사 (index.html + main.html)
```

## 검증 도구

`npm run smoke`가 필수다 — `package.json`의 `smoke`에 적힌 오프라인 검사(템플릿 렌더 `smoke.mjs`와 `test-*.mjs` 50여 종)를 순서대로 돌리고, 하나라도 실패하면 멈춘다. 새 검사를 만들면 그 체인에 넣는다. 체인 밖 도구는 Neo(127.0.0.1:5654)가 필요하거나 특정 영역 전용이라, 건드린 영역에 맞춰 돌린다.

| 도구 | 검증 대상 | Neo 필요 |
| :--- | :--- | :---: |
| `npm run smoke` | 오프라인 검사 전체 (목록은 `package.json`) | 아니오 |
| `test-dirtyflag.mjs` | 설정 입력마다 저장 경로(저장 안내 또는 즉시 저장)가 있는지 | 아니오 |
| `test-eventdetail.mjs` | 이벤트 사유 문구·유형 표가 앱과 서버에서 같은지 | 아니오 |
| `test-notifyroute.mjs` | 알림 라우팅·묶음 발송 | 아니오 |
| `test-reportjudge.mjs` | 리포트 헤드라인 등급이 화면 카드와 같은지 | 아니오 |
| `smoke-live.mjs` | `buildLiveData`·`liveDetail` 실데이터 경로 | 예 |
| `test-monitor.mjs` | 서버 판정 TQL 생성기 (dryRun — 실테이블 무변경) | 예 |
| `test-monitor-minified.mjs` | 미니파이 후에도 타이머 TQL이 도는지 (함수명 축약 회귀) | 예 |
| `test-timer-live.mjs` | 타이머가 패키지 경로의 `.tql`을 실제로 실행하는지 종단 | 예 |

서버 감시 코드(`cgi-bin/monitor`·`cgi-bin/notify`)를 고쳤으면 **미니파이 회귀 테스트를 반드시** 돌린다 — 빌드가 `judgeTick`·`shouldNotify` 같은 함수명을 축약해도 생성된 타이머 TQL이 동작해야 한다. 이걸 안 지켜서 서버 모드가 ReferenceError로 죽은 적이 있다.

## 규칙

- `src/view.js`(템플릿)·`src/app.js`(로직)가 **소스**다 — 직접 수정한다. 최초 골격만 프로토타입(`진동 데이터 분석 패키지/진동 분석 패키지.dc.html`)에서 자동 변환했고 그 변환기는 제거했다. dc.html은 디자인 원본으로만 남아 있으며 화면과 동기화되지 않는다(바인딩 70여 개 차이)
- 화면에 값을 새로 내보내려면 `app.js`의 `renderVals()`가 `base.<이름>`을 채우고, `view.js` 상단 구조분해 목록에 그 이름을 **추가해야 한다** — 빠뜨리면 `undefined`로 조용히 렌더된다
- 계산·DB·리포트·알림 로직은 `frontend/`가 아니라 `cgi-bin/`에 둔다. 프론트(Vite import)와 jsh(require) 겸용 UMD이므로 앱과 서버 타이머가 같은 소스를 공유한다 — 규칙을 두 곳에 복사하면 드리프트가 생긴다
- 수정 후에는 반드시 `npm run smoke` 통과 확인
- 판정·서버 타이머·재적재·모니터링 화면은 **적용된 설정 `this._ac()`** 를 읽는다. `this.state`의 설정 키는 설정 폼의 편집본이라 저장 전 값이 들어 있다 — 판정 코드에서 `this.state.<설정 키>`를 읽으면 저장 안 한 편집이 서버 타이머로 샌다(`test-applied.mjs`). 폼 밖에서 곧바로 적용하는 값은 `_applyNow({키: 값})`로 그 키만 저장한다
- 폰트·코디콘·로고는 `public/`에 두어 외부 파일로 유지 (base64 인라인 금지 — 파일 크기 폭증)
- 화면 변경 리뷰 기준은 `persona/ui-expert.md`(UI 프론트 전문가 페르소나 U1~U12) — 무동작 컨트롤, 빈/에러 상태 누락, 폴백의 실측 위장이 결함 판정 대상이다
