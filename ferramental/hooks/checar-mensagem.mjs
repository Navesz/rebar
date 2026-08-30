#!/usr/bin/env node
// Barra o trailer de coautoria de IA NA MENSAGEM QUE ESTÁ SENDO ESCRITA.
//
// Por que existe além do passo no pre-commit: `rebar-check --regra=coautoria-ia`
// lê `git log`, e o commit em curso ainda não está lá. Aquele passo barra o
// PRÓXIMO commit — impede o trailer de ficar, não de entrar. Como o objetivo
// declarado do rebar é "ignorar uma regra quebra o commit", faltava a metade
// que roda antes de o commit existir. É esta.
//
// Uma vez no histórico, o trailer só sai reescrevendo o histórico. Medido: o
// alicerce tem 11 de 11 commits com coautoria e não dá para limpar sem force.
//
// A regex casa TODOS os agentes, não só o Claude. A queixa original era "está
// colocando o claude como colaborador", mas a medição em 161 commits de seis
// repositórios deu Cursor 35 contra Claude 6 — e com casing de trailer
// diferente (`Co-authored-by:` contra `Co-Authored-By:`). Regex que só pega
// Claude cobre 15% do problema.
//
// Chamado pelo hook commit-msg com o caminho do arquivo de mensagem.

import { readFileSync } from 'node:fs'

const AGENTES =
  /^co-authored-by:.*(claude|anthropic|cursor|copilot|codex|devin|aider|gemini|noreply@anthropic)/im

const arquivo = process.argv[2]
if (!arquivo) {
  console.error('checar-mensagem: falta o caminho do arquivo de mensagem')
  process.exit(2)
}

let texto
try {
  texto = readFileSync(arquivo, 'utf8')
} catch (e) {
  console.error(`checar-mensagem: não consegui ler ${arquivo}: ${e.message}`)
  process.exit(2)
}

// Linha de comentário do git não é a mensagem: `git commit -v` cola o diff
// inteiro abaixo de `# ------------------------ >8 ------------------------`,
// e um diff que TOQUE numa linha de coautoria acusaria um commit inocente.
const corte = texto.indexOf('\n# ------------------------ >8')
const mensagem = (corte === -1 ? texto : texto.slice(0, corte))
  .split('\n')
  .filter((l) => !l.startsWith('#'))
  .join('\n')

const achados = mensagem.split('\n').filter((l) => AGENTES.test(l))
if (!achados.length) process.exit(0)

console.error('\n[coautoria] a mensagem declara uma IA como coautora:\n')
for (const l of achados) console.error(`  ${l.trim()}`)
console.error(
  '\nDecisão do projeto: IA não entra como coautora nos repositórios novos.\n' +
    'Tire a linha e comite de novo.\n\n' +
    'Na raiz, o conserto é não gerar o trailer:\n' +
    '  .claude/settings.json  ->  { "includeCoAuthoredBy": false }\n' +
    'Assim a string nunca existe, e não há falso positivo a discutir.\n',
)
process.exit(1)
