const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const { spawn } = require('child_process');


function loadConfig(filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const config = yaml.load(fileContent);
        return config.programs || [];
    } catch (err) {
        console.error('---Error loading configuration file:', err);
        process.exit(1);
    }
}

const programsConfig = loadConfig('./config.yaml');
// console.log('Loaded programs configuration:', programsConfig);

function startProcess(programName, config, index) {
    const {
      cmd,
      workingdir,
      env = {},
      umask,
      stdout,
      stderr,
    } = config;
  
    // Split command into executable and args
    const [exec, ...args] = cmd.split(' ');
  
    // Set up stdout and stderr streams
    const stdoutStream = fs.createWriteStream(stdout, { flags: 'a' });
    const stderrStream = fs.createWriteStream(stderr, { flags: 'a' });
  
    // Apply umask if defined
    if (umask !== undefined) {
      process.umask(parseInt(umask, 8)); // convert from string like "022" to octal
    }
  
    // Spawn the child process
    const child = spawn(exec, args, {
      cwd: workingdir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
  
    // Pipe output
    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);
  
    console.log(`Started [${programName}] instance ${index}, PID: ${child.pid}`);
  
    // Track status (for now just log exits)
    child.on('exit', (code, signal) => {
      console.log(`Process [${programName}] #${index} exited with code ${code}, signal ${signal}`);
    });
  
    return child;
}

const runningProcesses = {};

for (const [programName, config] of Object.entries(programsConfig)) {
  runningProcesses[programName] = [];

  const count = config.numprocs || 1;

  for (let i = 0; i < count; i++) {
    const proc = startProcess(programName, config, i);
    runningProcesses[programName].push(proc);
  }
}
