import { webcrypto } from "node:crypto";

// Password hashing: PBKDF2-SHA256. The Cloudflare Workers runtime caps
// PBKDF2 iterations at 100k (NotSupportedError above that), so we hash at
// 100k here too — the CLI and the edge Function must use the same algorithm
// for stored hashes to verify.

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32; // SHA-256 output length

export interface PasswordRecord {
  saltHex: string;
  hashHex: string;
  iterations: number;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `${ITERATIONS}:${toHex(salt)}:${toHex(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseEncoded(encoded);
  if (!parsed) return false;
  const salt = fromHex(parsed.saltHex);
  const expected = fromHex(parsed.hashHex);
  const actual = await pbkdf2(password, salt, parsed.iterations);
  return constantTimeEqual(actual, expected);
}

function parseEncoded(encoded: string): { iterations: number; saltHex: string; hashHex: string } | null {
  const parts = encoded.split(":");
  if (parts.length !== 3) return null;
  const iterations = Number(parts[0]);
  if (!Number.isFinite(iterations) || iterations < 1000) return null;
  return { iterations, saltHex: parts[1]!, hashHex: parts[2]! };
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, hash: "SHA-256", iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Generate a random secret used to sign session tokens. Stored as a wrangler
 * secret on push, never in settings.md or the static deployment.
 */
export function generateSessionSecret(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
}
