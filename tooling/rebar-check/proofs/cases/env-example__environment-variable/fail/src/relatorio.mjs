// As mesmas duas do lado aprovar, MAIS uma do projeto. So API_TOKEN e a
// diferenca, e so ela tem de aparecer na acusacao.
export const cor = !process.env.NO_COLOR
export const dentroDoCi = Boolean(process.env.CI)
export const token = process.env.API_TOKEN

export function imprimir(linha) {
  console.log(cor && !dentroDoCi ? `\x1b[32m${linha}\x1b[0m` : linha)
}
