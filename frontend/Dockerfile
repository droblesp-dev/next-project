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
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
