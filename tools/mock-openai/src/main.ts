import { startMockOpenAI } from "./server.js";

const port = Number(process.env.MOCK_OPENAI_PORT) || 4010;
const server = await startMockOpenAI({ port, host: process.env.MOCK_OPENAI_HOST ?? "127.0.0.1" });
console.log(`mock-openai listening on ${server.url}/v1`);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void server.close().then(() => process.exit(0)));
}
