#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
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
// 2. HARDWARE PIN DEFINITIONS
// ========================================================
// Fast Optical IR Coin Sensors
#define IR_1_PESO 27
#define IR_5_PESO 26
#define IR_10_PESO 25
#define IR_20_PESO 33

// Servos for Automated Coin Dispensers (1 per coin tube: ₱1, ₱5, ₱10, ₱20)
#define SERVO_1_PIN  18 // Servo for ₱1 coin tube
#define SERVO_5_PIN  19 // Servo for ₱5 coin tube
#define SERVO_10_PIN 23 // Servo for ₱10 coin tube
#define SERVO_20_PIN 13 // Servo for ₱20 coin tube (or GPIO 32/14)

LiquidCrystal_I2C lcd(0x27, 16, 2);

// ========================================================
// 3. AUTOMATED DISPENSER (0° -> 180° -> 0°) CONFIGURATION
// ========================================================
const int SERVO_HOME = 0;        // 0°: Hold/Load position (bottom coin drops into slot)
const int SERVO_DISPENSE = 180;  // 180°: Dispense position (coin drops through cutout into tray)

// Mechanical sequence timing (in milliseconds)
const unsigned long WITHDRAW_POLL_INTERVAL_MS = 1500; // Poll Supabase every 1.5s
const unsigned long SERVO_TRAVEL_MS = 400;           // Time to sweep 0° -> 180°
const unsigned long SERVO_HOLD_MS = 350;             // Time to hold at 180° for gravity drop
const unsigned long SERVO_RETURN_MS = 400;           // Time to return 180° -> 0°

Servo servoP1;
Servo servoP5;
Servo servoP10;
Servo servoP20;

// Dispenser Sequence Finite State Machine
enum DispenseStage {
  DISPENSE_IDLE,
  ROTATE_180,
  HOLD_AT_180,
  RETURN_TO_0,
  COMPLETE_DISPENSE
};

DispenseStage dispenseStage = DISPENSE_IDLE;
unsigned long dispenseStageStartedAt = 0;
unsigned long lastWithdrawPollAt = 0;
long activeWithdrawCommandId = -1;
int activeWithdrawDenom = 0;
int activeWithdrawQty = 1;
bool withdrawCommandActive = false;

// ========================================================
// 4. FAST COIN COUNTERS & STATE MACHINE
// ========================================================
int count1 = 0;
int count5 = 0;
int count10 = 0;
int count20 = 0;
int totalPesos = 0;

// Individual IR sensor state tracker to prevent repeated triggers
struct CoinSensor {
  int pin;
  int denom;
  int lastState;
  unsigned long stateChangeTime;
  bool isBlocked;
};

CoinSensor sensors[4] = {{IR_1_PESO, 1, HIGH, 0, false},
                         {IR_5_PESO, 5, HIGH, 0, false},
                         {IR_10_PESO, 10, HIGH, 0, false},
                         {IR_20_PESO, 20, HIGH, 0, false}};

// FreeRTOS queue for asynchronous cloud sync
QueueHandle_t coinQueue;
TaskHandle_t cloudTaskHandle = NULL;

// ========================================================
// 5. TIMERS & DISPLAY STATE
// ========================================================
unsigned long detectedTime = 0;
bool showingDetectedCoin = false;
const unsigned long detectedDisplayTime = 1500; // 1.5s snappy display popup

// Periodic sync timer to check for remote withdrawals
unsigned long lastSyncTime = 0;
const unsigned long syncInterval = 3000; // Check every 3 seconds

// ========================================================
// 6. FUNCTION DECLARATIONS
// ========================================================
void scanCoinSensors();
void coinDetected(int denomination);
void showOverall();
void pushCoinToSupabase(int denomination);
void syncWithSupabase(bool onBoot = false);
void connectWiFi();
void cloudSyncTask(void *pvParameters);

// Automated Coin Withdrawal Dispenser functions
bool fetchPendingWithdrawCommand(long &id, int &denom, int &qty);
bool updateWithdrawCommand(long id, const String &status);
void startWithdrawSequence(long id, int denom, int qty);
void runWithdrawSequence();
Servo* getServoForDenom(int denom);
void deductCoin(int denom);
void pushWithdrawalToSupabase(int denomination);

