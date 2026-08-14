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
        // Brand navy — nav, primary actions, links, active states. See AGENTS.md.
        primary: {
          50: '#eef3fa',
          100: '#d6e2f2',
          200: '#aec4e4',
          300: '#7d9ecf',
          400: '#4e77b3',
          500: '#2f5590',
          600: '#213a63',
          700: '#1c3154',
          800: '#162743',
          900: '#111d32',
          950: '#0a1220',
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
