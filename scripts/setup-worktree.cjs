#!/usr/bin/env node
/**
 * Fast setup script for git worktrees in Knowli / Umiem!
 *
 * Responsibilities:
 * 1. Ensure .env exists (copies from main repo root if missing).
 * 2. Ensure node_modules exists (runs fast corepack pnpm install --prefer-offline if missing).
 * 3. Safe to call multiple times (idempotent).
 */

const fs = require('fs');
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

function linkSharedDirectory(sourcePath, linkPath, label) {
  if (!fs.existsSync(sourcePath)) {
    console.log(`[setup-worktree] Skipping ${label}: shared directory is not installed (${sourcePath}).`);
    return;
  }

  try {
    const linkStat = fs.lstatSync(linkPath);
    if (linkStat.isSymbolicLink()) {
      console.log(`[setup-worktree] ✓ ${label} link already exists.`);
    } else {
      console.log(`[setup-worktree] Keeping worktree-local ${label} (${linkPath}).`);
    }
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[setup-worktree] Could not inspect ${label}: ${error.message}`);
      return;
    }
  }

  try {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    // Windows junctions do not require Developer Mode or elevated privileges.
    fs.symlinkSync(sourcePath, linkPath, 'junction');
    console.log(`[setup-worktree] ✓ Linked ${label} to the main checkout.`);
  } catch (error) {
    console.warn(`[setup-worktree] Could not link ${label}: ${error.message}`);
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

  // BMAD skills are installed once in the main checkout. Expose them to each
  // worktree while keeping docs/bmad local for safe plan-to-implementation handoff.
  if (gitPaths.isWorktree) {
    for (const [relativePath, label] of [
      ['_bmad', 'BMAD runtime'],
      [path.join('.agents', 'skills'), 'Codex BMAD skills'],
      [path.join('.zcode', 'skills'), 'ZCode BMAD skills'],
      [path.join('.agent', 'skills'), 'Antigravity BMAD skills'],
    ]) {
      linkSharedDirectory(
        path.join(gitPaths.mainRepoRoot, relativePath),
        path.join(rootDir, relativePath),
        label,
      );
    }
  }

  // 1. Copy .env if missing
  const localEnvPath = path.join(rootDir, '.env');
  if (!fs.existsSync(localEnvPath)) {
    const mainEnvPath = path.join(gitPaths.mainRepoRoot, '.env');
    const exampleEnvPath = path.join(rootDir, '.env.example');

    if (fs.existsSync(mainEnvPath)) {
      fs.copyFileSync(mainEnvPath, localEnvPath);
      console.log(`[setup-worktree] ✓ Copied .env from main repo (${mainEnvPath})`);
    } else if (fs.existsSync(exampleEnvPath)) {
      fs.copyFileSync(exampleEnvPath, localEnvPath);
      console.log(`[setup-worktree] ! Main .env not found. Created .env from .env.example`);
    } else {
      console.log('[setup-worktree] ! No .env found in main repo or .env.example.');
    }
  } else {
    console.log('[setup-worktree] ✓ Local .env already exists.');
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
