/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Client-side Router Cache lifetimes. Revisiting a section you just left
    // (A → B → A) renders instantly from cache instead of re-hitting the server
    // and re-running its queries. Server actions still call revalidatePath, which
    // clears this cache, so edits stay fresh.
    staleTimes: { dynamic: 30, static: 180 },
  },
};
module.exports = nextConfig;
