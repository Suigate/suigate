import type { ReactNode } from "react";
import { RISK_NOTICE } from "@suigate/core/risk";
import "../../react/src/style.css";
import { EXAMPLE_DISCOVERY } from "../../shared/discovery";

export const metadata = {
  title: "suigate Next.js testnet example",
  description: "Sui-native checkout and backend entitlement authorization",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="describedby"
          type="application/json"
          href={EXAMPLE_DISCOVERY.path}
        />
      </head>
      <body>
        <aside role="note" aria-label="Example software risk">
          {RISK_NOTICE}
        </aside>
        {children}
      </body>
    </html>
  );
}
