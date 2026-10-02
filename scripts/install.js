'use strict';

// pkg run install — 설치·업데이트 시 실행
// 준비할 런타임 폴더 없음 — 설정은 전용 DB(NEO_BEARING_STORE.<계정>.CONFIG),
// 타이머 스크립트 폴더(cgi-bin/tql/<계정>/)는 앱이 타이머 등록 시 생성
// 업데이트가 남긴 고아 파일만 정리(scripts/obsolete.json)

var path = require('path');
var process = require('process');

var PKG_ROOT = path.resolve(path.dirname(process.argv[1]), '..');
// 정리 실패가 설치를 막지 않음 — 사유만 출력
try {
  require('./cleanup').runCleanup(PKG_ROOT);
} catch (e) {
  console.println('[install] cleanup skipped: ' + (e && e.message ? e.message : String(e)));
}
console.println('install done.');
