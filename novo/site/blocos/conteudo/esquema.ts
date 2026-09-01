/**
 * O contrato de `conteudo/site.json`, escrito à mão em TypeScript puro.
 *
 * ZERO DEPENDÊNCIA — não é zod, e não é por gosto. A regra da casa vale para
 * tudo que o `npx` executa, e este arquivo executa dentro do `next build`.
 *
 * Ele é N2 e N0 ao mesmo tempo: a mesma declaração VALIDA em tempo de build
 * (lança e reprova o build se o JSON divergir) e PRODUZ o tipo — `Site` sai de
 * `typeof esquemaSite`, então não existe a segunda declaração que envelhece
 * separada do dado.
 *
 * O que o §12.3 do plano fechou e este arquivo é o dente: identidade do
 * negócio — telefone, endereço, nome — é CONTEÚDO VALIDADO, não variável de
 * ambiente. A prova está no PR `Navesz/Galegos#1`, que o dono estacionou de
 * propósito: mover o número para env var fazia o build passar, o deploy subir e
 * o `wa.me` nascer sem destinatário, com o cardápio parando de entregar pedido
 * EM SILÊNCIO. Aqui o campo faltando não é silêncio: é build vermelho.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE FOI CONSERTADO EM 31/08 (o mesmo desastre, outra mecânica).
 *
 * O gerador entregava `identidade.whatsapp.e164 = "5500000000000"`. O padrão
 * `/^[1-9]\d{9,14}$/` casa, o `next build` saía 0, e o HTML publicado carregava
 * `https://wa.me/5500000000000` em DUAS posições — botão e rodapé. Link que
 * sobe, parece certo e não entrega pedido nenhum: exatamente o `Galegos#1`,
 * cometido pelo próprio gerador. A causa não é regex frouxo; é o PLACEHOLDER
 * SER PLAUSÍVEL. Vazio, o esquema pegava. Plausível, ele aprovava.
 *
 * A DISCIPLINA, que vale para todo campo daqui em diante: placeholder é INERTE
 * E BARULHENTO, nunca plausível e silencioso.
 *   · INERTE     — impossível de confundir com valor real (`TROQUE-PELO-…`),
 *                  e impossível de virar link, e-mail ou endereço por acidente.
 *   · BARULHENTO — REPROVA o build até ser trocado, porque site com telefone
 *                  errado não deveria publicar. Um build vermelho custa cinco
 *                  minutos; um `wa.me` morto custa os pedidos de meses.
 *
 * Duas camadas, de propósito, e a segunda existe porque a primeira não pega
 * digitação à mão:
 *   1. `conferirSentinelas` varre o JSON INTEIRO ANTES da validação campo a
 *      campo e lança UMA mensagem com TODOS os placeholders restantes. Sem
 *      isso o dono conserta um campo, roda o build, descobre o próximo, e paga
 *      nove ciclos de build para preencher nove campos (medido: 9 campos ainda
 *      com sentinela no projeto recém-gerado).
 *   2. Os validadores recusam também o valor PLAUSÍVEL-PORÉM-MORTO que o dono
 *      pode digitar de volta: `5500000000000`, `(00) 00000-0000`,
 *      `contato@exemplo.com.br`, `https://exemplo.com.br`, CEP `00000-000`, UF
 *      que não existe. Mate a camada 1 e a 2 ainda reprova; mate a 2 e a 1
 *      ainda reprova o que sai do gerador.
 * ─────────────────────────────────────────────────────────────────────────
 */

export class ErroDeConteudo extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeConteudo'
  }
}

// ── sentinelas ────────────────────────────────────────────────────────────

/**
 * O que marca um campo como NÃO PREENCHIDO.
 *
 * `TROQUE-` em caixa alta, seguido de mais caixa alta e hífen. O hífen é o que
 * torna o token seguro: prosa brasileira de verdade escreve "Troque seu carro"
 * ou "TROQUE SEU CARRO", com ESPAÇO — e nenhuma das duas casa. Casar por espaço
 * reprovaria a home legítima de uma concessionária, que é o oposto do que esta
 * regra existe para fazer.
 */
