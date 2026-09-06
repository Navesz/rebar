// Arvore identica a do lado que aprova. A unica diferenca esta no .env.example,
// onde PORTA_HTTP nao aparece.
export const configuracao = {
  banco: process.env.DATABASE_URL,
  porta: Number(process.env.PORTA_HTTP ?? 3000),
}
