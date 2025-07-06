const fs = require('fs');
const yaml = require('js-yaml');
const { spawn } = require('child_process');
const notifier = require('node-notifier');
const express = require('express');
const readline = require('readline');
const { Writable } = require('stream');

const app = express();
const PORT = 3000;
const clients = [];

app.use(express.json());

app.post('/api/cmd', (req, res) => {
  const { cmd, args } = req.body;
  // Simulate CLI input
  rl.emit('line', [cmd, ...(args || [])].join(' '));
  res.json({ ok: true });
});


// --- SSE endpoint for real-time updates ---
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();
  clients.push(res);

  req.on('close', () => {
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
  });
});

function broadcastStatus() {
  const status = {};
  for (const name of Object.keys(programsConfig)) {
    const instances = runningProcesses[name] || [];
    status[name] = [];
    const count = programsConfig[name].numprocs || 1;
    for (let idx = 0; idx < count; idx++) {
      const meta = instances[idx];
      status[name].push({
        index: idx,
        pid: meta && meta.child ? meta.child.pid : '-',
        status: meta && meta.child && meta.child.exitCode === null
          ? 'RUNNING'
          : (meta && meta.child ? `EXITED (${meta.child.exitCode})` : 'NOT STARTED')
      });
    }
  }
  const data = `data: ${JSON.stringify(status)}\n\n`;
  clients.forEach(res => res.write(data));
}

app.get('/status', (req, res) => {
  const status = {};
  for (const name of Object.keys(programsConfig)) {
    const instances = runningProcesses[name] || [];
    status[name] = [];
    const count = programsConfig[name].numprocs || 1;
    for (let idx = 0; idx < count; idx++) {
      const meta = instances[idx];
      status[name].push({
        index: idx,
        pid: meta && meta.child ? meta.child.pid : '-',
        status: meta && meta.child && meta.child.exitCode === null
          ? 'RUNNING'
          : (meta && meta.child ? `EXITED (${meta.child.exitCode})` : 'NOT STARTED')
      });
    }
  }
  // If browser, show HTML, else JSON
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    let html = `<h1>Taskmaster Status</h1><table border="1" cellpadding="5"><tr><th>Program</th><th>Instance</th><th>PID</th><th>Status</th></tr>`;
    for (const [name, arr] of Object.entries(status)) {
      arr.forEach(inst => {
        html += `<tr>
          <td>${name}</td>
          <td>#${inst.index}</td>
          <td>${inst.pid}</td>
          <td>${inst.status}</td>
        </tr>`;
      });
    }
    html += `</table>`;
    res.send(html);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(status, null, 2));
  }
});

// --- Improved HTML dashboard with live updates ---
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Taskmaster Dashboard</title>
</head>
<body>
  <h1>Taskmaster Dashboard (Live)</h1>
  <table id="status" border="1" cellpadding="5">
    <tr><th>Program</th><th>Instance</th><th>PID</th><th>Status</th><th>Actions</th></tr>
  </table>
  <script>
    function render(status) {
      const table = document.getElementById('status');
      table.innerHTML = '<tr><th>Program</th><th>Instance</th><th>PID</th><th>Status</th><th>Actions</th></tr>';
      let hasRows = false;
      for (const [name, arr] of Object.entries(status)) {
        arr.forEach(inst => {
          hasRows = true;
          table.innerHTML += '<tr>' +
            '<td>' + name + '</td>' +
            '<td>#' + inst.index + '</td>' +
            '<td>' + inst.pid + '</td>' +
            '<td>' + inst.status + '</td>' +
            '<td>' +
              '<button onclick="sendCmd(\\'start\\', \\''
                + name + '\\',' + inst.index + ')">Start</button> ' +
              '<button onclick="sendCmd(\\'stop\\', \\''
                + name + '\\',' + inst.index + ')">Stop</button> ' +
              '<button onclick="sendCmd(\\'restart\\', \\''
                + name + '\\',' + inst.index + ')">Restart</button>' +
            '</td>' +
            '</tr>';
        });
      }
      if (!hasRows) {
        table.innerHTML += '<tr><td colspan="5">No processes found.</td></tr>';
      }
    }
    function sendCmd(cmd, name, idx) {
      fetch('/api/cmd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, args: [name, idx] })
      });
    }
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
      render(JSON.parse(event.data));
    };
    fetch('/status').then(r => r.json()).then(render);
  </script>
</body>
</html>`;
  res.send(html);
});


app.listen(PORT, () => {
  // console.log(`🌐 Web dashboard running at http://localhost:${PORT}/`);
});


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'taskmaster> ',
  completer
});

function loadConfig(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const config = yaml.load(fileContent);
    return config.programs || {};
  } catch (err) {
    console.error('---Error loading configuration file:', err);
    process.exit(1);
  }
}

