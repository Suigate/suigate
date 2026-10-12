import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { isValidTransactionSignature } from "@mysten/sui/verify";
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { CliError, exists, id } from "./config.js";

export interface WalletInfo {
  address: string;
  environment: string;
  chainIdentifier: string;
  version: string;
}
export interface SignedTransaction {
  bytes: Uint8Array;
  signedBytes: Uint8Array;
  signatures: string[];
}
export interface PackageArtifact {
  modules: string[];
  dependencies: string[];
}
export interface SuiTransport {
  inspect(): Promise<WalletInfo>;
  prepare(args: string[], wallet: WalletInfo): Promise<Uint8Array>;
  sign(bytes: Uint8Array, wallet: WalletInfo): Promise<SignedTransaction>;
  execute(transaction: SignedTransaction, wallet: WalletInfo): Promise<unknown>;
  buildPackage(path: string, environment: string): Promise<PackageArtifact>;
  transaction(digest: string, wallet: WalletInfo): Promise<unknown>;
}

export function decodeSignedTransaction(
  signedBytes: Uint8Array,
): SignedTransaction {
  const entries = bcs.SenderSignedData.parse(signedBytes);
  const entry = entries[0];
  if (
    entries.length !== 1 ||
    !entry ||
    entry.intentMessage.intent.scope.$kind !== "TransactionData" ||
    entry.intentMessage.intent.version.$kind !== "V0" ||
    entry.intentMessage.intent.appId.$kind !== "Sui" ||
    entry.txSignatures.length !== 1
  )
    throw new CliError("Unexpected Sui signed transaction envelope");
  if (
    !Buffer.from(bcs.SenderSignedData.serialize(entries).toBytes()).equals(
      Buffer.from(signedBytes),
    )
  )
    throw new CliError("Non-canonical signed transaction envelope");
  return {
    signedBytes,
    bytes: bcs.TransactionData.serialize(entry.intentMessage.value).toBytes(),
    signatures: entry.txSignatures,
  };
}

export function assertSigningPreservesTransaction(
  prepared: Uint8Array,
  signed: Uint8Array,
  chainIdentifier: string,
): void {
  const expected = Transaction.from(prepared).getData();
  const actual = Transaction.from(signed).getData();
  for (const data of [expected, actual]) {
    if (data.expiration?.$kind === "ValidDuring") {
      if (data.expiration.ValidDuring.chain !== chainIdentifier)
        throw new CliError(
          "Signed transaction expiration is bound to a different chain",
        );
      data.expiration.ValidDuring.nonce = 0;
    }
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new CliError(
      "Sui signing changed the approved transaction beyond its expiration nonce. Nothing was submitted.",
    );
}

export type Runner = (binary: string, args: string[]) => Promise<string>;

export function suiFailureMessage(
  args: string[],
  code: number | null,
  output: string,
): string {
  let index = 1;
  while (args[index] === "--client.config" || args[index] === "--client.env")
    index += 2;
  const command =
    args[0] === "--version"
      ? "version"
      : args[0] === "client"
        ? args[index]
        : undefined;
  const known = [
    "version",
    "active-address",
    "active-env",
    "chain-identifier",
    "publish",
    "call",
    "ptb",
    "serialized-tx",
    "execute-combined-signed-tx",
    "tx-block",
  ];
  const operation = command && known.includes(command) ? command : "command";
  let reason =
    "Check the native Sui command locally for wallet, RPC, or Move errors.";
  if (
    /--build-env[\s\S]*not allowed|not allowed[\s\S]*--build-env/i.test(output)
  ) {
    reason =
      "Sui rejects --build-env for publication; it derives the build environment from --client.env. Rebuild/update suigate before retrying.";
  } else if (
    /GasBalanceTooLow|InsufficientGas|No valid gas coins|no gas coins|cannot find gas coin|insufficient.*(?:gas|sui)|not enough.*(?:gas|sui)/i.test(
      output,
    )
  ) {
    reason =
      "The developer wallet has insufficient usable SUI for gas. Check its balance on the intended network and fund the correct test-only wallet when using testnet.";
  } else if (
    /unpublished dependenc|dependency verification|bytecode mismatch|source.*(?:does not match|mismatch)|on.chain.*mismatch/i.test(
      output,
    )
  ) {
    reason =
      "Move dependency/publication verification failed. Check pinned dependencies and CLI/network compatibility; do not bypass dependency verification.";
  } else if (
    /failed to build|compilation error|failed to resolve|failed to fetch|error\[E\d+\]/i.test(
      output,
    )
  ) {
    reason =
      "Move compilation or dependency resolution failed. Inspect the native Move build output locally before retrying.";
  }
  return `Sui ${operation} failed (${code === null ? "terminated" : `exit ${code}`}). ${reason} Native output is withheld to avoid exposing sensitive configuration.`;
}

export const runProcess: Runner = (binary, args) =>
  new Promise((resolveOutput, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new CliError(
          "Sui command timed out. Reconcile any pending transaction before retrying.",
        ),
      );
    }, 180_000);
    child.stdin.on("error", () => {});
    child.stdin.end("n\n");
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_000_000) {
        child.kill();
        reject(new CliError("Sui command output exceeded the safe limit"));
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new CliError(
          "Sui CLI could not be started. Install it or set SUI_BIN.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new CliError(
            suiFailureMessage(args, code, `${stdout.slice(-8192)}\n${stderr}`),
          ),
        );
      else resolveOutput(stdout.trim());
    });
  });

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(
      "Sui returned an unexpected response; supported CLI baseline is 1.81.0",
    );
  }
}

