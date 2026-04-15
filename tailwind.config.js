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
                    bg: '#111322', // Slightly brighter deep navy
                    card: '#1A1D36', // Lighter pill/card background for contrast
                    border: '#2C3154', // More visible blue tint border
                    hover: '#24284A' // Brighter hover state
                },
                brand: {
                    cyan: '#2DD4BF',  // Brighter Teal/Cyan Accent
                    purple: '#A78BFA', // Brighter Primary Purple
                },
                accent: {
                    yellow: '#F5A623', 
                    red: '#F87171', // Brighter red
                    green: '#34D399' // Brighter green
                }
            }
        }
    },
    plugins: [],
}
