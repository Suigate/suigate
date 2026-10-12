export const SUI_NETWORKS = Object.freeze({
  testnet: Object.freeze({
    rpcUrl: "https://fullnode.testnet.sui.io:443",
    chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
    paymentKitPackageId:
      "0x7e069abe383e80d32f2aec17b3793da82aabc8c2edf84abbf68dd7b719e71497",
    paymentKitNamespaceId:
      "0xa5016862fdccba7cc576b56cc5a391eda6775200aaa03a6b3c97d512312878db",
  }),
  mainnet: Object.freeze({
    rpcUrl: "https://fullnode.mainnet.sui.io:443",
    chainIdentifier: "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
    paymentKitPackageId:
      "0xbc126f1535fba7d641cb9150ad9eae93b104972586ba20f3c60bfe0e53b69bc6",
    paymentKitNamespaceId:
      "0xccd3e4c7802921991cd9ce488c4ca0b51334ba75483702744242284ccf3ae7c2",
  }),
});

export type SuiNetwork = keyof typeof SUI_NETWORKS;
