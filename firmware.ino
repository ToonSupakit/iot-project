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
  #include <WiFiUdp.h>         // ไลบรารี UDP สำหรับระบบค้นหา Server อัตโนมัติ (Auto-Discovery)
  #include <WiFiManager.h>     // ไลบรารีสำหรับตั้งค่า WiFi ผ่านหน้าจอมือถือ (Captive Portal)
  #include <HTTPClient.h>      // ไลบรารีสำหรับส่งข้อมูลผ่าน HTTP (เหมือนเปิดเว็บ)
  #include <Wire.h>            // ไลบรารีสำหรับสื่อสารแบบ I2C (สายสัญญาณ 2 เส้นที่ต่อกับเซนเซอร์)
  #include <Adafruit_AHTX0.h>  // ไลบรารีสำหรับเซนเซอร์ AHT10 (วัดอุณหภูมิและความชื้น)
  #include <SparkFun_ENS160.h>  // ไลบรารีสำหรับเซนเซอร์ ENS160 (วัดก๊าซ CO2)
  #include <PMS.h>              // ไลบรารีสำหรับเซนเซอร์ PMS7003 (วัดฝุ่น PM2.5)
  #include "soc/soc.h"          // ไลบรารีสำหรับตั้งค่าระดับฮาร์ดแวร์ของ ESP32
  #include "soc/rtc_cntl_reg.h" // ไลบรารีสำหรับปิดระบบตรวจจับไฟตก (Brown-out)
  #include <Preferences.h>      // ไลบรารีสำหรับบันทึกค่า Server IP ลงความจำถาวรของ ESP32
  #include <esp_idf_version.h>
  #include <math.h>
  #include <esp_task_wdt.h>     // ★ ไลบรารี Watchdog Timer ป้องกัน ESP32 ค้าง จะรีสตาร์ทอัตโนมัติ

  // =====================================================================
  // ตัวแปรเก็บ Server IP และระบบ UDP Auto-Discovery
  // =====================================================================
  Preferences preferences;
  char server_ip[40] = "192.168.1.110";
  char deviceKey[65] = ""; // Set in AirWatch-Setup; never commit a real key.
  unsigned int httpFailures = 0;
  bool watchdogReady = false;
  char serverUrl[80] = "http://192.168.1.110:3000/api/log";
  WiFiUDP udp;
  bool serverDiscovered = false;
  unsigned long lastDiscoveryAttempt = 0;

  // ฟังก์ชันยิงค้นหา IP ของคอมพิวเตอร์ในวง WiFi อัตโนมัติ (UDP Broadcast)
  void discoverServerIP() {
    if (WiFi.status() != WL_CONNECTED) return;
    
    udp.stop();
    udp.begin(41234);
    Serial.println("📡 Auto-Discovery: Broadcast searching for AirWatch Server...");
    
    udp.beginPacket(IPAddress(255, 255, 255, 255), 41234);
    udp.write((const uint8_t*)"AIRWATCH_DISCOVER", 17);
    udp.endPacket();

    unsigned long startWait = millis();
    while (millis() - startWait < 1000) {
      int packetSize = udp.parsePacket();
      if (packetSize) {
        char replyBuffer[64] = {0};
        udp.read(replyBuffer, sizeof(replyBuffer) - 1);
        unsigned int discoveredPort = 0;
        if (sscanf(replyBuffer, "AIRWATCH_SERVER_HERE:%u", &discoveredPort) == 1 &&
            discoveredPort > 0 && discoveredPort <= 65535) {
          IPAddress serverIP = udp.remoteIP();
          snprintf(serverUrl, sizeof(serverUrl), "http://%s:%u/api/log", serverIP.toString().c_str(), discoveredPort);
          Serial.printf("🎯 Auto-Discovery SUCCESS! Matched Server at: %s\n", serverUrl);
          serverDiscovered = true;
          break;
        }
      }
      delay(20);
    }
  }

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
  #define POST_INTERVAL    2500   // ส่งข้อมูลไปเซิร์ฟเวอร์ทุกๆ 2.5 วินาที
  #define HTTP_TIMEOUT     5000   // ★ HTTP timeout 5 วินาที (เพิ่มจาก 2 วิ ป้องกัน Timeout Error)
  #define PM_TIMEOUT       5000   // ถ้าเซนเซอร์ฝุ่นหายไป 5 วินาที ให้ถือว่าหลุด
  #define PMS_REQUEST_INTERVAL 1000  // สั่งขอค่าจากเซนเซอร์ฝุ่นทุกๆ 1 วินาที
  #define MIN_FAN_SWITCH_INTERVAL 5000 // ป้องกันรีเลย์รัว: พัดลมต้องเปิด/ปิดอย่างน้อย 5 วินาทีถึงเปลี่ยนสถานะได้
  #define WIFI_RECONNECT_INTERVAL 10000 // พยายามเชื่อมต่อ WiFi ใหม่ทุก 10 วินาทีหากหลุด
  #define WARMUP_PERIOD 30000            // ★ 30 วินาทีแรกไม่สั่งพัดลม (รอเซนเซอร์อุ่นเครื่อง)
  #define WIFI_RESTART_TIMEOUT 300000    // ★ 5 นาทีไม่มี WiFi → รีสตาร์ท ESP32 อัตโนมัติ
  #define PM_MAX_CAP 999                 // ★ ค่า PM2.5 สูงสุดที่ยอมรับ (ป้องกันค่าเพี้ยน)
  #define I2C_MAX_ERRORS 5               // ★ ถ้า I2C error เกิน 5 ครั้งติด ให้ reset I2C bus

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

  bool pmValid = false, pmOutValid = false;
  bool ahtValid = false;
  unsigned long lastCo2ReadTime = 0;
  bool ahtOnline = false;    
  bool ensOnline = false;    

  float lastTemp = 0, lastHum = 0;     
  int lastCo2 = 0, lastGas = 0;       
  int lastGasOut = 0;                  // ค่าแก๊สนอกบ้าน
  unsigned long lastSensorRead = 0;    
  unsigned long lastFanSwitch = 0;     // เวลาสลับสถานะพัดลมล่าสุด
  unsigned long lastWifiReconnect = 0; // เวลาพยายามเชื่อมต่อ WiFi ล่าสุด
  #define SENSOR_READ_INTERVAL 1000    

  bool isVentOn = false;               // สถานะพัดลมระบายอากาศ (true = กำลังทำงาน, false = ปิด)
  bool isFiltOn = false;               // สถานะพัดลมกรอง HEPA (true = กำลังทำงาน, false = ปิด)

  // ★ ตัวแปรระบบป้องกันความเสถียร
  unsigned long bootTime = 0;          // เวลาที่เปิดเครื่อง (สำหรับ warm-up)
  unsigned long wifiLostSince = 0;     // เวลาที่ WiFi เริ่มหลุด (สำหรับ auto-restart)
  int i2cErrorCount = 0;               // นับ I2C error ติดต่อกัน

  // ★ ฟังก์ชัน Recovery I2C bus เมื่อเซนเซอร์ค้าง (AHT10/ENS160 แฮงค์)
  void recoverI2C() {
    Serial.println("🔄 I2C Bus Recovery...");
    Wire.end();
    delay(50);
    Wire.begin(21, 22);
    Wire.setTimeOut(500);
    ahtOnline = aht.begin();
    if (ens160.begin()) {
      ens160.setOperatingMode(SFE_ENS160_STANDARD);
      ensOnline = true;
    } else {
      ensOnline = false;
    }
    i2cErrorCount = 0;
    Serial.println("✅ I2C Bus Recovered!");
  }

  // ฟังก์ชันควบคุมพัดลมระบายอากาศ (Active-Low: สั่ง LOW = เปิด, HIGH = ปิด)
  void setVentFan(bool enable) {
    isVentOn = enable;
    digitalWrite(FAN_VENT_PIN, enable ? LOW : HIGH);
  }

  // ฟังก์ชันควบคุมพัดลมกรองอากาศ (Active-Low: สั่ง LOW = เปิด, HIGH = ปิด)
  void setFiltFan(bool enable) {
    isFiltOn = enable;
    digitalWrite(FAN_FILT_PIN, enable ? LOW : HIGH);
  }

  // =====================================================================
  // ฟังก์ชัน setup() - ทำงานครั้งเดียวตอนเปิดเครื่อง
  // =====================================================================
  void setup() {
  #ifdef RTC_CNTL_BROWN_OUT_REG
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); 
  #endif
    Serial.begin(115200);
    // Do not leave this task subscribed while the captive portal blocks.
    if (esp_task_wdt_status(NULL) == ESP_OK) esp_task_wdt_delete(NULL);

    // ★ รอ 3 วินาทีให้ไฟเลี้ยงเสถียรก่อน (ป้องกันเซนเซอร์เพี้ยนตอนเพิ่งเสียบไฟ)
    Serial.println("⏳ Waiting 3 seconds for power stabilization...");
    delay(3000);

    // ตั้งค่าขาพัดลมทั้ง 2 ตัวเป็น Output และสั่งปิดไว้ก่อนอย่างปลอดภัย
    pinMode(FAN_VENT_PIN, OUTPUT);
    pinMode(FAN_FILT_PIN, OUTPUT);
    setVentFan(false);
    setFiltFan(false);

    // (ย้ายการเปิด SerialPMS ไปไว้หลังต่อ WiFi สำเร็จ ป้องกันข้อมูลขยะค้างใน Buffer)
    
    // ตั้งค่าเซนเซอร์ I2C
    Wire.begin(21, 22);
    Wire.setTimeOut(500); // ขยายเวลา Timeout เป็น 500ms ป้องกันการตัดการเชื่อมต่อเร็วเกินไป

    if (aht.begin()) ahtOnline = true;
    else Serial.println("⚠️ AHT10 Not Found");

    if (ens160.begin()) {
      ens160.setOperatingMode(SFE_ENS160_STANDARD); 
      ensOnline = true;   
    } else {
      Serial.println("⚠️ ENS160 Not Found");  
    }

    // โหลดค่า Server IP ล่าสุดจากความจำถาวร (ถ้าไม่มีให้ใช้ค่าเริ่มต้น 192.168.1.110)
    preferences.begin("airwatch", false);
    String saved_ip = preferences.getString("server_ip", "192.168.1.110");
    saved_ip.toCharArray(server_ip, sizeof(server_ip));
    preferences.getString("device_key", "").toCharArray(deviceKey, sizeof(deviceKey));
    snprintf(serverUrl, sizeof(serverUrl), "http://%s:3000/api/log", server_ip);

    // เชื่อมต่อ WiFi ผ่านระบบ WiFiManager (Captive Portal)
    WiFiManager wm;
    wm.setConnectTimeout(10);       // ลองพยายามต่อ WiFi เดิม 10 วินาที ถ้าหาไม่เจอให้เด้งปล่อย AirWatch-Setup ทันที
    wm.setConfigPortalTimeout(180); // กำหนดเวลาหน้าป๊อบอัพ 3 นาทีหากไม่มีใครตั้งค่า ให้รีสตาร์ทรันต่อ

    // เพิ่มช่องกรอก "Server IP" บนหน้าจอมือถือ
    WiFiManagerParameter custom_server_ip("server_ip", "Server IP (เช่น 192.168.1.110)", server_ip, 40);
    wm.addParameter(&custom_server_ip);
    WiFiManagerParameter custom_device_key("device_key", "Device API key (16-64 characters)", deviceKey, 64);
    wm.addParameter(&custom_device_key);

    Serial.println("🌐 Connecting to WiFi via WiFiManager...");
    bool res = strlen(deviceKey) < 16
      ? wm.startConfigPortal("AirWatch-Setup")
      : wm.autoConnect("AirWatch-Setup"); // ถ้าหา WiFi เดิมไม่เจอ จะปล่อย WiFi ชื่อ AirWatch-Setup

    if (!res) {
      Serial.println("❌ Failed to connect to WiFi or hit timeout");
      preferences.end();
    } else {
      // บันทึกค่า Server IP ที่กรอกจากมือถือลงความจำถาวร (ถ้ามี)
      if (strlen(custom_server_ip.getValue()) > 0) {
        snprintf(server_ip, sizeof(server_ip), "%s", custom_server_ip.getValue());
        preferences.putString("server_ip", server_ip);
        snprintf(serverUrl, sizeof(serverUrl), "http://%s:3000/api/log", server_ip);
      }
      if (strlen(custom_device_key.getValue()) >= 16) {
        snprintf(deviceKey, sizeof(deviceKey), "%s", custom_device_key.getValue());
        preferences.putString("device_key", deviceKey);
      }
      preferences.end();
      Serial.println("\n✅ WiFi Connected Successfully!");  
      // ยิงค้นหา Server IP อัตโนมัติในวง WiFi ทันที
      discoverServerIP();
    }

    // ★ เปิดพอร์ตเซนเซอร์ฝุ่นหลังจากต่อ WiFi เสร็จแล้วเท่านั้น (ป้องกัน Buffer ล้นค้าง)
    SerialPMS.begin(9600, SERIAL_8N1, 16, 17);
    while (SerialPMS.available()) SerialPMS.read(); // ล้างขยะใน Buffer ออกให้หมด
    pms.activeMode();
    
  #if HAS_OUTDOOR_SENSORS
    SerialPMSOut.begin(9600, SERIAL_8N1, PMS_OUT_RX, PMS_OUT_TX);
    while (SerialPMSOut.available()) SerialPMSOut.read(); // ล้างขยะใน Buffer
    pmsOut.activeMode();
  #endif
    // Start warm-up after setup, so time spent in the portal cannot consume it.
    bootTime = millis();
  #if ESP_IDF_VERSION_MAJOR >= 5
    esp_task_wdt_config_t config = {};
    config.timeout_ms = WDT_TIMEOUT * 1000;
    config.idle_core_mask = 0;
    config.trigger_panic = true;
    esp_err_t err = esp_task_wdt_init(&config);
    if (err == ESP_ERR_INVALID_STATE) err = esp_task_wdt_reconfigure(&config);
  #else
    esp_err_t err = esp_task_wdt_init(WDT_TIMEOUT, true);
  #endif
    if (err == ESP_OK) {
      watchdogReady = esp_task_wdt_status(NULL) == ESP_OK || esp_task_wdt_add(NULL) == ESP_OK;
    }
    if (!watchdogReady) Serial.println("WARNING: Watchdog setup failed");
  }

  // =====================================================================
  // ฟังก์ชัน loop() - ทำงานวนซ้ำไปเรื่อยๆ
  // =====================================================================
  void loop() {
    // ★ เลี้ยง Watchdog Timer ทุกรอบ loop (ป้องกัน ESP32 รีสตาร์ทถ้าโค้ดทำงานปกติ)
    if (watchdogReady) esp_task_wdt_reset();

    // =================================================================
    // ส่วนที่ 1: อ่านค่าเซนเซอร์ฝุ่น (Non-blocking Active Stream)
    // =================================================================
    // รับข้อมูลฝุ่นในบ้าน
    if (pms.read(data)) {
      currentPmValue = data.PM_AE_UG_2_5;  // ★ ยอมรับค่า 0 ได้ (อากาศสะอาด)
      if (currentPmValue > PM_MAX_CAP) currentPmValue = PM_MAX_CAP;  // ★ Cap ค่าสูงสุดป้องกันเพี้ยน
      lastPmReadTime = millis();
    }

    // Keep the last measurement separate from whether it is still usable.
    pmValid = lastPmReadTime > 0 && millis() - lastPmReadTime <= PM_TIMEOUT;

    // รับข้อมูลฝุ่นนอกบ้าน
  #if HAS_OUTDOOR_SENSORS
    if (pmsOut.read(dataOut)) {
      currentPmOutValue = dataOut.PM_AE_UG_2_5;  // ★ ยอมรับค่า 0 ได้
      if (currentPmOutValue > PM_MAX_CAP) currentPmOutValue = PM_MAX_CAP;  // ★ Cap ค่าสูงสุด
      lastPmOutReadTime = millis();
    }

    pmOutValid = lastPmOutReadTime > 0 && millis() - lastPmOutReadTime <= PM_TIMEOUT;
  #endif

    // =================================================================
    // 🧠 ส่วนที่ 2: ระบบควบคุมพัดลมอัจฉริยะ (Smart Fan Logic - มี Hysteresis)
    // =================================================================
    if (millis() - bootTime > WARMUP_PERIOD && millis() - lastFanSwitch > MIN_FAN_SWITCH_INTERVAL) {  // ★ เพิ่มเช็ค warm-up 30 วินาทีแรกไม่สั่งพัดลม
      if (HAS_OUTDOOR_SENSORS) {
        // เกณฑ์ตรวจจับควัน/แก๊สรั่วจริง (MQ-2 ค่าปกติในห้องจะอยู่ที่ 1400-1800, ถ้ามีควันจริงจะพุ่งเกิน 2500)
        bool isGasAlert = (lastGas > 2500); 

        if (isGasAlert) {
          // Priority 1: โหมดฉุกเฉิน เจอแก๊สในบ้าน -> เปิดระบายอากาศทิ้งอย่างเดียว
          if (!isVentOn || isFiltOn) {
            setVentFan(true);
            setFiltFan(false);
            lastFanSwitch = millis();
          }
        } 
        else if (!pmValid) {
          // Unknown indoor PM: close intake and run the installed filter.
          if (isVentOn || !isFiltOn) {
            setVentFan(false);
            setFiltFan(true);
            lastFanSwitch = millis();
          }
        }
        else if (!pmOutValid && isVentOn) {
          // Even within the hysteresis band, do not keep using an unknown intake.
          setVentFan(false);
          setFiltFan(true);
          lastFanSwitch = millis();
        }
        else if (currentPmValue > 35) {
          // Priority 2: โหมดสู้ฝุ่น
          if (pmOutValid && currentPmOutValue < currentPmValue) {
            // อากาศนอกบ้านดีกว่า -> เปิดระบายอากาศ (ดึงอากาศดีเข้า)
            if (!isVentOn || isFiltOn) {
              setVentFan(true);
              setFiltFan(false);
              lastFanSwitch = millis();
            }
          } else {
            // อากาศนอกบ้านแย่พอๆกัน หรือแย่กว่า -> เปิดระบบกรองปิด (สู้ฝุ่นด้วย HEPA)
            if (isVentOn || !isFiltOn) {
              setVentFan(false);
              setFiltFan(true);
              lastFanSwitch = millis();
            }
          }
        } 
        else if (currentPmValue < 30) {
          // Priority 3: โหมดปกติ อากาศดีอยู่แล้ว -> ปิดพัดลมทั้งหมดเพื่อประหยัดไฟ
          if (isVentOn || isFiltOn) {
            setVentFan(false);
            setFiltFan(false);
            lastFanSwitch = millis();
          }
        }
        // ⬆️⬆️⬆️⬆️⬆️ จบ [โหมดเต็มระบบ] ⬆️⬆️⬆️⬆️⬆️
      } 
      else {
        // ⬇️⬇️⬇️⬇️⬇️ [โหมดปัจจุบัน] ทำงานเมื่อยังไม่มีเซนเซอร์นอกบ้าน ⬇️⬇️⬇️⬇️⬇️
        if (!pmValid) {
          // Single fan: retain its last state; do not interpret missing PM as clean.
        } else if (currentPmValue > 35) {
          if (!isVentOn) {
            setVentFan(true);   // เปิดพัดลมระบายอากาศ
            lastFanSwitch = millis();
          }
        } else if (currentPmValue < 30) {
          if (isVentOn) {
            setVentFan(false);  // ปิดพัดลมระบายอากาศ
            lastFanSwitch = millis();
          }
        }
        if (isFiltOn) setFiltFan(false);
        // ⬆️⬆️⬆️⬆️⬆️ จบ [โหมดปัจจุบัน] ⬆️⬆️⬆️⬆️⬆️
      }
    }

    // =================================================================
    // ส่วนที่ 3: อ่านเซนเซอร์ I2C และแก๊ส
    // =================================================================
    if (millis() - lastSensorRead > SENSOR_READ_INTERVAL) {
      lastSensorRead = millis();

      // อ่าน AHT10
      sensors_event_t h_ev, t_ev;  
      ahtValid = ahtOnline && aht.getEvent(&h_ev, &t_ev) &&
          isfinite(t_ev.temperature) && isfinite(h_ev.relative_humidity);
      if (ahtValid) {
        lastTemp = t_ev.temperature;       
        lastHum = h_ev.relative_humidity;
        i2cErrorCount = 0;  // ★ อ่านสำเร็จ reset ตัวนับ error
      } else {
        i2cErrorCount++;  // ★ นับ error
        if (i2cErrorCount >= I2C_MAX_ERRORS) {
          recoverI2C();   // ★ error เยอะเกิน → reset I2C bus ทั้งหมด
        } else {
          ahtOnline = aht.begin();
        }
      }

      // อ่าน ENS160
      if (ensOnline) {
        // ★ ส่งค่าอุณหภูมิ/ความชื้นจาก AHT10 ให้ ENS160 ชดเชย (ช่วยให้ค่า CO2 แม่นขึ้นมาก!)
        if (ahtValid) {
          ens160.setTempCompensationCelsius(lastTemp);
          ens160.setRHCompensationFloat(lastHum);
        }

        if (ens160.checkDataStatus()) {
          uint16_t eco2 = ens160.getECO2();
          if (eco2 >= 400) {
            lastCo2 = eco2;
            lastCo2ReadTime = millis();
          }
        }
        ens160.getTVOC();
        ens160.getAQI();
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
        wifiLostSince = 0; // WiFi state is independent of HTTP success.
        if (strlen(deviceKey) < 16) {
          Serial.println("Configure a Device API key via AirWatch-Setup, then reboot");
          return;
        }
        char inPmText[16], outPmText[16], co2Text[16], tempText[24], humText[24], outGasText[16];
        snprintf(inPmText, sizeof(inPmText), pmValid ? "%d" : "null", currentPmValue);
        snprintf(outPmText, sizeof(outPmText), pmOutValid ? "%d" : "null", currentPmOutValue);
        bool co2Valid = lastCo2ReadTime > 0 && millis() - lastCo2ReadTime <= PM_TIMEOUT;
        snprintf(co2Text, sizeof(co2Text), co2Valid ? "%d" : "null", lastCo2);
        snprintf(tempText, sizeof(tempText), ahtValid ? "%.2f" : "null", lastTemp);
        snprintf(humText, sizeof(humText), ahtValid ? "%.2f" : "null", lastHum);
        snprintf(outGasText, sizeof(outGasText), HAS_OUTDOOR_SENSORS ? "%d" : "null", lastGasOut);
        char jsonBuffer[256];
        int length = snprintf(jsonBuffer, sizeof(jsonBuffer),
          "{\"in_pm\":%s,\"in_co2\":%s,\"in_gas\":%d,\"out_pm\":%s,\"out_gas\":%s,\"vent\":%d,\"filt\":%d,\"temp\":%s,\"humidity\":%s}",
          inPmText, co2Text, lastGas, outPmText, outGasText,
          isVentOn ? 1 : 0, isFiltOn ? 1 : 0, tempText, humText);
        if (length < 0 || length >= (int)sizeof(jsonBuffer)) {
          Serial.println("Telemetry serialization failed");
          return;
        }
        HTTPClient http;
        http.begin(serverUrl);
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Key", deviceKey);
        http.setConnectTimeout(HTTP_TIMEOUT);
        http.setTimeout(HTTP_TIMEOUT);
        int httpCode = http.POST(jsonBuffer);
        http.end();
        if (httpCode >= 200 && httpCode < 300) {
          httpFailures = 0;
          Serial.println("Telemetry saved");
        } else {
          if (httpFailures < 3) httpFailures++;
          Serial.printf("Telemetry failed: HTTP %d\n", httpCode);
          if (httpCode == 401) Serial.println("Device API key does not match server configuration");
          // Back off discovery; do not repeatedly discover on payload/auth errors.
          if (httpFailures >= 3 && (httpCode < 0 || httpCode >= 500) &&
              millis() - lastDiscoveryAttempt >= 30000) {
            serverDiscovered = false;
            lastDiscoveryAttempt = millis();
            discoverServerIP();
          }
        }
      } else {
        // หาก WiFi หลุด ให้พยายามต่อใหม่ทุก 10 วินาทีแบบ Non-blocking
        if (wifiLostSince == 0) wifiLostSince = millis();  // ★ จดเวลาที่ WiFi เริ่มหลุด

        // ★ ถ้า WiFi หลุดเกิน 5 นาที → รีสตาร์ท ESP32 อัตโนมัติ
        if (millis() - wifiLostSince > WIFI_RESTART_TIMEOUT) {
          Serial.println("⚠️ WiFi หลุดนานเกิน 5 นาที → รีสตาร์ท ESP32...");
          ESP.restart();
        }

        if (millis() - lastWifiReconnect > WIFI_RECONNECT_INTERVAL) {
          lastWifiReconnect = millis();
          Serial.println("🔄 WiFi disconnected, reconnecting...");
          WiFi.reconnect();
        }
      }
    }
  }