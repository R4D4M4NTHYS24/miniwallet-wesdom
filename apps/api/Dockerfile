FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
RUN npm ci --workspace apps/api
RUN DATABASE_URL="postgresql://miniwallet:miniwallet@postgres:5432/miniwallet?schema=public" npm --workspace apps/api run prisma:generate

COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src ./apps/api/src

EXPOSE 3000

CMD ["npm", "--workspace", "apps/api", "run", "dev"]
