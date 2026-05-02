FROM node:18-alpine AS builder

WORKDIR /app

# Client bağımlılıklarını yükle ve derle (build)
COPY client/package*.json ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# Server için yeni, temiz bir aşama
FROM node:18-alpine

WORKDIR /app

# Server bağımlılıklarını yükle
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Server kodlarını kopyala
COPY server/ ./server/

# Derlenmiş Client dosyalarını kopyala
COPY --from=builder /app/client/dist ./client/dist

# Çalışma dizinini server olarak ayarla
WORKDIR /app/server

# Yüklemeler için klasör oluştur (İzin sorunları olmaması için)
RUN mkdir -p uploads

# 3001 portunu dışa aç
EXPOSE 3001

# Uygulamayı başlat
CMD ["node", "index.js"]
