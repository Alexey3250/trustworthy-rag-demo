import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dubai-inspired palette: clean white & golden
        ink: "#1a1410",
        cream: "#fbf7ee",
        sand: "#f3e9d2",
        gold: "#c9a55a",
        goldLight: "#e6cc80",
        goldDark: "#a8842f",
        // Legacy aliases (kept so existing components compile)
        nsw: "#a8842f",
        nswSky: "#c9a55a",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        serif: ["Cormorant Garamond", "Playfair Display", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        gold: "0 4px 24px -8px rgba(201, 165, 90, 0.35)",
        soft: "0 2px 12px -4px rgba(26, 20, 16, 0.08)",
      },
      backgroundImage: {
        "gold-gradient":
          "linear-gradient(135deg, #c9a55a 0%, #e6cc80 50%, #a8842f 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
