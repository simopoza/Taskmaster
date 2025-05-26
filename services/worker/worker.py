# services/worker/worker.py

import os
import time

print("🔧 Worker started with mode:", os.getenv("WORKER_MODE", "default"))
time.sleep(5)
print("✅ Worker finished.")
exit(0)

# Optional crash
# print("❌ Worker crashed!")
# exit(1)
