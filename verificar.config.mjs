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

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const MINUTO = 60 * 1000

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
    tempoLimite: 3 * MINUTO,
    limite: 8,
  },
]
