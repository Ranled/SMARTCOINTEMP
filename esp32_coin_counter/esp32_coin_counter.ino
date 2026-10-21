#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>

// ========================================================
// 1. WIFI & SUPABASE CONFIGURATION
// ========================================================
const char *WIFI_SSID = "FTTx-4a6210";
const char *WIFI_PASSWORD = "10008636";

// Supabase REST Endpoint & API Key
const char *SUPABASE_URL = "https://zqkyqlgctnnezllvztfb.supabase.co";
const char *SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpxa3lxbGdjdG5uZXpsbHZ6dGZiIiwicm9sZSI6Im"
    "Fub24iLCJpYXQiOjE3ODkzNzczODIsImV4cCI6MjEwNDk1MzM4Mn0."
    "8udhomlBQZc0zDBUTHvAZBEcVMOMHZS3J5XqLYlf5C0";

// ========================================================
// 2. HARDWARE PIN DEFINITIONS (COIN SLOT & 16x2 LCD)
// ========================================================
// Electronic Coin Slot Signal Pin (White Wire)
#define COIN_SLOT_PIN 27

// 16x2 I2C LCD Display (SDA: GPIO 21, SCL: GPIO 22)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ========================================================
// 3. COIN COUNTERS & PULSE INTERRUPT STATE
// ========================================================
int count1 = 0;
int count5 = 0;
int count10 = 0;
int count20 = 0;
int totalPesos = 0;

// Pulse train detection from Electronic Coin Slot (Allan / Universal)
volatile int pulseCount = 0;
volatile unsigned long lastPulseTime = 0;
const unsigned long COIN_PULSE_TIMEOUT_MS = 300; // 300ms silence marks end of pulse train

// FreeRTOS queue for asynchronous cloud sync (Core 1 processing -> Core 0 uploading)
QueueHandle_t coinQueue;
TaskHandle_t cloudTaskHandle = NULL;

// ========================================================
// 4. TIMERS & DISPLAY STATE
// ========================================================
unsigned long detectedTime = 0;
bool showingDetectedCoin = false;
const unsigned long detectedDisplayTime = 1500; // 1.5s popup when coin is inserted

// Periodic sync timer with Supabase (checks if web admin reset the vault to 0)
unsigned long lastSyncTime = 0;
const unsigned long syncInterval = 4000; // Check every 4 seconds

// ========================================================
// 5. FUNCTION DECLARATIONS
// ========================================================
void IRAM_ATTR coinPulseISR();
void processCoinPulses();
void coinDetected(int denomination);
void showIdleScreen();
void pushCoinToSupabase(int denomination);
void syncWithSupabase(bool onBoot = false);
void connectWiFi();
void cloudSyncTask(void *pvParameters);
void checkSerialCommands();

// ========================================================
// 6. INTERRUPT SERVICE ROUTINE (PULSE CAPTURE)
// ========================================================
// Captures falling edge pulses from the coin slot signal line
void IRAM_ATTR coinPulseISR() {
  unsigned long now = millis();
  // Software debounce noise pulses shorter than 15ms
  if (now - lastPulseTime > 15) {
    pulseCount++;
    lastPulseTime = now;
  }
}

// ========================================================
// 7. SETUP
// ========================================================
void setup() {
  Serial.begin(115200);

  // Initialize FreeRTOS Queue for fast background cloud sync
  coinQueue = xQueueCreate(50, sizeof(int));

  // Configure Coin Slot interrupt pin with internal pullup
  pinMode(COIN_SLOT_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(COIN_SLOT_PIN), coinPulseISR, FALLING);

  // Initialize 16x2 LCD via I2C (SDA: 21, SCL: 22)
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  lcd.setCursor(3, 0);
  lcd.print("SMARTCOIN");
  lcd.setCursor(0, 1);
  lcd.print("CONNECTING WIFI");

  Serial.println("\n==============================================");
  Serial.println(" SMARTCOIN GROUP 4 - COINSLOT TELEMETRY NODE  ");
  Serial.println("==============================================");
  Serial.printf("[Coin Slot] Signal Pin: GPIO %d (Interrupt attached)\n", COIN_SLOT_PIN);

  connectWiFi();

  lcd.clear();
  lcd.setCursor(3, 0);
  lcd.print("SMARTCOIN");
  lcd.setCursor(0, 1);
  lcd.print("SYNCING VAULT...");

  // Initial cloud sync: Load actual live coins & balance from Supabase
  syncWithSupabase(true);

  // Spawn asynchronous background FreeRTOS task on Core 0 for Cloud Sync
  xTaskCreatePinnedToCore(
    cloudSyncTask,    // Task function
    "CloudSyncTask",  // Name of task
    8192,             // Stack size
    NULL,             // Parameter
    1,                // Priority
    &cloudTaskHandle, // Task handle
    0                 // Core 0 (Core 1 stays 100% responsive for coin pulse counting)
  );

  // Show standard idle screen
  showIdleScreen();
}

