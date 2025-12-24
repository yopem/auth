FROM oven/bun:alpine AS base
RUN apk add --no-cache libc6-compat
RUN apk update

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Production image, copy all the files and run the app
FROM base AS runner
WORKDIR /app

ENV APP_ENV production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/start ./start

EXPOSE 3999

CMD ["./start"]
