<#
.SYNOPSIS
    Fast setup for git worktrees in Knowli / Umiem!
.DESCRIPTION
    Wraps scripts/setup-worktree.cjs to ensure .env exists and dependencies are ready.
#>
param (
    [switch]$ForceInstall,
    [switch]$SkipInstall
)

$argsList = @("scripts/setup-worktree.cjs")
if ($ForceInstall) { $argsList += "--force-install" }
if ($SkipInstall) { $argsList += "--skip-install" }

node @argsList
