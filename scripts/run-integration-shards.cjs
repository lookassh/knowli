#!/usr/bin/env node
/**
 * Lokalny równoległy przebieg testów integracyjnych: te same kosze czasowe
 * INTEGRATION_BUCKETS co joby `integration (N)` w CI, każdy jako osobny proces
 * Vitesta z własnym kontenerem Postgresa (global-setup per proces, odrębny
 * UMIEM_TEST_RUN_ID). Pliki w koszu nadal biegną sekwencyjnie na wspólnej bazie
 * kosza, więc gwarancje `fileParallelism: false` zostają bez zmian.
 *
 * Użycie: pnpm test:integration:shards [-- <argumenty Vitesta, np. -t wzorzec>]
 */
"use strict";

const { spawn, execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const exec = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");
const VITEST_CLI = path.join(repoRoot, "node_modules/vitest/vitest.mjs");
// Liczba koszy INTEGRATION_BUCKETS (tests/integration-buckets.ts);
// zgodności pilnuje test jednostkowy integration-buckets.test.ts.
const INTEGRATION_BUCKETS = 3;

const DETACHED = process.platform !== "win32";
const children = new Set();

function killTree(child, signal = "SIGTERM") {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    exec("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => undefined);
    return;
  }
  // POSIX: dzieci startują detached, więc sygnał idzie do całej grupy procesów.
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
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

function runBucket(bucket, runId, vitestArgs) {
  const label = `integration-${bucket}/${INTEGRATION_BUCKETS}`;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [VITEST_CLI, "run", "--config", "vitest.integration.config.ts", ...vitestArgs],
      {
        cwd: repoRoot,
        env: { ...process.env, UMIEM_INTEGRATION_BUCKET: String(bucket), UMIEM_TEST_RUN_ID: runId },
        stdio: ["ignore", "pipe", "pipe"],
        detached: DETACHED,
      },
    );
    children.add(child);
    prefixStream(child.stdout, `[${label}]`, process.stdout);
    prefixStream(child.stderr, `[${label}]`, process.stderr);
    const finish = (code, error) => {
      children.delete(child);
      resolve({ label, code, seconds: Math.round((Date.now() - startedAt) / 1000), error });
    };
    child.once("error", (error) => finish(1, String(error)));
    // `close`, nie `exit`: podsumowanie dopiero po spłukaniu wyjścia dziecka.
    child.once("close", (code) => finish(code ?? 1));
  });
}

async function main() {
  // Wiodące `--` (pnpm test:integration:shards -- -t wzorzec) nie jest argumentem Vitesta.
  const vitestArgs = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
  if (vitestArgs.includes("--help")) {
    console.log("pnpm test:integration:shards [-- <argumenty Vitesta, np. -t wzorzec>]");
    return;
  }
  const startedAt = Date.now();
  // Sufiks pid: dwa równoległe wywołania runnera nie dzielą nazw kontenerów.
  const runs = [];
  for (let bucket = 1; bucket <= INTEGRATION_BUCKETS; bucket += 1) {
    runs.push(runBucket(bucket, `shards-it-${bucket}-${process.pid}`, vitestArgs));
  }
  const results = await Promise.all(runs);

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n[integration-shards] Podsumowanie (${elapsed} s):`);
  let failed = false;
  for (const result of results) {
    const status = result.code === 0 ? "PASS" : `FAIL (kod ${result.code})`;
    console.log(`[integration-shards]   ${result.label}: ${status}, ${result.seconds} s${result.error ? ` — ${result.error}` : ""}`);
    if (result.code !== 0) failed = true;
  }
  if (failed && !process.exitCode) process.exitCode = 1;
}

let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) {
    for (const child of children) killTree(child, "SIGKILL");
    process.exit(130);
  }
  interrupted = true;
  process.exitCode = 130;
  // Pierwsze Ctrl+C: SIGINT do dzieci, żeby teardown Vitesta usunął kontenery;
  // SIGKILL po limicie, gdyby teardown się zawiesił (osierocone kontenery
  // sprząta global-setup następnego przebiegu, gdy ich właściciel nie żyje).
  for (const child of children) {
    killTree(child, "SIGINT");
    setTimeout(() => killTree(child, "SIGKILL"), 15_000).unref();
  }
});

main().catch((error) => {
  if (interrupted) return;
  console.error(`[integration-shards] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
