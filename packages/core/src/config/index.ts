import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

export interface CAIConfig {
  // Indexing
  indexing: {
    autoIndex: boolean;
    indexOnSessionEnd: boolean;
  };

  // Summarization
  summarization: {
    autoSummarize: boolean;
    model: string;
    minConfidence: number;
  };

  // Sync
  sync: {
    autoSync: boolean;
    triggers: ('on_review_complete' | 'on_clean' | 'on_commit' | 'schedule')[];
    schedule?: string; // cron format
    options: {
      minConfidence: number;
      reviewedOnly: boolean;
      includeGlobal: boolean;
    };
  };

  // Search
  search: {
    defaultLimit: number;
    includeSessionSummaries: boolean;
  };

  // MCP
  mcp: {
    enableSessionSearch: boolean;
    defaultScope: 'project' | 'global' | 'all';
  };
}

const DEFAULT_CONFIG: CAIConfig = {
  indexing: {
    autoIndex: false,
    indexOnSessionEnd: true,
  },
  summarization: {
    autoSummarize: true,
    model: 'claude-sonnet-4-20250514',
    minConfidence: 0.7,
  },
  sync: {
    autoSync: false,
    triggers: ['on_review_complete'],
    options: {
      minConfidence: 0.7,
      reviewedOnly: false,
      includeGlobal: true,
    },
  },
  search: {
    defaultLimit: 10,
    includeSessionSummaries: true,
  },
  mcp: {
    enableSessionSearch: true,
    defaultScope: 'all',
  },
};

export class ConfigManager {
  private configPath: string;
  private config: CAIConfig;

  constructor() {
    const dataDir = path.join(os.homedir(), '.code-agent-insights');
    this.configPath = path.join(dataDir, 'config.yaml');
    this.config = this.loadConfig();
  }

  private loadConfig(): CAIConfig {
    if (!fs.existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const userConfig = yaml.parse(content);
      return this.mergeConfig(DEFAULT_CONFIG, userConfig);
    } catch (error) {
      console.error('Error loading config:', error);
      return { ...DEFAULT_CONFIG };
    }
  }

  private mergeConfig(defaults: CAIConfig, user: Partial<CAIConfig>): CAIConfig {
    return {
      indexing: { ...defaults.indexing, ...user.indexing },
      summarization: { ...defaults.summarization, ...user.summarization },
      sync: {
        ...defaults.sync,
        ...user.sync,
        options: { ...defaults.sync.options, ...user.sync?.options },
      },
      search: { ...defaults.search, ...user.search },
      mcp: { ...defaults.mcp, ...user.mcp },
    };
  }

  get(): CAIConfig {
    return this.config;
  }

  set(updates: Partial<CAIConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
    this.save();
  }

  save(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = yaml.stringify(this.config);
    fs.writeFileSync(this.configPath, content);
  }

  getPath(): string {
    return this.configPath;
  }

  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.save();
  }
}

// Singleton export
let configManager: ConfigManager | null = null;

export function getConfig(): CAIConfig {
  if (!configManager) {
    configManager = new ConfigManager();
  }
  return configManager.get();
}

export function getConfigManager(): ConfigManager {
  if (!configManager) {
    configManager = new ConfigManager();
  }
  return configManager;
}
