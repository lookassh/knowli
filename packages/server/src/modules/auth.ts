import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { lt, sql } from "drizzle-orm";
import { parentCredentials, parentSessions } from "../db/schema";
import { AppError } from "../errors";
import type { Services } from "../config";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Parametry zapisane w formacie hasha — zgodnie z architecture.md §13.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;
const SECRET_MIN_LENGTH = 4;
const SECRET_MAX_LENGTH = 200;

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(secret, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  const valid =
    parts.length === 6 &&
    parts[0] === "scrypt" &&
    parts.slice(1, 4).every((p) => /^\d+$/.test(p)) &&
    /^[0-9a-f]+$/i.test(parts[4] ?? "") &&
    /^[0-9a-f]+$/i.test(parts[5] ?? "");
  if (!valid) {
    // ta sama praca krypto również przy uszkodzonym formacie — stały czas ścieżki
    return scrypt(secret, Buffer.alloc(16), KEY_LENGTH, SCRYPT).then(() => false);
  }
  const [, n, r, p, saltHex, keyHex] = parts as [string, string, string, string, string, string];
  return scrypt(secret, Buffer.from(saltHex, "hex"), KEY_LENGTH, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  }).then((key) => {
    const expected = Buffer.from(keyHex, "hex");
    return expected.length === key.length && timingSafeEqual(expected, key);
  });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Limiter prób logowania w pamięci procesu; MVP uruchamia jedną instancję web. */
class LoginLimiter {
  private failures: number[] = [];

  private prune(now: number): void {
    this.failures = this.failures.filter((t) => now - t < LOGIN_FAILURE_WINDOW_MS);
  }

  assertNotLocked(clockNow: Date): void {
    const now = clockNow.getTime();
    this.prune(now);
    if (this.failures.length >= LOGIN_MAX_FAILURES) {
      throw new AppError("rate_limited");
    }
  }

  recordFailure(clockNow: Date): void {
    this.failures.push(clockNow.getTime());
  }

  reset(): void {
    this.failures = [];
  }
}

const limiters = new WeakMap<Services, LoginLimiter>();

function limiterFor(services: Services): LoginLimiter {
  let limiter = limiters.get(services);
  if (!limiter) {
    limiter = new LoginLimiter();
    limiters.set(services, limiter);
  }
  return limiter;
}

function assertSecretShape(secret: string): void {
  if (secret.length < SECRET_MIN_LENGTH || secret.length > SECRET_MAX_LENGTH) {
    throw new AppError("validation", {
      message: `secret length must be between ${SECRET_MIN_LENGTH} and ${SECRET_MAX_LENGTH}`,
    });
  }
}

/** Czy rodzic jeszcze nie skonfigurował PIN/hasła (ekran pierwszego uruchomienia). */
export async function isParentSetupRequired(services: Services): Promise<boolean> {
  const rows = await services.db
    .select({ id: parentCredentials.id })
    .from(parentCredentials)
    .limit(1);
  return rows.length === 0;
}

/**
 * Jednorazowy setup poświadczeń rodzica. Pojedynczy wiersz id = 1 rozstrzyga
 * próbę równoczesnej konfiguracji: wygrywa pierwsza, pozostałe dostają błąd.
 */
export async function setupParent(services: Services, secret: string): Promise<void> {
  assertSecretShape(secret);
  const passwordHash = await hashSecret(secret);
  const inserted = await services.db
    .insert(parentCredentials)
    .values({ id: 1, passwordHash })
    .onConflictDoNothing({ target: parentCredentials.id })
    .returning({ id: parentCredentials.id });
  if (inserted.length === 0) {
    throw new AppError("already_configured");
  }
}

export async function loginParent(
  services: Services,
  secret: string,
): Promise<{ token: string; expiresAt: string }> {
  const limiter = limiterFor(services);
  limiter.assertNotLocked(services.clock.now());

  const now = services.clock.now();
  const credentials = await services.db.transaction(async (tx) => {
    // leniwe porządkowanie wygasłych sesji (architecture.md §13)
    await tx.delete(parentSessions).where(lt(parentSessions.expiresAt, now));
    const rows = await tx.select().from(parentCredentials).limit(1);
    return rows[0];
  });

  if (!credentials) {
    throw new AppError("setup_required");
  }
  if (!(await verifySecret(secret, credentials.passwordHash))) {
    limiter.recordFailure(services.clock.now());
    throw new AppError("invalid_credentials");
  }

  limiter.reset();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await services.db
    .insert(parentSessions)
    .values({ tokenHash: hashToken(token), createdAt: now, expiresAt });
  return { token, expiresAt: expiresAt.toISOString() };
}

/** Weryfikuje sesję rodzica; surowy token nigdy nie trafia do bazy. */
export async function requireParent(services: Services, token: string): Promise<void> {
  if (!token) {
    throw new AppError("unauthorized");
  }
  const now = services.clock.now();
  const session = await services.db.transaction(async (tx) => {
    await tx.delete(parentSessions).where(lt(parentSessions.expiresAt, now));
    const rows = await tx
      .select({ tokenHash: parentSessions.tokenHash })
      .from(parentSessions)
      .where(sql`${parentSessions.tokenHash} = ${hashToken(token)}`)
      .limit(1);
    return rows[0];
  });
  if (!session) {
    throw new AppError("unauthorized");
  }
}

export async function logoutParent(services: Services, token: string): Promise<void> {
  await services.db
    .delete(parentSessions)
    .where(sql`${parentSessions.tokenHash} = ${hashToken(token)}`);
}
