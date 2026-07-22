#!/usr/bin/env node
import { execFile, execFileSync, spawn } from 'child_process';
import {
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
  rmSync,
} from 'fs';
import path from 'path';
import os from 'os';
import process from 'process';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================== Environment =====================
const PLATFORM = (() => {
  const p = os.platform();
  if (p === 'darwin') return 'mac';
  if (p === 'linux') return 'linux';
  if (p === 'win32') return 'windows';
  return 'unix';
})();
const IS_WINDOWS = PLATFORM === 'windows';
const IS_MAC = PLATFORM === 'mac';
const IS_TTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
const ASSUME_YES =
  process.env.PMM_ASSUME_YES === '1' ||
  process.env.PMM_ASSUME_YES === 'true' ||
  !IS_TTY;
const HOMEDIR =
  os.homedir() ||
  process.env.HOME ||
  process.env.USERPROFILE ||
  os.tmpdir() ||
  '/tmp';
if (!HOMEDIR) {
  console.error('pmm: unable to determine home directory. Set HOME or USERPROFILE.');
  process.exit(1);
}
const APPDATA = process.env.APPDATA || '';
const LOCALAPPDATA = process.env.LOCALAPPDATA || APPDATA || '';

// ===================== Colors =====================
const useColor =
  IS_TTY &&
  !process.env.NO_COLOR &&
  (process.env.TERM || '') !== 'dumb' &&
  !(process.env.PMM_FLAGS || '').split(/\s+/).includes('--no-color');
const C = (useColor
  ? {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
    }
  : Object.fromEntries(
      [
        'reset',
        'bright',
        'dim',
        'red',
        'green',
        'yellow',
        'blue',
        'magenta',
        'cyan',
        'white',
      ].map((k) => [k, '']),
    ));

// ===================== Helpers =====================
function safeExec(cmd, args = [], opts = {}) {
  const candidates = IS_WINDOWS
    ? [cmd, `${cmd}.cmd`, `${cmd}.bat`, `${cmd}.ps1`]
    : [cmd];
  for (const c of candidates) {
    try {
      return execFileSync(c, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
        windowsHide: true,
        ...opts,
      }).trim();
    } catch {}
  }
  return '';
}

function isRealValue(v) {
  return v && v !== 'undefined' && v !== 'null' && v.trim().length > 0;
}

function safeExecAsync(cmd, args = [], opts = {}) {
  const candidates = IS_WINDOWS
    ? [cmd, `${cmd}.cmd`, `${cmd}.bat`]
    : [cmd];
  return Promise.any(
    candidates.map((c) =>
      execFileAsync(c, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
        windowsHide: true,
        ...opts,
      }).then((r) => r.stdout),
    ),
  )
    .then((s) => s.trim())
    .catch(() => '');
}

function expandHome(p) {
  if (!p || typeof p !== 'string') return p;
  if (p === '~') return HOMEDIR;
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(HOMEDIR, p.slice(2));
  }
  return p;
}

function normPath(p) {
  if (!p || typeof p !== 'string') return null;
  try {
    let out = expandHome(p).trim();
    if (!out) return null;
    if (out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1);
    if (out.startsWith("'") && out.endsWith("'")) out = out.slice(1, -1);
    if (out.includes('\0')) return null;
    if (!path.isAbsolute(out)) out = path.resolve(out);
    return path.normalize(out);
  } catch {
    return null;
  }
}

function pathInfo(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

function isDir(p) {
  const s = pathInfo(p);
  return Boolean(s && s.isDirectory());
}

function isRealDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function xdgPath(envName, fallback) {
  const v = process.env[envName];
  return v ? expandHome(v) : fallback;
}

function dirsCommon() {
  return {
    xdgCache: xdgPath(
      'XDG_CACHE_HOME',
      path.join(HOMEDIR, '.cache'),
    ),
    xdgData: xdgPath(
      'XDG_DATA_HOME',
      path.join(HOMEDIR, '.local', 'share'),
    ),
    xdgState: xdgPath(
      'XDG_STATE_HOME',
      path.join(HOMEDIR, '.local', 'state'),
    ),
    xdgConfig: xdgPath(
      'XDG_CONFIG_HOME',
      path.join(HOMEDIR, '.config'),
    ),
  };
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const np = normPath(it.path);
    if (!np) continue;
    // Refuse to ever return a path that resolves to HOMEDIR itself —
    // tools that put their config in ~/.foorc (not in a subdir) would
    // otherwise be reported as "the entire home directory".
    if (np === HOMEDIR) continue;
    const key = IS_WINDOWS ? np.toLowerCase() : np;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...it, path: np });
  }
  return out;
}

// ===================== BigInt-safe size =====================
function humanSize(bytes) {
  if (bytes == null) return '?';
  let n;
  try {
    n = typeof bytes === 'bigint' ? Number(bytes) : Number(bytes);
  } catch {
    return '?';
  }
  if (!isFinite(n) || n <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const fmt =
    i === 0
      ? String(Math.round(n))
      : n < 10
        ? n.toFixed(2)
        : n < 100
          ? n.toFixed(1)
          : Math.round(n).toString();
  return `${fmt}${units[i]}`;
}

function dirSize(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 256;
  let total = 0n;
  let files = 0;
  let errors = 0;
  const visited = new Set();

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let real;
    try {
      real = realpathSync(dir);
    } catch {
      errors++;
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      errors++;
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      try {
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          walk(full, depth + 1);
        } else if (ent.isFile()) {
          const s = statSync(full);
          if (s.size > 0) {
            total += BigInt(s.size);
            files++;
          }
        }
      } catch {
        errors++;
      }
    }
  }

  const info = pathInfo(root);
  if (!info) return { bytes: 0n, files: 0, errors: 0 };
  if (info.isFile()) {
    try {
      return {
        bytes: BigInt(statSync(root).size),
        files: 1,
        errors: 0,
      };
    } catch {
      return { bytes: 0n, files: 0, errors: 1 };
    }
  }
  if (!info.isDirectory()) return { bytes: 0n, files: 0, errors: 0 };

  walk(root, 0);
  return { bytes: total, files, errors };
}

function safeShellPath(value, fallback) {
  const v = (value || '').trim();
  if (!v) return fallback;
  // Refuse anything that could break out of a quoted shell argument.
  if (/[\0`$\\]/.test(v)) return fallback;
  return v;
}

function shellQuote(p) {
  return `"${String(p).replace(/"/g, '\\"')}"`;
}

