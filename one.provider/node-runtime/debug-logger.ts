/**
 * Debug logger for Node.js that writes to App Group container
 * Provides persistent logs accessible without unified logging
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARNING = 'WARNING',
    ERROR = 'ERROR',
    CRITICAL = 'CRITICAL'
}

export class DebugLogger {
    private readonly logDirectory: string;
    private readonly logFileName: string;
    private readonly maxLogSize: number;
    private readonly maxLogFiles: number;

    /**
     * Initialize logger with App Group container path
     * @param component Component name (e.g., "node", "ipc")
     * @param appGroupIdentifier App Group identifier
     * @param maxLogSize Maximum size in bytes before rotation (default: 1MB)
     * @param maxLogFiles Maximum number of rotated log files to keep (default: 5)
     */
    constructor(
        component: string,
        appGroupIdentifier: string = 'group.com.one.filer',
        maxLogSize: number = 1_048_576,
        maxLogFiles: number = 5
    ) {
        const homeDir = os.homedir();
        const containerPath = path.join(homeDir, 'Library/Group Containers', appGroupIdentifier);
        this.logDirectory = path.join(containerPath, 'debug');
        this.logFileName = `${component}.log`;
        this.maxLogSize = maxLogSize;
        this.maxLogFiles = maxLogFiles;

        // Create debug directory if it doesn't exist
        try {
            fs.mkdirSync(this.logDirectory, {recursive: true});
        } catch (error) {
            // Try to write to stderr as fallback
            console.error(`[DebugLogger] Failed to create log directory: ${error}`);
        }
    }

    // MARK: - Logging Methods

    public log(level: LogLevel, message: string, file?: string, line?: number): void {
        const timestamp = new Date().toISOString();
        const location = file && line ? `[${file}:${line}]` : '';
        const logLine = `[${timestamp}] [${level}] ${location} ${message}\n`;

        this.write(logLine);
    }

    public info(message: string, file?: string, line?: number): void {
        this.log(LogLevel.INFO, message, file, line);
    }

    public debug(message: string, file?: string, line?: number): void {
        this.log(LogLevel.DEBUG, message, file, line);
    }

    public warning(message: string, file?: string, line?: number): void {
        this.log(LogLevel.WARNING, message, file, line);
    }

    public error(message: string, file?: string, line?: number): void {
        this.log(LogLevel.ERROR, message, file, line);
    }

    public critical(message: string, file?: string, line?: number): void {
        this.log(LogLevel.CRITICAL, message, file, line);
    }

    // MARK: - File Operations

    private write(content: string): void {
        const logFile = path.join(this.logDirectory, this.logFileName);

        try {
            // Check if log file needs rotation
            if (this.shouldRotate(logFile)) {
                this.rotateLogFile(logFile);
            }

            // Append to current log file
            fs.appendFileSync(logFile, content);
        } catch (error) {
            // Fallback to stderr if file write fails
            console.error(`[DebugLogger] Write failed: ${error}`);
            console.error(content);
        }
    }

    private shouldRotate(logFile: string): boolean {
        try {
            const stats = fs.statSync(logFile);
            return stats.size >= this.maxLogSize;
        } catch {
            return false;
        }
    }

    private rotateLogFile(logFile: string): void {
        try {
            // Remove oldest log file if we've hit the limit
            const oldestLog = path.join(
                this.logDirectory,
                `${this.logFileName}.${this.maxLogFiles}`
            );
            if (fs.existsSync(oldestLog)) {
                fs.unlinkSync(oldestLog);
            }

            // Shift existing rotated logs
            for (let i = this.maxLogFiles - 1; i >= 1; i--) {
                const oldPath = path.join(this.logDirectory, `${this.logFileName}.${i}`);
                const newPath = path.join(this.logDirectory, `${this.logFileName}.${i + 1}`);
                if (fs.existsSync(oldPath)) {
                    fs.renameSync(oldPath, newPath);
                }
            }

            // Rotate current log to .1
            const rotatedPath = path.join(this.logDirectory, `${this.logFileName}.1`);
            fs.renameSync(logFile, rotatedPath);
        } catch (error) {
            console.error(`[DebugLogger] Rotation failed: ${error}`);
        }
    }

    // MARK: - Utility Methods

    /**
     * Get path to current log file (for testing/inspection)
     */
    public getLogFilePath(): string {
        return path.join(this.logDirectory, this.logFileName);
    }

    /**
     * Get all log files (current + rotated)
     */
    public getAllLogFiles(): string[] {
        const files = [path.join(this.logDirectory, this.logFileName)];
        for (let i = 1; i <= this.maxLogFiles; i++) {
            const rotatedFile = path.join(this.logDirectory, `${this.logFileName}.${i}`);
            if (fs.existsSync(rotatedFile)) {
                files.push(rotatedFile);
            }
        }
        return files;
    }

    /**
     * Clear all log files
     */
    public clearLogs(): void {
        for (const file of this.getAllLogFiles()) {
            try {
                fs.unlinkSync(file);
            } catch {
                // Ignore errors
            }
        }
    }
}