// ========================================================
// 8. MAIN LOOP
// ========================================================
void loop() {
  // 1. Serial Monitor diagnostic commands (1, 5, 10, 20, STATUS, HELP)
  checkSerialCommands();

  // 2. Ensure WiFi auto-reconnects if dropped
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // 3. Process accumulated pulses from Coin Slot
  processCoinPulses();

  // 4. Restore idle display after detection popup expires
  if (showingDetectedCoin && (millis() - detectedTime >= detectedDisplayTime)) {
    showingDetectedCoin = false;
    showIdleScreen();
  }
}

// ========================================================
// 9. COIN PULSE EVALUATION & DENOMINATION MAPPING
// ========================================================
void processCoinPulses() {
  unsigned long now = millis();

  // If pulses were detected and no new pulse arrived within timeout -> Coin finished!
  if (pulseCount > 0 && (now - lastPulseTime >= COIN_PULSE_TIMEOUT_MS)) {
    // Atomically read and reset pulse counter
    noInterrupts();
    int pulses = pulseCount;
    pulseCount = 0;
    interrupts();

    // Map Philippine Peso pulses:
    // Standard Multi-coin selector (Allan 1240A / Universal):
    // 1 pulse = ₱1, 5 pulses = ₱5, 10 pulses = ₱10, 20 pulses = ₱20
    int denom = 0;
    if (pulses == 1) {
      denom = 1;
    } else if (pulses == 5) {
      denom = 5;
    } else if (pulses == 10) {
      denom = 10;
    } else if (pulses == 20) {
      denom = 20;
    } else {
      // Direct pulse-to-peso fallback
      denom = pulses;
    }

    if (denom == 1)       count1++;
    else if (denom == 5)  count5++;
    else if (denom == 10) count10++;
    else if (denom == 20) count20++;
    totalPesos += denom;

    Serial.printf("\n>>> [COIN ACCEPTED] %d Pulses -> ₱%d COIN! <<<\n", pulses, denom);

    // Show what coin was inserted on 16x2 LCD
    coinDetected(denom);

    // Queue for background Supabase upload on Core 0
    xQueueSend(coinQueue, &denom, 0);
  }
}

// ========================================================
// 10. LCD DISPLAY HANDLERS
// ========================================================

// Idle screen: Exactly "SMARTCOIN" and "Insert your coin" (No money totals displayed)
void showIdleScreen() {
  lcd.clear();
  lcd.setCursor(3, 0);
  lcd.print("SMARTCOIN");
  lcd.setCursor(0, 1);
  lcd.print("Insert your coin");
}

// Shows what coin was inserted inside the machine
void coinDetected(int denomination) {
  showingDetectedCoin = true;
  detectedTime = millis();

  lcd.clear();
  lcd.setCursor(1, 0);
  lcd.print("COIN INSERTED:");

  lcd.setCursor(2, 1);
  if (denomination == 1) {
    lcd.print("1 PESO COIN");
  } else if (denomination == 5) {
    lcd.print("5 PESOS COIN");
  } else if (denomination == 10) {
    lcd.print("10 PESOS COIN");
  } else if (denomination == 20) {
    lcd.print("20 PESOS COIN");
  } else {
    lcd.print(String(denomination) + " PESO COIN");
  }

  Serial.println("\n>>> [LCD NOTIFIED] <<<");
  Serial.printf("Coin: ₱%d | Vault: ₱%d | Breakdown: 1x[%d] 5x[%d] 10x[%d] 20x[%d]\n",
                denomination, totalPesos, count1, count5, count10, count20);
}

