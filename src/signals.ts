import { NetworkController } from './controller';

const HARD_TIMEOUT_MS = 3000;
const hardExit = (code: number): never => {
  const proc = process as unknown as { _exit?: (code: number) => never };
  if (typeof proc._exit === 'function') {
    return proc._exit(code);
  }
  process.exit(code);
  throw new Error('unreachable');
};

export class SignalHandler {
  private controller: NetworkController;
  private isCleaningUp: boolean = false;
  private registered: boolean = false;
  private sigintCount: number = 0;
  private sigtermCount: number = 0;

  constructor(controller: NetworkController) {
    this.controller = controller;
  }

  setup(): void {
    if (this.registered) {
      return;
    }
    this.registered = true;

    process.on('SIGINT', this.handleSigInt.bind(this));
    process.on('SIGTERM', this.handleSigTerm.bind(this));
    process.on('SIGQUIT', this.handleSigQuit.bind(this));
    process.on('SIGHUP', this.handleSigHup.bind(this));

    process.on('uncaughtException', this.handleUncaughtException.bind(this));
    process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));

    process.on('exit', this.handleExit.bind(this));
  }

  private printCleanupBanner(signal: string): void {
    try {
      process.stdout.write(
        `\r\n[netslim] Received ${signal}, synchronously restoring network configuration...\n`
      );
    } catch {
      // Ignore
    }
  }

  private printSuccessBanner(): void {
    try {
      process.stdout.write('[netslim] Network configuration restored successfully.\n');
    } catch {
      // Ignore
    }
  }

  private printFailureBanner(): void {
    try {
      process.stderr.write(
        '[netslim] WARNING: Some cleanup steps may have failed. ' +
        'Check your network configuration manually.\n'
      );
    } catch {
      // Ignore
    }
  }

  private startHardExitTimer(signal: string): NodeJS.Timeout {
    return setTimeout(() => {
      try {
        process.stderr.write(
          `\n[netslim] FATAL: Cleanup timed out after ${HARD_TIMEOUT_MS}ms. ` +
          `Forcing exit. You MUST check system state manually!\n` +
          `[netslim] Hint: Run: sudo tc qdisc show; sudo iptables -t mangle -S; sudo ip link show type ifb\n`
        );
      } catch {
        // Ignore
      }
      hardExit(128 + this.signalToNumber(signal));
    }, HARD_TIMEOUT_MS).unref();
  }

  private signalToNumber(signal: string): number {
    const map: Record<string, number> = {
      SIGINT: 2,
      SIGTERM: 15,
      SIGQUIT: 3,
      SIGHUP: 1,
    };
    return map[signal] || 15;
  }

  private performSyncCleanup(signal: string): void {
    if (this.isCleaningUp) {
      return;
    }
    this.isCleaningUp = true;

    this.printCleanupBanner(signal);

    const hardTimer = this.startHardExitTimer(signal);

    try {
      const success = this.controller.emergencyRestoreSync();
      if (success) {
        this.printSuccessBanner();
      } else {
        this.printFailureBanner();
      }
    } catch (e) {
      try {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[netslim] Cleanup exception: ${msg}\n`);
      } catch {
        // Ignore
      }
      this.printFailureBanner();
    } finally {
      clearTimeout(hardTimer);
    }
  }

  private handleSigInt(): void {
    this.sigintCount++;

    if (this.sigintCount >= 3) {
      try {
        process.stderr.write(
          '\r[netslim] Third Ctrl+C received. FORCE EXITING WITHOUT CLEANUP!\n' +
          '[netslim] Run these commands to fix your network:\n' +
          '[netslim]   sudo tc qdisc del dev <IFACE> root\n' +
          '[netslim]   sudo iptables -t mangle -F\n' +
          '[netslim]   sudo ip link del netslim0 (if exists)\n'
        );
      } catch {
        // Ignore
      }
      hardExit(130);
    }

    if (this.isCleaningUp && this.sigintCount >= 2) {
      try {
        process.stdout.write(
          '\r[netslim] Cleanup in progress... press Ctrl+C one more time to FORCE EXIT (UNSAFE)\n'
        );
      } catch {
        // Ignore
      }
      return;
    }

    this.performSyncCleanup('SIGINT');
    process.exit(130);
  }

  private handleSigTerm(): void {
    this.sigtermCount++;

    if (this.isCleaningUp) {
      return;
    }

    this.performSyncCleanup('SIGTERM');
    process.exit(143);
  }

  private handleSigQuit(): void {
    if (this.isCleaningUp) {
      return;
    }

    this.performSyncCleanup('SIGQUIT');
    process.exit(131);
  }

  private handleSigHup(): void {
    if (this.isCleaningUp) {
      return;
    }

    this.performSyncCleanup('SIGHUP');
    process.exit(129);
  }

  private handleUncaughtException(error: Error): void {
    try {
      process.stderr.write(`\n[netslim] UNCAUGHT EXCEPTION: ${error.message}\n`);
      if (error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
    } catch {
      // Ignore
    }

    try {
      this.performSyncCleanup('uncaughtException');
    } catch {
      // Swallow - already in crash handler
    }

    hardExit(70);
  }

  private handleUnhandledRejection(reason: unknown): void {
    try {
      const msg = reason instanceof Error ? reason.message : String(reason);
      process.stderr.write(`\n[netslim] UNHANDLED REJECTION: ${msg}\n`);
    } catch {
      // Ignore
    }

    try {
      this.performSyncCleanup('unhandledRejection');
    } catch {
      // Swallow
    }

    hardExit(70);
  }

  private handleExit(code: number): void {
    if (!this.isCleaningUp && this.registered) {
      try {
        process.stderr.write(
          `\n[netslim] Process exiting with code ${code} before cleanup was triggered. ` +
          `Attempting emergency restore...\n`
        );
      } catch {
        // Ignore
      }

      try {
        this.controller.emergencyRestoreSync();
      } catch {
        // Do not throw in exit handler
      }
    }

    this.isCleaningUp = true;
  }

  remove(): void {
    if (!this.registered) {
      return;
    }

    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGQUIT');
    process.removeAllListeners('SIGHUP');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('exit');

    this.registered = false;
  }
}
