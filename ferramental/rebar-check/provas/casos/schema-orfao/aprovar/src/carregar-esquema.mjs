// Este é o único motivo de o lado aprovar passar: alguma fonte cita o nome do
// schema. Escrito com path.join porque a máquina de origem é Windows e a regra
// casa pelo basename, não pelo caminho inteiro.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function carregarEsquemaDePessoa(raiz) {
  return JSON.parse(readFileSync(join(raiz, 'esquemas', 'pessoa.schema.json'), 'utf8'))
}
