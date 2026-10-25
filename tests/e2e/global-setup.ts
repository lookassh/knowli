import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { migrateDatabase, waitUntilDatabaseReady } from "@learning/server";
import { readTestRunConfig } from "../test-run-config";

const exec = promisify(execFile);

// Playwright uruchamiany jest zawsze z korzenia repozytorium.
const repoRoot = process.cwd();
const TEST_RUN_CONFIG = readTestRunConfig(process.env);
const CONTAINER = TEST_RUN_CONFIG.e2eContainer;
const PORT = TEST_RUN_CONFIG.e2ePort;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const NEXT_BIN = join(repoRoot, "apps/web/node_modules/next/dist/bin/next");

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await exec("docker", args);
  return stdout;
}

function killTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) {
    return Promise.resolve();
  }
  if (process.platform === "win32") {
    return exec("taskkill", ["/pid", String(child.pid), "/T", "/F"]).then(
      () => undefined,
      () => undefined,
    );
  }
  child.kill("SIGTERM");
  return Promise.resolve();
}

const BUILD_TIMEOUT_MS = 600_000;

function runInherit(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  onChild?: (child: ReturnType<typeof spawn>) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    onChild?.(child);
    const timer = setTimeout(() => {
      void killTree(child);
      reject(new Error(`Polecenie ${command} ${args.join(" ")} przekroczyło limit ${BUILD_TIMEOUT_MS / 1000} s`));
    }, BUILD_TIMEOUT_MS);
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    child.once("error", (error) => settle(() => reject(error)));
    child.once("exit", (code) => settle(() => {
      if (code === 0) resolve();
      else reject(new Error(`Polecenie ${command} ${args.join(" ")} zakończyło się kodem ${String(code)}`));
    }));
  });
}

/**
 * Build produkcyjny dla trybu `next start`. Build nie łączy się z bazą
 * (leniwa inicjalizacja usług), więc dostaje atrapę DATABASE_URL jak w CI
 * i może biec równolegle ze stawianiem kontenera Postgresa.
 */
async function buildWeb(onChild?: (child: ReturnType<typeof spawn>) => void): Promise<void> {
  // .next jest współdzielone między przebiegami w jednym worktree: równoległe
  // światy muszą budować raz z góry (runner shardów wymusza potem
  // UMIEM_E2E_SKIP_BUILD=1), a nie budować jednocześnie do tego samego .next.
  await runInherit(process.execPath, [NEXT_BIN, "build"], join(repoRoot, "apps/web"), {
    ...process.env,
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/knowli",
    NEXT_TELEMETRY_DISABLED: "1",
  }, onChild);
}