// ===================== Package Manager Definitions =====================
const packageManagers = {
  npm: {
    name: 'npm',
    emoji: '📦',
    color: C.red,
    isInstalled: function () {
      return Boolean(safeExec('npm', ['--version']));
    },
    getVersion: function () {
      return safeExec('npm', ['--version']) || null;
    },
    dataPaths: function () {
      const paths = [];

      const cache = safeExec('npm', ['config', 'get', 'cache']);
      if (cache)
        paths.push({
          label: 'cache (npm config)',
          path: cache,
          type: 'cache',
          primary: true,
        });

      paths.push({
        label: 'cache (default ~/.npm)',
        path: path.join(HOMEDIR, '.npm'),
        type: 'cache',
      });

      if (IS_WINDOWS) {
        if (APPDATA)
          paths.push({
            label: 'cache (AppData npm-cache)',
            path: path.join(APPDATA, 'npm-cache'),
            type: 'cache',
          });
        if (LOCALAPPDATA)
          paths.push({
            label: 'cache (LocalAppData npm-cache)',
            path: path.join(LOCALAPPDATA, 'npm-cache'),
            type: 'cache',
          });
      }

      for (const [env, label] of [
        ['NPM_CONFIG_CACHE', 'NPM_CONFIG_CACHE'],
        ['npm_config_cache', 'npm_config_cache'],
      ]) {
        if (process.env[env])
          paths.push({
            label: `cache (${label})`,
            path: process.env[env],
            type: 'cache',
          });
      }

      const configPrefix = safeExec('npm', ['config', 'get', 'prefix']);
      const brewPrefix = IS_MAC ? safeExec('brew', ['--prefix', 'npm']) : '';
      const fallbackPrefix = IS_WINDOWS
        ? path.join(LOCALAPPDATA || APPDATA, 'npm')
        : brewPrefix
          ? path.join(brewPrefix, 'libexec', 'lib', 'node_modules')
          : '/usr/local/lib/node_modules';
      const prefix = configPrefix || process.env.NPM_CONFIG_PREFIX || fallbackPrefix;
      if (prefix)
        paths.push({ label: 'prefix (global root)', path: prefix, type: 'modules' });

      const globalRoot = safeExec('npm', ['root', '-g']);
      if (globalRoot)
        paths.push({ label: 'global modules', path: globalRoot, type: 'modules' });

      const userconfig = safeExec('npm', ['config', 'get', 'userconfig']);
      if (userconfig)
        paths.push({
          label: 'user config',
          path: path.dirname(userconfig),
          type: 'config',
        });

      const globalconfig = safeExec('npm', ['config', 'get', 'globalconfig']);
      if (globalconfig)
        paths.push({
          label: 'global config',
          path: path.dirname(globalconfig),
          type: 'config',
        });

      const tmp = process.env.NPM_CONFIG_TMP || (IS_WINDOWS
        ? process.env.TEMP || process.env.TMP
        : process.env.TMPDIR || '/tmp');
      if (tmp)
        paths.push({
          label: 'tmp (npm-*)',
          path: path.join(tmp, 'npm-'),
          type: 'cache',
        });

      return dedupe(paths);
    },
    primaryCacheLabel: 'cache',
    cleanCmds: function () {
      return [
        {
          label: 'npm cache clean --force',
          cmd: 'npm cache clean --force',
          needsShell: true,
        },
      ];
    },
    install: {
      mac: 'brew install npm',
      linux: 'sudo apt install npm || sudo yum install npm || sudo pacman -S npm',
      windows: 'winget install OpenJS.NodeJS.LTS || choco install nodejs-lts',
      universal:
        'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && nvm install --lts',
    },
    uninstall: {
      mac: 'brew uninstall npm',
      linux: 'sudo apt remove npm || sudo yum remove npm',
      windows: 'winget uninstall OpenJS.NodeJS.LTS',
    },
  },

  pnpm: {
    name: 'pnpm',
    emoji: '🔷',
    color: C.blue,
    isInstalled: function () {
      return Boolean(safeExec('pnpm', ['--version']));
    },
    getVersion: function () {
      return safeExec('pnpm', ['--version']) || null;
    },
    dataPaths: function () {
      const { xdgCache, xdgData, xdgState, xdgConfig } = dirsCommon();
      const paths = [];

      const store = safeExec('pnpm', ['store', 'path']);
      if (store)
        paths.push({
          label: 'store (pnpm store path)',
          path: store,
          type: 'cache',
          primary: true,
        });

      const globalDir = safeExec('pnpm', ['config', 'get', 'global-dir']);
      if (isRealValue(globalDir))
        paths.push({ label: 'global modules', path: globalDir, type: 'modules' });

      const cacheDir = safeExec('pnpm', ['config', 'get', 'cache-dir']);
      if (isRealValue(cacheDir))
        paths.push({
          label: 'cache (pnpm config cache-dir)',
          path: cacheDir,
          type: 'cache',
        });

      const stateDir = safeExec('pnpm', ['config', 'get', 'state-dir']);
      if (isRealValue(stateDir))
        paths.push({
          label: 'state (pnpm config state-dir)',
          path: stateDir,
          type: 'state',
        });

      const dataDir = safeExec('pnpm', ['config', 'get', 'data-dir']);
      if (isRealValue(dataDir))
        paths.push({
          label: 'data (pnpm config data-dir)',
          path: dataDir,
          type: 'data',
        });

      paths.push({ label: 'data (XDG default)', path: path.join(xdgData, 'pnpm'), type: 'data' });
      paths.push({ label: 'state (XDG default)', path: path.join(xdgState, 'pnpm'), type: 'state' });
      paths.push({ label: 'cache (XDG default)', path: path.join(xdgCache, 'pnpm'), type: 'cache' });

      paths.push({
        label: 'data (.local/share/pnpm)',
        path: path.join(HOMEDIR, '.local', 'share', 'pnpm'),
        type: 'data',
      });
      paths.push({
        label: 'state (.local/state/pnpm)',
        path: path.join(HOMEDIR, '.local', 'state', 'pnpm'),
        type: 'state',
      });

      if (IS_MAC) {
        paths.push({
          label: 'data (macOS Library/pnpm)',
          path: path.join(HOMEDIR, 'Library', 'pnpm'),
          type: 'data',
        });
        paths.push({
          label: 'cache (macOS Library/Caches/pnpm)',
          path: path.join(HOMEDIR, 'Library', 'Caches', 'pnpm'),
          type: 'cache',
        });
      }

      paths.push({
        label: 'store (legacy ~/.pnpm-store)',
        path: path.join(HOMEDIR, '.pnpm-store'),
        type: 'cache',
      });

      if (process.env.PNPM_HOME)
        paths.push({
          label: 'home (PNPM_HOME)',
          path: process.env.PNPM_HOME,
          type: 'data',
        });

      paths.push({ label: 'config (XDG)', path: path.join(xdgConfig, 'pnpm'), type: 'config' });

      return dedupe(paths);
    },
    primaryCacheLabel: 'cache',
    cleanCmds: function () {
      return [{ label: 'pnpm store prune', cmd: 'pnpm store prune', needsShell: true }];
    },
    install: {
      mac: 'brew install pnpm',
      linux: 'sudo apt install pnpm || sudo yum install pnpm',
      windows: 'winget install pnpm',
      universal: 'curl -fsSL https://get.pnpm.io/install.sh | sh -',
    },
    uninstall: {
      mac: 'brew uninstall pnpm',
      linux: 'sudo apt remove pnpm || sudo yum remove pnpm',
      windows: 'winget uninstall pnpm',
    },
  },

  bun: {
    name: 'bun',
    emoji: '🥟',
    color: C.magenta,
    isInstalled: function () {
      return Boolean(safeExec('bun', ['--version']));
    },
    getVersion: function () {
      return safeExec('bun', ['--version']) || null;
    },
    dataPaths: function () {
      const { xdgCache, xdgData, xdgConfig } = dirsCommon();
      const paths = [];

      const bunHome = process.env.BUN_HOME || path.join(HOMEDIR, '.bun');
      paths.push({
        label: 'BUN_HOME',
        path: bunHome,
        type: 'data',
        primary: true,
      });
      paths.push({
        label: 'cache (BUN_HOME/install/cache)',
        path: path.join(bunHome, 'install', 'cache'),
        type: 'cache',
      });
      paths.push({
        label: 'global (BUN_HOME/install/global)',
        path: path.join(bunHome, 'install', 'global'),
        type: 'modules',
      });

      paths.push({ label: 'cache (XDG default)', path: path.join(xdgCache, 'bun'), type: 'cache' });
      paths.push({ label: 'data (XDG default)', path: path.join(xdgData, 'bun'), type: 'data' });
      paths.push({ label: 'config (XDG)', path: path.join(xdgConfig, 'bun'), type: 'config' });

      if (IS_MAC) {
        paths.push({
          label: 'cache (macOS Library/Caches/bun)',
          path: path.join(HOMEDIR, 'Library', 'Caches', 'bun'),
          type: 'cache',
        });
        paths.push({
          label: 'data (macOS Application Support/bun)',
          path: path.join(HOMEDIR, 'Library', 'Application Support', 'bun'),
          type: 'data',
        });
      }

      if (IS_WINDOWS) {
        if (LOCALAPPDATA) {
          paths.push({
            label: 'cache (LocalAppData/bun/cache)',
            path: path.join(LOCALAPPDATA, 'bun', 'cache'),
            type: 'cache',
          });
          paths.push({
            label: 'data (LocalAppData/bun)',
            path: path.join(LOCALAPPDATA, 'bun'),
            type: 'data',
          });
        }
        if (APPDATA) {
          paths.push({
            label: 'config (AppData/bun)',
            path: path.join(APPDATA, 'bun'),
            type: 'config',
          });
        }
      }

      if (process.env.BUN_INSTALL)
        paths.push({
          label: 'BUN_INSTALL (legacy)',
          path: process.env.BUN_INSTALL,
          type: 'data',
        });

      return dedupe(paths);
    },
    primaryCacheLabel: 'cache',
    cleanCmds: function () {
      return [
        { label: 'bun pm cache rm', cmd: 'bun pm cache rm', needsShell: true },
        { label: 'bun pm cache (clear alias)', cmd: 'bun pm cache clear', needsShell: true },
      ];
    },
    install: {
      mac: 'brew install bun',
      linux: 'curl -fsSL https://bun.sh/install | bash',
      windows: 'powershell -c "irm bun.sh/install.ps1 | iex"',
      universal: 'curl -fsSL https://bun.sh/install | bash',
    },
    uninstall: {
      mac: 'brew uninstall bun',
      linux: `rm -rf ${shellQuote(safeShellPath(process.env.BUN_HOME, path.join(HOMEDIR, '.bun')))}`,
      windows: `rmdir /s /q ${shellQuote(safeShellPath(process.env.BUN_HOME, '%USERPROFILE%\\.bun'))}`,
    },
  },

  yarn: {
    name: 'yarn',
    emoji: '🧶',
    color: C.cyan,
    isInstalled: function () {
      return Boolean(safeExec('yarn', ['--version']));
    },
    getVersion: function () {
      return safeExec('yarn', ['--version']) || null;
    },
    dataPaths: function () {
      const { xdgCache, xdgConfig } = dirsCommon();
      const paths = [];
      const ver = safeExec('yarn', ['--version']);
      const isBerry = ver && !ver.startsWith('1.');

      const cache =
        safeExec('yarn', ['config', 'get', 'cacheFolder']) ||
        safeExec('yarn', ['config', 'get', 'cache-folder']);
      if (isRealValue(cache))
        paths.push({
          label: 'cache (yarn config)',
          path: cache,
          type: 'cache',
          primary: true,
        });

      const global = safeExec('yarn', ['config', 'get', 'globalFolder']);
      if (isRealValue(global))
        paths.push({ label: 'global modules', path: global, type: 'modules' });

      const prefix = safeExec('yarn', ['config', 'get', 'prefix']);
      if (isRealValue(prefix))
        paths.push({ label: 'prefix', path: prefix, type: 'modules' });

      if (isBerry) {
        paths.push({
          label: 'cache (berry default ~/.yarn/cache)',
          path: path.join(HOMEDIR, '.yarn', 'cache'),
          type: 'cache',
        });
        paths.push({
          label: 'config (berry default ~/.yarn)',
          path: path.join(HOMEDIR, '.yarn'),
          type: 'config',
        });
        paths.push({
          label: 'state (berry ~/.yarn/berry)',
          path: path.join(HOMEDIR, '.yarn', 'berry'),
          type: 'state',
        });
        if (process.platform === 'win32') {
          if (LOCALAPPDATA)
            paths.push({
              label: 'cache (berry LocalAppData)',
              path: path.join(LOCALAPPDATA, 'Yarn', 'berry', 'cache'),
              type: 'cache',
            });
        }
      } else {
        paths.push({ label: 'cache (XDG default)', path: path.join(xdgCache, 'yarn'), type: 'cache' });
        paths.push({
          label: 'cache (XDG default v6)',
          path: path.join(xdgCache, 'yarn', 'v6'),
          type: 'cache',
        });
        paths.push({ label: 'config (XDG)', path: path.join(xdgConfig, 'yarn'), type: 'config' });
        if (IS_MAC) {
          paths.push({
            label: 'cache (macOS Library/Caches/Yarn)',
            path: path.join(HOMEDIR, 'Library', 'Caches', 'Yarn'),
            type: 'cache',
          });
          paths.push({
            label: 'cache (macOS Library/Caches/Yarn/v6)',
            path: path.join(HOMEDIR, 'Library', 'Caches', 'Yarn', 'v6'),
            type: 'cache',
          });
        }
        if (IS_WINDOWS && LOCALAPPDATA) {
          paths.push({
            label: 'cache (LocalAppData Yarn/Cache)',
            path: path.join(LOCALAPPDATA, 'Yarn', 'Cache'),
            type: 'cache',
          });
          paths.push({
            label: 'cache (LocalAppData Yarn/Cache/v6)',
            path: path.join(LOCALAPPDATA, 'Yarn', 'Cache', 'v6'),
            type: 'cache',
          });
          paths.push({
            label: 'config (LocalAppData Yarn)',
            path: path.join(LOCALAPPDATA, 'Yarn'),
            type: 'config',
          });
        }
        paths.push({
          label: 'global (classic ~/.config/yarn/global)',
          path: path.join(xdgConfig, 'yarn', 'global'),
          type: 'modules',
        });
      }

      if (process.env.YARN_CACHE_FOLDER)
        paths.push({
          label: 'cache (YARN_CACHE_FOLDER)',
          path: process.env.YARN_CACHE_FOLDER,
          type: 'cache',
        });
      if (process.env.YARN_GLOBAL_FOLDER)
        paths.push({
          label: 'global (YARN_GLOBAL_FOLDER)',
          path: process.env.YARN_GLOBAL_FOLDER,
          type: 'modules',
        });
      if (process.env.YARN_BERRY_PERSISTENT)
        paths.push({
          label: 'berry cache (YARN_BERRY_PERSISTENT)',
          path: process.env.YARN_BERRY_PERSISTENT,
          type: 'cache',
        });

      paths.push({ label: 'data (~/.yarn)', path: path.join(HOMEDIR, '.yarn'), type: 'data' });

      return dedupe(paths);
    },
    primaryCacheLabel: 'cache',
    cleanCmds: function () {
      return [{ label: 'yarn cache clean', cmd: 'yarn cache clean', needsShell: true }];
    },
    install: {
      mac: 'brew install yarn',
      linux: 'sudo apt install yarn || sudo yum install yarn',
      windows: 'winget install yarn',
      universal: 'npm install -g yarn',
    },
    uninstall: {
      mac: 'brew uninstall yarn',
      linux: 'sudo apt remove yarn || sudo yum remove yarn',
      windows: 'winget uninstall yarn',
    },
  },

  nub: {
    name: 'nub',
    emoji: '🪶',
    color: C.white,
    isInstalled: function () {
      return Boolean(safeExec('nub', ['--version']));
    },
    getVersion: function () {
      return safeExec('nub', ['--version']) || null;
    },
    dataPaths: function () {
      const { xdgCache, xdgConfig } = dirsCommon();
      const paths = [];

      paths.push({
        label: 'cache (XDG default)',
        path: path.join(xdgCache, 'nub'),
        type: 'cache',
        primary: true,
      });

      if (process.env.NUB_CACHE)
        paths.push({
          label: 'cache (NUB_CACHE)',
          path: process.env.NUB_CACHE,
          type: 'cache',
        });

      if (IS_MAC)
        paths.push({
          label: 'cache (macOS Library/Caches/nub)',
          path: path.join(HOMEDIR, 'Library', 'Caches', 'nub'),
          type: 'cache',
        });

      if (IS_WINDOWS && LOCALAPPDATA)
        paths.push({
          label: 'cache (LocalAppData nub/Cache)',
          path: path.join(LOCALAPPDATA, 'nub', 'Cache'),
          type: 'cache',
        });

      paths.push({ label: 'config (XDG)', path: path.join(xdgConfig, 'nub'), type: 'config' });

      paths.push({ label: 'data (legacy ~/.nub)', path: path.join(HOMEDIR, '.nub'), type: 'data' });

      const global = safeExec('nub', ['config', 'get', 'prefix']);
      if (isRealValue(global))
        paths.push({ label: 'prefix', path: global, type: 'modules' });

      return dedupe(paths);
    },
    primaryCacheLabel: 'cache',
    cleanCmds: function () {
      return [{ label: 'nub pm cache clear', cmd: 'nub pm cache clear', needsShell: true }];
    },
    install: {
      mac: 'brew install nubjs/tap/nub',
      linux: 'curl -fsSL https://nubjs.com/install.sh | bash',
      windows: 'powershell -c "irm https://nubjs.com/install.ps1 | iex"',
      universal: 'npm install -g @nubjs/nub',
    },
    uninstall: {
      mac: 'brew uninstall nubjs/tap/nub',
      linux: 'npm uninstall -g @nubjs/nub || rm -rf ~/.nub',
      windows: 'npm uninstall -g @nubjs/nub',
    },
  },

  deno: {
    name: 'deno',
    emoji: '🦕',
    color: C.cyan,
    isInstalled: function () {
      return Boolean(safeExec('deno', ['--version']));
    },
    getVersion: function () {
      const raw = safeExec('deno', ['--version']) || '';
      const line = raw.split(/\r?\n/)[0].trim();
      const m = line.match(/deno\s+([0-9][^\s]*)/i);
      return m ? m[1] : line || null;
    },
    dataPaths: function () {
      const { xdgCache, xdgData } = dirsCommon();
      const paths = [];

      const denoDir = process.env.DENO_DIR;
      if (denoDir) {
        paths.push({
          label: 'DENO_DIR',
          path: denoDir,
          type: 'data',
          primary: true,
        });
        for (const sub of ['deps', 'gen', 'cache', 'registries', 'node_modules']) {
          paths.push({
            label: `DENO_DIR/${sub}`,
            path: path.join(denoDir, sub),
            type: sub === 'node_modules' ? 'modules' : 'cache',
          });
        }
      } else if (IS_MAC) {
        paths.push({
          label: 'DENO_DIR (macOS default)',
          path: path.join(HOMEDIR, 'Library', 'Caches', 'deno'),
          type: 'data',
          primary: true,
        });
        for (const sub of ['deps', 'gen', 'cache', 'registries', 'node_modules']) {
          paths.push({
            label: `DENO_DIR/${sub}`,
            path: path.join(HOMEDIR, 'Library', 'Caches', 'deno', sub),
            type: sub === 'node_modules' ? 'modules' : 'cache',
          });
        }
      } else if (IS_WINDOWS) {
        if (LOCALAPPDATA) {
          paths.push({
            label: 'DENO_DIR (Windows default)',
            path: path.join(LOCALAPPDATA, 'deno'),
            type: 'data',
            primary: true,
          });
          for (const sub of ['deps', 'gen', 'cache', 'registries', 'node_modules']) {
            paths.push({
              label: `DENO_DIR/${sub}`,
              path: path.join(LOCALAPPDATA, 'deno', sub),
              type: sub === 'node_modules' ? 'modules' : 'cache',
            });
          }
        }
      } else {
        paths.push({
          label: 'DENO_DIR (XDG default)',
          path: path.join(xdgCache, 'deno'),
          type: 'data',
          primary: true,
        });
        paths.push({
          label: 'DENO_DIR (~/.deno fallback)',
          path: path.join(HOMEDIR, '.deno'),
          type: 'data',
        });
        for (const base of [
          path.join(xdgCache, 'deno'),
          path.join(HOMEDIR, '.deno'),
        ]) {
          for (const sub of ['deps', 'gen', 'cache', 'registries', 'node_modules']) {
            paths.push({
              label: `${base.split(path.sep).pop()}/${sub}`,
              path: path.join(base, sub),
              type: sub === 'node_modules' ? 'modules' : 'cache',
            });
          }
        }
        paths.push({
          label: 'data (XDG .local/share/deno)',
          path: path.join(xdgData, 'deno'),
          type: 'data',
        });
      }

      return dedupe(paths);
    },
    primaryCacheLabel: 'cache',
    cleanCmds: function () {
      return [
        {
          label: 'deno cache --reload (clears cache subdir)',
          cmd: 'deno cache --reload',
          needsShell: true,
        },
      ];
    },
    install: {
      mac: 'brew install deno',
      linux: 'curl -fsSL https://deno.land/install.sh | sh',
      windows: 'winget install deno',
      universal: 'curl -fsSL https://deno.land/install.sh | sh',
    },
    uninstall: {
      mac: 'brew uninstall deno',
      linux: 'rm -rf ~/.deno',
      windows: 'winget uninstall deno',
    },
  },

  corepack: {
    name: 'corepack',
    emoji: '📦',
    color: C.yellow,
    isInstalled: function () {
      return Boolean(safeExec('corepack', ['--version']));
    },
    getVersion: function () {
      return safeExec('corepack', ['--version']) || null;
    },
    dataPaths: function () {
      const { xdgCache } = dirsCommon();
      const paths = [];

      if (process.env.COREPACK_HOME) {
        paths.push({
          label: 'COREPACK_HOME',
          path: process.env.COREPACK_HOME,
          type: 'cache',
          primary: true,
        });
      }

      if (IS_MAC) {
        paths.push({
          label: 'corepack (macOS default)',
          path: path.join(HOMEDIR, 'Library', 'Caches', 'node', 'corepack'),
          type: 'cache',
          primary: true,
        });
      } else if (IS_WINDOWS) {
        if (LOCALAPPDATA) {
          paths.push({
            label: 'corepack (Windows default)',
            path: path.join(LOCALAPPDATA, 'node', 'corepack'),
            type: 'cache',
            primary: true,
          });
        }
        if (APPDATA) {
          paths.push({
            label: 'corepack (AppData)',
            path: path.join(APPDATA, 'node', 'corepack'),
            type: 'cache',
          });
        }
      } else {
        paths.push({
          label: 'corepack (Linux XDG)',
          path: path.join(xdgCache, 'node', 'corepack'),
          type: 'cache',
          primary: true,
        });
        paths.push({
          label: 'corepack (~/.cache/node/corepack)',
          path: path.join(HOMEDIR, '.cache', 'node', 'corepack'),
          type: 'cache',
        });
        paths.push({
          label: 'corepack (~/.cache/corepack)',
          path: path.join(HOMEDIR, '.cache', 'corepack'),
          type: 'cache',
        });
        paths.push({
          label: 'corepack (~/.local/share/corepack)',
          path: path.join(HOMEDIR, '.local', 'share', 'corepack'),
          type: 'cache',
        });
      }

      return dedupe(paths);
    },
    primaryCacheLabel: 'data',
    cleanCmds: function () {
      return [];
    },
    install: {
      mac: 'brew install corepack',
      linux: 'npm install -g corepack && corepack enable',
      windows: 'npm install -g corepack && corepack enable',
      universal: 'npm install -g corepack && corepack enable',
    },
    uninstall: {
      mac: 'brew uninstall corepack',
      linux: 'npm uninstall -g corepack',
      windows: 'npm uninstall -g corepack',
    },
  },

  volta: {
    name: 'volta',
    emoji: '⚡',
    color: C.yellow,
    isInstalled: function () {
      return Boolean(safeExec('volta', ['--version']));
    },
    getVersion: function () {
      return safeExec('volta', ['--version']) || null;
    },
    dataPaths: function () {
      const paths = [];

      const voltaHome = process.env.VOLTA_HOME || path.join(HOMEDIR, '.volta');
      paths.push({
        label: 'VOLTA_HOME',
        path: voltaHome,
        type: 'data',
        primary: true,
      });
      paths.push({
        label: 'cache',
        path: path.join(voltaHome, 'cache'),
        type: 'cache',
      });
      paths.push({
        label: 'inventory',
        path: path.join(voltaHome, 'tools', 'inventory'),
        type: 'cache',
      });
      for (const tool of ['node', 'yarn', 'npm', 'pnpm', 'bun']) {
        paths.push({
          label: `image (${tool})`,
          path: path.join(voltaHome, 'tools', 'image', tool),
          type: 'cache',
        });
      }
      paths.push({
        label: 'log',
        path: path.join(voltaHome, 'log'),
        type: 'state',
      });
      paths.push({
        label: 'tmp',
        path: path.join(voltaHome, 'tmp'),
        type: 'state',
      });

      return dedupe(paths);
    },
    primaryCacheLabel: 'cache',
    cleanCmds: function () {
      return [];
    },
    install: {
      mac: 'brew install volta',
      linux: 'curl -fsSL https://get.volta.sh | bash',
      windows: 'winget install Volta.Volta',
      universal: 'curl -fsSL https://get.volta.sh | bash',
    },
    uninstall: {
      mac: 'brew uninstall volta',
      linux: `rm -rf ${shellQuote(safeShellPath(process.env.VOLTA_HOME, path.join(HOMEDIR, '.volta')))}`,
      windows: 'winget uninstall Volta.Volta',
    },
  },
};

