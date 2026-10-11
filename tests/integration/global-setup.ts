import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { migrateDatabase } from "@learning/server";
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

async function waitForPostgres(name: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const out = await docker("exec", name, "pg_isready", "-U", "postgres", "-d", "postgres");
      if (out.includes("accepting connections")) return;
    } catch {
      // kontener jeszcze startuje
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`PostgreSQL w kontenerze ${name} nie odpowiedział w 60 s`);
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
  // pg_isready wewnątrz kontenera nie gwarantuje stabilnego socketu na hoście:
  // pierwszy socket bywa zrywany (runner CI i Docker Desktop). Kontener jest
  // wtedy martwy dla migracji, więc zamiast kończyć run startujemy od nowa.
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
      await waitForPostgres(name);
      const port = hostPort(await docker("port", name, "5432/tcp"));
      const url = `postgres://postgres:test@127.0.0.1:${port}/postgres`;
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
