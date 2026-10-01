#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

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
// 2. HARDWARE PIN DEFINITIONS & SENSOR LOGIC
// ========================================================
#define IR_1_PESO  27
#define IR_5_PESO  26
#define IR_10_PESO 25
#define IR_20_PESO 33

// Set to true if sensor output is LOW when coin cuts the beam (standard active-LOW)
// Set to false if sensor output is HIGH when coin cuts the beam (active-HIGH)
#define SENSOR_ACTIVE_LOW true

// Debounce lockout time (in milliseconds) to prevent 1 coin triggering multiple counts
#define COIN_DEBOUNCE_MS 200

// LCD Display (0x27 is standard, 0x3F for some boards)
LiquidCrystal_I2C lcd(0x27, 16, 2);
bool lcdAvailable = true;

// ========================================================
// 3. LIVE COIN COUNTERS & QUEUES
// ========================================================
volatile int count1 = 0;
volatile int count5 = 0;
volatile int count10 = 0;
volatile int count20 = 0;
volatile int totalPesos = 0;

// Interrupt debounce timers
volatile unsigned long lastTrigger1 = 0;
volatile unsigned long lastTrigger5 = 0;
volatile unsigned long lastTrigger10 = 0;
volatile unsigned long lastTrigger20 = 0;

// FreeRTOS Queues for asynchronous background sync & UI events
QueueHandle_t cloudQueue;
QueueHandle_t uiQueue;
TaskHandle_t cloudTaskHandle = NULL;

// Display state
unsigned long detectedTime = 0;
bool showingDetectedCoin = false;
const unsigned long detectedDisplayTime = 1500; // 1.5s popup

// Periodic sync timer
unsigned long lastSyncCheck = 0;
const unsigned long syncInterval = 5000; // Check remote withdrawals every 5s

// ========================================================
// 4. FUNCTION DECLARATIONS
// ========================================================
void IRAM_ATTR isr_coin1();
void IRAM_ATTR isr_coin5();
void IRAM_ATTR isr_coin10();
void IRAM_ATTR isr_coin20();
void registerCoin(int denom);
void coinDetectedUI(int denomination);
void showOverall();
void pushCoinToSupabase(int denomination);
void syncWithSupabase(bool onBoot = false);
void connectWiFi();
void cloudSyncTask(void *pvParameters);
void printSensorStatus();

// ========================================================
// 5. HARDWARE INTERRUPT SERVICE ROUTINES (Zero-Latency)
// ========================================================
void IRAM_ATTR isr_coin1() {
  unsigned long now = millis();
  if (now - lastTrigger1 >= COIN_DEBOUNCE_MS) {
    lastTrigger1 = now;
    int denom = 1;
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    xQueueSendFromISR(uiQueue, &denom, &xHigherPriorityTaskWoken);
    xQueueSendFromISR(cloudQueue, &denom, &xHigherPriorityTaskWoken);
    if (xHigherPriorityTaskWoken) {
      portYIELD_FROM_ISR();
    }
  }
}

void IRAM_ATTR isr_coin5() {
  unsigned long now = millis();
  if (now - lastTrigger5 >= COIN_DEBOUNCE_MS) {
    lastTrigger5 = now;
    int denom = 5;
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    xQueueSendFromISR(uiQueue, &denom, &xHigherPriorityTaskWoken);
    xQueueSendFromISR(cloudQueue, &denom, &xHigherPriorityTaskWoken);
    if (xHigherPriorityTaskWoken) {
      portYIELD_FROM_ISR();
    }
  }
}

void IRAM_ATTR isr_coin10() {
  unsigned long now = millis();
  if (now - lastTrigger10 >= COIN_DEBOUNCE_MS) {
    lastTrigger10 = now;
    int denom = 10;
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    xQueueSendFromISR(uiQueue, &denom, &xHigherPriorityTaskWoken);
    xQueueSendFromISR(cloudQueue, &denom, &xHigherPriorityTaskWoken);
    if (xHigherPriorityTaskWoken) {
      portYIELD_FROM_ISR();
    }
  }
}

void IRAM_ATTR isr_coin20() {
  unsigned long now = millis();
  if (now - lastTrigger20 >= COIN_DEBOUNCE_MS) {
    lastTrigger20 = now;
    int denom = 20;
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    xQueueSendFromISR(uiQueue, &denom, &xHigherPriorityTaskWoken);
    xQueueSendFromISR(cloudQueue, &denom, &xHigherPriorityTaskWoken);
    if (xHigherPriorityTaskWoken) {
      portYIELD_FROM_ISR();
    }
  }
}

