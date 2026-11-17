const fs = require('node:fs');
const path = require('node:path');
module.exports = function findCreator() {
    const root = path.resolve(__dirname, '..');
    let session;
    try { session = JSON.parse(fs.readFileSync(path.join(__dirname, 'level-studio/data/editor-bridge.json'), 'utf8')); } catch {}
    const candidates = [process.env.COCOS_CREATOR];
    if (session?.projectPath && path.resolve(session.projectPath).toLowerCase() === root.toLowerCase()) candidates.push(session.creatorPath);
    for (const base of [process.env.ProgramData, process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)) {
        candidates.push(path.join(base, 'cocos/editors/Creator/3.8.8/CocosCreator.exe'));
    }
    const found = candidates.find(file => file && path.basename(file).toLowerCase() === 'cocoscreator.exe' && fs.existsSync(file));
    if (!found) throw Error('未找到 Creator 3.8.8。先用 Creator 打开本工程，项目插件会自动记录安装位置；也可设置 COCOS_CREATOR 环境变量。');
    return found;
};
