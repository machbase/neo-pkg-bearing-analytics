'use strict';

// pkg run uninstall — 패키지 파일 삭제는 Neo가 수행, 사용자 데이터(전용 DB NEO_BEARING_STORE)는 건드리지 않음
// 타이머(감시·대역 추출)는 패키지 밖(Neo 등록부)에 남음 — 자동 삭제 없이 안내만
//  · 타이머 API는 계정별 API 토큰 전용, 제거 실행 세션엔 토큰 없음
//  · 실행할 TQL이 패키지와 함께 지워져 남은 타이머는 다음 회차에 "STOP, not found"로 멈춤(실행 없음)
// 상주 서비스가 없어 start/stop 훅 없음
console.println('neo-pkg-bearing-analytics uninstalled. data/ 디렉터리는 보존됩니다.');
console.println('  NEO_BEARING_* 타이머(감시·대역 추출)는 Neo 타이머 목록에 남을 수 있습니다 — 다음 회차에 "STOP, not found"로 멈추며 더는 실행되지 않습니다.');
console.println('  Neo 타이머 화면에서 계정마다 NEO_BEARING_* 항목을 삭제하세요. 다시 설치한 뒤 앱을 열면 켜 둔 감시·대역 추출 타이머가 새로 등록됩니다.');
