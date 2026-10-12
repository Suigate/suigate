// 100% AI-generated and unaudited. This CLI can sign transactions via Sui; see the packaged NOTICE.md before use.
import { RISK_NOTICE } from "@suigate/core";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuigateClient, SUI_NETWORKS, type SuiNetwork } from "@suigate/core";
import {
  CliError,
  initialize,
  readConfig,
  readState,
  statePath,
} from "./config.js";
import { NativeSui } from "./sui.js";
import { allPlans, deploy } from "./deploy.js";

export const HELP = `suigate — Sui entitlement developer tooling

Usage: suigate <init|deploy|plans|status> [options]

  init                 Detect the project and existing Sui wallet; create configuration
  deploy               Preview, confirm, then publish/create Service and plans
  deploy --dry-run     Preview only; never signs or submits transactions
  deploy --resume      Reconcile a recorded transaction, then confirm remaining steps
  --recover-publish <digest>  With --resume, adopt a confirmed legacy publication after exact bytecode/sender checks
  plans                Read Service plans, prices, currencies, and durations from Sui
  status               Read network, Service owner, recipient, and plans from Sui

Options:
  --config <path>      Project JSON file (default: ./suigate.config.json)
  --network <name>     init only: testnet (default) or mainnet
  --package-id <id>    init only: reuse an existing suigate package
  --sui <binary>       Sui CLI executable (or set SUI_BIN)
  --sui-config <path>  Existing Sui client.yaml; never a private key
  --acknowledge-unaudited  Acknowledge AI-generated/unaudited risks before deployment; NOT an audit or a substitute for confirmation
  --help              Show this help

Deployment requires Sui CLI 1.81.x+, an existing wallet/configuration, and SUI for gas.
The CLI never creates/imports keys, switches your active wallet/network, or deploys without confirmation.
`;

function units(value: bigint, decimals: number) {
  if (!decimals) return value.toString();
  const digits = value.toString().padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}

