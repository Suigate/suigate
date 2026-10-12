# Architecture and Move model

> **100% AI-generated and unaudited.** Incorrect or hallucinated code may cause loss of funds, keys, data, or otherwise. Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. Read the [risk and audit disclaimer](../DISCLAIMER.md). The described architecture is not a security certification.

## Separation of responsibilities

Payment Kit handles exact-value payment processing, duplicate payment records, registry administration, and its own payment events. suigate handles Service/Plan policy, entitlement issuance and renewal, authorization, and revocation.

A `PaymentReceipt` is not an `Entitlement`. A receipt is not a consumable proof object and is not accepted by the backend authorization packages.

## Atomic purchase

The purchase PTB calls the suigate Move wrapper. That wrapper fetches authoritative plan terms, checks the expected configuration versions and quote deadline, calls Payment Kit, and creates the entitlement. These actions execute in one transaction. A Move abort rolls back payment and entitlement writes together; gas can still be charged.

Payment is sent directly according to the Service's payment recipient. suigate does not keep a centralized customer-funds balance. Each Service creates a direct-payment Payment Kit registry and wraps its registry administration capability in the Service administration capability.

The TypeScript core delegates Payment Kit record encoding/lookup to the installed SDK. Its internal adapter contains a narrow correction for Payment Kit 0.2.31's malformed generated `PaymentKey<phantom T>` lookup name. It does not implement a competing receipt or registry system.

## Objects

### Service

A shared object containing owner, payment recipient, administration capability ID, registry ID, configuration version, a plans table, and a revocations table. Creation sets owner and recipient to the transaction sender. Configuration changes require both the matching capability and current owner. Transferring administration does not automatically change the recipient.

### Plan

A value in the Service's table keyed by a stable, case-sensitive ASCII name. Terms include price in coin base units, exact Move coin type, duration in milliseconds, version, and independent purchase/renewal availability flags. The CLI uses a conservative letters/digits/hyphen/underscore subset for new plan keys.

### Entitlement

An address-owned `key` object without `store`: it is not publicly transferable. Its fields include Service, plan key, holder, issuance/expiry timestamps, revision, and plan version. Its ID is derived from Service, holder, and plan; only one entitlement is issued for that combination. Knowing that ID grants no access.

Renewal mutates the existing entitlement:

```text
new_expiry = max(current_expiry, current_time) + plan.duration
```

Core renewal builders require `expectedRevision`, preventing an uncertain renewal from being rebuilt silently against a later state. Changing plan terms does not invalidate time already purchased. Revocation is permanent in this version and is tracked in the Service table.

## Application boundary

Core builders return unsigned transactions and predicted IDs, not proof of purchase. React waits for transaction confirmation, checks the expected creation effect, then calls core's live verifier.

Backend adapters first verify a one-use wallet challenge, then call the same core entitlement verifier. Verification checks object type, Service, plan, owner/holder, expiry, and revocation. The frontend success screen is not an authorization boundary.

## Deployment is not purchase

Protocol publication, Service creation, and initial plan creation are separate transactions under the current Move API. A deployment may partially complete. The CLI records confirmed IDs and pending transaction digests; it does not promise atomic rollback of the entire deployment.
