import { hostname } from "node:os";
import { describe, expect, it } from "vitest";
import {
  classifyContainer,
  isNameConflictError,
  isOwnedByThisProcess,
  isReservedByAnotherRun,
  MAX_CONTAINER_AGE_MS,
  OWNER_HOST_LABEL,
  OWNER_PID_LABEL,
  type OwnerContext,
  parseDockerTimestamp,
  parseInspectOutput,
  selectStaleContainers,
  type TestContainer,
} from "./test-containers";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const LIVE_PIDS = new Set([1111, 2222]);
const context: OwnerContext = { host: "box", now: NOW, isProcessAlive: (pid) => LIVE_PIDS.has(pid) };

function container(name: string, labels: Record<string, string> = {}, ageMs = 60_000): TestContainer {
  return { id: `id-${name}`, name, createdAt: NOW - ageMs, labels };
}

function owned(name: string, pid: number, host = "box"): TestContainer {
  return container(name, { [OWNER_PID_LABEL]: String(pid), [OWNER_HOST_LABEL]: host });
}

describe("selectStaleContainers", () => {
  it("keeps containers of live runs regardless of their run ID prefix", () => {
    // Regresja: przebieg z domyślnym prefiksem `knowli-it-` usuwał bazę
    // równoległego przebiegu `knowli-it-s106-<pid>`.
    const containers = [owned("knowli-it-1111", 1111), owned("knowli-it-s106-2222", 2222)];
    expect(selectStaleContainers(containers, context)).toEqual([]);
  });

  it("removes containers whose owner process is gone", () => {
    const orphan = owned("knowli-it-s106-3333", 3333);
    expect(selectStaleContainers([owned("knowli-it-1111", 1111), orphan], context)).toEqual([orphan]);
  });

  it("falls back to the pid in the name for containers without labels", () => {
    const legacyLive = container("knowli-it-run-a-2222");
    const legacyDead = container("knowli-it-4444");
    expect(selectStaleContainers([legacyLive, legacyDead], context)).toEqual([legacyDead]);
  });

  it("leaves containers with an unknown owner alone until they are too old", () => {
    const noPid = container("knowli-e2e");
    const otherHost = owned("knowli-it-3333", 3333, "wsl");
    expect(classifyContainer(noPid, context)).toBe("unknown");
    expect(classifyContainer(otherHost, context)).toBe("unknown");
    expect(selectStaleContainers([noPid, otherHost], context)).toEqual([]);
  });

  it("treats containers older than the age limit as stale even when the pid is reused", () => {
    const old = container("knowli-it-1111", { [OWNER_PID_LABEL]: "1111" }, MAX_CONTAINER_AGE_MS + 1);
    const otherHostOld = owned("knowli-it-wsl-9", 9, "wsl");
    otherHostOld.createdAt = NOW - MAX_CONTAINER_AGE_MS - 1;
    expect(selectStaleContainers([old, otherHostOld], context)).toEqual([old, otherHostOld]);
  });

  it("never marks containers that are not test containers as stale", () => {
    const composeDb = container("knowli-db-1", { "com.docker.compose.service": "db" }, 30 * MAX_CONTAINER_AGE_MS);
    const plainE2e = container("knowli-e2e", {}, 2 * MAX_CONTAINER_AGE_MS);
    expect(classifyContainer(composeDb, context)).toBe("unknown");
    expect(selectStaleContainers([composeDb, plainE2e], context)).toEqual([]);
  });

  it("prefers the owner label over the name suffix", () => {
    expect(classifyContainer(container("knowli-it-3333", { [OWNER_PID_LABEL]: "1111" }), context)).toBe("live");
    expect(classifyContainer(owned("knowli-e2e", 1111), context)).toBe("live");
    expect(classifyContainer(owned("knowli-e2e", 3333), context)).toBe("stale");
  });

  it("ignores malformed owner pids", () => {
    expect(classifyContainer(container("knowli-e2e", { [OWNER_PID_LABEL]: "abc" }), context)).toBe("unknown");
    expect(classifyContainer(container("knowli-e2e", { [OWNER_PID_LABEL]: "0" }), context)).toBe("unknown");
  });
});

