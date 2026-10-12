import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const source = fileURLToPath(
  new URL("../../../move/suigate/", import.meta.url),
);
const target = fileURLToPath(new URL("../dist/move/suigate/", import.meta.url));
await rm(target, { recursive: true, force: true });
await mkdir(join(target, "sources"), { recursive: true });
for (const file of ["Move.toml", "Move.lock"])
  await copyFile(join(source, file), join(target, file));
for (const file of await readdir(join(source, "sources"))) {
  if (file.endsWith(".move"))
    await copyFile(
      join(source, "sources", file),
      join(target, "sources", file),
    );
}
