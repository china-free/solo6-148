"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinuxBackend = void 0;
const utils_1 = require("../utils");
const process_1 = require("../process");
class LinuxBackend {
    constructor() {
        this.platform = 'linux';
        this.config = null;
        this.net_clsPath = null;
    }
    async isAvailable() {
        const [tcExists, iptablesExists, hasCgroup, hasIp] = await Promise.all([
            (0, utils_1.commandExists)('tc'),
            (0, utils_1.commandExists)('iptables'),
            this.checkCgroupAvailable(),
            (0, utils_1.commandExists)('ip'),
        ]);
        return tcExists && iptablesExists && hasCgroup && hasIp;
    }
    async checkRoot() {
        return (0, utils_1.checkRoot)();
    }
    async checkCgroupAvailable() {
        this.net_clsPath = await (0, process_1.getCgroupControllerPath)('net_cls');
        if (this.net_clsPath)
            return true;
        const result = await (0, utils_1.runSudoCommand)('mount', ['-t', 'cgroup']);
        return result.stdout.includes('net_cls');
    }
    async ensureNetClsMounted() {
        if (this.net_clsPath) {
            return this.net_clsPath;
        }
        const existingPath = await (0, process_1.getCgroupControllerPath)('net_cls');
        if (existingPath) {
            this.net_clsPath = existingPath;
            return existingPath;
        }
        const mountPath = '/sys/fs/cgroup/net_cls';
        await (0, utils_1.runSudoCommand)('mkdir', ['-p', mountPath]);
        await (0, utils_1.runSudoCommand)('mount', ['-t', 'cgroup', '-o', 'net_cls', 'net_cls', mountPath]);
        this.net_clsPath = mountPath;
        return mountPath;
    }
    async getRootQdisc(iface) {
        const result = await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'show', 'dev', iface, 'root']);
        const match = result.stdout.match(/qdisc\s+(\S+)\s+(\S+)/);
        if (match) {
            return { handle: match[2], type: match[1] };
        }
        return null;
    }
    async getNextClassMinor(iface, rootHandle) {
        const result = await (0, utils_1.runSudoCommand)('tc', ['class', 'show', 'dev', iface, 'parent', rootHandle]);
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
    async getNextFilterPrio(iface, parent) {
        const result = await (0, utils_1.runSudoCommand)('tc', ['filter', 'show', 'dev', iface, 'parent', parent]);
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
    generateFwmark() {
        const mark = Math.floor(Math.random() * 0x00FFFFFF + 0x00010000);
        return `0x${mark.toString(16).padStart(8, '0')}`;
    }
    generateCgroupClassid() {
        const major = Math.floor(Math.random() * 1000) + 100;
        const minor = Math.floor(Math.random() * 10000) + 100;
        return `${major}:${minor}`;
    }
    profileToTcArgs(profile) {
        const bandwidth = Math.min(profile.bandwidth.download, profile.bandwidth.upload);
        return {
            rate: (0, utils_1.bpsToRate)(Math.max(bandwidth, 8 * 1024)),
            burst: bandwidth > 0 ? `${Math.max(1500, Math.floor(bandwidth / 8 / 100))}b` : '1500b',
            delay: profile.latency > 0 ? (0, utils_1.msToTime)(profile.latency) : '0ms',
            jitter: profile.jitter > 0 ? (0, utils_1.msToTime)(profile.jitter) : '0ms',
            loss: (0, utils_1.percentToString)(profile.packetLoss),
            corrupt: (0, utils_1.percentToString)(profile.packetCorruption || 0),
            reorder: (0, utils_1.percentToString)(profile.packetReordering || 0),
        };
    }
    needNetem(profile) {
        return (profile.latency > 0 ||
            profile.jitter > 0 ||
            profile.packetLoss > 0 ||
            (profile.packetCorruption || 0) > 0 ||
            (profile.packetReordering || 0) > 0);
    }
    async apply(pid, profile) {
        if (!await this.checkRoot()) {
            throw new Error('Root privileges required. Please run with sudo.');
        }
        if (!await (0, process_1.processExists)(pid)) {
            throw new Error(`Process ${pid} does not exist`);
        }
        const net_clsPath = await this.ensureNetClsMounted();
        const iface = await (0, utils_1.getDefaultInterface)();
        const fwmark = this.generateFwmark();
        const cgroupClassid = this.generateCgroupClassid();
        const cgroupName = `netslim_${(0, utils_1.generateId)()}`;
        const cgroupPath = `${net_clsPath}/${cgroupName}`;
        await (0, utils_1.runSudoCommand)('mkdir', ['-p', cgroupPath]);
        await (0, utils_1.runSudoCommand)('bash', ['-c', `echo "${cgroupClassid}" > ${cgroupPath}/net_cls.classid`]);
        const allPids = [pid, ...await (0, process_1.getChildPids)(pid)];
        for (const p of allPids) {
            await (0, utils_1.runSudoCommand)('bash', ['-c', `echo ${p} >> ${cgroupPath}/cgroup.procs`]);
        }
        const egressConfig = await this.setupEgress(iface, fwmark, profile);
        const ports = await (0, process_1.getProcessPorts)(pid);
        const allPorts = {
            tcp: [...new Set([...ports.tcp, ...(await this.getAllChildPorts(allPids)).tcp])],
            udp: [...new Set([...ports.udp, ...(await this.getAllChildPorts(allPids)).udp])],
        };
        let ingressConfig = null;
        if (allPorts.tcp.length > 0 || allPorts.udp.length > 0) {
            try {
                ingressConfig = await this.setupIngress(iface, allPorts, profile);
            }
            catch (e) {
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
        await (0, utils_1.sleep)(100);
    }
    async getAllChildPorts(pids) {
        const tcp = new Set();
        const udp = new Set();
        for (const pid of pids) {
            try {
                const ports = await (0, process_1.getProcessPorts)(pid);
                ports.tcp.forEach(p => tcp.add(p));
                ports.udp.forEach(p => udp.add(p));
            }
            catch {
                // Skip if process no longer exists
            }
        }
        return { tcp: Array.from(tcp), udp: Array.from(udp) };
    }
    async setupEgress(iface, fwmark, profile) {
        const args = this.profileToTcArgs(profile);
        const existingRoot = await this.getRootQdisc(iface);
        let rootHandle;
        let weCreatedRootQdisc = false;
        if (!existingRoot || existingRoot.type !== 'htb') {
            rootHandle = '1:';
            await (0, utils_1.runSudoCommand)('tc', [
                'qdisc', 'add', 'dev', iface, 'root', 'handle', rootHandle, 'htb', 'default', '1'
            ]);
            weCreatedRootQdisc = true;
            await (0, utils_1.runSudoCommand)('tc', [
                'class', 'add', 'dev', iface, 'parent', rootHandle, 'classid', '1:1',
                'htb', 'rate', '4294967295kbit', 'ceil', '4294967295kbit'
            ]);
        }
        else {
            rootHandle = existingRoot.handle;
            if (!rootHandle.endsWith(':')) {
                rootHandle += ':';
            }
        }
        const classMinor = await this.getNextClassMinor(iface, rootHandle);
        const majorNum = parseInt(rootHandle, 10);
        const classId = `${majorNum}:${classMinor}`;
        const netemHandle = `${classMinor + 1000}:`;
        await (0, utils_1.runSudoCommand)('tc', [
            'class', 'add', 'dev', iface, 'parent', rootHandle, 'classid', classId,
            'htb', 'rate', args.rate, 'ceil', args.rate
        ]);
        if (this.needNetem(profile)) {
            const netemArgs = [
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
            await (0, utils_1.runSudoCommand)('tc', netemArgs);
        }
        const filterPrio = await this.getNextFilterPrio(iface, rootHandle);
        await (0, utils_1.runSudoCommand)('tc', [
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
    async setupIngress(iface, ports, profile) {
        if (ports.tcp.length === 0 && ports.udp.length === 0) {
            return null;
        }
        const args = this.profileToTcArgs(profile);
        const ifbResult = await (0, utils_1.runSudoCommand)('ip', ['link', 'show', 'type', 'ifb']);
        let ifbName;
        let weCreatedIfb = false;
        const existingIfbMatch = ifbResult.stdout.match(/(\S+):/);
        if (existingIfbMatch) {
            ifbName = existingIfbMatch[1];
        }
        else {
            ifbName = `${LinuxBackend.IFB_PREFIX}0`;
            try {
                await (0, utils_1.runSudoCommand)('modprobe', ['ifb']);
                await (0, utils_1.runSudoCommand)('ip', ['link', 'add', 'name', ifbName, 'type', 'ifb']);
                await (0, utils_1.runSudoCommand)('ip', ['link', 'set', 'up', 'dev', ifbName]);
                weCreatedIfb = true;
            }
            catch (e) {
                return null;
            }
        }
        const ifbRootResult = await this.getRootQdisc(ifbName);
        let ifbRootHandle;
        let weCreatedIfbRoot = false;
        if (!ifbRootResult || ifbRootResult.type !== 'htb') {
            ifbRootHandle = '1:';
            await (0, utils_1.runSudoCommand)('tc', [
                'qdisc', 'add', 'dev', ifbName, 'root', 'handle', ifbRootHandle, 'htb', 'default', '1'
            ]);
            weCreatedIfbRoot = true;
            await (0, utils_1.runSudoCommand)('tc', [
                'class', 'add', 'dev', ifbName, 'parent', ifbRootHandle, 'classid', '1:1',
                'htb', 'rate', '4294967295kbit', 'ceil', '4294967295kbit'
            ]);
        }
        else {
            ifbRootHandle = ifbRootResult.handle;
            if (!ifbRootHandle.endsWith(':')) {
                ifbRootHandle += ':';
            }
        }
        const ifbClassMinor = await this.getNextClassMinor(ifbName, ifbRootHandle);
        const ifbMajorNum = parseInt(ifbRootHandle, 10);
        const ifbClassId = `${ifbMajorNum}:${ifbClassMinor}`;
        const ifbNetemHandle = `${ifbClassMinor + 1000}:`;
        await (0, utils_1.runSudoCommand)('tc', [
            'class', 'add', 'dev', ifbName, 'parent', ifbRootHandle, 'classid', ifbClassId,
            'htb', 'rate', args.rate, 'ceil', args.rate
        ]);
        if (this.needNetem(profile)) {
            const netemArgs = [
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
            await (0, utils_1.runSudoCommand)('tc', netemArgs);
        }
        const ingressResult = await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'show', 'dev', iface, 'ingress']);
        const hasIngress = ingressResult.stdout.includes('ingress');
        if (!hasIngress) {
            await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'add', 'dev', iface, 'ingress']);
        }
        const ingressFilterPrio = await this.getNextFilterPrio(iface, 'ffff:');
        const ifbFilterPrio = await this.getNextFilterPrio(ifbName, ifbRootHandle);
        let portFilterPrio = ingressFilterPrio;
        for (const port of ports.tcp) {
            await (0, utils_1.runSudoCommand)('tc', [
                'filter', 'add', 'dev', iface, 'parent', 'ffff:',
                'protocol', 'ip', 'prio', portFilterPrio.toString(),
                'u32', 'match', 'ip', 'dport', port.toString(), '0xffff',
                'action', 'mirred', 'egress', 'redirect', 'dev', ifbName
            ]);
            portFilterPrio++;
        }
        for (const port of ports.udp) {
            await (0, utils_1.runSudoCommand)('tc', [
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
    async setupIptables(fwmark, cgroupClassid) {
        const rules = [];
        await (0, utils_1.runSudoCommand)('iptables', [
            '-t', 'mangle', '-A', 'OUTPUT',
            '-m', 'cgroup', '--cgroup', cgroupClassid,
            '-j', 'MARK', '--set-mark', fwmark
        ]);
        rules.push(`mangle OUTPUT -m cgroup --cgroup ${cgroupClassid} -j MARK --set-mark ${fwmark}`);
        await (0, utils_1.runSudoCommand)('iptables', [
            '-t', 'mangle', '-A', 'POSTROUTING',
            '-m', 'cgroup', '--cgroup', cgroupClassid,
            '-j', 'MARK', '--set-mark', fwmark
        ]);
        rules.push(`mangle POSTROUTING -m cgroup --cgroup ${cgroupClassid} -j MARK --set-mark ${fwmark}`);
        return rules;
    }
    async cleanup() {
        if (!this.config) {
            return;
        }
        const { cgroupPath, net_clsPath, iface, egress, ingress, iptablesRules, pids, } = this.config;
        try {
            await this.cleanupIptables(iptablesRules);
        }
        catch (e) {
            console.error('Error cleaning up iptables:', e instanceof Error ? e.message : String(e));
        }
        try {
            if (ingress) {
                await this.cleanupIngress(iface, ingress);
            }
        }
        catch (e) {
            console.error('Error cleaning up ingress:', e instanceof Error ? e.message : String(e));
        }
        try {
            if (egress) {
                await this.cleanupEgress(iface, egress);
            }
        }
        catch (e) {
            console.error('Error cleaning up egress:', e instanceof Error ? e.message : String(e));
        }
        try {
            await this.cleanupCgroup(cgroupPath, net_clsPath, pids);
        }
        catch (e) {
            console.error('Error cleaning up cgroup:', e instanceof Error ? e.message : String(e));
        }
        this.config = null;
    }
    async cleanupIptables(rules) {
        for (const rule of rules) {
            try {
                const parts = rule.split(' ');
                const table = parts[0];
                const chain = parts[1];
                const ruleArgs = ['-t', table, '-D', chain, ...parts.slice(2)];
                await (0, utils_1.runSudoCommand)('iptables', ruleArgs);
            }
            catch {
                // Rule may already be gone
            }
        }
    }
    async cleanupEgress(iface, egress) {
        const { rootQdiscHandle, classId, netemHandle, filterPrio, weCreatedRootQdisc, fwmark } = egress;
        try {
            await (0, utils_1.runSudoCommand)('tc', [
                'filter', 'del', 'dev', iface, 'parent', rootQdiscHandle,
                'prio', filterPrio.toString()
            ]);
        }
        catch {
            // Filter may already be gone
        }
        try {
            await (0, utils_1.runSudoCommand)('tc', [
                'qdisc', 'del', 'dev', iface, 'parent', classId, 'handle', netemHandle
            ]);
        }
        catch {
            // Netem may not exist
        }
        try {
            await (0, utils_1.runSudoCommand)('tc', [
                'class', 'del', 'dev', iface, 'parent', rootQdiscHandle, 'classid', classId
            ]);
        }
        catch {
            // Class may already be gone
        }
        if (weCreatedRootQdisc) {
            try {
                const classesResult = await (0, utils_1.runSudoCommand)('tc', ['class', 'show', 'dev', iface, 'parent', rootQdiscHandle]);
                const classCount = (classesResult.stdout.match(/class\s+\S+:\d+/g) || []).length;
                if (classCount <= 1) {
                    await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'del', 'dev', iface, 'root']);
                }
            }
            catch {
                // Ignore
            }
        }
    }
    async cleanupIngress(iface, ingress) {
        const { ifbName, weCreatedIfb, ifbRootQdiscHandle, ifbClassId, ifbNetemHandle, ingressFilterPrio, ifbFilterPrio, ports, } = ingress;
        const totalPortFilters = ports.tcp.length + ports.udp.length;
        for (let i = 0; i < totalPortFilters; i++) {
            try {
                await (0, utils_1.runSudoCommand)('tc', [
                    'filter', 'del', 'dev', iface, 'parent', 'ffff:',
                    'prio', (ingressFilterPrio + i).toString()
                ]);
            }
            catch {
                // Filter may already be gone
            }
        }
        try {
            await (0, utils_1.runSudoCommand)('tc', [
                'qdisc', 'del', 'dev', ifbName, 'parent', ifbClassId, 'handle', ifbNetemHandle
            ]);
        }
        catch {
            // Netem may not exist
        }
        try {
            await (0, utils_1.runSudoCommand)('tc', [
                'filter', 'del', 'dev', ifbName, 'parent', ifbRootQdiscHandle,
                'prio', ifbFilterPrio.toString()
            ]);
        }
        catch {
            // Filter may already be gone
        }
        try {
            await (0, utils_1.runSudoCommand)('tc', [
                'class', 'del', 'dev', ifbName, 'parent', ifbRootQdiscHandle, 'classid', ifbClassId
            ]);
        }
        catch {
            // Class may already be gone
        }
        try {
            const classesResult = await (0, utils_1.runSudoCommand)('tc', ['class', 'show', 'dev', ifbName, 'parent', ifbRootQdiscHandle]);
            const classCount = (classesResult.stdout.match(/class\s+\S+:\d+/g) || []).length;
            if (classCount <= 1) {
                await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'del', 'dev', ifbName, 'root']);
            }
        }
        catch {
            // Ignore
        }
        if (weCreatedIfb) {
            try {
                const result = await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'show', 'dev', ifbName, 'root']);
                if (!result.stdout.trim()) {
                    await (0, utils_1.runSudoCommand)('ip', ['link', 'set', 'down', 'dev', ifbName]);
                    await (0, utils_1.runSudoCommand)('ip', ['link', 'del', ifbName]);
                }
            }
            catch {
                // Ignore
            }
        }
        try {
            const ingressQdiscResult = await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'show', 'dev', iface, 'ingress']);
            const filtersResult = await (0, utils_1.runSudoCommand)('tc', ['filter', 'show', 'dev', iface, 'parent', 'ffff:']);
            if (ingressQdiscResult.stdout.includes('ingress') && !filtersResult.stdout.trim()) {
                await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'del', 'dev', iface, 'ingress']);
            }
        }
        catch {
            // Ignore
        }
    }
    async cleanupCgroup(cgroupPath, net_clsPath, pids) {
        try {
            const procsResult = await (0, utils_1.runSudoCommand)('cat', [`${cgroupPath}/cgroup.procs`]);
            const procs = procsResult.stdout.trim().split('\n').filter(Boolean);
            for (const proc of procs) {
                try {
                    await (0, utils_1.runSudoCommand)('bash', ['-c', `echo ${proc} >> ${net_clsPath}/cgroup.procs`]);
                }
                catch {
                    // Process may have exited
                }
            }
        }
        catch {
            // Cgroup may already be gone
        }
        try {
            await (0, utils_1.runSudoCommand)('rmdir', [cgroupPath]);
        }
        catch {
            // Cgroup may not be empty or already removed
        }
    }
    cleanupSync() {
        if (!this.config) {
            return;
        }
        const { cgroupPath, net_clsPath, iface, egress, ingress, iptablesRules, pids, } = this.config;
        try {
            this.cleanupIptablesSync(iptablesRules);
        }
        catch (e) {
            this.logCleanupError('iptables', e);
        }
        try {
            if (ingress) {
                this.cleanupIngressSync(iface, ingress);
            }
        }
        catch (e) {
            this.logCleanupError('ingress', e);
        }
        try {
            if (egress) {
                this.cleanupEgressSync(iface, egress);
            }
        }
        catch (e) {
            this.logCleanupError('egress', e);
        }
        try {
            this.cleanupCgroupSync(cgroupPath, net_clsPath, pids);
        }
        catch (e) {
            this.logCleanupError('cgroup', e);
        }
        this.config = null;
    }
    logCleanupError(component, error) {
        try {
            const msg = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[netslim] cleanup warning (${component}): ${msg}\n`);
        }
        catch {
            // If even stderr.write fails, just swallow
        }
    }
    cleanupIptablesSync(rules) {
        for (const rule of rules) {
            try {
                const parts = rule.split(' ');
                const table = parts[0];
                const chain = parts[1];
                const ruleArgs = ['-t', table, '-D', chain, ...parts.slice(2)];
                (0, utils_1.runSudoCommandSync)('iptables', ruleArgs);
            }
            catch {
                // Rule may already be gone
            }
        }
    }
    cleanupEgressSync(iface, egress) {
        const { rootQdiscHandle, classId, netemHandle, filterPrio, weCreatedRootQdisc } = egress;
        try {
            (0, utils_1.runSudoCommandSync)('tc', [
                'filter', 'del', 'dev', iface, 'parent', rootQdiscHandle,
                'prio', filterPrio.toString()
            ]);
        }
        catch {
            // Filter may already be gone
        }
        try {
            (0, utils_1.runSudoCommandSync)('tc', [
                'qdisc', 'del', 'dev', iface, 'parent', classId, 'handle', netemHandle
            ]);
        }
        catch {
            // Netem may not exist
        }
        try {
            (0, utils_1.runSudoCommandSync)('tc', [
                'class', 'del', 'dev', iface, 'parent', rootQdiscHandle, 'classid', classId
            ]);
        }
        catch {
            // Class may already be gone
        }
        if (weCreatedRootQdisc) {
            try {
                const classesResult = (0, utils_1.runSudoCommandSync)('tc', ['class', 'show', 'dev', iface, 'parent', rootQdiscHandle]);
                const classCount = (classesResult.stdout.match(/class\s+\S+:\d+/g) || []).length;
                if (classCount <= 1) {
                    (0, utils_1.runSudoCommandSync)('tc', ['qdisc', 'del', 'dev', iface, 'root']);
                }
            }
            catch {
                // Ignore
            }
        }
    }
    cleanupIngressSync(iface, ingress) {
        const { ifbName, weCreatedIfb, ifbRootQdiscHandle, ifbClassId, ifbNetemHandle, ingressFilterPrio, ifbFilterPrio, ports, } = ingress;
        const totalPortFilters = ports.tcp.length + ports.udp.length;
        for (let i = 0; i < totalPortFilters; i++) {
            try {
                (0, utils_1.runSudoCommandSync)('tc', [
                    'filter', 'del', 'dev', iface, 'parent', 'ffff:',
                    'prio', (ingressFilterPrio + i).toString()
                ]);
            }
            catch {
                // Filter may already be gone
            }
        }
        try {
            (0, utils_1.runSudoCommandSync)('tc', [
                'qdisc', 'del', 'dev', ifbName, 'parent', ifbClassId, 'handle', ifbNetemHandle
            ]);
        }
        catch {
            // Netem may not exist
        }
        try {
            (0, utils_1.runSudoCommandSync)('tc', [
                'filter', 'del', 'dev', ifbName, 'parent', ifbRootQdiscHandle,
                'prio', ifbFilterPrio.toString()
            ]);
        }
        catch {
            // Filter may already be gone
        }
        try {
            (0, utils_1.runSudoCommandSync)('tc', [
                'class', 'del', 'dev', ifbName, 'parent', ifbRootQdiscHandle, 'classid', ifbClassId
            ]);
        }
        catch {
            // Class may already be gone
        }
        try {
            const classesResult = (0, utils_1.runSudoCommandSync)('tc', ['class', 'show', 'dev', ifbName, 'parent', ifbRootQdiscHandle]);
            const classCount = (classesResult.stdout.match(/class\s+\S+:\d+/g) || []).length;
            if (classCount <= 1) {
                (0, utils_1.runSudoCommandSync)('tc', ['qdisc', 'del', 'dev', ifbName, 'root']);
            }
        }
        catch {
            // Ignore
        }
        if (weCreatedIfb) {
            try {
                const result = (0, utils_1.runSudoCommandSync)('tc', ['qdisc', 'show', 'dev', ifbName, 'root']);
                if (!result.stdout.trim()) {
                    (0, utils_1.runSudoCommandSync)('ip', ['link', 'set', 'down', 'dev', ifbName]);
                    (0, utils_1.runSudoCommandSync)('ip', ['link', 'del', ifbName]);
                }
            }
            catch {
                // Ignore
            }
        }
        try {
            const ingressQdiscResult = (0, utils_1.runSudoCommandSync)('tc', ['qdisc', 'show', 'dev', iface, 'ingress']);
            const filtersResult = (0, utils_1.runSudoCommandSync)('tc', ['filter', 'show', 'dev', iface, 'parent', 'ffff:']);
            if (ingressQdiscResult.stdout.includes('ingress') && !filtersResult.stdout.trim()) {
                (0, utils_1.runSudoCommandSync)('tc', ['qdisc', 'del', 'dev', iface, 'ingress']);
            }
        }
        catch {
            // Ignore
        }
    }
    cleanupCgroupSync(cgroupPath, net_clsPath, pids) {
        try {
            const procsResult = (0, utils_1.runSudoCommandSync)('cat', [`${cgroupPath}/cgroup.procs`]);
            const procs = procsResult.stdout.trim().split('\n').filter(Boolean);
            for (const proc of procs) {
                try {
                    (0, utils_1.runSudoCommandSync)('bash', ['-c', `echo ${proc} >> ${net_clsPath}/cgroup.procs`]);
                }
                catch {
                    // Process may have exited
                }
            }
        }
        catch {
            // Cgroup may already be gone
        }
        try {
            (0, utils_1.runSudoCommandSync)('rmdir', [cgroupPath]);
        }
        catch {
            // Cgroup may not be empty or already removed
        }
    }
}
exports.LinuxBackend = LinuxBackend;
LinuxBackend.PRIO_START = 5000;
LinuxBackend.CLASS_MINOR_START = 100;
LinuxBackend.IFB_PREFIX = 'netslim';
//# sourceMappingURL=linux.js.map