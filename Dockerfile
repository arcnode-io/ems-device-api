FROM node:24-slim AS builder
WORKDIR /app
COPY package* .
RUN npm ci
COPY tsconfig*.json nest-cli.json cfg.yml .
COPY src src
COPY device_templates device_templates
RUN find src -name "*.test.ts" -delete
RUN npm run build

FROM node:24-slim AS production
WORKDIR /app
COPY package* .
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/device_templates ./device_templates
COPY cfg.yml .
CMD [ "node", "dist/main"]
