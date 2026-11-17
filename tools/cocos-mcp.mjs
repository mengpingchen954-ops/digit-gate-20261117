import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editorCall } from './editor-bridge-client.mjs';

// 保留工具调用接口，连接已改为项目自带插件，不再依赖外部 Funplay 安装。
export async function callMcp(name, args = {}) {
    return { ok: true, data: await editorCall(name, args, 60000) };
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
    const [name = 'get_editor_state', arg = '{}'] = process.argv.slice(2);
    const args = name === 'scene' || name === 'editor' ? { context: name, code: await fs.readFile(arg, 'utf8') } : JSON.parse(arg);
    console.log(JSON.stringify(await callMcp(name === 'scene' || name === 'editor' ? 'execute_javascript' : name, args), null, 2));
}
