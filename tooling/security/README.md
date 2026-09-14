# security — prompt-injection signatures in versioned files

`rebar-security` ([index.mjs](index.mjs)) answers "does this repository have a security flaw?".
Besides the rules distilled from the security inventory, it carries a family of rules that look
for **known prompt-injection signatures in what git versions**: text an agent reads and a
reviewer does not see, and configuration an agent client or an editor acts on by itself.

> **A pass means "no known signature". It never means "free of injection".**
>
> The signature list is public and the attacker moves second: anyone who reads this file can
> write a payload these rules do not know. What they do not catch is in
> [the last section](#what-these-rules-do-not-catch), and that list is longer than this one.

```bash
node tooling/security/index.mjs .                          # the scoreboard
node tooling/security/index.mjs --rule=hidden-unicode .    # one rule
node tooling/security/index.mjs --heuristics --json .      # heuristics fail too
node tooling/security/index.mjs --sugerir-allowlist .      # ready allowlist lines, to edit
```

## The rules

| id | class | level | what a pass says |
|---|---|---|---|
| `hidden-unicode` | deterministic | N4 | no known hidden-Unicode signature in tracked text, file names or commit messages |
| `control-bytes` | deterministic | N4 | no known terminal-control signature in tracked text |
| `agent-config-exec` | deterministic | N4 | no known agent setting that runs a command or widens approval |
| `mcp-server-launch` | deterministic | N4 | every MCP server launch in versioned config is the template or allowlisted |
| `agent-bypass-invocation` | deterministic | N4 | no agent CLI started with its approval switch turned off |
| `ai-workflow-untrusted-input` | deterministic | N4 | no AI agent step in a workflow that outside text reaches with power to act |
| `mcp-ansi-escape` | heuristic | N1 | no escaped terminal control in an MCP server file |

**Why N4 and not a hook.** Nothing runs these rules in a git hook in this phase: they bite in CI
and in rebar's own gate (`security-injection`, `security-self`). A hook is a file the agent can
delete without a diff anyone reviews, which is the same reason `hardcoded-secret` already sits at
N4. A deterministic failure exits `1`; a heuristic failure prints `✗` and changes the exit code
only under `--heuristics`.

**A finding names a position, never the payload.** The terminal, `--json` and the MCP answers are
read by agents, so echoing the matched text would deliver it a second time. Paths, key pointers
and server names go out through [`escaparSaida`](texto-seguro.mjs), which turns every invisible,
control, bidirectional, surrogate and private-use code point into a visible `<U+XXXX>` label.
Free text (commands, URLs, header values) goes out only as `sha256:<12 hex> len:<n>`. A switch is
named by its vendor row, never spelled.

### hidden-unicode

**What it catches.** Code points that render as nothing, or that reorder what renders, in three
places: the decoded text of every tracked file, every tracked path and symlink target, and the
message of every commit reachable from `HEAD`. The fail set is Unicode's
Default_Ignorable_Code_Point from UCD 17.0.0 — 17 ranges, 4,174 code points: zero-width spaces and
joiners, bidirectional marks, embeddings, overrides and isolates, the Hangul fillers, variation
selectors, the byte-order mark and the whole tag block — plus unpaired surrogates. JSON, JSONC,
JSON5, YAML and TOML files and Markdown frontmatter are read a second time with their string
escapes decoded, so a zero-width space written as an escape inside a config string is caught too.
The dialect comes from every name a client opens the file by: a `.mcp.json` symlink to a `.txt`
file is decoded as JSON.

**Why.** An agent reads every code point; a reviewer sees none of these. Invisible characters hid
instructions inside the rule files of two coding agents (Pillar Security, _Rules File Backdoor_,
2025-03-18), and tag characters can carry a whole ASCII sentence that renders as nothing.
Bidirectional controls make the reviewed source differ from the compiled one (_Trojan Source_,
CVE-2021-42574). A Hangul filler is a valid JavaScript identifier that looks like a space
(Certitude, 2021).

**What stays legal**, because real text needs it — rebar's own documents carry 25 emoji variation
selectors after a warning sign, measured on 2026-09-12:

- one variation selector after an Extended_Pictographic base, or after a keycap base that is
  followed by the combining keycap; a second selector in a row fails;
- a zero-width joiner inside an emoji sequence;
- tag characters only inside the three RGI subdivision flags;
- left-to-right, right-to-left and Arabic letter marks on a line that has a right-to-left letter,
  in prose, data and commit messages (a warning in code); the mark itself, an Arabic number sign
  or a vowel mark does not make a line right-to-left;
- embeddings, overrides and isolates only as a warning, in prose, on a balanced line with
  right-to-left script;
- a zero-width space between two Khmer letters, outside agent files and names: Khmer writes no
  spaces and marks word boundaries this way (date-fns' Khmer locale carries 12). Next to only one
  Khmer letter it warns;
- one invisible code point as the whole content of a quoted literal in code, a byte-order mark
  included, only as a warning: a character table or a strip of one code point (152 such literals
  in 21 dependency files);
- in a commit message only, one zero-width space between `@` and a letter or digit: GitHub writes
  it when it quotes release notes into a Dependabot pull request, so nobody is mentioned, and a
  squash merge keeps it in history (measured: all 145 in one honest repository's history);
- a zero-width joiner or non-joiner right after a virama that sits on a letter of the same joining
  script (one nukta between them allowed), in prose, data and commit messages: UTS #39 section
  3.1.1.1 and RFC 5892 allow exactly this context, and the Malayalam chillu written before Unicode
  5.1 and the Bengali khanda ta written before 4.1 end a word this way, before a space or
  punctuation. Code keeps the older verdict, because a joiner is legal inside a JavaScript
  identifier and a word-final one makes a second name that looks like the first.

Agent instruction files and names are judged in strict mode, where only the prose exceptions
Persian, Arabic and the Indic scripts cannot be written without apply, in their narrowest shape: one
zero-width non-joiner or joiner with a letter of the same joining script on each side; one joiner
after a letter and its virama when a letter of that script follows (the Sinhala "Sri"), and one
zero-width joiner between a letter and a virama of one script (the Bengali ya-phalaa after ra, the
Sinhala touching conjuncts);
and one left-to-right, right-to-left or Arabic letter mark, not next to another invisible, on a
line that has a right-to-left letter. A word-final legacy chillu or khanda ta still fails there:
the atomic letters U+0D7A–U+0D7E and U+09CE are the fix. Every other exception, a run of
invisibles and a zero-width space still fail there. A byte-order mark left in the text after decoding (one leading byte-order mark of a file or
of a commit message is consumed) fails everywhere else. The braille blank, the private-use areas,
the interlinear annotation characters and the noncharacters only warn (`⚠`).

The code point sets are literal hex ranges generated from the UCD files, not regex property
escapes: CI runs Node 22 and the local machine Node 24, and a property escape follows each Node's
own Unicode version, so the same blob could pass on one and fail on the other.

**Allowlist keys:** `{arquivo, oid}` for file findings, `{commit}` for message findings. Never
exemptable: tag characters outside the RGI flags; embeddings, overrides and isolates in agent
instruction files or in names; any finding inside the allowlist file itself.

### control-bytes

**What it catches.** Control characters in the decoded text of every tracked file that is not
binary.

- Prose, data, configuration and agent files: every C0 control except TAB and LF, a CR that is not
  part of a CRLF, DEL, and the whole C1 range U+0080–U+009F.
- Code files: only the controls that drive a terminal or erase what was printed — NUL, backspace,
  ESC, and the C1 introducers U+008D, U+0090, U+0098, U+009B and U+009D–U+009F — plus a lone CR
  when the same file also has LF line endings. A file whose endings are all CR gets a nota.
- A NUL in an agent file, or in a file whose extension or name says it must be text.
- String escapes that decode to one of those controls, in JSON, YAML, TOML and frontmatter.
- Tracked paths and symlink targets with any C0, DEL or C1 character, TAB and LF included: a name
  is one field on one line, and `git ls-files` and `git log` print it raw.
- Commit messages reachable from `HEAD`, with the prose set: TAB, LF and CRLF stay legal. A bell,
  vertical tab or form feed in a message is only a nota: none of them hides text, a published commit
  cannot be reworded, and PowerShell leaves them in `-m "..."` where a backtick meets `a`, `v` or
  `f`. NUL, backspace, ESC, a lone CR, DEL and C1 still fail in a message.

**Why.** A terminal obeys a control sequence instead of printing it. Reading a diff, a log or a
file in a terminal, a reviewer can be shown a hidden line, a line rewritten after it was printed,
or a payload coloured invisible, while the agent reads every byte.

**What stays legal.** TAB, LF and CRLF. Bytes that are not valid UTF-8 (a cp1252 file with
Portuguese text, say) are counted in a nota outside agent files and never fail. In prose and data
files only, never in agent files, code, names, commit messages or the allowlist:

- a form feed alone on its line (after LF or at the start, before LF, CRLF or the end). GNU license
  files, Emacs Lisp and Python separate pages this way, and a terminal treats a form feed like a
  line feed. Measured: 90 of the 101 form feeds in the licenses and libraries Git for Windows and
  Python 3.12 install sit alone on their line. A run of them, or one inside a line, still fails;
- a colour sequence (the select-graphic-rendition form, digits and semicolons only, at most 40)
  whose every parameter is one of: reset, bold, dim, italic, underline, reverse, strike-through,
  their resets, the foreground colours red to cyan and their bright forms, and the default
  foreground. That is what a CLI test snapshot or a golden file records. Concealed text (parameter
  8), black, white, grey, bright white, every background colour, 256-colour and true-colour
  selections, colon sub-parameters, cursor movement, erasing and hyperlinks still fail: git pages a
  diff through `less -R`, which passes these sequences raw, and a theme can paint text in its own
  background colour (Solarized Dark's background is bright black, Solarized Light's is bright
  white). Snapshot and golden files are judged by what they hold, never by where they are: a path
  exemption would be a place to hide text an agent opens when a test fails.

When every remaining finding is a bell, vertical tab or form feed, or a C1 control right after a
Latin-1 letter (UTF-8 text decoded twice), the message says so instead of claiming the character
hides text; the verdict is the same. Reverse index (U+008D, what a double-decoded I-acute leaves)
and the sequence introducers after such a letter keep the hiding claim, and the message adds that
the text may have been decoded twice.

**Allowlist keys:** `{arquivo, oid}` for file findings, `{commit}` for message findings. The
expected users are vendored bundles that colour their own output: of 26,321 code files measured
under `node_modules`, 20 carry a raw ESC or C1. Never exemptable: a control in a name, and a finding
inside the allowlist file itself.

### agent-config-exec

**What it catches.** Settings committed to the repository that an agent client or an editor reads
and that make it run a command, send traffic somewhere else, or approve without asking. Files are
matched by path suffix at any depth, including files reached through a symlinked folder, and read
by parsing: strict JSON for Claude Code settings, JSONC for VS Code, Dev Containers and Gemini
CLI, TOML for Codex, YAML for frontmatter.

| Vendor | Files | Fails | Warns (`⚠`, passes) |
|---|---|---|---|
| Claude Code | `.claude/settings.json` and `.claude/settings.local.json`, merged with the local file winning | a helper command that produces credentials, refreshes cloud auth or builds telemetry headers; environment that moves the API endpoint, adds custom headers or a proxy, trusts an extra certificate authority, prefixes every shell command, or moves the config, temp or home directory; a default permission mode that skips prompts; the setting that silences the warning before that mode; an allow rule that grants a whole shell or package runner, or a wildcard that reaches an interpreter's own options or replaces the script it runs (a wildcard after a fixed tracked script stays narrow, and so do these fixed shapes, in Claude Code and Gemini CLI rules: `deno fmt`, `check`, `doc` and `info`; `deno task` with a task name; `pwsh -File` or `powershell -File` with a script, after only `-NoProfile`, `-NoLogo`, `-NonInteractive`, `-Sta`, `-Mta` or a value switch such as `-ExecutionPolicy` (`-NoExit` runs what stdin holds after the script, and Windows PowerShell 5.1 reads an unknown `-SettingsFile` as the start of `-Command`, so both stay broad); `node --run`; and a version or help option first for npm, npx, pnpm, uvx, curl, node, python and bash) | approving every project MCP server; enabling listed servers; plugins and extra marketplaces; the mode that accepts edits without asking; the sandbox turned off, or commands let out of it; hooks; status line and file suggestion commands; a tracked local settings file; a local settings file in a folder spelled with another case, which overrides nothing where the file system tells case apart |
| Claude Code agents, skills and commands | `.claude/agents/`, `.claude/skills/`, `.claude/commands/` | a frontmatter permission mode that skips prompts; a whole-shell tool grant | a narrow tool grant; frontmatter hooks or MCP servers; a skill that runs an inline command together with a shell grant; frontmatter that does not parse |
| Claude Code preview | `.claude/launch.json` | — | every launch, listed by fingerprint |
| VS Code | `.vscode/settings.json`, `.vscode/tasks.json`, `*.code-workspace` (its `settings.mcp.servers` judged as an MCP server map) | automatic approval of every tool; a chat permission default that approves everything; a terminal approval entry that matches every command, an interpreter, or an interpreter with its inline-code switch (a regex is also tried on short probe lines); ignoring the default terminal rules; a URL approval entry that matches every address; a task that runs when the folder opens; allowing automatic tasks; workspace trust turned off; a tool-path setting that points at a tracked file | narrower terminal and URL approval entries |
| Dev Containers | `.devcontainer/devcontainer.json`, `.devcontainer/<folder>/devcontainer.json` one folder deep, `.devcontainer.json` | the VS Code settings it writes into the container (`customizations.vscode.settings`), judged as in `.vscode/settings.json` | lifecycle commands (initialize, on-create, update-content, post-create, post-start, post-attach), listed by fingerprint |
| Cursor | `.cursor/hooks.json`, `.cursor/cli.json` | an allow rule that grants a whole shell | hooks |
| OpenAI Codex | `.codex/config.toml`, `.codex/hooks.json`, `.env` | an approval policy that never asks and the sandbox mode with full access, at the top level or in any profile; the built-in no-sandbox permission profile as the default; a Codex home in `.env` that is relative to the repository | a Codex home that is absolute; the HTTP headers helper; hooks |
| Gemini CLI | `.gemini/settings.json`, `.gemini/.env` | a trusted MCP server; an allowed tool that grants a whole shell | hooks |
| GitHub Copilot, Windsurf | `.github/hooks/*.json`, `.windsurf/hooks.json` | — | hooks |
| Any of them | settings environment, MCP server environment, `.env` | a variable that preloads or audits a library in every process, loads a shell startup file, injects interpreter options, replaces git's SSH or diff program, or runs a prompt command; Node options that preload a module, register a loader or open the inspector | library and module search paths, a Python startup file, an env-file reference, telemetry exporter endpoints and headers |
| Any file | all of the above | a duplicate key at any level, frontmatter included; a file that does not parse; a `.env` stored as an LFS pointer, or rewritten on checkout by a filter other than LFS, a working-tree encoding or archive substitution | — |

A `.env` is read with the grammar of the dotenv loader Gemini CLI uses: `NAME=value` and
`NAME: value`, and values in double quotes, single quotes or backticks, over more than one line.

A finding gated on folder trust says `after trusting the folder`. A key current clients ignore
but older builds honour says `ignored by current clients, honored by older ones; removing it costs
nothing` — a design choice, not a claim that it is exploitable today. A mode that denies whatever
was not pre-approved is stricter than the default and is not reported.

**Why.** Check Point showed code execution and API-token exfiltration from Claude Code project
files (CVE-2025-59536, CVE-2026-21852) and from Codex CLI's project environment file
(CVE-2025-61260). A prompt injection that wrote the automatic-approval setting into the
workspace turned GitHub Copilot in VS Code into a command runner (CVE-2025-53773). Environment
that VS Code's MCP approval dialog did not show let a server preload code (Envade,
CVE-2026-41613).

**Allowlist key:** `{arquivo, ponteiro, sha256}`, where `sha256` is taken over the JSON of the node
at that pointer with its keys sorted. Never exemptable: a duplicate key, a file that does not
parse.

### mcp-server-launch

**What it catches.** Every MCP server launch in a tracked configuration, at any depth: `.mcp.json`,
`.cursor/mcp.json`, `.gemini/settings.json`, `.vscode/mcp.json` (JSONC), `.codex/config.toml`, the
`customizations.vscode.mcp` section of a dev container (`.devcontainer.json`,
`.devcontainer/devcontainer.json` and one folder down, the place the VS Code MCP docs name for
container servers) and the `settings.mcp` section of a `*.code-workspace` file, which VS Code's
resource scanner reads. A dev container or workspace file that never mentions MCP is not a server
configuration here. The `mcp` key of a folder's `.vscode/settings.json` is not read: current VS Code
migrates it only from user settings and never reads it for a folder.
Each launch gets a fingerprint: the sha256 of its canonical JSON, keys sorted, over every field
that decides what starts or where it connects — transport type, command, arguments, environment,
env file, working directory, the URL fields, headers and their helper, OAuth and trust, plus the
client-specific fields that forward environment variables, headers or a bearer token into the
server (Codex) or change its sandbox or development mode (VS Code). An absent field is left out, so
a launch that has none of them keeps the same fingerprint.

A launch passes when it is the one rebar's own generator ships (`new/gate/arquivos/mcp.json`,
read from the running rebar package and never from the target; a vendored checker without that
file accepts nothing implicitly), or when its fingerprint is in the allowlist. Every other launch
fails with labels: `remote-url`, `remote-package`, `shell`, `exec-flag`, `local`.

These fail even with an allowlist entry:

- a file that does not parse, or a duplicate key;
- a variable expansion inside the command;
- a server marked as trusted in Gemini CLI;
- the package that bridges a local client to a remote MCP server, at a version below its
  CVE-2025-6514 fix or with no version at all, also behind an npm alias or as a URL package spec
  (a tarball, archive or repository link) whose version cannot be read;
- a one-shot package runner while the index also tracks a registry override that reaches the
  package it starts, or a folder of dependency executables, global options before the runner's
  subcommand included. An override is npm, Yarn or Bun configuration at the repository root or in
  the folder the server starts in that points away from the public registry, for every package or
  for the scope of the package launched. `.npmrc` is read the way npm's ini parser reads it
  (quoted keys, `key[]` arrays, sections, inline comments), and a key is read as npm expands its
  environment references; only the https spelling of the public registry is the default. A
  `userconfig` or `globalconfig` key is an override whatever it names, because npm then reads the
  registry from that file.

**Why.** In MCPoison (CVE-2025-54136, Check Point) a server config was swapped after it had been
approved in Cursor. In Claude Code's non-interactive modes, project servers connect without
asking. A fingerprint over every field means an allowlisted command cannot quietly gain an
environment variable, a working directory or an env file.

**Output:** `<path>:<line>:<column> server <name> [labels] fingerprint sha256:<64 hex>`. The command
text is never printed; the fingerprint is what goes into the allowlist. Whether a runner fetches a
pinned version is not judged in this phase.

**Allowlist key:** `{arquivo, servidor, sha256}`, with the fingerprint as `sha256`.

### agent-bypass-invocation

**What it catches.** An agent CLI started with its approval switch turned off, in a place where it
runs without a person choosing to run it.

- **Strong switches**, caught on their own: Claude Code's switch that skips every permission prompt,
  and its permission mode set to bypass; Codex's switch that bypasses both approvals and the
  sandbox; the Amazon Q Developer and Kiro switch that trusts every tool; GitHub Copilot CLI's
  switches that allow every tool and every path; the Claude Agent SDK options that set the bypass
  mode or allow it.
- **Weak**, a warning only: Claude Code's switch that merely allows the skip to be turned on later.
- **Ambiguous switches**, counted only next to the CLI's own name in the same shell command, or
  within three lines in code: the modes of Gemini CLI and Qwen Code that approve every action;
  Codex's options that never ask and that open the sandbox fully; the trust option of Amazon Q and
  Kiro chat; Cursor CLI's options that force, approve every MCP server, or turn its sandbox off;
  Copilot CLI's options that allow everything; Aider's option that answers yes to every question.
- **Config overrides:** Codex's `-c` and `--config` override of the sandbox key or the default
  permission profile set to no sandbox, under a profile too, is the same hole as the switch and is
  matched like an ambiguous switch, with the value glued to `-c` and blanks before the key too
  (clap takes the glued form and Codex trims the key). The override of the approval policy to its never-ask value is
  not counted: Codex's config reference recommends it for non-interactive runs and `exec` has no
  approval option; over 1,590 fetched repositories that row only failed one skill file documenting
  it, while the sandbox rows added 14 warnings and no failure.
- **Vendor action inputs:** the official GitHub Actions take the setting as an input, and each
  input is rebuilt into the command the action runs. `openai/codex-action` with its no-sandbox
  value in `sandbox` or `permission-profile`, or the bypass switch or its short alias in
  `codex-args` when no profile is set and neither the sandbox nor the safety strategy is
  read-only (the action throws otherwise); `anthropics/claude-code-action` and both base actions
  with a `settings` JSON, or an inline JSON `--settings` inside `claude_args`, whose default
  permission mode bypasses prompts. Sandbox and approval
  switches and config overrides inside `codex-args` are not counted: the action appends its own
  sandbox choice after them and rejects those config roots under every strategy but unsafe. The
  unsafe strategy itself is judged by `ai-workflow-untrusted-input`. In a workflow these fail, in a
  gh-aw lock file and in an `action.yml` they warn. Measured on 1,660 workflows of agent adopters:
  22 files turn the Codex sandbox off through the input, 1 turns Claude's prompts off.
- **Never counted:** Codex's sandboxed automatic mode, non-interactive and print modes, and the
  name of an environment variable on its own.

| Where the switch is | Verdict |
|---|---|
| npm lifecycle scripts (install, prepare, pack and publish hooks) and the tracked files they run, one level deep | fails |
| git hooks: anything under `.husky/` or `.githooks/`, a hook-named file inside a `hooks` folder, and the hook commands `simple-git-hooks` and husky before v5 keep in `package.json`; the tracked files and the package scripts they start, also with runner options before or after `run` (`--silent`, `--prefix`, a workspace or filter by folder or package name, pnpm's workspace root), a runner called by full path, and a runner behind another command | fails |
| commands that run by themselves: tasks that run when the folder opens, dev container lifecycle commands, agent hook commands; the tracked files and the package scripts they start | fails |
| agent instruction files, fenced code included | fails |
| GitHub workflows, whatever triggers them, except GitHub Agentic Workflows lock files (a `.lock.yml` with gh-aw's header and its `activation` and `agent` jobs, the agent needing the activation; the header alone is no lock) | fails |
| GitHub Agentic Workflows lock files, other package scripts, code, fenced code in other Markdown, unknown extensions | warns |
| prose outside fences in Markdown that is not an agent file | nothing |

Quotes are read the way a shell reads them: a separator inside quotes does not end the command, a
quoted prompt is one argument whose dashed words are no one-letter switch, and a string that holds
the whole command (a code call, a JSON value, a Markdown code span) is read as a command in turn.
Which characters quote and escape follows the shell that runs the line: PowerShell (`.ps1` files,
a PowerShell shebang, a workflow step whose shell is pwsh or powershell, and a step on a Windows
runner with no shell) escapes with the backtick and keeps a backslash literal; a POSIX shell (shell
scripts, git hooks, package scripts, workflow steps on other runners) reads `$'...'` as a quote with
backslash escapes and a backtick as command substitution, whose words are arguments; only Markdown,
code and data keep the backtick as a quote. Where the shell depends on the machine (a workflow
runner given by an expression, a folder-open task, an agent hook command), both shell readings run
and either one can find the switch.
The files a script runs include the module a Node preload option loads, next to the entry, and a
redirection written against the file name does not hide the file. The value of a shell's `-o`,
`-O` and rc-file options is not the script it runs. After an option this rule does not know, the
word that follows may be its value, so the word after it counts only when it names a tracked
program for that interpreter (for a shell, a file with no extension counts too).

A command continued on the next line with a trailing backslash, and a folded or multi-line scalar
in a YAML file, is read as the one command the shell runs, so splitting the CLI name and its switch
across lines changes nothing, and neither does a redirection or background operator written right
after the switch. A switch is also matched the way the CLI's own parser accepts it: a one-letter
switch inside a group of short options, the camelCase spelling of a dashed option for the CLIs
built on yargs (Gemini CLI, Qwen Code), and any unique prefix of Aider's option. Comments in code are stripped first, so a switch written in a comment
is not an invocation. Every other non-binary blob is read as raw text, whatever its extension, and
so is every member of a `package.json` outside its scripts. A workflow that only runs on push or on
a schedule still fails: who can trigger a workflow, and what an agent in it can act with, is
`ai-workflow-untrusted-input`'s question.

**Why.** Amazon Q Developer for VS Code 1.84.0 shipped code that started the agent CLI with every
tool trusted (CVE-2025-8217), and the Nx "s1ngularity" packages called the agent CLIs installed on
the machine with approval turned off. Vendors rename these switches between releases, so every row
of the table carries the date it was last verified.

**Allowlist key:** `{arquivo, oid}`.

### ai-workflow-untrusted-input

**What it catches.** A step of a GitHub workflow that starts an AI agent, on a trigger any
account can fire, whose actor check is absent or opened by an input, when the agent holds power to
act. The agent reads the issue, comment or pull request that started it, and whoever wrote that
text steers it.

- **Agents.** `anthropics/claude-code-action`, its base action and `claude-code-base-action`,
  `anthropics/claude-code-security-review`, `google-github-actions/run-gemini-cli`,
  `openai/codex-action`, `actions/ai-inference` (v1 and v2 send the prompt to GitHub Models and
  can hand the model the GitHub MCP tools; v3 goes through the Copilot CLI) and OpenCode's GitHub
  action, each with the inputs and outputs its `action.yml` declares, its `uses` split the way the
  runner splits it (backslashes, doubled slashes and `.` parts name the same folder); and a `run:`
  step whose shell command starts an agent CLI, read the way `agent-bypass-invocation` names CLIs,
  inside a command substitution, a shell's `-c` string, `eval`, and a here-document a shell reads,
  and behind `sudo`, `env`, `timeout`, `nohup`, `time`, `exec`, `xargs`, `nice`, `setsid` and the
  package runners too. The body of a here-document another program reads is data, and the Copilot
  name followed by one of AWS Copilot's or GitHub Copilot CLI's commands that open no session is
  no agent.
- **Triggers.** `issues`, `issue_comment`, `discussion`, `discussion_comment`,
  `pull_request_target`, `pull_request_review`, `pull_request_review_comment` and
  `workflow_run`, narrowed by the activity types each declares to the ones an account with no
  role can cause (`pull_request_target` defaults to opened, synchronize and reopened). A fork's
  `pull_request` gets no secret and a read-only token, and the others need write access, so they
  never count. A `workflow_run` counts unless every workflow it names resolves to tracked
  workflows (by `name:`, or by path when a workflow has none) whose own triggers include no
  outside trigger, no `pull_request` and no `workflow_run`.
- **Actor checks.** claude-code-action and codex-action run only for accounts with write access;
  `allowed_non_write_users` (with a `github_token`, as its docs require), `allowed_bots` and
  `allow-users` open that check when they hold `*` or an expression. A named list keeps it
  closed. OpenCode's check has no input to open it.
- **Conditions.** The job `if`, the `if` of every job it needs, and the step `if` are evaluated per
  trigger in three values. A job `if` that calls a status function in any letter case (`always`,
  `success`, `failure`, `cancelled`) is kept as written, the way the runner keeps it, and its
  `success()` is false when a job it needs is closed. False comes from the event name, the inputs
  context (null outside dispatch and call), the association of the account that fired that trigger
  compared only with owner, member or collaborator, its login against a literal or a JSON list, a
  fork check on `pull_request_target`, an activity type that account cannot cause, and a
  repository or owner literal that differs from the clone's origin remote (a copy or fork of
  another project's workflow never runs that job). Anything else, a job or step output included,
  is unknown and keeps the step reachable.
- **Event text** it interpolates (a title, body, comment, branch name or commit message, or a whole
  event object turned into text) is reported, never required: 11 of 13 vendor examples on these
  triggers interpolate none, because the agent loads the text by itself.

| What the agent can do | Verdict |
|---|---|
| run commands: a whole-shell tool grant (in the action inputs or on the CLI's own command line), approvals or the sandbox off, settings that approve every tool call (the `settings` input or an inline `--settings`), Gemini's approve-everything mode with no tool list or with a shell tool that only a scoped exclusion narrows, the Codex unsafe strategy, an agent CLI whose shell line interpolates event text, or its text output spliced into a later `run:` or `actions/github-script` step (dot or bracket spelling, or through an `env` key the script expands in an expression) | fails, at any permission level |
| nothing the vendor lets it reach: ai-inference with no tool and no GitHub MCP, run-gemini-cli with an empty core tool list and no MCP server or extension, codex-action in its sandbox with sudo dropped | warns, whatever the job holds |
| anything else, which reads its own environment and workspace | fails with a write scope other than issues, pull requests, discussions, models, copilot requests and id-token, with no permissions block, with a secret other than its model credential or all of them, with a personal token given to the agent, or with the vendor App token claude-code-action and OpenCode trade the OIDC token for; warns otherwise |

Codex's read-only strategy runs the agent as a user that likely keeps sudo, which the action says
could read its API key from memory, so it is not contained; the action refuses a Windows runner
unless the strategy is unsafe, which is counted. `id-token: write` alone is no capability: using it
takes a call with the runner token, which is execution, and the Anthropic template ships it for its
own OIDC exchange.

Local resolution goes one level down: a job that calls `./.github/workflows/<file>` is judged with
the caller's triggers, conditions, permissions and inherited or mapped secrets, and the callee's
inputs carry the caller's event text; a step that uses a local composite action is judged as steps
of the calling job, through a tracked folder link too (the finding names the file the link ends
at), and a link that resolves nowhere is named in a note. A deeper local call is named in a note.
YAML anchors and aliases are read, and so is a plain scalar a flow list wraps over lines. A gh-aw
lock file, known by its `.lock.yml` name, header and `activation` and `agent` jobs, is never judged
step by step: it warns when the role-check env of the jobs its agent needs admits every account. A
workflow in YAML this reader does not support fails when its text names an agent action or CLI
anywhere (behind an anchor, in a flow step, on a folded line), and is a note otherwise; invalid
YAML, which GitHub does not run either, is a note. Measured over 2,987 distinct workflow texts of
both corpora, this reader and js-yaml refuse the same 9 files, and all 9 name an agent: failing
invalid YAML would fail 9 files GitHub never runs.

**Why.** PromptPwnd (Aikido, 2025-12-04) steered the Gemini CLI in Google's own triage workflows
with a new issue. Clinejection (Adnan Khan, 2026-02-09) led Claude Code, running with a shell grant
on an issue trigger, from an issue title to a poisoned Actions cache that reached release tokens.
Comment and Control (2026-04-15) did it from a comment.

**Measured** with this engine on 2026-09-13: over 1,660 workflows of 1,394 agent adopters, with
each repository's own name as its origin, 124 files fail (150 steps, 126 of them with execution or
code injection) and 140 warn; read with no origin, as a clone without a remote is, 142 files fail
(170 steps, 146 with execution) and 166 warn, and the 18 files and 20 steps between the two are
copies of Gemini CLI's own triage workflows gated on its repository name. Over 1,571 workflows of 49
well-known repositories, 3 files fail (two of Google's Gemini triage workflows, and a Copilot CLI
with every tool allowed after a pull request's CI) and 11 warn; over the 29 workflows of 24 local
repositories, the rebar worktree and the gate template, none. The prototype the owner decisions
were taken on counted 130 failing steps over the same 1,660.

**Output:** `<path>:<line>:<column> job <id> step <n> (<agent>): outside text reaches it through
<triggers> (<actor check>); interpolates <fields>; it can act through <reasons>`. Secret names are
never printed.

**Allowlist key:** `{arquivo, oid}`. A finding is exempt only when every file it depends on has an
entry: the workflow, the reusable workflow or composite action it resolved, and the `workflow_run`
upstream that made it reachable.

### mcp-ansi-escape

**What it catches.** An escaped terminal control — ESC or CSI written as a hex, Unicode, octal,
HTML-entity or character-code escape, or built in Go by a rune or byte conversion, a byte slice
literal or a `%c` verb of its number — in the code, comments stripped, of a file that looks like
an MCP server (it imports the TypeScript, Python or Go SDK, builds a server object or registers
tools; the official Go SDK import counts only in a file with server-side code, because the same
package serves clients: the bare import made 2 of 5 public Go client files that print colour fail,
and the narrowed marker selects none of them and 143 of 200 go-sdk files of a code search) or that a tracked
MCP configuration launches. A launch's files are found the way `mcp-server-launch` finds them: a
command written as one string and a shell wrapper's inner command are split into words.

**Why.** A tool description or a tool result reaches the model whole, while the person watching
the client in a terminal sees what the control sequence left on screen. Descriptions act before
any tool is called (Trail of Bits, _Jumping the line_, 2025-04-21).

**Why it is a heuristic.** A server that colours its own logs has the same spelling, and evading
the rule takes one arithmetic step: a computed code point, or the escape moved into an imported
module with no server marker. rebar runs it with `--heuristics` on itself.

**Allowlist key:** `{arquivo, oid}`.

## The allowlist

One file, `.rebar-injection-allowlist`, at the repository root: JSON Lines, one object per line,
with `#` comments and blank lines allowed. It is **read from the index**, like everything else. A
copy on disk that git does not track is ignored and reported in a nota: rebar's own commit-message
hook once read its co-author allowlist from disk, and authorized a co-author through a file nobody
had committed (the `commit-msg` step in [verify.config.mjs](../../verify.config.mjs) tells it).

Each line is `{regra, motivo}` plus exactly one key shape:

| Shape | Rules | What the key is |
|---|---|---|
| `{arquivo, oid}` | `hidden-unicode`, `control-bytes`, `agent-bypass-invocation`, `ai-workflow-untrusted-input`, `mcp-ansi-escape` | the path and the blob id of its content, as `git ls-files -s <path>` prints it |
| `{commit}` | `hidden-unicode`, `control-bytes` | the id of the commit whose message carries the finding |
| `{arquivo, ponteiro, sha256}` | `agent-config-exec` | the path, the JSON Pointer of the key, and the sha256 of that node serialized with sorted keys |
| `{arquivo, servidor, sha256}` | `mcp-server-launch` | the path, the server name, and the launch fingerprint the finding prints |

`motivo` is 1 to 200 characters. There are no globs and no path prefixes: every key names
content, so an exemption ends the moment the content changes, and stale entries are counted in a
nota. The hashes below are placeholders.

```text
# a vendored bundle that colours its own CLI output
{"regra":"control-bytes","arquivo":"vendor/cli.min.js","oid":"0000000000000000000000000000000000000000","motivo":"vendored bundle, reviewed on update"}
{"regra":"hidden-unicode","commit":"0000000000000000000000000000000000000000","motivo":"message pasted from a chat client before this rule existed"}
{"regra":"agent-config-exec","arquivo":".vscode/settings.json","ponteiro":"/<pointer from the finding>","sha256":"0000000000000000000000000000000000000000000000000000000000000000","motivo":"team editor setting, reviewed"}
{"regra":"mcp-server-launch","arquivo":".mcp.json","servidor":"docs","sha256":"0000000000000000000000000000000000000000000000000000000000000000","motivo":"internal docs server, reviewed"}
```

- A malformed line makes **every** injection rule fail, and that failure cannot be exempted.
- A finding inside the allowlist file itself cannot be exempted.
- When the file is tracked, has at least one entry in use, and no tracked `CODEOWNERS` (at the root,
  in `.github/` or in `docs/`) covers it, a nota says so. Without an entry in use the line would be
  noise nobody acts on.
- **The checker cannot protect this file.** An agent committing under the owner's identity can add
  its own line. Only a ruleset that requires a second person's review closes that, and it lives
  outside the gate, at N4s.

### Writing the lines: `--sugerir-allowlist`

`node tooling/security/index.mjs --sugerir-allowlist <repository>` runs the six injection rules
(or the one `--rule=` names) and prints, for every finding an entry can exempt, the line that
would exempt it, with the exact key that rule compares. It takes one repository and no `--json`
(exit `2`), and prints nothing but a message when a rule breaks (exit `127`). The keys are
written as JSON, so a path with an invisible character comes out as a JSON unicode escape the
reader decodes back; the output is otherwise the path, the JSON Pointer and the server name
verbatim, which is why the option is not offered through the MCP server. A key longer than 4096
characters (Linux's PATH_MAX) is counted in the first line, not printed. A key the allowlist
already holds is left out, and a finding no entry can exempt is never listed: run the scoreboard
again after adding the lines. Placeholder hashes below:

```text
# 2 line(s) for .rebar-injection-allowlist. Replace every motivo before committing: the reader refuses the placeholder. Findings no entry can exempt are not listed; run the scoreboard again after adding them.
{"regra":"control-bytes","arquivo":"vendor/cli.min.js","oid":"0000000000000000000000000000000000000000","motivo":"TODO: write why a person accepted this finding"}
{"regra":"mcp-server-launch","arquivo":".mcp.json","servidor":"docs","sha256":"0000000000000000000000000000000000000000000000000000000000000000","motivo":"TODO: write why a person accepted this finding"}
```

**The reader refuses that motivo.** A line whose motivo contains the placeholder, whatever its
spacing, punctuation or case, is a malformed line, and every injection rule fails on it until a
person writes why the finding was accepted. A fixed placeholder says why nobody accepted anything.

## What reads what

- **The index, not the disk.** Every rule reads the stage-0 entries of the git index as blobs. In
  CI, after checkout, the index equals `HEAD`; on your machine, an edit you have not staged is not
  judged yet. An unmerged entry makes the rule break (exit `127`) instead of guessing which side
  counts.
- **Every tracked entry**, whatever its extension. A symlink target is scanned as a name and also
  resolved, up to 8 hops; a folder symlink mounts what is behind it, so settings behind a linked
  agent folder are judged. A link on an agent path that points outside the repository, or at
  nothing, fails.
- **Every commit message in history.** Every commit reachable from `HEAD`, raw, with no range and
  no trim. Measured on 2026-09-12: 0 candidates in the histories of rebar and of four other
  repositories.
- **No exemption by location.** `.rebarignore` is not honoured, and neither are proof-case folders,
  template folders or any path list. rebar's own sources, its proofs, this file and the generated
  MCP artifact are judged by the same rules; the proof cases carry their payloads as base64 and
  write them into a temporary git index. A path exemption is a place to hide.
- **Git itself is held down**: replacement objects disabled, optional locks and fsmonitor off, path
  quoting off, stderr captured and never printed.
- **Decoding** goes by the byte-order mark (UTF-8, UTF-16 and UTF-32 in both byte orders), then
  strict UTF-8, then a lenient pass that is reported. A file with no UTF-16 or UTF-32 mark is
  binary and skipped when its first 8,000 bytes hold a NUL, or are not UTF-8 and at least a fifth
  of them decode to replacement or control characters (a small compressed or encrypted blob often
  holds no NUL; Latin-1 text sits near 0.3%), unless it is an agent file or its extension or name
  says it must be text.
- **Size.** The first 8 MiB of a blob are read; a longer one is named in a nota.
- **Agent instruction files** (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, the other names agent clients
  load, their rule, agent, skill and command folders, and the files they import up to five levels
  deep) are held to more. A missing blob, a cut at 8 MiB, an LFS pointer, a NUL, invalid UTF-8, a
  clean or smudge filter, a no-diff or generated attribute, a working-tree encoding (checkout
  writes other bytes than the index holds) or archive substitution, a symlink that leaves the
  repository, including one found behind a linked folder, or a path that collides with another one
  by case makes `hidden-unicode` and `control-bytes` fail: in each of those, what the agent reads is
  not what was judged.
- **Attributes and pointers of every file.** The attributes are read for every tracked file, not
  only agent files: a `.env` or `package.json` re-encoded on checkout is also read as checkout
  writes it. An LFS pointer is recognised by any version line git-lfs accepts, the two legacy
  ones included.

## What these rules do not catch

Saying where the limit is is worth more than pretending to check.

| Not caught | Why | Where the defence lives |
|---|---|---|
| A visible, plausible instruction in prose | it cannot be told apart from documentation without a model; the Gemini CLI case sat inside the licence text of a README | the agent harness, human review |
| Payloads in issues, pull requests, comments, web pages, e-mail, PR titles and bodies | they are not versioned files | the harness: treat them as untrusted data, least privilege |
| A remote server's tool descriptions, and a description swapped after it was approved | served at run time, never committed | the MCP client: pin by hash, an MCP scanner |
| Line jumping and sampling abuse | a property of the protocol at run time | the MCP client |
| A toxic flow between tools (the GitHub MCP case, 2025-05-26) | it depends on which tools were granted, not on a file | one repository per session, the Rule of Two |
| Encoded payloads: base64, rot13, hex | lockfiles and assets are full of high-entropy text; the false positives would be prohibitive | a classifier, outside the gate |
| Escaped forms in JavaScript and TypeScript source that build an invisible or a control character at run time | only JSON, YAML, TOML and frontmatter escapes are decoded; `mcp-ansi-escape` looks only at MCP server files | review; sanitizing output at run time |
| Strings built at run time: concatenation, variables, a computed code point, a switch kept in a variable | a static rule sees literals; rebar builds its own vocabulary exactly this way so it does not accuse itself | defence in depth; the rules promise only "no known signature" |
| A payload split across files | every fragment is harmless on its own | no reliable static defence |
| Text inside an image | it would take OCR | the rules see only the text that points at it |
| Exfiltration through a legitimate destination: an image proxy, the vendor's API, DNS | the destination is allowed | egress filtered by content, not by host |
| A forged approval dialog, approval fatigue | it happens on screen | process; a classifier as an extra layer |
| Submodule content | a gitlink is counted in a nota, not read | run the ruler inside the submodule's own repository |
| Content past 8 MiB in one blob | not read; the nota names the file | review, or split the file |
| UTF-16 without a byte-order mark outside files that must be text | it looks binary and is skipped | keep instruction and config files in UTF-8 |
| A raw 0x9B byte in a Latin-1 file | it decodes to a replacement character; flagging raw 0x80–0x9F would fail cp1252 Portuguese text | a UTF-8 terminal locale |
| Escapes in a YAML double-quoted scalar written on the same line as a document marker; escapes in notebooks and terminal recordings | the YAML escape reader follows where a scalar may start, multi-line and flow collections included, and the frontmatter reader refuses content on a document marker line; notebooks and recordings are not decoded, on purpose | review |
| Impostor commits: a fork's commit served under the parent repository's name | a pinned id cannot be proven offline to belong to the repository it names | pin verification, a later phase |
| Client configuration outside the repository: settings in the home folder, installed extensions, global settings, gitignored local instruction and settings files, direnv | not versioned | the user's machine |
| A commit made with git's hook-skipping option, and everything that ran locally before the push | the hook can be removed, and local execution does not wait for CI | a ruleset with a required check (N4s); a local sandbox |
| An allowlist line written by an agent under the owner's identity | the checker cannot tell who wrote a line | a ruleset that requires a second person's review |
| Annotated tag messages, git notes, branch and ref names | the rules read the index and commit messages only | review |
| A local MCP server script that changes its code while its launch stays the same | the fingerprint covers the launch, not the script it starts | file integrity, a later phase |
| A switch whose value is attached to its short option or grouped with other short options, where the CLI's parser allows it, other than Codex's `-c` | a value switch is matched only as a separate word or with `=`; the attached and grouped forms were not measured against each vendor parser | review; a later phase |
| Agent CLIs that approve by default and need no switch, a CLI whose binary name is too generic to match, a switch that only exists on a tag or in something downloaded at build time | there is no trace in the tree | pin dependencies; review release artifacts |
| Low-capacity channels the exceptions leave open: one joiner between letters of a joining script, one joiner after a virama, a form feed alone on its line, a variation selector after a Han character, alternating emoji selectors | real text needs those exceptions | a warning at most |
| Colour a terminal theme can match: the visible set assumes no theme paints its background red, green, yellow, blue, magenta or cyan | those six are what test snapshots record; no theme with such a background was looked for | review in a web diff, which shows the sequence as text |
| Colour a word-colour diff uses as its only marker: red and green in `git diff --word-diff=color` can make added text look removed in a terminal review | a snapshot records exactly those colours, so excluding them would undo the snapshot exemption; not measured | review in a web diff, which shows the sequence as text |
| A package script started through a workspace glob, a recursive run over every workspace, or a runner named by a variable | the rule follows a script name to the package a folder, a workspace or a package name selects, one at a time | review of the hook |
| Cursor permission rules in the narrow shapes Claude Code and Gemini CLI rules get (a fixed `deno` subcommand, `pwsh -File`, `node --run`, a version option) | Cursor's command-base matching was not measured, so its rules keep the older, broader reading | review |
| Homoglyphs and confusable identifiers | they need a confusables table and a measured false-positive rate | a heuristic, a later phase |
| A reusable workflow called from another repository | it is not in the index | review the called workflow; pin it by commit |
| A gate that lives in a job or step output, or in an earlier step that fails the job for an account without write access | the output is only known at run time, so the step counts as reachable: copies of Google's dispatch and plan-execute example fail, and so do workflows that check permissions in a script | an allowlist entry for the reviewed workflow |
| Tool limits kept outside the step: a `settings` input given as a file path, `.claude/commands` or `.gemini/commands` | only inline JSON is read, so a path reads as no restriction for Gemini and as none found for Claude | inline the settings |
| An agent started by a schedule or by hand that fetches issues or comments itself, and a maintainer's comment that starts an agent which then reads text an outsider wrote | the trigger no outside account fires, or the actor check passes, and nothing in the file says which text the agent reads | least privilege for every agent step |
| Event text that reaches the agent through a file, an artifact or an earlier step's environment | only expressions in the step's own inputs, env and run text are followed | review |
| An agent action or CLI this rule does not know, or a CLI name too generic to match | the vocabulary is the table | review; a later phase |
| Secrets of a deployment environment and the repository's default token permissions | `environment:` secrets and the default permissions live in the repository settings | set `permissions:` explicitly |
| Secrets a later step uses, which an agent that can write files could reach by changing what that step runs | only the agent step's own inputs and environment are counted (the prototype found such a later step next to 26 exposed steps that warn) | give the agent no write access to the workspace |
| A private repository, where no outside account can open an issue | visibility is a setting, so it fails the same way | an allowlist entry |
| A `codex-args` sandbox or approval switch | the action appends its own sandbox choice and rejects those overrides, so they are not counted | none needed |
| YAML merge keys and tags in a workflow | not read; the file fails only when it names an agent | write the workflow without them |
| Valid YAML this reader wrongly refuses as invalid | a refused file is a note, so an agent in it is not judged; over 2,987 distinct corpus workflows this reader and js-yaml refused the same 9 files, and the one construct the review found (a plain scalar a flow list wraps over lines) is now read | review; report the construct |
| A workflow that copies gh-aw's whole lock structure: the `.lock.yml` name, its header, `activation` and `agent` jobs, and a role env in a job the agent needs | it is trusted as a lock and never judged step by step, although its role-check job may check nothing | review of every `.lock.yml` change |
| A job gated on another repository's name in a clone with no origin remote, or with an origin that is not the repository the workflow runs in | the repository is unknown, so the literal is unknown and the step stays reachable: read with no origin, 18 files and 20 failing steps of the adopter corpus are copies gated on Gemini CLI's own name | clone with the origin remote; an allowlist entry |
| An agent CLI word followed by one of its own commands that start no session, such as adding an MCP server or logging in | only the Copilot name has its non-session commands listed (it also names AWS Copilot); other CLIs still read as an agent step | review; a later phase |
| A here-document opened inside a double-quoted command substitution (`"$(cat <<EOF`) | the opener sits inside quotes, so its body lines are read as commands | review |
| Claude Code's `--settings` given as a file path, and inline `--settings` JSON in a script or hook that `agent-bypass-invocation` reads as text | only inline JSON in a workflow step's command or `claude_args` is parsed | inline the settings in the step; review scripts |
| An escaped control in a Go MCP server built by arithmetic, or in a file with no server-side identifier (a wiring file, a helper package) | the Go rows see a literal number in a conversion, a byte or rune slice or a `%c` argument, and the import counts only next to server-side code | review; sanitizing output at run time |
| A named allow list in an actor check input | the listed accounts are trusted as the owner chose | review the list |
| An adaptive attack against these signatures | the list is public, and the attacker plays after reading it | defence in depth; the rules promise only "no known signature" |
