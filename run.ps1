$ErrorActionPreference = "Stop"

$Port = 5173
$Root = $PSScriptRoot
$Python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
$Server = Join-Path $Root "backend\server.py"
$Requirements = Join-Path $Root "requirements.txt"

function Get-ServerProcessIds {
    $lines = netstat -ano | Select-String ":$Port"
    $ids = @()

    foreach ($line in $lines) {
        $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
        if ($parts.Count -ge 5 -and $parts[1] -like "*:$Port" -and $parts[3] -eq "LISTENING") {
            $ids += [int]$parts[4]
        }
    }

    return $ids | Select-Object -Unique
}

function Start-Server {
    $ids = @(Get-ServerProcessIds)
    if ($ids.Count -gt 0) {
        Write-Host "Server is already running at http://127.0.0.1:$Port" -ForegroundColor Yellow
        return
    }

    if (-not (Test-Path $Python)) {
        Write-Host "Python was not found: $Python" -ForegroundColor Red
        return
    }

    if (-not (Test-Dependencies)) {
        Write-Host "FastAPI dependencies are missing. Select 4 to install dependencies first." -ForegroundColor Yellow
        return
    }

    Start-Process -FilePath $Python -ArgumentList "`"$Server`"" -WorkingDirectory $Root -WindowStyle Hidden
    Start-Sleep -Milliseconds 500
    Write-Host "Started: http://127.0.0.1:$Port" -ForegroundColor Green
}

function Test-Dependencies {
    if (-not (Test-Path $Python)) {
        return $false
    }

    & $Python -c "import fastapi, uvicorn" 2>$null
    return $LASTEXITCODE -eq 0
}

function Install-Dependencies {
    if (-not (Test-Path $Python)) {
        Write-Host "Python was not found: $Python" -ForegroundColor Red
        return
    }
    if (-not (Test-Path $Requirements)) {
        Write-Host "requirements.txt was not found." -ForegroundColor Red
        return
    }

    & $Python -m pip install -r $Requirements
}

function Stop-Server {
    $ids = @(Get-ServerProcessIds)
    if ($ids.Count -eq 0) {
        Write-Host "Server is not running." -ForegroundColor Yellow
        return
    }

    foreach ($id in $ids) {
        Stop-Process -Id $id -Force
        Write-Host "Stopped process $id" -ForegroundColor Green
    }
}

function Restart-Server {
    Stop-Server
    Start-Sleep -Milliseconds 500
    Start-Server
}

Write-Host ""
Write-Host "Matgo server menu" -ForegroundColor Cyan
Write-Host "1. Start"
Write-Host "2. Restart"
Write-Host "3. Stop"
Write-Host "4. Install dependencies"
Write-Host "5. Exit"
Write-Host ""

$choice = Read-Host "Select"

switch ($choice) {
    "1" { Start-Server }
    "2" { Restart-Server }
    "3" { Stop-Server }
    "4" { Install-Dependencies }
    "5" { Write-Host "Bye." }
    default { Write-Host "Unknown option: $choice" -ForegroundColor Red }
}
