import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { open, unlink, chmod } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDatabase,
  createServices,
  issueIntegrationToken,
  listIntegrationTokens,
  revokeIntegrationToken,
} from "@learning/server";
import type { Services } from "@learning/server";

type TokenMetadata = Awaited<ReturnType<typeof listIntegrationTokens>>[number];
type CliDependencies = {
  issue: (name: string, secret: string) => Promise<{ id: string }>;
  list?: () => Promise<readonly TokenMetadata[]>;
  revoke?: (id: string) => Promise<void>;
  randomToken?: () => string;
  secureFile?: (path: string) => Promise<void>;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

function defaultRandomToken(): string {
  return `umiem_${randomUUID()}_${randomBytes(32).toString("base64url")}`;
}

async function secureTokenFile(path: string): Promise<void> {
  if (process.platform === "win32") {
    const identity = execFileSync("whoami.exe", [], { encoding: "utf8" }).trim();
    if (!identity || /[\r\n]/.test(identity)) throw new Error("Unable to identify token file owner");
    execFileSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${identity}:(R,W)`], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return;
  }
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new Error("Unsupported platform for private token files");
  }
  await chmod(path, 0o600);
  const mode = (await (await import("node:fs/promises")).stat(path)).mode & 0o777;
  if (mode !== 0o600) throw new Error("Unable to restrict token file permissions");
}

async function writePrivateSecret(path: string, secret: string, secureFile: (path: string) => Promise<void>): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await secureFile(path);
    await handle.writeFile(secret, "utf8");
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(path).catch(() => undefined);
    throw error;
  }
}

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (args.indexOf(flag, index + 1) >= 0) throw new Error(`Duplicate ${flag}`);
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function ensureOnlyOptions(args: string[], allowed: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.includes(args[index]!)) throw new Error("Unknown integration token option");
    index += 1;
  }
}

export async function runIntegrationTokenCommand(args: string[], deps: CliDependencies): Promise<void> {
  const [command, ...options] = args;
  if (command === "create") {
    ensureOnlyOptions(options, ["--name", "--out"]);
    const name = readOption(options, "--name")?.trim();
    const outputPath = readOption(options, "--out");
    if (!name || name.length > 120 || !outputPath || !isAbsolute(outputPath)) {
      throw new Error("Usage: integration-tokens create --name <name> --out <absolute-path>");
    }
    const path = resolve(outputPath);
    const secret = (deps.randomToken ?? defaultRandomToken)();
    let created = false;
    try {
      await writePrivateSecret(path, secret, deps.secureFile ?? secureTokenFile);
      created = true;
      const { id } = await deps.issue(name, secret);
      deps.stdout(`Created integration token ${id}; secret saved to the requested file.`);
    } catch (error) {
      if (created) await unlink(path).catch(() => undefined);
      throw error;
    }
    return;
  }

  if (command === "list") {
    ensureOnlyOptions(options, []);
    if (!deps.list) throw new Error("List command is unavailable");
    const rows = (await deps.list()).map((token) => ({
      ...token,
      createdAt: token.createdAt.toISOString(),
      revokedAt: token.revokedAt?.toISOString() ?? null,
    }));
    deps.stdout(JSON.stringify(rows, null, 2));
    return;
  }

  if (command === "revoke") {
    ensureOnlyOptions(options, ["--id"]);
    const id = readOption(options, "--id");
    if (!id || !deps.revoke) throw new Error("Usage: integration-tokens revoke --id <uuid>");
    await deps.revoke(id);
    deps.stdout(`Revoked integration token ${id}.`);
    return;
  }

  throw new Error("Usage: integration-tokens <create|list|revoke> ...");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  const { db, pool } = createDatabase(databaseUrl);
  const services: Services = createServices({ db });
  try {
    await runIntegrationTokenCommand(process.argv.slice(2), {
      issue: (name, secret) => issueIntegrationToken(services, name, secret),
      list: () => listIntegrationTokens(services),
      revoke: (id) => revokeIntegrationToken(services, id),
      stdout: (message) => process.stdout.write(`${message}\n`),
      stderr: (message) => process.stderr.write(`${message}\n`),
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Avoid printing driver messages that may contain SQL parameters.
    process.stderr.write("Integration token command failed.\n");
    process.exitCode = 1;
  });
}
