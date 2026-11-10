#!/usr/bin/env node
/**
 * Fast setup script for git worktrees in Knowli / Umiem!
 *
 * Responsibilities:
 * 1. Ensure .env exists: from ~/.config/umiem/.env (shared by all clones), else the main
 *    repo's .env, else .env.example. Symlink when the OS allows it, otherwise a copy;
 *    --refresh-env replaces an existing .env (e.g. after rotating keys).
 * 2. Ensure node_modules exists (runs fast corepack pnpm install --prefer-offline if missing).
 * 3. Safe to call multiple times (idempotent).
 * Runs automatically for every new worktree via scripts/hooks/post-checkout (`pnpm hooks:install`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function runCommand(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: options.stdio || 'pipe', ...options });
  } catch (error) {
    if (options.ignoreError) return null;
    throw error;
  }
}

function getGitPaths() {
  try {
    const gitDir = runCommand('git rev-parse --git-dir').trim();
    const gitCommonDir = runCommand('git rev-parse --git-common-dir').trim();
    const currentRoot = runCommand('git rev-parse --show-toplevel').trim();
    
    // Resolve absolute path to main repo root
    const absoluteCommonDir = path.resolve(gitCommonDir);
    const mainRepoRoot = path.resolve(absoluteCommonDir, '..');

    return {
      gitDir: path.resolve(gitDir),
      gitCommonDir: absoluteCommonDir,
      currentRoot: path.resolve(currentRoot),
      mainRepoRoot,
      isWorktree: path.resolve(gitDir) !== absoluteCommonDir,
    };
  } catch (err) {
    // If not in a git repo
    return null;
  }
}

function setupWorktree(options = {}) {
  const gitPaths = getGitPaths();
  if (!gitPaths) {
    console.warn('[setup-worktree] Warning: Not inside a git repository. Skipping git-based discovery.');
    return;
  }

  const rootDir = gitPaths.currentRoot || process.cwd();
  try {
    process.chdir(rootDir);
  } catch (_) {
    // Ignore chdir failure if any
  }

  console.log(`[setup-worktree] Initializing workspace in: ${rootDir}`);

  // 1. .env: wzorzec poza repo (wspólny dla wszystkich klonów), inaczej z głównego repo, inaczej przykład.
  const localEnvPath = path.join(rootDir, '.env');
  const refreshEnv = process.argv.includes('--refresh-env');
  if (fs.existsSync(localEnvPath) && !refreshEnv) {
    console.log('[setup-worktree] ✓ Local .env already exists (use --refresh-env to replace it from the source).');
  } else {
    const candidates = [
      path.join(os.homedir(), '.config', 'umiem', '.env'),
      path.join(gitPaths.mainRepoRoot, '.env'),
      path.join(rootDir, '.env.example'),
    ];
    const source = candidates.find((candidate) => fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(localEnvPath));
    if (!source) {
      console.log(`[setup-worktree] ! No .env source found (${candidates.join(', ')}).`);
    } else {
      fs.rmSync(localEnvPath, { force: true });
      try {
        // Dowiązanie trzyma jeden plik; Windows pozwala na nie tylko w trybie dewelopera.
        fs.symlinkSync(source, localEnvPath, 'file');
        console.log(`[setup-worktree] ✓ Linked .env -> ${source}`);
      } catch {
        fs.copyFileSync(source, localEnvPath);
        console.log(`[setup-worktree] ✓ Copied .env from ${source}`);
      }
    }
  }

  // 2. Check node_modules
  const localNodeModules = path.join(rootDir, 'node_modules');
  const forceInstall = process.argv.includes('--force-install');
  const skipInstall = process.argv.includes('--skip-install');

  if (skipInstall) {
    console.log('[setup-worktree] Skipping dependency check (--skip-install).');
    return;
  }

  if (fs.existsSync(localNodeModules) && !forceInstall) {
    console.log('[setup-worktree] ✓ node_modules already exists. Skipping install (use --force-install to override).');
  } else {
    console.log('[setup-worktree] Installing dependencies via corepack pnpm install --prefer-offline --frozen-lockfile...');
    try {
      // Try corepack pnpm first
      runCommand('corepack pnpm install --prefer-offline --frozen-lockfile', { stdio: 'inherit' });
      console.log('[setup-worktree] ✓ Dependencies installed successfully.');
    } catch (corepackErr) {
      console.warn('[setup-worktree] corepack pnpm failed, trying global pnpm...');
      try {
        runCommand('pnpm install --prefer-offline --frozen-lockfile', { stdio: 'inherit' });
        console.log('[setup-worktree] ✓ Dependencies installed successfully via pnpm.');
      } catch (pnpmErr) {
        console.error('[setup-worktree] ✗ Failed to install dependencies via corepack pnpm and pnpm.');
        process.exitCode = 1;
      }
    }
  }
}

setupWorktree();
