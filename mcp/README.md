# mcp — as regras do rebar na memória da IA

O objetivo nº 5 do repositório: **manter o MCP vivo — regra mudou, MCP se regenera, e o portão reprova se estiver velho.** O desenho está em [docs/PLANO.md §7.2](../docs/PLANO.md).

O defeito que ele existe para não repetir, nas palavras do dono: *"No Herz e no BMB Compras eu elaborei um MCP com todas as regras de projeto, pra ele sempre ficar na memória e forçar a ser usadas"* — e *"o MCP não era reescrito quando as regras de projeto foram modificadas"*.

## As três peças

| Peça | Papel |
| --- | --- |
| `ferramental/rebar-check/index.mjs` | **A fonte.** 22 regras, com o porquê medido de cada uma |
| `mcp/gerar.mjs` | **O gerador.** Deriva o artefato da fonte |
| `mcp/regras.gerado.json` | **O artefato.** 79 KB. Não se edita à mão |
| `mcp/src/` | **O servidor.** Lê o artefato. Nunca lê o `index.mjs` |

O que fecha o ciclo é o passo 5 do portão:

```
npm run verificar   →   passo `mcp`   →   node mcp/gerar.mjs --verificar
```

Ele regenera o artefato **em memória** e compara com o disco. Divergiu, reprova. É impossível mudar a regra e esquecer o MCP.

O servidor ainda dá um sinal mais fraco por conta própria: compara o `sha256` que o artefato gravou em `fontes[]` com o hash do arquivo hoje e cola um **AVISO DE FRESCOR** em toda resposta quando a fonte mudou. É um aviso, não um veredito — quem decide é o portão.

## Como o dono liga isso

O Claude Code lê **`.mcp.json` na raiz do projeto**. Crie o arquivo com:

<!-- prova-cliente.mjs lê o bloco abaixo e SOBE o servidor com ele. Se o caminho aqui
     estiver errado, `npm run prova` reprova. O snippet é testado, não prometido. -->

```json
{
  "mcpServers": {
    "rebar": {
      "command": "node",
      "args": ["mcp/src/index.mjs"]
    }
  }
}
```

`node`, nunca `npx`: `npx` no Windows não é executável, e quem chama sem `shell: true` recebe ENOENT — é o defeito que sobreviveu no alicerce porque o CI só rodava Linux.

**Para usar o rebar de dentro de OUTRO projeto** (um site gerado por `rebar novo`, por exemplo), aponte para o checkout do rebar por caminho absoluto:

```json
{
  "mcpServers": {
    "rebar": {
      "command": "node",
      "args": ["C:/Users/voce/Documents/rebar/mcp/src/index.mjs"]
    }
  }
}
```

Barra normal funciona no Windows e evita ter de escapar `\\` no JSON.

Antes do primeiro uso, uma vez: `cd mcp && npm install`. O pacote `mcp/` tem dependência própria (SDK do MCP e zod) e é **separado da raiz de propósito** — a raiz continua com zero dependência, que é o que faz `npx github:Navesz/rebar` rodar sem instalar nada, e o portão de frescor (`gerar.mjs`) também é zero dependência, porque ele roda no `verificar` e não pode exigir `mcp/node_modules`.

Depois de editar o `.mcp.json`, reinicie o Claude Code e confira com `/mcp`.

## As cinco ferramentas

| Ferramenta | Pergunta que ela responde | Quando chamar |
| --- | --- | --- |
| `rebar_regras` | "o que vai me reprovar aqui?" | antes de escrever código |
| `rebar_porque` | "por que isto é regra?" — com o número medido e as provas | quando o portão reprovar e der vontade de contornar |
| `rebar_decidir` | "o projeto já decidiu sobre X?" | antes de propor stack, biblioteca, formato ou processo |
| `rebar_portao` | os 11 passos do `verificar`, o comando de cada um, os códigos de saída | quando o portão reprovar e a mensagem não bastar |
| `rebar_verificar` | roda a régua num caminho e devolve o placar | depois de mexer, antes de dizer que terminou |

**Não existe `rebar_gerar`**, que a §7.2 previa. O gerador do rebar (`novo/index.mjs`) cria um projeto inteiro, roda `shadcn create` e faz o primeiro commit — não é emissor de componente, e uma tool que faz commit contraria a regra da casa de que quem commita é o dono. Tool que promete o que o repositório não faz é a promessa que ninguém confere, exatamente o que o campo `naoDerivado` do artefato existe para registrar.

## O que ele NÃO é

**O MCP nunca é a porta.** A porta é N0–N5: o `npm run verificar`, o hook e o CI. Chamar uma tool daqui é atalho para não errar; nenhuma resposta dela autoriza nada, e um verde do `rebar_verificar` não substitui o portão — que ainda roda formato, elos, segredo, provas e o frescor deste módulo.

Ele também **não serve prosa**. A versão anterior deste servidor devolvia trechos de `docs/PLANO.md` por seção; foi trocada porque prosa copiada é o formato que o Herz provou ignorável (17 guias, 1.961 linhas, 80 KB, e o próprio repositório admitindo que *"ferramenta MCP é discricionária, o modelo decide se chama"*), e porque o plano diz o que o projeto PRETENDE enquanto o artefato diz o que o portão REPROVA hoje. Quando os dois divergem, manda quem reprova. A prosa continua alcançável: as ferramentas devolvem `arquivo:linha` em vez de copiar o texto.

## Provar que roda

```
node mcp/src/prova-cliente.mjs          # handshake, tools/list, 7 chamadas, e o servidor sem artefato
node mcp/src/prova-cliente.mjs --curto  # só o veredito de cada passo
```

O cliente é **zero dependência** — só `node:child_process` e JSON — de propósito: provar o servidor com o mesmo SDK que ele usa faria um defeito do SDK se cancelar dos dois lados. Ele fala JSON-RPC 2.0 em NDJSON no stdio, que é o transporte do MCP (uma mensagem por linha; enquadramento `Content-Length` é LSP, não MCP).

O último passo dele monta uma cópia do servidor numa pasta sem o artefato e confere que o processo **morre com exit 1** dizendo como gerar — em vez de subir e responder "nenhuma regra encontrada", que ensinaria o modelo que o projeto não tem regra.
