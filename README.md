# FileDrop 📁

Şifreli, geçici dosya transfer uygulaması.  
6 haneli oda kodu — 1 saat sonra tüm dosyalar otomatik silinir — max 1 GB.

---

## Kurulum

### 1. Backend (server)

```bash
cd server
npm install
node index.js
```

Sunucu `3001` portunda çalışır. Port değiştirmek için:
```bash
PORT=5000 node index.js
```

---

### 2. Frontend (client)

`.env.example` dosyasını kopyala ve düzenle:
```bash
cd client
cp .env.example .env
```

`.env` içinde `VITE_API_URL`'i sunucunun gerçek adresine yaz:
```
VITE_API_URL=https://senindomain.com
```

Sonra:
```bash
npm install
npm run build
```

`dist/` klasörünü hosting'indeki public HTML dizinine at (cPanel'de `public_html`).

---

### 3. Production için Nginx örneği

```nginx
server {
    listen 80;
    server_name senindomain.com;

    # Frontend
    root /var/www/filedrop/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend proxy
    location /api {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        client_max_body_size 1G;
    }
}
```

---

### 4. PM2 ile sunucuyu arka planda çalıştır

```bash
npm install -g pm2
cd server
pm2 start index.js --name filedrop
pm2 save
pm2 startup
```

---

## Kullanım

1. Kırtasiyedeki bilgisayarda siteye gir → **Yeni Oda Oluştur**
2. 6 haneli kodu karşı tarafa gönder (WhatsApp, SMS, sesli söyle)
3. Karşı taraf siteye girer → **Odaya Katıl** → kodu yazar
4. Dosyaları yükle veya indir
5. 1 saat sonra her şey otomatik silinir ✓
