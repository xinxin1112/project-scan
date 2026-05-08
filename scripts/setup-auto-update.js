#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const platform = process.platform;
const args = process.argv.slice(2);

let action = null;
let knowledgeBaseDir = null;
let hour = null;
let minute = null;

for (const arg of args) {
  if (['on', 'off', 'status'].includes(arg)) action = arg;
  else if (arg.startsWith('--time=')) {
    const [h, m] = arg.split('=')[1].split(':');
    hour = parseInt(h);
    minute = parseInt(m);
  } else if (!knowledgeBaseDir) {
    knowledgeBaseDir = arg;
  }
}

if (!action) {
  console.error('Usage: setup-auto-update.js <on|off|status> [knowledge-base-dir] [--time=HH:MM]');
  console.error('');
  console.error('Examples:');
  console.error('  setup-auto-update.js on /path/to/kb --time=09:00');
  console.error('  setup-auto-update.js off /path/to/kb');
  console.error('  setup-auto-update.js status');
  process.exit(1);
}

function getTaskName(kbDir) {
  const name = path.basename(kbDir).replace(/[^a-zA-Z0-9-]/g, '-');
  return `project-scan-auto-update-${name}`;
}

function findNodePath() {
  try {
    if (platform === 'win32') {
      return execSync('where node', { encoding: 'utf-8' }).split('\n')[0].trim();
    }
    return execSync('which node', { encoding: 'utf-8' }).trim();
  } catch (e) {
    return 'node';
  }
}

// --- macOS: launchd plist ---

function getLaunchAgentDir() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function getPlistPath(taskName) {
  return path.join(getLaunchAgentDir(), `com.${taskName}.plist`);
}