// ========================================================
// 6. SETUP
// ========================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n==============================================");
  Serial.println(" SMARTCOIN GROUP 4 - HIGH-PRECISION FIRMWARE  ");
  Serial.println("==============================================");

  // Initialize FreeRTOS Queues
  cloudQueue = xQueueCreate(50, sizeof(int));
  uiQueue = xQueueCreate(50, sizeof(int));

  // Configure IR sensor inputs
  pinMode(IR_1_PESO, INPUT_PULLUP);
  pinMode(IR_5_PESO, INPUT_PULLUP);
  pinMode(IR_10_PESO, INPUT_PULLUP);
  pinMode(IR_20_PESO, INPUT_PULLUP);

  // Attach zero-latency hardware interrupts
  int triggerMode = SENSOR_ACTIVE_LOW ? FALLING : RISING;
  attachInterrupt(digitalPinToInterrupt(IR_1_PESO), isr_coin1, triggerMode);
  attachInterrupt(digitalPinToInterrupt(IR_5_PESO), isr_coin5, triggerMode);
  attachInterrupt(digitalPinToInterrupt(IR_10_PESO), isr_coin10, triggerMode);
  attachInterrupt(digitalPinToInterrupt(IR_20_PESO), isr_coin20, triggerMode);

  // Initialize LCD Display
  Wire.begin(21, 22);
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    lcd.init();
    lcd.backlight();
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("SMARTCOIN GRP 4");
    lcd.setCursor(0, 1);
    lcd.print("CONNECTING WIFI");
  } else {
    Serial.println("[LCD] I2C Display at 0x27 not detected. Continuing in Serial mode.");
    lcdAvailable = false;
  }

  // Connect to WiFi network
  connectWiFi();

  if (lcdAvailable) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("SYNCING VAULT...");
    lcd.setCursor(0, 1);
    lcd.print("FETCHING DB DATA");
  }

  // Initial cloud sync: Load actual live coins & balance from Supabase
  syncWithSupabase(true);

  // Print current sensor pin diagnostics
  printSensorStatus();

  // Spawn asynchronous background FreeRTOS task on Core 0 for Cloud Sync
  xTaskCreatePinnedToCore(
      cloudSyncTask,    // Task function
      "CloudSyncTask",  // Name of task
      8192,             // Stack size
      NULL,             // Parameter
      1,                // Priority
      &cloudTaskHandle, // Task handle
      0                 // Pin to Core 0 (leaves Core 1 for UI & interrupts)
  );

  showOverall();
}

// ========================================================
// 7. MAIN LOOP (UI Updates & Local Processing)
// ========================================================
void loop() {
  // Check for newly detected coins from the interrupt UI queue
  int detectedDenom = 0;
  if (xQueueReceive(uiQueue, &detectedDenom, 0) == pdTRUE) {
    registerCoin(detectedDenom);
  }

  // Restore main display after detection popup expires
  if (showingDetectedCoin && (millis() - detectedTime >= detectedDisplayTime)) {
    showingDetectedCoin = false;
    showOverall();
  }

  // Periodically check remote status / withdrawals (every 5 seconds)
  if (!showingDetectedCoin && (millis() - lastSyncCheck >= syncInterval)) {
    lastSyncCheck = millis();
    syncWithSupabase(false);
  }

  delay(10);
}

// ========================================================
// 8. COIN PROCESSING & DISPLAY LOGIC
// ========================================================
void registerCoin(int denom) {
  if (denom == 1) count1++;
  else if (denom == 5) count5++;
  else if (denom == 10) count10++;
  else if (denom == 20) count20++;

  totalPesos += denom;
  coinDetectedUI(denom);
}

void coinDetectedUI(int denomination) {
  showingDetectedCoin = true;
  detectedTime = millis();

  int currentDenomCount = 0;
  if (denomination == 1) currentDenomCount = count1;
  else if (denomination == 5) currentDenomCount = count5;
  else if (denomination == 10) currentDenomCount = count10;
  else if (denomination == 20) currentDenomCount = count20;

  Serial.println("\n>>> [COIN DETECTED VIA INTERRUPT] <<<");
  Serial.printf("Coin: P%d | Total: P%d | 1x[%d] 5x[%d] 10x[%d] 20x[%d]\n",
                denomination, totalPesos, count1, count5, count10, count20);

  if (!lcdAvailable) return;

  lcd.clear();
  lcd.setCursor(0, 0);
  if (denomination == 1) lcd.print("1 PESO DETECTED");
  else if (denomination == 5) lcd.print("5 PESO DETECTED");
  else if (denomination == 10) lcd.print("10 PESO DETECTED");
  else if (denomination == 20) lcd.print("20 PESO DETECTED");

  lcd.setCursor(0, 1);
  lcd.print("COUNT: ");
  lcd.print(currentDenomCount);
  lcd.print(" | P");
  lcd.print(totalPesos);
}

