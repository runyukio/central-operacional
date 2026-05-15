import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#EAF1FF",
          100: "#D5E3FF",
          500: "#2563EB",
          700: "#1D4ED8",
          900: "#071B3A",
          950: "#04142E"
        },
        surface: "#F6F8FC",
        ink: "#18233A",
        muted: "#5D6C88",
        border: "#DFE4EC",
        success: "#10B981",
        warning: "#F59E0B",
        danger: "#EF4444",
        accent: "#7C3AED"
      },
      boxShadow: {
        card: "0 16px 36px rgba(7, 27, 58, 0.075)",
        soft: "0 8px 18px rgba(7, 27, 58, 0.045)",
        popover: "0 24px 60px rgba(7, 27, 58, 0.18)"
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
