import {
  access,
  readFile,
  writeFile,
  mkdir,
  rename,
  readdir,
} from "node:fs/promises";
import { dirname, join, resolve, parse } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SUI_NETWORKS, type SuiNetwork } from "@suigate/core";
import {
  isValidStructTag,
  normalizeStructTag,
  normalizeSuiAddress,
} from "@mysten/sui/utils";

export class CliError extends Error {}
export interface ConfigPlan {
  key: string;
  price: string;
  coinType: string;
  durationMs: string;
}
export interface ProjectConfig {
  version: 1;
  network: SuiNetwork;
  registryName: string;
  packageId?: string;
  typeOrigin?: string;
  gasBudgetMist: string;
  plans: ConfigPlan[];
  project: { packageManager: string; frameworks: string[] };
}
export interface DeploymentState {
  version: 1;
  network: SuiNetwork;
  chainIdentifier: string;
  owner: string;
  registryName: string;
  packageId?: string;
  typeOrigin?: string;
  serviceId?: string;
  adminCapId?: string;
  sourceDigest?: string;
  appliedPlans?: string[];
  pending?: {
    action: "publish" | "service" | "plans";
    digest: string;
    digestSource?: "signed-transaction";
    planKeys?: string[];
  };
  transactions: { action: string; digest: string; previousDigest?: string }[];
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function id(value: unknown, name = "object ID"): string {
  if (typeof value !== "string" || !/^(0x)?[a-fA-F0-9]{1,64}$/.test(value))
    throw new CliError(`Invalid ${name}`);
  return normalizeSuiAddress(value);
}

function amount(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9]+$/.test(value) ||
    BigInt(value) <= 0n ||
    BigInt(value) > (1n << 64n) - 1n
  )
    throw new CliError(`${name} must be a positive u64 decimal string`);
  return BigInt(value).toString();
}

export function validateConfig(value: unknown): ProjectConfig {
  if (!value || typeof value !== "object")
    throw new CliError("Invalid suigate configuration");
  const config = value as ProjectConfig;
  if (
    config.version !== 1 ||
    !(config.network === "testnet" || config.network === "mainnet")
  )
    throw new CliError(
      "Configuration requires version 1 and network testnet or mainnet",
    );
  if (
    typeof config.registryName !== "string" ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.registryName)
  )
    throw new CliError("Invalid Payment Kit registry name");
  if (
    !Array.isArray(config.plans) ||
    !config.plans.length ||
    config.plans.length > 50
  )
    throw new CliError("Configure between 1 and 50 plans");
  const keys = new Set<string>();
  const plans = config.plans.map((plan) => {
    if (
      !plan ||
      typeof plan.key !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(plan.key) ||
      keys.has(plan.key)
    )
      throw new CliError(
        "Plan keys must be unique ASCII letters, digits, hyphens, or underscores (1–64 characters)",
      );
    keys.add(plan.key);
    if (
      typeof plan.coinType !== "string" ||
      !isValidStructTag(plan.coinType) ||
      plan.coinType.includes("@")
    )
      throw new CliError("Plans require explicit Move coin types");
    return {
      key: plan.key,
      price: amount(plan.price, "Plan price"),
      coinType: normalizeStructTag(plan.coinType),
      durationMs: amount(plan.durationMs, "Plan durationMs"),
    };
  });
  return {
    version: 1,
    network: config.network,
    registryName: config.registryName,
    gasBudgetMist: amount(config.gasBudgetMist, "gasBudgetMist"),
    plans,
    ...(config.packageId
      ? { packageId: id(config.packageId, "package ID") }
      : {}),
    ...(config.typeOrigin
      ? { typeOrigin: id(config.typeOrigin, "type origin") }
      : {}),
    project: config.project ?? { packageManager: "npm", frameworks: [] },
  };
}

export async function readConfig(path: string): Promise<ProjectConfig> {
  if (!(await exists(path)))
    throw new CliError(
      "Run suigate init first, or pass --config with an existing suigate.config.json",
    );
  return validateConfig(JSON.parse(await readFile(path, "utf8")));
}

