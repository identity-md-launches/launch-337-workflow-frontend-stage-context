import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccount, useConnect, useDisconnect, useWalletClient } from "wagmi";
import { formatUnits, type Hex } from "viem";
import type { Deployment } from "./config";
import {
  amountValue,
  assertWallet,
  displayAmount,
  duration,
  minimumOutput,
  permitAbi,
  poolId,
  poolKey,
  quoterAbi,
  readableError,
  slippageValue,
  swapCall,
  switchNetwork,
  type Provider,
} from "./protocol";
import { usePool } from "./state";

type Quote = {
  out: bigint;
  minimum: bigint;
  amount: bigint;
  signature: string;
  expires: number;
  deadline: bigint;
  tokenAllowed: boolean;
  routerAllowed: boolean;
};
function Sun({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={small ? "sun small" : "sun"}
      viewBox="0 0 120 120"
      fill="none"
    >
      <circle cx="60" cy="60" r="27" stroke="currentColor" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => (
        <path
          key={i}
          d="M60 11V23"
          stroke="currentColor"
          strokeWidth="2"
          transform={`rotate(${i * 30} 60 60)`}
        />
      ))}
      <path
        d="M49 64Q60 76 71 64M48 52h1M71 52h1"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
export default function App({ d }: { d: Deployment }) {
  const { address, chainId, connector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: wallet } = useWalletClient();
  const pool = usePool(d, address);
  const s = pool.data;
  const [tick, setTick] = useState(performance.now());
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [hash, setHash] = useState<Hex>();
  const [review, setReview] = useState(false);
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [fieldError, setFieldError] = useState("");
  const [chosen, setChosen] = useState("");
  const formVersion = useRef("");
  const symbol = d.manifest.token.symbol;
  const native = d.manifest.network.nativeCurrency.symbol;
  const signature = JSON.stringify([buy, amount, slippage, address, chainId]);
  formVersion.current = signature;
  useEffect(() => {
    const timer = setInterval(() => setTick(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setQuote(undefined);
    setReview(false);
    setFieldError("");
  }, [signature]);
  useEffect(() => {
    if (fieldError && !busy)
      document
        .getElementById(/slippage/i.test(fieldError) ? "slippage" : "amount")
        ?.focus();
  }, [fieldError, busy]);
  const elapsed = s ? Math.max(0, (tick - s.received) / 1000) : 0;
  const remaining = s ? Math.max(0, s.seconds - Math.min(elapsed, 45)) : 0;
  const fresh =
    !!s &&
    !pool.error &&
    elapsed < 45 &&
    remaining > 0 &&
    Math.abs(Date.now() / 1000 - s.timestamp) < 180;
  const correctChain = chainId === d.manifest.chainId;
  const ready =
    !!address && correctChain && fresh && s?.account === address && !!wallet;
  const quoteValid =
    !!quote && quote.signature === signature && tick < quote.expires && fresh;
  const explorer = (path: string) => d.manifest.network.explorer + path;
  const clock = s
    ? new Date((s.timestamp + Math.min(elapsed, 45)) * 1000)
        .toISOString()
        .slice(11, 19)
    : "––:––:––";
  const run = async (label: string, fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setStatus("");
    setHash(undefined);
    try {
      await fn();
    } catch (e) {
      setError(readableError(e));
      requestAnimationFrame(() =>
        document
          .getElementById("action-feedback")
          ?.scrollIntoView({ block: "nearest" }),
      );
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const getProvider = async () => {
    if (!connector || !address)
      throw Error("Connect a browser wallet to continue.");
    return (await connector.getProvider()) as Provider;
  };
  const connect = () =>
    run("Connecting", async () => {
      const c = connectors.find((c) => c.uid === chosen) || connectors[0];
      if (!c || !(await c.getProvider()))
        throw Error(
          "No browser wallet found. Install an Ethereum wallet, then reload this page.",
        );
      await connectAsync({ connector: c });
      setStatus("Wallet connected. Check the network before continuing.");
    });
  // Every signature has a fresh simulation and two direct wallet identity checks.
  const transact = async (
    call: Record<string, unknown>,
    label: string,
    guard: () => void = () => {},
  ) => {
    if (!ready || !address || !wallet)
      throw Error(
        "Connect on the configured network and refresh live pool state first.",
      );
    const provider = await getProvider();
    await assertWallet(provider, d.manifest.chainId, address);
    if ((await d.client.getChainId()) !== d.manifest.chainId)
      throw Error("RPC network mismatch. Refresh and retry.");
    setStatus(`Simulating ${label.toLowerCase()}…`);
    const { request } = await d.client.simulateContract({
      ...call,
      account: address,
    } as Parameters<typeof d.client.simulateContract>[0]);
    await assertWallet(provider, d.manifest.chainId, address);
    if (
      performance.now() - s!.received > 45_000 ||
      performance.now() - s!.received >= s!.seconds * 1000
    )
      throw Error(
        "Pool data expired during simulation. Refresh and try again.",
      );
    guard();
    setStatus(`Confirm ${label.toLowerCase()} in your wallet.`);
    const tx = await wallet.writeContract(request);
    setHash(tx);
    setStatus(`${label} submitted. Waiting for a receipt…`);
    const receipt = await d.client.waitForTransactionReceipt({
      hash: tx,
      timeout: 120_000,
    });
    if (receipt.status !== "success")
      throw Error(
        `${label} reverted. Check the transaction and refresh before trying again.`,
      );
    setStatus(
      `${label} confirmed.${label.includes("approval") ? " Get a fresh quote to continue." : ""}`,
    );
    setReview(false);
    setQuote(undefined);
    await pool.refresh();
  };
  const requestQuote = (e: FormEvent) => {
    e.preventDefault();
    setFieldError("");
    void run("Quoting", async () => {
      if (!fresh || !s?.price)
        throw Error("Refresh live pool state before requesting a quote.");
      let input: bigint, bps: number;
      try {
        input = amountValue(
          amount,
          buy ? d.manifest.network.nativeCurrency.decimals : s.decimals,
        );
        bps = slippageValue(slippage);
      } catch (e) {
        setFieldError(readableError(e));
        return;
      }
      const snapshot = signature;
      const result = await d.client.simulateContract({
        address: d.manifest.network.uniswapV4.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: poolKey(d),
            zeroForOne: buy,
            exactAmount: input,
            hookData: "0x",
          },
        ],
      });
      const out = result.result[0],
        minimum = minimumOutput(out, bps);
      let tokenAllowed = buy,
        routerAllowed = buy;
      if (!buy && address) {
        const [allowance, permit] = await Promise.all([
          d.client.readContract({
            address: d.token.address,
            abi: d.token.abi,
            functionName: "allowance",
            args: [address, d.manifest.network.uniswapV4.permit2],
          }),
          d.client.readContract({
            address: d.manifest.network.uniswapV4.permit2,
            abi: permitAbi,
            functionName: "allowance",
            args: [
              address,
              d.token.address,
              d.manifest.network.uniswapV4.universalRouter,
            ],
          }),
        ]);
        tokenAllowed = (allowance as bigint) >= input;
        routerAllowed =
          permit[0] >= input && permit[1] > Math.floor(Date.now() / 1000) + 300;
      }
      if (formVersion.current !== snapshot) return;
      setQuote({
        out,
        minimum,
        amount: input,
        signature: snapshot,
        expires: Math.min(
          performance.now() + 30_000,
          s.received + s.seconds * 1000,
        ),
        deadline: BigInt(s.timestamp + 300),
        tokenAllowed,
        routerAllowed,
      });
      setStatus("Quote ready. Review the minimum received before signing.");
    });
  };
  const balance = buy ? s?.balance0 : s?.balance1;
  const enough = quote && balance !== undefined && balance >= quote.amount;
  const blocked = !address
    ? "Connect your wallet to make a transaction."
    : !correctChain
      ? `Switch to ${d.manifest.network.name} to continue.`
      : !fresh
        ? "Waiting for fresh, verified pool data."
        : s?.liquidity === 0n
          ? "No in-range liquidity. Donations will be available when liquidity returns."
          : "";
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header wrap">
        <a className="brand" href="#main">
          <Sun small />
          <span>
            Happy Hour
            <span className="brand-sub">A little better, every day.</span>
          </span>
        </a>
        <div className="wallet-area">
          <span className="network-pill">
            <span className="dot" />
            {d.manifest.network.name} testnet
          </span>
          {address ? (
            <>
              <span className="account" title={address}>
                {short(address)}
              </span>
              <button
                className="compact"
                disabled={!!busy}
                onClick={() => disconnect()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              {connectors.length > 1 && (
                <label className="wallet-picker">
                  Wallet
                  <select
                    aria-label="Choose wallet"
                    value={chosen}
                    onChange={(e) => setChosen(e.target.value)}
                  >
                    {connectors.map((c) => (
                      <option key={c.uid} value={c.uid}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="compact" disabled={!!busy} onClick={connect}>
                {busy === "Connecting" ? "Connecting…" : "Connect wallet"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            </>
          )}
        </div>
      </header>
      <main id="main" className="wrap">
        <section className="intro">
          <div>
            <p className="eyebrow">The ETH / {symbol} pool · Uniswap v4</p>
            <h1>
              Good timing.
              <br />
              <em>Better fees.</em>
            </h1>
            <p className="lede">
              A smaller hook fee, every day from 16:00–17:00 UTC.
              <br className="desktop-break" /> Every collected fee goes back to
              liquidity providers.
            </p>
          </div>
          <div className="daily-stamp">
            <Sun />
            <span>
              Same time.
              <br />
              Every day.
            </span>
          </div>
        </section>
        {address && !correctChain && (
          <div className="notice warning">
            <p>Your wallet is on another network.</p>
            <button
              disabled={!!busy}
              onClick={() =>
                run("Switching", async () => {
                  await switchNetwork(await getProvider(), d);
                  setStatus("Network switched. Refreshing pool state.");
                  await pool.refresh();
                })
              }
            >
              Switch to {d.manifest.network.name}
            </button>
          </div>
        )}
        <section className="clock-panel" aria-label="Fee schedule">
          <div className="clock-column">
            <span className="eyebrow">Pool clock · UTC</span>
            <div className="clock numerals">{clock}</div>
            <span className="small-text">
              {s
                ? `Block ${s.block.toLocaleString("en-US")} · ${fresh ? "interpolated between blocks" : "last observed time"}`
                : "Waiting for a public RPC"}
            </span>
          </div>
          <div className="fee-column">
            <span className="eyebrow">Current hook fee</span>
            <div className="fee numerals">
              {s ? `${s.fee / 100}` : "–"}
              <span>%</span>
            </div>
            <span className="period">
              {s
                ? s.happy
                  ? "Happy hour is on"
                  : "Standard hours"
                : "Checking the pool"}
            </span>
          </div>
          <div className="countdown-column">
            <span className="eyebrow">
              {s?.happy ? "Happy hour ends in" : "Next happy hour in"}
            </span>
            <div className="countdown numerals">
              {s ? duration(remaining) : "––:––:––"}
            </div>
            <p>
              {fresh
                ? s?.happy
                  ? "Enjoy the 0.1% hook fee."
                  : "The hook fee drops to 0.1%."
                : s
                  ? "Waiting for the next confirmed block."
                  : "The countdown follows the hook’s clock."}
            </p>
          </div>
        </section>
        <div className="schedule">
          <span>00:00</span>
          <div className="schedule-track">
            <span className="hour-window" />
            <span
              className="time-marker"
              style={{
                insetInlineStart: `${s ? ((s.timestamp + Math.min(elapsed, 45)) % 86400) / 864 : 0}%`,
              }}
            />
          </div>
          <span>24:00 UTC</span>
        </div>
        <p className="schedule-note">
          <span className="legend" /> Happy hour · 16:00–17:00 UTC{" "}
          <span className="muted">/</span> LP fee: {d.manifest.pool.fee / 10000}
          % at all times
        </p>
        <div className="connection-row">
          <p>
            <span className={`dot ${fresh ? "green" : ""}`} />
            {pool.loading
              ? "Refreshing pool state…"
              : fresh
                ? "Live pool reads · deployment checked"
                : pool.error
                  ? "Pool connection unavailable"
                  : "Waiting for fresh pool data"}
          </p>
          <button
            className="text-button"
            disabled={pool.loading || !!busy}
            onClick={() => pool.refresh()}
          >
            Refresh data <span aria-hidden="true">↻</span>
          </button>
        </div>
        {pool.error && (
          <p className="notice error" role="alert">
            {pool.error}
          </p>
        )}
        <div id="action-feedback">
          <div className="transaction-status" aria-live="polite" role="status">
            {status && <p>{status}</p>}
            {hash && (
              <a
                href={explorer(`/tx/${hash}`)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on explorer ↗
              </a>
            )}
          </div>
          <div role="alert">
            {error && <p className="notice error">{error}</p>}
          </div>
        </div>
        <div className="action-grid">
          <section className="card donation">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Give back to the pool</p>
                <h2>Fees with somewhere to go.</h2>
              </div>
              <span className="round-icon" aria-hidden="true">
                ↗
              </span>
            </div>
            <p>
              These collected fees are waiting to be shared with liquidity
              providers. Anyone can send them on their way.
            </p>
            <div className="balances">
              <div>
                <span className="asset-label">
                  <span className="coin eth" aria-hidden="true">
                    Ξ
                  </span>
                  {native} accrued
                </span>
                <strong
                  className="balance numerals"
                  title={
                    s
                      ? formatUnits(
                          s.accrued0,
                          d.manifest.network.nativeCurrency.decimals,
                        )
                      : ""
                  }
                >
                  {s
                    ? displayAmount(
                        s.accrued0,
                        d.manifest.network.nativeCurrency.decimals,
                      )
                    : "—"}
                </strong>
                <span className="small-text">Native {native}</span>
              </div>
              <div>
                <span className="asset-label">
                  <span className="coin hapy" aria-hidden="true">
                    H
                  </span>
                  {symbol} accrued
                </span>
                <strong
                  className="balance numerals"
                  title={s ? formatUnits(s.accrued1, s.decimals) : ""}
                >
                  {s ? displayAmount(s.accrued1, s.decimals) : "—"}
                </strong>
                <span className="small-text">Happy Hour token</span>
              </div>
            </div>
            <div className="donate-action">
              <button
                className="primary"
                disabled={
                  !ready ||
                  !!busy ||
                  s?.liquidity === 0n ||
                  (!!s && s.accrued0 + s.accrued1 === 0n)
                }
                onClick={() => setReview(true)}
              >
                Donate to LPs <span aria-hidden="true">↗</span>
              </button>
              <p className="small-text">
                {blocked ||
                  (s && s.accrued0 + s.accrued1 === 0n
                    ? "Nothing accrued yet. Fees collect when the pool is traded."
                    : "Returns both currencies to in-range LPs. You pay network gas only.")}
              </p>
            </div>
            {review && (
              <div className="review">
                <h3>Review your donation</h3>
                <p>
                  Donate all accrued fees:{" "}
                  <strong>
                    {s &&
                      formatUnits(
                        s.accrued0,
                        d.manifest.network.nativeCurrency.decimals,
                      )}{" "}
                    {native}
                  </strong>{" "}
                  and{" "}
                  <strong>
                    {s && formatUnits(s.accrued1, s.decimals)} {symbol}
                  </strong>
                  . The amounts may change before confirmation.
                </p>
                <p>
                  No tokens leave your wallet. There is no reward for calling;
                  you pay gas. This donation cannot be undone.
                </p>
                <div className="button-row">
                  <button
                    disabled={
                      !ready ||
                      !!busy ||
                      !s?.liquidity ||
                      s.accrued0 + s.accrued1 === 0n
                    }
                    onClick={() =>
                      run("Donating", () =>
                        transact(
                          {
                            address: d.hook.address,
                            abi: d.hook.abi,
                            functionName: "donateFees",
                            args: [poolKey(d)],
                          },
                          "Donation",
                        ),
                      )
                    }
                  >
                    {busy === "Donating" ? "Donating…" : "Confirm donation"}
                  </button>
                  <button
                    disabled={!!busy}
                    className="text-button"
                    onClick={() => setReview(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <details>
              <summary>How donations are shared</summary>
              <p>
                Only liquidity that is in range when the donation executes
                receives fees. Liquidity added just before a donation shares
                earlier fees (JIT capture). With no in-range liquidity, the
                transaction reverts and all fees stay accrued. There is no
                owner, admin, fee recipient, or caller reward.
              </p>
            </details>
          </section>
          <section className="card swap">
            <p className="eyebrow">A seat at the pool</p>
            <h2>Swap {symbol}</h2>
            <form onSubmit={requestQuote}>
              <fieldset disabled={!!busy}>
                <legend className="sr-only">Swap direction</legend>
                <div className="segments">
                  <button
                    type="button"
                    aria-pressed={buy}
                    onClick={() => setBuy(true)}
                  >
                    Buy {symbol}
                  </button>
                  <button
                    type="button"
                    aria-pressed={!buy}
                    onClick={() => setBuy(false)}
                  >
                    Sell {symbol}
                  </button>
                </div>
                <label htmlFor="amount">
                  You pay <span>{buy ? native : symbol}</span>
                </label>
                <input
                  id="amount"
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setQuote(undefined);
                  }}
                  aria-invalid={!!fieldError && !/slippage/i.test(fieldError)}
                  aria-describedby="amount-help form-error"
                />
                <p id="amount-help" className="small-text">
                  {address && s
                    ? `Balance: ${displayAmount(balance ?? 0n, buy ? d.manifest.network.nativeCurrency.decimals : s.decimals)} ${buy ? native : symbol}${buy ? " · keep some for gas" : ""}`
                    : "Connect a wallet to see your balance."}
                </p>
                <div className="slippage">
                  <label htmlFor="slippage">
                    Slippage limit <span className="muted">%</span>
                  </label>
                  <input
                    id="slippage"
                    aria-invalid={!!fieldError && /slippage/i.test(fieldError)}
                    name="slippage"
                    inputMode="decimal"
                    value={slippage}
                    onChange={(e) => {
                      setSlippage(e.target.value);
                      setQuote(undefined);
                    }}
                    aria-describedby="form-error"
                  />
                </div>
                <p
                  id="form-error"
                  className="error-text"
                  role={fieldError ? "alert" : undefined}
                >
                  {fieldError}
                </p>
                <button
                  className="full"
                  disabled={!fresh || !s?.price || !!busy}
                  type="submit"
                >
                  {busy === "Quoting" ? "Getting quote…" : "Get quote"}{" "}
                  <span aria-hidden="true">↗</span>
                </button>
              </fieldset>
            </form>
            {quote && (
              <div className="quote">
                <dl>
                  <div>
                    <dt>Expected output</dt>
                    <dd>
                      {displayAmount(
                        quote.out,
                        buy
                          ? s!.decimals
                          : d.manifest.network.nativeCurrency.decimals,
                      )}{" "}
                      {buy ? symbol : native}
                    </dd>
                  </div>
                  <div>
                    <dt>Minimum received</dt>
                    <dd>
                      {formatUnits(
                        quote.minimum,
                        buy
                          ? s!.decimals
                          : d.manifest.network.nativeCurrency.decimals,
                      )}{" "}
                      {buy ? symbol : native}
                    </dd>
                  </div>
                  <div>
                    <dt>Rate per {buy ? native : symbol}</dt>
                    <dd>
                      {(
                        Number(
                          formatUnits(
                            quote.out,
                            buy
                              ? s!.decimals
                              : d.manifest.network.nativeCurrency.decimals,
                          ),
                        ) / Number(amount)
                      ).toLocaleString("en-US", {
                        maximumSignificantDigits: 6,
                      })}{" "}
                      {buy ? symbol : native}
                    </dd>
                  </div>
                </dl>
                <p className="small-text">
                  {quoteValid
                    ? `Quote expires in ${Math.max(0, Math.ceil((quote.expires - tick) / 1000))}s. Output includes pool and hook fees.`
                    : "Quote expired. Get a new quote before continuing."}
                </p>
                {!buy && (
                  <ol className="approval-steps">
                    <li>
                      Approve {symbol} for Permit2.{" "}
                      <button
                        disabled={
                          !ready || !quoteValid || !!busy || quote.tokenAllowed
                        }
                        onClick={() =>
                          run("Approving token", () =>
                            transact(
                              {
                                address: d.token.address,
                                abi: d.token.abi,
                                functionName: "approve",
                                args: [
                                  d.manifest.network.uniswapV4.permit2,
                                  quote.amount,
                                ],
                              },
                              "Token approval",
                            ),
                          )
                        }
                      >
                        {quote.tokenAllowed ? "Approved" : "Approve token"}
                      </button>
                    </li>
                    <li>
                      Allow the router to spend this amount for 30 minutes.{" "}
                      <button
                        disabled={
                          !ready ||
                          !quoteValid ||
                          !!busy ||
                          !quote.tokenAllowed ||
                          quote.routerAllowed
                        }
                        onClick={() =>
                          run("Approving router", () =>
                            transact(
                              {
                                address: d.manifest.network.uniswapV4.permit2,
                                abi: permitAbi,
                                functionName: "approve",
                                args: [
                                  d.token.address,
                                  d.manifest.network.uniswapV4.universalRouter,
                                  quote.amount,
                                  Math.floor(Date.now() / 1000) + 1800,
                                ],
                              },
                              "Router approval",
                            ),
                          )
                        }
                      >
                        {quote.routerAllowed ? "Approved" : "Approve router"}
                      </button>
                    </li>
                  </ol>
                )}
                <button
                  className="full"
                  disabled={
                    !ready ||
                    !quoteValid ||
                    !!busy ||
                    !enough ||
                    !quote.tokenAllowed ||
                    !quote.routerAllowed
                  }
                  onClick={() =>
                    run("Swapping", async () => {
                      if (
                        performance.now() >= quote.expires ||
                        formVersion.current !== quote.signature
                      )
                        throw Error("Quote expired. Get a new quote.");
                      await transact(
                        swapCall(
                          d,
                          buy,
                          quote.amount,
                          quote.minimum,
                          quote.deadline,
                        ),
                        "Swap",
                        () => {
                          if (
                            performance.now() >= quote.expires ||
                            formVersion.current !== quote.signature
                          )
                            throw Error(
                              "Quote expired during simulation. Get a new quote.",
                            );
                        },
                      );
                    })
                  }
                >
                  {busy === "Swapping"
                    ? "Swapping…"
                    : `Swap ${buy ? native : symbol} for ${buy ? symbol : native}`}
                </button>
                <p className="small-text">
                  {!address || !correctChain
                    ? blocked
                    : !enough
                      ? "Insufficient balance for this swap."
                      : !buy
                        ? "After each approval, get a fresh quote to update the next step."
                        : "You pay the input amount plus network gas. No token approval needed."}
                </p>
              </div>
            )}
            <p className="small-text swap-note">
              Sepolia test assets only. Quotes can change; your slippage limit
              sets the minimum you receive.
            </p>
          </section>
        </div>
        <section className="activity">
          <div className="section-heading">
            <div>
              <p className="eyebrow">On the record</p>
              <h2>Recent pool activity</h2>
            </div>
            <span className="small-text">
              {pool.eventRange
                ? `Blocks ${pool.eventRange}`
                : "Loading recent blocks"}
            </span>
          </div>
          {pool.eventsError ? (
            <p className="notice error">{pool.eventsError}</p>
          ) : pool.events.length ? (
            <ul className="event-list">
              {pool.events.map((e) => (
                <li key={e.hash + e.index}>
                  <span className="event-mark" aria-hidden="true">
                    {e.name === "Donated" ? "↗" : "+"}
                  </span>
                  <div>
                    <strong>
                      {e.name === "Donated"
                        ? "Fees donated to LPs"
                        : "Hook fee collected"}
                    </strong>
                    <p className="small-text">
                      {e.name === "Donated"
                        ? `${displayAmount(e.amount0 ?? 0n, d.manifest.network.nativeCurrency.decimals)} ${native} + ${displayAmount(e.amount1 ?? 0n, s?.decimals ?? d.manifest.token.decimals)} ${symbol}`
                        : `${displayAmount(e.amount ?? 0n, e.currency?.toLowerCase() === d.token.address.toLowerCase() ? (s?.decimals ?? d.manifest.token.decimals) : d.manifest.network.nativeCurrency.decimals)} ${e.currency?.toLowerCase() === d.token.address.toLowerCase() ? symbol : native} · ${Number(e.bps) / 100}%`}
                    </p>
                  </div>
                  <a
                    href={explorer(`/tx/${e.hash}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Block {String(e.block)} ↗
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <span aria-hidden="true">◷</span>
              <p>
                {pool.eventRange
                  ? "No fee events in the last 1,000 blocks."
                  : "Reading recent fee events…"}
                <span className="small-text">
                  Pool balances above are read directly from the hook.
                </span>
              </p>
            </div>
          )}
        </section>
        <section className="notes-grid">
          <div>
            <span className="eyebrow">01 / Watch the clock</span>
            <h3>A daily window</h3>
            <p>
              The hook fee drops from 1% to 0.1% at 16:00 UTC, then returns at
              17:00. Block timestamps decide the rate; a few seconds of boundary
              skew are possible.
            </p>
          </div>
          <div>
            <span className="eyebrow">02 / Know the fee</span>
            <h3>Two separate fees</h3>
            <p>
              The pool’s {d.manifest.pool.fee / 10000}% LP fee is always
              separate. Exact-input trades pay the hook fee from output. Tiny
              fees round down to zero.
            </p>
          </div>
          <div>
            <span className="eyebrow">03 / Pass it on</span>
            <h3>Made for LPs</h3>
            <p>
              Fees accrue as PoolManager claims until someone donates them. No
              ETH transfer or donation happens inside a swap.
            </p>
          </div>
        </section>
        <details className="deployment-details">
          <summary>Deployment & pool details</summary>
          <dl>
            <div>
              <dt>Connected wallet</dt>
              <dd>{address || "Not connected"}</dd>
            </div>
            <div>
              <dt>Pool ID</dt>
              <dd>{poolId(d)}</dd>
            </div>
            {d.manifest.contracts.map((c) => (
              <div key={c.name}>
                <dt>{c.name}</dt>
                <dd>
                  <a
                    href={explorer(`/address/${c.address}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {c.address} ↗
                  </a>
                </dd>
              </div>
            ))}
            <div>
              <dt>Source commit</dt>
              <dd>{d.manifest.sourceCommit}</dd>
            </div>
            <div>
              <dt>RPC endpoints</dt>
              <dd>{d.manifest.network.rpcUrls.join(" · ")}</dd>
            </div>
            <div>
              <dt>Pool parameters</dt>
              <dd>
                LP fee {d.manifest.pool.fee} · tick spacing{" "}
                {d.manifest.pool.tickSpacing}
              </dd>
            </div>
          </dl>
          <p className="small-text">
            The displayed fee is from the last verified block. The clock and
            countdown interpolate between reads and pause after 45 seconds.
            Transactions wait for a new read at fee boundaries. Recent events
            can reorganize; they are not used to calculate balances. Hook data
            does not credit a swapper or router.
          </p>
          <a href="./imd-deployment.json">View deployment manifest ↗</a>
        </details>
      </main>
      <footer className="footer wrap">
        <span className="brand footer-brand">
          <Sun small /> Happy Hour
        </span>
        <p>A daily ritual. An open pool.</p>
        <a
          href={d.manifest.network.faucets[0]}
          target="_blank"
          rel="noreferrer"
        >
          Get test {native} ↗
        </a>
      </footer>
    </>
  );
}
