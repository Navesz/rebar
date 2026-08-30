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
// ─────────────────────────────────────────────────────────────────────────────
// REESCRITA APÓS AUDITORIA ADVERSARIAL. A versão anterior deixou passar um
// token `ghp_` real por OITO caminhos diferentes, sempre imprimindo "nenhum
// achado". Os números abaixo são os medidos pela auditoria, não estimativas.
// Cada decisão deste arquivo está presa a um deles:
//
//   1. ÍNDICE CONTRA DISCO. `--staged` pegava os NOMES do índice e lia o
//      CONTEÚDO do disco. Lia um arquivo e commitava outro. Não é só ataque:
//      acontece sozinho toda vez que alguém edita o arquivo depois do `git add`.
//      Agora, em `--staged`, o conteúdo vem do BLOB DO ÍNDICE. O disco só é
//      lido no modo normal, onde índice e disco não têm por que divergir.
//
//   2. PLACEHOLDER DESLIGAVA A LINHA INTEIRA. Medido: 8 de 9 credenciais REAIS
//      passaram. O caso pior era `{ host: "localhost", token: "ghp_…" }` —
//      linha que qualquer projeto escreve. Agora o placeholder é testado contra
//      o TRECHO CASADO, nunca contra a linha, e as regras de fornecedor
//      (prefixo fixo + comprimento) só aceitam desligador que esteja DENTRO do
//      próprio token: um `ghp_` de 40 caracteres não é exemplo de nada.
//      Desligar a linha inteira só pelo escape hatch `rebar-segredo-ok:`.
//
//   3. SEIS SAÍDAS SILENCIOSAS. O mesmo `ghp_` entrou por vendor/, build/, .svg,
//      arquivo >512 KB, linha >2000 caracteres e arquivo com byte NUL — todos
//      pulados INTEIROS e sem imprimir nada. Agora não existe pulo por pasta
//      nem por extensão, linha longa é varrida em janelas e binário é varrido
//      pelas ilhas de texto. O que sobra de pulo (truncado, ilegível) é contado
//      e IMPRESSO. Silêncio aqui é pior que falso positivo: falso positivo o
//      humano vê.
//
//   4. CEGUEIRA A camelCase. O lookbehind `(?<![A-Za-z0-9])` na palavra-chave
//      fazia `githubToken` e `googleApiKey` não casarem — 6 de 7 credenciais
//      realistas passaram por isso. A chave agora é casada como IDENTIFICADOR
//      inteiro e quebrada em palavras no JavaScript, o que resolve camelCase,
//      snake_case, UPPER_SNAKE, kebab e pontilhado de uma vez só.
//
//   5. SÓ 6 FORNECEDORES. Faltavam github_pat_, Stripe (usa `_`, a regra exigia
//      hífen), SendGrid, npm, GitLab, HuggingFace e a secret key da AWS.
//
//   6. DEPENDIA DO DIRETÓRIO. O git rodava sem `cwd`: o MESMO segredo em stage
//      dava exit 1 da raiz e exit 0 de dentro de ferramental/, e o ENOENT era
//      engolido por um catch mudo. Agora todo git roda com `cwd` na raiz
//      descoberta, e falha de git é mensagem, não silêncio.
//
//   7. NOME DE ARQUIVO ACENTUADO. `core.quotePath` é true por padrão em todo SO
//      e este repositório é escrito em português: `configuração.mjs` saía
//      C-quoted, o readFileSync falhava e a falha era engolida. Todo listamento
//      de caminho agora usa `-z` (NUL), que não passa por quoting.
// ─────────────────────────────────────────────────────────────────────────────
//
// Uso:
//   node varrer-segredo.mjs              tudo que o Git rastreia
//   node varrer-segredo.mjs --staged     só o que está em stage (hook)
//   node varrer-segredo.mjs --json
//
// Escape hatch, na linha do achado:  // rebar-segredo-ok: <motivo>
// Sem motivo escrito, não vale — supressão sem justificativa é exatamente a
// gambiarra que esta ferramenta existe para impedir.

import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const soStaged = args.includes('--staged')
const comoJson = args.includes('--json')

