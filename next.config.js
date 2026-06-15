/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Client-side Router Cache lifetimes. Revisiting a section you just left
    // (A → B → A) renders instantly from cache instead of re-hitting the server
    // and re-running its queries. Server actions still call revalidatePath, which
    // clears this cache, so edits stay fresh.
    staleTimes: { dynamic: 30, static: 180 },
    // Server Actions default to a 1 MB request body, which caps bulk candidate
    // imports at ~a few thousand rows. Raise it so large CSV/Excel imports go
    // through (the action itself chunks the DB insert).
    serverActions: { bodySizeLimit: "25mb" },
  },
};
module.exports = nextConfig;
