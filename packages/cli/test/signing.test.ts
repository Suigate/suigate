import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_NETWORKS } from "@suigate/core";
import {
  NativeSui,
  decodeSignedTransaction,
  assertSigningPreservesTransaction,
} from "../src/sui.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const signer = new Ed25519Keypair();
  const wallet = {
    address: signer.toSuiAddress(),
    environment: "testnet",
    chainIdentifier: SUI_NETWORKS.testnet.chainIdentifier,
    version: "sui 1.81.0",
  };
  const tx = new Transaction();
  tx.setSender(wallet.address);
  tx.setGasOwner(wallet.address);
  tx.setGasBudget(200_000_000);
  tx.setGasPrice(1000);
  tx.setGasPayment([
    {
      objectId: "0x9",
      version: "1",
      digest: "11111111111111111111111111111111",
    },
  ]);
  const unsigned = bcs.TransactionData.parse(await tx.build());
  unsigned.V1.gasData.payment = [];
  const expiration = {
    minEpoch: "1250",
    maxEpoch: "1251",
    minTimestamp: null,
    maxTimestamp: null,
    chain: wallet.chainIdentifier,
    nonce: 10,
  };
  const prepared = bcs.TransactionData.serialize({
    V1: { ...unsigned.V1, expiration: { ValidDuring: expiration } },
  }).toBytes();
  const signedBytes = bcs.TransactionData.serialize({
    V1: {
      ...unsigned.V1,
      expiration: { ValidDuring: { ...expiration, nonce: 20 } },
    },
  }).toBytes();
  async function envelope(bytes: Uint8Array, key = signer, scope = 0) {
    const { signature } = await key.signTransaction(bytes);
    return bcs.SenderSignedData.serialize([
      {
        intentMessage: {
          intent: bcs.Intent.parse(new Uint8Array([scope, 0, 0])),
          value: bcs.TransactionData.parse(bytes),
        },
        txSignatures: [signature],
      },
    ]).toBytes();
  }
  const signed = await envelope(signedBytes);
  const directory = await mkdtemp(join(tmpdir(), "suigate-signing-test-"));
  directories.push(directory);
  const path = join(directory, "client.yaml");
  await writeFile(path, "fixture, no wallet keys");
  const calls: string[][] = [];
  const native = (output = signed) =>
    new NativeSui("sui", path, async (_binary, args) => {
      calls.push(args);
      if (args.includes("--version")) return wallet.version;
      if (args.includes("active-address"))
        return JSON.stringify(wallet.address);
      if (args.includes("active-env"))
        return JSON.stringify(wallet.environment);
      if (args.includes("chain-identifier"))
        return JSON.stringify({ base58: wallet.chainIdentifier });
      if (args.includes("--serialize-signed-transaction"))
        return Buffer.from(output).toString("base64");
      if (args.includes("execute-combined-signed-tx"))
        return JSON.stringify({ submitted: true });
      throw new Error("Unexpected native operation");
    });
  return { wallet, prepared, signedBytes, signed, calls, native, envelope };
}

describe("exact signed transaction submission", () => {
  it("uses the final signed digest after the address-balance nonce changes and submits the unchanged envelope", async () => {
    const f = await fixture();
    const native = f.native();
    const signed = await native.sign(f.prepared, f.wallet);
    expect(await Transaction.from(signed.bytes).getDigest()).not.toBe(
      await Transaction.from(f.prepared).getDigest(),
    );
    expect(signed.bytes).toEqual(f.signedBytes);
    await native.execute(signed, f.wallet);
    const signing = f.calls.find((args) => args.includes("serialized-tx"))!;
    expect(signing).toContain("--serialize-signed-transaction");
    expect(signing).not.toContain("--json");
    const execution = f.calls.at(-1)!;
    expect(execution).toContain("execute-combined-signed-tx");
    expect(execution[execution.indexOf("--signed-tx-bytes") + 1]).toBe(
      Buffer.from(f.signed).toString("base64"),
    );
    expect(execution).not.toContain("serialized-tx");
  });

  it("rejects changed commands, gas, expiration bounds, or chain rather than silently signing a new intent", async () => {
    const f = await fixture();
    const tx = bcs.TransactionData.parse(f.signedBytes);
    const gasChanged = bcs.TransactionData.serialize({
      V1: { ...tx.V1, gasData: { ...tx.V1.gasData, budget: "300000000" } },
    }).toBytes();
    expect(() =>
      assertSigningPreservesTransaction(
        f.prepared,
        gasChanged,
        f.wallet.chainIdentifier,
      ),
    ).toThrow("beyond its expiration nonce");
    const expiration = tx.V1.expiration.ValidDuring!;
    const timeChanged = bcs.TransactionData.serialize({
      V1: {
        ...tx.V1,
        expiration: { ValidDuring: { ...expiration, maxEpoch: "1300" } },
      },
    }).toBytes();
    expect(() =>
      assertSigningPreservesTransaction(
        f.prepared,
        timeChanged,
        f.wallet.chainIdentifier,
      ),
    ).toThrow();
    const wrongChain = bcs.TransactionData.serialize({
      V1: {
        ...tx.V1,
        expiration: {
          ValidDuring: {
            ...expiration,
            chain: SUI_NETWORKS.mainnet.chainIdentifier,
          },
        },
      },
    }).toBytes();
    expect(() =>
      assertSigningPreservesTransaction(
        f.prepared,
        wrongChain,
        f.wallet.chainIdentifier,
      ),
    ).toThrow("different chain");
    await expect(
      f.native(await f.envelope(gasChanged)).sign(f.prepared, f.wallet),
    ).rejects.toThrow("beyond its expiration nonce");
  });

  it("rejects the wrong signing key, message intent, and trailing envelope data", async () => {
    const f = await fixture();
    await expect(
      f
        .native(await f.envelope(f.signedBytes, new Ed25519Keypair()))
        .sign(f.prepared, f.wallet),
    ).rejects.toThrow("approved wallet");
    expect(() =>
      decodeSignedTransaction(new Uint8Array([...f.signed, 0])),
    ).toThrow();
    expect(() =>
      decodeSignedTransaction(bcs.SenderSignedData.serialize([]).toBytes()),
    ).toThrow();
    const messageIntent = await f.envelope(f.signedBytes, undefined, 3);
    expect(() => decodeSignedTransaction(messageIntent)).toThrow("envelope");
  });
});
