/* 설정 입력이 저장으로 이어지는지 — 두 경로 중 하나여야 한다.
     ① dirty: true       → 저장 안내가 뜨고 사용자가 [저장]을 누른다
     ② 즉시 저장 호출     → _persistCfg / _persistView 로 그 자리에서 파일에 쓴다
   둘 다 없으면 값이 state에만 남았다가 새로고침에 사라진다. 화면엔 아무 안내도 없다.

   실제로 회전수·베어링·형상 세 setter가 이 상태였다 — 하필 결함 패턴 격자를 세우는 값들이라,
   입력해도 저장이 안 되고 카드는 계속 "판정 못 함"으로 남았다. */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const DB = fs.readFileSync(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
// 파일에 실제로 쓰이는 키만 본다(db.js CONFIG_FILES) — 화면 전용 상태는 저장 대상이 아니다
const BLOCK = DB.slice(DB.indexOf('var CONFIG_FILES'), DB.indexOf('function configDir'));
const CFG = new Set([...BLOCK.matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.json')));

/* 예외 셋 — 사용자의 입력이 아니라 앱이 스스로 거는 방어다. 저장하면 오히려 해롭다.
     _loadSchemas : 미지원 컬럼 table을 매 로드마다 다시 뺀다(저장하면 고른 소스가 조용히 바뀐다)
     _initEmpty   : DB가 안 닿을 때 빈 상태로 시작한다(저장하면 DB가 잠깐 죽은 것만으로 소스가 지워진다)
     _initNoAuth  : 신원을 모르는 상태다. 누구의 설정인지 모르는 채로 저장하면 남의 폴더에 쓴다
     _initCfgFail : 설정을 못 읽은 상태다. 비운 화면 값을 저장하면 실제 설정을 덮는다(저장 자체가 잠겨 있다) */
const EXEMPT = [/_loadSchemas\(\)/, /_initEmpty\(msg\)/, /_initNoAuth\(why\)/, /_initCfgFail\(err\)/];

let pass = 0, fail = 0;
const chk = (ok, msg, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (got ? ' — ' + got : '')); ok ? pass++ : fail++; };

chk(CFG.size > 10, 'CONFIG_FILES에서 저장 키 목록을 읽었다', CFG.size + '개');
['equipRpm', 'equipBearing', 'equipGeo'].forEach((k) => chk(CFG.has(k), `${k}는 파일로 저장되는 키다`));

// setState({...}) 인자를 중괄호 균형으로 떠낸다 — 안에 {} 리터럴이 있어 단순 정규식은 잘린다
function argOf(src, at) {
  let d = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}' && --d === 0) return src.slice(at, i + 1);
  }
  return '';
}

const lineAt = (i) => SRC.slice(0, i).split('\n').length;
const miss = [];
for (const m of SRC.matchAll(/setState\(\s*\{/g)) {
  const body = argOf(SRC, SRC.indexOf('{', m.index));
  const keys = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((x) => x[1]).filter((k) => CFG.has(k));
  if (!keys.length || /\bdirty\b/.test(body)) continue;
  const ln = lineAt(m.index);
  const near = SRC.split('\n').slice(ln - 1, ln + 4).join('\n');   // 같은 자리에서 바로 저장하는가
  if (/_persistCfg\(|_persistView\(/.test(near)) continue;
  const fn = SRC.slice(Math.max(0, m.index - 1200), m.index);
  if (EXEMPT.some((re) => re.test(fn))) continue;
  miss.push(`app.js:${ln} ${keys.join(',')}`);
}
chk(miss.length === 0, '저장 대상 키를 바꾸면 dirty를 세우거나 즉시 저장한다', miss.join(' | ') || '누락 0');

console.log(`\ndirty flag: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
