import readline from 'readline';

export async function waitForKeyPress(message = 'press a key to continue'): Promise<void> {
    await new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(message, answer => resolve(answer));
    });
}
