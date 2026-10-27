/* 설정 입력의 저장 경로 — 저장 대상 키를 바꾸는 setState는 ① dirty: true(저장 안내) 또는 ② 즉시 저장(_persistCfg/_persistView/_applyNow) 중 하나
   · 둘 다 없으면 값이 state에만 남아 새로고침에 사라짐
   오프라인(Neo 불필요) · app.js 소스 정적 검사 · npm run smoke 포함 */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const DB = fs.readFileSync(new URL('../../cgi-bin/db/db.js', import.meta.url), 'utf8');
// 저장 키만 대상(db.js CONFIG_FILES) — 화면 전용 상태 제외
const BLOCK = DB.slice(DB.indexOf('var CONFIG_FILES'), DB.indexOf('function configDir'));
const CFG = new Set([...BLOCK.matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.json')));

/* 예외 — 사용자 입력이 아닌 앱 자체 방어(저장하면 해로움)
     _loadSchemas : 미지원 컬럼 테이블을 로드마다 제외(저장하면 고른 소스가 조용히 바뀜)
     _initEmpty   : DB 불통 시 빈 상태로 시작(저장하면 일시 장애만으로 소스가 지워짐)
     _initNoAuth  : 신원 불명 상태(저장하면 남의 설정에 씀)
     _initCfgFail : 설정 읽기 실패 상태(저장하면 실제 설정을 덮음, 저장 자체도 잠김) */
const EXEMPT = [/_loadSchemas\(\)/, /_initEmpty\(msg\)/, /_initNoAuth\(why[,)]/, /_initCfgFail\(err\)/];

let pass = 0, fail = 0;
const chk = (ok, msg, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (got ? ' — ' + got : '')); ok ? pass++ : fail++; };

chk(CFG.size > 10, 'CONFIG_FILES에서 저장 키 목록을 읽었다', CFG.size + '개');
['equipRpm', 'equipBearing', 'equipGeo'].forEach((k) => chk(CFG.has(k), `${k}는 파일로 저장되는 키다`));

// setState({...}) 인자를 중괄호 균형으로 추출(내부 {} 리터럴 때문에 단순 정규식 불가)
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
  const near = SRC.split('\n').slice(Math.max(0, ln - 4), ln + 4).join('\n');   // 같은 자리(앞뒤 몇 줄)에서 즉시 저장 여부
  if (/_persistCfg\(|_persistView\(|_applyNow\(/.test(near)) continue;
  const fn = SRC.slice(Math.max(0, m.index - 1200), m.index);
  if (EXEMPT.some((re) => re.test(fn))) continue;
  miss.push(`app.js:${ln} ${keys.join(',')}`);
}
chk(miss.length === 0, '저장 대상 키를 바꾸면 dirty를 세우거나 즉시 저장한다', miss.join(' | ') || '누락 0');

console.log(`\ndirty flag: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
