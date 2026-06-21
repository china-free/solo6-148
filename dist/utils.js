"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
exports.runSudoCommand = runSudoCommand;
exports.getPlatform = getPlatform;
exports.checkRoot = checkRoot;
exports.bpsToRate = bpsToRate;
exports.msToTime = msToTime;
exports.percentToString = percentToString;
exports.generateId = generateId;
exports.sleep = sleep;
exports.commandExists = commandExists;
exports.getDefaultInterface = getDefaultInterface;
exports.parseNumber = parseNumber;
exports.parseFloatValue = parseFloatValue;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function runCommand(command, args, sudo = false) {
    try {
        if (sudo) {
            const fullCmd = args ? `sudo ${command} ${args.join(' ')}` : `sudo ${command}`;
            return await execAsync(fullCmd);
        }
        if (args) {
            return await execFileAsync(command, args);
        }
        return await execAsync(command);
    }
    catch (error) {
        if (error instanceof Error) {
            const execError = error;
            return {
                stdout: execError.stdout || '',
                stderr: execError.stderr || error.message,
            };
        }
        throw error;
    }
}
async function runSudoCommand(command, args) {
    return runCommand(command, args, true);
}
function getPlatform() {
    const platform = process.platform;
    if (platform === 'linux')
        return 'linux';
    if (platform === 'darwin')
        return 'darwin';
    if (platform === 'win32')
        return 'win32';
    return 'unknown';
}
async function checkRoot() {
    try {
        if (process.platform === 'win32') {
            const result = await execAsync('net session');
            return result.stderr === '';
        }
        const getuid = process.getuid;
        return getuid ? getuid() === 0 : false;
    }
    catch {
        return false;
    }
}
function bpsToRate(bps) {
    if (bps === 0)
        return '0bit';
    if (bps >= 1024 * 1024 * 1024) {
        return `${Math.round(bps / (1024 * 1024 * 1024))}gbit`;
    }
    if (bps >= 1024 * 1024) {
        return `${Math.round(bps / (1024 * 1024))}mbit`;
    }
    if (bps >= 1024) {
        return `${Math.round(bps / 1024)}kbit`;
    }
    return `${bps}bit`;
}
function msToTime(ms) {
    return `${ms}ms`;
}
function percentToString(value) {
    return `${value}%`;
}
function generateId() {
    return Math.random().toString(36).substring(2, 10);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function commandExists(command) {
    try {
        const result = await execAsync(`which ${command} || command -v ${command}`);
        return result.stdout.trim() !== '';
    }
    catch {
        return false;
    }
}
async function getDefaultInterface() {
    const platform = getPlatform();
    try {
        if (platform === 'linux') {
            const result = await execAsync("ip route | grep default | awk '{print $5}' | head -1");
            const iface = result.stdout.trim();
            if (iface)
                return iface;
        }
        else if (platform === 'darwin') {
            const result = await execAsync("route -n get default | grep interface | awk '{print $2}'");
            const iface = result.stdout.trim();
            if (iface)
                return iface;
        }
    }
    catch {
        // Fall through to defaults
    }
    return platform === 'linux' ? 'eth0' : 'en0';
}
function parseNumber(value, defaultValue) {
    if (!value)
        return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}
function parseFloatValue(value, defaultValue) {
    if (!value)
        return defaultValue;
    const parsed = global.parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}
//# sourceMappingURL=utils.js.map