describe("isReservedByAnotherRun", () => {
  it("blocks reuse of a container owned by a live run", () => {
    expect(isReservedByAnotherRun(owned("knowli-e2e", 1111), context)).toBe(true);
  });

  it("blocks reuse of a labelled container from another host whose pid cannot be checked", () => {
    // Np. WSL i Windows na jednym Docker Desktop: pid z WSL nic tu nie znaczy.
    expect(isReservedByAnotherRun(owned("knowli-e2e", 3333, "wsl"), context)).toBe(true);
  });

  it("allows removing orphans, legacy unlabelled containers and day-old foreign containers", () => {
    const oldForeign = owned("knowli-e2e", 3333, "wsl");
    oldForeign.createdAt = NOW - MAX_CONTAINER_AGE_MS - 1;
    expect(isReservedByAnotherRun(owned("knowli-e2e", 3333), context)).toBe(false);
    expect(isReservedByAnotherRun(container("knowli-e2e"), context)).toBe(false);
    expect(isReservedByAnotherRun(oldForeign, context)).toBe(false);
  });
});

describe("isNameConflictError", () => {
  it("recognises docker's name conflict only", () => {
    const conflict = Object.assign(new Error("Command failed"), {
      stderr: 'docker: Error response from daemon: Conflict. The container name "/knowli-e2e" is already in use by container "abc". You have to remove (or rename) that container to be able to reuse that name.',
    });
    expect(isNameConflictError(conflict)).toBe(true);
    expect(isNameConflictError(Object.assign(new Error("x"), { stderr: "port is already allocated" }))).toBe(false);
    expect(isNameConflictError(new Error("no stderr"))).toBe(false);
    expect(isNameConflictError(null)).toBe(false);
  });
});

describe("isOwnedByThisProcess", () => {
  it("matches only this process's pid and host labels", () => {
    const host = hostname();
    expect(isOwnedByThisProcess(container("knowli-e2e", { [OWNER_PID_LABEL]: String(process.pid), [OWNER_HOST_LABEL]: host }))).toBe(true);
    expect(isOwnedByThisProcess(container("knowli-e2e", { [OWNER_PID_LABEL]: String(process.pid), [OWNER_HOST_LABEL]: `${host}-x` }))).toBe(false);
    expect(isOwnedByThisProcess(container("knowli-e2e", { [OWNER_PID_LABEL]: String(process.pid + 1), [OWNER_HOST_LABEL]: host }))).toBe(false);
    expect(isOwnedByThisProcess(container("knowli-e2e"))).toBe(false);
  });
});

describe("docker inspect parsing", () => {
  it("parses nanosecond timestamps", () => {
    expect(parseDockerTimestamp("2026-10-30T11:59:00.123456789Z")).toBe(Date.parse("2026-10-30T11:59:00.123Z"));
    expect(parseDockerTimestamp("2026-10-30T11:59:00Z")).toBe(Date.parse("2026-10-30T11:59:00Z"));
  });

  it("maps inspect entries and tolerates missing labels", () => {
    const output = JSON.stringify([
      { Id: "abc", Name: "/knowli-it-1111", Created: "2026-10-30T11:59:00.5Z", Config: { Labels: { [OWNER_PID_LABEL]: "1111" } } },
      { Id: "def", Name: "/knowli-e2e", Created: "2026-10-30T11:59:00Z", Config: { Labels: null } },
    ]);
    expect(parseInspectOutput(output)).toEqual([
      { id: "abc", name: "knowli-it-1111", createdAt: Date.parse("2026-10-30T11:59:00.5Z"), labels: { [OWNER_PID_LABEL]: "1111" } },
      { id: "def", name: "knowli-e2e", createdAt: Date.parse("2026-10-30T11:59:00Z"), labels: {} },
    ]);
    expect(parseInspectOutput("")).toEqual([]);
  });
});
