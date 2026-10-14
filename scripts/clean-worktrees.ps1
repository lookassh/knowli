<#
.SYNOPSIS
    Inspect and clean up git worktrees in Knowli / Umiem!
.DESCRIPTION
    Wraps scripts/clean-worktrees.cjs to list worktrees and prune stale entries.
#>
param (
    [switch]$Prune,
    [switch]$Help
)

$scriptPath = Join-Path $PSScriptRoot "clean-worktrees.cjs"
$argsList = @($scriptPath)
if ($Prune) { $argsList += "--prune" }
if ($Help) { $argsList += "--help" }

node @argsList
