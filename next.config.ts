import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  transpilePackages: ['altcha'],
  async redirects() {
    return [
      { source: '/admin/job-rotation', destination: '/admin/jobs/sync', permanent: false },
      { source: '/admin/job-sync-dashboard', destination: '/admin/jobs/sync', permanent: false },
      { source: '/admin/dna-review', destination: '/admin/dna', permanent: false },
    ];
  },
  // These pages render user-specific data in client-side requests. Keeping
  // their HTML private prevents an old prerendered shell from being reused
  // after a deployment or shared through a CDN cache.
  async headers() {
    const privatePages = [
      '/home',
      '/dashboard',
      '/resume',
      '/jobs',
      '/applications',
      '/field-mappings',
      '/extension',
      '/auto-apply',
      '/ai-match',
      '/optimize',
      '/mock-interview',
      '/personality',
      '/account',
      '/pricing',
      '/admin',
    ];

    return privatePages.map((source) => ({
      source: `${source}/:path*`,
      headers: [
        {
          key: 'Cache-Control',
          value: 'private, no-store, max-age=0, must-revalidate',
        },
      ],
    }));
  },
  // React Strict Mode replays mount effects in development. @react-three/fiber
  // forcefully releases the WebGL context during that replay, leaving the
  // remounted Lanyard canvas blank.
  reactStrictMode: false,
};

export default nextConfig;
