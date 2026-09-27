import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex } from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const handoff = await read("web/config/deployment.json");
const network = await read("web/config/network.json");
const canonical = (value) => JSON.stringify(sort(value));
function sort(v) {
  return Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort(v[k])]),
        )
      : v;
}
if (
  handoff.chainId !== network.network.chainId ||
  Number(network.walletAddChain.chainId) !== handoff.chainId
)
  throw Error("Network mismatch");
const checking = process.argv.includes("--check");
const contracts = [];
for (const contract of handoff.contracts) {
  const path = `docs/abi/${contract.name}.json`;
  const pinned = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:${path}`],
    { cwd: root },
  );
  const source = await readFile(resolve(root, path));
  if (!source.equals(pinned)) throw Error(`${path} differs from pinned source`);
  const abi = JSON.parse(source);
  if (
    !Array.isArray(abi) ||
    keccak256(toHex(canonical(abi))).slice(2) !== contract.abiHash
  )
    throw Error(`ABI hash mismatch: ${contract.name}`);
  const abiPath = `abi/${contract.name}.json`;
  if (!checking) {
    await mkdir(resolve(root, "dist/abi"), { recursive: true });
    await writeFile(resolve(root, "dist", abiPath), source);
  }
  contracts.push({
    name: contract.name,
    address: contract.address,
    abiHash: contract.abiHash,
    abiPath,
  });
}
async function files(dir, prefix = "") {
  const list = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error("Symlink in export");
    const p = prefix + entry.name;
    if (entry.isDirectory())
      list.push(...(await files(resolve(dir, entry.name), p + "/")));
    else if (p !== "imd-deployment.json") list.push(p);
  }
  return list.sort();
}
const assets = [];
for (const path of await files(resolve(root, "dist"))) {
  const bytes = await readFile(resolve(root, "dist", path));
  if (bytes.length > 8388608) throw Error("Oversized asset");
  assets.push({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
if (assets.length > 128 || !assets.some((a) => a.path === "index.html"))
  throw Error("Invalid export inventory");
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  network: network.network,
  walletAddChain: network.walletAddChain,
  pool: handoff.manifest.pool,
  token: handoff.manifest.token,
};
const target = resolve(root, "dist/imd-deployment.json");
if (checking) {
  if (canonical(await read("dist/imd-deployment.json")) !== canonical(manifest))
    throw Error("Manifest differs from final export or handoff");
} else await writeFile(target, JSON.stringify(manifest, null, 2) + "\n");
const total =
  (
    await Promise.all(
      (await files(resolve(root, "dist"))).map((p) =>
        stat(resolve(root, "dist", p)),
      ),
    )
  ).reduce((sum, f) => sum + f.size, 0) + (await stat(target)).size;
if (total > 8 * 1024 * 1024) throw Error("Export exceeds submission budget");
console.log(
  JSON.stringify(
    {
      result: "pass",
      mode: checking ? "check" : "export",
      sourceCommit: handoff.sourceCommit,
      abiHashes: contracts.map((c) => ({ name: c.name, abiHash: c.abiHash })),
      assets: assets.length,
      totalBytes: total,
    },
    null,
    2,
  ),
);
