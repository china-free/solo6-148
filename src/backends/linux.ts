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
import { getChildPids, getCgroupControllerPath, processExists } from '../process';

interface AppliedConfig {
  classid: string;
  fwmark: string;
  cgroupPath: string;
  iface: string;
  handle: string;
  pids: number[];
  iptablesRules: string[];
}

export class LinuxBackend implements Backend {
  public readonly platform: Platform = 'linux';
  private config: AppliedConfig | null = null;
  private net_clsPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    const [tcExists, iptablesExists, hasCgroup] = await Promise.all([
      commandExists('tc'),
      commandExists('iptables'),
      this.checkCgroupAvailable(),
    ]);
    return tcExists && iptablesExists && hasCgroup;
  }

  async checkRoot(): Promise<boolean> {
    return checkRoot();
  }

  private async checkCgroupAvailable(): Promise<boolean> {
    this.net_clsPath = await getCgroupControllerPath('net_cls');
    if (this.net_clsPath) return true;
    
    const result = await runSudoCommand('mount', ['-t', 'cgroup']);
    return result.stdout.includes('net_cls');
  }

  private async ensureNetClsMounted(): Promise<string> {
    if (this.net_clsPath) {
      return this.net_clsPath;
    }

    const existingPath = await getCgroupControllerPath('net_cls');
    if (existingPath) {
      this.net_clsPath = existingPath;
      return existingPath;
    }

    const mountPath = '/sys/fs/cgroup/net_cls';
    await runSudoCommand('mkdir', ['-p', mountPath]);
    await runSudoCommand('mount', ['-t', 'cgroup', '-o', 'net_cls', 'net_cls', mountPath]);
    this.net_clsPath = mountPath;
    return mountPath;
  }

  private generateClassid(): string {
    const major = Math.floor(Math.random() * 1000) + 1;
    const minor = Math.floor(Math.random() * 1000) + 1;
    return `${major}:${minor}`;
  }

  private generateFwmark(): string {
    return `0x${Math.floor(Math.random() * 0xFFFFFF + 1).toString(16).padStart(6, '0')}`;
  }

  private profileToTcArgs(profile: NetworkProfile, direction: 'download' | 'upload'): {
    rate: string;
    burst: string;
    delay: string;
    jitter: string;
    loss: string;
    corrupt: string;
    reorder: string;
  } {
    const bandwidth = direction === 'download' 
      ? profile.bandwidth.download 
      : profile.bandwidth.upload;

    return {
      rate: bpsToRate(bandwidth),
      burst: bandwidth > 0 ? `${Math.max(1500, Math.floor(bandwidth / 8 / 100))}b` : '1500b',
      delay: profile.latency > 0 ? msToTime(profile.latency) : '0ms',
      jitter: profile.jitter > 0 ? msToTime(profile.jitter) : '0ms',
      loss: percentToString(profile.packetLoss),
      corrupt: percentToString(profile.packetCorruption || 0),
      reorder: percentToString(profile.packetReordering || 0),
    };
  }

  async apply(pid: number, profile: NetworkProfile): Promise<void> {
    if (!await this.checkRoot()) {
      throw new Error('Root privileges required. Please run with sudo.');
    }

    if (!await processExists(pid)) {
      throw new Error(`Process ${pid} does not exist`);
    }

    const net_clsPath = await this.ensureNetClsMounted();
    const iface = await getDefaultInterface();
    const classid = this.generateClassid();
    const fwmark = this.generateFwmark();
    const cgroupName = `netslim_${generateId()}`;
    const cgroupPath = `${net_clsPath}/${cgroupName}`;
    const handle = `1:${Math.floor(Math.random() * 100) + 10}`;

    await runSudoCommand('mkdir', ['-p', cgroupPath]);
    await runSudoCommand('bash', ['-c', `echo "${classid}" > ${cgroupPath}/net_cls.classid`]);

    const allPids = [pid, ...await getChildPids(pid)];
    for (const p of allPids) {
      await runSudoCommand('bash', ['-c', `echo ${p} >> ${cgroupPath}/cgroup.procs`]);
    }

    await this.setupTrafficControl(iface, handle, fwmark, profile);

    const iptablesRules = await this.setupIptables(fwmark, classid);

    this.config = {
      classid,
      fwmark,
      cgroupPath,
      iface,
      handle,
      pids: allPids,
      iptablesRules,
    };

    await sleep(100);
  }

  private async setupTrafficControl(
    iface: string,
    handle: string,
    fwmark: string,
    profile: NetworkProfile
  ): Promise<void> {
    const args = this.profileToTcArgs(profile, 'download');
    const parentHandle = handle.split(':')[0] + ':';

    await runSudoCommand('tc', ['qdisc', 'add', 'dev', iface, 'root', 'handle', parentHandle, 'htb']);
    await runSudoCommand('tc', [
      'class', 'add', 'dev', iface, 'parent', parentHandle, 'classid', handle,
      'htb', 'rate', args.rate, 'ceil', args.rate
    ]);

    const netemArgs: string[] = [
      'qdisc', 'add', 'dev', iface, 'parent', handle, 'handle', `${parseInt(handle.split(':')[1]) + 10}:`,
      'netem',
    ];

    if (profile.latency > 0) {
      netemArgs.push('delay', args.delay, args.jitter, '25%');
    }
    if (profile.packetLoss > 0) {
      netemArgs.push('loss', args.loss);
    }
    if (profile.packetCorruption && profile.packetCorruption > 0) {
      netemArgs.push('corrupt', args.corrupt);
    }
    if (profile.packetReordering && profile.packetReordering > 0) {
      netemArgs.push('reorder', args.reorder, '50%');
    }

    if (netemArgs.length > 8) {
      await runSudoCommand('tc', netemArgs);
    }

    await runSudoCommand('tc', [
      'filter', 'add', 'dev', iface, 'parent', parentHandle, 'protocol', 'ip',
      'prio', '1', 'handle', fwmark, 'fw', 'flowid', handle
    ]);
  }

  private async setupIptables(fwmark: string, classid: string): Promise<string[]> {
    const rules: string[] = [];

    await runSudoCommand('iptables', [
      '-t', 'mangle', '-A', 'OUTPUT',
      '-m', 'cgroup', '--cgroup', classid,
      '-j', 'MARK', '--set-mark', fwmark
    ]);
    rules.push(`mangle OUTPUT -m cgroup --cgroup ${classid} -j MARK --set-mark ${fwmark}`);

    await runSudoCommand('iptables', [
      '-t', 'mangle', '-A', 'INPUT',
      '-m', 'cgroup', '--cgroup', classid,
      '-j', 'MARK', '--set-mark', fwmark
    ]);
    rules.push(`mangle INPUT -m cgroup --cgroup ${classid} -j MARK --set-mark ${fwmark}`);

    await runSudoCommand('iptables', [
      '-t', 'mangle', '-A', 'FORWARD',
      '-m', 'cgroup', '--cgroup', classid,
      '-j', 'MARK', '--set-mark', fwmark
    ]);
    rules.push(`mangle FORWARD -m cgroup --cgroup ${classid} -j MARK --set-mark ${fwmark}`);

    return rules;
  }

  async cleanup(): Promise<void> {
    if (!this.config) {
      return;
    }

    const { cgroupPath, iface, iptablesRules, fwmark } = this.config;

    try {
      for (const rule of iptablesRules) {
        const parts = rule.split(' ');
        const table = parts[0];
        const chain = parts[1];
        const args = ['-t', table, '-D', chain, ...parts.slice(2)];
        await runSudoCommand('iptables', args);
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    try {
      const result = await runSudoCommand('tc', ['qdisc', 'show', 'dev', iface]);
      if (result.stdout.includes('root')) {
        await runSudoCommand('tc', ['qdisc', 'del', 'dev', iface, 'root']);
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    try {
      const procs = await runSudoCommand('cat', [`${cgroupPath}/cgroup.procs`]);
      for (const line of procs.stdout.trim().split('\n')) {
        if (line) {
          await runSudoCommand('bash', ['-c', `echo ${line} >> /sys/fs/cgroup/net_cls/cgroup.procs`]);
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    try {
      await runSudoCommand('rmdir', [cgroupPath]);
    } catch (e) {
      // Ignore cleanup errors
    }

    try {
      await runSudoCommand('iptables', ['-t', 'mangle', '-F']);
    } catch (e) {
      // Ignore cleanup errors
    }

    this.config = null;
  }
}
