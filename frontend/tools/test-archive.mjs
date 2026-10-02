/* 리포트 보관함 목록 — 메타(.index.json)의 대상 태그·기간·LLM 여부 반영
   · Neo 파일 목록은 점(.)으로 시작하는 파일을 빼고 줌(실측) → 목록에 없어도 리포트가 있으면 직접 조회
   · 빈 폴더는 조회 안 함(콘솔 404 방지), 메타 없는 리포트는 파일명 폴백
   오프라인(Neo 불필요) · npm run smoke 포함 */
globalThis.window = globalThis;

// live.js가 로드 시점에 DB 함수를 캡처 — 스텁은 import 전에 설치
const DB = (await import('../../cgi-bin/db/db.js')).default;
const FILES = {};      // 폴더 → 목록(점 파일 제외 — Neo와 같음)
const BLOBS = {};      // 경로 → 내용
const asked = [];
DB.listDir = (d) => Promise.resolve((FILES[d] || []).filter((f) => !f.name.startsWith('.')));
DB.readFileBlob = (p) => { asked.push(p); return p in BLOBS ? Promise.resolve({ text: () => Promise.resolve(BLOBS[p]) }) : Promise.reject(new Error('404')); };
DB.ensureDir = () => Promise.resolve();

const { App } = await import('../src/app.js');
const { reportDir } = await import('../src/data/live.js');

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra === undefined ? '' : extra);
  else { fail++; console.error('FAIL', msg, extra === undefined ? '' : extra); }
};
const load = async () => {
  const app = new App({ seed: 7, equipmentCount: 1 });
  app.setState = function (o) { Object.assign(this.state, o); };
  app._loadReports();
  await new Promise((r) => setTimeout(r, 20));
  return app.state.reports;
};

const dir = reportDir();
const F1 = 'SENSOR_FREQ_20261002_133412.html', F2 = 'SENSOR_SPIKE_20260922_172537.html';
FILES[dir] = [{ name: F1, isDir: false, lastModifiedUnixMillis: 1 }, { name: F2, isDir: false, lastModifiedUnixMillis: 2 }, { name: '.index.json', isDir: false }];
BLOBS[dir + '/.index.json'] = JSON.stringify({
  [F1]: { tag: 'SENSOR_FREQ', from: '2026-09-22 16:32', to: '2026-09-22 17:32', llm: true, ms: 1790915652982 },
});
{
  const reps = await load();
  const r1 = reps.find((r) => r.fname === F1), r2 = reps.find((r) => r.fname === F2);
  chk(asked.includes(dir + '/.index.json'), '목록에 안 보여도(점 파일) 메타 파일을 직접 읽음(예전: 목록에 없으면 안 읽어 전부 폴백)');
  chk(r1 && r1.tags[0] === 'SENSOR_FREQ' && r1.period === '2026-09-22 16:32 ~ 2026-09-22 17:32' && r1.llm === true,
    '메타 있는 리포트 — 대상 태그·기간·LLM 소견 여부(예전: 기간 "-", 유형 "지표만")', JSON.stringify(r1 && { t: r1.tags, p: r1.period, l: r1.llm }));
  chk(r2 && r2.tags[0] === 'SENSOR_SPIKE_20260922_172537' && r2.period === '-', '메타 없는 리포트 — 파일명 폴백');
}
{
  // 빈 폴더 — 메타 조회 안 함(없는 파일 요청 시 콘솔 404)
  FILES[dir] = [];
  asked.length = 0;
  const reps = await load();
  chk(reps.length === 0 && !asked.length, '리포트 없는 폴더는 메타를 조회하지 않음');
}

console.log(fail ? `\n${fail} failed` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
