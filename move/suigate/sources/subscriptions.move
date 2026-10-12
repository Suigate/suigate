// WARNING: 100% AI-generated and not independently human-audited. Incorrect or hallucinated code may cause irreversible loss of funds or keys.
// Provided AS IS; publisher responsibility/liability is disclaimed to the extent permitted by law. See DISCLAIMER.md/NOTICE.md; tests are not an audit.
module suigate::subscriptions;

use payment_kit::payment_kit::{Self, Namespace, PaymentRegistry, RegistryAdminCap};
use std::{ascii::String, type_name::{Self, TypeName}};
use sui::{clock::Clock, coin::Coin, derived_object, event, table::{Self, Table}};

const ENotAuthorized: u64 = 0;
const EWrongService: u64 = 1;
const EWrongRegistry: u64 = 2;
const EInvalidPlanKey: u64 = 3;
const EPlanAlreadyExists: u64 = 4;
const EPlanNotFound: u64 = 5;
const EInvalidPrice: u64 = 6;
const EInvalidDuration: u64 = 7;
const EWrongCoinType: u64 = 8;
const EStaleService: u64 = 9;
const EStalePlan: u64 = 10;
const EQuoteExpired: u64 = 11;
const EAlreadyEntitled: u64 = 12;
const ENotHolder: u64 = 13;
const EStaleEntitlement: u64 = 14;
const ERevoked: u64 = 15;
const EPlanUnavailable: u64 = 16;
const EExpiryOverflow: u64 = 17;
const EInvalidAddress: u64 = 18;
const EEntitlementNotFound: u64 = 19;
const U64_MAX: u64 = 18_446_744_073_709_551_615;

public struct Service has key {
    id: UID,
    owner: address,
    admin_cap_id: ID,
    payment_recipient: address,
    registry_id: ID,
    version: u64,
    plans: Table<String, Plan>,
    revocations: Table<ID, bool>,
}

public struct ServiceAdminCap has key {
    id: UID,
    service_id: ID,
    registry_admin_cap: RegistryAdminCap,
}

public struct Plan has copy, drop, store {
    service_id: ID,
    key: String,
    price: u64,
    coin_type: TypeName,
    duration_ms: u64,
    version: u64,
    purchases_enabled: bool,
    renewals_enabled: bool,
}

public struct Entitlement has key {
    id: UID,
    service_id: ID,
    plan_key: String,
    holder: address,
    issued_at: u64,
    expires_at: u64,
    revision: u64,
    plan_version: u64,
}

public struct EntitlementKey has copy, drop, store {
    holder: address,
    plan_key: String,
}

public struct ServiceCreated has copy, drop {
    service_id: ID,
    owner: address,
    payment_recipient: address,
    registry_id: ID,
    admin_cap_id: ID,
}

public struct ServiceUpdated has copy, drop {
    service_id: ID,
    owner: address,
    payment_recipient: address,
    version: u64,
}

public struct PlanCreated has copy, drop {
    plan: Plan,
}

public struct PlanUpdated has copy, drop {
    plan: Plan,
}

public struct EntitlementCreated has copy, drop {
    entitlement_id: ID,
    service_id: ID,
    plan_key: String,
    holder: address,
    issued_at: u64,
    expires_at: u64,
    plan_version: u64,
    nonce: String,
}

public struct EntitlementRenewed has copy, drop {
    entitlement_id: ID,
    service_id: ID,
    plan_key: String,
    holder: address,
    previous_expires_at: u64,
    expires_at: u64,
    revision: u64,
    plan_version: u64,
    nonce: String,
}

public struct EntitlementRevoked has copy, drop {
    entitlement_id: ID,
    service_id: ID,
    holder: address,
    plan_key: String,
}

public fun create_service(namespace: &mut Namespace, registry_name: String, ctx: &mut TxContext) {
    let (registry, registry_admin_cap) = payment_kit::create_registry(
        namespace,
        registry_name,
        ctx,
    );
    let id = object::new(ctx);
    let cap = ServiceAdminCap {
        id: object::new(ctx),
        service_id: id.to_inner(),
        registry_admin_cap,
    };
    let service = Service {
        id,
        owner: ctx.sender(),
        admin_cap_id: object::id(&cap),
        payment_recipient: ctx.sender(),
        registry_id: object::id(&registry),
        version: 0,
        plans: table::new(ctx),
        revocations: table::new(ctx),
    };
    event::emit(ServiceCreated {
        service_id: object::id(&service),
        owner: service.owner,
        payment_recipient: service.payment_recipient,
        registry_id: service.registry_id,
        admin_cap_id: service.admin_cap_id,
    });
    payment_kit::share(registry);
    transfer::transfer(cap, ctx.sender());
    transfer::share_object(service);
}

public fun set_payment_recipient(
    service: &mut Service,
    cap: &ServiceAdminCap,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert_admin(service, cap, ctx);
    assert!(
        recipient != @0x0
            && recipient != service.registry_id.to_address()
            && recipient != object::id_address(service),
        EInvalidAddress,
    );
    service.payment_recipient = recipient;
    service.version = service.version + 1;
    emit_service_updated(service);
}

