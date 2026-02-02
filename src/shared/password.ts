import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

type ScryptParams = {
  N: number;
  r: number;
  p: number;
  keylen: number;
};

const DEFAULT_SCRYPT: ScryptParams = {
  // Reasonable defaults for interactive logins (adjust if needed).
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
};

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {return reject(err);}
      resolve(derivedKey as Buffer);
    });
  });
}

function parseScryptHash(encoded: string): {
  version: string;
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
} | null {
  const parts = String(encoded || "").split("$");
  // Format: scrypt$1$N$r$p$salt$hash
  if (parts.length !== 7) {return null;}
  const [kind, version, Nraw, rraw, praw, saltB64, hashB64] = parts;
  if (kind !== "scrypt") {return null;}
  if (!version) {return null;}

  const N = Number(Nraw);
  const r = Number(rraw);
  const p = Number(praw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {return null;}
  if (N <= 1 || r <= 0 || p <= 0) {return null;}

  try {
    const salt = Buffer.from(saltB64, "base64url");
    const hash = Buffer.from(hashB64, "base64url");
    if (salt.length < 8 || hash.length < 32) {return null;}
    return {
      version,
      params: { N, r, p, keylen: hash.length },
      salt,
      hash,
    };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string, params: Partial<ScryptParams> = {}): Promise<string> {
  const p: ScryptParams = { ...DEFAULT_SCRYPT, ...params };
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, p.keylen, { N: p.N, r: p.r, p: p.p });
  return `scrypt$1$${p.N}$${p.r}$${p.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseScryptHash(encoded);
  if (!parsed) {return false;}
  if (parsed.version !== "1") {return false;}

  const derived = await scryptAsync(password, parsed.salt, parsed.params.keylen, {
    N: parsed.params.N,
    r: parsed.params.r,
    p: parsed.params.p,
  });

  if (derived.length !== parsed.hash.length) {return false;}
  return timingSafeEqual(derived, parsed.hash);
}

