'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let server, session;
const descriptor = () => path.join(Editor.Project.path, 'tools/level-studio/data/editor-bridge.json');

// 项目自己的编辑器连接，仅在回环地址监听，调用须持有随机会话令牌。
exports.load = () => {
    // 命令行构建会启动另一个 Creator；不能覆盖正在编辑的会话连接。
    if (process.argv.includes('--build')) return;
    if (server) return;
    session = { projectPath: path.resolve(Editor.Project.path), creatorPath: process.execPath,
        version: Editor.App.version, pid: process.pid, token: crypto.randomBytes(32).toString('hex') };
    server = http.createServer(async (req, res) => {
        const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
        if (req.method !== 'POST' || req.url !== '/call' || req.headers.origin || req.headers['x-studio-bridge-token'] !== session.token) return reply(403, { error: 'Invalid local editor session' });
        try {
            let body = '';
            for await (const chunk of req) { body += chunk; if (body.length > 2 * 1024 * 1024) throw Error('Request too large'); }
            const { name, args = {}, projectPath } = JSON.parse(body);
            if (path.resolve(projectPath).toLowerCase() !== session.projectPath.toLowerCase()) throw Error('工作台与 Creator 工程不一致');
            let data;
            if (name === 'get_editor_state') data = { projectPath: session.projectPath, version: session.version };
            else if (name === 'execute_javascript' && typeof args.code === 'string') {
                if (args.context === 'editor') data = await new AsyncFunction('Editor', 'require', args.code)(Editor, require);
                else if (args.context === 'scene') data = { result: await Editor.Message.request('scene', 'execute-scene-script', { name: 'digit-gate-level-studio', method: 'execute', args: [args.code] }) };
                else throw Error('Unsupported editor context');
            } else throw Error('Unsupported project tool');
            reply(200, { data: data === undefined ? null : data });
        } catch (error) { reply(400, { error: error.message }); }
    });
    server.on('error', error => console.error('[关卡工作台] 编辑器连接启动失败', error));
    server.listen(0, '127.0.0.1', () => {
        session.port = server.address().port;
        fs.mkdirSync(path.dirname(descriptor()), { recursive: true });
        fs.writeFileSync(descriptor(), JSON.stringify(session, null, 2));
        console.log('[关卡工作台] 项目连接已就绪');
    });
};
exports.unload = () => {
    server?.close(); server = null;
    try { if (JSON.parse(fs.readFileSync(descriptor(), 'utf8')).token === session?.token) fs.unlinkSync(descriptor()); } catch {}
};
