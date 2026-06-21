import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { Backend, NetworkProfile, Platform } from '../types';
import {
  runSudoCommand,
  bpsToRate,
  msToTime,
  percentToString,
  generateId,
  commandExists,
  checkRoot,
  getDefaultInterface,
  sleep,
} from '../utils';
import { getProcessPorts, processExists, getChildPids } from '../process';

interface AppliedConfig {
  pipeNumber: number;
  pid: number;
  ports: { tcp: number[]; udp: number[] };
  iface: string;
  pfRulesFile: string;
  originalPfEnabled: boolean;
  originalPfRules: string;
}

export class DarwinBackend implements Backend {
  public readonly platform: Platform = 'darwin';
  private config: AppliedConfig | null = null;
  private static PIPE_START = 1000;
  private static usedPipes: Set<number> = new Set();

  async isAvailable(): Promise<boolean> {
    const [pfctlExists, dnctlExists] = await Promise.all([
      commandExists('pfctl'),
      commandExists('dnctl'),
    ]);
    return pfctlExists && dnctlExists;
  }

  async checkRoot(): Promise<boolean> {
    return checkRoot();
  }

  private getNextPipeNumber(): number {
    let pipe = DarwinBackend.PIPE_START;
    while (DarwinBackend.usedPipes.has(pipe)) {
      pipe++;
    }
    DarwinBackend.usedPipes.add(pipe);
    return pipe;
  }

  private releasePipeNumber(pipe: number): void {
    DarwinBackend.usedPipes.delete(pipe);
  }

  private async isPfEnabled(): Promise<boolean> {
    try {
      const result = await runSudoCommand('pfctl', ['-s', 'info']);
      return result.stdout.includes('Status: Enabled');
    } catch {
      return false;
    }
  }

  private async getPfRules(): Promise<string> {
    try {
      const result = await runSudoCommand('pfctl', ['-s', 'rules']);
      return result.stdout;
    } catch {
      return '';
    }
  }

  private profileToDnctlArgs(profile: NetworkProfile): {
    bandwidth: string;
    delay: string;
    loss: string;
  } {
    const minBandwidth = Math.min(profile.bandwidth.download, profile.bandwidth.upload);
    
    return {
      bandwidth: bpsToRate(minBandwidth),
      delay: profile.latency > 0 ? msToTime(profile.latency) : '0ms',
      loss: percentToString(profile.packetLoss),
    };
  }

  async apply(pid: number, profile: NetworkProfile): Promise<void> {
    if (!await this.checkRoot()) {
      throw new Error('Root privileges required. Please run with sudo.');
    }

    if (!await processExists(pid)) {
      throw new Error(`Process ${pid} does not exist`);
    }

    const iface = await getDefaultInterface();
    const pipeNumber = this.getNextPipeNumber();
    const pfRulesFile = `/tmp/netslim_${generateId()}.pf`;

    const allPids = [pid, ...await getChildPids(pid)];
    const allPorts = await this.getAllPorts(allPids);

    if (allPorts.tcp.length === 0 && allPorts.udp.length === 0) {
      throw new Error(`No network ports found for process ${pid}. The process may not have any active network connections yet.`);
    }

    const args = this.profileToDnctlArgs(profile);

    const originalPfEnabled = await this.isPfEnabled();
    const originalPfRules = await this.getPfRules();

    await this.createDnctlPipe(pipeNumber, args);
    await this.createPfRules(pfRulesFile, pipeNumber, allPorts, iface, profile);
    await this.applyPfRules(pfRulesFile);

    this.config = {
      pipeNumber,
      pid,
      ports: allPorts,
      iface,
      pfRulesFile,
      originalPfEnabled,
      originalPfRules,
    };

    await sleep(100);
  }

  private async getAllPorts(pids: number[]): Promise<{ tcp: number[]; udp: number[] }> {
    const tcp = new Set<number>();
    const udp = new Set<number>();

    for (const pid of pids) {
      const ports = await getProcessPorts(pid);
      ports.tcp.forEach(p => tcp.add(p));
      ports.udp.forEach(p => udp.add(p));
    }

    return {
      tcp: Array.from(tcp),
      udp: Array.from(udp),
    };
  }

