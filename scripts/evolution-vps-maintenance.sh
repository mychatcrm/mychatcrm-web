#!/usr/bin/env bash
# Manutenção segura da Evolution API na VPS Hostinger (Docker).
# Execute no Terminal do hPanel ou via SSH na VPS (ex.: 2.24.82.206).
#
# Uso:
#   ./scripts/evolution-vps-maintenance.sh status
#   ./scripts/evolution-vps-maintenance.sh restart
#   ./scripts/evolution-vps-maintenance.sh logs
#   ./scripts/evolution-vps-maintenance.sh update   # pull + up -d (faça snapshot antes)
#   ./scripts/evolution-vps-maintenance.sh orphans    # lista instâncias mc049357* (sistema)
#   ./scripts/evolution-vps-maintenance.sh runbook    # passos rápidos para agente do sistema

set -euo pipefail

COMPOSE_DIR="${EVOLUTION_COMPOSE_DIR:-/root/evolution-api}"
CONTAINER_FILTER="${EVOLUTION_CONTAINER_FILTER:-evolution}"

cmd="${1:-status}"

find_evolution_container() {
  docker ps --format '{{.Names}}' | grep -i "${CONTAINER_FILTER}" | head -n1 || true
}

case "$cmd" in
  status)
    echo "=== Docker containers ==="
    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
    echo ""
    echo "=== Evolution container (auto-detect) ==="
    c="$(find_evolution_container)"
    if [[ -n "$c" ]]; then
      docker inspect "$c" --format 'Name: {{.Name}} | Image: {{.Config.Image}} | Started: {{.State.StartedAt}}'
    else
      echo "Nenhum container encontrado com filtro: ${CONTAINER_FILTER}"
    fi
    ;;
  restart)
    c="$(find_evolution_container)"
    if [[ -z "$c" ]]; then
      echo "Container Evolution não encontrado. Ajuste EVOLUTION_CONTAINER_FILTER ou reinicie manualmente."
      exit 1
    fi
    echo "Reiniciando ${c} (sessões persistem no volume)..."
    docker restart "$c"
    echo "Aguardando 5s..."
    sleep 5
    docker logs --tail 50 "$c"
    ;;
  logs)
    c="$(find_evolution_container)"
    if [[ -z "$c" ]]; then
      echo "Container Evolution não encontrado."
      exit 1
    fi
    docker logs -f --tail 100 "$c"
    ;;
  update)
    if [[ ! -d "$COMPOSE_DIR" ]]; then
      echo "Diretório compose não encontrado: $COMPOSE_DIR"
      echo "Defina EVOLUTION_COMPOSE_DIR ou edite este script."
      exit 1
    fi
    echo "ATENÇÃO: faça snapshot/backup da VPS antes de continuar."
    echo "Instâncias cliente podem exigir novo QR após upgrade."
    read -r -p "Continuar com docker compose pull && up -d? [y/N] " ans
    if [[ "${ans:-}" != "y" && "${ans:-}" != "Y" ]]; then
      echo "Cancelado."
      exit 0
    fi
    cd "$COMPOSE_DIR"
    docker compose pull
    docker compose up -d
    docker compose ps
    ;;
  orphans)
    echo "Instâncias do sistema (prefixo mc049357) — apague só estas no Evolution Manager, nunca mc976b7b* (clientes):"
    c="$(find_evolution_container)"
    if [[ -z "$c" ]]; then
      echo "Container não encontrado; liste manualmente no Evolution Manager."
      exit 1
    fi
    docker logs --tail 500 "$c" 2>/dev/null | grep -o 'mc049357[a-f0-9]*' | sort -u || echo "(nenhuma encontrada nos logs recentes)"
    ;;
  runbook)
    cat <<'EOF'
=== Runbook — Agente do sistema MyChatCRM ===
1) No /admin/system-agent: apagar conexão → Conectar → QR com número oficial
2) Re-aplicar webhook (botão no painel admin)
3) Reconciliar órfãos se diagnóstico mostrar eventos pendentes
4) Restart Evolution: ./scripts/evolution-vps-maintenance.sh restart
5) Limpar instâncias órfãs mc049357* no Evolution Manager (NUNCA mc976b7b*)
6) Warm-up: destino manda "oi" antes de teste/código
7) Aceite E2E: 5 fluxos com delivered em <=60s no painel
EOF
    ;;
  *)
    echo "Comando desconhecido: $cmd"
    echo "Uso: $0 {status|restart|logs|update|orphans|runbook}"
    exit 1
    ;;
esac
