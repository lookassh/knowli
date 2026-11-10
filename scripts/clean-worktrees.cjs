#!/usr/bin/env node
/**
 * Raport i sprzątanie git worktree (Claude, Codex, Muse — każde narzędzie używa `git worktree add`).
 *
 *   node scripts/clean-worktrees.cjs            # raport: stan każdego worktree i porzucone katalogi
 *   node scripts/clean-worktrees.cjs --remove   # usuwa tylko czyste i scalone worktree (+ ich gałęzie) i puste porzucone katalogi
 *   node scripts/clean-worktrees.cjs --prune    # tylko `git worktree prune`
 *
 * „Scalony”: HEAD jest w origin/main (albo main bez remote) lub w głowie scalonego PR (przez `gh`,
 * bo PR-y są scalane squashem). Nigdy nie rusza głównego checkoutu, bieżącego katalogu,
 * zablokowanych worktree, worktree z niezapisanymi zmianami ani z niescalonymi commitami.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const isAncestor = (commit, of) => spawnSync('git', ['merge-base', '--is-ancestor', commit, of], { stdio: 'ignore' }).status === 0;
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function parseWorktrees() {
  const worktrees = [];
  let current = null;
  for (const line of (git(['worktree', 'list', '--porcelain']) || '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) worktrees.push((current = { path: line.slice(9).trim() }));
    else if (!current) continue;
    else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim();
    else if (line.startsWith('branch ')) current.branch = line.slice(7).trim().replace('refs/heads/', '');
    else if (line.startsWith('detached')) current.detached = true;
    else if (line.startsWith('locked')) current.locked = true;
  }
  return worktrees;
}

/** Commity osiągalne z głów scalonych PR (obecnych lokalnie); null, gdy brak remote albo `gh`. */
function mergedPrCommits() {
  if (!git(['remote', 'get-url', 'origin'])) return null;
  for (const gh of ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']) {
    const result = spawnSync(gh, ['pr', 'list', '--state', 'merged', '--limit', '1000', '--json', 'headRefOid', '--jq', '.[].headRefOid'], { encoding: 'utf-8' });
    if (result.status !== 0) continue;
    const check = spawnSync('git', ['cat-file', '--batch-check'], { input: result.stdout, encoding: 'utf-8' });
    const heads = check.stdout.split(/\r?\n/).filter((l) => l && !l.endsWith('missing')).map((l) => l.split(' ')[0]);
    const reachable = spawnSync('git', ['rev-list', '--stdin'], { input: heads.join('\n') + '\n', encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    return new Set(reachable.stdout.split(/\r?\n/).filter(Boolean));
  }
  return null;
}

function classify(wt, ctx) {
  if (wt.locked) return { removable: false, label: 'zablokowany' };
  if (!fs.existsSync(wt.path)) return { removable: false, label: 'brak katalogu (wyczyść --prune)' };
  const dirty = git(['status', '--porcelain'], wt.path);
  if (dirty === null) return { removable: false, label: 'nie da się odczytać stanu' };
  if (dirty) return { removable: false, label: `niezapisane zmiany: ${dirty.split(/\r?\n/).length}` };
  if (isAncestor(wt.head, ctx.mainRef)) return { removable: true, label: `czysty, scalony (w ${ctx.mainRef})` };
  if (ctx.prCommits === null) return { removable: false, label: 'nie ustalono scalenia (brak gh/remote)' };
  if (ctx.prCommits.has(wt.head)) return { removable: true, label: 'czysty, scalony (w scalonym PR)' };
  return { removable: false, label: 'niescalone commity' };
}

/** Usuwa katalog bez wchodzenia w dowiązania (pnpm na Windows używa junction). */
function removeDir(dir) {
  if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', `\\\\?\\${path.resolve(dir)}`], { stdio: 'ignore' });
  else fs.rmSync(dir, { recursive: true, force: true });
  return !fs.existsSync(dir);
}

/** Niezarejestrowane katalogi obok worktree; pomija katalog nadrzędny głównego repo (np. E:/dev z innymi projektami). */
function orphanDirs(worktrees, mainPath) {
  const registered = worktrees.map((wt) => wt.path);
  const parents = [...new Set(registered.filter((p) => !samePath(p, mainPath)).map((p) => path.dirname(p)))].filter(
    (parent) => !samePath(parent, path.dirname(mainPath)),
  );
  return parents.flatMap((parent) => {
    if (!fs.existsSync(parent)) return [];
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !registered.some((p) => samePath(p, path.join(parent, e.name))))
      .map((e) => path.join(parent, e.name));
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Użycie: node scripts/clean-worktrees.cjs [--remove | --prune]');
    return;
  }
  if (args.includes('--prune')) {
    console.log(git(['worktree', 'prune', '-v']) || 'Prune completed.');
    return;
  }

  const remove = args.includes('--remove');
  const worktrees = parseWorktrees();
  const mainPath = path.dirname(path.resolve(git(['rev-parse', '--path-format=absolute', '--git-common-dir']) || '.git'));
  const currentTop = git(['rev-parse', '--show-toplevel']) || process.cwd();
  const ctx = { mainRef: git(['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main' : 'main', prCommits: mergedPrCommits() };
  const removed = [];

  for (const wt of worktrees) {
    if (samePath(wt.path, mainPath) || samePath(wt.path, currentTop)) {
      console.log(`- ${wt.path} [${wt.branch || 'detached'}] — główny/bieżący, pomijam`);
      continue;
    }
    const { removable, label } = classify(wt, ctx);
    console.log(`- ${wt.path} [${wt.branch || 'detached'}] — ${label}`);
    if (!remove || !removable) continue;

    git(['worktree', 'remove', wt.path]);
    if (parseWorktrees().some((other) => samePath(other.path, wt.path))) {
      console.log('    ✗ git nie wyrejestrował worktree — zostawiam katalog');
      continue;
    }
    if (fs.existsSync(wt.path) && !removeDir(wt.path)) console.log('    ! katalog częściowo został — usuń ręcznie');
    if (wt.branch) git(['branch', '-D', wt.branch]);
    removed.push(wt.path);
    console.log(`    ✓ usunięto${wt.branch ? ` (z gałęzią ${wt.branch})` : ''}`);
  }

  for (const dir of orphanDirs(parseWorktrees(), mainPath)) {
    const empty = fs.readdirSync(dir).length === 0;
    if (remove && empty) {
      fs.rmdirSync(dir);
      console.log(`- porzucony katalog ${dir} — pusty, usunięto`);
    } else {
      console.log(`- porzucony katalog ${dir} — ${empty ? 'pusty' : 'niepusty, sprawdź ręcznie'}`);
    }
  }

  if (remove) {
    git(['worktree', 'prune']);
    console.log(`\nUsunięte worktree: ${removed.length}.`);
  } else {
    console.log('\nRaport bez zmian. `--remove` usuwa tylko worktree oznaczone jako „czysty, scalony” i puste porzucone katalogi.');
  }
}

main();
