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
RUN mkdir -p uploads/comprobantes uploads/evidencias uploads/logos-bancos

# /app/uploads es un VOLUMEN: todo lo que suben los usuarios (comprobantes de pago,
# evidencias de ordenes y logos de bancos) vive ahi y debe sobrevivir a la recreacion
# del contenedor. Declararlo aqui garantiza que, aunque quien despliegue olvide el -v,
# Docker cree un volumen anonimo en lugar de guardar los archivos en la capa efimera del
# contenedor. En despliegue se sustituye por un montaje explicito (azure-pipelines.yml:
# -v ~/nextproject-uploads-<entorno>:/app/uploads); con un volumen con nombre
# (-v nextproject-uploads:/app/uploads) Docker conserva ademas las subcarpetas de arriba.
VOLUME ["/app/uploads"]

EXPOSE 3000
CMD ["node", "dist/server.js"]
