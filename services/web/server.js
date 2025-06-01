// services/web/server.js

console.log("🟢 Server started...");

process.on('SIGTERM', () => {
  console.log("🛑 Received SIGTERM, exiting...");
  process.exit(0);
});

setTimeout(() => {
  console.log("✅ Server exiting normally after 10 seconds.");
  process.exit(0); // Normal exit
}, 20000);

// To test failure behavior, use this instead:
// setTimeout(() => {
//   console.error("❌ Simulated crash!");
//   process.exit(1); // Abnormal exit
// }, 5000);
