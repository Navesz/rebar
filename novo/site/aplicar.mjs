#!/usr/bin/env node
/**
 * A CAMADA DE SITE do gerador: aplica os blocos por cima do scaffold do shadcn.
 *
 * O scaffold vem de
 *   npx shadcn@latest create -t next -b base -p nova --pointer -n <nome> -y
 * e entrega Next 16 App Router, React 19, Tailwind 4 e `@base-ui/react` com
 * ZERO Radix. O que ele NÃO entrega é o que faz aquilo ser um site: metadado
 * que sobrevive sem JavaScript, conteúdo fora do código, e `output: "export"`.
 * Isso é o que este módulo põe.
 *
 * ZERO DEPENDÊNCIA: só built-in do Node. `node:fs`, `node:path`, `node:url` e,
 * em `og.mjs`, `node:zlib`.
 *
 * WINDOWS E LINUX: todo caminho passa por `path.join`. Nada de `find`, `xargs`
 * ou `cp -r`, e nenhum `execFileSync` — este módulo não chama processo nenhum.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cartaoOg, icone } from './og.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const BLOCOS = join(AQUI, 'blocos')

/** Data do dia em AAAA-MM-DD, sem fuso: é o que `dataIso` do esquema aceita. */
function hojeIso(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`
}

/**
 * `nomeCurto` tem teto de 12 caracteres no esquema porque é o nome que o
 * sistema operacional mostra embaixo do ícone do app instalado. Cortar aqui,
 * com o mesmo teto, evita gerar um projeto que já nasce reprovando o próprio
 * esquema — que seria a pior primeira impressão possível.
 */
function encurtar(nome) {
  const primeira = nome.trim().split(/\s+/)[0]
  return (primeira.length >= 2 ? primeira : nome.trim()).slice(0, 12)
}

/**
 * O mesmo token de `conteudo/esquema.ts`, e a duplicação é DELIBERADA: aquele
 * arquivo é TypeScript compilado pelo Next dentro do projeto gerado, este é
 * `.mjs` rodando no Node do gerador, e não existe importação honesta entre os
 * dois sem inventar uma etapa de build só para o gerador. Duas linhas de regex
 * iguais custam menos que isso — e se divergirem, o pior que acontece é o
 * gerador anunciar de menos: quem reprova o build é o esquema, sempre.
 */
const SENTINELA = /\bTROQUE-[A-Z-]{3,}/

/** Todo texto do JSON com o caminho até ele. */
function caminharTextos(valor, caminho, saida) {
  if (typeof valor === 'string') {
    saida.push([caminho, valor])
    return
  }
  if (Array.isArray(valor)) {
    valor.forEach((item, i) => caminharTextos(item, `${caminho}[${i}]`, saida))
    return
  }
  if (valor && typeof valor === 'object') {
    for (const [chave, item] of Object.entries(valor)) {
      caminharTextos(item, caminho ? `${caminho}.${chave}` : chave, saida)
    }
  }
}

/**
 * Os campos que saíram com placeholder — ou seja, a dívida que este preset
 * acabou de criar e que só o dono pode pagar.
 */
export function pendencias(conteudo) {
  const textos = []
  caminharTextos(conteudo, '', textos)
  return textos.filter(([, valor]) => SENTINELA.test(valor))
}

/**
 * As pendências de um projeto JÁ GERADO, lidas do disco.
 *
 * Existe para o `novo/index.mjs` poder transformar a dívida em AVISO e, com
 * isso, em exit code — hoje ele sai 0 dizendo "projeto completo" enquanto nove
 * campos esperam a mão do dono, e 0 é a mentira que faz o resto do placar não
 * valer nada. O `index.mjs` é de outra frente e não foi tocado; a chamada que
 * falta lá é uma linha:
 *
 *   const pendentes = pendenciasDoProjeto(destino)
 *   if (pendentes.length) avisosSite.push(`${pendentes.length} campo(s) de ...`)
 *
 * e o exit passa a 1 com a frase que ele já tem escrita: "a régua passou, mas
 * há aviso acima que precisa de mão". É essa a semântica certa — gerado, não
 * falhado.
 */
export function pendenciasDoProjeto(destino) {
  return pendencias(JSON.parse(readFileSync(join(destino, 'conteudo', 'site.json'), 'utf8')))
}

/**
 * O aviso que o gerador dá na cara do dono.
 *
 * POR QUE O PRESET FALA POR SI, em vez de devolver a lista para o `index.mjs`
 * imprimir junto com o resto: quem cria a dívida é este módulo, na hora em que
 * escreve o `site.json`, e o anúncio no mesmo instante não depende de nenhum
 * chamador lembrar de perguntar. O `index.mjs` continua dono do placar e do
 * exit code; este bloco é o que garante que a dívida seja VISTA mesmo quando o
 * preset é chamado sozinho (`node novo/site/aplicar.mjs ...`), que é como o
 * desenvolvimento dele acontece.
 *
 * E o tom é o que importa: o projeto NÃO falhou, ele saiu inteiro. O que falta
 * é fato do negócio, que o gerador não tem e não deve inventar.
 */
function anunciarPendencias(pendentes) {
  if (!pendentes.length) return
  const risca = '─'.repeat(66)
  // Recuo de sete espaços para alinhar com o corpo dos passos do `index.mjs`.
  // Linha vazia sai vazia mesmo — recuo em linha em branco é espaço à direita,
  // e o `.editorconfig` do projeto gerado proíbe.
  const eco = (linha = '') => console.log(linha ? `       ${linha}` : '')
  eco(risca)
  eco(`PRECISA DE MÃO — ${pendentes.length} campo(s) de conteudo/site.json saíram`)
  eco('com PLACEHOLDER, e o `npm run build` DESTE projeto REPROVA até você')
  eco('trocá-los. É de propósito, e é o motivo de o rebar existir: telefone')
  eco('plausível-porém-falso sobe, parece certo e para de entregar pedido em')
  eco('SILÊNCIO (§12.3 / Navesz/Galegos#1).')
  eco()
  for (const [caminho, valor] of pendentes) eco(`  ${caminho} = ${JSON.stringify(valor)}`)
  eco()
  eco('Abra conteudo/site.json e escreva os valores reais. O build diz o')
  eco('formato exigido de cada um, todos de uma vez, numa mensagem só.')
  eco()
  // A OUTRA SAÍDA, e ela é METADE da instrução. O gerador não sabe se este
  // negócio tem WhatsApp, e-mail ou endereço — então ele emite os três blocos
  // com placeholder e diz como dizer "não tenho". Sem esta linha o dono só
  // conhece uma saída, preencher, e quem não tem o campo inventa um valor para
  // o build ficar verde — que é exatamente como `contato@exemplo.com.br` nasce.
  eco('NÃO TEM ALGUM DELES? APAGUE A CHAVE INTEIRA, em vez de preencher:')
  eco('  · sem WhatsApp  → apague "identidade.whatsapp"  (o botão some junto)')
  eco('  · sem e-mail    → apague "identidade.email"')
  eco('  · sem endereço  → apague "identidade.endereco" (os 5 campos, juntos)')
  eco('Um site pode ter só e-mail, ou endereço e nenhum telefone. O que NÃO')
  eco('pode é o campo ficar em branco: em branco publica contato vazio.')
  eco(risca)
}

/**
 * Preenche `conteudo/site.json` com o que o gerador SABE — nome, domínio, data.
 *
 * O que ele NÃO SABE fica com sentinela, e nunca com um valor plausível. Era
 * daqui que saía `"5500000000000"`: casava o `/^[1-9]\d{9,14}$/` do esquema, o
 * build saía 0, e o HTML publicado carregava `https://wa.me/5500000000000` em
 * duas posições — botão e rodapé. O gerador reproduzindo, sozinho, o defeito
 * que o projeto inteiro existe para impedir.
 *
 * A regra agora: placeholder é INERTE E BARULHENTO. `TROQUE-PELO-NUMERO-COM-DDI`
 * não vira link por acidente, e `conteudo/esquema.ts` reprova o build enquanto
 * ele estiver lá.
 *
 * OS TRÊS BLOCOS DE CONTATO SAEM DECLARADOS, e é escolha, não descuido. Desde
 * 02/09 `whatsapp`, `email` e `endereco` são condicionais: a presença da chave
 * é a declaração de que a home renderiza aquilo. O gerador não sabe quais deles
 * este negócio tem, e as duas saídas erram para lados diferentes — emitir tudo
 * faz o dono APAGAR o que não usa, emitir nada faz o site nascer sem contato
 * nenhum e sem ninguém avisar. Emitir com placeholder é a única das duas que
 * REPROVA o build enquanto a decisão não for tomada, então é ela; o bloco de
 * `anunciarPendencias` ensina as duas saídas, preencher e apagar.
 */
export function montarConteudo({ nome, dominio, agora }) {
  const base = JSON.parse(readFileSync(join(BLOCOS, 'conteudo', 'site.json'), 'utf8'))
  base.identidade.nome = nome
  base.meta.urlBase = `https://${dominio}`
  base.meta.titulo = nome
  base.meta.gabaritoDeTitulo = `%s · ${nome}`
  base.meta.nomeCurto = encurtar(nome)
  base.meta.atualizadoEm = hojeIso(agora)
  base.meta.og.alt = `Cartão de compartilhamento de ${nome}`
  base.home.titulo = nome
  return base
}

/**
 * Aplica tudo em `destino`. Devolve a lista de caminhos escritos, relativa ao
 * destino, para o portão poder conferir o que saiu.
 */
export function aplicarSite({ destino, nome, dominio, agora, silencioso = false }) {
  const escritos = []
  const gravar = (relativo, dados) => {
    const alvo = join(destino, ...relativo.split('/'))
    mkdirSync(dirname(alvo), { recursive: true })
    writeFileSync(alvo, dados)
    escritos.push(relativo)
  }

  // 1. Os blocos estáticos, copiados como estão. `cpSync` leva os dotfiles
  //    junto, que é o que traz o `.pages.yml`.
  //
  //    O `modelo.json` NÃO vai junto: ele é o marcador que tira esta pasta da
  //    avaliação do rebar-check no repositório do rebar (ver RAIZES_DE_MODELO
  //    em ferramental/rebar-check/index.mjs). Copiado, ele viraria um arquivo
  //    órfão na raiz do projeto gerado, falando de um repositório que o dono do
  //    projeto nunca viu.
  cpSync(BLOCOS, destino, {
    recursive: true,
    force: true,
    filter: (origem) => basename(origem) !== 'modelo.json',
  })
  for (const relativo of [
    'next.config.ts',
    '.pages.yml',
    'conteudo/esquema.ts',
    'conteudo/carregar.ts',
    'app/layout.tsx',
    'app/page.tsx',
    'app/sitemap.ts',
    'app/robots.ts',
    'app/manifest.ts',
    // A prova do contrato de conteúdo vai JUNTO, e não fica no rebar: os dois
    // casos que ela exercita — o site sem WhatsApp e o site que declara o botão
    // sem número — são sites que o build DESTE projeto nunca vai ver, porque um
    // projeto só pode ser um deles. Ela roda no `npm test`, que o portão põe na
    // cadeia do `npm run verificar`, que o CI roda.
    'testes/conteudo.test.mjs',
  ]) {
    escritos.push(relativo)
  }

  // 2. O conteúdo, com a identidade do projeto dentro.
  const conteudo = montarConteudo({ nome, dominio, agora })
  gravar('conteudo/site.json', `${JSON.stringify(conteudo, null, 2)}\n`)

  // 3. As imagens. Geradas, não copiadas: elas dependem do nome e da cor que
  //    acabaram de ser decididos. Ver o cabeçalho de `og.mjs` para por que o
  //    arquivo é `og.png` e não `og.jpg`.
  const cores = { corTema: conteudo.meta.cores.tema, corFundo: conteudo.meta.cores.fundo }
  gravar('public/og.png', cartaoOg({ nome, dominio, ...cores }))
  gravar('public/icone-192.png', icone(192, { nome, ...cores }))
  gravar('public/icone-512.png', icone(512, { nome, ...cores }))

  // 4. `out/` é a saída do export. Fora do versionamento, e o scaffold não
  //    sabe disso porque o scaffold não sabe que vai exportar.
  const gitignore = join(destino, '.gitignore')
  const atual = readFileSync(gitignore, 'utf8')
  if (!/^\/?out\/?$/m.test(atual)) {
    writeFileSync(gitignore, `${atual.replace(/\n*$/, '\n')}\n# saída do output: "export"\n/out\n`)
    escritos.push('.gitignore')
  }

  // 5. A dívida, na cara. Por último de propósito: o dono lê o que falta depois
  //    de ver que tudo foi escrito, não no meio da lista de arquivos.
  if (!silencioso) anunciarPendencias(pendencias(conteudo))

  return escritos
}

// Executável direto, para dar para RODAR e ver o que sai:
//   node novo/site/aplicar.mjs <destino> <nome> <dominio>
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [destino, nome, dominio] = process.argv.slice(2)
  if (!destino || !nome || !dominio) {
    console.error('uso: node aplicar.mjs <destino> <nome> <dominio>')
    process.exit(2)
  }
  for (const caminho of aplicarSite({ destino, nome, dominio })) console.log(caminho)
}
