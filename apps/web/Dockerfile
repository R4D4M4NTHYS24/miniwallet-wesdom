FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace apps/web

COPY apps/web/index.html ./apps/web/index.html
COPY apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY apps/web/vite.config.ts ./apps/web/vite.config.ts
COPY apps/web/src ./apps/web/src

EXPOSE 5173

CMD ["npm", "--workspace", "apps/web", "run", "dev"]
