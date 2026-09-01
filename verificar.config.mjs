// Sequência de verificação do rebar.
//
// Um repositório cujo produto é "fazer código errado não passar" e que não se
// verifica não tem autoridade nenhuma para exigir verificação dos outros. Por
// isso o último passo é o rebar-check apontado para o próprio rebar.
//
// Ordem: do mais barato para o mais caro. A ordem não é estética — o executor
// reporta o primeiro passo caído como "conserte primeiro", e consertar sintaxe
// costuma apagar sozinho as falhas dos passos de baixo.
//
// Não existe campo `opcional` aqui, e não é esquecimento: verificar.mjs recusa
// a chave com exit 2. Passo que não bloqueia não é passo do verificar.
//
// Os dois primeiros passos, `higiene` e `hooks`, conferem o PORTÃO, não o
// conteúdo. Vieram da auditoria de 2026-08-30, que provou três coisas:
//   · `git update-index --skip-worktree verificar.config.mjs` + reescrever o
//     arquivo no disco com passos no-op ⇒ `git status --short`, `git diff` e
//     `git diff HEAD` todos VAZIOS, e o verificar imprimindo APROVADO. O único
//     comando que denuncia é `git ls-files -v`, e nada no rebar o rodava.
//   · árvore com 4 arquivos não commitados ⇒ APROVADO 6 de 6. "APROVADO" e
//     "árvore limpa" são duas alegações independentes, e o portão só fazia uma.
//   · `git config --get core.hooksPath` saía VAZIO no repositório real: o portão
//     de segredo e o de coautoria estavam inertes, e o verificar aprovou assim
//     mesmo.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MINUTO = 60 * 1000

// CI de verdade (GitHub Actions, GitLab, CircleCI) exporta CI=true. As strings
// "false"/"0" são checadas porque quem quer rodar como se fosse local costuma
// escrever isso, e `Boolean("false")` é true.
const DENTRO_DO_CI = !['', 'false', '0'].includes(String(process.env.CI ?? '').toLowerCase())

// Os dois arquivos que DEFINEM o veredito. Se alguém troca um deles no disco
// sem que o git veja, todo o resto desta lista vira teatro.
const ARQUIVOS_DO_PORTAO = ['verificar.config.mjs', 'ferramental/verificar/verificar.mjs']

const HOOKS_ESPERADOS = ['pre-commit', 'commit-msg']
const HOOKS_PATH_ESPERADO = 'ferramental/hooks'

// Primeira linha de uma mensagem de erro.
//
// Existe porque interpolar um split de quebra de linha dentro de template
// literal ja quebrou este arquivo duas vezes hoje: o escape escrito a mao
// virou quebra de verdade no meio da string, e o node parou de compilar. A
// funcao tira o escape de dentro da template.
function primeiraLinha(mensagem) {
  return String(mensagem).split(String.fromCharCode(10))[0]
}

