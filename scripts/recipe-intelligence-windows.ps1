param([ValidateSet('start','stop','setup')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
try {
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $nodeVersion = & $nodeCommand.Source --version
    if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Install Node.js 24 LTS or newer, then open this launcher again.' }
    $scriptName = if ($Action -eq 'stop') { 'recipe-intelligence-stop.cjs' } else { 'recipe-intelligence-launcher.cjs' }
    $scriptPath = Join-Path $PSScriptRoot $scriptName
    $arguments = '"' + $scriptPath + '"'
    if ($Action -eq 'setup') { $arguments += ' --choose-folder' }
    Start-Process -FilePath $nodeCommand.Source -ArgumentList $arguments -WorkingDirectory (Split-Path $PSScriptRoot -Parent) -WindowStyle Hidden
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message + "`nInstall Node.js from https://nodejs.org/ if needed.", 'Recipe Intelligence', 'OK', 'Error')
    exit 1
}
