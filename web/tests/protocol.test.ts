import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toHex,
} from "viem";
import { canonical, safePath, type Deployment } from "../src/config";
import {
  amountValue,
  minimumOutput,
  slippageValue,
  schedule,
  swapCall,
  poolTuple,
  poolId,
  switchNetwork,
  assertWallet,
} from "../src/protocol";
const manifest = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const d = {
  manifest,
  token: manifest.contracts.find(
    (x: { name: string }) => x.name === "LaunchToken",
  ),
  hook: manifest.contracts.find(
    (x: { name: string }) => x.name === "HappyHourHook",
  ),
} as Deployment;

test("ABI arrays have the exact attested canonical Keccak hashes", () => {
  for (const c of manifest.contracts) {
    const abi = JSON.parse(
      readFileSync(new URL(`../../dist/${c.abiPath}`, import.meta.url), "utf8"),
    );
    assert.equal(keccak256(toHex(canonical(abi))).slice(2), c.abiHash);
  }
});
test("fee boundary schedule agrees with approved half-open interval", () => {
  for (const [t, bps, happy, remaining] of [
    [57599, 100, false, 1],
    [57600, 10, true, 3600],
    [61199, 10, true, 1],
    [61200, 100, false, 82800],
  ] as const)
    assert.deepEqual(schedule(t), { bps, happy, remaining });
});
test("amount and slippage parsing rejects rounding, zero, exponent and unbounded inputs", () => {
  for (const v of ["0", "-1", "1e2", ".5", "1.0000000000000000001", "NaN"])
    assert.throws(() => amountValue(v, 18));
  assert.equal(amountValue("0.000000000000000001", 18), 1n);
  assert.throws(() => amountValue("340282366920938463464", 18));
  for (const v of ["0", "5.01", "abc", "0.001"])
    assert.throws(() => slippageValue(v));
  assert.equal(slippageValue("0.5"), 50);
  assert.equal(minimumOutput(1001n, 50), 995n);
  assert.throws(() => minimumOutput(1n, 50));
});
test("router plan encodes native buy and token sale with correct currencies, minima and settlement", () => {
  for (const buy of [true, false]) {
    const call = swapCall(d, buy, 123n, 99n, 2000000000n);
    assert.equal(call.address, manifest.network.uniswapV4.universalRouter);
    assert.equal(call.value, buy ? 123n : 0n);
    assert.equal(call.args[0], "0x10");
    const [actions, params] = decodeAbiParameters(
      parseAbiParameters("bytes,bytes[]"),
      call.args[1][0],
    );
    assert.equal(actions, "0x060c0f");
    const [swap] = decodeAbiParameters(
      parseAbiParameters(
        `(${poolTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`,
      ),
      params[0],
    );
    assert.equal(swap.zeroForOne, buy);
    assert.equal(swap.amountIn, 123n);
    assert.equal(swap.amountOutMinimum, 99n);
    assert.equal(swap.hookData, "0x");
    assert.equal(swap.poolKey.hooks.toLowerCase(), d.hook.address);
    const [input, settle] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[1],
    );
    const [output, take] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[2],
    );
    assert.equal(
      input.toLowerCase(),
      buy ? manifest.pool.pairedCurrency : d.token.address,
    );
    assert.equal(
      output.toLowerCase(),
      buy ? d.token.address : manifest.pool.pairedCurrency,
    );
    assert.equal(settle, 123n);
    assert.equal(take, 99n);
  }
  assert.match(poolId(d), /^0x[0-9a-f]{64}$/);
});
test("unknown wallet chain adds exact supplied parameters then retries switching", async () => {
  const calls: { method: string; params?: unknown[] }[] = [];
  await switchNetwork(
    {
      request: async (args) => {
        calls.push(args);
        if (calls.length === 1) throw { code: 4902 };
        return null;
      },
    },
    d,
  );
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [manifest.walletAddChain]);
});
test("wallet rejection does not trigger add-chain and identity changes abort", async () => {
  let count = 0;
  await assert.rejects(
    switchNetwork(
      {
        request: async () => {
          count++;
          throw { code: 4001 };
        },
      },
      d,
    ),
  );
  assert.equal(count, 1);
  await assert.rejects(
    assertWallet(
      {
        request: async ({ method }) =>
          method === "eth_chainId" ? "0x1" : [d.token.address],
      },
      manifest.chainId,
      d.token.address,
    ),
  );
  await assert.rejects(
    assertWallet(
      {
        request: async ({ method }) =>
          method === "eth_chainId" ? manifest.walletAddChain.chainId : [],
      },
      manifest.chainId,
      d.token.address,
    ),
  );
});
test("configuration paths prohibit URLs and traversal", () => {
  for (const p of ["../a", "/a", "https://x/a", "a/../b", "a//b"])
    assert.equal(safePath(p), false);
  assert.equal(safePath("abi/LaunchToken.json"), true);
});
