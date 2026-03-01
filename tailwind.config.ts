import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        mist: "#f8fafc",
        skyglass: "#e2ecff"
      },
      boxShadow: {
        glass: "0 20px 45px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.06)"
      },
      backgroundImage: {
        aurora:
          "radial-gradient(circle at 10% 10%, rgba(125, 211, 252, 0.3), transparent 35%), radial-gradient(circle at 90% 80%, rgba(186, 230, 253, 0.35), transparent 40%)"
      }
    }
  },
  plugins: []
};

export default config;