export const SENTINELA = /\bTROQUE-[A-Z-]{3,}/

/**
 * O que escrever em cada campo. Fica aqui, e não só no `.pages.yml`, porque
 * esta é a mensagem de ERRO que o dono lê às 23h com o build vermelho — o
 * `.pages.yml` é documentação, este mapa é o que aparece na hora do aperto.
 */
const COMO_PREENCHER: Record<string, string> = {
  'identidade.nome': 'O nome do negócio como o cliente o chama. Ex.: "Padaria do Zé".',
  'identidade.whatsapp.e164':
    'Só dígitos, com DDI e DDD, do jeito que o wa.me aceita — sem +, sem espaço, sem parêntese. O molde é 55DD9NNNNNNNN — DDI, DDD e o número, colados.',
  'identidade.whatsapp.exibicao':
    'O MESMO número de cima, formatado para o visitante ler, no molde (DD) 9NNNN-NNNN.',
  'identidade.email': 'O e-mail que alguém abre e responde. Ex.: "contato@padariadoze.com.br".',
  'identidade.endereco.logradouro': 'Rua e número. Ex.: "Rua das Palmeiras, 512".',
  'identidade.endereco.bairro': 'O bairro. Ex.: "Vila Mariana".',
  'identidade.endereco.cidade': 'A cidade. Ex.: "São Paulo".',
  'identidade.endereco.uf': 'A sigla do estado, duas maiúsculas. Ex.: "SP".',
  'identidade.endereco.cep': 'O CEP com hífen. Ex.: "04101-300".',
  'meta.urlBase':
    'O endereço onde o site vai ficar, com https:// e SEM barra no fim. Ex.: "https://padariadoze.com.br".',
  'meta.titulo': 'O título da aba e do resultado no Google. Ex.: "Padaria do Zé".',
  'meta.gabaritoDeTitulo':
    'O molde do título das páginas filhas, com %s onde entra o nome da página. Ex.: "%s · Padaria do Zé".',
  'meta.descricao':
    'De 50 a 160 caracteres dizendo o que o negócio faz. É este texto que aparece no Google e no preview do link no WhatsApp.',
  'meta.nomeCurto':
    'Até 12 caracteres — é o nome que fica embaixo do ícone do app instalado. Ex.: "Padaria".',
  'meta.og.alt': 'Descrição da imagem de compartilhamento, para quem usa leitor de tela.',
  'home.titulo': 'O título grande da primeira tela. Costuma ser o nome do negócio.',
}

/** Todo texto do JSON, com o caminho até ele, para a varredura de sentinela. */
function caminharTextos(valor: unknown, caminho: string, saida: Array<[string, string]>): void {
  if (typeof valor === 'string') {
    saida.push([caminho, valor])
    return
  }
  if (Array.isArray(valor)) {
    valor.forEach((item, i) => caminharTextos(item, `${caminho}[${i}]`, saida))
    return
  }
  if (typeof valor === 'object' && valor !== null) {
    for (const [chave, item] of Object.entries(valor)) {
      caminharTextos(item, caminho ? `${caminho}.${chave}` : chave, saida)
    }
  }
}

export type Pendencia = { caminho: string; valor: string; instrucao: string }

/** Os campos que ainda estão com placeholder, na ordem em que aparecem no JSON. */
export function acharSentinelas(bruto: unknown): Pendencia[] {
  const textos: Array<[string, string]> = []
  caminharTextos(bruto, '', textos)
  return textos
    .filter(([, valor]) => SENTINELA.test(valor))
    .map(([caminho, valor]) => ({
      caminho,
      valor,
      instrucao: COMO_PREENCHER[caminho] ?? 'Escreva o valor real deste campo.',
    }))
}

