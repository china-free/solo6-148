export interface NetworkProfile {
  name: string;
  description: string;
  bandwidth: {
    download: number;
    upload: number;
  };
  latency: number;
  jitter: number;
  packetLoss: number;
  packetCorruption?: number;
  packetReordering?: number;
}

export interface NetemConfig {
  delay?: string;
  jitter?: string;
  loss?: string;
  corrupt?: string;
  reorder?: string;
  duplicate?: string;
}

export interface TBFConfig {
  rate: string;
  burst: string;
  latency: string;
}

export interface TrafficControlConfig {
  netem: NetemConfig;
  tbf: TBFConfig;
  interface: string;
  handle: string;
  parent: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  ports: number[];
  user: string;
  cmdline: string;
}

export type Platform = 'linux' | 'darwin' | 'win32' | 'unknown';

export interface Backend {
  platform: Platform;
  isAvailable(): Promise<boolean>;
  apply(pid: number, profile: NetworkProfile): Promise<void>;
  cleanup(): Promise<void>;
  cleanupSync(): void;
  checkRoot(): Promise<boolean>;
}

export interface CLIOptions {
  pid: number;
  profile: string;
  interface?: string;
  duration?: number;
  download?: number;
  upload?: number;
  latency?: number;
  jitter?: number;
  loss?: number;
  list?: boolean;
}

export type SignalHandler = () => Promise<void>;

export interface ProcessPorts {
  tcp: number[];
  udp: number[];
}
