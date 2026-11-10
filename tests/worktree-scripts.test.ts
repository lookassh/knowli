import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Hook post-checkout + setup-worktree + clean-worktrees na tymczasowym repo (prawdziwy git, bez sieci).
const root = mkdtempSync(join(tmpdir(), "knowli-wt-"));
const repo = join(root, "repo");
const wts = join(root, "wts");
const home = join(root, "home");
const env = { ...process.env, HOME: home, USERPROFILE: home };
const run = (cmd: string, args: string[], cwd = repo) => execFileSync(cmd, args, { cwd, env, encoding: "utf-8" });

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("worktree scripts", () => {
  it("configures new worktrees and removes only clean merged ones", { timeout: 60_000 }, () => {
    mkdirSync(join(home, ".config", "umiem"), { recursive: true });
    writeFileSync(join(home, ".config", "umiem", ".env"), "KEY=master\n");
    mkdirSync(join(repo, "node_modules"), { recursive: true });
    writeFileSync(join(repo, "node_modules", ".keep"), ""); // istniejące node_modules: bez instalacji
    writeFileSync(join(repo, ".gitignore"), ".env\n");
    for (const file of ["setup-worktree.cjs", "clean-worktrees.cjs", "install-git-hooks.cjs", "hooks/post-checkout"]) {
      cpSync(resolve("scripts", file), join(repo, "scripts", file));
    }
    run("git", ["init", "-q", "-b", "main"]);
    run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
    run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
    run("node", ["scripts/install-git-hooks.cjs"]);

    for (const name of ["merged", "dirty", "unmerged"]) run("git", ["worktree", "add", "-q", join(wts, name), "-b", name]);
    expect(readFileSync(join(wts, "merged", ".env"), "utf-8")).toBe("KEY=master\n");

    writeFileSync(join(wts, "dirty", "note.md"), "praca\n");
    writeFileSync(join(wts, "unmerged", "feature.txt"), "x\n");
    run("git", ["add", "feature.txt"], join(wts, "unmerged"));
    run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "feature"], join(wts, "unmerged"));
    mkdirSync(join(wts, "orphan"));

    const report = run("node", ["scripts/clean-worktrees.cjs", "--remove"]);

    expect(existsSync(join(wts, "merged"))).toBe(false);
    expect(run("git", ["branch", "--list", "merged"]).trim()).toBe("");
    expect(existsSync(join(wts, "dirty", "note.md"))).toBe(true);
    expect(existsSync(join(wts, "unmerged"))).toBe(true);
    expect(existsSync(join(wts, "orphan"))).toBe(false);
    expect(report).toContain("niezapisane zmiany: 1");
  });
});