// ===================== Path probing =====================
function getPathInfo(pm) {
  const installed = pm.isInstalled();
  const version = installed ? pm.getVersion() : null;
  const rawPaths = installed ? pm.dataPaths() : [];
  const detailed = [];
  let cacheBytes = 0n;
  let modulesBytes = 0n;
  let existing = 0;

  for (const p of rawPaths) {
    const result = dirSize(p.path);
    const exists =
      result.bytes > 0n ||
      result.files > 0 ||
      isRealDir(p.path) ||
      (pathInfo(p.path)?.isFile?.() ?? false);
    detailed.push({
      ...p,
      exists,
      bytes: result.bytes,
      sizeStr: humanSize(result.bytes),
      errors: result.errors,
    });
    if (result.bytes > 0n) {
      if (p.type === 'cache' || p.primary) cacheBytes += result.bytes;
      else if (p.type === 'modules') modulesBytes += result.bytes;
    }
    if (exists) existing++;
  }

  return {
    name: pm.name,
    emoji: pm.emoji,
    color: pm.color,
    installed,
    version,
    paths: detailed,
    cacheBytes,
    modulesBytes,
    totalBytes: cacheBytes,
    totalSize: humanSize(cacheBytes),
    existing,
  };
}

// ===================== Clean operations =====================
function removeDir(p) {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    return true;
  } catch {
    return false;
  }
}