async function assertBuildPresent(): Promise<void> {
  try {
    await access(join(repoRoot, "apps/web/.next/BUILD_ID"));
  } catch {
    throw new Error(
      "UMIEM_E2E_SKIP_BUILD=1, ale brak buildu produkcyjnego (apps/web/.next/BUILD_ID). "
      + "Uruchom najpierw `pnpm build` albo zdejmij UMIEM_E2E_SKIP_BUILD.",
    );
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // serwer jeszcze się podnosi
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Serwer ${url} nie odpowiedział w ${Math.round(timeoutMs / 1000)} s`);
}

function hostPort(portOutput: string): string {
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

/**
 * Jeden odizolowany świat na przebieg E2E: czysta baza, serwer web i worker
 * z fake providerami i regulowanym opóźnieniem generacji. Domyślnie web to
 * build produkcyjny pod `next start` (szybszy od `next dev`, bez kompilacji
 * tras na żądanie); `UMIEM_E2E_WEB_MODE=dev` wraca do serwera deweloperskiego
 * przy szybkiej iteracji na pojedynczym specu.
 */
export default async function globalSetup(): Promise<(() => Promise<void>) | void> {
  const cleanup: Array<() => Promise<void>> = [
    () => docker("rm", "-f", CONTAINER).then(() => undefined, () => undefined),
  ];
  const fail = async (error: unknown): Promise<never> => {
    for (const fn of cleanup.reverse()) await fn();
    throw error;
  };

  // Build startuje od razu i biegnie równolegle ze stawianiem bazy; wynik
  // odbieramy dopiero przed spawnem serwera web.
  // Brak buildu przy SKIP_BUILD zgłaszamy od razu, zanim postawimy bazę.
  if (TEST_RUN_CONFIG.e2eWebMode === "start" && TEST_RUN_CONFIG.e2eSkipBuild) {
    await assertBuildPresent().catch(fail);
  }
  let buildChild: ReturnType<typeof spawn> | undefined;
  const buildPromise: Promise<void> = TEST_RUN_CONFIG.e2eWebMode === "start" && !TEST_RUN_CONFIG.e2eSkipBuild
    ? buildWeb((child) => { buildChild = child; })
    : Promise.resolve();
  void buildPromise.catch(() => undefined);
  // Gdy baza nie wstanie, fail() ubija także wciąż biegnący build.
  cleanup.push(() => (buildChild ? killTree(buildChild) : Promise.resolve()));

  // Nawet po poprawnym handshake'u kontener potrafi być martwy (zedrsany stan
  // demona dockera); zamiast kończyć run startujemy kontener od nowa.
  const attempts = 3;
  let databaseUrl: string | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts && databaseUrl === null; attempt += 1) {
    await docker("rm", "-f", CONTAINER).catch(() => undefined);
    if (attempt > 1) {
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
        CONTAINER,
        "postgres:17-alpine",
      );
      const port = hostPort(await docker("port", CONTAINER, "5432/tcp"));
      const url = `postgres://postgres:test@127.0.0.1:${port}/postgres`;
      // pg_isready wewnątrz kontenera pyta po unix sockecie i zgłasza gotowość już
      // podczas tymczasowego serwera entrypointa (listen_addresses=''), zanim port
      // TCP hosta zacznie słuchać — wtedy migracja dostaje ECONNRESET. Czekamy na
      // realny handshake po dokładnie tym URL-u, którego używa migracja.
      await waitUntilDatabaseReady(url);
      await migrateDatabase(url, join(repoRoot, "packages/server/drizzle"));
      databaseUrl = url;
    } catch (error) {
      lastError = error;
      console.warn(`Kontener Postgres e2e nie wystartował (próba ${attempt}/${attempts}): ${String(error)}`);
    }
  }
  if (databaseUrl === null) {
    return fail(lastError);
  }

  try {
    await buildPromise;

    // świat przekazuje połączenie do bazowym testom (seedowanie należnych
    // sprawdzeń bez czekania na realny upływ dni)
    const worldFile = join(repoRoot, TEST_RUN_CONFIG.worldFile);
    await writeFile(worldFile, JSON.stringify({ databaseUrl }, null, 2));
    cleanup.push(() => rm(worldFile, { force: true }));

    const mediaRoot = await mkdtemp(join(tmpdir(), "knowli-e2e-media-"));
    cleanup.push(() => rm(mediaRoot, { recursive: true, force: true }));

    // fake providerzy muszą zgadzać się z ustawieniami medialnymi (fingerprinty)
    const sharedEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MEDIA_ROOT: mediaRoot,
      UMIEM_FAKE_PROVIDERS: "1",
      UMIEM_FAKE_DELAY_MS: process.env.UMIEM_E2E_FAKE_DELAY_MS ?? "750",
      UMIEM_FAKE_LESSON_DELAY_MS: process.env.UMIEM_E2E_FAKE_LESSON_DELAY_MS ?? "3000",
      UMIEM_TTS_PROVIDER: "fake-tts",
      UMIEM_TTS_MODEL: "fake-tts-1",
      UMIEM_TTS_VOICE: "fake-voice",
      UMIEM_IMAGE_PROVIDER: "fake-image",
      UMIEM_IMAGE_MODEL: "fake-image-1",
      UMIEM_IMAGE_SIZE: "512x512",
      WORKER_HEALTH_PORT: String(TEST_RUN_CONFIG.workerHealthPort),
    };

    const nextArgs = TEST_RUN_CONFIG.e2eWebMode === "start"
      ? ["start", "--port", String(PORT)]
      : ["dev", "--port", String(PORT)];
    if (TEST_RUN_CONFIG.e2eWebMode === "dev" && process.env.UMIEM_E2E_TURBOPACK === "1") nextArgs.push("--turbopack");
    const web = spawn(
      process.execPath,
      [NEXT_BIN, ...nextArgs],
      { cwd: join(repoRoot, "apps/web"), env: sharedEnv, stdio: "inherit" },
    );
    cleanup.push(() => killTree(web));

    const worker = spawn(
      process.execPath,
      [join(repoRoot, "apps/worker/node_modules/tsx/dist/cli.mjs"), "src/main.ts"],
      { cwd: join(repoRoot, "apps/worker"), env: { ...sharedEnv, WORKER_POLL_MS: "100" }, stdio: "inherit" },
    );
    cleanup.push(() => killTree(worker));

    await waitForHttp(`${BASE_URL}/api/v1/parent/login`, 120_000);
    return async () => {
      for (const fn of cleanup.reverse()) await fn();
    };
  } catch (error) {
    return fail(error);
  }
}
