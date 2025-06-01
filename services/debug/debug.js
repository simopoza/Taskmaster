// services/debug/debug.js

console.log("🐞 Debug task is running...");

process.on('SIGTERM', () => {
  console.log("🛑 Received SIGTERM, exiting...");
  process.exit(0);
});

setTimeout(() => {
  console.log("✅ Debug task finished.");
  process.exit(0); // exit normally
}, 30000);

// Optional crash for testing
// setTimeout(() => {
//   console.error("💥 Debug task crashed!");
//   process.exit(1);
// }, 3000);
