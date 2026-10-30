# frontend 개발 가이드

Preact 10 + HTM + preact/compat, Vite 6(singlefile) 스택. 빌드 산출물(index.html + assets)이 패키지 루트로 배포된다.

판정 규칙·임계값의 근거가 된 검증·실험 기록(검증 풀 성적, 시도했다가 버린 방법 등)은 [VALIDATION.md](VALIDATION.md)에 있다. 사용자 문서(`docs/`)에는 결론만 둔다.

## 워크플로

```
npm install
npm run dev         # 개발 서버 (포트 7781)
npm run smoke       # 필수: Neo 없이 도는 검사 전부 — 템플릿 렌더(htm은 런타임 파싱이라 빌드 성공 ≠ 템플릿 정상) + 로직 검사
npm run build:root  # vite build + dist/ → 패키지 루트 복사 (index.html + main.html)
```

## 검증 도구

`npm run smoke`가 필수다 — `package.json`의 `smoke`에 적힌 오프라인 검사(템플릿 렌더 `smoke.mjs`와 `test-*.mjs` 60여 종)를 순서대로 돌리고, 하나라도 실패하면 멈춘다. 새 검사를 만들면 그 체인에 넣는다. 체인 밖 도구는 Neo(127.0.0.1:5654)가 필요하거나 특정 영역 전용이라, 건드린 영역에 맞춰 돌린다.

| 도구 | 검증 대상 | Neo 필요 |
| :--- | :--- | :---: |
| `npm run smoke` | 오프라인 검사 전체 (목록은 `package.json`) | 아니오 |
| `smoke-live.mjs` | `buildLiveData`·`liveDetail` 실데이터 경로, 저장소 왕복 | 예 (토큰) |
| `test-judgeinputs.mjs` | 표시 단위(g·mm/s·μm)를 바꿔도 결함 판정 입력이 같은지 | 예 (토큰) |
| `test-monitor.mjs` | 서버 판정 TQL 생성기 (dryRun — 실테이블 무변경) | 예 (토큰) |
| `test-monitor-minified.mjs` | 미니파이 후에도 타이머 TQL이 도는지 (함수명 축약 회귀) | 예 (토큰) |
| `npm run verify:live` | 진단 규칙(`verify-persona`)·요약 리포트 문구와 순서(`verify-summary`)·설비 메타 반영(`verify-meta`) | 예 (토큰) |

라이브 검사는 앱과 같은 API 토큰·같은 경로(`/db/*`)로 조회한다(`tools/_liveauth.mjs`). 토큰은 환경변수 `NEO_TOKEN`으로만 넘기고, 없거나 무효면 건너뛴다. 설비 설정은 그 토큰 계정의 저장 설정을 읽는다. 오프라인 검사 중 가짜 `fetch`로 `db.js`를 부르는 것은 `tools/_faketoken.mjs`를 먼저 import한다(토큰 없는 요청은 관문이 막음).

```bash
NEO_TOKEN=<API 토큰> npm run smoke:live
NEO_TOKEN=<API 토큰> npm run verify:live
```

계정마다 테이블 구성이 다르다. 기준 데이터는 그 계정의 `BEARING` 테이블(C1)이고, 없으면 건너뛴다. `VIBE_DATA`는 있을 때만 함께 조립해 검사한다. `verify:live`는 테이블 이름을 인자로 받는다(`node tools/verify-persona.mjs <테이블>`).

`smoke-live.mjs`는 그 계정에 시험 행·리포트 파일·설정을 잠깐 쓰고, 실패해도 원래대로 돌려 놓는다.

서버 감시 코드(`cgi-bin/monitor`·`cgi-bin/notify`)를 고쳤으면 **미니파이 회귀 테스트를 반드시** 돌린다 — 빌드가 `judgeTick`·`shouldNotify` 같은 함수명을 축약해도 생성된 타이머 TQL이 동작해야 한다. 이걸 안 지켜서 서버 모드가 ReferenceError로 죽은 적이 있다.

## 규칙

