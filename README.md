# dsh-extra-paths

English | [中文](README.zh.md)

Let DSH **write to a set of configured external paths on the first try, with no approval**: this covers the `write`/`edit`
tools and `bash` subprocesses alike. The plugin works by wrapping services (it does not change DSH core) and ships a Web
settings page plus a preview of the effective roots for the current workspace.

## Install

Requires DSH `0.1.5` / `0.2.0` / `0.2.1` (outside that range the install gate refuses the package).

```bash
dsh plugin --profile <name> add dsh-extra-paths            # <name> = your profile
```

From a checkout instead of the registry:

```bash
pnpm install && pnpm build
dsh plugin --profile <name> add /path/to/dsh-extra-paths   # path = absolute path to this repo
```

Then open the **Extra paths** card under **Settings → Plugins**, or **Extra writable paths** in the settings sidebar.

## Configuration

Write it into the `extra-paths` section of the settings document `~/.dsh/settings.yaml`, or just use the settings page
(**saving takes effect immediately, no restart needed**). `<work root>` below is a placeholder for the directory that
holds your projects (an absolute path, or one starting with `~/`) — replace it with a path of your own:

```yaml
extra-paths:
  paths:
    - <work root>/notes/home                   # default scope/surfaces
    - path: ../../notes/home                   # relative paths resolve against the session workspace
      scope: always-write
    - path: <work root>/some-repo
      scope: write
      surfaces: [fs]                           # only the write/edit tools may write here
```

| scope | session `read-only` | session `workspace-write` |
|---|---|---|
| `write` (default) | denied | writable |
| `always-write` | writable | writable |

`surfaces`: `fs` = the `write`/`edit`/str-replace tools; `shell` = `bash` subprocesses. Reads and execution are not
sandboxed to begin with.

### How relative paths resolve

Relative paths resolve against **each session's own workspace** (the settings page has a "base workspace" field so you
can preview this):

| Spelling | Resolves to | Notes |
|---|---|---|
| `..` | `<work root>` | the **parent** of the workspace; that directory and all of its siblings become writable |
| `../some-repo` | `<work root>/some-repo` | grants exactly one sibling repository (more precise than `..`, recommended) |
| `../../notes/home` | `<work root>/notes/home` | go up a few levels and into another tree |
| `~/notes/home` | under your home | independent of the workspace; `~user` is not expanded (same as the host) |

### Patterns: anchor a grant to directory structure (no hard-coded paths)

A `path` can use wildcards to describe **a group of directories**, turning "a certain directory exists somewhere in this
path" into a condition:

| Spelling | Matches (the granted root) |
|---|---|
| `<work root>/**/.worktrees/..` | every **repository root that contains `.worktrees`** (the parent of `.worktrees`) |
| `<work root>/**/.worktrees/*` | each individual worktree (`.git` and the main checkout are never touched) |
| `<work root>/<some-repo>/.worktrees/*` | every worktree of one repository (**zero traversal cost**, recommended) |
| `<work root>/*/notes` | the `notes` directory under every repository/project |

Syntax: `*` = exactly one level, `**` = at most 3 levels (**only directories that actually exist** match, so
"`.worktrees` must exist" comes for free); a trailing `..` moves up **after** matching (so `…/.worktrees/..` is "the
parent of `.worktrees`", rather than something lexical collapsing eats away).

Safety bounds (hard constraints, not advice):

- the wildcard needs a **literal anchor** before it, at least two segments long, absolute or starting with `~/` —
  `/**`, `~/**`, `/srv/**` are refused outright
- traversal **never enters** `node_modules` or `.git`, and `**` never enters hidden directories (`.worktrees` is a
  literal, so it still matches at its own level)
- bounded: `**` covers at most 3 levels, and more than 4096 directories or more than 256 matches makes **the whole
  pattern inert** (fail closed — never a partial, unpredictable grant); the reason is reported as a warning
- expansions are cached for 30 seconds, so a **newly created worktree is picked up within 30 seconds**

The settings page shows the **resolved absolute path** live for every row (symlinks follow the host's canonical
preview) and, for a pattern row, the match count as `[active ×N]` plus each concrete root below it; zero matches and
blocked patterns are both spelled out — so there is no need to "save first and then check whether it resolved".

## Known limits

- Per-path "no restrictions at all" is not achievable: the bash sandbox works at whole-invocation granularity.
- Relative paths resolve against the session workspace, so the same entry points at different directories in different
  workspaces — the settings page preview shows the actual resolution.
- The shell side is not widened on Windows; `always-write` weakens what the `read-only` stop button can do for that path.
- Files written outside the workspace do not appear in the `deliverables` workspace-changes card.