// ========================================================
// 7. SETUP
// ========================================================
void setup() {
  Serial.begin(115200);

  // Initialize FreeRTOS Queue for fast background cloud sync
  coinQueue = xQueueCreate(50, sizeof(int));

  // Configure IR sensor inputs with pullup
  pinMode(IR_1_PESO, INPUT_PULLUP);
  pinMode(IR_5_PESO, INPUT_PULLUP);
  pinMode(IR_10_PESO, INPUT_PULLUP);
  pinMode(IR_20_PESO, INPUT_PULLUP);

  // Configure 4x Coin Dispenser Servos (₱1, ₱5, ₱10, ₱20)
  servoP1.setPeriodHertz(50);
  servoP5.setPeriodHertz(50);
  servoP10.setPeriodHertz(50);
  servoP20.setPeriodHertz(50);

  servoP1.attach(SERVO_1_PIN, 500, 2400);
  servoP5.attach(SERVO_5_PIN, 500, 2400);
  servoP10.attach(SERVO_10_PIN, 500, 2400);
  servoP20.attach(SERVO_20_PIN, 500, 2400);

  // Initialize to safe home positions (0°)
  servoP1.write(SERVO_HOME);
  servoP5.write(SERVO_HOME);
  servoP10.write(SERVO_HOME);
  servoP20.write(SERVO_HOME);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("SMARTCOIN GRP 4");
  lcd.setCursor(0, 1);
  lcd.print("CONNECTING WIFI");

  Serial.println("\n==============================================");
  Serial.println(" SMARTCOIN GRP 4 - (IR + 4 SERVO DISPENSER) ");
  Serial.println("==============================================");

  connectWiFi();

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("SYNCING VAULT...");
  lcd.setCursor(0, 1);
  lcd.print("FETCHING DB DATA");

  // Initial cloud sync: Load actual live coins & balance from Supabase
  syncWithSupabase(true);

  // Spawn asynchronous background FreeRTOS task on Core 0 for Cloud Sync
  xTaskCreatePinnedToCore(cloudSyncTask,    // Task function
                          "CloudSyncTask",  // Name of task
                          8192,             // Stack size
                          NULL,             // Parameter
                          1,                // Priority
                          &cloudTaskHandle, // Task handle
                          0 // Pin to Core 0 (leaves Core 1 for sensor scanning)
  );

  lcd.clear();
  showOverall();
}

// ========================================================
// 8. MAIN LOOP (Zero-Latency Scanning & Non-Blocking Servos)
// ========================================================
void loop() {
  // Ensure WiFi reconnects if dropped
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // 1. High-speed non-blocking scan of all 4 IR sensors
  scanCoinSensors();

  // 2. Automated servo withdrawal state machine (0° -> 180° -> 0°)
  runWithdrawSequence();

  // 3. Poll for pending withdrawal commands only when idle & connected
  unsigned long now = millis();
  if (!withdrawCommandActive && WiFi.status() == WL_CONNECTED &&
      (now - lastWithdrawPollAt >= WITHDRAW_POLL_INTERVAL_MS)) {
    lastWithdrawPollAt = now;
    long pendingCmdId = -1;
    int pendingDenom = 0;
    int pendingQty = 1;
    if (fetchPendingWithdrawCommand(pendingCmdId, pendingDenom, pendingQty)) {
      startWithdrawSequence(pendingCmdId, pendingDenom, pendingQty);
    }
  }

  // 4. Restore main display after detection popup expires
  if (showingDetectedCoin && (millis() - detectedTime >= detectedDisplayTime)) {
    showingDetectedCoin = false;
    showOverall();
  }

  // 5. Periodically sync database when not detecting coins or dispensing
  if (!showingDetectedCoin && !withdrawCommandActive &&
      (millis() - lastSyncTime >= syncInterval)) {
    lastSyncTime = millis();
    syncWithSupabase(false);
  }
}

