// O PORTÃO. É o que o gerador aplica POR CIMA do que o `shadcn create` entregou.
//
// A divisão de trabalho está fechada e é a razão de este arquivo ser pequeno: o
// scaffold é do shadcn, que já entrega a pilha decidida na §12.2 — Next 16 App
// Router, React 19, Tailwind 4, base-nova, zero Radix. Escrever o nosso próprio
// scaffold seria assumir a manutenção de uma cópia do trabalho do shadcn, para
// sempre, e ela começaria a apodrecer na primeira release deles.
//
// O portão é o que o shadcn NÃO entrega e o rebar cobra: régua, CI em matriz,
// hooks, licença, e o fim de linha normalizado.
//
// TUDO AQUI É IDEMPOTENTE, e não é elegância. Outro passo do gerador — o preset
// `site` — escreve no mesmo projeto no mesmo minuto, e os dois têm motivo para
// encostar no next.config.ts. Sobrescrever o que o vizinho acabou de escrever é
// o defeito clássico de gerador em camadas; aqui cada escrita ou é a primeira
// ou é um no-op declarado.

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

// fileURLToPath, não .pathname: no Windows o pathname vem "/C:/Users/...", com
// barra antes da letra do drive, e todo join a partir dele aponta para o nada.
const AQUI = dirname(fileURLToPath(import.meta.url))
const MOLDES = join(AQUI, 'arquivos')

// ─────────────────────────────────────────────────────────── moldes estáticos
//
// Os moldes moram sem o ponto inicial no nome (`editorconfig`, não
// `.editorconfig`) DE PROPÓSITO. Um `.gitignore` ou um `.editorconfig` de
// verdade dentro desta pasta valeria para a subárvore do PRÓPRIO rebar — o git
// e os editores leem arquivo de configuração em qualquer profundidade — e o
// molde passaria a mudar o comportamento do repositório que só queria guardá-lo.
// O mapa abaixo é o único lugar onde o nome final é decidido.

// Os hooks vão para `.githooks/` e NÃO para `hooks/`, e isso não é gosto: o
// `shadcn create` já cria `hooks/` como a pasta de React hooks do projeto,
// aliasada como `@/hooks` no components.json. Despejar `pre-commit` lá dentro
// misturaria hook de git com hook de React na mesma pasta e no mesmo alias.
const PASTA_HOOKS = '.githooks'

// O LANÇADOR DO MCP, e por que ele NÃO vai para `.githooks/`.
//
// `.githooks/` é o que o `core.hooksPath` aponta: tudo lá dentro é candidato a
// ser executado pelo git num evento de commit. O lançador do MCP não é hook de
// coisa nenhuma — quem o executa é o cliente de IA, e num momento que não tem
// relação com git. Misturar os dois faria o `git` tropeçar num arquivo que não
// é dele no dia em que ganhar um nome de evento novo.
//
// `.rebar/` começa com ponto pelo mesmo motivo que `.githooks/`: é ferramental
// do repositório, não fonte do produto. Medido no scaffold do `shadcn create`:
// o `tsconfig.json` só inclui .ts/.tsx/.mts, então este .mjs fica fora do
// typecheck, e o `eslint.config.mjs` não o alcança — nenhum dos dois passa a ter
// trabalho por causa dele.
const PASTA_REBAR = '.rebar'

// O CAMINHO DO LANÇADOR MORA AQUI, UMA VEZ. O `.mcp.json` repete este mesmo
// caminho dentro dele, porque JSON não tem como importar constante — e é essa
// repetição que `conferirPonteiroMcp` afere, logo depois de escrever os dois.
const MCP_LANCADOR = `${PASTA_REBAR}/mcp.mjs`

const ESTATICOS = [
  ['editorconfig', '.editorconfig'],
  ['gitattributes', '.gitattributes'],
  ['dependabot.yml', '.github/dependabot.yml'],
  ['verificar.yml', '.github/workflows/verificar.yml'],
  ['pre-commit', `${PASTA_HOOKS}/pre-commit`],
  ['commit-msg', `${PASTA_HOOKS}/commit-msg`],
  ['instalar.mjs', `${PASTA_HOOKS}/instalar.mjs`],
  ['portao.test.mjs', 'testes/portao.test.mjs'],
  // O ponteiro para as regras. Ver o cabeçalho de `mcp-rebar.mjs` para a
  // decisão inteira; o resumo é: este projeto NÃO ganha MCP próprio, porque um
  // MCP próprio aqui serviria uma cópia das 22 regras do rebar, e cópia de
  // regra que envelhece é exatamente o requisito nº 5 do plano.
  ['mcp.json', '.mcp.json'],
  ['mcp-rebar.mjs', MCP_LANCADOR],
]

