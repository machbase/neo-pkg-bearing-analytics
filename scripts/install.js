'use strict';

// pkg run install — 런타임 디렉터리 준비.
// 상주 서비스가 없고(프론트 → Neo API 직접) 설정도 DB(NEO_VIBE_CONFIG LOOKUP 테이블)에
// 저장되므로, 여기서는 리포트 보관용 디렉터리만 만든다.

var path = require('path');
var process = require('process');
var fs = require('fs');

var PKG_ROOT = path.resolve(path.dirname(process.argv[1]), '..');
// 설정 저장 폴더(cgi-bin/config/*.json — 설정탭 카드별 분할 저장). 리포트는 워크스페이스 '진동 분석/'에 저장.
try { if (!fs.exists(path.join(PKG_ROOT, 'cgi-bin', 'config'))) fs.mkdir(path.join(PKG_ROOT, 'cgi-bin', 'config'), { recursive: true }); } catch (e) {}
console.println('install done.');
