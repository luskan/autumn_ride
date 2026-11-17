// Author credits, kept out of plain text: each UTF-8 byte is rotated left by a number of bits
// that depends on its position. The About card decodes them and draws them as images only,
// so neither the page source nor the DOM holds the name or the address as text.
// New values: node -e "import('./src/credits.js').then((m) => console.log(JSON.stringify(m.encode('text'))))"

const shift = (i) => ((i * 3) % 7) + 1; // 1..7 bits
const rotl = (b, n) => ((b << n) | (b >> (8 - n))) & 0xff;
const rotr = (b, n) => ((b >> n) | (b << (8 - n))) & 0xff;

export const encode = (text) => [...new TextEncoder().encode(text)].map((b, i) => rotl(b, shift(i)));
export const decode = (bytes) => new TextDecoder().decode(Uint8Array.from(bytes, (b, i) => rotr(b, shift(i))));

const AUTHOR = [154, 22, 57, 27, 90, 185, 4, 148, 76, 204, 35, 156, 233, 172, 212, 86, 187, 155, 218, 165];
const MAIL = [218, 22, 57, 27, 90, 185, 77, 202, 4, 179, 107, 88, 165, 141, 92, 54, 183, 107];

export const getCredits = () => ({ name: decode(AUTHOR), mail: decode(MAIL) });
