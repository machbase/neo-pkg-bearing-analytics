// 설정이 DB 를 왕복하는지 — 도메인 JSON 을 조각내 담고 다시 합쳐 읽는 경로를 fetch 목으로 재현한다.
// 조각이 하나라도 어긋나면 그 도메인이 에러 없이 기본값으로 떨어지므로 눈으로는 못 잡는다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = createRequire(import.meta.url)(path.join(HERE, '../../cgi-bin/db/db.js'));

let pass = 0, fail = 0;
const chk = (ok, label, got) => { if (ok) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}${got ? ' — ' + got : ''}`); } };

// LOOKUP 테이블을 메모리 맵으로 흉내낸다. SQL 문자열에서 키·값을 되읽어 실제 문장을 검증한다.
const store = new Map();
globalThis.fetch = async (url) => {
  const sql = decodeURIComponent(String(url).replace(/^[^?]*\?q=/, '').replace(/&.*$/, ''));
  let rows = [];
  let m;
  if (/^select K, VAL from /.test(sql)) rows = [...store.entries()].map(([k, v]) => [k, v]);
  else if ((m = /^select count\(\*\) from \S+ where K='(.*)'$/.exec(sql))) rows = [[store.has(m[1]) ? 1 : 0]];
  else if ((m = /^insert into \S+ values\('(.*?)', '(.*)'\)$/.exec(sql))) store.set(m[1], m[2]);
  else if ((m = /^update \S+ set VAL='(.*)' where K='(.*?)'$/.exec(sql))) store.set(m[2], m[1]);
  else if ((m = /^delete from \S+ where K='(.*?)'$/.exec(sql))) store.delete(m[1]);
  return { ok: true, status: 200, json: async () => ({ success: true, data: { rows } }) };
};

DB.setUser('JOY');

// 설비 정보를 실제 규모로 — 한글 별칭이 섞여야 인코딩 팽창까지 재현된다
const equip = {}, alias = {};
for (let i = 0; i < 300; i++) {
  equip['VIBE_TEST:SENSOR_' + i] = { cls: 'II', rpm: 1780 + i, geo: { n: 8, d: 7.94, p: 39.0 } };
  alias['VIBE_TEST:SENSOR_' + i] = '펌프 ' + i + '번 구동축';
}
const cfg = {
  srcSel: ['VIBE_TEST'], machineClass: 'III', monitorOn: true, evalWindow: '10s',
  equipGeo: equip, aliases: alias, llmKeys: { claude: "sk-ant-'quoted'", openai: 'sk-proj-x' },
  notifTo: { webhook: 'https://hooks.slack.com/services/T0/B0/xyz' },
};

await DB.saveConfig(cfg);
const rows = [...store.keys()].filter((k) => /^cfg:equipment#/.test(k));
chk(rows.length > 1, `설비 도메인이 조각으로 나뉜다 (${rows.length}조각)`);
chk([...store.values()].every((v) => v.length <= 3800), '조각이 VAL 한도 안에 들어간다');
chk([...store.values()].every((v) => !v.includes("'")), '값에 따옴표가 남지 않는다 (SQL 안전)');

const back = await DB.loadConfig();
chk(back && Object.keys(back.equipGeo || {}).length === 300, '설비 300건이 그대로 돌아온다',
  back ? String(Object.keys(back.equipGeo || {}).length) : 'null');
chk(back && back.aliases['VIBE_TEST:SENSOR_7'] === '펌프 7번 구동축', '한글 별칭이 보존된다', back && back.aliases && back.aliases['VIBE_TEST:SENSOR_7']);
chk(back && back.llmKeys.claude === "sk-ant-'quoted'", '따옴표 든 시크릿이 보존된다', back && back.llmKeys && back.llmKeys.claude);
chk(back && back.monitorOn === true && back.machineClass === 'III', '작은 도메인도 함께 돌아온다');

// 줄어든 도메인 — 옛 조각이 남으면 다음 읽기에 덧붙어 파싱이 깨진다
const before = [...store.keys()].filter((k) => /^cfg:equipment#/.test(k)).length;
await DB.saveConfigPartial({ equipGeo: { 'VIBE_TEST:SENSOR_0': { cls: 'I' } }, aliases: {} }, ['equipGeo', 'aliases']);
const after = [...store.keys()].filter((k) => /^cfg:equipment#/.test(k)).length;
chk(after < before, `줄어들면 옛 조각을 지운다 (${before} → ${after})`);
const back2 = await DB.loadConfig();
chk(back2 && Object.keys(back2.equipGeo).length === 1, '줄어든 값이 그대로 읽힌다');
chk(back2 && back2.machineClass === 'III', '부분 저장이 다른 도메인을 건드리지 않는다', back2 && back2.machineClass);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