// ========================================================
// 11. ASYNCHRONOUS FREE-RTOS CLOUD SYNC TASK (Core 0)
// ========================================================
void cloudSyncTask(void *pvParameters) {
  int receivedDenom = 0;
  Serial.println("[CloudSyncTask] Core 0 Background Network Task Active");

  for (;;) {
    // 1. Process coin deposit queue (waits up to 1000ms for coin event)
    if (xQueueReceive(coinQueue, &receivedDenom, pdMS_TO_TICKS(1000)) == pdTRUE) {
      Serial.printf("[CloudSyncTask] Queue received coin: ₱%d. Uploading to Supabase...\n", receivedDenom);
      pushCoinToSupabase(receivedDenom);
    }

    // 2. Periodic cloud sync to check if web admin reset the vault to 0
    unsigned long now = millis();
    if (!showingDetectedCoin && (now - lastSyncTime >= syncInterval)) {
      lastSyncTime = now;
      syncWithSupabase(false);
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// ========================================================
// 12. SUPABASE CLOUD SYNC (DEPOSIT TO DATABASE)
// ========================================================
void pushCoinToSupabase(int denomination) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Supabase] WiFi offline. Skipping push.");
    return;
  }

  Serial.printf("[Supabase] Uploading ₱%d deposit to Supabase...\n", denomination);

  WiFiClientSecure client;
  client.setInsecure(); // Fast HTTPS without certificate verification overhead
  client.setTimeout(3500); // 3.5s timeout

  HTTPClient http;

  // Snapshot current counters
  int c1 = count1;
  int c5 = count5;
  int c10 = count10;
  int c20 = count20;
  int tot = totalPesos;

  // 1. UPDATE coin_container (Live Container Table)
  String urlContainer = String(SUPABASE_URL) + "/rest/v1/coin_container?id=eq.1";
  http.begin(client, urlContainer);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  String containerPayload = "{"
                            "\"count_1\":" + String(c1) + ","
                            "\"count_5\":" + String(c5) + ","
                            "\"count_10\":" + String(c10) + ","
                            "\"count_20\":" + String(c20) + ","
                            "\"total_pesos\":" + String(tot) + ","
                            "\"last_action\":\"DEPOSIT_P" + String(denomination) + "\","
                            "\"updated_at\":\"now()\""
                            "}";

  int patchCode = http.sendRequest("PATCH", (uint8_t*)containerPayload.c_str(), containerPayload.length());
  if (patchCode == 200 || patchCode == 204) {
    Serial.printf("[Supabase] Container updated successfully (HTTP %d)\n", patchCode);
  } else if (patchCode > 0) {
    Serial.printf("[Supabase] Container updated (HTTP %d)\n", patchCode);
  } else {
    Serial.printf("[Supabase] Container update failed: %s (code %d)\n",
                  http.errorToString(patchCode).c_str(), patchCode);
  }
  http.end();

  // 2. INSERT into coin_logs (Audit History Table)
  String urlLogs = String(SUPABASE_URL) + "/rest/v1/coin_logs";
  http.begin(client, urlLogs);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  String logPayload = "{"
                      "\"event_type\":\"DEPOSIT\","
                      "\"denomination\":" + String(denomination) + ","
                      "\"amount\":" + String(denomination) + ","
                      "\"count_1\":" + String(c1) + ","
                      "\"count_5\":" + String(c5) + ","
                      "\"count_10\":" + String(c10) + ","
                      "\"count_20\":" + String(c20) + ","
                      "\"total_pesos\":" + String(tot) + ","
                      "\"notes\":\"Coin inserted at ESP32 coin slot\""
                      "}";

  int postCode = http.POST(logPayload);
  if (postCode == 200 || postCode == 201) {
    Serial.printf("[Supabase] Coin deposit log created (HTTP %d)\n", postCode);
  } else if (postCode > 0) {
    Serial.printf("[Supabase] Coin deposit log status: HTTP %d\n", postCode);
  } else {
    Serial.printf("[Supabase] Log insert failed: %s (code %d)\n",
                  http.errorToString(postCode).c_str(), postCode);
  }
  http.end();
}

// Helper to extract integer value from simple JSON string
int extractJsonInt(const String &json, const String &key) {
  int keyIndex = json.indexOf("\"" + key + "\":");
  if (keyIndex == -1) return -1;
  int valStart = keyIndex + key.length() + 3;
  int valEnd = valStart;
  while (valEnd < json.length() && (isDigit(json[valEnd]) || json[valEnd] == '-')) {
    valEnd++;
  }
  return json.substring(valStart, valEnd).toInt();
}

