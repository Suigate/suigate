#[test_only]
module suigate::subscriptions_tests;

use payment_kit::payment_kit::{Self, Namespace, PaymentRegistry};
use sui::{clock::{Self, Clock}, coin::{Self, Coin}, sui::SUI, test_scenario::{Self, Scenario}};
use suigate::subscriptions::{Self, Entitlement, Service, ServiceAdminCap};

const OWNER: address = @0xA;
const BUYER: address = @0xB;
const OTHER: address = @0xC;
const RECIPIENT: address = @0xD;
const PRICE: u64 = 1_000;
const DURATION: u64 = 10_000;
const NOW: u64 = 1_000;
const DEADLINE: u64 = 1_000_000;

public struct OTHER_COIN has drop {}

fun setup(): Scenario {
    let mut scenario = test_scenario::begin(OWNER);
    payment_kit::init_for_testing(scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    clock.set_for_testing(NOW);
    clock.share_for_testing();
    scenario.next_tx(OWNER);
    let mut namespace = scenario.take_shared<Namespace>();
    subscriptions::create_service(
        &mut namespace,
        b"suigate-tests".to_ascii_string(),
        scenario.ctx(),
    );
    test_scenario::return_shared(namespace);
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::create_plan<SUI>(
        &mut service,
        &cap,
        b"pro".to_ascii_string(),
        PRICE,
        DURATION,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
    scenario
}

fun purchase(scenario: &mut Scenario, nonce: vector<u8>) {
    checkout<SUI>(scenario, b"pro", PRICE, 0, 0, DEADLINE, nonce);
}

fun checkout<T>(
    scenario: &mut Scenario,
    key: vector<u8>,
    amount: u64,
    service_version: u64,
    plan_version: u64,
    deadline: u64,
    nonce: vector<u8>,
) {
    let mut service = scenario.take_shared<Service>();
    let mut registry = scenario.take_shared_by_id<PaymentRegistry>(service.registry_id());
    let clock = scenario.take_shared<Clock>();
    let coin = coin::mint_for_testing<T>(amount, scenario.ctx());
    subscriptions::purchase<T>(
        &mut service,
        &mut registry,
        key.to_ascii_string(),
        service_version,
        plan_version,
        deadline,
        nonce.to_ascii_string(),
        coin,
        &clock,
        scenario.ctx(),
    );
    test_scenario::return_shared(clock);
    test_scenario::return_shared(registry);
    test_scenario::return_shared(service);
}

fun renew(scenario: &mut Scenario, revision: u64, nonce: vector<u8>) {
    renew_with<SUI>(scenario, revision, 0, 0, PRICE, DEADLINE, nonce);
}

fun renew_with<T>(
    scenario: &mut Scenario,
    revision: u64,
    service_version: u64,
    plan_version: u64,
    amount: u64,
    deadline: u64,
    nonce: vector<u8>,
) {
    let service = scenario.take_shared<Service>();
    let mut registry = scenario.take_shared_by_id<PaymentRegistry>(service.registry_id());
    let mut entitlement = scenario.take_from_sender<Entitlement>();
    let clock = scenario.take_shared<Clock>();
    let coin = coin::mint_for_testing<T>(amount, scenario.ctx());
    subscriptions::renew<T>(
        &service,
        &mut registry,
        &mut entitlement,
        revision,
        service_version,
        plan_version,
        deadline,
        nonce.to_ascii_string(),
        coin,
        &clock,
        scenario.ctx(),
    );
    scenario.return_to_sender(entitlement);
    test_scenario::return_shared(clock);
    test_scenario::return_shared(registry);
    test_scenario::return_shared(service);
}

fun set_time(scenario: &mut Scenario, timestamp: u64) {
    let mut clock = scenario.take_shared<Clock>();
    clock.set_for_testing(timestamp);
    test_scenario::return_shared(clock);
    scenario.next_tx(BUYER);
}

fun update_plan<T>(
    scenario: &mut Scenario,
    price: u64,
    duration: u64,
    purchases: bool,
    renewals: bool,
) {
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::update_plan<T>(
        &mut service,
        &cap,
        b"pro".to_ascii_string(),
        price,
        duration,
        purchases,
        renewals,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
}

fun set_recipient(scenario: &mut Scenario, recipient: address) {
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::set_payment_recipient(&mut service, &cap, recipient, scenario.ctx());
    scenario.return_to_sender(cap);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
}

fun revoke(scenario: &mut Scenario) {
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::revoke(&mut service, &cap, BUYER, b"pro".to_ascii_string(), scenario.ctx());
    scenario.return_to_sender(cap);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
}

#[test]
fun service_and_plan_creation() {
    let mut scenario = setup();
    let service = scenario.take_shared<Service>();
    let plan = service.plan(b"pro".to_ascii_string());
    assert!(service.owner() == OWNER);
    assert!(service.payment_recipient() == OWNER);
    assert!(service.service_version() == 0);
    assert!(plan.plan_service_id() == object::id(&service));
    assert!(plan.plan_key() == b"pro".to_ascii_string());
    assert!(plan.price() == PRICE);
    assert!(plan.duration_ms() == DURATION);
    assert!(plan.plan_version() == 0);
    assert!(plan.coin_type() == std::type_name::with_defining_ids<SUI>());
    assert!(plan.purchases_enabled() && plan.renewals_enabled());
    assert!(!scenario.has_most_recent_for_sender<ServiceAdminCap>());
    test_scenario::return_shared(service);
    scenario.end();
}

#[test]
fun purchase_creates_owned_entitlement_and_pays_owner() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    let effects = scenario.next_tx(BUYER);
    assert!(effects.num_user_events() == 2);
    let service = scenario.take_shared<Service>();
    let entitlement = scenario.take_from_sender<Entitlement>();
    let clock = scenario.take_shared<Clock>();
    assert!(entitlement.service_id() == object::id(&service));
    assert!(entitlement.entitlement_plan_key() == b"pro".to_ascii_string());
    assert!(entitlement.holder() == BUYER);
    assert!(entitlement.issued_at() == NOW);
    assert!(entitlement.expires_at() == NOW + DURATION);
    assert!(entitlement.revision() == 0);
    assert!(
        object::id(&entitlement) == subscriptions::entitlement_id(
        &service, BUYER, b"pro".to_ascii_string(),
    ),
    );
    assert!(subscriptions::is_active(&service, &entitlement, &clock));
    scenario.return_to_sender(entitlement);
    test_scenario::return_shared(clock);
    test_scenario::return_shared(service);
    scenario.next_tx(OWNER);
    assert!(!scenario.has_most_recent_for_sender<Entitlement>());
    let payment = scenario.take_from_sender<Coin<SUI>>();
    assert!(payment.value() == PRICE);
    scenario.return_to_sender(payment);
    scenario.end();
}

#[test]
fun early_renewal_preserves_remaining_time_and_object_id() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    let entitlement = scenario.take_from_sender<Entitlement>();
    let id = object::id(&entitlement);
    scenario.return_to_sender(entitlement);
    scenario.next_tx(BUYER);
    renew(&mut scenario, 0, b"renew-1");
    let effects = scenario.next_tx(BUYER);
    assert!(effects.num_user_events() == 2);
    let entitlement = scenario.take_from_sender<Entitlement>();
    assert!(object::id(&entitlement) == id);
    assert!(entitlement.expires_at() == NOW + 2 * DURATION);
    assert!(entitlement.issued_at() == NOW);
    assert!(entitlement.revision() == 1);
    scenario.return_to_sender(entitlement);
    scenario.end();
}

#[test]
fun owner_can_update_plan_terms_and_coin() {
    let mut scenario = setup();
    update_plan<OTHER_COIN>(&mut scenario, 2 * PRICE, 2 * DURATION, true, false);
    let service = scenario.take_shared<Service>();
    let plan = service.plan(b"pro".to_ascii_string());
    assert!(plan.plan_key() == b"pro".to_ascii_string());
    assert!(plan.price() == 2 * PRICE);
    assert!(plan.duration_ms() == 2 * DURATION);
    assert!(plan.plan_version() == 1);
    assert!(plan.coin_type() == std::type_name::with_defining_ids<OTHER_COIN>());
    assert!(plan.purchases_enabled() && !plan.renewals_enabled());
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
    checkout<OTHER_COIN>(&mut scenario, b"pro", 2 * PRICE, 0, 1, DEADLINE, b"updated");
    scenario.next_tx(BUYER);
    let entitlement = scenario.take_from_sender<Entitlement>();
    assert!(entitlement.expires_at() == NOW + 2 * DURATION);
    assert!(entitlement.entitlement_plan_version() == 1);
    scenario.return_to_sender(entitlement);
    scenario.next_tx(OWNER);
    let payment = scenario.take_from_sender<Coin<OTHER_COIN>>();
    assert!(payment.value() == 2 * PRICE);
    scenario.return_to_sender(payment);
    scenario.end();
}

#[test]
fun configured_recipient_receives_payment_directly() {
    let mut scenario = setup();
    set_recipient(&mut scenario, RECIPIENT);
    checkout<SUI>(&mut scenario, b"pro", PRICE, 1, 0, DEADLINE, b"recipient");
    scenario.next_tx(OWNER);
    assert!(!scenario.has_most_recent_for_sender<Coin<SUI>>());
    scenario.next_tx(RECIPIENT);
    let payment = scenario.take_from_sender<Coin<SUI>>();
    assert!(payment.value() == PRICE);
    scenario.return_to_sender(payment);
    scenario.end();
}

#[test]
fun service_transfer_moves_capability_and_preserves_recipient() {
    let mut scenario = setup();
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::transfer_service(&mut service, cap, OTHER, scenario.ctx());
    assert!(service.owner() == OTHER);
    assert!(service.payment_recipient() == OWNER);
    assert!(service.service_version() == 1);
    test_scenario::return_shared(service);
    scenario.next_tx(OWNER);
    assert!(!scenario.has_most_recent_for_sender<ServiceAdminCap>());
    scenario.next_tx(OTHER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::set_payment_recipient(&mut service, &cap, OTHER, scenario.ctx());
    assert!(service.payment_recipient() == OTHER);
    assert!(service.service_version() == 2);
    scenario.return_to_sender(cap);
    test_scenario::return_shared(service);
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = suigate::subscriptions)]
fun non_owner_cannot_change_recipient_even_with_cap_reference() {
    let mut scenario = setup();
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_address<ServiceAdminCap>(OWNER);
    subscriptions::set_payment_recipient(&mut service, &cap, BUYER, scenario.ctx());
    abort 1000
}

#[test, expected_failure(abort_code = 0, location = suigate::subscriptions)]
fun non_owner_cannot_create_plan() {
    let mut scenario = setup();
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_address<ServiceAdminCap>(OWNER);
    subscriptions::create_plan<SUI>(
        &mut service,
        &cap,
        b"free".to_ascii_string(),
        1,
        DURATION,
        scenario.ctx(),
    );
    abort 1000
}

#[test, expected_failure(abort_code = 0, location = suigate::subscriptions)]
fun non_owner_cannot_update_plan() {
    let mut scenario = setup();
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_address<ServiceAdminCap>(OWNER);
    subscriptions::update_plan<SUI>(
        &mut service,
        &cap,
        b"pro".to_ascii_string(),
        1,
        DURATION,
        true,
        true,
        scenario.ctx(),
    );
    abort 1000
}

#[test, expected_failure(abort_code = 0, location = suigate::subscriptions)]
fun non_owner_cannot_transfer_service() {
    let mut scenario = setup();
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_address<ServiceAdminCap>(OWNER);
    subscriptions::transfer_service(&mut service, cap, BUYER, scenario.ctx());
    abort 1000
}

#[test, expected_failure(abort_code = 0, location = suigate::subscriptions)]
fun capability_from_another_service_is_rejected() {
    let mut scenario = setup();
    let service = scenario.take_shared<Service>();
    let original_id = object::id(&service);
    test_scenario::return_shared(service);
    scenario.next_tx(OWNER);
    let mut namespace = scenario.take_shared<Namespace>();
    subscriptions::create_service(
        &mut namespace,
        b"other-service".to_ascii_string(),
        scenario.ctx(),
    );
    test_scenario::return_shared(namespace);
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared_by_id<Service>(original_id);
    let wrong_cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::set_payment_recipient(&mut service, &wrong_cap, OTHER, scenario.ctx());
    abort 1000
}

#[test, expected_failure(abort_code = 18, location = suigate::subscriptions)]
fun zero_recipient_is_rejected() {
    let mut scenario = setup();
    set_recipient(&mut scenario, @0x0);
    abort 1000
}

#[test, expected_failure(abort_code = 18, location = suigate::subscriptions)]
fun registry_cannot_become_recipient() {
    let mut scenario = setup();
    let service = scenario.take_shared<Service>();
    let registry_address = service.registry_id().to_address();
    test_scenario::return_shared(service);
    set_recipient(&mut scenario, registry_address);
    abort 1000
}

fun create_another_plan(scenario: &mut Scenario, key: vector<u8>, price: u64, duration: u64) {
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::create_plan<SUI>(
        &mut service,
        &cap,
        key.to_ascii_string(),
        price,
        duration,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
}

#[test, expected_failure(abort_code = 3, location = suigate::subscriptions)]
fun empty_plan_key_is_rejected() {
    let mut scenario = setup();
    create_another_plan(&mut scenario, b"", PRICE, DURATION);
    abort 1000
}

#[test, expected_failure(abort_code = 3, location = suigate::subscriptions)]
fun oversized_plan_key_is_rejected() {
    let mut scenario = setup();
    create_another_plan(
        &mut scenario,
        b"abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklm",
        PRICE,
        DURATION,
    );
    abort 1000
}

#[test, expected_failure(abort_code = 4, location = suigate::subscriptions)]
fun stable_plan_key_cannot_be_recreated() {
    let mut scenario = setup();
    create_another_plan(&mut scenario, b"pro", PRICE, DURATION);
    abort 1000
}

#[test, expected_failure(abort_code = 6, location = suigate::subscriptions)]
fun zero_price_is_rejected() {
    let mut scenario = setup();
    create_another_plan(&mut scenario, b"zero", 0, DURATION);
    abort 1000
}

#[test, expected_failure(abort_code = 7, location = suigate::subscriptions)]
fun zero_duration_is_rejected() {
    let mut scenario = setup();
    create_another_plan(&mut scenario, b"zero", PRICE, 0);
    abort 1000
}

#[test, expected_failure(abort_code = 6, location = suigate::subscriptions)]
fun update_cannot_set_zero_price() {
    let mut scenario = setup();
    update_plan<SUI>(&mut scenario, 0, DURATION, true, true);
    abort 1000
}

#[test, expected_failure(abort_code = 7, location = suigate::subscriptions)]
fun update_cannot_set_zero_duration() {
    let mut scenario = setup();
    update_plan<SUI>(&mut scenario, PRICE, 0, true, true);
    abort 1000
}

#[test, expected_failure(abort_code = 5, location = suigate::subscriptions)]
fun missing_plan_is_rejected() {
    let mut scenario = setup();
    checkout<SUI>(&mut scenario, b"missing", PRICE, 0, 0, DEADLINE, b"missing");
    abort 1000
}

#[test, expected_failure(abort_code = 8, location = suigate::subscriptions)]
fun purchase_rejects_wrong_coin() {
    let mut scenario = setup();
    checkout<OTHER_COIN>(&mut scenario, b"pro", PRICE, 0, 0, DEADLINE, b"wrong-coin");
    abort 1000
}

#[test, expected_failure(abort_code = payment_kit::EIncorrectAmount)]
fun purchase_rejects_insufficient_amount() {
    let mut scenario = setup();
    checkout<SUI>(&mut scenario, b"pro", PRICE - 1, 0, 0, DEADLINE, b"underpaid");
    abort 1000
}

#[test, expected_failure(abort_code = payment_kit::EIncorrectAmount)]
fun purchase_rejects_overpayment() {
    let mut scenario = setup();
    checkout<SUI>(&mut scenario, b"pro", PRICE + 1, 0, 0, DEADLINE, b"overpaid");
    abort 1000
}

#[test, expected_failure(abort_code = payment_kit::EIncorrectAmount)]
fun purchase_rejects_zero_payment() {
    let mut scenario = setup();
    checkout<SUI>(&mut scenario, b"pro", 0, 0, 0, DEADLINE, b"unpaid");
    abort 1000
}

#[test, expected_failure(abort_code = payment_kit::EInvalidNonce)]
fun purchase_rejects_empty_nonce() {
    let mut scenario = setup();
    purchase(&mut scenario, b"");
    abort 1000
}

#[test, expected_failure(abort_code = payment_kit::EInvalidNonce)]
fun purchase_rejects_oversized_nonce() {
    let mut scenario = setup();
    purchase(&mut scenario, b"1234567890123456789012345678901234567");
    abort 1000
}

#[test, expected_failure(abort_code = 9, location = suigate::subscriptions)]
fun recipient_change_invalidates_old_quote() {
    let mut scenario = setup();
    set_recipient(&mut scenario, RECIPIENT);
    purchase(&mut scenario, b"stale-service");
    abort 1000
}

#[test, expected_failure(abort_code = 10, location = suigate::subscriptions)]
fun plan_change_invalidates_old_quote() {
    let mut scenario = setup();
    update_plan<SUI>(&mut scenario, PRICE, DURATION, true, true);
    purchase(&mut scenario, b"stale-plan");
    abort 1000
}

#[test, expected_failure(abort_code = 11, location = suigate::subscriptions)]
fun expired_quote_is_rejected() {
    let mut scenario = setup();
    checkout<SUI>(&mut scenario, b"pro", PRICE, 0, 0, NOW - 1, b"expired-quote");
    abort 1000
}

#[test, expected_failure(abort_code = 16, location = suigate::subscriptions)]
fun disabled_plan_rejects_new_purchase() {
    let mut scenario = setup();
    update_plan<SUI>(&mut scenario, PRICE, DURATION, false, true);
    checkout<SUI>(&mut scenario, b"pro", PRICE, 0, 1, DEADLINE, b"disabled");
    abort 1000
}

#[test, expected_failure(abort_code = 17, location = suigate::subscriptions)]
fun purchase_expiry_overflow_is_rejected() {
    let mut scenario = setup();
    update_plan<SUI>(&mut scenario, PRICE, 18_446_744_073_709_551_615, true, true);
    checkout<SUI>(&mut scenario, b"pro", PRICE, 0, 1, DEADLINE, b"overflow");
    abort 1000
}

#[test, expected_failure(abort_code = 12, location = suigate::subscriptions)]
fun second_purchase_cannot_mint_another_entitlement() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    purchase(&mut scenario, b"purchase-2");
    abort 1000
}

#[test, expected_failure(abort_code = payment_kit::EPaymentAlreadyExists)]
fun duplicate_payment_aborts_purchase_after_payment_kit_transfer_path() {
    let mut scenario = setup();
    purchase(&mut scenario, b"same-payment");
    scenario.next_tx(OTHER);
    purchase(&mut scenario, b"same-payment");
    abort 1000
}

#[test, expected_failure(abort_code = 2, location = suigate::subscriptions)]
fun purchase_rejects_unrelated_registry() {
    let mut scenario = setup();
    let mut service = scenario.take_shared<Service>();
    let mut namespace = scenario.take_shared<Namespace>();
    let (mut registry, _cap) = payment_kit::create_registry(
        &mut namespace,
        b"unrelated-registry".to_ascii_string(),
        scenario.ctx(),
    );
    let clock = scenario.take_shared<Clock>();
    let coin = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    subscriptions::purchase<SUI>(
        &mut service,
        &mut registry,
        b"pro".to_ascii_string(),
        0,
        0,
        DEADLINE,
        b"wrong-registry".to_ascii_string(),
        coin,
        &clock,
        scenario.ctx(),
    );
    abort 1000
}

#[test, expected_failure(abort_code = 3, location = sui::test_scenario)]
fun other_wallet_cannot_take_entitlement_as_owned_input() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(OTHER);
    let _entitlement = scenario.take_from_sender<Entitlement>();
    abort 1000
}

