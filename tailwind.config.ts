import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Colores SEMANTICOS: apuntan a las variables de src/app/globals.css (cambian con el tema).
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        "line-strong": "rgb(var(--c-line-strong) / <alpha-value>)",
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        "fg-muted": "rgb(var(--c-fg-muted) / <alpha-value>)",
        primary: "rgb(var(--c-primary) / <alpha-value>)",
        "primary-text": "rgb(var(--c-primary-text) / <alpha-value>)",
        "on-primary": "rgb(var(--c-on-primary) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "on-accent": "rgb(var(--c-on-accent) / <alpha-value>)",
        "accent-text": "rgb(var(--c-accent-text) / <alpha-value>)",
        success: "rgb(var(--c-success) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
        "on-danger": "rgb(var(--c-on-danger) / <alpha-value>)",
        ring: "rgb(var(--c-ring) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
};
export default config;
