import type { Transaction } from "@mysten/sui/transactions";
import { SuigateError } from "./errors.js";
import { address, u64 } from "./internal/validation.js";
import type { GasSelection, GasStrategy, Sponsor } from "./types.js";

export function configureGas(
  transaction: Transaction,
  options: {
    sender: string;
    gas?: GasStrategy;
    sponsor?: Sponsor;
  },
): GasSelection {
  const sender = address(options.sender);
  const strategy = options.gas ?? "auto";
  if (!["auto", "user", "sponsored"].includes(strategy)) {
    throw new SuigateError("INVALID_ARGUMENT", "Unknown gas strategy");
  }
  const sponsored =
    strategy === "sponsored" ||
    (strategy === "auto" && options.sponsor !== undefined);
  if (sponsored && !options.sponsor)
    throw new SuigateError(
      "SPONSOR_REQUIRED",
      "Configure a sponsor for sponsored gas",
    );
  const data = transaction.getData();
  if (data.sender && address(data.sender) !== sender) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Transaction sender does not match gas configuration",
    );
  }
  if (
    data.gasData.owner ||
    data.gasData.payment !== null ||
    data.gasData.price !== null ||
    data.gasData.budget !== null
  ) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Gas strategy must be configured before gas fields are set",
    );
  }
  if (sponsored && (data.commands.length || data.inputs.length)) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Configure sponsorship before adding inputs or commands so funding cannot use the sponsor's gas",
    );
  }
  transaction.setSender(sender);
  if (!sponsored) return Object.freeze({ mode: "user", owner: sender });
  const sponsor = options.sponsor!;
  const owner = address(sponsor.address);
  if (owner === sender)
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Sponsor must differ from the customer",
    );
  if (
    sponsor.budget !== undefined &&
    u64(sponsor.budget, "Gas budget") === 0n
  ) {
    throw new SuigateError(
      "INVALID_ARGUMENT",
      "Sponsored gas budget must be positive",
    );
  }
  transaction.setGasOwner(owner);
  transaction.setGasPayment(
    (sponsor.gasPayment ?? []).map((coin) => ({
      ...coin,
      objectId: address(coin.objectId),
    })),
  );
  if (sponsor.budget !== undefined) transaction.setGasBudget(sponsor.budget);
  return Object.freeze({ mode: "sponsored", owner });
}