// Peças que o gerador COPIA do próprio rebar em vez de duplicar aqui.
//
// São arquivos que já existem, já são revisados e já têm prova: o texto integral
// da Apache-2.0, o varredor de segredo e o checador de mensagem de commit. Uma
// segunda cópia deles nesta pasta seria uma cópia que envelhece separado da
// original — e a única coisa pior que não ter varredor de segredo é ter um
// desatualizado que diz que olhou.
//
// Os dois `.mjs` copiados são autocontidos, só de built-in do Node, e acham a
// raiz por `git rev-parse --show-toplevel`. Postos em `.githooks/`, eles leem o
// repositório GERADO, não o rebar.
const COPIADOS_DO_REBAR = [
  ['LICENSE', 'LICENSE'],
  ['ferramental/segredo/varrer-segredo.mjs', `${PASTA_HOOKS}/varrer-segredo.mjs`],
  ['ferramental/hooks/checar-mensagem.mjs', `${PASTA_HOOKS}/checar-mensagem.mjs`],
]

// Os dois arquivos que o git precisa ver como 100755. Ver `marcarExecutaveis`.
const EXECUTAVEIS = [`${PASTA_HOOKS}/pre-commit`, `${PASTA_HOOKS}/commit-msg`]

// ───────────────────────────── o que o scaffold emite, e o destino de cada arquivo
//
// ESTA LISTA EXISTE PORQUE O SILÊNCIO JÁ DEIXOU PASSAR UM ARQUIVO.
//
// O `shadcn create` emitiu 23 arquivos na medição de 2026-08-31 (Next 16,
// base-nova). O portão tinha decisão escrita sobre cinco deles e NENHUMA
// palavra sobre os outros dezoito — e um desses dezoito era um `AGENTS.md` de 5
// linhas, em inglês, que é instrução direta para agente de IA num projeto cuja
// regra é português. Ele atravessou o portão inteiro sem encostar em nada:
// nenhuma das 22 regras do rebar-check o vê. A `idioma-unico` só lê COMENTÁRIO
// DE CÓDIGO (`r.fontes`), então prosa em `.md` nunca chega nela; a `readme` só
// pergunta se existe README. Não foi aprovação, foi ausência de pergunta.
//
// Então a pergunta passa a ser feita para TODO arquivo do scaffold, aqui, uma
// vez, por escrito. Três destinos possíveis e nada mais:
//
//   'sobrescrito'   — o portão ou o preset `site` escreve por cima.
//   'complementado' — o arquivo do scaffold continua valendo e ganha o nosso
//                     acréscimo; nunca substituído.
//   'preservado'    — fica exatamente como o shadcn entregou, DE PROPÓSITO.
//
// A chave usa barra normal porque é assim que o `git ls-files` devolve caminho
// nos dois sistemas — comparar com `path.join` aqui seria comparar `\` com `/`
// e nunca casar no Windows.
const DESTINO_DO_SCAFFOLD = {
  'AGENTS.md': {
    destino: 'sobrescrito',
    porque:
      'instrução de agente em inglês, e só o boilerplate do shadcn; ver `garantirAgents`, ' +
      'que reescreve em pt-BR e preserva o bloco de terceiro intacto',
  },
  'README.md': {
    destino: 'sobrescrito',
    porque: 'boilerplate de framework, e é a primeira coisa que se vê num repositório público',
  },
  'app/layout.tsx': {
    destino: 'sobrescrito',
    porque: 'o preset `site` põe o metadado que sobrevive sem JavaScript',
  },
  'app/page.tsx': {
    destino: 'sobrescrito',
    porque: 'o preset `site` põe a home que lê `conteudo/site.json`',
  },
  'next.config.ts': {
    destino: 'complementado',
    porque: 'ganha `output: "export"` e `images.unoptimized`; ver `garantirExportEstatico`',
  },
  'package.json': {
    destino: 'complementado',
    porque: 'ganha os scripts `test` e `verificar`; o resto do manifesto é do scaffold',
  },
  '.prettierignore': {
    destino: 'complementado',
    porque: 'o do shadcn não conhece prosa nem licença; o que ele já lista continua valendo',
  },
  '.gitignore': {
    destino: 'complementado',
    porque:
      'o preset `site` acrescenta `/out`, que é a saída do export; o scaffold não sabe que ' +
      'vai exportar',
  },
  '.prettierrc': {
    destino: 'preservado',
    porque:
      '`endOfLine: "lf"` já bate com o nosso .gitattributes, e o `prettier-plugin-tailwindcss` ' +
      'e o `tailwindStylesheet` são configuração do tema que veio junto — reescrever é brigar ' +
      'com o formatador do próprio scaffold',
  },
  'eslint.config.mjs': {
    destino: 'preservado',
    porque: '`globalIgnores` já cobre `out/**`, que é para onde o export escreve',
  },
  'tsconfig.json': {
    destino: 'preservado',
    porque:
      'o `include` cobre .ts/.tsx/.mts e NÃO cobre .mjs — o `testes/portao.test.mjs` fica fora ' +
      'do typecheck de propósito: ele é Node puro, não TypeScript, e roda no `node --test`',
  },
  'app/globals.css': {
    destino: 'preservado',
    porque:
      'é o tema base-nova inteiro, em token do Tailwind 4; encostar aqui é assumir a ' +
      'manutenção do tema do shadcn para sempre. A regra `hex-cru` cobra que o código não ' +
      'duplique estes tokens em hex',
  },
  'app/favicon.ico': {
    destino: 'preservado',
    porque:
      'o preset `site` gera og.png e icone-192/512.png, que são outra coisa: o Next serve ' +
      'este arquivo como /favicon.ico e nada do nosso o substitui',
  },
  'components.json': {
    destino: 'preservado',
    porque:
      'é o contrato do `shadcn add`; as regras `ui-falso` e `shadcn-completo` do rebar-check ' +
      'exigem que ele exista ao lado de components/ui/',
  },
  'components/ui/button.tsx': {
    destino: 'preservado',
    porque: 'componente do registro, atualizado por `shadcn add`, não por nós',
  },
  'components/theme-provider.tsx': {
    destino: 'preservado',
    porque: 'idem — vem do template `next` do shadcn',
  },
  'lib/utils.ts': {
    destino: 'preservado',
    porque: 'o `cn()`; todo componente do registro importa daqui pelo alias do components.json',
  },
  'components/.gitkeep': { destino: 'preservado', porque: 'pasta aliasada no components.json' },
  'lib/.gitkeep': { destino: 'preservado', porque: 'pasta aliasada no components.json' },
  'hooks/.gitkeep': {
    destino: 'preservado',
    porque:
      'pasta de React hooks, aliasada como `@/hooks` — é exatamente por causa dela que os ' +
      'hooks de git vão para `.githooks/` e não para `hooks/`',
  },
  'public/.gitkeep': {
    destino: 'preservado',
    porque: 'o preset `site` escreve as imagens ao lado; o marcador não atrapalha',
  },
  'postcss.config.mjs': { destino: 'preservado', porque: 'plugin do Tailwind 4, e nada além' },
  'package-lock.json': {
    destino: 'preservado',
    porque:
      'é o resultado do `npm install` que o scaffold acabou de rodar; reescrever à mão é ' +
      'fabricar um lock que não corresponde a nenhuma instalação',
  },
}

