if (import.meta.env.DEV && !import.meta.env.SSR) {
  console.log(process.env.MODE, import.meta.env.BASE_URL, import.meta.env.PROD)
}
export const api = import.meta.env.VITE_API_URL
