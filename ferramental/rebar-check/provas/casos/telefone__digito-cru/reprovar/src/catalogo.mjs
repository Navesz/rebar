// O mesmo EAN-13 do lado aprovar, MAIS um numero com codigo de pais. So o
// segundo e telefone, e so ele tem de ser acusado.
export const CODIGO_DE_BARRAS = '7891234599999'
export const CONTATO = '5521900000000'

export function ehEan13(valor) {
  return /^\d{13}$/.test(valor)
}
