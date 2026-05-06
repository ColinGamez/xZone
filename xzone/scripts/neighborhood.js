'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { TextDecoder } = require('util');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outputEncoding = process.env.XDK_OUTPUT_ENCODING || 'shift_jis';
const defaultXdkBin = path.join(
  process.env.XDK_BIN ||
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Xbox 360 SDK', 'bin', 'win32')
);

const help = `
Xbox 360 Neighborhood helper for xZone.

Usage:
  npm run xbox:status -- [--target 192.168.2.83]
  npm run xbox:dir -- xY:\\ [--target 192.168.2.83]
  npm run xbox:capture -- [output.bmp] [--target 192.168.2.83]

Environment:
  XBOX_TARGET          Optional Neighborhood target IP/name.
  XDK_BIN              Optional folder containing xbdir.exe, xbcapture.exe, etc.
  XDK_OUTPUT_ENCODING  Optional XDK output encoding, default shift_jis.
`;

function parseArgs(argv) {
  const parsed = {
    command: 'status',
    target: process.env.XBOX_TARGET || '',
    rest: [],
  };

  const args = [...argv];
  if (args[0] && !args[0].startsWith('--')) {
    parsed.command = args.shift();
  }

  while (args.length) {
    const arg = args.shift();
    if (arg === '--target' || arg === '/X') {
      parsed.target = args.shift() || '';
    } else if (arg.startsWith('--target=')) {
      parsed.target = arg.slice('--target='.length);
    } else {
      parsed.rest.push(arg);
    }
  }

  return parsed;
}

function toolPath(name) {
  const fullPath = path.join(defaultXdkBin, name);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Could not find ${name}. Set XDK_BIN if the Xbox 360 SDK is installed somewhere else.`);
  }
  return fullPath;
}

function targetArgs(target) {
  return target ? [`/X:${target}`] : [];
}

function runTool(name, args, options = {}) {
  const result = spawnSync(toolPath(name), args, {
    cwd: root,
    encoding: 'buffer',
  });

  const decoder = new TextDecoder(outputEncoding);
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .map(buffer => decoder.decode(buffer))
    .join('');
  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${name} exited with ${result.status}\n${output}`);
  }

  return {
    status: result.status,
    output,
  };
}

function printBlock(title, body) {
  console.log(`\n== ${title} ==`);
  console.log(String(body || '').trim() || '(no output)');
}

function localIPv4s() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(addr => addr && addr.family === 'IPv4' && !addr.internal)
    .map(addr => addr.address);
}

function detectTarget(output, explicitTarget) {
  if (explicitTarget) return explicitTarget;
  const match = String(output || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  return match ? match[0] : '';
}

function summarizeDir(output) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const summary = lines.filter(line => (
    !line.startsWith('Xbox 360 target system') &&
    !line.includes('File Not Found') &&
    !line.startsWith('xbdir:')
  ));

  return summary.slice(0, 8).join('\n');
}

function recentRequestsForTarget(target) {
  if (!target) return [];
  const logPath = path.join(root, 'logs', 'all-requests.jsonl');
  if (!fs.existsSync(logPath)) return [];

  return fs.readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter(record => String(record.ip || '').includes(target))
    .slice(-10)
    .reverse();
}

function checkPort(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function status(command) {
  console.log(`XDK tools: ${defaultXdkBin}`);
  console.log(`Requested target: ${command.target || '(Neighborhood default)'}`);

  const type = runTool('xbconsoletype.exe', targetArgs(command.target), { allowFailure: true });
  printBlock('Console Type', type.output);
  const target = detectTarget(type.output, command.target);

  if (target) {
    const open = await checkPort(target, 730);
    console.log(`\nNeighborhood port 730: ${open ? 'open' : 'not reachable'}`);
  }

  console.log('\nxZone probe URLs from this PC:');
  for (const address of localIPv4s()) {
    console.log(`  http://${address}:3000/probe.txt`);
  }

  printBlock('Mounted Drive Summary', driveSummary(command.target));

  const requests = recentRequestsForTarget(target);
  if (requests.length) {
    printBlock(
      `Recent xZone Requests From ${target}`,
      requests.map(record => `${record.timestamp} ${record.method} ${record.originalUrl} ${record.statusCode}`).join('\n')
    );
  } else {
    printBlock(`Recent xZone Requests From ${target || 'Xbox'}`, 'none yet');
  }
}

function driveSummary(target) {
  const drives = ['C', 'D', 'E', 'H', 'S', 'U', 'Y'];
  return drives.map(letter => {
    const xboxPath = `x${letter}:\\`;
    const result = runTool('xbdir.exe', [...targetArgs(target), xboxPath], { allowFailure: true });
    return `${xboxPath}\n${summarizeDir(result.output) || '(empty or unavailable)'}`;
  }).join('\n\n');
}

function dir(command) {
  const xboxPath = command.rest[0] || 'xY:\\';
  if (!/^x[a-z]:\\/i.test(xboxPath)) {
    throw new Error(`Expected an Xbox path like xY:\\, got ${xboxPath}`);
  }

  const result = runTool('xbdir.exe', [...targetArgs(command.target), xboxPath], { allowFailure: true });
  process.stdout.write(result.output);
  process.exitCode = result.status === 0 ? 0 : 1;
}

function capture(command) {
  const output = path.resolve(root, command.rest[0] || path.join('test-results', 'xbox-current.bmp'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const result = runTool('xbcapture.exe', [...targetArgs(command.target), output], { allowFailure: true });
  process.stdout.write(result.output);
  if (result.status !== 0) {
    process.exitCode = 1;
    return;
  }

  const file = fs.statSync(output);
  console.log(`Captured ${output} (${file.size} bytes)`);
}

async function main() {
  const command = parseArgs(process.argv.slice(2));
  if (command.command === 'help' || command.command === '--help' || command.command === '/?') {
    console.log(help.trim());
    return;
  }

  if (command.command === 'status') return status(command);
  if (command.command === 'dir') return dir(command);
  if (command.command === 'capture') return capture(command);

  throw new Error(`Unknown command "${command.command}". Run with "help" for usage.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
