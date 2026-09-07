PYTHON ?= python
PNPM ?= pnpm

.PHONY: install setup dev up down migrate seed lint lint-frontend lint-backend typecheck typecheck-frontend typecheck-backend test test-backend test-frontend test-e2e golden-case golden security environment-check migration-check contract-check clean verify

install setup:
	$(PYTHON) -m pip install -e ".[dev]"
	$(PNPM) install --frozen-lockfile

dev up:
	docker compose up -d --build

down:
	docker compose down

migrate:
	$(PYTHON) -m alembic upgrade head

seed:
	$(PYTHON) -m backend.scripts.seed

lint-frontend:
	$(PNPM) lint

lint-backend:
	$(PYTHON) -m ruff check backend

lint: lint-frontend lint-backend

typecheck-frontend:
	$(PNPM) typecheck

typecheck-backend:
	$(PYTHON) -m mypy backend/app

typecheck: typecheck-frontend typecheck-backend

test-backend:
	$(PYTHON) -m pytest backend/tests --cov=backend.app --cov-report=term-missing --cov-fail-under=70

test-frontend:
	$(PNPM) test

test-e2e:
	$(PNPM) test:e2e

test: test-backend test-frontend

golden-case golden:
	$(PYTHON) -m backend.scripts.golden_case
	$(PYTHON) -m backend.scripts.verify_golden

environment-check:
	$(PYTHON) -m backend.scripts.delivery_checks environment

migration-check:
	$(PYTHON) -m backend.scripts.delivery_checks migrations

contract-check:
	$(PYTHON) -m backend.scripts.export_openapi --check

security:
	$(PYTHON) -m backend.scripts.delivery_checks secrets
	$(PYTHON) -m pip_audit --local --progress-spinner off --cache-dir .audit-cache/pip
	$(PNPM) audit --audit-level high --registry https://registry.npmjs.org

clean:
	$(PYTHON) -m backend.scripts.delivery_checks clean

verify: environment-check
	$(PNPM) generate:api
	$(MAKE) lint-frontend
	$(MAKE) typecheck-frontend
	$(MAKE) test-frontend
	$(PNPM) build
	$(MAKE) lint-backend
	$(MAKE) typecheck-backend
	$(MAKE) test-backend
	$(MAKE) migration-check
	$(MAKE) contract-check
	$(PYTHON) -m backend.scripts.backup_restore_smoke
	$(MAKE) test-e2e
	$(MAKE) golden-case
	$(MAKE) security
	$(PYTHON) -m backend.scripts.delivery_checks final
