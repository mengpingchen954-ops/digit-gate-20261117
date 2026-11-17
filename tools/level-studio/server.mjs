import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { editorCall, readSceneMap } from './editor.mjs';
import { modelImportRoute, modelImportBusy } from './model-import.mjs';
import { rewardPicturePreview } from './reward-picture-preview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '../..');
const configPath = path.join(root, 'assets/配置/数字门配置.json');
const dataDir = path.join(here, 'data');
const port = Number(process.env.DIGIT_GATE_STUDIO_PORT || 19321);
const token = crypto.randomBytes(24).toString('hex');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export function normalizeConfig(c) {
    c = structuredClone(c);
    c.levelFireIntervals ??= [0, 1, 2].map(i => (c.fireInterval ?? .38) / (1 + i * .12));
    delete c.fireInterval;
    // 门只用沿路线的间距；旧开场数量和定时生成间隔会造成接缝。
    delete c.gateInterval;
    if (c.gateLayout) delete c.gateLayout.initialCount;
    // 旧方案统一迁移为两种奖励，不再保留独立攻速覆盖值。
    for (const w of [...(c.rewards ?? []), ...(c.obstacles ?? [])]) {
        if (w.kind === 'tank') w.kind = 'soldier';
        delete w.fireInterval;
        if (w.kind !== 'weapon') delete w.power;
    }
    // 拖拽按参考道路比例换算，不再保留旧版的独立灵敏度字段。
    delete c.dragSensitivity;
    // 地图由 Creator 场景唯一管理，旧方案不再覆盖场景变换。
    delete c.scenery;
    // 老方案没有双端地址时沿用项目当前地址，不恢复旧版单一商店链接。
    c.storeUrls ??= JSON.parse(fs.readFileSync(configPath, 'utf8')).storeUrls;
    delete c.storeUrl;
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    c.leftGateCycle = { ...current.leftGateCycle, ...c.leftGateCycle,
        operation: c.leftGateCycle?.operation ?? c.gateLayout?.operation ?? 'add',
        value: c.leftGateCycle?.value ?? c.gateLayout?.value ?? 1 };
    c.planePosition = { z: current.planePosition?.z ?? 7.8, ...c.planePosition };
    c.planeIcon ??= '';
    c.planeIconScale ??= 1;
    c.rewardStone = { ...current.rewardStone, ...c.rewardStone,
        offset: { ...current.rewardStone.offset, ...c.rewardStone?.offset },
        size: { ...current.rewardStone.size, ...c.rewardStone?.size } };
    // 旧方案的共用层数迁移到每份奖励，之后各自独立保存。
    const legacyLayers = c.rewardStone.layers ?? 3;
    c.rewards?.forEach(w => { w.layers ??= legacyLayers; });
    c.planeLayers ??= legacyLayers;
    delete c.rewardStone.layers;
    c.retryLimit ??= current.retryLimit ?? 2;
    c.death ??= structuredClone(current.death);
    for (const [key, defaults] of Object.entries(current.death)) c.death[key] = { ...defaults, ...c.death[key] };
    c.effects = { ...current.effects, ...c.effects };
    c.bulletLifetime ??= current.bulletLifetime;
    c.enemyScale ??= current.enemyScale;
    c.enemyCombat ??= current.enemyCombat;
    c.bossCombat ??= { ...current.bossCombat, attackInterval: c.bossAttackInterval ?? current.bossCombat.attackInterval };
    // 老方案缺少逐波大小时，按外形沿用当前关卡的校准值。
    c.bosses?.forEach((w, i) => {
        w.scale ??= current.bosses[i]?.style === w.style ? current.bosses[i].scale : current.bosses.find(b => b.style === w.style)?.scale;
        // 旧方案的刷出时刻换算为开场纵向位置，保留原本的接近节奏。
        w.startZ ??= -4 - (w.time ?? 0) * w.speed;
        delete w.time;
    });
    delete c.bossAttackInterval;
    delete c.bossKillCount;
    return c;
}
const readConfig = () => { const text = fs.readFileSync(configPath, 'utf8'); return { config: normalizeConfig(JSON.parse(text)), revision: hash(text) }; };
function prefabAssets() {
    const result = [];
    const types = ['BossAnimationBinder', 'DigitGateFrameRenderer'].flatMap(name => {
        const uuid = JSON.parse(fs.readFileSync(path.join(root, `assets/TS/${name}.ts.meta`), 'utf8')).uuid;
        const hex = uuid.replaceAll('-', ''), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let compressed = hex.slice(0, 5);
        for (let i = 5; i < hex.length; i += 3) { const value = parseInt(hex.slice(i, i + 3), 16); compressed += alphabet[value >> 6] + alphabet[value & 63]; }
        return [uuid, compressed, name];
    });
    function walk(dir) { for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, n.name);
        if (n.isDirectory() && n.name !== '制作源资源') walk(file);
        else if (n.name.endsWith('.prefab') && fs.existsSync(file + '.meta')) {
            const meta = JSON.parse(fs.readFileSync(file + '.meta', 'utf8'));
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            // 必须是项目已绑定动画的角色预制体，不能把道路等资产当作士兵。
            const prefabRoot = data[data[0].data?.__id__];
            if (prefabRoot?._components?.some(ref => types.includes(data[ref.__id__]?.__type__))) result.push({ uuid: meta.uuid, name: path.relative(root, file).replaceAll('\\', '/') });
        }
    } }
    walk(path.join(root, 'assets')); return result;
}

