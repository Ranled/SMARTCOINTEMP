#include <Arduino.h>
#include <HTTPClient.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_timer.h>

// ========================================================
// 1. WIFI & SUPABASE CONFIGURATION
// ========================================================
const char *WIFI_SSID = "FTTx-4a6210";
const char *WIFI_PASSWORD = "10008636";

// Supabase REST Endpoint & API Key (Aligned with config.js)
const char *SUPABASE_URL = "https://zqkyqlgctnnezllvztfb.supabase.co";
const char *SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpxa3lxbGdjdG5uZXpsbHZ6dGZiIiwicm9sZSI6Im"
    "Fub24iLCJpYXQiOjE3ODkzNzczODIsImV4cCI6MjEwNDk1MzM4Mn0."
    "8udhomlBQZc0zDBUTHvAZBEcVMOMHZS3J5XqLYlf5C0";

// ========================================================
// 2. HARDWARE PIN DEFINITIONS (COIN SLOT & 16x2 LCD)
// ========================================================
// Electronic Coin Slot Signal Pin (White Wire -> GPIO 27, Black Wire -> ESP32 GND)
#define COIN_SLOT_PIN 27

// 16x2 I2C LCD Display (SDA: GPIO 21, SCL: GPIO 22)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ========================================================
// 3. COIN COUNTERS, SNAPSHOT QUEUE & PULSE STATE
// ========================================================
volatile int count1 = 0;
volatile int count5 = 0;
volatile int count10 = 0;
volatile int count20 = 0;
volatile int totalPesos = 0;

// High-precision microsecond pulse capture from Electronic Coin Slot
volatile int pulseCount = 0;
volatile int64_t lastPulseTimeUs = 0;

// Minimum 25ms (25,000 us) between falling edges rejects solenoid/contact bounce
const int64_t PULSE_DEBOUNCE_US = 25000;
// 200ms (200,000 us) silence after last pulse marks end of coin pulse train
const int64_t COIN_PULSE_TIMEOUT_US = 200000;

// Decoder mode selection
enum DecoderMode {
  MODE_VALUE,    // Value Mode (Default): 1p=P1, 5p=P5, 10p=P10, 20p=P20
  MODE_CHANNEL,  // Channel Mode: 1p=P1, 2p=P5, 3p=P10, 4p=P20
  MODE_AUTO      // Auto-detects both Channel (1,2,3,4) and Value (1,5,10,20)
};
DecoderMode currentDecoderMode = MODE_AUTO;

// Atomic snapshot sent from Core 1 -> Core 0 so rapid coins never overwrite each other
struct CoinEvent {
  int denomination;
  int minutes;
  int c1;
  int c5;
  int c10;
  int c20;
  int total;
};

QueueHandle_t coinQueue;
TaskHandle_t cloudTaskHandle = NULL;
portMUX_TYPE counterMux = portMUX_INITIALIZER_UNLOCKED;

// ========================================================
// 4. TIMERS & LCD DISPLAY STATE (CORE 1 ONLY)
// ========================================================
unsigned long detectedTime = 0;
bool showingDetectedCoin = false;
const unsigned long detectedDisplayTime = 2000; // Show inserted coin & time for 2.0s

// Cross-core flag when web admin resets the vault (drawn safely by Core 1)
volatile bool vaultResetNoticePending = false;
unsigned long lastCoinUploadMs = 0;

// Periodic sync timer with Supabase (checks if web admin reset or withdrew from vault)
unsigned long lastSyncTime = 0;
const unsigned long syncInterval = 4000; // Check every 4 seconds when idle

// Non-blocking Serial command buffer
char serialBuf[64];
uint8_t serialIdx = 0;

