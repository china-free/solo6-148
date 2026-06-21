import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { Platform } from './types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args?: string[],
  sudo: boolean = false
): Promise<ExecResult> {
  try {
    if (sudo) {
      const fullCmd = args ? `sudo ${command} ${args.join(' ')}` : `sudo ${command}`;
      return await execAsync(fullCmd);
    }
    if (args) {
      return await execFileAsync(command, args);
    }
    return await execAsync(command);
  } catch (error) {
    if (error instanceof Error) {
      const execError = error as { stdout?: string; stderr?: string };
      return {
        stdout: execError.stdout || '',
        stderr: execError.stderr || error.message,
      };
    }
    throw error;
  }
}

export async function runSudoCommand(
  command: string,
  args?: string[]
): Promise<ExecResult> {
  return runCommand(command, args, true);
}

export function getPlatform(): Platform {
  const platform = process.platform;
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'darwin';
  if (platform === 'win32') return 'win32';
  return 'unknown';
}

export async function checkRoot(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const result = await execAsync('net session');
      return result.stderr === '';
    }
    const getuid = (process as { getuid?: () => number }).getuid;
    return getuid ? getuid() === 0 : false;
  } catch {
    return false;
  }
}

export function bpsToRate(bps: number): string {
  if (bps === 0) return '0bit';
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

export function msToTime(ms: number): string {
  return `${ms}ms`;
}

export function percentToString(value: number): string {
  return `${value}%`;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    const result = await execAsync(`which ${command} || command -v ${command}`);
    return result.stdout.trim() !== '';
  } catch {
    return false;
  }
}

export async function getDefaultInterface(): Promise<string> {
  const platform = getPlatform();
  
  try {
    if (platform === 'linux') {
      const result = await execAsync("ip route | grep default | awk '{print $5}' | head -1");
      const iface = result.stdout.trim();
      if (iface) return iface;
    } else if (platform === 'darwin') {
      const result = await execAsync("route -n get default | grep interface | awk '{print $2}'");
      const iface = result.stdout.trim();
      if (iface) return iface;
    }
  } catch {
    // Fall through to defaults
  }
  
  return platform === 'linux' ? 'eth0' : 'en0';
}

export function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function parseFloatValue(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = global.parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}
