#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI color codes
const colors = {
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
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

process.on('SIGINT', () => {
  console.log(`\n${colors.green}👋 Goodbye!${colors.reset}`);
  rl.close();
  process.exit(0);
});

function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

// Package manager definitions
const packageManagers = {
  npm: {
    name: 'npm',
    emoji: '📦',
    color: colors.red,
    install: {
      mac: 'brew install npm',
      linux: 'sudo apt install npm || sudo yum install npm',
      windows: 'winget install npm',
      universal: 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && nvm install --lts',
    },
    getVersion: () => {
      try {
        return execSync('npm --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    },
    getCachePath: () => {
      try {
        return execSync('npm config get cache', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return path.join(os.homedir(), '.npm');
      }
    },
    cleanCmd: () => 'npm cache clean --force',
    uninstall: {
      mac: 'brew uninstall npm',
      linux: 'sudo apt remove npm || sudo yum remove npm',
      windows: 'winget uninstall npm',
    },
    isInstalled: function () {
      return Boolean(this.getVersion());
    }
  },
  pnpm: {
    name: 'pnpm',
    emoji: '🔷',
    color: colors.blue,
    install: {
      mac: 'brew install pnpm',
      linux: 'sudo apt install pnpm || sudo yum install pnpm',
      windows: 'winget install pnpm',
      universal: 'curl -fsSL https://get.pnpm.io/install.sh | sh -',
    },
    getVersion: () => {
      try {
        return execSync('pnpm --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    },
    getCachePath: () => {
      try {
        const store = execSync('pnpm store path', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        return store || path.join(os.homedir(), '.pnpm-store');
      } catch {
        return path.join(os.homedir(), '.pnpm-store');
      }
    },
    cleanCmd: () => 'pnpm store prune',
    uninstall: {
      mac: 'brew uninstall pnpm',
      linux: 'sudo apt remove pnpm || sudo yum remove pnpm',
      windows: 'winget uninstall pnpm',
    },
    isInstalled: function () {
      return Boolean(this.getVersion());
    }
  },
  bun: {
    name: 'bun',
    emoji: '🥟',
    color: colors.magenta,
    install: {
      mac: 'brew install bun',
      linux: 'curl -fsSL https://bun.sh/install | bash',
      windows: 'powershell -c "irm bun.sh/install.ps1 | iex"',
      universal: 'curl -fsSL https://bun.sh/install | bash',
    },
    getVersion: () => {
      try {
        return execSync('bun --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    },
    getCachePath: () => {
      const bunHome = process.env.BUN_HOME || path.join(os.homedir(), '.bun');
      return path.join(bunHome, 'install', 'cache');
    },
    cleanCmd: () => 'bun pm cache rm',
    cleanFallback: function () {
      const cachePath = this.getCachePath();
      const platform = getPlatform();
      if (platform === 'windows') {
        return `if exist "${cachePath}" rmdir /s /q "${cachePath}"`;
      }
      return `rm -rf "${cachePath}"`;
    },
    uninstall: {
      mac: 'brew uninstall bun',
      linux: 'rm -rf ~/.bun && rm -rf ~/.bun-version',
      windows: 'rmdir /s /q %USERPROFILE%\\.bun',
    },
    isInstalled: function () {
      return Boolean(this.getVersion());
    }
  },
  yarn: {
    name: 'yarn',
    emoji: '🧶',
    color: colors.cyan,
    install: {
      mac: 'brew install yarn',
      linux: 'sudo apt install yarn || sudo yum install yarn',
      windows: 'winget install yarn',
      universal: 'npm install -g yarn',
    },
    getVersion: () => {
      try {
        return execSync('yarn --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    },
    getCachePath: () => {
      try {
        const folder = execSync('yarn config get cacheFolder', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (folder && folder !== 'undefined') return folder;
        const legacy = execSync('yarn config get cache-folder', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        return (legacy && legacy !== 'undefined') ? legacy : path.join(os.homedir(), '.yarn', 'cache');
      } catch {
        return path.join(os.homedir(), '.yarn', 'cache');
      }
    },
    cleanCmd: () => 'yarn cache clean',
    uninstall: {
      mac: 'brew uninstall yarn',
      linux: 'sudo apt remove yarn || sudo yum remove yarn',
      windows: 'winget uninstall yarn',
    },
    isInstalled: function () {
      return Boolean(this.getVersion());
    }
  },
  nub: {
    name: 'nub',
    emoji: '🪶',
    color: colors.white,
    install: {
      mac: 'brew install nubjs/tap/nub',
      linux: 'curl -fsSL https://nubjs.com/install.sh | bash',
      windows: 'powershell -c "irm https://nubjs.com/install.ps1 | iex"',
      universal: 'npm install -g --ignore-scripts=false @nubjs/nub',
    },
    getVersion: () => {
      try {
        return execSync('nub --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    },
    getCachePath: () => {
      const xdgCache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
      return path.join(xdgCache, 'nub');
    },
    cleanCmd: () => 'nub pm cache clear',
    uninstall: {
      mac: 'brew uninstall nubjs/tap/nub',
      linux: 'npm uninstall -g @nubjs/nub || rm -rf ~/.nub',
      windows: 'npm uninstall -g @nubjs/nub',
    },
    isInstalled: function () {
      return Boolean(this.getVersion());
    }
  }
};

function getPlatform() {
  const platform = os.platform();
  if (platform === 'darwin') return 'mac';
  if (platform === 'linux') return 'linux';
  if (platform === 'win32') return 'windows';
  return 'universal';
}

function humanSize(bytes) {
  if (bytes <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

function dirSize(target) {
  let total = 0;
  let stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          total += fs.statSync(full).size;
        }
      } catch {
        continue;
      }
    }
  }
  return total;
}

function getCacheSize(cachePath) {
  try {
    if (!cachePath || !fs.existsSync(cachePath)) {
      return '0B';
    }
    const stat = fs.statSync(cachePath);
    if (stat.isDirectory()) {
      return humanSize(dirSize(cachePath));
    }
    return humanSize(stat.size);
  } catch {
    return '0B';
  }
}

function getPackageManagerInfo(pm) {
  const version = pm.getVersion();
  const installed = Boolean(version);
  const cachePath = installed ? pm.getCachePath() : null;
  const cacheSize = installed && cachePath ? getCacheSize(cachePath) : 'N/A';

  return {
    name: pm.name,
    emoji: pm.emoji,
    installed,
    version,
    cachePath,
    cacheSize,
    color: pm.color,
  };
}

async function installPackageManager(pm) {
  const platform = getPlatform();
  const installCmds = pm.install;
  let installCmd = installCmds[platform] || installCmds.universal;

  console.log(`\n${colors.yellow}📥 Installing ${pm.emoji} ${pm.name}...${colors.reset}`);
  console.log(`${colors.dim}Running: ${installCmd}${colors.reset}\n`);

  try {
    // For universal installs that might need user interaction
    if (installCmd.includes('curl') || installCmd.includes('wget')) {
      console.log(`${colors.blue}ℹ️  This installation may require your interaction.${colors.reset}`);
      const confirm = await question(`${colors.yellow}Continue with installation? (y/N): ${colors.reset}`);
      if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log(`${colors.blue}ℹ️  Installation cancelled.${colors.reset}`);
        return false;
      }
    }

    // Execute the install command
    const child = spawn(installCmd, [], {
      shell: true,
      stdio: 'inherit',
      env: process.env
    });

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Installation failed with code ${code}`));
        }
      });
      child.on('error', reject);
    });

    console.log(`\n${colors.green}✅ ${pm.emoji} ${pm.name} installed successfully!${colors.reset}`);
    return true;
  } catch (error) {
    console.log(`\n${colors.red}❌ Failed to install ${pm.name}: ${error.message}${colors.reset}`);
    console.log(`${colors.yellow}💡 Try manual installation: ${installCmd}${colors.reset}`);
    return false;
  }
}

async function uninstallPackageManager(pm) {
  const platform = getPlatform();
  const uninstallCmds = pm.uninstall;
  let uninstallCmd = uninstallCmds[platform] || uninstallCmds.universal;

  console.log(`\n${colors.yellow}🗑️  Uninstalling ${pm.emoji} ${pm.name}...${colors.reset}`);
  console.log(`${colors.dim}Running: ${uninstallCmd}${colors.reset}\n`);

  try {
    // For manual uninstall commands that might need user interaction
    if (uninstallCmd.includes('rm -rf') || uninstallCmd.includes('rmdir')) {
      console.log(`${colors.red}⚠️  This will delete ${pm.name} and its associated files.${colors.reset}`);
      const confirm = await question(`${colors.yellow}Are you sure? (y/N): ${colors.reset}`);
      if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log(`${colors.blue}ℹ️  Uninstallation cancelled.${colors.reset}`);
        return false;
      }
    }

    const child = spawn(uninstallCmd, [], {
      shell: true,
      stdio: 'inherit',
      env: process.env
    });

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Uninstallation failed with code ${code}`));
        }
      });
      child.on('error', reject);
    });

    console.log(`\n${colors.green}✅ ${pm.emoji} ${pm.name} uninstalled successfully!${colors.reset}`);
    return true;
  } catch (error) {
    console.log(`\n${colors.red}❌ Failed to uninstall ${pm.name}: ${error.message}${colors.reset}`);
    console.log(`${colors.yellow}💡 Try manual uninstallation: ${uninstallCmd}${colors.reset}`);
    return false;
  }
}

async function cleanCache(pm) {
  const cachePath = pm.getCachePath();
  const size = getCacheSize(cachePath);

  console.log(`\n${colors.yellow}🧹 Cleaning ${pm.emoji} ${pm.name} cache...${colors.reset}`);
  console.log(`${colors.dim}Cache path: ${cachePath}${colors.reset}`);
  console.log(`${colors.dim}Cache size: ${size}${colors.reset}\n`);

  try {
    if (!fs.existsSync(cachePath)) {
      console.log(`${colors.blue}ℹ️  Cache directory doesn't exist. Nothing to clean.${colors.reset}`);
      return true;
    }

    try {
      execSync(pm.cleanCmd(), {
        encoding: 'utf8',
        stdio: 'inherit',
      });
    } catch (primaryError) {
      if (pm.cleanFallback) {
        console.log(`${colors.yellow}⚠️  Primary clean command failed, trying direct cache removal...${colors.reset}`);
        execSync(pm.cleanFallback(), {
          encoding: 'utf8',
          stdio: 'inherit',
        });
      } else {
        throw primaryError;
      }
    }

    const newSize = getCacheSize(cachePath);
    console.log(`\n${colors.green}✅ ${pm.emoji} ${pm.name} cache cleaned! (${size} → ${newSize})${colors.reset}`);
    return true;
  } catch (error) {
    console.log(`\n${colors.red}❌ Failed to clean ${pm.name} cache: ${error.message}${colors.reset}`);
    return false;
  }
}

async function showMenu() {
  console.clear();
  console.log(`${colors.bright}${colors.cyan}📦 Package Manager Manager${colors.reset}`);
  console.log(`${colors.dim}Manage npm, pnpm, bun, yarn, and nub${colors.reset}\n`);
  console.log(`${colors.dim}${'═'.repeat(60)}${colors.reset}\n`);

  // Show status of all package managers
  console.log(`${colors.bright}📊 Status:${colors.reset}\n`);

  const pmList = Object.values(packageManagers);
  const infoMap = {};
  let optionNum = 1;

  pmList.forEach(pm => {
    const info = getPackageManagerInfo(pm);
    infoMap[pm.name] = info;
    const statusIcon = info.installed ? '✅' : '❌';
    const versionStr = info.installed ? `v${info.version}` : 'not installed';
    const cacheStr = info.installed ? `cache: ${info.cacheSize}` : '';

    console.log(
      `  ${pm.emoji} ${pm.color}${pm.name.padEnd(6)}${colors.reset}: ` +
      `${statusIcon} ${versionStr.padEnd(15)} ${cacheStr}`
    );
  });

  console.log(`\n${colors.dim}${'═'.repeat(60)}${colors.reset}\n`);
  console.log(`${colors.bright}Actions:${colors.reset}`);

  console.log(`  ${colors.green}${optionNum}${colors.reset}. Clean All Caches`);
  optionNum++;

  console.log(`  ${colors.green}${optionNum}${colors.reset}. Install Package Manager`);
  const installOption = optionNum;
  optionNum++;

  console.log(`  ${colors.green}${optionNum}${colors.reset}. Uninstall Package Manager`);
  const uninstallOption = optionNum;
  optionNum++;

  // Clean cache options for installed managers
  console.log(`\n${colors.dim}${'─'.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}Clean specific cache:${colors.reset}`);

  const cleanOptions = {};
  pmList.forEach(pm => {
    const info = infoMap[pm.name];
    if (info.installed) {
      cleanOptions[optionNum] = pm.name;
      console.log(`  ${colors.green}${optionNum}${colors.reset}. Clean ${pm.emoji} ${pm.name} cache (${info.cacheSize})`);
      optionNum++;
    }
  });

  console.log(`\n  ${colors.red}0${colors.reset}. Exit`);
  console.log(`\n${colors.dim}${'═'.repeat(60)}${colors.reset}`);

  return { infoMap, optionNum, installOption, uninstallOption, cleanOptions };
}

async function handleInstall(infoMap) {
  console.log(`\n${colors.bright}📥 Install Package Manager${colors.reset}\n`);

  const pmList = Object.values(packageManagers);
  const available = pmList.filter(pm => !infoMap[pm.name].installed);

  if (available.length === 0) {
    console.log(`${colors.green}✅ All package managers are already installed!${colors.reset}`);
    return;
  }

  available.forEach((pm, index) => {
    console.log(`  ${colors.green}${index + 1}${colors.reset}. ${pm.emoji} ${pm.name}`);
  });
  console.log(`  ${colors.red}0${colors.reset}. Cancel`);

  const choice = await question(`\n${colors.bright}Select package manager to install: ${colors.reset}`);
  const idx = parseInt(choice) - 1;

  if (idx >= 0 && idx < available.length) {
    await installPackageManager(available[idx]);
  } else {
    console.log(`${colors.blue}ℹ️  Installation cancelled.${colors.reset}`);
  }
}

async function handleUninstall(infoMap) {
  console.log(`\n${colors.bright}🗑️  Uninstall Package Manager${colors.reset}\n`);

  const pmList = Object.values(packageManagers);
  const installed = pmList.filter(pm => infoMap[pm.name].installed);

  if (installed.length === 0) {
    console.log(`${colors.yellow}⚠️  No package managers are installed!${colors.reset}`);
    return;
  }

  installed.forEach((pm, index) => {
    console.log(`  ${colors.green}${index + 1}${colors.reset}. ${pm.emoji} ${pm.name} (v${pm.getVersion()})`);
  });
  console.log(`  ${colors.red}0${colors.reset}. Cancel`);

  const choice = await question(`\n${colors.bright}Select package manager to uninstall: ${colors.reset}`);
  const idx = parseInt(choice) - 1;

  if (idx >= 0 && idx < installed.length) {
    const confirm = await question(`\n${colors.red}⚠️  Are you sure you want to uninstall ${installed[idx].emoji} ${installed[idx].name}? (y/N): ${colors.reset}`);
    if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
      await uninstallPackageManager(installed[idx]);
    } else {
      console.log(`${colors.blue}ℹ️  Uninstallation cancelled.${colors.reset}`);
    }
  } else {
    console.log(`${colors.blue}ℹ️  Uninstallation cancelled.${colors.reset}`);
  }
}

async function main() {
  try {
    while (true) {
      const { infoMap, optionNum, installOption, uninstallOption, cleanOptions } = await showMenu();

      const answer = await question(`${colors.bright}Enter your choice (0-${optionNum - 1}): ${colors.reset}`);
      const choice = parseInt(answer);

      if (isNaN(choice) || choice < 0 || choice >= optionNum) {
        console.log(`${colors.red}❌ Invalid choice. Please try again.${colors.reset}`);
        await question(`\nPress Enter to continue...`);
        continue;
      }

      if (choice === 0) {
        console.log(`\n${colors.green}👋 Goodbye!${colors.reset}`);
        break;
      }

      if (choice === 1) {
        // Clean all caches
        console.log(`\n${colors.yellow}🧹 Cleaning all caches...${colors.reset}`);
        const pmList = Object.values(packageManagers);
        const installedPms = pmList.filter(pm => infoMap[pm.name].installed);
        let successCount = 0;

        for (const pm of installedPms) {
          const success = await cleanCache(pm);
          if (success) successCount++;
        }

        console.log(`\n${colors.green}✅ Cleaned ${successCount}/${installedPms.length} caches successfully!${colors.reset}`);
      } else if (choice === installOption) {
        await handleInstall(infoMap);
      } else if (choice === uninstallOption) {
        await handleUninstall(infoMap);
      } else if (cleanOptions[choice]) {
        // Clean specific cache
        const pmName = cleanOptions[choice];
        const pm = packageManagers[pmName];
        await cleanCache(pm);
      }

      await question(`\n${colors.dim}Press Enter to continue...${colors.reset}`);
    }

  } catch (error) {
    console.error(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
    if (error.stack) {
      console.error(`${colors.dim}${error.stack}${colors.reset}`);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the main function
main();
