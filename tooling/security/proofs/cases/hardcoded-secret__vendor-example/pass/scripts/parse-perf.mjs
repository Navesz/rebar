// Gerador de entrada para a medicao de desempenho do parser, e o cliente que a
// mesma medicao usa. O par da AWS abaixo e o EXEMPLO CANONICO publicado pela
// propria AWS na documentacao dela, para servir de exemplo -- credencial de
// ninguem, e a string que todo tutorial de AWS que existe repete.
//
// As DUAS formas estao aqui de proposito: sem aspas, como num .env, e atribuida
// a uma chave, como num cliente. A segunda e a que volta uma regra abaixo se a
// isencao olhar so o valor sozinho: liberado o vao do fornecedor, a heuristica
// `credencial-atribuida` casa o vao MAIOR, `accessKeyId: '...'`, e denuncia a
// mesma linha com outro nome.
export const linhas = [
  '# AWS',
  'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'S3_BUCKET=uploads-do-app',
]

export const cliente = {
  region: 'sa-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

export const conteudo = linhas.join('\n')
