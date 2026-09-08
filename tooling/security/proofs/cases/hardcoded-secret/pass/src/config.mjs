// O REPOSITORIO CORRETO, com os falsos positivos NOMEADOS que derrubam um
// detector ingenuo. Cada um esta aqui por uma medicao, e cada um trava uma
// parte diferente da defesa do varredor.
//
// FALSO POSITIVO 1 — A DOCUMENTACAO QUE CITA O PREFIXO DO FORNECEDOR.
//   Medido no proprio varredor: `sk-ant-api03-EXEMPLO-nao-e-chave-de-verdade`
//   foi o UNICO falso positivo em 44 casos de ataque, e e texto que nenhum
//   projeto consegue evitar escrever. Quem tirar PLACEHOLDER_FORTE do vao
//   casado reprova este lado.
//
// FALSO POSITIVO 2 — O VALOR QUE VEM DO AMBIENTE. `process.env.X` e o
//   CONSERTO da falha, nao a falha. Um detector que olha so o nome do
//   identificador acusa `apiKey` aqui do mesmo jeito que no lado que reprova.
//
// FALSO POSITIVO 3 — `key` SEM QUALIFICADOR NAO E CREDENCIAL. `cacheKey`,
//   `sortKey` e `chaveDeOrdenacao` sao a maioria dos `key` de qualquer
//   projeto. Quem promover `key` sozinho a palavra forte reprova este lado.
//
// FALSO POSITIVO 4 — A SENHA DE UMA MAQUINA QUE E A PROPRIA MAQUINA. Uma
//   string de conexao para localhost nao e segredo de ninguem: quem tem a
//   senha ja tem a maquina.
//
// FALSO POSITIVO 5 — A VALVULA DE ESCAPE ESCRITA. `rebar-segredo-ok:` e um
//   CONTRATO ja escrito nos repositorios auditados. Quem fizer esta regra ler
//   o codigo sem o comentario -- e a tentacao existe, porque as outras regras
//   deste modulo leem assim -- desliga toda liberacao ja em uso, e reprova
//   este lado.

// 1
export const NA_DOCUMENTACAO = 'sk-ant-api03-EXEMPLO-nao-e-chave-de-verdade'

// 2
const apiKey = process.env.WEATHER_API_KEY

// 3
const cacheKey = 'usuario-12345-perfil'

// 4
export const bancoLocal = 'postgres://app:trocar@localhost:5432/app'

// 5
const tokenDeAmostra = 'ghp_C5d6E7f8G9h0I1j2K3l4M5n6O7p8Q9r0S1t2' // rebar-segredo-ok: sintetico

export const clima = (cidade) =>
  fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${cidade}`)

export const chaves = { cacheKey, tokenDeAmostra }
