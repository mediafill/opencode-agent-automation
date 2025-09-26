# Multi-stage Dockerfile for OpenCode Multi-Agent System
FROM python:3.11-slim as base

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r opencode && useradd -r -g opencode opencode

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Production stage
FROM base as production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /data /certs /logs && \
    chown -R opencode:opencode /data /certs /logs /app

# Switch to non-root user
USER opencode

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Expose ports
EXPOSE 8080 9090

# Default command
CMD ["python", "-m", "opencode_agent_system"]