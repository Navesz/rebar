// THE GATE. It is what the generator applies ON TOP of what `shadcn create`
// delivered.
//
// The division of labor is settled and it is the reason this file is small: the
// scaffold belongs to shadcn, which already delivers the stack decided in §12.2
// — Next 16 App Router, React 19, Tailwind 4, base-nova, zero Radix. Writing our
// own scaffold would mean taking over the maintenance of a copy of shadcn's
// work, forever, and it would start rotting on their first release.
//
// The gate is what shadcn does NOT deliver and rebar demands: the ruler, matrix
// CI, hooks, license, and normalized line endings.
//
// EVERYTHING HERE IS IDEMPOTENT, and that is not elegance. Another generator
// step — the `site` preset — writes into the same project in the same minute,
// and both have reason to touch next.config.ts. Overwriting what the neighbor
// just wrote is the classic layered-generator defect; here every write is either
// the first one or a declared no-op.

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not .pathname: on Windows the pathname comes out as
// "/C:/Users/...", with a slash before the drive letter, and every join from it
// points at nothing.
const AQUI = dirname(fileURLToPath(import.meta.url))
const MOLDES = join(AQUI, 'arquivos')

// ─────────────────────────────────────────────────────────── static templates
//
// The templates live without the leading dot in the name (`editorconfig`, not
// `.editorconfig`) ON PURPOSE. A real `.gitignore` or `.editorconfig` inside
// this folder would apply to rebar's OWN subtree — git and editors read config
// files at any depth — and the template would start changing the behavior of
// the repository that only wanted to store it. The map below is the only place
// where the final name is decided.

// The hooks go to `.githooks/` and NOT to `hooks/`, and that is not taste:
// `shadcn create` already creates `hooks/` as the project's React hooks folder,
// aliased as `@/hooks` in components.json. Dumping `pre-commit` in there would
// mix git hooks with React hooks in the same folder and under the same alias.
const PASTA_HOOKS = '.githooks'

// THE MCP SERVER, and why it does NOT go to `.githooks/`.
//
// `.githooks/` is what `core.hooksPath` points at: everything inside it is a
// candidate to be executed by git on a commit event. The MCP server is a hook
// for nothing — what runs it is the AI client, at a moment that has no relation
// to git. Mixing the two would make `git` trip over a file that is not its own
// the day it gains a new event name.
//
// `.rebar/` starts with a dot for the same reason as `.githooks/`: it is
// repository tooling, not product source. Measured in the `shadcn create`
// scaffold: `tsconfig.json` only includes .ts/.tsx/.mts, so this .mjs stays out
// of the typecheck, and `eslint.config.mjs` does not reach it — neither of them
// gains work because of it.
const PASTA_REBAR = '.rebar'

// THE SERVER PATH LIVES HERE, ONCE. The `.mcp.json` repeats this same path
// inside itself, because JSON has no way to import a constant — and it is that
// repetition `conferirPonteiroMcp` measures, right after writing both.
//
// The constant's name is historical: until 2026-09-02 the file pointed at was a
// LAUNCHER, which called `npx github:Navesz/rebar --mcp` and handed over stdio.
// Measured on a freshly generated project, that chain exited 2 — `npx` installs
// only the package at rebar's ROOT, and the MCP SDK lives in `mcp/`, which is a
// separate package, so `mcp/node_modules` never exists in the npx cache. Today
// the file is the SERVER, with no dependency at all. The name stayed because
// `{{lancador}}` is a key of the `arquivos/agentes.md` template, and renaming
// the two in different commits is how a pointer breaks silently.
const MCP_LANCADOR = `${PASTA_REBAR}/mcp.mjs`

export const ESTATICOS = [
  ['editorconfig', '.editorconfig'],
  ['gitattributes', '.gitattributes'],
  ['dependabot.yml', '.github/dependabot.yml'],
  ['verificar.yml', '.github/workflows/verificar.yml'],
  ['pre-commit', `${PASTA_HOOKS}/pre-commit`],
  ['commit-msg', `${PASTA_HOOKS}/commit-msg`],
  ['install.mjs', `${PASTA_HOOKS}/install.mjs`],
  ['portao.test.mjs', 'testes/portao.test.mjs'],
  // THIS PROJECT'S MCP. See the header of `mcp-rebar.mjs` for the whole
  // decision and for the numbers that measured it; the summary is: the project
  // serves ITS OWN rules, not a copy of rebar's 22, and there is no copy to age
  // because every answer is DERIVED from disk at call time. That is why this
  // pair goes into ESTATICOS and needs no freshness gate: what gets copied is
  // MECHANICS, and mechanics do not change when a rule changes.
  ['mcp.json', '.mcp.json'],
  ['mcp-rebar.mjs', MCP_LANCADOR],
]

// `arquivos/agentes.md` LIVES NEXT TO THESE AND IS NOT ON THE LIST, on purpose.
// It is a template, not a copy: it goes through `moldeAgents`, which swaps the
// project name and the launcher path and puts the shadcn block back. Putting it
// here would deliver an AGENTS.md with a raw `{{nome}}` inside. See the whole
// decision further down.