const PORQUE_REPROVA =
  'POR QUE O BUILD PARA AQUI EM VEZ DE PUBLICAR: um placeholder plausível — "5500000000000",\n' +
  '"contato@exemplo.com.br" — sobe, parece certo e não entrega pedido nenhum. É o mesmo defeito\n' +
  'do PR Navesz/Galegos#1 (§12.3), estacionado justamente porque o link subia sem destinatário e\n' +
  'o cardápio parava de entregar EM SILÊNCIO. Placeholder aqui é inerte e barulhento: impossível\n' +
  'de confundir com valor real, e reprova até ser trocado.'

/** Uma mensagem com TODOS os campos por preencher, para caber num build só. */
function conferirSentinelas(bruto: unknown): void {
  const pendentes = acharSentinelas(bruto)
  if (!pendentes.length) return
  const lista = pendentes
    .map((p) => `  ${p.caminho} = ${JSON.stringify(p.valor)}\n      → ${p.instrucao}`)
    .join('\n')
  throw new ErroDeConteudo(
    `conteudo/site.json ainda tem ${pendentes.length} campo(s) com PLACEHOLDER. ` +
      `Troque, em conteudo/site.json:\n\n${lista}\n\n${PORQUE_REPROVA}\n`,
  )
}

/**
 * A recusa campo a campo, para quando a sentinela é digitada de volta à mão ou
 * a varredura de cima é removida. Roda ANTES da checagem de tamanho: sem isso
 * `uf: "TROQUE-PELA-UF"` morreria com "no máximo 2 caracteres", que manda o
 * dono ENCURTAR o placeholder em vez de trocá-lo.
 */
function recusarSentinela(limpo: string, caminho: string): void {
  if (!SENTINELA.test(limpo)) return
  const curto = caminho.replace(/^site\./, '')
  throw new ErroDeConteudo(
    `conteudo/site.json em "${curto}": ainda está com o placeholder ${JSON.stringify(limpo)}. ` +
      `${COMO_PREENCHER[curto] ?? 'Escreva o valor real deste campo.'} ` +
      'O build reprova de propósito — placeholder que publica é pedido perdido em silêncio (§12.3).',
  )
}

// ── primitivos ────────────────────────────────────────────────────────────

/** Descrição curta do que VEIO, para a mensagem dizer o que consertar. */
function descrever(valor: unknown): string {
  if (valor === undefined) return 'nada (campo ausente)'
  if (valor === null) return 'null'
  if (typeof valor === 'string') {
    return valor.length <= 60 ? JSON.stringify(valor) : `texto de ${valor.length} caracteres`
  }
  if (Array.isArray(valor)) return `lista de ${valor.length} item(ns)`
  if (typeof valor === 'object') return `objeto com ${Object.keys(valor).length} campo(s)`
  return JSON.stringify(valor)
}

/**
 * O caminho do campo entra na mensagem SEMPRE. Sem ele, "esperava texto, veio
 * nada" manda o dono procurar em 60 linhas de JSON qual dos campos sumiu.
 */
function falhar(caminho: string, esperado: string, recebido: unknown): never {
  throw new ErroDeConteudo(
    `conteudo/site.json inválido em "${caminho}": esperava ${esperado}, veio ${descrever(recebido)}.`,
  )
}

/** Recusa que não é de FORMATO e sim de VALOR MORTO: diz o porquê, não só o quê. */
function falharMorto(caminho: string, recebido: string, porque: string): never {
  throw new ErroDeConteudo(
    `conteudo/site.json em "${caminho.replace(/^site\./, '')}": ${JSON.stringify(recebido)} ${porque}`,
  )
}

export type Validador<T> = (valor: unknown, caminho: string) => T
type Inferir<V> = V extends Validador<infer T> ? T : never