function runShell(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, [], {
      shell: true,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {}
    }, 5 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: killed ? 124 : code });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: 1 });
    });
  });
}

async function cleanPackageManager(info, opts = {}) {
  const { name, paths, installed } = info;
  const pm = packageManagers[name];
  const skipShell = opts.skipShell === true;
  const onlyDeletable = opts.onlyDeletable !== false;

  const targets = paths.filter(
    (p) =>
      p.exists &&
      (!onlyDeletable || p.type === 'cache'),
  );

  if (targets.length === 0) {
    return { ok: true, before: 0n, after: 0n, method: 'noop', removed: 0, error: null };
  }

  const before = targets.reduce((acc, t) => acc + t.bytes, 0n);

  let method = 'none';
  let error = null;
  if (installed && !skipShell) {
    const cmds = pm.cleanCmds();
    for (const c of cmds) {
      if (!c.cmd) continue;
      const res = await runShell(c.cmd);
      if (res.code === 0) {
        method = c.label;
        break;
      }
    }
  }

  if (method === 'none') method = 'direct removal';

  let removed = 0;
  for (const t of targets) {
    if (!isRealDir(t.path) && !pathInfo(t.path)?.isFile?.()) continue;
    if (removeDir(t.path)) removed++;
  }

  let after = 0n;
  for (const t of targets) {
    if (isRealDir(t.path) || pathInfo(t.path)?.isFile?.()) {
      after += dirSize(t.path).bytes;
    }
  }

  if (after > 0n && removed === 0) {
    error = 'Clean commands succeeded but no data was removed';
  }

  return { ok: removed > 0 || before === 0n, before, after, method, removed, error };
}

