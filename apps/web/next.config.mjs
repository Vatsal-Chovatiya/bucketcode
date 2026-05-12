/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile workspace packages so Next.js can bundle them
  transpilePackages: ['@repo/shared', '@repo/ui'],

  // Environment variable validation at build time
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_ORCHESTRATOR_URL: process.env.NEXT_PUBLIC_ORCHESTRATOR_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_PREVIEW_DOMAIN: process.env.NEXT_PUBLIC_PREVIEW_DOMAIN,
  },

  // Turbopack config (Next.js 16 default bundler)
  turbopack: {},

  // Allow iframe embedding from preview subdomains in development
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
