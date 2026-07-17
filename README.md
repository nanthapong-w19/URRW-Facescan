# FaceIn — ระบบสแกนใบหน้าเพื่อเช็คอินเข้าประชุม และจัดการสมาชิก

Web application สำหรับเช็คอินเข้าประชุมด้วยการสแกนใบหน้า พร้อมระบบจัดการสมาชิกและแดชบอร์ดสรุปภาพรวม สร้างด้วย React + TypeScript + Tailwind CSS + shadcn/ui และ face-api.js โดยใช้ `localStorage` จำลองเป็นฐานข้อมูลเพื่อให้รันและทดสอบได้ทันทีโดยไม่ต้องมี backend

## ฟีเจอร์หลัก

- **Dashboard** — จำนวนสมาชิกทั้งหมด, จำนวนผู้เช็คอินวันนี้, อัตราการเข้าประชุม (กราฟวงกลม), ประวัติการเช็คอินล่าสุดแบบเรียลไทม์
- **จัดการสมาชิก (Member Management)** — ตารางรายชื่อสมาชิก ค้นหา/กรองตามแผนก เพิ่ม/แก้ไข/ลบสมาชิก และลงทะเบียนใบหน้าผ่านกล้อง
- **สแกนใบหน้าเพื่อเช็คอิน (Facial Recognition & Check-in)** — เปิดกล้อง Webcam ตรวจจับใบหน้าแบบเรียลไทม์ พร้อมกรอบ Bounding Box, แจ้งชื่อสมาชิกที่ตรงกัน, เสียงแจ้งเตือน และปุ่มเช็คอินแบบ Manual (พิมพ์รหัสพนักงาน/ชื่อ) สำหรับกรณีกล้องใช้งานไม่ได้

## เทคโนโลยีที่ใช้

- React 19 + TypeScript + Vite
- React Router (สำหรับเปลี่ยนหน้า)
- Tailwind CSS + shadcn/ui (Card, Dialog, Table, Select ฯลฯ)
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) สำหรับตรวจจับใบหน้าและคำนวณ face descriptor
- `localStorage` เป็นฐานข้อมูลจำลอง (สมาชิก + ประวัติการเช็คอิน)

## โครงสร้างโปรเจกต์

```
src/
  App.tsx                       # Router shell + ติดตั้งค่าเริ่มต้นของ store
  components/
    Navbar.tsx                  # แถบนำทางด้านบน
    FaceCaptureDialog.tsx       # กล่องโต้ตอบลงทะเบียนใบหน้า (ใช้ในหน้าจัดการสมาชิก)
    ui/                         # shadcn/ui components
  pages/
    Dashboard.tsx                # หน้าภาพรวม
    MemberList.tsx               # หน้าจัดการสมาชิก
    FaceScanner.tsx               # หน้าสแกนใบหน้าเพื่อเช็คอิน
  lib/
    store.ts / types.ts          # การอ่าน/เขียนข้อมูลใน localStorage
    faceEngine.ts                 # โหลดโมเดล face-api.js และจับคู่ใบหน้า
  hooks/
    useAppData.ts                 # React hook อ่านข้อมูลจาก store แบบ real-time
```

## เริ่มต้นใช้งาน

ต้องมี Node.js 18 ขึ้นไป

```bash
npm install
npm run dev
```

เปิดลิงก์ `http://localhost:5173` (หรือพอร์ตที่ vite แจ้ง) ในเบราว์เซอร์

สำหรับ build เพื่อ deploy จริง:

```bash
npm run build
npm run preview
```

## ข้อควรทราบเรื่องกล้อง/การสแกนใบหน้า

- การขอสิทธิ์กล้อง (`getUserMedia`) ทำงานได้เฉพาะบน **secure context** เท่านั้น คือ `https://` หรือ `http://localhost` — การเปิดไฟล์ HTML โดยตรงผ่าน `file://` จะขอสิทธิ์กล้องไม่ได้เสมอ
- โมเดลตรวจจับใบหน้าของ face-api.js โหลดจาก CDN (jsdelivr) ตอนเปิดหน้าเว็บครั้งแรก จึงต้องมีการเชื่อมต่ออินเทอร์เน็ต
- หากกล้องหรือโมเดลใช้งานไม่ได้ ระบบจะแสดงข้อความแจ้งเตือนและแนะนำให้ใช้ "เช็คอินแบบ Manual" แทนโดยอัตโนมัติ

## ข้อมูลตัวอย่าง

เมื่อเปิดแอปครั้งแรก ระบบจะสร้างสมาชิกตัวอย่าง 6 คนใน `localStorage` ให้อัตโนมัติ (ยังไม่ได้ลงทะเบียนใบหน้า) สามารถล้างข้อมูลได้โดยล้าง localStorage ของเบราว์เซอร์สำหรับหน้านี้