// ===================== Display =====================
function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

function renderMenu(infoMap) {
  const lines = [];
  lines.push(`${C.bright}${C.cyan}📦 Package Manager Manager${C.reset}`);
  lines.push(`${C.dim}Manage npm, pnpm, bun, yarn, nub, deno, corepack, volta${C.reset}`);
  if (!IS_TTY) lines.push(`${C.dim}(non-interactive mode — confirmations skipped)${C.reset}`);
  lines.push('');

  lines.push(`${C.bright}📊 Status:${C.reset}`);
  for (const info of Object.values(infoMap)) {
    const statusIcon = info.installed ? '✅' : '❌';
    const versionStr = info.installed ? `v${info.version}` : 'not installed';
    const totalStr = info.installed ? `cache: ${info.totalSize}` : '';
    lines.push(
      `  ${info.emoji} ${info.color}${pad(info.name, 9)}${C.reset}: ` +
        `${statusIcon} ${pad(versionStr, 15)} ${totalStr}` +
        (info.installed && info.existing > 1
          ? ` ${C.dim}(${info.existing} locations)${C.reset}`
          : ''),
    );
  }
  return lines;
}

async function showDetails(infoMap) {
  console.log(`\n${C.bright}📂 Detailed locations:${C.reset}`);
  for (const info of Object.values(infoMap)) {
    console.log(
      `\n  ${info.emoji} ${info.color}${info.name}${C.reset} — total ${C.bright}${info.totalSize}${C.reset}`,
    );
    if (info.paths.length === 0) {
      console.log(`    ${C.dim}(no paths to report — not installed?)${C.reset}`);
      continue;
    }
    for (const p of info.paths) {
      const marker = p.primary ? '★' : p.exists ? '•' : '·';
      const tag = p.exists
        ? `${C.bright}${p.sizeStr.padStart(8)}${C.reset}`
        : `${C.dim}${'(missing)'.padStart(8)}${C.reset}`;
      const typeTag = `${C.dim}[${p.type}]${C.reset}`;
      console.log(
        `    ${marker} ${tag}  ${p.label}\n        ${C.dim}${p.path}${C.reset} ${typeTag}`,
      );
    }
  }
  console.log('');
}

