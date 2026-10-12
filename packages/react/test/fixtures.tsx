import { act, render, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { createDAppKit, DAppKitProvider } from "@mysten/dapp-kit-react";
import {
  getWallets,
  type Wallet,
  type SuiSignTransactionInput,
} from "@mysten/wallet-standard";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SuiClientTypes } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  fromBase64,
  normalizeSuiAddress,
  normalizeStructTag,
  SUI_TYPE_ARG,
} from "@mysten/sui/utils";
import {
  SuigateClient,
  deriveEntitlementId,
  type Entitlement,
  type EntitlementTransaction,
  type Plan,
  type Service,
} from "@suigate/core";
import {
  SuigatePaywall,
  SuigateProvider,
  type Deployment,
  type Sponsorship,
  type SuigatePaywallProps,
} from "../src/index.js";

export const address = normalizeSuiAddress;
export const PACKAGE = address("0xabc");
export const SERVICE = address("0x100");
export const CHAIN = "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD";
export const COIN = normalizeStructTag(SUI_TYPE_ARG);
export const deployment: Deployment = {
  network: "testnet",
  packageId: PACKAGE,
  chainIdentifier: CHAIN,
};
export const service: Service = {
  id: SERVICE,
  objectVersion: "1",
  owner: address("0xa"),
  adminCapId: address("0xc"),
  paymentRecipient: address("0xa"),
  registryId: address("0x200"),
  version: 2n,
  plans: { id: address("0x300"), size: 1n },
  revocations: { id: address("0x400"), size: 0n },
};
export const plan: Plan = {
  serviceId: SERVICE,
  key: "pro",
  price: 1_500_000_000n,
  coinType: COIN,
  durationMs: 86_400_000n,
  version: 3n,
  purchasesEnabled: true,
  renewalsEnabled: true,
};

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function fixture(options: { sponsored?: boolean } = {}) {
  const keypair = new Ed25519Keypair();
  const sponsorKeypair = new Ed25519Keypair();
  const sender = keypair.toSuiAddress();
  const entitlementId = deriveEntitlementId({
    typeOrigin: PACKAGE,
    serviceId: SERVICE,
    owner: sender,
    plan: "pro",
  });
  const entitlement: Entitlement = {
    id: entitlementId,
    objectVersion: "1",
    owner: sender,
    holder: sender,
    serviceId: SERVICE,
    plan: "pro",
    issuedAt: BigInt(Date.now()),
    expiresAt: BigInt(Date.now() + 86_400_000),
    revision: 0n,
    planVersion: plan.version,
  };
  const client = new SuiGrpcClient({
    network: "testnet",
    baseUrl: "http://127.0.0.1:1",
  });
  const kit = createDAppKit({
    networks: ["testnet", "mainnet"],
    createClient: () => client,
    autoConnect: false,
    slushWalletConfig: null,
    storage: null,
  });
  const account = {
    address: sender,
    publicKey: keypair.getPublicKey().toRawBytes(),
    chains: ["sui:testnet", "sui:mainnet"] as const,
    features: ["sui:signTransaction"] as const,
  };
  const sign = vi.fn(async ({ transaction }: SuiSignTransactionInput) =>
    keypair.signTransaction(fromBase64(await transaction.toJSON())),
  );
  const connect = vi.fn(async () => ({ accounts: [account] }));
  const standardWallet: Wallet = {
    version: "1.0.0",
    name: `Test wallet ${sender.slice(-8)}`,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLz4=",
    chains: ["sui:testnet", "sui:mainnet"],
    accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
      "sui:signTransaction": { version: "2.0.0", signTransaction: sign },
    },
  };
  disposers.push(getWallets().register(standardWallet));
  disposers.push(kit.stores.$wallets.listen(() => {}));
  const sponsorSign = vi.fn(async ({ bytes }: { bytes: Uint8Array }) =>
    sponsorKeypair.signTransaction(bytes),
  );
  const sponsorship: Sponsorship = {
    sponsor: { address: sponsorKeypair.toSuiAddress(), budget: 10_000_000n },
    sign: sponsorSign,
  };
  const getService = vi
    .spyOn(SuigateClient.prototype, "getService")
    .mockResolvedValue(service);
  const getPlan = vi
    .spyOn(SuigateClient.prototype, "getPlan")
    .mockResolvedValue(plan);
  const verify = vi
    .spyOn(SuigateClient.prototype, "verifyEntitlement")
    .mockResolvedValue(entitlement);
  const balance = vi
    .spyOn(client.core, "getBalance")
    .mockImplementation(async ({ coinType = COIN }) => ({
      balance: {
        coinType,
        balance: "100000000000",
        coinBalance: "100000000000",
        addressBalance: "0",
      },
    }));
  vi.spyOn(client.core, "getCoinMetadata").mockResolvedValue({
    coinMetadata: {
      id: address("0x2"),
      name: "Sui",
      symbol: "SUI",
      decimals: 9,
      description: "",
      iconUrl: null,
    },
  });
  const drafts: EntitlementTransaction[] = [];
  const purchase = vi
    .spyOn(SuigateClient.prototype, "purchaseEntitlement")
    .mockImplementation(async (input) => {
      const sponsored =
        input.gas === "sponsored" ||
        (input.gas === "auto" && options.sponsored);
      const transaction = new Transaction();
      transaction.setSender(sender);
      transaction.setGasOwner(sponsored ? sponsorship.sponsor.address : sender);
      transaction.setGasPrice(1000);
      transaction.setGasBudget(10_000_000);
      transaction.setGasPayment(
        sponsored
          ? []
          : [
              {
                objectId: address("0x800"),
                version: "1",
                digest: "11111111111111111111111111111111",
              },
            ],
      );
      transaction.setExpiration({
        ValidDuring: {
          minEpoch: 0,
          maxEpoch: 1,
          minTimestamp: null,
          maxTimestamp: null,
          chain: CHAIN,
          nonce: 1,
        },
      });
      const coin = transaction.splitCoins(
        sponsored
          ? transaction.objectRef({
              objectId: address("0x900"),
              version: "1",
              digest: "11111111111111111111111111111111",
            })
          : transaction.gas,
        [plan.price],
      );
      transaction.moveCall({
        target: `${PACKAGE}::subscriptions::purchase`,
        typeArguments: [plan.coinType],
        arguments: [
          transaction.sharedObjectRef({
            objectId: SERVICE,
            initialSharedVersion: "1",
            mutable: true,
          }),
          transaction.sharedObjectRef({
            objectId: service.registryId,
            initialSharedVersion: "1",
            mutable: true,
          }),
          transaction.pure.string(plan.key),
          transaction.pure.u64(service.version),
          transaction.pure.u64(plan.version),
          transaction.pure.u64(Date.now() + 60000),
          transaction.pure.string(input.nonce!),
          coin,
          transaction.sharedObjectRef({
            objectId: address("0x6"),
            initialSharedVersion: "1",
            mutable: false,
          }),
        ],
      });
      const draft: EntitlementTransaction = {
        transaction,
        entitlementId,
        gas: {
          mode: sponsored ? "sponsored" : "user",
          owner: sponsored ? sponsorship.sponsor.address : sender,
        },
        quote: {
          nonce: input.nonce!,
          service,
          plan,
          deadlineMs: BigInt(Date.now() + 60000),
        },
      };
      drafts.push(draft);
      return draft;
    });
  const successful = (digest: string) =>
    ({
      $kind: "Transaction",
      Transaction: {
        digest,
        status: { success: true, error: null },
        effects: {
          changedObjects: [{ objectId: entitlementId, idOperation: "Created" }],
        },
      },
    }) as SuiClientTypes.TransactionResult<{ effects: true }>;
  const execute = vi
    .spyOn(client.core, "executeTransaction")
    .mockImplementation(async ({ transaction }) =>
      successful(await Transaction.from(transaction).getDigest()),
    );
  const wait = vi
    .spyOn(client.core, "waitForTransaction")
    .mockImplementation(async (input) =>
      successful(
        "digest" in input ? input.digest : input.result.Transaction!.digest,
      ),
    );
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const onStateChange = vi.fn();
  function tree(
    props: Partial<SuigatePaywallProps> = {},
    configuration = deployment,
  ) {
    return (
      <DAppKitProvider dAppKit={kit}>
        <SuigateProvider
          deployment={configuration}
          {...(options.sponsored ? { sponsorship } : {})}
        >
          <SuigatePaywall
            serviceId={SERVICE}
            plan="pro"
            onSuccess={onSuccess}
            onError={onError}
            onStateChange={onStateChange}
            {...props}
          />
        </SuigateProvider>
      </DAppKitProvider>
    );
  }
  return {
    client,
    kit,
    sender,
    entitlement,
    entitlementId,
    keypair,
    sponsorKeypair,
    sponsorship,
    sponsorSign,
    getService,
    getPlan,
    verify,
    balance,
    purchase,
    drafts,
    execute,
    wait,
    sign,
    onSuccess,
    onError,
    onStateChange,
    successful,
    tree,
    render: (props: Partial<SuigatePaywallProps> = {}) => render(tree(props)),
    async connect() {
      await waitFor(() => {
        if (
          !kit.stores.$wallets
            .get()
            .some((wallet) => wallet.name === standardWallet.name)
        )
          throw new Error("Wallet not discovered");
      });
      await act(() =>
        kit.connectWallet({
          wallet: kit.stores.$wallets
            .get()
            .find((wallet) => wallet.name === standardWallet.name)!,
        }),
      );
    },
  };
}
