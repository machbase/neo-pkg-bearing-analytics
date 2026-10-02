// 결정론 난수(mulberry32) — 회귀 판정용 Math.random 대체
// Math.imul로 32비트 안에서만 곱함(큰 곱 LCG는 저비트 소실로 주기 붕괴)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;   // [-1, 1)
  };
}
