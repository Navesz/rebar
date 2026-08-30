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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
