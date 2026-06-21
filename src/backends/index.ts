import { Backend, Platform, NetworkProfile } from '../types';
import { LinuxBackend } from './linux';
import { DarwinBackend } from './darwin';
import { getPlatform } from '../utils';

export class BackendManager {
  private backend: Backend | null = null;
  private platform: Platform;

  constructor() {
    this.platform = getPlatform();
  }

  async init(): Promise<Backend> {
    const backend = this.createBackend();
    if (!backend) {
      throw new Error(`Unsupported platform: ${this.platform}`);
    }

    const available = await backend.isAvailable();
    if (!available) {
      throw new Error(
        `Required tools not available for ${this.platform}. ` +
        `Please ensure the necessary network tools are installed.`
      );
    }

    this.backend = backend;
    return backend;
  }

  private createBackend(): Backend | null {
    switch (this.platform) {
      case 'linux':
        return new LinuxBackend();
      case 'darwin':
        return new DarwinBackend();
      case 'win32':
        return null;
      default:
        return null;
    }
  }

  getBackend(): Backend | null {
    return this.backend;
  }

  getPlatform(): Platform {
    return this.platform;
  }

  async apply(pid: number, profile: NetworkProfile): Promise<void> {
    if (!this.backend) {
      throw new Error('Backend not initialized. Call init() first.');
    }
    await this.backend.apply(pid, profile);
  }

  async cleanup(): Promise<void> {
    if (this.backend) {
      await this.backend.cleanup();
    }
  }

  cleanupSync(): void {
    if (this.backend) {
      this.backend.cleanupSync();
    }
  }

  async checkRoot(): Promise<boolean> {
    if (!this.backend) {
      return false;
    }
    return this.backend.checkRoot();
  }

  getPlatformDescription(): string {
    switch (this.platform) {
      case 'linux':
        return 'Linux (using tc + cgroup + iptables)';
      case 'darwin':
        return 'macOS (using pf + dnctl)';
      case 'win32':
        return 'Windows (not yet supported)';
      default:
        return 'Unknown platform';
    }
  }
}

export { LinuxBackend, DarwinBackend };
