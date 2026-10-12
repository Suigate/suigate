import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import { SOFTWARE_RISK } from "@suigate/core";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SuiClientTypes } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { SUI_NETWORKS, SuigateClient } from "@suigate/core";
import {
  initialize,
  readConfig,
  detectProject,
  readState,
  statePath,
  saveState,
  sourceDigest,
  type DeploymentState,
} from "../src/config.js";
import {
  NativeSui,
  decodeSignedTransaction,
  type SignedTransaction,
  type SuiTransport,
  type WalletInfo,
} from "../src/sui.js";
import { deploy, verifyRecoveredPublication } from "../src/deploy.js";

const directories: string[] = [];
const address = normalizeSuiAddress;
const signer = new Ed25519Keypair();
const wallet: WalletInfo = {
  address: signer.toSuiAddress(),
  environment: "testnet",
  chainIdentifier: SUI_NETWORKS.testnet.chainIdentifier,
  version: "sui 1.81.0",
};
const PACKAGE = address("0xabc");
const SERVICE = address("0x123");
const CAP = address("0x456");
const moves = fileURLToPath(new URL("../dist/move/suigate/", import.meta.url));

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "suigate-cli-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await directory();
  const path = join(root, "suigate.config.json");
  const config = await initialize(path, "testnet", PACKAGE);
  let serviceCreated = false;
  let plansCreated = false;
  const client = new SuiGrpcClient({
    network: "testnet",
    baseUrl: "http://127.0.0.1:1",
  });
  vi.spyOn(client.core, "getChainIdentifier").mockResolvedValue({
    chainIdentifier: wallet.chainIdentifier,
  });
  vi.spyOn(client.core, "getMoveFunction").mockResolvedValue({
    function: {
      packageId: PACKAGE,
      moduleName: "subscriptions",
      name: "create_service",
      visibility: "public",
      isEntry: false,
      typeParameters: [],
      returns: [],
      parameters: [
        {
          reference: "mutable",
          body: {
            $kind: "datatype",
            datatype: {
              typeName: `${SUI_NETWORKS.testnet.paymentKitPackageId}::payment_kit::Namespace`,
              typeParameters: [],
            },
          },
        },
        { reference: null, body: { $kind: "u64" } },
        { reference: "mutable", body: { $kind: "u64" } },
      ],
    },
  });
  vi.spyOn(SuigateClient.prototype, "getService").mockImplementation(
    async () => {
      if (!serviceCreated) throw new Error("not yet created");
      return {
        id: SERVICE,
        objectVersion: "1",
        owner: wallet.address,
        paymentRecipient: wallet.address,
        adminCapId: CAP,
        registryId: address("0x321"),
        version: 0n,
        plans: { id: address("0x100"), size: plansCreated ? 1n : 0n },
        revocations: { id: address("0x200"), size: 0n },
      };
    },
  );
  vi.spyOn(SuigateClient.prototype, "listPlans").mockImplementation(
    async () => ({
      cursor: null,
      hasNextPage: false,
      plans: plansCreated
        ? [
            {
              serviceId: SERVICE,
              key: "pro",
              price: 1_000_000_000n,
              coinType: config.plans[0]!.coinType,
              durationMs: 2_592_000_000n,
              version: 0n,
              purchasesEnabled: true,
              renewalsEnabled: true,
            },
          ]
        : [],
    }),
  );
  const executions: unknown[] = [];
  const inspect = vi.fn(async () => wallet);
  const prepare = vi.fn(async (args: string[]) => {
    const tx = new Transaction();
    tx.setSender(wallet.address);
    tx.setGasOwner(wallet.address);
    tx.setGasBudget(200_000_000);
    tx.setGasPrice(1000);
    tx.setGasPayment([
      {
        objectId: address(`0x${executions.length + 90}`),
        version: "1",
        digest: "11111111111111111111111111111111",
      },
    ]);
    if (args[0] === "publish") {
      const cap = tx.publish({
        modules: [Buffer.from("test-module").toString("base64")],
        dependencies: [SUI_NETWORKS.testnet.paymentKitPackageId],
      });
      tx.transferObjects([cap], wallet.address);
    } else {
      tx.moveCall({
        target: `${PACKAGE}::subscriptions::${args[0] === "call" ? "create_service" : "create_plan"}`,
        arguments: [],
      });
    }
    tx.setExpiration({
      ValidDuring: {
        minEpoch: "1250",
        maxEpoch: "1251",
        minTimestamp: null,
        maxTimestamp: null,
        chain: wallet.chainIdentifier,
        nonce: 1,
      },
    });
    return tx.build();
  });
  const sign = vi.fn(async (prepared: Uint8Array) => {
    const tx = Transaction.from(prepared);
    tx.setExpiration({
      ValidDuring: {
        minEpoch: "1250",
        maxEpoch: "1251",
        minTimestamp: null,
        maxTimestamp: null,
        chain: wallet.chainIdentifier,
        nonce: 2,
      },
    });
    const bytes = await tx.build();
    const { signature } = await signer.signTransaction(bytes);
    return decodeSignedTransaction(
      bcs.SenderSignedData.serialize([
        {
          intentMessage: {
            intent: bcs.Intent.parse(new Uint8Array([0, 0, 0])),
            value: bcs.TransactionData.parse(bytes),
          },
          txSignatures: [signature],
        },
      ]).toBytes(),
    );
  });
  const execute = vi.fn(async (signed: SignedTransaction) => {
    const bytes = signed.bytes;
    const data = Transaction.from(bytes).getData();
    const published = data.commands[0]?.$kind === "Publish";
    const createService =
      data.commands[0]?.$kind === "MoveCall" &&
      data.commands[0].MoveCall.function === "create_service";
    if (createService) serviceCreated = true;
    else if (!published) plansCreated = true;
    const result = {
      digest: await Transaction.from(bytes).getDigest(),
      transaction: { data: { sender: wallet.address } },
      transactionData: data,
      effects: { status: { status: "success" } },
      objectChanges: published
        ? [
            {
              type: "published",
              packageId: PACKAGE,
              modules: ["subscriptions"],
            },
          ]
        : createService
          ? [
              {
                type: "created",
                objectType: `${PACKAGE}::subscriptions::Service`,
                objectId: SERVICE,
              },
              {
                type: "created",
                objectType: `${PACKAGE}::subscriptions::ServiceAdminCap`,
                objectId: CAP,
                owner: { AddressOwner: wallet.address },
              },
            ]
          : [],
    };
    executions.push(result);
    return result;
  });
  vi.spyOn(client.core, "waitForTransaction").mockImplementation(
    async (input) => {
      const value = executions.find(
        (item) =>
          (item as { digest: string }).digest ===
          ("digest" in input ? input.digest : ""),
      ) as {
        digest: string;
        transactionData: ReturnType<Transaction["getData"]>;
        objectChanges: {
          type: string;
          packageId?: string;
          objectId?: string;
          objectType?: string;
          owner?: { AddressOwner?: string };
        }[];
      };
      if (!value) throw new Error("Not indexed");
      return {
        $kind: "Transaction",
        Transaction: {
          digest: value.digest,
          status: { success: true, error: null },
          transaction: value.transactionData,
          objectTypes: Object.fromEntries(
            value.objectChanges.map((object) => [
              object.objectId,
              object.objectType,
            ]),
          ),
          effects: {
            changedObjects: value.objectChanges.map((object) => ({
              objectId: object.packageId ?? object.objectId,
              idOperation: "Created",
              outputState:
                object.type === "published" ? "PackageWrite" : "ObjectWrite",
              outputOwner: object.owner
                ? {
                    $kind: "AddressOwner",
                    AddressOwner: object.owner.AddressOwner,
                  }
                : { $kind: "Shared", Shared: {} },
            })),
          },
        },
      } as unknown as SuiClientTypes.TransactionResult<{
        transaction: true;
        effects: true;
        objectTypes: true;
      }>;
    },
  );
  const transaction = vi.fn(async () => executions.at(-1));
  const buildPackage = vi.fn(async () => ({
    modules: [Buffer.from("test-module").toString("base64")],
    dependencies: [SUI_NETWORKS.testnet.paymentKitPackageId],
  }));
  const sui: SuiTransport = {
    inspect,
    prepare,
    sign,
    execute,
    buildPackage,
    transaction,
  };
  const log = vi.fn();
  const confirm = vi.fn(async () => true);
  return {
    root,
    path,
    config,
    client,
    sui,
    inspect,
    prepare,
    sign,
    buildPackage,
    execute,
    transaction,
    executions,
    log,
    confirm,
    deps: { sui, client, movePath: moves, log, confirm },
  };
}

