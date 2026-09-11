const path = require("node:path");
// Node 22+ loads an optional .env file; no dotenv dependency or key required.
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const { createApp } = require("./app");

createApp()
  .then((app) => {
    const port = Number(process.env.PORT || 4000);
    const host = process.env.HOST || "127.0.0.1";
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("PORT must be between 1 and 65535.");
      const server = app.listen(port, "0.0.0.0", () => {
      console.log(`VendorGuard is running at http://${host}:${port}`);
      console.log(
        "Demo only: local review states; no real payments or phone calls are made.",
      );
    });
    server.on("error", (error) => {
      console.error(`Could not start: ${error.message}`);
      process.exitCode = 1;
    });
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => server.close(() => process.exit(0)));
  })
  .catch((error) => {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  });
