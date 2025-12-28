import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./types";

const DATA_DIR = join(homedir(), ".pr-review-slo");

export const paths = {
  dataDir: DATA_DIR,
  config: join(DATA_DIR, "config.toml"),
  budgetRuns: join(DATA_DIR, "budget-runs.jsonl"),
  pto: join(DATA_DIR, "pto.jsonl"),
  holidayCache: (year: number) => join(DATA_DIR, `holidays-${year}.json`),
};

const DEFAULT_CONFIG: Config = {
  github: {
    username: "",
    repos: undefined,
  },
  businessHours: {
    start: 9,
    end: 19,
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

export async function ensureDataDir(): Promise<void> {
  const dir = Bun.file(paths.dataDir);
  if (!(await dir.exists())) {
    await Bun.write(paths.dataDir + "/.keep", "");
  }
}

export async function loadConfig(): Promise<Config> {
  await ensureDataDir();

  const configFile = Bun.file(paths.config);
  if (!(await configFile.exists())) {
    return DEFAULT_CONFIG;
  }

  const tomlContent = await configFile.text();
  const parsed = parseTOML(tomlContent);

  return mergeConfig(DEFAULT_CONFIG, parsed);
}

function parseTOML(content: string): Partial<Config> {
  const result: Record<string, unknown> = {};
  let currentSection: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Section header
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      const parts = currentSection.split(".");
      let obj = result;
      for (const part of parts) {
        obj[part] = obj[part] || {};
        obj = obj[part] as Record<string, unknown>;
      }
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^([^=]+)=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1]!.trim();
      let value: unknown = kvMatch[2]!.trim();

      // Parse value type
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (/^-?\d+(\.\d+)?$/.test(value as string))
        value = parseFloat(value as string);
      else if ((value as string).startsWith('"'))
        value = (value as string).slice(1, -1);
      else if ((value as string).startsWith("[")) {
        // Simple array parsing
        const arrayContent = (value as string).slice(1, -1);
        value = arrayContent
          .split(",")
          .map((v) => v.trim().replace(/^"|"$/g, ""))
          .filter((v) => v);
      }

      if (currentSection) {
        const parts = currentSection.split(".");
        let obj = result;
        for (const part of parts) {
          obj = obj[part] as Record<string, unknown>;
        }
        obj[key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  return result as Partial<Config>;
}

function mergeConfig(defaults: Config, overrides: Partial<Config>): Config {
  return {
    github: { ...defaults.github, ...overrides.github },
    businessHours: { ...defaults.businessHours, ...overrides.businessHours },
    businessDays: overrides.businessDays || defaults.businessDays,
    holidayCountryCode:
      overrides.holidayCountryCode || defaults.holidayCountryCode,
    slo: { ...defaults.slo, ...overrides.slo },
    sizeBuckets: {
      small: { ...defaults.sizeBuckets.small, ...overrides.sizeBuckets?.small },
      medium: {
        ...defaults.sizeBuckets.medium,
        ...overrides.sizeBuckets?.medium,
      },
    },
  };
}

export async function saveDefaultConfig(username: string): Promise<void> {
  await ensureDataDir();

  const content = `# PR Review SLO Configuration

[github]
username = "${username}"
# repos = ["org/repo", "org2/*"]  # Optional: filter to specific repos

[businessHours]
start = 9
end = 19
timezone = "America/Los_Angeles"

# Business days: 1=Mon, 7=Sun
businessDays = [1, 2, 3, 4, 5]

holidayCountryCode = "US"

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

  await Bun.write(paths.config, content);
}
