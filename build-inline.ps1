# Build a self-contained index.html (all local assets inlined) from index.modular.html.
# Edit index.modular.html for changes, then re-run:  powershell -File build-inline.ps1
$dir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$src    = Join-Path $dir "index.modular.html"
$out    = Join-Path $dir "index.html"
$assets = Join-Path $dir "assets"

# First run: seed the modular source from the current (modular) index.html
if (-not (Test-Path -LiteralPath $src)) { Copy-Item -LiteralPath $out -Destination $src -Force }

$html   = [IO.File]::ReadAllText($src)
$logo64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $assets "logo.png")))
$post64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $assets "hero-poster.jpg")))
$datajs = [IO.File]::ReadAllText((Join-Path $assets "livefresh-data.js"))
$mapjs  = [IO.File]::ReadAllText((Join-Path $assets "livefresh-map.js"))
$animejs = if (Test-Path (Join-Path $assets "anime.umd.min.js")) { [IO.File]::ReadAllText((Join-Path $assets "anime.umd.min.js")) } else { "" }

# on-brand inline SVG favicon (LF badge) — avoids a 1.3MB external icon
$favicon = "<link rel=`"icon`" href=`"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%230E3A1F' stroke='%23F5C060' stroke-width='2'/%3E%3Ctext x='16' y='22' font-family='Georgia' font-size='15' font-weight='bold' fill='%23F4FAEF' text-anchor='middle'%3ELF%3C/text%3E%3C/svg%3E`" />"

$html = $html.Replace('<link rel="icon" type="image/png" href="assets/icon.png" />', $favicon)
$html = $html.Replace('src="assets/logo.png"', 'src="data:image/png;base64,' + $logo64 + '"')
$html = $html.Replace('poster="assets/hero-poster.jpg"', 'poster="data:image/jpeg;base64,' + $post64 + '"')
$html = $html.Replace('<script src="assets/livefresh-data.js"></script>', '<script>' + $datajs + '</script>')
$html = $html.Replace('<script src="assets/livefresh-map.js" defer></script>', '<script>' + $mapjs + '</script>')
if ($animejs -ne "") { $html = $html.Replace('<script src="assets/anime.umd.min.js"></script>', '<script>' + $animejs + '</script>') }

# inline any in-store carousel photos that are present (store-1.jpg, store-2.jpg, ...)
foreach ($s in (Get-ChildItem -LiteralPath $assets -Filter 'store-*.jpg' -ErrorAction SilentlyContinue)) {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($s.FullName))
  $html = $html.Replace('src="assets/' + $s.Name + '"', 'src="data:image/jpeg;base64,' + $b64 + '"')
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($out, $html, $utf8)

$kb = [math]::Round((Get-Item -LiteralPath $out).Length/1024)
$left = ([regex]::Matches($html, 'assets/')).Count
Write-Output "Built self-contained index.html ($kb KB). Remaining 'assets/' references: $left"
