param([switch]$SkipTests, [switch]$Package)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$originalPath = $env:PATH
function Run-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
foreach ($program in @('node', 'npm.cmd', 'cargo', 'git.exe')) {
    if (-not (Get-Command $program -ErrorAction SilentlyContinue)) { throw "Missing build tool: $program" }
}
$compiler = $null
if ($Package) {
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    $compiler = if ($command) { $command.Source } else {
        @("${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:ProgramFiles\NSIS\makensis.exe") |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if (-not $compiler) { throw 'NSIS is required for -Package; install NSIS or build without -Package' }
}
Push-Location $repoRoot
try {
    if (-not $SkipTests) {
        # 部分跨平台打包夹具使用 Git Bash；兼容 Git 安装在非 C 盘的本机环境。
        $gitRoot = Split-Path -Parent (Split-Path -Parent (Get-Command git.exe).Source)
        $gitBash = Join-Path $gitRoot 'bin\bash.exe'
        if (Test-Path -LiteralPath $gitBash) { $env:PATH = "$(Split-Path -Parent $gitBash);$env:PATH" }
    }
    Run-Checked 'npm.cmd' @('ci', '--prefix', 'apps/codex-plus-manager', '--no-audit', '--no-fund')
    Run-Checked 'node' @('scripts/assemble-renderer-inject.mjs', '--check')
    Run-Checked 'npm.cmd' @('--prefix', 'apps/codex-plus-manager', 'run', 'check')
    # Tauri 的 generate_context! 在 cargo test 编译阶段也需要 frontendDist。
    Run-Checked 'npm.cmd' @('--prefix', 'apps/codex-plus-manager', 'run', 'vite:build')
    if (-not $SkipTests) {
        # 部分集成测试会调用默认状态路径；不能继承开发者的供应商、皮肤和会话目录。
        $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-plus-build-tests-' + [guid]::NewGuid())
        $previousCodexHome = $env:CODEX_HOME
        $previousStateDir = $env:CODEX_PLUS_STATE_DIR
        try {
            $env:CODEX_HOME = Join-Path $testRoot '.codex'
            $env:CODEX_PLUS_STATE_DIR = Join-Path $testRoot '.codex-session-delete'
            New-Item -ItemType Directory -Force -Path $env:CODEX_HOME, $env:CODEX_PLUS_STATE_DIR | Out-Null
            Run-Checked 'node' @('--test', 'scripts/custom-release.test.mjs')
            Run-Checked 'npm.cmd' @('--prefix', 'apps/codex-plus-manager', 'test')
            Run-Checked 'cargo' @('test', '--locked', '--workspace', '--no-fail-fast')
        } finally {
            $env:CODEX_HOME = $previousCodexHome
            $env:CODEX_PLUS_STATE_DIR = $previousStateDir
        }
    }
    Run-Checked 'cargo' @('build', '--locked', '--release', '-p', 'codex-plus-manager', '--bin', 'codex-plus-plus')
    $targetRoot = if ($env:CARGO_TARGET_DIR) { [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $repoRoot 'target' }
    $output = Join-Path $repoRoot 'dist\windows'
    New-Item -ItemType Directory -Force -Path (Join-Path $output 'app') | Out-Null
    Copy-Item -LiteralPath (Join-Path $targetRoot 'release\codex-plus-plus.exe') -Destination (Join-Path $output 'app\codex-plus-plus.exe') -Force
    if ($Package) {
        $version = (Get-Content -LiteralPath 'apps/codex-plus-manager/package.json' -Raw | ConvertFrom-Json).version
        Compress-Archive -LiteralPath (Join-Path $output 'app\codex-plus-plus.exe') -DestinationPath (Join-Path $output "CodexPlusPlus-$version-windows-x64.zip") -Force
        Push-Location 'scripts/installer/windows'
        try { Run-Checked $compiler @('/INPUTCHARSET', 'UTF8', "/DVERSION=$version", 'CodexPlusPlus.nsi') }
        finally { Pop-Location }
        Run-Checked 'node' @('scripts/custom-release.mjs', 'dist/windows')
    }
} finally { Pop-Location; $env:PATH = $originalPath }
