"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
exports.runSudoCommand = runSudoCommand;
exports.runCommandSync = runCommandSync;
exports.runSudoCommandSync = runSudoCommandSync;
exports.runBashCommandSync = runBashCommandSync;
exports.runSudoBashCommandSync = runSudoBashCommandSync;
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
function runCommand(command, args, sudo = false) {
    try {
        if (sudo) {
            const fullCmd = args ? `sudo ${command} ${args.join(' ')}` : `sudo ${command}`;
            return execAsync(fullCmd);
        }
        if (args) {
            return execFileAsync(command, args);
        }
        return execAsync(command);
    }
    catch (error) {
        if (error instanceof Error) {
            const execError = error;
            return Promise.resolve({
                stdout: execError.stdout || '',
                stderr: execError.stderr || error.message,
            });
        }
        return Promise.reject(error);
    }
}
function runSudoCommand(command, args) {
    return runCommand(command, args, true);
}
function runCommandSync(command, args, sudo = false) {
    try {
        let stdout = '';
        let stderr = '';
        let success = true;
        const options = {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 3000,
        };
        try {
            if (sudo) {
                if (args && args.length > 0) {
                    const cmdArgs = ['-n', command, ...args];
                    const result = (0, child_process_1.spawnSync)('sudo', cmdArgs, options);
                    stdout = result.stdout || '';
                    stderr = result.stderr || '';
                    success = result.status === 0;
                }
                else {
                    const result = (0, child_process_1.spawnSync)('sudo', ['-n', 'bash', '-c', command], options);
                    stdout = result.stdout || '';
                    stderr = result.stderr || '';
                    success = result.status === 0;
                }
            }
            else {
                if (args && args.length > 0) {
                    const result = (0, child_process_1.spawnSync)(command, args, options);
                    stdout = result.stdout || '';
                    stderr = result.stderr || '';
                    success = result.status === 0;
                }
                else {
                    stdout = (0, child_process_1.execSync)(command, options);
                    success = true;
                }
            }
        }
        catch (error) {
            success = false;
            if (error && typeof error === 'object') {
                const e = error;
                if (typeof e.stdout === 'string')
                    stdout = e.stdout;
                else if (e.stdout)
                    stdout = e.stdout.toString();
                if (typeof e.stderr === 'string')
                    stderr = e.stderr;
                else if (e.stderr)
                    stderr = e.stderr.toString();
            }
        }
        return {
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            success,
        };
    }
    catch {
        return { stdout: '', stderr: '', success: false };
    }
}
function runSudoCommandSync(command, args) {
    return runCommandSync(command, args, true);
}
function runBashCommandSync(script) {
    return runCommandSync('bash', ['-c', script]);
}
function runSudoBashCommandSync(script) {
    return runCommandSync(`sudo -n bash -c '${script.replace(/'/g, "'\\''")}'`);
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