- `src/view.js`(템플릿)·`src/app.js`(로직)가 **소스**다 — 직접 수정한다. 최초 골격만 프로토타입(`진동 데이터 분석 패키지/진동 분석 패키지.dc.html`)에서 자동 변환했고 그 변환기는 제거했다. dc.html은 디자인 원본으로만 남아 있으며 화면과 동기화되지 않는다(바인딩 70여 개 차이)
- 화면에 값을 새로 내보내려면 `app.js`의 `renderVals()`가 `base.<이름>`을 채우고, `view.js` 상단 구조분해 목록에 그 이름을 **추가해야 한다** — 빠뜨리면 `undefined`로 조용히 렌더된다
- 계산·DB·리포트·알림 로직은 `frontend/`가 아니라 `cgi-bin/`에 둔다. 프론트(Vite import)와 jsh(require) 겸용 UMD이므로 앱과 서버 타이머가 같은 소스를 공유한다 — 규칙을 두 곳에 복사하면 드리프트가 생긴다
- 수정 후에는 반드시 `npm run smoke` 통과 확인
- 레포에서 파일·폴더를 지우면 그 경로(패키지 루트 기준)를 `scripts/obsolete.json`의 `remove`에 더한다. 덮어쓰기 업데이트는 빠진 파일을 지우지 않으므로, 설치·업데이트 때 `scripts/install.js`가 이 목록으로 정리한다. 목록은 누적하고(지우기는 멱등), 아직 레포에 있는 경로가 들어가면 `test-obsolete.mjs`가 막는다
- 판정·서버 타이머·재적재·모니터링 화면은 **적용된 설정 `this._ac()`** 를 읽는다. `this.state`의 설정 키는 설정 폼의 편집본이라 저장 전 값이 들어 있다 — 판정 코드에서 `this.state.<설정 키>`를 읽으면 저장 안 한 편집이 서버 타이머로 샌다(`test-applied.mjs`). 폼 밖에서 곧바로 적용하는 값은 `_applyNow({키: 값})`로 그 키만 저장한다
- 화면 문구는 한국어 원문을 키로 `T('…')`(인자는 `T('태그 {0}개', n)`)로 감싸고 `src/i18n/en.js`·`ja.js`에 같은 키를 넣는다 — 빠지면 `test-i18n.mjs`가 막는다(사전에 없으면 화면엔 한국어 그대로)
  - 진단 엔진(`_dxLive`·`_evidence`)·리포트 조립·LLM 프롬프트·서버 타이머·저장되는 이벤트 사유는 항상 한국어다. 엔진은 자기 문구(원인·결함명)를 정규식으로 다시 검사하므로 번역하면 판정이 깨진다. 화면에 낼 때 `tx()`·`txAll()`로 번역한다
  - 리포트는 생성 시작 때 화면 언어로 나간다 — 앱이 `i18n`(`_i18nFor`)을 넘기면 `report.js`가 고정 문구는 `T()`, 들어온 한국어 문구는 `escT()`(번역 + 이스케이프)로 표시. LLM 소견은 프롬프트 끝 언어 지시(`_opinionLang`)로 그 언어로 받는다
  - 이벤트 내보내기(CSV/JSON)는 내려받을 때 화면 언어, 웹훅 알림은 설정의 알림 언어(`notifLang`). 알림 문구 함수(`notify.js`)는 번역기 `L`을 받고, 서버 감시 스크립트에는 번역기(`cgi-bin/i18n/tx.js`)와 그 스크립트에 나오는 문구의 키만 고른 영·일 부분 사전이 실린다. 번역 알고리즘은 `tx.js` 하나(화면 `i18n.js`도 같은 것)
  - 이어 붙인 문구(`'ISO 위험 구간 · 격자 3.2 · 1회차 — 확정 전'`)는 `tx()`가 조각으로 나눠 사전에 맞는 가장 긴 단위로 번역한다. 새 사유 문구를 만들면 `test-i18n.mjs` 9절(저장 이벤트 사유)에 분기를 넣어 조각 순서까지 확인
  - 비교·저장에 쓰는 값(등급어 `'주의'`, 라우팅 `'즉시'`, 옵션 값 `'직접 입력'` 등)은 감싸지 않고 표시 지점에서 `tx()`
- 폰트·코디콘·로고는 `public/`에 두어 외부 파일로 유지 (base64 인라인 금지 — 파일 크기 폭증)
- 화면 변경 리뷰 기준 — 무동작 컨트롤, 빈/에러 상태 누락, 폴백을 실측처럼 보이게 하는 것을 결함으로 본다
