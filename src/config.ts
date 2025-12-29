import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./types";

const DEFAULT_DATA_DIR = join(homedir(), ".pr-review-slo");

export function getPaths(dataDir: string = DEFAULT_DATA_DIR) {
  return {
    dataDir,
    config: join(dataDir, "config.toml"),
    budgetRuns: join(dataDir, "budget-runs.jsonl"),
    pto: join(dataDir, "pto.jsonl"),
    holidayCache: (year: number) => join(dataDir, `holidays-${year}.json`),
  };
}

export const paths = getPaths();

const DEFAULT_CONFIG: Config = {
  github: {
    username: "",
    repos: undefined,
  },
  businessHours: {
    start: 9,
    end: 17,
    timezone: "America/Los_Angeles",
  },
  businessDays: [1, 2, 3, 4, 5], // Mon-Fri
  holidayCountryCode: "US",
  slo: {
    target: 0.9,
    windowDays: 30,
  },
  sizeBuckets: {
    small: { maxLoc: 200, businessDays: 1 },
    medium: { maxLoc: 800, businessDays: 3 },
  },
};

export type Paths = ReturnType<typeof getPaths>;

export async function ensureDataDir(p: Paths = paths): Promise<void> {
  await mkdir(p.dataDir, { recursive: true });
  const gitignore = Bun.file(join(p.dataDir, ".gitignore"));
  if (!(await gitignore.exists())) {
    await Bun.write(gitignore, "holidays-*.json\n");
  }
}

export async function loadConfig(p: Paths = paths): Promise<Config> {
  await ensureDataDir(p);

  const configFile = Bun.file(p.config);
  if (!(await configFile.exists())) {
    return DEFAULT_CONFIG;
  }

  const tomlContent = await configFile.text();
  const parsed = Bun.TOML.parse(tomlContent) as Partial<Config>;

  return mergeConfig(DEFAULT_CONFIG, parsed);
}

function mergeConfig(defaults: Config, overrides: Partial<Config>): Config {
  return {
    github: { ...defaults.github, ...overrides.github },
    businessHours: { ...defaults.businessHours, ...overrides.businessHours },
    businessDays: overrides.businessDays || defaults.businessDays,
    holidayCountryCode:
      overrides.holidayCountryCode || defaults.holidayCountryCode,
    slo: { ...defaults.slo, ...overrides.slo },
    sizeBuckets: overrides.sizeBuckets ?? defaults.sizeBuckets,
  };
}

export async function saveDefaultConfig(
  username: string,
  p: Paths = paths
): Promise<void> {
  await ensureDataDir(p);

  const content = `# PR Review SLO Configuration

# Business days: 1=Mon, 7=Sun
businessDays = [1, 2, 3, 4, 5]

holidayCountryCode = "US"  # or "GB-ENG" for subregions

[github]
username = "${username}"
# repos = ["org/repo", "org2/*"]  # Optional: filter to specific repos

[businessHours]
start = 9
end = 17
timezone = "America/Los_Angeles"

[slo]
target = 0.90
windowDays = 30

[sizeBuckets.small]
maxLoc = 200
businessDays = 1

[sizeBuckets.medium]
maxLoc = 800
businessDays = 3
`;

  await Bun.write(p.config, content);
}

/** Exported for testing */
export { DEFAULT_CONFIG };
