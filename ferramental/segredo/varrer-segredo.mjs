#!/usr/bin/env node
// Varredura de segredo. Existe porque "nunca commitar credencial" é regra de
// documento e precisa virar porta: o rebar-check é retroativo e mede o que já
// está lá, mas segredo não se conserta medindo depois — se entrou no histórico,
// exige ROTAÇÃO. Esta é a única ferramenta do ferramental que precisa barrar
// ANTES, e por isso é ela que mora no hook.
//
// Zero dependência. Varre o que o Git rastreia, não o disco: arquivo ignorado
// não é risco, e node_modules não é nosso.
//
// Uso:
//   node varrer-segredo.mjs              tudo que o Git rastreia
//   node varrer-segredo.mjs --staged     só o que está em stage (hook)
//   node varrer-segredo.mjs --json
//
// Escape hatch, na linha do achado:  // rebar-segredo-ok: <motivo>
// Sem motivo escrito, não vale — supressão sem justificativa é exatamente a
// gambiarra que esta ferramenta existe para impedir.

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const args = process.argv.slice(2)
const soStaged = args.includes('--staged')
const comoJson = args.includes('--json')

const TAMANHO_MAXIMO = 512 * 1024
const MARCA_LIBERACAO = /rebar-segredo-ok:\s*\S+/