export class NativeSui implements SuiTransport {
  readonly configPath: string;
  constructor(
    readonly binary = process.env.SUI_BIN ?? "sui",
    configPath = join(homedir(), ".sui/sui_config/client.yaml"),
    readonly runner: Runner = runProcess,
  ) {
    this.configPath = resolve(
      configPath.startsWith("~/")
        ? join(homedir(), configPath.slice(2))
        : configPath,
    );
  }

  async #client(
    args: string[],
    environment?: string,
    jsonOutput = true,
  ): Promise<string> {
    if (!(await exists(this.configPath)))
      throw new CliError(
        "No existing Sui client configuration found. Configure Sui yourself first; suigate never creates/imports wallet keys.",
      );
    return this.runner(this.binary, [
      "client",
      "--client.config",
      this.configPath,
      ...(environment ? ["--client.env", environment] : []),
      ...args,
      ...(jsonOutput ? ["--json"] : []),
    ]);
  }

  async inspect(): Promise<WalletInfo> {
    const version = await this.runner(this.binary, ["--version"]);
    const match = /^sui 1\.(\d+)\./.exec(version);
    if (!match || Number(match[1]) < 81)
      throw new CliError(
        "Use Sui CLI 1.81.x or a compatible newer 1.x release",
      );
    const address = id(
      json(await this.#client(["active-address"])),
      "active Sui address",
    );
    const environment = json(await this.#client(["active-env"]));
    if (typeof environment !== "string" || !environment.length)
      throw new CliError("No active Sui environment");
    const chain = json(
      await this.#client(
        ["chain-identifier", "--format", "base58"],
        environment,
      ),
    );
    const chainIdentifier =
      typeof chain === "string"
        ? chain
        : (chain as { base58?: unknown })?.base58;
    if (typeof chainIdentifier !== "string")
      throw new CliError("Unable to determine the active Sui chain identifier");
    return { address, environment, chainIdentifier, version };
  }

  async #assertWallet(wallet: WalletInfo) {
    const current = await this.inspect();
    if (
      current.address !== wallet.address ||
      current.environment !== wallet.environment ||
      current.chainIdentifier !== wallet.chainIdentifier
    )
      throw new CliError(
        "Active wallet/network changed after preview. Deployment stopped.",
      );
  }

  async prepare(args: string[], wallet: WalletInfo): Promise<Uint8Array> {
    await this.#assertWallet(wallet);
    const output = await this.#client(
      [...args, "--serialize-unsigned-transaction"],
      wallet.environment,
      false,
    );
    let encoded: unknown;
    try {
      encoded = JSON.parse(output);
    } catch {
      encoded = output;
    }
    if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(encoded))
      throw new CliError("Expected unsigned transaction bytes from Sui CLI");
    const bytes = fromBase64(encoded);
    const data = Transaction.from(bytes).getData();
    if (
      !data.sender ||
      normalizeSuiAddress(data.sender) !== wallet.address ||
      !data.gasData.owner ||
      normalizeSuiAddress(data.gasData.owner) !== wallet.address
    )
      throw new CliError(
        "Prepared transaction is not funded and sent by the previewed developer wallet",
      );
    return bytes;
  }

  async sign(
    bytes: Uint8Array,
    wallet: WalletInfo,
  ): Promise<SignedTransaction> {
    await this.#assertWallet(wallet);
    const output = await this.#client(
      [
        "serialized-tx",
        Buffer.from(bytes).toString("base64"),
        "--serialize-signed-transaction",
      ],
      wallet.environment,
      false,
    );
    if (!/^[A-Za-z0-9+/]+=*$/.test(output))
      throw new CliError(
        "Expected serialized signed transaction bytes from Sui CLI",
      );
    const signed = decodeSignedTransaction(fromBase64(output));
    assertSigningPreservesTransaction(
      bytes,
      signed.bytes,
      wallet.chainIdentifier,
    );
    if (
      !(await isValidTransactionSignature(signed.bytes, signed.signatures[0]!, {
        address: wallet.address,
      }))
    )
      throw new CliError(
        "Sui CLI did not sign the final transaction with the approved wallet",
      );
    return signed;
  }

  async execute(
    transaction: SignedTransaction,
    wallet: WalletInfo,
  ): Promise<unknown> {
    await this.#assertWallet(wallet);
    const decoded = decodeSignedTransaction(transaction.signedBytes);
    if (!Buffer.from(decoded.bytes).equals(Buffer.from(transaction.bytes)))
      throw new CliError("Signed transaction bytes changed before submission");
    return json(
      await this.#client(
        [
          "execute-combined-signed-tx",
          "--signed-tx-bytes",
          Buffer.from(transaction.signedBytes).toString("base64"),
        ],
        wallet.environment,
      ),
    );
  }

  async buildPackage(
    path: string,
    environment: string,
  ): Promise<PackageArtifact> {
    const artifact = json(
      await this.runner(this.binary, [
        "move",
        "build",
        "--path",
        path,
        "--build-env",
        environment,
        "--dump-bytecode-as-base64",
      ]),
    ) as PackageArtifact;
    if (
      !artifact ||
      !Array.isArray(artifact.modules) ||
      !artifact.modules.length ||
      !artifact.modules.every((module) => typeof module === "string") ||
      !Array.isArray(artifact.dependencies) ||
      !artifact.dependencies.every(
        (dependency) => typeof dependency === "string",
      )
    )
      throw new CliError("Unexpected compiled Move package artifact");
    return { modules: artifact.modules, dependencies: artifact.dependencies };
  }

  async transaction(digest: string, wallet: WalletInfo): Promise<unknown> {
    return json(await this.#client(["tx-block", digest], wallet.environment));
  }
}