// O DESTINO DE ARQUIVO QUE ESTA LISTA NÃO CONHECE: fica no disco e VIRA AVISO,
// com o nome dele na tela.
//
// Nunca apagado — apagar arquivo que o scaffold acabou de escrever, sem saber o
// que ele é, é pior que a omissão que esta lista conserta. E nunca silencioso:
// o `index.mjs` derruba o exit code do gerador para 1 quando há qualquer aviso,
// então uma release do shadcn que passe a emitir um arquivo novo faz o gerador
// sair vermelho com o nome do arquivo, e alguém decide. Foi assim que o
// AGENTS.md teria aparecido no dia em que nasceu, em vez de num ataque
// adversarial semanas depois.
//
// O oráculo é o ÍNDICE DO GIT, e não o disco. Medido em 2026-08-31: o `shadcn
// create` roda `git init` e deixa os 23 arquivos EM STAGE, sem nenhum commit.
// O preset `site` e o portão escrevem só no disco — nenhum dos dois toca no
// índice, e o `git add -A` do gerador só roda depois. Logo, neste ponto do
// fluxo, `git ls-files` é exatamente a lista do que o shadcn emitiu, sem uma
// linha de acoplamento com o que o vizinho escreveu.
function conferirScaffold(destino, avisos) {
  let bruto
  try {
    // -z: sem `-z` o git cita caminho com caractere fora do ASCII entre aspas e
    // com escape de barra invertida, e a comparação com a chave da lista falha
    // justo no arquivo de nome estranho, que é o que mais precisa de aviso.
    bruto = execFileSync('git', ['ls-files', '-z'], { cwd: destino, encoding: 'utf8' })
  } catch (erro) {
    avisos.push(
      `não consegui ler o índice do scaffold (${erro.message}) — a varredura de arquivo ` +
        'desconhecido NÃO rodou, e é ela que impede que arquivo novo do shadcn entre calado',
    )
    return null
  }
  const emitidos = bruto.split('\0').filter(Boolean)
  if (!emitidos.length) {
    avisos.push(
      'o índice do git está vazio neste ponto — o `shadcn create` deixava 23 arquivos em ' +
        'stage em 2026-08-31. Mudou de comportamento, e a varredura de arquivo desconhecido ' +
        'perdeu o oráculo dela: confira à mão o que o scaffold emitiu',
    )
    return null
  }

  const desconhecidos = emitidos.filter((a) => !(a in DESTINO_DO_SCAFFOLD))
  if (desconhecidos.length) {
    avisos.push(
      `o scaffold emitiu ${desconhecidos.length} arquivo(s) que DESTINO_DO_SCAFFOLD não ` +
        `conhece: ${desconhecidos.join(', ')}. Ficaram como vieram, intocados. Decida o ` +
        'destino de cada um em novo/portao/aplicar.mjs — foi calado assim que o AGENTS.md ' +
        'em inglês entrou',
    )
  }

  // A deriva contrária também conta: arquivo que a lista espera e o scaffold
  // parou de emitir. Sem `eslint.config.mjs` o `npm run lint` morre, e o script
  // `verificar` — que é o CI inteiro — morre junto.
  const sumidos = Object.keys(DESTINO_DO_SCAFFOLD).filter((a) => !emitidos.includes(a))
  if (sumidos.length) {
    avisos.push(
      `o scaffold NÃO emitiu ${sumidos.length} arquivo(s) que DESTINO_DO_SCAFFOLD espera: ` +
        `${sumidos.join(', ')}. Ou o shadcn mudou, ou a lista envelheceu`,
    )
  }

  return { emitidos: emitidos.length, desconhecidos, sumidos }
}