describe("suigate CLI", () => {
  it("prints risk warnings to stderr even for help and never treats acknowledgement as audited", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--help", "--acknowledge-unaudited"])).toBe(0);
    expect(stderr.mock.calls.flat().join(" ")).toContain("100% AI-generated");
    expect(stderr.mock.calls.flat().join(" ")).toContain("private keys");
    expect(stdout.mock.calls.flat().join(" ")).toContain(
      "--acknowledge-unaudited",
    );
    expect(SOFTWARE_RISK.humanAuditStatus).toBe("not-audited");
  });

  it("requires explicit unaudited-risk acknowledgement before transaction preparation or confirmation", async () => {
    const f = await setup();
    await expect(deploy(f.path, f.config, f.deps)).rejects.toThrow(
      "--acknowledge-unaudited",
    );
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
    await deploy(f.path, f.config, f.deps, { dryRun: true });
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it("detects framework/package manager and never overwrites initialization", async () => {
    const root = await directory();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.0.0",
        dependencies: { next: "16.3.8", react: "19.3.0" },
      }),
    );
    expect(await detectProject(root)).toEqual({
      packageManager: "pnpm",
      frameworks: ["nextjs"],
    });
    const path = join(root, "suigate.config.json");
    await initialize(path, "testnet");
    const before = await readFile(path, "utf8");
    await expect(initialize(path, "mainnet")).rejects.toThrow(
      "not overwritten",
    );
    expect(await readFile(path, "utf8")).toBe(before);
    expect((await readConfig(path)).plans[0]?.price).toBe("1000000000");
  });

  it("uses only existing Sui configuration and never calls key export/import", async () => {
    const root = await directory();
    const runner = vi.fn(async (_binary: string, args: string[]) => {
      if (args[0] === "--version") return "sui 1.81.0";
      if (args.includes("active-address"))
        return JSON.stringify(wallet.address);
      if (args.includes("active-env"))
        return JSON.stringify(wallet.environment);
      return JSON.stringify({
        base58: wallet.chainIdentifier,
        hex: "4c78adac",
      });
    });
    const cli = new NativeSui("sui", join(root, "client.yaml"), runner);
    await expect(cli.inspect()).rejects.toThrow(
      "No existing Sui client configuration",
    );
    expect(runner).toHaveBeenCalledTimes(1);
    await writeFile(
      join(root, "client.yaml"),
      "test fixture; never a keystore",
    );
    expect((await cli.inspect()).address).toBe(wallet.address);
    expect(
      runner.mock.calls.every(
        ([, args]) =>
          !args.some((argument) =>
            /keytool|export|new-address|import/.test(argument),
          ),
      ),
    ).toBe(true);
  });

  it("previews and cancels without signing or submitting", async () => {
    const f = await setup();
    await deploy(f.path, f.config, f.deps, { dryRun: true });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    f.confirm.mockResolvedValue(false);
    await deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("refuses mismatched networks and concurrent deployment locks", async () => {
    const f = await setup();
    f.inspect.mockResolvedValueOnce({
      ...wallet,
      chainIdentifier: SUI_NETWORKS.mainnet.chainIdentifier,
    });
    await expect(
      deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true }),
    ).rejects.toThrow("does not match");
    const lock = join(f.root, ".suigate/deployments/deploy.lock");
    await mkdir(join(f.root, ".suigate/deployments"), { recursive: true });
    await writeFile(lock, "another process");
    await expect(
      deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true }),
    ).rejects.toThrow("lock already exists");
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("creates a developer-owned Service and Pro plan, then deploy becomes a no-op", async () => {
    const f = await setup();
    await deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true });
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.log).toHaveBeenCalledWith(`SUIGATE_SERVICE_ID=${SERVICE}`);
    const state = await readState(
      statePath(f.path, f.config.network),
      f.config,
    );
    expect(state?.owner).toBe(wallet.address);
    expect(state?.adminCapId).toBe(CAP);
    await deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true });
    expect(f.execute).toHaveBeenCalledTimes(2);
  });

  it("publishes the bundled package when no existing package is configured", async () => {
    const f = await setup();
    delete f.config.packageId;
    await deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true });
    expect(f.execute).toHaveBeenCalledTimes(3);
    expect(f.prepare.mock.calls[0]?.[0][0]).toBe("publish");
    expect(f.prepare.mock.calls[0]?.[0]).not.toContain("--build-env");
    expect(f.prepare.mock.calls[0]?.[0]).not.toContain(
      "--skip-dependency-verification",
    );
  });

  it("reports unsigned preparation failures without creating a pending transaction or submitting", async () => {
    const f = await setup();
    f.prepare.mockRejectedValueOnce(new Error("private native error"));
    await expect(
      deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true }),
    ).rejects.toThrow("preparation failed before signing/submission");
    expect(f.execute).not.toHaveBeenCalled();
    expect(
      await readState(statePath(f.path, f.config.network), f.config),
    ).toBeNull();
  });

  it("records a digest before execution and reconciles uncertain outcomes without re-execution", async () => {
    const f = await setup();
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementationOnce(async (bytes) => {
      await original(bytes);
      throw new Error("response lost");
    });
    await expect(
      deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true }),
    ).rejects.toThrow("uncertain");
    const state = await readState(
      statePath(f.path, f.config.network),
      f.config,
    );
    expect(state?.pending?.action).toBe("service");
    await expect(
      deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true }),
    ).rejects.toThrow("--resume");
    await deploy(f.path, f.config, f.deps, {
      resume: true,
      acknowledgeUnaudited: true,
    });
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.transaction).not.toHaveBeenCalled();
  });

  it("journals the signed digest instead of the unsigned preparation digest", async () => {
    const f = await setup();
    await deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true });
    const prepared = await f.prepare.mock.results[0]!.value;
    const signed = await f.sign.mock.results[0]!.value;
    const state = await readState(statePath(f.path, "testnet"), f.config);
    expect(state!.transactions[0]!.digest).toBe(
      await Transaction.from(signed.bytes).getDigest(),
    );
    expect(state!.transactions[0]!.digest).not.toBe(
      await Transaction.from(prepared).getDigest(),
    );
    expect(f.execute.mock.calls[0]![0].signedBytes).toEqual(signed.signedBytes);
  });

  it("retains an unavailable pending digest and never republishes automatically", async () => {
    const f = await setup();
    const bytes = await f.prepare(["publish"]);
    const digest = await Transaction.from(bytes).getDigest();
    const state: DeploymentState = {
      version: 1,
      network: "testnet",
      chainIdentifier: wallet.chainIdentifier,
      owner: wallet.address,
      registryName: f.config.registryName,
      packageId: PACKAGE,
      transactions: [],
      pending: { action: "publish", digest },
    };
    await saveState(statePath(f.path, "testnet"), state);
    await expect(
      deploy(f.path, f.config, f.deps, {
        resume: true,
        acknowledgeUnaudited: true,
      }),
    ).rejects.toThrow("pending record has been retained");
    expect(
      (await readState(statePath(f.path, "testnet"), f.config))!.pending
        ?.digest,
    ).toBe(digest);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("recovers a legacy publication only from matching confirmed bytecode/recipient and keeps both digests", async () => {
    const f = await setup();
    delete f.config.packageId;
    const unsigned = await f.prepare(["publish"]);
    const signed = await f.sign(unsigned);
    const confirmed = await f.execute(signed);
    const previousDigest = await Transaction.from(unsigned).getDigest();
    const state: DeploymentState = {
      version: 1,
      network: "testnet",
      chainIdentifier: wallet.chainIdentifier,
      owner: wallet.address,
      registryName: f.config.registryName,
      sourceDigest: await sourceDigest(moves),
      transactions: [],
      pending: { action: "publish", digest: previousDigest },
    };
    await saveState(statePath(f.path, "testnet"), state);
    f.confirm.mockResolvedValue(false);
    await deploy(f.path, f.config, f.deps, {
      resume: true,
      recoverPublish: confirmed.digest,
      acknowledgeUnaudited: true,
    });
    const recovered = (await readState(
      statePath(f.path, "testnet"),
      f.config,
    ))!;
    expect(recovered.packageId).toBe(PACKAGE);
    expect(recovered.pending).toBeUndefined();
    expect(recovered.transactions[0]).toEqual({
      action: "publish",
      digest: confirmed.digest,
      previousDigest,
    });
    expect(f.execute).toHaveBeenCalledTimes(1);
    f.buildPackage.mockResolvedValueOnce({
      modules: [Buffer.from("wrong-module").toString("base64")],
      dependencies: [SUI_NETWORKS.testnet.paymentKitPackageId],
    });
    await expect(
      verifyRecoveredPublication(f.config, state, f.deps, confirmed.digest),
    ).rejects.toThrow("exact recorded suigate code");
    await expect(
      verifyRecoveredPublication(
        f.config,
        { ...state, owner: address("0xb") },
        f.deps,
        confirmed.digest,
      ),
    ).rejects.toThrow("developer wallet");
    await expect(
      verifyRecoveredPublication(
        f.config,
        { ...state, sourceDigest: "wrong" },
        f.deps,
        confirmed.digest,
      ),
    ).rejects.toThrow("source revision");
  });

  it("rejects tampered/wrong-wallet state and excessive prepared gas budgets", async () => {
    const f = await setup();
    const state: DeploymentState = {
      version: 1,
      network: "testnet",
      chainIdentifier: wallet.chainIdentifier,
      owner: address("0xb"),
      registryName: f.config.registryName,
      transactions: [],
    };
    await saveState(statePath(f.path, "testnet"), state);
    await expect(
      deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true }),
    ).rejects.toThrow("different developer wallet");
    state.owner = wallet.address;
    state.packageId = PACKAGE;
    await saveState(statePath(f.path, "testnet"), state);
    const original = f.prepare.getMockImplementation()!;
    f.prepare.mockImplementationOnce(async (args) => {
      const tx = Transaction.from(await original(args));
      tx.setGasBudget(300_000_000);
      return tx.build();
    });
    await expect(
      deploy(f.path, f.config, f.deps, { acknowledgeUnaudited: true }),
    ).rejects.toThrow("gas policy");
    expect(f.execute).not.toHaveBeenCalled();
  });
});
