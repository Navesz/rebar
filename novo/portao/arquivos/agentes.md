<!-- rebar:agentes -->

# {{nome}} — leia antes de escrever qualquer código

## 1. Ligue o MCP antes de tudo

**Antes da primeira linha de código, chame a ferramenta `rebar_regras`.** Ela
devolve o que reprova neste projeto HOJE, derivado da fonte — não há cópia das
regras neste repositório, de propósito: cópia envelhece calada. As outras
respondem o resto: `rebar_porque`, `rebar_decidir`, `rebar_portao` e
`rebar_verificar`.

**Se `rebar_regras` não existir na sua sessão, PARE e diga ao usuário, literalmente:**

> Este projeto declara um servidor MCP em `.mcp.json` e ele não está ativo na
> minha sessão. Sem ele eu escrevo sem as regras do projeto, e você só descobre
> no portão. Ative o servidor `rebar` no seu cliente de IA — no Claude Code:
> reinicie na raiz do projeto, aprove o `.mcp.json` e confira com `/mcp` — e me
> chame de novo. Enquanto isso eu sigo pela régua da linha de comando, que dá o
> mesmo veredito: `npx --yes github:Navesz/rebar .`

O `.mcp.json` já está escrito e aponta para `{{lancador}}`. Não é você que o
cria: é o cliente que precisa carregá-lo, e isso é decisão do usuário, não sua.

## 2. O que quebra se você ignorar

| se você fizer isto | o que acontece de verdade |
| --- | --- |
| escrever telefone, endereço, preço ou URL de produção dentro de `.tsx` | o build passa, o site publica com o dado errado e ninguém é avisado — falha **em silêncio**, já no ar |
| inventar um valor plausível para calar um `TROQUE-…` de `conteudo/site.json` | o build para ali de propósito; valor inventado sobe, parece certo e não entrega pedido nenhum. Pergunte o valor real ao usuário |
| deixar chave, token ou `.env` entrar no commit | `.githooks/pre-commit` barra. Se escapar, não se conserta com commit novo: tem de rotacionar a credencial |
| assinar `Co-authored-by:` com o seu nome | `.githooks/commit-msg` barra antes de o commit existir, e a régua barra depois, no histórico. A allowlist é de **humanos**, em `.rebar-coautores`, e quem a edita é o dono |
| instalar dependência para o que o Next ou o Node já fazem | dependência nova precisa de motivo escrito. Se um built-in resolve, é ele |

## 3. A base, para você não inventar

- **Conteúdo não mora no código.** Texto, telefone, CNPJ, endereço, preço e URL
  vão em `conteudo/*.json`, validados no build — nunca em `.tsx`, nunca em
  variável de ambiente.
- **A pilha já está decidida:** Next 16 App Router com `output: "export"`,
  React 19, Tailwind 4, shadcn no estilo `base-nova` sobre `@base-ui/react`.
  Componente novo vem do `shadcn add`, não escrito à mão.
- **Não instale** Radix, outra biblioteca de UI, de estado, de data ou de
  formulário, nem SDK de MCP: o servidor é o do rebar, por `.mcp.json`.
- **O idioma é português do Brasil**, em código, comentário, nome de arquivo e
  commit. O comentário explica o PORQUÊ, com o número medido quando houver.
- O `README.md` tem a pilha e os comandos. Nenhum markdown daqui guarda regra:
  para saber o que reprova, pergunte ao MCP.

## 4. Antes de dizer que terminou

```sh
npm run verificar   # lint, typecheck, teste e build — o mesmo que o CI roda
```

O MCP é atalho para não errar; **a porta é este comando.** Verde comprado
desligando regra é dívida, não conclusão.

{{bloco-terceiro}}
