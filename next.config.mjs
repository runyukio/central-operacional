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
    ]
  }
};

export default nextConfig;
