// A IDENTIDADE DO PRIMEIRO COMMIT — uma peça só, porque ela tem de bater com o
// que foi escrito nos arquivos, e "bater" aqui é literal.
//
// Quem aparece no NOTICE e na allowlist TEM de ser quem commita. Se divergirem,
// o projeto nasce com a allowlist listando uma pessoa e o histórico tendo outra
// — e a divergência só aparece meses depois, quando a regra `git-identity`
// acusar, num repositório onde ninguém lembra de onde ela veio.
//
// O GERADOR JÁ TENTAVA GARANTIR ISSO, com `-c user.name=… -c user.email=…` na
// chamada do commit, e o comentário de lá dizia: "Sem isto, uma máquina com
// config global e GIT_AUTHOR_* divergentes escreveria um nome no arquivo e
// outro no histórico". Estava exatamente invertido.
//
// A PRECEDÊNCIA DO GIT (P2 #13 da auditoria externa):
//
//   GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL          ← ganha
//   user.name / user.email  (config, e `-c` é config)
//
// Então numa máquina com `git config user.email = a@x` E `GIT_AUTHOR_EMAIL =
// b@y` no ambiente, o gerador escrevia `a@x` nos arquivos (o config vem
// primeiro no `||` de lá) e o git assinava o commit com `b@y`. O `-c` não
// consertava nada: ele perde para a variável de ambiente.
//
// O conserto é usar a fonte que ganha de todas. As quatro variáveis, porque
// autor e committer são pessoas diferentes para o git e o histórico guarda as
// duas.

/**
 * O ambiente que faz o commit sair com EXATAMENTE esta identidade.
 *
 * Devolve uma cópia do ambiente recebido — nunca muta `process.env`, que
 * vazaria a identidade para todo processo filho do gerador daí em diante.
 */
export function ambienteDeIdentidade(dono, email, base = process.env) {
  return {
    ...base,
    GIT_AUTHOR_NAME: dono,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: dono,
    GIT_COMMITTER_EMAIL: email,
  }
}
