import { deflateSync } from 'node:zlib';
import { randomInt } from 'node:crypto';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

// Randomized ground truth is kept out of the prompt and image filename.
export function makeImageProbe(blockPixels = 64) {
  if (!Number.isSafeInteger(blockPixels) || blockPixels < 32 || blockPixels > 512) throw new Error('Expected image block size between 32 and 512');
  const colors = [ ['red', [240, 20, 20]], ['green', [0, 160, 30]], ['blue', [20, 40, 240]], ['yellow', [245, 220, 10]] ];
  for (let i = colors.length - 1; i > 0; i--) {
    const swap = randomInt(i + 1); [colors[i], colors[swap]] = [colors[swap], colors[i]];
  }
  const width = blockPixels * 4, height = blockPixels;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = colors[Math.floor(x / blockPixels)][1];
      for (let c = 0; c < 3; c++) raw[y * (width * 3 + 1) + 1 + x * 3 + c] = pixel[c];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { png, colors: colors.map(([name]) => name) };
}
