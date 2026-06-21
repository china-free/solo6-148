import { NetworkProfile, CLIOptions, SignalHandler } from './types';
import { BackendManager } from './backends';
import { getProfile, listProfiles, formatBandwidth } from './profiles';
import { getProcessInfo, getProcessPorts } from './process';
import { sleep } from './utils';

export class NetworkController {
  private backendManager: BackendManager;
  private activeProfile: NetworkProfile | null = null;
  private activePid: number | null = null;
  private signalHandler: SignalHandler | null = null;

  constructor() {
    this.backendManager = new BackendManager();
  }

  async init(): Promise<void> {
    await this.backendManager.init();
  }

  getPlatform(): string {
    return this.backendManager.getPlatformDescription();
  }

  async checkRoot(): Promise<boolean> {
    return this.backendManager.checkRoot();
  }

  listAvailableProfiles(): Array<{
    name: string;
    description: string;
    download: string;
    upload: string;
    latency: string;
    loss: string;
  }> {
    return listProfiles().map((p) => ({
      name: p.name,
      description: p.description,
      download: formatBandwidth(p.bandwidth.download),
      upload: formatBandwidth(p.bandwidth.upload),
      latency: `${p.latency}ms`,
      loss: `${p.packetLoss}%`,
    }));
  }

  async getProfileInfo(name: string): Promise<NetworkProfile | undefined> {
    return getProfile(name);
  }

  buildCustomProfile(options: CLIOptions): NetworkProfile {
    const base = getProfile('Custom')!;
    return {
      ...base,
      bandwidth: {
        download: options.download ? options.download * 1024 * 1024 : base.bandwidth.download,
        upload: options.upload ? options.upload * 1024 * 1024 : base.bandwidth.upload,
      },
      latency: options.latency ?? base.latency,
      jitter: options.jitter ?? base.jitter,
      packetLoss: options.loss ?? base.packetLoss,
    };
  }

  async applyProfile(pid: number, profileName: string, options?: CLIOptions): Promise<void> {
    let profile: NetworkProfile | undefined;

    if (profileName === 'Custom' && options) {
      profile = this.buildCustomProfile(options);
    } else {
      profile = getProfile(profileName);
      if (!profile) {
        throw new Error(`Profile '${profileName}' not found. Use --list to see available profiles.`);
      }

      if (options) {
        profile = { ...profile };
        if (options.download !== undefined) {
          profile.bandwidth.download = options.download * 1024 * 1024;
        }
        if (options.upload !== undefined) {
          profile.bandwidth.upload = options.upload * 1024 * 1024;
        }
        if (options.latency !== undefined) {
          profile.latency = options.latency;
        }
        if (options.jitter !== undefined) {
          profile.jitter = options.jitter;
        }
        if (options.loss !== undefined) {
          profile.packetLoss = options.loss;
        }
      }
    }

    const processInfo = await getProcessInfo(pid);
    if (!processInfo) {
      throw new Error(`Process ${pid} does not exist.`);
    }

    this.activePid = pid;
    this.activeProfile = profile;

    await this.backendManager.apply(pid, profile);
  }

  async getProcessStatus(pid: number): Promise<{
    pid: number;
    name: string;
    ports: number[];
    tcpPorts: number[];
    udpPorts: number[];
    user: string;
    cmdline: string;
  } | null> {
    const info = await getProcessInfo(pid);
    if (!info) return null;

    const ports = await getProcessPorts(pid);

    return {
      pid: info.pid,
      name: info.name,
      ports: info.ports,
      tcpPorts: ports.tcp,
      udpPorts: ports.udp,
      user: info.user,
      cmdline: info.cmdline,
    };
  }

  async runWithDuration(pid: number, profileName: string, duration: number, options?: CLIOptions): Promise<void> {
    await this.applyProfile(pid, profileName, options);
    await sleep(duration * 1000);
    await this.cleanup();
  }

  setSignalHandler(handler: SignalHandler): void {
    this.signalHandler = handler;
  }

  async handleSignal(): Promise<void> {
    if (this.signalHandler) {
      await this.signalHandler();
    }
    await this.cleanup();
  }

  async cleanup(): Promise<void> {
    try {
      await this.backendManager.cleanup();
    } finally {
      this.activeProfile = null;
      this.activePid = null;
    }
  }

  getActiveConfig(): {
    pid: number | null;
    profile: NetworkProfile | null;
  } {
    return {
      pid: this.activePid,
      profile: this.activeProfile,
    };
  }

  formatProfileSummary(profile: NetworkProfile): string {
    return [
      `  Profile:      ${profile.name}`,
      `  Description:  ${profile.description}`,
      `  Bandwidth:    ↓ ${formatBandwidth(profile.bandwidth.download)} / ↑ ${formatBandwidth(profile.bandwidth.upload)}`,
      `  Latency:      ${profile.latency}ms (±${profile.jitter}ms)`,
      `  Packet Loss:  ${profile.packetLoss}%`,
      profile.packetCorruption ? `  Corruption:   ${profile.packetCorruption}%` : null,
      profile.packetReordering ? `  Reordering:   ${profile.packetReordering}%` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }
}
