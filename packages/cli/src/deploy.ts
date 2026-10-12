import { cp, mkdir, mkdtemp, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Transaction } from "@mysten/sui/transactions";
import {
  normalizeSuiAddress,
  isValidTransactionDigest,
} from "@mysten/sui/utils";
import type { ClientWithCoreApi, SuiClientTypes } from "@mysten/sui/client";
import {
  SuigateClient,
  SUI_NETWORKS,
  RISK_NOTICE,
  type Plan,
} from "@suigate/core";
import {
  CliError,
  id,
  readState,
  saveState,
  sourceDigest,
  statePath,
  type DeploymentState,
  type ProjectConfig,
} from "./config.js";
import {
  assertSigningPreservesTransaction,
  type SuiTransport,
  type WalletInfo,
} from "./sui.js";

export interface DeployDependencies {
  sui: SuiTransport;
  client: ClientWithCoreApi;
  movePath: string;
  log(message: string): void;
  confirm(message: string): Promise<boolean>;
}

type Action = "publish" | "service" | "plans";
interface TransactionResponse {
  digest: string;
  data: SuiClientTypes.TransactionData;
  transaction: { data: { sender: string } };
  effects: { status: { status: string } };
  objectChanges: {
    type: string;
    packageId?: string;
    modules?: string[];
    objectType?: string;
    objectId?: string;
    owner?: { AddressOwner?: string };
  }[];
}

async function response(
  client: ClientWithCoreApi,
  digest: string,
  owner: string,
): Promise<TransactionResponse> {
  let result;
  try {
    result = await client.core.waitForTransaction({
      digest,
      timeout: 20_000,
      include: { transaction: true, effects: true, objectTypes: true },
    });
  } catch {
    throw new CliError(
      `Cannot confirm transaction ${digest} on the configured RPC. Its pending record has been retained. Not found does not prove it was never executed; do not delete the journal or republish.`,
    );
  }
  const tx =
    result.$kind === "Transaction"
      ? result.Transaction
      : result.FailedTransaction;
  if (
    tx.digest !== digest ||
    !tx.transaction.sender ||
    id(tx.transaction.sender) !== owner
  )
    throw new CliError(
      "Transaction does not match the recorded digest and developer wallet",
    );
  return {
    digest: tx.digest,
    data: tx.transaction,
    transaction: { data: { sender: tx.transaction.sender } },
    effects: { status: { status: tx.status.success ? "success" : "failure" } },
    objectChanges: tx.effects.changedObjects
      .filter((object) => object.idOperation === "Created")
      .map((object) =>
        object.outputState === "PackageWrite"
          ? { type: "published", packageId: object.objectId }
          : {
              type: "created",
              objectId: object.objectId,
              objectType: tx.objectTypes[object.objectId] ?? "",
              ...(object.outputOwner?.$kind === "AddressOwner"
                ? { owner: { AddressOwner: object.outputOwner.AddressOwner } }
                : {}),
            },
      ),
  };
}

function applyResult(
  state: DeploymentState,
  action: Action,
  tx: TransactionResponse,
) {
  if (tx.effects.status.status !== "success") return false;
  if (!Array.isArray(tx.objectChanges))
    throw new CliError(
      "Transaction response has no object changes; reconcile the digest before continuing",
    );
  if (action === "publish") {
    const packages = tx.objectChanges.filter(
      (change) => change.type === "published",
    );
    if (packages.length !== 1)
      throw new CliError(
        "Publication did not produce the expected suigate package",
      );
    state.packageId = id(packages[0]!.packageId);
    state.typeOrigin = state.packageId;
  }
  if (action === "service") {
    const typeOrigin = state.typeOrigin ?? state.packageId;
    const services = tx.objectChanges.filter(
      (change) =>
        change.type === "created" &&
        change.objectType === `${typeOrigin}::subscriptions::Service`,
    );
    const caps = tx.objectChanges.filter(
      (change) =>
        change.type === "created" &&
        change.objectType === `${typeOrigin}::subscriptions::ServiceAdminCap`,
    );
    if (
      services.length !== 1 ||
      caps.length !== 1 ||
      id(caps[0]!.owner?.AddressOwner) !== state.owner
    )
      throw new CliError(
        "Service creation did not return the developer-owned administration capability",
      );
    state.serviceId = id(services[0]!.objectId);
    state.adminCapId = id(caps[0]!.objectId);
  }
  if (action === "plans")
    state.appliedPlans = [
      ...new Set([
        ...(state.appliedPlans ?? []),
        ...(state.pending?.planKeys ?? []),
      ]),
    ];
  state.transactions.push({ action, digest: tx.digest });
  return true;
}

