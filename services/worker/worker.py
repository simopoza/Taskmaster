# services/worker/worker.py

import os
import time
import signal
import sys

def handle_sigterm(signum, frame):
    print("🛑 Received SIGTERM, exiting...")
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_sigterm)

print("🔧 Worker started with mode:", os.getenv("WORKER_MODE", "default"))
time.sleep(15)
print("✅ Worker finished.")
exit(0)

# Optional crash
# print("❌ Worker crashed!")
# exit(1)