// ========================================================
// 9. HIGH-SPEED SENSOR SCANNER (Prevents Retrigger Loops)
// ========================================================
void scanCoinSensors() {
  unsigned long now = millis();

  for (int i = 0; i < 4; i++) {
    int reading = digitalRead(sensors[i].pin);

    // Detect beam cut (Transition from HIGH to LOW)
    if (reading == LOW && sensors[i].lastState == HIGH) {
      sensors[i].stateChangeTime = now;
      sensors[i].lastState = LOW;
    }
    // Validate pulse: Must stay LOW for at least 15ms (filters optical glitches)
    else if (reading == LOW && sensors[i].lastState == LOW &&
             !sensors[i].isBlocked) {
      if (now - sensors[i].stateChangeTime >= 15) {
        sensors[i].isBlocked = true; // Lock this sensor until beam is clear

        int denom = sensors[i].denom;
        if (denom == 1)
          count1++;
        else if (denom == 5)
          count5++;
        else if (denom == 10)
          count10++;
        else if (denom == 20)
          count20++;
        totalPesos += denom;

        // Instant LCD & Serial feedback
        coinDetected(denom);

        // Send to background FreeRTOS queue for Supabase sync
        xQueueSend(coinQueue, &denom, 0);
      }
    }
    // Beam unblocked (Sensor returned to HIGH)
    else if (reading == HIGH) {
      if (sensors[i].lastState == LOW) {
        sensors[i].lastState = HIGH;
        sensors[i].stateChangeTime = now;
      }
      // Chute has been clear for at least 80ms -> unlock for next coin
      else if (sensors[i].isBlocked &&
               (now - sensors[i].stateChangeTime >= 80)) {
        sensors[i].isBlocked = false;
      }
    }
  }
}

// ========================================================
// 10. AUTOMATED COIN DISPENSER (0° -> 180° -> 0° CONTROLLER)
// ========================================================
Servo* getServoForDenom(int denom) {
  if (denom == 1) return &servoP1;
  if (denom == 5) return &servoP5;
  if (denom == 10) return &servoP10;
  if (denom == 20) return &servoP20;
  return &servoP1;
}

void deductCoin(int denom) {
  if (denom == 1) {
    if (count1 > 0) count1--;
  } else if (denom == 5) {
    if (count5 > 0) count5--;
  } else if (denom == 10) {
    if (count10 > 0) count10--;
  } else if (denom == 20) {
    if (count20 > 0) count20--;
  }
  totalPesos = (count1 * 1) + (count5 * 5) + (count10 * 10) + (count20 * 20);
}

void runWithdrawSequence() {
  if (!withdrawCommandActive) return;

  unsigned long now = millis();
  Servo *s = getServoForDenom(activeWithdrawDenom);

  switch (dispenseStage) {
    case ROTATE_180:
      // Allow time for servo to reach 180°
      if (now - dispenseStageStartedAt >= SERVO_TRAVEL_MS) {
        dispenseStage = HOLD_AT_180;
        dispenseStageStartedAt = now;
        Serial.printf("[Dispenser] Servo at 180°. Holding for coin ₱%d to drop...\n", activeWithdrawDenom);
      }
      break;

    case HOLD_AT_180:
      // Hold at 180° for coin to clear cutout and drop into tray
      if (now - dispenseStageStartedAt >= SERVO_HOLD_MS) {
        s->write(SERVO_HOME); // Reset servo to 0°
        dispenseStage = RETURN_TO_0;
        dispenseStageStartedAt = now;

        lcd.setCursor(0, 1);
        lcd.print("SERVO -> 0 DEG  ");
        Serial.println("[Dispenser] Returning servo to 0° (Home)...");
      }
      break;

    case RETURN_TO_0:
      // Allow time for servo to fully return to 0°
      if (now - dispenseStageStartedAt >= SERVO_RETURN_MS) {
        dispenseStage = COMPLETE_DISPENSE;
      }
      break;

    case COMPLETE_DISPENSE: {
      Serial.printf("[Dispenser] Dispense cycle complete for ₱%d (Cmd #%ld)\n",
                    activeWithdrawDenom, activeWithdrawCommandId);

      // 1. Mark command 'completed' in Supabase with retries
      bool updated = false;
      for (int attempt = 1; attempt <= 3 && !updated; attempt++) {
        if (WiFi.status() != WL_CONNECTED) {
          connectWiFi();
        }
        updated = updateWithdrawCommand(activeWithdrawCommandId, "completed");
        if (!updated) {
          Serial.printf("[Dispenser] Retrying completed status update (%d/3)...\n", attempt);
          delay(300);
        }
      }

      if (updated) {
        Serial.println("[Dispenser] Supabase updated: completed.");
      } else {
        Serial.println("[Dispenser] Warning: Failed to update Supabase status after 3 attempts.");
      }

      // 2. Fetch the latest coin_container state from Supabase to stay 100% in sync
      syncWithSupabase(false);

      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("DISPENSED: P");
      lcd.print(activeWithdrawDenom);
      lcd.setCursor(0, 1);
      lcd.print("BAL: P");
      lcd.print(totalPesos);

      withdrawCommandActive = false;
      activeWithdrawCommandId = -1;
      dispenseStage = DISPENSE_IDLE;

      delay(1500);
      showOverall();
      break;
    }

    default:
      break;
  }
}

