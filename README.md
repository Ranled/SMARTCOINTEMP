# SmartCoin Group 4 - Coin Counter & Web Vault Monitor

A minimalist monochrome hardware telemetry web app and ESP32 firmware for an automated coin counter (₱1, ₱5, ₱10, ₱20) powered by Supabase Realtime.

---

## 📁 Project Structure

- `index.html` — Clean monochrome dashboard UI for real-time monitoring and withdrawal operations.
- `style.css` — High-contrast monochrome / brutalist design system.
- `app.js` — Supabase Realtime subscription, live container updates, and audit logging.
- `config.js` — Supabase URL & public anon key configuration file.
- `supabase_schema.sql` — SQL migration file for your Supabase tables (`coin_container` & `coin_logs`).
- `esp32_coin_counter.ino` — Updated ESP32 Arduino sketch with WiFi and Supabase REST integration.

---

## 🚀 Quick Setup Guide

### 1. Supabase Setup
1. Go to [Supabase](https://supabase.com) and create a free project.
2. Navigate to **SQL Editor** in your Supabase dashboard.
3. Open [`supabase_schema.sql`](./supabase_schema.sql), paste the content into the SQL Editor, and click **Run**.
4. Go to **Project Settings** -> **API** to copy:
   - **Project URL** (e.g. `https://xxxxxx.supabase.co`)
   - **anon / public key**

### 2. Run the Web Dashboard
You can open `index.html` directly in any web browser or serve it locally (e.g. VS Code Live Server or python http server):
```bash
python -m http.server 3000
```
- Click **CONFIG API** in the top right to paste your Supabase URL & Anon Key (it saves directly to your browser's LocalStorage).

### 3. Upload ESP32 Code
1. Open [`esp32_coin_counter.ino`](./esp32_coin_counter.ino) in Arduino IDE.
2. In lines 10-15, fill in:
   - `WIFI_SSID` & `WIFI_PASSWORD`
   - `SUPABASE_URL` & `SUPABASE_KEY`
3. Upload to your ESP32 board.

---

## ✨ Features
- **Live Telemetry**: Real-time counter of ₱1, ₱5, ₱10, and ₱20 coins inside the machine.
- **Micro-Animations**: Clean monochrome flashing pulse whenever a coin drops.
- **Withdrawal Reset**: Clicking **Withdraw All Coins** in the web app resets the active machine count to ₱0 on both the dashboard and the ESP32 LCD while creating a permanent audit record in the transaction logs.
- **Permanent Audit Trail**: Filterable transaction log table with snapshots of all coin denominations at each event.