// ──────────────────────────────────────────────────────────────── utilitários

function escrever(destino, rel, texto) {
  const caminho = join(destino, ...rel.split('/'))
  mkdirSync(dirname(caminho), { recursive: true })
  // LF sempre, e escrito à mão em vez de confiado ao .gitattributes: o
  // .gitattributes conserta o que o git INDEXA, não o que está no disco de quem
  // acabou de rodar o gerador.
  writeFileSync(caminho, texto.replace(/\r\n/g, '\n'), 'utf8')
}

function lerSe(destino, rel) {
  const caminho = join(destino, ...rel.split('/'))
  return existsSync(caminho) ? readFileSync(caminho, 'utf8') : null
}

// ─────────────────────────────────────────────────────────── conteúdo gerado

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
#   .githooks/checar-mensagem.mjs       no commit-msg, antes de o commit existir
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

Site estático em Next.js com App Router, gerado pelo \`rebar novo\` e nascido com
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
node .githooks/instalar.mjs
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
// A DECISÃO, POR ESCRITO: (a) SOBRESCREVER EM pt-BR, PRESERVANDO O BLOCO DO
// SHADCN. Não (b), "deixar como está".
//
// O que o `shadcn create` entrega é um AGENTS.md de 5 linhas, em inglês, entre
// os marcadores `BEGIN:nextjs-agent-rules`. O conteúdo é bom e é verdadeiro:
// avisa que aquela versão do Next tem breaking change e manda ler a doc em
// `node_modules/next/dist/docs/` antes de escrever código.
//
// POR QUE NÃO (b). O argumento de (b) é razoável e não é o que decide: sim,
// instrução de agente em inglês funciona, e o modelo que vai ler isto entende
// os dois idiomas. Mas o arquivo não é UM PARÁGRAFO EM INGLÊS — ele é O ÚNICO
// CONTEÚDO do arquivo, e é conteúdo de terceiro sobre o framework. Um agente
// que abre este AGENTS.md aprende sobre o Next e ZERO sobre este projeto: não
// fica sabendo que o idioma é português, que conteúdo não mora no código, que
// dependência nova precisa de motivo, nem que ele próprio não pode assinar o
// commit. A forense original deste projeto listou "AGENTS.md ausente ou só
// boilerplate" como falha de frequência 5 em 6 repositórios — este arquivo é
// exatamente o caso "só boilerplate", e um gerador que fabrica a falha que a
// forense do próprio dono catalogou está fabricando dívida.
//
// POR QUE O BLOCO FICA INTACTO. Ele não é nosso e envelhece com o Next: fala da
// versão instalada AQUI, e uma tradução nossa vira uma cópia que apodrece na
// próxima release do shadcn — o mesmo motivo pelo qual este repositório delega o
// scaffold inteiro em vez de manter uma cópia dele. É extraído pelos marcadores
// e recolocado byte a byte, com uma única mudança declarada: o CRLF vira LF,
// porque o `escrever()` normaliza o arquivo inteiro e o .gitattributes ia
// normalizar de qualquer jeito no `git add`.
const MARCADOR_AGENTES = '<!-- rebar:agentes -->'
const RE_BLOCO_SHADCN =
  /<!--\s*BEGIN:nextjs-agent-rules\s*-->[\s\S]*?<!--\s*END:nextjs-agent-rules\s*-->/

function moldeAgents(nome, blocoTerceiro) {
  const terceiro = blocoTerceiro
    ? `## Aviso do scaffold, preservado como veio