export const texto =
  (min = 1, max = 300): Validador<string> =>
  (valor, caminho) => {
    if (typeof valor !== 'string') falhar(caminho, 'texto', valor)
    const limpo = valor.trim()
    recusarSentinela(limpo, caminho)
    if (limpo.length < min) falhar(caminho, `texto com ao menos ${min} caractere(s)`, valor)
    if (limpo.length > max) falhar(caminho, `texto com no máximo ${max} caracteres`, valor)
    return limpo
  }

export const inteiro =
  (min: number, max: number): Validador<number> =>
  (valor, caminho) => {
    if (typeof valor !== 'number' || !Number.isInteger(valor))
      falhar(caminho, 'número inteiro', valor)
    if (valor < min || valor > max) falhar(caminho, `inteiro entre ${min} e ${max}`, valor)
    return valor
  }

export const padrao =
  (re: RegExp, formato: string, max = 300): Validador<string> =>
  (valor, caminho) => {
    const limpo = texto(1, max)(valor, caminho)
    if (!re.test(limpo)) falhar(caminho, `texto no formato ${formato}`, valor)
    return limpo
  }

export const objeto =
  <F extends Record<string, Validador<unknown>>>(
    campos: F,
  ): Validador<{ [K in keyof F]: Inferir<F[K]> }> =>
  (valor, caminho) => {
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
      falhar(caminho, 'objeto', valor)
    }
    const bruto = valor as Record<string, unknown>
    const saida: Record<string, unknown> = {}
    for (const chave of Object.keys(campos)) {
      saida[chave] = campos[chave](bruto[chave], caminho ? `${caminho}.${chave}` : chave)
    }
    // Campo desconhecido REPROVA, e essa é a escolha cara de propósito. Campo a
    // mais é quase sempre campo renomeado no esquema e esquecido no JSON — ou o
    // contrário. Tolerar a sobra é deixar o dono editar um campo que ninguém lê,
    // que é a falha silenciosa que o §12.3 existe para não repetir.
    const sobra = Object.keys(bruto).filter((chave) => !(chave in campos))
    if (sobra.length) {
      throw new ErroDeConteudo(
        `conteudo/site.json inválido em "${caminho || 'site'}": campo(s) que o esquema não conhece — ${sobra
          .map((chave) => JSON.stringify(chave))
          .join(', ')}. Conhecidos: ${Object.keys(campos).join(', ')}.`,
      )
    }
    return saida as { [K in keyof F]: Inferir<F[K]> }
  }

export const lista =
  <T>(item: Validador<T>, min = 1, max = 24): Validador<T[]> =>
  (valor, caminho) => {
    if (!Array.isArray(valor)) falhar(caminho, 'lista', valor)
    if (valor.length < min || valor.length > max) {
      falhar(caminho, `lista com ${min} a ${max} item(ns)`, valor)
    }
    return valor.map((item_, i) => item(item_, `${caminho}[${i}]`))
  }

// ── o que é plausível e mesmo assim está morto ────────────────────────────

/**
 * Seis zeros seguidos. `5500000000000` traz onze; `(00) 00000-0000` traz nove.
 * Nenhum plano de numeração entrega assinante com essa corrida — o corte em
 * seis dá folga para o número real mais zerado que existe e ainda mata todo
 * placeholder de teclado.
 */
const ZEROS_DEMAIS = /0{6,}/

/** `1111111111`, `0000000000`: passa em qualquer regex de formato e não existe. */
const UM_DIGITO_SO = /^(\d)\1+$/

/**
 * Host que existe para ser exemplo, e por isso nunca é destino.
 *
 * `exemplo.com.br` é o pior deles: está REGISTRADO, resolve, e o e-mail mandado
 * para lá some sem bounce — a mesma falha silenciosa do telefone, só que na
 * caixa de entrada. `.invalid`, `.test`, `.example` e `.localhost` são
 * reservados pela RFC 2606 e não resolvem nunca; recusá-los aqui é o que
 * transforma o padrão inerte do gerador (`<nome>.exemplo.invalid`) de barulho
 * em dente — o aviso do gerador pedia para trocar, agora o build cobra.
 */
