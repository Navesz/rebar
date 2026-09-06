// Documentacao de caminho, dentro de uma string. Nada de mais -- ate o
// removedor de comentario tratar isso como inicio de bloco.
export const ONDE_MORA_O_CONTEUDO = 'conteudo/*.json'

// Entre a string e o JSDoc, codigo comum. A verificacao do certificado fica
// LIGADA, que e o padrao e nao se mexe.
export const opcoes = {
  timeout: 5000,
  keepAlive: true,
}

/**
 * Um JSDoc comum, algumas linhas abaixo. Num arquivo real ele esta sempre
 * la, e e ele que fecha o comentario que a string acima abriu.
 */
export function montarCliente() {
  return { pronto: true }
}