O bloco abaixo é do \`shadcn create\`, está em inglês e fica INTACTO de
propósito: ele fala da versão do Next que está instalada aqui e envelhece junto
com ela. Traduzir seria manter uma cópia que apodrece na próxima release.

${blocoTerceiro}
`
    : ''

  return `${MARCADOR_AGENTES}

# Instruções de agente — ${nome}

Leia o \`README.md\` antes de escrever qualquer coisa: a pilha, os comandos e o
motivo de cada escolha estão lá. Este arquivo é só o que muda o SEU
comportamento.

## As regras deste projeto não estão escritas aqui

Elas são as do \`rebar\`, e se **derivam sob demanda**. Não há cópia delas neste
repositório, de propósito: cópia envelhece calada, e regra velha servida com
cara de regra atual vale menos que regra nenhuma. As duas linhas abaixo rodam
sem instalar nada e são a mesma régua que o CI aplica.

\`\`\`sh
npx --yes github:Navesz/rebar .          # o placar: o que passa, o que reprova, e por quê
npx --yes github:Navesz/rebar . --json   # o mesmo, estruturado, uma entrada por regra
\`\`\`

O \`.mcp.json\` daqui declara esse mesmo rebar como servidor MCP, por
\`${MCP_LANCADOR}\`. É **atalho, não porta**: ferramenta de MCP é discricionária —
quem decide chamá-la é você. Se ela não subir, as duas linhas acima continuam
valendo, e são elas que barram o merge.

## O idioma é português do Brasil

Código, comentário, nome de arquivo e mensagem de commit. O comentário explica o
PORQUÊ, com o número medido quando houver — não repete o que a linha abaixo dele
já diz.

## Conteúdo não mora no código

Telefone, CNPJ, endereço, preço e URL de produção vão em \`conteudo/*.json\`,
validados no build. Literal em \`.tsx\` ou em variável de ambiente faz o build
passar e o site quebrar **em silêncio**, depois de publicado. As regras
\`conteudo-fora-do-codigo\`, \`telefone\` e \`url-producao\` do rebar-check cobram isso.

## Dependência nova precisa de motivo escrito

Se um built-in do Node ou do próprio Next resolve, é ele.

## Você não assina o commit

A coautoria aceita aqui é uma **allowlist de humanos**, em \`.rebar-coautores\`.
Não acrescente trailer \`Co-authored-by\` seu: o \`.githooks/commit-msg\` barra
antes de o commit existir, e a regra \`coautoria-ia\` barra depois, no histórico.
Para entrar na lista é preciso ser uma pessoa do projeto, e quem edita o arquivo
é o dono.

## Rode o portão antes de dizer pronto

\`\`\`sh
npm run verificar   # lint, typecheck, teste e build — o mesmo comando que o CI roda
\`\`\`

Verde comprado desligando regra é dívida, não conclusão.

${terceiro}`
}

