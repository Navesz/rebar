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
 * Preenche `conteudo/site.json` com o que o gerador sabe. O resto continua
 * sendo texto de exemplo, e continua VISIVELMENTE de exemplo: o dono troca no
 * JSON, sem abrir um `.tsx`.
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
export function aplicarSite({ destino, nome, dominio, agora }) {
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
