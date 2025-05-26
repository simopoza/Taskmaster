// services/debug/debug.js

console.log("🐞 Debug task is running...");

setTimeout(() => {
  console.log("✅ Debug task finished.");
  process.exit(0); // exit normally
}, 3000);

// Optional crash for testing
// setTimeout(() => {
//   console.error("💥 Debug task crashed!");
//   process.exit(1);
// }, 3000);