#[test]
fun expiration_is_exclusive_at_boundary() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    let service = scenario.take_shared<Service>();
    let entitlement = scenario.take_from_sender<Entitlement>();
    let mut clock = scenario.take_shared<Clock>();
    clock.set_for_testing(NOW + DURATION - 1);
    assert!(subscriptions::is_active(&service, &entitlement, &clock));
    clock.set_for_testing(NOW + DURATION);
    assert!(!subscriptions::is_active(&service, &entitlement, &clock));
    clock.set_for_testing(NOW + DURATION + 1);
    assert!(!subscriptions::is_active(&service, &entitlement, &clock));
    scenario.return_to_sender(entitlement);
    test_scenario::return_shared(clock);
    test_scenario::return_shared(service);
    scenario.end();
}

#[test]
fun expired_renewal_starts_from_current_time() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    set_time(&mut scenario, NOW + DURATION + 5_000);
    renew(&mut scenario, 0, b"renew-1");
    scenario.next_tx(BUYER);
    let service = scenario.take_shared<Service>();
    let entitlement = scenario.take_from_sender<Entitlement>();
    let clock = scenario.take_shared<Clock>();
    assert!(entitlement.expires_at() == NOW + 2 * DURATION + 5_000);
    assert!(entitlement.issued_at() == NOW);
    assert!(subscriptions::is_active(&service, &entitlement, &clock));
    scenario.return_to_sender(entitlement);
    test_scenario::return_shared(clock);
    test_scenario::return_shared(service);
    scenario.end();
}

