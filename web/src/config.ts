import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  isAddress,
  keccak256,
  toHex,
  type Abi,
  type Address,
} from "viem";
import { createConfig, injected } from "wagmi";
export type Manifest = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<
      | "poolManager"
      | "universalRouter"
      | "quoter"
      | "stateView"
      | "positionManager"
      | "permit2",
      Address
    >;
  };
  walletAddChain: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: { fee: number; tickSpacing: number; pairedCurrency: Address };
  token: { contract: string; name: string; symbol: string; decimals: number };
};
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, sort(v)]),
          )
        : v;
  return JSON.stringify(sort(value));
}
export function safePath(path: string) {
  return (
    /^[a-zA-Z0-9_./-]+$/.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").some((p) => p === ".." || p === "." || !p)
  );
}
async function json(path: string) {
  const res = await fetch(new URL(path, document.baseURI), {
    cache: "no-cache",
  });
  if (!res.ok) throw Error(`Unable to load ${path}. Reload the page to retry.`);
  return res.json();
}
export async function loadDeployment() {
  const manifest: Manifest = await json("imd-deployment.json");
  if (
    manifest.version !== 1 ||
    manifest.chainId !== manifest.network.chainId ||
    Number(manifest.walletAddChain.chainId) !== manifest.chainId ||
    manifest.contracts.length !== 2
  )
    throw Error("Deployment configuration is inconsistent.");
  for (const c of manifest.contracts)
    if (
      !isAddress(c.address) ||
      !safePath(c.abiPath) ||
      !manifest.assets.some((a) => a.path === c.abiPath)
    )
      throw Error("Invalid deployment contract.");
  for (const a of Object.values(manifest.network.uniswapV4))
    if (!isAddress(a)) throw Error("Invalid network contract.");
  const contracts = await Promise.all(
    manifest.contracts.map(async (c) => {
      const abi: Abi = await json(c.abiPath);
      if (
        !Array.isArray(abi) ||
        keccak256(toHex(canonical(abi))).slice(2) !== c.abiHash
      )
        throw Error(
          `${c.name} ABI verification failed. Transactions are unavailable.`,
        );
      return { ...c, abi };
    }),
  );
  const token = contracts.find((c) => c.name === manifest.token.contract);
  const hook = contracts.find((c) => c.name === "HappyHourHook");
  if (
    !token ||
    !hook ||
    token === hook ||
    manifest.pool.pairedCurrency !==
      "0x0000000000000000000000000000000000000000"
  )
    throw Error("Unsupported Happy Hour deployment.");
  const chain = defineChain({
    id: manifest.chainId,
    name: manifest.network.name,
    nativeCurrency: manifest.network.nativeCurrency,
    rpcUrls: { default: { http: manifest.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: manifest.network.explorer },
    },
    testnet: manifest.network.testnet,
  });
  const transport = () =>
    fallback(
      manifest.network.rpcUrls.map((url) =>
        http(url, { timeout: 8_000, retryCount: 0 }),
      ),
      { retryCount: 1 },
    );
  const client = createPublicClient({
    chain,
    transport: transport(),
    batch: { multicall: false },
  });
  const wagmi = createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: transport() },
    multiInjectedProviderDiscovery: true,
  });
  return { manifest, chain, client, wagmi, token, hook };
}
export type Deployment = Awaited<ReturnType<typeof loadDeployment>>;
