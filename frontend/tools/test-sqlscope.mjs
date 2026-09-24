// SQL 빌더가 만든 문장에 조립 코드가 문자열로 새어 나오지 않는지, 그리고 앱 저장소만
// 계정 스키마로 가는지 지킨다. 큰따옴표 문자열 안에서 이어 붙이면 리터럴이 되는데,
// 그 SQL 은 실행 시점에야 깨지고 화면에는 "데이터 없음"으로만 보인다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = createRequire(import.meta.url)(path.join(HERE, '../../cgi-bin/db/sql.js'));

const ARGS = {
  tagList: ['T'], tagStats: ['T'], rollupTrend: ['T', 'a', 'min', 0, 1], rollupBatch: ['T', ['a'], 'min', 0, 1],
  rawWindow: ['T', 'a', 0, 1], lastSampleAt: ['T', 'a', 0, 1], sampleTimes: ['T', 'a', 0, 1, 10],
  fftTql: ['T', 'a', 0, 1, 0, 100], bandTrend: ['k', 'min', 0, 1], bandRaw: [['k'], 0, 1],
  bandTimes: [['k'], 0, 1], bandLatest: [['k'], 0, 1], eventsSelect: [10], eventsRange: [0, 1],
  countEvents: [0, 1], insertEvent: [{}], eventsDeleteTag: ['T', 'a'], eventsDeleteRange: [['k'], 0, 1],
  bandDeleteRange: [['k'], 0, 1], bandInsert: ['k', 0, 1], bandDeleteKey: ['k'],
  kvSelect: ['CONFIG'], kvExists: ['CONFIG', 'k'], kvInsert: ['CONFIG', 'k', 'v'],
  kvUpdate: ['CONFIG', 'k', 'v'], kvDelete: ['CONFIG', 'k'], usageCount: ['BAND'],
  dropTable: ['BAND'], tableTypeOf: ['BAND'], colLength: ['BAND', 'VAL'],
  catalogTables: ['SYS'], catalogCount: ['SYS'], tagSchemas: ['SYS'], sessionUser: ['abc123'],
  dbUsable: ['NEO_BEARING_STORE'], grantStatements: ['JOY'], purgeNames: ['BAND'],
};
// SQL 을 만들지 않는 것들 — 이름 조립 헬퍼와 상수
const SKIP = new Set(['esc', 'ident', 'sqlDate', 'setScope', 'scope', 'appTable',
  'sharedScope', 'userPrefix', 'ukey', 'unkey', 'setOwners', 'ownerOf', 'dataTable']);

function allSql() {
  const out = [];
  for (const k of Object.keys(S)) {
    if (typeof S[k] !== 'function' || SKIP.has(k)) continue;
    let r;
    try { r = S[k].apply(null, ARGS[k] || []); } catch { continue; }
    for (const sql of (Array.isArray(r) ? r : [r])) if (typeof sql === 'string') out.push([k, sql]);
  }
  return out;
}