// Pieces the generator COPIES from rebar itself instead of duplicating here.
//
// These are files that already exist, are already reviewed and already have
// proof: the full text of Apache-2.0, the secret scanner and the commit message
// checker. A second copy of them in this folder would be a copy that ages apart
// from the original — and the only thing worse than having no secret scanner is
// having an outdated one that says it looked.
//
// The two copied `.mjs` are self-contained, Node built-ins only, and find the
// root through `git rev-parse --show-toplevel`. Placed in `.githooks/`, they
// read the GENERATED repository, not rebar.
export const COPIADOS_DO_REBAR = [
  ['LICENSE', 'LICENSE'],
  ['tooling/secret/scan-secret.mjs', `${PASTA_HOOKS}/scan-secret.mjs`],
  ['tooling/hooks/check-message.mjs', `${PASTA_HOOKS}/check-message.mjs`],
]

// The two files git needs to see as 100755. See `marcarExecutaveis`.
const EXECUTAVEIS = [`${PASTA_HOOKS}/pre-commit`, `${PASTA_HOOKS}/commit-msg`]

// ────────────────────────────── what the scaffold emits, and where each file lands
//
// THIS LIST EXISTS BECAUSE SILENCE ALREADY LET A FILE THROUGH.
//
// `shadcn create` emitted 23 files in the 2026-08-31 measurement (Next 16,
// base-nova). The gate had a written decision about five of them and NOT ONE
// word about the other eighteen — and one of those eighteen was a 5-line
// `AGENTS.md`, in English, which is a direct instruction to an AI agent in a
// project whose rule is Portuguese. It crossed the whole gate without touching
// anything: none of rebar-check's 22 rules sees it. `idioma-unico` only reads
// CODE COMMENTS (`r.fontes`), so prose in `.md` never reaches it; `readme` only
// asks whether a README exists. It was not approval, it was the absence of a
// question.
//
// So the question is now asked of EVERY scaffold file, here, once, in writing.
// Three possible destinations and nothing more:
//
//   'sobrescrito'   — the gate or the `site` preset writes over it.
//   'complementado' — the scaffold's file still holds and gains our addition;
//                     never replaced.
//   'preservado'    — stays exactly as shadcn delivered it, ON PURPOSE.
//
// Those three values and the `destino`/`porque` keys stay in Portuguese: they
// are the enum this table is built out of and the object's key names, not
// prose. Renaming them is a refactor, not a translation.
//
// The key uses a forward slash because that is how `git ls-files` returns paths
// on both systems — comparing with `path.join` here would compare `\` against
// `/` and never match on Windows.
const DESTINO_DO_SCAFFOLD = {
  'AGENTS.md': {
    destino: 'sobrescrito',
    porque:
      'agent instruction in English, and nothing but shadcn boilerplate; see `garantirAgents`, ' +
      'which rewrites it in pt-BR and preserves the third-party block intact',
  },
  'README.md': {
    destino: 'sobrescrito',
    porque: 'framework boilerplate, and it is the first thing one sees in a public repository',
  },
  'app/layout.tsx': {
    destino: 'sobrescrito',
    porque: 'the `site` preset puts in the metadata that survives without JavaScript',
  },
  'app/page.tsx': {
    destino: 'sobrescrito',
    porque: 'the `site` preset puts in the home page that reads `conteudo/site.json`',
  },
  'next.config.ts': {
    destino: 'complementado',
    porque: 'gains `output: "export"` and `images.unoptimized`; see `garantirExportEstatico`',
  },
  'package.json': {
    destino: 'complementado',
    porque: 'gains the `test` and `verificar` scripts; the rest of the manifest is untouched',
  },
  '.prettierignore': {
    destino: 'complementado',
    porque: 'the shadcn one knows neither prose nor license; what it already lists still holds',
  },
  '.gitignore': {
    destino: 'complementado',
    porque:
      'the `site` preset adds `/out`, which is the export output; the scaffold does not know ' +
      'it is going to export',
  },
  '.prettierrc': {
    destino: 'preservado',
    porque:
      '`endOfLine: "lf"` already matches our .gitattributes, and `prettier-plugin-tailwindcss` ' +
      'and `tailwindStylesheet` are configuration of the theme that came with it — rewriting ' +
      'is picking a fight with the formatter of the scaffold itself',
  },
  'eslint.config.mjs': {
    destino: 'preservado',
    porque: '`globalIgnores` already covers `out/**`, which is where the export writes',
  },
  'tsconfig.json': {
    destino: 'preservado',
    porque:
      'the `include` covers .ts/.tsx/.mts and does NOT cover .mjs — `testes/portao.test.mjs` ' +
      'stays out of the typecheck on purpose: it is plain Node, not TypeScript, and runs under ' +
      '`node --test`',
  },
  'app/globals.css': {
    destino: 'preservado',
    porque:
      'it is the whole base-nova theme, in Tailwind 4 tokens; touching here means taking over ' +
      'the maintenance of the shadcn theme forever. The `hex-cru` rule demands that the code not ' +
      'duplicate these tokens in hex',
  },
  'app/favicon.ico': {
    destino: 'preservado',
    porque:
      'the `site` preset generates og.png and icone-192/512.png, which are another thing: Next ' +
      'serves this file as /favicon.ico and nothing of ours replaces it',
  },
  'components.json': {
    destino: 'preservado',
    porque:
      'it is the contract of `shadcn add`; the `ui-falso` and `shadcn-completo` rules of ' +
      'rebar-check require it to exist next to components/ui/',
  },
  'components/ui/button.tsx': {
    destino: 'preservado',
    porque: 'registry component, updated by `shadcn add`, not by us',
  },
  'components/theme-provider.tsx': {
    destino: 'preservado',
    porque: 'same — it comes from the `next` template of shadcn',
  },
  'lib/utils.ts': {
    destino: 'preservado',
    porque: '`cn()`; every registry component imports from here via the components.json alias',
  },
  'components/.gitkeep': { destino: 'preservado', porque: 'folder aliased in components.json' },
  'lib/.gitkeep': { destino: 'preservado', porque: 'folder aliased in components.json' },
  'hooks/.gitkeep': {
    destino: 'preservado',
    porque:
      'React hooks folder, aliased as `@/hooks` — it is exactly because of it that the git ' +
      'hooks go to `.githooks/` and not to `hooks/`',
  },
  'public/.gitkeep': {
    destino: 'preservado',
    porque: 'the `site` preset writes the images alongside it; the marker does not get in the way',
  },
  'postcss.config.mjs': { destino: 'preservado', porque: 'Tailwind 4 plugin, and nothing beyond' },
  'package-lock.json': {
    destino: 'preservado',
    porque:
      'it is the result of the `npm install` the scaffold just ran; rewriting it by hand is ' +
      'manufacturing a lock that corresponds to no installation',
  },
}