const programsConfig = loadConfig('./config.yaml');
const runningProcesses = {};

const commands = ['status', 'start', 'stop', 'restart', 'reload', 'exit'];
const programNames = Object.keys(programsConfig);

function completer(line) {
  const completions = commands.concat(Object.keys(programsConfig));
  const hits = completions.filter(c => c.startsWith(line));
  return [hits.length ? hits : completions, line];
}

function isRuntimeConfigChanged(oldDef, newDef) {
  const keysToCheck = ['cmd', 'workingdir', 'env', 'umask', 'stdout', 'stderr'];
  return keysToCheck.some(key => JSON.stringify(oldDef[key]) !== JSON.stringify(newDef[key]));
}

const MAX_LOG_SIZE = 1024 * 1;
const MAX_LOG_FILES = 5; // Keep up to 10 rotated logs

class RotatingWriteStream extends Writable {
  constructor(logPath, maxSize, maxFiles) {
    super();
    this.logPath = logPath;
    this.maxSize = maxSize;
    this.maxFiles = maxFiles;
    this.currentSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    this.stream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  _rotate() {
    this.stream.end();
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = `${this.logPath}.${i}`;
      const dest = `${this.logPath}.${i + 1}`;
      if (fs.existsSync(src)) fs.renameSync(src, dest);
    }
    if (fs.existsSync(this.logPath)) {
      fs.renameSync(this.logPath, `${this.logPath}.1`);
    }
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
    this.currentSize = 0;
  }

  _write(chunk, encoding, callback) {
    this.currentSize += Buffer.byteLength(chunk);
    if (this.currentSize > this.maxSize) {
      this._rotate();
      this.currentSize += Buffer.byteLength(chunk); // after rotation, add chunk size
    }
    this.stream.write(chunk, encoding, callback);
  }

  end(...args) {
    this.stream.end(...args);
  }
}

