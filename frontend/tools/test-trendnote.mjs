/* 첨도·대역 추이가 비었을 때의 처리(소스 구조 검사) — 오프라인(Neo 불필요) · npm run smoke 포함
   · 대역(FFT, 창당 256샘플) 실패가 첨도를 끌고 가지 않음, 빈 원인별 사유 문구
   · 값이 없으면 캔버스·툴팁 비움, 계산 완료·실패 시 문구 갱신, 간헐 수집 앵커 되짚기 */
import { readFile } from 'node:fs/promises';

let fail = 0;
const chk = (ok, msg, extra) => {
  if (ok) console.log('PASS', msg, extra || '');
  else { fail++; console.error('FAIL', msg, extra || ''); }
};
const live = await readFile(new URL('../src/data/live.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const view = await readFile(new URL('../src/view.js', import.meta.url), 'utf8');

// ── 첨도는 대역 실패와 무관 ───────────────────────────────────
chk(!/const be = Band\.bandEnergy\([^)]*\);\s*\n\s*if \(!be\) return;/.test(live),
  '대역 계산 실패로 청크를 통째로 버리지 않는다 — 첨도까지 함께 사라졌던 자리');
chk(/kurt\.push\(VC\.kurtosis\(w\.values\)\);\s*\n\s*if \(be\)/.test(live),
  '첨도를 먼저 담고 대역은 있을 때만 담는다');
chk(/else bandVals\.forEach\(\(a\) => a\.push\(null\)\);/.test(live),
  '대역이 없으면 null로 채운다 — x축을 공유하므로 길이는 맞아야 한다');

// ── 빈 사유를 값과 함께 반환 ────────────────────────────────────────
chk(/const kurtNote = kurt\.length \? ''/.test(live), '첨도가 없으면 사유를 만든다');
chk(/const bandNote = \(bandHas \|\| envBands\.length\) \? ''/.test(live), '대역이 없으면 사유를 만든다');
chk(/256샘플/.test(live) && /최소 128 Hz/.test(live), '대역 사유에 필요한 표본 수와 샘플레이트를 적는다');
chk(/64샘플/.test(live), '첨도 사유에 필요한 표본 수를 적는다');

// ── 간헐 수집: 앵커가 비면 실제 표본으로 당김 ────────────────────────────
chk(/DB\.lastSampleMs\(eq\.table, eq\.name, lo, at\)/.test(live),
  '빈 앵커는 표본이 있는 마지막 초로 당겨 잰다 — 10분마다 1초 수집이면 균등 앵커가 거의 다 빈다');
chk(/const lo = Math\.max\(fromMs, at - \(step \|\| \(toMs - fromMs\)\)\)/.test(live),
  '되짚기 하한은 직전 앵커까지 — 더 가면 여러 앵커가 같은 구간을 겹쳐 잰다');
chk(/if \(w && w\.values\.length >= 64\) return \{ at, w \};/.test(live),
  '앵커에 데이터가 있으면 되짚지 않는다 — 연속 수집 태그에는 조회가 안 붙는다');

// ── 못 낸 이유를 실제 결과로 구분 — 사용자 조치가 서로 다름 ──
chk(/w\.failed/.test(live), '조회 실패와 데이터 없음을 구분해 센다');
chk(/원시 데이터 조회에 실패했습니다/.test(live), '실패가 많으면 실패라고 적는다');
chk(/지점에 원시 파형이 없습니다/.test(live),
  '지점이 비었으면 구간을 좁히라고 적는다 — 표본 수를 탓하면 엉뚱하게 센서 사양을 보게 된다');
chk(/E\.addTip\(kurtC, C\('vt-kurt'\), null, \[\]\)/.test(app),
  '캔버스를 비울 때 툴팁도 지운다 — 핸들러가 남아 옛 값이 떠오른다');

// ── 값이 없으면 캔버스 비움 — 이전 선택 그래프 잔존 방지 ──
chk(/else if \(kurtC\) \{/.test(app) && /E\.drawLine\(kurtC, \{ values: \[\]/.test(app),
  '첨도 값이 없으면 캔버스를 비운다');
chk(/else if \(band\) \{/.test(app) && /E\.drawMultiLine\(band, \{ series: \[\]/.test(app),
  '대역 값이 없으면 캔버스를 비운다');

// ── 계산 완료 시 문구도 갱신 ───────────────────────────────────
chk(/self\._scheduleDraw\(\); self\.forceUpdate\(\);/.test(app),
  '청크 로드가 끝나면 화면도 다시 그린다 — 캔버스만 갱신하면 문구가 로딩 시점에 멈춘다');
chk(/c\.state = 'error'; self\.forceUpdate\(\);/.test(app), '실패해도 화면을 갱신한다');

// ── 상태별 문구 구분 ─────────────────────────────────────────────────
chk(/_trErr \? '계산에 실패했습니다/.test(app),
  '조회 실패를 표본 부족으로 적지 않는다 — 없는 데이터 문제를 찾게 된다');
chk(/_trBusy \? '계산 중…'/.test(app), '계산 중에는 계산 중이라고 적는다');
chk(/base\.kurtNote = \(_tr && \(_tr\.kurt \|\| \[\]\)\.length\) \? ''/.test(app),
  '값이 있으면 문구를 띄우지 않는다 — 그래프와 문구가 모순되지 않아야 한다');

// ── 화면에 사유 렌더 ─────────────────────────────────────────────
chk(/\$\{\(kurtNote\) \? html`/.test(view), '첨도 카드가 사유를 렌더한다');
chk(/\$\{\(bandNote\) \? html`/.test(view), '대역 카드가 사유를 렌더한다');

console.log(fail ? `\n=== ${fail}건 실패 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
