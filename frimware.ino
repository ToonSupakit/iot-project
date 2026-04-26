// =====================================================================
// ไฟล์: frimware.ino
// คำอธิบาย: โปรแกรมหลักของบอร์ด ESP32 ทำหน้าที่อ่านค่าจากเซนเซอร์ต่างๆ
//           (ฝุ่น, อุณหภูมิ, ความชื้น, CO2, แก๊ส) แล้วส่งข้อมูลขึ้นเซิร์ฟเวอร์
//           พร้อมระบบ Smart Control ควบคุม 2 พัดลมอัตโนมัติ (Ventilation & Filtration)
// =====================================================================

// =====================================================================
// 🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑
// 🌟 สวิตช์เปิด-ปิด โหมด 2 พัดลม & เซนเซอร์นอกบ้าน (เตรียมเผื่ออนาคต)
// 🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑
//
// วิธีใช้งานในอนาคต:
// ตอนนี้คุณมีพัดลมตัวเดียว และเซนเซอร์ชุดเดียว สวิตช์นี้จึงปิด (false) อยู่
//
// 👉 หากวันไหนคุณซื้อของมาติดครบแล้ว ให้แก้คำว่า "false" เป็น "true"
// 👉 จากนั้นกด อัปโหลด (Upload) โค้ดลงบอร์ด ESP32 ใหม่ 
// 👉 ระบบสมองกล 2 พัดลมสุดฉลาด จะทำงานทันที!
// 
#define HAS_OUTDOOR_SENSORS false  // <--- แก้คำว่า false ตรงนี้เป็น true เมื่อพร้อม!
//
// =====================================================================

// --- นำเข้าไลบรารี (Library) ที่จำเป็น ---
#include <WiFi.h>            // ไลบรารีสำหรับเชื่อมต่อ WiFi
#include <HTTPClient.h>      // ไลบรารีสำหรับส่งข้อมูลผ่าน HTTP (เหมือนเปิดเว็บ)
#include <Wire.h>            // ไลบรารีสำหรับสื่อสารแบบ I2C (สายสัญญาณ 2 เส้นที่ต่อกับเซนเซอร์)
#include <Adafruit_AHTX0.h>  // ไลบรารีสำหรับเซนเซอร์ AHT10 (วัดอุณหภูมิและความชื้น)
#include <SparkFun_ENS160.h>  // ไลบรารีสำหรับเซนเซอร์ ENS160 (วัดก๊าซ CO2)
#include <PMS.h>              // ไลบรารีสำหรับเซนเซอร์ PMS7003 (วัดฝุ่น PM2.5)
#include "esp_task_wdt.h"     // ไลบรารี Watchdog Timer (ระบบเฝ้าระวังการค้าง)
#include "soc/soc.h"          // ไลบรารีสำหรับตั้งค่าระดับฮาร์ดแวร์ของ ESP32
#include "soc/rtc_cntl_reg.h" // ไลบรารีสำหรับปิดระบบตรวจจับไฟตก (Brown-out)

// =====================================================================
// ตั้งค่าการเชื่อมต่อ WiFi และเซิร์ฟเวอร์
// =====================================================================
const char* ssid = "Judyxtoon";                        // ชื่อ WiFi ที่จะเชื่อมต่อ
const char* password = "12345678";                      // รหัสผ่าน WiFi
const char* serverUrl = "http://172.20.10.2:3000/api/log"; // URL ของเซิร์ฟเวอร์ Node.js

// =====================================================================
// ตั้งค่าขา (Pin) ที่ต่อกับอุปกรณ์ภายนอก
// =====================================================================
#define MQ2_PIN 34           // เซนเซอร์แก๊ส MQ2 ในบ้าน
#define FAN_VENT_PIN 25      // รีเลย์พัดลมระบายอากาศ (ดึงอากาศเข้า/ออก) ตัวเดิม
#define FAN_FILT_PIN 26      // รีเลย์พัดลมกรองอากาศ (HEPA Filter) ตัวใหม่

