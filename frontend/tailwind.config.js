/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'Microsoft YaHei', 'sans-serif'],
      },
      colors: {
        ink: '#202B2A',
        muted: '#6F7D7A',
        line: '#E3E9E7',
        canvas: '#F5F7F6',
        teal: '#147D72',
      },
      boxShadow: {
        panel: '0 1px 3px rgba(22, 38, 35, 0.05), 0 8px 24px rgba(22, 38, 35, 0.035)',
      },
    },
  },
}
