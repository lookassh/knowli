#!/usr/bin/env node
/**
 * Lokalny równoległy przebieg E2E (odpowiednik shardingu z CI):
 * jeden build produkcyjny, potem równolegle:
 *  - projekt `mocked` na wielu workerach w jednym świecie,
 *  - projekt `real` podzielony na N shardów, każdy z własnym światem
 *    (osobny Postgres, `next start` i worker przez UMIEM_TEST_RUN_ID).
 *
 * Użycie: pnpm test:e2e:shards [--shards=3] [--mocked-workers=4]
 *         [--base-port=24600] [--grep=<wzorzec>] [--skip-mocked] [--skip-real]
 * Z UMIEM_E2E_SKIP_BUILD=1 pomija build (wymaga istniejącego apps/web/.next).
 */
"use strict";

const { spawn, execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const exec = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");
const NEXT_BIN = path.join(repoRoot, "apps/web/node_modules/next/dist/bin/next");
const PLAYWRIGHT_CLI = path.join(repoRoot, "node_modules/@playwright/test/cli.js");
const BUILD_ID = path.join(repoRoot, "apps/web/.next/BUILD_ID");

function parseArgs(argv) {
  const options = {
    shards: 3,
    mockedWorkers: 4,
    basePort: 24600,
    grep: null,
    skipMocked: false,
    skipReal: false,
  };
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Nieznany argument: ${arg} (oczekiwane --nazwa[=wartość])`);
    const [, name, value] = match;
    switch (name) {
      case "shards":
        options.shards = parseInteger(name, value, 1, 8);
        break;
      case "mocked-workers":
        options.mockedWorkers = parseInteger(name, value, 1, 32);
        break;
      case "base-port":
        options.basePort = parseInteger(name, value, 1024, 65000);
        break;
      case "grep":
        if (!value) throw new Error("--grep wymaga wzorca: --grep=<wzorzec>");
        options.grep = value;
        break;
      case "skip-mocked":
        options.skipMocked = true;
        break;
      case "skip-real":
        options.skipReal = true;
        break;
      case "help":
        console.log(
          "pnpm test:e2e:shards [--shards=3] [--mocked-workers=4] [--base-port=24600] "
          + "[--grep=<wzorzec>] [--skip-mocked] [--skip-real]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Nieznana opcja: --${name}`);
    }
  }
  if (options.skipMocked && options.skipReal) {
    throw new Error("--skip-mocked i --skip-real naraz nie zostawiają nic do uruchomienia");
  }
  return options;
}

function parseInteger(name, value, min, max) {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`--${name} musi być liczbą całkowitą od ${min} do ${max}`);
  }
  const parsed = Number(value);
  if (parsed < min || parsed > max) {
    throw new Error(`--${name} musi być liczbą całkowitą od ${min} do ${max}`);
  }
  return parsed;
}

function runInherit(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
    children.add(child);
    child.once("error", (error) => {
      children.delete(child);
      reject(error);
    });
    child.once("exit", (code) => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`Polecenie zakończyło się kodem ${String(code)}: ${args.join(" ")}`));
    });
  });
}

function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    exec("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => undefined);
  } else {
    child.kill("SIGTERM");
  }
}

function prefixStream(stream, prefix, target) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) target.write(`${prefix} ${line}\n`);
  });
  stream.on("end", () => {
    if (buffer) target.write(`${prefix} ${buffer}\n`);
  });
}

const children = new Set();

