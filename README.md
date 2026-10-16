# SmartCoin Group 4 - Automated Coin Counter & Dispenser Vault Monitor

A modern enterprise hardware telemetry web dashboard and ESP32 firmware for an automated Philippine Peso coin counter (₱1, ₱5, ₱10, ₱20) and an automated 4-Servo Coin Dispenser Mechanism powered by Supabase Realtime.

---

## 🏗️ System Architecture

```text
[ Web Dashboard Hub ]
         │  Click "DISPENSE ₱1 / ₱5 / ₱10 / ₱20"
         ▼
[ Supabase (withdraw_commands table) ]
   (Status: 'pending' -> 'running' -> 'completed')
         ▲
         │  Asynchronous Poll (every 1.5s) & Realtime Telemetry
         ▼
[ ESP32 Microcontroller ]
   (Non-Blocking millis() State Machine: 0° -> 180° -> 0°)
         │
         ├───▶ [Servo 1 (GPIO 18)]: ₱1 Dispenser Tube (Rotates 180° -> returns 0°)
         │
         ├───▶ [Servo 2 (GPIO 19)]: ₱5 Dispenser Tube (Rotates 180° -> returns 0°)
         │
         ├───▶ [Servo 3 (GPIO 23)]: ₱10 Dispenser Tube (Rotates 180° -> returns 0°)
         │
         └───▶ [Servo 4 (GPIO 13)]: ₱20 Dispenser Tube (Rotates 180° -> returns 0°)
```

> **Design Choice**: Supabase acts as the asynchronous command pipeline and real-time state ledger. The ESP32 executes physical servo dispensing using a non-blocking `millis()` finite state machine (`ROTATE_180 ➔ HOLD_AT_180 ➔ RETURN_TO_0 ➔ COMPLETE_DISPENSE`). The high-speed optical IR deposit sensors remain zero-latency and will never miss a deposited coin even while a servo is rotating.

---

## 📁 Project Structure

- `index.html` — Enterprise dashboard UI featuring the live vault monitor, denomination breakdown, and the **Automated Coin Dispenser Hub** (₱1, ₱5, ₱10, ₱20 actuation cards).
- `style.css` — Modern enterprise design system with real-time hardware status indicators, servo angle telemetry, and responsive mobile layouts.
- `app.js` — Supabase Realtime client managing live coin counting, selective withdrawals, receipts, and the `withdraw_commands` pipeline.
- `config.js` — Supabase URL & public anon key configuration file.
- `supabase_schema.sql` — SQL migration file defining `coin_container`, `coin_logs`, `withdraw_commands`, RLS policies, and realtime publications.
- `esp32_coin_counter.ino` (and `esp32_coin_counter/esp32_coin_counter.ino`) — Production-ready ESP32 Arduino firmware integrating 4x optical IR coin sensors, 16x2 I2C LCD, and 4x SG90/MG90S positional servos for automated coin dispensing.

---

## ⚡ Hardware Wiring & Pinout

### 1. IR Optical Coin Sensors (Deposits)
| Sensor Pin | ESP32 GPIO | Description |
| :--- | :--- | :--- |
| **₱1 IR Sensor** | `GPIO 27` | Optical beam detector for ₱1 coins |
| **₱5 IR Sensor** | `GPIO 26` | Optical beam detector for ₱5 coins |
| **₱10 IR Sensor** | `GPIO 25` | Optical beam detector for ₱10 coins |
| **₱20 IR Sensor** | `GPIO 33` | Optical beam detector for ₱20 coins |

### 2. 4x SG90 / MG90S Positional Servos (Withdrawal Dispensers)
| Servo | ESP32 Pin | Function | Dispense Action |
| :--- | :--- | :--- | :--- |
| **₱1 Dispenser Servo** | `GPIO 18` | Sweeps bottom coin out of ₱1 tube | `0° ➔ 180° ➔ 0°` |
| **₱5 Dispenser Servo** | `GPIO 19` | Sweeps bottom coin out of ₱5 tube | `0° ➔ 180° ➔ 0°` |
| **₱10 Dispenser Servo** | `GPIO 23` | Sweeps bottom coin out of ₱10 tube | `0° ➔ 180° ➔ 0°` |
| **₱20 Dispenser Servo** | `GPIO 13` | Sweeps bottom coin out of ₱20 tube | `0° ➔ 180° ➔ 0°` |
| **All Servo VCC** | **External 5V** | Regulated 5V (2A+ rated power supply) | Power supply (+) |
| **All Servo GND** | **Common GND** | Connect supply GND to ESP32 GND | Common Ground (-) |

