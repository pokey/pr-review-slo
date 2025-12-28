import { test, expect } from "bun:test";
import { DEFAULT_CONFIG, saveDefaultConfig, getPaths } from "./config";

test("default config template matches DEFAULT_CONFIG", async () => {
  const username = "testuser";
  const tempDir = await Bun.$`mktemp -d`.text();
  const p = getPaths(tempDir.trim());

  await saveDefaultConfig(username, p);

  const content = await Bun.file(p.config).text();
  const parsed = Bun.TOML.parse(content);

  const expected = {
    ...DEFAULT_CONFIG,
    github: { ...DEFAULT_CONFIG.github, username },
  };

  expect(parsed).toEqual(expected);
});
