import type { DiscoveryOptions } from "@suigate/core";

export const EXAMPLE_DISCOVERY: DiscoveryOptions = Object.freeze({
  path: "/api/.suigate/discovery",
  challengePath: "/api/challenge",
  openApiPath: "/api/.suigate/openapi",
  checkoutPath: "/",
});
