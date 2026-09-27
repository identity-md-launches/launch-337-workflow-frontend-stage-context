import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { loadDeployment } from "./config";
import App from "./App";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <main className="boot">
    <p className="eyebrow">Happy Hour</p>
    <h1>Checking the deployment…</h1>
    <p>Loading configuration and verifying contract interfaces.</p>
  </main>,
);
loadDeployment()
  .then((d) =>
    root.render(
      <WagmiProvider config={d.wagmi}>
        <QueryClientProvider client={new QueryClient()}>
          <App d={d} />
        </QueryClientProvider>
      </WagmiProvider>,
    ),
  )
  .catch((e) =>
    root.render(
      <main className="boot">
        <p className="eyebrow">Happy Hour</p>
        <h1>Unable to verify this deployment</h1>
        <p role="alert">{e.message}</p>
        <button onClick={() => location.reload()}>Reload configuration</button>
      </main>,
    ),
  );