// THE DESTINATION OF A FILE THIS LIST DOES NOT KNOW: it stays on disk and
// BECOMES A WARNING, with its name on screen.
//
// Never deleted — deleting a file the scaffold just wrote, without knowing what
// it is, is worse than the omission this list fixes. And never silent:
// `index.mjs` drops the generator's exit code to 1 whenever there is any
// warning, so a shadcn release that starts emitting a new file makes the
// generator exit red with the file's name, and somebody decides. That is how
// AGENTS.md would have shown up on the day it was born, instead of in an
// adversarial attack weeks later.
//
// The oracle is THE GIT INDEX, not the disk. Measured on 2026-08-31: `shadcn
// create` runs `git init` and leaves the 23 files STAGED, with no commit. The
// `site` preset and the gate write only to disk — neither touches the index,
// and the generator's `git add -A` only runs afterwards. So at this point in
// the flow, `git ls-files` is exactly the list of what shadcn emitted, without
// a line of coupling to what the neighbor wrote.
function conferirScaffold(destino, avisos) {
  let bruto
  try {
    // -z: without `-z` git quotes paths with non-ASCII characters and escapes
    // the backslashes, and the comparison against the list's key fails on
    // exactly the oddly named file, which is the one that most needs a warning.
    bruto = execFileSync('git', ['ls-files', '-z'], { cwd: destino, encoding: 'utf8' })
  } catch (erro) {
    avisos.push(
      `could not read the scaffold index (${erro.message}) — the unknown-file scan did NOT ` +
        'run, and it is the one thing that keeps a new shadcn file from getting in silently',
    )
    return null
  }
  const emitidos = bruto.split('\0').filter(Boolean)
  if (!emitidos.length) {
    avisos.push(
      'the git index is empty at this point — `shadcn create` was leaving 23 files staged on ' +
        '2026-08-31. It changed behavior, and the unknown-file scan lost its oracle: check by ' +
        'hand what the scaffold emitted',
    )
    return null
  }

  const desconhecidos = emitidos.filter((a) => !(a in DESTINO_DO_SCAFFOLD))
  if (desconhecidos.length) {
    avisos.push(
      `the scaffold emitted ${desconhecidos.length} file(s) DESTINO_DO_SCAFFOLD does not ` +
        `know: ${desconhecidos.join(', ')}. They were left as they came, untouched. Decide ` +
        'the destination of each one in new/gate/aplicar.mjs — this is how the English ' +
        'AGENTS.md got in silently',
    )
  }

  // The opposite drift counts too: a file the list expects and the scaffold
  // stopped emitting. Without `eslint.config.mjs` the `npm run lint` dies, and
  // the `verificar` script — which is the whole CI — dies with it.
  const sumidos = Object.keys(DESTINO_DO_SCAFFOLD).filter((a) => !emitidos.includes(a))
  if (sumidos.length) {
    avisos.push(
      `the scaffold did NOT emit ${sumidos.length} file(s) DESTINO_DO_SCAFFOLD expects: ` +
        `${sumidos.join(', ')}. Either shadcn changed, or the list aged`,
    )
  }

  return { emitidos: emitidos.length, desconhecidos, sumidos }
}