// ========================================================
// 11. SUPABASE WITHDRAW API (CLAIM & UPDATE COMMANDS)
// ========================================================
bool fetchPendingWithdrawCommand(long &id, int &denom, int &qty) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(2500);

  HTTPClient http;
  String url = String(SUPABASE_URL) +
               "/rest/v1/withdraw_commands?select=id,denomination,quantity&status=eq.pending"
               "&order=created_at.asc&limit=1";

  http.begin(client, url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }

  String response = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err || !doc.is<JsonArray>() || doc.as<JsonArray>().size() == 0) {
    return false;
  }

  id = doc[0]["id"].as<long>();
  denom = doc[0]["denomination"].as<int>();
  qty = doc[0]["quantity"].as<int>();
  return (id > 0 && (denom == 1 || denom == 5 || denom == 10 || denom == 20));
}

bool updateWithdrawCommand(long id, const String &status) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(3000);

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/withdraw_commands?id=eq." + String(id);

  http.begin(client, url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  JsonDocument doc;
  doc["status"] = status;

  String body;
  serializeJson(doc, body);

  http.addHeader("Content-Length", String(body.length()));

  int code = http.PATCH(body);
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("[Dispenser] Status update failed: HTTP %d\n", code);
    return false;
  }

  return true;
}

void startWithdrawSequence(long id, int denom, int qty) {
  Serial.printf("\n>>> [WITHDRAW INITIATED] Claiming Command #%ld for ₱%d <<<\n", id, denom);

  // Claim command first: mark 'running' in Supabase before moving hardware
  if (!updateWithdrawCommand(id, "running")) {
    Serial.println("[Dispenser] Could not mark command as running. Skipping.");
    return;
  }

  activeWithdrawCommandId = id;
  activeWithdrawDenom = denom;
  activeWithdrawQty = (qty > 0) ? qty : 1;
  withdrawCommandActive = true;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WITHDRAW: P");
  lcd.print(denom);
  lcd.setCursor(0, 1);
  lcd.print("SERVO 180 DEG...");

  // Rotate dedicated servo from 0° -> 180°
  Servo *s = getServoForDenom(denom);
  s->write(SERVO_DISPENSE);

  dispenseStage = ROTATE_180;
  dispenseStageStartedAt = millis();
  Serial.printf("[Dispenser] Servo for ₱%d commanded to 180°\n", denom);
}

void pushWithdrawalToSupabase(int denomination) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(2500);

  HTTPClient http;

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
                            "\"last_action\":\"WITHDRAW_P" + String(denomination) + "\","
                            "\"updated_at\":\"now()\""
                            "}";

  int patchCode = http.PATCH(containerPayload);
  if (patchCode > 0) {
    Serial.printf("[Supabase] Container updated after withdrawal (HTTP %d)\n", patchCode);
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
                      "\"event_type\":\"WITHDRAWAL\","
                      "\"denomination\":" + String(denomination) + ","
                      "\"amount\":" + String(denomination) + ","
                      "\"count_1\":" + String(c1) + ","
                      "\"count_5\":" + String(c5) + ","
                      "\"count_10\":" + String(c10) + ","
                      "\"count_20\":" + String(c20) + ","
                      "\"total_pesos\":" + String(tot) + ","
                      "\"notes\":\"Automated servo dispense (0->180->0 deg)\""
                      "}";

  int postCode = http.POST(logPayload);
  if (postCode > 0) {
    Serial.printf("[Supabase] Withdrawal log created (HTTP %d)\n", postCode);
  }
  http.end();
}

// ========================================================
// 12. ASYNCHRONOUS FREE-RTOS CLOUD SYNC TASK (Core 0)
// ========================================================
void cloudSyncTask(void *pvParameters) {
  int receivedDenom = 0;
  for (;;) {
    // Wait for coin event from scanner
    if (xQueueReceive(coinQueue, &receivedDenom, portMAX_DELAY) == pdTRUE) {
      // Non-blocking push to Supabase Cloud in background
      pushCoinToSupabase(receivedDenom);
    }
  }
}