export async function main(argv: string[]): Promise<number> {
  console.error(RISK_NOTICE);
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        config: { type: "string" },
        network: { type: "string" },
        "package-id": { type: "string" },
        sui: { type: "string" },
        "sui-config": { type: "string" },
        "dry-run": { type: "boolean" },
        resume: { type: "boolean" },
        "recover-publish": { type: "string" },
        "acknowledge-unaudited": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    const command = parsed.positionals[0];
    if (parsed.values.help || !command) {
      console.log(HELP);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      !["init", "deploy", "plans", "status"].includes(command)
    )
      throw new CliError("Unknown command. Run suigate --help.");
    if (
      command !== "deploy" &&
      (parsed.values["dry-run"] ||
        parsed.values.resume ||
        parsed.values["recover-publish"])
    )
      throw new CliError("--dry-run and --resume only apply to deploy");
    const configPath = resolve(parsed.values.config ?? "suigate.config.json");
    const sui = new NativeSui(
      parsed.values.sui ?? process.env.SUI_BIN,
      parsed.values["sui-config"],
    );
    if (command === "init") {
      const network = parsed.values.network ?? "testnet";
      if (!(network in SUI_NETWORKS))
        throw new CliError("Choose testnet or mainnet");
      const config = await initialize(
        configPath,
        network as SuiNetwork,
        parsed.values["package-id"],
      );
      console.log(`Configuration: ${JSON.stringify(configPath)}`);
      console.log(
        `Package manager: ${config.project.packageManager}; frameworks: ${config.project.frameworks.join(", ") || "generic"}`,
      );
      console.log(
        `Target network: ${config.network}; Pro: 1 SUI / 30 days (edit configuration before deployment)`,
      );
      try {
        const wallet = await sui.inspect();
        console.log(
          `Sui CLI: ${wallet.version}; active address: ${wallet.address}; environment: ${JSON.stringify(wallet.environment)}`,
        );
        if (
          wallet.chainIdentifier !==
          SUI_NETWORKS[config.network].chainIdentifier
        )
          console.log(
            "Active Sui chain differs from the target. Switch it explicitly before deployment.",
          );
      } catch (error) {
        console.log(
          error instanceof CliError
            ? error.message
            : "Existing Sui configuration could not be inspected",
        );
      }
      console.log(
        "Add .suigate/ to .gitignore. No private-key export/import or wallet creation was requested.",
      );
      return 0;
    }
    if (parsed.values.network || parsed.values["package-id"])
      throw new CliError(
        "--network and --package-id are init options; edit the project configuration for an existing project",
      );
    const config = await readConfig(configPath);
    const client = new SuiGrpcClient({
      network: config.network,
      baseUrl:
        process.env.SUIGATE_RPC_URL ?? SUI_NETWORKS[config.network].rpcUrl,
    });
    if (command === "deploy") {
      await deploy(
        configPath,
        config,
        {
          sui,
          client,
          movePath: fileURLToPath(new URL("./move/suigate/", import.meta.url)),
          log: console.log,
          confirm: async (message) => {
            if (!process.stdin.isTTY || !process.stdout.isTTY)
              throw new CliError(
                "Deployment needs an interactive confirmation. Use --dry-run in automation; there is no implicit --yes mode.",
              );
            const prompt = createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            try {
              return (
                (await prompt.question(message)).trim() ===
                `deploy ${config.network}`
              );
            } finally {
              prompt.close();
            }
          },
        },
        {
          dryRun: parsed.values["dry-run"] ?? false,
          resume: parsed.values.resume ?? false,
          ...(parsed.values["recover-publish"]
            ? { recoverPublish: parsed.values["recover-publish"] }
            : {}),
          acknowledgeUnaudited: parsed.values["acknowledge-unaudited"] ?? false,
        },
      );
      return 0;
    }
    if (
      parsed.values["dry-run"] ||
      parsed.values.resume ||
      parsed.values["recover-publish"]
    )
      throw new CliError("--dry-run and --resume only apply to deploy");
    const state = await readState(
      statePath(configPath, config.network),
      config,
    );
    console.log(`Network: ${config.network}`);
    if (state?.pending)
      console.log(
        `Pending ${state.pending.action}: ${state.pending.digest}; reconcile with deploy --resume`,
      );
    if (!state?.serviceId || !state.packageId)
      throw new CliError(
        "No deployed Service is recorded for this project/network",
      );
    const core = new SuigateClient({
      client,
      packageId: state.packageId,
      typeOrigin: state.typeOrigin ?? state.packageId,
      chainIdentifier: state.chainIdentifier,
    });
    const service = await core.getService(state.serviceId);
    console.log(`Service: ${service.id}`);
    console.log(`Owner: ${service.owner}`);
    console.log(`Payment recipient: ${service.paymentRecipient}`);
    for (const plan of await allPlans(core, service.id)) {
      let price = `${plan.price} base units`;
      let symbol = "unknown";
      try {
        const { coinMetadata } = await client.core.getCoinMetadata({
          coinType: plan.coinType,
        });
        if (
          coinMetadata &&
          coinMetadata.decimals >= 0 &&
          coinMetadata.decimals <= 255
        ) {
          price = units(plan.price, coinMetadata.decimals);
          symbol = coinMetadata.symbol;
        }
      } catch {}
      console.log(
        `${JSON.stringify(plan.key)} | ${price} ${JSON.stringify(symbol)} | ${plan.durationMs} ms | purchases=${plan.purchasesEnabled} renewals=${plan.renewalsEnabled}`,
      );
      console.log(`  Currency: ${plan.coinType}`);
    }
    return 0;
  } catch (error) {
    console.error(
      error instanceof CliError
        ? error.message
        : "suigate could not complete the operation. Check project configuration, the existing Sui wallet, and RPC connectivity.",
    );
    return 1;
  }
}
