import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { makeApp } from "./test-app.js";

export async function withTestServer<T>(
  fn: (params: { baseUrl: string }) => Promise<T>
): Promise<T> {
  const app = makeApp();
  const server: Server = app.listen(0);

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    return await fn({ baseUrl });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}





