import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIntegrationTokenCommand } from "./integration-tokens";

const tempDirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "umiem-integration-token-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("integration token CLI", () => {
  it("does not overwrite an existing secret file or print a generated token", async () => {
    const dir = await tempDir();
    const out = join(dir, "token.txt");
    await writeFile(out, "existing-owner-data", "utf8");
    const issue = vi.fn(async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    const stdout: string[] = [];
    const stderr: string[] = [];

    await expect(runIntegrationTokenCommand(["create", "--name", "Hermes", "--out", out], {
      issue,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })).rejects.toThrow();
    expect(await readFile(out, "utf8")).toBe("existing-owner-data");
    expect(issue).not.toHaveBeenCalled();
    expect(stdout.join("\n") + stderr.join("\n")).not.toContain("umiem_");
  });

  it("writes a private secret file before issuing and removes only its own file on database failure", async () => {
    const dir = await tempDir();
    const out = join(dir, "token.txt");
    const issue = vi.fn(async (_name: string, secret: string) => {
      expect(await readFile(out, "utf8")).toBe(secret);
      throw new Error("database unavailable");
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    await expect(runIntegrationTokenCommand(["create", "--name", "Hermes", "--out", out], {
      issue,
      randomToken: () => "umiem_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_test-secret-value",
      secureFile: async () => undefined,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })).rejects.toThrow("database unavailable");
    expect(issue).toHaveBeenCalledTimes(1);
    await expect(stat(out)).rejects.toMatchObject({ code: "ENOENT" });
    expect(stdout.join("\n") + stderr.join("\n")).not.toContain("test-secret-value");
  });

  it("creates a restricted file and reports only the public id after success", async () => {
    const dir = await tempDir();
    const out = join(dir, "token.txt");
    const secret = "umiem_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_test-secret-value";
    const stdout: string[] = [];

    await runIntegrationTokenCommand(["create", "--name", "Hermes", "--out", out], {
      issue: async (name, issuedSecret) => {
        expect(name).toBe("Hermes");
        expect(issuedSecret).toBe(secret);
        return { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      },
      randomToken: () => secret,
      secureFile: async () => undefined,
      stdout: (message) => stdout.push(message),
      stderr: () => undefined,
    });
    expect(await readFile(out, "utf8")).toBe(secret);
    if (process.platform !== "win32") expect((await stat(out)).mode & 0o777).toBe(0o600);
    expect(stdout.join("\n")).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(stdout.join("\n")).not.toContain(secret);
  });
});
