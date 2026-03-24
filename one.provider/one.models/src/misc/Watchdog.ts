import {OEvent} from './OEvent.js';

/**
 * This is a software based watchdog.
 *
 * It fires the onTimeout event when a specified amount of time has passed before it was reset.
 *
 * At the beginning the watchdog is not enabled. You have to call enable() in order for it to
 * work. If you change the timeout after the watchdag was enabled the new timeout will be used
 * only after the next restart call.
 *
 * Future improvement:
 * Just using setTimeout has the drawback, that if the main event loop gets stuck e.g. in the
 * I/O phase, then the timeout won't fire until it is unstuck. This can be improved, by also
 * scheduling a check in the I/O phase and the Immediate phase of the event loop. But this would
 * require more resources and would make the code much more complex.
 */
export default class Watchdog {
    public timeout: number;
    private timeoutHandle: number | null = null;
    public onTimeout = new OEvent<() => void>();

    constructor(timeout: number) {
        this.timeout = timeout;
    }

    /**
     * Restart the timout, thus preventing the onTimeout event for another this.timeout msecs.
     */
    public restart(): void {
        if (!this.enabled()) {
            throw new Error('Wathdog was not started.');
        }

        this.cancelTimeout();
        this.setTimeout();
    }

    /**
     * Enable the watchdog.
     *
     * @throws Error - If watchdog is already enabled.
     */
    public enable(): void {
        if (this.enabled()) {
            throw new Error('Watchdog is already enabled.');
        }

        this.setTimeout();
    }

    /**
     * Disable the watchdog.
     *
     * It never throws.
     */
    public disable(): void {
        if (this.enabled()) {
            this.cancelTimeout();
        }
    }

    /**
     * Check if watchdog is enabled.
     */
    public enabled(): boolean {
        return this.timeoutHandle !== null;
    }

    /**
     * Schedules another timeout.
     */
    private setTimeout() {
        if (this.timeoutHandle) {
            throw new Error(
                'Programming error: Tried to start a timeout without cancelling the previous one.'
            );
        }
        this.timeoutHandle = setTimeout(() => {
            this.onTimeout.emit();
        }, this.timeout) as unknown as number;
    }

    /**
     * Cancels the timeout.
     */
    private cancelTimeout() {
        if (!this.timeoutHandle) {
            throw new Error('Programming error: tried to cancel a non running timeout.');
        }
        clearTimeout(this.timeoutHandle);
        this.timeoutHandle = null;
    }
}
