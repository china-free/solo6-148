import { NetworkController } from './controller';
export declare class SignalHandler {
    private controller;
    private isCleaningUp;
    private registered;
    private sigintCount;
    private sigtermCount;
    constructor(controller: NetworkController);
    setup(): void;
    private printCleanupBanner;
    private printSuccessBanner;
    private printFailureBanner;
    private startHardExitTimer;
    private signalToNumber;
    private performSyncCleanup;
    private handleSigInt;
    private handleSigTerm;
    private handleSigQuit;
    private handleSigHup;
    private handleUncaughtException;
    private handleUnhandledRejection;
    private handleExit;
    remove(): void;
}
