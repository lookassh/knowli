import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { migrateDatabase, waitUntilDatabaseReady } from "@learning/server";
import { readTestRunConfig } from "../test-run-config";

const exec = promisify(execFile);

const CONTAINER_PREFIX = readTestRunConfig(process.env).integrationContainerPrefix;
const POSTGRES_IMAGE = "postgres:17-alpine";

function containerName(): string {
  return `${CONTAINER_PREFIX}${process.pid}`;
}

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await exec("docker", args);
  return stdout;
}

async function removeStaleContainers(): Promise<void> {
  const ids = (await docker("ps", "-aq", "--filter", `name=${CONTAINER_PREFIX}`)).trim();
  if (!ids) return;
  for (const id of ids.split(/\r?\n/)) {
    if (id) await docker("rm", "-f", id).catch(() => undefined);
  }
}

function hostPort(portOutput: string): string {
  // "docker port <c> 5432/tcp" zwraca linie "0.0.0.0:55001" (ew. "[::]:55001");
  // forma z "5432/tcp -> ..." również jest obsługiwana.
  const line = portOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.includes("0.0.0.0:"));
  const mapped = line?.split("->").pop()?.trim();
  const port = mapped?.split(":").pop();
  if (!port || !/^\d+$/.test(port)) {
    throw new Error(`Nie udało się odczytać portu kontenera: ${portOutput}`);
  }
  return port;
}

interface GlobalSetupContext {
  provide: (key: string, value: unknown) => void;
}

export default async function globalSetup({
  provide,
}: GlobalSetupContext): Promise<(() => Promise<void>) | void> {
  await removeStaleContainers();
  const name = containerName();
  // Nawet po poprawnym handshake'u kontener potrafi być martwy (zedrsany stan
  // demona dockera); zamiast kończyć run startujemy kontener od nowa.
  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      await docker("rm", "-f", name).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    try {
      await docker(
        "run",
        "-d",
        "--rm",
        "-P",
        "-e",
        "POSTGRES_USER=postgres",
        "-e",
        "POSTGRES_PASSWORD=test",
        "--name",
        name,
        POSTGRES_IMAGE,
      );
      const port = hostPort(await docker("port", name, "5432/tcp"));
      const url = `postgres://postgres:test@127.0.0.1:${port}/postgres`;
      // pg_isready wewnątrz kontenera pyta po unix sockecie i zgłasza gotowość już
      // podczas tymczasowego serwera entrypointa (listen_addresses=''), zanim port
      // TCP hosta zacznie słuchać — wtedy migracja dostaje ECONNRESET. Czekamy na
      // realny handshake po dokładnie tym URL-u, którego używa migracja.
      await waitUntilDatabaseReady(url);
      await migrateDatabase(url, "packages/server/drizzle");
      provide("DATABASE_URL", url);
      provide("TEST_CONTAINER", name);
      return async () => {
        await docker("rm", "-f", name).catch(() => undefined);
      };
    } catch (error) {
      lastError = error;
      console.warn(`Kontener Postgres testów integracyjnych nie wystartował (próba ${attempt}/${attempts}): ${String(error)}`);
    }
  }
  await docker("rm", "-f", name).catch(() => undefined);
  throw lastError;
}
