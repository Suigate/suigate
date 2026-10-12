import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RISK_NOTICE, SOFTWARE_RISK } from "@suigate/core/risk";

const root = new URL("../../../", import.meta.url);
const core = new URL("../../", import.meta.url);

test("risk provenance is immutable, unaudited, and explicit about funds/keys and hallucinations", () => {
  assert.equal(SOFTWARE_RISK.aiGeneratedPercentage, 100);
  assert.equal(SOFTWARE_RISK.humanAuditStatus, "not-audited");
  assert.equal(SOFTWARE_RISK.humanAuditReport, null);
  assert.equal(SOFTWARE_RISK.auditedRevision, null);
  assert.equal(SOFTWARE_RISK.recommendedUse, "testnet-only");
  assert.equal(Object.isFrozen(SOFTWARE_RISK), true);
  for (const text of [
    "100% AI-generated",
    "hallucinated",
    "loss of funds",
    "private keys",
    "AS IS",
    "applicable law",
    "not a human audit",
  ])
    assert.ok(RISK_NOTICE.includes(text), text);
});

test("install warning is usable before compilation, emits only a notice, and never claims an audit", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("scripts/install-warning.mjs", core))],
    { encoding: "utf8", env: { ...process.env, SUIGATE_AUDITED: "true" } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(RISK_NOTICE));
  assert.ok(result.stderr.includes("hidden or disabled"));
  assert.equal(SOFTWARE_RISK.humanAuditStatus, "not-audited");
});

test("every publishable package carries risk flags and complete packaged notices", async () => {
  const packages = new URL("../", core);
  const license = await readFile(new URL("../LICENSE.md", packages), "utf8");
  assert.ok(license.includes("Permission is hereby granted, free of charge"));
  for (const name of ["core", "react", "express", "nextjs", "cli"]) {
    const manifest = JSON.parse(
      await readFile(new URL(`${name}/package.json`, packages), "utf8"),
    );
    assert.equal(manifest.suigateRisk.aiGenerated, true);
    assert.equal(manifest.suigateRisk.humanAuditStatus, "not-audited");
    assert.ok(manifest.files.includes("NOTICE.md"));
    assert.equal(manifest.license, "MIT");
    assert.ok(manifest.files.includes("LICENSE.md"));
    const packagedLicense = await readFile(
      new URL(`${name}/LICENSE.md`, packages),
      "utf8",
    );
    assert.ok(
      packagedLicense.endsWith(license),
      `${name} must preserve the root license text`,
    );
    const notice = await readFile(
      new URL(`${name}/NOTICE.md`, packages),
      "utf8",
    );
    const readme = await readFile(
      new URL(`${name}/README.md`, packages),
      "utf8",
    );
    assert.ok(notice.includes("100% AI-generated"));
    assert.ok(notice.includes("ASSUME NO RESPONSIBILITY"));
    assert.ok(notice.includes("hallucinated code"));
    assert.ok(readme.includes(RISK_NOTICE));
  }
});

test("project documentation carries warnings and an evidence-based human audit retirement process", async () => {
  const repository = new URL("../", root);
  const disclaimer = await readFile(
    new URL("DISCLAIMER.md", repository),
    "utf8",
  );
  assert.ok(disclaimer.includes("auditedRevision"));
  assert.ok(disclaimer.includes("Retain accurate AI-generation provenance"));
  for (const name of await readdir(new URL("docs/", repository))) {
    if (!name.endsWith(".md")) continue;
    const text = await readFile(new URL(`docs/${name}`, repository), "utf8");
    assert.ok(text.includes("100% AI-generated"), name);
    assert.ok(text.includes("DISCLAIMER.md"), name);
  }
});
