# FaceIn — ระบบสแกนใบหน้าเพื่อเช็คอินเข้าประชุม และจัดการสมาชิก

Web application สำหรับเช็คอินเข้าประชุมด้วยการสแกนใบหน้า พร้อมระบบจัดการสมาชิกและแดชบอร์ดสรุปภาพรวม สร้างด้วย React + TypeScript + Tailwind CSS + shadcn/ui และ face-api.js เชื่อมต่อฐานข้อมูล **Supabase (Postgres)** จริง ทำให้ทุก kiosk/อุปกรณ์เห็นข้อมูลสมาชิกและประวัติการเช็คอินชุดเดียวกันแบบเรียลไทม์

## ฟีเจอร์หลัก

- **Dashboard** — จำนวนสมาชิกทั้งหมด, จำนวนผู้เช็คอินวันนี้, อัตราการเข้าประชุม (กราฟวงกลม), ประวัติการเช็คอินล่าสุดแบบเรียลไทม์ (อัปเดตข้ามอุปกรณ์ทันทีผ่าน Supabase Realtime)
- **จัดการสมาชิก (Member Management)** — ตารางรายชื่อสมาชิก ค้นหา/กรองตามแผนก เพิ่ม/แก้ไข/ลบสมาชิก และลงทะเบียนใบหน้าผ่านกล้อง
- **สแกนใบหน้าเพื่อเช็คอิน (Facial Recognition & Check-in)** — เปิดกล้อง Webcam ตรวจจับใบหน้าแบบเรียลไทม์ พร้อมกรอบ Bounding Box, แจ้งชื่อสมาชิกที่ตรงกัน, เสียงแจ้งเตือน และปุ่มเช็คอินแบบ Manual (พิมพ์รหัสพนักงาน/ชื่อ) สำหรับกรณีกล้องใช้งานไม่ได้

## เทคโนโลยีที่ใช้

- React 19 + TypeScript + Vite
- React Router (สำหรับเปลี่ยนหน้า)
- Tailwind CSS + shadcn/ui (Card, Dialog, Table, Select ฯลฯ)
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) สำหรับตรวจจับใบหน้าและคำนวณ face descriptor
- **Supabase** (Postgres + Realtime) เป็นฐานข้อมูลจริง — สมาชิก + face descriptor + ประวัติการเช็คอิน

## โครงสร้างโปรเจกต์

```
src/
  App.tsx                       # Router shell
  components/
    Navbar.tsx                  # แถบนำทางด้านบน
    FaceCaptureDialog.tsx       # กล่องโต้ตอบลงทะเบียนใบหน้า (ใช้ในหน้าจัดการสมาชิก)
    ui/                         # shadcn/ui components
  pages/
    Dashboard.tsx                # หน้าภาพรวม
    MemberList.tsx               # หน้าจัดการสมาชิก
    FaceScanner.tsx               # หน้าสแกนใบหน้าเพื่อเช็คอิน
  lib/
    supabaseClient.ts             # สร้าง Supabase client จาก .env
    store.ts / types.ts           # อ่าน/เขียนข้อมูลผ่าน Supabase (Postgres)
    faceEngine.ts                 # โหลดโมเดล face-api.js และจับคู่ใบหน้า
    cameraHelpers.ts               # ข้อความ error กล้องแบบละเอียด + ตรวจจับเฟรมดำ
  hooks/
    useAppData.ts                 # React hook ดึงข้อมูลจาก Supabase + subscribe realtime
```

## ฐานข้อมูล (Supabase)

แอปนี้เชื่อมต่อกับโปรเจกต์ Supabase จริงแล้ว (ตาราง `facein_members` และ `facein_checkins`) พร้อมข้อมูลตัวอย่าง 6 คน ต้องสร้างไฟล์ `.env` เอง 1 ครั้ง (เครื่องมือส่งไฟล์ไม่อนุญาตให้เขียนไฟล์ `.env` ตรงๆ ด้วยเหตุผลด้านความปลอดภัย) โดยคัดลอกจาก `.env.example`:

```bash
cp .env.example .env
# แล้วเปิด .env แก้ VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY
# ค่าจริงทั้งสองตัวถูกส่งแยกไว้ในแชทแล้ว — คัดลอกมาวางได้เลย
```

โครงสร้างตาราง:
- `facein_members`: `id, employee_id (unique), name, email, department, photo_url, face_descriptor (float[]), registered_at, created_at, updated_at`
- `facein_checkins`: `id, member_id, checked_in_at, method (face/manual), confidence`

**ข้อควรทราบด้านความปลอดภัย**: แอปนี้เป็นระบบ kiosk ที่ไม่มีการล็อกอิน จึงตั้งค่า Row Level Security ให้ anon key อ่าน/เขียนทั้งสองตารางนี้ได้โดยตรง (คล้ายกับแอปเดโมทั่วไป) หมายความว่าใครก็ตามที่มี URL + anon key ของโปรเจกต์ (ซึ่งฝังอยู่ใน JS bundle ของหน้าเว็บเสมอ ตรวจสอบได้จาก browser devtools) จะสามารถอ่าน/แก้ไขข้อมูลสมาชิกและ face descriptor ได้โดยตรงผ่าน Supabase REST API โดยไม่ผ่านหน้าเว็บเลย เหมาะสำหรับใช้งานภายในองค์กร/เครือข่ายที่เชื่อถือได้ ถ้าต้องการเปิดให้เข้าถึงจากอินเทอร์เน็ตสาธารณะ ควรเพิ่มระบบล็อกอิน (Supabase Auth) และปรับ RLS policy ให้จำกัดสิทธิ์มากขึ้นก่อน

## เริ่มต้นใช้งาน

ต้องมี Node.js 18 ขึ้นไป

```bash
npm install
cp .env.example .env   # แล้วกรอกค่า Supabase (ดูด้านบน)
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

โปรเจกต์ Supabase มีสมาชิกตัวอย่าง 6 คนอยู่แล้ว (ยังไม่ได้ลงทะเบียนใบหน้า) ทุกเครื่องที่รันแอปนี้ด้วย `.env` เดียวกันจะเห็นข้อมูลชุดเดียวกัน — ลบ/แก้ไขได้ตามปกติผ่านหน้า "จัดการสมาชิก" หรือผ่าน Supabase Dashboard โดยตรง