// 8 MiB, e o número saiu de medição, não de chute. O teto antigo era 512 KB e
// era um dos seis caminhos de saída: um arquivo de 600 KB com o `ghp_` dentro
// era pulado inteiro e em silêncio. Medido nesta máquina, varrendo bundle
// minificado: 1 MiB → 489 ms, 2 MiB → 510 ms de processo inteiro contra 279 ms
// de partida do Node sozinho, ou seja ~230 ms por 2 MiB varridos. A 8 MiB isso
// dá ~1 s, que cabe no orçamento de 5 s do hook.
//
// O teto continua existindo porque um blob de 500 MB trava o hook, mas ele não
// DESCARTA mais nada: acima do teto o arquivo é varrido até o teto e a
// truncagem é impressa. Nenhum arquivo sai da varredura sem deixar linha.
const LIMITE_BYTES = 8 * 1024 * 1024

// Linha longa também era saída silenciosa (`if (linha.length > 2000) continue`).
// O teto existia por medo de backtracking; a resposta certa é fatiar, não
// descartar. A sobreposição de 200 caracteres garante que nenhum token caia
// exatamente na emenda entre duas janelas — o maior token que reconhecemos
// (github_pat_, ~82 caracteres) cabe folgado nela.
const JANELA = 2000
const SOBREPOSICAO = 200

// Teto de memória por lote de `git cat-file --batch`. Blobs maiores que
// LIMITE_BYTES nem entram no lote, então o lote só cresce por quantidade.
const LOTE_BYTES = 32 * 1024 * 1024

const MARCA_LIBERACAO = /rebar-segredo-ok:\s*\S+/

/**
 * Placeholders são a principal fonte de falso positivo, e regra com falso
 * positivo ensina a desligar verificação — verificação desligada verifica zero.
 *
 * MUDANÇA DE ESCOPO, e é a correção do FURO 2: esta expressão agora é testada
 * contra o TRECHO CASADO, nunca contra a linha. Antes, um único termo desta
 * lista em qualquer coluna da linha apagava todas as regras daquela linha ao
 * mesmo tempo — foi assim que `{ host: "localhost", token: "ghp_…" }` passou.
 * Testada contra o trecho, a palavra `localhost` continua eximindo
 * `password: 'localhost'` e não chega perto do `ghp_` ao lado.
 *
 * Regras marcadas `alta` (prefixo de fornecedor + comprimento) NÃO consultam
 * esta lista: não existe placeholder de 40 caracteres começando em `ghp_`.
 * Elas consultam só o PLACEHOLDER_FORTE logo abaixo.
 */
