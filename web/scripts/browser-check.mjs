import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  parseAbiParameters,
  toHex,
} from "viem";
import {
  stateAbi,
  quoterAbi,
  permitAbi,
  routerAbi,
  poolId,
  poolTuple,
  schedule,
} from "../src/protocol.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "docs/frontend");
await mkdir(out, { recursive: true });
const manifest = JSON.parse(
  await readFile(resolve(root, "dist/imd-deployment.json"), "utf8"),
);
const contracts = await Promise.all(
  manifest.contracts.map(async (c) => ({
    ...c,
    abi: JSON.parse(await readFile(resolve(root, "dist", c.abiPath), "utf8")),
  })),
);
const token = contracts.find((c) => c.name === "LaunchToken"),
  hook = contracts.find((c) => c.name === "HappyHourHook");
const deployment = { manifest, token, hook },
  id = poolId(deployment),
  uni = manifest.network.uniswapV4;
const user = "0x1111111111111111111111111111111111111111";
const hash = "0x" + "a".repeat(64),
  blockHash = "0x" + "b".repeat(64);
const zero = "0x" + "0".repeat(64),
  number = 12000000n;
const abis = {
  [token.address]: token.abi,
  [hook.address]: hook.abi,
  [uni.stateView]: stateAbi,
  [uni.quoter]: quoterAbi,
  [uni.permit2]: permitAbi,
  [uni.universalRouter]: routerAbi,
};
const checks = [],
  consoleErrors = [],
  resourceFailures = [];
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://local").pathname);
    if (!path.startsWith("/preview/") || path.includes("..")) {
      res.writeHead(404).end();
      return;
    }
    const file = resolve(
      root,
      "dist",
      path.slice("/preview/".length) || "index.html",
    );
    const bytes = await readFile(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[extname(file)] || "application/octet-stream",
    );
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });
async function scenario(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const state = {
    connected: false,
    chain: options.wrongChain ? "0x1" : manifest.walletAddChain.chainId,
    added: false,
    requests: [],
    sent: [],
    simulations: [],
    revert: false,
    accrued0: 84000000000000000n,
    accrued1: 24180n * 10n ** 18n,
    tokenAllowance: 0n,
    routerAllowance: 0n,
    expiration: 0,
    liquidity: options.noLiquidity ? 0n : 10n ** 24n,
    missingCode: options.missingCode || false,
    failRpc: options.failRpc || false,
    block: number,
    reject: false,
    events: options.events !== false,
  };
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (r) => {
    if (r.url().startsWith(url) && r.status() >= 400)
      resourceFailures.push({ url: r.url(), status: r.status() });
  });
  async function rpc({ method, params = [] }) {
    if (state.failRpc)
      throw { code: -32000, message: "Fixture RPC unavailable" };
    if (
      options.slow &&
      ["eth_chainId", "eth_getBlockByNumber", "eth_getCode"].includes(method)
    )
      await new Promise((r) => setTimeout(r, 6000));
    const now = Math.floor(Date.now() / 1000),
      fee = schedule(now);
    switch (method) {
      case "eth_chainId":
        return manifest.walletAddChain.chainId;
      case "eth_blockNumber":
        return toHex(state.block);
      case "eth_getCode":
        return state.missingCode && params[0].toLowerCase() === hook.address
          ? "0x"
          : "0x60016000";
      case "eth_getBalance":
        return toHex(2n * 10n ** 18n);
      case "eth_getBlockByNumber":
        return {
          number: toHex(state.block),
          hash: blockHash,
          parentHash: zero,
          timestamp: toHex(now),
          nonce: "0x0000000000000000",
          difficulty: "0x0",
          totalDifficulty: "0x0",
          gasLimit: "0x1c9c380",
          gasUsed: "0x0",
          baseFeePerGas: "0x3b9aca00",
          extraData: "0x",
          miner: user,
          mixHash: zero,
          receiptsRoot: zero,
          sha3Uncles: zero,
          stateRoot: zero,
          transactionsRoot: zero,
          transactions: [],
          uncles: [],
          size: "0x100",
          logsBloom: "0x" + "0".repeat(512),
        };
      case "eth_call": {
        const call = params[0],
          address = call.to.toLowerCase(),
          abi = abis[address];
        if (!abi) throw Error(`Unknown call ${address}`);
        const { functionName: f, args } = decodeFunctionData({
          abi,
          data: call.data,
        });
        let result;
        if (["donateFees", "execute", "approve"].includes(f)) {
          state.simulations.push({ address, functionName: f, args });
          if (state.revert)
            throw {
              code: 3,
              message: "execution reverted: NoLiquidityToReceiveFees",
              data: "0x",
            };
          return f === "approve" && address === token.address
            ? encodeFunctionResult({ abi, functionName: f, result: true })
            : "0x";
        }
        if (f === "currentFeeBps") result = fee.bps;
        else if (f === "isHappyHour") result = fee.happy;
        else if (f === "secondsUntilNextChange") result = BigInt(fee.remaining);
        else if (f === "accrued") {
          assert.equal(args[0], id);
          result =
            args[1].toLowerCase() === token.address
              ? state.accrued1
              : state.accrued0;
        } else if (f === "poolManager") result = uni.poolManager;
        else if (f === "decimals") result = manifest.token.decimals;
        else if (f === "symbol") result = manifest.token.symbol;
        else if (f === "balanceOf") result = 12000n * 10n ** 18n;
        else if (f === "getLiquidity") result = state.liquidity;
        else if (f === "getSlot0")
          result = [78588986356927097284479352776873n, 138000, 0, 3000];
        else if (f === "quoteExactInputSingle") {
          state.simulations.push({ address, functionName: f, args });
          result = [
            args[0].zeroForOne ? 1250n * 10n ** 18n : 10n ** 15n,
            90000n,
          ];
        } else if (f === "allowance")
          result =
            address === token.address
              ? state.tokenAllowance
              : [state.routerAllowance, state.expiration, 0];
        else throw Error(`Unhandled read ${f}`);
        return encodeFunctionResult({ abi, functionName: f, result });
      }
      case "eth_getLogs": {
        if (!state.events) return [];
        const logBlock = number - 1n;
        if (
          BigInt(params[0].fromBlock) > logBlock ||
          BigInt(params[0].toBlock) < logBlock
        )
          return [];
        return [
          {
            address: hook.address,
            blockNumber: toHex(logBlock),
            blockHash,
            transactionHash: hash,
            transactionIndex: "0x0",
            logIndex: "0x0",
            removed: false,
            topics: encodeEventTopics({
              abi: hook.abi,
              eventName: "FeeTaken",
              args: { poolId: id, currency: token.address },
            }),
            data: encodeAbiParameters(parseAbiParameters("uint256,uint24"), [
              200n * 10n ** 18n,
              100,
            ]),
          },
        ];
      }
      case "eth_getTransactionReceipt":
        return {
          transactionHash: params[0],
          transactionIndex: "0x0",
          blockHash,
          blockNumber: toHex(state.block),
          from: user,
          to: hook.address,
          cumulativeGasUsed: "0x186a0",
          gasUsed: "0x186a0",
          contractAddress: null,
          logs: [],
          logsBloom: "0x" + "0".repeat(512),
          status: "0x1",
          effectiveGasPrice: "0x3b9aca00",
          type: "0x2",
        };
      default:
        throw Error(`Unhandled RPC ${method}`);
    }
  }
  if (!options.liveRpc)
    await page.route(
      (url) => manifest.network.rpcUrls.some((r) => url.href.startsWith(r)),
      async (route) => {
        const body = route.request().postDataJSON();
        const respond = async (q) => {
          try {
            return { jsonrpc: "2.0", id: q.id, result: await rpc(q) };
          } catch (e) {
            return {
              jsonrpc: "2.0",
              id: q.id,
              error: {
                code: e.code || -32000,
                message: e.message || String(e),
                data: e.data,
              },
            };
          }
        };
        const result = Array.isArray(body)
          ? await Promise.all(body.map(respond))
          : await respond(body);
        await route.fulfill({
          json: result,
          headers: { "access-control-allow-origin": "*" },
        });
      },
    );
  if (!options.noWallet) {
    await page.exposeFunction("mockRequest", async (args) => {
      state.requests.push(args);
      const { method, params = [] } = args;
      if (
        state.reject &&
        [
          "eth_requestAccounts",
          "eth_sendTransaction",
          "wallet_switchEthereumChain",
        ].includes(method)
      )
        return { error: { code: 4001, message: "User rejected the request" } };
      if (method === "eth_accounts")
        return { result: state.connected ? [user] : [] };
      if (method === "eth_requestAccounts") {
        state.connected = true;
        return { result: [user] };
      }
      if (method === "eth_chainId") return { result: state.chain };
      if (method === "wallet_requestPermissions") {
        state.connected = true;
        return { result: [{ parentCapability: "eth_accounts" }] };
      }
      if (method === "wallet_revokePermissions") {
        state.connected = false;
        return { result: null };
      }
      if (method === "wallet_switchEthereumChain") {
        if (options.wrongChain && !state.added)
          return { error: { code: 4902, message: "Unknown chain" } };
        state.chain = params[0].chainId;
        return { result: null };
      }
      if (method === "wallet_addEthereumChain") {
        assert.deepEqual(params[0], manifest.walletAddChain);
        state.added = true;
        return { result: null };
      }
      if (method === "eth_sendTransaction") {
        const tx = params[0],
          address = tx.to.toLowerCase(),
          abi = abis[address],
          decoded = decodeFunctionData({ abi, data: tx.data });
        state.sent.push({ tx, ...decoded });
        state.block++;
        if (decoded.functionName === "donateFees") {
          state.accrued0 = 0n;
          state.accrued1 = 0n;
        }
        if (decoded.functionName === "approve" && address === token.address)
          state.tokenAllowance = decoded.args[1];
        if (decoded.functionName === "approve" && address === uni.permit2) {
          state.routerAllowance = decoded.args[2];
          state.expiration = decoded.args[3];
        }
        return { result: "0x" + String(state.sent.length).padStart(64, "0") };
      }
      if (method === "wallet_getCapabilities") return { result: {} };
      return {
        error: { code: 4200, message: `Unsupported fixture method ${method}` },
      };
    });
    await page.addInitScript(() => {
      const listeners = {};
      window.ethereum = {
        isMetaMask: true,
        on(event, handler) {
          (listeners[event] ??= []).push(handler);
        },
        removeListener(event, handler) {
          listeners[event] = (listeners[event] || []).filter(
            (x) => x !== handler,
          );
        },
        async request(args) {
          const reply = await window.mockRequest(args);
          if (reply.error)
            throw Object.assign(new Error(reply.error.message), reply.error);
          if (args.method === "wallet_switchEthereumChain")
            for (const cb of listeners.chainChanged || [])
              cb(args.params[0].chainId);
          return reply.result;
        },
      };
    });
  }
  await page.goto(url);
  return { context, page, state };
}
async function live(page) {
  await expect(
    page.getByText("Live pool reads · deployment checked"),
  ).toBeVisible({ timeout: 30000 });
}
async function connect(page) {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await live(page);
}
function pass(name) {
  checks.push({ name, result: "pass" });
  console.log("PASS", name);
}
try {
  const { context, page, state } = await scenario();
  await live(page);
  await expect(
    page.getByRole("button", { name: "Donate to LPs" }),
  ).toBeDisabled();
  await expect(page.getByText("Hook fee collected")).toBeVisible();
  pass("Disconnected public reads and pool-filtered event activity");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toBeFocused();
  await page.screenshot({ path: resolve(out, "focus-desktop.png") });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await live(page);
  await expect(
    page.getByRole("button", { name: "Donate to LPs" }),
  ).toBeEnabled();
  pass("Keyboard navigation, visible focus capture and wallet connection");
  await page.screenshot({ path: resolve(out, "desktop.png"), fullPage: true });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  pass("Desktop axe WCAG automated scan");
  const contrast = await page.evaluate(() => {
    function luminance(color) {
      const rgb = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    return [
      ".clock-column .small-text",
      ".primary",
      ".lede",
      ".donation h2",
    ].map((selector) => {
      const el = document.querySelector(selector);
      const foreground = getComputedStyle(el).color;
      let parent = el,
        background = "";
      while (parent) {
        background = getComputedStyle(parent).backgroundColor;
        if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent")
          break;
        parent = parent.parentElement;
      }
      const values = [luminance(foreground), luminance(background)].sort(
        (a, b) => a - b,
      );
      return {
        selector,
        foreground,
        background,
        ratio: (values[1] + 0.05) / (values[0] + 0.05),
      };
    });
  });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow at ${width}`,
    );
    if (width !== 768)
      await page.screenshot({
        path: resolve(out, `mobile-${width}.png`),
        fullPage: true,
      });
  }
  const mobileAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.equal(mobileAxe.violations.length, 0);
  pass("768, 390 and 320 pixel reflow; mobile accessibility scan");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  pass("200% text enlargement without horizontal overflow");
  await page.getByRole("button", { name: "Donate to LPs" }).click();
  await expect(page.getByText("Review your donation")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(state.sent.length, 0);
  await page.getByRole("button", { name: "Donate to LPs" }).click();
  state.revert = true;
  await page.getByRole("button", { name: "Confirm donation" }).click();
  await expect(page.getByRole("alert")).toContainText("No in-range liquidity");
  assert.equal(state.sent.length, 0);
  pass("Donation review, cancellation and simulation failure prevent signing");
  state.revert = false;
  state.reject = true;
  await page.getByRole("button", { name: "Confirm donation" }).click();
  await expect(page.getByRole("alert")).toContainText("Request declined");
  assert.equal(state.sent.length, 0);
  state.reject = false;
  await page.getByRole("button", { name: "Confirm donation" }).click();
  await expect(page.getByRole("status")).toContainText("Donation confirmed.", {
    timeout: 15000,
  });
  assert.equal(state.sent[0].functionName, "donateFees");
  assert.equal(state.sent[0].args[0].hooks.toLowerCase(), hook.address);
  assert.equal(BigInt(state.sent[0].tx.value || 0), 0n);
  await expect(
    page.getByRole("button", { name: "Donate to LPs" }),
  ).toBeDisabled();
  pass("Donation wallet rejection, success receipt and zero-accrual refresh");
  await page.getByLabel("You pay").fill("0");
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(page.locator("#form-error")).toContainText("positive amount");
  await expect(page.getByLabel("You pay")).toBeFocused();
  pass("Invalid amount produces a linked, focused field error");
  await page.getByLabel("You pay").fill("0.01");
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(
    page.getByRole("button", { name: "Swap ETH for HAPY" }),
  ).toBeEnabled();
  await expect(page.getByText("1243.75 HAPY", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Swap ETH for HAPY" }).click();
  await expect(page.getByRole("status")).toContainText("Swap confirmed.", {
    timeout: 15000,
  });
  const buy = state.sent.at(-1);
  assert.equal(buy.tx.to.toLowerCase(), uni.universalRouter);
  assert.equal(BigInt(buy.tx.value), 10n ** 16n);
  assert.equal(buy.args[0], "0x10");
  assert.equal(
    state.sent.filter((s) => s.functionName === "approve").length,
    0,
  );
  pass(
    "Native buy quote, minimum, router simulation, receipt and no approvals",
  );
  await page.getByRole("button", { name: "Sell HAPY", exact: true }).click();
  await page.getByLabel("You pay").fill("100");
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(
    page.getByRole("button", { name: "Approve token", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Approve router", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Approve token", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Token approval confirmed.",
    { timeout: 15000 },
  );
  assert.equal(state.sent.at(-1).args[0].toLowerCase(), uni.permit2);
  assert.equal(state.sent.at(-1).args[1], 100n * 10n ** 18n);
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(
    page.getByRole("button", { name: "Approve router", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Approve router", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Router approval confirmed.",
    { timeout: 15000 },
  );
  assert.equal(state.sent.at(-1).tx.to.toLowerCase(), uni.permit2);
  assert.equal(state.sent.at(-1).args[1].toLowerCase(), uni.universalRouter);
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(
    page.getByRole("button", { name: "Swap HAPY for ETH" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Swap HAPY for ETH" }).click();
  await expect(page.getByRole("status")).toContainText("Swap confirmed.", {
    timeout: 15000,
  });
  assert.equal(BigInt(state.sent.at(-1).tx.value || 0), 0n);
  pass(
    "Token sale requires explicit bounded token and Permit2 router approvals",
  );
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(
    page.getByRole("button", { name: "Swap HAPY for ETH" }),
  ).toBeEnabled();
  await page.getByLabel("You pay").fill("101");
  await expect(
    page.getByRole("button", { name: "Swap HAPY for ETH" }),
  ).toHaveCount(0);
  pass("Changed swap input invalidates the quote");
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(
    page.getByRole("button", { name: "Swap HAPY for ETH" }),
  ).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(31_000);
  await expect(
    page.getByRole("button", { name: "Swap HAPY for ETH" }),
  ).toBeDisabled();
  pass("Expired quotes cannot submit");
  await context.close();
  const wrong = await scenario({ wrongChain: true });
  await live(wrong.page);
  await connect(wrong.page);
  await expect(
    wrong.page.getByRole("button", { name: "Donate to LPs" }),
  ).toBeDisabled();
  await wrong.page.getByRole("button", { name: "Switch to Sepolia" }).click();
  await expect(
    wrong.page.getByRole("button", { name: "Donate to LPs" }),
  ).toBeEnabled();
  assert.equal(
    wrong.state.requests.filter(
      (r) => r.method === "wallet_switchEthereumChain",
    ).length,
    2,
  );
  assert.equal(
    wrong.state.requests.filter((r) => r.method === "wallet_addEthereumChain")
      .length,
    1,
  );
  pass(
    "Wrong network gates actions, adds the exact unknown chain and switches again",
  );
  await wrong.context.close();
  const absent = await scenario({ noWallet: true, events: false });
  await live(absent.page);
  await absent.page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(absent.page.getByRole("alert")).toContainText(
    "No browser wallet",
  );
  await expect(
    absent.page.getByText("No fee events in the last 1,000 blocks."),
  ).toBeVisible();
  pass("Missing wallet and empty event state");
  await absent.context.close();
  const noLiq = await scenario({ noLiquidity: true });
  await live(noLiq.page);
  await connect(noLiq.page);
  await expect(
    noLiq.page.getByRole("button", { name: "Donate to LPs" }),
  ).toBeDisabled();
  await expect(
    noLiq.page.getByText(/No in-range liquidity. Donations/),
  ).toBeVisible();
  pass("No-liquidity donation guard");
  await noLiq.context.close();
  const missing = await scenario({ missingCode: true });
  await expect(
    missing.page
      .getByRole("alert")
      .filter({ hasText: "contract code is missing" }),
  ).toContainText("contract code is missing", { timeout: 30000 });
  await expect(
    missing.page.getByRole("button", { name: "Get quote" }),
  ).toBeDisabled();
  pass("Missing deployed code fails closed");
  await missing.context.close();
  const fail = await scenario({ failRpc: true });
  await expect(fail.page.getByText("Pool connection unavailable")).toBeVisible({
    timeout: 30000,
  });
  await expect(
    fail.page.getByRole("button", { name: "Donate to LPs" }),
  ).toBeDisabled();
  fail.state.failRpc = false;
  await fail.page.getByRole("button", { name: "Refresh data" }).click();
  await live(fail.page);
  pass("RPC failure and explicit refresh recovery");
  await fail.context.close();
  const slow = await scenario({ slow: true, noWallet: true });
  await live(slow.page);
  pass(
    "Slow sequential RPC reads complete without overlapping polling starvation",
  );
  await slow.context.close();
  const bad = await browser.newContext();
  const badPage = await bad.newPage();
  await badPage.route("**/abi/HappyHourHook.json", (route) =>
    route.fulfill({ json: [] }),
  );
  await badPage.goto(url);
  await expect(badPage.getByRole("alert")).toContainText(
    "ABI verification failed",
  );
  await expect(
    badPage.getByRole("button", { name: "Donate to LPs" }),
  ).toHaveCount(0);
  pass("Tampered ABI prevents application startup");
  await bad.close();
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(resourceFailures, []);
  pass("No uncaught page exceptions or failed static resources");
  const real = await scenario({ liveRpc: true, noWallet: true });
  let liveBrowser;
  try {
    await live(real.page);
    liveBrowser = {
      result: "pass",
      label: await real.page.locator(".clock-column .small-text").innerText(),
    };
    await real.page.screenshot({
      path: resolve(out, "live-desktop.png"),
      fullPage: true,
    });
  } catch (e) {
    liveBrowser = { result: "unavailable", error: String(e).slice(0, 500) };
  }
  await real.context.close();
  await writeFile(
    resolve(out, "browser-results.json"),
    JSON.stringify(
      {
        result: "pass",
        date: new Date().toISOString(),
        browser: await browser.version(),
        previewPath: "/preview/",
        mocked: true,
        liveBrowser,
        contrast,
        realTransactions: 0,
        checks,
        consoleErrors,
        resourceFailures,
        axe: {
          desktopViolations: axe.violations.length,
          mobileViolations: mobileAxe.violations.length,
        },
        limitations: [
          "Mocked RPC and injected wallet; no funded live-chain transactions",
          "No physical-device, native browser zoom or screen-reader session",
          "Supplied browser MCP transport was closed; local Playwright used",
        ],
      },
      null,
      2,
    ) + "\n",
  );
} catch (e) {
  await writeFile(
    resolve(out, "browser-results.json"),
    JSON.stringify(
      {
        result: "failed",
        checks,
        error: String(e),
        consoleErrors,
        resourceFailures,
      },
      null,
      2,
    ) + "\n",
  );
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
