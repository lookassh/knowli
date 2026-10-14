#!/usr/bin/env node
/**
 * Installs git hooks for Knowli / Umiem!
 *
 * Copies hooks from scripts/hooks/ to the shared git common directory (e.g. .git/hooks/).
 * Because worktrees share the common git directory, installing once applies to all worktrees!
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  const gitCommonDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf-8' }).trim();
  const hooksTargetDir = path.resolve(gitCommonDir, 'hooks');

  if (!fs.existsSync(hooksTargetDir)) {
    fs.mkdirSync(hooksTargetDir, { recursive: true });
  }

  const hooksSourceDir = path.join(__dirname, 'hooks');
  if (!fs.existsSync(hooksSourceDir)) {
    console.error(`[install-git-hooks] Hook source directory not found: ${hooksSourceDir}`);
    process.exit(1);
  }

  const hookFiles = fs.readdirSync(hooksSourceDir);
  for (const hookName of hookFiles) {
    const srcPath = path.join(hooksSourceDir, hookName);
    if (!fs.statSync(srcPath).isFile()) continue;

    const destPath = path.join(hooksTargetDir, hookName);

    fs.copyFileSync(srcPath, destPath);
    try {
      fs.chmodSync(destPath, 0o755);
    } catch (_) {
      // chmod might be a no-op on Windows, which is fine
    }
    console.log(`[install-git-hooks] ✓ Installed hook: ${hookName} -> ${destPath}`);
  }

  console.log('[install-git-hooks] All git hooks installed successfully.');
} catch (error) {
  console.error('[install-git-hooks] Failed to install git hooks:', error.message);
  process.exit(1);
}