async function showMenu(infoMap) {
  if (IS_TTY) console.clear();
  for (const l of renderMenu(infoMap)) console.log(l);
  console.log(`\n${C.dim}${'═'.repeat(64)}${C.reset}\n`);
  console.log(`${C.bright}Actions:${C.reset}`);

  const actions = [];
  const pushAction = (label, run) => {
    actions.push({ key: actions.length + 1, label, run });
    const a = actions[actions.length - 1];
    console.log(`  ${C.green}${a.key}${C.reset}. ${label}`);
  };
  pushAction('Clean All Caches', () => cleanAll(infoMap));
  pushAction('Show All Locations & Sizes', async () => {
    await showDetails(infoMap);
  });
  pushAction('Install Package Manager', () => handleInstall(infoMap));
  pushAction('Uninstall Package Manager', () => handleUninstall(infoMap));

  console.log(`\n${C.dim}${'─'.repeat(64)}${C.reset}`);
  console.log(`${C.bright}Clean specific cache:${C.reset}`);

  for (const info of Object.values(infoMap)) {
    if (info.installed && info.totalBytes > 0n) {
      const label = `Clean ${info.emoji} ${info.name} (${info.totalSize})`;
      const a = { key: actions.length + 1, label, run: () => cleanOne(info) };
      actions.push(a);
      console.log(`  ${C.green}${a.key}${C.reset}. ${label}`);
    }
  }

  console.log(`\n  ${C.red}0${C.reset}. Exit`);
  console.log(`\n${C.dim}${'═'.repeat(64)}${C.reset}`);

  return { actions, maxKey: actions.length };
}

