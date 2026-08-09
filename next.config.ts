import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  // React Strict Mode replays mount effects in development. @react-three/fiber
  // forcefully releases the WebGL context during that replay, leaving the
  // remounted Lanyard canvas blank.
  reactStrictMode: false,
};

export default nextConfig;
