#!/bin/bash

# OpenCode Multi-Agent System - Production Deployment Script
# This script deploys the entire OpenCode system to a Kubernetes cluster

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="opencode-system"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${SCRIPT_DIR}/k8s"

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

check_dependencies() {
    log_info "Checking dependencies..."

    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed. Please install it first."
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        log_error "docker is not installed. Please install it first."
        exit 1
    fi

    log_success "Dependencies check passed"
}

check_kubernetes_context() {
    log_info "Checking Kubernetes context..."

    if ! kubectl cluster-info &> /dev/null; then
        log_error "Unable to connect to Kubernetes cluster"
        exit 1
    fi

    CONTEXT=$(kubectl config current-context)
    log_info "Using Kubernetes context: $CONTEXT"
}

create_namespace() {
    log_info "Creating namespace: $NAMESPACE"

    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        kubectl apply -f "${K8S_DIR}/namespace.yaml"
        log_success "Namespace created"
    else
        log_warning "Namespace already exists"
    fi
}

build_and_push_image() {
    log_info "Building and pushing Docker image..."

    # Build the image
    docker build -t opencode-agent:latest .

    # Tag for registry (you may need to change this)
    docker tag opencode-agent:latest your-registry/opencode-agent:latest

    # Push to registry
    docker push your-registry/opencode-agent:latest

    log_success "Image built and pushed"
}

deploy_infrastructure() {
    log_info "Deploying infrastructure components..."

    # Apply configurations in order
    kubectl apply -f "${K8S_DIR}/configmap.yaml"
    kubectl apply -f "${K8S_DIR}/pvc.yaml"
    kubectl apply -f "${K8S_DIR}/services.yaml"

    log_success "Infrastructure deployed"
}

deploy_application() {
    log_info "Deploying application components..."

    # Deploy master orchestrator
    kubectl apply -f "${K8S_DIR}/master-deployment.yaml"

    # Wait for master to be ready
    log_info "Waiting for master orchestrator to be ready..."
    kubectl wait --for=condition=available --timeout=300s deployment/opencode-master-orchestrator -n "$NAMESPACE"

    # Deploy slave agents
    kubectl apply -f "${K8S_DIR}/slave-deployment.yaml"

    log_success "Application deployed"
}

create_secrets() {
    log_info "Creating secrets..."

    # Check if secrets already exist
    if ! kubectl get secret opencode-secrets -n "$NAMESPACE" &> /dev/null; then
        # Generate random secrets
        JWT_SECRET=$(openssl rand -hex 32)
        ADMIN_PASSWORD=$(openssl rand -hex 16)

        # Create secrets
        kubectl create secret generic opencode-secrets \
            --from-literal=jwt-secret="$JWT_SECRET" \
            --from-literal=admin-password="$ADMIN_PASSWORD" \
            -n "$NAMESPACE"

        log_success "Secrets created"
        log_warning "Please save these credentials:"
        echo "Admin Password: $ADMIN_PASSWORD"
        echo "JWT Secret: $JWT_SECRET"
    else
        log_warning "Secrets already exist"
    fi
}

verify_deployment() {
    log_info "Verifying deployment..."

    # Check pod status
    kubectl get pods -n "$NAMESPACE"

    # Check services
    kubectl get services -n "$NAMESPACE"

    # Check deployments
    kubectl get deployments -n "$NAMESPACE"

    log_success "Deployment verification complete"
}

main() {
    log_info "Starting OpenCode Multi-Agent System deployment..."

    check_dependencies
    check_kubernetes_context
    create_namespace
    build_and_push_image
    create_secrets
    deploy_infrastructure
    deploy_application
    verify_deployment

    log_success "Deployment completed successfully!"
    log_info "You can access the system at: http://<your-cluster-ip>:8080"
    log_info "Metrics available at: http://<your-cluster-ip>:9090"
}

# Run main function
main "$@"