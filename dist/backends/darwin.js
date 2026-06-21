"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DarwinBackend = void 0;
const fs_1 = require("fs");
const utils_1 = require("../utils");
const process_1 = require("../process");
class DarwinBackend {
    constructor() {
        this.platform = 'darwin';
        this.config = null;
    }
    async isAvailable() {
        const [pfctlExists, dnctlExists] = await Promise.all([
            (0, utils_1.commandExists)('pfctl'),
            (0, utils_1.commandExists)('dnctl'),
        ]);
        return pfctlExists && dnctlExists;
    }
    async checkRoot() {
        return (0, utils_1.checkRoot)();
    }
    getNextPipeNumber() {
        let pipe = DarwinBackend.PIPE_START;
        while (DarwinBackend.usedPipes.has(pipe)) {
            pipe++;
        }
        DarwinBackend.usedPipes.add(pipe);
        return pipe;
    }
    releasePipeNumber(pipe) {
        DarwinBackend.usedPipes.delete(pipe);
    }
    async isPfEnabled() {
        try {
            const result = await (0, utils_1.runSudoCommand)('pfctl', ['-s', 'info']);
            return result.stdout.includes('Status: Enabled');
        }
        catch {
            return false;
        }
    }
    async getPfRules() {
        try {
            const result = await (0, utils_1.runSudoCommand)('pfctl', ['-s', 'rules']);
            return result.stdout;
        }
        catch {
            return '';
        }
    }
    profileToDnctlArgs(profile) {
        const minBandwidth = Math.min(profile.bandwidth.download, profile.bandwidth.upload);
        return {
            bandwidth: (0, utils_1.bpsToRate)(minBandwidth),
            delay: profile.latency > 0 ? (0, utils_1.msToTime)(profile.latency) : '0ms',
            loss: (0, utils_1.percentToString)(profile.packetLoss),
        };
    }
    async apply(pid, profile) {
        if (!await this.checkRoot()) {
            throw new Error('Root privileges required. Please run with sudo.');
        }
        if (!await (0, process_1.processExists)(pid)) {
            throw new Error(`Process ${pid} does not exist`);
        }
        const iface = await (0, utils_1.getDefaultInterface)();
        const pipeNumber = this.getNextPipeNumber();
        const pfRulesFile = `/tmp/netslim_${(0, utils_1.generateId)()}.pf`;
        const allPids = [pid, ...await (0, process_1.getChildPids)(pid)];
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
        await (0, utils_1.sleep)(100);
    }
    async getAllPorts(pids) {
        const tcp = new Set();
        const udp = new Set();
        for (const pid of pids) {
            const ports = await (0, process_1.getProcessPorts)(pid);
            ports.tcp.forEach(p => tcp.add(p));
            ports.udp.forEach(p => udp.add(p));
        }
        return {
            tcp: Array.from(tcp),
            udp: Array.from(udp),
        };
    }
    async createDnctlPipe(pipeNumber, args) {
        await (0, utils_1.runSudoCommand)('dnctl', [
            'pipe', pipeNumber.toString(), 'config',
            'bw', args.bandwidth,
            'delay', args.delay,
            'plr', args.loss,
        ]);
    }
    createPfRules(rulesFile, pipeNumber, ports, iface, profile) {
        const rules = [];
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
        (0, fs_1.writeFileSync)(rulesFile, content);
    }
    async applyPfRules(rulesFile) {
        await (0, utils_1.runSudoCommand)('pfctl', ['-e']);
        await (0, utils_1.runSudoCommand)('pfctl', ['-f', rulesFile]);
    }
    async cleanup() {
        if (!this.config) {
            return;
        }
        const { pipeNumber, pfRulesFile, originalPfEnabled } = this.config;
        try {
            if ((0, fs_1.existsSync)(pfRulesFile)) {
                (0, fs_1.unlinkSync)(pfRulesFile);
            }
        }
        catch (e) {
            // Ignore cleanup errors
        }
        try {
            if (!originalPfEnabled) {
                await (0, utils_1.runSudoCommand)('pfctl', ['-d']);
            }
            else {
                await (0, utils_1.runSudoCommand)('pfctl', ['-f', '/etc/pf.conf']);
            }
        }
        catch (e) {
            // Ignore cleanup errors
        }
        try {
            await (0, utils_1.runSudoCommand)('dnctl', ['-q', 'flush']);
        }
        catch (e) {
            // Ignore cleanup errors
        }
        try {
            await (0, utils_1.runSudoCommand)('dnctl', ['pipe', pipeNumber.toString(), 'delete']);
        }
        catch (e) {
            // Ignore cleanup errors
        }
        this.releasePipeNumber(pipeNumber);
        this.config = null;
    }
    cleanupSync() {
        if (!this.config) {
            return;
        }
        const { pipeNumber, pfRulesFile, originalPfEnabled } = this.config;
        try {
            if ((0, fs_1.existsSync)(pfRulesFile)) {
                try {
                    (0, fs_1.unlinkSync)(pfRulesFile);
                }
                catch {
                    // Ignore
                }
            }
        }
        catch {
            // Ignore
        }
        try {
            if (!originalPfEnabled) {
                (0, utils_1.runSudoCommandSync)('pfctl', ['-d']);
            }
            else {
                (0, utils_1.runSudoCommandSync)('pfctl', ['-f', '/etc/pf.conf']);
            }
        }
        catch {
            // Ignore cleanup errors
        }
        try {
            (0, utils_1.runSudoCommandSync)('dnctl', ['-q', 'flush']);
        }
        catch {
            // Ignore cleanup errors
        }
        try {
            (0, utils_1.runSudoCommandSync)('dnctl', ['pipe', pipeNumber.toString(), 'delete']);
        }
        catch {
            // Ignore cleanup errors
        }
        this.releasePipeNumber(pipeNumber);
        this.config = null;
    }
}
exports.DarwinBackend = DarwinBackend;
DarwinBackend.PIPE_START = 1000;
DarwinBackend.usedPipes = new Set();
//# sourceMappingURL=darwin.js.map