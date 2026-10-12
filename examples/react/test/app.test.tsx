import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@mysten/dapp-kit-react", () => ({
  createDAppKit: () => ({}),
  DAppKitProvider: ({ children }: { children: ReactNode }) => children,
  useDAppKit: () => ({}),
  useCurrentClient: () => ({}),
  useWalletConnection: () => ({ account: null }),
}));
vi.mock("@mysten/dapp-kit-react/ui", () => ({
  ConnectButton: () => <button>Connect wallet</button>,
}));

vi.mock("@suigate/react", () => ({
  SuigateProvider: ({ children }: { children: ReactNode }) => children,
  SuigatePaywall: ({
    serviceId,
    plan,
  }: {
    serviceId: string;
    plan: string;
  }) => (
    <div data-testid="configured-paywall">
      {serviceId} / {plan}
    </div>
  ),
}));

import { App } from "../src/app.js";

describe("React example", () => {
  it("starts without fabricated deployment data or automatic transactions", () => {
    render(<App />);
    expect(screen.getByText("Ready when you are")).toBeTruthy();
    expect(screen.queryByTestId("configured-paywall")).toBeNull();
    expect(screen.getByText(/backend must verify wallet control/)).toBeTruthy();
  });

  it("validates configuration and passes the actual service and plan to the paywall", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Package ID"), {
      target: { value: "invalid" },
    });
    fireEvent.change(screen.getByLabelText("Service ID"), {
      target: { value: "0x100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load paywall" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "valid Sui package",
    );
    fireEvent.change(screen.getByLabelText("Package ID"), {
      target: { value: "0xabc" },
    });
    fireEvent.change(screen.getByLabelText("Plan key"), {
      target: { value: "team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load paywall" }));
    expect(screen.getByTestId("configured-paywall").textContent).toContain(
      "0100 / team",
    );
  });
});
