# dsh-extra-paths

English | [中文](README.zh.md)

Let DSH **write to configured external paths on the first try, with no approval** — for the `write`/`edit` tools and
`bash` subprocesses alike — and, since 0.3.0, **restrict** paths per access level: `deny` (no read or write), `read`
(read-only), `write` and `always-write`. Paths may be spelled for Windows, macOS/Linux or WSL, so one configuration can
be shared across machines. The plugin works by wrapping services (it does not change DSH core) and ships a Web settings
page plus a live preview of the effective rules for the current workspace.

## Install

Requires DSH `0.1.5` / `0.2.0` / `0.2.1` / `0.2.2` (outside that range the install gate refuses the package).

```bash
dsh plugin --profile <name> add dsh-extra-paths            # <name> = your profile
```

From a checkout instead of the registry:

```bash
pnpm install && pnpm build
dsh plugin --profile <name> add /path/to/dsh-extra-paths   # path = absolute path to this repo
```

Then open **Extra writable paths** in the settings sidebar. In **Settings → Plugins** the same page lives on this
plugin's own row: open the `dsh-extra-paths` bundle, then hit that row's **Configure** button.

The page follows DSH's own language selection (**Settings → General → Language**): it ships Simplified Chinese and
English copy, and every other UI language falls back to English.

## Access levels

Every configured path carries one access level and a set of **surfaces**. `deny` and `read` are new in 0.3.0; before
that every entry was a write grant (`write` / `always-write`, spelled `scope` back then).

| `access` | fs tools: read | fs tools: write | bash: read | bash: write |
|---|---|---|---|---|
| `deny` | refused | refused | refused¹ | refused¹ |
| `read` | allowed | refused, even inside the workspace | allowed | refused¹ |
| `write` (default) | allowed | allowed while the session is `workspace-write` | allowed | allowed while `workspace-write`² |
| `always-write` | allowed | allowed even under `read-only` | allowed | allowed even under `read-only`² |

