# Taskmaster

Taskmaster is a simple process control shell, inspired by tools like `supervisord` and `systemd`.  
It allows you to manage multiple programs and their instances from a single interactive shell.

---

## Features

- `status` — Show current state of all processes
- `start <program>` — Start all instances of a program
- `start <program> <idx>` — Start a specific instance
- `stop <program>` — Stop all instances of a program
- `stop <program> <idx>` — Stop a specific instance
- `restart <program>` — Restart all running instances of a program
- `restart <program> <idx>` — Restart a specific running instance
- `reload` — Reload the configuration file and apply changes
- `exit` / `quit` — Exit Taskmaster cleanly

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/simopoza/Taskmaster.git
cd Taskmaster
```

### 2. Install dependencies

```bash
npm install
```

### 3. Prepare your config

Edit `config.yaml` to define your programs and their settings.  
Example:

```yaml
programs:
  web-server:
    cmd: "node services/web/server.js"
    numprocs: 2
    workingdir: "./"
    stdout: "./logs/web-server.out"
    stderr: "./logs/web-server.err"
    autorestart: "unexpected"
    startretries: 1
    starttime: 1
  mailer:
    cmd: "bash scripts/run_mailer.sh"
    numprocs: 1
    workingdir: "./"
    stdout: "./logs/mailer.out"
    stderr: "./logs/mailer.err"
    autorestart: "never"
```

### 4. Make sure your service scripts handle SIGTERM

- **Node.js:**  
  ```js
  process.on('SIGTERM', () => {
    console.log("🛑 Received SIGTERM, exiting...");
    process.exit(0);
  });
  ```
- **Python:**  
  ```python
  import signal, sys
  def handle_sigterm(signum, frame):
      print("🛑 Received SIGTERM, exiting...")
      sys.exit(0)
  signal.signal(signal.SIGTERM, handle_sigterm)
  ```
- **Bash:**  
  ```bash
  trap 'echo "🛑 Received SIGTERM, exiting..."; exit 0' SIGTERM
  ```

### 5. Run Taskmaster

```bash
node main.js
```

---

## Usage

Once running, you'll see the prompt:

```
taskmaster>
```

You can now use commands like:

- `status`
- `start web-server`
- `start web-server 1`
- `stop mailer`
- `stop mailer 0`
- `restart web-server`
- `restart mailer 0`
- `reload`
- `exit` or `quit`

---

## Example Session

```
taskmaster> status
[web-server] #0 PID: 12345 - RUNNING
[web-server] #1 PID: 12346 - RUNNING
[mailer] #0 PID: 12347 - EXITED (0)

taskmaster> stop web-server
⏹️ Stopped [web-server] instance #0
⏹️ Stopped [web-server] instance #1

taskmaster> start mailer 0
▶️ Started [mailer] instance #0 (PID: 12348)

taskmaster> reload
🔁 Reload complete.

taskmaster> exit
Exiting Taskmaster...
```

---

## Notes

- **Logs** are written to the files specified in your config.
- **Config reload** will apply changes, start new programs, stop removed ones, and restart changed ones.
- **Graceful shutdown**: Make sure your scripts handle SIGTERM for proper stop/restart behavior.
- **Retries** and **autorestart** are controlled by your config.

---

## License

MIT

---

## Author

simopoza