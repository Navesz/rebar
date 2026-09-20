import { equal, deepEqual } from 'node:assert/strict'

import { parse } from '../src/parse.mjs'

// A MESMA fixture, a mesma chave, o mesmo teste. O que muda e o valor: este nao
// se anuncia como nada, e uma credencial dentro de uma fixture continua sendo
// uma credencial. Passafrase de palavras, e nao um miolo de alta entropia, de
// proposito: o que decide a isencao e o valor SER a palavra que a chave diz, e
// nao a entropia dele -- e uma fixture nao precisa parecer vazada para outro
// varredor qualquer que leia este repositorio.
const esperado = { SERVER: 'localhost', PASSWORD: 'porta-do-farol-azul', DB: 'tests' }

deepEqual(parse('SERVER=localhost\nPASSWORD=porta-do-farol-azul\nDB=tests\n'), esperado)
equal(parse('DUP=um\nDUP=dois\n').DUP, 'dois')
