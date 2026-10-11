FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# uploads/comprobantes y uploads/evidencias deben existir siempre: el
# codigo escribe ahi via fs.writeFile asumiendo que ya existen (ver
# backend/src/config/uploadsComprobantes.ts). En despliegue, /app/uploads
# se monta como volumen (ver azure-pipelines.yml) para persistir los
# archivos entre deploys.
RUN mkdir -p uploads/comprobantes uploads/evidencias

EXPOSE 3000
CMD ["node", "dist/server.js"]
