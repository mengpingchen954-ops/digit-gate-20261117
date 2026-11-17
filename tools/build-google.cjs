const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const JSZip = require('../extensions/super-html/node_modules/jszip');
const finalize = require("./finalize-google.cjs");
const root = path.resolve(__dirname, '..');
const config = require('../package-build.config.json');
const channel = process.argv[2] || 'google';
if (!['google', 'applovin'].includes(channel) || !config.channels.includes(channel)) throw Error('未配置的构建渠道：' + channel);
const channelName = channel === 'applovin' ? 'AppLovin' : 'Google';
const creator = require('./find-creator.cjs')();
const build = path.join(root, 'build');
const output = path.resolve(root, config.outputs?.[channel] || config.output);
const logs = path.join(root, 'temp', channel + '-build');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(root, 'tools/backups', channel + '-build-' + stamp);
const bytesIn = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? bytesIn(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const imageBytesIn = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? imageBytesIn(path.join(dir, e.name)) : /\.(png|jpe?g|webp)$/i.test(e.name) ? fs.statSync(path.join(dir, e.name)).size : 0), 0);

async function main() {
    if (build !== path.join(root, 'build') || !output.startsWith(root + path.sep)) throw Error('构建/输出目录不在本项目内');
    fs.mkdirSync(logs, { recursive: true });
    if (fs.existsSync(build)) { fs.mkdirSync(backup, { recursive: true }); fs.renameSync(build, path.join(backup, 'build')); }
    const startedAt = new Date().toISOString();
    const args = ['--project', root, '--build', `configPath=${path.join(root, 'playable-build.json')}`];
    const log = fs.openSync(path.join(logs, 'cli.log'), 'w');
    console.log('Creator 开始完整构建，日志：' + path.join(logs, 'cli.log'));
    const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(creator, args, { cwd: root, windowsHide: true, stdio: ['ignore', log, log] });
        child.on('error', reject); child.on('exit', resolve);
    });
    fs.closeSync(log);
    const report = { command: [creator, ...args], startedAt, finishedAt: new Date().toISOString(), exitCode };
    fs.writeFileSync(path.join(logs, '构建记录.json'), JSON.stringify(report, null, 2));
    if (exitCode !== 36) throw Error(`Creator 构建失败，退出码 ${exitCode}`);
    const source = path.join(build, 'super-html', channel, 'digitgate_' + channel + '.zip');
    if (fs.statSync(source).mtimeMs < Date.parse(startedAt)) throw Error('SuperHTML 不是本轮生成的产物');
    const archive = await JSZip.loadAsync(fs.readFileSync(source));
    const entries = Object.keys(archive.files).filter(k => !archive.files[k].dir);
    if (!entries.includes('index.html') || entries.some(k => !['index.html', 'res.js'].includes(k))) throw Error('待核对的 SuperHTML 资源布局：' + entries.join(', '));
    let html = await archive.file('index.html').async('string');
    if (archive.file('res.js')) {
        const resourceTag = /<script src=['"]res\.js['"]><\/script>/;
        if (!resourceTag.test(html)) throw Error('未找到 res.js 入口');
        const resources = await archive.file('res.js').async('string');
        html = html.replace(resourceTag, () => '<script>' + resources + '</script>');
    }
    const optimized = await finalize(html);
    html = optimized.html;
    fs.writeFileSync(path.join(logs, 'SuperHTML资源优化.json'), JSON.stringify(optimized.report, null, 2));
    const bytes = Buffer.byteLength(html);
    Object.assign(report, { channel, html: config.name + '.html', htmlBytes: bytes, sourceImageBytes: imageBytesIn(path.join(root, 'assets')), webMobileBytes: bytesIn(path.join(build, 'web-mobile')), remainingBytes: 5000000 - bytes, sizePass: bytes <= 5000000, enforceSizeLimit: config.enforceSizeLimit, optimization: optimized.report, packagedAt: new Date().toISOString(), validation: 'pending' });
    if (config.enforceSizeLimit && !report.sizePass) {
        // 超限仍保留本轮原画质预览，不能拿上轮降质成品冒充本轮结果。
        const preview = path.join(logs, '原画质LZMA预览');
        fs.mkdirSync(preview, { recursive: true });
        fs.writeFileSync(path.join(preview, config.name + '.html'), html);
        fs.writeFileSync(path.join(preview, '构建记录.json'), JSON.stringify({ ...report, status: 'experimental-oversize' }, null, 2));
        throw Error(`${channelName} 包体超限：${bytes} B，超出 ${bytes - 5000000} B。原画质预览：${preview}`);
    }
    // 保留 SuperHTML 的资源和渠道适配，以单 HTML 的实际字节数验收。
    const zip = new JSZip(); zip.file(config.name + '.html', html);
    const zipData = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    if (await (await JSZip.loadAsync(zipData)).file(config.name + '.html').async('string') !== html) throw Error('ZIP 内容校验失败');
    fs.mkdirSync(output, { recursive: true });
    for (const name of [config.name + '.html', config.name + '.zip', '构建记录.json']) {
        const file = path.join(output, name);
        if (fs.existsSync(file)) { fs.mkdirSync(backup, { recursive: true }); fs.copyFileSync(file, path.join(backup, name), fs.constants.COPYFILE_EXCL); }
    }
    fs.writeFileSync(path.join(output, config.name + '.html'), html);
    fs.writeFileSync(path.join(output, config.name + '.zip'), zipData);
    Object.assign(report, { channel, html: config.name + '.html', zip: config.name + '.zip', htmlBytes: bytes, zipBytes: zipData.length, webMobileBytes: bytesIn(path.join(build, 'web-mobile')), enforceSizeLimit: config.enforceSizeLimit, validation: 'pending' });
    fs.writeFileSync(path.join(output, '构建记录.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