function startProcess(programName, config, index, retries = 0) {
  const {
    cmd,
    workingdir,
    env = {},
    umask,
    stdout,
    stderr,
    exitcodes = [0],
    autorestart = 'never',
    startretries = 0,
    starttime = 0
  } = config;

  const [exec, ...args] = cmd.split(' ');

  const stdoutStream = new RotatingWriteStream(stdout, MAX_LOG_SIZE, MAX_LOG_FILES);
  const stderrStream = new RotatingWriteStream(stderr, MAX_LOG_SIZE, MAX_LOG_FILES);

  if (umask !== undefined) {
    process.umask(parseInt(umask, 8));
  }

  const child = spawn(exec, args, {
    cwd: workingdir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  child.stdout.pipe(stdoutStream);
  child.stderr.pipe(stderrStream);

  console.log(`Started [${programName}] instance ${index}, PID: ${child.pid}`);
  rl.prompt();
  broadcastStatus();

  const processMeta = {
    child,
    retries,
    startTime: Date.now(),
    config,
    stopping: false
  };

  if (!runningProcesses[programName]) runningProcesses[programName] = [];
  runningProcesses[programName][index] = processMeta;

  child.on('exit', (code, signal) => {
    // Removed process exit log and checkAllExited

    const meta = runningProcesses[programName] && runningProcesses[programName][index];
    if (meta && meta.stopping) {
      meta.stopping = false;
      return;
    }

    broadcastStatus();

    const expected = exitcodes.includes(code);
    const isRestartable =
      (autorestart === 'always') ||
      (autorestart === 'unexpected' && !expected);

    if (!expected) {
      notifier.notify({
        title: 'Taskmaster: Process Exited Unexpectedly',
        message: `[${programName}] instance #${index} exited with code ${code}`,
        sound: true
      });
    }

    if (isRestartable) {
      if (retries < startretries) {
        console.log(`Restarting [${programName}] #${index} (attempt ${retries + 1}/${startretries})`);
        rl.prompt();
        setTimeout(() => {
          startProcess(programName, config, index, retries + 1);
        }, starttime * 1000);
      } else {
        console.warn(`❌ Max retries reached for [${programName}] #${index}. Giving up.`);
        rl.prompt();
      }
    }
    // No checkAllExited here
  });

  return child;
}

// Initial launch: start only programs with autostart: true
for (const [programName, config] of Object.entries(programsConfig)) {
  runningProcesses[programName] = [];
  if (config.autostart) { // Only start if autostart is true
    const count = config.numprocs || 1;
    for (let i = 0; i < count; i++) {
      startProcess(programName, config, i);
    }
  }
}

function reloadConfig() {
  const newConfig = loadConfig('./config.yaml');

  // Add new or update existing programs
  for (const [name, newDef] of Object.entries(newConfig)) {
    const oldDef = programsConfig[name];
    const oldInstances = runningProcesses[name] || [];

    // New program
    if (!oldDef) {
      console.log(`➕ [${name}] New program. Starting ${newDef.numprocs} instance(s).`);
      runningProcesses[name] = [];
      for (let i = 0; i < newDef.numprocs; i++) {
        startProcess(name, newDef, i);
      }
      continue;
    }

    // Changed runtime config: restart all
    if (isRuntimeConfigChanged(oldDef, newDef)) {
      console.log(`🔄 [${name}] Config changed. Restarting all instances.`);
      oldInstances.forEach((meta, idx) => {
        if (meta) {
          meta.stopping = true;
          console.log(`   ⏹️ Stopping [${name}] instance #${idx}`);
          meta.child.kill();
        }
      });
      setTimeout(() => {
        runningProcesses[name] = [];
        for (let i = 0; i < newDef.numprocs; i++) {
          startProcess(name, newDef, i);
        }
      }, 100);
      continue;
    }

    // Scaling up
    if (newDef.numprocs > oldInstances.length) {
      console.log(`🔁 [${name}] Scaling up from ${oldInstances.length} to ${newDef.numprocs}.`);
      for (let i = oldInstances.length; i < newDef.numprocs; i++) {
        startProcess(name, newDef, i);
      }
    }

    // Scaling down
    if (newDef.numprocs < oldInstances.length) {
      console.log(`🔁 [${name}] Scaling down from ${oldInstances.length} to ${newDef.numprocs}.`);
      for (let i = newDef.numprocs; i < oldInstances.length; i++) {
        if (oldInstances[i]) {
          oldInstances[i].stopping = true;
          console.log(`   ⏹️ Stopping [${name}] instance #${i}`);
          oldInstances[i].child.kill();
        }
      }
      runningProcesses[name] = oldInstances.slice(0, newDef.numprocs);
    }

    // Unchanged
    if (
      !isRuntimeConfigChanged(oldDef, newDef) &&
      newDef.numprocs === oldInstances.length
    ) {
      console.log(`✅ [${name}] Unchanged. No action needed.`);
    }
  }

  // Remove deleted programs
  for (const name of Object.keys(programsConfig)) {
    if (!newConfig[name]) {
      console.log(`➖ [${name}] Removed. Stopping all instances.`);
      (runningProcesses[name] || []).forEach((meta, idx) => {
        if (meta) {
          meta.stopping = true;
          console.log(`   ⏹️ Stopping [${name}] instance #${idx}`);
          meta.child.kill();
        }
      });
      setTimeout(() => {
        delete runningProcesses[name];
      }, 100);
    }
  }

  // Sync programsConfig
  for (const key of Object.keys(programsConfig)) {
    if (!newConfig[key]) delete programsConfig[key];
  }
  Object.assign(programsConfig, newConfig);

  console.log('🔁 Reload complete.');
  rl.prompt();
  broadcastStatus(); 
}

process.on('SIGHUP', () => {
  console.log('🔁 Received SIGHUP: Reloading config...');
  reloadConfig();
});

fs.watchFile('./config.yaml', { interval: 500 }, (curr, prev) => {
  if (curr.mtime !== prev.mtime) {
    console.log('🔁 Detected config.yaml change: Reloading config...');
    reloadConfig();
  }
});

function showStatus(programName) {
  if (programName) {
    const instances = runningProcesses[programName];
    if (!instances) {
      console.log(`No such program: ${programName}`);
      return;
    }
    instances.forEach((meta, idx) => {
      if (!meta) return;
      const status = meta.child.exitCode === null ? 'RUNNING' : `EXITED (${meta.child.exitCode})`;
      console.log(`[${programName}] #${idx} PID: ${meta.child.pid} - ${status}`);
    });
  } else {
    for (const [name, instances] of Object.entries(runningProcesses)) {
      instances.forEach((meta, idx) => {
        if (!meta) return;
        const status = meta.child.exitCode === null ? 'RUNNING' : `EXITED (${meta.child.exitCode})`;
        console.log(`[${name}] #${idx} PID: ${meta.child.pid} - ${status}`);
      });
    }
  }
}

function stopProcess(name, idx) {
  const meta = runningProcesses[name] && runningProcesses[name][idx];
  if (!meta) {
    console.log(`No such instance #${idx} for [${name}]`);
    rl.prompt();
    return;
  }
  if (meta.child.exitCode !== null) {
    console.log(`Instance #${idx} for [${name}] is not running`);
    rl.prompt();
    return;
  }
  meta.stopping = true;
  meta.child.once('exit', () => {
    console.log(`⏹️ Stopped [${name}] instance #${idx}`);
    rl.prompt();
    broadcastStatus();
  });
  meta.child.kill();
  setTimeout(() => {
    if (meta.child.exitCode === null) {
      meta.child.kill('SIGKILL');
    }
  }, 2000);
}

function startSingleProcess(name, idx) {
  const config = programsConfig[name];
  if (!config) return console.log(`No such program: ${name}`);

  if (!runningProcesses[name]) runningProcesses[name] = [];

  const existing = runningProcesses[name][idx];
  if (existing && existing.child && existing.child.exitCode === null) {
    return console.log(`[${name}] instance #${idx} is already running.`);
  }

  // Otherwise, start new process at that index
  const proc = startProcess(name, config, idx);
  // console.log(`▶️ Started [${name}] instance #${idx} (PID: ${proc.pid})`);
  broadcastStatus();
}

function restartProcess(name, idx) {
  const meta = runningProcesses[name] && runningProcesses[name][idx];
  if (!meta || meta.child.exitCode !== null) {
    console.log(`No running instance #${idx} for [${name}]`);
    return;
  }
  meta.stopping = true;
  meta.child.once('exit', () => {
    startSingleProcess(name, idx);
  });
  stopProcess(name, idx);
}

function stopAll(name) {
  const instances = runningProcesses[name];
  if (!instances) {
    console.log(`No such program: ${name}`);
    rl.prompt();
    return;
  }
  let any = false;
  let pending = 0;
  instances.forEach((meta, idx) => {
    if (meta && meta.child.exitCode === null) {
      any = true;
      pending++;
      meta.stopping = true;
      meta.child.once('exit', () => {
        console.log(`⏹️ Stopped [${name}] instance #${idx}`);
        pending--;
        if (pending === 0) rl.prompt();
        broadcastStatus(); 
      });
      meta.child.kill();
      setTimeout(() => {
        if (meta.child.exitCode === null) {
          meta.child.kill('SIGKILL');
        }
      }, 2000);
    }
  });
  if (!any) {
    console.log(`No running instances for [${name}]`);
    rl.prompt();
  }
}

function startAll(name) {
  const config = programsConfig[name];
  if (!config) return console.log(`No such program: ${name}`);
  const count = config.numprocs || 1;
  for (let i = 0; i < count; i++) {
    startSingleProcess(name, i);
  }
  broadcastStatus();
}

function restartAll(name) {
  const instances = runningProcesses[name];
  if (!instances) return console.log(`No such program: ${name}`);
  let any = false;
  instances.forEach((meta, idx) => {
    if (meta && meta.child.exitCode === null) {
      any = true;
      restartProcess(name, idx);
    }
  });
  if (!any) {
    console.log(`No running instances for [${name}]`);
  }
}

function getProgramsByTag(tag) {
  return Object.entries(programsConfig)
    .filter(([name, config]) => Array.isArray(config.tags) && config.tags.includes(tag))
    .map(([name]) => name);
}

rl.prompt();
rl.on('line', (line) => {
  const [cmd, ...args] = line.trim().split(/\s+/);

  // Group support
  let targets = [];
  if (args[0] && args[0].startsWith('group:')) {
    const tag = args[0].slice(6);
    targets = getProgramsByTag(tag);
    if (targets.length === 0) {
      console.log(`No programs found for group: ${tag}`);
      rl.prompt();
      return;
    }
  } else if (args[0]) {
    targets = [args[0]];
  }

  switch (cmd) {
    case 'status':
      if (args[0] && args[0].startsWith('group:')) {
        targets.forEach(name => showStatus(name));
      } else if (args[0]) {
        showStatus(args[0]);
      } else {
        showStatus();
      }
      break;

    case 'start':
      if (targets.length > 0) {
        targets.forEach(name => {
          if (args[1]) startSingleProcess(name, Number(args[1]));
          else startAll(name);
        });
      } else {
        console.log('Usage: start <program|group:tag> [index]');
      }
      break;

    case 'stop':
      if (targets.length > 0) {
        targets.forEach(name => {
          if (args[1]) stopProcess(name, Number(args[1]));
          else stopAll(name);
        });
      } else {
        console.log('Usage: stop <program|group:tag> [index]');
      }
      break;

    case 'restart':
      if (targets.length > 0) {
        targets.forEach(name => {
          if (args[1]) restartProcess(name, Number(args[1]));
          else restartAll(name);
        });
      } else {
        console.log('Usage: restart <program|group:tag> [index]');
      }
      break;

    case 'reload':
      reloadConfig();
      break;

    case 'exit':
    case 'quit':
      console.log('Exiting Taskmaster...');
      rl.close();
      process.exit(0);
      break;

    case '':
      break;

    default:
      console.log('Commands: status, start <program> [index], stop <program> [index], restart <program> [index], reload, exit');
  }

  rl.prompt();
});

