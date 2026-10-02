'use strict';

/* 업데이트가 남긴 고아 파일 정리 — scripts/obsolete.json의 remove 경로 삭제(목록 누적, 삭제는 멱등).
   레포에서 파일을 지우면 그 경로를 목록에 추가.
   install.js가 설치·업데이트 때 호출. 단독 실행: machbase-neo jsh scripts/cleanup.js
   거부 경로: 빈 경로·절대경로·'..'·패키지 밖·보호 경로와 그 상위 폴더. 실패해도 throw 안 함 */

var path = require('path');
var fs = require('fs');

/* 보호 경로(목록에 잘못 적혀도 삭제 안 함) — cgi-bin/tql = 계정별 타이머 스크립트,
   cgi-bin/config = 옛 설정(DB 이관 원본), 나머지는 정리·설치 스크립트 자신 */
var PROTECTED = [
  'cgi-bin/tql',
  'cgi-bin/config',
  'scripts/install.js',
  'scripts/uninstall.js',
  'scripts/cleanup.js',
  'scripts/obsolete.json',
  '.git',
];

function log(m) {
  if (typeof console.println === 'function') console.println(m);
  else console.log(m);
}

function normalizeRel(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').trim();
}

// 보호 경로 자신·하위·상위 폴더 거부(상위 폴더 삭제 시 보호 경로도 사라짐)
function isProtected(rel) {
  for (var i = 0; i < PROTECTED.length; i++) {
    var p = PROTECTED[i];
    if (rel === p || rel.indexOf(p + '/') === 0 || p.indexOf(rel + '/') === 0) return true;
  }
  return false;
}

// 한 항목 판정 — 'ok'면 root 안의 대상 경로도 반환(테스트도 같은 규칙 사용)
function judge(orig, root) {
  var rel = normalizeRel(orig);
  if (!rel || rel === '.' || path.isAbsolute(String(orig)) || rel.split('/').indexOf('..') >= 0) return { verdict: 'unsafe', rel: rel };
  if (isProtected(rel)) return { verdict: 'protected', rel: rel };
  var target = path.resolve(root, rel);
  var back = path.relative(root, target);
  if (back === '' || back.indexOf('..') === 0 || path.isAbsolute(back)) return { verdict: 'escape', rel: rel };
  return { verdict: 'ok', rel: rel, target: target };
}

function runCleanup(pkgRoot) {
  var root = path.resolve(pkgRoot);
  var manifest = path.join(root, 'scripts', 'obsolete.json');
  var stats = { removed: 0, absent: 0, refused: 0, failed: 0 };
  var list;
  try {
    list = (JSON.parse(fs.readFileSync(manifest, 'utf8')) || {}).remove || [];
  } catch (e) {
    log('[cleanup] 목록을 읽지 못함 (' + manifest + '): ' + (e.message || e));
    return stats;
  }
  for (var i = 0; i < list.length; i++) {
    var j = judge(list[i], root);
    if (j.verdict !== 'ok') {
      log('[cleanup] 거부 (' + j.verdict + '): ' + list[i]);
      stats.refused++;
      continue;
    }
    if (!fs.existsSync(j.target)) { stats.absent++; continue; }
    try {
      fs.rmSync(j.target, { recursive: true, force: true });
      log('[cleanup] 지움: ' + j.rel);
      stats.removed++;
    } catch (e) {
      log('[cleanup] 실패: ' + j.rel + ' — ' + (e.message || e));
      stats.failed++;
    }
  }
  log('[cleanup] 끝 — removed=' + stats.removed + ' absent=' + stats.absent
    + ' refused=' + stats.refused + ' failed=' + stats.failed);
  return stats;
}

// jsh 단독 실행엔 module이 없음 — require될 때만 export
if (typeof module !== 'undefined' && module.exports) module.exports = { runCleanup: runCleanup, judge: judge, PROTECTED: PROTECTED };

// 단독 실행 판별 — install.js가 require하면 argv[1]이 install.js라 미실행
var _proc = require('process');
var _entry = (_proc.argv && _proc.argv[1]) ? String(_proc.argv[1]).replace(/\\/g, '/') : '';
if (/\/cleanup\.js$/.test(_entry)) runCleanup(path.resolve(path.dirname(_proc.argv[1]), '..'));
