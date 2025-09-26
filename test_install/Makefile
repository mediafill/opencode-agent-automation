# OpenCode Multi-Agent System Makefile

.PHONY: help build test clean deploy setup lint format docs

# Default target
help: ## Show this help message
	@echo "OpenCode Multi-Agent System"
	@echo ""
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

# Setup
setup: ## Initial setup of development environment
	./setup.sh

# Build
build: ## Build Docker image
	docker build -t opencode-agent:latest .

build-prod: ## Build production Docker image
	docker build --target production -t opencode-agent:prod .

push: ## Push Docker image to registry
	docker tag opencode-agent:latest $(DOCKER_REGISTRY)/opencode-agent:latest
	docker push $(DOCKER_REGISTRY)/opencode-agent:latest

# Development
dev: ## Start development environment with docker-compose
	docker-compose up -d

dev-build: ## Start development environment with fresh build
	docker-compose up --build -d

dev-logs: ## Show development logs
	docker-compose logs -f

dev-stop: ## Stop development environment
	docker-compose down

# Testing
test: ## Run tests
	pytest tests/ -v --cov=src --cov-report=html

test-unit: ## Run unit tests only
	pytest tests/unit/ -v

test-integration: ## Run integration tests
	pytest tests/integration/ -v

# Code Quality
lint: ## Run linting
	flake8 src/ tests/
	black --check src/ tests/

format: ## Format code
	black src/ tests/
	isort src/ tests/

type-check: ## Run type checking
	mypy src/

security: ## Run security checks
	bandit -r src/
	safety check

# Deployment
deploy: ## Deploy to Kubernetes
	./deploy.sh

deploy-dev: ## Deploy to development Kubernetes namespace
	K8S_NAMESPACE=opencode-dev ./deploy.sh

undeploy: ## Remove from Kubernetes
	kubectl delete namespace opencode-system --ignore-not-found=true

# Monitoring
monitoring-up: ## Start monitoring stack
	docker-compose -f docker-compose.monitoring.yml up -d

monitoring-down: ## Stop monitoring stack
	docker-compose -f docker-compose.monitoring.yml down

# Database
db-migrate: ## Run database migrations
	alembic upgrade head

db-reset: ## Reset database (WARNING: destroys data)
	docker-compose down -v
	docker-compose up -d postgres

# Logs
logs: ## Show application logs
	kubectl logs -f -n opencode-system deployment/opencode-master-orchestrator

logs-slaves: ## Show slave agent logs
	kubectl logs -f -n opencode-system deployment/opencode-slave-agents

# Cleanup
clean: ## Clean up build artifacts and temporary files
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type f -name "*.pyd" -delete
	find . -type d -name "*.egg-info" -exec rm -rf {} +
	rm -rf .coverage htmlcov/ .pytest_cache/
	docker system prune -f

clean-all: clean ## Clean up everything including volumes
	docker-compose down -v
	docker system prune -a -f --volumes

# Documentation
docs: ## Generate documentation
	mkdocs build

docs-serve: ## Serve documentation locally
	mkdocs serve

# CI/CD
ci: lint type-check test security ## Run full CI pipeline

# Utility
shell: ## Open shell in running container
	docker-compose exec master-orchestrator bash

db-shell: ## Open database shell
	docker-compose exec postgres psql -U opencode -d opencode

redis-shell: ## Open Redis shell
	docker-compose exec redis redis-cli

# Environment
env-check: ## Check environment variables
	@echo "Checking environment variables..."
	@test -f .env || (echo ".env file not found. Run 'make setup' first."; exit 1)
	@grep -v '^#' .env | grep -v '^$$' | while read line; do \
		key=$$(echo $$line | cut -d'=' -f1); \
		value=$$(echo $$line | cut -d'=' -f2-); \
		if [ -z "$$value" ]; then \
			echo "Warning: $$key is not set"; \
		fi; \
	done
	@echo "Environment check complete"

# Help for specific targets
help-%: ## Show help for a specific target
	@grep -E '^$*:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'