#[test]
fun renewal_uses_updated_terms_without_retroactively_changing_access() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    update_plan<OTHER_COIN>(&mut scenario, 2 * PRICE, 2 * DURATION, false, true);
    let service = scenario.take_shared<Service>();
    let entitlement = scenario.take_from_sender<Entitlement>();
    let clock = scenario.take_shared<Clock>();
    assert!(entitlement.expires_at() == NOW + DURATION);
    assert!(subscriptions::is_active(&service, &entitlement, &clock));
    assert!(entitlement.entitlement_plan_version() == 0);
    scenario.return_to_sender(entitlement);
    test_scenario::return_shared(clock);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
    renew_with<OTHER_COIN>(&mut scenario, 0, 0, 1, 2 * PRICE, DEADLINE, b"renew-updated");
    scenario.next_tx(BUYER);
    let entitlement = scenario.take_from_sender<Entitlement>();
    assert!(entitlement.expires_at() == NOW + 3 * DURATION);
    assert!(entitlement.entitlement_plan_version() == 1);
    scenario.return_to_sender(entitlement);
    scenario.end();
}

#[test, expected_failure(abort_code = 14, location = suigate::subscriptions)]
fun renewal_rejects_stale_entitlement_revision() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    renew(&mut scenario, 0, b"renew-1");
    scenario.next_tx(BUYER);
    renew(&mut scenario, 0, b"renew-2");
    abort 1000
}