¹ Only where the shell sandbox can subtract permissions: macOS seatbelt and Linux bwrap. On Linux landlock (used when
bwrap is unavailable) and on Windows ACL, bash does not honor `deny`/`read`; the fs tools still do — see
[Known limits](#known-limits). ² The host cannot express extra bash grants on Windows; the fs tools still grant there.

- **The strictest rule wins**: for one target, `deny` > `read` > `write`/`always-write`. A `read`/`deny` rule is never
  widened by a broader writable rule that covers it, so a denied subdirectory stays denied inside a writable root.
  `write` and `always-write` merge to `always-write`, and the levels are reconciled **per surface**: one root can be
  writable for the fs tools while bash may only read it.
- **`deny` is a hard rule**: it refuses content reads (the `read` tool, image/byte reads, listings and `watch`) and every
  write. The `deny` and `read` rules hold for the fs tools even under `danger-full-access`; that mode has no shell sandbox
  for them to attach to, so `bash` is not covered there.
- **`read` downgrades writes while keeping reads**: use it for directories inside the workspace that must stay
  write-protected (`.git`, `node_modules`, build output).
- **Surfaces** (default `[fs, shell]`): `fs` = the fs tools — reads/listings as well as `write`/`edit`/apply-patch and
  the delete/move operations; `shell` = `bash` subprocesses. A rule only applies to the surfaces it lists, so an
  `fs`-only `deny` does not stop bash from reading the path (and vice versa).
- Read **metadata** (`stat`/`lstat`/`resolve`) is not blocked — only content access is; see Known limits.

## Configuration

Write it into the `extra-paths` section of the settings document `~/.dsh/settings.yaml`, or just use the settings page
(**saving takes effect immediately, no restart needed**). `<work root>` below is a placeholder for the directory that
holds your projects (an absolute path, or one starting with `~/`) — replace it with a path of your own:

```yaml
extra-paths:
  defaultAccess: write                         # default access for entries that omit it (default: write)
  defaultSurfaces: [fs, shell]                 # default surfaces (default: fs + shell)
  paths:
    - <work root>/notes/home                   # bare string = default access/surfaces
    - path: ../../notes/home                   # relative paths resolve against the session workspace
      access: always-write
    - path: <work root>/some-repo
      access: write
      surfaces: [fs]                           # fs tools only: bash gets neither a grant nor a restriction
    - path: ~/.ssh
      access: deny                             # refuse reads and writes (bash too, where the platform can)
```

Access levels are `deny` / `read` / `write` / `always-write`; surfaces are `fs` / `shell`. A bare-string entry inherits
`defaultAccess` and `defaultSurfaces`, and an object entry may omit either field to inherit it.

### Migrating from 0.2.x

The old vocabulary is still accepted: an entry's `scope: write|always-write` maps onto the same `access` level, and
`defaultScope` is the legacy alias of `defaultAccess`. Nothing has to change. If one entry spells both `scope` and
`access` with different values, the save is rejected instead of silently preferring one.

**One deliberate semantic change:** a spelling with no `/` (`notes`, `secrets`, `.git`) used to mean
`<workspace>/<name>` and is now a [name rule](#bare-name-rules-one-name-matched-at-any-depth) (that name at any depth).
Write `./notes` to keep the old literal meaning.

### How relative paths resolve

Relative paths resolve against **each session's own workspace** (the settings page has a "base workspace" field so you
can preview this); a spelling with **no separator** is a name rule instead — see
[Bare-name rules](#bare-name-rules-one-name-matched-at-any-depth):

| Spelling | Resolves to | Notes |
|---|---|---|
| `..` | `<work root>` | the **parent** of the workspace; that directory and all of its siblings become writable |
| `../some-repo` | `<work root>/some-repo` | grants exactly one sibling repository (more precise than `..`, recommended) |
| `../../notes/home` | `<work root>/notes/home` | go up a few levels and into another tree |
| `~/notes/home` | under your home | independent of the workspace; `~user` is not expanded (same as the host) |

### Bare-name rules: one name, matched at any depth

A `path` with **no separator** (`.git`, `.env`, `node_modules`) is a **name rule**, not a path: it matches that
component — file or directory — at **any depth** under the session workspace plus every configured **writable root**,
and covers each match's whole subtree. One line protects the same structure in every repository, without a
per-checkout path or a walk-everything pattern:

```yaml
paths:
  - path: .git
    access: deny            # repository metadata, wherever it is
    surfaces: [fs]          # name rules are fs-only (see below)
  - path: .env
    access: deny            # secret files anywhere under the scope roots
  - path: node_modules
    access: read            # dependency trees: readable, never writable
```

- **Scope**: matching starts only at the session workspace and the configured writable roots (the scope roots the
  preview lists); the plugin never walks the whole disk.
- **Escape hatch**: `./notes` — a spelling WITH a separator — is still a literal workspace-relative path, so use it
  when a single component must mean exactly `<workspace>/name` instead of "any depth".
- **Every access level is legal**, but `deny` / `read` are the recommended ones: a name-scoped grant
  (`write` / `always-write`) would grant every same-named directory under the scope roots.
- **fs tools only — deliberately.** Name rules are matched lexically on every fs call: exact, live (a directory created a
  moment ago is already covered) and with no directory walk. The shell surface **cannot** express a bare name, and
  enumerating "the paths it matches right now" before commands turned out to be costly, stale for up to 30 s and
  silently partial whenever one writable root was deep or unreadable — so it is **not done**: a name rule never
  restricts `bash`. If the shell must be covered, write concrete paths or a `*` pattern (those are exact on both
  surfaces). A name rule that still lists `shell` in `surfaces` gets a one-time host warning — the fs tools stay
  protected, bash does not.
- **Need bash covered? Use a pattern.** A spelling containing `*` is a pattern (never a name rule) and patterns are the
  one form the shell surface can inject. A leading wildcard anchors at the **session workspace**, so `**/.git` protects
  every repository's `.git` under it without hard-coding a machine-specific root; a literal final segment also matches
  **files**, so `**/.env` works. See below.

### Patterns: anchor a grant to directory structure (no hard-coded paths)

A `path` can use wildcards to describe **a group of paths** — directories, or files when the final segment is a literal
name — turning "a certain structure exists somewhere in this path" into a condition:

| Spelling | Matches (the granted root) |
|---|---|
| `<work root>/**/.worktrees/..` | every **repository root that contains `.worktrees`** (the parent of `.worktrees`) |
| `<work root>/**/.worktrees/*` | each individual worktree (`.git` and the main checkout are never touched) |
| `<work root>/<some-repo>/.worktrees/*` | every worktree of one repository (**zero traversal cost**, recommended) |
| `<work root>/*/notes` | the `notes` directory under every repository/project |
| `**/.git` | every `.git` directory under the **session workspace**, up to the depth bound |
| `**/.env` | every `.env` **file** under the session workspace |
| `<work root>/**/.git` | the same, anchored at an absolute work root so every session shares it |

Syntax: `*` = exactly one level, `**` = at most 3 levels (**only existing paths** match, so "`.worktrees` must exist" comes
for free); a **literal final segment also matches files** (`**/.env`); a trailing `..` moves up **after** matching (so
`…/.worktrees/..` is "the parent of `.worktrees`", rather than something lexical collapsing eats away).

**Anchor:** absolute (`~`, `/…`, `C:\…`) or **workspace-relative** — a leading wildcard (`**/.git`, `*/src`) or a
literal prefix (`services/**/notes`, `../**/.git`) is anchored at the **session workspace**, exactly like a relative
path, so the same configuration works in every checkout without a machine-specific work root. A Windows spelling with
`\` separators is parsed in its own dialect; a pattern whose absolute anchor belongs to another platform becomes
inactive (`foreign`) with a warning instead of failing the save.

Safety bounds (hard constraints, not advice):

- **absolute / `~` anchors** need at least two literal segments and must not start at a volume root — `/**`, `~/**`,
  `/srv/**` are refused outright; **workspace-relative anchors** need at least one literal segment, so `**` / `**/*`
  (a pure workspace sweep) is refused too
- traversal **never enters** `node_modules` or `.git`, and `**` never enters hidden directories — but a **final literal
  segment may match `.git` itself** (that is how `**/.git` works), it just never looks inside it
- bounded: `**` covers at most 3 levels, and more than 4096 directories or more than 256 matches makes **the whole
  pattern inert** (fail closed — never a partial, unpredictable grant); the reason is reported as a warning
- expansions are cached for 30 seconds, so a **newly created worktree/.git is picked up within 30 seconds**
- a pattern is also the form the **shell surface** can express: on macOS seatbelt and Linux bwrap the matched paths are
  injected into the sandbox (bounded + cached); landlock and Windows ACL still cannot subtract access

The preview panel shows the **host's answer for every configured entry**: the resolved absolute path (symlinks as the
host canonicalizes them), the status badge (`[active]`, `[missing]`, `[rejected]`, `[not applicable on this host]`), and —
for a pattern or a name rule — how many paths currently match. Zero matches, blocked patterns and platform-mismatched
entries are all spelled out, so there is no need to "save first and then check whether it resolved".

## Windows, WSL and macOS/Linux: one configuration for every machine

A configured path may be written in any platform's spelling; the **host** resolves it and translates between Windows and
WSL where it can, then verifies the result against the real filesystem. The page always shows the host's answer — the
browser never guesses the platform (under WSL the browser is Windows Chrome while the host is Linux, and a remote web
client is another machine).

| Spelling | Meaning |
|---|---|
| `C:\work\shared`, `C:/work/shared` | a Windows drive path, either separator accepted |
| `\\server\share\docs` | a Windows UNC share |
| `C:foo` | rejected at save time (drive-relative — it depends on that drive's current directory) |
| `/mnt/c/work` | WSL spelling of `C:\work` (the mount root is detected from the mount table; `/mnt` is the fallback) |
| `/c/work` | git-bash/MSYS spelling of `C:\work`; only usable when that drive exists on the host (otherwise `missing`) |
| `~/projects`, `~\projects` | your home directory; both separators accepted |

- **WSL ⇄ Windows translation**: inside WSL a Windows drive path `C:\x` (or `C:/x`) becomes `/mnt/c/x`; on a native
  Windows host `/mnt/c/…` or `/c/…` becomes `C:\…` (a drive that does not exist there is simply `missing`). UNC paths
  have no reliable WSL mapping, so they are `foreign` inside WSL. Translation is never trusted lexically — the
  translated path still has to resolve.
- **Foreign entries stay inactive**: a spelling this host cannot express (a Windows path on macOS/Linux, an unmappable
  POSIX path on Windows) is **inactive with a warning**; the configuration still saves, so the same document can be used
  on several machines (dotfiles, a shared settings repo) without per-machine copies.
- **Save-time validation**: filesystem/volume roots (`/`, `C:`, `C:\`, a UNC share root), drive-relative spellings and
  duplicate paths (case-insensitively on Windows) are rejected. A spelling that only becomes a volume root after
  translation (WSL's `/mnt/c`) is reported `[rejected]` and ignored at resolution time.

## Settings page: one plain-text editor, one Save

The page is a **single plain-text editor for all rules** — no row list, no mode switch and exactly **one action:
Save**. Each line is `path | access | surfaces`; the editor always renders the explicit three-field form, and a bare
name (`.git`, `.env`) is a name rule. Hand-written comments (`# …`) and blank lines are ignored.

- **Defaults when fields are omitted**: the page shows the live values in a line above the editor — access falls back
  to `defaultAccess` (default **write**, i.e. writable while the session is workspace-write) and surfaces to
  `defaultSurfaces` (default **fs+shell**); both can be changed in the config document under the `extra-paths` section.
- **Built-in examples**: a collapsible **Examples and supported forms** block sits right above the editor with the
  common spellings (access levels, surfaces, bare-name rules, patterns, Windows/WSL paths) and the same defaults note.
- **The base-workspace field** only feeds the preview and the host-side resolution — it is not part of the saved
  configuration.
- **Save** parses the whole text (all-or-nothing) and writes the structured `paths` array in one step; invalid lines are
  reported with their line number and nothing is saved. The host's refusal (a home/CLI override owns the namespace) is
  shown instead of silently pretending to save.
- **The preview panel** answers for the draft: effective writable roots, read-only roots, denied roots, per-entry
  status (`[active]`, `[missing]`, `[rejected]`, `[not applicable on this host]`) and warnings. It is collapsed by
  default.
- Rows/pattern/name details now live **in the text itself**; the preview shows the resolved result, so there is no
  second editor to keep in sync.

## Known limits

- **Shell-side `deny`/`read` is only reliable on macOS (seatbelt) and Linux with bwrap.** The Linux landlock runner is an
  allow-list — it can grant, not subtract — and WSL installs without bwrap end up there; the Windows ACL runner rejects
  unknown flags. On those hosts bash will not honor `deny`/`read`: the plugin does not invent flags, it warns once per
  dialect and rule set, and the page shows the capability banner. The fs tools always enforce the rules.
- **A bare-name rule protects the fs tools, NOT bash.** `.git`, `.env`, `node_modules` are matched lexically by
  `read`/`write`/`edit`/apply-patch and friends (and by the `grep`/`glob` argument guard); `bash` can still read or
  write them, because a sandbox profile can only name concrete paths and per-command enumeration was rejected
  (cost, staleness, partial coverage). Use a path pattern if bash must be restricted too — e.g. `**/.git` (anchored at
  the session workspace) or `<work root>/**/.git`; patterns are exact on both surfaces where the platform can subtract.
- **`grep`/`glob` bypass `ctx.fs`**: the host runs its bundled ripgrep directly. The plugin's tool-level guard reliably
  refuses `grep`/`glob` calls whose own `path` argument names a denied path, but a default workspace-wide search can
  still surface a denied subdirectory in its results. Keep sensitive data outside the workspace and `deny` it there —
  on platforms where the shell can subtract, bash is blocked as well.
- **Metadata is not blocked**: `stat`/`lstat`/`resolve` and similar methods exchange only metadata, so the existence,
  size and identity of a denied path can still be observed. Content reads, listings and `watch` are refused.
- **Consumers outside the proxy**: services that reach the filesystem through `ctx.get('fs')`, LSP/MCP subprocesses, and
  host services that cached `ctx.fs` at load time are not constrained by the proxy.
- **Windows shell grants remain unsupported by the host** (a 0.2.2 architecture limit): extra paths are not widened for
  bash on Windows, and 0.3.0 does not change that. The fs tools still work.
- **Under `danger-full-access`** there is no shell sandbox to inject rules into, so shell-surface `deny`/`read` cannot be
  enforced in that mode; the fs tools still enforce them.
- Per-path "no restrictions at all" is not achievable: the bash sandbox works at whole-invocation granularity.
- Relative paths resolve against the session workspace, so the same entry points at different directories in different
  workspaces — the settings page preview shows the actual resolution.
- `always-write` weakens what the `read-only` stop button can do for that path.
- Files written outside the workspace do not appear in the `deliverables` workspace-changes card.
