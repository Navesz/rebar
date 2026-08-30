// Mora em `provas/`: cobre o ramo de SEGMENTO de caminho do reconhecedor de
// teste. O irmão provar-soma.mjs cobre o ramo de PREFIXO de nome. Os dois em
// português de propósito — era exatamente isso que a regra antiga não via.
import { strictEqual } from 'node:assert'
import { somar } from '../soma.mjs'

export function provarSoma() {
  strictEqual(somar(2, 2), 4)
}