#[test, expected_failure(abort_code = payment_kit::EPaymentAlreadyExists)]
fun renewal_cannot_reuse_purchase_payment_nonce() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    renew(&mut scenario, 0, b"purchase-1");
    abort 1000
}

#[test, expected_failure(abort_code = payment_kit::EIncorrectAmount)]
fun renewal_rejects_insufficient_amount() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    renew_with<SUI>(&mut scenario, 0, 0, 0, PRICE - 1, DEADLINE, b"underpaid-renewal");
    abort 1000
}

#[test, expected_failure(abort_code = 8, location = suigate::subscriptions)]
fun renewal_rejects_wrong_coin() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    renew_with<OTHER_COIN>(&mut scenario, 0, 0, 0, PRICE, DEADLINE, b"wrong-coin-renewal");
    abort 1000
}

#[test, expected_failure(abort_code = 13, location = suigate::subscriptions)]
fun renewal_rejects_wrong_holder_even_with_object_reference() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(OTHER);
    let service = scenario.take_shared<Service>();
    let mut registry = scenario.take_shared_by_id<PaymentRegistry>(service.registry_id());
    let mut entitlement = scenario.take_from_address<Entitlement>(BUYER);
    let clock = scenario.take_shared<Clock>();
    let coin = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    subscriptions::renew<SUI>(
        &service,
        &mut registry,
        &mut entitlement,
        0,
        0,
        0,
        DEADLINE,
        b"unauthorized".to_ascii_string(),
        coin,
        &clock,
        scenario.ctx(),
    );
    abort 1000
}

