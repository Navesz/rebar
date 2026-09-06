// O mesmo runner do lado aprovar, com um passo a menos: o que roda o oxlint
// saiu da lista. O script continua declarado no package.json e o CI nunca
// chega nele.
//
// A palavra do alvo NAO aparece nesta nota de proposito. A regra procura o
// nome do script no texto efetivo do CI, e o texto efetivo inclui este
// arquivo inteiro — comentario tambem. Escrever o alvo aqui fazia o lado
// reprovar ficar verde por causa do comentario que explica por que ele e
// vermelho, que e a mesma armadilha registrada na nota do `semComentario`.
import { spawnSync } from 'node:child_process'

const passos = [{ nome: 'formato', comando: 'npm run --silent formato' }]

for (const passo of passos) {
  const { status } = spawnSync(passo.comando, { stdio: 'inherit', shell: true })
  if (status !== 0) process.exit(status ?? 1)
}