// ────────────────────────────────────────────────────────────────── utilities

function escrever(destino, rel, texto) {
  const caminho = join(destino, ...rel.split('/'))
  mkdirSync(dirname(caminho), { recursive: true })
  // LF always, and written by hand instead of trusted to .gitattributes:
  // .gitattributes fixes what git INDEXES, not what sits on the disk of whoever
  // just ran the generator.
  writeFileSync(caminho, texto.replace(/\r\n/g, '\n'), 'utf8')
}

function lerSe(destino, rel) {
  const caminho = join(destino, ...rel.split('/'))
  return existsSync(caminho) ? readFileSync(caminho, 'utf8') : null
}

// ───────────────────────────────────────────────────────── generated content
//
// THE TEMPLATE BODIES BELOW STAY IN PORTUGUESE ON PURPOSE. They are not this
// repository's prose: they are the bytes written INTO the generated project,
// and the generated project is a pt-BR project by decision — the AGENTS.md it
// receives declares "português do Brasil", and `testes/portao.test.mjs` asserts
// that. Translating half of the output would hand the owner a mixed-language
// repository, which is exactly the defect the `idioma-unico` rule exists to
// catch. Translate these only together with `arquivos/agentes.md` and the rest
// of the emitted files, as one decision.

function moldeNotice(nome, dono, ano) {
  return `${nome}
Copyright ${ano} ${dono}

Este produto inclui software desenvolvido por ${dono}.

Distribuído sob a Apache License, Version 2.0. O texto integral da licença
está no arquivo LICENSE, na raiz deste repositório.
`
}

function moldeCoautores(dono, email) {
  return `# Coautores HUMANOS aceitos neste repositório. ALLOWLIST, não lista de inimigos.
#
# Por que invertido: a política antiga era uma ENUMERAÇÃO de agentes de IA, e o
# ataque de 2026-08-30 furou os dois lugares onde ela morava — seis agentes
# entraram no histórico de uma vez, com trailer que o git reconhece como
# coautoria, e a régua acusou 1 de 9 commits quando 8 tinham trailer. Enumerar
# agente é corrida que se perde toda semana; humano do projeto é lista curta e
# que muda uma vez por ano.
#
# FORMATO: uma identidade por linha, "Nome <email>" ou só o e-mail. O que é
# comparado é o E-MAIL, em caixa baixa. Nome é texto livre e não identifica
# ninguém. Linha vazia e linha começada por # são ignoradas.
#
# QUEM LÊ:
#   .githooks/check-message.mjs       no commit-msg, antes de o commit existir
#   regra coautoria-ia do rebar-check   no histórico, depois de ele existir
#
# ESTE ARQUIVO TEM DE ESTAR RASTREADO. O rebar-check só o aceita se o
# "git ls-files" o listar, porque allowlist solta no disco é allowlist que o
# auditor não vê — e aqui um arquivo de dois bytes desligaria a regra inteira.

${dono} <${email}>
`
}

function moldeReadme(nome, dono, ano) {
  return `# ${nome}

Site estático em Next.js com App Router, gerado pelo \`rebar new\` e nascido com
o portão ligado.

## A pilha, e por que ela

| peça | escolha | motivo |
| --- | --- | --- |
| framework | Next 16, App Router, \`output: "export"\` | publica no GitHub Pages sem servidor |
| UI | shadcn no estilo \`base-nova\`, sobre \`@base-ui/react\` | zero Radix, decisão da §12.2 |
| estilo | Tailwind 4 | vem com o preset |
| conteúdo | \`conteudo/*.json\`, validado no build | §12.3 — ver abaixo |

## Conteúdo não mora no código

Telefone, CNPJ, endereço e preço são **conteúdo validado**, em \`conteudo/*.json\`,
e não literal em \`.tsx\` nem variável de ambiente. A decisão tem custo medido:
mover o número de WhatsApp para variável de ambiente faz o build passar, o link
de WhatsApp subir sem destinatário e o cardápio parar de entregar pedido **em
silêncio**. A régua do rebar cobra isso pelas regras \`telefone\` e
\`conteudo-fora-do-codigo\`.

## Comandos

\`\`\`sh
npm run dev         # desenvolvimento
npm run verificar   # o portão inteiro: lint, typecheck, teste e build
npm run build       # gera out/ , estático
npx --yes github:Navesz/rebar .   # a régua do rebar, o placar
\`\`\`

## Hooks

\`\`\`sh
node .githooks/install.mjs
\`\`\`

Configura \`core.hooksPath\`, então o hook é versionado e atualiza junto com o
repositório. O \`pre-commit\` varre segredo no que está em stage; o \`commit-msg\`
barra trailer de coautoria de IA antes de o commit existir. Pular uma vez:
\`git commit --no-verify\`.

## Licença

Apache-2.0. Ver \`LICENSE\` e \`NOTICE\`.

Copyright ${ano} ${dono}.
`
}

