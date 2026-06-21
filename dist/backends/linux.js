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
        const [tcExists, iptablesExists, hasCgroup] = await Promise.all([
            (0, utils_1.commandExists)('tc'),
            (0, utils_1.commandExists)('iptables'),
            this.checkCgroupAvailable(),
        ]);
        return tcExists && iptablesExists && hasCgroup;
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
    generateClassid() {
        const major = Math.floor(Math.random() * 1000) + 1;
        const minor = Math.floor(Math.random() * 1000) + 1;
        return `${major}:${minor}`;
    }
    generateFwmark() {
        return `0x${Math.floor(Math.random() * 0xFFFFFF + 1).toString(16).padStart(6, '0')}`;
    }
    profileToTcArgs(profile, direction) {
        const bandwidth = direction === 'download'
            ? profile.bandwidth.download
            : profile.bandwidth.upload;
        return {
            rate: (0, utils_1.bpsToRate)(bandwidth),
            burst: bandwidth > 0 ? `${Math.max(1500, Math.floor(bandwidth / 8 / 100))}b` : '1500b',
            delay: profile.latency > 0 ? (0, utils_1.msToTime)(profile.latency) : '0ms',
            jitter: profile.jitter > 0 ? (0, utils_1.msToTime)(profile.jitter) : '0ms',
            loss: (0, utils_1.percentToString)(profile.packetLoss),
            corrupt: (0, utils_1.percentToString)(profile.packetCorruption || 0),
            reorder: (0, utils_1.percentToString)(profile.packetReordering || 0),
        };
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
        const classid = this.generateClassid();
        const fwmark = this.generateFwmark();
        const cgroupName = `netslim_${(0, utils_1.generateId)()}`;
        const cgroupPath = `${net_clsPath}/${cgroupName}`;
        const handle = `1:${Math.floor(Math.random() * 100) + 10}`;
        await (0, utils_1.runSudoCommand)('mkdir', ['-p', cgroupPath]);
        await (0, utils_1.runSudoCommand)('bash', ['-c', `echo "${classid}" > ${cgroupPath}/net_cls.classid`]);
        const allPids = [pid, ...await (0, process_1.getChildPids)(pid)];
        for (const p of allPids) {
            await (0, utils_1.runSudoCommand)('bash', ['-c', `echo ${p} >> ${cgroupPath}/cgroup.procs`]);
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
        await (0, utils_1.sleep)(100);
    }
    async setupTrafficControl(iface, handle, fwmark, profile) {
        const args = this.profileToTcArgs(profile, 'download');
        const parentHandle = handle.split(':')[0] + ':';
        await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'add', 'dev', iface, 'root', 'handle', parentHandle, 'htb']);
        await (0, utils_1.runSudoCommand)('tc', [
            'class', 'add', 'dev', iface, 'parent', parentHandle, 'classid', handle,
            'htb', 'rate', args.rate, 'ceil', args.rate
        ]);
        const netemArgs = [
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
            await (0, utils_1.runSudoCommand)('tc', netemArgs);
        }
        await (0, utils_1.runSudoCommand)('tc', [
            'filter', 'add', 'dev', iface, 'parent', parentHandle, 'protocol', 'ip',
            'prio', '1', 'handle', fwmark, 'fw', 'flowid', handle
        ]);
    }
    async setupIptables(fwmark, classid) {
        const rules = [];
        await (0, utils_1.runSudoCommand)('iptables', [
            '-t', 'mangle', '-A', 'OUTPUT',
            '-m', 'cgroup', '--cgroup', classid,
            '-j', 'MARK', '--set-mark', fwmark
        ]);
        rules.push(`mangle OUTPUT -m cgroup --cgroup ${classid} -j MARK --set-mark ${fwmark}`);
        await (0, utils_1.runSudoCommand)('iptables', [
            '-t', 'mangle', '-A', 'INPUT',
            '-m', 'cgroup', '--cgroup', classid,
            '-j', 'MARK', '--set-mark', fwmark
        ]);
        rules.push(`mangle INPUT -m cgroup --cgroup ${classid} -j MARK --set-mark ${fwmark}`);
        await (0, utils_1.runSudoCommand)('iptables', [
            '-t', 'mangle', '-A', 'FORWARD',
            '-m', 'cgroup', '--cgroup', classid,
            '-j', 'MARK', '--set-mark', fwmark
        ]);
        rules.push(`mangle FORWARD -m cgroup --cgroup ${classid} -j MARK --set-mark ${fwmark}`);
        return rules;
    }
    async cleanup() {
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
                await (0, utils_1.runSudoCommand)('iptables', args);
            }
        }
        catch (e) {
            // Ignore cleanup errors
        }
        try {
            const result = await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'show', 'dev', iface]);
            if (result.stdout.includes('root')) {
                await (0, utils_1.runSudoCommand)('tc', ['qdisc', 'del', 'dev', iface, 'root']);
            }
        }
        catch (e) {
            // Ignore cleanup errors
        }
        try {
            const procs = await (0, utils_1.runSudoCommand)('cat', [`${cgroupPath}/cgroup.procs`]);
            for (const line of procs.stdout.trim().split('\n')) {
                if (line) {
                    await (0, utils_1.runSudoCommand)('bash', ['-c', `echo ${line} >> /sys/fs/cgroup/net_cls/cgroup.procs`]);
                }
            }
        }
        catch (e) {
            // Ignore cleanup errors
        }
        try {
            await (0, utils_1.runSudoCommand)('rmdir', [cgroupPath]);
        }
        catch (e) {
            // Ignore cleanup errors
        }
        try {
            await (0, utils_1.runSudoCommand)('iptables', ['-t', 'mangle', '-F']);
        }
        catch (e) {
            // Ignore cleanup errors
        }
        this.config = null;
    }
}
exports.LinuxBackend = LinuxBackend;
//# sourceMappingURL=linux.js.map