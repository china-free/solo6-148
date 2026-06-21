import { ProcessInfo, ProcessPorts } from './types';
export declare function getProcessInfo(pid: number): Promise<ProcessInfo | null>;
export declare function getProcessPorts(pid: number): Promise<ProcessPorts>;
export declare function processExists(pid: number): Promise<boolean>;
export declare function getChildPids(pid: number): Promise<number[]>;
export declare function getCgroupControllerPath(controller: string): Promise<string | null>;
