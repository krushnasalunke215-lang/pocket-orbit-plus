/**
 * Incremental 32-bit FNV-1a. The hash state is a plain unsigned 32-bit number.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnvInit(): number {
  return FNV_OFFSET_BASIS;
}

function fnvByte(h: number, byte: number): number {
  return Math.imul(h ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/** Hashes the low 32 bits of an integer as 4 little-endian bytes. */
export function fnvInt32(h: number, n: number): number {
  const v = n | 0;
  h = fnvByte(h, v);
  h = fnvByte(h, v >>> 8);
  h = fnvByte(h, v >>> 16);
  return fnvByte(h, v >>> 24);
}

/**
 * Hashes a string by UTF-16 code unit: one byte for code units below 0x80,
 * otherwise two little-endian bytes. ASCII strings hash exactly like FNV-1a
 * over their bytes.
 */
export function fnvString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = fnvByte(h, c);
    if (c >= 0x80) h = fnvByte(h, c >>> 8);
  }
  return h;
}

/** The hash as 8 lowercase hex characters. */
export function fnvHex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
