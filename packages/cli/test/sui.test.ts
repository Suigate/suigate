import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { SUI_NETWORKS } from "@suigate/core";
import {
  NativeSui,
  runProcess,
  suiFailureMessage,
  type WalletInfo,
} from "../src/sui.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const wallet: WalletInfo = {
  address: normalizeSuiAddress("0xa"),
  environment: "testnet",
  chainIdentifier: SUI_NETWORKS.testnet.chainIdentifier,
  version: "sui 1.81.0",
};
const argumentsForPublish = [
  "client",
  "--client.config",
  "/private/client.yaml",
  "--client.env",
  "testnet",
  "publish",
  "/tmp/staging",
  "--serialize-unsigned-transaction",
];

describe("native Sui diagnostics", () => {
  it("identifies the actual rejected publication flag without exposing native output", () => {
    const message = suiFailureMessage(
      argumentsForPublish,
      1,
      "The `--build-env` argument is not allowed for `sui move publish`; when publishing you must build for the environment that you are publishing for.\nhttps://user:password@example.invalid?token=private-value",
    );
    expect(message).toContain("Sui publish failed (exit 1)");
    expect(message).toContain(
      "derives the build environment from --client.env",
    );
    expect(message).not.toContain("password");
    expect(message).not.toContain("private-value");
    expect(message).not.toContain("/private/client.yaml");
  });

  it("classifies gas and dependency errors without encouraging unsafe verification bypass", () => {
    expect(
      suiFailureMessage(argumentsForPublish, 1, "GasBalanceTooLow"),
    ).toContain("insufficient usable SUI");
    expect(
      suiFailureMessage(
        argumentsForPublish,
        1,
        "dependency verification failed",
      ),
    ).toContain("do not bypass dependency verification");
    const unknown = suiFailureMessage(
      ["client", "--client.config", "secret", "malicious\ntext"],
      1,
      "secret recovery phrase: fake-example-only",
    );
    expect(unknown).toContain("Sui command failed");
    expect(unknown).not.toContain("malicious");
    expect(unknown).not.toContain("recovery phrase");
  });

  for (const stream of ["stdout", "stderr"] as const) {
    it(`recognizes diagnostic text on ${stream} while withholding raw output`, async () => {
      const script = `process.${stream}.write("The --build-env argument is not allowed for publish. token=private-example");process.exitCode=1;`;
      await expect(
        runProcess(process.execPath, ["-e", script]),
      ).rejects.toThrow("derives the build environment");
      await expect(
        runProcess(process.execPath, ["-e", script]),
      ).rejects.not.toThrow("private-example");
    });
  }

  it("prepares with the selected CLI environment and unsigned base64 mode, not --json or --build-env", async () => {
    const directory = await mkdtemp(join(tmpdir(), "suigate-native-test-"));
    directories.push(directory);
    const configPath = join(directory, "client.yaml");
    await writeFile(configPath, "test fixture, no keys");
    const tx = new Transaction();
    tx.setSender(wallet.address);
    tx.setGasOwner(wallet.address);
    tx.setGasBudget(200_000_000);
    tx.setGasPrice(1000);
    tx.setGasPayment([
      {
        objectId: normalizeSuiAddress("0x9"),
        version: "1",
        digest: "11111111111111111111111111111111",
      },
    ]);
    const bytes = await tx.build();
    const calls: string[][] = [];
    const native = new NativeSui("sui", configPath, async (_binary, args) => {
      calls.push(args);
      if (args.includes("--version")) return wallet.version;
      if (args.includes("active-address"))
        return JSON.stringify(wallet.address);
      if (args.includes("active-env"))
        return JSON.stringify(wallet.environment);
      if (args.includes("chain-identifier"))
        return JSON.stringify({ base58: wallet.chainIdentifier });
      return Buffer.from(bytes).toString("base64");
    });
    expect(
      await native.prepare(
        [
          "publish",
          directory,
          "--sender",
          wallet.address,
          "--gas-budget",
          "200000000",
        ],
        wallet,
      ),
    ).toEqual(bytes);
    const invocation = calls.at(-1)!;
    expect(invocation).toContain("--serialize-unsigned-transaction");
    expect(invocation).toContain("--client.env");
    expect(invocation[invocation.indexOf("--client.env") + 1]).toBe("testnet");
    expect(invocation).not.toContain("--json");
    expect(invocation).not.toContain("--build-env");
    expect(calls.some((args) => args.includes("serialized-tx"))).toBe(false);
  });
});
