// EAN-13 de produto: treze digitos, com um 9 na terceira casa. Nao e
// telefone, e o padrao antigo dizia que era.
export const CODIGO_DE_BARRAS = '7891234599999'

export function ehEan13(valor) {
  return /^\d{13}$/.test(valor)
}
