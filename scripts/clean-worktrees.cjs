#!/usr/bin/env node
/**
 * Utility to inspect and clean up stale git worktrees in Knowli / Umiem!
 *
 * Usage:
 *   node scripts/clean-worktrees.cjs             # List all worktrees and status
 *   node scripts/clean-worktrees.cjs --prune     # Run git worktree prune
 *   node scripts/clean-worktrees.cjs --help      # Show help
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch (e) {
    return null;
  }
}

function parseWorktrees() {
  const output = run('git worktree list --porcelain');
  if (!output) return [];

  const lines = output.split('\n');
  const worktrees = [];
  let current = {};

  for (const line of lines) {
    if (!line.trim()) {
      if (current.path) worktrees.push(current);
      current = {};
      continue;
    }

    if (line.startsWith('worktree ')) {
      current.path = line.substring(9).trim();
    } else if (line.startsWith('HEAD ')) {
      current.head = line.substring(5).trim();
    } else if (line.startsWith('branch ')) {
      current.branch = line.substring(7).trim().replace('refs/heads/', '');
    } else if (line.startsWith('bare')) {
      current.bare = true;
    } else if (line.startsWith('detached')) {
      current.detached = true;
    } else if (line.startsWith('locked')) {
      current.locked = line.substring(7).trim() || true;
    } else if (line.startsWith('prunable')) {
      current.prunable = line.substring(9).trim() || true;
    }
  }

  if (current.path) worktrees.push(current);
  return worktrees;
}

function main() {
  const args = process.argv.slice(2);
  const isPrune = args.includes('--prune');
  const isHelp = args.includes('--help') || args.includes('-h');

  if (isHelp) {
    console.log(`
Knowli / Umiem! Worktree Cleanup Tool

Usage:
  node scripts/clean-worktrees.cjs          List all registered worktrees
  node scripts/clean-worktrees.cjs --prune  Prune missing or stale worktree registrations
`);
    return;
  }

  console.log('[clean-worktrees] Inspecting git worktrees...\n');
  const worktrees = parseWorktrees();
  const currentDir = path.resolve(process.cwd());

  console.log(`Total registered worktrees: ${worktrees.length}`);
  let missingCount = 0;

  worktrees.forEach((wt, idx) => {
    const isCurrent = path.resolve(wt.path).toLowerCase() === currentDir.toLowerCase();
    const exists = fs.existsSync(wt.path);
    if (!exists) missingCount++;

    let statusBadge = isCurrent
      ? '[CURRENT]'
      : exists
      ? '[ACTIVE]'
      : '[MISSING DIRECTORY]';

    if (wt.locked) {
      statusBadge += ' [LOCKED]';
    }

    const branchName = wt.branch ? `branch: ${wt.branch}` : (wt.detached ? 'detached HEAD' : 'unknown');
    console.log(`${idx + 1}. ${statusBadge} ${wt.path} (${branchName})`);
  });

  if (isPrune) {
    console.log('\n[clean-worktrees] Running git worktree prune...');
    const result = run('git worktree prune -v');
    console.log(result || 'Prune completed.');
  } else if (missingCount > 0) {
    console.log(`\nFound ${missingCount} missing worktree directory/directories. Run with --prune to clean up stale registrations.`);
  } else {
    console.log('\nAll registered worktrees are active. Nothing to prune.');
  }
}

main();
