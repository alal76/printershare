# Beta test version v1.2.0
SHELL := /bin/bash
.DEFAULT_GOAL := help

-include .env
export

SERVER_IP ?= $(shell hostname -I 2>/dev/null | awk '{print $$1}')
SCANS_DIR ?= /srv/printershare/scans

.PHONY: help setup wizard build pull start stop restart logs status \
        setup-rclone test-rclone install-native install-usbip \
        open-ui open-cups backup clean

help: ## Show this help
	@echo ""
	@echo "  printershare — make targets"
	@echo "  ────────────────────────────────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	    | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Optional service profiles:"
	@echo "    docs    — Paperless-ngx document library"
	@echo "    remote  — Tailscale VPN + Cloudflare Tunnel"
	@echo "  Usage: COMPOSE_PROFILES=docs,remote make start"
	@echo ""

setup: ## Create .env from template and host scan directory
	@echo "==> Creating scan directory $(SCANS_DIR) ..."
	sudo mkdir -p $(SCANS_DIR) && sudo chmod 777 $(SCANS_DIR)
	@if [ ! -f .env ]; then \
	    cp .env.example .env; \
	    echo "==> .env created — edit it, then run: make build start"; \
	else \
	    echo "==> .env already exists"; \
	fi

wizard: ## Open browser-based setup wizard
	@echo "==> Starting portal for wizard ..."
	docker compose up -d portal nginx
	@sleep 2
	@echo "==> Opening wizard at http://$(SERVER_IP)/wizard"
	xdg-open "http://$(SERVER_IP)/wizard" 2>/dev/null || \
	    open "http://$(SERVER_IP)/wizard" 2>/dev/null || \
	    echo "Open: http://$(SERVER_IP)/wizard"

build: ## Build all custom Docker images
	docker compose build

pull: ## Pull latest upstream images
	docker compose pull samba nfs nginx

start: ## Start all containers (default profile)
	docker compose up -d
	@echo ""
	@echo "  Portal     : http://$(SERVER_IP)/"
	@echo "  Scan UI    : http://$(SERVER_IP)/scan/"
	@echo "  CUPS admin : http://$(SERVER_IP)/cups/"
	@echo "  Samba      : \\\\$(SERVER_IP)\\Scans"
	@echo "  NFS        : $(SERVER_IP):/exports/scans"
	@echo ""

start-docs: ## Start with Paperless-ngx document library
	COMPOSE_PROFILES=docs docker compose up -d
	@echo "  Docs       : http://$(SERVER_IP)/docs/"

start-remote: ## Start with Tailscale + Cloudflare remote access
	COMPOSE_PROFILES=remote docker compose up -d

start-all: ## Start all services (all profiles)
	COMPOSE_PROFILES=docs,remote docker compose up -d

stop: ## Stop all containers
	docker compose down

restart: ## Restart all containers
	docker compose restart

restart-%: ## Restart one service e.g. make restart-cups
	docker compose restart $*

status: ## Show container status
	docker compose ps

logs: ## Tail all container logs
	docker compose logs -f

logs-%: ## Tail logs for one service e.g. make logs-cups
	docker compose logs -f $*

setup-rclone: ## Interactive rclone wizard (Google Drive + OneDrive)
	bash scripts/setup-rclone.sh

test-rclone: ## Test rclone remote connections
	bash scripts/setup-rclone.sh --test

install-native: ## Install everything natively on Ubuntu/Debian (no Docker)
	sudo bash scripts/install-native.sh

install-usbip: ## Install USB/IP server (raw USB port sharing)
	sudo bash scripts/install-usbip-server.sh

install-udev: ## Install USB hotplug udev rules for auto-rebind
	sudo bash usbip/install-udev.sh

open-ui: ## Open portal web UI in browser
	xdg-open "http://$(SERVER_IP)/" 2>/dev/null || open "http://$(SERVER_IP)/" 2>/dev/null || echo "Open: http://$(SERVER_IP)/"

open-cups: ## Open CUPS admin UI in browser
	xdg-open "http://$(SERVER_IP)/cups/" 2>/dev/null || open "http://$(SERVER_IP)/cups/" 2>/dev/null || echo "Open: http://$(SERVER_IP)/cups/"

backup: ## Backup all persistent volumes to ./backups/<timestamp>/
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S); \
	mkdir -p backups/$$TIMESTAMP; \
	docker run --rm \
	    -v cups-config:/data/cups-config \
	    -v portal-data:/data/portal-data \
	    -v rclone-config:/data/rclone-config \
	    -v $${SCANS_HOST_PATH:-/srv/printershare/scans}:/data/scans \
	    -v $$(pwd)/backups/$$TIMESTAMP:/backup \
	    alpine tar czf /backup/printershare-backup.tar.gz /data; \
	echo "==> Backup saved to backups/$$TIMESTAMP/printershare-backup.tar.gz"

clean: ## Remove stopped containers and dangling images (keeps volumes)
	docker compose down --remove-orphans
	docker image prune -f


setup-rclone: ## Interactive rclone wizard (Google Drive + OneDrive)
	bash scripts/setup-rclone.sh

test-rclone: ## Test rclone remote connections
	bash scripts/setup-rclone.sh --test

install-native: ## Install everything natively on Ubuntu/Debian (no Docker)
	sudo bash scripts/install-native.sh

install-usbip: ## Install USB/IP server (raw USB port sharing)
	sudo bash scripts/install-usbip-server.sh

open-ui: ## Open scanner web UI in browser
	xdg-open "http://$(SERVER_IP)/" 2>/dev/null || open "http://$(SERVER_IP)/" 2>/dev/null || echo "Open: http://$(SERVER_IP)/"

open-cups: ## Open CUPS admin UI in browser
	xdg-open "http://$(SERVER_IP):631/" 2>/dev/null || open "http://$(SERVER_IP):631/" 2>/dev/null || echo "Open: http://$(SERVER_IP):631/"

clean: ## Remove stopped containers and dangling images (keeps volumes)
	docker compose down --remove-orphans
	docker image prune -f
