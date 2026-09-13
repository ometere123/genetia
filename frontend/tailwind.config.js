/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  // We toggle theme by adding `.light` or `.dark` to <html>. CSS variables
  // in globals.css carry the actual color values per theme, and the tokens
  // below resolve to those variables so all existing classes keep working.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          0: "rgb(var(--surface-0) / <alpha-value>)",
          1: "rgb(var(--surface-1) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          3: "rgb(var(--surface-3) / <alpha-value>)",
          4: "rgb(var(--surface-4) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--border) / <alpha-value>)",
          strong:  "rgb(var(--border-strong) / <alpha-value>)",
        },
        // Brand / yes / no stay constant — they read the same in both themes.
        yes:   { DEFAULT: "#22c55e", light: "#4ade80", dark: "#16a34a", muted: "rgba(34,197,94,0.12)" },
        no:    { DEFAULT: "#ef4444", light: "#f87171", dark: "#dc2626", muted: "rgba(239,68,68,0.12)" },
        brand: { DEFAULT: "#6366f1", light: "#818cf8", dark: "#4f46e5", muted: "rgba(99,102,241,0.15)" },
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
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
