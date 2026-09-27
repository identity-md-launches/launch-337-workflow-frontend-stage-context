import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { readSnapshot } from "../src/state.ts";
const manifest = JSON.parse(
  await readFile("../dist/imd-deployment.json", "utf8"),
);
const contracts = await Promise.all(
  manifest.contracts.map(async (c) => ({
    ...c,
    abi: JSON.parse(await readFile("../dist/" + c.abiPath, "utf8")),
  })),
);
const results = [];
for (const url of manifest.network.rpcUrls) {
  const d = {
    manifest,
    token: contracts.find((c) => c.name === "LaunchToken"),
    hook: contracts.find((c) => c.name === "HappyHourHook"),
    client: createPublicClient({
      transport: http(url, { timeout: 12000, retryCount: 0 }),
    }),
  };
  try {
    const snapshot = await readSnapshot(d);
    results.push({ rpc: url, result: "pass", snapshot });
    break;
  } catch (e) {
    results.push({
      rpc: url,
      result: "unavailable",
      error: (e.shortMessage || e.message).slice(0, 400),
    });
  }
}
const result = {
  date: new Date().toISOString(),
  readOnly: true,
  realTransactions: 0,
  results,
};
await writeFile(
  "../docs/frontend/live-read-results.json",
  JSON.stringify(
    result,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    result,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