/**
 * Escreve o AGENTS.md em pt-BR preservando o bloco de terceiro, de forma
 * idempotente e SEM NUNCA destruir texto que não seja o boilerplate do shadcn.
 *
 * Os quatro estados, e nenhum deles é silencioso:
 *
 *   'já estava'    o arquivo já tem o nosso marcador — segunda passagem do
 *                  gerador, ou o preset escreveu antes. No-op declarado, que é
 *                  a regra deste arquivo inteiro.
 *   'reescrito'    o arquivo era SÓ o bloco do shadcn (e espaço em branco). É o
 *                  caso que a decisão (a) existe para tratar.
 *   'sem bloco'    o arquivo não existia, ou não tinha o bloco. Sai o molde
 *                  pt-BR sozinho.
 *   'não mexi'     havia texto fora do bloco que não é nosso. Alguém escreveu
 *                  ali, ou uma versão futura do shadcn passou a escrever mais.
 *                  Vira AVISO e o arquivo fica como está: sobrescrever prosa de
 *                  outro é exatamente o defeito que o `force: true` de gerador
 *                  em camadas comete.
 */
function garantirAgents(destino, nome, avisos) {
  const rel = 'AGENTS.md'
  const atual = lerSe(destino, rel)

  if (atual !== null && atual.includes(MARCADOR_AGENTES)) return 'já estava'

  const casou = atual === null ? null : atual.match(RE_BLOCO_SHADCN)
  const bloco = casou ? casou[0].replace(/\r\n/g, '\n') : ''

  if (atual !== null) {
    const resto = atual.replace(RE_BLOCO_SHADCN, '').trim()
    if (resto) {
      avisos.push(
        'AGENTS.md tem texto fora do bloco `nextjs-agent-rules` que não é do portão — ' +
          'não sobrescrevi. Confira à mão se as regras do projeto estão lá, em pt-BR',
      )
      return 'não mexi'
    }
  }

  escrever(destino, rel, moldeAgents(nome, bloco))
  return atual === null ? 'sem bloco' : bloco ? 'reescrito' : 'sem bloco'
}

// ─────────────────────────────────────────────────────────────── as etapas

/**
 * O `output: "export"` do Next, de forma idempotente.
 *
 * Sem ele o `next build` gera um servidor e o GitHub Pages publica uma pasta
 * vazia — falha que NÃO aparece no build, só no deploy. O `images.unoptimized`
 * vem junto porque o otimizador de imagem do Next exige servidor em execução, e
 * sem ele o mesmo build passa e as imagens somem em produção.
 *
 * Idempotente porque o preset `site` tem o mesmo direito de escrever aqui. Se já
 * houver `output:`, esta função não encosta. Se o arquivo não tiver a forma que
 * ela sabe editar, ela AVISA em vez de fingir que editou — patch silencioso que
 * não pegou é como o defeito chega em produção.
 */
function garantirExportEstatico(destino, avisos) {
  const rel = 'next.config.ts'
  const atual = lerSe(destino, rel)
  if (atual === null) {
    avisos.push('next.config.ts não existe — o output: "export" não foi aplicado')
    return 'ausente'
  }
  if (/output\s*:\s*['"]export['"]/.test(atual)) return 'já estava'

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
      'next.config.ts já foi editado por outra camada e não tem a forma esperada — ' +
        'confira à mão se output: "export" está lá',
    )
    return 'não reconheci'
  }
  escrever(destino, rel, atual.replace(vazio, `$1${corpo}`))
  return 'aplicado'
}

/**
 * O `.mcp.json` e o lançador têm de apontar um para o outro.
 *
 * Isto é o portão de frescor do §7.2 no tamanho que este projeto pede. O de lá
 * regenera o artefato e compara com o disco; aqui não há artefato para
 * regenerar — de propósito, porque este projeto não guarda cópia de regra
 * nenhuma. O que SOBRA para divergir é o caminho escrito duas vezes: uma em
 * `MCP_LANCADOR`, outra dentro do JSON, que não tem como importar constante.
 *
 * Renomear a pasta num lugar e esquecer o outro produz um `.mcp.json` que
 * aponta para o nada — e cliente de MCP com servidor que não sobe aparece como
 * uma linha cinza que ninguém lê. É a mesma classe do defeito que o portão
 * inteiro persegue: a decisão está no arquivo e nenhuma máquina a executa.
 *
 * Aqui a conferência é na hora da geração; o `testes/portao.test.mjs` repete a
 * mesma pergunta dentro do projeto, no `npm run verificar` e no CI, para o dia
 * em que alguém mexer no `.mcp.json` sem passar pelo gerador.
 */
