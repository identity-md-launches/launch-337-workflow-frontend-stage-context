import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, type Hex } from "viem";
import type { Deployment } from "./config";
import { poolId, readableError, stateAbi } from "./protocol";
export type Snapshot = {
  block: bigint;
  timestamp: number;
  received: number;
  fee: number;
  happy: boolean;
  seconds: number;
  accrued0: bigint;
  accrued1: bigint;
  liquidity: bigint;
  price: bigint;
  decimals: number;
  symbol: string;
  balance0: bigint;
  balance1: bigint;
  account?: Address;
};
export type Activity = {
  name: string;
  hash: Hex;
  block: bigint;
  index: number;
  currency?: Address;
  amount?: bigint;
  amount0?: bigint;
  amount1?: bigint;
  bps?: number;
};
export async function readSnapshot(
  d: Deployment,
  account?: Address,
): Promise<Snapshot> {
  const c = d.client;
  if ((await c.getChainId()) !== d.manifest.chainId)
    throw Error(
      "The RPC returned the wrong network. Transactions are disabled; refresh to retry.",
    );
  const block = await c.getBlock();
  if (block.number === null)
    throw Error("The RPC did not return a mined block.");
  const addresses = [
    ...d.manifest.contracts.map((x) => x.address),
    ...Object.values(d.manifest.network.uniswapV4),
  ];
  const code = await Promise.all(
    addresses.map((address) =>
      c.getBytecode({ address, blockNumber: block.number }),
    ),
  );
  if (code.some((x) => !x || x === "0x"))
    throw Error(
      "Deployment check failed: contract code is missing. Transactions are disabled.",
    );
  const hook = (functionName: string, args?: unknown[]) =>
    c.readContract({
      address: d.hook.address,
      abi: d.hook.abi,
      functionName,
      args,
      blockNumber: block.number,
    });
  const token = (functionName: string, args?: unknown[]) =>
    c.readContract({
      address: d.token.address,
      abi: d.token.abi,
      functionName,
      args,
      blockNumber: block.number,
    });
  const [
    fee,
    happy,
    seconds,
    accrued0,
    accrued1,
    manager,
    decimals,
    symbol,
    liquidity,
    slot,
    balance0,
    balance1,
  ] = await Promise.all([
    hook("currentFeeBps"),
    hook("isHappyHour"),
    hook("secondsUntilNextChange"),
    hook("accrued", [poolId(d), d.manifest.pool.pairedCurrency]),
    hook("accrued", [poolId(d), d.token.address]),
    hook("poolManager"),
    token("decimals"),
    token("symbol"),
    c.readContract({
      address: d.manifest.network.uniswapV4.stateView,
      abi: stateAbi,
      functionName: "getLiquidity",
      args: [poolId(d)],
      blockNumber: block.number,
    }),
    c.readContract({
      address: d.manifest.network.uniswapV4.stateView,
      abi: stateAbi,
      functionName: "getSlot0",
      args: [poolId(d)],
      blockNumber: block.number,
    }),
    account
      ? c.getBalance({ address: account, blockNumber: block.number })
      : 0n,
    account ? token("balanceOf", [account]) : 0n,
  ]);
  if (
    String(manager).toLowerCase() !==
      d.manifest.network.uniswapV4.poolManager.toLowerCase() ||
    Number(decimals) !== d.manifest.token.decimals ||
    symbol !== d.manifest.token.symbol
  )
    throw Error(
      "On-chain configuration differs from the handoff. Transactions are disabled.",
    );
  return {
    block: block.number,
    timestamp: Number(block.timestamp),
    received: performance.now(),
    fee: Number(fee),
    happy: happy as boolean,
    seconds: Number(seconds),
    accrued0: accrued0 as bigint,
    accrued1: accrued1 as bigint,
    liquidity,
    price: slot[0],
    decimals: Number(decimals),
    symbol: String(symbol),
    balance0,
    balance1: balance1 as bigint,
    account,
  };
}
export function usePool(d: Deployment, account?: Address) {
  const [data, setData] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<Activity[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [eventRange, setEventRange] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    try {
      const next = await readSnapshot(d, account);
      if (id !== generation.current) return;
      setData(next);
      setError("");
    } catch (e) {
      if (id === generation.current) setError(readableError(e));
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [d, account]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 15_000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    let active = true;
    async function readEvents() {
      const to = data!.block,
        from = to > 999n ? to - 999n : 0n;
      try {
        const groups = await Promise.all(
          Array.from({ length: 4 }, async (_, i) => {
            const start = from + BigInt(i * 250);
            if (start > to) return [];
            const end = start + 249n > to ? to : start + 249n;
            return d.client.getContractEvents({
              address: d.hook.address,
              abi: d.hook.abi,
              fromBlock: start,
              toBlock: end,
            });
          }),
        );
        const entries = groups
          .flat()
          .filter(
            (e) =>
              (e.args as Record<string, unknown>).poolId === poolId(d) &&
              !e.removed,
          )
          .map((e) => ({
            ...(e.args as Record<string, unknown>),
            name: e.eventName!,
            hash: e.transactionHash!,
            block: e.blockNumber!,
            index: e.logIndex!,
          })) as Activity[];
        if (active) {
          setEvents(
            entries
              .sort((a, b) =>
                a.block === b.block
                  ? b.index - a.index
                  : a.block > b.block
                    ? -1
                    : 1,
              )
              .slice(0, 6),
          );
          setEventsError("");
          setEventRange(`${from}–${to}`);
        }
      } catch (e) {
        if (active) {
          setEvents([]);
          setEventsError(
            `Activity unavailable. ${readableError(e)} Refresh to retry.`,
          );
        }
      }
    }
    void readEvents();
    return () => {
      active = false;
    };
  }, [d, data?.block]);
  return { data, error, loading, events, eventsError, eventRange, refresh };
}