#[test, expected_failure(abort_code = 1, location = suigate::subscriptions)]
fun renewal_rejects_entitlement_from_another_service() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(OWNER);
    let mut namespace = scenario.take_shared<Namespace>();
    subscriptions::create_service(
        &mut namespace,
        b"other-service".to_ascii_string(),
        scenario.ctx(),
    );
    test_scenario::return_shared(namespace);
    scenario.next_tx(BUYER);
    let service = scenario.take_shared<Service>();
    let mut registry = scenario.take_shared_by_id<PaymentRegistry>(service.registry_id());
    let mut entitlement = scenario.take_from_sender<Entitlement>();
    let clock = scenario.take_shared<Clock>();
    assert!(!subscriptions::is_active(&service, &entitlement, &clock));
    let coin = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
    subscriptions::renew<SUI>(
        &service,
        &mut registry,
        &mut entitlement,
        0,
        0,
        0,
        DEADLINE,
        b"wrong-service".to_ascii_string(),
        coin,
        &clock,
        scenario.ctx(),
    );
    abort 1000
}

#[test, expected_failure(abort_code = 16, location = suigate::subscriptions)]
fun disabled_renewal_is_rejected() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    update_plan<SUI>(&mut scenario, PRICE, DURATION, true, false);
    renew_with<SUI>(&mut scenario, 0, 0, 1, PRICE, DEADLINE, b"disabled-renewal");
    abort 1000
}

