/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pages read the last-fetch file at request time, so nothing is prerendered.
  experimental: { workerThreads: false },
};
export default nextConfig;