// ─────────────────────────────────────────────────────────────────── AGENTS.md
//
// THE DECISION, IN WRITING: (a) OVERWRITE IN pt-BR, PRESERVING THE SHADCN
// BLOCK. Not (b), "leave it as it is".
//
// What `shadcn create` delivers is a 5-line AGENTS.md, in English, between the
// `BEGIN:nextjs-agent-rules` markers. The content is good and it is true: it
// warns that that Next version has a breaking change and tells you to read the
// docs in `node_modules/next/dist/docs/` before writing code.
//
// WHY NOT (b). The argument for (b) is reasonable and it is not what decides:
// yes, an agent instruction in English works, and the model that will read this
// understands both languages. But the file is not ONE PARAGRAPH IN ENGLISH — it
// is the ONLY CONTENT of the file, and it is third-party content about the
// framework. An agent that opens this AGENTS.md learns about Next and ZERO
// about this project: it does not find out that the language is Portuguese,
// that content does not live in the code, that a new dependency needs a reason,
// nor that it may not sign the commit itself. This project's original forensics
// listed "AGENTS.md ausente ou só boilerplate" [AGENTS.md missing or only
// boilerplate] as a failure with frequency 5 in 6 repositories — this file is
// exactly the "só boilerplate" [only boilerplate] case, and a generator that
// manufactures the failure the owner's own forensics catalogued is
// manufacturing debt.
//
// WHY THE BLOCK STAYS INTACT. It is not ours and it ages with Next: it speaks
// of the version installed HERE, and a translation of ours becomes a copy that
// rots on shadcn's next release — the same reason this repository delegates the
// whole scaffold instead of keeping a copy of it. It is extracted by the
// markers and put back byte for byte, with a single declared change: CRLF
// becomes LF, because `escrever()` normalizes the whole file and .gitattributes
// was going to normalize it anyway on `git add`.
//
// ───────────────────────────────────────── what the file HAS TO DO, and the size
//
// The owner's request, verbatim: "a IA tem que entender que ela tem que ativar
// o MCP, e ela tem que falar para o usuário que esse MCP tem que ser ativado, se
// não estiver ativado" [the AI has to understand that it has to activate the
// MCP, and it has to tell the user that this MCP has to be activated, if it is
// not activated]. So the FIRST section is not about the stack nor about the
// language: it is an order — call `rebar_regras` before the first line of code —
// and, for the case where the tool does not exist in the session, a READY-MADE
// SENTENCE the agent just copies to the user. An instruction that depends on the
// model composing its own error message is an instruction that comes out
// different every session.
//
// And it is SHORT by measurement, not by taste: §7.2 of docs/PLANO.md records
// that herz's MCP had 17 guides and 1,961 lines and is demonstrably ignorable.
// The target here is under 60 lines. What does not fit becomes an MCP tool, not
// a paragraph — which is exactly why §1 names the five tools instead of
// explaining what each rule demands.
//
// ─────────────────────────── why the prose lives in a .md, and not in this .mjs
//
// This file's prose used to be a template literal in here. It moved out, and the
// reason is mechanical: markdown with a code fence inside a backtick needs every
// backtick and every `${` escaped, and a forgotten escape does not raise an
// error — it closes the string early and AGENTS.md comes out truncated. In
// `arquivos/agentes.md` the bytes you read are the bytes that come out. As a
// bonus the file becomes a tracked `.md`, and the `elos` step of verificar
// checks its links the way it checks everyone else's.
//
// IT DOES NOT GO INTO `ESTATICOS` because it is not a copy: it has two values
// that only exist at generation time (the project name and the launcher path,
// which is a constant of this file) and the third-party block, which is
// extracted from what shadcn wrote.
const MOLDE_AGENTES = 'agentes.md'
const MARCADOR_AGENTES = '<!-- rebar:agentes -->'
const RE_BLOCO_SHADCN =
  /<!--\s*BEGIN:nextjs-agent-rules\s*-->[\s\S]*?<!--\s*END:nextjs-agent-rules\s*-->/

/**
 * Assembles the AGENTS.md from `arquivos/agentes.md`.
 *
 * The substitution is a literal `{{chave}}`, with `split`/`join` and not
 * `replace` with a regex: the substituted value contains `$` in no case today,
 * but `$&` and `$'` inside a `replace` are special substitutions nobody
 * remembers when adding a new key, and the defect only shows up in the
 * generated file.
 *
 * The wrapper around the third-party block lives HERE, and not in the template,
 * because it is conditional: with no block there is no section at all, and a
 * template with an empty section would leave an orphan heading in the file of a
 * project that came without one.
 *
 * THE WRAPPER TEXT BELOW STAYS IN PORTUGUESE, and for two reasons. It is
 * generated-project content, like the templates above. And the heading is
 * matched by `new/gate/prove-map.mjs`, which asserts
 * `doesNotMatch(agents, /Aviso do scaffold/)` for the no-block case: translating
 * it would leave that assertion passing for the wrong reason, which is worse
 * than no assertion because it occupies its place.
 */
