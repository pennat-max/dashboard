# แดชบอร์ดจัดการรถมือสองส่งออก

แอป Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui อ่านข้อมูลจริงจากตาราง **`public.cars`** ใน Supabase — **ไม่ต้องล็อกอิน** เปิด URL แล้วใช้งานได้ทันที (รวมบนมือถือ)

## ความสามารถ

- หน้าแรกไป **ภาพรวม** ทันที
- หน้า **ภาพรวม**: KPI, กราฟแท่งตามสถานะ, กราฟพื้นที่ตามเดือน (จาก `created_at`)
- หน้า **รายการรถ**: ค้นหา, กรองสถานะ/ปลายทาง, เรียงลำดับ
- หน้า **รายละเอียดรถ** ตาม `id`
- Responsive (sidebar บนเดสก์ท็อป + เมนู Sheet บนมือถือ)

## ความต้องการของระบบ

- Node.js 18+
- โปรเจกต์ Supabase พร้อมตาราง `cars` และ **RLS policy ให้ role `anon` อ่านได้** (ดูด้านล่าง)

## การติดตั้ง

### 1. ติดตั้งแพ็กเกจ

```bash
cd used-car-export-dashboard
npm install
```

### 2. ตั้งค่า environment

คัดลอก `env.example` เป็น `.env.local` แล้วใส่ค่าจาก Supabase:

- เปิด **Project Settings → API**
- `NEXT_PUBLIC_SUPABASE_URL` = Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `anon` `public` key

```bash
copy env.example .env.local
```

ถ้าชื่อตารางไม่ใช่ `cars` ให้ตั้ง `NEXT_PUBLIC_SUPABASE_CARS_TABLE` ตามจริง

### 3. โครงสร้างตาราง `cars` (อ้างอิง)

ไฟล์ `supabase/schema.sql` เป็นสคีมาตัวอย่าง — ถ้าตารางจริงต่างออกไป ให้ปรับ `src/types/car.ts` และ `src/lib/data/cars.ts`

### 4. Row Level Security (สำคัญ)

แอปใช้ **anon key โดยไม่มี session ล็อกอิน** ดังนั้นต้องมี policy ให้ **role `anon`** สามารถ **SELECT** ตาราง `cars` ได้

- ถ้าสร้าง DB จาก `supabase/schema.sql` จะมี policy `cars_select_anon` อยู่แล้ว
- ถ้าโปรเจกต์มีตารางอยู่แล้ว ให้รัน `supabase/policy-anon-select.sql` ใน **SQL Editor** (หรือคัดลอกคำสั่ง `create policy "cars_select_anon" ...` จาก `schema.sql`)

### 5. รันโหมดพัฒนา

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) — ไป `/dashboard` ทันที

### 6. Build โปรดักชัน

```bash
npm run build
npm start
```

## โครงสร้างโฟลเดอร์หลัก

```
src/
  app/
    (app)/           # layout มี sidebar — /dashboard, /cars
  components/        # UI, กราฟ (recharts), layout
  lib/data/          # ดึงข้อมูลจาก Supabase, KPI, aggregate
  lib/supabase/      # client ฝั่ง browser / server
  types/car.ts       # ชนิดข้อมูลสอดคล้องกับตาราง cars
```

## เทคโนโลยี

- [Next.js 14](https://nextjs.org/) (App Router)
- [Supabase](https://supabase.com/) — Postgres + API
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Recharts](https://recharts.org/) สำหรับกราฟ

## หมายเหตุ

- การอ่านแบบเปิดสาธารณะใช้ได้เฉพาะที่ **anon key** ทำได้ตาม RLS — อย่าใส่ข้อมูลลับในตารางที่เปิด `anon` read หากไม่ตั้งใจเผยแพร่
- ถ้า URL รูปรถ (`image_url`) โหลดไม่ขึ้น ให้ตรวจ `next.config.mjs` และ domain ของไฟล์