function createLaunchdTask(kbDir, taskName, h, m) {
  const nodePath = findNodePath();
  const scriptPath = path.resolve(__dirname, 'auto-update.js');
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.${taskName}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>${kbDir}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${h}</integer>
    <key>Minute</key>
    <integer>${m}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(kbDir, '.update-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(kbDir, '.update-stderr.log')}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>`;

  const agentDir = getLaunchAgentDir();
  if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

  const plistPath = getPlistPath(taskName);
  fs.writeFileSync(plistPath, plistContent);

  try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`); } catch (e) {}
  execSync(`launchctl load "${plistPath}"`);

  return plistPath;
}

function removeLaunchdTask(taskName) {
  const plistPath = getPlistPath(taskName);
  if (!fs.existsSync(plistPath)) return false;
  try { execSync(`launchctl unload "${plistPath}"`); } catch (e) {}
  fs.unlinkSync(plistPath);
  return true;
}

function getLaunchdStatus(taskName) {
  const plistPath = getPlistPath(taskName);
  if (!fs.existsSync(plistPath)) return null;
  const content = fs.readFileSync(plistPath, 'utf-8');
  const hourMatch = content.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
  const minMatch = content.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
  if (hourMatch && minMatch) {
    return { hour: parseInt(hourMatch[1]), minute: parseInt(minMatch[1]) };
  }
  return { hour: 0, minute: 0 };
}

// --- Windows: Task Scheduler (schtasks) ---

function getWindowsTaskName(taskName) {
  return `\\${taskName}`;
}

function createWindowsTask(kbDir, taskName, h, m) {
  const nodePath = findNodePath();
  const scriptPath = path.resolve(__dirname, 'auto-update.js');
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  const cmd = `schtasks /Create /F /TN "${taskName}" /TR "\\"${nodePath}\\" \\"${scriptPath}\\" \\"${kbDir}\\"" /SC DAILY /ST ${timeStr}`;
  execSync(cmd, { encoding: 'utf-8' });
  return taskName;
}

function removeWindowsTask(taskName) {
  try {
    execSync(`schtasks /Delete /F /TN "${taskName}"`, { encoding: 'utf-8' });
    return true;
  } catch (e) {
    return false;
  }
}

function getWindowsStatus(taskName) {
  try {
    const output = execSync(`schtasks /Query /TN "${taskName}" /FO CSV /NH`, { encoding: 'utf-8' });
    const timeMatch = output.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      return { hour: parseInt(timeMatch[1]), minute: parseInt(timeMatch[2]) };
    }
    return { hour: 0, minute: 0 };
  } catch (e) {
    return null;
  }
}

// --- Main logic ---

function handleOn() {
  if (!knowledgeBaseDir) {
    console.error('Error: knowledge-base-dir is required for "on" action.');
    process.exit(1);
  }
  if (hour === null || minute === null) {
    console.error('Error: --time=HH:MM is required for "on" action.');
    process.exit(1);
  }

  const absKbDir = path.resolve(knowledgeBaseDir);
  if (!fs.existsSync(absKbDir)) {
    console.error(`Error: directory not found: ${absKbDir}`);
    process.exit(1);
  }

  const taskName = getTaskName(absKbDir);
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  if (platform === 'darwin') {
    const plistPath = createLaunchdTask(absKbDir, taskName, hour, minute);
    console.log(`Auto-update enabled (macOS launchd)`);
    console.log(`  Schedule: daily at ${timeStr}`);
    console.log(`  Plist: ${plistPath}`);
  } else if (platform === 'win32') {
    createWindowsTask(absKbDir, taskName, hour, minute);
    console.log(`Auto-update enabled (Windows Task Scheduler)`);
    console.log(`  Schedule: daily at ${timeStr}`);
    console.log(`  Task: ${taskName}`);
  } else {
    console.error(`Unsupported platform: ${platform}. Only macOS and Windows are supported.`);
    process.exit(1);
  }
}

function handleOff() {
  if (!knowledgeBaseDir) {
    console.error('Error: knowledge-base-dir is required for "off" action.');
    process.exit(1);
  }

  const absKbDir = path.resolve(knowledgeBaseDir);
  const taskName = getTaskName(absKbDir);

  let removed = false;
  if (platform === 'darwin') {
    removed = removeLaunchdTask(taskName);
  } else if (platform === 'win32') {
    removed = removeWindowsTask(taskName);
  }

  if (removed) {
    console.log(`Auto-update disabled. Task "${taskName}" removed.`);
  } else {
    console.log(`No auto-update task found for this knowledge base.`);
  }
}

function handleStatus() {
  if (knowledgeBaseDir) {
    const absKbDir = path.resolve(knowledgeBaseDir);
    const taskName = getTaskName(absKbDir);
    let status = null;

    if (platform === 'darwin') status = getLaunchdStatus(taskName);
    else if (platform === 'win32') status = getWindowsStatus(taskName);

    if (status) {
      const timeStr = `${String(status.hour).padStart(2, '0')}:${String(status.minute).padStart(2, '0')}`;
      console.log(`Auto-update: ENABLED`);
      console.log(`  Schedule: daily at ${timeStr}`);
      console.log(`  Knowledge base: ${absKbDir}`);
    } else {
      console.log(`Auto-update: DISABLED`);
      console.log(`  No scheduled task found for: ${absKbDir}`);
    }
  } else {
    // List all project-scan tasks
    if (platform === 'darwin') {
      const agentDir = getLaunchAgentDir();
      if (fs.existsSync(agentDir)) {
        const plists = fs.readdirSync(agentDir).filter(f => f.startsWith('com.project-scan-auto-update'));
        if (plists.length === 0) {
          console.log('No auto-update tasks configured.');
        } else {
          console.log(`Found ${plists.length} auto-update task(s):`);
          for (const p of plists) {
            console.log(`  - ${p}`);
          }
        }
      }
    } else if (platform === 'win32') {
      try {
        const output = execSync('schtasks /Query /FO CSV /NH', { encoding: 'utf-8' });
        const tasks = output.split('\n').filter(l => l.includes('project-scan-auto-update'));
        if (tasks.length === 0) {
          console.log('No auto-update tasks configured.');
        } else {
          console.log(`Found ${tasks.length} auto-update task(s):`);
          for (const t of tasks) {
            const name = t.split(',')[0].replace(/"/g, '');
            console.log(`  - ${name}`);
          }
        }
      } catch (e) {
        console.log('No auto-update tasks configured.');
      }
    }
  }
}

// Execute
if (action === 'on') handleOn();
else if (action === 'off') handleOff();
else if (action === 'status') handleStatus();
