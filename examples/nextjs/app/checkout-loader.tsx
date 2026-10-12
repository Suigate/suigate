"use client";
import dynamic from "next/dynamic";
const Checkout = dynamic(() => import("./checkout-client"), {
  ssr: false,
  loading: () => <p>Loading wallet checkout…</p>,
});
export function CheckoutLoader() {
  return <Checkout />;
}
