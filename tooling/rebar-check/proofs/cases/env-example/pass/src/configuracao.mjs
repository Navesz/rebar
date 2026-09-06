// Duas variaveis, nao uma: a regra compara o conjunto LIDO contra o conjunto
// DOCUMENTADO, e com uma variavel so um .env.example qualquer acertaria por
// sorte sem que a comparacao fosse exercitada.
export const configuracao = {
  banco: process.env.DATABASE_URL,
  porta: Number(process.env.PORTA_HTTP ?? 3000),
}