function hostDeMentira(host: string): boolean {
  const h = host.toLowerCase()
  return (
    /^(exemplo|example|dominio|domain|seudominio|meudominio|seusite|meusite)\./.test(h) ||
    /\.(invalid|test|example|localhost)$/.test(h) ||
    h === 'localhost'
  )
}

// ── validadores de formato ────────────────────────────────────────────────

/**
 * URL de origem, SEM barra no fim. A barra é cobrada porque `robots.ts` e
 * `sitemap.ts` concatenam `${urlBase}/sitemap.xml`; com a barra sobrando o
 * arquivo sai anunciado como `https://dominio.com.br//sitemap.xml`, que é 404
 * e ninguém percebe — o build passa e o Search Console é que reclama, semanas
 * depois.
 */
export const urlBase: Validador<string> = (valor, caminho) => {
  const limpo = padrao(
    /^https:\/\/[^\s/?#]+$/,
    'https://dominio.com.br (sem barra no fim)',
    200,
  )(valor, caminho)
  if (hostDeMentira(limpo.slice('https://'.length))) {
    falharMorto(
      caminho,
      limpo,
      'é domínio de exemplo, não o endereço do site. Ele vira o og:url, o sitemap e o robots.txt: ' +
        'publicado assim, o cartão de compartilhamento aponta para um lugar que não existe e ninguém ' +
        'percebe. Escreva o domínio de verdade (ex.: https://padariadoze.com.br), ou gere o projeto de ' +
        'novo passando o domínio como segundo argumento.',
    )
  }
  return limpo
}

/** Caminho servido de `public/`. Absoluto, porque vira URL absoluta no og. */
export const caminhoPublico = padrao(/^\/[^\s?#]*$/, '/arquivo.ext', 200)

export const corHex = padrao(/^#[0-9a-fA-F]{6}$/, '#rrggbb', 7)

/**
 * Só dígitos, com DDI. É o que o `wa.me` aceita — ele rejeita pontuação.
 *
 * E não basta casar o formato: `5500000000000` casava, e era o defeito. O
 * `wa.me` com número que não existe NÃO dá erro visível do lado de cá — abre o
 * WhatsApp, diz ao cliente que o número é inválido, e o cliente vai embora. Do
 * lado do dono não chega nada, nem um log. Por isso a recusa é aqui, no build.
 */
export const telefoneE164: Validador<string> = (valor, caminho) => {
  const limpo = padrao(
    /^[1-9]\d{9,14}$/,
    'só dígitos, com DDI (ex.: 55 + DDD + número)',
    15,
  )(valor, caminho)
  if (ZEROS_DEMAIS.test(limpo) || UM_DIGITO_SO.test(limpo)) {
    falharMorto(
      caminho,
      limpo,
      'casa o formato e não é telefone de ninguém. O wa.me com número inexistente abre e morre do ' +
        'lado do cliente, sem erro nenhum do lado do dono — o site fica no ar entregando zero pedido. ' +
        'Escreva o número real, só dígitos, no molde 55DD9NNNNNNNN.',
    )
  }
  return limpo
}

/**
 * O número como o visitante LÊ. Separado do `e164` de propósito — o Galegos
 * tinha o mesmo número em dois formatos dentro de `src/lib/whatsapp.ts` e a
 * causa era não existir campo para cada uso. Tendo dois campos, aparece o risco
 * novo: os dois divergirem. Quem cobra a igualdade é `conferirCoerencia`.
 */
export const telefoneExibicao: Validador<string> = (valor, caminho) => {
  const limpo = texto(8, 30)(valor, caminho)
  const digitos = limpo.replace(/\D/g, '')
  if (digitos.length < 10 || digitos.length > 11) {
    falhar(caminho, 'telefone com DDD, como o visitante lê, no molde (DD) 9NNNN-NNNN', valor)
  }
  if (ZEROS_DEMAIS.test(digitos) || UM_DIGITO_SO.test(digitos)) {
    falharMorto(
      caminho,
      limpo,
      'é máscara de formulário, não telefone. É o número que o visitante vê no rodapé e digita no ' +
        'celular dele. Escreva o real, no molde (DD) 9NNNN-NNNN.',
    )
  }
  return limpo
}

export const email: Validador<string> = (valor, caminho) => {
  const limpo = padrao(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'nome@dominio', 120)(valor, caminho)
  if (hostDeMentira(limpo.slice(limpo.indexOf('@') + 1))) {
    falharMorto(
      caminho,
      limpo,
      'é e-mail de exemplo. `exemplo.com.br` está registrado de verdade: a mensagem do cliente sai, ' +
        'não volta bounce nenhum, e some — o mesmo silêncio do telefone, na caixa de entrada. ' +
        'Escreva o e-mail que alguém abre e responde.',
    )
  }
  return limpo
}

/**
 * As 27 unidades federativas, fechadas em lista. Um `/^[A-Z]{2}$/` aceita `XX`,
 * `AA` e `ZZ` — e endereço com UF que não existe some do mapa sem avisar.
 */
const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
]

export const uf: Validador<string> = (valor, caminho) => {
  const limpo = padrao(/^[A-Z]{2}$/, 'UF em duas maiúsculas', 2)(valor, caminho)
  if (!UFS.includes(limpo)) {
    falharMorto(caminho, limpo, `não é uma UF brasileira. As que existem: ${UFS.join(', ')}.`)
  }
  return limpo
}

export const cep: Validador<string> = (valor, caminho) => {
  const limpo = padrao(/^\d{5}-\d{3}$/, '00000-000', 9)(valor, caminho)
  if (UM_DIGITO_SO.test(limpo.replace('-', ''))) {
    falharMorto(
      caminho,
      limpo,
      'casa o formato e não é CEP de lugar nenhum. Escreva o do endereço (ex.: "04101-300").',
    )
  }
  return limpo
}

export const dataIso = padrao(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD', 10)

/** O `%s` é o buraco onde o Next encaixa o título da página filha. */
export const gabaritoDeTitulo: Validador<string> = (valor, caminho) => {
  const limpo = texto(4, 120)(valor, caminho)
  if (!limpo.includes('%s'))
    falhar(caminho, 'gabarito contendo %s (onde entra o título da página)', valor)
  return limpo
}

// ── o contrato do site ────────────────────────────────────────────────────

const formaDoSite = objeto({
  // Identidade do negócio. §12.3: isto é CONTEÚDO VALIDADO, não env var.
  identidade: objeto({
    nome: texto(2, 80),
    whatsapp: objeto({
      // O que entra no link. Sem pontuação, porque o `wa.me` a rejeita.
      e164: telefoneE164,
      // O que o visitante lê.
      exibicao: telefoneExibicao,
    }),
    email,
    endereco: objeto({
      logradouro: texto(4, 120),
      bairro: texto(2, 60),
      cidade: texto(2, 60),
      uf,
      cep,
    }),
  }),

  meta: objeto({
    urlBase,
    idioma: padrao(/^[a-z]{2}-[A-Z]{2}$/, 'pt-BR', 5),
    titulo: texto(4, 70),
    gabaritoDeTitulo,
    descricao: texto(50, 160),
    nomeCurto: texto(2, 12),
    // Data do sitemap. É CONTEÚDO e não `new Date()` porque `new Date()` no
    // build faz o mesmo commit gerar bytes diferentes a cada rodada, e build
    // que não é reprodutível não dá para comparar.
    atualizadoEm: dataIso,
    cores: objeto({ tema: corHex, fundo: corHex }),
    og: objeto({
      caminho: caminhoPublico,
      // 1200×630 não é decoração: é a proporção que WhatsApp, LinkedIn e
      // Twitter recortam sem cortar. Fixo no esquema para o campo não virar
      // um número qualquer que ninguém confere.
      largura: inteiro(1200, 1200),
      altura: inteiro(630, 630),
      alt: texto(10, 140),
    }),
  }),

  home: objeto({
    titulo: texto(4, 90),
    // Subtítulo e destaques NÃO levam sentinela, e a linha está escrita aqui de
    // propósito: o corte é entre FATO VERIFICÁVEL do negócio (contato,
    // endereço, domínio, e a descrição que viaja no preview do link) e TEXTO DE
    // MARKETING. Fato errado desvia pedido e visita em silêncio; "Primeiro
    // destaque" não engana ninguém — o dono vê no primeiro `npm run dev` e o
    // texto já se anuncia como exemplo. Reprovar o build por causa de copy é o
    // caminho rápido para o dono apagar a validação inteira.
    subtitulo: texto(20, 220),
    chamadaAcao: texto(4, 40),
    // O texto que já vai escrito na conversa do WhatsApp. Está aqui, e não
    // dentro do `page.tsx`, porque é frase que o dono reescreve — e a regra
    // `conteudo-fora-do-codigo` acusaria a frase se ela morasse no componente.
    mensagemWhatsapp: texto(10, 200),
    destaques: lista(objeto({ titulo: texto(3, 60), texto: texto(20, 240) }), 1, 6),
  }),
})

type FormaDoSite = Inferir<typeof formaDoSite>

/**
 * O número que o visitante LÊ tem de ser o número para onde o link VAI.
 *
 * Este é o defeito do Galegos na forma original: dois formatos do mesmo
 * telefone, mantidos à mão, divergindo. Quando divergem, o rodapé mostra um
 * número e o botão abre outro — e ninguém percebe, porque as duas coisas
 * "funcionam".
 */
function conferirCoerencia(site: FormaDoSite): void {
  const visivel = site.identidade.whatsapp.exibicao.replace(/\D/g, '')
  if (!site.identidade.whatsapp.e164.endsWith(visivel)) {
    throw new ErroDeConteudo(
      'conteudo/site.json: identidade.whatsapp.exibicao e identidade.whatsapp.e164 são telefones ' +
        `DIFERENTES — o rodapé mostra ${JSON.stringify(site.identidade.whatsapp.exibicao)} ` +
        `(dígitos ${visivel}) e o link abre ${site.identidade.whatsapp.e164}. ` +
        'Os dois campos são o MESMO número em formatos diferentes: o e164 tem de terminar nos ' +
        'dígitos do exibicao — e164 no molde 55DD9NNNNNNNN, exibicao no molde (DD) 9NNNN-NNNN.',
    )
  }
}

/**
 * A porta única. Sentinela primeiro (uma mensagem com tudo que falta), depois o
 * formato campo a campo, depois a coerência entre campos — nessa ordem porque é
 * a ordem em que o dono resolve: preencher, corrigir, conferir.
 */
export const esquemaSite: Validador<FormaDoSite> = (valor, caminho) => {
  conferirSentinelas(valor)
  const site = formaDoSite(valor, caminho)
  conferirCoerencia(site)
  return site
}

export type Site = FormaDoSite

/**
 * O link do WhatsApp é MONTADO em código a partir do número que é conteúdo.
 * Essa divisão é o conserto do `Navesz/Galegos#1` feito do lado certo: o
 * formato do link é código (não muda por negócio), o destinatário é conteúdo
 * validado (muda, e falta dele reprova o build em vez de sumir em produção).
 */
export function linkWhatsapp(site: Site, mensagem: string): string {
  return `https://wa.me/${site.identidade.whatsapp.e164}?text=${encodeURIComponent(mensagem)}`
}