#[test]
fun owner_revokes_without_customer_owned_object() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    revoke(&mut scenario);
    let service = scenario.take_shared<Service>();
    let entitlement = scenario.take_from_sender<Entitlement>();
    let clock = scenario.take_shared<Clock>();
    assert!(service.is_revoked(object::id(&entitlement)));
    assert!(!subscriptions::is_active(&service, &entitlement, &clock));
    assert!(entitlement.holder() == BUYER);
    assert!(entitlement.expires_at() == NOW + DURATION);
    scenario.return_to_sender(entitlement);
    test_scenario::return_shared(clock);
    test_scenario::return_shared(service);
    scenario.end();
}

#[test, expected_failure(abort_code = 15, location = suigate::subscriptions)]
fun revoked_entitlement_cannot_be_renewed() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    revoke(&mut scenario);
    renew(&mut scenario, 0, b"revoked-renewal");
    abort 1000
}

#[test, expected_failure(abort_code = 0, location = suigate::subscriptions)]
fun non_owner_cannot_revoke() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(OTHER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_address<ServiceAdminCap>(OWNER);
    subscriptions::revoke(&mut service, &cap, BUYER, b"pro".to_ascii_string(), scenario.ctx());
    abort 1000
}

#[test, expected_failure(abort_code = 12, location = suigate::subscriptions)]
fun record_cleanup_does_not_allow_duplicate_issuance() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    let context = scenario.ctx_builder().set_epoch(31);
    scenario.next_with_context(context);
    let service = scenario.take_shared<Service>();
    let mut registry = scenario.take_shared_by_id<PaymentRegistry>(service.registry_id());
    registry.delete_payment_record<SUI>(
        payment_kit::create_payment_key<SUI>(b"purchase-1".to_ascii_string(), PRICE, OWNER),
        scenario.ctx(),
    );
    test_scenario::return_shared(registry);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
    purchase(&mut scenario, b"purchase-1");
    abort 1000
}

