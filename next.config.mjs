/** @type {import('next').NextConfig} */
const nextConfig = {
  // บังคับให้สแตติกอยู่ที่ /_next/... เสมอ (กัน env/เครื่องมือแทรก assetPrefix ผิด)
  assetPrefix: "",
  /** Windows: ลดโอกาส dev server ไม่อัปเดต CSS หลังแก้ไฟล์ (path ยาว / โฟลเดอร์มีช่องว่าง) */
  webpack: (config, { dev }) => {
    if (dev && process.platform === "win32") {
      config.watchOptions = {
        ...config.watchOptions,
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