export async function detectProject(directory: string) {
  const manifests: Record<string, unknown>[] = [];
  let packageManager: string | undefined;
  const manifestPath = join(directory, "package.json");
  if (await exists(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifests.push(manifest);
    if (
      typeof manifest.packageManager === "string" &&
      /^(npm|pnpm|yarn|bun)@/.test(manifest.packageManager)
    )
      packageManager = manifest.packageManager.split("@")[0];
    const workspaces = Array.isArray(manifest.workspaces)
      ? manifest.workspaces
      : [];
    for (const workspace of workspaces) {
      if (
        typeof workspace !== "string" ||
        workspace.startsWith(".") ||
        workspace.startsWith("/") ||
        workspace.includes("..")
      )
        continue;
      const paths =
        workspace.endsWith("/*") &&
        (await exists(join(directory, workspace.slice(0, -2))))
          ? (await readdir(join(directory, workspace.slice(0, -2)))).map(
              (name) => join(workspace.slice(0, -2), name),
            )
          : [workspace];
      for (const path of paths) {
        const file = join(directory, path, "package.json");
        if (await exists(file))
          manifests.push(JSON.parse(await readFile(file, "utf8")));
      }
    }
  }
  const frameworks = new Set<string>();
  for (const manifest of manifests) {
    const dependencies = {
      ...(manifest.dependencies as object),
      ...(manifest.devDependencies as object),
    } as Record<string, unknown>;
    if (dependencies.next) frameworks.add("nextjs");
    if (dependencies.express) frameworks.add("express");
    if (dependencies.react && !dependencies.next) frameworks.add("react");
  }
  if (
    (await exists(join(directory, "Move.toml"))) ||
    (await exists(join(directory, "move/suigate/Move.toml")))
  )
    frameworks.add("move");
  let current = resolve(directory);
  while (!packageManager) {
    for (const [name, files] of [
      ["pnpm", ["pnpm-lock.yaml"]],
      ["yarn", ["yarn.lock"]],
      ["bun", ["bun.lock", "bun.lockb"]],
      ["npm", ["package-lock.json"]],
    ] as const) {
      if (
        (
          await Promise.all(files.map((file) => exists(join(current, file))))
        ).some(Boolean)
      ) {
        packageManager = name;
        break;
      }
    }
    if (current === parse(current).root) break;
    current = dirname(current);
  }
  return {
    packageManager: packageManager ?? "npm",
    frameworks: [...frameworks].sort(),
  };
}

export async function initialize(
  path: string,
  network: SuiNetwork,
  packageId?: string,
): Promise<ProjectConfig> {
  const project = await detectProject(dirname(path));
  const config = validateConfig({
    version: 1,
    network,
    registryName: `sg-${randomUUID()}`,
    gasBudgetMist: "200000000",
    ...(packageId ? { packageId } : {}),
    project,
    plans: [
      {
        key: "pro",
        price: "1000000000",
        coinType: "0x2::sui::SUI",
        durationMs: "2592000000",
      },
    ],
  });
  try {
    await writeFile(path, JSON.stringify(config, null, 2) + "\n", {
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CliError(
        "suigate configuration already exists; it was not overwritten",
      );
    throw error;
  }
  return config;
}

export function statePath(configPath: string, network: SuiNetwork): string {
  return join(
    dirname(configPath),
    ".suigate",
    "deployments",
    `${network}.json`,
  );
}

export async function readState(
  path: string,
  config: ProjectConfig,
): Promise<DeploymentState | null> {
  if (!(await exists(path))) return null;
  const state = JSON.parse(await readFile(path, "utf8")) as DeploymentState;
  if (
    state.version !== 1 ||
    state.network !== config.network ||
    state.chainIdentifier !== SUI_NETWORKS[config.network].chainIdentifier ||
    state.registryName !== config.registryName
  )
    throw new CliError("Deployment state does not match this project/network");
  id(state.owner, "deployment owner");
  for (const key of [
    "packageId",
    "typeOrigin",
    "serviceId",
    "adminCapId",
  ] as const)
    if (state[key]) id(state[key]);
  if (!Array.isArray(state.transactions))
    throw new CliError("Invalid deployment transaction history");
  if (
    state.pending &&
    (!["publish", "service", "plans"].includes(state.pending.action) ||
      typeof state.pending.digest !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(state.pending.digest))
  )
    throw new CliError("Invalid pending transaction");
  return state;
}

export async function saveState(
  path: string,
  state: DeploymentState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function sourceDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for (const file of [
    "Move.toml",
    "Move.lock",
    ...(await readdir(join(path, "sources")))
      .filter((name) => name.endsWith(".move"))
      .sort()
      .map((name) => `sources/${name}`),
  ]) {
    hash.update(file);
    hash.update(await readFile(join(path, file)));
  }
  return hash.digest("hex");
}
