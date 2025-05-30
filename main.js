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
      startTime: Date.now()
    };
  
    // Save to tracking
    runningProcesses[programName][index] = processMeta;
  
    // Handle unexpected exits
    child.on('exit', (code, signal) => {
      console.log(`Process [${programName}] #${index} exited with code ${code}, signal ${signal}`);
  
      const expected = exitcodes.includes(code);
  
      const isRestartable =
        (autorestart === 'always') ||
        (autorestart === 'unexpected' && !expected);
  
      if (isRestartable) {
        if (retries < startretries) {
          console.log(`Restarting [${programName}] #${index} (attempt ${retries + 1}/${startretries})`);
  
          setTimeout(() => {
            startProcess(programName, config, index, retries + 1);
          }, starttime * 1000); // Wait starttime before restarting
        } else {
          console.warn(`❌ Max retries reached for [${programName}] #${index}. Giving up.`);
        }
      }
    });
  
    return child;
}
  

const runningProcesses = {};

for (const [programName, config] of Object.entries(programsConfig)) {
    runningProcesses[programName] = [];
  
    const count = config.numprocs || 1;
  
    for (let i = 0; i < count; i++) {
      startProcess(programName, config, i);
    }
}
  