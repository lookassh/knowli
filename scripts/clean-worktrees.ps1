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

$argsList = @("scripts/clean-worktrees.cjs")
if ($Prune) { $argsList += "--prune" }
if ($Help) { $argsList += "--help" }

node @argsList
