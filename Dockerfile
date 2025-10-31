FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY index.ts ./

RUN npm install
RUN npm run build

FROM node:22-alpine AS release

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/index.js"]