public fun transfer_service(
    service: &mut Service,
    cap: ServiceAdminCap,
    new_owner: address,
    ctx: &mut TxContext,
) {
    assert_admin(service, &cap, ctx);
    assert!(new_owner != @0x0, EInvalidAddress);
    service.owner = new_owner;
    service.version = service.version + 1;
    emit_service_updated(service);
    transfer::transfer(cap, new_owner);
}

public fun create_plan<T>(
    service: &mut Service,
    cap: &ServiceAdminCap,
    key: String,
    price: u64,
    duration_ms: u64,
    ctx: &mut TxContext,
) {
    assert_admin(service, cap, ctx);
    assert!(key.length() > 0 && key.length() <= 64, EInvalidPlanKey);
    assert!(!service.plans.contains(key), EPlanAlreadyExists);
    assert_terms(price, duration_ms);
    let plan = Plan {
        service_id: object::id(service),
        key,
        price,
        coin_type: type_name::with_defining_ids<T>(),
        duration_ms,
        version: 0,
        purchases_enabled: true,
        renewals_enabled: true,
    };
    service.plans.add(key, plan);
    event::emit(PlanCreated { plan });
}

public fun update_plan<T>(
    service: &mut Service,
    cap: &ServiceAdminCap,
    key: String,
    price: u64,
    duration_ms: u64,
    purchases_enabled: bool,
    renewals_enabled: bool,
    ctx: &mut TxContext,
) {
    assert_admin(service, cap, ctx);
    assert_terms(price, duration_ms);
    assert!(service.plans.contains(key), EPlanNotFound);
    let plan = service.plans.borrow_mut(key);
    plan.price = price;
    plan.coin_type = type_name::with_defining_ids<T>();
    plan.duration_ms = duration_ms;
    plan.version = plan.version + 1;
    plan.purchases_enabled = purchases_enabled;
    plan.renewals_enabled = renewals_enabled;
    event::emit(PlanUpdated { plan: *plan });
}

public fun purchase<T>(
    service: &mut Service,
    registry: &mut PaymentRegistry,
    plan_key: String,
    expected_service_version: u64,
    expected_plan_version: u64,
    quote_deadline_ms: u64,
    nonce: String,
    payment: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let plan = *service.plan(plan_key);
    assert_checkout<T>(
        service,
        registry,
        &plan,
        expected_service_version,
        expected_plan_version,
        quote_deadline_ms,
        clock,
    );
    assert!(plan.purchases_enabled, EPlanUnavailable);
    let key = EntitlementKey { holder: ctx.sender(), plan_key };
    assert!(!derived_object::exists(&service.id, key), EAlreadyEntitled);
    let now = clock.timestamp_ms();
    let expires_at = extend_expiry(now, plan.duration_ms);
    let id = derived_object::claim(&mut service.id, key);
    let entitlement_id = id.to_inner();
    assert!(!is_revoked(service, entitlement_id), ERevoked);
    payment_kit::process_registry_payment<T>(
        registry,
        nonce,
        plan.price,
        payment,
        option::some(service.payment_recipient),
        clock,
        ctx,
    );
    let entitlement = Entitlement {
        id,
        service_id: object::id(service),
        plan_key,
        holder: ctx.sender(),
        issued_at: now,
        expires_at,
        revision: 0,
        plan_version: plan.version,
    };
    event::emit(EntitlementCreated {
        entitlement_id,
        service_id: entitlement.service_id,
        plan_key,
        holder: entitlement.holder,
        issued_at: now,
        expires_at,
        plan_version: plan.version,
        nonce,
    });
    transfer::transfer(entitlement, ctx.sender());
}

public fun renew<T>(
    service: &Service,
    registry: &mut PaymentRegistry,
    entitlement: &mut Entitlement,
    expected_revision: u64,
    expected_service_version: u64,
    expected_plan_version: u64,
    quote_deadline_ms: u64,
    nonce: String,
    payment: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(entitlement.service_id == object::id(service), EWrongService);
    assert!(entitlement.holder == ctx.sender(), ENotHolder);
    assert!(entitlement.revision == expected_revision, EStaleEntitlement);
    assert!(!is_revoked(service, object::id(entitlement)), ERevoked);
    let plan = service.plan(entitlement.plan_key);
    assert_checkout<T>(
        service,
        registry,
        plan,
        expected_service_version,
        expected_plan_version,
        quote_deadline_ms,
        clock,
    );
    assert!(plan.renewals_enabled, EPlanUnavailable);
    let previous_expires_at = entitlement.expires_at;
    let expires_at = extend_expiry(previous_expires_at.max(clock.timestamp_ms()), plan.duration_ms);
    payment_kit::process_registry_payment<T>(
        registry,
        nonce,
        plan.price,
        payment,
        option::some(service.payment_recipient),
        clock,
        ctx,
    );
    entitlement.expires_at = expires_at;
    entitlement.revision = entitlement.revision + 1;
    entitlement.plan_version = plan.version;
    event::emit(EntitlementRenewed {
        entitlement_id: object::id(entitlement),
        service_id: entitlement.service_id,
        plan_key: entitlement.plan_key,
        holder: entitlement.holder,
        previous_expires_at,
        expires_at,
        revision: entitlement.revision,
        plan_version: plan.version,
        nonce,
    });
}

