import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseMetadata } from "./custom-release.mjs";

const version = "1.10.0-jack.1";
const setup = `CodexPlusPlus-${version}-windows-x64-setup.exe`;
const zip = `CodexPlusPlus-${version}-windows-x64.zip`;
const input = () => ({ repository: "JackWenStack/CodexPlusPlus", version,
  files: new Map([[setup, Buffer.from("installer")], [zip, Buffer.from("portable")]]), body: "Custom release" });
test("metadata points only to the custom release and includes both Windows packages", () => {
  const { manifest, checksums } = releaseMetadata(input());
  assert.equal(manifest.version, `v${version}`);
  assert.equal(manifest.url, `https://github.com/JackWenStack/CodexPlusPlus/releases/tag/v${version}`);
  assert.equal(manifest.assets.length, 2);
  for (const asset of manifest.assets) assert.ok(asset.url.startsWith(`${manifest.url.replace("/tag/", "/download/")}/`));
  assert.match(checksums, new RegExp(`[a-f0-9]{64}  ${setup.replaceAll(".", "\\.")}`));
});
test("incomplete or empty packages cannot produce update metadata", () => {
  const missing = input(); missing.files.delete(zip);
  assert.throws(() => releaseMetadata(missing), /Missing or empty/);
  const empty = input(); empty.files.set(setup, Buffer.alloc(0));
  assert.throws(() => releaseMetadata(empty), /Missing or empty/);
});
test("upstream versions and invalid repository URLs are rejected", () => {
  assert.throws(() => releaseMetadata({ ...input(), version: "1.10.0" }), /custom version/);
  assert.throws(() => releaseMetadata({ ...input(), repository: "../elsewhere" }), /Invalid repository/);
});