// ขาสำหรับเซนเซอร์นอกบ้าน (ใช้งานเมื่อ HAS_OUTDOOR_SENSORS เป็น true)
#if HAS_OUTDOOR_SENSORS
#define MQ2_OUT_PIN 35       // เซนเซอร์แก๊ส MQ2 นอกบ้าน
#define PMS_OUT_RX 4         // ขา RX ของเซนเซอร์ฝุ่นนอกบ้าน
#define PMS_OUT_TX 5         // ขา TX ของเซนเซอร์ฝุ่นนอกบ้าน
#endif

#define WDT_TIMEOUT 30   // ตั้ง Watchdog Timer ไว้ 30 วินาที

// =====================================================================
// ตั้งค่าเวลาในการทำงานต่างๆ (หน่วยเป็นมิลลิวินาที)
// =====================================================================
#define POST_INTERVAL    2000   // ส่งข้อมูลไปเซิร์ฟเวอร์ทุกๆ 2 วินาที
#define HTTP_TIMEOUT     2000   // HTTP timeout 2 วินาที
#define PM_TIMEOUT       5000   // ถ้าเซนเซอร์ฝุ่นหายไป 5 วินาที ให้ถือว่าหลุด
#define PMS_REQUEST_INTERVAL 1000  // สั่งขอค่าจากเซนเซอร์ฝุ่นทุกๆ 1 วินาที

// =====================================================================
// สร้างตัวแปร "วัตถุ" (Object) สำหรับเซนเซอร์
// =====================================================================
Adafruit_AHTX0 aht;             
SparkFun_ENS160 ens160;         
HardwareSerial SerialPMS(2);    // ช่อง Serial 2 สำหรับเซนเซอร์ฝุ่นในบ้าน
PMS pms(SerialPMS);             
PMS::DATA data;                 

#if HAS_OUTDOOR_SENSORS
HardwareSerial SerialPMSOut(1); // ช่อง Serial 1 สำหรับเซนเซอร์ฝุ่นนอกบ้าน
PMS pmsOut(SerialPMSOut);
PMS::DATA dataOut;
#endif

// =====================================================================
// ตัวแปรสำหรับจับเวลาการทำงานและเก็บข้อมูล
// =====================================================================
unsigned long lastPost = 0;          
unsigned long lastPmReadTime = 0;    
unsigned long lastPmOutReadTime = 0; 
unsigned long lastPmsRequest = 0;    

int currentPmValue = 0;              // ค่าฝุ่นในบ้าน
int currentPmOutValue = 0;           // ค่าฝุ่นนอกบ้าน

bool ahtOnline = false;    
bool ensOnline = false;    

float lastTemp = 0, lastHum = 0;     
int lastCo2 = 0, lastGas = 0;       
int lastGasOut = 0;                  // ค่าแก๊สนอกบ้าน

unsigned long lastSensorRead = 0;    
#define SENSOR_READ_INTERVAL 1000    

// =====================================================================
// ฟังก์ชัน setup() - ทำงานครั้งเดียวตอนเปิดเครื่อง
// =====================================================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); 
  Serial.begin(115200);

  // ตั้งค่าขาพัดลมทั้ง 2 ตัวเป็น Output และปิดไว้ก่อน (HIGH)
  pinMode(FAN_VENT_PIN, OUTPUT);
  digitalWrite(FAN_VENT_PIN, HIGH); 
  pinMode(FAN_FILT_PIN, OUTPUT);
  digitalWrite(FAN_FILT_PIN, HIGH); 

  // ตั้งค่า Watchdog Timer
  esp_task_wdt_config_t twdt_config = {
      .timeout_ms = WDT_TIMEOUT * 1000,                    
      .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,     
      .trigger_panic = true                                 
  };
  esp_task_wdt_init(&twdt_config);  
  esp_task_wdt_add(NULL);           

  // เปิดพอร์ตสื่อสารเซนเซอร์ฝุ่น
  SerialPMS.begin(9600, SERIAL_8N1, 16, 17);
  pms.passiveMode();
  