// ========================================================
// 5. FUNCTION DECLARATIONS
// ========================================================
void IRAM_ATTR coinPulseISR();
void processCoinPulses();
int mapPulsesToDenomination(int pulses);
int getMinutesForDenomination(int denom);
void lcdWriteLines(const char *line0, const char *line1);
void coinDetected(int denomination, int minutes);
void showIdleScreen();
void pushCoinToSupabase(WiFiClientSecure &client, const CoinEvent &ev);
void syncWithSupabase(WiFiClientSecure &client, bool onBoot = false);
void connectWiFiInitial();
void cloudSyncTask(void *pvParameters);
void checkSerialCommands();
void handleSerialCommand(String input);

// ========================================================
// 6. INTERRUPT SERVICE ROUTINE (FAST MICROSECOND CAPTURE)
// ========================================================
void IRAM_ATTR coinPulseISR() {
  int64_t nowUs = esp_timer_get_time();
  if (nowUs - lastPulseTimeUs >= PULSE_DEBOUNCE_US) {
    pulseCount++;
    lastPulseTimeUs = nowUs;
  }
}

// ========================================================
// 7. SETUP
// ========================================================
void setup() {
  Serial.begin(115200);

  // Create FreeRTOS queue holding up to 50 atomic CoinEvent snapshots
  coinQueue = xQueueCreate(50, sizeof(CoinEvent));

  // Configure Coin Slot interrupt pin with internal pullup
  pinMode(COIN_SLOT_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(COIN_SLOT_PIN), coinPulseISR, FALLING);

  // Initialize 16x2 LCD via I2C (SDA: 21, SCL: 22) at 400kHz Fast Mode
  Wire.begin(21, 22, 400000);
  lcd.init();
  lcd.backlight();
  lcdWriteLines("   SMARTCOIN    ", "CONNECTING WIFI ");

  Serial.println("\n=======================================================");
  Serial.println(" SMARTCOIN GROUP 4 - FAST ESP32 COIN SLOT & WEB SYNC   ");
  Serial.println("=======================================================");
  Serial.printf("[Coin Slot] Pin: GPIO %d (FALLING, 25ms debounce, 200ms timeout)\n", COIN_SLOT_PIN);

  // Verify idle state of Coin Slot signal line
  int idleState = digitalRead(COIN_SLOT_PIN);
  Serial.printf("[Coin Slot] Idle State: %s (%d)\n",
                (idleState == HIGH) ? "HIGH / 3.3V (OK - Normally Open)" : "LOW / 0V (CHECK: Switch on NC or GND missing!)",
                idleState);

  if (idleState == LOW) {
    Serial.println("[!] WARNING: GPIO 27 is LOW at idle! Set coin slot switch to 'NO' (Normally Open).");
    lcdWriteLines("CHECK COINSLOT! ", "SET SWITCH: NO  ");
    delay(2000);
  }

  // Initial WiFi connection (auto-reconnect enabled in background afterwards)
  connectWiFiInitial();

  lcdWriteLines("   SMARTCOIN    ", "SYNCING VAULT...");

  // Initial cloud sync on boot
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure bootClient;
    bootClient.setInsecure();
    bootClient.setTimeout(3000);
    syncWithSupabase(bootClient, true);
  }

  // Clear any stray boot pulses before starting main loop
  noInterrupts();
  pulseCount = 0;
  interrupts();

  // Spawn background FreeRTOS task on Core 0 for non-blocking WiFi & Supabase sync
  xTaskCreatePinnedToCore(
      cloudSyncTask,    // Task function
      "CloudSyncTask",  // Name of task
      8192,             // Stack size
      NULL,             // Parameter
      1,                // Priority
      &cloudTaskHandle, // Task handle
      0                 // Core 0 (Core 1 stays 100% dedicated to Coin Slot & LCD)
  );

  showIdleScreen();
}

// ========================================================
// 8. MAIN LOOP (CORE 1 - ZERO BLOCKING, INSTANT RESPONSE)
// ========================================================
void loop() {
  // 1. Non-blocking Serial diagnostic commands
  checkSerialCommands();

  // 2. Immediately evaluate coin pulses & update LCD
  processCoinPulses();

  // 3. Display vault reset notice if triggered from Admin Web Dashboard
  if (vaultResetNoticePending) {
    vaultResetNoticePending = false;
    lcdWriteLines("   SMARTCOIN    ", " VAULT RESET: 0 ");
    showingDetectedCoin = true;
    detectedTime = millis();
  }

  // 4. Return to idle screen after coin popup timer expires
  if (showingDetectedCoin && (millis() - detectedTime >= detectedDisplayTime)) {
    showingDetectedCoin = false;
    showIdleScreen();
  }
}