// Caminhos que não valem a varredura: lockfile é ruído puro, e binário nunca
// tem segredo em texto que este varredor consiga ler de forma confiável.
const IGNORAR_CAMINHO =
  /(^|\/)(node_modules|dist|build|\.next|coverage|vendor)\/|(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$|\.(png|jpe?g|gif|webp|avif|ico|svg|pdf|zip|gz|tgz|mp4|mov|woff2?|ttf|otf|eot|wasm|node|dll|exe|bin)$/i

/**
 * Placeholders são a principal fonte de falso positivo. Regra automática com
 * falso positivo ensina a desligar verificação — e verificação desligada
 * verifica zero.
 *
 * ATENÇÃO ao mexer aqui: cada termo desta lista é uma CHAVE DE DESLIGAR a
 * LINHA INTEIRA, para todas as regras de uma vez. Termo mal formado não
 * afrouxa um pouco — apaga a regra.
 *
 * As três últimas alternativas nasceram no rebar, que é projeto Postgres e por
 * isso carrega credencial de desenvolvimento no código de teste. Medido: o
 * varredor do alicerce, rodado contra o rebar, deu 2 achados —
 * dominios/privilegio-de-banco/privilegio.test.mjs:19 e :196,
 * `password: 'app_dev_only'` num pool apontando para 127.0.0.1. Zero
 * verdadeiros positivos em 2.
 *
 * Cada termo novo está preso à POSIÇÃO DE VALOR em vez de solto na linha, e o
 * motivo é concreto:
 *   · `senha` solto desligaria a regra `credencial-atribuida`, que procura
 *     exatamente a palavra `senha` — `senha: 'DcT9x…'` suprimiria a si mesma e
 *     a metade em português da regra deixaria de existir.
 *   · `postgres` solto desligaria a regra `string-de-conexao`, cujo padrão
 *     começa em `postgres://` — toda URL de banco de produção passaria batido.
 * Na posição de valor (`password: 'postgres'`) nenhum dos dois casa com a
 * chave nem com o esquema da URL, e as duas regras continuam inteiras.
 */
const PLACEHOLDER = new RegExp(
  [
    // ── herdado do alicerce, sem alteração ──
    /process\.env|import\.meta\.env|\$\{|\$\(|<[^>]*>|\bxxx+\b|\bchange[_-]?me\b/,
    /\bexample\b|\bexemplo\b|\bplaceholder\b|\bseu[_-]|\bdummy\b|\bfake\b/,
    /\btest(e)?[_-]?(key|token|secret)\b|\*{4,}|\.{4,}|\bnull\b|\bundefined\b/,

    // ── acrescentado no rebar ──
    // 1. Credencial canônica de desenvolvimento Postgres/Docker, e só na
    //    POSIÇÃO DE VALOR. Três travas, cada uma paga por um furo que a versão
    //    frouxa desta linha deixou passar quando medida:
    //      · à esquerda exige abertura de valor (aspas, `=`, `:`, `(`, `,`) —
    //        espaço simples não serve, senão a palavra `docker` num comentário
    //        de fim de linha desligava a linha inteira;
    //      · `(?![A-Za-z0-9_-])` impede casar o prefixo de uma chave, e é o que
    //        mantém `POSTGRES_PASSWORD: 'S3cr3tDeVerdade'` sendo achado;   // rebar-segredo-ok: exemplo dentro do comentario que documenta o proprio padrao
    //      · `(?!\s*[:=])` impede casar a palavra QUANDO ELA É A CHAVE, e é o
    //        que mantém `senha: 'Tr0v0…'` e `postgres://u:p@prod/db` sendo   // rebar-segredo-ok: exemplo dentro do comentario que documenta o proprio padrao
    //        achados — nos dois o que vem depois é `:`.
    /(?:^\s*|[=:(,[{]\s*|['"`])(?:senha|postgres(?:ql)?|docker|local(?:host)?)(?![A-Za-z0-9_-])(?!\s*[:=])/,

    // 2. Valor que se declara de desenvolvimento. É esta alternativa que limpa
    //    o rebar: `app_dev_only` não contém nenhum dos quatro termos acima.
    //    Exige marcador + separador + substantivo, para que `device`,
    //    `developer` e `devops` não virem chave de desligar.
    /(?<![a-z0-9])(?:dev|desenvolvimento|homolog|sandbox)[_-](?:only|local|senha|password|pass|pwd|key|token|secret|teste?)(?![a-z0-9])/,

    // 3. Credencial cujo HOST é a própria máquina. String de conexão para
    //    127.0.0.1 não é segredo de ninguém: quem tem a senha já tem a máquina.
    //    Presa ao `@` do userinfo — exime o host, nunca a linha.
    /@(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(?![\w.-])/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
)

const REGRAS = [
  {
    nome: 'chave-privada',
    padrao: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    aceitaPlaceholder: false,
  },
  { nome: 'aws-access-key', padrao: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: 'github-token', padrao: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { nome: 'slack-token', padrao: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { nome: 'google-api-key', padrao: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nome: 'chave-de-api', padrao: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/ },
  {
    nome: 'jwt',
    padrao: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    nome: 'string-de-conexao',
    padrao:
      /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/i,
  },
  {
    nome: 'senha-em-conexao',
    padrao: /\b(?:password|pwd)\s*=\s*[^;\s"'<${]{6,}/i,
  },
  {
    nome: 'credencial-atribuida',
    // Fronteira própria em vez de \b: em UPPER_SNAKE_CASE o vizinho da palavra é
    // "_", que é caractere de palavra, então \b não casa e AWS_SECRET_ACCESS_KEY,
    // DB_PASSWORD e STRIPE_SECRET_KEY passavam batido — que é justamente como
    // credencial aparece em código de verdade.
    padrao:
      /(?<![A-Za-z0-9])(?:senha|password|secret[_-]?key|client[_-]?secret|access[_-]?key|api[_-]?key|apikey|auth[_-]?token|secret|token)(?![A-Za-z0-9])\s*[:=]\s*["'][^"']{8,}["']/i,
  },
]

function arquivosParaVarrer() {
  const comando = soStaged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files']
  try {
    return execFileSync('git', comando, { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((c) => !IGNORAR_CAMINHO.test(c))
  } catch {
    console.error('[segredo] não é um repositório Git, ou o git não está disponível.')
    process.exit(2)
  }
}

const achados = []

for (const caminho of arquivosParaVarrer()) {
  // Arquivo de ambiente rastreado é achado por si só, independente do conteúdo.
  if (/(^|\/)\.env(\.|$)/.test(caminho) && !/\.example$|\.exemplo$/.test(caminho)) {
    achados.push({ caminho, linha: 0, regra: 'env-versionado', trecho: caminho })
    continue
  }

  let conteudo
  try {
    if (statSync(caminho).size > TAMANHO_MAXIMO) continue
    conteudo = readFileSync(caminho, 'utf8')
  } catch {
    continue
  }
  // binário que escapou do filtro de extensão: NUL é o sinal confiável
  if (conteudo.indexOf(String.fromCharCode(0)) !== -1) continue

  const linhas = conteudo.split('\n')
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (linha.length > 2000) continue
    if (MARCA_LIBERACAO.test(linha)) continue

    for (const regra of REGRAS) {
      if (!regra.padrao.test(linha)) continue
      if (regra.aceitaPlaceholder !== false && PLACEHOLDER.test(linha)) continue

      // Mostra o suficiente para achar, nunca o segredo inteiro: a saída desta
      // ferramenta vai para log de CI, que é outro lugar onde segredo não entra.
      const bruto = linha.trim()
      const trecho = bruto.length > 60 ? `${bruto.slice(0, 40)}…[${bruto.length} car.]` : bruto
      achados.push({ caminho, linha: i + 1, regra: regra.nome, trecho })
      break
    }
  }
}

if (comoJson) {
  console.log(JSON.stringify({ total: achados.length, achados }, null, 2))
} else if (achados.length === 0) {
  console.log(`[segredo] nenhum achado em ${soStaged ? 'stage' : 'arquivos rastreados'}.`)
} else {
  console.error(`\n[segredo] ${achados.length} achado(s):\n`)
  for (const a of achados) {
    console.error(`  error  ${a.caminho}:${a.linha}  ${a.regra}`)
    console.error(`         ${a.trecho}`)
  }
  console.error(
    '\n  Segredo que já entrou no histórico não se remove com commit novo:\n' +
      '  precisa ser ROTACIONADO. Reescrever histórico vem depois, não no lugar.\n' +
      '  Falso positivo: adicione na linha  // rebar-segredo-ok: <motivo>\n',
  )
}

process.exit(achados.length === 0 ? 0 : 1)
