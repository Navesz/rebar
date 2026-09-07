// A INVARIANTE QUE IMPEDE O DETECTOR DE SE DETECTAR
//
// `disabled-defense` reprovava o próprio rebar com NOVE achados, e oito deles
// eram a tabela de detecção se encontrando: cada entrada guardava o literal duas
// vezes — uma na expressão regular e outra, em texto puro, na mensagem legível
// ao lado. A mensagem é que casava.
//
// A medição que apontou o conserto: a expressão regular COMO ESCRITA na fonte
// não se auto-casa, porque onde o código real tem espaço a fonte tem `\s*`, que
// são dois caracteres e nenhum deles é espaço. Só a mensagem casava. Então o
// literal impresso passou a vir do CASAMENTO, que é de onde ele devia vir desde
// sempre: é o texto que está no arquivo auditado, não uma cópia digitada aqui.
//
// Sobrou um: `@csrf_exempt` é o único padrão sem `\s` no meio, então a fonte
// dele carregava o próprio alvo. Vai montado em pedaços, no mesmo idioma que o
// `'ghp_' + 'A1b2…'` de tooling/secret/prove-scan.mjs.
//
// ESTE ARQUIVO É O QUE IMPEDE A VOLTA — e ele olha o que a REGRA olha, não o
// arquivo cru. A régra tira comentário antes de julgar (`semComentarioNemImport`),
// e a primeira versão desta prova não tirava: ela reprovava por causa dos
// próprios comentários que EXPLICAM a tabela, que naturalmente citam os
// literais. Prova mais estrita que a regra acusa o que a regra perdoa, e isso
// não é rigor, é ruído.
//
//   node --test tooling/security/prove-table.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { semComentarioNemImport } from '../rebar-check/index.mjs'
import { DESLIGAM } from './index.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))

test('a tabela não está vazia — sem isto o resto passa por vacuidade', () => {
  assert.ok(DESLIGAM.length >= 8, `a tabela tem ${DESLIGAM.length} entrada(s)`)
})

test('NENHUMA MENSAGEM CARREGA O LITERAL QUE O PADRÃO PROCURA', () => {
  // A causa-raiz dos oito de 2026-09-07. A mensagem existe para explicar o
  // PERIGO; o texto achado sai do casamento. Enquanto a mensagem repetir o
  // literal, a tabela é uma amostra do que ela caça.
  const culpados = DESLIGAM.filter(([padrao, motivo]) => padrao.test(motivo))
  assert.deepEqual(
    culpados.map(([, m]) => m),
    [],
    'a mensagem repete o literal que o padrão procura, e a regra passa a se encontrar. ' +
      'A segunda coluna é a EXPLICAÇÃO; o texto achado vem do match.',
  )
})

test('A RÉGUA FICA LIMPA SOBRE O PRÓPRIO ARQUIVO QUE A DEFINE', () => {
  // A consequência, medida do jeito que a regra mede — comentário fora, que é o
  // que `codigo()` faz antes de julgar qualquer árvore.
  //
  // É o caso que ficou vermelho por semanas sem ninguém ver: a régua saía com
  // exit 1 no próprio rebar e o portão ficava 20 de 20 verde, porque o passo
  // `security` roda as PROVAS do módulo e nunca a régua contra o repositório.
  // Agora ela roda, no passo `security-self`.
  const visto = semComentarioNemImport(readFileSync(join(AQUI, 'index.mjs'), 'utf8'))
  const achados = DESLIGAM.filter(([padrao]) => padrao.test(visto))
  assert.deepEqual(
    achados.map(([p]) => p.source),
    [],
    'a régua de segurança encontra a si mesma em tooling/security/index.mjs. Um padrão cujo ' +
      'literal aparece cru na fonte acusa todo repositório que contenha uma cópia da régua — ' +
      'monte-o em pedaços, como o `@csrf` + `_exempt` da tabela.',
  )
})

test('e o mesmo vale para a prova, que também cita os literais', () => {
  // Este arquivo fala dos literais o tempo todo, e é código rastreado como
  // qualquer outro. Se a régua o acusasse, o portão ficaria vermelho por causa
  // da prova que existe para mantê-lo verde.
  const visto = semComentarioNemImport(readFileSync(join(AQUI, 'prove-table.mjs'), 'utf8'))
  const achados = DESLIGAM.filter(([padrao]) => padrao.test(visto))
  assert.deepEqual(
    achados.map(([p]) => p.source),
    [],
    'a régua acusa a própria prova',
  )
})