#if HAS_OUTDOOR_SENSORS
  SerialPMSOut.begin(9600, SERIAL_8N1, PMS_OUT_RX, PMS_OUT_TX);
  pmsOut.passiveMode();
#endif
  
  // ตั้งค่าเซนเซอร์ I2C
  Wire.begin(21, 22);
  Wire.setTimeOut(50); 

  if (aht.begin()) ahtOnline = true;
  else Serial.println("⚠️ AHT10 Not Found");

  if (ens160.begin()) {
    ens160.setOperatingMode(SFE_ENS160_STANDARD); 
    ensOnline = true;   
  } else {
    Serial.println("⚠️ ENS160 Not Found");  
  }

  // เชื่อมต่อ WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);               
    Serial.print(".");        
    esp_task_wdt_reset();     
  }
  Serial.println("\n✅ Connected!");  
}

// =====================================================================
// ฟังก์ชัน loop() - ทำงานวนซ้ำไปเรื่อยๆ
// =====================================================================
void loop() {
  esp_task_wdt_reset(); 

  // =================================================================
  // ส่วนที่ 1: อ่านค่าเซนเซอร์ฝุ่น
  // =================================================================
  if (millis() - lastPmsRequest > PMS_REQUEST_INTERVAL) {
    lastPmsRequest = millis();
    pms.requestRead();          // ขอข้อมูลในบ้าน
#if HAS_OUTDOOR_SENSORS
    pmsOut.requestRead();       // ขอข้อมูลนอกบ้าน
#endif
  }

  // รับข้อมูลฝุ่นในบ้าน
  if (pms.readUntil(data, 500)) {
    currentPmValue = data.PM_AE_UG_2_5;  
    lastPmReadTime = millis();             
  }
  if (millis() - lastPmReadTime > PM_TIMEOUT) currentPmValue = 0;

  // รับข้อมูลฝุ่นนอกบ้าน (ถ้ามี)
#if HAS_OUTDOOR_SENSORS
  if (pmsOut.readUntil(dataOut, 500)) {
    currentPmOutValue = dataOut.PM_AE_UG_2_5;
    lastPmOutReadTime = millis();
  }
  if (millis() - lastPmOutReadTime > PM_TIMEOUT) currentPmOutValue = 0;
#endif

  // =================================================================
  // 🧠 ส่วนที่ 2: ระบบควบคุมพัดลมอัจฉริยะ (Smart Fan Logic)
  // =================================================================
  if (HAS_OUTDOOR_SENSORS) {
    // ⬇️⬇️⬇️⬇️⬇️ [โค้ดแห่งอนาคต] ทำงานเมื่อ HAS_OUTDOOR_SENSORS เป็น true ⬇️⬇️⬇️⬇️⬇️
    
    // ตั้งค่าความไวของแก๊สตรงนี้! (ตอนนี้ตั้งไว้ที่ 1500)
    bool isGasAlert = (lastGas > 1500); 

    if (isGasAlert) {
      // Priority 1: โหมดฉุกเฉิน เจอแก๊สในบ้าน -> เปิดระบายอากาศทิ้งอย่างเดียว
      digitalWrite(FAN_VENT_PIN, LOW);  // เปิด Vent
      digitalWrite(FAN_FILT_PIN, HIGH); // ปิด Filt
    } 
    else if (currentPmValue > 35) {
      // Priority 2: โหมดสู้ฝุ่น
      if (currentPmOutValue < currentPmValue) {
        // อากาศนอกบ้านดีกว่า -> เปิดระบายอากาศ (ดึงอากาศดีเข้า)
        digitalWrite(FAN_VENT_PIN, LOW);
        digitalWrite(FAN_FILT_PIN, HIGH);
      } else {
        // อากาศนอกบ้านแย่พอๆกัน หรือแย่กว่า -> เปิดระบบกรองปิด (สู้ฝุ่นด้วย HEPA)
        digitalWrite(FAN_VENT_PIN, HIGH);
        digitalWrite(FAN_FILT_PIN, LOW);
      }
    } 
    else if (currentPmValue < 30) {
      // Priority 3: โหมดปกติ อากาศดีอยู่แล้ว -> ปิดพัดลมทั้งหมดเพื่อประหยัดไฟ
      digitalWrite(FAN_VENT_PIN, HIGH);
      digitalWrite(FAN_FILT_PIN, HIGH);
    }
    // ⬆️⬆️⬆️⬆️⬆️ จบ [โค้ดแห่งอนาคต] ⬆️⬆️⬆️⬆️⬆️
  } 
  else {
    // ⬇️⬇️⬇️⬇️⬇️ [โค้ดปัจจุบัน] ทำงานเมื่อยังไม่มีเซนเซอร์นอกบ้าน ⬇️⬇️⬇️⬇️⬇️
    // มีพัดลมตัวเดียว ดูค่าฝุ่นในบ้านอย่างเดียว
    if (currentPmValue > 35) {
      digitalWrite(FAN_VENT_PIN, LOW);   
    } else if (currentPmValue < 30 || currentPmValue == 0) {
      digitalWrite(FAN_VENT_PIN, HIGH); 
    }
    // ปิดพัดลมกรองไว้ตลอด (เพราะยังไม่มีของ)
    digitalWrite(FAN_FILT_PIN, HIGH);
    // ⬆️⬆️⬆️⬆️⬆️ จบ [โค้ดปัจจุบัน] ⬆️⬆️⬆️⬆️⬆️
  }

  // =================================================================
  // ส่วนที่ 3: อ่านเซนเซอร์ I2C และแก๊ส
  // =================================================================
  if (millis() - lastSensorRead > SENSOR_READ_INTERVAL) {
    lastSensorRead = millis();

    // อ่าน AHT10
    sensors_event_t h_ev, t_ev;  
    if (ahtOnline && aht.getEvent(&h_ev, &t_ev)) {
      lastTemp = t_ev.temperature;       
      lastHum = h_ev.relative_humidity;  
    } else ahtOnline = aht.begin();

    // อ่าน ENS160
    if (ensOnline) {
      lastCo2 = ens160.getECO2();  
      if (lastCo2 == 0) ensOnline = ens160.begin();
    } else {
      ensOnline = ens160.begin();
      if (ensOnline) ens160.setOperatingMode(SFE_ENS160_STANDARD);
    }

    // อ่านแก๊ส
    lastGas = analogRead(MQ2_PIN);
#if HAS_OUTDOOR_SENSORS
    lastGasOut = analogRead(MQ2_OUT_PIN);
#else
    lastGasOut = 0; // บังคับเป็น 0 ถ้ายังไม่มีเซนเซอร์ ป้องกันค่ากวน
#endif
  }

  // =================================================================
  // ส่วนที่ 4: ส่งข้อมูลไปเซิร์ฟเวอร์
  // =================================================================
  if (millis() - lastPost > POST_INTERVAL) {
    lastPost = millis();

    if (WiFi.status() == WL_CONNECTED) {
      char jsonBuffer[256];
      // ส่งข้อมูลเซนเซอร์ในบ้าน นอกบ้าน และสถานะพัดลมทั้ง 2 ตัวครบถ้วน
      snprintf(jsonBuffer, sizeof(jsonBuffer),
        "{\"in_pm\":%d,\"in_co2\":%d,\"in_gas\":%d,\"out_pm\":%d,\"out_gas\":%d,\"vent\":%d,\"filt\":%d,\"temp\":%.2f,\"humidity\":%.2f}",
        currentPmValue, lastCo2, lastGas, 
        currentPmOutValue, lastGasOut,
        (digitalRead(FAN_VENT_PIN) == LOW ? 1 : 0),
        (digitalRead(FAN_FILT_PIN) == LOW ? 1 : 0),
        lastTemp, lastHum
      );

      HTTPClient http;
      http.begin(serverUrl);                           
      http.addHeader("Content-Type", "application/json"); 
      http.setTimeout(HTTP_TIMEOUT);                   
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