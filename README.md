# WhatsApp API Service (Baileys + Express)

Layanan WhatsApp API mandiri (_self-hosted_) untuk menggantikan Whapi.cloud. Dibangun dengan `Baileys` dan `Express`, dirancang untuk dijalankan di VPS (AWS EC2) menggunakan Docker.

## Fitur

- **Multi-session (multi-login)**: banyak akun WhatsApp dalam satu service, tiap akun diidentifikasi `sessionId`.
- Koneksi WhatsApp dengan sesi persisten per `sessionId` (`useMultiFileAuthState`).
- Auto-reconnect dan auto-recovery (hapus sesi + scan ulang) saat logout.
- Restore semua sesi otomatis saat server restart.
- QR code tersedia di terminal (setup VPS) maupun via endpoint untuk ditampilkan di frontend.
- Endpoint session-scoped yang diamankan dengan API Key.
- Validasi nomor target via `onWhatsApp()` sebelum mengirim.
- Penerusan pesan masuk (_inbound_) ke webhook AutoFlow (membawa `sessionId` + `name`).
- Respons API dengan kerangka metadata standar.
- Siap deploy dengan Docker.

> Cara mengonsumsi API ini dari project Next.js (multi-login + menampilkan QR di frontend) ada di [docs/multi-session-integration.md](docs/multi-session-integration.md).

## Struktur Project

```
src/
├── config/        Konfigurasi env dan logger
├── controllers/   Handler endpoint HTTP (session & message)
├── lib/           Helper (respons, nomor telepon, axios, sessionId)
├── middlewares/   Middleware autentikasi API Key
├── routes/        Definisi rute Express (session-scoped)
├── services/      session.manager.js (multi-session) dan webhook forwarder
├── app.js         Setup aplikasi Express
└── server.js      Titik masuk utama (restore sesi saat boot)
```

## Menjalankan Secara Lokal

1. Install dependency:

   ```bash
   npm install
   ```

2. Salin `.env.example` menjadi `.env` lalu isi nilainya:

   ```bash
   cp .env.example .env
   ```

   | Variabel               | Keterangan                                              |
   | ---------------------- | ------------------------------------------------------- |
   | `PORT`                 | Port server (default `3001`)                            |
   | `API_KEY`              | Kunci rahasia untuk autentikasi endpoint                |
   | `AUTOFLOW_WEBHOOK_URL` | URL webhook AutoFlow tujuan pesan masuk                 |
   | `AUTH_FOLDER`          | Folder penyimpanan sesi (default `./auth_info_baileys`) |

3. Jalankan server:

   ```bash
   npm run dev
   ```

4. Scan QR code yang muncul di terminal melalui menu **Perangkat Tertaut** di aplikasi WhatsApp.

## Penggunaan API

Semua endpoint bersifat _session-scoped_: ganti `<SESSION_ID>` dengan identitas unik tiap user (mis. `userId` AutoFlow).

| Method   | Endpoint                            | Keterangan                              |
| -------- | ----------------------------------- | --------------------------------------- |
| `GET`    | `/sessions`                         | Daftar semua sesi + statusnya           |
| `GET`    | `/sessions/:sessionId/status`       | Status sesi + QR (auto-start bila baru) |
| `POST`   | `/sessions/:sessionId/send-message` | Kirim pesan dari sesi tertentu          |
| `DELETE` | `/sessions/:sessionId`              | Logout + hapus sesi                     |

### Status Sesi & QR Code

Mengembalikan status koneksi beserta QR code dalam bentuk data URL (`data:image/png;base64,...`). Jika sesi belum ada, sesi otomatis dimulai dan QR akan tersedia beberapa saat kemudian.

```bash
curl http://localhost:3001/sessions/<SESSION_ID>/status \
  -H "Authorization: Bearer <API_KEY_ANDA>"
```

**Respons (menunggu scan):**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Status sesi WhatsApp berhasil diambil",
  "data": {
    "status": "qr",
    "isReady": false,
    "qr": "data:image/png;base64,iVBORw0KGgo..."
  }
}
```

Nilai `status` dapat berupa `connecting`, `qr`, `open`, atau `close`. Saat `isReady` bernilai `true`, field `qr` akan `null`.

### Kirim Pesan

```bash
curl -X POST http://localhost:3001/sessions/<SESSION_ID>/send-message \
  -H "Authorization: Bearer <API_KEY_ANDA>" \
  -H "Content-Type: application/json" \
  -d '{"target":"6281234567890","message":"Halo dari Baileys"}'
```

**Respons berhasil (200):**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Pesan berhasil dikirim",
  "data": {
    "messageId": "BAE534ABCD123"
  }
}
```

Jika nomor target tidak terdaftar di WhatsApp, balasan `400` dengan pesan `"Nomor target tidak terdaftar whatsapp"`.

### Health Check

```bash
curl http://localhost:3001/health
```

## Pesan Masuk (Webhook)

Setiap pesan masuk dari nomor lain akan diteruskan ke `AUTOFLOW_WEBHOOK_URL` dengan metode `POST` dan payload:

```json
{
  "sessionId": "user-123",
  "sender": "6281234567890",
  "message": "isi balasan pengguna",
  "name": "Nama Pengirim",
  "receivedAt": "2026-06-13T10:01:00.000Z"
}
```

Field `sessionId` menandakan akun (user) mana yang menerima pesan, sehingga AutoFlow bisa mengarahkan ke workflow yang benar.

## Deployment dengan Docker

1. Pastikan `API_KEY` dan `AUTOFLOW_WEBHOOK_URL` pada `docker-compose.yaml` sudah diisi dengan benar.

2. Build dan jalankan:

   ```bash
   docker compose up -d --build
   ```

3. Lihat QR code untuk scan awal:

   ```bash
   docker logs -f bailey_container
   ```

> Folder `auth_info_baileys` di-_mount_ sebagai volume agar sesi tidak hilang saat kontainer restart.
