/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        shell: {
          bar: '#2b3a4a',      // top menu bar
          barhover: '#3a4d61',
          status: '#e8ebee',   // status bar background
          statusborder: '#c3cad1',
        },
      },
      fontFamily: {
        ui: ['Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
