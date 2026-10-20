import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function releaseMetadata({ repository, version, files, body = "" }) {
  if (!/^[\w-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  if (!/^\d+\.\d+\.\d+-jack\.\d+$/.test(version)) throw new Error("Expected a jack.N custom version");
  const names = [`CodexPlusPlus-${version}-windows-x64-setup.exe`, `CodexPlusPlus-${version}-windows-x64.zip`];
  const hashes = names.map((name) => {
    const bytes = files.get(name);
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error(`Missing or empty release asset: ${name}`);
    return `${createHash("sha256").update(bytes).digest("hex")}  ${name}`;
  });
  const tag = `v${version}`;
  const base = `https://github.com/${repository}/releases`;
  return {
    manifest: { version: tag, url: `${base}/tag/${tag}`, body,
      assets: names.map(name => ({ name, url: `${base}/download/${tag}/${encodeURIComponent(name)}` })) },
    checksums: hashes.join("\n") + "\n",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const directory = path.resolve(root, process.argv[2] || "dist/windows");
  const relative = path.relative(root, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Output must stay inside the repository");
  const pkg = JSON.parse(readFileSync(path.join(root, "apps/codex-plus-manager/package.json"), "utf8"));
  const tauri = JSON.parse(readFileSync(path.join(root, "apps/codex-plus-manager/src-tauri/tauri.conf.json"), "utf8"));
  const cargo = readFileSync(path.join(root, "Cargo.toml"), "utf8");
  const cargoVersion = cargo.match(/\[workspace\.package\][\s\S]*?^version = "([^"]+)"/m)?.[1];
  if (pkg.version !== tauri.version || pkg.version !== cargoVersion) throw new Error("Package versions disagree");
  const repository = "JackWenStack/CodexPlusPlus";
  const names = [`CodexPlusPlus-${pkg.version}-windows-x64-setup.exe`, `CodexPlusPlus-${pkg.version}-windows-x64.zip`];
  const body = readFileSync(path.join(root, "docs/custom-releases", `v${pkg.version}.md`), "utf8");
  const output = releaseMetadata({ repository, version: pkg.version, body,
    files: new Map(names.map(name => [name, readFileSync(path.join(directory, name))])) });
  writeFileSync(path.join(directory, "latest.json"), JSON.stringify(output.manifest, null, 2) + "\n");
  writeFileSync(path.join(directory, "SHA256SUMS.txt"), output.checksums);
  console.log(`Prepared ${output.manifest.version} for ${repository}`);
}
