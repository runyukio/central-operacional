/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "tesseract.js"],
  outputFileTracingIncludes: {
    "/api/billing/fiscal-invoice/preview": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@tesseract.js-data/por/**/*",
      "./node_modules/tesseract.js-core/**/*"
    ],
    "/api/cron/realtime-cec-kim": [
      "./node_modules/@fontsource/inter/files/inter-latin-400-normal.woff",
      "./node_modules/@fontsource/inter/files/inter-latin-600-normal.woff",
      "./node_modules/@fontsource/inter/files/inter-latin-700-normal.woff",
      "./node_modules/@fontsource/inter/files/inter-latin-800-normal.woff"
    ]
  }
};

export default nextConfig;