### 3. 16x2 I2C LCD Display
| LCD Pin | ESP32 Pin | Description |
| :--- | :--- | :--- |
| **SDA** | `GPIO 21` | I2C Data line |
| **SCL** | `GPIO 22` | I2C Clock line |
| **VCC** | `5V` (or VIN) | LCD Power |
| **GND** | `GND` | Ground |

> ⚠️ **CRITICAL POWER NOTE**: Do **NOT** power the SG90/MG90S servos from the ESP32's 3.3V or 5V VIN pins. Simultaneous servo movement or stall current can exceed 1.5A–2.0A, causing severe brownouts and ESP32 reboot loops. Always use an external regulated 5V power adapter (2A to 3A) and tie its ground to the ESP32 ground (**Common Ground**).

---

## 🚀 Quick Setup Guide

### 1. Supabase Database Setup
1. Log in to [Supabase](https://supabase.com) and open your project.
2. Navigate to the **SQL Editor**.
3. Copy all contents of [`supabase_schema.sql`](./supabase_schema.sql), paste into the SQL Editor, and click **Run**.
   - This drops the old `refill_commands` table if it exists and creates `withdraw_commands`.
   - Initializes `coin_container` with default ₱1, ₱5, ₱10, ₱20 rows.
   - Sets up an automatic timestamp trigger for `started_at` and `completed_at`.
   - Enables Row Level Security (RLS) and adds tables to the `supabase_realtime` publication.

### 2. Required Arduino IDE Libraries
Install the following via the Arduino IDE Library Manager (`Ctrl + Shift + I`):
- `ESP32Servo` by Kevin Harrington
- `ArduinoJson` (v6 or v7)
- `LiquidCrystal_I2C` by Frank de Brabander

### 3. Flash ESP32 Firmware
1. Open [`esp32_coin_counter.ino`](./esp32_coin_counter.ino) (or [`esp32_coin_counter/esp32_coin_counter.ino`](./esp32_coin_counter/esp32_coin_counter.ino)) in Arduino IDE.
2. Verify Wi-Fi and Supabase credentials in Section 1:
   ```cpp
   const char *WIFI_SSID = "YOUR_WIFI_SSID";
   const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   const char *SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
   const char *SUPABASE_KEY = "YOUR_ANON_PUBLIC_KEY";
   ```
3. Connect your ESP32 board and upload at `115200` baud.

### 4. Run the Web Dashboard
Open `index.html` directly in your browser, or start a local HTTP server:
```bash
python -m http.server 3000
```
- Open `http://localhost:3000`
- Click **API CONFIG** in the top navigation if you need to update your Supabase URL & Anon Key.
- Test dispensing coins by clicking any of the **"DISPENSE ₱X"** buttons in the Automated Dispenser Hub.

---

## 🛠️ Calibration & Mechanical Tuning

In [`esp32_coin_counter.ino`](./esp32_coin_counter.ino), you can adjust angles and timings to match your physical 3D-printed coin chute or sliding pusher mechanism:

```cpp
// Servo Angle Positions (degrees)
const int SERVO_HOME = 0;        // 0°: Hold/Load position (bottom coin drops into slot)
const int SERVO_DISPENSE = 180;  // 180°: Dispense position (coin drops into tray)

// Mechanical sequence timing (in milliseconds)
const unsigned long WITHDRAW_POLL_INTERVAL_MS = 1500; // Poll Supabase every 1.5s
const unsigned long SERVO_TRAVEL_MS = 400;           // Time to sweep 0° -> 180°
const unsigned long SERVO_HOLD_MS = 350;             // Time to hold at 180° for gravity drop
const unsigned long SERVO_RETURN_MS = 400;           // Time to return 180° -> 0°
```

---

## 🔒 Security & Best Practices
- **Row Level Security**: The schema enables RLS for all tables. For production deployments with sensitive access, restrict the `insert` policy on `withdraw_commands` or route requests through Supabase Edge Functions with authenticated tokens.
- **Fail-Safe Operation**: If the network connection drops mid-sequence, the ESP32 safely finishes returning the physical servo to its home `0°` position locally before attempting reconnection.
