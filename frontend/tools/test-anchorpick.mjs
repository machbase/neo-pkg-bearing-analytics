// 판정 앵커 선택기 — "기간의 끝 한 점"이 정지·무부하면 파손 중인 설비가 양호로 나온다.
// 실측 근거: NASA IMS Set2 B1은 외륜 파손으로 시험이 끝났는데 마지막 두 스냅샷이 정지(RMS 0.002 g)였다.
globalThis.window = globalThis;
const { App } = await import('../src/app.js');
const VC = (await import('../../cgi-bin/calc/calc.js')).default;

let fail = 0;
const chk = (c, label, extra) => {
  if (c) console.log('PASS', label, extra === undefined ? '' : extra);
  else { fail++; console.log('FAIL', label, extra === undefined ? '' : extra); }
};

const app = new App({ seed: 1, equipmentCount: 1 });
const eq = { id: 'T:x', table: 'T', name: 'x', unit: 'mm/s', cls: 'I', rpm: 1800, fs: 20480 };
const A = (at, acRms, isoRms, patScore) => ({ at, acRms, isoRms, patScore, patKey: 'BPFO', n: 20480 });
const pick = (anchors) => app._pickAnchor(eq, { anchors, scanned: anchors.length }, 9999);
const zones = app._isoZones(eq);
console.log('Class I 존:', zones.join(' / '), 'mm/s');

// ── 정지 시점이 마지막이어도 나쁜 시점을 고른다 ─────────────────────────────
{
  const p = pick([
    A(1000, 0.5, 0.6, 2.2),
    A(2000, 0.5, 0.7, 16.7),   // 최악
    A(3000, 0.001, 0.02, 4.2), // 정지 — 옛 동작은 여기를 봤다
  ]);
  chk(p.at === 2000, '정지가 마지막이어도 기간 최악을 고른다', 'at=' + p.at);
  chk(p.stopped === 1, '정지 의심 개수를 함께 낸다 — 화면이 "왜 끝이 아닌가"를 말할 수 있어야 한다', p.stopped);
}

// ── 정지 판정은 기간 자기 자신 대비(절대값 아님) ────────────────────────────
/* 절대 임계를 두면 단위(g/mm·s⁻¹/μm)와 설비 크기마다 다시 맞춰야 하고, 저진폭 정상 설비가
   통째로 "정지"가 된다. 중앙값의 5% 미만만 그 기간의 이 설비가 아니라고 본다. */
{
  const low = pick([A(1, 0.004, 0.05, 2), A(2, 0.005, 0.06, 2), A(3, 0.006, 0.07, 2)]);
  chk(low.stopped === 0, '전체가 저진폭이면 아무도 정지가 아니다 — 비교 대상이 없으면 판단하지 않는다', low.stopped);
  const one = pick([A(1, 0.5, 0.6, 2), A(2, 0.5, 0.6, 2), A(3, 0.01, 0.02, 2)]);
  chk(one.stopped === 1, '기간 대표값의 5% 미만인 점만 정지로 본다', one.stopped);
}

// ── 전부 정지면 빈 화면 대신 그 중에서 고른다 ───────────────────────────────
{
  const p = pick([A(1, 0.001, 0.01, 1), A(2, 0.002, 0.02, 1)]);
  chk(p.at === 2, '전부 정지면 그 안에서라도 고른다 — 빈 화면보다 낫다', 'at=' + p.at);
}

// ── 순위: ISO 등급 → 결함 채택 → 점수 ───────────────────────────────────────
{
  // 존을 넘는 쪽이 결함점수가 낮아도 이긴다(등급이 먼저다)
  const p = pick([A(1, 0.5, zones[1] + 0.1, 4.5), A(2, 0.5, 0.1, 99)]);
  chk(p.at === 1, 'ISO 등급이 결함점수보다 앞선다', 'at=' + p.at);
  // 등급이 같으면 채택된 쪽, 그 다음 점수
  const q = pick([A(1, 0.5, 0.1, VC.TGT_ADOPT - 0.1), A(2, 0.5, 0.1, VC.TGT_ADOPT + 5)]);
  chk(q.at === 2, '등급이 같으면 결함 격자에 붙은 쪽', 'at=' + q.at);
}

// ── 후보가 하나도 없으면 원래 앵커로 돌아간다 ───────────────────────────────
{
  const p = pick([{ at: 1, empty: true }, { at: 2, empty: true }]);
  chk(p.at === 9999, '전부 빈 창이면 폴백 앵커(기간의 끝)를 쓴다', 'at=' + p.at);
}

// ── 최댓값을 쓰면 "몇 곳이 같은 수준이었나"를 함께 내야 한다 ─────────────────
/* 8곳 중 1곳만 걸린 것과 7곳이 걸린 것은 정비 판단이 완전히 다른데 등급어 하나로는 안 갈린다.
   판정에는 안 태운다 — 지속성을 판정 기준에 넣으면 단발로 서는 진짜 결함이 같이 죽는다. */
{
  const z = app._isoZones(eq);
  const many = pick([1,2,3,4,5,6,7,8].map((i) => A(i, 0.5, i <= 7 ? z[1] + 0.1 : 0.1, 2)));
  chk(many.atLevel === 7 && many.poolN === 8, '지속된 이상은 곳 수를 그대로 센다',
    many.atLevel + '/' + many.poolN);
  const one = pick([1,2,3,4,5,6,7,8].map((i) => A(i, 0.5, i === 3 ? z[1] + 0.1 : 0.1, 2)));
  chk(one.atLevel === 1, '단발은 1곳으로 드러난다 — 화면이 "단발일 수 있습니다"를 붙인다', one.atLevel);
  const calm = pick([1,2,3,4].map((i) => A(i, 0.5, 0.1, 2)));
  chk(calm.level === 0, '정상 수준이면 분포를 말하지 않는다 — "4곳 중 4곳 정상"은 아무 뜻이 없다', calm.level);
  const st = pick([A(1, 0.5, z[1] + 0.1, 2), A(2, 0.5, z[1] + 0.1, 2), A(3, 0.005, 0.01, 1)]);
  chk(st.poolN === 2 && st.atLevel === 2, '정지 의심은 분모에서도 빠진다', st.atLevel + '/' + st.poolN);
}

console.log(fail ? `\n=== FAIL ${fail}건 ===` : '\n=== 전부 통과 ===');
process.exit(fail ? 1 : 0);
