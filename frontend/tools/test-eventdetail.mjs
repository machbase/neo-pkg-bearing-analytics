/* 이벤트 사유(DETAIL) — judgeDetail이 격자 점수·부위·확정 근거·충격성 값을 싣는지, 앱·서버가 같은 함수로 채우는지
 * · 이벤트 유형 표(앱↔서버 사본) 일치, 격자 점수 계열(:pattern) 적재
 * 오프라인(Neo 불필요) · 소스 정적 검사 · npm run smoke 포함
 */
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const MON = fs.readFileSync(new URL('../../cgi-bin/monitor/monitor.js', import.meta.url), 'utf8');
const SQL = fs.readFileSync(new URL('../../cgi-bin/db/sql.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const chk = (ok, msg, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg + (got ? ' — ' + got : '')); ok ? pass++ : fail++; };

// ── 사유 문구 ───────────────────────────────────────────────────────────
{
  // judgeDetail을 소스에서 떠 격리 실행 — 앱 없이 문구만 확인
  const m = /function judgeDetail\(ev, pat, imp\) \{[\s\S]*?\n\}/.exec(SRC);
  chk(!!m, 'judgeDetail이 있다');
  if (m) {
    const durKo = (ms) => (ms < 3600000 ? Math.round(ms / 60000) + '분' : Math.round(ms / 3600000) + '시간');
    const fn = new Function('durKo', m[0] + '; return judgeDetail;')(durKo);
    // 부위 키는 판정이 내는 원문(BPFO·BPFI·BSF) — 문구에서 부위 이름으로
    const pat = { r: 3.24, key: 'BPFO' };
    chk(/· 외륜\(BPFO\) ·/.test(fn({ etype: 'threshold' }, pat)), '부위 키 BPFO → 외륜(BPFO)', fn({ etype: 'threshold' }, pat));
    chk(/내륜\(BPFI\)/.test(fn({ etype: 'threshold' }, { r: 3.5, key: 'BPFI' })), '부위 키 BPFI → 내륜(BPFI)');
    const bsf = fn({ etype: 'threshold' }, { r: 3.5, key: 'BSF' });
    chk(/부위 미상/.test(bsf) && !/· BSF ·/.test(bsf), '구름체(BSF)는 부위를 단정하지 않는다 — 부위 미상', bsf);

    const obs = fn({ etype: 'observe' }, pat);
    chk(/격자 3\.2/.test(obs) && /외륜/.test(obs), '조짐에 격자 점수와 부위가 들어간다', obs);
    chk(/확정 전/.test(obs), '조짐은 확정 전임을 밝힌다', obs);

    const thr = fn({ etype: 'threshold' }, pat);
    chk(/2회 연속 확정/.test(thr), '확정은 근거를 적는다', thr);

    const rec = fn({ etype: 'recovery', epMs: 4 * 3600000 + 20 * 60000 }, { r: 2.2, key: '' });
    chk(/복귀/.test(rec) && /4시간/.test(rec), '복귀는 에피소드 길이를 적는다 — 시각을 빼서 계산하지 않게', rec);

    // 패턴 미측정 태그(회전수 미입력)는 격자 문구 없음
    const none = fn({ etype: 'threshold' }, null);
    chk(!/격자/.test(none), '패턴을 못 쟀으면 격자를 지어내지 않는다', none || '(빈칸)');

    /* 충격성 근거 — 값만 싣고 판정 단어 없음(상세분석은 다른 창·다른 임계를 써 화면마다 답이 갈림)
       · 어느 창인지는 접두어('판정 창')로 표시 */
    const imp = fn({ etype: 'threshold' }, pat, { crest: 10.4, kurt: 5.4 });
    chk(imp.indexOf('판정 창 Crest 10.4') >= 0 && imp.indexOf('첨도 5.4') >= 0, '충격성 근거가 값으로 실린다', imp);
    chk(imp.indexOf('충격성') < 0 && imp.indexOf('광대역') < 0, '판정 단어는 쓰지 않는다 — 화면과 임계가 다르다', imp);
    chk(imp.indexOf('2회 연속 확정') >= 0, '기존 문구 뒤에 붙는다 — 앞부분 규칙은 그대로', imp);
    // 원본 미확보 틱은 충격성 근거 없음
    const noImp = fn({ etype: 'threshold' }, pat, null);
    chk(noImp.indexOf('판정 창') < 0, '충격성을 못 쟀으면 적지 않는다', noImp);
  }
}

// ── 이벤트 연결 ─────────────────────────────────────────────────────────
chk(SRC.indexOf('judgeDetail(ev, _pat, self._rawImp(key))') >= 0,
  '등급 이벤트의 DETAIL이 judgeDetail로 채워진다 — 충격성 근거까지 함께');

/* 서버도 같은 judgeDetail로 사유 작성 — DETAIL 경로와 소스 전달 둘 다 확인 */
const has = (s, t) => s.indexOf(t) >= 0;
chk(has(SRC, 'VC.embedSrc([durKo, judgeDetail]'), '앱이 durKo까지 한 스코프로 묶어 싣는다 — 압축에도 이름이 안 갈리게');
chk(has(SRC, 'detailSrc: detailSrc()'), '앱이 그 소스를 서버 spec에 싣는다');
chk(has(MON, "spec.detailSrc || 'var judgeDetail"), '서버 TQL이 그 소스를 그대로 임베드한다');
chk(has(MON, 'var dt = isS ? (ev.detail||"") : judgeDetail(ev, _pv, _im);'),
  '서버 등급 이벤트의 DETAIL이 judgeDetail로 채워진다');
chk(has(MON, 'key: m?(m.key||""):""'), '서버 패턴 판정이 결함 부위도 돌려준다 — 없으면 부위가 빠진 문구가 된다');
chk(has(MON, 'res.next.patK='), '부위를 상태로 실어 나른다 — TQL은 매 실행 새로 시작한다');
// 앱도 같은 창에서 충격성 측정 — 두 모드 문장 일치
chk(has(SRC, 'VC.impactEvidence(w.values, eq.fs)'), '앱이 ISO와 같은 원본 창에서 충격성을 잰다');
chk(has(SRC, 'judgeDetail(ev, _pat, self._rawImp(key))'), '앱 이벤트도 그 근거를 싣는다');
// band·baseline 이벤트는 생성되지 않음 — 죽은 분기 부재
chk(!has(MON, 'ev.etype=="band"') && !has(MON, 'ev.etype=="baseline"'),
  '서버에 죽은 band·baseline 이벤트 분기가 없다');

// ── 유형 표 사본 ────────────────────────────────────────────────────────
/* 이벤트 유형 표(TYPEKO)는 앱·서버 두 벌(서버 것은 TQL에 값으로 구움) — 키가 빠지면 영문 코드가 그대로 나감 */
{
  const keysOf = (s, start) => {
    const i = s.indexOf(start);
    if (i < 0) return null;
    const a = s.indexOf('{', i), b = s.indexOf('}', a);
    if (a < 0 || b < 0) return null;
    return s.slice(a + 1, b).split(',').map((p) => p.split(':')[0].trim()).filter(Boolean).sort();
  };
  const appKeys = keysOf(SRC, 'var TYPEKO = {');
  const monKeys = keysOf(MON, 'var TYPEKO=');
  chk(!!appKeys && !!monKeys, '두 유형 표를 다 찾았다');
  if (appKeys && monKeys) {
    const missing = appKeys.filter((k) => monKeys.indexOf(k) < 0);
    const extra = monKeys.filter((k) => appKeys.indexOf(k) < 0);
    chk(missing.length === 0 && extra.length === 0, '이벤트 유형 표가 앱과 서버에서 같다',
      missing.length || extra.length ? '서버 누락 [' + missing.join(',') + '] · 서버 잉여 [' + extra.join(',') + ']' : appKeys.length + '개 일치');
  }
}

// ── 점수 계열 ───────────────────────────────────────────────────────────
chk(/function bandInsert\(key, ms, v\)/.test(SQL), '계열 한 점을 넣는 SQL이 있다');
chk(/insertBandPoint\(r\.key \+ ':pattern'/.test(SRC), '앱이 매 회차 격자 점수를 계열로 남긴다');
chk(/BAND[\s\S]{0,120}:pattern/.test(MON), '서버 타이머도 같은 키로 남긴다');
// 서버 모드에선 앱이 쓰지 않음 — 같은 시각 두 행 적재 방지
chk(/[SC]\.monMode !== 'server'/.test(SRC), '앱은 서버 모드일 때 쓰지 않는다 — 중복 적재 방지');

// ── 계열 키 규칙 ────────────────────────────────────────────────────────
/* 대역·포락선과 같은 표·키 규칙(테이블:태그:pattern) — 한 차트에 겹쳐 그리고 태그 정리도 한 번에 */
chk(/':pattern'/.test(SRC) && /":pattern"/.test(MON), '키가 태그:pattern 규칙을 따른다');

console.log(`\nevent detail: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
