# ---- Builder stage ----
FROM python:3.14-slim AS builder

# Essential environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps needed only to build/install Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create a virtualenv to copy into the final image
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install uv (Astral) into the venv
RUN pip install --no-cache-dir -U pip && \
    pip install --no-cache-dir uv

# Copy project and install it (editable) using uv
COPY . .
RUN uv pip install --no-cache-dir -e .


# ---- Runtime stage ----
FROM python:3.14-slim AS runtime

# Essential environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Copy the prebuilt virtualenv from builder
COPY --from=builder /opt/venv /opt/venv

# Copy application source
COPY . .

# Used PORTS
EXPOSE 8501

# Run the app
CMD ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0", "--server.headless=true"]
