const fs = require('fs');
const yaml = require('js-yaml');
const { spawn } = require('child_process');

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

// --- Add this function ---
function checkAllExited() {
  const anyRunning = Object.values(runningProcesses).some(instances =>
    instances.some(meta => meta && meta.child.exitCode === null)
  );
  if (!anyRunning) {
    console.log('✅ All processes have exited. Exiting main program.');
    process.exit(0);
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

  const processMeta = {
    child,
    retries,
    startTime: Date.now(),
    config,
    stopping: false // Add stopping flag
  };

  if (!runningProcesses[programName]) runningProcesses[programName] = [];
  runningProcesses[programName][index] = processMeta;

  child.on('exit', (code, signal) => {
    console.log(`Process [${programName}] #${index} exited with code ${code}, signal ${signal}`);

    // Prevent autorestart if intentionally stopping
    const meta = runningProcesses[programName] && runningProcesses[programName][index];
    if (meta && meta.stopping) {
      meta.stopping = false; // Reset for future use
      checkAllExited();
      return;
    }

    const expected = exitcodes.includes(code);
    const isRestartable =
      (autorestart === 'always') ||
      (autorestart === 'unexpected' && !expected);

    if (isRestartable) {
      if (retries < startretries) {
        console.log(`Restarting [${programName}] #${index} (attempt ${retries + 1}/${startretries})`);
        setTimeout(() => {
          startProcess(programName, config, index, retries + 1);
        }, starttime * 1000);
      } else {
        console.warn(`❌ Max retries reached for [${programName}] #${index}. Giving up.`);
      }
    }
    checkAllExited();
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
      }, 100); // Give time for exit handlers to run
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