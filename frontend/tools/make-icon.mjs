// 패키지 아이콘 생성 — 베어링 단면 위로 진동 파형이 가로지르는 그림.
// 도형이 원과 선분뿐이라 픽셀 거리로 직접 칠한다(이 환경에 SVG 변환 도구가 없다).
// 경계는 거리 기반 알파로 부드럽게 만든다 — 안 하면 256px 에서 계단이 그대로 보인다.
//   node frontend/tools/make-icon.mjs [출력경로]
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 256;
const OUT = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../icon.png');

const BG = [0x25, 0x28, 0x30];      // 둥근 사각형 배경
/* 금속색 — 목록의 28px 아이콘에서 링과 전동체가 뭉치지 않으려면 둘의 명도 차가 커야 한다.
   전동체를 가장 밝게 두어 작게 줄여도 "링 안의 볼"로 읽히게 한다. */
const RING = [0xb6, 0xbf, 0xcc];    // 외륜
const INNER = [0x8c, 0x95, 0xa3];   // 내륜 — 한 톤 낮춰 깊이를 준다
const BALL = [0xdc, 0xe2, 0xea];    // 전동체
const WAVE = [0xff, 0x57, 0x57];    // 진동 파형 — 유일한 강조색

const px = new Uint8Array(S * S * 4);
const cov = (d) => (d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d);

function blend(i, c, a) {
  if (a <= 0) return;
  const sa = px[i + 3] / 255;
  const na = a + sa * (1 - a);
  for (let k = 0; k < 3; k++) px[i + k] = Math.round((c[k] * a + px[i + k] * sa * (1 - a)) / (na || 1));
  px[i + 3] = Math.round(na * 255);
}

// 둥근 사각형까지의 부호 거리(안쪽이 음수)
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}
// 선분까지의 거리 — 끝이 저절로 둥글어져 별도 캡 처리가 필요 없다
function sdSeg(x, y, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy));
}

const C = S / 2;
// 전동체 — 8개, 45도 간격. 파형이 지나갈 자리를 비우지 않는다(파형이 위에 얹힌다).
const BALLS = [];
for (let i = 0; i < 8; i++) {
  const t = (i * Math.PI) / 4 + Math.PI / 8;
  BALLS.push([C + 72 * Math.cos(t), C + 72 * Math.sin(t)]);
}

/* 파형 — 베어링 충격은 좌우 대칭이 아니다. 잔잔하다가 한 번 크게 때리고(impulse)
   그 뒤로 울리며 잦아든다(ringing decay). 대칭 파형은 정상 회전 진동처럼 보인다. */
const PTS = [
  [16, 158], [62, 158], [74, 152], [84, 166], [94, 148], [102, 170],
  [110, 74], [118, 220], [126, 96], [134, 202], [142, 116], [150, 188],
  [158, 132], [166, 178], [174, 142], [182, 172], [190, 150], [198, 166],
  [206, 155], [214, 161], [240, 158],
];
const WAVE_W = 7;

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const ax = x + 0.5, ay = y + 0.5;
    const r = Math.hypot(ax - C, ay - C);

    blend(i, BG, cov(sdRoundRect(ax, ay, C, C, 124, 124, 56)));
    blend(i, RING, cov(Math.abs(r - 96) - 7));      // 외륜
    blend(i, INNER, cov(Math.abs(r - 44) - 6));     // 내륜

    let bd = Infinity;
    for (const [bx, by] of BALLS) bd = Math.min(bd, Math.hypot(ax - bx, ay - by));
    blend(i, BALL, cov(bd - 13));                   // 전동체

    let wd = Infinity;                              // 파형 — 맨 위에 얹는다
    for (let k = 0; k < PTS.length - 1; k++) {
      wd = Math.min(wd, sdSeg(ax, ay, PTS[k][0], PTS[k][1], PTS[k + 1][0], PTS[k + 1][1]));
    }
    blend(i, WAVE, cov(wd - WAVE_W / 2));
  }
}

/* PNG 인코딩 — 필터 0(None) 스캔라인 + zlib. 단순할수록 깨질 자리가 없다. */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
fs.writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${OUT} — ${S}x${S}, ${fs.statSync(OUT).size} bytes`);
