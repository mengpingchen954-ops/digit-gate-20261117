import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function editorCall(name, args = {}, timeout = 15000) {
    let session;
    try { session = JSON.parse(await fs.readFile(path.join(root, 'tools/level-studio/data/editor-bridge.json'), 'utf8')); }
    catch { throw Error('请用 Cocos Creator 3.8.8 打开本工程，等待资源导入后打开 scene-1；项目自带的关卡工作台插件会自动连接。'); }
    if (path.resolve(session.projectPath).toLowerCase() !== root.toLowerCase()) throw Error('这是其他目录的旧连接，请在 Creator 中打开当前这份工程。');
    let response;
    try {
        response = await fetch(`http://127.0.0.1:${session.port}/call`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Bridge-Token': session.token },
            body: JSON.stringify({ projectPath: root, name, args }), signal: AbortSignal.timeout(timeout),
        });
    } catch { throw Error('未连接当前工程的 Creator，请打开工程并确认“数字门关卡工作台”项目插件已启用。'); }
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '编辑器执行失败');
    return result.data;
}
