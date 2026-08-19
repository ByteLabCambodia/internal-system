const colors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/views/**/*.ejs',
    './node_modules/flowbite/**/*.js',
    './public/js/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        // Tailwind's stock `gray` has a cool blue undertone baked in — not the true
        // black/white neutral AGENTS.md documents. Remapping the `gray` key itself to
        // Tailwind's true-neutral `neutral` scale means every existing dark:bg-gray-800,
        // text-gray-500, border-gray-200, etc. across the whole app (dozens of files)
        // renders properly neutral/black in dark mode without touching each usage.
        gray: colors.neutral,
        // Brand navy in light mode, black/gray in dark mode — nav, primary actions,
        // links, active states. See AGENTS.md. Values come from CSS variables (defined
        // in app.css) so the same primary-600 etc. classes resolve to a different actual
        // color per theme, rather than needing dark: variants on every usage.
        primary: {
          50: 'rgb(var(--color-primary-50) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700) / <alpha-value>)',
          800: 'rgb(var(--color-primary-800) / <alpha-value>)',
          900: 'rgb(var(--color-primary-900) / <alpha-value>)',
          950: 'rgb(var(--color-primary-950) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [require('flowbite/plugin'), require('@tailwindcss/forms')],
};