function moldeAgents(nome, blocoTerceiro) {
  const terceiro = blocoTerceiro
    ? `## Aviso do scaffold, preservado como veio

O bloco abaixo é do \`shadcn create\`, está em inglês e fica INTACTO de
propósito: ele fala da versão do Next que está instalada aqui e envelhece junto
com ela. Traduzir seria manter uma cópia que apodrece na próxima release.

${blocoTerceiro}
`
    : ''

  const molde = readFileSync(join(MOLDES, MOLDE_AGENTES), 'utf8')
  return Object.entries({
    nome,
    lancador: MCP_LANCADOR,
    'bloco-terceiro': terceiro,
  }).reduce((texto, [chave, valor]) => texto.split(`{{${chave}}}`).join(valor), molde)
}

/**
 * Writes the AGENTS.md in pt-BR preserving the third-party block, idempotently
 * and WITHOUT EVER destroying text that is not shadcn boilerplate.
 *
 * The four states, and none of them is silent:
 *
 *   'was there'    the file already has our marker — second pass of the
 *                  generator, or the preset wrote first. A declared no-op,
 *                  which is the rule of this whole file.
 *   'rewritten'    the file was ONLY the shadcn block (and whitespace). It is
 *                  the case decision (a) exists to handle.
 *   'no block'     the file did not exist, or had no block. The pt-BR template
 *                  comes out on its own.
 *   'left alone'   there was text outside the block that is not ours. Someone
 *                  wrote there, or a future shadcn version started writing
 *                  more. It becomes a WARNING and the file stays as it is:
 *                  overwriting someone else's prose is exactly the defect a
 *                  layered generator's `force: true` commits.
 */
function garantirAgents(destino, nome, avisos) {
  const rel = 'AGENTS.md'
  const atual = lerSe(destino, rel)

  if (atual !== null && atual.includes(MARCADOR_AGENTES)) return 'was there'

  const casou = atual === null ? null : atual.match(RE_BLOCO_SHADCN)
  const bloco = casou ? casou[0].replace(/\r\n/g, '\n') : ''

  if (atual !== null) {
    const resto = atual.replace(RE_BLOCO_SHADCN, '').trim()
    if (resto) {
      avisos.push(
        'AGENTS.md has text outside the `nextjs-agent-rules` block that is not from the gate — ' +
          'I did not overwrite. Check by hand that the project rules are there, in pt-BR',
      )
      return 'left alone'
    }
  }

  escrever(destino, rel, moldeAgents(nome, bloco))
  return atual === null ? 'no block' : bloco ? 'rewritten' : 'no block'
}

// ─────────────────────────────────────────────────────────────── the steps

/**
 * Next's `output: "export"`, idempotently.
 *
 * Without it `next build` generates a server and GitHub Pages publishes an
 * empty folder — a failure that does NOT show up in the build, only in the
 * deploy. `images.unoptimized` comes along because Next's image optimizer
 * requires a running server, and without it the same build passes and the
 * images vanish in production.
 *
 * Idempotent because the `site` preset has the same right to write here. If
 * there already is an `output:`, this function does not touch it. If the file
 * does not have the shape it knows how to edit, it WARNS instead of pretending
 * it edited — a silent patch that did not land is how the defect reaches
 * production.
 */