export async function allPlans(
  core: SuigateClient,
  serviceId: string,
): Promise<Plan[]> {
  const plans: Plan[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await core.listPlans({ serviceId, cursor });
    plans.push(...page.plans);
    if (!page.hasNextPage) break;
    if (!page.cursor || seen.has(page.cursor))
      throw new CliError("RPC returned a repeated plan cursor");
    cursor = page.cursor;
    seen.add(cursor);
  } while (true);
  return plans;
}

function coreClient(
  config: ProjectConfig,
  state: DeploymentState,
  client: ClientWithCoreApi,
) {
  if (!state.packageId) throw new CliError("No published suigate package");
  return new SuigateClient({
    client,
    packageId: state.packageId,
    typeOrigin: state.typeOrigin ?? state.packageId,
    chainIdentifier: SUI_NETWORKS[config.network].chainIdentifier,
    cache: false,
  });
}

async function missingPlans(
  config: ProjectConfig,
  state: DeploymentState,
  client: ClientWithCoreApi,
) {
  if (!state.serviceId) return config.plans;
  const core = coreClient(config, state, client);
  const service = await core.getService(state.serviceId);
  if (service.owner !== state.owner)
    throw new CliError("The active developer wallet does not own this Service");
  state.adminCapId = service.adminCapId;
  const plans = await allPlans(core, state.serviceId);
  return config.plans.filter((wanted) => {
    const existing = plans.find((plan) => plan.key === wanted.key);
    if (!existing) {
      if (state.appliedPlans?.includes(wanted.key))
        throw new CliError(
          "A confirmed plan is not visible on the read RPC yet. Recheck status later; no duplicate transaction was sent.",
        );
      return true;
    }
    if (
      existing.price.toString() !== wanted.price ||
      existing.coinType !== wanted.coinType ||
      existing.durationMs.toString() !== wanted.durationMs ||
      !existing.purchasesEnabled ||
      !existing.renewalsEnabled
    ) {
      throw new CliError(
        `Existing plan ${JSON.stringify(wanted.key)} differs from configuration. Deploy never silently changes live terms; use explicit Move administration.`,
      );
    }
    return false;
  });
}

async function checkPackage(
  config: ProjectConfig,
  state: DeploymentState,
  client: ClientWithCoreApi,
) {
  if (!state.packageId) return;
  const { function: create } = await client.core.getMoveFunction({
    packageId: state.packageId,
    moduleName: "subscriptions",
    name: "create_service",
  });
  const parameter = create.parameters[0];
  if (
    create.visibility !== "public" ||
    create.parameters.length !== 3 ||
    parameter?.body.$kind !== "datatype" ||
    parameter.body.datatype.typeName !==
      `${SUI_NETWORKS[config.network].paymentKitPackageId}::payment_kit::Namespace`
  ) {
    throw new CliError(
      "The selected package is not compatible with the supported Payment Kit namespace/Service API",
    );
  }
}

