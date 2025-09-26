#!/bin/bash

# OpenCode Multi-Agent System - Setup Script
# This script sets up the development and deployment environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

create_directories() {
    log_info "Creating necessary directories..."

    mkdir -p data
    mkdir -p certs
    mkdir -p logs
    mkdir -p monitoring/prometheus
    mkdir -p monitoring/grafana/provisioning/datasources
    mkdir -p monitoring/grafana/provisioning/dashboards

    log_success "Directories created"
}

generate_certificates() {
    log_info "Generating SSL certificates..."

    if [ ! -f certs/ca.crt ]; then
        # Generate CA private key
        openssl genrsa -out certs/ca.key 4096

        # Generate CA certificate
        openssl req -x509 -new -nodes -key certs/ca.key -sha256 -days 3650 \
            -out certs/ca.crt \
            -subj "/C=US/ST=State/L=City/O=OpenCode/CN=OpenCode-CA"

        # Generate server private key
        openssl genrsa -out certs/master.key 4096

        # Generate certificate signing request
        openssl req -new -key certs/master.key \
            -out certs/master.csr \
            -subj "/C=US/ST=State/L=City/O=OpenCode/CN=master-orchestrator"

        # Generate server certificate
        openssl x509 -req -in certs/master.csr -CA certs/ca.crt -CAkey certs/ca.key \
            -CAcreateserial -out certs/master.crt -days 365 -sha256

        # Generate client certificate
        openssl genrsa -out certs/client.key 4096
        openssl req -new -key certs/client.key \
            -out certs/client.csr \
            -subj "/C=US/ST=State/L=City/O=OpenCode/CN=client"
        openssl x509 -req -in certs/client.csr -CA certs/ca.crt -CAkey certs/ca.key \
            -CAcreateserial -out certs/client.crt -days 365 -sha256

        # Clean up
        rm certs/*.csr certs/*.srl

        log_success "SSL certificates generated"
    else
        log_warning "SSL certificates already exist"
    fi
}

create_env_file() {
    log_info "Creating environment file..."

    if [ ! -f .env ]; then
        cat > .env << EOF
# OpenCode Multi-Agent System Environment Variables

# Database
POSTGRES_PASSWORD=opencode123
POSTGRES_DB=opencode
POSTGRES_USER=opencode

# Authentication
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=admin123

# Monitoring
GRAFANA_PASSWORD=admin123

# Docker Registry (change this to your registry)
DOCKER_REGISTRY=your-registry.com

# Kubernetes
K8S_NAMESPACE=opencode-system

# Logging
LOG_LEVEL=INFO

# Redis
REDIS_PASSWORD=

# External Services
PROMETHEUS_URL=http://prometheus:9090
GRAFANA_URL=http://grafana:3000
EOF

        log_success "Environment file created"
        log_warning "Please review and update .env file with your specific values"
    else
        log_warning "Environment file already exists"
    fi
}

create_monitoring_config() {
    log_info "Creating monitoring configuration..."

    # Prometheus configuration
    if [ ! -f monitoring/prometheus.yml ]; then
        cat > monitoring/prometheus.yml << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  # - "first_rules.yml"
  # - "second_rules.yml"

scrape_configs:
  - job_name: 'opencode-master'
    static_configs:
      - targets: ['master-orchestrator:9090']
    scrape_interval: 5s

  - job_name: 'opencode-slaves'
    static_configs:
      - targets: ['opencode-slave-agents:9090']
    scrape_interval: 5s

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
EOF
        log_success "Prometheus configuration created"
    fi

    # Grafana datasource configuration
    if [ ! -f monitoring/grafana/provisioning/datasources/prometheus.yml ]; then
        mkdir -p monitoring/grafana/provisioning/datasources
        cat > monitoring/grafana/provisioning/datasources/prometheus.yml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
EOF
        log_success "Grafana datasource configuration created"
    fi
}

create_dockerignore() {
    log_info "Creating .dockerignore file..."

    if [ ! -f .dockerignore ]; then
        cat > .dockerignore << EOF
# Version control
.git
.gitignore

# Python
__pycache__
*.pyc
*.pyo
*.pyd
.Python
env
venv
.venv
pip-log.txt
pip-delete-this-directory.txt
.tox
.coverage
.coverage.*
.cache
nosetests.xml
coverage.xml
*.cover
*.log
.git
.mypy_cache
.pytest_cache
.hypothesis

# Virtual environments
.env
.venv
env/
venv/
ENV/
env.bak/
venv.bak/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Documentation
*.md
docs/

# Test files
tests/
test_*.py
*_test.py

# Development files
docker-compose.override.yml
.dockerignore

# Logs
logs/
*.log

# Data
data/
EOF
        log_success ".dockerignore file created"
    fi
}

setup_git_hooks() {
    log_info "Setting up git hooks..."

    # Create pre-commit hook for linting
    mkdir -p .git/hooks
    cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

echo "Running pre-commit checks..."

# Run linting if available
if command -v flake8 &> /dev/null; then
    echo "Running flake8..."
    flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
fi

if command -v black &> /dev/null; then
    echo "Running black..."
    black --check .
fi

echo "Pre-commit checks completed"
EOF

    chmod +x .git/hooks/pre-commit
    log_success "Git hooks configured"
}

main() {
    log_info "Setting up OpenCode Multi-Agent System environment..."

    create_directories
    generate_certificates
    create_env_file
    create_monitoring_config
    create_dockerignore
    setup_git_hooks

    log_success "Environment setup completed!"
    log_info "Next steps:"
    echo "1. Review and update the .env file"
    echo "2. Update the Docker registry in .env"
    echo "3. Run 'make build' to build the application"
    echo "4. Run 'make deploy' to deploy to Kubernetes"
}

# Run main function
main "$@"