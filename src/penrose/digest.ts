/**
 * Non-cryptographic 64-bit FNV-1a over UTF-8 plus length.
 * Used only as a cache key for compiled trios (`topologyDigest`); it is not a
 * security primitive.
 */
export function topologyDigest(parts: readonly (string | number)[]): string {
  const input = parts.join('\u0000');
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return `${hash.toString(16).padStart(16, '0')}-${bytes.length.toString(16)}`;
}
