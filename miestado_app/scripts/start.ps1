#!/usr/bin/env pwsh
# Levanta MiEstadoApp con docker-compose y verifica los 3 servicios.
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectRoot

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host '[start] .env creado a partir de .env.example - editalo antes de produccion.' -ForegroundColor Yellow
}

Write-Host '[start] Construyendo y levantando los servicios (mongo + api + frontend)...' -ForegroundColor Cyan
docker compose up -d --build

Write-Host ''
Write-Host '[start] Esperando healthchecks...' -ForegroundColor Cyan
Start-Sleep -Seconds 8

Write-Host ''
Write-Host '[start] Mongo healthcheck:' -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:27017' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
} catch {
    # mongod no responde HTTP; verificamos via docker
    $health = docker inspect --format='{{.State.Health.Status}}' miestado_mongo
    Write-Host ('  Estado (docker inspect): ' + $health)
}

Write-Host '[start] API healthcheck:' -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:8888/healthz' -UseBasicParsing -TimeoutSec 5
    Write-Host ('  ' + $resp.StatusCode + ' ' + $resp.Content)
} catch {
    Write-Host '  [ERROR] Servicio aun no disponible: ' $_.Exception.Message
}

Write-Host '[start] Frontend healthcheck:' -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 5
    Write-Host ('  ' + $resp.StatusCode + ' (' + $resp.Headers['Content-Type'] + ')')
} catch {
    Write-Host '  [ERROR] Frontend aun no disponible: ' $_.Exception.Message
}

Write-Host ''
Write-Host '[start] Credenciales del administrador sembrado:' -ForegroundColor Green
Write-Host '  correo    : admin@miestado.local'
Write-Host '  contrasena: CambiarEnProduccion123*'
Write-Host '  Panel     : http://localhost:5173   (Vite + nginx)'
Write-Host '  API       : http://localhost:8888   (FastAPI)'
Write-Host '  OpenAPI   : http://localhost:8888/docs'

Write-Host ''
Write-Host '[start] Probando login contra la API:' -ForegroundColor Cyan
try {
    $body = 'username=admin@miestado.local&password=CambiarEnProduccion123*'
    $tokenResp = Invoke-WebRequest `
        -Uri 'http://localhost:8888/api/auth/token' `
        -Method POST `
        -ContentType 'application/x-www-form-urlencoded' `
        -Body $body `
        -UseBasicParsing `
        -TimeoutSec 10
    Write-Host ('  Login OK. Response: ' + $tokenResp.Content)
} catch {
    Write-Host '  [ERROR] No se pudo autenticar: ' $_.Exception.Message
}

Write-Host ''
Write-Host '[start] Tail de logs:' -ForegroundColor Cyan
docker compose logs --tail=10

Pop-Location
