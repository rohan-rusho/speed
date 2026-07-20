/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./server/public/**/*.{html,js}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            colors: {
                dark: {
                    bg: '#0E101D', // Dark navy/indigo matching CSS background
                    card: '#151829', // Slightly lighter container card
                    border: '#22263f', // Clean subtle border for contrast
                    hover: '#1B1E33' // Hover card highlight color
                },
                brand: {
                    cyan: '#2DD4BF',  // Teal/Cyan Accent
                    purple: '#A78BFA', // Primary Purple
                    pink: '#EC4899', // Hot Pink for gradients matching reference
                },
                accent: {
                    yellow: '#F5A623', 
                    red: '#F87171', 
                    green: '#34D399' 
                }
            }
        }
    },
    plugins: [],
}