function runPlaywright(label, runId, port, playwrightArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test", ...playwrightArgs], {
      cwd: repoRoot,
      env: {
        ...process.env,
        UMIEM_TEST_RUN_ID: runId,
        UMIEM_E2E_PORT: String(port),
        // Jawny port health workera per świat: odziedziczony z powłoki
        // UMIEM_WORKER_HEALTH_PORT związałby wszystkie światy do jednego portu.
        UMIEM_WORKER_HEALTH_PORT: String(10_000 + (port % 50_000)),
        UMIEM_E2E_WEB_MODE: "start",
        UMIEM_E2E_SKIP_BUILD: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    prefixStream(child.stdout, `[${label}]`, process.stdout);
    prefixStream(child.stderr, `[${label}]`, process.stderr);
    child.once("error", (error) => {
      children.delete(child);
      resolve({ label, code: 1, error: String(error) });
    });
    // `close`, nie `exit`: podsumowanie ma wypisać się dopiero po spłukaniu
    // prefiksowanego wyjścia dziecka.
    child.once("close", (code) => {
      children.delete(child);
      resolve({ label, code: code ?? 1 });
    });
  });
}

async function cleanupContainers(runIds) {
  // Sieć bezpieczeństwa: global-teardown Playwrighta usuwa kontenery po
  // przebiegu, ale po twardym przerwaniu mogłyby zostać osierocone.
  for (const runId of runIds) {
    await exec("docker", ["rm", "-f", `knowli-e2e-${runId}`]).catch(() => undefined);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  if (process.env.UMIEM_E2E_SKIP_BUILD === "1") {
    if (!existsSync(BUILD_ID)) {
      throw new Error("UMIEM_E2E_SKIP_BUILD=1, ale brak apps/web/.next/BUILD_ID — uruchom `pnpm build`.");
    }
    console.log("[shards] Pomijam build (UMIEM_E2E_SKIP_BUILD=1).");
  } else {
    console.log("[shards] Buduję web (jednorazowo dla wszystkich światów)...");
    await runInherit([NEXT_BIN, "build"], path.join(repoRoot, "apps/web"), {
      ...process.env,
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/knowli",
      NEXT_TELEMETRY_DISABLED: "1",
    });
  }

  const runs = [];
  const runIds = [];
  // Z --grep projekt bez trafień ma wyjść zielono, a nie wywrócić cały przebieg
  // błędem "No tests found" (shardy realne i tak tolerują pusty wycinek).
  const grepArgs = options.grep ? ["--grep", options.grep, "--pass-with-no-tests"] : [];
  // Sufiks pid: dwa równoległe wywołania runnera na tej samej maszynie nie
  // mogą współdzielić kontenerów, plików świata ani katalogów wyników
  // (porty nadal rozdziela --base-port).
  const suffix = `-${process.pid}`;
  if (!options.skipMocked) {
    const runId = `shards-mocked${suffix}`;
    runIds.push(runId);
    runs.push(runPlaywright("mocked", runId, options.basePort, [
      "--project=mocked",
      `--workers=${options.mockedWorkers}`,
      ...grepArgs,
    ]));
  }
  if (!options.skipReal) {
    for (let shard = 1; shard <= options.shards; shard += 1) {
      const runId = `shards-real-${shard}${suffix}`;
      runIds.push(runId);
      runs.push(runPlaywright(`real-${shard}/${options.shards}`, runId, options.basePort + shard * 10, [
        "--project=real",
        `--shard=${shard}/${options.shards}`,
        "--workers=1",
        ...grepArgs,
      ]));
    }
  }

  let results;
  try {
    results = await Promise.all(runs);
  } finally {
    await cleanupContainers(runIds);
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n[shards] Podsumowanie (${elapsed} s):`);
  let failed = false;
  for (const result of results) {
    console.log(`[shards]   ${result.label}: ${result.code === 0 ? "PASS" : `FAIL (kod ${result.code})`}${result.error ? ` — ${result.error}` : ""}`);
    if (result.code !== 0) failed = true;
  }
  if (failed) process.exitCode = 1;
}

let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  // Ubijamy całe drzewa procesów: sam CLI Playwrighta zostawiłby osierocone
  // `next start` i workery światów na ich portach.
  for (const child of children) killTree(child);
});

main().catch((error) => {
  console.error(`[shards] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
