# rebar — o alicerce v2

> **O que é este arquivo.** O manuscrito único do projeto, em fase de planejamento.
> A analogia do dono: *"é como um livro — primeiro o cara escreve tudo, depois pega o que ficou bom e publica."*
> Planejamos tudo aqui; **depois** este arquivo vira uma árvore de arquivos no repositório.
> Enquanto isso, nada de decisão que more só na conversa.
>
> **Status:** planejamento · **Atualizado:** 25/08/2026

---

# 0. Objetivos do repositório

1. **Fazer código errado não passar.** Tudo tipado, tudo testável, e erro que **barra** em vez de virar aviso ignorado.
2. **`npm create rebar`** — gerar um projeto web que já nasce com a stack certa e o portão fechado, sem edição manual.
3. **Continuar impondo depois do dia 1.** O gerador não sai de cena; ele fica no projeto como MCP e como portão de commit e CI.
4. **Descer as regras de nível.** Tudo que hoje é pedido em prosa para a IA e caberia num compilador, lint ou teste, vira compilador, lint ou teste.
5. **Manter o MCP vivo.** Quando a regra do projeto muda, o MCP se regenera — e o portão reprova se ele estiver velho. *(Ver §7.2 — é o defeito que o dono viveu no Herz e no BMB Compras.)*
6. **Ser navegável por um agente novo** sem ler tudo: índice, README e MCP como pontos de entrada.

---

# Índice