function conferirPonteiroMcp(destino, avisos) {
  const bruto = lerSe(destino, '.mcp.json')
  if (bruto === null) {
    avisos.push('.mcp.json não foi escrito — a IA que abrir este projeto não acha o rebar por MCP')
    return 'ausente'
  }
  let alvo
  try {
    alvo = JSON.parse(bruto)?.mcpServers?.rebar?.args?.find((a) => a.endsWith('.mjs'))
  } catch (erro) {
    avisos.push(`.mcp.json não é JSON válido (${erro.message}) — nenhum cliente vai lê-lo`)
    return 'ilegível'
  }
  if (alvo !== MCP_LANCADOR) {
    avisos.push(
      `.mcp.json aponta para ${JSON.stringify(alvo)} e o portão escreveu ${MCP_LANCADOR} — ` +
        'o ponteiro caiu no vazio. Acerte o molde `mcp.json` em novo/portao/arquivos/',
    )
    return 'divergiu'
  }
  if (!existsSync(join(destino, ...MCP_LANCADOR.split('/')))) {
    avisos.push(`.mcp.json aponta para ${MCP_LANCADOR}, que não está no disco`)
    return 'sem lançador'
  }
  return 'confere'
}

/**
 * Os scripts que o portão exige do package.json.
 *
 * `verificar` é UM comando, e o CI chama só ele. O motivo é a regra `ci-gateia`
 * do rebar: ela cobra que o CI ALCANCE o lint, o typecheck e o teste que o
 * repositório tem, e ela expande `npm run verificar` lendo o corpo do script.
 * Com os passos escritos no YAML, renomear um script desliga o passo e o YAML
 * continua verde; com um comando só, o desvio aparece na hora.
 *
 * Só encadeia o que EXISTE. Chamar `npm run lint` num projeto sem `lint` é um
 * CI que quebra por causa do gerador, não por causa do código.
 */