// ========================================================
// 9. PULSE DECODER & WIFI TIME MAPPER (ALIGNED WITH WEB)
// ========================================================
int mapPulsesToDenomination(int pulses) {
  if (pulses <= 0) return 0;

  if (currentDecoderMode == MODE_VALUE) {
    if (pulses == 1) return 1;
    if (pulses >= 4 && pulses <= 7) return 5;
    if (pulses >= 8 && pulses <= 14) return 10;
    if (pulses >= 15 && pulses <= 25) return 20;
    return 0;
  }

  if (currentDecoderMode == MODE_CHANNEL) {
    if (pulses == 1) return 1;
    if (pulses == 2) return 5;
    if (pulses == 3) return 10;
    if (pulses == 4) return 20;
    return 0;
  }

  // MODE_AUTO: Supports 1p=P1, Channel (2p=P5, 3p=P10, 4p=P20), and Value (5p=P5, 10p=P10, 20p=P20)
  if (pulses == 1) return 1;
  if (pulses == 2) return 5;
  if (pulses == 3) return 10;
  if (pulses == 4) return 20;
  if (pulses >= 5 && pulses <= 7) return 5;
  if (pulses >= 8 && pulses <= 14) return 10;
  if (pulses >= 15 && pulses <= 25) return 20;

  return 0;
}

// Matches portal-config rates in index.html: P1=5m, P5=30m, P10=60m (1hr), P20=180m (3hrs)
int getMinutesForDenomination(int denom) {
  switch (denom) {
    case 1:  return 5;
    case 5:  return 30;
    case 10: return 60;
    case 20: return 180;
    default: return denom * 5;
  }
}

// ========================================================
// 10. COIN PULSE EVALUATION & DISPATCH
// ========================================================
void processCoinPulses() {
  if (pulseCount == 0) return;

  int64_t nowUs = esp_timer_get_time();
  if (nowUs - lastPulseTimeUs >= COIN_PULSE_TIMEOUT_US) {
    // Atomically grab and reset pulse counter
    noInterrupts();
    int pulses = pulseCount;
    pulseCount = 0;
    interrupts();

    int denom = mapPulsesToDenomination(pulses);
    if (denom == 0) {
      Serial.printf("[Noise Rejected] Ignored unrecognized pulse count: %d\n", pulses);
      return;
    }

    int mins = getMinutesForDenomination(denom);

    // Update counters and build atomic snapshot for Supabase
    CoinEvent ev;
    portENTER_CRITICAL(&counterMux);
    if (denom == 1)       count1++;
    else if (denom == 5)  count5++;
    else if (denom == 10) count10++;
    else if (denom == 20) count20++;
    totalPesos += denom;

    ev.denomination = denom;
    ev.minutes = mins;
    ev.c1 = count1;
    ev.c5 = count5;
    ev.c10 = count10;
    ev.c20 = count20;
    ev.total = totalPesos;
    portEXIT_CRITICAL(&counterMux);

    // 1. Update 16x2 LCD immediately (shows PISO ENTERED + time)
    coinDetected(denom, mins);

    // 2. Enqueue for instant background upload to Supabase on Core 0
    xQueueSend(coinQueue, &ev, 0);

    Serial.println("\n-------------------------------------------------------");
    Serial.printf(">>> [COIN ENTERED] Pulses: %d ==> P%d (+%d MINS) <<<\n", pulses, denom, mins);
    Serial.printf("Vault: P%d | P1:[%d] P5:[%d] P10:[%d] P20:[%d]\n",
                  ev.total, ev.c1, ev.c5, ev.c10, ev.c20);
    Serial.println("-------------------------------------------------------");
  }
}

