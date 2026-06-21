import { NetworkController } from './controller';

export class SignalHandler {
  private controller: NetworkController;
  private isCleaningUp: boolean = false;
  private cleanupTimeout: NodeJS.Timeout | null = null;

  constructor(controller: NetworkController) {
    this.controller = controller;
  }

  setup(): void {
    process.on('SIGINT', this.handleSignal.bind(this, 'SIGINT'));
    process.on('SIGTERM', this.handleSignal.bind(this, 'SIGTERM'));
    process.on('SIGQUIT', this.handleSignal.bind(this, 'SIGQUIT'));
    process.on('SIGHUP', this.handleSignal.bind(this, 'SIGHUP'));

    process.on('uncaughtException', this.handleUncaughtException.bind(this));
    process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));

    process.on('exit', this.handleExit.bind(this));
  }

  private async handleSignal(signal: string): Promise<void> {
    if (this.isCleaningUp) {
      console.log('\n⚠️  Forcing exit...');
      process.exit(1);
    }

    this.isCleaningUp = true;
    console.log(`\n📡 Received ${signal}, cleaning up network rules...`);

    this.cleanupTimeout = setTimeout(() => {
      console.error('❌ Cleanup timeout, forcing exit');
      process.exit(1);
    }, 5000);

    try {
      await this.controller.cleanup();
      console.log('✅ Network rules cleaned up successfully');
    } catch (error) {
      console.error('❌ Error during cleanup:', error instanceof Error ? error.message : String(error));
    } finally {
      if (this.cleanupTimeout) {
        clearTimeout(this.cleanupTimeout);
      }
      process.exit(0);
    }
  }

  private handleUncaughtException(error: Error): void {
    console.error('❌ Uncaught Exception:', error.message);
    console.error(error.stack);
    this.forceCleanupAndExit(1);
  }

  private handleUnhandledRejection(reason: unknown): void {
    console.error('❌ Unhandled Rejection:', reason instanceof Error ? reason.message : String(reason));
    this.forceCleanupAndExit(1);
  }

  private handleExit(code: number): void {
    if (!this.isCleaningUp) {
      console.log(`\n📡 Process exiting with code ${code}, attempting cleanup...`);
      try {
        this.controller.cleanup();
      } catch {
        // Ignore errors in exit handler
      }
    }
  }

  private async forceCleanupAndExit(code: number): Promise<void> {
    if (this.isCleaningUp) {
      process.exit(code);
    }

    this.isCleaningUp = true;
    try {
      await this.controller.cleanup();
    } catch {
      // Ignore cleanup errors
    }
    process.exit(code);
  }

  remove(): void {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGQUIT');
    process.removeAllListeners('SIGHUP');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('exit');

    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
    }
  }
}
