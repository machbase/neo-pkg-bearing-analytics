'use strict';

// pkg run start — 상주 서비스가 없다(프론트 → Neo API 직접). 디렉터리만 보장.

var path = require('path');
var process = require('process');
var fs = require('fs');

var PKG_ROOT = path.resolve(path.dirname(process.argv[1]), '..');
try { if (!fs.exists(path.join(PKG_ROOT, 'cgi-bin', 'config'))) fs.mkdir(path.join(PKG_ROOT, 'cgi-bin', 'config'), { recursive: true }); } catch (e) {}
console.println('neo-pkg-vibe-analytics ready (no resident service).');