let pass = 0, fail = 0;
const chk = (ok, label, got) => { if (ok) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${got ? ' — ' + got : ''}`); } };
console.log('SQL 이름 조립');

S.setScope('', '');
const plain = allSql();
chk(plain.length > 30, `빌더 ${plain.length}건을 검사한다`);
const leaked = plain.filter(([, sql]) => sql.includes('appTable(') || sql.includes(" + '"));
chk(leaked.length === 0, '조립 코드가 문자열로 새지 않는다', leaked.map(([k]) => k).join(','));

S.setScope('NEO_BEARING_STORE', 'JOY');
const scoped = allSql();
const leaked2 = scoped.filter(([, sql]) => sql.includes('appTable('));
chk(leaked2.length === 0, '계정 스코프에서도 새지 않는다', leaked2.map(([k]) => k).join(','));

/* 저장소는 두 갈래다 — 공용 4표는 SYS 스키마, 설정만 계정 스키마.
   접두 없는 이름은 접속 계정 스키마에서 찾으므로 어느 쪽이든 반드시 수식되어야 한다.
   롤업은 '이름'에 DB·스키마 수식을 못 쓴다(ERR-2010) — 대상만 수식된다. */
const isRollup = (sql) => /^CREATE ROLLUP/i.test(sql);
const appRefs = scoped.filter(([, sql]) => /(CONFIG|EVENTS|BASELINE|BAND|MONSTATE)/.test(sql) && !isRollup(sql));
const unqualified = appRefs.filter(([, sql]) => /(^|[\s(,])(CONFIG|EVENTS|BASELINE|BAND|MONSTATE)/.test(sql));
chk(unqualified.length === 0, '앱 표는 전부 수식된다', unqualified.map(([k]) => k).join(','));
chk(S.appTable('CONFIG') === 'NEO_BEARING_STORE.JOY.CONFIG', '설정은 계정 스키마', S.appTable('CONFIG'));
chk(['BAND', 'EVENTS', 'BASELINE', 'MONSTATE'].every((t) => S.appTable(t) === 'NEO_BEARING_STORE.SYS.' + t),
  '나머지 넷은 공용 스키마', ['BAND', 'EVENTS', 'BASELINE', 'MONSTATE'].map((t) => S.appTable(t)).join(' '));

/* 공용 표를 만지는 문장은 반드시 내 행으로 좁혀져 있어야 한다 — 키 접두나 LIKE 조건 중 하나.
   빠지면 남의 행을 읽거나(조회) 지운다(삭제). 실패가 에러가 아니라 "남의 데이터"로 나타나므로
   화면으로는 알 수 없다. DDL·메타 조회는 행을 다루지 않으므로 제외한다. */
const SHARED_RE = /NEO_BEARING_STORE\.SYS\.(BAND|EVENTS|BASELINE|MONSTATE)\b/;
/* eventsLegacySelect 만 예외 — 다계정 이전의 옛 LOG 표를 통째로 읽는 1회성 이관 경로다.
   그 표의 행에는 소유자가 없고(계정 구분이 생기기 전 설치), 이관은 SYS 만 돌린다. */
const rowTouching = scoped.filter(([k, sql]) => SHARED_RE.test(sql) && k !== 'eventsLegacySelect'
  && !/^(CREATE|DROP|GRANT|REVOKE)\b/i.test(sql) && !/M\$SYS_/.test(sql));
const unscoped = rowTouching.filter(([, sql]) => !(sql.includes("'JOY:") || sql.includes("like 'JOY:%'")));
chk(rowTouching.length > 8 && unscoped.length === 0,
  `공용 표 ${rowTouching.length}건이 전부 내 행으로 좁혀진다`, unscoped.map(([k]) => k).join(','));

// 설정 표는 표 자체가 계정 것이라 키에 접두를 또 붙이면 안 된다 — 붙이면 키가 두 번 갈린다
const cfg = scoped.filter(([, sql]) => sql.includes('NEO_BEARING_STORE.JOY.CONFIG'));
chk(cfg.length > 0 && cfg.every(([, sql]) => !sql.includes("'JOY:")), '설정 키에는 접두를 안 붙인다',
  (cfg.find(([, sql]) => sql.includes("'JOY:")) || [])[1] || '');

const rollups = scoped.filter(([, sql]) => isRollup(sql));
chk(rollups.length > 0 && rollups.every(([, sql]) => /(ON|FROM) NEO_BEARING_STORE\.SYS\./.test(sql)),
  '롤업은 이름을 수식하지 않고 대상만 수식한다', rollups.map(([, s2]) => s2.slice(0, 46)).join(' | '));
/* FROM 의 소스 롤업을 수식하지 않으면 접속 계정의 기본 DB 에서 찾다가 ERR-2025 로 떨어진다.
   실패가 폴백에 먹혀 시간 추세가 조용히 원본 스캔이 되므로 화면으로는 알 수 없다. */
chk(rollups.some(([, sql]) => sql.includes('FROM NEO_BEARING_STORE.SYS.BAND_MIN')),
  '시간 롤업의 소스도 수식된다', rollups.map(([, s2]) => s2).find((x) => /FROM/.test(x)) || '없음');
// 표가 한 벌이라 롤업도 계정마다 늘지 않는다
chk(!rollups.some(([, sql]) => /BAND_(MIN|HOUR)_JOY/.test(sql)), '롤업 이름에 계정이 섞이지 않는다');
chk(S.unkey('JOY:BEARING:C1') === 'BEARING:C1' && S.ukey('BEARING:C1') === 'JOY:BEARING:C1',
  '키 접두는 붙인 대로 떨어진다', S.unkey(S.ukey('x')));

// 사용자 데이터 테이블은 앱 저장소와 다른 규칙을 탄다 — db.user.table 세 부분.
// 소유자만 붙이면 현재 DB 에서만 찾아 다른 DB 의 테이블이 조용히 "없는 테이블"이 된다.
S.setOwners({ VIBE_TEST: { user: 'SYS', db: '' }, SENSOR_A: { user: 'SYS', db: 'FACTORY_A' } });
const here = S.rawWindow('VIBE_TEST', 'a', 0, 1);
chk(!here.includes('NEO_BEARING_STORE.JOY.') && here.includes('SYS.VIBE_TEST'), '데이터 테이블은 앱 저장소 접두를 안 쓴다', here.slice(0, 50));
const other = S.rawWindow('SENSOR_A', 'a', 0, 1);
chk(other.includes('FACTORY_A.SYS.SENSOR_A'), '다른 DB 테이블은 db.user.table 로 쓴다', other.slice(0, 56));
chk(S.tagList('SENSOR_A').includes('FACTORY_A.SYS._sensor_a_meta'), '부속 객체(_meta)에도 같은 접두');
chk(S.tagStats('SENSOR_A').includes('FACTORY_A.SYS.V$SENSOR_A_STAT'), '통계뷰에도 같은 접두');
S.setOwners({});

S.setScope('', '');

/* 앱 저장소가 데이터 소스 목록에 섞이지 않는가.
   섞이면 자기 이벤트 표를 진동 데이터로 고르게 되고, 화면에는 그냥 빈 태그 목록으로만 보인다.
   공용 표가 되면서 권한을 받은 전 계정에게 보이므로 예전보다 걸리기 쉽다. */
const APPDB = 'NEO_BEARING_STORE';
const owned = [['BAND', APPDB], ['EVENTS', APPDB], ['BASELINE', APPDB], ['MONSTATE', APPDB], ['CONFIG', APPDB],
  ['NEO_VIBE_BAND', 'MACHBASEDB'], ['NEO_BEARING_EVENTS', 'MACHBASEDB']];   // 옛 이름은 어디 있든 잔재
const userData = [['BEARING', 'MACHBASEDB'], ['NASA_LIVE', 'MACHBASEDB'], ['SENSOR_A', 'FACTORY_A'],
  ['BAND_SAW', 'MACHBASEDB'], ['EVENTS_LOG', 'MACHBASEDB']];                // 이름이 비슷해도 남의 표다
chk(owned.every(([t, d]) => S.isAppOwned(t, d, APPDB)), '앱 저장소는 데이터 소스에서 빠진다',
  (owned.find(([t, d]) => !S.isAppOwned(t, d, APPDB)) || []).join('.'));
chk(userData.every(([t, d]) => !S.isAppOwned(t, d, APPDB)), '사용자 표는 걸러지지 않는다',
  (userData.find(([t, d]) => S.isAppOwned(t, d, APPDB)) || []).join('.'));

/* '내 행만' 조건은 LIKE가 아니라 문자열 범위다(실측 두 가지):
   · LOOKUP 표(BASELINE·MONSTATE)와 TAG 메타 표에서 '_' 없는 접두 LIKE('JOY:%')는 0건 — 학습값·판정 상태를 못 읽는다
   · LIKE의 '_'는 아무 한 글자라 A_B 계정이 AXB의 행까지 잡는다(Machbase LIKE는 이스케이프 불가) */
S.setScope('NEO_BEARING_STORE', 'JOY');
const kv = S.kvSelect('BASELINE');
chk(/K >= 'JOY:' and K < 'JOY;'/.test(kv) && !/ like /i.test(kv), '학습값·판정 상태 조회는 범위 조건(LIKE 없음)', kv);
const likeLeft = allSql().filter(([, sql]) => /like '[A-Z0-9_]+:%'/i.test(sql));
chk(likeLeft.length === 0, '공용 표 어디에도 계정 접두 LIKE가 남지 않는다', likeLeft.map(([k]) => k).join(','));
S.setScope('NEO_BEARING_STORE', 'A_B');
const m = /K >= '([^']*)' and K < '([^']*)'/.exec(S.kvSelect('MONSTATE'));
const inRange = (k) => !!m && k >= m[1] && k < m[2];   // ASCII 키라 JS 비교 = DB 바이트 비교
chk(inRange('A_B:VIBE_TEST:A') && inRange('A_B:__lock'), 'A_B 계정은 자기 행을 잡는다', m && m.slice(1).join(' ~ '));
chk(!inRange('AXB:VIBE_TEST:A') && !inRange('A_BC:VIBE_TEST:A') && !inRange('A_B'), 'AXB·A_BC 계정의 행은 잡지 않는다(와일드카드 섞임 없음)');
S.setScope('', '');

/* 서버 FFT의 SQL은 TQL 큰따옴표 문자열로 넣는다. 백틱 원시 문자열은 이스케이프가 없어 태그 이름의
   백틱에서 끊기고(실측: "unclosed string literal") 뒤가 TQL로 해석된다 — 여는 사람의 권한으로 실행된다. */
{
  const bad = 'x`y"z' + String.fromCharCode(92) + "w'q";   // 백틱·큰따옴표·백슬래시·작은따옴표
  const t = S.fftTql('BEARING', bad, 0, 1000, 0, 500);
  const m = /^SQL\(("(?:[^"\\]|\\.)*")\)\n/.exec(t);
  const inner = m ? JSON.parse(m[1]) : '';
  chk(!!m && !/^SQL\(`/.test(t), 'FFT 조회는 SQL을 큰따옴표 문자열로 넣는다(백틱 원시 문자열 아님)', t.slice(0, 60));
  chk(inner.includes("name = 'x`y\"z" + String.fromCharCode(92) + "w''q'"),
    '태그는 TQL 층(\\"·\\\\)과 SQL 층(\'\') 양쪽에서 이스케이프된다 — 문자열 밖으로 새지 않는다', inner.slice(0, 80));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
