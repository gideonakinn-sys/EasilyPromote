// Loaded into the API process the load test starts (node -r). Lets the test stop the API with a
// normal exit, which Windows can't do with signals, so a --cpu-prof profile gets written.
process.on("message", (message) => {
  if (message === "exit") process.exit(0);
});