// ========================================================
// 11. FAST ZERO-FLICKER LCD DISPLAY HANDLERS (CORE 1 ONLY)
// ========================================================
void lcdWriteLines(const char *line0, const char *line1) {
  char buf0[17];
  char buf1[17];
  snprintf(buf0, sizeof(buf0), "%-16.16s", line0);
  snprintf(buf1, sizeof(buf1), "%-16.16s", line1);

  lcd.setCursor(0, 0);
  lcd.print(buf0);
  lcd.setCursor(0, 1);
  lcd.print(buf1);
}

void showIdleScreen() {
  lcdWriteLines("   SMARTCOIN    ", "Insert your coin");
}

void coinDetected(int denomination, int minutes) {
  showingDetectedCoin = true;
  detectedTime = millis();

  char row0[17];
  char row1[17];

  if (denomination == 1) {
    snprintf(row0, sizeof(row0), "1 PISO ENTERED! ");
    snprintf(row1, sizeof(row1), "TIME: +5 MINS   ");
  } else if (denomination == 5) {
    snprintf(row0, sizeof(row0), "5 PESO ENTERED! ");
    snprintf(row1, sizeof(row1), "TIME: +30 MINS  ");
  } else if (denomination == 10) {
    snprintf(row0, sizeof(row0), "10 PESO ENTERED!");
    snprintf(row1, sizeof(row1), "TIME: +1 HOUR   ");
  } else if (denomination == 20) {
    snprintf(row0, sizeof(row0), "20 PESO ENTERED!");
    snprintf(row1, sizeof(row1), "TIME: +3 HOURS  ");
  } else {
    snprintf(row0, sizeof(row0), "P%d ENTERED!", denomination);
    snprintf(row1, sizeof(row1), "TIME: +%d MINS", minutes);
  }

  lcdWriteLines(row0, row1);
}

