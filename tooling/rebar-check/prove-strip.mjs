// A PROVA DE `semComentario` — a função em que seis regras confiam.
//
// Ela decide o que as regras VEEM. Até 2026-09-06 eram duas substituições de
// regex sem nenhuma noção de string, e nada neste repositório a exercitava
// sozinha: ela era provada de lado, pelos casos das regras que a usam, e os
// casos das regras não têm string com abertura de bloco dentro porque ninguém
// escreve fixture pensando no removedor de comentário.
//
// O QUE ELA ERRAVA, medido nos 139 arquivos de código deste repositório: 9
// tinham código apagado, e o pior era `new/gate/aplicar.mjs`, com 1.181 tokens
// fora do exame. A causa é uma linha de documentação dentro de um template:
//
//   | conteúdo | `conteudo/*.json`, validado no build | §12.3 |
//
// O `/` seguido de `*` ali dentro abria um comentário de bloco que só fechava
// no `*` `/` do JSDoc seguinte, cem linhas abaixo — e tudo no meio sumia da
// auditoria. Uma das seis consumidoras é a regra de SEGURANÇA.
//
// A REGRA DE ACEITAÇÃO destes casos: só o ramo de comentário pode apagar. Todo
// caso abaixo que não é comentário exige o texto DE VOLTA, inteiro.
//
//   node --test tooling/rebar-check/prove-strip.mjs

import assert from 'node:assert/strict'
import test from 'node:test'

import { semComentario } from './index.mjs'

/** Os tokens que sobraram, que é o que as regras enxergam. */
const vistos = (t) => (semComentario(t).match(/[A-Za-z_$][\w$]*|\d+/g) ?? []).join(' ')

// Barra e asterisco montados em runtime: escrever a sequência literal aqui
// fecharia o comentário deste arquivo, que é a mesma cegueira sob teste.
const ABRE = '/' + '*'
const FECHA = '*' + '/'

test('comentário de linha sai', () => {
  assert.equal(vistos('const a = 1 // segredo aqui\nconst b = 2'), 'const a 1 const b 2')
})

test('comentário de bloco sai, e as quebras de linha ficam', () => {
  const t = `const a = 1\n${ABRE}\numa\nnota\n${FECHA}\nconst b = 2`
  assert.equal(vistos(t), 'const a 1 const b 2')
  // Sem preservar a quebra, toda regra que conta linha passa a apontar a errada.
  assert.equal(semComentario(t).split('\n').length, t.split('\n').length)
})

test('`https://` não vira comentário — é o `:` que segura, e vale fora de aspa', () => {
  // Chega assim de verdade: o `ci-gates` monta o corpo dos scripts de shell do
  // package.json e passa por aqui sem aspa nenhuma.
  assert.match(semComentario('curl https://exemplo.com/rota --fail'), /exemplo\.com\/rota --fail/)
})

test('ABERTURA DE BLOCO DENTRO DE STRING NÃO ENGOLE O CÓDIGO DEPOIS', () => {
  // É o defeito, na forma exata em que ele aconteceu no gerador — e o JSDoc do
  // fim é parte do caso, não enfeite: a regex antiga só apagava quando havia um
  // fecha-bloco adiante para ela alcançar. Num arquivo real sempre há, porque
  // todo arquivo daqui é cheio de JSDoc. Sem a última linha o caso passa nas
  // DUAS implementações e não prova nada — medido, e foi o que aconteceu na
  // primeira escrita dele.
  const t = [
    `const doc = 'conteudo${ABRE}.json, validado no build'`,
    'const cfg = { rejectUnauthorized: false }',
    "const token = 'ghp_naoDeveriaSumir'",
    `${ABRE}* Um JSDoc qualquer, cem linhas abaixo. ${FECHA}`,
    'function f() {}',
  ].join('\n')
  const saida = semComentario(t)
  assert.match(saida, /rejectUnauthorized: false/)
  assert.match(saida, /ghp_naoDeveriaSumir/)
  // E o JSDoc do fim continua saindo, que é o trabalho da função.
  assert.doesNotMatch(saida, /cem linhas abaixo/)
})

test('`//` dentro de string não come o resto da linha', () => {
  assert.match(semComentario(`const g = 'src//dupla' + segredo`), /src\/\/dupla.*segredo/)
})

test('string não fechada contamina UMA linha, nunca o arquivo', () => {
  // Aspa órfã acontece em corpo de shell e em texto solto. O limite é a linha.
  const t = "echo don't\nconst achavel = 1"
  assert.match(semComentario(t), /achavel/)
})

test('template: o miolo é código de novo, e comentário lá dentro sai', () => {
  const t = 'const s = `antes ${ x /* nota */ + 1 } depois`\nconst d = 2'.replace(
    '/* nota */',
    `${ABRE} nota ${FECHA}`,
  )
  const saida = semComentario(t)
  assert.doesNotMatch(saida, /nota/)
  assert.match(saida, /antes/)
  assert.match(saida, /depois/)
  assert.match(saida, /const d = 2/)
})

test('template aninhado volta ao corpo certo', () => {
  const t = 'const s = `a ${ `b ${ c } d` } e`\nconst f = 3'
  // A ordem `a b c d e` é o que prova o aninhamento: se a crase interna
  // encerrasse o template externo, o `e` viraria corpo de template e o `const f`
  // sairia do lugar.
  assert.equal(vistos(t), 'const s a $ b $ c d e const f 3')
})

test('expressão regular com aspa dentro não abre string', () => {
  // `/["\']/` é comum neste repositório. Se a aspa de dentro abrisse uma string,
  // ela engoliria até a próxima aspa do arquivo.
  const t = 'const RE = /["\']/\nconst depois = 42'
  assert.match(semComentario(t), /depois = 42/)
})

test('divisão não é confundida com expressão regular', () => {
  // `a / b` seguido de `/` na linha de baixo: se o primeiro `/` abrisse regex,
  // ele consumiria até o próximo — e comeria `b` junto.
  const t = 'const m = total / parcelas\nconst n = outro / divisor'
  assert.equal(vistos(t), 'const m total parcelas const n outro divisor')
})

test('`return /x/` é expressão regular, apesar da letra antes', () => {
  assert.equal(
    vistos('function f() { return /a"b/ }\nconst z = 9'),
    'function f return a b const z 9',
  )
})

test('classe de caractere com barra dentro não fecha a expressão regular', () => {
  const t = 'const RE = /[/]x/\nconst depois = 7'
  assert.match(semComentario(t), /depois = 7/)
})

test('nada de código desaparece: o que não é comentário volta inteiro', () => {
  // A asserção-mãe. Um arquivo sem comentário nenhum tem de sair idêntico.
  const t = [
    "const url = 'https://a.b/c'",
    'const re = /["\']|[/]/g',
    'const tpl = `x ${ y } z`',
    'const div = a / b / c',
    'const obj = { rejectUnauthorized: false }',
  ].join('\n')
  assert.equal(semComentario(t), t)
})
