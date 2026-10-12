import { readFile, writeFile } from "node:fs/promises";
import { RISK_NOTICE } from "../risk.mjs";

const marker =
  "<!-- Generated from DISCLAIMER.md and packages/core/risk.mjs; do not edit directly. -->";
const disclaimer = await readFile(
  new URL("../../../DISCLAIMER.md", import.meta.url),
  "utf8",
);
const license = await readFile(
  new URL("../../../LICENSE.md", import.meta.url),
  "utf8",
);
const licenseMarker =
  "<!-- Generated from root LICENSE.md; do not edit directly. -->";
for (const [folder, name] of [
  ["core", "@suigate/core"],
  ["react", "@suigate/react"],
  ["express", "@suigate/express"],
  ["nextjs", "@suigate/nextjs"],
  ["cli", "suigate"],
]) {
  const files = {
    "LICENSE.md": `${licenseMarker}\n\n${license}`,
    "NOTICE.md": `${marker}\n\n${disclaimer}`,
    "README.md": `${marker}\n\n# ${name}\n\n**100% AI-generated. Experimental. No independent human security audit has passed.**\n\n${RISK_NOTICE}\n\nRead the included [NOTICE.md](NOTICE.md) before installing, deploying, signing, or using this package. It includes the current audit status, liability disclaimer, and human-review requirements. Installation warnings can be hidden or disabled; their absence is not evidence of safety.\n\nLicensed under the [MIT License](LICENSE.md). Third-party dependencies retain their own licenses.\n\nThis package is part of suigate, a Sui-native entitlement project. Consult the project's README and docs for integration instructions. Acknowledging a warning does not make a release audited.\n`,
  };
  for (const [file, content] of Object.entries(files)) {
    const path = new URL(`../../${folder}/${file}`, import.meta.url);
    try {
      const existing = await readFile(path, "utf8");
      if (!existing.startsWith(file === "LICENSE.md" ? licenseMarker : marker))
        throw new Error(
          `Refusing to replace manually maintained ${folder}/${file}`,
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await writeFile(path, content);
  }
}
