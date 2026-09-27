import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  formatUnits,
  type Address,
} from "viem";
import type { Deployment } from "./config";
export const poolTuple =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export const stateAbi = parseAbi([
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);
export const quoterAbi = parseAbi([
  `function quoteExactInputSingle((${poolTuple} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
]);
export const routerAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
export const permitAbi = parseAbi([
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export function poolKey(d: Deployment) {
  return {
    currency0: d.manifest.pool.pairedCurrency,
    currency1: d.token.address,
    fee: d.manifest.pool.fee,
    tickSpacing: d.manifest.pool.tickSpacing,
    hooks: d.hook.address,
  };
}
export function poolId(d: Deployment) {
  return keccak256(
    encodeAbiParameters(parseAbiParameters(poolTuple), [poolKey(d)]),
  );
}
export function amountValue(text: string, decimals: number) {
  if (
    !/^\d+(\.\d+)?$/.test(text) ||
    (text.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const value = parseUnits(text, decimals);
  if (value <= 0n || value >= 2n ** 128n)
    throw Error("Enter a positive amount below the pool limit.");
  return value;
}
export function slippageValue(text: string) {
  const n = Number(text);
  if (!/^\d+(\.\d{1,2})?$/.test(text) || n < 0.01 || n > 5)
    throw Error("Set slippage between 0.01% and 5%.");
  return Math.round(n * 100);
}
export function minimumOutput(out: bigint, bps: number) {
  const value = (out * BigInt(10000 - bps)) / 10000n;
  if (value <= 0n || value >= 2n ** 128n)
    throw Error(
      "The quoted output is outside the supported range. Try another amount.",
    );
  return value;
}
export function swapCall(
  d: Deployment,
  buy: boolean,
  amount: bigint,
  minimum: bigint,
  deadline: bigint,
) {
  const key = poolKey(d);
  const params = [
    encodeAbiParameters(
      parseAbiParameters(
        `(${poolTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`,
      ),
      [
        {
          poolKey: key,
          zeroForOne: buy,
          amountIn: amount,
          amountOutMinimum: minimum,
          hookData: "0x",
        },
      ],
    ),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      buy ? key.currency0 : key.currency1,
      amount,
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      buy ? key.currency1 : key.currency0,
      minimum,
    ]),
  ];
  return {
    address: d.manifest.network.uniswapV4.universalRouter,
    abi: routerAbi,
    functionName: "execute" as const,
    args: [
      "0x10",
      [
        encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
          "0x060c0f",
          params,
        ]),
      ],
      deadline,
    ] as const,
    value: buy ? amount : 0n,
  };
}
export function displayAmount(value: bigint, decimals: number, places = 6) {
  const s = formatUnits(value, decimals);
  const [whole, fraction] = s.split(".");
  if (!fraction) return whole;
  const short = fraction.slice(0, places).replace(/0+$/, "");
  return value > 0n && whole === "0" && !short
    ? `<${formatUnits(1n, places)}`
    : whole + (short ? "." + short : "");
}
export function duration(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}
export function schedule(timestamp: number) {
  const t = timestamp % 86400;
  return {
    happy: t >= 57600 && t < 61200,
    bps: t >= 57600 && t < 61200 ? 10 : 100,
    remaining:
      t < 57600 ? 57600 - t : t < 61200 ? 61200 - t : 86400 - t + 57600,
  };
}
export function readableError(e: unknown) {
  const err = e as {
    shortMessage?: string;
    message?: string;
    code?: number;
    cause?: { code?: number };
  };
  const msg = err.shortMessage || err.message || "Request failed.";
  if (
    err.code === 4001 ||
    err.cause?.code === 4001 ||
    /reject|denied/i.test(msg)
  )
    return "Request declined in your wallet. You can try again when ready.";
  if (/NothingAccrued/i.test(msg))
    return "There are no fees to donate. Refresh the pool balances.";
  if (/NoLiquidityToReceiveFees/i.test(msg))
    return "No in-range liquidity can receive fees. Accrued fees remain in the hook; try again when liquidity returns.";
  return msg.slice(0, 320);
}
export type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
export async function switchNetwork(
  provider: Provider,
  d: Pick<Deployment, "manifest">,
) {
  const params = [{ chainId: d.manifest.walletAddChain.chainId }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params });
  } catch (e) {
    const err = e as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      err.code !== 4902 &&
      err.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(err.message || "")
    )
      throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [d.manifest.walletAddChain],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params });
  }
}
export async function assertWallet(
  provider: Provider,
  chainId: number,
  address: Address,
) {
  const chain = await provider.request({ method: "eth_chainId" });
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as string[];
  if (
    Number(chain) !== chainId ||
    accounts[0]?.toLowerCase() !== address.toLowerCase()
  )
    throw Error(
      "Your wallet changed. Reconnect on the configured network and try again.",
    );
}
