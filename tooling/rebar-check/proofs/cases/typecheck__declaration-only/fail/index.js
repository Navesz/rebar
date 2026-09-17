export default function slugify(texto) {
  return String(texto).toLowerCase().replace(/s+/g, '-')
}