void showOverall() {
  if (!lcdAvailable) return;
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("OVERALL TOTAL");
  lcd.setCursor(0, 1);
  lcd.print("TOTAL: P");
  lcd.print(totalPesos);
}

// ========================================================
// 9. ASYNCHRONOUS FREE-RTOS CLOUD SYNC TASK (Core 0)
// ========================================================
void cloudSyncTask(void *pvParameters) {
  int receivedDenom = 0;
  for (;;) {
    // Wait for coin event from interrupt queue
    if (xQueueReceive(cloudQueue, &receivedDenom, portMAX_DELAY) == pdTRUE) {
      // Non-blocking push to Supabase Cloud
      pushCoinToSupabase(receivedDenom);
    }
  }
}

// ========================================================
// 10. SUPABASE CLOUD SYNC (DEPOSIT)
// ========================================================
void pushCoinToSupabase(int denomination) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Supabase] WiFi offline. Reconnecting...");
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(3500);

  HTTPClient http;

  int c1 = count1;
  int c5 = count5;
  int c10 = count10;
  int c20 = count20;
  int tot = totalPesos;

  // 1. UPDATE coin_container
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

  int patchCode = http.PATCH(containerPayload);
  if (patchCode >= 200 && patchCode < 300) {
    Serial.printf("[Supabase] Container updated (HTTP %d)\n", patchCode);
  } else {
    Serial.printf("[Supabase] Container update failed: %d (%s)\n",
                  patchCode, http.errorToString(patchCode).c_str());
  }
  http.end();

  // 2. INSERT into coin_logs
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
                      "\"notes\":\"Coin inserted at ESP32 node\""
                      "}";

  int postCode = http.POST(logPayload);
  if (postCode >= 200 && postCode < 300) {
    Serial.printf("[Supabase] Log created (HTTP %d)\n", postCode);
  } else {
    Serial.printf("[Supabase] Log insert failed: %d (%s)\n",
                  postCode, http.errorToString(postCode).c_str());
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
// 11. DATABASE SYNC (READ REMOTE WITHDRAWALS)
// ========================================================
void syncWithSupabase(bool onBoot) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(3000);

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

      // Only update if it's on boot or if the remote change was a withdrawal from web
      if (onBoot || (valuesChanged && response.indexOf("WITHDRAWAL") != -1)) {
        count1 = (remote1 >= 0) ? remote1 : 0;
        count5 = (remote5 >= 0) ? remote5 : 0;
        count10 = (remote10 >= 0) ? remote10 : 0;
        count20 = (remote20 >= 0) ? remote20 : 0;
        totalPesos = remoteTotal;

        Serial.printf("\n[SYNC] Synced with Supabase! Total: P%d | 1x[%d] 5x[%d] 10x[%d] 20x[%d]\n",
                      totalPesos, count1, count5, count10, count20);

        if (response.indexOf("WITHDRAWAL") != -1 && !onBoot && lcdAvailable) {
          lcd.clear();
          lcd.setCursor(0, 0);
          lcd.print("WITHDRAWN (APP)");
          lcd.setCursor(0, 1);
          lcd.print("BAL: P");
          lcd.print(totalPesos);
          delay(1500);
        }

        showOverall();
      }
    }
  }
  http.end();
}

// ========================================================
// 12. SENSOR DIAGNOSTIC HELPER
// ========================================================
void printSensorStatus() {
  Serial.println("\n--- [IR SENSOR REAL-TIME PIN STATUS] ---");
  Serial.printf("Pin %d (P1) : %s\n", IR_1_PESO, digitalRead(IR_1_PESO) == LOW ? "DETECTED (LOW)" : "IDLE/CLEAR (HIGH)");
  Serial.printf("Pin %d (P5) : %s\n", IR_5_PESO, digitalRead(IR_5_PESO) == LOW ? "DETECTED (LOW)" : "IDLE/CLEAR (HIGH)");
  Serial.printf("Pin %d (P10): %s\n", IR_10_PESO, digitalRead(IR_10_PESO) == LOW ? "DETECTED (LOW)" : "IDLE/CLEAR (HIGH)");
  Serial.printf("Pin %d (P20): %s\n", IR_20_PESO, digitalRead(IR_20_PESO) == LOW ? "DETECTED (LOW)" : "IDLE/CLEAR (HIGH)");
  Serial.println("Tip: When idle, pins should be HIGH. When you place a coin or finger in the slot, the pin should drop to LOW and onboard sensor LED lights up.");
  Serial.println("----------------------------------------\n");
}

// ========================================================
// 13. WIFI CONNECTION HELPER
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
    Serial.println("\n[WiFi] Connected!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Connection Failed. Sensor interrupts will still count locally.");
  }
}