async function cleanAll(infoMap) {
  console.log(`\n${C.yellow}🧹 Cleaning all caches...${C.reset}`);
  const installed = Object.values(infoMap).filter(
    (i) => i.installed && i.totalBytes > 0n,
  );
  if (installed.length === 0) {
    console.log(`${C.blue}ℹ️  No installed package managers with cache.${C.reset}`);
    return;
  }
  let ok = 0;
  for (const info of installed) {
    const r = await cleanPackageManager(info);
    if (r.ok) ok++;
    console.log(
      `  ${r.ok ? C.green + '✅' : C.red + '❌'} ${info.emoji} ${info.name}: ${C.dim}${r.method}${C.reset}  freed ${humanSize(r.before - r.after)}`,
    );
  }
  console.log(`\n${C.green}✅ Cleaned ${ok}/${installed.length} caches.${C.reset}`);
}

async function cleanOne(info) {
  console.log(`\n${C.yellow}🧹 Cleaning ${info.emoji} ${info.name} (${info.totalSize})...${C.reset}`);
  if (!ASSUME_YES) {
    const confirm = await question(
      `${C.yellow}Proceed? (y/N): ${C.reset}`,
    );
    if (!/^y(es)?$/i.test(confirm.trim())) {
      console.log(`${C.blue}ℹ️  Cancelled.${C.reset}`);
      return;
    }
  }
  const r = await cleanPackageManager(info);
  if (r.ok) {
    console.log(
      `${C.green}✅ ${info.emoji} ${info.name} cleaned via ${r.method}. ` +
        `Before ${humanSize(r.before)} → after ${humanSize(r.after)} ` +
        `(freed ${humanSize(r.before - r.after)}).${C.reset}`,
    );
  } else {
    console.log(
      `${C.red}❌ ${info.name} clean failed${r.error ? `: ${r.error}` : ''}.${C.reset}`,
    );
  }
}

async function handleInstall(infoMap) {
  console.log(`\n${C.bright}📥 Install Package Manager${C.reset}\n`);
  const available = Object.values(infoMap).filter((i) => !i.installed);
  if (available.length === 0) {
    console.log(`${C.green}✅ All package managers are already installed!${C.reset}`);
    return;
  }
  available.forEach((info, idx) => {
    console.log(`  ${C.green}${idx + 1}${C.reset}. ${info.emoji} ${info.name}`);
  });
  console.log(`  ${C.red}0${C.reset}. Cancel`);

  const choice = await question(`\n${C.bright}Select package manager to install: ${C.reset}`);
  const idx = parseInt(choice, 10) - 1;
  if (idx < 0 || idx >= available.length) {
    console.log(`${C.blue}ℹ️  Installation cancelled.${C.reset}`);
    return;
  }
  const target = available[idx];
  const pm = packageManagers[target.name];
  await installPackageManager(pm);
}

async function installPackageManager(pm) {
  const platform = PLATFORM;
  const installCmds = pm.install;
  const installCmd = installCmds[platform] || installCmds.universal;

  console.log(`\n${C.yellow}📥 Installing ${pm.emoji} ${pm.name}...${C.reset}`);
  console.log(`${C.dim}Running: ${installCmd}${C.reset}\n`);

  if (
    !ASSUME_YES &&
    /(curl|wget|irm)/i.test(installCmd)
  ) {
    const confirm = await question(
      `${C.yellow}Continue with installation? (y/N): ${C.reset}`,
    );
    if (!/^y(es)?$/i.test(confirm.trim())) {
      console.log(`${C.blue}ℹ️  Installation cancelled.${C.reset}`);
      return false;
    }
  }

  const res = await runShell(installCmd);
  if (res.code === 0) {
    console.log(
      `\n${C.green}✅ ${pm.emoji} ${pm.name} installed successfully!${C.reset}`,
    );
    return true;
  }
  console.log(
    `\n${C.red}❌ Failed to install ${pm.name} (exit ${res.code}).${C.reset}`,
  );
  console.log(`${C.yellow}💡 Try manual installation: ${installCmd}${C.reset}`);
  return false;
}