public fun revoke(
    service: &mut Service,
    cap: &ServiceAdminCap,
    holder: address,
    plan_key: String,
    ctx: &mut TxContext,
) {
    assert_admin(service, cap, ctx);
    let key = EntitlementKey { holder, plan_key };
    assert!(derived_object::exists(&service.id, key), EEntitlementNotFound);
    let entitlement_id = entitlement_id(service, holder, plan_key);
    assert!(!is_revoked(service, entitlement_id), ERevoked);
    service.revocations.add(entitlement_id, true);
    event::emit(EntitlementRevoked {
        entitlement_id,
        service_id: object::id(service),
        holder,
        plan_key,
    });
}

public fun entitlement_id(service: &Service, holder: address, plan_key: String): ID {
    derived_object::derive_address(object::id(service), EntitlementKey { holder, plan_key }).to_id()
}

public fun is_revoked(service: &Service, entitlement_id: ID): bool {
    service.revocations.contains(entitlement_id)
}

public fun is_active(service: &Service, entitlement: &Entitlement, clock: &Clock): bool {
    entitlement.service_id == object::id(service)
        && clock.timestamp_ms() >= entitlement.issued_at
        && clock.timestamp_ms() < entitlement.expires_at
        && !is_revoked(service, object::id(entitlement))
}

public fun owner(service: &Service): address { service.owner }

public fun payment_recipient(service: &Service): address { service.payment_recipient }

public fun registry_id(service: &Service): ID { service.registry_id }

public fun service_version(service: &Service): u64 { service.version }

public fun plan(service: &Service, key: String): &Plan {
    assert!(service.plans.contains(key), EPlanNotFound);
    service.plans.borrow(key)
}

public fun plan_service_id(plan: &Plan): ID { plan.service_id }

public fun plan_key(plan: &Plan): String { plan.key }

public fun price(plan: &Plan): u64 { plan.price }

public fun coin_type(plan: &Plan): TypeName { plan.coin_type }

public fun duration_ms(plan: &Plan): u64 { plan.duration_ms }

public fun plan_version(plan: &Plan): u64 { plan.version }

public fun purchases_enabled(plan: &Plan): bool { plan.purchases_enabled }

public fun renewals_enabled(plan: &Plan): bool { plan.renewals_enabled }

public fun service_id(entitlement: &Entitlement): ID { entitlement.service_id }

public fun entitlement_plan_key(entitlement: &Entitlement): String { entitlement.plan_key }

public fun holder(entitlement: &Entitlement): address { entitlement.holder }

public fun issued_at(entitlement: &Entitlement): u64 { entitlement.issued_at }

public fun expires_at(entitlement: &Entitlement): u64 { entitlement.expires_at }

public fun revision(entitlement: &Entitlement): u64 { entitlement.revision }

public fun entitlement_plan_version(entitlement: &Entitlement): u64 { entitlement.plan_version }

fun assert_admin(service: &Service, cap: &ServiceAdminCap, ctx: &TxContext) {
    assert!(
        cap.service_id == object::id(service) && object::id(cap) == service.admin_cap_id,
        ENotAuthorized,
    );
    assert!(ctx.sender() == service.owner, ENotAuthorized);
}

fun assert_terms(price: u64, duration_ms: u64) {
    assert!(price > 0, EInvalidPrice);
    assert!(duration_ms > 0, EInvalidDuration);
}

fun assert_checkout<T>(
    service: &Service,
    registry: &PaymentRegistry,
    plan: &Plan,
    expected_service_version: u64,
    expected_plan_version: u64,
    quote_deadline_ms: u64,
    clock: &Clock,
) {
    assert!(object::id(registry) == service.registry_id, EWrongRegistry);
    assert!(service.version == expected_service_version, EStaleService);
    assert!(plan.service_id == object::id(service), EWrongService);
    assert!(plan.version == expected_plan_version, EStalePlan);
    assert!(plan.coin_type == type_name::with_defining_ids<T>(), EWrongCoinType);
    assert!(clock.timestamp_ms() <= quote_deadline_ms, EQuoteExpired);
}

fun extend_expiry(base: u64, duration_ms: u64): u64 {
    assert!(base <= U64_MAX - duration_ms, EExpiryOverflow);
    base + duration_ms
}

fun emit_service_updated(service: &Service) {
    event::emit(ServiceUpdated {
        service_id: object::id(service),
        owner: service.owner,
        payment_recipient: service.payment_recipient,
        version: service.version,
    });
}
