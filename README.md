# SmartCoin Group 4 - Piso WiFi Portal & Live Vault Telemetry System

A complete hardware telemetry and customer portal ecosystem for an automated Philippine Peso coin counter (₱1, ₱5, ₱10, ₱20) powered by an ESP32 microcontroller, Supabase Realtime, and a captive portal frontend.

---

## 🏗️ System Architecture & Data Flow

```text
  [ User Drops Coin into Electronic Coin Slot ]
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ ESP32 Microcontroller                                       │
│  - Signal Pin: GPIO 27 (Falling edge interrupt)             │
│  - Pulse Count Evaluation (1 pulse = ₱1, 5 = ₱5, etc.)      │
│  - 16x2 LCD Displays: "COIN INSERTED: X PESO COIN"          │
│  - Returns after 1.5s to: "SMARTCOIN / Insert your coin"    │
└──────────────────────────────┬──────────────────────────────┘
                               │ FreeRTOS Queue (Core 0 Background)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Cloud Database (Supabase)                                   │
│  - Updates: coin_container (Live counters & total)          │
│  - Inserts: coin_logs (Permanent DEPOSIT audit trail)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ Realtime WebSocket Broadcast
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Web Application                                             │
│                                                             │
│  1. index.html (Piso WiFi Customer Portal)                  │
│     - Realtime coin detection (Plays arcade chime)          │
│     - 60s coin slot countdown timer                         │
│     - Adds connection time (₱1=5m, ₱5=30m, ₱10=1h, ₱20=3h)  │
│     - Status switches to CONNECTED                          │
│     - Top "ADMIN" button (PIN: 1234)                        │
│                                                             │
│  2. admin.html (Admin Vault Monitor)                        │
│     - Live Vault Balance (Total ₱ and Coins count)          │
│     - Denomination breakdown (₱1, ₱5, ₱10, ₱20)             │
│     - Transaction history & permanent logs                  │
│     - [RESET STATUS / CASH COLLECTED] Button                │
│       (Zeros out machine counters and logs collection)      │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚡ Hardware Wiring & Pinout Guide

### 1. Electronic Coin Slot (Allan 1240A / Universal Coin Acceptor)
The coin selector requires **12V DC power** and outputs pulses on the **White signal wire**.

| Coin Slot Wire | Connect To | Description / Voltage |
| :--- | :--- | :--- |
| **RED Wire** | **+12V DC** | External 12V DC Power Supply (+) |
| **BLACK Wire** | **GND (Common Ground)** | Connect to 12V Supply (-) **AND** ESP32 GND pin |
| **WHITE Wire** | **ESP32 `GPIO 27`** | Coin pulse signal (via 1N4148 Diode protection) |
| **GRAY / BLUE** | *Leave Disconnected* | Mechanical counter (not needed) |

#### ⚠️ CRITICAL VOLTAGE PROTECTION FOR WHITE WIRE:
Most coin selectors share internal 12V. **Never connect raw 12V directly to an ESP32 GPIO** (ESP32 is 3.3V max). Use either:
1. **1N4148 Diode (Recommended)**:
   - Connect the diode between the Coin Slot White wire and ESP32 GPIO 27:
     - **Cathode (striped line side of diode)** ➔ Coin Slot White Wire
     - **Anode (other side)** ➔ ESP32 GPIO 27
   - When the coin slot pulses LOW, the diode pulls GPIO 27 LOW safely. When HIGH, no 12V can enter the ESP32!
2. **Voltage Divider**: 10kΩ from White wire to GPIO 27, and 4.7kΩ from GPIO 27 to GND.

#### ⚙️ Coin Slot Switch Settings (On the Coin Slot Body):
- **NO / NC Switch**: Set to **`NO` (Normally Open)**.
- **SPEED Switch**: Set to **`FAST`** (20ms) or **`MEDIUM`** (40ms).

---

### 2. 16x2 I2C LCD Display (HD44780 + PCF8574 Backpack)

| LCD Pin | ESP32 Pin | Description |
| :--- | :--- | :--- |
| **VCC** | **VIN / 5V** | 5V Power for LCD & backlight |
| **GND** | **GND** | Ground (shared common ground) |
| **SDA** | **`GPIO 21`** | I2C Serial Data line |
| **SCL** | **`GPIO 22`** | I2C Serial Clock line |

---

### 3. 16x2 LCD Screen Behavior
- **Idle Screen** (Does NOT show total money inside):
  ```text
     SMARTCOIN
  Insert your coin
  ```
- **When a coin is inserted**:
  ```text
  COIN INSERTED:
    1 PESO COIN   (or 5 PESOS / 10 PESOS / 20 PESOS)
  ```
  *(Displays for 1.5 seconds, then returns to the idle screen)*

---

## 🚀 Quick Setup Guide

1. Open [`esp32_coin_counter/esp32_coin_counter.ino`](./esp32_coin_counter/esp32_coin_counter.ino) in Arduino IDE.
2. Ensure libraries are installed:
   - `ArduinoJson`
   - `LiquidCrystal_I2C` by Frank de Brabander
3. Select **ESP32 Dev Module** and upload.
4. Double-click [`index.html`](./index.html) to open the Piso WiFi portal.
