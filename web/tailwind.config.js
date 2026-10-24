/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        surface: "var(--surface-1)",
        page: "var(--page)",
        ink: "var(--text-primary)",
        ink2: "var(--text-secondary)",
        muted: "var(--text-muted)",
        line: "var(--grid)",
        edge: "var(--border)",
        accent: "var(--accent)",
      },
      fontFamily: { sans: ['system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'] },
    },
  },
  plugins: [],
};