function garantirExportEstatico(destino, avisos) {
  const rel = 'next.config.ts'
  const atual = lerSe(destino, rel)
  if (atual === null) {
    avisos.push('next.config.ts does not exist — the output: "export" was not applied')
    return 'missing'
  }
  if (/output\s*:\s*['"]export['"]/.test(atual)) return 'was there'

  // The comments inside `corpo` go INTO the generated project's next.config.ts
  // and stay in Portuguese for the same reason as the templates above: the
  // generated project is pt-BR, and `new/site/blocks/next.config.ts` is too.
  const corpo = `{
  // GitHub Pages serve arquivo, não processo. Sem isto o build gera servidor e
  // o Pages publica uma pasta vazia — falha que só aparece no deploy.
  output: "export",
  images: {
    // O otimizador de imagem do Next exige servidor em execução. Com export
    // estático e sem esta linha, o build passa e as imagens somem em produção.
    unoptimized: true,
  },
}`
  const vazio = /(const\s+nextConfig\s*:\s*NextConfig\s*=\s*)\{\s*\}/
  if (!vazio.test(atual)) {
    avisos.push(
      'next.config.ts was already edited by another layer and does not have the expected ' +
        'shape — check by hand that output: "export" is there',
    )
    return 'unrecognized'
  }
  escrever(destino, rel, atual.replace(vazio, `$1${corpo}`))
  return 'applied'
}

/**
 * The `.mcp.json` and the launcher have to point at each other.
 *
 * This is §7.2's freshness gate at the size this project asks for. That one
 * regenerates the artifact and compares it against the disk; here there is no
 * artifact to regenerate — on purpose, because this project keeps no copy of
 * any rule. What IS LEFT to diverge is the path written twice: once in
 * `MCP_LANCADOR`, once inside the JSON, which has no way to import a constant.
 *
 * Renaming the folder in one place and forgetting the other produces a
 * `.mcp.json` that points at nothing — and an MCP client with a server that
 * does not come up shows as a gray line nobody reads. It is the same class of
 * defect the whole gate chases: the decision is in the file and no machine
 * executes it.
 *
 * Here the check happens at generation time; `testes/portao.test.mjs` repeats
 * the same question inside the project, in `npm run verificar` and in CI, for
 * the day somebody touches `.mcp.json` without going through the generator.
 */
function conferirPonteiroMcp(destino, avisos) {
  const bruto = lerSe(destino, '.mcp.json')
  if (bruto === null) {
    avisos.push(
      '.mcp.json was not written — the AI that opens this project cannot find its rules by MCP',
    )
    return 'missing'
  }
  let alvo
  try {
    alvo = JSON.parse(bruto)?.mcpServers?.rebar?.args?.find((a) => a.endsWith('.mjs'))
  } catch (erro) {
    avisos.push(`.mcp.json is not valid JSON (${erro.message}) — no client will read it`)
    return 'unreadable'
  }
  if (alvo !== MCP_LANCADOR) {
    avisos.push(
      `.mcp.json points at ${JSON.stringify(alvo)} and the gate wrote ${MCP_LANCADOR} — ` +
        'the pointer fell into the void. Fix the `mcp.json` template in new/gate/arquivos/',
    )
    return 'diverged'
  }
  if (!existsSync(join(destino, ...MCP_LANCADOR.split('/')))) {
    avisos.push(`.mcp.json points at ${MCP_LANCADOR}, which is not on disk`)
    return 'no launcher'
  }
  return 'matches'
}

/**
 * The scripts the gate demands from package.json.
 *
 * `verificar` is ONE command, and CI calls only it. The reason is rebar's
 * `ci-gateia` rule: it demands that CI REACH the lint, the typecheck and the
 * test the repository has, and it expands `npm run verificar` by reading the
 * body of the script. With the steps written in the YAML, renaming a script
 * turns the step off and the YAML stays green; with a single command, the drift
 * shows up right away.
 *
 * It only chains what EXISTS. Calling `npm run lint` in a project without
 * `lint` is a CI that breaks because of the generator, not because of the code.
 */
function garantirScripts(destino, avisos) {
  const bruto = lerSe(destino, 'package.json')
  if (bruto === null) {
    avisos.push('package.json does not exist — no script was adjusted')
    return null
  }
  const pkg = JSON.parse(bruto)
  pkg.scripts = pkg.scripts || {}

  // The GLOB pattern, and not `node --test testes/`. Measured on Node 24.13 on
  // Windows: with the folder as a positional argument, the runner tries to LOAD
  // `testes` as a module and dies with MODULE_NOT_FOUND — "✖ test at
  // testes:1:1", a failure that does not look like a path failure. The glob is
  // expanded by Node itself since v22, so it does not depend on a shell and
  // holds on both systems.
  //
  // Pointed at the folder and not left loose: `node --test` on its own would
  // sweep the whole repository and try to interpret the app's `.tsx` as tests.
  // Node built-in, zero new dependencies.
  if (!pkg.scripts.test) pkg.scripts.test = 'node --test "testes/**/*.test.mjs"'

  const elos = ['lint', 'typecheck', 'test', 'build'].filter((n) => pkg.scripts[n])
  // `npm test` and not `npm run test`: it is the canonical name, and the
  // `ci-gateia` rule looks for the word `test`, which is in both.
  pkg.scripts.verificar = elos.map((n) => (n === 'test' ? 'npm test' : `npm run ${n}`)).join(' && ')

  escrever(destino, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  return elos
}

/**
 * The execute bit, which is the trap rebar has already paid for once.
 *
 * On Windows `core.filemode` is false: a `chmodSync(0o755)` on disk does NOT
 * become mode 100755 in the git index. The hook is committed as 100644, and on
 * Linux git simply DOES NOT EXECUTE IT — no error, no warning, nothing. The
 * gate looks installed and verifies zero.
 *
 * `git update-index --chmod=+x` writes the mode into the index directly, and it
 * is the only form that works the same on both systems. The chmod on disk comes
 * along because whoever just generated the project will run the hook before any
 * clone, and on Linux it needs the bit on disk too.
 *
 * Runs AFTER `git add`: `--chmod` touches the index, and what is not in the
 * index has no mode to touch.
 */
function marcarExecutaveis(destino, avisos) {
  for (const rel of EXECUTAVEIS) {
    try {
      chmodSync(join(destino, ...rel.split('/')), 0o755)
    } catch (erro) {
      avisos.push(`could not chmod ${rel}: ${erro.message}`)
    }
  }
  try {
    execFileSync('git', ['update-index', '--add', '--chmod=+x', ...EXECUTAVEIS], {
      cwd: destino,
      encoding: 'utf8',
    })
  } catch (erro) {
    avisos.push(`git update-index --chmod=+x failed: ${erro.message}`)
    return null
  }
  // Check, do not trust. The mode is the whole point of this function.
  // `-z` here does NOT fix the check: the mode sits at the start of the line
  // and `startsWith('100755')` is right even with the path quoted. It fixes the
  // MESSAGE -- without it the warning shows the escaped sequence in place of
  // the name, and whoever reads it does not recognize their own file.
  const saida = execFileSync('git', ['ls-files', '-s', '-z', ...EXECUTAVEIS], {
    cwd: destino,
    encoding: 'utf8',
  })
  const linhas = saida.split('\0').filter(Boolean)
  const errados = linhas.filter((l) => !l.startsWith('100755'))
  if (errados.length) {
    avisos.push(`hook without mode 100755 in the index: ${errados.join(' | ')}`)
    return null
  }
  return linhas
}

// ─────────────────────────────────────────────────────────── the application

/**
 * Applies the gate over an already existing project.
 *
 * @param {object} opcoes
 * @param {string} opcoes.destino    root of the generated project
 * @param {string} opcoes.nome       project name, already validated by the caller
 * @param {string} opcoes.raizRebar  root of the rebar checkout, what is copied from
 * @param {string} opcoes.dono       owner name, for NOTICE and allowlist
 * @param {string} opcoes.email      owner e-mail, for the allowlist
 * @returns {{escritos: string[], avisos: string[], elos: string[]|null, exportEstatico: string}}
 */
export function aplicarPortao({ destino, nome, raizRebar, dono, email }) {
  const escritos = []
  const avisos = []

  for (const [molde, rel] of ESTATICOS) {
    escrever(destino, rel, readFileSync(join(MOLDES, molde), 'utf8'))
    escritos.push(rel)
  }

  for (const [origem, rel] of COPIADOS_DO_REBAR) {
    const de = join(raizRebar, ...origem.split('/'))
    if (!existsSync(de)) {
      // Loud and clear. Without LICENSE, the `licenca` and `notice` rules fail;
      // without the scanner, the pre-commit dies on the first commit. Neither of
      // the two can become a warning somebody reads later.
      avisos.push(`NOT FOUND in rebar: ${origem} — the project comes out incomplete`)
      continue
    }
    const para = join(destino, ...rel.split('/'))
    mkdirSync(dirname(para), { recursive: true })
    copyFileSync(de, para)
    escritos.push(rel)
  }

  const ano = new Date().getFullYear()
  escrever(destino, 'NOTICE', moldeNotice(nome, dono, ano))
  escrever(destino, '.rebar-coauthors', moldeCoautores(dono, email))
  // The create-next-app README is framework boilerplate, and the README is the
  // first thing one sees in a public repository. This is the only scaffold file
  // the gate overwrites without asking permission.
  escrever(destino, 'README.md', moldeReadme(nome, dono, ano))
  escritos.push('NOTICE', '.rebar-coauthors', 'README.md')

  // The scaffold's AGENTS.md is the second — and last — scaffold file the gate
  // overwrites. See the header of `garantirAgents` for the decision.
  const agents = garantirAgents(destino, nome, avisos)
  if (agents !== 'left alone') escritos.push(`AGENTS.md (${agents})`)

  // The shadcn .prettierignore knows neither prose nor license. Add, do not
  // replace: what it already lists (.next/, coverage/) still holds.
  const ignore = lerSe(destino, '.prettierignore')
  if (ignore !== null && !ignore.includes('LICENSE')) {
    // `nota` goes INTO the generated project's .prettierignore, so it stays in
    // Portuguese along with the rest of what that project receives.
    const nota =
      '# Prosa e texto legal ficam fora. O prettier reflui markdown e a licença,\n' +
      '# e um diff de milhares de linhas esconde a mudança real.\n'
    escrever(
      destino,
      '.prettierignore',
      `${ignore.replace(/\s*$/, '')}\n\n${nota}*.md\nLICENSE\nNOTICE\n`,
    )
    escritos.push('.prettierignore')
  }

  const exportEstatico = garantirExportEstatico(destino, avisos)
  const elos = garantirScripts(destino, avisos)
  escritos.push('next.config.ts', 'package.json')

  // After the ESTATICOS, because it is precisely the two files they just wrote
  // that this function confronts with each other.
  const mcp = conferirPonteiroMcp(destino, avisos)

  // LAST, and for two reasons. First: it only makes sense to ask "is there a
  // file left with no decision?" after every decision has been executed.
  // Second: the oracle is the git index, and the index has to keep being what
  // `shadcn create` left — the generator's `git add -A` comes after this
  // function, and after it `git ls-files` would start listing ours too.
  const scaffold = conferirScaffold(destino, avisos)

  return { escritos, avisos, elos, exportEstatico, agents, scaffold, mcp }
}

export {
  // Exported for `prove-map.mjs`: the test the generator EMITS makes seven
  // assertions about the AGENTS.md, and what produces the AGENTS.md is this
  // function. Until 2026-09-07 nothing executed it, and the template and the
  // emitted test diverged in two places without anything calling it out.
  moldeAgents,
  marcarExecutaveis,
  PASTA_HOOKS,
  EXECUTAVEIS,
  DESTINO_DO_SCAFFOLD,
  MARCADOR_AGENTES,
  MCP_LANCADOR,
}
