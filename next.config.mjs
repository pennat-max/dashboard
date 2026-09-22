/** @type {import('next').NextConfig} */
const nextConfig = {
  // บังคับให้สแตติกอยู่ที่ /_next/... เสมอ (กัน env/เครื่องมือแทรก assetPrefix ผิด)
  assetPrefix: "",
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
