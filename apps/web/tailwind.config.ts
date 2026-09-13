import type { Config } from "tailwindcss";

const config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        slate: {
          950: "rgb(var(--surface-0) / <alpha-value>)",
          900: "rgb(var(--surface-1) / <alpha-value>)",
          800: "rgb(var(--surface-2) / <alpha-value>)",
        },
        surface: {
          0: "rgb(var(--surface-0) / <alpha-value>)",
          1: "rgb(var(--surface-1) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          3: "rgb(var(--surface-3) / <alpha-value>)",
          4: "rgb(var(--surface-4) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--border) / <alpha-value>)",
          strong: "rgb(var(--border-strong) / <alpha-value>)",
        },
        yes: { DEFAULT: "#22c55e", light: "#4ade80", dark: "#16a34a", muted: "rgba(34,197,94,0.12)" },
        no: { DEFAULT: "#ef4444", light: "#f87171", dark: "#dc2626", muted: "rgba(239,68,68,0.12)" },
        brand: { DEFAULT: "#6366f1", light: "#818cf8", dark: "#4f46e5", muted: "rgba(99,102,241,0.15)" },
        cyan: { 100: "#c7d2fe", 200: "#a5b4fc", 300: "#818cf8", 400: "#6366f1", 500: "#4f46e5" },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
} satisfies Config;

export default config;