// ========================================================
// 13. COIN DETECTED UI HANDLER
// ========================================================
void coinDetected(int denomination) {
  showingDetectedCoin = true;
  detectedTime = millis();

  lcd.clear();
  lcd.setCursor(0, 0);

  int currentDenomCount = 0;
  if (denomination == 1) {
    lcd.print("1 PESO DETECTED");
    currentDenomCount = count1;
  } else if (denomination == 5) {
    lcd.print("5 PESO DETECTED");
    currentDenomCount = count5;
  } else if (denomination == 10) {
    lcd.print("10 PESO DETECTED");
    currentDenomCount = count10;
  } else if (denomination == 20) {
    lcd.print("20 PESO DETECTED");
    currentDenomCount = count20;
  }

  lcd.setCursor(0, 1);
  lcd.print("COUNT: ");
  lcd.print(currentDenomCount);
  lcd.print(" | P");
  lcd.print(totalPesos);

  Serial.println("\n>>> [FAST IR DETECTED] <<<");
  Serial.printf("Coin: P%d | Total: P%d | 1x[%d] 5x[%d] 10x[%d] 20x[%d]\n",
                denomination, totalPesos, count1, count5, count10, count20);
}

// ========================================================
// 14. SHOW OVERALL TOTAL LCD
// ========================================================
void showOverall() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("OVERALL TOTAL");
  lcd.setCursor(0, 1);
  lcd.print("TOTAL: P");
  lcd.print(totalPesos);
}

// ========================================================
// 15. SUPABASE CLOUD SYNC (DEPOSIT)
// ========================================================
void pushCoinToSupabase(int denomination) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Supabase] WiFi offline. Skipping push.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Fast HTTPS without certificate verification overhead
  client.setTimeout(2500); // 2.5s quick timeout

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

  int patchCode = http.PATCH(containerPayload);
  if (patchCode > 0) {
    Serial.printf("[Supabase] Container updated (HTTP %d)\n", patchCode);
  } else {
    Serial.printf("[Supabase] Container update failed: %s\n",
                  http.errorToString(patchCode).c_str());
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
                      "\"notes\":\"Coin inserted at ESP32 node\""
                      "}";

  int postCode = http.POST(logPayload);
  if (postCode > 0) {
    Serial.printf("[Supabase] Log created (HTTP %d)\n", postCode);
  } else {
    Serial.printf("[Supabase] Log insert failed: %s\n",
                  http.errorToString(postCode).c_str());
  }
  http.end();
}

// Helper to extract integer value from simple JSON string
int extractJsonInt(const String &json, const String &key) {
  int keyIndex = json.indexOf("\"" + key + "\":");
  if (keyIndex == -1)
    return -1;
  int valStart = keyIndex + key.length() + 3;
  int valEnd = valStart;
  while (valEnd < json.length() &&
         (isDigit(json[valEnd]) || json[valEnd] == '-')) {
    valEnd++;
  }
  return json.substring(valStart, valEnd).toInt();
}

// ========================================================
// 16. FULL DATABASE & LCD SYNCHRONIZATION
// ========================================================
void syncWithSupabase(bool onBoot) {
  if (WiFi.status() != WL_CONNECTED)
    return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(2500);

  HTTPClient http;
  String url = String(SUPABASE_URL) +
               "/rest/v1/"
               "coin_container?id=eq.1&select=count_1,count_5,"
               "count_10,count_20,total_pesos,last_action";

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
      bool valuesChanged =
          (remoteTotal != totalPesos || remote1 != count1 ||
           remote5 != count5 || remote10 != count10 || remote20 != count20);

      if (valuesChanged || onBoot) {
        count1 = (remote1 >= 0) ? remote1 : 0;
        count5 = (remote5 >= 0) ? remote5 : 0;
        count10 = (remote10 >= 0) ? remote10 : 0;
        count20 = (remote20 >= 0) ? remote20 : 0;
        totalPesos = remoteTotal;

        Serial.printf("\n[SYNC] Matched with Web Supabase! Total: P%d | 1x[%d] "
                      "5x[%d] 10x[%d] 20x[%d]\n",
                      totalPesos, count1, count5, count10, count20);

        if (response.indexOf("WITHDRAWAL") != -1 && !onBoot) {
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
// 17. WIFI CONNECTION HELPER
// ========================================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED)
    return;

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
    Serial.println(
        "\nWiFi Connection Failed. Running in offline fallback mode.");
  }
}
