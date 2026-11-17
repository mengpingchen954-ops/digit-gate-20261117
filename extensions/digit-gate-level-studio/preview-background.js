'use strict';
const { app, webContents } = require('electron');

// Creator 3.8.8 的 Game WebView 首帧前是透明的，会露出默认白底。
// 只设置编辑器游戏预览底色，不修改引擎安装、场景相机或发布网页。
const css = 'html, body, #GameCanvas { background-color: #303030 !important; }';
const pages = new Map();

function watch(page) {
    if (page.getType() !== 'webview' || pages.has(page)) return;
    const entry = { key: null, ready: null, destroyed: null };
    entry.ready = async () => {
        if (page.isDestroyed()) return;
        const url = page.getURL();
        if (!url.startsWith('packages://scene/static/template/3d-webview.html?') || !url.endsWith('preview.js')) return;
        try { entry.key = await page.insertCSS(css); }
        catch (error) { if (!page.isDestroyed()) console.warn('[关卡工作台] 预览底色设置失败：', error); }
    };
    entry.destroyed = () => pages.delete(page);
    pages.set(page, entry);
    page.on('dom-ready', entry.ready);
    page.once('destroyed', entry.destroyed);
    void entry.ready();
}

function created(_event, page) { watch(page); }

exports.load = () => {
    app.on('web-contents-created', created);
    webContents.getAllWebContents().forEach(watch);
};

exports.unload = () => {
    app.off('web-contents-created', created);
    for (const [page, entry] of pages) {
        page.off('dom-ready', entry.ready);
        page.off('destroyed', entry.destroyed);
        if (entry.key && !page.isDestroyed()) void page.removeInsertedCSS(entry.key).catch(() => {});
    }
    pages.clear();
};
