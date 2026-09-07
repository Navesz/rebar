<!-- rebar:agentes -->

# {{nome}} — read before writing any code

## 1. Turn the MCP on first

**Before the first line of code, call the `rebar_regras` tool.** It returns what
fails in this project TODAY, derived from the source — there is no copy of the
rules in this repository, on purpose: a copy ages in silence. The others answer
the rest: `rebar_porque`, `rebar_decidir`, `rebar_portao` and `rebar_verificar`.

**If `rebar_regras` does not exist in your session, STOP and tell the user, literally:**

> This project declares an MCP server in `.mcp.json` and it is not active in my
> session. Without it I write without the project's rules, and you only find out
> at the gate. Turn the `rebar` server on in your AI client — in Claude Code:
> restart at the project root, approve the `.mcp.json` and check with `/mcp` —
> and call me again. Meanwhile I go by the command-line ruler, which gives the
> same verdict: `npx --yes github:Navesz/rebar .`

The `.mcp.json` is already written and points to `{{lancador}}`. You are not the
one who creates it: the client has to load it, and that is the user's decision,
not yours.

## 2. What breaks if you ignore this

| if you do this | what actually happens |
| --- | --- |
| write a phone number, address, price or production URL inside a `.tsx` | the build passes, the site publishes with the wrong data and nobody is warned — it fails **in silence**, already live |
| invent a plausible value to silence a `TROQUE-…` in `conteudo/site.json` | the build stops there on purpose; an invented value ships, looks right and delivers no order at all. Ask the user for the real value |
| let a key, token or `.env` into the commit | `.githooks/pre-commit` blocks it. If it escapes, a new commit does not fix it: you have to rotate the credential |
| sign `Co-authored-by:` with your own name | `.githooks/commit-msg` blocks it before the commit exists, and the ruler blocks it afterwards, in the history. The allowlist is of **humans**, in `.rebar-coauthors`, and the owner is the one who edits it |
| install a dependency for what Next or Node already do | a new dependency needs a written reason. If a built-in solves it, it is the built-in |

## 3. The base, so you don't invent one

- **Content does not live in code.** Text, phone, CNPJ, address, price and URL
  go in `conteudo/*.json`, validated at build time — never in `.tsx`, never in
  an environment variable.
- **The stack is already decided:** Next 16 App Router with `output: "export"`,
  React 19, Tailwind 4, shadcn in the `base-nova` style over `@base-ui/react`.
  A new component comes from `shadcn add`, not written by hand.
- **Do not install** Radix, another UI, state, date or form library, nor an MCP
  SDK: the server is rebar's, via `.mcp.json`.
- **The language is Brazilian Portuguese (português do Brasil)**, in code, comment, file
  name and commit. The comment explains the WHY, with the measured number when there is one. <!-- keep "português do Brasil" verbatim: portao.test.mjs matches it -->
- `README.md` has the stack and the commands. No markdown here holds a rule:
  to know what fails, ask the MCP.

## 4. Before you say you are done

```sh
npm run verificar   # lint, typecheck, test and build — the same thing CI runs
```

The MCP is a shortcut to not get it wrong; **the door is this command.** Green
bought by turning a rule off is debt, not completion.

{{bloco-terceiro}}