function validatePrepared(
  bytes: Uint8Array,
  action: Action,
  wallet: WalletInfo,
  config: ProjectConfig,
  state: DeploymentState,
) {
  const data = Transaction.from(bytes).getData();
  if (
    !data.sender ||
    normalizeSuiAddress(data.sender) !== wallet.address ||
    !data.gasData.owner ||
    normalizeSuiAddress(data.gasData.owner) !== wallet.address ||
    !data.gasData.budget ||
    BigInt(data.gasData.budget) <= 0n ||
    BigInt(data.gasData.budget) > BigInt(config.gasBudgetMist)
  )
    throw new CliError(
      "Prepared transaction exceeds the approved sender/gas policy",
    );
  if (action === "publish") {
    if (
      data.commands.length !== 2 ||
      data.commands[0]?.$kind !== "Publish" ||
      data.commands[1]?.$kind !== "TransferObjects" ||
      !data.commands[0].Publish.dependencies.includes(
        SUI_NETWORKS[config.network].paymentKitPackageId,
      )
    )
      throw new CliError("Unexpected publication transaction shape");
  } else {
    const expected = action === "service" ? "create_service" : "create_plan";
    if (
      !data.commands.length ||
      data.commands.some(
        (command) =>
          command.$kind !== "MoveCall" ||
          command.MoveCall.package !== state.packageId ||
          command.MoveCall.module !== "subscriptions" ||
          command.MoveCall.function !== expected,
      )
    )
      throw new CliError("Unexpected deployment transaction commands");
  }
}

export async function verifyRecoveredPublication(
  config: ProjectConfig,
  state: DeploymentState,
  deps: DeployDependencies,
  digest: string,
): Promise<TransactionResponse> {
  if (
    !isValidTransactionDigest(digest) ||
    state.pending?.action !== "publish" ||
    state.pending.digestSource === "signed-transaction"
  )
    throw new CliError(
      "--recover-publish only repairs a legacy pending publication with a verified replacement transaction digest",
    );
  if (
    !state.sourceDigest ||
    (await sourceDigest(deps.movePath)) !== state.sourceDigest
  )
    throw new CliError(
      "Bundled Move sources differ from the pending publication; restore the recorded source revision before recovery",
    );
  const tx = await response(deps.client, digest, state.owner);
  if (tx.effects.status.status !== "success")
    throw new CliError("Recovery requires a successful confirmed publication");
  const staging = await mkdtemp(join(tmpdir(), "suigate-recover-"));
  await cp(deps.movePath, staging, { recursive: true });
  const artifact = await deps.sui.buildPackage(staging, config.network);
  const expected = new Transaction();
  const cap = expected.publish(artifact);
  expected.transferObjects([cap], state.owner);
  const actualKind = await Transaction.from(JSON.stringify(tx.data)).build({
    onlyTransactionKind: true,
  });
  const expectedKind = await expected.build({ onlyTransactionKind: true });
  if (!Buffer.from(actualKind).equals(Buffer.from(expectedKind)))
    throw new CliError(
      "Confirmed transaction does not publish the exact recorded suigate code/dependencies and transfer its upgrade capability to the developer",
    );
  return tx;
}

