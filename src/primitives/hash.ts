/**
 * src/primitives/hash.ts
 * Hashing utilities. Uses Web Crypto (crypto.subtle) which is available on Cloudflare.
 */

/** Compute SHA-1 hex of a string. */
export async function sha1(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return bufferToHex(buffer);
}

/** Compute SHA-256 hex of a string. */
export async function sha256(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bufferToHex(buffer);
}

/** Generate a short random ID (8 chars). Suitable for post IDs, job IDs. */
export function shortId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a UUID v4. */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (should not be needed on Cloudflare Workers, but keeps tests happy).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Convert ArrayBuffer to hex string. */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}