| § | Seção | Para quê |
|---|---|---|
| [1](#1-como-trabalhamos) | Como trabalhamos | As regras desta colaboração. Ler antes de agir |
| [2](#2-contexto) | Contexto | De onde veio o projeto e qual é a dor |
| [3](#3-os-três-achados-que-reenquadram-o-projeto) | Os três achados | O que mudou de entendimento durante o levantamento |
| [4](#4-a-taxonomia-n0n7--o-ativo-mais-valioso) | Taxonomia N0–N7 | A espinha de tudo. Sem isso nada faz sentido |
| [5](#5-o-painel-completo--120-decisões) | O painel — 120 decisões | O inventário. Vira `perfil.esquema.json` |
| [6](#6-inventário-do-aplicativo-completo) | Aplicativo completo | O que o app precisa ter, e o que falta no alicerce |
| [7](#7-arquitetura-do-rebar) | Arquitetura | Perfil-como-compilador, MCP vivo, camadas de porta |
| [8](#8-o-que-se-leva-de-cada-repositório) | O que se leva | Inventário de herança: alicerce e herz |
| [9](#9-ordem-de-construção) | Ordem de construção | Sequência com critério de pronto |
| [10](#10-verificação) | Verificação | Como saber que funcionou |
| [11](#11-registro-de-decisões) | Registro de decisões | Log datado. **Toda mudança entra aqui** |
| [12](#12-revisão--furos-encontrados) | **Revisão — furos** | O que a revisão adversarial derrubou. **Ler antes de implementar** |
| [13](#13-aberto) | Aberto | O que ainda não sabemos |

**Quando isto virar árvore de arquivos**, o corte previsto é: §4 e §5 → `manual/`; §5 → também `perfil.esquema.json`; §6 → `manual/aplicativo-completo.md`; §7 → `arquitetura/`; §11 → `adr/`.

---

# 1. Como trabalhamos

Instruções do dono, a valer durante todo o projeto. Estão aqui porque **os dois esquecem** — palavras dele: *"eu também sou igual você, cara. Eu vou esquecer de algumas coisas que estou falando, assim como você esquece."*

1. **Centralizar.** Um arquivo, ou no máximo três. No começo há coisa demais e se esquece qual arquivo editar. Centralizar evita pivotar à toa.
2. **Índice e referência cruzada.** Para nenhum dos dois precisar reler tudo, e para um agente novo se guiar sozinho.
3. **Documento vivo.** A informação muda ao longo do tempo; o arquivo acompanha. Mudança entra no [Registro de decisões](#11-registro-de-decisões).
4. **Planejar tudo primeiro, publicar depois.** Só transformar em árvore de arquivos quando o plano estiver fechado.
5. **Objetivos no topo**, sempre visíveis.
6. **O MCP é prioridade logo depois do README** — é ele que impede a IA de ignorar o que foi combinado.

## 1.1 Crítica do dono ao meu trabalho, registrada

> *"Eu estou vendo que você está mais arrumando o bug do que implementando novas."*

Procede. Nesta sessão eu auditei, consertei `openparts`, consertei o instalador de hooks do alicerce, e licenciei cinco repositórios — muito conserto, pouca construção. Parte foi pedida, mas a observação vale como correção de rumo: **o rebar é construção, não auditoria.**

Ele também aponta a causa e a cura, e as duas importam para o desenho:

> *"No Herz e no BMB Compras eu não tive esse problema porque elaborei um MCP com todas as regras de projeto, pra ele sempre ficar na memória e forçar a ser usadas."*

E o defeito que sobrou:

> *"O MCP não era reescrito quando as regras de projeto foram modificadas. Não tem a capacidade de reescrever o MCP em tempo real."*

**Esse defeito é o requisito nº 5 do projeto.** Ver [§7.2](#72-o-mcp-que-se-regenera).

---

# 2. Contexto

O dono constrói sites com ajuda de IA. Tem dois repositórios que deveriam resolver isso e não resolvem:

- **`alicerce`** — o método: painel de 120 decisões, constituição de 23 invariantes, taxonomia N0–N7, e um `ferramental/` de verificadores.
- **`herz`** — um PCP real, com a stack mais bem pensada que ele tem e uma interface que funciona muito bem.

A queixa de origem: *"todos os sites que peço para usar o alicerce como referência, muita coisa é ignorada, hardcoded, esquecendo alguma coisa da stack, colocando o claude como colaborador, esquecendo do shadcn"*.

O diagnóstico já estava escrito pelo próprio alicerce, em `perfis/herz.md:14`: **"decisão que mora onde nenhuma máquina lê"**.

## 2.1 Decisões travadas

| Decisão | Escolha |
|---|---|
| Natureza | Gera **e** fica vigiando |
| Alvo | Presets `site` / `app` / `api`, núcleo comum |
| Dureza | **Bloqueia commit e CI** |
| Coautoria de IA | Bloqueada nos projetos novos; histórico do alicerce fica como está |
| Nome | `rebar` — o vergalhão dentro do concreto |
| Banco | **Postgres.** SQL Server exige licença; e não há migração, o backend do herz nunca foi construído |
| Interface | **Aproveitar a do herz** — *"funciona muito bem, está bem animada, os botões estão bem legais"* |
| Base do repo | Novo. **Não construir em cima do alicerce atual** |
| Sequência | Inventário → revisão por agentes → README → **MCP** → resto |

---

# 3. Os três achados que reenquadram o projeto

## 3.1 A stack do herz é, em boa parte, documento — não código

| `Stack.md` afirma | Realidade | Evidência |
|---|---|---|
| Fastify, camadas `domain/ app/ http/ db/` | Não existe. `apps/` só tem `web` | `Stack.md:153-176` |
| Kysely + MssqlDialect + tedious | Não instalado | `Stack.md:234` |
| Playwright em 3 fluxos | Não instalado | `Stack.md:607` |
| shadcn/ui + **Radix** | É **`@base-ui/react`**; Radix só transitivo via `cmdk` | `apps/web/package.json:16` |
| `responseValidation` ligado | Ignorado com `api` custom; refeito à mão | `apps/web/src/dados/cliente.ts:8-30` |

**Não há backend para portar.** Postgres entra sem custo de migração.

## 3.2 O alicerce impõe menos de 7% do que documenta

- **120 decisões** no painel (não 117 — quatro arquivos afirmam 117).
- **~8 decisões** têm porta real. **5 dos 23 invariantes** têm código que roda.
- `base/`, `orquestracao/`, `adr/` estão **vazios**.
- **`perfil.esquema.json` não existe.** O motor validador passa em 10 fixtures, mas o default aponta para arquivo ausente → exit 2.
- `fronteiras/provas/provar.mjs` quebra no Windows: `execFileSync('npx', …)` sem `shell:true`. Derruba o passo `fronteiras` **e** o `provar-portao.mjs`. Invisível porque o CI só roda Linux.

**A inversão que define o rebar:** no alicerce o gerador é o M8, último e nunca alcançado. No rebar, **o gerador é o produto**.

## 3.3 O ponto cego do alicerce é onde os projetos do dono vivem

O alicerce foi escrito para sistema corporativo interno. O dono constrói **sites públicos**. O painel não tem uma linha sobre:

> termos de uso · política de privacidade · cookies · base legal · canal do titular · DPO · DPA · SEO · `<title>`/description · favicon · `og:image` · sitemap · `robots.txt` · manifest/PWA · LICENSE · README como entregável

Grep no repositório inteiro: **zero ocorrências**. Pelo critério do próprio painel (*o inimigo é "não perceber que havia uma escolha"*), é o modo de falha dele acontecendo nele mesmo. **Maior contribuição original do rebar.**

---

# 4. A taxonomia N0–N7 — o ativo mais valioso

De `manual/02-quem-impoe.md`. Regra-mãe (`:8`): **"Se uma regra pode descer um nível, ela deve descer."**

| Nível | O que é | Falha como | Custo/sessão |
|---|---|---|---|
| **N0** | Compilador — tipos, contrato tipado, exaustividade | "não compila" | zero |
| **N1** | Análise estática — lint, fronteiras, ciclos, cor literal | "não passa no lint" | zero |
| **N2** | Contrato em runtime — Zod na borda, env no boot | "não passa na borda" | ~zero |
| **N3** | Teste | "não passa na suíte" | zero |
| **N4** | CI — bloqueia merge | "não entra na principal" | zero |
| **N5** | Hook — impede **antes** de acontecer | "a ação não acontece" | ~zero |
| **N6** | Regra de IA — `CLAUDE.md`, MCP | "depende de ler e obedecer" | **alto e recorrente** |
| **N7** | Porta humana | "depende de alguém prestar atenção" | alto |

**Fronteira do determinismo entre N5 e N6.** Acima é máquina; abaixo é pedido.

1. **A conta** (`:43-54`): 100 linhas de regra ≈ 1,5k tokens. 30 sessões/semana por um ano ≈ **2,3 milhões de tokens**. *"Toda regra que mora em N6 e caberia em N0–N5 é dívida."* Alvo: instrução sempre presente **< 200 linhas**.
2. **O limite** (`:103-114`): *"Regra automática errada custa mais que regra ausente."* **Toda regra que sobe para N1 nasce com dois casos — um que reprova, um que aprova.**

**É isto que responde à queixa.** A IA ignora porque quase tudo está em N6. A resposta não é escrever melhor — é **descer de nível**.

---

# 5. O painel completo — 120 decisões

Transcrição de `manual/00-painel-de-decisoes.md`. ✅ padrão da casa · ⬜ o projeto decide · 🔴 caro de reverter.

*(Esta seção vira `perfil.esquema.json`. Cada linha ganha dois campos que o alicerce não tem: **nível N0–N7** e **artefato gerado**.)*

## Eixo 0 · Produto e limites — 9
> Antes de qualquer tecnologia. Metade dos erros de arquitetura são erros de escopo assumido.

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ⬜🔴 Que problema resolve, em uma frase | — | N7 | Escopo cresce sem limite |
| ⬜🔴 O que o sistema **não** faz | Lista explícita, versionada | N7 | Cada pedido vira feature |
| ⬜ Atores e o que cada um pode | Lista antes do RBAC | N7 | Permissão vira remendo |
| ⬜🔴 Criticidade: dinheiro, tempo ou vida? | — | N7 | Define o rigor de tudo abaixo |
| ⬜ Volume esperado | Ordem de grandeza basta | N7 | Otimização inventada ou ausente |
| ⬜🔴 Multi-tenant? | Não, salvo prova | N0/N2 | Retrofit de tenant é reescrita |
| ✅ Idioma do código e do domínio | Português, um só | N1 | Nome duplicado em dois idiomas |
| ⬜ Sistemas com que integra, e quem manda | Lista com dono humano | N7 | Acoplamento descoberto tarde |
| ⬜ Prazo de vida esperado | — | N7 | Rigor desproporcional ao descartável |

## Eixo 1 · Contrato — 13
> Onde a IA mais inventa: cria `POST /pedido/iniciar` quando o servidor espera `POST /pedidos/:id/iniciar-montagem`.

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ✅🔴 Fonte única, importada pelas duas pontas | Pacote `contracts`, sem geração intermediária | N0 | Divergência descoberta pelo usuário |
| ⬜ Ferramenta de contrato | ts-rest + Zod | N0 | — |
| ✅ Contrato descreve rota inteira | método, path, params, query, body, status, erro | N0 | Schema solto valida payload, não API |
| ✅🔴 Validação de **resposta**, inclusive em produção | Sim | N2 | `as any` passa direto |
| ✅ Formato de erro | Problem Details RFC 9457 | N2 | Tela casa string de mensagem |
| ✅🔴 `commandId` gerado pelo **cliente** | Sim | N0/N2 | Retry duplica efeito |
| ✅ `request`·`response`·`evento`·`erro` separados | Sim | N1 | Ciclos de vida no mesmo tipo |
| ✅ `z.input` no cliente, `z.output` no servidor | Sim | N0 | Funciona por acidente |
| ⬜ Versionamento de API | Aditivo; quebra exige ADR | N7 | Cliente antigo quebra em silêncio |
| ✅ Paginação/filtro/ordenação | Primitivo compartilhado | N0 | Cada rota inventa a sua |
| ✅ Zero dependência de Node no contrato | Sim | N0/N1 | Bundle do browser quebra |
| ⬜ Data e fuso | ISO 8601 com offset, sempre | N2 | Bug de fuso é o mais caro de achar |
| ⬜ Dinheiro | Inteiro em centavos, nunca float | N0/N2 | Erro de centavo em relatório |

## Eixo 2 · Dados e persistência — 15

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ⬜🔴 Banco e dialeto | — | — | Reversível só cedo |
| ✅🔴 Query builder sobre ORM que esconde SQL | Kysely | N7 | Abstração que esconde o que executa |
| ✅ Um pool, uma API de transação | Sim | N1 | Dois modelos transacionais |
| ✅🔴 Uma transação por caso de uso, via `UnitOfWork` | Sim | N1/N3 | Transação aberta em qualquer lugar |
| ✅🔴 Nenhum I/O externo dentro de transação | Outbox após commit | N1/N3 | Lock segurado por HTTP de terceiro |
| ✅ Concorrência: `UPDATE` condicional | Sim | N3 | Saldo negativo sob concorrência |
| ✅🔴 Conflito de versão é `409`, **nunca** retry | Sim | N3 | Retry sobrescreve intenção alheia |
| ✅ Retry só transitório, do caso de uso inteiro | No `UnitOfWork` | N3 | Retry parcial corrompe estado |
| ⬜🔴 Migrations: ferramenta, reversibilidade | Reversível ou com ADR | N4/N7 | Migration destrutiva sem volta |
| ✅ Migration existente nunca é editada | Nova migration | N1/N4 | Ambientes divergem em silêncio |
| ⬜ Seed determinístico | Sim, seed fixo | N3 | Teste que passa às terças |
| ⬜ Invariante no banco (CHECK, FK, unique) | Sim, além do código | N2 | Código é uma porta; banco é a última |
| ⬜ Soft delete? | Não, salvo exigência legal | N7 | `WHERE deleted_at IS NULL` esquecido |
| ⬜🔴 Backup — **quem já testou restaurar?** | Restauração testada antes do go-live | N7 | Backup nunca testado é inexistente |
| ⬜ Retenção e expurgo | Antes da primeira gravação | N7 | LGPD e tabela de 400 GB |

## Eixo 3 · Fronteiras e composição — 9

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ✅🔴 Camadas e direção de import fixa | domínio → nada; dados → sem UI; componente → sem busca | N1 | Tudo importa tudo em 3 meses |
| ✅🔴 Fronteira imposta por ferramenta | `dependency-cruiser` no CI | N1/N4 | README é intenção |
| ✅ Regra de negócio em código puro | Sim | N1/N3 | Regra só testável subindo o mundo |
| ✅ Ciclo de import reprovado | Sim | N1 | Funciona até parar de funcionar |
| ✅ Módulo órfão sinalizado | Aviso | N1 | Código não revisado no repositório |
| ✅ Estado global mutável não existe | Dependência explícita | N1/N7 | IA não prevê efeito |
| ⬜ Monorepo: quem depende de quem | Grafo declarado | N1 | Pacote vira lixeira comum |
| ✅🔴 Raio de busca: feature em quantos arquivos | Alvo ≤ 10 | N6/N7 | É **a** métrica de custo de token |
| ⬜ Organização: por camada ou por feature | Por feature onde houver domínio real | N7 | Mudar feature toca 8 pastas |

## Eixo 4 · Verificação — 18
> O eixo que se esquece. Não porque é difícil — porque se pede "testes" e se recebe teste unitário.

**Colunas diferentes neste eixo.**

| Verificação | Padrão da casa | O que ela pega | Gatilho |
|---|---|---|---|
| ✅ Tipagem estrita | `strict`, sem exceção sem ADR | Divergência de forma | Sempre |
| ✅ Formatação | Automática, não discutida | Ruído de revisão | Sempre |
| ✅ Estática + fronteiras | Lint + `dependency-cruiser` | Camada cruzada, ciclo, órfão | Sempre |
| ✅ Unitário de domínio | Sim | Regra de negócio errada | Existe regra de negócio |
| ⬜🔴 **Teste de contrato** | Sim | Handler que divergiu do schema | Existe API |
| ⬜🔴 **Integração com banco real** | Sim | SQL, transação, índice ausente | Existe banco |
| ⬜ **Teste de migration** (com dado existente) | Sim | Migration que quebra em produção | Existe migration |
| ⬜ Teste de componente | Onde há lógica de interação | Estado de UI quebrado | Componente com estado |
| ⬜ E2E do caminho crítico | 3 a 7 fluxos, não mais | Integração entre tudo | Existe usuário final |
| ⬜ Caminho de erro (409, 422, 503, timeout) | Sim | O que só quebra quando dá errado | Sempre que houver erro previsto |
| ⬜ Acessibilidade | Nível alvo declarado | Teclado, foco, contraste, leitor | Interface pública ou corporativa |
| ⬜ Regressão visual | Só em design system estável | CSS que vaza | Design system compartilhado |
| ⬜ Carga / limite | Antes do go-live | Índice ausente, N+1, pool | Volume conhecido |
| ⬜🔴 Segurança: dependências, segredo, estática | Sim, no CI | Segredo commitado, CVE | Sempre |
| ⬜ Smoke pós-deploy | Sim | Deploy que subiu quebrado | Existe deploy |
| ⬜ Cobertura: alvo e onde exigir | Domínio alto; UI sem meta | Falsa sensação | Sempre declarar |
| ✅🔴 Comando único que decide se terminou | `verificar` | — | Sempre |
| ✅ Determinismo: relógio fake, seed fixo, sem rede | Sim | Teste intermitente | Sempre |

> **Não** se exige teste por arquivo. Exige-se verificação por **comportamento importante**.

## Eixo 5 · Segurança, acesso e LGPD — 12

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ⬜🔴 IdP e modelo de sessão | Hello (corporativo) | N7 | Auth caseiro é passivo |
| ⬜ Duração de sessão, refresh, revogação | Declarados | N3 | Sessão eterna |
| ✅🔴 Política de acesso em domínio puro e testável | Sim | N1/N3 | RBAC espalhado em `if` de rota |
| ✅ Entrada externa validada na borda | Sim | N2 | Tipo não existe em runtime |
| ✅🔴 Segredo nunca no repositório nem em log | Cofre + verificação no CI | N4/N5 | Rotação de tudo, e sorte |
| ⬜🔴 Dado pessoal: campos, onde, por quanto tempo | Inventário antes da 1ª gravação | N7 | LGPD — caro depois |
| ✅🔴 Dado pessoal não entra em log | Mascaramento na saída | N1/N3 | Vazamento por observabilidade |
| ⬜ Auditoria: quem fez o quê, quando | Em operação sensível | N3 | Não responde à investigação |
| ⬜ Limite de taxa e abuso | Onde houver borda pública | N3 | — |
| ⬜ Upload: tipo, tamanho, varredura, destino | Declarado | N2 | Vetor clássico |
| ⬜ Cabeçalhos, CORS, CSP | Restritivo por padrão | N3 | — |
| ⬜ Dependências: política e CVE | Verificação semanal no CI | N4 | Dívida silenciosa |

## Eixo 6 · Operação — 10

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ✅🔴 Config validada no boot | Schema no boot | N2 | Erro de env vira bug de meia-noite |
| ⬜ Ambientes e como diferem | Lista explícita | N7 | "Funciona local" |
| ✅ Log estruturado com correlação | Sim | N1/N3 | Log ilegível sob incidente |
| ⬜ Métricas mínimas | Latência, erro, saturação | N7 | Diagnóstico por achismo |
| ⬜ Alerta — **para quem toca o telefone** | Definido com nome | N7 | Erro que ninguém lê |
| ⬜🔴 Deploy: como sobe e como volta | Rollback testado | N7 | Volta improvisada às 23h |
| ⬜ Feature flag | Só onde houver risco real | N7 | Flag eterna é dívida |
| ⬜ Assíncrono: fila, outbox, agendado | Outbox após commit | N1/N3 | Efeito perdido ou duplicado |
| ⬜ Idempotência de consumidor | Obrigatória | N3 | Reprocessamento duplica |
| ⬜ Janela de manutenção e degradação | Declarada | N7 | Expectativa não combinada |

## Eixo 7 · Interface — 11

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ⬜🔴 Biblioteca de componentes, uma só | shadcn/ui + Radix ⚠️ | N6/N7 | Duas bibliotecas é caminho para nenhuma |
| ✅ Componente de terceiro não editado no lugar | Camada própria por cima | N1/N6 | Atualização sobrescreve |
| ✅🔴 Cor literal reprovada; só token semântico | Sim | N1 | Funciona no claro, quebra no escuro |
| ✅ Ícones: uma família só | Lucide | N1 | Duas famílias, dois pesos |
| ✅🔴 Todo componente de dado tem 4 estados | carregando·vazio·erro·com dado | N3/N6 | Tela branca em produção |
| ✅ Componente recebe dado por prop | Sim | N1 | Deixa de ser testável |
| ⬜ Estado de modal e filtro na URL | Validado por schema | N2 | Link não compartilhável |
| ⬜ Formulário: validação vinda do contrato | Mesmo schema das duas pontas | N0 | Regra divergente tela/servidor |
| ⬜ Acessibilidade: nível alvo | Declarado | N3 | Retrofit é caro |
| ⬜ Tema claro/escuro | Ambos verificados | N6/N7 | Metade dos bugs visuais |
| ⬜ i18n | Não, salvo necessidade | N7 | Retrofit caro; adoção prematura também |

> ⚠️ **Contradição a resolver:** o painel diz Radix; o herz usa `@base-ui/react`. O rebar decide **Base UI**.

## Eixo 8 · Trabalho com IA — 15
> O eixo que não existe nos padrões de mercado, e o que decide o custo do ano dois.

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ✅🔴 Instrução sempre presente é curta | < 200 linhas | N6 | Contexto permanente gigante |
| ✅ Regra específica carrega por caminho | Sim | N6 | Outro contexto de 20k |
| ✅🔴 MCP de padrões do próprio projeto | Sim, **gerado do perfil** | N6 | A IA lê o repo inteiro |
| ⬜🔴 MCP de outro projeto nunca vale como norma | Regra explícita | N6 | Custou 5 decisões revertidas no Herz |
| ✅🔴 Protocolo de gambiarra com aprovação humana | Sim | N5/N7 | Gambiarra invisível |
| ✅ Supressão exige justificativa | `any`, `ts-ignore`, teste pulado | N1/N4 | Ninguém sabe se foi erro ou intenção |
| ⬜🔴 Estado de tarefa no repositório | `.ai/` | N4 | Compactar custa caro |
| ⬜ Handoff ao fim de cada tarefa | Automático | N4 | Sessão nova relê a novela |
| ⬜ ADR obrigatório para qual classe | Arquitetura, contrato, banco, segurança | N7 | Decisão vira folclore |
| ✅🔴 Comentar o porquê, nunca o o quê | Sim | N6 | Comentário desatualizado mente |
| ✅ Densidade decidida nos 1ºs arquivos | Fase 2 | N7 | A IA imita o entorno |
| ⬜ JSDoc só na fronteira pública | Sim | N1 | Prosa repetindo assinatura |
| ⬜ Roteamento de modelo por complexidade | Experimento medido | — | Orquestração custando mais |
| ⬜🔴 Telemetria de token e custo por tarefa | Sim | N4 | Otimizar sem medir |
| ✅🔴 "Terminei" = o comando de verificação passou | Sim | N4/N6 | Relato otimista |

## Eixo 9 · Processo e entrega — 8

| Decisão | Padrão da casa | Imposto | Custo de errar |
|---|---|---|---|
| ⬜🔴 CI existe e bloqueia merge | Sim | N4 | ~~"O Herz hoje não tem"~~ ⚠️ **Falso.** `herz/.github/workflows/verificar.yml` roda em push para `main` e em todo PR. O painel está desatualizado e eu copiei sem reverificar |
| ✅ CI = o que `verificar` roda, mais o caro | Sim | N4 | Local e CI divergem |
| ⬜ Branch e PR | PR sempre; sem push direto | N4/N5 | — |
| ⬜🔴 Quando revisão humana é obrigatória | Migration, segurança, contrato, gambiarra | N7 | Revisão vira carimbo |
| ✅ Commit descreve o efeito | Sim, em português | N6 | Histórico inútil como memória |
| ⬜ Versionamento e changelog | Onde houver consumidor externo | N4 | — |
| ⬜ Hook local antes do commit | Rápido: formato e tipo | N5 | Hook lento é hook desligado |
| ⬜ Onboarding | Alvo: um comando | N7 | Conhecimento em uma cabeça só |

---

# 6. Inventário do aplicativo completo

## 6.1 O que o alicerce cobre bem

**Dado pessoal (técnico):** inventário antes da 1ª gravação · retenção e expurgo · mascaramento em log · auditoria · soft delete só por exigência legal · segredo em cofre.

**Operação:** config no boot · ambientes · log com correlação · métricas · alerta com dono nomeado · **health check que checa dependência** (*"saúde que responde 200 fixo mente"*) · smoke pós-deploy · **backup com restauração testada** · rollback testado · feature flag · janela de manutenção · outbox · idempotência · carga antes do go-live.

**Segurança:** cabeçalhos/CORS/CSP · upload declarado · rate limit · cofre + varredura no CI · CVE semanal · IdP · sessão/refresh/revogação · acesso em domínio puro · validação de entrada e de resposta.

**Entrega:** CI que bloqueia · `verificar` único · PR sempre · ramo protegido · revisão humana obrigatória · ADR por divergência · `CLAUDE.md` < 200 linhas · `.ai/` com handoff · MCP gerado do perfil · telemetria de token.

**O catálogo de 13 verificações**, cada uma com a coluna *"o que ela NÃO pega"* — que é o que ninguém escreve:
tipagem · formatação (*"absolutamente nada de correção"*) · estática/fronteiras · unitário · contrato **nos dois sentidos** · integração com banco real (*"mock de banco testa o mock"*) · **migration com dado existente** (*"a mais esquecida do catálogo"*) · componente · E2E 3–7 fluxos · caminho de erro · acessibilidade (*"automática pega talvez metade"*) · regressão visual · carga · segurança · smoke.

**Determinismo:** relógio injetável · `Date.now()` reprovado por lint · seed fixo explícito · rede proibida em unitário · cada teste cria e destrói o próprio dado · esperar por condição, nunca por duração · fuso fixado · quarentena **com prazo e dono**, nunca `skip` seco.

**Sete antipadrões vistos em projeto real:** pedir testes e receber unitário · mock de banco em integração · suíte E2E grande · teste escrito depois pelo mesmo agente que escreveu o código · `skip` sem prazo · CI que roda menos que o dev · **regra automática com falso positivo**.

**Bloco de gambiarra, pronto para virar regex:**
```
// @gambiarra
// motivo: ...
// alternativa-recusada: ...
// remover-quando: ...
// issue: INT-143
// revisao-humana: obrigatória
```

**A tabela "em vez de comentar, suba para":**

| Comentário | Vira |
|---|---|
| "precisa continuar idempotente" | teste que envia o mesmo `commandId` duas vezes |
| "mantenha dentro da transação" | regra `sem-io-externo-no-caso-de-uso` |
| "não normalizar o e-mail" | teste com caso legado real |
| "nunca revele se o e-mail existe" | teste de caminho de erro |
| "componente não busca dado" | regra `componente-nao-busca-dado` |

## 6.2 O que falta — o rebar acrescenta

**Legal e conteúdo público:** termos de uso · política de privacidade · cookies · base legal · canal do titular · DPO · DPA/subprocessador · transferência internacional · exportação de dado do titular.

**Identidade e descoberta:** SEO · `<title>` e description por rota · favicon · `og:image` · sitemap · `robots.txt` · manifest/PWA.

**Ainda ausentes:** LICENSE · README como entregável · CHANGELOG e SemVer · e-mail transacional · notificação ao usuário · página de status · runbook · SLO/SLA · limite de custo de infra · **health check sem linha própria no painel** · **nível de acessibilidade nunca nomeado** (diz "declarado", nunca WCAG A/AA/AAA).

## 6.3 A forense — o que realmente falha nos seis sites

161 commits medidos em Galegos (GAL), decima-edicoes (DEC), navesz.github.io (NAV), openparts (OPP), hug-brasil-propostas (HUG) e constellation (CON).

### O achado central

**Os 3 repos sem CI são exatamente os 3 com lint quebrado agora.**

| repo | CI roda lint? | eslint hoje |
|---|---|---|
| GAL | não | **3 erros, 4 avisos** |
| OPP | não | **35 erros** + prettier falha em 3 arquivos |
| HUG | não | **2 erros, 9 avisos** |
| DEC | sim | gated |
| NAV | sim (build com `tsc`) | não tem eslint |
| CON | sim (lint+tsc+test+audit) | **0 problemas** |

O caso mais eloquente é o **OPP**: único com `AGENTS.md` de verdade (39 linhas, "Hard rules", "Definition of done"), único com `SECURITY.md`/`GOVERNANCE.md`/`CONTRIBUTING.md`, único com prettier, único com um script `check` que encadeia `format:check && lint && typecheck && test:run && build`. **Nada nunca executa esse `check`.**

> **Regra derivada, e é a tese do rebar em uma linha:** regra em markdown tem cumprimento próximo de zero; regra em CI tem 100%. **O scaffold gera o workflow, não o documento.**

### Correção de duas premissas

**1. Não é o Claude — é o Cursor.** A queixa era "colocando o claude como colaborador". Medido:

| agente | commits |
|---|---|
| Cursor | **35** |
| Claude | 6 |
| total com coautoria de IA | 41 de 161 (25,5%) |

O OPP tem 22/22 commits co-assinados pelo Cursor e **zero** do Claude. Trailers com casing diferente: `Co-authored-by: Cursor` vs `Co-Authored-By: Claude`. **Uma regex que só pegue "Claude" cobre 15% do problema.**

**E os 6 do Claude são meus, desta sessão** — aparecem quase todos em commits "Adiciona LICENSE Apache-2.0", que fui eu que fiz hoje. Você tinha razão em levantar isso; eu estava produzindo exatamente o defeito enquanto o catalogava.

**2. Nenhum segredo hardcoded nos seis.** `gh[pousr]_`, `sk-`, `AKIA`, `AIza` — zero ocorrências. Também zero `TODO/FIXME/HACK`, zero `: any`, zero `@ts-ignore`, zero artefato de build versionado. **O desleixo não é de código — é de configuração, contrato e imposição.**

### Ranking por frequência

| # | Falha | Repos | Como detectar |
|---|---|---|---|
| 1 | sem `.editorconfig` | **6/6** | `test -f` |
| 1 | sem dependabot/renovate | **6/6** | `test -f .github/dependabot.yml` |
| 3 | sem `.env.example` mesmo lendo env | **5/6** | grep de `process.env` vs arquivo |
| 3 | sem formatter | **5/6** | prettier em devDeps + script |
| 3 | `AGENTS.md` ausente ou só boilerplate | **5/6** | linhas úteis < 15 ou marcador `BEGIN:nextjs-agent-rules` |
| 3 | URL de produção hardcoded | **5/6** | `git grep -PE 'https?://(?!localhost…)'` |
| 3 | hex cru em vez de token | **5/6** | `comm -12` entre hex do CSS e hex do TS |
| 8 | sem testes | **4/6** | `git ls-files '*.test.*'` |
| 8 | sem script `typecheck` | **4/6** | `package.json.scripts` |
| 8 | idioma misturado no mesmo repo | **4/6** | stopwords PT/EN por arquivo |
| 11 | **sem CI** | **3/6** | `ls .github/workflows/` |
| 11 | **lint quebrado agora** | **3/6** (os mesmos) | `eslint . --max-warnings 0` |
| 11 | `NOTICE` ausente com licença Apache | 3/6 | `grep Apache LICENSE && test -f NOTICE` |
| 16 | coautoria de IA | **41/161 commits** | hook `commit-msg` |
| 17 | identidade git inconsistente | **4 combos** do mesmo dono | `git log --format='%an <%ae>' \| sort -u` |
| 18 | deriva de versão | TS 4 valores · `@types/node` 4 · Next 4 · React 3 · Vite 3 · eslint 3 | job agregador |

### A armadilha do shadcn

**1 de 6 usa shadcn.** E a checagem ingênua reprovaria justamente o certo:

- **GAL usa shadcn corretamente e tem ZERO `@radix-ui`** — está no estilo `base-nova` e importa `@base-ui/react`. Igual ao herz.
- **HUG tem um shadcn falso**: pasta `src/components/ui/` (imita a convenção) sem `components.json`, sem `cn()`, sem `cva`, sem primitiva acessível, com a mesma string Tailwind repetida 4 vezes, e `<label>` **irmão** do `<input>` sem `htmlFor` — bug de acessibilidade, não só de estilo.

> **A checagem correta é `components.json` + (`@radix-ui` **ou** `@base-ui/react`) + `cn()` resolvível pelo alias.** Nunca `@radix-ui` sozinho.

Esse é o retrato exato de "esquecendo do shadcn": a IA reproduz a **aparência** da convenção sem nenhuma das **garantias**.

### Casos individuais que viram fixture de teste

| Caso | Repo |
|---|---|
| Dado pessoal de terceiro entrou num commit, foi removido depois e **continua no histórico** — segredo e PII não se corrigem com commit novo. O commit e os campos ficam fora deste documento de propósito: este repositório é público e o outro também, e apontar o lugar exato seria republicar o dado. Detalhe no privado, com o dono | HUG |
| 623 linhas de catálogo e preço em `.ts`; **zero `process.env` no repo inteiro** | GAL |
| Número de WhatsApp hardcoded em dois formatos; o README documenta o hardcode | GAL |
| Marca em duas grafias — `Galegos` e `Gallegos` — no mesmo app, inclusive no `<title>` | GAL |
| `userScalable: false` + `maximumScale: 1` — viola WCAG 1.4.4 | GAL |
| JSON Schema formal em `packages/schemas/` que **nada no código lê** | OPP |
| 3 libs de animação sobrepostas: gsap + framer-motion + lenis + r3f | DEC |
| `vinext@0.0.50` — pré-1.0, patch 50 — em produção | CON |
| `eslint-config-next 16.2.6` contra `next ^16.3.2` | CON |
| e-mail pessoal (gmail) exposto em autoria de commit | HUG |
| Actions com tag flutuante (`@v4`) em vez de SHA | NAV |

### As três regras que a evidência impõe ao scaffold

1. **Gerar o CI antes de gerar o código.** Correlação 3/3. `AGENTS.md` não impediu 35 erros no repo com mais documento de governança.
2. **Detectar shadcn por `components.json` + primitiva + `cn()`.** Nunca por `@radix-ui`.
3. **Barrar config-como-código no hook, não no review.** O vazamento do HUG passou num commit inicial e o dano no histórico é irreversível. Um `git grep` de telefone no `pre-commit` custaria 40 ms.

## 6.4 Inconsistências do alicerce, a não reproduzir

1. `04-ordem-de-construcao.md:56` diz "117 respostas"; o painel tem **120**.
2. `03-verificacao.md:46` rotula formatação como N1; em `02-quem-impoe.md:33` N1 é análise estática.
3. Não há tabela de correspondência painel ↔ constituição.
4. O painel diz **Radix**; o herz usa **Base UI**.

---

# 7. Arquitetura do rebar

## 7.1 O perfil é o compilador

```
painel (§5, versionado)
   │  respondido uma vez, no create
   ▼
perfil.json  ─── validado contra perfil.esquema.json
   │
   ├─► tsconfig + tipos            (N0)
   ├─► lint + depcruise            (N1)  + os DOIS casos de cada regra
   ├─► schemas Zod de borda e env  (N2)
   ├─► suíte-esqueleto             (N3)
   ├─► workflow de CI              (N4)
   ├─► hooks pre-commit            (N5)
   ├─► CLAUDE.md / AGENTS.md       (N6, < 200 linhas)
   ├─► servidor MCP do projeto     (N6)  ← ver §7.2
   └─► ADR de cada divergência
```

Cada entrada do esquema ganha **nível N0–N7** e **artefato gerado**. É o que transforma o painel de checklist em compilador.

## 7.2 O MCP que se regenera

**O requisito nº 5, e o defeito concreto que o dono viveu.** No Herz e no BMB Compras o MCP funcionou para manter as regras na memória da IA — mas quando as regras mudavam, o MCP continuava servindo a versão velha, e ninguém percebia.

O rebar resolve isso porque o MCP **não é escrito à mão**: ele é um artefato gerado do `perfil.json`, como o `tsconfig` e o lint. E ganha o mesmo tratamento que o herz já dá aos arquivos de instrução com `.ai/gerar.mjs --verificar`:

| Mecanismo | O que faz |
|---|---|
| **Geração** | `rebar gerar` reescreve o servidor MCP a partir do `perfil.json` |
| **Portão de frescor** | `verificar` roda `rebar gerar --verificar`: regenera em memória e compara com o que está em disco. **Divergiu, reprova.** É impossível mudar a regra e esquecer o MCP |
| **Sem `dist` velho** | O MCP roda do fonte, ou o build entra no `verificar`. No herz, `dist` velho é a causa nº 1 de *"o guia não mudou"* (`pcp-herz/CLAUDE.md:147-153`) |
| **Derivado, nunca duplicado** | O MCP não guarda cópia da regra: ele lê o `perfil.json`. Não há duas fontes para divergir |

Isso é o padrão `guias-vs-realidade.test.ts` do herz, generalizado: **derive o fato da fonte e reprove se a cópia divergir.**

### As quatro tools

| Tool | Faz |
|---|---|
| `rebar_verificar` | Roda o portão, devolve achados estruturados. Mesmo comando do hook e do CI — chamar é atalho, não é a barreira |
| `rebar_decidir` | "O que este projeto decidiu sobre X?" — lê `perfil.json`, não prosa |
| `rebar_gerar` | Emite componente/rota/migration na stack **deste** perfil |
| `rebar_porque` | Busca o ADR da divergência |

**O MCP nunca é a porta.** A porta é N0–N5. O MCP do herz tem 17 guias, 1961 linhas, 80 KB, e é comprovadamente ignorável — o próprio repositório admite: *"ferramenta MCP é discricionária, o modelo decide se chama"*. O rebar não repete: nada de guia longo, tudo derivado do perfil sob demanda.

## 7.3 As três camadas de porta

1. **`npm run verificar`** — comando único. Portar `verificar.mjs` do alicerce (294 linhas).
2. **Hook `Stop` do Claude Code** — roda `verificar` ao fim de **cada turno de IA**, não só no commit.

   > ⚠️ **O hook do herz NÃO bloqueia, e eu afirmei o contrário.** O comando é
   > `npm run verificar 2>&1 | tail -25`. Em pipeline POSIX o código de saída é o do **último** comando — `tail` sempre retorna 0. Verificado: `false | tail -25` → exit 0.
   > O guia do herz chama isso de *"não é lembrete: é porta"*; na implementação é literalmente um lembrete.
   > **No rebar:** sem pipe, ou `set -o pipefail`, ou capturar o código antes de formatar. **E uma fixture que prove que o hook reprova** — é a regra dos dois casos aplicada ao próprio portão.

3. **CI com matriz Windows + Linux.** O defeito do `npx` sobreviveu no alicerce porque o CI só roda Linux.

4. **Branch protection.** ⚠️ Não é arquivo, é **estado do GitHub**. `npm create` não entrega isso sozinho — precisa de `gh api` no pós-create ou de um passo humano documentado. Sem isso, metade da dureza prometida não existe.

---

# 8. O que se leva de cada repositório

## 8.1 Do alicerce — como está

`verificar/verificar.mjs` · `segredo/varrer-segredo.mjs` · `elos/verificar-elos.mjs` · `contexto/ai.mjs` · `hooks/` · os **15 presets de fronteira** (web 7 + api 8) com as **29 fixtures** · `ci/verificar.yml` como template.

## 8.2 Do alicerce — consertar ao portar

- `provas/provar.mjs:39-43` → `execFileSync(process.execPath, [require.resolve('dependency-cruiser/bin/dependency-cruise.mjs'), …])`. Desbloqueia três coisas de uma vez.
- `validar-perfil.mjs:25-27` → escrever o esquema real.
- `verificar.config.mjs:12` → trocar `find | xargs` por Node puro.
- `verificar.mjs:124` → distinguir "reprovou" de "quebrou".

## 8.3 Do herz — stack e mecânica

React 19.2 · Vite 8.2 · TypeScript 6 · TanStack Router/Query/Table · Tailwind 4 CSS-first · **shadcn/ui sobre `@base-ui/react`**, style `base-nova` · Zod · react-hook-form · lucide · sonner · cmdk · TS strict com `noUncheckedIndexedAccess`.

Primitivos: `rowVersion` branded · dinheiro como string decimal · `commandId` · Problem Details.

Mecânica: **`.ai/gerar.mjs`** e **`guias-vs-realidade.test.ts`** — ver §7.2.

## 8.4 Do herz — a interface

### A animação não foi escrita à mão

Zero `@keyframes`, zero `framer-motion`. Vem de três coisas, todas reprodutíveis:

1. **`tw-animate-css`** (`index.css:2`)
2. **Data-attributes do Base UI** — `data-open`, `data-closed`, `data-starting-style`, `data-ending-style`, `data-swiping`
3. **`transition-*`** para o contínuo

Padrão de popup, literal em `dialog`, `popover`, `select`, `dropdown-menu`, `tooltip`:
```
duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95
             data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95
```

Drawer, o mais sofisticado (`drawer.tsx:133`) — saída derivada da física do gesto:
```
duration-450 ease-[cubic-bezier(0.22,1,0.36,1)]
data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]
data-swiping:duration-0
```

**Os "botões bem legais"** são `button.tsx:7`: `active:not-aria-[haspopup]:translate-y-px` — afunda 1px ao clicar, exceto quando abre menu — mais `focus-visible:ring-3` e o bloco de cursor de `index.css:198-263`.

### Os 33 componentes são shadcn stock

Zero português, zero import de `@pcp/*`, strings em inglês. **Consequência: o scaffold roda `shadcn add`, não copia arquivo** — assim ganha atualização de graça.

### Genérico, zero domínio — levar

| Bloco | Linhas | Nota |
|---|---|---|
| `components/tabela/` | 1.262 | `TabelaDados<T>` sobre TanStack Table, seis filtros, paginação. Grep por domínio: zero |
| `components/graficos/` | 633 | 9 gráficos + `MolduraGrafico`, que embute os três estados obrigatórios |
| `padroes/estados.tsx` | 118 | Vazio·SemResultado·Erro·Esqueleto, com `role="alert"` e `aria-busy` |
| `padroes/secao-galeria.tsx` | 57 | Moldura de catálogo |
| `index.css` cursor `:198-263` | 66 | **A peça de polimento mais transferível** |
| `main.tsx` providers | 79 | ErrorBoundary › Theme › Query › Tooltip › Router+Toaster |
| `alternar-tema.tsx` | 38 | Troca por CSS, **não por estado** — evita o flash do primeiro quadro |
| `dados/use-comando.ts` | 69 | Hub de mutação: toast, invalidação, 409 com botão "Atualizar" |

### As cinco famílias de cor

`espera` · `execucao` · `bloqueio` · `retrabalho` · `concluido`. Cada uma com `--x`, `--x-fg`, `--x-line`, nos dois temas, e `--chart-1..5` nas mesmas matizes. O **padrão** é generalizável; os **nomes** são de PCP. Renomear.

### Defeitos a não herdar

- `components.json` diz `"baseColor": "neutral"`, mas o CSS é zinc — o próximo `shadcn add` reintroduz cinza.
- `--chart-1..5` declarados **duas vezes**; `--sidebar-*` são tokens mortos.
- `"use client"` em 12 dos 33 arquivos, num Vite sem RSC.
- **Não existe `form.tsx`.** O padrão de formulário é RHF cru repetido — num scaffold isso se perde na primeira tela nova.

## 8.5 Não entra

Domínio PCP inteiro: `packages/dominio/`, contratos `pedido/estoque/estrutura/cotacao`, os 12 componentes de negócio (~1.411 linhas), `features/` (~2.412), `paginas/` (~2.668), `layout/` (406), guias `protheus.md`/`rbac.md`/`bloqueios.md`/`deploy.md`.

---

# 9. Ordem de construção

> ⚠️ **A versão anterior desta seção (7 passos, gerador + 3 presets + MCP) foi descartada pela revisão de escopo.** Motivo em **§9.1**, logo abaixo — e o corte de escopo que o acompanha está em §12.5 item 9. (Antes esta linha apontava para uma §12.9 que nunca existiu: a §12 vai de 12.8 direto para a §13.) O que segue é a versão reduzida.

## 9.1 O que a revisão derrubou

**Passos 1–4 não cabiam numa sessão e não entregavam nada olhável.** Eram 3–4 sessões para "um projeto novo e vazio que passa no lint" — e nenhum dos seis sites existentes ganhava coisa alguma.

**A inversão gerador-primeiro estava errada.** A correção não é *gerar* um projeto — é **checar os que já existem**. Checar é retroativo e idempotente; gerar só serve para o projeto nº 8.

> ⚠️ **Correção de premissa, medida em 30/08.** O diagnóstico original desta seção era *"o alicerce morreu porque a imposição nunca encostou num projeto"*. **É falso.** O `ferramental/` do alicerce está instalado em dois repositórios — o próprio alicerce e o `prumo` — e no `prumo` ele gateia de verdade: `.github/workflows/ci.yml:113` roda `npm run verificar` → `node ferramental/verificar/verificar.mjs`, e a linha 207 roda `node ferramental/portao/provar-portao.mjs`. `prumo/ferramental/` tem 8 diretórios, 7 com o mesmo nome dos do alicerce, e a linha 139 do CI diz que os casos vieram do alicerce upstream. A formulação que a medição sustenta: **o rebar mede 12 repositórios e não impõe em nenhum; o alicerce mede 2 e impõe nos 2.** O problema do alicerce é escala (2 de 12), não contato. A conclusão — consumidor antes do gerador — sobrevive à correção, porque é a escala que o `rebar-check` ataca.

> A inversão certa não é gerador-primeiro. É **consumidor-primeiro: escreva o que lê antes do que escreve.**

## 9.2 A fatia: `rebar-check` — um arquivo, nenhum gerador

Um `.mjs` de ~350 linhas que roda contra **qualquer repositório existente** e imprime um placar:

```
rebar-check · Galegos
  ✗ coautoria-ia          2 commits com Co-Authored-By de IA
  ✓ shadcn                components.json, style=base-nova
  ✗ registry              registries: {} — a casa não tem registry publicado
  ✗ robots.txt            ausente
  ✗ sitemap               ausente
  ✗ politica-privacidade  rota ausente
  ✗ termos-de-uso         rota ausente
  ✗ cor-literal           11 classes de cor crua em .tsx
  ✓ LICENSE               presente
                          4 de 12
```

Por que esta fatia:

1. **Funciona nos seis sites que já existem** — mais prumo, ducado e vectra-painel.
2. **Produz um número no dia 1.** "Galegos: 4 de 12." **Placar é a tela do rebar** — e o preditor abaixo diz que tela é o que sobrevive.
3. Transforma cada achado da forense (§6.3) em **uma linha de código**, não em tarefa de pesquisa.
4. Sem esquema, sem templating, sem CLI, sem presets, sem MCP.
5. **O gerador cai de graça depois.** Um checker que sabe dizer "falta robots.txt" está a um `--corrigir` de ser gerador. A ordem inversa não vale.
6. Distribuição sem npm: `npx github:Navesz/rebar`.

**O preditor que decidiu isto:** dos sete repositórios do dono, **o alicerce é o único sem tela.** ducado, vectra-painel, prumo, decima-edicoes, Galegos, openkartline — todos têm algo para olhar. n=7, mas é 7 de 7. O plano anterior não tinha tela até o passo 3.

A meia-frase "e é o único morto" foi tirada daqui: medido, o alicerce roda no CI do `prumo` (ver a correção de premissa em §9.1). O que a tela prediz é adoção, não sobrevida — e é adoção que o placar do `rebar-check` ataca.

## 9.3 O passo a passo numerado

> Ordem pedida pelo dono. Cada passo tem **critério de pronto verificável**. Nenhum começa antes do anterior fechar.

### Passo 0 · O MCP desta sessão — antes de qualquer código

**Por que primeiro:** o dono identificou que *"a gente não criou um MCP pra essa sessão, então pode ser que você se perca"*. Está certo — e é exatamente o que fez o `bmb-compras` funcionar: ele virou aplicação final boa e funcional porque teve MCP de regras desde o começo, com Composer 2.5.

| | |
|---|---|
| **O quê** | Um MCP que serve **este documento** por seção, mais o registro de decisões (§11), para qualquer sessão futura |
| **Tools** | `rebar_plano(secao)` · `rebar_decidido()` → lê §11 · `rebar_aberto()` → lê §13 |
| **Fonte** | Este arquivo. Nenhuma prosa dentro do servidor |
| **Pronto quando** | Sessão nova responde "o que já foi decidido sobre o banco?" sem ler o arquivo inteiro |

### Passo 1 · Estrutura e Vite

`npm create vite` · pastas · `tsconfig` estrito · shadcn com `style: base-nova` e `baseColor: zinc` · o bloco de cursor do herz · `@fontsource-variable` (nunca CDN de fonte).

**Pronto quando:** `npm run dev` sobe e `tsc --noEmit` passa.

### Passo 2 · O CI, antes das regras

**A evidência manda isto:** 3 de 3 repos sem CI estão com lint quebrado. O `openparts` tem `AGENTS.md` com "Hard rules" e 35 erros.

Workflow em matriz Windows + Linux · `npm run verificar` com **contagem `12/12 passos`** no cabeçalho.

**Pronto quando:** um erro plantado de propósito reprova o PR.

### Passo 3 · O portão de servidor (N4s)

> **O nível que faltava na taxonomia.** Só ele resiste ao agente. Tudo em N0–N5 mora em arquivo que o agente edita; o workflow ele apaga; `core.hooksPath` ele remove **sem diff nenhum**.

Ruleset via `gh api`: status check obrigatório por nome · PR obrigatório · force-push bloqueado · `commit_message_pattern` negando coautoria de IA · `CODEOWNERS` em `perfil.json` e `adr/`.

**Pronto quando:** apagar o `.yml` deixa o PR travado em "expected", não verde.
**Se não der para instalar:** gravar `.rebar/portao-remoto.json: {estado:"ausente"}` e o `verificar` grita enquanto for verdade. **Portão aberto tem que ser fato checado, não omissão.**

### Passo 4 · As primeiras regras — três, não trinta

Cada uma nasce com **os dois casos** e rastreável a uma falha medida na forense (§6.3):

| Regra | Falha que ela pega | Nível |
|---|---|---|
| Coautoria de IA | 41 de 161 commits | N5 + N4 + **N4s** |
| shadcn de verdade | `components.json` + primitiva + `cn()` — nunca `@radix-ui` sozinho | N1 |
| Presença legal/SEO | robots · sitemap · privacidade · termos · `og:image` | N1 |

**Pronto quando:** `provar-portao` planta as três violações e as três reprovam.

### Passo 5 · `rebar-check` nos seis sites

Roda contra Galegos, decima, navesz.github.io, openparts, hug-brasil, constellation. Imprime o placar.

**Pronto quando:** os seis têm nota. É a **tela** do rebar.

### Passo 6 em diante

Só depois: `perfil.json` com catraca · gerador · presets `app`/`api`.

---

## 9.4 Os furos de imposição que mudam o desenho

Verificados no código do alicerce:

| Furo | O quê |
|---|---|
| **`opcional: true`** | Uma palavra num passo do `verificar.config` faz ele **falhar e sair com código 0**. Qualquer portão vira aviso verde |
| **`--passo=`** | Roda 1 de 12 passos e imprime `APROVADO`, sem dizer que 11 não rodaram |
| **`perfil.json` é rota nuclear** | O plano a cria. Trocar `"acessibilidade":"AA"` por `"nenhuma"`, regenerar, e tudo fica **consistente e verde** com o portão removido. Precisa de **catraca**: cada chave com ordem declarada, e descer na ordem só com ADR no mesmo commit |
| **`settings.local.json`** | É ignorado pelo git e **sobrepõe**. Hook vazio ali desliga tudo com zero diff |
| **`PreToolUse` — a maior omissão** | O plano só tem hook `Stop`, que é relatório pós-fato. `PreToolUse` **impede a ação**: nega `git commit --no-verify`, nega escrita em `src/components/ui/**`. É a definição literal de N5, aplicada ao agente em vez de ao git |
| **Coautoria: remover a fonte primeiro** | `"includeCoAuthoredBy": false` no `.claude/settings.json`. A string nunca existe. Zero atrito, zero falso positivo |
| **Nunca varrer o histórico inteiro** | alicerce tem 11 commits com coautoria, herz 17. `git log \| grep` ingênuo deixa todo PR vermelho para sempre |

## 9.5 Falsos positivos medidos — a regra que eu ia enviar e não vou

**"Cor literal reprovada"** parecia a regra N1 mais óbvia da lista. Medida no herz: **7 ocorrências, 5 dentro de comentários que documentam a própria regra**, 1 é `bg-black/10` de véu em código shadcn stock. **Zero verdadeiros positivos.** Uma regra ingênua seria ~100% falso positivo no repositório de referência — a definição exata de *"regra automática errada custa mais que regra ausente"*.

**Segundo:** o varredor de segredo **vai reprovar no dia 1** com Postgres. `postgres://user:senha@host` casa `string-de-conexao`, e a lista de placeholder não tem `senha`, `postgres`, `docker` nem `local`. Colide direto com o critério de aceite do passo 1.

**Política, então:** toda regra nasce `warn` com contador e só vira `error` depois de N commits sem acerto novo. Escape hatch único (`// rebar-<regra>-ok: <motivo>`), contado. **Falso positivo relatado vira arquivo no `aprovar/`** — que já é a suíte de regressão de FP, porque o `provar.mjs` reprova qualquer violação ali.

## 9.6 A simplificação que elimina o apodrecimento de fixture

> **`aprovar` = a saída do gerador. `reprovar` = mutações plantadas nessa saída, num diretório temporário.**

Uma prova nova não cria diretório novo. Se uma regra precisa de app próprio para ser provável, a regra está com a forma errada. Isso conserta de quebra o `provar-portao.mjs`, que hoje escreve e faz `git add` **no repositório vivo**.

## 9.7 Condição de abandono

O dono já escreve cláusula "Reconsider if" nos ADRs do prumo. Aplicada aqui, com data:

| Marco | Critério | Se falhar |
|---|---|---|
| **D+7** | `rebar-check` rodou contra ≥3 repositórios que não são o rebar | **Para.** O M5 do alicerce diz *"falta instalar num projeto real"* desde 12/08 e nunca mudou. É a única diferença mensurável entre os dois projetos |
| **D+30** | ≥2 repositórios com `rebar-check` no CI **reprovando merge**, com link de execução | Vira checklist no `CLAUDE.md` e o repositório é apagado |
| **D+60** | ≥1 checagem disparou contra algo que o dono queria fazer, **e ele consertou o código em vez de desligar a checagem** | A regra estava errada — é o *"regra automática errada custa mais que regra ausente"* |
| **D+90** | Checagens cresceram ≤50% **e** o nº de repositórios usando cresceu | Se checagem cresce e adoção não, virou alicerce. Congela a lista |

**Parada dura:** dois repositórios novos iniciados sem o rebar, em sequência. O dono criou 3 repos em 48 h — este critério dá veredito em dias.

**Não-escopo:** nenhum preset `app` ou `api` antes de o `site` ter sido usado **sem modificação** em dois sites.

---

# 10. Verificação

- **Do próprio rebar:** `verificar` verde em matriz Windows + Linux; `provar-portao` planta um erro por regra e exige reprovação; `rebar gerar --verificar` reprova MCP desatualizado.
- **Do que ele gera:** `npm create rebar` em diretório limpo → `verificar` passa sem edição; depois plantar cada falha da forense e confirmar que o commit é barrado.

---

# 11. Registro de decisões

Toda mudança de rumo entra aqui, datada. Vira `adr/` quando o arquivo virar árvore.

| Data | Decisão | Por quê |
|---|---|---|
| 25/08 | Nome `rebar` | Vergalhão dentro do concreto: imposição invisível. Sequência natural de "alicerce" |
| 25/08 | Repo novo, não construir sobre o alicerce | Pedido do dono |
| 25/08 | Postgres | SQL Server exige licença. E não há migração — o backend do herz nunca existiu |
| 25/08 | Base UI, não Radix | O painel do alicerce diz Radix; o herz **usa** Base UI. Vence a realidade |
| 25/08 | `shadcn add` em vez de copiar componente | Os 33 são stock; copiar congela e perde atualização |
| 25/08 | Portão bloqueia commit **e** CI | Escolha do dono, nível mais duro |
| 25/08 | O gerador é o produto, não o último módulo | Inverte o erro do alicerce, que deixou `base/` vazio |
| 25/08 | MCP com portão de frescor | Defeito vivido no Herz e no BMB: regra mudou, MCP não |
| 25/08 | README e MCP subiram na ordem | Pedido do dono: o MCP é o que impede a IA de ignorar o combinado |
| 25/08 | **Gerar o CI antes do código** | Forense: 3/3 dos repos sem CI estão com lint quebrado. `AGENTS.md` não impediu 35 erros |
| 25/08 | Regex de coautoria cobre **todos** os agentes | Cursor é 6× mais frequente que Claude (35 vs 6), com casing de trailer diferente |
| 25/08 | Detecção de shadcn por `components.json` + primitiva + `cn()` | `@radix-ui` sozinho reprova o único repo que acertou (GAL usa Base UI) |

---

# 12. Revisão — furos encontrados

Primeira passada de revisão adversarial. Tudo abaixo foi **verificado no disco**, não aceito do revisor.

## 12.1 O buraco estrutural: o N1 não tem ferramenta

**O `ferramental/` do alicerce não tem linter nenhum.** `devDependencies` = `dependency-cruiser` + `typescript`. Zero arquivo de config de eslint/oxlint/biome. Todo o N1 que existe é **grafo de import**, e as 29 fixtures são todas de fronteira — **zero fixture de lint**.

Consequência: estas dez linhas do painel dizem N1 e não têm ferramenta, implementação, nem os dois casos que a regra-mãe exige:

> cor literal · `catch` vazio · `Date.now()` solto · supressão com justificativa · JSDoc na fronteira · mascaramento de dado pessoal em log · idioma único · log com correlação · estado global mutável · migration nunca editada

**E a decisão que habilitaria tudo isso — "qual linter, com que capacidade de regra própria" — não existe no painel.** O nível N1 inteiro depende de uma decisão que ninguém tomou. É o item mais urgente do esquema.

## 12.2 O preset `site` não pode usar a stack do herz como está

A stack herdada é Vite + TanStack Router = **SPA**. O buraco que o rebar existe para tapar inclui `<title>`, `og:image` e sitemap.

**WhatsApp, LinkedIn, Slack e Discord não executam JavaScript.** O `og:image` de um SPA simplesmente não funciona — o preview do link vem vazio.

> Ou o preset `site` não é a stack do herz, ou o preset `site` não resolve o problema declarado. **Falta uma decisão 🔴: estratégia de renderização — SPA · SSG · SSR · ilhas.**

## 12.3 A decisão que o painel não tem e que É a queixa original

**Origem do conteúdo: hardcode · MD/MDX no repo · CMS · banco.** É o *"hardcoded"* da queixa do dono, textualmente. O painel não tem uma linha sobre onde mora o texto do site. Sem essa decisão, o gerador produz exatamente o que existe para impedir — como o `menu.ts` de 623 linhas do Galegos.

## 12.4 Três níveis herdados errados, violando a regra-mãe

| Linha | Nível no painel | Deveria ser | Como |
|---|---|---|---|
| Query builder sobre ORM (Kysely) | **N7** | **N1** | "Não importar ORM" é import proibido. Uma linha de depcruise |
| Biblioteca de componentes, uma só | **N6/N7** | **N1** | Proibir `@radix-ui/*`, `@mui/*`. Uma linha |
| Todo componente de dado tem 4 estados | **N3/N6** | **N0** | União discriminada + `switch` exaustivo. **Não compila** sem tratar carregando/vazio/erro/dado |

Num documento cuja tese é *"se pode descer, deve descer"*, herdar esses três sem corrigir é a contradição mais direta possível.

## 12.5 Outras correções

| # | Erro | Correção |
|---|---|---|
| 1 | **Dinheiro contraditório.** §5 Eixo 1 diz *"inteiro em centavos"*; §8.3 leva *"string decimal"* do herz | Escrevi os dois sem notar. Mesma classe do Radix/Base UI, e essa eu não peguei |
| 2 | **`verificar.mjs` em duas listas opostas** — §8.1 "levar como está" e §8.2 "consertar ao portar" | É levar **e** consertar |
| 3 | **Acessibilidade aparece 2× no painel** — linhas 119 e 181 | São **119 decisões distintas**, não 120. Eu corrigi 117→120 e contei linha de tabela, não decisão |
| 4 | **CSRF ausente do painel inteiro** | Tem CORS, tem CSP, não tem CSRF |
| 5 | **Telemetria de token por tarefa em N4** | Nenhum job de CI mede custo por tarefa. É N6/N7 rotulado de N4 |
| 6 | **A métrica de contexto mede a coisa errada** | "< 200 linhas" conta o arquivo sempre-presente. O herz passa com 153 linhas **e serve 1961 linhas de guia por MCP na mesma sessão**. O alvo certo é o pacote de retomada em tokens, que o `contexto/ai.mjs orcamento` já mede |
| 7 | **`shadcn add` escreve em zona sem regra** | `web-camadas.cjs` exclui `^src/components/ui/` da análise. E a prova de que a atualização volta errada já está no doc: `components.json` diz `neutral`, o CSS é zinc |
| 8 | **`.ai/gerar.mjs` é o pipeline inverso** | No herz ele destila prosa → 3 cópias. O rebar quer respostas estruturadas → prosa. Reaproveitar só o "N cópias sincronizadas + `--verificar`" |
| 9 | **§8 passo 1 projeta o esquema de um preset só** | Recortar o núcleo **antes** da fatia vertical, senão o núcleo nasce torto — o mesmo erro do M8 |

## 12.6 O colapso: 120 → ~71 decisões

Dezesseis grupos onde linhas separadas são **a mesma decisão**. Os quatro de maior valor:

| Grupo | Absorve | Vira |
|---|---|---|
| **Fronteira** | Camadas · ferramenta · ciclo · órfão · dado por prop · terceiro não editado · monorepo · zero-Node no contrato · negócio puro · estática | **10 → 1.** Não são 10 decisões: é 1 ("qual preset de fronteira") com 10 regras dentro. O alicerce já entrega como 15 presets + 29 fixtures |
| **Mapa de campo pessoal** | Inventário · não entra em log · retenção · soft delete · auditoria **+ os 9 itens legais faltantes** | **14 → 1.** Um artefato tipado marcando cada campo. Dele derivam o mascarador (N1), o job de expurgo (N3), o endpoint de exportação (**N0 — não compila se um campo novo não foi classificado**) e **a política de privacidade gerada**. O "buraco maior" vira mecânico |
| **Metadado de rota** | Nenhuma hoje — absorve `<title>` · description · `og:image` · canonical · sitemap · `robots.txt` · JSON-LD · 404 · `hreflang` | **9 novas → 1.** **N0**: o tipo da rota exige `meta`. Sitemap e robots passam a ser **gerados, não decididos** |
| **Origem de terceiro** | CORS/CSP + analytics · consentimento · fonte por CDN · vídeo · mapa | **6 → 1.** O CSP e o banner de cookie são **a mesma allowlist vista de dois ângulos** |

Outros doze: token de design · um schema por fronteira · efeito acontece uma vez · tempo/aleatório injetados · escape declarado · um comando · fatura de contexto · localidade · transação · migration · estado de dado · superfície de segurança do CI.

## 12.7 O corte dos presets, em número

| Preset | Das 120 atuais, aplicam | Exclusivas hoje |
|---|---|---|
| `app` | **118** (98%) | 2 |
| `api` | **105** (88%) | 2 |
| `site` | **77** (64%) | **0** |

Os eixos 8 e 9 são **100% núcleo** — 23 linhas iguais em todo preset. O eixo 7 inteiro é N/A para `api`.

> **`site` é o preset pior servido, e é o que o dono constrói.** 36% do painel não se aplica e **nada** ocupa o lugar: zero linha exclusiva em 120. É a §2.3 medida em número.

Depois do colapso e das faltas: `site` ≈ 68 · `app` ≈ 82 · `api` ≈ 64 — e `site` passa a ter o segundo maior conjunto exclusivo (~26).

## 12.8 O que falta e é 🔴

Além das duas de §12.2 e §12.3: estratégia de renderização · origem do conteúdo · onde hospeda · método de autenticação de usuário final · processador de pagamento · **deriva do scaffold** (o projeto gerado sabe de que versão do rebar nasceu, e `rebar doctor` reprova se divergir).

---

# 13. Aberto

| Item | Estado |
|---|---|
| Revisor: completude e o que combina com o quê | Agente rodando |
| Revisor: rigor de imposição e rotas de fuga | Agente rodando |
| Revisor: realismo de escopo e sequência | Agente rodando |
| Corte das 120 decisões entre `site` / `app` / `api` | Não feito |
| Nomes neutros para as cinco famílias de cor | Não decidido |
| Nível WCAG a adotar como padrão da casa | Não decidido |
| Escrever as ~18 checagens da forense como regras com dois casos cada | Não feito — depende do revisor de escopo |
