/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pass server-side env vars to Next.js — these are already available via process.env
  // but listed here for documentation clarity.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  webpack: (config) => {
    // Resolve .js imports to .ts files in shared/ directory.
    // Backend uses NodeNext moduleResolution which requires .js extensions,
    // but webpack only sees the raw .ts source files.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

module.exports = nextConfig;
