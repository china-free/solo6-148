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
import { getChildPids, getCgroupControllerPath, processExists, getProcessPorts } from '../process';

interface EgressConfig {
  weCreatedRootQdisc: boolean;
  rootQdiscHandle: string;
  classId: string;
  netemHandle: string;
  filterPrio: number;
  fwmark: string;
}

interface IngressConfig {
  ifbName: string;
  weCreatedIfb: boolean;
  ifbRootQdiscHandle: string;
  ifbClassId: string;
  ifbNetemHandle: string;
  ingressFilterPrio: number;
  ifbFilterPrio: number;
  ports: { tcp: number[]; udp: number[] };
}

interface AppliedConfig {
  cgroupClassid: string;
  fwmark: string;
  cgroupPath: string;
  cgroupName: string;
  net_clsPath: string;
  iface: string;
  pids: number[];
  egress: EgressConfig | null;
  ingress: IngressConfig | null;
  iptablesRules: string[];
}

export class LinuxBackend implements Backend {
  public readonly platform: Platform = 'linux';
  private config: AppliedConfig | null = null;
  private net_clsPath: string | null = null;

  private static readonly PRIO_START = 5000;
  private static readonly CLASS_MINOR_START = 100;
  private static readonly IFB_PREFIX = 'netslim';

  async isAvailable(): Promise<boolean> {
    const [tcExists, iptablesExists, hasCgroup, hasIp] = await Promise.all([
      commandExists('tc'),
      commandExists('iptables'),
      this.checkCgroupAvailable(),
      commandExists('ip'),
    ]);
    return tcExists && iptablesExists && hasCgroup && hasIp;
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

  private async getRootQdisc(iface: string): Promise<{ handle: string; type: string } | null> {
    const result = await runSudoCommand('tc', ['qdisc', 'show', 'dev', iface, 'root']);
    const match = result.stdout.match(/qdisc\s+(\S+)\s+(\S+)/);
    if (match) {
      return { handle: match[2], type: match[1] };
    }
    return null;
  }

  private async getNextClassMinor(iface: string, rootHandle: string): Promise<number> {
    const result = await runSudoCommand('tc', ['class', 'show', 'dev', iface, 'parent', rootHandle]);
    let maxMinor = LinuxBackend.CLASS_MINOR_START - 1;

    const regex = /class\s+\S+:(\d+)/g;
    let match;
    while ((match = regex.exec(result.stdout)) !== null) {
      const minor = parseInt(match[1], 10);
      if (minor > maxMinor) {
        maxMinor = minor;
      }
    }

    return maxMinor + 1;
  }

  private async getNextFilterPrio(iface: string, parent: string): Promise<number> {
    const result = await runSudoCommand('tc', ['filter', 'show', 'dev', iface, 'parent', parent]);
    let maxPrio = LinuxBackend.PRIO_START - 1;

    const regex = /pref\s+(\d+)/g;
    let match;
    while ((match = regex.exec(result.stdout)) !== null) {
      const prio = parseInt(match[1], 10);
      if (prio > maxPrio) {
        maxPrio = prio;
      }
    }

    return maxPrio + 1;
  }

  private generateFwmark(): string {
    const mark = Math.floor(Math.random() * 0x00FFFFFF + 0x00010000);
    return `0x${mark.toString(16).padStart(8, '0')}`;
  }

  private generateCgroupClassid(): string {
    const major = Math.floor(Math.random() * 1000) + 100;
    const minor = Math.floor(Math.random() * 10000) + 100;
    return `${major}:${minor}`;
  }

  private profileToTcArgs(profile: NetworkProfile): {
    rate: string;
    burst: string;
    delay: string;
    jitter: string;
    loss: string;
    corrupt: string;
    reorder: string;
  } {
    const bandwidth = Math.min(profile.bandwidth.download, profile.bandwidth.upload);

    return {
      rate: bpsToRate(Math.max(bandwidth, 8 * 1024)),
      burst: bandwidth > 0 ? `${Math.max(1500, Math.floor(bandwidth / 8 / 100))}b` : '1500b',
      delay: profile.latency > 0 ? msToTime(profile.latency) : '0ms',
      jitter: profile.jitter > 0 ? msToTime(profile.jitter) : '0ms',
      loss: percentToString(profile.packetLoss),
      corrupt: percentToString(profile.packetCorruption || 0),
      reorder: percentToString(profile.packetReordering || 0),
    };
  }

  private needNetem(profile: NetworkProfile): boolean {
    return (
      profile.latency > 0 ||
      profile.jitter > 0 ||
      profile.packetLoss > 0 ||
      (profile.packetCorruption || 0) > 0 ||
      (profile.packetReordering || 0) > 0
    );
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
    const fwmark = this.generateFwmark();
    const cgroupClassid = this.generateCgroupClassid();
    const cgroupName = `netslim_${generateId()}`;
    const cgroupPath = `${net_clsPath}/${cgroupName}`;

    await runSudoCommand('mkdir', ['-p', cgroupPath]);
    await runSudoCommand('bash', ['-c', `echo "${cgroupClassid}" > ${cgroupPath}/net_cls.classid`]);

    const allPids = [pid, ...await getChildPids(pid)];
    for (const p of allPids) {
      await runSudoCommand('bash', ['-c', `echo ${p} >> ${cgroupPath}/cgroup.procs`]);
    }

    const egressConfig = await this.setupEgress(iface, fwmark, profile);

    const ports = await getProcessPorts(pid);
    const allPorts = {
      tcp: [...new Set([...ports.tcp, ...(await this.getAllChildPorts(allPids)).tcp])],
      udp: [...new Set([...ports.udp, ...(await this.getAllChildPorts(allPids)).udp])],
    };
    let ingressConfig: IngressConfig | null = null;
    if (allPorts.tcp.length > 0 || allPorts.udp.length > 0) {
      try {
        ingressConfig = await this.setupIngress(iface, allPorts, profile);
      } catch (e) {
        console.warn('Warning: Failed to setup ingress control, egress only mode');
      }
    }

    const iptablesRules = await this.setupIptables(fwmark, cgroupClassid);

    this.config = {
      cgroupClassid,
      fwmark,
      cgroupPath,
      cgroupName,
      net_clsPath,
      iface,
      pids: allPids,
      egress: egressConfig,
      ingress: ingressConfig,
      iptablesRules,
    };

    await sleep(100);
  }

  private async getAllChildPorts(pids: number[]): Promise<{ tcp: number[]; udp: number[] }> {
    const tcp = new Set<number>();
    const udp = new Set<number>();

    for (const pid of pids) {
      try {
        const ports = await getProcessPorts(pid);
        ports.tcp.forEach(p => tcp.add(p));
        ports.udp.forEach(p => udp.add(p));
      } catch {
        // Skip if process no longer exists
      }
    }

    return { tcp: Array.from(tcp), udp: Array.from(udp) };
  }

  private async setupEgress(
    iface: string,
    fwmark: string,
    profile: NetworkProfile
  ): Promise<EgressConfig> {
    const args = this.profileToTcArgs(profile);
    const existingRoot = await this.getRootQdisc(iface);

    let rootHandle: string;
    let weCreatedRootQdisc = false;

    if (!existingRoot || existingRoot.type !== 'htb') {
      rootHandle = '1:';
      await runSudoCommand('tc', [
        'qdisc', 'add', 'dev', iface, 'root', 'handle', rootHandle, 'htb', 'default', '1'
      ]);
      weCreatedRootQdisc = true;

      await runSudoCommand('tc', [
        'class', 'add', 'dev', iface, 'parent', rootHandle, 'classid', '1:1',
        'htb', 'rate', '4294967295kbit', 'ceil', '4294967295kbit'
      ]);
    } else {
      rootHandle = existingRoot.handle;
      if (!rootHandle.endsWith(':')) {
        rootHandle += ':';
      }
    }

    const classMinor = await this.getNextClassMinor(iface, rootHandle);
    const majorNum = parseInt(rootHandle, 10);
    const classId = `${majorNum}:${classMinor}`;
    const netemHandle = `${classMinor + 1000}:`;

    await runSudoCommand('tc', [
      'class', 'add', 'dev', iface, 'parent', rootHandle, 'classid', classId,
      'htb', 'rate', args.rate, 'ceil', args.rate
    ]);

    if (this.needNetem(profile)) {
      const netemArgs: string[] = [
        'qdisc', 'add', 'dev', iface, 'parent', classId, 'handle', netemHandle,
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

      await runSudoCommand('tc', netemArgs);
    }

    const filterPrio = await this.getNextFilterPrio(iface, rootHandle);

    await runSudoCommand('tc', [
      'filter', 'add', 'dev', iface, 'parent', rootHandle,
      'protocol', 'ip', 'prio', filterPrio.toString(),
      'handle', fwmark, 'fw', 'flowid', classId
    ]);

    return {
      weCreatedRootQdisc,
      rootQdiscHandle: rootHandle,
      classId,
      netemHandle,
      filterPrio,
      fwmark,
    };
  }

  private async setupIngress(
    iface: string,
    ports: { tcp: number[]; udp: number[] },
    profile: NetworkProfile
  ): Promise<IngressConfig | null> {
    if (ports.tcp.length === 0 && ports.udp.length === 0) {
      return null;
    }

    const args = this.profileToTcArgs(profile);

    const ifbResult = await runSudoCommand('ip', ['link', 'show', 'type', 'ifb']);
    let ifbName: string;
    let weCreatedIfb = false;

    const existingIfbMatch = ifbResult.stdout.match(/(\S+):/);
    if (existingIfbMatch) {
      ifbName = existingIfbMatch[1];
    } else {
      ifbName = `${LinuxBackend.IFB_PREFIX}0`;
      try {
        await runSudoCommand('modprobe', ['ifb']);
        await runSudoCommand('ip', ['link', 'add', 'name', ifbName, 'type', 'ifb']);
        await runSudoCommand('ip', ['link', 'set', 'up', 'dev', ifbName]);
        weCreatedIfb = true;
      } catch (e) {
        return null;
      }
    }

    const ifbRootResult = await this.getRootQdisc(ifbName);
    let ifbRootHandle: string;
    let weCreatedIfbRoot = false;

    if (!ifbRootResult || ifbRootResult.type !== 'htb') {
      ifbRootHandle = '1:';
      await runSudoCommand('tc', [
        'qdisc', 'add', 'dev', ifbName, 'root', 'handle', ifbRootHandle, 'htb', 'default', '1'
      ]);
      weCreatedIfbRoot = true;

      await runSudoCommand('tc', [
        'class', 'add', 'dev', ifbName, 'parent', ifbRootHandle, 'classid', '1:1',
        'htb', 'rate', '4294967295kbit', 'ceil', '4294967295kbit'
      ]);
    } else {
      ifbRootHandle = ifbRootResult.handle;
      if (!ifbRootHandle.endsWith(':')) {
        ifbRootHandle += ':';
      }
    }

    const ifbClassMinor = await this.getNextClassMinor(ifbName, ifbRootHandle);
    const ifbMajorNum = parseInt(ifbRootHandle, 10);
    const ifbClassId = `${ifbMajorNum}:${ifbClassMinor}`;
    const ifbNetemHandle = `${ifbClassMinor + 1000}:`;

    await runSudoCommand('tc', [
      'class', 'add', 'dev', ifbName, 'parent', ifbRootHandle, 'classid', ifbClassId,
      'htb', 'rate', args.rate, 'ceil', args.rate
    ]);

    if (this.needNetem(profile)) {
      const netemArgs: string[] = [
        'qdisc', 'add', 'dev', ifbName, 'parent', ifbClassId, 'handle', ifbNetemHandle,
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

      await runSudoCommand('tc', netemArgs);
    }

    const ingressResult = await runSudoCommand('tc', ['qdisc', 'show', 'dev', iface, 'ingress']);
    const hasIngress = ingressResult.stdout.includes('ingress');
    if (!hasIngress) {
      await runSudoCommand('tc', ['qdisc', 'add', 'dev', iface, 'ingress']);
    }

    const ingressFilterPrio = await this.getNextFilterPrio(iface, 'ffff:');
    const ifbFilterPrio = await this.getNextFilterPrio(ifbName, ifbRootHandle);

    let portFilterPrio = ingressFilterPrio;
    for (const port of ports.tcp) {
      await runSudoCommand('tc', [
        'filter', 'add', 'dev', iface, 'parent', 'ffff:',
        'protocol', 'ip', 'prio', portFilterPrio.toString(),
        'u32', 'match', 'ip', 'dport', port.toString(), '0xffff',
        'action', 'mirred', 'egress', 'redirect', 'dev', ifbName
      ]);
      portFilterPrio++;
    }
    for (const port of ports.udp) {
      await runSudoCommand('tc', [
        'filter', 'add', 'dev', iface, 'parent', 'ffff:',
        'protocol', 'ip', 'prio', portFilterPrio.toString(),
        'u32', 'match', 'ip', 'dport', port.toString(), '0xffff',
        'action', 'mirred', 'egress', 'redirect', 'dev', ifbName
      ]);
      portFilterPrio++;
    }

    return {
      ifbName,
      weCreatedIfb,
      ifbRootQdiscHandle: ifbRootHandle,
      ifbClassId,
      ifbNetemHandle,
      ingressFilterPrio,
      ifbFilterPrio,
      ports,
    };
  }

  private async setupIptables(fwmark: string, cgroupClassid: string): Promise<string[]> {
    const rules: string[] = [];

    await runSudoCommand('iptables', [
      '-t', 'mangle', '-A', 'OUTPUT',
      '-m', 'cgroup', '--cgroup', cgroupClassid,
      '-j', 'MARK', '--set-mark', fwmark
    ]);
    rules.push(`mangle OUTPUT -m cgroup --cgroup ${cgroupClassid} -j MARK --set-mark ${fwmark}`);

    await runSudoCommand('iptables', [
      '-t', 'mangle', '-A', 'POSTROUTING',
      '-m', 'cgroup', '--cgroup', cgroupClassid,
      '-j', 'MARK', '--set-mark', fwmark
    ]);
    rules.push(`mangle POSTROUTING -m cgroup --cgroup ${cgroupClassid} -j MARK --set-mark ${fwmark}`);

    return rules;
  }

  async cleanup(): Promise<void> {
    if (!this.config) {
      return;
    }

    const {
      cgroupPath,
      net_clsPath,
      iface,
      egress,
      ingress,
      iptablesRules,
      pids,
    } = this.config;

    try {
      await this.cleanupIptables(iptablesRules);
    } catch (e) {
      console.error('Error cleaning up iptables:', e instanceof Error ? e.message : String(e));
    }

    try {
      if (ingress) {
        await this.cleanupIngress(iface, ingress);
      }
    } catch (e) {
      console.error('Error cleaning up ingress:', e instanceof Error ? e.message : String(e));
    }

    try {
      if (egress) {
        await this.cleanupEgress(iface, egress);
      }
    } catch (e) {
      console.error('Error cleaning up egress:', e instanceof Error ? e.message : String(e));
    }

    try {
      await this.cleanupCgroup(cgroupPath, net_clsPath, pids);
    } catch (e) {
      console.error('Error cleaning up cgroup:', e instanceof Error ? e.message : String(e));
    }

    this.config = null;
  }

  private async cleanupIptables(rules: string[]): Promise<void> {
    for (const rule of rules) {
      try {
        const parts = rule.split(' ');
        const table = parts[0];
        const chain = parts[1];
        const ruleArgs = ['-t', table, '-D', chain, ...parts.slice(2)];
        await runSudoCommand('iptables', ruleArgs);
      } catch {
        // Rule may already be gone
      }
    }
  }

  private async cleanupEgress(iface: string, egress: EgressConfig): Promise<void> {
    const { rootQdiscHandle, classId, netemHandle, filterPrio, weCreatedRootQdisc, fwmark } = egress;

    try {
      await runSudoCommand('tc', [
        'filter', 'del', 'dev', iface, 'parent', rootQdiscHandle,
        'prio', filterPrio.toString()
      ]);
    } catch {
      // Filter may already be gone
    }

    try {
      await runSudoCommand('tc', [
        'qdisc', 'del', 'dev', iface, 'parent', classId, 'handle', netemHandle
      ]);
    } catch {
      // Netem may not exist
    }

    try {
      await runSudoCommand('tc', [
        'class', 'del', 'dev', iface, 'parent', rootQdiscHandle, 'classid', classId
      ]);
    } catch {
      // Class may already be gone
    }

    if (weCreatedRootQdisc) {
      try {
        const classesResult = await runSudoCommand('tc', ['class', 'show', 'dev', iface, 'parent', rootQdiscHandle]);
        const classCount = (classesResult.stdout.match(/class\s+\S+:\d+/g) || []).length;

        if (classCount <= 1) {
          await runSudoCommand('tc', ['qdisc', 'del', 'dev', iface, 'root']);
        }
      } catch {
        // Ignore
      }
    }
  }

  private async cleanupIngress(iface: string, ingress: IngressConfig): Promise<void> {
    const {
      ifbName,
      weCreatedIfb,
      ifbRootQdiscHandle,
      ifbClassId,
      ifbNetemHandle,
      ingressFilterPrio,
      ifbFilterPrio,
      ports,
    } = ingress;

    const totalPortFilters = ports.tcp.length + ports.udp.length;
    for (let i = 0; i < totalPortFilters; i++) {
      try {
        await runSudoCommand('tc', [
          'filter', 'del', 'dev', iface, 'parent', 'ffff:',
          'prio', (ingressFilterPrio + i).toString()
        ]);
      } catch {
        // Filter may already be gone
      }
    }

    try {
      await runSudoCommand('tc', [
        'qdisc', 'del', 'dev', ifbName, 'parent', ifbClassId, 'handle', ifbNetemHandle
      ]);
    } catch {
      // Netem may not exist
    }

    try {
      await runSudoCommand('tc', [
        'filter', 'del', 'dev', ifbName, 'parent', ifbRootQdiscHandle,
        'prio', ifbFilterPrio.toString()
      ]);
    } catch {
      // Filter may already be gone
    }

    try {
      await runSudoCommand('tc', [
        'class', 'del', 'dev', ifbName, 'parent', ifbRootQdiscHandle, 'classid', ifbClassId
      ]);
    } catch {
      // Class may already be gone
    }

    try {
      const classesResult = await runSudoCommand('tc', ['class', 'show', 'dev', ifbName, 'parent', ifbRootQdiscHandle]);
      const classCount = (classesResult.stdout.match(/class\s+\S+:\d+/g) || []).length;

      if (classCount <= 1) {
        await runSudoCommand('tc', ['qdisc', 'del', 'dev', ifbName, 'root']);
      }
    } catch {
      // Ignore
    }

    if (weCreatedIfb) {
      try {
        const result = await runSudoCommand('tc', ['qdisc', 'show', 'dev', ifbName, 'root']);
        if (!result.stdout.trim()) {
          await runSudoCommand('ip', ['link', 'set', 'down', 'dev', ifbName]);
          await runSudoCommand('ip', ['link', 'del', ifbName]);
        }
      } catch {
        // Ignore
      }
    }

    try {
      const ingressQdiscResult = await runSudoCommand('tc', ['qdisc', 'show', 'dev', iface, 'ingress']);
      const filtersResult = await runSudoCommand('tc', ['filter', 'show', 'dev', iface, 'parent', 'ffff:']);

      if (ingressQdiscResult.stdout.includes('ingress') && !filtersResult.stdout.trim()) {
        await runSudoCommand('tc', ['qdisc', 'del', 'dev', iface, 'ingress']);
      }
    } catch {
      // Ignore
    }
  }

  private async cleanupCgroup(cgroupPath: string, net_clsPath: string, pids: number[]): Promise<void> {
    try {
      const procsResult = await runSudoCommand('cat', [`${cgroupPath}/cgroup.procs`]);
      const procs = procsResult.stdout.trim().split('\n').filter(Boolean);

      for (const proc of procs) {
        try {
          await runSudoCommand('bash', ['-c', `echo ${proc} >> ${net_clsPath}/cgroup.procs`]);
        } catch {
          // Process may have exited
        }
      }
    } catch {
      // Cgroup may already be gone
    }

    try {
      await runSudoCommand('rmdir', [cgroupPath]);
    } catch {
      // Cgroup may not be empty or already removed
    }
  }
}