  private async createDnctlPipe(
    pipeNumber: number,
    args: { bandwidth: string; delay: string; loss: string }
  ): Promise<void> {
    await runSudoCommand('dnctl', [
      'pipe', pipeNumber.toString(), 'config',
      'bw', args.bandwidth,
      'delay', args.delay,
      'plr', args.loss,
    ]);
  }

  private createPfRules(
    rulesFile: string,
    pipeNumber: number,
    ports: { tcp: number[]; udp: number[] },
    iface: string,
    profile: NetworkProfile
  ): void {
    const rules: string[] = [];

    if (ports.tcp.length > 0) {
      const tcpPorts = ports.tcp.join(',');
      
      rules.push(`dummynet in on ${iface} proto tcp from any to any port { ${tcpPorts} } pipe ${pipeNumber}`);
      rules.push(`dummynet out on ${iface} proto tcp from any port { ${tcpPorts} } to any pipe ${pipeNumber}`);
      
      rules.push(`dummynet in on ${iface} proto tcp from any port { ${tcpPorts} } to any pipe ${pipeNumber}`);
      rules.push(`dummynet out on ${iface} proto tcp from any to any port { ${tcpPorts} } pipe ${pipeNumber}`);
    }

    if (ports.udp.length > 0) {
      const udpPorts = ports.udp.join(',');
      
      rules.push(`dummynet in on ${iface} proto udp from any to any port { ${udpPorts} } pipe ${pipeNumber}`);
      rules.push(`dummynet out on ${iface} proto udp from any port { ${udpPorts} } to any pipe ${pipeNumber}`);
      
      rules.push(`dummynet in on ${iface} proto udp from any port { ${udpPorts} } to any pipe ${pipeNumber}`);
      rules.push(`dummynet out on ${iface} proto udp from any to any port { ${udpPorts} } pipe ${pipeNumber}`);
    }

    if (profile.packetCorruption && profile.packetCorruption > 0) {
      rules.push(`# Note: Packet corruption is not directly supported by dnctl`);
      rules.push(`# Use packet loss as a substitute: ${profile.packetCorruption}% corruption simulated`);
    }

    if (profile.packetReordering && profile.packetReordering > 0) {
      rules.push(`# Note: Packet reordering is not directly supported by dnctl`);
      rules.push(`# Use delay jitter as a substitute: ${profile.packetReordering}% reordering simulated`);
    }

    const content = [
      '# Auto-generated by netslim',
      `# Date: ${new Date().toISOString()}`,
      `# PID: ${this.config?.pid || 'unknown'}`,
      '',
      ...rules,
      '',
    ].join('\n');

    writeFileSync(rulesFile, content);
  }

  private async applyPfRules(rulesFile: string): Promise<void> {
    await runSudoCommand('pfctl', ['-e']);
    await runSudoCommand('pfctl', ['-f', rulesFile]);
  }

  async cleanup(): Promise<void> {
    if (!this.config) {
      return;
    }

    const { pipeNumber, pfRulesFile, originalPfEnabled } = this.config;

    try {
      if (existsSync(pfRulesFile)) {
        unlinkSync(pfRulesFile);
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    try {
      if (!originalPfEnabled) {
        await runSudoCommand('pfctl', ['-d']);
      } else {
        await runSudoCommand('pfctl', ['-f', '/etc/pf.conf']);
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    try {
      await runSudoCommand('dnctl', ['-q', 'flush']);
    } catch (e) {
      // Ignore cleanup errors
    }

    try {
      await runSudoCommand('dnctl', ['pipe', pipeNumber.toString(), 'delete']);
    } catch (e) {
      // Ignore cleanup errors
    }

    this.releasePipeNumber(pipeNumber);
    this.config = null;
  }
}