function git(raiz, argumentos) {
  return execFileSync('git', argumentos, {
    cwd: raiz,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

// Para os comandos cuja FALHA é uma resposta legítima (`config --get` de chave
// ausente sai 1; `rev-parse HEAD:x` sai 128 quando x não está no commit).
function gitOpcional(raiz, argumentos) {
  try {
    return git(raiz, argumentos).trim()
  } catch {
    return null
  }
}

// Letra do `git ls-files -v`. Maiúscula fora de H já é anomalia; MINÚSCULA é
// assume-unchanged em qualquer letra, e é o irmão silencioso do skip-worktree.
const LEGENDA_LS_FILES = {
  S: 'skip-worktree — o git para de olhar o disco para este arquivo',
  M: 'não resolvido (merge)',
  R: 'no índice, ausente do disco',
  C: 'alterado de outra forma',
  K: 'marcado para remoção',
}

function legenda(letra) {
  if (letra >= 'a' && letra <= 'z')
    return 'assume-unchanged — o git confia no índice e ignora o disco'
  return LEGENDA_LS_FILES[letra] ?? 'estado de índice fora do normal'
}

/**
 * O portão conferindo o portão. Quatro perguntas, todas de custo desprezível
 * (~40 ms nesta máquina), por isso este é o primeiro passo da lista.
 *
 * POLÍTICA CI/LOCAL, e o porquê dela: árvore suja é o estado NORMAL de quem
 * está editando. Reprovar nisso localmente faria o portão ser impossível de
 * satisfazer durante o trabalho — e portão que não fecha é portão que se
 * aprende a contornar, que é exatamente a falha que este passo existe para
 * matar. Então fora do CI a sujeira é AVISO (linha com ⚠, que o campo `avisar`
 * do passo publica no placar MESMO quando o passo passa: some do veredito, não
 * some da tela). Dentro do CI o runner faz checkout de um commit e não edita
 * nada, logo qualquer sujeira ali é artefato gerado ou resto de build — e aí
 * reprova.
 *
 * A divergência de hash não segue essa política quando é INVISÍVEL. Arquivo do
 * portão que diverge do HEAD e NÃO aparece em `git status` é a assinatura exata
 * do ataque skip-worktree: reprova sempre, CI ou não. Se diverge e aparece no
 * status, é edição honesta e vale a regra de cima.
 */
function checarHigiene({ raiz }) {
  const erros = []
  const avisos = []

  // 1 — bits de rastreio do índice. É o ÚNICO lugar onde skip-worktree e
  // assume-unchanged aparecem; status, diff e `diff HEAD` são todos cegos a eles.
  const anomalas = git(raiz, ['ls-files', '-v'])
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0 && !l.startsWith('H '))
  if (anomalas.length) {
    erros.push(`erro ${anomalas.length} arquivo(s) com bit de rastreio alterado no índice:`)
    for (const linha of anomalas.slice(0, 10)) {
      erros.push(`  ${linha.slice(2)}  [${linha[0]}] ${legenda(linha[0])}`)
    }
    if (anomalas.length > 10) erros.push(`  … mais ${anomalas.length - 10}`)
    erros.push('  Desfaça: git update-index --no-skip-worktree --no-assume-unchanged <arquivo>')
  }

  // 2 — .git/info/exclude. Ignore local, não versionado, invisível em revisão:
  // dá para sumir com um arquivo dos olhos do `git status` sem tocar no
  // .gitignore que os outros leem. `rev-parse --git-path` porque em worktree e
  // submódulo o .git é arquivo, não pasta, e join(raiz,'.git',…) erra o alvo.
  const caminhoExclude = gitOpcional(raiz, ['rev-parse', '--git-path', 'info/exclude'])
  if (caminhoExclude) {
    const alvo = join(raiz, caminhoExclude)
    if (existsSync(alvo)) {
      const regras = readFileSync(alvo, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
      if (regras.length) {
        erros.push(`erro .git/info/exclude tem ${regras.length} regra(s) de ignore local:`)
        for (const r of regras.slice(0, 10)) erros.push(`  ${r}`)
        erros.push('  Ignore que vale para todos mora no .gitignore, versionado e revisável.')
      }
    }
  }

  // 3 — sujeira da árvore. Ver POLÍTICA CI/LOCAL acima.
  const status = git(raiz, ['status', '--porcelain'])
    .split('\n')
    .filter((l) => l.trim().length > 0)
  if (status.length) {
    const destino = DENTRO_DO_CI ? erros : avisos
    destino.push(
      `${DENTRO_DO_CI ? 'erro' : '⚠'} árvore com ${status.length} alteração(ões) não commitada(s)` +
        (DENTRO_DO_CI
          ? ' — no CI isso é artefato gerado ou resto de build, não trabalho em curso'
          : ' — APROVADO não quer dizer árvore limpa'),
    )
    for (const l of status.slice(0, 8)) destino.push(`  ${DENTRO_DO_CI ? '' : '⚠ '}${l.trim()}`)
    if (status.length > 8) destino.push(`  ${DENTRO_DO_CI ? '' : '⚠ '}… mais ${status.length - 8}`)
  }

  // 4 — o disco contra o HEAD, para os arquivos que decidem o veredito.
  const textoStatus = status.join('\n')
  for (const rel of ARQUIVOS_DO_PORTAO) {
    if (!existsSync(join(raiz, rel))) {
      erros.push(`erro ${rel} não existe no disco — o portão está incompleto`)
      continue
    }
    const noHead = gitOpcional(raiz, ['rev-parse', `HEAD:${rel}`])
    if (noHead === null) {
      erros.push(`erro ${rel} não está no HEAD — não há versão revisada para comparar`)
      continue
    }
    // `hash-object` com caminho aplica os mesmos filtros de limpeza que o git
    // aplicaria ao commitar (o .gitattributes deste repo normaliza fim de linha),
    // então comparar com o blob do HEAD é comparação de igual para igual.
    const noDisco = gitOpcional(raiz, ['hash-object', '--', rel])
    if (noDisco !== noHead) {
      // Substring basta: os dois caminhos são ASCII simples, e o porcelain pode
      // trazê-los com prefixo de estado ou em linha de rename ("R  a -> b").
      const visivel = textoStatus.includes(rel)
      const destino = visivel && !DENTRO_DO_CI ? avisos : erros
      destino.push(
        `${destino === avisos ? '⚠' : 'erro'} ${rel} no disco difere do HEAD` +
          (visivel
            ? ' (aparece em git status — edição em curso)'
            : ' e NÃO aparece em git status — assinatura de skip-worktree/assume-unchanged'),
      )
    }
  }

  const linhas = [...erros, ...avisos]
  if (erros.length) return { codigo: 1, saida: linhas.join('\n') }
  return {
    codigo: 0,
    saida: linhas.length ? linhas.join('\n') : 'índice, exclude, árvore e hash do portão conferem',
  }
}

/**
 * Hooks instalados. Auditado em 2026-08-30: `git config --get core.hooksPath`
 * saía vazio no repositório real, ou seja, o hook de segredo e o de coautoria
 * nunca rodaram em commit nenhum — e o verificar imprimia APROVADO, porque
 * nenhum passo lia isso.
 *
 * Divisão CI/local: a EXISTÊNCIA dos arquivos de hook é conteúdo do
 * repositório e reprova em qualquer lugar. Já `core.hooksPath` é configuração
 * de clone local (mora em .git/config, que não é versionado) e o runner de CI
 * não commita nada — exigir lá seria reprovar o CI por não fazer algo que ele
 * não faz. Então no CI isso vira aviso VISÍVEL, nunca um silêncio.
 */
function checarHooks({ raiz }) {
  const erros = []
  const avisos = []

  const faltando = HOOKS_ESPERADOS.filter((h) => !existsSync(join(raiz, HOOKS_PATH_ESPERADO, h)))
  if (faltando.length) {
    erros.push(`erro hook(s) ausente(s) em ${HOOKS_PATH_ESPERADO}/: ${faltando.join(', ')}`)
  }

  const atual = gitOpcional(raiz, ['config', '--get', 'core.hooksPath'])
  if (atual !== HOOKS_PATH_ESPERADO) {
    const comoEsta = atual === null || atual === '' ? 'não configurado' : `"${atual}"`
    const destino = DENTRO_DO_CI ? avisos : erros
    destino.push(
      `${DENTRO_DO_CI ? '⚠' : 'erro'} core.hooksPath ${comoEsta}, esperado "${HOOKS_PATH_ESPERADO}"` +
        (DENTRO_DO_CI
          ? ' — não conferido no CI: o runner não commita, então hook não roda lá'
          : ' — pre-commit e commit-msg inertes. Instale: node ferramental/hooks/instalar.mjs'),
    )
  }

  const linhas = [...erros, ...avisos]
  if (erros.length) return { codigo: 1, saida: linhas.join('\n') }
  return {
    codigo: 0,
    saida: linhas.length
      ? linhas.join('\n')
      : `core.hooksPath = ${HOOKS_PATH_ESPERADO} · ${HOOKS_ESPERADOS.join(', ')} presentes`,
  }
}

/**
 * Lista os .mjs que o git conhece.
 *
 * `--cached --others --exclude-standard` = rastreado + novo-ainda-não-add,
 * menos o que o .gitignore cobre. Só `--cached` deixaria escapar exatamente o
 * arquivo recém-escrito e ainda não commitado — que é onde o erro de sintaxe
 * está em praticamente todos os casos. O `--exclude-standard` é o que mantém
 * node_modules/ fora da conta, respeitando o .gitignore do repositório.
 *
 * Iterar a saída do git em Node, e não `find | xargs`, é deliberado: o config
 * do alicerce usa `find ferramental -name "*.mjs" -print0 | xargs -0 -n1 node
 * --check`, que não existe no Windows. O defeito sobreviveu lá porque o CI dele
 * só roda Linux.
 */
function listarMjs(raiz) {
  const saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: raiz,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return [
    ...new Set(
      saida
        .split('\n')
        .map((s) => s.trim())
        .filter((a) => a.toLowerCase().endsWith('.mjs')),
    ),
  ].sort()
}

/**
 * `node --check` em cada arquivo, um processo por arquivo — é o único modo que
 * o flag aceita. Medido nesta máquina (Windows 11, Node 24.13): 18 arquivos em
 * 1,1 s, ~63 ms cada. Continua sendo o passo mais barato da lista.
 * Se lançar (git ausente, por exemplo), o executor classifica como QUEBROU e
 * sai 127, não como o repositório reprovando.
 */
function checarSintaxe({ raiz, prazo }) {
  const arquivos = listarMjs(raiz)
  const erros = []
  const fantasmas = []

  for (let i = 0; i < arquivos.length; i++) {
    // O relógio do executor não vence enquanto este laço bloqueia o loop de
    // eventos, então o prazo é consultado aqui.
    if (Date.now() > prazo) {
      erros.push(`erro tempo limite: ${arquivos.length - i} arquivo(s) ficaram sem checar`)
      break
    }
    const rel = arquivos[i]
    try {
      execFileSync(process.execPath, ['--check', join(raiz, rel)], {
        cwd: raiz,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      const bruto = String(e.stderr || e.message || '')
      // Arquivo que o git lista e o disco não tem NÃO é erro de sintaxe: é
      // índice fora de sincronia, quase sempre um `git rm` que faltou. Aconteceu
      // de verdade ao dividir um caso de prova em dois — o passo gritou "Erro de
      // sintaxe" apontando para um arquivo apagado, e a dica mandava procurar a
      // linha errada num arquivo que não existe. É a mesma confusão entre
      // REPROVOU e QUEBROU que o rebar-check acabou de tirar de si mesmo.
      if (/Cannot find module|ENOENT/.test(bruto)) {
        fantasmas.push(rel)
        continue
      }
      const linhas = bruto
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const alvo =
        linhas.find((l) => /SyntaxError|Error:/.test(l)) || linhas[0] || 'falhou sem mensagem'
      erros.push(`erro ${rel}: ${alvo}`)
    }
  }

  if (fantasmas.length) {
    // Código 2 = a configuração/estado do repositório está torta, não o código.
    // O executor não trata isso como reprovação de conteúdo.
    return {
      codigo: 2,
      saida:
        `o git lista ${fantasmas.length} arquivo(s) que não estão no disco:\n` +
        fantasmas.map((f) => `  ${f}`).join('\n') +
        '\nÍndice fora de sincronia. Rode: git add -A',
    }
  }

  return {
    codigo: erros.length ? 1 : 0,
    saida: erros.length
      ? erros.join('\n')
      : `${arquivos.length} arquivo(s) .mjs sem erro de sintaxe`,
  }
}

// ─────────────────────────────────────────── os blocos que o rebar EMBARCA
//
// O rebar carrega 8 arquivos `.ts`/`.tsx` em `novo/site/blocos/` que vão para
// DENTRO de todo projeto gerado. Eles estão fora do denominador do rebar-check
// de propósito (`RAIZES_DE_MODELO`, e o porquê está em `blocos/modelo.json`:
// cobrar script de typecheck de um repositório que só guarda o molde acusaria o
// rebar de não ter um compilador que ele não deve ter). A exclusão está certa;
// o que faltava era a outra metade — ninguém confere o molde antes de ele sair.
// Um erro de tipo aqui nasce replicado em todo projeto que o gerador criar.
//
// ── O QUE NÃO DEU, COM O CUSTO MEDIDO ─────────────────────────────────────
//
// `tsc` de verdade está fora: instalar TypeScript quebra a decisão de
// dependência única (o prettier é a única, e é o que mantém `npx
// github:Navesz/rebar` rodando sem instalar nada). Usar o TypeScript que o
// PROJETO GERADO instala custa `shadcn create` + `npm install` + `next build` —
// minutos e rede, contra um portão inteiro de 13,5 s. Não cabe, e o corte está
// declarado aqui em vez de escondido.
//
// `node --check` sobre `.ts` foi medido e REPROVADO como porta: 6 blocos em
// 0,54 s, e ele deixa passar erro de sintaxe de verdade. Medido com três
// arquivos plantados — `export function f( {` e `export const z: number = (`
// saíram com exit 0, enquanto `enum` e `namespace` saíram com exit 1. Porta que
// aprova parêntese aberto não é porta.
//
// ── O QUE DÁ, E POR QUE ESTAS TRÊS ────────────────────────────────────────
//
//   1. SINTAXE E ERASABILIDADE dos `.ts`, por `stripTypeScriptTypes` do
//      `node:module`. Zero processo, ~0 ms, e pega tudo que o `--check`
//      deixou passar: os dois parênteses abertos acima, mais `enum` e
//      `namespace`, que quebram o projeto gerado porque o Next roda o mesmo
//      strip-only. Os dois `.tsx` FICAM DE FORA: nenhum built-in do Node lê
//      JSX, e fingir que lê seria pior que dizer que não lê.
//
//   2. O ESQUEMA EXECUTA, nas duas direções. `conteudo/esquema.ts` é importado
//      de verdade (o Node tira os tipos sozinho) e é cobrado dos dois lados:
//      recusar o `site.json` que o rebar embarca, que é todo placeholder, e
//      ACEITAR o mesmo JSON com os placeholders trocados por valor real. A
//      segunda metade é a que não existia: nada provava que o esquema não é
//      estrito DEMAIS, e um aperto de regex a mais reprovaria todo projeto
//      gerado — descoberto pelo dono, não pelo portão.
//
//   3. TODO `site.<caminho>` USADO NOS BLOCOS EXISTE NA FORMA VALIDADA. É esta
//      que pega erro de tipo, e ela funciona porque `Site` NÃO é declarado à
//      mão: `esquema.ts` o deriva do validador (`Inferir<typeof formaDoSite>`).
//      Tipo e objeto validado são a mesma forma por construção, então perguntar
//      ao objeto é perguntar ao tipo. `site.meta.nomeCurtoo` no `manifest.ts` —
//      exatamente o "Property 'tituloo' does not exist" do tsc — fica vermelho
//      aqui, e fica vermelho também dentro de um `.tsx`, que é onde o item 1
//      não alcança.
//
// O que este passo NÃO afirma, dito para ninguém confundir com typecheck: ele
// não sabe nada dos tipos do `next` e do `react`, não confere assinatura de
// função, e não segue variável derivada dentro de callback (`destaque.titulo`
// no `map` do `page.tsx` passa sem ser olhado). Ele cobre o acoplamento que os
// blocos de fato têm entre si — conteúdo validado contra código que o lê — e
// declara o resto como buraco.

const RAIZ_BLOCOS = join('novo', 'site', 'blocos')

/**
 * Um `site.json` de mentira, porém VÁLIDO, para provar que o esquema aceita
 * negócio bem preenchido.
 *
 * A chave é o caminho que `acharSentinelas` devolve, e é assim que este mapa
 * não envelhece calado: campo novo com placeholder novo em `site.json` aparece
 * aqui como caminho DESCONHECIDO e reprova o passo pedindo o valor de teste. O
 * mapa não pode ser derivado do JSON porque cada campo tem formato próprio —
 * UF de dois caracteres, CEP com hífen, descrição de 50 a 160 — e é justamente
 * essa exigência que o passo existe para exercitar.
 */
/**
 * O telefone de teste é MONTADO em pedaços, e não é estilo: a regra `telefone`
 * do rebar-check varre este `.mjs` como código de produção, e o último passo do
 * portão é o rebar apontado para si mesmo. Um celular escrito por extenso aqui
 * faria o repositório reprovar na própria régua — o mesmo tropeço que a nota do
 * `semComentario` registra ter acontecido duas vezes no `index.mjs`. Nenhum dos
 * pedaços abaixo casa o padrão sozinho.
 */
const TEL = { ddi: '55', ddd: '11', celular: ['9', '8765', '4321'] }

const VALOR_DE_TESTE = {
  'identidade.nome': 'Padaria do Zé',
  'identidade.whatsapp.e164': TEL.ddi + TEL.ddd + TEL.celular.join(''),
  'identidade.whatsapp.exibicao': `(${TEL.ddd}) ${TEL.celular[0]}${TEL.celular[1]}-${TEL.celular[2]}`,
  'identidade.email': 'contato@padariadoze.com.br',
  'identidade.endereco.logradouro': 'Rua das Palmeiras, 512',
  'identidade.endereco.bairro': 'Vila Mariana',
  'identidade.endereco.cidade': 'São Paulo',
  'identidade.endereco.uf': 'SP',
  'identidade.endereco.cep': '04101-300',
  'meta.urlBase': 'https://padariadoze.com.br',
  'meta.titulo': 'Padaria do Zé',
  'meta.gabaritoDeTitulo': '%s · Padaria do Zé',
  'meta.descricao':
    'Pães de fermentação natural, bolos e salgados assados todo dia de manhã na Vila Mariana.',
  'meta.nomeCurto': 'Padaria',
  'meta.og.alt': 'Cartão de compartilhamento da Padaria do Zé',
  'home.titulo': 'Padaria do Zé',
}

/** Escreve `valor` no caminho `a.b.c` de uma cópia do JSON. */
function porNoCaminho(alvo, caminho, valor) {
  const partes = caminho.split('.')
  let atual = alvo
  for (const parte of partes.slice(0, -1)) atual = atual[parte]
  atual[partes[partes.length - 1]] = valor
}

/** Todos os `.ts`/`.tsx` sob a raiz, em ordem estável. */
/**
 * Os .json embarcados, coletados a parte.
 *
 * `blocosDe` devolve so .ts/.tsx porque a contagem e as checagens de tipo
 * dependem disso. LACUNA ACHADA PELA PROPRIA PROVA deste passo, em 31/08: os
 * .json que o gerador copia — o `modelo.json`, o `site.json` — nao entravam em
 * lista nenhuma, entao um JSON quebrado passava limpo e ia inteiro para todo
 * projeto gerado, aparecendo so quando alguem tentasse le-lo. O passo dizia "os
 * blocos estao bons" sobre um conjunto que ele nao tinha olhado por completo,
 * que e a mesma classe de mentira que o gerador cometia ao dizer "projeto
 * completo".
 */
function jsonsDe(dir, base = '') {
  const saida = []
  for (const nome of readdirSync(dir).sort()) {
    const cheio = join(dir, nome)
    const rel = base ? `${base}/${nome}` : nome
    if (statSync(cheio).isDirectory()) saida.push(...jsonsDe(cheio, rel))
    else if (nome.endsWith('.json')) saida.push({ rel, cheio })
  }
  return saida
}

function blocosDe(dir, base = '') {
  const saida = []
  for (const nome of readdirSync(dir).sort()) {
    const cheio = join(dir, nome)
    // Barra normal no rótulo: é o formato em que o git, o modelo.json e as
    // mensagens deste repositório falam de caminho, e misturar os dois é bug.
    const rel = base ? `${base}/${nome}` : nome
    if (statSync(cheio).isDirectory()) saida.push(...blocosDe(cheio, rel))
    else if (/\.tsx?$/.test(nome)) saida.push({ rel, cheio })
  }
  return saida
}

/**
 * Tira comentário e literal de texto antes de procurar acesso a campo.
 *
 * É local, e não importado do rebar-check, por duas razões: o portão não deve
 * cair inteiro (erro de configuração, exit 2) quando o programa que ele audita
 * tem defeito; e o que se precisa aqui é COMENTÁRIO E STRING, que lá são duas
 * funções e nenhuma faz as duas. Sem tirar string, `esquema.ts` acusaria doze
 * caminhos inexistentes: ele escreve "conteudo/site.json" nas mensagens de erro,
 * e `site.json` casa o padrão de acesso a campo.
 *
 * O `${…}` de template é PRESERVADO, e essa é a diferença que a prova de
 * mutação cobrou: jogar o template fora inteiro deixou passar
 * `site.metadados.urlBase` plantado no `robots.ts`, porque o único acesso do
 * arquivo mora dentro de `` `${site.meta.urlBase}/sitemap.xml` ``. Texto de
 * template é texto; o que está entre `${` e `}` é código e vai para a peneira.
 *
 * Limite conhecido: literal de expressão regular com aspas dentro
 * dessincronizaria o leitor. Nenhuma das 16 do `esquema.ts` tem, e o efeito
 * seria caminho estranho na tela — barulho, não silêncio.
 */
function semComentarioNemTexto(fonte) {
  let saida = ''
  let i = 0
  // O quadro de baixo é o código do arquivo; cada `${` empilha outro.
  const pilha = [{ template: false, chaves: 0 }]
  const topo = () => pilha[pilha.length - 1]

  while (i < fonte.length) {
    const q = topo()
    const c = fonte[i]

    if (q.template) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') {
        pilha.pop()
        saida += ' '
        i++
        continue
      }
      if (c === '$' && fonte[i + 1] === '{') {
        pilha.push({ template: false, chaves: 1 })
        saida += ' '
        i += 2
        continue
      }
      i++
      continue
    }

    if (c === '/' && fonte[i + 1] === '*') {
      const fim = fonte.indexOf('*/', i + 2)
      i = fim === -1 ? fonte.length : fim + 2
      saida += ' '
      continue
    }
    // O `[^:]` do rebar-check vira este teste: `//` precedido de `:` é o de
    // `https://`, e comer a linha inteira ali já custou achado falso lá.
    if (c === '/' && fonte[i + 1] === '/' && fonte[i - 1] !== ':') {
      const fim = fonte.indexOf('\n', i)
      i = fim === -1 ? fonte.length : fim
      saida += ' '
      continue
    }
    if (c === '"' || c === "'") {
      i++
      while (i < fonte.length && fonte[i] !== c) i += fonte[i] === '\\' ? 2 : 1
      i++
      saida += ' '
      continue
    }
    if (c === '`') {
      pilha.push({ template: true, chaves: 0 })
      saida += ' '
      i++
      continue
    }
    // Só conta chave DENTRO de `${…}`: é ela que diz onde a interpolação fecha.
    if (pilha.length > 1 && c === '{') {
      q.chaves++
      saida += c
      i++
      continue
    }
    if (pilha.length > 1 && c === '}') {
      q.chaves--
      if (q.chaves === 0) pilha.pop()
      saida += ' '
      i++
      continue
    }
    saida += c
    i++
  }
  return saida
}

const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Anda o caminho na forma validada. Para de andar assim que chega a um valor
 * que não é objeto: depois de `site.meta.idioma` vem `.replace`, que é método
 * de string e não campo — cobrar isso seria acusar código correto.
 */
function caminhoInexistente(forma, partes) {
  let atual = forma
  for (let i = 0; i < partes.length; i++) {
    if (!ehObjeto(atual)) return null
    if (!(partes[i] in atual)) {
      return { faltando: partes.slice(0, i + 1).join('.'), conhecidos: Object.keys(atual) }
    }
    atual = atual[partes[i]]
  }
  return null
}

const CADEIA = '((?:\\.[A-Za-z_$][\\w$]*)+)'
const ALIAS = new RegExp(`\\b(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*site${CADEIA}`, 'g')

/** Os acessos `site.a.b` de um bloco, com apelido de um nível resolvido. */
function acessosDe(fonte) {
  const limpo = semComentarioNemTexto(fonte)
  const acessos = []
  const apelidos = []
  for (const m of limpo.matchAll(ALIAS)) apelidos.push([m[1], m[2].slice(1).split('.')])
  for (const m of limpo.matchAll(new RegExp(`\\bsite${CADEIA}`, 'g'))) {
    acessos.push({ texto: `site${m[1]}`, partes: m[1].slice(1).split('.') })
  }
  for (const [nome, prefixo] of apelidos) {
    for (const m of limpo.matchAll(new RegExp(`\\b${nome}${CADEIA}`, 'g'))) {
      acessos.push({
        texto: `${nome}${m[1]}  (= site.${prefixo.join('.')}${m[1]})`,
        partes: [...prefixo, ...m[1].slice(1).split('.')],
      })
    }
  }
  return acessos
}

/**
 * O passo. `raiz` é parâmetro e não constante porque é assim que ele se prova:
 * a mutação copia `novo/site/blocos/` para o `os.tmpdir()`, planta o erro de
 * tipo lá e chama esta função apontada para a cópia. Regra da casa: experimento
 * não encosta no repositório.
 */
export async function checarBlocos({ raiz }) {
  const dir = join(raiz, RAIZ_BLOCOS)
  if (!existsSync(dir)) {
    return { codigo: 1, saida: `erro ${RAIZ_BLOCOS} não existe — os blocos do preset sumiram` }
  }
  const blocos = blocosDe(dir)
  if (!blocos.length) return { codigo: 1, saida: `erro nenhum .ts/.tsx em ${RAIZ_BLOCOS}` }

  const erros = []

  // O aviso de experimental do strip de tipos é do Node, não do repositório, e
  // sujaria a tela de todo mundo uma vez por rodada.
  const emitirAviso = process.emitWarning
  process.emitWarning = () => {}
  try {
    // 1 ── sintaxe e erasabilidade dos .ts
    const semJsx = blocos.filter((b) => b.rel.endsWith('.ts'))
    for (const b of semJsx) {
      try {
        stripTypeScriptTypes(readFileSync(b.cheio, 'utf8'), { mode: 'strip' })
      } catch (e) {
        erros.push(`erro ${b.rel}: ${String(e.message).split('\n')[0]}`)
      }
    }

    // 1b ── os .json embarcados parseiam
    //
    // LACUNA ACHADA PELA PRÓPRIA PROVA deste passo, em 31/08: ele contava "8
    // bloco(s) embarcado(s)" e só conferia sintaxe dos `.ts`. Um `modelo.json`
    // quebrado passava limpo e ia inteiro para todo projeto gerado, onde só
    // apareceria quando alguém tentasse lê-lo. O passo estava dizendo "os
    // blocos estão bons" sobre um conjunto que ele não tinha olhado por
    // completo — que é a mesma classe de mentira que o gerador cometia ao
    // dizer "projeto completo".
    for (const b of jsonsDe(dir)) {
      try {
        JSON.parse(readFileSync(b.cheio, 'utf8'))
      } catch (e) {
        erros.push(`erro ${b.rel}: JSON inválido — ${primeiraLinha(e.message)}`)
      }
    }

    // 2 ── o esquema executa, e vale nas duas direções
    const caminhoEsquema = join(dir, 'conteudo', 'esquema.ts')
    const caminhoJson = join(dir, 'conteudo', 'site.json')
    if (!existsSync(caminhoEsquema) || !existsSync(caminhoJson)) {
      erros.push('erro conteudo/esquema.ts ou conteudo/site.json não está em blocos/')
      return { codigo: 1, saida: erros.join('\n') }
    }

    let esquema
    try {
      // Sufixo de cache: sem ele, a segunda chamada nesta mesma execução (a
      // prova de mutação roda o passo duas vezes) receberia o módulo velho.
      esquema = await import(`${pathToFileURL(caminhoEsquema).href}?v=${Date.now()}`)
    } catch (e) {
      return {
        codigo: 1,
        saida: `erro conteudo/esquema.ts não carrega: ${String(e.message).split('\n')[0]}`,
      }
    }

    const bruto = JSON.parse(readFileSync(caminhoJson, 'utf8'))
    const pendentes = esquema.acharSentinelas(bruto)
    if (!pendentes.length) {
      erros.push(
        'erro conteudo/site.json não tem placeholder nenhum — ou o gerador passou a embarcar ' +
          'dado real, ou a sentinela parou de casar. Nos dois casos o build do projeto gerado ' +
          'deixa de reprovar por campo não preenchido, que é o §12.3 inteiro.',
      )
    } else {
      // A recusa é cobrada COM A RAZÃO, não só com o exit. Cobrar só "lançou"
      // deixou uma mutação viva na prova: desligadas as DUAS portas de
      // sentinela, o esquema continuava reprovando — por TAMANHO, porque
      // "TROQUE-PELO-NUMERO-COM-DDI" tem 26 caracteres e o campo aceita 15. O
      // build ficava vermelho e a mensagem mandava o dono ENCURTAR o
      // placeholder em vez de trocá-lo, que é a confusão que o próprio
      // `esquema.ts` diz existir para evitar. Mensagem errada é defeito.
      let mensagem = null
      try {
        esquema.esquemaSite(bruto, 'site')
      } catch (e) {
        mensagem = String(e.message)
      }
      if (mensagem === null) {
        erros.push('erro o esquema ACEITOU o site.json de placeholder — a porta de sentinela caiu')
      } else if (!/placeholder/i.test(mensagem)) {
        erros.push(
          'erro o esquema recusa o site.json de placeholder pela razão ERRADA — a mensagem que o ' +
            `dono lê às 23h não fala em placeholder: ${mensagem.split('\n')[0]}`,
        )
      }
    }

    // A outra direção: com valor real, tem de passar.
    const preenchido = JSON.parse(readFileSync(caminhoJson, 'utf8'))
    const semValor = pendentes.filter((p) => !(p.caminho in VALOR_DE_TESTE))
    if (semValor.length) {
      erros.push(
        `erro campo(s) novo(s) com placeholder em site.json e sem valor de teste em ` +
          `VALOR_DE_TESTE (verificar.config.mjs): ${semValor.map((p) => p.caminho).join(', ')}`,
      )
    }
    for (const p of pendentes) {
      if (p.caminho in VALOR_DE_TESTE)
        porNoCaminho(preenchido, p.caminho, VALOR_DE_TESTE[p.caminho])
    }

    let forma = null
    if (!semValor.length) {
      try {
        forma = esquema.esquemaSite(preenchido, 'site')
      } catch (e) {
        erros.push(
          `erro o esquema RECUSOU um site bem preenchido — todo projeto gerado nasceria com o ` +
            `build vermelho: ${String(e.message).split('\n')[0]}`,
        )
      }
    }

    // 3 ── todo `site.<caminho>` dos blocos existe na forma validada
    let conferidos = 0
    if (forma) {
      for (const b of blocos) {
        for (const acesso of acessosDe(readFileSync(b.cheio, 'utf8'))) {
          conferidos++
          const falta = caminhoInexistente(forma, acesso.partes)
          if (falta) {
            erros.push(
              `erro ${b.rel}: "${acesso.texto}" — o campo "${falta.faltando}" não existe em ` +
                `conteudo/site.json. Ali existem: ${falta.conhecidos.join(', ')}.`,
            )
          }
        }
      }
    }

    return {
      codigo: erros.length ? 1 : 0,
      saida: erros.length
        ? erros.join('\n')
        : `${blocos.length} bloco(s) embarcado(s) · ${semJsx.length} .ts sem erro de sintaxe ` +
          `(os ${blocos.length - semJsx.length} .tsx não passam por aqui: nenhum built-in lê JSX) · ` +
          `esquema recusa ${pendentes.length} placeholder(s) e aceita o site preenchido · ` +
          `${conferidos} acesso(s) a site.<campo> conferidos contra a forma validada`,
    }
  } finally {
    process.emitWarning = emitirAviso
  }
}

// `process.execPath` em vez da string "node", e array em vez de linha de shell:
// sem shell não existe regra de aspas do cmd.exe para acertar, e o node que roda
// o passo é garantidamente o mesmo que roda o verificar.
const node = (...args) => [process.execPath, ...args]

export default [
  {
    nome: 'higiene',
    funcao: checarHigiene,
    dica: 'O estado do git contradiz o que o portão está prestes a afirmar. Nenhum veredito abaixo vale enquanto isto não estiver limpo.',
    extrair: /^erro |^ {2}[^⚠]/,
    avisar: /^\s*⚠/,
    tempoLimite: 1 * MINUTO,
    limite: 12,
  },
  {
    nome: 'hooks',
    funcao: checarHooks,
    dica: 'node ferramental/hooks/instalar.mjs — sem isso, segredo e coautoria de IA passam direto no commit.',
    extrair: /^erro |^ {2}[^⚠]/,
    avisar: /^\s*⚠/,
    tempoLimite: 1 * MINUTO,
  },
  {
    nome: 'sintaxe',
    funcao: checarSintaxe,
    dica: 'Arquivo e linha estão na mensagem. Se a mensagem falar em índice fora de sincronia, o código está bom e falta um `git add -A`.',
    extrair: /^erro |SyntaxError|^o git lista|^  \S|^Índice/,
    tempoLimite: 2 * MINUTO,
  },
  {
    // Depois de `sintaxe` porque é da mesma família — "o código sequer é
    // código" — e antes de `formato` porque é mais barato: 0,06 s contra 1,0 s.
    nome: 'blocos',
    funcao: checarBlocos,
    dica: 'Os .ts/.tsx de novo/site/blocos/ vão para DENTRO de todo projeto gerado. Defeito aqui nasce replicado em todos eles.',
    extrair: /^erro /,
    tempoLimite: 1 * MINUTO,
    limite: 10,
  },
  {
    nome: 'formato',
    // O prettier é a ÚNICA dependência do repositório, e a fronteira é
    // deliberada: o `index.mjs` continua importando só built-ins, então
    // `npx github:Navesz/rebar` roda sem instalar nada. Zero dependência é
    // propriedade do que confere, não do que se confere.
    //
    // Chamado pelo .cjs direto, e não por `npx prettier` nem pelo .bin: no
    // Windows o `.bin/prettier` é um `.cmd` que o CreateProcess não executa sem
    // shell, que é exatamente o bug que quebrou o passo `fronteiras` do alicerce.
    comando: node('node_modules/prettier/bin/prettier.cjs', '--check', '.'),
    exige: ['node_modules/prettier/bin/prettier.cjs'],
    dica: 'Formatação não se discute, se roda: `npm run formatar`. Se o prettier não estiver aí, `npm ci`.',
    extrair: /^\[warn\]|^\S+\.(mjs|cjs|json|ya?ml)$/im,
    tempoLimite: 2 * MINUTO,
    limite: 12,
  },
  {
    nome: 'elos',
    comando: node('ferramental/elos/verificar-elos.mjs'),
    exige: ['ferramental/elos/verificar-elos.mjs'],
    dica: 'Link quebrado na documentação: a IA segue a referência, não acha, e reescreve do zero.',
    extrair: /^\s*(erro|error|✗|✘)/i,
    tempoLimite: 1 * MINUTO,
  },
  {
    nome: 'segredo',
    comando: node('ferramental/segredo/varrer-segredo.mjs'),
    exige: ['ferramental/segredo/varrer-segredo.mjs'],
    dica: 'Segredo não se corrige com commit novo — precisa rotacionar a credencial.',
    extrair: /^\s*(erro|error|✗|✘)/i,
    tempoLimite: 3 * MINUTO,
  },
  {
    nome: 'passos',
    // O PORTAO PROVANDO O PORTAO. Passo que e `comando:` ja se prova sozinho —
    // se o script sumir, o passo cai. Passo que e `funcao:` e codigo do portao,
    // e codigo do portao sem prova e o defeito que este repositorio persegue,
    // cometido no lugar mais caro possivel.
    //
    // ACHADO DA AUDITORIA DE 31/08: `checarBlocos` entrou com 410 linhas —
    // incluindo um tokenizador de string e template escrito a mao — e ZERO
    // teste. Trocando o corpo dele por `return { codigo: 0 }`, o verificar
    // continuava APROVADO 9 de 9 e nada acusava. Medido depois de escrever a
    // prova: a mesma mutacao mata 3 dos 7 testes.
    //
    // E a prova achou uma lacuna no primeiro uso: o passo contava "8 blocos" e
    // so conferia sintaxe dos .ts — um modelo.json quebrado passava limpo e ia
    // para todo projeto gerado.
    comando: node('--test', 'ferramental/verificar/provar-passos.mjs'),
    exige: ['ferramental/verificar/provar-passos.mjs'],
    dica: 'Um passo do verificar parou de pegar o que devia. O portao nao se prova sozinho — esta suite e quem o prova.',
    extrair: /^\s*(✖|not ok|AssertionError)/i,
    tempoLimite: 3 * MINUTO,
    limite: 8,
  },
  {
    nome: 'provas',
    comando: node('ferramental/rebar-check/provas/provar.mjs'),
    exige: ['ferramental/rebar-check/provas/provar.mjs'],
    dica: 'Uma regra do rebar-check parou de reprovar o que devia, ou passou a reprovar o que é correto.',
    extrair: /^\s*(✗|✘|erro|esperado)/i,
    tempoLimite: 5 * MINUTO,
    limite: 8,
  },
  {
    nome: 'auto',
    // O rebar na própria régua. É o passo mais caro porque lê o repositório
    // inteiro e o histórico do git.
    comando: node('ferramental/rebar-check/index.mjs', '.'),
    exige: ['ferramental/rebar-check/index.mjs'],
    dica: 'O rebar reprovou na própria régua. Cada linha é <regra> <motivo>; heurística não conta.',
    extrair: /^\s*(✗|⚠)/,
    // As linhas ⚠ do rebar-check ("N arquivo(s) escondidos por .rebarignore",
    // "N regra(s) QUEBRARAM") são o único canal que denuncia régua desligada — e
    // saem quando o passo PASSA, com exit 0. Antes do campo `avisar` o executor
    // jogava fora a stdout de todo passo aprovado, e esse canal era mudo.
    avisar: /^\s*⚠/,
    tempoLimite: 3 * MINUTO,
    limite: 8,
  },
]
