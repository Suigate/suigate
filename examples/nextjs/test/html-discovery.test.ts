import { readFile } from "node:fs/promises";
import { Children, isValidElement, type ReactNode } from "react";
import { expect, it } from "vitest";
import Layout from "../app/layout";
import { EXAMPLE_DISCOVERY } from "../../shared/discovery";

it("places discovery in the server layout head, outside the client-only wallet UI", () => {
  const html = Layout({ children: null });
  const head = Children.toArray(html.props.children).find(
    (node) => isValidElement(node) && node.type === "head",
  );
  if (!isValidElement<{ children: ReactNode }>(head))
    throw new Error("Missing server-rendered head");
  const link = Children.only(head.props.children);
  if (!isValidElement<{ href: string; rel: string; type: string }>(link))
    throw new Error("Missing discovery link");
  expect(link.type).toBe("link");
  expect(link.props).toMatchObject({
    href: EXAMPLE_DISCOVERY.path,
    rel: "describedby",
    type: "application/json",
  });
});

it("renders a risk warning in the server body before any wallet client code loads", () => {
  const html = Layout({ children: null });
  const body = Children.toArray(html.props.children).find(
    (node) => isValidElement(node) && node.type === "body",
  );
  if (!isValidElement<{ children: ReactNode }>(body))
    throw new Error("Missing body");
  const notice = Children.toArray(body.props.children)[0];
  if (!isValidElement<{ children: string }>(notice))
    throw new Error("Missing risk notice");
  expect(notice.props.children).toContain("100% AI-generated");
  expect(notice.props.children).toContain("hallucinated");
  expect(notice.props.children).toContain("applicable law");
});

it("keeps the Vite HTML discovery link synchronized with the server paths", async () => {
  const html = await readFile(
    new URL("../../react/index.html", import.meta.url),
    "utf8",
  );
  expect(html).toContain(`href="${EXAMPLE_DISCOVERY.path}"`);
  expect(html).toContain('rel="describedby"');
  expect(html).toContain("100% AI-generated");
  expect(html).toContain("unaudited");
  expect(html).toContain("DISCLAIMER.md");
});
