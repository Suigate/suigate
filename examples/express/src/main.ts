import { createApp } from "./app.js";
import { loadExampleConfiguration } from "../../shared/config.js";

const configuration = await loadExampleConfiguration();
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");
createApp(configuration).listen(port, "127.0.0.1", () =>
  console.log(`suigate Express testnet example: http://localhost:${port}`),
);
