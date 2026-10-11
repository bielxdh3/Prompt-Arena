param(
  [Parameter(Mandatory = $true)]
  [string]$MsiPath
)

$ErrorActionPreference = 'Stop'

function Invoke-InstallerCom($target, [string]$method, [object[]]$arguments) {
  return $target.GetType().InvokeMember(
    $method,
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null,
    $target,
    $arguments
  )
}

function Read-MsiRows($database, [string]$query, [int]$fields) {
  $view = Invoke-InstallerCom $database 'OpenView' @($query)
  try {
    [void](Invoke-InstallerCom $view 'Execute' @())
    while ($true) {
      $record = Invoke-InstallerCom $view 'Fetch' @()
      if ($null -eq $record) { break }
      $row = @()
      for ($index = 1; $index -le $fields; $index++) {
        $row += [string]$record.StringData($index)
      }
      Write-Output -NoEnumerate $row
    }
  } finally {
    [void](Invoke-InstallerCom $view 'Close' @())
  }
}

# Windows Tauri's resource directory is the directory containing the main
# executable. A worker resolves either beside that executable, or as the exact
# configured externalBin resource at binaries/<name>-<target-triple>.exe.
# Resolve the actual MSI Directory table rather than accepting arbitrary
# sibling/subdirectory files that the installed app cannot execute.
function Get-MsiRelativeDirectory([string]$from, [string]$to, $directoryById) {
  $components = New-Object 'System.Collections.Generic.List[string]'
  $visited = New-Object 'System.Collections.Generic.HashSet[string]'
  $cursor = $to
  while ($cursor -ne $from) {
    if (-not $visited.Add($cursor) -or -not $directoryById.ContainsKey($cursor)) {
      throw 'MSI worker Directory table does not lead to the installed application directory'
    }
    $entry = $directoryById[$cursor]
    $segment = ([string]$entry[1] -split ':', 2)[0]
    $segment = ($segment -split '\|')[-1]
    if ($segment -ne '.') {
      if ($segment -notmatch '^[a-zA-Z0-9._-]+$' -or $segment -eq '..') {
        throw 'MSI worker has an unsafe or ambiguous installed directory segment'
      }
      $components.Insert(0, $segment)
    }
    $cursor = [string]$entry[0]
  }
  return ($components -join '/')
}

try {
  $source = Get-Item -LiteralPath $MsiPath -ErrorAction Stop
  if (-not $source.PSIsContainer -and $source.Extension -eq '.msi') {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = Invoke-InstallerCom $installer 'OpenDatabase' @($source.FullName, 0)
    $files = @(Read-MsiRows $database 'SELECT `File`, `FileName`, `Component_` FROM `File`' 3)
    $featureComponents = @(Read-MsiRows $database 'SELECT `Feature_`, `Component_` FROM `FeatureComponents`' 2)
    $components = @(Read-MsiRows $database 'SELECT `Component`, `Directory_` FROM `Component`' 2)
    $features = @(Read-MsiRows $database 'SELECT `Feature`, `Level`, `Attributes` FROM `Feature`' 3)

    $resourceWorker = 'prompt-arena-worker-x86_64-pc-windows-msvc.exe'
    $worker = @($files | Where-Object {
      $fileName = ($_[1] -split '\|')[-1]
      $fileName -ieq 'prompt-arena-worker.exe' -or $fileName -ieq $resourceWorker
    })
    $app = @($files | Where-Object { ($_[1] -split '\|')[-1] -ieq 'prompt-arena.exe' })
    if ($worker.Count -ne 1 -or $app.Count -ne 1) {
      throw "MSI must embed exactly one app EXE and one recognized worker executable (found app=$($app.Count), worker=$($worker.Count))"
    }
    $workerComponentId = [string]$worker[0][2]
    $appComponentId = [string]$app[0][2]
    $workerLinks = @($featureComponents | Where-Object { [string]$_[1] -ceq $workerComponentId })
    if ($workerLinks.Count -ne 1 -or [string]$workerLinks[0][0] -cne 'MainProgram') {
      throw 'MSI worker component must have exactly one direct FeatureComponents reference in mandatory MainProgram'
    }
    $mainFeature = @($features | Where-Object { [string]$_[0] -ceq 'MainProgram' })
    # msidbFeatureAttributesUIDisallowAbsent (0x10) ensures that custom UI
    # cannot deselect the main program while enabling optional features.
    if ($mainFeature.Count -ne 1 -or [int]$mainFeature[0][1] -ne 1 -or (([int]$mainFeature[0][2] -band 16) -eq 0)) {
      throw 'MSI MainProgram must be a level-1 feature with UIDisallowAbsent enabled'
    }
    $workerDir = @($components | Where-Object { [string]$_[0] -eq $workerComponentId })
    $appDir = @($components | Where-Object { [string]$_[0] -eq $appComponentId })
    if ($workerDir.Count -ne 1 -or $appDir.Count -ne 1) {
      throw 'MSI worker and app components must each have an installed directory'
    }
    $directories = @(Read-MsiRows $database 'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`' 3)
    $directoryById = @{}
    foreach ($entry in $directories) {
      $id = [string]$entry[0]
      if ($directoryById.ContainsKey($id)) { throw 'MSI directory identifiers are duplicated' }
      $directoryById[$id] = @([string]$entry[1], [string]$entry[2])
    }
    $relativeDir = Get-MsiRelativeDirectory ([string]$appDir[0][1]) ([string]$workerDir[0][1]) $directoryById
    $workerName = ($worker[0][1] -split '\|')[-1]
    $validBesideApp = ($relativeDir -eq '' -and $workerName -ieq 'prompt-arena-worker.exe')
    $validResource = ($relativeDir -ieq 'binaries' -and $workerName -ieq $resourceWorker)
    if (-not $validBesideApp -and -not $validResource) {
      throw 'MSI worker does not install at either Tauri-resolvable path (app dir or binaries/<target-triple> resource)'
    }
    Write-Output "MSI worker payload verified: one worker executable at resolvable layout '$relativeDir/$workerName', directly linked to mandatory MainProgram."
    exit 0
  }
  throw 'MSI worker validation requires an existing .msi file'
} catch {
  Write-Error "MSI worker payload validation failed: $($_.Exception.Message)"
  exit 1
}
