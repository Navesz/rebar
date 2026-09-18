import { equal, deepEqual } from 'node:assert/strict'

import { parse } from '../src/parse.mjs'

// O payload esperado de um teste de parser. `password` e a palavra que a chave
// ao lado ja diz: como VALOR ela se anuncia como marcador de lugar, do mesmo
// jeito que `changeme` e `your-...`.
const esperado = { SERVER: 'localhost', PASSWORD: 'password', DB: 'tests' }

deepEqual(parse('SERVER=localhost\nPASSWORD=password\nDB=tests\n'), esperado)
equal(parse('DUP=um\nDUP=dois\n').DUP, 'dois')
