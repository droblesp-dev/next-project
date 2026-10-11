FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_NEXT_PROJECT_NAME
ARG VITE_NEXT_PROJECT_WHATSAPP
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_NEXT_PROJECT_NAME=$VITE_NEXT_PROJECT_NAME \
    VITE_NEXT_PROJECT_WHATSAPP=$VITE_NEXT_PROJECT_WHATSAPP

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Host/puerto del backend que nginx proxea en /api/. Sobrescribibles en
# `docker run -e` según el entorno de despliegue (ej. nombre del servicio
# en docker-compose o en el orquestador usado).
ENV BACKEND_HOST=backend \
    BACKEND_PORT=3000

EXPOSE 80
