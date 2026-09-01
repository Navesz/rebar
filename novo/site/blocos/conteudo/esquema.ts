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
 */

export class ErroDeConteudo extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeConteudo'
  }
}

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

export type Validador<T> = (valor: unknown, caminho: string) => T
type Inferir<V> = V extends Validador<infer T> ? T : never

export const texto =
  (min = 1, max = 300): Validador<string> =>
  (valor, caminho) => {
    if (typeof valor !== 'string') falhar(caminho, 'texto', valor)
    const limpo = valor.trim()
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

// ── validadores de formato ────────────────────────────────────────────────

/**
 * URL de origem, SEM barra no fim. A barra é cobrada porque `robots.ts` e
 * `sitemap.ts` concatenam `${urlBase}/sitemap.xml`; com a barra sobrando o
 * arquivo sai anunciado como `https://exemplo.com.br//sitemap.xml`, que é 404
 * e ninguém percebe — o build passa e o Search Console é que reclama, semanas
 * depois.
 */
export const urlBase = padrao(
  /^https:\/\/[^\s/?#]+$/,
  'https://dominio.com.br (sem barra no fim)',
  200,
)

/** Caminho servido de `public/`. Absoluto, porque vira URL absoluta no og. */
export const caminhoPublico = padrao(/^\/[^\s?#]*$/, '/arquivo.ext', 200)

export const corHex = padrao(/^#[0-9a-fA-F]{6}$/, '#rrggbb', 7)

/** Só dígitos, com DDI. É o que o `wa.me` aceita — ele rejeita pontuação. */
export const telefoneE164 = padrao(
  /^[1-9]\d{9,14}$/,
  'só dígitos, com DDI (ex.: 55 + DDD + número)',
  15,
)

export const dataIso = padrao(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD', 10)

/** O `%s` é o buraco onde o Next encaixa o título da página filha. */
export const gabaritoDeTitulo: Validador<string> = (valor, caminho) => {
  const limpo = texto(4, 120)(valor, caminho)
  if (!limpo.includes('%s'))
    falhar(caminho, 'gabarito contendo %s (onde entra o título da página)', valor)
  return limpo
}

// ── o contrato do site ────────────────────────────────────────────────────

export const esquemaSite = objeto({
  // Identidade do negócio. §12.3: isto é CONTEÚDO VALIDADO, não env var.
  identidade: objeto({
    nome: texto(2, 80),
    whatsapp: objeto({
      // O que entra no link. Sem pontuação, porque o `wa.me` a rejeita.
      e164: telefoneE164,
      // O que o visitante lê. Separado do de cima de propósito: o Galegos tinha
      // o mesmo número em DOIS formatos dentro do código (`src/lib/whatsapp.ts`),
      // e a causa era não existir campo para cada uso.
      exibicao: texto(8, 30),
    }),
    email: padrao(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'nome@dominio', 120),
    endereco: objeto({
      logradouro: texto(4, 120),
      bairro: texto(2, 60),
      cidade: texto(2, 60),
      uf: padrao(/^[A-Z]{2}$/, 'UF em duas maiúsculas', 2),
      cep: padrao(/^\d{5}-\d{3}$/, '00000-000', 9),
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
    subtitulo: texto(20, 220),
    chamadaAcao: texto(4, 40),
    // O texto que já vai escrito na conversa do WhatsApp. Está aqui, e não
    // dentro do `page.tsx`, porque é frase que o dono reescreve — e a regra
    // `conteudo-fora-do-codigo` acusaria a frase se ela morasse no componente.
    mensagemWhatsapp: texto(10, 200),
    destaques: lista(objeto({ titulo: texto(3, 60), texto: texto(20, 240) }), 1, 6),
  }),
})

export type Site = Inferir<typeof esquemaSite>

/**
 * O link do WhatsApp é MONTADO em código a partir do número que é conteúdo.
 * Essa divisão é o conserto do `Navesz/Galegos#1` feito do lado certo: o
 * formato do link é código (não muda por negócio), o destinatário é conteúdo
 * validado (muda, e falta dele reprova o build em vez de sumir em produção).
 */
export function linkWhatsapp(site: Site, mensagem: string): string {
  return `https://wa.me/${site.identidade.whatsapp.e164}?text=${encodeURIComponent(mensagem)}`
}
