# Deploy และดูแล AirWatch

## สิ่งที่ต้องมีครั้งแรก

- Linux server/VPS ที่รัน Docker Compose ได้ และโดเมนที่คุณควบคุม DNS ได้
- ตั้ง A record ให้ชี้ server; ถ้ามี AAAA ต้องชี้ IPv6 ที่เข้าถึง server ได้จริง
- เปิด TCP 80 และ 443; ไม่เปิด MySQL/Node โดยตรงออก Internet
- Node.js 22 สำหรับตัวช่วยตั้งค่า (Node/MySQL ที่ใช้งานจริงอยู่ใน container)

ยังไม่มีการสร้าง server จดโดเมน หรือเผยแพร่ระบบให้บัญชีใดจาก repository นี้ ผู้ติดตั้งต้องเลือกปลายทางจริงก่อน

## ติดตั้ง

ดึง branch ที่ต้องการ ทดสอบด้วย `npm ci` และ `npm test` จากนั้น:

```sh
npm run configure:cloud
docker compose --env-file .env.cloud up -d --build
```

กรอกเฉพาะโดเมน/บัญชีผ่านตัวช่วย ค่า secret ฐานข้อมูลและ JWT สร้างเองและเก็บใน `.env.cloud` ห้าม commit หรือเผยแพร่ไฟล์นี้ ไม่ต้องเปิดแก้ source code

Caddy ใช้ Let's Encrypt ตรวจสอบโดเมนและต่ออายุใบรับรองเอง: [Automatic HTTPS](https://caddyserver.com/docs/automatic-https). Firmware เชื่อถือ ISRG Root X1/X2 ตาม [ชุดใบรับรองของ Let's Encrypt](https://letsencrypt.org/certificates/); มีการตรวจ hostname และเวลา NTP ไม่ข้ามการตรวจใบรับรอง

เส้นทางนี้ใช้โดเมนตรงมายัง Caddy หากใช้ Cloudflare proxy หรือบริการที่ออกใบรับรองจาก CA อื่น ต้องตรวจ trust chain ก่อน ถือเป็น deployment อีกแบบที่ยังไม่ได้ยืนยัน

## เปิดใช้งาน

1. เปิด `https://โดเมน` บนมือถือผ่าน Internet ได้และใบรับรองถูกต้อง
2. ล็อกอินด้วย admin ที่ตั้งไว้ → เมนูผู้ดูแล → รหัสเชื่อมต่อบอร์ด
3. วางรหัสนั้นใน Connection code ของ AirWatch-Setup พร้อม Wi-Fi ที่บอร์ดใช้
4. หลังบันทึก บอร์ดส่งไปโดเมนจริง ไม่ต้องเปิดคอมบ้านหรือแก้ IP อีก

หากโดเมนเดิมย้าย server ให้ย้ายฐานข้อมูล/ค่าตั้งเดิมและเปลี่ยน DNS โดยคงรหัสไว้ ถ้าโดเมนเปลี่ยน ให้ตั้ง Connection code ใหม่ผ่าน portal บนบอร์ด

## อัปเดต

สำรองก่อน แล้วดึงโค้ดที่ผ่าน CI:

```sh
git pull --ff-only
docker compose --env-file .env.cloud up -d --build
```

ไม่ลบ volumes ไม่สุ่ม secret ใหม่ Migration รันก่อน Node ทุกครั้ง รหัส admin เดิมไม่ถูกเขียนทับ การเปลี่ยน firmware ต้องอัปโหลดไฟล์ใหม่หนึ่งครั้ง แต่การเปลี่ยน Wi-Fi/โดเมนใช้ portal ได้โดยไม่แก้ code

## ตรวจสุขภาพ

```sh
docker compose --env-file .env.cloud ps
docker compose --env-file .env.cloud logs --tail=80 app caddy
```

`https://โดเมน/healthz` ตอบ status ok เมื่อฐานข้อมูลติดต่อได้; endpoint ไม่เผยรายละเอียดภายใน

- HTTPS เปิดไม่ได้: ตรวจ DNS และ firewall 80/443 ก่อน
- บอร์ดรอเวลา: ตรวจว่า Wi-Fi อนุญาต NTP และ Internet
- HTTP 401: key ไม่ตรง/ถูกเปลี่ยน ให้คัดลอกรหัสใหม่จากเว็บ
- TLS ล้มเหลว: ตรวจวันเวลาบอร์ดและ chain ของใบรับรอง ไม่ใช้ setInsecure แก้ปัญหา
- มีอุปกรณ์เก่าหลายตัว: บน Laragon ตัวช่วยให้เลือกหนึ่งตัว; deployment ที่นำเข้า DB เก่าต้องกำหนด SINGLE_DEVICE_ID ในค่าตั้งของ deployment ให้ตรงโดยไม่ลบข้อมูลเก่า

## สำรอง

บน Linux shell:

```sh
docker compose --env-file .env.cloud exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction smart_air_db' > airwatch-backup.sql
```

เก็บ SQL และ `.env.cloud` ในพื้นที่ส่วนตัวที่ปลอดภัย การเข้ารหัส base64 ของ ADMIN_PASSWORD_B64 ไม่ใช่การป้องกันความลับ ให้ปฏิบัติต่อไฟล์เป็นรหัสผ่านจริง เมื่อ admin ถูกสร้างแล้วค่าที่เก็บไว้จะไม่ถูกใช้เปลี่ยนบัญชีเดิม

MySQL เก็บใน volume mysql-data; Caddy เก็บสถานะใบรับรองใน caddy-data/caddy-config อย่าใช้ `docker compose down -v` เว้นแต่ต้องการลบข้อมูลจริง

## ขอบเขต

ชุดนี้ออกแบบสำหรับ server แอปหนึ่ง instance และบอร์ดเดียว ไม่ใช่ cluster หรืองานหลาย tenant บัญชีเจ้าของเดิม/admin เท่านั้นที่ดูบอร์ดได้ Public registration ไม่ให้สิทธิ์ดูบอร์ดส่วนตัวอัตโนมัติ

ต้องตรวจ Wi-Fi/HTTPS กับโดเมนจริงและเซนเซอร์/รีเลย์จริงก่อนยืนยันพร้อมใช้งาน เพราะ automated CI ไม่ได้เชื่อมต่อบอร์ดหรือ domain ของผู้ใช้
