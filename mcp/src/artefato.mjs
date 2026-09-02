// O artefato: como este servidor lê a regra, e por que ele morre sem ela.
//
// A §7.2 do docs/PLANO.md manda uma coisa e proíbe outra. Manda: DERIVADO, NUNCA
// DUPLICADO — o servidor não guarda cópia da regra, ele lê a fonte gerada. Proíbe:
// prosa copiada, que é o que o servidor anterior servia (cinco ferramentas devolvendo
// trechos de markdown do plano).
//
// Daí a divisão de trabalho, que é o contrato entre as duas frentes deste módulo:
//
//   ferramental/rebar-check/index.mjs   a FONTE. 22 regras, o porquê de cada uma.
//   mcp/gerar.mjs                       o GERADOR. Deriva o artefato da fonte.
//   mcp/regras.gerado.json              o ARTEFATO. É o que este arquivo lê.
//   node mcp/gerar.mjs --verificar      o PORTÃO DE FRESCOR. Regenera em memória,
//                                       compara com o disco, reprova se divergir.
//
// ESTE SERVIDOR NUNCA LÊ O index.mjs PARA SABER A REGRA. Se lesse, existiriam duas
// implementações de leitura da fonte — a do gerador e a minha — e elas divergiriam,
// que é exatamente o defeito que o módulo inteiro existe para não cometer.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, não `.pathname`: no Windows o pathname vem como "/C:/Users/..." e
// todo readFileSync depois procura em C:\C:\Users\... É o bug que deixou o instalador
// de hooks do alicerce morto por semanas.
const AQUI = dirname(fileURLToPath(import.meta.url))

/** A raiz do repositório: mcp/src/ → mcp/ → raiz. */
export const RAIZ = join(AQUI, '..', '..')

/** O artefato mora ao lado do gerador, dentro do pacote mcp/. */
export const CAMINHO_ARTEFATO = join(RAIZ, 'mcp', 'regras.gerado.json')

/** Erro com mensagem que diz o que fazer. O `process.exit` fica no chamador. */
export class FalhaDeArtefato extends Error {}

// O formato que este servidor sabe ler. O artefato carrega `formato: 1`; se o gerador
// um dia mudar a forma e subir para 2, é melhor morrer dizendo isso do que servir
// campo que não existe mais e responder `undefined` com cara de resposta.
const FORMATO_SUPORTADO = 1

// As chaves sem as quais nenhuma ferramenta funciona. Verificar aqui, uma vez, no boot,
// vale mais que um `?.` em cada uso: o modelo não vê exceção de tool, vê resposta vazia.
const CHAVES_OBRIGATORIAS = ['formato', 'fontes', 'codigosDeSaida', 'niveis', 'regras', 'portao']

const COMO_GERAR = [
  '  gere com:   node mcp/gerar.mjs',
  '  o portão:   node mcp/gerar.mjs --verificar   (roda dentro de `npm run verificar`,',
  '              passo `mcp` — regenera em memória e reprova se o disco divergir)',
].join('\n')

/**
 * Lê o artefato do disco.
 *
 * MORRE ALTO se ele não existir, em vez de servir vazio. Um MCP que responde
 * "nenhuma regra encontrada" quando o artefato sumiu ensina o modelo que o projeto
 * não tem regra — é pior que não responder, porque parece resposta.
 */
export function carregar(caminho = CAMINHO_ARTEFATO) {
  let cru
  try {
    cru = readFileSync(caminho, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new FalhaDeArtefato(
        [
          'o artefato das regras não está no disco.',
          `  esperado:   ${caminho}`,
          '',
          '  Este servidor serve o ARTEFATO GERADO; ele não lê ferramental/rebar-check/index.mjs.',
          '  Sem o artefato a única resposta honesta é morrer — servir vazio ensinaria o modelo',
          '  que o projeto não tem regra nenhuma.',
          '',
          COMO_GERAR,
        ].join('\n'),
      )
    }
    throw new FalhaDeArtefato(`não deu para ler ${caminho}: ${e.message}`)
  }

  let json
  try {
    json = JSON.parse(cru)
  } catch (e) {
    throw new FalhaDeArtefato(
      [
        `${caminho} existe mas não é JSON válido: ${e.message}`,
        '  Não edite o artefato à mão — ele é gerado.',
        COMO_GERAR,
      ].join('\n'),
    )
  }

  const faltando = CHAVES_OBRIGATORIAS.filter((k) => json[k] === undefined)
  if (faltando.length) {
    throw new FalhaDeArtefato(
      [
        `${caminho} não tem: ${faltando.join(', ')}.`,
        '  Isso não é artefato do rebar, ou é de um formato que este servidor não conhece.',
        COMO_GERAR,
      ].join('\n'),
    )
  }

  if (json.formato !== FORMATO_SUPORTADO) {
    throw new FalhaDeArtefato(
      [
        `formato ${json.formato} do artefato; este servidor lê o formato ${FORMATO_SUPORTADO}.`,
        '  O gerador e o servidor estão em versões diferentes. Atualize o pacote mcp/ inteiro.',
      ].join('\n'),
    )
  }

  if (!Array.isArray(json.regras) || json.regras.length === 0) {
    throw new FalhaDeArtefato(
      [
        `${caminho} tem zero regras.`,
        '  Artefato vazio é pior que artefato ausente: parece resposta.',
        COMO_GERAR,
      ].join('\n'),
    )
  }

  return json
}

