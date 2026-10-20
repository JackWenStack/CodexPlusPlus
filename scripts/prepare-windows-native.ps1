param([Parameter(Mandatory=$true)][string]$Destination, [string]$ArchivePath)
$ErrorActionPreference = 'Stop'
# sherpa-onnx-sys 将预编译库放在 target 的自定义目录中；Rust 缓存清理会移除其中的 .lib。
# 独立准备库目录，避免缓存恢复后只剩空目录却被依赖的 build.rs 当成有效缓存。
$version = '1.13.8'
$sha256 = '56FFCF3C454C1F14F7BC9887286CC8143E7E542DC632804E1C447D5F8D534EAF'
$repoRoot = Split-Path -Parent $PSScriptRoot
$lock = Get-Content -LiteralPath (Join-Path $repoRoot 'Cargo.lock') -Raw
if ($lock -notmatch ('name = "sherpa-onnx-sys"\r?\nversion = "' + [regex]::Escape($version) + '"')) {
    throw 'Update the pinned sherpa-onnx version and official asset checksum before building'
}
$destinationRoot = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
$stem = "sherpa-onnx-v$version-win-x64-static-MT-Release-lib"
if (-not $ArchivePath) {
    $ArchivePath = Join-Path $destinationRoot "$stem.tar.bz2"
    Invoke-WebRequest -Uri "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$version/$stem.tar.bz2" -OutFile $ArchivePath
}
if ((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash -ne $sha256) {
    throw 'Official sherpa-onnx archive checksum mismatch'
}
& tar.exe -xjf $ArchivePath -C $destinationRoot
if ($LASTEXITCODE -ne 0) { throw 'Native library extraction failed' }
$libDir = Join-Path $destinationRoot "$stem\lib"
$libraries = @('sherpa-onnx-c-api','sherpa-onnx-core','kaldi-decoder-core','sherpa-onnx-kaldifst-core',
    'sherpa-onnx-fstfar','sherpa-onnx-fst','kaldi-native-fbank-core','kissfft-float','piper_phonemize',
    'espeak-ng','ucd','onnxruntime','ssentencepiece_core')
foreach ($library in $libraries) {
    $file = Get-Item -LiteralPath (Join-Path $libDir "$library.lib")
    if ($file.Length -eq 0) { throw "Empty native library: $library" }
}
$env:SHERPA_ONNX_LIB_DIR = $libDir
if ($env:GITHUB_ENV) { "SHERPA_ONNX_LIB_DIR=$libDir" | Out-File -LiteralPath $env:GITHUB_ENV -Encoding utf8 -Append }
Write-Output "Verified $($libraries.Count) native libraries from sherpa-onnx v$version"
