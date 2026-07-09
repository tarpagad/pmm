# pmm — Package Managers Manager

CLI tool to clean caches for npm, pnpm, bun, yarn, and nub.

## Install (global symlink)

```bash
npm link
```

## Usage

```bash
pmm
```

The interactive menu shows the status of each package manager and lets you:

- Clean all caches or a specific one
- Install a package manager that's not detected
- Uninstall a package manager

Cache sizes are displayed before and after cleaning.

## Unlink

```bash
npm unlink -g package-cache-cleaner
```
