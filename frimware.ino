#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_AHTX0.h>
#include <SparkFun_ENS160.h>
#include <PMS.h>
#include "esp_task_wdt.h" 
#include "soc/soc.h" 
#include "soc/rtc_cntl_reg.h" 

// --- Configuration --- 
const char* ssid = "Judyxtoon";
const char* password = "12345678";
const char* serverUrl = "http://172.20.10.2:3000/api/log"; 

#define MQ2_PIN 34
#define FAN_PIN 25 
#define WDT_TIMEOUT 30 

Adafruit_AHTX0 aht;
SparkFun_ENS160 ens160;
HardwareSerial SerialPMS(2); 
PMS pms(SerialPMS);
PMS::DATA data;

unsigned long lastPost = 0;
unsigned long lastPmReadTime = 0;
int currentPmValue = 0;

// ตัวแปรเก็บสถานะเซนเซอร์
bool ahtOnline = false;
bool ensOnline = false;

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); 
  
  Serial.begin(115200);
  pinMode(FAN_PIN, OUTPUT);
  digitalWrite(FAN_PIN, HIGH); 

  esp_task_wdt_config_t twdt_config = {
      .timeout_ms = WDT_TIMEOUT * 1000,
      .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
      .trigger_panic = true
  };
  esp_task_wdt_init(&twdt_config); 
  esp_task_wdt_add(NULL); 

  SerialPMS.begin(9600, SERIAL_8N1, 16, 17);
  
  // ตั้งค่า I2C พร้อม Timeout เพื่อป้องกันการค้าง (สำคัญมาก!)
  Wire.begin(21, 22);
  Wire.setTimeOut(50); // ถ้าไม่ตอบสนองใน 50ms ให้ข้ามเลย

  if (aht.begin()) {
    ahtOnline = true;
  } else {
    Serial.println("⚠️ AHT10 Not Found");
  }

  if (ens160.begin()) {
    ens160.setOperatingMode(SFE_ENS160_STANDARD);
    ensOnline = true;
  } else {
    Serial.println("⚠️ ENS160 Not Found");
  }

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    esp_task_wdt_reset();
  }
  Serial.println("\n✅ Connected!");
}

void loop() {
  esp_task_wdt_reset(); 

  // อ่านค่า PMS (Serial ไม่ค่อยมีปัญหาเรื่องค้างเท่า I2C)
  if (pms.read(data)) {
    currentPmValue = data.PM_AE_UG_2_5;
    lastPmReadTime = millis();
  }

  // ระบบตัดกลับเป็น 0 ถ้าเซนเซอร์หาย
  if (millis() - lastPmReadTime > 15000) {
    currentPmValue = 0;
    digitalWrite(FAN_PIN, HIGH); 
  } else {
    if (currentPmValue > 35) digitalWrite(FAN_PIN, LOW);   
    else if (currentPmValue < 30) digitalWrite(FAN_PIN, HIGH); 
  }

  if (millis() - lastPost > 5000) {
    lastPost = millis();

    if (WiFi.status() == WL_CONNECTED) {
      float temp = 0, hum = 0;
      int co2 = 0;

      // ตรวจสอบ I2C Bus ก่อนอ่านค่า
      // ถ้าถอดสายไฟเลี้ยง บางครั้ง AHT/ENS จะส่งค่า Error หรือค้าง
      sensors_event_t h_ev, t_ev;
      if (ahtOnline && aht.getEvent(&h_ev, &t_ev)) {
        temp = t_ev.temperature;
        hum = h_ev.relative_humidity;
      } else {
        // พยายาม Re-init ถ้าเซนเซอร์หายไป
        ahtOnline = aht.begin();
      }

      if (ensOnline) {
        co2 = ens160.getECO2();
        if (co2 == 0) ensOnline = ens160.begin(); // เช็คว่ายังอยู่ไหม
      } else {
        ensOnline = ens160.begin();
        if(ensOnline) ens160.setOperatingMode(SFE_ENS160_STANDARD);
      }

      char jsonBuffer[256];
      snprintf(jsonBuffer, sizeof(jsonBuffer),
        "{\"in_pm\":%d,\"in_co2\":%d,\"in_gas\":%d,\"out_pm\":0,\"out_gas\":0,\"vent\":%d,\"filt\":0,\"temp\":%.2f,\"humidity\":%.2f}",
        currentPmValue, co2, analogRead(MQ2_PIN), 
        (digitalRead(FAN_PIN) == LOW ? 1 : 0),
        temp, hum
      );

      HTTPClient http;
      http.begin(serverUrl);
      http.addHeader("Content-Type", "application/json");
      int httpCode = http.POST(jsonBuffer);
      
      if (httpCode > 0) {
        Serial.printf("📡 Sent: %s\n", jsonBuffer);
      } else {
        Serial.printf("❌ Error: %s\n", http.errorToString(httpCode).c_str());
      }
      http.end();
    }
  }
}