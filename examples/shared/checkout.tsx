import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createDAppKit,
  DAppKitProvider,
  useCurrentClient,
  useDAppKit,
  useWalletConnection,
  type DAppKit,
} from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  SUI_NETWORKS,
  SuigateClient,
  RISK_NOTICE,
  type Entitlement,
} from "@suigate/core";
import {
  SuigatePaywall,
  SuigateProvider,
  type Sponsorship,
} from "@suigate/react";
import { publicConfiguration, type PublicConfiguration } from "./model.ts";
import { proAccess } from "./api.ts";
import { EXAMPLE_DISCOVERY } from "./discovery.ts";

export interface CheckoutProps {
  rpcUrl?: string;
  initial?: Partial<PublicConfiguration>;
  sponsorship?: Sponsorship;
}

export function ExampleCheckout(props: CheckoutProps) {
  const kit = useMemo(
    () =>
      createDAppKit({
        networks: ["testnet"],
        createClient: (network) =>
          new SuiGrpcClient({
            network,
            baseUrl: props.rpcUrl || SUI_NETWORKS.testnet.rpcUrl,
          }),
        slushWalletConfig: { appName: "suigate testnet example" },
      }),
    [props.rpcUrl],
  );
  return (
    <DAppKitProvider dAppKit={kit}>
      <Checkout {...props} />
    </DAppKitProvider>
  );
}