// ========================================================
// 13. FULL DATABASE SYNCHRONIZATION (Handles Web Resets)
// ========================================================
void syncWithSupabase(bool onBoot) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(2500);

  HTTPClient http;
  String url = String(SUPABASE_URL) +
               "/rest/v1/coin_container?id=eq.1&select=count_1,count_5,count_10,count_20,total_pesos,last_action";

  http.begin(client, url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  int httpCode = http.GET();
  if (httpCode == 200) {
    String response = http.getString();

    int remote1 = extractJsonInt(response, "count_1");
    int remote5 = extractJsonInt(response, "count_5");
    int remote10 = extractJsonInt(response, "count_10");
    int remote20 = extractJsonInt(response, "count_20");
    int remoteTotal = extractJsonInt(response, "total_pesos");

    if (remoteTotal != -1) {
      bool valuesChanged = (remoteTotal != totalPesos || remote1 != count1 ||
                            remote5 != count5 || remote10 != count10 || remote20 != count20);

      if (valuesChanged || onBoot) {
        count1 = (remote1 >= 0) ? remote1 : 0;
        count5 = (remote5 >= 0) ? remote5 : 0;
        count10 = (remote10 >= 0) ? remote10 : 0;
        count20 = (remote20 >= 0) ? remote20 : 0;
        totalPesos = remoteTotal;

        Serial.printf("\n[SYNC] Updated from Supabase! Total: ₱%d | 1x[%d] 5x[%d] 10x[%d] 20x[%d]\n",
                      totalPesos, count1, count5, count10, count20);

        // If the web admin reset the vault to 0, show brief notification
        if (response.indexOf("VAULT_MANUALLY_EMPTIED") != -1 && !onBoot) {
          lcd.clear();
          lcd.setCursor(3, 0);
          lcd.print("SMARTCOIN");
          lcd.setCursor(1, 1);
          lcd.print("VAULT RESET: 0");
          delay(1200);
          showIdleScreen();
        }
      }
    }
  }
  http.end();
}

// ========================================================
// 14. WIFI CONNECTION HELPER
// ========================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("Connecting to WiFi '%s'...", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(300);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi Connection Failed. Running in offline counting mode.");
  }
}

// ========================================================
// 15. SERIAL MONITOR DIAGNOSTIC COMMANDS
// ========================================================
void checkSerialCommands() {
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    input.toUpperCase();
    if (input.length() == 0) return;

    if (input == "1" || input == "C1") {
      Serial.println("[Serial Test] Simulating ₱1 coin (1 pulse)...");
      noInterrupts();
      pulseCount = 1;
      lastPulseTime = millis();
      interrupts();
    } else if (input == "5" || input == "C5") {
      Serial.println("[Serial Test] Simulating ₱5 coin (5 pulses)...");
      noInterrupts();
      pulseCount = 5;
      lastPulseTime = millis();
      interrupts();
    } else if (input == "10" || input == "C10") {
      Serial.println("[Serial Test] Simulating ₱10 coin (10 pulses)...");
      noInterrupts();
      pulseCount = 10;
      lastPulseTime = millis();
      interrupts();
    } else if (input == "20" || input == "C20") {
      Serial.println("[Serial Test] Simulating ₱20 coin (20 pulses)...");
      noInterrupts();
      pulseCount = 20;
      lastPulseTime = millis();
      interrupts();
    } else if (input == "STATUS") {
      Serial.printf("\n--- SMARTCOIN STATUS ---\nTotal: ₱%d | ₱1: %d | ₱5: %d | ₱10: %d | ₱20: %d\nWiFi: %s\n\n",
                    totalPesos, count1, count5, count10, count20,
                    (WiFi.status() == WL_CONNECTED) ? "CONNECTED" : "DISCONNECTED");
    } else if (input == "HELP" || input == "?") {
      Serial.println("\n--- SMARTCOIN ESP32 SERIAL COMMANDS ---");
      Serial.println("1 / 5 / 10 / 20 : Simulate coin pulses (tests LCD & Supabase Upload)");
      Serial.println("STATUS          : View current coin counts and WiFi status");
      Serial.println("----------------------------------------\n");
    }
  }
}
