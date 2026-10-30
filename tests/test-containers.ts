import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Kontenery Postgresa testów niosą etykiety właściciela: pid procesu runnera
// (Vitest / Playwright) i host. Na jednej maszynie równolegle biegnie kilka
// przebiegów (sesje agentów, worktree) na wspólnym demonie Dockera; sprzątanie
// usuwa wyłącznie kontenery, których właściciel już nie żyje.
export const OWNER_PID_LABEL = "knowli.test-owner-pid";
export const OWNER_HOST_LABEL = "knowli.test-owner-host";

// Żaden przebieg nie trwa dobę; starszy kontener z „żywym” pid to osierocony
// kontener, którego pid system przydzielił już innemu procesowi.
export const MAX_CONTAINER_AGE_MS = 24 * 60 * 60 * 1000;

export interface TestContainer {
  id: string;
  name: string;
  createdAt: number;
  labels: Record<string, string>;
}

export interface OwnerContext {
  host: string;
  now: number;
  isProcessAlive: (pid: number) => boolean;
}

export type ContainerOwnership = "live" | "stale" | "unknown";

// Kontenery integracji sprzed etykiet: `knowli-it-[<runId>-]<pid>`.
const LEGACY_INTEGRATION_NAME = /^knowli-it-(?:[a-z0-9-]+-)?(\d+)$/;

// Pid właściciela: z etykiety, a dla kontenerów sprzed etykiet — z sufiksu nazwy.
function ownerPid(container: TestContainer): number | null {
  const raw = container.labels[OWNER_PID_LABEL] ?? LEGACY_INTEGRATION_NAME.exec(container.name)?.[1];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function classifyContainer(container: TestContainer, context: OwnerContext): ContainerOwnership {
  // Cudze kontenery (np. stos Compose `knowli-db-1` na tym samym demonie)
  // nigdy nie są „stale”, choćby działały od tygodni.
  const isTestContainer = OWNER_PID_LABEL in container.labels || LEGACY_INTEGRATION_NAME.test(container.name);
  if (!isTestContainer) return "unknown";
  if (context.now - container.createdAt > MAX_CONTAINER_AGE_MS) return "stale";
  const owner = container.labels[OWNER_HOST_LABEL];
  // Pid z innego hosta (np. WSL obok Windows na wspólnym Docker Desktop) nic
  // nie mówi o procesach tutaj — taki kontener rozstrzyga tylko wiek.
  if (owner !== undefined && owner !== context.host) return "unknown";
  const pid = ownerPid(container);
  if (pid === null) return "unknown";
  return context.isProcessAlive(pid) ? "live" : "stale";
}

/**
 * Czy kontener o wspólnej nazwie (E2E) wolno usunąć przed własnym startem.
 * Blokuje żywy przebieg tutaj i oznaczony przebieg z innego hosta (jego pid
 * jest nieweryfikowalny); kontener bez etykiet (sprzed nich) nie blokuje,
 * bo nigdy nie stałby się „stale” i setup utknąłby do ręcznego usunięcia.
 */
export function isReservedByAnotherRun(container: TestContainer, context: OwnerContext): boolean {
  const ownership = classifyContainer(container, context);
  return ownership === "live" || (ownership === "unknown" && OWNER_HOST_LABEL in container.labels);
}

/** `docker run --name` przegrał wyścig o nazwę z równoległym przebiegiem. */
export function isNameConflictError(error: unknown): boolean {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  return typeof stderr === "string" && /container name .* is already in use/i.test(stderr);
}

export function selectStaleContainers(containers: readonly TestContainer[], context: OwnerContext): TestContainer[] {
  return containers.filter((container) => classifyContainer(container, context) === "stale");
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: proces istnieje, tylko nie wolno mu wysłać sygnału.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function currentOwnerContext(): OwnerContext {
  return { host: hostname(), now: Date.now(), isProcessAlive };
}

export function isOwnedByThisProcess(container: TestContainer): boolean {
  return container.labels[OWNER_PID_LABEL] === String(process.pid)
    && container.labels[OWNER_HOST_LABEL] === hostname();
}

export function ownerLabelArgs(): string[] {
  return ["--label", `${OWNER_PID_LABEL}=${process.pid}`, "--label", `${OWNER_HOST_LABEL}=${hostname()}`];
}

// Docker podaje Created z nanosekundami; Date.parse gwarantuje tylko milisekundy.
export function parseDockerTimestamp(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
}

interface DockerInspectEntry {
  Id: string;
  Name: string;
  Created: string;
  Config?: { Labels?: Record<string, string> | null };
}

export function parseInspectOutput(output: string): TestContainer[] {
  const entries = JSON.parse(output.trim() || "[]") as DockerInspectEntry[];
  return entries.map((entry) => ({
    id: entry.Id,
    name: entry.Name.replace(/^\//, ""),
    createdAt: parseDockerTimestamp(entry.Created),
    labels: entry.Config?.Labels ?? {},
  }));
}

async function inspect(ids: readonly string[]): Promise<TestContainer[]> {
  if (ids.length === 0) return [];
  try {
    const { stdout } = await exec("docker", ["inspect", ...ids]);
    return parseInspectOutput(stdout);
  } catch (error) {
    // Kontener zniknął między `ps` a `inspect` (np. --rm po teardownie
    // innego przebiegu): docker kończy się błędem, ale wypisuje resztę.
    const stdout = (error as { stdout?: string }).stdout;
    return stdout ? parseInspectOutput(stdout) : [];
  }
}

/** Kontenery, których nazwa zaczyna się od `prefix` (filtr Dockera dopasowuje fragment). */
export async function listContainersByPrefix(prefix: string): Promise<TestContainer[]> {
  const { stdout } = await exec("docker", ["ps", "-aq", "--filter", `name=${prefix}`]);
  const containers = await inspect(stdout.split(/\r?\n/).map((id) => id.trim()).filter(Boolean));
  return containers.filter((container) => container.name.startsWith(prefix));
}

export async function findContainer(name: string): Promise<TestContainer | null> {
  return (await inspect([name])).find((container) => container.name === name) ?? null;
}

export async function removeContainer(id: string): Promise<void> {
  await exec("docker", ["rm", "-f", id]).catch(() => undefined);
}
