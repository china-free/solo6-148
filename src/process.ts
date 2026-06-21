import { exec } from 'child_process';
import { promisify } from 'util';
import { ProcessInfo, ProcessPorts, Platform } from './types';
import { getPlatform } from './utils';

const execAsync = promisify(exec);

export async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  const platform = getPlatform();
  
  try {
    if (platform === 'linux' || platform === 'darwin') {
      return await getUnixProcessInfo(pid);
    } else if (platform === 'win32') {
      return await getWindowsProcessInfo(pid);
    }
  } catch {
    // Process may not exist
  }
  
  return null;
}

async function getUnixProcessInfo(pid: number): Promise<ProcessInfo | null> {
  try {
    const [psResult, ports] = await Promise.all([
      execAsync(`ps -p ${pid} -o pid,user,comm,args`),
      getProcessPorts(pid),
    ]);
    
    const lines = psResult.stdout.trim().split('\n');
    if (lines.length < 2) return null;
    
    const match = lines[1].match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!match) return null;
    
    return {
      pid: parseInt(match[1], 10),
      user: match[2],
      name: match[3],
      cmdline: match[4],
      ports: [...ports.tcp, ...ports.udp],
    };
  } catch {
    return null;
  }
}

async function getWindowsProcessInfo(pid: number): Promise<ProcessInfo | null> {
  try {
    const [wmicResult, ports] = await Promise.all([
      execAsync(`wmic process where ProcessId=${pid} get Name,User,CommandLine /format:csv`),
      getProcessPorts(pid),
    ]);
    
    const lines = wmicResult.stdout.trim().split('\n');
    if (lines.length < 2) return null;
    
    const values = lines[1].split(',');
    if (values.length < 3) return null;
    
    return {
      pid,
      name: values[1] || '',
      user: values[2] || '',
      cmdline: values.slice(3).join(',') || '',
      ports: [...ports.tcp, ...ports.udp],
    };
  } catch {
    return null;
  }
}

export async function getProcessPorts(pid: number): Promise<ProcessPorts> {
  const platform = getPlatform();
  
  if (platform === 'linux') {
    return await getLinuxProcessPorts(pid);
  } else if (platform === 'darwin') {
    return await getMacProcessPorts(pid);
  } else if (platform === 'win32') {
    return await getWindowsProcessPorts(pid);
  }
  
  return { tcp: [], udp: [] };
}

async function getLinuxProcessPorts(pid: number): Promise<ProcessPorts> {
  const tcp: number[] = [];
  const udp: number[] = [];
  
  try {
    const result = await execAsync(`ss -tulnp 2>/dev/null | grep -E "pid=${pid}(,|\\s|$)"`);
    
    for (const line of result.stdout.trim().split('\n')) {
      if (!line) continue;
      
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      
      const protocol = parts[0];
      const localAddr = parts[3];
      
      const portMatch = localAddr.match(/:(\d+)$/);
      if (!portMatch) continue;
      
      const port = parseInt(portMatch[1], 10);
      if (protocol.includes('tcp')) {
        tcp.push(port);
      } else if (protocol.includes('udp')) {
        udp.push(port);
      }
    }
  } catch {
    try {
      const result = await execAsync(`lsof -i -P -n 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`);
      
      for (const line of result.stdout.trim().split('\n')) {
        if (!line) continue;
        
        const match = line.match(/(TCP|UDP).*:(\d+)/i);
        if (!match) continue;
        
        const port = parseInt(match[2], 10);
        if (match[1].toUpperCase() === 'TCP') {
          tcp.push(port);
        } else {
          udp.push(port);
        }
      }
    } catch {
      // Both commands failed
    }
  }
  
  return {
    tcp: [...new Set(tcp)],
    udp: [...new Set(udp)],
  };
}

async function getMacProcessPorts(pid: number): Promise<ProcessPorts> {
  const tcp: number[] = [];
  const udp: number[] = [];
  
  try {
    const result = await execAsync(`lsof -i -P -n 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`);
    
    for (const line of result.stdout.trim().split('\n')) {
      if (!line) continue;
      
      const match = line.match(/(TCP|UDP).*:(\d+)/i);
      if (!match) continue;
      
      const port = parseInt(match[2], 10);
      if (match[1].toUpperCase() === 'TCP') {
        tcp.push(port);
      } else {
        udp.push(port);
      }
    }
  } catch {
    // Command failed
  }
  
  return {
    tcp: [...new Set(tcp)],
    udp: [...new Set(udp)],
  };
}

async function getWindowsProcessPorts(pid: number): Promise<ProcessPorts> {
  const tcp: number[] = [];
  const udp: number[] = [];
  
  try {
    const result = await execAsync(`netstat -ano | findstr /R /C:":\\*" /C:":\\d"`);
    
    for (const line of result.stdout.trim().split('\n')) {
      if (!line) continue;
      
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      
      const protocol = parts[0];
      const localAddr = parts[1];
      const processId = parseInt(parts[parts.length - 1], 10);
      
      if (processId !== pid) continue;
      
      const portMatch = localAddr.match(/:(\d+)$/);
      if (!portMatch) continue;
      
      const port = parseInt(portMatch[1], 10);
      if (protocol.toUpperCase().includes('TCP')) {
        tcp.push(port);
      } else if (protocol.toUpperCase().includes('UDP')) {
        udp.push(port);
      }
    }
  } catch {
    // Command failed
  }
  
  return {
    tcp: [...new Set(tcp)],
    udp: [...new Set(udp)],
  };
}

export async function processExists(pid: number): Promise<boolean> {
  try {
    const info = await getProcessInfo(pid);
    return info !== null;
  } catch {
    return false;
  }
}

export async function getChildPids(pid: number): Promise<number[]> {
  const platform = getPlatform();
  const children: number[] = [];
  
  try {
    if (platform === 'linux' || platform === 'darwin') {
      const result = await execAsync(`pgrep -P ${pid} 2>/dev/null`);
      for (const line of result.stdout.trim().split('\n')) {
        const childPid = parseInt(line.trim(), 10);
        if (!isNaN(childPid)) {
          children.push(childPid);
          const grandChildren = await getChildPids(childPid);
          children.push(...grandChildren);
        }
      }
    } else if (platform === 'win32') {
      const result = await execAsync(`wmic process where ParentProcessId=${pid} get ProcessId /format:csv`);
      const lines = result.stdout.trim().split('\n');
      for (let i = 1; i < lines.length; i++) {
        const childPid = parseInt(lines[i].trim(), 10);
        if (!isNaN(childPid)) {
          children.push(childPid);
          const grandChildren = await getChildPids(childPid);
          children.push(...grandChildren);
        }
      }
    }
  } catch {
    // Command failed
  }
  
  return [...new Set(children)];
}

export async function getCgroupControllerPath(controller: string): Promise<string | null> {
  try {
    const result = await execAsync(`mount | grep cgroup | grep -E "(^|,)${controller}(,|$)" | head -1`);
    const match = result.stdout.match(/on\s+(\S+)\s+type/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
