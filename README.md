# pmm — Package managers Manager

An interactive CLI to manage, inspect, and clean caches for **npm**, **pnpm**, **bun**, **yarn**, and **nub**.

## Why pmm exists

If you work on Node.js projects for more than a few months, you accumulate package managers like cats. You install pnpm for one project, yarn for a legacy one, bun because a friend told you it was fast, and nub because the readme was good. Before you know it, four of them are sitting in your `$PATH` quietly hoarding gigabytes under `~/.npm`, `~/.local/share/pnpm`, `~/.bun/install/cache`, `~/.cache/yarn`, and `~/.cache/nub`.

The pain:

- **It's boring to remember the right command for each one.** `npm cache clean --force`, `pnpm store prune`, `bun pm cache rm`, `yarn cache clean`, `nub pm cache clear` — and the flag for npm is different from the flag for everything else.
- **It's easy to forget they're installed.** Nothing tells you, until disk pressure does. `df -h` screaming at 95% and you have no idea which directory to blame.
- **Some hide their cache in non-obvious places.** pnpm keeps a content-addressable store outside the project, bun nests under `~/.bun/install/cache`, nub under `~/.cache/nub`, and XDG-aware tools respect `$XDG_CACHE_HOME`. Good luck finding them by hand.
- **Uninstalling cleanly is its own chore.** Brew, corepack, npm global, curl-installed binaries — each one uninstalls differently, and the symlinks linger.

pmm is one menu that does all of it: shows you what's installed, where the cache lives, how big it is, and gets out of your way with one keypress.

## Install (global symlink)

```bash
git clone https://github.com/tarpagad/pmm.git
cd pmm
npm link
```

## Usage

```bash
pmm
```

The interactive menu shows the status of each package manager and lets you:

- **Clean all caches** with a single action
- **Clean a specific cache** (size is shown before and after)
- **Install** a package manager that's not detected
- **Uninstall** a package manager (with a confirmation prompt, since `rm -rf` is permanent)

```
📦 Package Manager Manager
Manage npm, pnpm, bun, yarn, and nub

════════════════════════════════════════════════════════════
📊 Status:

  📦 npm  : ✅ v10.2.4         cache: 412.3MB
  🔷 pnpm : ✅ v9.15.4         cache: 1.8GB
  🥟 bun  : ✅ v1.1.42         cache: 622.1MB
  🧶 yarn : ❌ not installed
  🪶 nub  : ❌ not installed
════════════════════════════════════════════════════════════
```

## Features

- Cross-platform — works the same on macOS, Linux, and Windows
- No dependencies — single `index.js` file, just Node.js
- Respects `XDG_CACHE_HOME` and `BUN_HOME` environment variables
- Falls back to a direct `rm -rf` of the cache directory if the package manager's own clean command fails (so a broken `bun pm cache rm` doesn't leave you stuck)
- Confirms before destructive operations
- Human-readable sizes (`412.3MB`, `1.8GB`)

## Contributing

**This project is open for contribution and actively encourages forking.**

pmm is intentionally small — one file, no build step, no test framework. The whole contribution model is:

1. **Add another package manager** by appending an entry to the `packageManagers` object in `index.js`. Copy the structure of an existing one (npm is the simplest). The five required fields are `name`, `emoji`, `color`, `getVersion()`, and `getCachePath()`; `install`, `cleanCmd`, and `uninstall` are recommended.

2. **Improve an existing one** — better cache path detection, a more accurate fallback, an install command that matches the platform.

3. **Fix a bug or improve UX** — the menu, the size formatting, the error messages.

### How to contribute

1. Fork the repo
2. Create a branch (`git checkout -b feature/dnt-cache-cleaner`)
3. Make your change
4. Open a Pull Request describing what you added and why

### Or just fork it

The whole point of pmm being a single-file tool with no build step is that you can fork it in five minutes and bend it to your workflow:

- Add the package manager your team uses
- Tweak the menu order
- Change the color scheme
- Add a `--non-interactive` flag for CI
- Wrap it in a TUI library if you want fancier rendering

Fork it, rename it, ship it under your own name. The MIT license is there for exactly that. If you build something interesting, a star on the original is always appreciated but never required.

## License

MIT — see [LICENSE](./LICENSE).
