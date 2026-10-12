import { PaymentKitClient } from "@mysten/payment-kit";
import {
  ObjectError,
  type ClientWithCoreApi,
  type SuiClientTypes,
} from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";
import { SuigateError } from "../errors.js";
import type { GasSelection, Plan, Service } from "../types.js";
import { rpc } from "./rpc.js";

export class PaymentAdapter {
  readonly #payments: PaymentKitClient;

  constructor(client: ClientWithCoreApi) {
    if (client.network !== "mainnet" && client.network !== "testnet") {
      throw new SuigateError(
        "WRONG_NETWORK",
        "The pinned Payment Kit SDK supports mainnet and testnet only",
      );
    }
    const core = new Proxy(client.core, {
      get(target, property) {
        if (property !== "getDynamicField")
          return Reflect.get(target, property, target);
        return (options: SuiClientTypes.GetDynamicFieldOptions) =>
          target.getDynamicField({
            ...options,
            name: {
              ...options.name,
              type: options.name.type.replace(
                "::PaymentKey<phantom T><",
                "::PaymentKey<",
              ),
            },
          });
      },
    });
    this.#payments = new PaymentKitClient({
      client: new Proxy(client, {
        get: (target, property) =>
          property === "core" ? core : Reflect.get(target, property, target),
      }),
    });
  }

  async assertUnused(
    service: Service,
    plan: Plan,
    nonce: string,
  ): Promise<void> {
    const record = await rpc(async () => {
      try {
        return await this.#payments.getPaymentRecord({
          registryId: service.registryId,
          receiver: service.paymentRecipient,
          coinType: plan.coinType,
          amount: plan.price,
          nonce,
        });
      } catch (error) {
        if (error instanceof ObjectError && error.reason === "notFound")
          return null;
        throw error;
      }
    });
    if (record)
      throw new SuigateError(
        "DUPLICATE_PAYMENT",
        "Payment Kit already records this payment; reconcile the previous transaction",
      );
  }

  coin(transaction: Transaction, plan: Plan, gas: GasSelection) {
    return transaction.coin({
      type: plan.coinType,
      balance: plan.price,
      useGasCoin: gas.mode === "user",
    });
  }
}