export async function deploy(
  configPath: string,
  config: ProjectConfig,
  deps: DeployDependencies,
  options: {
    dryRun?: boolean;
    resume?: boolean;
    acknowledgeUnaudited?: boolean;
    recoverPublish?: string;
  } = {},
) {
  if (options.recoverPublish && (!options.resume || options.dryRun))
    throw new CliError(
      "--recover-publish requires --resume and cannot be combined with --dry-run",
    );
  const wallet = await deps.sui.inspect();
  const network = SUI_NETWORKS[config.network];
  if (wallet.chainIdentifier !== network.chainIdentifier)
    throw new CliError(
      "Active Sui CLI chain does not match the project's network. Switch it explicitly with sui client switch; no transaction was sent.",
    );
  const chain = await deps.client.core.getChainIdentifier();
  if (chain.chainIdentifier !== wallet.chainIdentifier)
    throw new CliError("Read RPC and Sui CLI are on different chains");
  const path = statePath(configPath, config.network);
  const lockPath = join(dirname(path), "deploy.lock");
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CliError(
        "A deployment lock already exists. Verify no deploy is running before removing a stale .suigate/deployments/deploy.lock.",
      );
    throw error;
  }
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    );
    const state: DeploymentState = (await readState(path, config)) ?? {
      version: 1,
      network: config.network,
      chainIdentifier: wallet.chainIdentifier,
      owner: wallet.address,
      registryName: config.registryName,
      transactions: [],
      ...(config.packageId
        ? {
            packageId: config.packageId,
            typeOrigin: config.typeOrigin ?? config.packageId,
          }
        : {}),
    };
    if (state.owner !== wallet.address)
      throw new CliError(
        "This deployment belongs to a different developer wallet",
      );
    if (config.packageId && state.packageId !== config.packageId)
      throw new CliError("Configured package differs from saved deployment");
    if (options.recoverPublish && !state.pending)
      throw new CliError("There is no pending publication to recover");
    if (state.pending) {
      deps.log(`Pending ${state.pending.action}: ${state.pending.digest}`);
      if (!options.resume || options.dryRun)
        throw new CliError(
          "Use suigate deploy --resume to query the recorded transaction before any further deployment",
        );
      const previousDigest = state.pending.digest;
      const tx = options.recoverPublish
        ? await verifyRecoveredPublication(
            config,
            state,
            deps,
            options.recoverPublish,
          )
        : await response(deps.client, state.pending.digest, state.owner);
      const succeeded = applyResult(state, state.pending.action, tx);
      if (options.recoverPublish) {
        state.transactions[state.transactions.length - 1]!.previousDigest =
          previousDigest;
        deps.log(
          `Recovered confirmed publication ${tx.digest}; retained the previous recorded digest in history.`,
        );
      }
      delete state.pending;
      await saveState(path, state);
      if (!succeeded)
        deps.log(
          "The recorded transaction failed on-chain. Gas may have been charged; no application changes committed.",
        );
    }
    const plans = await missingPlans(config, state, deps.client);
    const source = state.packageId ? null : await sourceDigest(deps.movePath);
    deps.log(`Developer: ${wallet.address}`);
    deps.log(
      `Network: ${config.network} (CLI environment ${JSON.stringify(wallet.environment)})`,
    );
    deps.log(`Chain: ${wallet.chainIdentifier}`);
    deps.log(
      `Package: ${state.packageId ?? "publish bundled suigate Move package"}`,
    );
    if (source) deps.log(`Source SHA-256: ${source}`);
    deps.log(
      `Service: ${state.serviceId ?? `create ${JSON.stringify(config.registryName)}; owner and recipient = developer`}`,
    );
    for (const plan of plans)
      deps.log(
        `Create plan ${plan.key}: ${plan.price} base units of ${plan.coinType}, ${plan.durationMs} ms`,
      );
    const count =
      (state.packageId ? 0 : 1) +
      (state.serviceId ? 0 : 1) +
      (plans.length ? 1 : 0);
    deps.log(
      `Transactions: ${count}; gas budget per transaction: ${config.gasBudgetMist} MIST (maximum, not a fee quote)`,
    );
    if (options.dryRun) {
      deps.log("Preview only. No transaction signed or submitted.");
      return state;
    }
    // An acknowledgement is not an audit or a waiver guarantee; keep this gate until a documented human-reviewed release changes it.
    if (count && !options.acknowledgeUnaudited)
      throw new CliError(
        "Deployment blocked: 100% AI-generated, unaudited code may lose funds or keys. Read NOTICE.md, then explicitly pass --acknowledge-unaudited if you accept these risks. Wallet confirmation is still required.",
      );
    if (count) deps.log(RISK_NOTICE);
    if (
      count &&
      !(await deps.confirm(
        `Type deploy ${config.network} to approve these transactions: `,
      ))
    ) {
      deps.log("Cancelled. No transaction submitted.");
      return state;
    }
    async function execute(
      action: Action,
      args: string[],
      planKeys?: string[],
    ) {
      let bytes: Uint8Array;
      try {
        bytes = await deps.sui.prepare(args, wallet);
      } catch (error) {
        const reason =
          error instanceof CliError
            ? error.message
            : "Native Sui preparation failed.";
        throw new CliError(
          `${action} preparation failed before signing/submission. No transaction was submitted for this step. ${reason} Resolve the preparation error, then run deploy again; previously confirmed steps are preserved.`,
        );
      }
      validatePrepared(bytes, action, wallet, config, state);
      let signed;
      try {
        signed = await deps.sui.sign(bytes, wallet);
        assertSigningPreservesTransaction(
          bytes,
          signed.bytes,
          wallet.chainIdentifier,
        );
        validatePrepared(signed.bytes, action, wallet, config, state);
      } catch (error) {
        throw new CliError(
          `${action} signing/validation failed before submission. ${error instanceof CliError ? error.message : "Nothing was submitted for this step."}`,
        );
      }
      const digest = await Transaction.from(signed.bytes).getDigest();
      state.pending = {
        action,
        digest,
        digestSource: "signed-transaction",
        ...(planKeys ? { planKeys } : {}),
      };
      await saveState(path, state);
      deps.log(`${action} transaction: ${digest}`);
      let tx: TransactionResponse;
      try {
        await deps.sui.execute(signed, wallet);
        tx = await response(deps.client, digest, state.owner);
      } catch {
        throw new CliError(
          `Transaction outcome is uncertain. Run suigate deploy --resume to reconcile ${digest}; do not blindly redeploy.`,
        );
      }
      if (!applyResult(state, action, tx)) {
        delete state.pending;
        await saveState(path, state);
        throw new CliError(
          `${action} transaction failed on-chain. Gas may have been charged.`,
        );
      }
      delete state.pending;
      await saveState(path, state);
    }
    if (!state.packageId) {
      const staging = await mkdtemp(join(tmpdir(), "suigate-publish-"));
      await cp(deps.movePath, staging, { recursive: true });
      state.sourceDigest = source!;
      await execute("publish", [
        "publish",
        staging,
        "--gas-budget",
        config.gasBudgetMist,
        "--sender",
        wallet.address,
      ]);
    }
    await checkPackage(config, state, deps.client);
    if (!state.serviceId) {
      await execute("service", [
        "call",
        "--package",
        state.packageId!,
        "--module",
        "subscriptions",
        "--function",
        "create_service",
        "--args",
        network.paymentKitNamespaceId,
        config.registryName,
        "--sender",
        wallet.address,
        "--gas-budget",
        config.gasBudgetMist,
      ]);
    }
    const service = await coreClient(config, state, deps.client).getService(
      state.serviceId!,
    );
    if (service.owner !== wallet.address)
      throw new CliError("Created Service owner is not the developer wallet");
    state.adminCapId = service.adminCapId;
    if (
      !state.transactions.some((tx) => tx.action === "plans") &&
      service.paymentRecipient !== wallet.address
    )
      throw new CliError(
        "New Service payment recipient is not the developer wallet",
      );
    const remaining = await missingPlans(config, state, deps.client);
    if (remaining.length) {
      const args = [
        "ptb",
        "--sender",
        `@${wallet.address}`,
        "--gas-budget",
        config.gasBudgetMist,
      ];
      for (const plan of remaining)
        args.push(
          "--move-call",
          `${state.packageId}::subscriptions::create_plan`,
          `<${plan.coinType}>`,
          `@${state.serviceId}`,
          `@${state.adminCapId}`,
          JSON.stringify(plan.key),
          plan.price,
          plan.durationMs,
        );
      await execute(
        "plans",
        args,
        remaining.map((plan) => plan.key),
      );
    }
    if ((await missingPlans(config, state, deps.client)).length)
      throw new CliError(
        "Plan creation is not yet visible. Recheck status; no automatic duplicate submission.",
      );
    await saveState(path, state);
    deps.log(`SUIGATE_PACKAGE_ID=${state.packageId}`);
    deps.log(`SUIGATE_CHAIN_IDENTIFIER=${state.chainIdentifier}`);
    deps.log(`SUIGATE_SERVICE_ID=${state.serviceId}`);
    return state;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
