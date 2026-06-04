FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "start"]
