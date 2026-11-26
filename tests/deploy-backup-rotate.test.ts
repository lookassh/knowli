import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Rotacja kopii z deploy/backup.sh: zostaje N najnowszych kompletnych (katalog z SHA256SUMS).
const script = resolve("deploy", "backup-rotate.sh");
// Na Windows `bash` z PATH bywa WSL-em (inne ścieżki); bierzemy bash z Git for Windows.
const bash =
  process.platform === "win32"
    ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf-8" }).trim(), "../../../bin/bash.exe")
    : "bash";
let dir = "";

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup(entries: Record<string, "complete" | "partial" | "file">): string {
  dir = mkdtempSync(join(tmpdir(), "knowli-rotate-"));
  for (const [name, kind] of Object.entries(entries)) {
    if (kind === "file") {
      writeFileSync(join(dir, name), "x\n");
      continue;
    }
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "db.dump"), "dump\n");
    if (kind === "complete") writeFileSync(join(dir, name, "SHA256SUMS"), "sums\n");
  }
  return dir;
}

const rotate = (...args: string[]) => spawnSync(bash, [script, ...args], { encoding: "utf-8" });
const left = () => readdirSync(dir).sort();
const complete = (n: number) => `knowli-2026110${n}-231500`;

describe("deploy/backup-rotate.sh", () => {
  it("keeps the newest N complete backups", () => {
    setup(Object.fromEntries([1, 2, 3, 4, 5].map((n) => [complete(n), "complete"])));
    expect(rotate(dir, "3").status).toBe(0);
    expect(left()).toEqual([complete(3), complete(4), complete(5)]);
  });

  it("removes nothing when there are fewer than N complete backups", () => {
    setup({ [complete(1)]: "complete", [complete(2)]: "complete" });
    expect(rotate(dir, "3").status).toBe(0);
    expect(left()).toEqual([complete(1), complete(2)]);
  });

  it("does not count a newer incomplete backup and does not remove it", () => {
    setup({ [complete(1)]: "complete", [complete(2)]: "complete", [complete(3)]: "complete", [complete(4)]: "partial" });
    expect(rotate(dir, "2").status).toBe(0);
    expect(left()).toEqual([complete(2), complete(3), complete(4)]);
  });

  it("removes an incomplete backup older than the N-th complete one", () => {
    setup({ [complete(1)]: "partial", [complete(2)]: "complete", [complete(3)]: "complete" });
    expect(rotate(dir, "2").status).toBe(0);
    expect(left()).toEqual([complete(2), complete(3)]);
  });

  it("leaves foreign files and directories untouched", () => {
    // nazwy-podróbki pasują do globu knowli-[0-9]*-[0-9]*, ale nie do formatu kopii
    const lookalikes = ["knowli-2026-old", "knowli-20261101-2315", "knowli-20261101-231500.bak"];
    setup({
      [complete(1)]: "complete",
      [complete(2)]: "complete",
      "backup.log": "file",
      other: "partial",
      "knowli-restore": "partial",
      ...Object.fromEntries(lookalikes.map((name) => [name, "partial" as const])),
    });
    expect(rotate(dir, "1").status).toBe(0);
    expect(left()).toEqual(["backup.log", ...lookalikes, complete(2), "knowli-restore", "other"].sort());
  });

  it("exits cleanly on an empty backup directory", () => {
    setup({});
    const result = rotate(dir, "3");
    expect(result.status).toBe(0);
    expect(left()).toEqual([]);
  });

  it.each([["0"], ["-1"], ["abc"], ["3x"], [""]])("rejects keep=%j without removing anything", (keep) => {
    setup({ [complete(1)]: "complete", [complete(2)]: "complete" });
    const result = rotate(dir, keep);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toBe("");
    expect(left()).toEqual([complete(1), complete(2)]);
  });

  it("rejects a missing keep argument and a missing directory", () => {
    setup({ [complete(1)]: "complete", [complete(2)]: "complete" });
    const noKeep = rotate(dir);
    expect(noKeep.status).not.toBe(0);
    expect(noKeep.stderr).not.toBe("");
    const noDir = rotate(join(dir, "missing"), "1");
    expect(noDir.status).not.toBe(0);
    expect(noDir.stderr).not.toBe("");
    expect(left()).toEqual([complete(1), complete(2)]);
  });
});