#[test]
fun multiple_plans_have_independent_entitlements() {
    let mut scenario = setup();
    create_another_plan(&mut scenario, b"team", 2 * PRICE, 2 * DURATION);
    purchase(&mut scenario, b"pro-purchase");
    scenario.next_tx(BUYER);
    checkout<SUI>(&mut scenario, b"team", 2 * PRICE, 0, 0, DEADLINE, b"team-purchase");
    scenario.next_tx(BUYER);
    let service = scenario.take_shared<Service>();
    let pro_id = subscriptions::entitlement_id(&service, BUYER, b"pro".to_ascii_string());
    let team_id = subscriptions::entitlement_id(&service, BUYER, b"team".to_ascii_string());
    assert!(pro_id != team_id);
    let pro = scenario.take_from_sender_by_id<Entitlement>(pro_id);
    let team = scenario.take_from_sender_by_id<Entitlement>(team_id);
    assert!(pro.expires_at() == NOW + DURATION);
    assert!(team.expires_at() == NOW + 2 * DURATION);
    scenario.return_to_sender(pro);
    scenario.return_to_sender(team);
    test_scenario::return_shared(service);
    scenario.end();
}

#[test, expected_failure(abort_code = 18, location = suigate::subscriptions)]
fun service_cannot_custody_its_own_payment() {
    let mut scenario = setup();
    let service = scenario.take_shared<Service>();
    let address = object::id_address(&service);
    test_scenario::return_shared(service);
    set_recipient(&mut scenario, address);
    abort 1000
}

#[test, expected_failure(abort_code = 19, location = suigate::subscriptions)]
fun unissued_entitlement_cannot_be_revoked() {
    let mut scenario = setup();
    revoke(&mut scenario);
    abort 1000
}

#[test, expected_failure(abort_code = 15, location = suigate::subscriptions)]
fun revocation_cannot_be_repeated() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    revoke(&mut scenario);
    revoke(&mut scenario);
    abort 1000
}

#[test, expected_failure(abort_code = 14, location = suigate::subscriptions)]
fun record_cleanup_does_not_allow_replaying_old_renewal() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    renew(&mut scenario, 0, b"renew-1");
    let context = scenario.ctx_builder().set_epoch(31);
    scenario.next_with_context(context);
    let service = scenario.take_shared<Service>();
    let mut registry = scenario.take_shared_by_id<PaymentRegistry>(service.registry_id());
    registry.delete_payment_record<SUI>(
        payment_kit::create_payment_key<SUI>(b"renew-1".to_ascii_string(), PRICE, OWNER),
        scenario.ctx(),
    );
    test_scenario::return_shared(registry);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
    renew(&mut scenario, 0, b"renew-1");
    abort 1000
}

#[test, expected_failure(abort_code = 10, location = suigate::subscriptions)]
fun renewal_rejects_stale_plan_quote() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    update_plan<SUI>(&mut scenario, PRICE, DURATION, true, true);
    renew(&mut scenario, 0, b"stale-renewal");
    abort 1000
}

#[test, expected_failure(abort_code = 11, location = suigate::subscriptions)]
fun renewal_rejects_expired_quote() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    renew_with<SUI>(&mut scenario, 0, 0, 0, PRICE, NOW - 1, b"expired-renewal");
    abort 1000
}

#[test, expected_failure(abort_code = 17, location = suigate::subscriptions)]
fun renewal_expiry_overflow_is_rejected() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    update_plan<SUI>(&mut scenario, PRICE, 18_446_744_073_709_551_615, true, true);
    renew_with<SUI>(&mut scenario, 0, 0, 1, PRICE, DEADLINE, b"overflow-renewal");
    abort 1000
}

#[test]
fun renewal_at_expiration_boundary() {
    let mut scenario = setup();
    purchase(&mut scenario, b"purchase-1");
    scenario.next_tx(BUYER);
    set_time(&mut scenario, NOW + DURATION);
    renew(&mut scenario, 0, b"renew-1");
    scenario.next_tx(BUYER);
    let entitlement = scenario.take_from_sender<Entitlement>();
    assert!(entitlement.expires_at() == NOW + 2 * DURATION);
    scenario.return_to_sender(entitlement);
    scenario.end();
}

