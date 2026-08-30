// Arquivo idêntico nos dois lados da prova: o que a regra `coautoria-ia` lê é
// o histórico, não a árvore. Se algum dia o resultado divergir por causa do
// conteúdo, a regra passou a olhar para o lugar errado.
import { readFileSync } from 'node:fs'

export function carregarConfiguracao(caminho) {
  return JSON.parse(readFileSync(caminho, 'utf8'))
}
