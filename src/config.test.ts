import { test, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, saveDefaultConfig, paths } from "./config";

let originalDataDir: string;
let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("default config template matches DEFAULT_CONFIG", async () => {
  const username = "testuser";

  // Create temp dir and override paths
  tempDir = await mkdtemp(join(tmpdir(), "pr-review-slo-test-"));
  originalDataDir = paths.dataDir;
  (paths as { dataDir: string }).dataDir = tempDir;
  (paths as { config: string }).config = join(tempDir, "config.toml");

  try {
    await saveDefaultConfig(username);

    const content = await Bun.file(paths.config).text();
    const parsed = Bun.TOML.parse(content);

    const expected = {
      ...DEFAULT_CONFIG,
      github: { ...DEFAULT_CONFIG.github, username },
    };

    expect(parsed).toEqual(expected);
  } finally {
    // Restore original paths
    (paths as { dataDir: string }).dataDir = originalDataDir;
    (paths as { config: string }).config = join(originalDataDir, "config.toml");
  }
});