async function handleUninstall(infoMap) {
  console.log(`\n${C.bright}🗑️  Uninstall Package Manager${C.reset}\n`);
  const installed = Object.values(infoMap).filter((i) => i.installed);
  if (installed.length === 0) {
    console.log(`${C.yellow}⚠️  No package managers installed!${C.reset}`);
    return;
  }
  installed.forEach((info, idx) => {
    console.log(
      `  ${C.green}${idx + 1}${C.reset}. ${info.emoji} ${info.name} (v${info.version}) — total ${info.totalSize}`,
    );
  });
  console.log(`  ${C.red}0${C.reset}. Cancel`);

  const choice = await question(`\n${C.bright}Select package manager to uninstall: ${C.reset}`);
  const idx = parseInt(choice, 10) - 1;
  if (idx < 0 || idx >= installed.length) {
    console.log(`${C.blue}ℹ️  Uninstallation cancelled.${C.reset}`);
    return;
  }
  const target = installed[idx];
  const pm = packageManagers[target.name];

  if (!ASSUME_YES) {
    const confirm = await question(
      `\n${C.red}⚠️  Are you sure you want to uninstall ${target.emoji} ${target.name}? (y/N): ${C.reset}`,
    );
    if (!/^y(es)?$/i.test(confirm.trim())) {
      console.log(`${C.blue}ℹ️  Uninstallation cancelled.${C.reset}`);
      return;
    }
  }

  const ok = await uninstallPackageManager(pm);

  if (ok && !ASSUME_YES) {
    const alsoClean = await question(
      `\n${C.yellow}Also remove leftover data directories (${target.totalSize})? (y/N): ${C.reset}`,
    );
    if (/^y(es)?$/i.test(alsoClean.trim())) {
      const r = await cleanPackageManager(target);
      console.log(
        `${r.ok ? C.green + '✅' : C.yellow + '⚠️'} ` +
          `${target.emoji} ${target.name} leftover data: ${r.removed} locations cleaned, freed ${humanSize(r.before - r.after)}.${C.reset}`,
      );
    }
  }
}

async function uninstallPackageManager(pm) {
  const platform = PLATFORM;
  const uninstallCmds = pm.uninstall;
  const uninstallCmd = uninstallCmds[platform] || uninstallCmds.universal;

  console.log(`\n${C.yellow}🗑️  Uninstalling ${pm.emoji} ${pm.name}...${C.reset}`);
  console.log(`${C.dim}Running: ${uninstallCmd}${C.reset}\n`);

  if (!ASSUME_YES && /(rm -rf|rmdir)/i.test(uninstallCmd)) {
    const confirm = await question(
      `${C.yellow}Are you sure? (y/N): ${C.reset}`,
    );
    if (!/^y(es)?$/i.test(confirm.trim())) {
      console.log(`${C.blue}ℹ️  Uninstallation cancelled.${C.reset}`);
      return false;
    }
  }

  const res = await runShell(uninstallCmd);
  if (res.code === 0) {
    console.log(
      `\n${C.green}✅ ${pm.emoji} ${pm.name} uninstalled successfully!${C.reset}`,
    );
    return true;
  }
  console.log(
    `\n${C.red}❌ Failed to uninstall ${pm.name} (exit ${res.code}).${C.reset}`,
  );
  console.log(`${C.yellow}💡 Try manual uninstallation: ${uninstallCmd}${C.reset}`);
  return false;
}

// ===================== readline =====================
let rl = null;
function getRL() {
  if (rl) return rl;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: IS_TTY,
  });
  return rl;
}

function question(query) {
  return new Promise((resolve) => {
    if (!IS_TTY) {
      process.stdout.write(query);
      let data = '';
      const onData = (chunk) => {
        data += chunk.toString('utf8');
        if (data.includes('\n')) {
          process.stdin.removeListener('data', onData);
          process.stdin.removeListener('end', onEnd);
          resolve(data);
        }
      };
      const onEnd = () => {
        process.stdin.removeListener('data', onData);
        resolve(data);
      };
      try {
        process.stdin.on('data', onData);
        process.stdin.on('end', onEnd);
        if (process.stdin.readableEnded || process.stdin.destroyed) onEnd();
      } catch {
        resolve('');
      }
      return;
    }
    const r = getRL();
    const onClose = () => resolve('');
    r.once('close', onClose);
    r.question(query, (answer) => {
      r.removeListener('close', onClose);
      resolve(answer);
    });
  });
}

let sigintCount = 0;
function installSignalHandlers() {
  process.on('SIGINT', () => {
    sigintCount++;
    if (sigintCount >= 2) {
      console.log(`\n${C.red}Force exit.${C.reset}`);
      cleanup(130);
    } else {
      console.log(`\n${C.yellow}Ctrl+C detected. Press Ctrl+C again to force exit, or choose 0 to quit.${C.reset}`);
    }
  });
  process.on('SIGTERM', () => cleanup(143));
  process.on('uncaughtException', (e) => {
    console.error(`${C.red}❌ Uncaught: ${e?.message || e}${C.reset}`);
    if (e?.stack) console.error(`${C.dim}${e.stack}${C.reset}`);
    cleanup(1);
  });
  process.on('unhandledRejection', (e) => {
    console.error(`${C.red}❌ Unhandled rejection: ${e?.message || e}${C.reset}`);
  });
}

function cleanup(code = 0) {
  try {
    if (rl) rl.close();
  } catch {}
  process.exit(code);
}

// ===================== Main =====================
async function main() {
  installSignalHandlers();

  while (true) {
    const infoMap = {};
    for (const [name, pm] of Object.entries(packageManagers)) {
      try {
        infoMap[name] = getPathInfo(pm);
      } catch (e) {
        infoMap[name] = {
          name,
          emoji: pm.emoji,
          color: pm.color,
          installed: false,
          version: null,
          paths: [],
          cacheBytes: 0n,
          modulesBytes: 0n,
          totalBytes: 0n,
          totalSize: '0B',
          existing: 0,
          error: e.message,
        };
      }
    }

    const { actions, maxKey } = await showMenu(infoMap);
    const answer = await question(
      `${C.bright}Enter your choice (0-${maxKey}): ${C.reset}`,
    );
    const choice = parseInt(answer, 10);

    if (isNaN(choice) || choice < 0 || choice > maxKey) {
      console.log(`${C.red}❌ Invalid choice.${C.reset}`);
      if (IS_TTY) await question(`\nPress Enter to continue...`);
      continue;
    }

    if (choice === 0) {
      console.log(`\n${C.green}👋 Goodbye!${C.reset}`);
      cleanup(0);
    }

    const action = actions.find((a) => a.key === choice);
    if (action) {
      try {
        sigintCount = 0;
        await action.run();
      } catch (e) {
        console.log(`${C.red}❌ Action failed: ${e?.message || e}${C.reset}`);
      }
    }

    if (IS_TTY) await question(`\n${C.dim}Press Enter to continue...${C.reset}`);
  }
}

main().catch((e) => {
  console.error(`${C.red}❌ Fatal: ${e?.message || e}${C.reset}`);
  if (e?.stack) console.error(`${C.dim}${e.stack}${C.reset}`);
  cleanup(1);
});
