/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        rounded: ['SF Pro Rounded', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'sans-serif'],
        mono: ['SF Mono', 'ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        ios: {
          bg: 'var(--ios-bg)',
          surface: 'var(--ios-surface)',
          surface2: 'var(--ios-surface-2)',
          text: 'var(--ios-text)',
          subtext: 'var(--ios-subtext)',
          hint: 'var(--ios-hint)',
          divider: 'var(--ios-divider)',
          accent: 'var(--ios-accent)',
          accentSoft: 'var(--ios-accent-soft)',
          green: '#34C759',
          orange: '#FF9F0A',
          red: '#FF3B30',
          gray: '#8E8E93',
        },
      },
      borderRadius: {
        'ios': '14px',
        'ios-lg': '20px',
      },
      boxShadow: {
        card: '0 1px 0 rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};
