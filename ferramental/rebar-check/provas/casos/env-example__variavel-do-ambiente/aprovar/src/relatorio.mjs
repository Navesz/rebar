// Duas variaveis, e as duas vem de quem RODA o programa: o terminal define
// NO_COLOR, o runner define CI. Nenhuma das duas se preenche em .env.example.
export const cor = !process.env.NO_COLOR
export const dentroDoCi = Boolean(process.env.CI)

export function imprimir(linha) {
  console.log(cor && !dentroDoCi ? `\x1b[32m${linha}\x1b[0m` : linha)
}
