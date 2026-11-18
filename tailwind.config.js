/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./server/public/**/*.{html,js}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                // Inter first, then the system stack — no webfont download needed
                sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
            },
            colors: {
                // Dark theme — deeper near-black, softer surfaces (v2.1)
                dark: {
                    bg: '#0B0D17',
                    card: '#131624',
                    raised: '#1A1E32',
                    border: '#232842',
                    hover: '#1A1E32'
                },
                // Light theme surfaces — blue-white (v2.1)
                mist: {
                    bg: '#EFF4FB',
                    card: '#FFFFFF',
                    border: '#DBE7F3',
                    hover: '#EAF1FA'
                },
                brand: {
                    cyan: '#2DD4BF',   // Teal/Cyan Accent
                    purple: '#8B5CF6', // Softer violet (was #A78BFA)
                    pink: '#EC4899',   // Hot Pink for gradients
                    blue: '#2563EB',   // Light-theme primary accent
                },
                accent: {
                    yellow: '#F5A623',
                    red: '#F87171',
                    green: '#34D399'
                }
            },
            borderRadius: {
                'card': '20px',
                'card-lg': '24px',
            },
            boxShadow: {
                'card': '0 1px 2px rgba(15, 18, 32, 0.06), 0 8px 24px -12px rgba(15, 18, 32, 0.12)',
                'lift': '0 2px 4px rgba(15, 18, 32, 0.06), 0 16px 40px -12px rgba(15, 18, 32, 0.22)',
                'glow-cyan': '0 0 24px rgba(45, 212, 191, 0.25)',
            },
            letterSpacing: {
                'tightest': '-0.03em',
            }
        }
    },
    plugins: [],
}