function garantirScripts(destino, avisos) {
  const bruto = lerSe(destino, 'package.json')
  if (bruto === null) {
    avisos.push('package.json não existe — nenhum script foi ajustado')
    return null
  }
  const pkg = JSON.parse(bruto)
  pkg.scripts = pkg.scripts || {}

  // O padrão GLOB, e não `node --test testes/`. Medido no Node 24.13 em
  // Windows: com a pasta como argumento posicional, o runner tenta CARREGAR
  // `testes` como módulo e morre com MODULE_NOT_FOUND — "✖ test at testes:1:1",
  // uma falha que não parece uma falha de caminho. O glob é expandido pelo
  // próprio Node desde a v22, então não depende de shell e vale nos dois
  // sistemas.
  //
  // Apontado para a pasta e não solto: `node --test` sozinho varreria o
  // repositório inteiro e tentaria interpretar `.tsx` do app como teste.
  // Built-in do Node, zero dependência nova.
  if (!pkg.scripts.test) pkg.scripts.test = 'node --test "testes/**/*.test.mjs"'

  const elos = ['lint', 'typecheck', 'test', 'build'].filter((n) => pkg.scripts[n])
  // `npm test` e não `npm run test`: é o nome canônico, e a regra `ci-gateia`
  // procura a palavra `test`, que está nos dois.
  pkg.scripts.verificar = elos.map((n) => (n === 'test' ? 'npm test' : `npm run ${n}`)).join(' && ')

  escrever(destino, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  return elos
}

/**
 * O bit de execução, que é a armadilha que o rebar já pagou uma vez.
 *
 * No Windows o `core.filemode` é false: um `chmodSync(0o755)` no disco NÃO vira
 * modo 100755 no índice do git. O hook é commitado como 100644, e em Linux o
 * git simplesmente NÃO O EXECUTA — sem erro, sem aviso, sem nada. O portão
 * parece instalado e verifica zero.
 *
 * `git update-index --chmod=+x` escreve o modo no índice diretamente, e é a
 * única forma que funciona igual nos dois sistemas. O chmod no disco vai junto
 * porque quem acabou de gerar o projeto vai rodar o hook antes de qualquer
 * clone, e em Linux ele precisa do bit no disco também.
 *
 * Roda DEPOIS do `git add`: `--chmod` mexe no índice, e o que não está no índice
 * não tem modo para mexer.
 */
function marcarExecutaveis(destino, avisos) {
  for (const rel of EXECUTAVEIS) {
    try {
      chmodSync(join(destino, ...rel.split('/')), 0o755)
    } catch (erro) {
      avisos.push(`não consegui dar chmod em ${rel}: ${erro.message}`)
    }
  }
  try {
    execFileSync('git', ['update-index', '--add', '--chmod=+x', ...EXECUTAVEIS], {
      cwd: destino,
      encoding: 'utf8',
    })
  } catch (erro) {
    avisos.push(`git update-index --chmod=+x falhou: ${erro.message}`)
    return null
  }
  // Conferir, e não confiar. O modo é o ponto inteiro desta função.
  const saida = execFileSync('git', ['ls-files', '-s', ...EXECUTAVEIS], {
    cwd: destino,
    encoding: 'utf8',
  })
  const linhas = saida.split('\n').filter(Boolean)
  const errados = linhas.filter((l) => !l.startsWith('100755'))
  if (errados.length) {
    avisos.push(`hook sem modo 100755 no índice: ${errados.join(' | ')}`)
    return null
  }
  return linhas
}

// ──────────────────────────────────────────────────────────────── a aplicação

/**
 * Aplica o portão sobre um projeto já existente.
 *
 * @param {object} opcoes
 * @param {string} opcoes.destino    raiz do projeto gerado
 * @param {string} opcoes.nome       nome do projeto, já validado pelo chamador
 * @param {string} opcoes.raizRebar  raiz do checkout do rebar, de onde se copia
 * @param {string} opcoes.dono       nome do dono, para NOTICE e allowlist
 * @param {string} opcoes.email      e-mail do dono, para a allowlist
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
      // Alto e claro. Sem LICENSE, as regras `licenca` e `notice` reprovam; sem
      // o varredor, o pre-commit morre no primeiro commit. Nenhuma das duas
      // pode virar um aviso que se lê depois.
      avisos.push(`NÃO ACHEI no rebar: ${origem} — o projeto sai incompleto`)
      continue
    }
    const para = join(destino, ...rel.split('/'))
    mkdirSync(dirname(para), { recursive: true })
    copyFileSync(de, para)
    escritos.push(rel)
  }

  const ano = new Date().getFullYear()
  escrever(destino, 'NOTICE', moldeNotice(nome, dono, ano))
  escrever(destino, '.rebar-coautores', moldeCoautores(dono, email))
  // O README do create-next-app é boilerplate de framework, e README é a
  // primeira coisa que se vê num repositório público. Este é o único arquivo do
  // scaffold que o portão sobrescreve sem pedir licença.
  escrever(destino, 'README.md', moldeReadme(nome, dono, ano))
  escritos.push('NOTICE', '.rebar-coautores', 'README.md')

  // O AGENTS.md do scaffold é o segundo — e último — arquivo do scaffold que o
  // portão sobrescreve. Ver o cabeçalho de `garantirAgents` para a decisão.
  const agents = garantirAgents(destino, nome, avisos)
  if (agents !== 'não mexi') escritos.push(`AGENTS.md (${agents})`)

  // O .prettierignore do shadcn não conhece prosa nem licença. Acrescentar, não
  // substituir: o que ele já lista (.next/, coverage/) continua valendo.
  const ignore = lerSe(destino, '.prettierignore')
  if (ignore !== null && !ignore.includes('LICENSE')) {
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

  // Depois dos ESTATICOS, porque é justamente os dois arquivos que eles
  // acabaram de escrever que esta função confronta um com o outro.
  const mcp = conferirPonteiroMcp(destino, avisos)

  // POR ÚLTIMO, e por dois motivos. Primeiro: só faz sentido perguntar "sobrou
  // arquivo sem decisão?" depois de todas as decisões terem sido executadas.
  // Segundo: o oráculo é o índice do git, e o índice tem de continuar sendo o
  // que o `shadcn create` deixou — o `git add -A` do gerador vem depois desta
  // função, e depois dele `git ls-files` passaria a listar o nosso também.
  const scaffold = conferirScaffold(destino, avisos)

  return { escritos, avisos, elos, exportEstatico, agents, scaffold, mcp }
}

export {
  marcarExecutaveis,
  PASTA_HOOKS,
  EXECUTAVEIS,
  DESTINO_DO_SCAFFOLD,
  MARCADOR_AGENTES,
  MCP_LANCADOR,
}
