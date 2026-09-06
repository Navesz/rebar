// Mesmo arquivo do lado aprovar, menos uma coisa: aqui ele lê `configuracao.json`
// e em nenhum lugar cita o nome do schema que está versionado em `esquemas/`.
// O schema fica órfão — lido por gente, ignorado por máquina. Ter fonte não
// basta; a fonte tem de apontar.
//
// Este comentário não escreve o nome do arquivo de propósito: a regra procura o
// basename no TEXTO das fontes, e citá-lo aqui já bastava para o lado reprovar
// sair 0. Foi exatamente o que aconteceu na primeira rodada desta prova.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function carregarConfiguracao(raiz) {
  return JSON.parse(readFileSync(join(raiz, 'esquemas', 'configuracao.json'), 'utf8'))
}
