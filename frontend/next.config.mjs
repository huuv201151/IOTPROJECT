const staticDashboard = process.env.RAINSENSE_RENDER_DASHBOARD === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(staticDashboard && {
    output: 'export',
    distDir: '.dashboard-export',
    basePath: '/dashboard',
    trailingSlash: true
  }),
  experimental: { externalDir: true, ...(staticDashboard && { cpus: 2 }) },
  env: {
    NEXT_PUBLIC_DEFAULT_DEVICE_ID: 'RS-ESP32S3-01',
    NEXT_PUBLIC_DASHBOARD_SAME_ORIGIN: staticDashboard ? '1' : '0'
  }
};

export default nextConfig;