export function validateConfig(c) {
    for (const key of ['android', 'ios']) {
        const value = c.storeUrls?.[key];
        let url; try { url = new URL(value); } catch { throw Error(`${key === 'ios' ? 'iOS' : '安卓'} 商店地址不是有效网址`); }
        if (typeof value !== 'string' || value.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('商店地址须为 http/https 网址，且不能包含账号密码');
    }
    const number = (value, label, min, max, integer = false) => {
        if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw Error(`${label}须为 ${min}～${max}${integer ? ' 的整数' : ' 的数字'}`);
    };
    const picture = (icon, scale, label) => {
        if (icon !== undefined && (typeof icon !== 'string' || (icon !== '' && !/^[a-f0-9-]{36}@[a-f0-9]{5}$/i.test(icon)))) throw Error(label+'图片无效，请从列表选择');
        if (scale !== undefined) number(scale, label+'图片大小', .1, 4);
    };
    picture(c.planeIcon, c.planeIconScale, '右侧奖励');
    const pictureTransform=(transform,label)=>{
        if(transform===undefined)return;
        if(!transform||typeof transform!=='object'||Array.isArray(transform))throw Error(label+'图片变换无效');
        for(const [key,axes,min,max] of [['offset',['x','y','z'],-10,10],['rotation',['x','y','z'],-360,360],['scale',['x','y'],.1,4]]){
            if(transform[key]===undefined)continue;
            for(const axis of axes)number(transform[key]?.[axis],label+'图片 '+key+'.'+axis,min,max);
        }
    };
    pictureTransform(c.planeIconTransform,'右侧奖励');
    for (const [key,label] of Object.entries({soldier1:'1级友军',soldier2:'2级友军',soldier3:'3级友军',enemy:'普通丧尸',boss1:'屠夫 Boss 类型 1',boss2:'屠夫 Boss 类型 2'})) {
        const rule=c.death?.[key];
        if (!rule || typeof rule.clip !== 'string' || rule.clip.length > 120) throw Error(label+'死亡动作名称无效');
        number(rule.speed,label+'死亡倍速',.1,10);
        number(rule.randomSpeed,label+'随机速度偏移',0,Math.max(0,rule.speed-.1));
        number(rule.holdSeconds,label+'倒地停留时间',0,30);
        number(rule.endPercent,label+'动作结束位置',10,100);
        if(typeof rule.whiteFlash!=='boolean') throw Error(label+'死亡变白开关无效');
    }
    number(c.effects?.hitFlashSeconds,'受击闪白时间',.01,2);
    number(c.effects.bulletScale,'子弹显示大小',.1,5);
    number(c.effects.bulletBrightness,'子弹亮度',.1,8);
    if (!Array.isArray(c.effects.upgradeColors) || c.effects.upgradeColors.length !== 3
        || c.effects.upgradeColors.some(v => typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))) {
        throw Error('升级 Shader 颜色必须是 3 个十六进制颜色');
    }
    for (const kind of ['landing', 'reward']) {
        number(c.effects[kind+'ShakeStrength'],'震屏强度',0,.5);
        number(c.effects[kind+'ShakeSeconds'],'震屏时长',0,1);
    }
    number(c.effects.rewardFlightSeconds,'奖励飞行时长',.05,5);
    number(c.effects.rewardFlightHeight,'奖励飞行弧线高度',0,10);
    const stone = c.rewardStone;
    number(c.planeLayers, '右侧飞机奖励石头层数', 1, 12, true);
    for (const axis of ['x', 'y', 'z']) {
        number(stone.offset?.[axis], '石头相对位置 ' + axis, -10, 10);
        number(stone.size?.[axis], '每层石头尺寸 ' + axis, .05, 10);
    }
    number(stone.gap, '石头层间缝隙', 0, .3);
    number(stone.hitScale, '底层受击放大幅度', 0, .25);
    number(stone.hitSeconds, '底层受击时长', .05, 1);
    number(stone.outlinePixels, '底层白色描边宽度', 0, 5);
    number(stone.fallSeconds, '上层下落时长', .05, 1);
    if (typeof stone.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(stone.color)) throw Error('石头纯色须为十六进制颜色');
    number(c.retryLimit, '失败后重试次数', 0, 100, true);
    number(c.maxSoldiers, '人数上限', 1, 60, true); number(c.startSoldiers, '开场人数', 1, c.maxSoldiers, true);
    number(c.soldierSpacing, '队形间距', 0.05, 3); number(c.formationDepthRatio, '队形纵向比例', 0.1, 4);
    if (!Array.isArray(c.levelFireIntervals) || c.levelFireIntervals.length !== 3) throw Error('必须设置三级射击间隔');
    c.levelFireIntervals.forEach(v => number(v, '每级射击间隔', .05, 30));
    for (const key of ['gateSpeed', 'rewardSpeed', 'enemySpeed']) number(c[key], key, 0, 30);
    for (const key of ['bulletSpeed', 'baseDamage', 'enemyHp', 'planeHp']) number(c[key], key, 0.01, 100000);
    number(c.enemyScale, '丧尸模型大小', .05, 10);
    number(c.bulletLifetime, '子弹存活时间', .05, 30);
    for (const key of ['enemyCombat', 'bossCombat']) {
        const rule = c[key], label = key === 'bossCombat' ? 'Boss' : '丧尸';
        number(rule?.chaseDistance, label + '追踪距离', .1, 100);
        number(rule.attackDistance, label + '攻击距离', .1, rule.chaseDistance);
        number(rule.attackRadius, label + '杀伤半径', .05, 20);
        number(rule.attackInterval, label + '攻击间隔', .1, 30);
    }
    number(c.playerZ, '我方纵向位置', -40, 40); number(c.moveLimit, '左右活动范围', 0, 30);
    for (const key of ['levelDamage', 'levelScale']) {
        if (!Array.isArray(c[key]) || c[key].length !== 3) throw Error(`${key} 必须保留三级配置`);
        c[key].forEach(v => number(v, key, 0.01, 100));
    }
    const a = c.enemyArea;
    number(a?.count, '丧尸数量', 0, 500, true); number(a.columns, '每排数量', 1, 30, true);
    for (const k of ['minX', 'maxX', 'minZ', 'maxZ']) number(a[k], '丧尸区域 ' + k, k === 'minZ' ? -20000 : -100, 100);
    if (a.minX > a.maxX || a.minZ > a.maxZ) throw Error('丧尸区域的起点不能大于终点');
    for (const key of ['gates', 'rewards', 'obstacles']) {
        const p = c.paths?.[key];
        if (!Array.isArray(p) || p.length < 2 || p.length > 512) throw Error('每条路线需要 2～512 个控制点');
        p.forEach((v, i) => { number(v.x, '路线横向位置', -100, 100); number(v.z, '路线纵向位置', -200, 100);
            if (i && v.z - p[i - 1].z < 0.1 - 1e-6) throw Error('路线点须从远到近排列，纵向至少相隔 0.1'); });
    }
    const g = c.gateLayout;
    number(g?.spacing, '沿路线的门间隔距离', 0.1, 20);
    number(g.firstZ, '首扇门位置', -100, c.playerZ + 2); number(g.spawnZ, '新门出生位置', -100, Math.min(c.playerZ, g.firstZ));
    if (!['add', 'subtract', 'multiply', 'divide'].includes(g.operation)) throw Error('门运算无效');
    number(g.value, '门数值', 1, 60, true);
    const left = c.leftGateCycle;
    if (typeof left?.enabled !== 'boolean') throw Error('左侧变量门开关无效');
    number(left.gatesPerReward, '每份奖励间需要通过的左侧门数', 1, 100, true);
    number(left.gateSpeed, '左侧门前进速度', .1, 30);
    number(left.rewardZ, '左侧奖励位置 Z', g.spawnZ + 2, c.playerZ - 1);
    number(left.riseSeconds, '奖励升起时长', .1, 5);
    if (!['add', 'subtract', 'multiply', 'divide'].includes(left.operation)) throw Error('左侧门运算无效');
    number(left.value, '左侧门数值', 1, 60, true);
    number(c.planePosition?.z, '右侧障碍物位置 Z', g.spawnZ + 2, c.playerZ - 1);
    if (c.planePosition.x !== undefined) number(c.planePosition.x, '右侧障碍物位置 X', -100, 100);
    if (left.enabled && !c.rewards?.length) throw Error('左侧变量门至少需要一份开场奖励');
    for (const key of ['rewards', 'obstacles', 'bosses']) {
        if (!Array.isArray(c[key]) || c[key].length > 100) throw Error('波次列表不正确');
        c[key].forEach((w, i) => {
            number(w.hp, '血量', 1, 1000000);
            if (key === 'bosses') { number(w.startZ, 'Boss 开场位置 Z', -20000, c.playerZ); number(w.speed, 'Boss 速度', 0, 30); number(w.scale, 'Boss 模型大小', .05, 10); if (![1, 2].includes(w.style)) throw Error('Boss 外形须为 1 或 2'); }
            else {
                number(w.time, '出现时间', 0, 600);
                if (i && w.time < c[key][i - 1].time) throw Error('波次请按出现时间排序');
                if (!(key === 'obstacles' ? ['obstacle'] : ['weapon', 'soldier']).includes(w.kind)) throw Error('物体类型无效');
                if (key === 'rewards') {
                    number(w.layers, `奖励 ${i + 1} 石头层数`, 1, 12, true);
                    picture(w.icon, w.iconScale, `奖励 ${i + 1}`);
                    pictureTransform(w.iconTransform, `奖励 ${i + 1}`);
                }
                if (w.power !== undefined) number(w.power, '火力增量', 0, 100);
                if (w.startZ !== undefined) number(w.startZ, '出生位置', -100, 100);
                if (w.speed !== undefined) number(w.speed, '前进速度', 0, 30);
                for (const k of ['width', 'depth']) if (w[k] !== undefined) number(w[k], '碰撞尺寸', 0.1, 20);
            }
        });
    }
    return c;
}