#[test]
fun lifecycle_emits_typed_events_without_extra_payment_events() {
    use suigate::subscriptions::{
        EntitlementCreated,
        EntitlementRenewed,
        EntitlementRevoked,
        PlanCreated,
        PlanUpdated,
        ServiceCreated,
        ServiceUpdated,
    };
    use sui::bcs;
    use sui::event::events_by_type;
    let mut scenario = test_scenario::begin(OWNER);
    payment_kit::init_for_testing(scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    clock.set_for_testing(NOW);
    clock.share_for_testing();
    scenario.next_tx(OWNER);
    let mut namespace = scenario.take_shared<Namespace>();
    subscriptions::create_service(&mut namespace, b"event-tests".to_ascii_string(), scenario.ctx());
    let created = events_by_type<ServiceCreated>();
    assert!(created.length() == 1);
    let mut payload = bcs::new(bcs::to_bytes(&created[0]));
    let service_address = payload.peel_address();
    assert!(payload.peel_address() == OWNER);
    assert!(payload.peel_address() == OWNER);
    let registry_address = payload.peel_address();
    let cap_address = payload.peel_address();
    assert!(payload.into_remainder_bytes().is_empty());
    test_scenario::return_shared(namespace);
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    assert!(object::id_address(&service) == service_address);
    assert!(service.registry_id().to_address() == registry_address);
    assert!(object::id_address(&cap) == cap_address);
    subscriptions::create_plan<SUI>(
        &mut service,
        &cap,
        b"pro".to_ascii_string(),
        PRICE,
        DURATION,
        scenario.ctx(),
    );
    let plan_events = events_by_type<PlanCreated>();
    assert!(plan_events.length() == 1);
    assert!(
        bcs::to_bytes(&plan_events[0]) == bcs::to_bytes(service.plan(b"pro".to_ascii_string())),
    );
    scenario.return_to_sender(cap);
    test_scenario::return_shared(service);
    scenario.next_tx(BUYER);
    purchase(&mut scenario, b"purchase-1");
    let created = events_by_type<EntitlementCreated>();
    assert!(created.length() == 1);
    let mut payload = bcs::new(bcs::to_bytes(&created[0]));
    let entitlement_address = payload.peel_address();
    assert!(payload.peel_address() == service_address);
    assert!(payload.peel_vec_u8() == b"pro");
    assert!(payload.peel_address() == BUYER);
    assert!(payload.peel_u64() == NOW);
    assert!(payload.peel_u64() == NOW + DURATION);
    assert!(payload.peel_u64() == 0);
    assert!(payload.peel_vec_u8() == b"purchase-1");
    assert!(payload.into_remainder_bytes().is_empty());
    assert!(events_by_type<payment_kit::PaymentReceipt>().length() == 1);
    scenario.next_tx(BUYER);
    renew(&mut scenario, 0, b"renew-1");
    let renewed = events_by_type<EntitlementRenewed>();
    assert!(renewed.length() == 1);
    let mut payload = bcs::new(bcs::to_bytes(&renewed[0]));
    assert!(payload.peel_address() == entitlement_address);
    assert!(payload.peel_address() == service_address);
    assert!(payload.peel_vec_u8() == b"pro");
    assert!(payload.peel_address() == BUYER);
    assert!(payload.peel_u64() == NOW + DURATION);
    assert!(payload.peel_u64() == NOW + 2 * DURATION);
    assert!(payload.peel_u64() == 1);
    assert!(payload.peel_u64() == 0);
    assert!(payload.peel_vec_u8() == b"renew-1");
    assert!(payload.into_remainder_bytes().is_empty());
    assert!(events_by_type<payment_kit::PaymentReceipt>().length() == 1);
    scenario.next_tx(OWNER);
    let mut service = scenario.take_shared<Service>();
    let cap = scenario.take_from_sender<ServiceAdminCap>();
    subscriptions::revoke(&mut service, &cap, BUYER, b"pro".to_ascii_string(), scenario.ctx());
    let revoked = events_by_type<EntitlementRevoked>();
    assert!(revoked.length() == 1);
    let mut payload = bcs::new(bcs::to_bytes(&revoked[0]));
    assert!(payload.peel_address() == entitlement_address);
    assert!(payload.peel_address() == service_address);
    assert!(payload.peel_address() == BUYER);
    assert!(payload.peel_vec_u8() == b"pro");
    assert!(payload.into_remainder_bytes().is_empty());
    subscriptions::update_plan<SUI>(
        &mut service,
        &cap,
        b"pro".to_ascii_string(),
        PRICE,
        DURATION,
        false,
        false,
        scenario.ctx(),
    );
    let updated = events_by_type<PlanUpdated>();
    assert!(updated.length() == 1);
    assert!(bcs::to_bytes(&updated[0]) == bcs::to_bytes(service.plan(b"pro".to_ascii_string())));
    subscriptions::set_payment_recipient(&mut service, &cap, RECIPIENT, scenario.ctx());
    let updated = events_by_type<ServiceUpdated>();
    assert!(updated.length() == 1);
    let mut payload = bcs::new(bcs::to_bytes(&updated[0]));
    assert!(payload.peel_address() == service_address);
    assert!(payload.peel_address() == OWNER);
    assert!(payload.peel_address() == RECIPIENT);
    assert!(payload.peel_u64() == 1);
    assert!(payload.into_remainder_bytes().is_empty());
    assert!(events_by_type<payment_kit::PaymentReceipt>().is_empty());
    scenario.return_to_sender(cap);
    test_scenario::return_shared(service);
    scenario.end();
}