function Checkout({ initial, sponsorship }: CheckoutProps) {
  const kit = useDAppKit();
  const client = useCurrentClient<DAppKit<string[]>>();
  const { account } = useWalletConnection();
  const [packageId, setPackageId] = useState(initial?.packageId ?? "");
  const [serviceId, setServiceId] = useState(initial?.serviceId ?? "");
  const [plan, setPlan] = useState(initial?.plan ?? "pro");
  const [chainIdentifier, setChainIdentifier] = useState(
    initial?.chainIdentifier ?? SUI_NETWORKS.testnet.chainIdentifier,
  );
  const [configuration, setConfiguration] =
    useState<PublicConfiguration | null>(null);
  const [selected, setSelected] = useState(false);
  const [backendConfiguration, setBackendConfiguration] =
    useState<PublicConfiguration | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiResult, setApiResult] = useState<{
    scope: string;
    body: unknown;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef({ account, configuration });
  current.current = { account, configuration };
  const configured = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) return;
        const config = publicConfiguration(await response.json());
        if (cancelled || configured.current) return;
        setConfiguration(config);
        setBackendConfiguration(config);
        setPackageId(config.packageId);
        setServiceId(config.serviceId);
        setPlan(config.plan);
        setChainIdentifier(config.chainIdentifier);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const held =
    entitlement &&
    account?.address === entitlement.holder &&
    configuration?.serviceId === entitlement.serviceId &&
    configuration.plan === entitlement.plan
      ? entitlement
      : null;

  function configure(event: FormEvent) {
    event.preventDefault();
    try {
      const config = publicConfiguration({
        network: "testnet",
        packageId,
        serviceId,
        chainIdentifier,
        plan,
      });
      configured.current = true;
      setConfiguration(config);
      setSelected(true);
      setEntitlement(null);
      setApiResult(null);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function action(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function findEntitlement() {
    if (!configuration || !account) return;
    const core = new SuigateClient({
      client,
      packageId: configuration.packageId,
      typeOrigin: configuration.typeOrigin,
      chainIdentifier: configuration.chainIdentifier,
    });
    setEntitlement(
      await core.verifyEntitlement({
        serviceId: configuration.serviceId,
        plan: configuration.plan,
        owner: account.address,
      }),
    );
  }
  async function accessPro() {
    if (!configuration || !account || !held) return;
    const captured = { account, configuration };
    const result = await proAccess({
      configuration,
      address: account.address,
      entitlementId: held.id,
      sign: (message) => kit.signPersonalMessage({ message, account }),
      assertCurrent: () => {
        if (
          current.current.account !== captured.account ||
          current.current.configuration !== captured.configuration
        )
          throw new Error(
            "Wallet or configuration changed. Review the request again.",
          );
      },
    });
    setApiResult({
      scope: `${account.address}:${configuration.serviceId}:${configuration.plan}`,
      body: result,
    });
  }
  const scope = `${account?.address}:${configuration?.serviceId}:${configuration?.plan}`;
  return (
    <main>
      <header>
        <aside role="note" aria-label="Example software risk">
          {RISK_NOTICE}
        </aside>
        <p className="eyebrow">suigate / full testnet example</p>
        <h1>
          Software access.
          <br />
          Owned on Sui.
        </h1>
        <p>
          Connect wallet → select Pro → purchase → receive an entitlement →
          authenticate with the API.
        </p>
        {!selected && <ConnectButton />}
      </header>
      <div className="layout">
        <form onSubmit={configure} className="configuration">
          <h2>Your testnet service</h2>
          <p>
            Run suigate deploy first. The example can load its public
            configuration from the backend, or you can enter it here.
          </p>
          <label>
            Package ID
            <input
              value={packageId}
              onChange={(event) => setPackageId(event.target.value)}
              required
            />
          </label>
          <label>
            Service ID
            <input
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              required
            />
          </label>
          <label>
            Chain identifier
            <input
              value={chainIdentifier}
              onChange={(event) => setChainIdentifier(event.target.value)}
              required
            />
          </label>
          <label>
            Plan key
            <input
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
              required
            />
          </label>
          <button type="submit">Load paywall</button>
          <small>
            Public configuration only. No private keys belong in frontend
            variables.
          </small>
        </form>
        <div className="checkout">
          <section className="placeholder">
            <h2>Choose access</h2>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const response = await fetch("/api/free");
                  if (!response.ok)
                    throw new Error(
                      "Free API unavailable. Start the example backend.",
                    );
                  setApiResult({ scope: "free", body: await response.json() });
                })
              }
            >
              Use free API
            </button>{" "}
            <button
              type="button"
              disabled={!configuration || busy}
              onClick={() => setSelected(true)}
            >
              Select Pro
            </button>
            <p>
              Free needs no wallet. Pro requires a paid, unexpired on-chain
              entitlement and a fresh wallet authentication proof.
            </p>
          </section>
          {configuration && selected ? (
            <SuigateProvider
              deployment={configuration}
              {...(sponsorship ? { sponsorship } : {})}
            >
              <SuigatePaywall
                serviceId={configuration.serviceId}
                plan={configuration.plan}
                {...(backendConfiguration &&
                JSON.stringify(backendConfiguration) ===
                  JSON.stringify(configuration)
                  ? { discoveryUrl: EXAMPLE_DISCOVERY.path }
                  : {})}
                labels={{ title: `${configuration.plan} membership` }}
                onSuccess={(result) => setEntitlement(result.entitlement)}
              />
              <button
                type="button"
                disabled={!account || busy}
                onClick={() => void action(findEntitlement)}
              >
                Check existing entitlement
              </button>
            </SuigateProvider>
          ) : (
            <section className="placeholder">
              <h2>Ready when you are</h2>
              <p>
                Configure your testnet service, connect a wallet, then select
                Pro.
              </p>
            </section>
          )}
          {held && (
            <section className="receipt" role="status">
              <h2>Entitlement received</h2>
              <code>{held.id}</code>
              <p>
                Next, sign a one-use login challenge. This does not send another
                payment.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(accessPro)}
              >
                Authenticate and call Pro API
              </button>
            </section>
          )}
          {apiResult &&
            (apiResult.scope === "free" || apiResult.scope === scope) && (
              <pre role="status">{JSON.stringify(apiResult.body, null, 2)}</pre>
            )}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
      <footer>
        The paywall is checkout UI, not an authorization boundary. Your backend
        must verify wallet control and the current entitlement. These demos use
        actual testnet only, not mainnet.
      </footer>
    </main>
  );
}