function listPresets() {
    if (!fs.existsSync(dataDir)) return [];
    return fs.readdirSync(dataDir).filter(n => /^preset-[a-f0-9-]+\.json$/.test(n)).map(n => {
        const v = JSON.parse(fs.readFileSync(path.join(dataDir, n), 'utf8'));
        return { id: n, name: v.name, date: v.date };
    });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 250000) throw Error('配置文件过大'); }
    return JSON.parse(text);
}

export const server = http.createServer(async (req, res) => {
    try {
        const host = req.headers.host;
        const activePort = server.address().port;
        if (host !== `127.0.0.1:${activePort}` && host !== `localhost:${activePort}`) return send(res, 403, { error: '仅允许本机访问' });
        const url = new URL(req.url, `http://${host}`);
        if (req.method === 'POST' && req.headers['x-studio-token'] !== token) return send(res, 403, { error: '请重新打开工作台' });
        if (url.pathname.startsWith('/api/model-import') && ['GET','POST'].includes(req.method)) return send(res,200,await modelImportRoute(req,url,body));
        if (req.method==='POST' && modelImportBusy() && ['/api/apply','/api/soldier-prefabs'].includes(url.pathname)) throw Error('正在处理模型，请等待完成后再应用其他设置');
        if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, {
            ...readConfig(), token, presets: listPresets(), project: path.basename(root), projectPath: root,
            configFile: 'assets/配置/数字门配置.json', scene: '当前 Creator 编辑场景', sceneObjects: [], apiVersion: 11,
        });
        if(req.method==='POST'&&url.pathname==='/api/reward-picture-preview'){
            const input=await body(req);
            if(!input.close){
                input.config=normalizeConfig(input.config);validateConfig(input.config);
                if(!/^[a-f0-9-]{36}$/i.test(input.sceneUuid))throw Error('请先连接 Creator 场景');
                if(input.index!==null&&(!Number.isInteger(input.index)||!input.config.rewards[input.index]))throw Error('请选择有效奖励');
                const full=input.index===null?input.config.planeLayers:input.config.rewards[input.index].layers;
                if(!Number.isInteger(input.remaining)||input.remaining<1||input.remaining>full)throw Error('剩余层数无效');
                if(!Number.isFinite(input.zoom)||input.zoom<.25||input.zoom>2)throw Error('预览缩放无效');
            }
            return send(res,200,await rewardPicturePreview(input));
        }
        if (req.method === 'GET' && url.pathname === '/api/scene-map') {
            const map = await readSceneMap(); return send(res, 200, { ...map, prefabAssets: prefabAssets() });
        }
        if (req.method === 'GET' && url.pathname === '/api/preview-url') {
            const address = await editorCall('execute_javascript', { context: 'editor', code: "return await Editor.Message.request('preview','query-preview-url');" });
            const preview = new URL(typeof address === 'string' ? address : address.url);
            preview.hostname = '127.0.0.1';
            return send(res, 200, { url: preview.href });
        }
        if (req.method === 'POST' && url.pathname === '/api/soldier-prefabs') {
            const input = await body(req), assets = prefabAssets();
            if (!Array.isArray(input.uuids) || input.uuids.length !== 3 || input.uuids.some(id => !assets.some(a => a.uuid === id))) throw Error('请选择项目内有效的角色预制体');
            const sceneUrl = await editorCall('execute_javascript', { context: 'editor', code: `return await Editor.Message.request('asset-db','query-url',${JSON.stringify(input.sceneUuid)});` });
            if (typeof sceneUrl !== 'string' || !sceneUrl.startsWith('db://assets/')) throw Error('请先保存当前场景');
            const sceneFile = path.resolve(root, sceneUrl.slice('db://'.length));
            if (!sceneFile.startsWith(root + path.sep) || !sceneFile.endsWith('.scene')) throw Error('场景路径无效');
            const backupDir = path.join(dataDir, 'backups'); fs.mkdirSync(backupDir, { recursive: true });
            const backup = `scene-${Date.now()}.scene`; fs.copyFileSync(sceneFile, path.join(backupDir, backup), fs.constants.COPYFILE_EXCL);
            const code = `return await (async()=>{ const input=${JSON.stringify(input)}; const s=cc.director.getScene();
                if(s.uuid!==input.sceneUuid) throw Error('编辑场景已切换，请先刷新场景');
                const g=s.getComponentsInChildren(cc.Component).find(c=>c.uuid===input.gameComponent);
                if(!g || JSON.stringify(g.soldierPrefabs.map(p=>p.uuid))!==JSON.stringify(input.expected)) throw Error('预制体已在 Creator 更改，请刷新场景后重试');
                const prefabs=await Promise.all(input.uuids.map(uuid=>new Promise((resolve,reject)=>cc.assetManager.loadAny({uuid},(e,p)=>e?reject(e):resolve(p)))));
                const Binder=cc.js.getClassByName('角色动画绑定');
                const Frames=cc.js.getClassByName('角色序列帧');
                if(prefabs.some(p=>!(p instanceof cc.Prefab) || !(p.data.getComponent(Binder) || p.data.getComponent(Frames)))) throw Error('角色预制体根节点必须设置角色动画绑定或角色序列帧');
                if(cc.director.getScene()!==s || !cc.isValid(g) || JSON.stringify(g.soldierPrefabs.map(p=>p.uuid))!==JSON.stringify(input.expected)) throw Error('加载期间场景或预制体已更改，请刷新后重试');
                g.soldierPrefabs=prefabs; await Editor.Message.request('scene','save-scene'); return {saved:true,prefabs:prefabs.map(p=>({uuid:p.uuid,name:p.name}))}; })();`;
            const result = await editorCall('execute_javascript', { context: 'scene', code });
            return send(res, 200, { ...result.result, backup });
        }
        if (req.method === 'POST' && url.pathname === '/api/apply') {
            const input = await body(req); input.config = normalizeConfig(input.config); validateConfig(input.config);
            if (input.config.rewards.some(w => w.icon) || input.config.planeIcon) {
                const map = await readSceneMap(), ids = new Set((map.rewardIcons ?? []).map(t => t.uuid));
                for (const [i,w] of input.config.rewards.entries()) if (w.icon && !ids.has(w.icon)) throw Error(`奖励 ${i + 1} 的图片未在当前场景引用，请先拖入 Creator 的“奖励可选图片”列表并保存场景`);
                if (input.config.planeIcon && !ids.has(input.config.planeIcon)) throw Error('右侧奖励的图片未在当前场景引用，请先加入“奖励可选图片”列表并保存场景');
            }
            // 指定动作必须来自当前角色，防止把拼错的名称保存成看不见的动作。
            if (Object.values(input.config.death).some(r=>r.clip)) {
                const map=await readSceneMap();
                for(const actor of map.actorAnimations) {
                    const clip=input.config.death[actor.key].clip;
                    if(clip&&!actor.clips.some(c=>c.name===clip)) throw Error(actor.name+' 没有动作「'+clip+'」，请刷新角色列表重新选择');
                }
            }
            const current = readConfig();
            if (current.revision !== input.revision) return send(res, 409, { error: '项目配置已在其他地方修改，请先重新读取，再应用你的调整。' });
            const backupDir = path.join(dataDir, 'backups'); fs.mkdirSync(backupDir, { recursive: true });
            const backup = `config-${Date.now()}.json`;
            fs.copyFileSync(configPath, path.join(backupDir, backup), fs.constants.COPYFILE_EXCL);
            const output = JSON.stringify(input.config, null, 2) + '\n';
            const temp = configPath + '.studio-tmp';
            fs.writeFileSync(temp, output); fs.renameSync(temp, configPath);
            let refreshWarning = '';
            try { await editorCall('execute_javascript',{context:'editor',code:"return await Editor.Message.request('asset-db','refresh-asset','db://assets/配置/数字门配置.json');"}); }
            catch { refreshWarning = '配置已保存，但 Creator 未自动刷新；请确认编辑器已连接，再刷新 assets 并重新运行。'; }
            return send(res, 200, { revision: hash(output), backup: `tools/level-studio/data/backups/${backup}`, refreshWarning });
        }
        if (req.method === 'POST' && url.pathname === '/api/validate') {
            const input = await body(req); const config = normalizeConfig(input.config); validateConfig(config); return send(res, 200, { valid: true, config });
        }
        if (req.method === 'POST' && url.pathname === '/api/presets') {
            const input = await body(req); input.config = normalizeConfig(input.config); validateConfig(input.config);
            const name = String(input.name || '').trim(); if (!name || name.length > 60) throw Error('方案名须为 1～60 个字');
            fs.mkdirSync(dataDir, { recursive: true });
            const id = `preset-${crypto.randomUUID()}.json`;
            fs.writeFileSync(path.join(dataDir, id), JSON.stringify({ name, date: new Date().toISOString(), config: input.config }, null, 2));
            return send(res, 200, { presets: listPresets(), id });
        }
        if (req.method === 'GET' && url.pathname.startsWith('/api/preset/')) {
            const id = url.pathname.slice('/api/preset/'.length);
            if (!/^preset-[a-f0-9-]+\.json$/.test(id)) throw Error('无效方案');
            const preset = JSON.parse(fs.readFileSync(path.join(dataDir, id), 'utf8')); preset.config = normalizeConfig(preset.config);
            return send(res, 200, preset);
        }
        if (req.method === 'GET' && url.pathname === '/layout.js') {
            const source = fs.readFileSync(path.join(root, 'assets/TS/DigitGateLayout.ts'), 'utf8');
            return send(res, 200, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText, 'text/javascript; charset=utf-8');
        }
        const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/reward-picture-preview.js': ['reward-picture-preview.js','text/javascript'], '/model-import.js': ['model-import.js','text/javascript'], '/number-scrub.js': ['number-scrub.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
        if (req.method === 'GET' && assets[url.pathname]) {
            const [file, type] = assets[url.pathname]; return send(res, 200, fs.readFileSync(path.join(here, file)), `${type}; charset=utf-8`);
        }
        return send(res, 404, { error: '地址不存在' });
    } catch (error) { send(res, 400, { error: error.message }); }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    server.on('error', error => {
        if (error.code === 'EADDRINUSE' && port !== 0) server.listen(0, '127.0.0.1');
        else { console.error(error); process.exitCode = 1; }
    });
    server.on('listening', () => {
        const activePort = server.address().port;
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'app-session.json'), JSON.stringify({ projectPath: root, pid: process.pid, port: activePort }));
        console.log(`数字门关卡工作台 http://127.0.0.1:${activePort}`);
    });
    server.listen(port, '127.0.0.1');
}
