# 🌧️ RainSense — Smart Rainfall & Environmental Monitoring System

[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Next.js 14](https://img.shields.io/badge/Next.js-14_App_Router-black.svg)](https://nextjs.org/)
[![Database Aiven](https://img.shields.io/badge/Database-Aiven_PostgreSQL-FF1053.svg)](https://aiven.io/)
[![MQTT EMQX](https://img.shields.io/badge/MQTT-EMQX_Broker-00B175.svg)](https://www.emqx.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**RainSense** là hệ thống giám sát khí tượng và đo mưa thông minh quy chuẩn công nghiệp, kết nối phần cứng vi điều khiển **ESP32-S3**, cảm biến môi trường kỹ thuật số **BME280** (Nhiệt độ, Độ ẩm, Khí áp), và cảm biến **Hall A3144** gắn trên phễu lật đo mưa (Tipping Bucket Rain Gauge).

Dự án được phân chia độc lập và rõ ràng thành 2 thư mục chính:
1. **`frontend/`:** Giao diện Next.js 14 App Router, Tailwind CSS, Recharts, TanStack Query, React Hook Form, Dark/Light mode, độc lập 100% (dễ dàng deploy lên Vercel/Render).
2. **`backend/`:** Node.js Express API, Socket.IO truyền phát thời gian thực, MQTT.js kết nối **EMQX MQTT Broker** (TCP/TLS), Prisma ORM kết nối **Aiven PostgreSQL Cloud**, Zod validation, khử trùng lặp bản tin idempotent.
3. **`firmware/`:** Mã nguồn nhúng Arduino C++ cho vi điều khiển ESP32-S3.
4. **`docs/`:** Tài liệu kiến trúc, hướng dẫn triển khai Render, hướng dẫn cấu hình EMQX & Aiven.

---

## 🏛️ Cấu Trúc Dự Án (Project Structure)

```
IOTPROJECT/
├── backend/                  # Server Node.js + Express + Socket.IO + EMQX MQTT
│   ├── src/                  # Mã nguồn Backend (API, Controllers, Services, MQTT)
│   ├── prisma/               # Cấu trúc cơ sở dữ liệu Prisma (PostgreSQL / Aiven)
│   ├── .env.example          # File mẫu cấu hình backend
│   └── package.json          # Dependencies & Scripts độc lập của backend
├── frontend/                 # Giao diện Web Dashboard Next.js 14
│   ├── app/                  # Next.js App Router (Overview, Rainfall, Environmental, Alerts)
│   ├── components/           # UI Components
│   ├── lib/                  # Utilities & API Client
│   ├── .env.example          # File mẫu cấu hình frontend
│   └── package.json          # Dependencies & Scripts độc lập của frontend
├── firmware/                 # Firmware ESP32-S3 (Arduino IDE)
├── docs/                     # Tài liệu hướng dẫn kỹ thuật & Deploy
├── .env.example              # File mẫu biến môi trường gốc
├── render.yaml               # File cấu hình tự động deploy lên Render
└── package.json              # Quản lý chạy đồng thời toàn bộ dự án
```

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Ứng Dụng (Quick Start)

### 1. Cài đặt các gói phụ thuộc
Tại thư mục gốc dự án:
```powershell
npm install
```

### 2. Cấu hình biến môi trường
File `.env` mẫu đã được cấu hình sẵn tại gốc dự án (`.env.example` và `.env`):
```env
# Database Aiven PostgreSQL (Bắt buộc có ?sslmode=require)
DATABASE_URL="postgresql://avnadmin:YOUR_PASSWORD@pg-cluster.aivencloud.com:12345/defaultdb?sslmode=require"

# EMQX MQTT Broker (Dùng broker test công cộng hoặc EMQX Cloud TLS)
MQTT_BROKER_URL="mqtt://broker.emqx.io:1883"
MQTT_USERNAME=""
MQTT_PASSWORD=""
DEMO_MODE=false
```

### 3. Kiểm tra kết nối hạ tầng (Aiven & EMQX)
Chạy lệnh chẩn đoán tự động:
```powershell
npm run test:conn
```

### 4. Khởi tạo cấu trúc bảng trên Aiven Database
```powershell
npm run db:push
npm run db:seed
```

### 5. Khởi động hệ thống phát triển

**Cách 1: Khởi động cả Frontend & Backend đồng thời từ thư mục gốc:**
```powershell
npm run dev
```

**Cách 2: Khởi động độc lập từng phần:**
- Chạy Backend: `cd backend && npm run dev` (hoặc `npm run dev:backend`)
- Chạy Frontend: `cd frontend && npm run dev` (hoặc `npm run dev:frontend`)

- **Web Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Backend API & Socket.IO:** [http://localhost:5000](http://localhost:5000)
- **Health Check & Diagnostics:** [http://localhost:5000/health](http://localhost:5000/health)

---

## 🛠️ Tài Liệu Kỹ Thuật

- **Theo dõi, cảnh báo và ước tính lượng mưa:** [Hướng dẫn cấu hình và kiểm định mô hình](docs/ai/rain-monitor.md).

1. **Hướng dẫn Deploy lên Render:** Xem chi tiết tại [docs/DEPLOY_TO_RENDER.md](docs/DEPLOY_TO_RENDER.md).
2. **Hướng dẫn kết nối EMQX & Aiven:** Xem chi tiết tại [docs/EMQX_AIVEN_GUIDE.md](docs/EMQX_AIVEN_GUIDE.md).
3. **Sơ đồ đấu nối & Mã nguồn ESP32-S3:** Xem chi tiết tại [docs/ESP32_FIRMWARE_GUIDE.md](docs/ESP32_FIRMWARE_GUIDE.md).
4. **Quy chuẩn Bản tin MQTT (Topic & JSON):** Xem chi tiết tại [docs/MQTT_SPECIFICATION.md](docs/MQTT_SPECIFICATION.md).

---

## 📄 Bản Quyền
Dự án được phân phối dưới giấy phép MIT License.