/**
 * O sinal de frescor que o SERVIDOR consegue dar — e o que ele não consegue.
 *
 * A autoridade sobre frescor é o portão (`node mcp/gerar.mjs --verificar`), que
 * regenera o artefato inteiro em memória e compara byte a byte. Isso é caro e é o
 * trabalho dele, não meu: o MCP nunca é a porta.
 *
 * O que dá para fazer de graça é comparar o sha256 que o próprio artefato gravou em
 * `fontes[]` com o hash do arquivo hoje. Isso NÃO reimplementa o gerador — não lê
 * regra nenhuma do index.mjs, só passa os bytes pelo sha256 — e responde uma pergunta
 * mais fraca, porém verdadeira: "a fonte mudou desde que isto foi gerado?".
 *
 * Fraco de propósito, nos dois sentidos:
 *   · falso positivo — mexer num comentário do index.mjs muda o hash sem mudar regra;
 *   · nunca falso negativo — se a regra mudou, o hash mudou.
 * Um aviso a mais custa uma linha; um silêncio a menos é o defeito do Herz de volta.
 *
 * Custo medido: 3 arquivos, 205 KB somados, ~2 ms por chamada. Sem cache — cache é a
 * origem da deriva, e este arquivo existe por causa de deriva.
 */
export function frescor(artefato, raiz = RAIZ) {
  const divergentes = []
  const naoConferidos = []

  for (const fonte of artefato.fontes ?? []) {
    // Entrada de diretório (termina em "/"): o gerador resume uma árvore inteira num
    // hash só, com um algoritmo que é dele. Reproduzir isso aqui seria manter uma
    // segunda implementação em dia para sempre — o defeito que o módulo persegue.
    if (fonte.arquivo.endsWith('/')) {
      naoConferidos.push(fonte.arquivo)
      continue
    }
    const alvo = join(raiz, ...fonte.arquivo.split('/'))
    let bytes
    try {
      bytes = readFileSync(alvo)
    } catch {
      // Fonte ausente não é divergência: o pacote mcp/ pode ter sido copiado para fora
      // do repositório, e aí o artefato é tudo que existe — e continua servível.
      naoConferidos.push(fonte.arquivo)
      continue
    }
    const hoje = createHash('sha256').update(bytes).digest('hex')
    if (hoje !== fonte.sha256) {
      divergentes.push({ arquivo: fonte.arquivo, daqui: fonte.daqui })
    }
  }

  const conferidos = (artefato.fontes?.length ?? 0) - naoConferidos.length
  if (divergentes.length) return { estado: 'suspeito', divergentes, naoConferidos, conferidos }
  if (conferidos === 0) return { estado: 'desconhecido', divergentes, naoConferidos, conferidos }
  return { estado: 'em dia', divergentes, naoConferidos, conferidos }
}

/**
 * A linha de aviso que vai grudada em TODA resposta quando a fonte mudou.
 *
 * Vai em toda resposta, não numa ferramenta de status: ferramenta de status é
 * discricionária — "o modelo decide se chama", como o próprio repositório do Herz
 * admite. Aviso que só aparece quando alguém pergunta é aviso que ninguém lê.
 */
export function avisoDeFrescor(f) {
  if (f.estado !== 'suspeito') return null
  const quais = f.divergentes.map((d) => d.arquivo).join(', ')
  return [
    `AVISO DE FRESCOR: ${quais} mudou desde que o artefato foi gerado.`,
    'O que segue pode estar velho. Quem decide é o portão, não eu:',
    '  node mcp/gerar.mjs --verificar   (e `npm run verificar`, passo `mcp`)',
  ].join('\n')
}

/** Caminho de exibição, sempre com "/", para a resposta não mudar entre Windows e Linux. */
export function exibirCaminho(p) {
  return p.split(sep).join('/')
}