// ========================================================
// 12. ASYNCHRONOUS FREE-RTOS CLOUD SYNC TASK (CORE 0)
// ========================================================
void cloudSyncTask(void *pvParameters) {
  CoinEvent ev;
  WiFiClientSecure client;
  client.setInsecure(); // Fast HTTPS without CA bundle overhead
  client.setTimeout(3000);

  bool wasConnected = (WiFi.status() == WL_CONNECTED);
  unsigned long lastWifiCheck = millis();
  Serial.println("[CloudSyncTask] Core 0 Background Network Task Active");

  for (;;) {
    bool isConnected = (WiFi.status() == WL_CONNECTED);

    // Detect background WiFi connection recovery
    if (isConnected && !wasConnected) {
      wasConnected = true;
      Serial.println("\n[WiFi] Connected in background! IP: " + WiFi.localIP().toString());
      syncWithSupabase(client, true);
    } else if (!isConnected && wasConnected) {
      wasConnected = false;
      Serial.println("[WiFi] Connection lost. Waiting for auto-reconnect...");
      lastWifiCheck = millis();
    }

    // 1. Non-blocking background WiFi retry (only every 20s so we never abort an active handshake)
    if (!isConnected) {
      unsigned long now = millis();
      if (now - lastWifiCheck >= 20000) {
        lastWifiCheck = now;
        Serial.printf("[WiFi] Retrying connection to '%s'...\n", WIFI_SSID);
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }

    // 2. Process queued coin deposits immediately (waits up to 250ms)
    if (xQueueReceive(coinQueue, &ev, pdMS_TO_TICKS(250)) == pdTRUE) {
      pushCoinToSupabase(client, ev);
      lastCoinUploadMs = millis();
      lastSyncTime = millis();
      continue; // Immediately drain any additional coins in the queue
    }

    // 3. Periodic cloud sync (only when queue is empty and no recent upload in last 3s)
    unsigned long now = millis();
    if (uxQueueMessagesWaiting(coinQueue) == 0 &&
        (now - lastCoinUploadMs >= 3000) &&
        (now - lastSyncTime >= syncInterval)) {
      lastSyncTime = now;
      syncWithSupabase(client, false);
    }
  }
}

// ========================================================
// 13. SUPABASE CLOUD SYNC (INSTANT WEB PORTAL + VAULT SYNC)
// ========================================================
void pushCoinToSupabase(WiFiClientSecure &client, const CoinEvent &ev) {
  HTTPClient http;
  http.setReuse(true); // Keep TLS connection warm between POST and PATCH

  char payload[256];

  // STEP 1: INSERT into coin_logs FIRST so the Customer PisoWiFi Web Portal
  // (assets/app.js -> 'portal-coin-listener') receives the coin & time immediately!
  String urlLogs = String(SUPABASE_URL) + "/rest/v1/coin_logs";
  http.begin(client, urlLogs);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  snprintf(payload, sizeof(payload),
           "{\"event_type\":\"DEPOSIT\",\"denomination\":%d,\"amount\":%d,"
           "\"count_1\":%d,\"count_5\":%d,\"count_10\":%d,\"count_20\":%d,"
           "\"total_pesos\":%d,\"notes\":\"P%d coin (+%d mins) inserted at coin slot\"}",
           ev.denomination, ev.denomination,
           ev.c1, ev.c5, ev.c10, ev.c20,
           ev.total, ev.denomination, ev.minutes);

  int postCode = http.POST((uint8_t *)payload, strlen(payload));
  if (postCode == 200 || postCode == 201 || postCode == 204) {
    Serial.printf("[Supabase] Web Portal notified: +P%d (+%d mins) (HTTP %d)\n",
                  ev.denomination, ev.minutes, postCode);
  } else {
    Serial.printf("[Supabase] Log insert failed: %s (HTTP %d)\n",
                  http.errorToString(postCode).c_str(), postCode);
  }
  http.end();

  // STEP 2: UPDATE coin_container for the Admin Vault Monitor
  String urlContainer = String(SUPABASE_URL) + "/rest/v1/coin_container?id=eq.1";
  http.begin(client, urlContainer);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  snprintf(payload, sizeof(payload),
           "{\"count_1\":%d,\"count_5\":%d,\"count_10\":%d,\"count_20\":%d,"
           "\"total_pesos\":%d,\"last_action\":\"DEPOSIT_P%d\",\"updated_at\":\"now()\"}",
           ev.c1, ev.c5, ev.c10, ev.c20, ev.total, ev.denomination);

  int patchCode = http.sendRequest("PATCH", (uint8_t *)payload, strlen(payload));
  if (patchCode == 200 || patchCode == 204) {
    Serial.printf("[Supabase] Vault container synced: Total P%d (HTTP %d)\n", ev.total, patchCode);
  } else {
    Serial.printf("[Supabase] Container update failed: %s (HTTP %d)\n",
                  http.errorToString(patchCode).c_str(), patchCode);
  }
  http.end();
}

// Helper to extract integer value from JSON string
int extractJsonInt(const String &json, const char *key) {
  String pattern = String("\"") + key + "\":";
  int keyIndex = json.indexOf(pattern);
  if (keyIndex == -1) return -1;
  int valStart = keyIndex + pattern.length();
  while (valStart < (int)json.length() && json[valStart] == ' ') valStart++;
  int valEnd = valStart;
  while (valEnd < (int)json.length() && (isDigit(json[valEnd]) || json[valEnd] == '-')) {
    valEnd++;
  }
  return json.substring(valStart, valEnd).toInt();
}

// ========================================================
// 14. DATABASE SYNCHRONIZATION (HANDLES WEB ADMIN RESETS)
// ========================================================
void syncWithSupabase(WiFiClientSecure &client, bool onBoot) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.setReuse(true);
  String url = String(SUPABASE_URL) +
               "/rest/v1/coin_container?id=eq.1&select=count_1,count_5,count_10,count_20,total_pesos,last_action";

  http.begin(client, url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  int httpCode = http.GET();
  if (httpCode == 200) {
    String response = http.getString();

    // Abort sync if a coin was inserted while HTTP GET was in flight
    if (!onBoot && uxQueueMessagesWaiting(coinQueue) > 0) {
      http.end();
      return;
    }

    int remote1 = extractJsonInt(response, "count_1");
    int remote5 = extractJsonInt(response, "count_5");
    int remote10 = extractJsonInt(response, "count_10");
    int remote20 = extractJsonInt(response, "count_20");
    int remoteTotal = extractJsonInt(response, "total_pesos");

    if (remoteTotal != -1) {
      portENTER_CRITICAL(&counterMux);
      int prevTotal = totalPesos;
      bool valuesChanged = (remoteTotal != totalPesos || remote1 != count1 ||
                            remote5 != count5 || remote10 != count10 || remote20 != count20);

      if (valuesChanged || onBoot) {
        count1 = (remote1 >= 0) ? remote1 : 0;
        count5 = (remote5 >= 0) ? remote5 : 0;
        count10 = (remote10 >= 0) ? remote10 : 0;
        count20 = (remote20 >= 0) ? remote20 : 0;
        totalPesos = remoteTotal;
      }
      portEXIT_CRITICAL(&counterMux);

      if (valuesChanged || onBoot) {
        Serial.printf("[SYNC] Vault synced from Supabase: Total P%d | 1x[%d] 5x[%d] 10x[%d] 20x[%d]\n",
                      remoteTotal, remote1, remote5, remote10, remote20);

        // Notify Core 1 LCD only once when vault transitions from >0 to 0 via Admin Reset
        if (!onBoot && prevTotal > 0 && remoteTotal == 0 &&
            response.indexOf("VAULT_MANUALLY_EMPTIED") != -1) {
          vaultResetNoticePending = true;
        }
      }
    }
  }
  http.end();
}

// ========================================================
// 15. INITIAL WIFI CONNECTION HELPER (BOOT ONLY)
// ========================================================
void connectWiFiInitial() {
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // Improves stability with FTTx / Fiberhome routers
  WiFi.setAutoReconnect(true);

  String targetSsid = String(WIFI_SSID);

  // Quick scan to verify 2.4GHz visibility & auto-match case if needed
  Serial.println("[WiFi] Scanning 2.4GHz networks...");
  int n = WiFi.scanNetworks();
  bool foundAp = false;
  for (int i = 0; i < n; i++) {
    String scanned = WiFi.SSID(i);
    Serial.printf("  -> Found: '%s' (RSSI: %d dBm, Ch: %d)\n",
                  scanned.c_str(), WiFi.RSSI(i), WiFi.channel(i));
    if (scanned.equalsIgnoreCase(targetSsid)) {
      targetSsid = scanned; // Use exact casing broadcast by router
      foundAp = true;
    }
  }
  WiFi.scanDelete();

  if (!foundAp) {
    Serial.printf("[!] Notice: '%s' was not seen in scan (check if 2.4GHz is enabled or in range).\n", WIFI_SSID);
  }

  Serial.printf("Connecting to WiFi '%s'...", targetSsid.c_str());
  WiFi.begin(targetSsid.c_str(), WIFI_PASSWORD);

  int attempts = 0;
  // Wait up to 12 seconds (40 * 300ms) for WPA2 + DHCP lease on FTTx routers
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(300);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.printf("\n[WiFi] Not connected yet (status=%d). Background task will keep trying.\n", WiFi.status());
  }
}

