# Stage 1: Build modern static React frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 2: Build Rust backend with embedded frontend assets
FROM rust:1.85-slim-bookworm AS backend-builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy cargo manifest and lock
COPY Cargo.toml Cargo.lock build.rs ./
COPY vendor ./vendor
COPY native ./native
COPY scripts ./scripts

# Copy compiled frontend into place so rust-embed embeds it at compile time
COPY --from=frontend-builder /app/web/dist ./web/dist

# Copy source code
COPY src ./src

# Build production release binary
RUN cargo build --release --bin gdirect

# Stage 3: Ultra-lightweight minimal runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates curl tzdata && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=backend-builder /app/target/release/gdirect /usr/local/bin/gdirect

ENV PORT=8080 \
    GDIRECT_HOST=0.0.0.0

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/api/status || exit 1

ENTRYPOINT ["/usr/local/bin/gdirect", "serve", "--db", "/data/state.sqlite3"]
