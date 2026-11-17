'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const previewBackground = require('./preview-background');
const bridge = require('./bridge');
exports.load = () => { previewBackground.load(); bridge.load(); };
exports.unload = () => { bridge.unload(); previewBackground.unload(); };
exports.methods = {
    async open() {
        const projectRoot = path.resolve(Editor.Project.path);
        const launcher = path.join(projectRoot, 'tools', 'level-studio', 'launch.ps1');
        if (!fs.existsSync(launcher)) throw new Error('当前项目缺少关卡工作台启动脚本。');
        return new Promise((resolve, reject) => {
            // 等启动脚本完成并收集错误，不把拿到 PID 当成启动成功。
            const child = spawn('powershell.exe', [
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher,
            ], { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data.toString(); });
            child.stderr.on('data', data => { output += data.toString(); });
            child.once('error', reject);
            child.once('exit', code => {
                if (code === 0) resolve({ pid: child.pid, launcher, output });
                else reject(new Error(`工作台启动失败 (${code}): ${output}`));
            });
        });
    },
};