const PLACEHOLDER = new RegExp(
  [
    // ── herdado do alicerce ──
    /process\.env|import\.meta\.env|\$\{|\$\(|<[^>]*>|\bxxx+\b|\bchange[_-]?me\b/,
    /\bexample\b|\bexemplo\b|\bplaceholder\b|\bseu[_-]|\bdummy\b|\bfake\b/,
    /\btest(e)?[_-]?(key|token|secret)\b|\*{4,}|\.{4,}|\bnull\b|\bundefined\b/,

    // 1. Credencial canônica de desenvolvimento Postgres/Docker, e só na
    //    POSIÇÃO DE VALOR. As três travas continuam valendo mesmo com o escopo
    //    reduzido ao trecho, porque o trecho de `credencial-atribuida` inclui a
    //    chave: sem elas, `postgres` como CHAVE eximiria a si mesmo.
    //      · à esquerda exige abertura de valor (aspas, `=`, `:`, `(`, `,`);
    //      · `(?![A-Za-z0-9_-])` impede casar o prefixo de uma chave, e é o que
    //        mantém `POSTGRES_PASSWORD: 'S3cr3tDeVerdade'` sendo achado;   // rebar-segredo-ok: exemplo dentro do comentario que documenta o proprio padrao
    //      · `(?!\s*[:=])` impede casar a palavra QUANDO ELA É A CHAVE, e é o
    //        que mantém `senha: 'Tr0v0…'` e `postgres://u:p@prod/db` sendo   // rebar-segredo-ok: exemplo dentro do comentario que documenta o proprio padrao
    //        achados — nos dois o que vem depois é `:`.
    /(?:^\s*|[=:(,[{]\s*|['"`])(?:senha|postgres(?:ql)?|docker|local(?:host)?)(?![A-Za-z0-9_-])(?!\s*[:=])/,

    // 2. Valor que se declara de desenvolvimento. É esta alternativa que limpa
    //    o rebar: medido, o varredor do alicerce dava 2 achados neste
    //    repositório — privilegio.test.mjs:19 e :196, `password: 'app_dev_only'`
    //    num pool apontando para 127.0.0.1, zero verdadeiros positivos em 2.
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

/**
 * O único desligador que uma regra de fornecedor aceita, e só DENTRO do trecho
 * casado. Medido na suíte de ataque: a linha de documentação
 * `sk-ant-api03-EXEMPLO-nao-e-chave-de-verdade` era o único falso positivo em
 * 44 casos — texto que projeto nenhum consegue evitar escrever.
 *
 * Por que isto não reabre o FURO 2: o teste é contra o TRECHO, isto é, contra o
 * miolo do próprio token. Para se esconder aqui, a credencial teria de conter
 * `example`/`exemplo`/`xxx` entre fronteiras de palavra — e token que carrega
 * isso dentro não é mais o token. Num `ghp_` de 40 caracteres, que é alfanumérico
 * puro depois do prefixo, `\bexample\b` não tem como casar: os dois vizinhos são
 * alfanuméricos e não há fronteira. Só ficam expostos os formatos com hífen ou
 * sublinhado no meio (sk-, glpat-, github_pat_), e para esses o escape hatch
 * explícito continua sendo o caminho certo.
 */
const PLACEHOLDER_FORTE =
  /\bexample\b|\bexemplo\b|\bplaceholder\b|\bdummy\b|\bfake\b|\bchange[_-]?me\b|\bxxx+\b|\bseu[_-]|\bsua[_-]|\byour[_-]|\.{4,}|\*{4,}/i

// ── Palavras que fazem de um identificador uma chave de credencial ───────────
// Correção do FURO 4. A versão antiga tentava resolver camelCase com
// lookbehind e não dá: `(?<![A-Za-z0-9])token` nunca casa em `githubToken`,
// porque a letra antes de `Token` é alfanumérica. Casar o identificador INTEIRO
// e quebrá-lo em palavras aqui no JavaScript resolve camelCase, snake_case,
// UPPER_SNAKE, kebab e pontilhado com uma implementação só.
const FORTES = new Set([
  'senha',
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'secret',
  'token',
  'apikey',
  'apitoken',
  'credential',
  'credentials',
  'credencial',
  'credenciais',
])

// `key` e `auth` sozinhos são ruído: `sortKey`, `cacheKey`, `authUrl`. Só valem
// acompanhados de um qualificador que os torne credencial.
const FRACAS = new Set(['key', 'keys', 'chave', 'auth', 'cred', 'creds', 'signature'])
const QUALIFICADORES = new Set([
  'api',
  'secret',
  'access',
  'private',
  'privada',
  'auth',
  'client',
  'signing',
  'encryption',
  'refresh',
  'session',
  'bearer',
  'master',
  'admin',
  'service',
])

function palavrasDoIdentificador(identificador) {
  return identificador
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // githubToken → github Token
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // AWSSecret   → AWS Secret
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase())
}

// Subconjunto de FORTES cujo valor é uma SENHA digitada por gente, e não um
// token gerado por máquina. A distinção existe porque as duas classes têm forma
// diferente e sofrem falsos positivos diferentes — ver `valorDeCredencial`.
const SENHAS = new Set(['senha', 'password', 'passwd', 'passphrase', 'pwd'])

function classeDoIdentificador(identificador) {
  const palavras = palavrasDoIdentificador(identificador)
  if (palavras.some((p) => SENHAS.has(p))) return 'senha'
  if (palavras.some((p) => FORTES.has(p))) return 'token'
  if (palavras.some((p) => FRACAS.has(p)) && palavras.some((p) => QUALIFICADORES.has(p)))
    return 'token'
  return null
}

/**
 * Gate de FORMA DO VALOR, e ele foi pago por medição. Rodado contra 9,5 MiB de
 * código de terceiro real (o node_modules do próprio rebar, prettier incluído),
 * o varredor sem este gate deu 16 falsos positivos e nenhum verdadeiro. Doze
 * vinham daqui, e todos do mesmo lugar: `token`, `key` e `secret` são palavras
 * de compilador tanto quanto de credencial. Os casos reais eram
 *   `nextLastSignificantToken = "?NonExpressionParenEnd"`
 *   `UnexpectedTokenUnaryExponentiation: "Illegal expression. Wrap left…"`
 * — código de parser, não credencial.
 *
 * Duas travas, e cada uma corta um dos dois formatos observados:
 *   · valor com espaço em branco é PROSA. Mensagem de erro não é segredo. Custa
 *     a senha que contenha espaço, que existe mas é rara, e para essa continua
 *     havendo as regras de fornecedor e o escape hatch.
 *   · para a classe `token`, o valor tem de misturar letra e dígito. Token
 *     gerado por máquina praticamente sempre tem dígito; identificador
 *     PascalCase de compilador (`?NonExpressionParenEnd`) nunca tem. Esta trava
 *     NÃO vale para a classe `senha`, porque `password` não é palavra ambígua
 *     em código de parser e senha só de letras é comum.
 */
function valorDeCredencial(classe, valor) {
  if (/\s/.test(valor)) return false
  if (classe === 'senha') return true
  return /[0-9]/.test(valor) && /[A-Za-z]/.test(valor)
}

function temMisturaDeCaracteres(texto) {
  return /[a-z]/.test(texto) && /[A-Z]/.test(texto) && /[0-9]/.test(texto)
}

// Contexto PERTO do casamento, não na linha inteira. Num arquivo minificado o
// arquivo todo é UMA linha, então "a linha fala de credencial?" é sempre sim e
// o gate não gateia nada — foi assim que 4 dos 16 falsos positivos entraram.
function contextoFala(linha, inicio, fim, padrao) {
  return padrao.test(linha.slice(Math.max(0, inicio - 64), fim + 16))
}

/**
 * `alta: true` = prefixo de fornecedor com comprimento fixo. Duas consequências:
 * o placeholder não é consultado (FURO 2) e a regra também roda dentro de
 * arquivo binário (FURO 3), onde as heurísticas genéricas seriam ruído puro.
 *
 * `sensivel: false` = o trecho casado não é o segredo em si (o cabeçalho PEM é
 * público), então pode ser impresso inteiro no log.
 *
 * A ordem importa: quem casa primeiro fica com o intervalo, e um intervalo já
 * tomado não vira segundo achado. É o que faz `token: "ghp_…"` render UM
 * achado (github-token) em vez de dois.
 */
const REGRAS = [
  {
    nome: 'chave-privada',
    alta: true,
    sensivel: false,
    padrao: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    nome: 'aws-access-key-id',
    alta: true,
    padrao: /(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'github-token',
    alta: true,
    padrao: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}(?![A-Za-z0-9])/g,
  },
  {
    // FURO 5: o PAT novo do GitHub não começa em `ghp_`. Passou inteiro.
    nome: 'github-pat',
    alta: true,
    padrao: /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{50,}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'gitlab-token',
    alta: true,
    padrao:
      /(?<![A-Za-z0-9])(?:glpat|gldt|glrt|glcbt|glptt|glsoat)-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
  },
  {
    nome: 'slack-token',
    alta: true,
    padrao: /(?<![A-Za-z0-9])xox[baprse]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'google-api-key',
    alta: true,
    padrao: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g,
  },
  {
    nome: 'google-oauth-secret',
    alta: true,
    padrao: /(?<![A-Za-z0-9])GOCSPX-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
  },
  {
    // FURO 5: a Stripe separa com `_`, e a regra antiga (`sk-`) exigia hífen.
    // `pk_live_` fica de fora de propósito: chave publicável é pública.
    nome: 'stripe',
    alta: true,
    padrao: /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{16,}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'sendgrid',
    alta: true,
    padrao: /(?<![A-Za-z0-9])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
  },
  {
    nome: 'npm-token',
    alta: true,
    padrao: /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'huggingface-token',
    alta: true,
    padrao: /(?<![A-Za-z0-9])hf_[A-Za-z0-9]{30,}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'chave-de-api',
    alta: true,
    padrao: /(?<![A-Za-z0-9])sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
  },
  {
    nome: 'jwt',
    alta: true,
    padrao:
      /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g,
  },
  {
    // FURO 5: a secret key da AWS é 40 caracteres base64 e não tem prefixo —
    // é indistinguível de um hash. Por isso NÃO é `alta`: exige que a linha
    // fale de credencial e que o valor misture maiúscula, minúscula e dígito.
    // Sem esse par de travas a regra acusaria todo `integrity: "sha512-…"` de
    // lockfile, e regra que grita vira regra desligada.
    // Sem `=` na classe, e isso é conserto de falso positivo medido: com `=`
    // dentro, a regex atravessava o sinal de atribuição e colava identificador
    // com número. Em prettier/plugins/typescript.js o casamento de 40
    // caracteres era `MethodWithSuperPropertyAccessInAsync=128` — o `=128` era
    // quem fornecia o dígito exigido por temMisturaDeCaracteres. A secret key
    // da AWS são 30 bytes em base64, que dão 40 caracteres exatos e SEM
    // preenchimento, então `=` nunca aparece nela de verdade.
    nome: 'aws-secret-key',
    padrao: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g,
    filtrar: (casamento, linha, inicio, fim) =>
      contextoFala(
        linha,
        inicio,
        fim,
        /\b(?:aws|secret|credential|credencial|senha|password)\b/i,
      ) && temMisturaDeCaracteres(casamento[0]),
  },
  {
    // O trecho vai até o HOST de propósito: é o host que decide se a credencial
    // vale alguma coisa, e é ele que a alternativa 3 do PLACEHOLDER lê para
    // eximir `@localhost`. Terminando no `@`, como terminava antes, o
    // placeholder por trecho não teria o que ler.
    nome: 'string-de-conexao',
    padrao:
      /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|amqp|ftp|ssh):\/\/[^\s:@/]+:[^\s:@/]+@[^\s/'"`,)\]}]+/gi,
  },
  {
    nome: 'senha-em-conexao',
    padrao: /\b(?:password|pwd)\s*=\s*[^;\s"'<${]{6,}/gi,
  },
  {
    // Chave casada como identificador inteiro (FURO 4). O `filtrar` decide se
    // aquele identificador é de credencial olhando as palavras que o compõem.
    nome: 'credencial-atribuida',
    padrao: /([A-Za-z_$][A-Za-z0-9_$.-]{0,60})\s*[:=]\s*(["'`])([^"'`\r\n]{8,}?)\2/g,
    filtrar: (casamento) => {
      const classe = classeDoIdentificador(casamento[1])
      return classe !== null && valorDeCredencial(classe, casamento[3])
    },
  },
  {
    nome: 'cabecalho-autorizacao',
    padrao:
      /\b(?:Authorization|Proxy-Authorization)\s*[:=]\s*["'`]?\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9+/=_.-]{12,}/gi,
  },
]

// ── Git ──────────────────────────────────────────────────────────────────────
// FURO 6: sem `cwd`, o resultado dependia da pasta de onde o comando rodava, e
// o catch mudo transformava ENOENT em "nenhum achado". Tudo aqui roda com cwd
// na raiz e reclama alto quando o git falha.

function descobrirRaiz() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
  } catch (erro) {
    console.error(
      `[segredo] não é um repositório Git, ou o git não está disponível: ${erro.message}`,
    )
    process.exit(2)
  }
}

const RAIZ = descobrirRaiz()

function git(argumentos, opcoes = {}) {
  try {
    return execFileSync('git', argumentos, {
      cwd: RAIZ,
      encoding: opcoes.binario ? null : 'utf8',
      input: opcoes.entrada,
      maxBuffer: opcoes.maxBuffer ?? LOTE_BYTES + 8 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (erro) {
    console.error(`[segredo] falhou: git ${argumentos.join(' ')}\n         ${erro.message}`)
    process.exit(2)
  }
}

// FURO 7: `-z` devolve o caminho cru, separado por NUL. Sem ele o git aplica
// core.quotePath (true por padrão em todo SO) e "configuração.mjs" volta
// C-quoted — o readFileSync falhava e a falha era engolida, então um arquivo
// com nome acentuado passava VERDE com uma AWS key dentro.
function caminhosParaVarrer() {
  const bruto = soStaged
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    : git(['ls-files', '-z'])
  return bruto.split('\0').filter(Boolean)
}

// FURO 1: em `--staged` o conteúdo tem de vir do índice, não do disco. Um
// `git show :caminho` por arquivo custaria um processo por arquivo; `ls-files -s`
// dá o OID de cada entrada do índice numa chamada só, e o `cat-file --batch`
// entrega os blobs em outra. São 3 processos no total, independente de quantos
// arquivos o commit tenha. Medido: os 106 arquivos rastreados do rebar inteiro
// em stage, varridos pelo índice, levam 381–432 ms em três rodadas — o hook tem
// orçamento de 5 s.
function conteudosDoIndice(caminhos) {
  const desejados = new Set(caminhos)
  const oidPorCaminho = new Map()
  for (const registro of git(['ls-files', '-s', '-z']).split('\0')) {
    if (!registro) continue
    const tabulacao = registro.indexOf('\t')
    if (tabulacao === -1) continue
    const caminho = registro.slice(tabulacao + 1)
    if (!desejados.has(caminho)) continue
    // formato: "<modo> <oid> <estágio>\t<caminho>"
    oidPorCaminho.set(caminho, registro.slice(0, tabulacao).split(' ')[1])
  }

  const oids = [...new Set(oidPorCaminho.values())]
  const tamanhoPorOid = new Map()
  if (oids.length > 0) {
    const verificacao = git(['cat-file', '--batch-check'], { entrada: `${oids.join('\n')}\n` })
    for (const linha of verificacao.split('\n')) {
      const partes = linha.trim().split(' ')
      if (partes.length === 3 && partes[1] === 'blob')
        tamanhoPorOid.set(partes[0], Number(partes[2]))
    }
  }

  // Blob acima do teto sai do lote e é lido sozinho, TRUNCADO. `spawnSync` com
  // `maxBuffer` estourado devolve ENOBUFS mas entrega o parcial já lido em
  // `r.stdout` — medido: teto de 1 MiB contra blob de 5 MiB devolveu 1.114.112
  // bytes com o começo íntegro. É o que permite varrer os primeiros 8 MiB de um
  // arquivo enorme em vez de declará-lo não varrido, sem risco de estourar a
  // memória do processo.
  const truncadosPorOid = new Map()
  const lerTruncado = (oid) => {
    const r = spawnSync('git', ['cat-file', 'blob', oid], {
      cwd: RAIZ,
      maxBuffer: LIMITE_BYTES,
      windowsHide: true,
    })
    return Buffer.isBuffer(r.stdout) ? r.stdout.subarray(0, LIMITE_BYTES) : Buffer.alloc(0)
  }

  // Só busca em lote o conteúdo do que cabe no teto, para que um repositório
  // com blob gigante em stage não estoure a memória do processo.
  const conteudoPorOid = new Map()
  let lote = []
  let bytesDoLote = 0
  const despejar = () => {
    if (lote.length === 0) return
    const buffer = git(['cat-file', '--batch'], { entrada: `${lote.join('\n')}\n`, binario: true })
    let posicao = 0
    while (posicao < buffer.length) {
      const fimDoCabecalho = buffer.indexOf(0x0a, posicao)
      if (fimDoCabecalho === -1) break
      const cabecalho = buffer.toString('utf8', posicao, fimDoCabecalho).split(' ')
      posicao = fimDoCabecalho + 1
      if (cabecalho[1] !== 'blob') continue // "<oid> missing"
      const tamanho = Number(cabecalho[2])
      conteudoPorOid.set(cabecalho[0], buffer.subarray(posicao, posicao + tamanho))
      posicao += tamanho + 1 // o git fecha cada blob com um \n extra
    }
    lote = []
    bytesDoLote = 0
  }
  for (const [oid, tamanho] of tamanhoPorOid) {
    if (tamanho > LIMITE_BYTES) {
      truncadosPorOid.set(oid, lerTruncado(oid))
      continue
    }
    if (bytesDoLote + tamanho > LOTE_BYTES) despejar()
    lote.push(oid)
    bytesDoLote += tamanho
  }
  despejar()

  return { oidPorCaminho, tamanhoPorOid, conteudoPorOid, truncadosPorOid }
}

// ── Leitura do disco (modo normal) ───────────────────────────────────────────
// O git devolve caminho com barra normal; o disco no Windows não. Reconstituir
// com path.join a partir dos segmentos é o que faz os dois formatos baterem.
function lerDoDisco(caminho) {
  const absoluto = join(RAIZ, ...caminho.split('/'))
  const tamanho = statSync(absoluto).size
  if (tamanho <= LIMITE_BYTES) return { dados: readFileSync(absoluto), tamanho }

  const descritor = openSync(absoluto, 'r')
  try {
    const buffer = Buffer.allocUnsafe(LIMITE_BYTES)
    const lidos = readSync(descritor, buffer, 0, LIMITE_BYTES, 0)
    return { dados: buffer.subarray(0, lidos), tamanho }
  } finally {
    closeSync(descritor)
  }
}

// ── Varredura ────────────────────────────────────────────────────────────────

function ehPlaceholder(regra, linha, inicio, fim) {
  const trecho = linha.slice(inicio, fim)
  if (PLACEHOLDER_FORTE.test(trecho)) return true
  // Daqui para baixo é só para as heurísticas. Regra de fornecedor não se
  // desliga por `<…>` nem por `${…}` em volta: o desligador tem de estar dentro
  // do token, senão bastaria envolver a credencial em sinais para escondê-la.
  if (regra.alta) return false
  if (PLACEHOLDER.test(trecho)) return true
  const antes = linha.slice(0, inicio)
  const depois = linha.slice(fim)
  if (/<[^<>]*$/.test(antes) && /^[^<>]*>/.test(depois)) return true
  if (/\$\{[^{}]*$/.test(antes) && /^[^{}]*\}/.test(depois)) return true
  return false
}

function redigir(texto, sensivel) {
  if (!sensivel) return texto.length > 80 ? `${texto.slice(0, 80)}…` : texto
  // A saída desta ferramenta vai para log de CI, que é outro lugar onde segredo
  // não entra. Mostra o suficiente para localizar, nunca o suficiente para usar.
  if (texto.length <= 8) return `‹${texto.length} car.›`
  return `${texto.slice(0, 4)}…‹${texto.length} car.›`
}

function varrerLinha(caminho, numero, linha, apenasAlta, achados) {
  if (MARCA_LIBERACAO.test(linha)) return

  // Linha longa não é mais descartada (FURO 3): é fatiada em janelas com
  // sobreposição, porque nenhuma das regras precisa enxergar mais que isso.
  const pedacos = []
  if (linha.length <= JANELA) pedacos.push([0, linha])
  else
    for (let b = 0; b < linha.length; b += JANELA - SOBREPOSICAO)
      pedacos.push([b, linha.slice(b, b + JANELA)])

  const tomados = []
  for (const regra of REGRAS) {
    if (apenasAlta && !regra.alta) continue
    for (const [deslocamento, pedaco] of pedacos) {
      regra.padrao.lastIndex = 0
      let casamento
      while ((casamento = regra.padrao.exec(pedaco)) !== null) {
        if (casamento[0].length === 0) {
          regra.padrao.lastIndex += 1
          continue
        }
        const inicio = deslocamento + casamento.index
        const fim = inicio + casamento[0].length
        if (regra.filtrar && !regra.filtrar(casamento, linha, inicio, fim)) continue
        if (ehPlaceholder(regra, linha, inicio, fim)) continue
        // Intervalo já tomado por regra anterior (mais específica) não vira
        // segundo achado, e a sobreposição das janelas não vira achado dobrado.
        if (tomados.some(([i, f]) => inicio < f && i < fim)) continue
        tomados.push([inicio, fim])
        achados.push({
          caminho,
          linha: numero,
          coluna: inicio + 1,
          regra: regra.nome,
          trecho: redigir(casamento[0], regra.sensivel !== false),
        })
      }
    }
  }
}

function varrerConteudo(caminho, dados, relatorio) {
  let texto = dados.toString('utf8')
  let binario = false
  if (texto.indexOf('\u0000') !== -1) {
    // FURO 3: byte NUL fazia o arquivo inteiro ser pulado em silêncio. Segredo
    // dentro de binário vaza igual ao de dentro de .mjs. Trocando os controles
    // por quebra de linha, as ilhas de texto ASCII viram linhas varríveis; só
    // as regras `alta` rodam aqui, porque heurística sobre lixo binário é ruído.
    binario = true
    texto = texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '\n')
    relatorio.binarios.push(caminho)
  }

  const achados = []
  const linhas = texto.split(/\r?\n/)
  for (let i = 0; i < linhas.length; i++) varrerLinha(caminho, i + 1, linhas[i], binario, achados)
  return achados
}

// ── Execução ─────────────────────────────────────────────────────────────────
//
// Não existe mais IGNORAR_CAMINHO. A lista antiga pulava vendor/, build/, dist/,
// .next/, coverage/, lockfiles e .svg — e a auditoria fez o mesmo `ghp_` entrar
// por quatro deles. O argumento "é código de terceiro" vale para estilo e para
// dívida técnica; NÃO vale para segredo, porque credencial commitada em vendor/
// vaza exatamente igual à commitada em src/, e o clone de quem pegar o repo não
// distingue as duas. .svg é texto, não imagem binária, e cabe token dentro.
// O que sobrou de exclusão é só o que o próprio Git já exclui: arquivo
// ignorado não é rastreado, então node_modules não aparece aqui.

const caminhos = caminhosParaVarrer()
const relatorio = { truncados: [], ilegiveis: [], binarios: [], varridos: 0 }
const achados = []

const doIndice = soStaged ? conteudosDoIndice(caminhos) : null

for (const caminho of caminhos) {
  // Arquivo de ambiente rastreado é achado por si só, independente do conteúdo.
  if (/(^|\/)\.env(\.|$)/.test(caminho) && !/\.example$|\.exemplo$/.test(caminho)) {
    achados.push({ caminho, linha: 0, coluna: 0, regra: 'env-versionado', trecho: caminho })
    continue
  }

  let dados
  if (soStaged) {
    const oid = doIndice.oidPorCaminho.get(caminho)
    const tamanho = oid === undefined ? undefined : doIndice.tamanhoPorOid.get(oid)
    if (tamanho !== undefined && tamanho > LIMITE_BYTES) {
      dados = doIndice.truncadosPorOid.get(oid)
      relatorio.truncados.push(
        `${caminho} (${tamanho} bytes, varridos os primeiros ${LIMITE_BYTES})`,
      )
    } else {
      dados = oid === undefined ? undefined : doIndice.conteudoPorOid.get(oid)
    }
    if (dados === undefined) {
      relatorio.ilegiveis.push(`${caminho} — sem blob no índice`)
      continue
    }
  } else {
    try {
      const lido = lerDoDisco(caminho)
      dados = lido.dados
      if (lido.tamanho > LIMITE_BYTES) {
        relatorio.truncados.push(
          `${caminho} (${lido.tamanho} bytes, varridos os primeiros ${LIMITE_BYTES})`,
        )
      }
    } catch (erro) {
      // Antes era `catch { continue }`, e era por aí que o nome acentuado saía
      // limpo. Falha de leitura agora é linha impressa, não silêncio.
      relatorio.ilegiveis.push(`${caminho} — ${erro.code ?? erro.message}`)
      continue
    }
  }

  relatorio.varridos += 1
  achados.push(...varrerConteudo(caminho, dados, relatorio))
}

// Em `--staged`, arquivo que não pôde ser varrido é arquivo entrando no commit
// sem verificação — o hook não tem como aprovar o que não leu. No modo normal
// isso é rotina (arquivo rastreado apagado do disco), então só avisa.
const naoVerificados = soStaged ? relatorio.ilegiveis.length : 0

function imprimirLista(rotulo, itens) {
  if (itens.length === 0) return
  console.error(`\n  ${rotulo} (${itens.length}):`)
  for (const item of itens.slice(0, 20)) console.error(`    ${item}`)
  if (itens.length > 20) console.error(`    …e mais ${itens.length - 20}`)
}

if (comoJson) {
  console.log(
    JSON.stringify(
      {
        total: achados.length,
        modo: soStaged ? 'staged' : 'rastreados',
        varridos: relatorio.varridos,
        naoVerificados,
        achados,
        pulos: {
          truncados: relatorio.truncados,
          ilegiveis: relatorio.ilegiveis,
          binariosVarridos: relatorio.binarios,
        },
      },
      null,
      2,
    ),
  )
} else {
  // O resumo sai SEMPRE, inclusive no caminho feliz. A mentira mais cara da
  // versão anterior não foi um achado errado: foi "nenhum achado" impresso
  // depois de pular seis arquivos sem contar nenhum deles.
  const resumo =
    `[segredo] ${relatorio.varridos} arquivo(s) varrido(s) em ${soStaged ? 'stage' : 'arquivos rastreados'}` +
    ` · ${relatorio.binarios.length} binário(s) · ${relatorio.truncados.length} truncado(s)` +
    ` · ${relatorio.ilegiveis.length} não varrido(s)`

  if (achados.length === 0 && naoVerificados === 0) {
    console.log(`${resumo} · nenhum achado.`)
    if (relatorio.truncados.length > 0 || relatorio.ilegiveis.length > 0) {
      imprimirLista('truncados — varridos só em parte', relatorio.truncados)
      imprimirLista('não varridos', relatorio.ilegiveis)
    }
  } else {
    console.error(resumo)
    if (achados.length > 0) {
      console.error(`\n[segredo] ${achados.length} achado(s):\n`)
      for (const a of achados) {
        console.error(`  error  ${a.caminho}:${a.linha}:${a.coluna}  ${a.regra}`)
        console.error(`         ${a.trecho}`)
      }
    }
    imprimirLista('truncados — varridos só em parte', relatorio.truncados)
    imprimirLista('não varridos', relatorio.ilegiveis)
    console.error(
      '\n  Segredo que já entrou no histórico não se remove com commit novo:\n' +
        '  precisa ser ROTACIONADO. Reescrever histórico vem depois, não no lugar.\n' +
        '  Falso positivo: adicione na linha  // rebar-segredo-ok: <motivo>\n',
    )
  }
}

process.exit(achados.length === 0 && naoVerificados === 0 ? 0 : 1)
