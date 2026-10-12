import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fromBase64, normalizeStructTag } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import type { GasStrategy } from "@suigate/core";
import {
  COIN,
  deferred,
  deployment,
  fixture,
  plan,
  SERVICE,
} from "./fixtures.js";

async function ready(f: ReturnType<typeof fixture>) {
  await f.connect();
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Purchase access",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
}

async function buy(f: ReturnType<typeof fixture>) {
  await ready(f);
  fireEvent.click(screen.getByRole("button", { name: "Purchase access" }));
}

describe("SuigatePaywall", () => {
  it("shows an unavoidable AI-generated/unaudited notice before wallet interaction", () => {
    const f = fixture();
    f.render({
      labels: { title: "Custom checkout" },
      renderLoading: () => null,
    });
    const notice = screen.getByRole("note", {
      name: "Unaudited software warning",
    });
    expect(notice.textContent).toContain("100% AI-generated");
    expect(notice.textContent).toContain("hallucinated");
    expect(notice.textContent).toContain("private keys");
    expect(notice.getAttribute("data-suigate-human-audit")).toBe("not-audited");
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.purchase).not.toHaveBeenCalled();
  });

  it("advertises an explicitly configured discovery link without purchasing or signing", async () => {
    const f = fixture();
    const view = f.render({ discoveryUrl: "/api/.suigate/discovery" });
    await screen.findByText("1.5 SUI");
    const link = screen.getByRole("link", { name: "Programmatic access" });
    expect(link.getAttribute("href")).toBe("/api/.suigate/discovery");
    expect(link.getAttribute("rel")).toBe("describedby");
    expect(
      view.container
        .querySelector("[data-suigate-discovery]")
        ?.getAttribute("data-suigate-service"),
    ).toBe(SERVICE);
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.purchase).not.toHaveBeenCalled();
  });

  it("discovers and connects a Wallet Standard wallet through real dApp Kit", async () => {
    const f = fixture();
    const view = f.render();
    await screen.findByText("1.5 SUI");
    expect(
      view.container.querySelector("[data-suigate-wallet]"),
    ).not.toBeNull();
    expect(screen.getByText("Connect wallet")).toBeTruthy();
    const connectButton = view.container.querySelector(
      "mysten-dapp-kit-connect-button",
    );
    await waitFor(() => {
      expect(connectButton?.instance).toBe(f.kit);
      expect(
        connectButton?.shadowRoot?.querySelector("internal-button"),
      ).toBeTruthy();
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Purchase access",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await ready(f);
    expect(f.kit.stores.$connection.get().account?.address).toBe(f.sender);
    expect(f.getPlan).toHaveBeenCalledWith({ serviceId: SERVICE, plan: "pro" });
  });

  it("keeps the loaded plan stable when equivalent deployment props are recreated", async () => {
    const f = fixture();
    const view = f.render();
    await screen.findByText("1.5 SUI");
    const reads = f.getPlan.mock.calls.length;
    view.rerender(f.tree({}, { ...deployment }));
    await screen.findByText("1.5 SUI");
    expect(f.getPlan).toHaveBeenCalledTimes(reads);
  });

  it("requests a signature, executes, waits, and verifies the resulting entitlement", async () => {
    const f = fixture();
    f.render();
    await buy(f);
    await screen.findByText("Access purchased");
    expect(f.sign).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.wait).toHaveBeenCalledTimes(1);
    expect(f.verify).toHaveBeenCalledWith({
      entitlementId: f.entitlementId,
      serviceId: SERVICE,
      plan: "pro",
      owner: f.sender,
    });
    expect(f.onSuccess).toHaveBeenCalledWith({
      digest: expect.any(String),
      entitlement: f.entitlement,
    });
    expect(screen.getByText(f.entitlementId)).toBeTruthy();
  });

  it("exposes wallet approval and transaction pending states and prevents double clicks", async () => {
    const f = fixture();
    const approval = deferred<{ bytes: string; signature: string }>();
    f.sign.mockImplementationOnce(() => approval.promise);
    const confirmation = deferred<ReturnType<typeof f.successful>>();
    f.wait.mockImplementationOnce(() => confirmation.promise);
    f.render();
    await buy(f);
    await screen.findByText("Approve the purchase in your wallet.");
    fireEvent.click(screen.getByRole("button", { name: "Purchase access" }));
    expect(f.purchase).toHaveBeenCalledTimes(1);
    const request = f.sign.mock.calls[0]![0];
    const bytes = fromBase64(await request.transaction.toJSON());
    await act(async () =>
      approval.resolve(await f.keypair.signTransaction(bytes)),
    );
    await screen.findByText("Confirming your entitlement…");
    expect(f.onSuccess).not.toHaveBeenCalled();
    await act(async () =>
      confirmation.resolve(
        f.successful(await Transaction.from(bytes).getDigest()),
      ),
    );
    await screen.findByText("Access purchased");
  });

  it("handles wallet rejection without submitting and allows an explicit retry", async () => {
    const f = fixture();
    f.sign.mockRejectedValueOnce(
      Object.assign(new Error("User rejected request"), { code: 4001 }),
    );
    f.render();
    await buy(f);
    await screen.findByText(/Wallet approval was declined/);
    expect(f.execute).not.toHaveBeenCalled();
    const nonce = f.purchase.mock.calls[0]![0].nonce;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Access purchased");
    expect(f.purchase.mock.calls[1]![0].nonce).toBe(nonce);
  });

  it("shows insufficient gas for stablecoin purchases without SUI", async () => {
    const f = fixture();
    const coinType = normalizeStructTag("0xabc::usdc::USDC");
    const stablePlan = { ...plan, coinType };
    f.getPlan.mockResolvedValue(stablePlan);
    const original = f.purchase.getMockImplementation()!;
    f.purchase.mockImplementation(async (options) => {
      const draft = await original(options);
      return { ...draft, quote: { ...draft.quote, plan: stablePlan } };
    });
    f.balance.mockImplementation(async ({ coinType = COIN }) => ({
      balance: {
        coinType,
        balance: normalizeStructTag(coinType) === COIN ? "0" : "100000000000",
        coinBalance: "0",
        addressBalance: "0",
      },
    }));
    f.render();
    await buy(f);
    await screen.findByText(/needs SUI for the network fee/);
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("handles not enough payment currency separately from gas", async () => {
    const f = fixture();
    f.balance.mockResolvedValue({
      balance: {
        coinType: COIN,
        balance: "1",
        coinBalance: "1",
        addressBalance: "0",
      },
    });
    f.render();
    await buy(f);
    await screen.findByText(/not have enough of the accepted currency/);
    expect(f.sign).not.toHaveBeenCalled();
  });

  it("executes sponsored transactions with both signatures and sponsor-paid gas", async () => {
    const f = fixture({ sponsored: true });
    f.balance.mockResolvedValue({
      balance: {
        coinType: COIN,
        balance: plan.price.toString(),
        coinBalance: plan.price.toString(),
        addressBalance: "0",
      },
    });
    f.render();
    await screen.findByText(/Network fee covered/);
    await buy(f);
    await screen.findByText("Access purchased");
    expect(f.sponsorSign).toHaveBeenCalledTimes(1);
    const submitted = f.execute.mock.calls[0]![0];
    expect(submitted.signatures).toHaveLength(2);
    expect(
      Transaction.from(submitted.transaction).getData().gasData.owner,
    ).toBe(f.sponsorKeypair.toSuiAddress());
    expect(f.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast when sponsorship fails or returns an invalid signature", async () => {
    const f = fixture({ sponsored: true });
    f.sponsorSign.mockRejectedValueOnce(new Error("quota exhausted"));
    f.render();
    await buy(f);
    await screen.findByText(/Fee sponsorship is unavailable/);
    expect(f.execute).not.toHaveBeenCalled();
    f.sponsorSign.mockResolvedValueOnce({ bytes: "", signature: "invalid" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/sponsor did not authorize/);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("does not claim stablecoin entitlement purchases are gasless", async () => {
    const f = fixture();
    f.render({ gas: "gasless" as GasStrategy });
    await screen.findByText(/require a SUI network fee or a sponsor/);
    expect(f.purchase).not.toHaveBeenCalled();
  });

  it("preserves an uncertain submission and checks its digest without paying again", async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(new Error("network response lost"));
    f.render();
    await buy(f);
    await screen.findByText(/Check status; do not pay again/);
    expect(f.onSuccess).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Check purchase status" }),
    );
    await screen.findByText("Access purchased");
    expect(f.purchase).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it("does not report success from a digest alone when entitlement verification fails", async () => {
    const f = fixture();
    f.verify.mockRejectedValueOnce(new Error("object not indexed yet"));
    f.render();
    await buy(f);
    await screen.findByText(/could not yet be verified/);
    expect(f.onSuccess).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Check purchase status" }),
    );
    await screen.findByText("Access purchased");
    expect(f.sign).toHaveBeenCalledTimes(1);
  });

  it("supports labels, styles, loading, currency, success, and error callbacks", async () => {
    const f = fixture();
    f.render({
      labels: { title: "Developer API", purchase: "Unlock API" },
      className: "custom-paywall",
      style: { borderRadius: 4 },
      renderLoading: () => <span>Custom progress</span>,
      renderCurrency: ({ currency }) => <span>Pay in {currency.symbol}</span>,
      renderSuccess: (result) => <span>Welcome {result.entitlement.plan}</span>,
    });
    expect(screen.getByText("Custom progress")).toBeTruthy();
    await f.connect();
    await screen.findByText("Pay in SUI");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Unlock API",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlock API" }));
    await screen.findByText("Welcome pro");
    expect(
      document.querySelector(".custom-paywall")?.getAttribute("style"),
    ).toContain("border-radius: 4px");
  });

  it("rejects unsupported currencies and reloadable plan errors", async () => {
    const f = fixture();
    const view = f.render({ coinType: "0x123::wrong::COIN" });
    await screen.findByText(/only accepts its on-chain currency/);
    expect(f.purchase).not.toHaveBeenCalled();
    f.getPlan.mockRejectedValueOnce(new Error("RPC unavailable"));
    view.rerender(f.tree());
    await screen.findByText(/Unable to load this plan/);
    fireEvent.click(screen.getByRole("button", { name: "Reload plan" }));
    await screen.findByText("1.5 SUI");
  });

  it("rechecks changed pricing before requesting wallet approval", async () => {
    const f = fixture();
    const original = f.purchase.getMockImplementation()!;
    f.purchase.mockImplementationOnce(async (options) => {
      const draft = await original(options);
      return {
        ...draft,
        quote: {
          ...draft.quote,
          plan: { ...plan, price: 2_000_000_000n, version: 4n },
        },
      };
    });
    f.render();
    await buy(f);
    await screen.findByText(/Review the updated details/);
    expect(screen.getByText("2 SUI")).toBeTruthy();
    expect(f.sign).not.toHaveBeenCalled();
  });

  it("rejects wallet-signed transaction mutations", async () => {
    const f = fixture();
    f.sign.mockImplementationOnce(async ({ transaction }) => {
      const changed = Transaction.from(fromBase64(await transaction.toJSON()));
      changed.setGasBudget(11_000_000);
      return f.keypair.signTransaction(await changed.build());
    });
    f.render();
    await buy(f);
    await screen.findByText(/wallet did not sign the exact/);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("rejects zero-fee bytes for an entitlement-writing transaction", async () => {
    const f = fixture();
    const original = f.purchase.getMockImplementation()!;
    f.purchase.mockImplementationOnce(async (options) => {
      const draft = await original(options);
      draft.transaction.setGasPrice(0);
      draft.transaction.setGasBudget(0);
      return draft;
    });
    f.render();
    await buy(f);
    await screen.findByText(/cannot use the gasless stablecoin-transfer path/);
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("requires entitlement creation in the confirmed transaction effects", async () => {
    const f = fixture();
    f.wait.mockImplementationOnce(async (input) => {
      const result = f.successful(
        "digest" in input ? input.digest : input.result.Transaction!.digest,
      );
      result.Transaction!.effects.changedObjects = [];
      return result;
    });
    f.render();
    await buy(f);
    await screen.findByText(/Check status; do not pay again/);
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.onSuccess).not.toHaveBeenCalled();
  });

  it("keeps status recovery available after currency props change on an uncertain purchase", async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(new Error("network timeout"));
    const view = f.render();
    await buy(f);
    await screen.findByText(/Check status; do not pay again/);
    view.rerender(f.tree({ coinType: "0xabc::other::COIN" }));
    await screen.findByRole("button", { name: "Check purchase status" });
    fireEvent.click(
      screen.getByRole("button", { name: "Check purchase status" }),
    );
    await screen.findByText("Access purchased");
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it("blocks signing on the wrong selected network", async () => {
    const f = fixture();
    f.render();
    await ready(f);
    act(() => f.kit.switchNetwork("mainnet"));
    await screen.findByText(/Switch your wallet to Sui testnet/);
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.purchase).not.toHaveBeenCalled();
  });

  it("does not submit if the wallet disconnects while approval is pending", async () => {
    const f = fixture();
    const approval = deferred<{ bytes: string; signature: string }>();
    f.sign.mockImplementationOnce(() => approval.promise);
    f.render();
    await buy(f);
    await screen.findByText("Approve the purchase in your wallet.");
    const bytes = fromBase64(
      await f.sign.mock.calls[0]![0].transaction.toJSON(),
    );
    await act(() => f.kit.disconnectWallet());
    await act(async () =>
      approval.resolve(await f.keypair.signTransaction(bytes)),
    );
    await waitFor(() => expect(f.execute).not.toHaveBeenCalled());
    expect(f.onSuccess).not.toHaveBeenCalled();
  });
});
