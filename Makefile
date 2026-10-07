.PHONY: help install dev up down build start test coverage e2e lint typecheck check judge prototype

.DEFAULT_GOAL := help

PIDFILE := .next-dev.pid

help: ## Show available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

install: ## Install npm dependencies
	npm install

dev: ## Start development server (foreground)
	npm run dev

up: ## Start dev server in the background (idempotent)
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "already running (pid $$(cat $(PIDFILE)))"; \
	else \
		nohup npm run dev > .next-dev.log 2>&1 & echo $$! > $(PIDFILE); \
		echo "started (pid $$(cat $(PIDFILE))), logs in .next-dev.log"; \
	fi

down: ## Stop the background dev server
	@if [ -f $(PIDFILE) ]; then \
		pkill -P $$(cat $(PIDFILE)) 2>/dev/null || true; \
		kill $$(cat $(PIDFILE)) 2>/dev/null || true; \
		rm -f $(PIDFILE); \
	fi; echo "stopped"

build: ## Production build
	npm run build

start: ## Run the production build on 127.0.0.1:3000
	npm run start

test: ## Run unit and integration tests
	npm test

coverage: ## Unit and integration tests with coverage
	npm run test:coverage

e2e: ## Browser tests (Playwright, Gemini fixture mode); keeps macOS awake while running
	@if command -v caffeinate >/dev/null; then caffeinate -dims npm run test:e2e; else npm run test:e2e; fi

check: typecheck lint test ## Typecheck, lint and tests

judge: ## Judge one local video with the real agent: make judge VIDEO=path/to/video.mp4
	npm run judge -- $(VIDEO)

lint: ## Run ESLint
	npm run lint

typecheck: ## Run TypeScript check
	npm run typecheck

prototype: ## Serve the S-1 HTML prototype at http://localhost:4100
	python3 -m http.server 4100 -d specs/prototype
