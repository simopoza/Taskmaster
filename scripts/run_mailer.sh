#!/bin/bash
# scripts/run_mailer.sh

trap 'echo "🛑 Received SIGTERM, exiting..."; exit 0' SIGTERM

echo "📬 Mailer started..."

for i in {1..20}; do
  sleep 1
done

echo "✅ Mailer finished sending emails."
exit 0

# Optional crash for testing
# echo "❌ Mailer failed!"
# exit 1