// ========================================================
// 16. NON-BLOCKING SERIAL DIAGNOSTIC COMMANDS
// ========================================================
void checkSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialIdx > 0) {
        serialBuf[serialIdx] = '\0';
        serialIdx = 0;
        handleSerialCommand(String(serialBuf));
      }
    } else if (serialIdx < sizeof(serialBuf) - 1) {
      serialBuf[serialIdx++] = c;
    }
  }
}

void handleSerialCommand(String input) {
  input.trim();
  input.toUpperCase();
  if (input.length() == 0) return;

  if (input == "1" || input == "C1") {
    Serial.println("[Serial Test] Simulating P1 coin (1 pulse)...");
    noInterrupts();
    pulseCount = 1;
    lastPulseTimeUs = esp_timer_get_time() - COIN_PULSE_TIMEOUT_US;
    interrupts();
  } else if (input == "5" || input == "C5") {
    Serial.println("[Serial Test] Simulating P5 coin (5 pulses)...");
    noInterrupts();
    pulseCount = 5;
    lastPulseTimeUs = esp_timer_get_time() - COIN_PULSE_TIMEOUT_US;
    interrupts();
  } else if (input == "10" || input == "C10") {
    Serial.println("[Serial Test] Simulating P10 coin (10 pulses)...");
    noInterrupts();
    pulseCount = 10;
    lastPulseTimeUs = esp_timer_get_time() - COIN_PULSE_TIMEOUT_US;
    interrupts();
  } else if (input == "20" || input == "C20") {
    Serial.println("[Serial Test] Simulating P20 coin (20 pulses)...");
    noInterrupts();
    pulseCount = 20;
    lastPulseTimeUs = esp_timer_get_time() - COIN_PULSE_TIMEOUT_US;
    interrupts();
  } else if (input == "P" || input == "PIN") {
    int pinVal = digitalRead(COIN_SLOT_PIN);
    Serial.printf("\n[PIN CHECK] GPIO 27 = %s (%d)\n",
                  (pinVal == HIGH) ? "HIGH (3.3V - Ready / NO)" : "LOW (0V - Triggered / Check NC Switch or GND)",
                  pinVal);
  } else if (input == "MODE" || input == "M") {
    Serial.println("\n--- CURRENT DECODER MODE ---");
    if (currentDecoderMode == MODE_AUTO) Serial.println("MODE: AUTO (Accepts Channel & Value)");
    else if (currentDecoderMode == MODE_CHANNEL) Serial.println("MODE: CHANNEL (1p=P1, 2p=P5, 3p=P10, 4p=P20)");
    else if (currentDecoderMode == MODE_VALUE) Serial.println("MODE: VALUE (1p=P1, 5p=P5, 10p=P10, 20p=P20)");
    Serial.println("Commands: 'MODE AUTO', 'MODE CH', 'MODE VAL'\n");
  } else if (input == "MODE AUTO") {
    currentDecoderMode = MODE_AUTO;
    Serial.println("[Decoder] Switched to AUTO MODE");
  } else if (input == "MODE CH" || input == "MODE CHANNEL") {
    currentDecoderMode = MODE_CHANNEL;
    Serial.println("[Decoder] Switched to CHANNEL MODE (1p=P1, 2p=P5, 3p=P10, 4p=P20)");
  } else if (input == "MODE VAL" || input == "MODE VALUE") {
    currentDecoderMode = MODE_VALUE;
    Serial.println("[Decoder] Switched to VALUE MODE (1p=P1, 5p=P5, 10p=P10, 20p=P20)");
  } else if (input == "STATUS") {
    Serial.printf("\n--- SMARTCOIN STATUS ---\nTotal: P%d | P1: %d | P5: %d | P10: %d | P20: %d\nWiFi: %s | GPIO 27: %s\n\n",
                  totalPesos, count1, count5, count10, count20,
                  (WiFi.status() == WL_CONNECTED) ? "CONNECTED" : "DISCONNECTED",
                  (digitalRead(COIN_SLOT_PIN) == HIGH) ? "HIGH (Ready)" : "LOW (Active/NC)");
  } else if (input == "HELP" || input == "?") {
    Serial.println("\n--- SMARTCOIN SERIAL COMMANDS ---");
    Serial.println("1 / 5 / 10 / 20 : Instant coin simulation (tests LCD & Web sync)");
    Serial.println("P / PIN         : Check GPIO 27 state");
    Serial.println("MODE            : View/set pulse mode (MODE AUTO, MODE CH, MODE VAL)");
    Serial.println("STATUS          : Show vault counts & WiFi status");
    Serial.println("---------------------------------\n");
  }
}
