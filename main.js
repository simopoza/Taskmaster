const fs = require('fs');
const yaml = require('js-yaml');
const { spawn } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'taskmaster> '
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

function isRuntimeConfigChanged(oldDef, newDef) {
  const keysToCheck = ['cmd', 'workingdir', 'env', 'umask', 'stdout', 'stderr'];
  return keysToCheck.some(key => JSON.stringify(oldDef[key]) !== JSON.stringify(newDef[key]));
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

  const stdoutStream = fs.createWriteStream(stdout, { flags: 'a' });
  const stderrStream = fs.createWriteStream(stderr, { flags: 'a' });

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

    const expected = exitcodes.includes(code);
    const isRestartable =
      (autorestart === 'always') ||
      (autorestart === 'unexpected' && !expected);

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

// Initial launch: start all programs
for (const [programName, config] of Object.entries(programsConfig)) {
  runningProcesses[programName] = [];
  const count = config.numprocs || 1;
  for (let i = 0; i < count; i++) {
    startProcess(programName, config, i);
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

function showStatus() {
  for (const [name, instances] of Object.entries(runningProcesses)) {
    instances.forEach((meta, idx) => {
      if (!meta) return;
      const status = meta.child.exitCode === null ? 'RUNNING' : `EXITED (${meta.child.exitCode})`;
      console.log(`[${name}] #${idx} PID: ${meta.child.pid} - ${status}`);
    });
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
  console.log(`▶️ Started [${name}] instance #${idx} (PID: ${proc.pid})`);
}


function restartProcess(name, idx) {
  const meta = runningProcesses[name] && runningProcesses[name][idx];
  if (!meta || meta.child.exitCode !== null) {
    console.log(`No running instance #${idx} for [${name}]`);
    return;
  }
  stopProcess(name, idx);
  setTimeout(() => startSingleProcess(name, idx), 200);
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


rl.prompt();
rl.on('line', (line) => {
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case 'status':
      showStatus();
      break;

    case 'start':
      if (args.length === 1) {
        startAll(args[0]);
      } else if (args.length === 2) {
        startSingleProcess(args[0], Number(args[1]));
      } else {
        console.log('Usage: start <program> [index]');
      }
      break;

    case 'stop':
      if (args.length === 1) {
        stopAll(args[0]);
      } else if (args.length === 2) {
        stopProcess(args[0], Number(args[1]));
      } else {
        console.log('Usage: stop <program> [index]');
      }
      break;

    case 'restart':
      if (args.length === 1) {
        restartAll(args[0]);
      } else if (args.length === 2) {
        restartProcess(args[0], Number(args[1]));
      } else {
        console.log('Usage: restart <program> [index]');
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