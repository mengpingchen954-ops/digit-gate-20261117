const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const sessionPath = path.join(__dirname, 'data/app-session.json');
const sameRoot = value => typeof value === 'string' && path.resolve(value).toLowerCase() === root.toLowerCase();
async function existing(port) {
    try {
        if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
        const url = `http://127.0.0.1:${port}/`;
        const state = await fetch(url + 'api/state', { signal: AbortSignal.timeout(1200) }).then(r => r.json());
        return sameRoot(state.projectPath) && state.apiVersion >= 11 ? url : null;
    } catch { return null; }
}
async function main() {
    let session;
    try { session = JSON.parse(fs.readFileSync(sessionPath, 'utf8')); } catch {}
    const url = await existing(sameRoot(session?.projectPath) ? session.port : 19321);
    if (url) return console.log(url);
    const logs = path.join(__dirname, 'data/logs'); fs.mkdirSync(logs, { recursive: true });
    const stdout = fs.openSync(path.join(logs, 'server.log'), 'a');
    const stderr = fs.openSync(path.join(logs, 'server-error.log'), 'a');
    const child = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr],
    });
    child.on('error', error => { throw error; }); child.unref(); fs.closeSync(stdout); fs.closeSync(stderr);
    for (let i = 0; i < 80; i++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        try { session = JSON.parse(fs.readFileSync(sessionPath, 'utf8')); } catch { continue; }
        if (!sameRoot(session.projectPath) || session.pid !== child.pid) continue;
        const ready = await existing(session.port);
        if (ready) return console.log(ready);
    }
    throw Error('APP did not start. See tools/level-studio/data/logs/server-error.log');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
