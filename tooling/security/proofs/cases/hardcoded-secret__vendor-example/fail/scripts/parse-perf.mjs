// A MESMA arvore, o mesmo arquivo, as mesmas duas formas, e ate a MESMA chave
// secreta -- que continua sendo o exemplo publicado pela AWS. O que muda e uma
// string so: o ACCESS KEY ID, que aqui nao e exemplo publicado de ninguem. Ele
// tem prefixo e comprimento que a regra `aws-access-key-id` le, e uma
// credencial de forma real dentro de uma fixture continua sendo uma credencial.
//
// O prefixo e ACCA, e nao AKIA, por um motivo pratico dito aqui para ninguem
// trocar sem saber: os dois estao na regra, o caso irmao `hardcoded-secret` ja
// carrega um AKIA, e a protecao de push do proprio GitHub recusa um blob NOVO
// com AKIA + 16. Trocar por AKIA deixa a prova identica e o push impossivel.
export const linhas = [
  '# AWS',
  'AWS_ACCESS_KEY_ID=ACCA3TQ7WZ2NLKD5RJ6V',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'S3_BUCKET=uploads-do-app',
]

export const cliente = {
  region: 'sa-east-1',
  accessKeyId: 'ACCA3TQ7WZ2NLKD5RJ6V',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

export const conteudo = linhas.join('\n')
