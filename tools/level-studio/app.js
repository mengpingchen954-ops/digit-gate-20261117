import { routeX, routeYaw, routeZ, routeDistance, routePosition, footprintsOverlap, formationPosition, enemyPositions, gateLabel, gatePositions, gateRule } from '/layout.js';
import { installNumberScrub } from '/number-scrub.js';
import { modelImportPanel, installModelImport } from '/model-import.js';
import { installRewardPicturePreview } from '/reward-picture-preview.js';
const $ = id => document.getElementById(id);
const clone = x => JSON.parse(JSON.stringify(x));
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const titles = { overview: '关卡总览', scenery: '场景道路与护栏', gates: '右侧变量门与路线', rewards: '左侧变量门与奖励', obstacles: '障碍物与路线', enemies: '丧尸生成区域', squad: '我方队伍', bosses: '开场 Boss', death: '死亡动画与表现' };
const colors = { gates: '#65baff', rewards: '#ffca6a', obstacles: '#ff8585' };
titles.models = '导入与替换丧尸';
let config, base, revision, token, sceneObjects = [], selectedScene = 0, tab = 'overview', selectedPoint = -1;
if (titles[location.hash.slice(1)]) tab = location.hash.slice(1);
let undo = [], time = 0, playing = false, zoom = 1, camera = null, drag = null, view = null, busy = false;
let viewMode = 'pan';
let sceneMap = null, sceneBusy = false, prefabDraft = null, prefabExpected = null, mapTriangles = [];
let sceneUuid = null;
const canvas = $('map'), ctx = canvas.getContext('2d');
function status(text) { $('status').textContent = text; }
function notice(title, text) { $('noticeTitle').textContent = title; $('noticeText').textContent = text; $('notice').showModal(); }
// 间距是现有区域的直接编辑入口，不再保存一套与区域边界冲突的数值。
function enemySpacing(axis) {
    const a = config.enemyArea;
    const slots = axis === 'X' ? Math.min(a.count, a.columns) : Math.ceil(a.count / a.columns);
    return slots > 1 ? (a['max' + axis] - a['min' + axis]) / (slots - 1) : 0;
}
function get(key) {
    if (key === 'enemySpacingX' || key === 'enemySpacingZ') return +enemySpacing(key.slice(-1)).toFixed(6);
    return key.split('.').reduce((o, k) => o?.[k], config);
}
function set(key, value) {
    const a = config.enemyArea;
    if (key === 'enemySpacingX') {
        const columns = Math.min(a.count, a.columns);
        if (columns < 2) return;
        const center = (a.minX + a.maxX) / 2, halfWidth = value * (columns - 1) / 2;
        a.minX = +(center - halfWidth).toFixed(6); a.maxX = +(center + halfWidth).toFixed(6);
        return;
    }
    if (key === 'enemySpacingZ') {
        const rows = Math.ceil(a.count / a.columns);
        if (rows > 1) a.minZ = +(a.maxZ - value * (rows - 1)).toFixed(6);
        return;
    }
    const keys = key.split('.'); const last = keys.pop(); keys.reduce((o, k) => o[k], config)[last] = value;
}
function checkpoint() { undo.push(clone({ config, prefabDraft, prefabExpected })); if (undo.length > 60) undo.shift(); }
function restoreUndo() { ({ config, prefabDraft, prefabExpected } = undo.pop()); }
function hasPrefabChanges() { return prefabDraft && JSON.stringify(prefabDraft) !== JSON.stringify(prefabExpected); }
function changed() {
    const dirty = JSON.stringify(config) !== JSON.stringify(base) || hasPrefabChanges();
    $('dirty').textContent = dirty ? '未应用的调整' : '与游戏一致'; $('dirty').classList.toggle('changed', dirty);
    $('undo').disabled = !undo.length;
    try { localStorage.setItem('digit-gate-studio-draft', JSON.stringify({ config, revision })); } catch {}
    draw(); metrics();
}
async function api(url, input) {
    const r = await fetch(url, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token }, body: JSON.stringify(input) });
    const data = await r.json(); if (!r.ok) throw Error(data.error || '操作失败'); return data;
}
async function run(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { status(e.message); notice('操作未完成', e.message); } finally { busy = false; } }
function presetOptions(presets) { $('presets').innerHTML = '<option value="">选择已保存方案</option>' + presets.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); }
async function refreshScene() {
    if (sceneBusy) return;
    sceneBusy = true;
    try {
        const map = await api('/api/scene-map');
        if (sceneUuid !== map.sceneUuid) {
            if (hasPrefabChanges()) status('Creator 已切换场景，已清除上一场景的预制体选择；数值草稿保留。');
            prefabDraft = null; prefabExpected = null; camera = null; selectedScene = 0; undo = [];
        }
        sceneUuid = map.sceneUuid;
        sceneMap = map; sceneObjects = map.objects;
        selectedScene = Math.min(selectedScene, Math.max(0, sceneObjects.length - 1));
        mapTriangles = sceneObjects.flatMap(o => o.triangles).sort((a, b) => a.height - b.height);
        $('mapStatus').textContent = `${map.sceneName} · ${sceneObjects.length} 个真实网格 · ${new Date().toLocaleTimeString()}${map.warnings.length ? ' · 部分网格读取受限' : ''}`;
        if (!drag && !scrub.active() && (tab === 'scenery' || tab === 'squad' || tab === 'death' || tab === 'rewards') && !document.querySelector('#panel :focus')) renderPanel();
        draw();
    } catch (e) {
        // 断连时不把缓存地图当作实时场景；清空几何，保留路线草稿。
        sceneMap = null; sceneObjects = []; mapTriangles = [];
        $('mapStatus').textContent = '未连接当前场景：' + e.message;
        draw();
    } finally { sceneBusy = false; }
}
async function load(initial = false) {
    const s = await api('/api/state'); token = s.token; revision = s.revision; config = clone(s.config); base = clone(config); sceneObjects = s.sceneObjects; undo = [];
    prefabDraft = null; prefabExpected = null;
    $('project').textContent = `${s.project} · Creator 3.8.8 · 当前编辑场景`;
    presetOptions(s.presets);
    if (initial) {
        try { const d = JSON.parse(localStorage.getItem('digit-gate-studio-draft')); if (d?.revision === revision && JSON.stringify(d.config) !== JSON.stringify(base)) { config = (await api('/api/validate', { config: d.config })).config; status('已恢复上次尚未应用的调整；地图仍以 Creator 场景为准。'); } } catch {}
    }
    renderPanel(); changed(); await refreshScene();
}
function field(label, key, step = 1, min = 0, max = 100000, hint = '', disabled = false) {
    return `<label class="field">${label}<input type="number" data-key="${key}" value="${esc(get(key) ?? '')}" step="${step}" min="${min}" max="${max}" ${disabled ? 'disabled' : ''}>${hint ? `<small class="field-hint">${esc(hint)}</small>` : ''}</label>`;
}
function select(label, key, choices) {
    return `<label class="field">${label}<select data-key="${key}">${choices.map(([value, text]) => `<option value="${esc(value)}" ${String(get(key)) === String(value) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}
function upgradeColorPanel() {
    return section('升级 Shader 颜色', [1, 2, 3].map((level, i) => {
        const color = config.effects.upgradeColors[i];
        return `<label class="field upgrade-color">${level}级时的升级光效<input type="color" data-key="effects.upgradeColors.${i}" value="${esc(color)}"><small class="field-hint">${esc(color.toUpperCase())}</small></label>`;
    }).join('') + help('默认与当前等级子弹对应：1级蓝色、2级紫色、3级红色。攻速奖励使用当前等级颜色，兵种升级使用升级后的等级颜色；这里只调整升级光效。'));
}
function bossDeathPanel() {
    return section('Boss 死亡播放与移除', [1, 2].map(style => {
        const prefix = 'death.boss' + style;
        const indices = config.bosses.flatMap((boss, i) => boss.style === style ? [i + 1] : []);
        return `<div class="card"><strong>${style === 1 ? '屠夫 Boss 类型 1' : '屠夫 Boss 类型 2'}</strong><p class="tip">${indices.length ? '当前用于第 ' + indices.join('、') + ' 个 Boss。' : '用于该外形的 Boss。'}</p>`
            + fields(field('死亡动作播放速率', prefix + '.speed', .1, .1, 10, '1＝原速；2＝两倍快。')
                + field('动作播完后移除延迟（秒）', prefix + '.holdSeconds', .1, 0, 30, '从死亡动作播完开始计时；0＝播完立即移除。')) + '</div>';
    }).join('') + '<button data-goto="death" class="full">死亡动作与更多设置</button>');
}
function section(title, content) { return `<section class="section"><h2>${title}</h2>${content}</section>`; }
function stoneLayersField(key) {
    return field('石头层数', key, 1, 1, 12, `此奖励每损失 ${(100 / get(key)).toFixed(2)}% 血量破碎一层；独立设置。`);
}
function stonePanel() {
    const s = config.rewardStone;
    return section('奖励石头外观（左右共用）', fields(
        field('层间缝隙', 'rewardStone.gap', .005, 0, .3)
        + ['x', 'y', 'z'].map((axis, i) => field('相对位置 ' + ['左右 X', '上下 Y', '前后 Z'][i], 'rewardStone.offset.' + axis, .05, -10, 10)).join('')
        + ['x', 'y', 'z'].map((axis, i) => field('每层' + ['宽度 X', '高度 Y', '深度 Z'][i], 'rewardStone.size.' + axis, .05, .05, 10)).join('')
        + `<label class="field">石头纯色<input type="color" data-key="rewardStone.color" value="${esc(s.color)}"></label>`
        + field('底层受击放大幅度', 'rewardStone.hitScale', .01, 0, .25, '0.06＝放大 6%，只影响最下面一层。')
        + field('受击反馈时长（秒）', 'rewardStone.hitSeconds', .01, .05, 1)
        + field('受击白色描边（像素）', 'rewardStone.outlinePixels', .1, 0, 5)
        + field('上层下落时长（秒）', 'rewardStone.fallSeconds', .01, .05, 1))
        + help('使用桌面导入的石头模型，无纹理纯色。层数在下方每份奖励中单独设置，右侧飞机奖励在右侧页面设置。血量按各自层数均分；先碎底层，再让上层下落。位置、尺寸、颜色和受击表现共用，单份奖励的宽度和深度会在此尺寸上按比例调整。修改后应用并重新预览游戏查看效果。'));
}
function storeField(label, platform) { return `<label class="field">${label}<input type="url" data-key="storeUrls.${platform}" value="${esc(config.storeUrls[platform])}" placeholder="https://…"></label>`; }
function fields(content) { return `<div class="fields">${content}</div>`; }
function help(text) { return `<div class="help">${text}</div>`; }
function deathPanel() {
    const roles={enemy:'普通丧尸',soldier1:'1级友军',soldier2:'2级友军',soldier3:'3级友军',boss1:'屠夫 Boss 类型 1',boss2:'屠夫 Boss 类型 2'};
    return help('死亡流程：停止攻击 → 播放一次死亡动作 → 保持倒地 → 到时移除。这里的数值随右上角“应用到游戏”统一保存。')
        + Object.entries(roles).map(([key,title])=>{
            const rule=config.death[key],actor=sceneMap?.actorAnimations?.find(a=>a.key===key),prefix='death.'+key;
            const clips=actor?.clips??[],clip=clips.find(c=>rule.clip?c.name===rule.clip:/^(死亡|Dead|Death)$/i.test(c.name));
            const choices=[['','自动识别死亡动作（推荐）'],...clips.map(c=>[c.name,`${c.name} · 原长 ${c.duration.toFixed(2)} 秒`])];
            if(rule.clip&&!clips.some(c=>c.name===rule.clip))choices.push([rule.clip,rule.clip+'（待核对当前角色）']);
            const minSpeed=rule.speed-rule.randomSpeed,maxSpeed=rule.speed+rule.randomSpeed;
            const duration=clip?clip.duration*rule.endPercent/100:null;
            const estimate=duration!==null&&minSpeed>0?`死亡到移除约 ${(duration/maxSpeed+rule.holdSeconds).toFixed(2)}～${(duration/minSpeed+rule.holdSeconds).toFixed(2)} 秒。`: '连接当前游戏场景后显示动作时长。';
            return `<details class="death-card" data-role="${key}" ${key==='enemy'?'open':''}><summary>${title}<small>${rule.speed}倍 · 倒地停留 ${rule.holdSeconds} 秒</small></summary><div class="death-content">`
                + `<p class="small">${actor?esc(actor.name)+' · '+actor.format:'等待 Creator 角色列表…'}</p>`
                + select('使用哪个死亡动作',prefix+'.clip',choices)
                + (!rule.clip||/死亡|dead|death/i.test(rule.clip)?'':help('当前选择不是常见死亡动作名称，请确认它确实是倒地动作。'))
                + fields(field('播放倍速',prefix+'.speed',.1,.1,10,'1＝原速；2＝两倍快。')
                    + field('随机速度偏移 ±',prefix+'.randomSpeed',.05,0,Math.max(0,rule.speed-.1),'0＝一致；0.3＝每人上下浮动 0.3 倍。')
                    + field('倒地后停留（秒）',prefix+'.holdSeconds',.1,0,30,'动作播完后再计时；0＝立即移除。')
                    + field('动作结束位置（%）',prefix+'.endPercent',1,10,100,'100＝完整播放；有起身尾段时可提前结束。'))
                + `<label class="field"><span><input type="checkbox" data-key="${prefix}.whiteFlash" ${rule.whiteFlash?'checked':''}> 死亡时保持白色高亮</span></label>`
                + `<p class="death-estimate">实际倍速 ${minSpeed.toFixed(2)}～${maxSpeed.toFixed(2)} 倍<br>${estimate}</p></div></details>`;
        }).join('')
        + upgradeColorPanel()
        + section('常用表现细调',fields(field('受击闪白（秒）','effects.hitFlashSeconds',.01,.01,2,'仅普通受击；不影响死亡高亮。')
            +field('子弹显示大小（倍）','effects.bulletScale',.1,.1,5,'1＝预制体原尺寸；只改外观，不改伤害和碰撞。')
            +field('子弹亮度（倍）','effects.bulletBrightness',.1,.1,8,'1＝原亮度；默认 2.5，更醒目，保留子弹原配色。')
            +field('右侧奖励落地震屏强度','effects.landingShakeStrength',.01,0,.5,'0＝关闭；只在右侧奖励物落地瞬间触发一次。')
            +field('落地震屏时长（秒）','effects.landingShakeSeconds',.01,0,1,'默认 0.28 秒，随后恢复正常跟随。')
            +field('吃到奖励震屏强度','effects.rewardShakeStrength',.01,0,.5,'0＝关闭；左侧奖励图标抵达队伍时触发，右侧奖励打破领取时触发。')
            +field('领奖震屏时长（秒）','effects.rewardShakeSeconds',.01,0,1,'默认 0.18 秒，比落地震屏轻。')
            +field('奖励飞行时间（秒）','effects.rewardFlightSeconds',.05,.05,5,'越小，奖励图标飞向队伍越快。')
            +field('奖励弧线高度','effects.rewardFlightHeight',.1,0,10,'0＝直线；数值越大，飞行弧线越高。')))
        + help('动作菜单来自当前角色预制体，不需要手写名称。换新动画文件：先在 Creator 角色预制体的动画组件中绑定；序列帧角色还需重新烘焙。换友军预制体后先应用，再来选择动作。骨骼角色可直接使用已绑定片段。')
        + '<button id="refreshScene" class="full">刷新当前角色与动作列表</button>';
}
function combatPanel(key) {
    return section('追踪与近身攻击', fields(field('开始追踪距离', `${key}.chaseDistance`, .1, .1, 100)
        + field('开始攻击距离', `${key}.attackDistance`, .05, .1, 100)
        + field('前方杀伤半径', `${key}.attackRadius`, .05, .05, 20)
        + field('最短攻击间隔（秒）', `${key}.attackInterval`, .1, .1, 30))
        + '<p class="tip">远处直行，靠近后追最近的存活友军。出手时锁定方向；仅动画命中帧击杀前方圆形区域内的友军。攻击间隔不会截断动作。</p>');
}
function routePanel() {
    const key = tab;
    return section('路线控制点', '<p class="tip">切换画布上的“编辑布局”后拖动编号点。X 是左右，Z 从远到近增大；按点顺序连成路线。</p>'
        + `<div class="small">　序号　　 横向 X　　　 纵向 Z</div>`
        + config.paths[key].map((p, i) => `<div class="point ${i === selectedPoint ? 'selected' : ''}"><span>${i + 1}</span><input aria-label="控制点 ${i + 1} 横向" type="number" step="0.1" data-key="paths.${key}.${i}.x" value="${p.x}"><input aria-label="控制点 ${i + 1} 纵向" type="number" step="0.1" data-key="paths.${key}.${i}.z" value="${p.z}"><button data-remove-point="${i}" ${config.paths[key].length <= 2 ? 'disabled' : ''} title="移除控制点">×</button></div>`).join('')
        + '<button id="addPoint" class="full">＋ 在最长一段中插入控制点</button>');
}
function rewardPictureFields(w, i) {
    const pictures = sceneMap?.rewardIcons ?? [];
    const options = [['', '默认（跟随奖励种类）'], ...pictures.map(t => [t.uuid, t.name])];
    if (w.icon && !pictures.some(t => t.uuid === w.icon)) options.push([w.icon, '此图片不在当前场景，请重新选择']);
    return select('此奖励的图片', i === null ? 'planeIcon' : `rewards.${i}.icon`, options)
        + field('此图片大小（留空为 1）', i === null ? 'planeIconScale' : `rewards.${i}.iconScale`, .05, .1, 4)
        + `<button class="span2" data-picture-preview="${i===null?'plane':i}">调整图片位置、旋转与缩放 · 实时预览</button>`;
}
function wavePanel(key) {
    const boss = key === 'bosses', obstacle = key === 'obstacles';
    const sequence = key === 'rewards' && config.leftGateCycle.enabled;
    return section(boss ? '开场 Boss 列表' : obstacle ? '障碍物出场计划' : sequence ? '左侧奖励顺序（最后一份后结束）' : '奖励出场计划',
        config[key].map((w, i) => `<div class="card"><div class="row"><strong>${boss ? 'Boss' : obstacle ? '障碍' : '奖励'} ${i + 1}</strong><button data-remove-wave="${key}:${i}">移除</button></div>` + fields(
            (boss ? field('开场位置 Z（越小越远）', `${key}.${i}.startZ`, .1, -20000, config.playerZ) : sequence ? '' : field('出现时间（秒）', `${key}.${i}.time`, 0.5, 0, 600)) + field('血量', `${key}.${i}.hp`, 1, 1, 1000000)
            + (boss ? select('外形', `${key}.${i}.style`, [[1, '屠夫 Boss 类型 1'], [2, '屠夫 Boss 类型 2']]) + field('移动速度', `${key}.${i}.speed`, 0.05, 0, 30)
                + field('模型大小', `${key}.${i}.scale`, .01, .05, 10)
                + `<label class="field span2"><span><input type="checkbox" data-key="${key}.${i}.final" ${w.final ? 'checked' : ''}> 大型 Boss（清掉全部敌人才胜利）</span></label>`
                : (obstacle ? '' : select('奖励种类', `${key}.${i}.kind`, [['weapon', '强化火力'], ['soldier', '兵种升级']]) + stoneLayersField(`${key}.${i}.layers`) + rewardPictureFields(w, i))
                + (sequence ? '' : field('出生位置 Z', `${key}.${i}.startZ`, 0.1, -100, 100) + field('前进速度（留空用默认）', `${key}.${i}.speed`, 0.1, 0, 30))
                + field('宽度（留空 1.35）', `${key}.${i}.width`, 0.05, 0.1, 20) + field('深度（留空 0.9）', `${key}.${i}.depth`, 0.05, 0.1, 20)
                + (w.kind === 'weapon' ? field('增加火力倍率', `${key}.${i}.power`, 0.05, 0, 100) : '')))
            + (w.kind === 'weapon' ? '<p class="tip">这是火力奖励唯一的攻速设置，不增加单发伤害。初始攻速 1 倍，每次奖励累加：填 0.5 增加 50%，填 3 后从 1 倍变成 4 倍。实际射击间隔＝当前兵种默认间隔 ÷ 累计火力倍率。图标抵达后生效；升级兵种保留倍率，重开恢复 1 倍。</p>' : w.kind === 'soldier' ? '<p class="tip">图标抵达后提升一级兵种，最高三级；满级后不再升级或增加火力倍率。</p>' : '') + '</div>').join('')
        + `<button data-add-wave="${key}" class="full">＋ 添加${boss ? 'Boss' : obstacle ? '障碍物' : '奖励'}</button>`);
}
function renderPanel() {
    if (!config) return;
    const detailsState=new Map([...document.querySelectorAll('.death-card')].map(el=>[el.dataset.role,el.open]));
    $('viewTitle').textContent = titles[tab];
    updateViewControls();
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    let html = '';
    if (tab === 'overview') html = help('① 左边选择内容<br>② 拖点或填中文参数<br>③ 拉动时间查看布局<br>④ 点击右上角“应用到游戏”')
        + section('不知道从哪里开始？', '<button data-goto="death" class="full">死亡动作、倍速、倒地停留</button><button data-goto="squad" class="full">人数、攻速、伤害和子弹寿命</button><button data-goto="enemies" class="full">敌人数量、血量和近身攻击</button><p class="tip">布局画布不播放动画。改完先应用，再打开游戏预览检查效果。</p>')
        + section('这次可以自由调整', '<p class="tip">所有数字都可按住左右拖动，Shift 精调、Ctrl 快调，也可直接输入。地图在 Creator 自行拼接，APP 自动读取真实网格俯视投影。</p>')
        + section('商店跳转与重试', fields(field('失败后重试次数', 'retryLimit', 1, 0, 100)) + storeField('安卓商店地址', 'android') + '<br>' + storeField('iOS 商店地址', 'ios') + '<p class="tip">默认可重试 2 次；设为 0 则首次失败后就只跳商店。次数用完后，所有按钮均跳商店。消灭全部丧尸和 Boss 才胜利；我方全灭失败。胜利不显示重试和下一关，只保留居中的 Play Now，点击跳商店。次数与地址随“应用到游戏”保存。</p><p class="tip">渠道顺序：ExitApi → Facebook → openAppStore → MRAID → 浏览器。前三者由渠道 SDK 接管；MRAID 根据系统选择上述地址，桌面默认安卓。</p>')
        + section('游戏预览', '<p class="tip">应用后在 Creator 刷新 assets 并重新预览 scene-1。工作台是布局示意；战斗、模型和最终画面请在游戏里看。</p><button id="previewGame" class="full">打开游戏预览</button>');
    if (tab === 'gates') html = help('这里调整右侧路线和门数字；左侧在“左侧变量门与奖励”中单独调整。两侧共用首门位置、出生位置和间距。右侧障碍物落地后，只挡住后方门，已放行的门继续移动。') + section('右侧门规则与两侧队列间距', fields(select('右侧运算方式', 'gateLayout.operation', [['add', '加法 ＋'], ['subtract', '减法 −'], ['multiply', '乘法 ×'], ['divide', '除法 ÷']]) + field('右侧门运算数值', 'gateLayout.value', 1, 1, 60) + field('开场首门 Z', 'gateLayout.firstZ', .1, -100, config.playerZ + 2) + field('相邻门距离（沿路线）', 'gateLayout.spacing', .1, .1, 20) + field('后续出生 Z', 'gateLayout.spawnZ', .1, -100, Math.min(config.playerZ, config.gateLayout.firstZ)) + field('右侧门前进速度', 'gateSpeed', .1, 0, 30)) + help(`右侧开场自动生成 ${gatePositions(config).length} 扇门。`)) + routePanel();
    if (tab === 'gates') html += section('右侧障碍物（飞机奖励石头）', fields(field('障碍物血量', 'planeHp', 10, 1) + stoneLayersField('planeLayers') + rewardPictureFields({icon:config.planeIcon}, null) + field('位置 X（留空跟随右侧路线）', 'planePosition.x', .1, -100, 100) + field('位置 Z（越大越靠近角色）', 'planePosition.z', .1, config.gateLayout.spawnZ + 2, config.playerZ - 1)) + help('开场即在这个位置出现。刚满员时播放 MAX，之后左右合计每吸收两扇增兵变量门提示一次；右侧障碍物保持原状，打破后放行后方门。')) + stonePanel();
    if (tab === 'rewards' || tab === 'obstacles') html = help(tab === 'rewards' ? (config.leftGateCycle.enabled ? '开场显示第 1 份奖励，左侧门在后方静止排列。打破后等图标飞到队伍才放行；实际通过指定数量的左侧门后，下一份奖励从地面升起，只阻挡后方队列。已越过奖励位置或正在通过的门继续正常移动和生效，阻挡期间通过的门不累计到下一轮。只计左侧，满员通过也计数，漏门不计数。奖励按下方顺序出现，最后一份领取后不再出新奖励，门继续移动。时间预览仅示意开场布局，完整流程请在游戏预览体验。' : '打破获得奖励；未打破的箱子触碰到哪名友军，就让该友军停火并死亡。') : '可破坏的障碍物。打破后无奖励；碰到友军会造成死亡。默认列表为空，按需添加。单项速度留空时使用下方默认速度。')
        + (tab === 'rewards' ? section('左侧门与奖励放行', `<label class="field"><span><input type="checkbox" data-key="leftGateCycle.enabled" ${config.leftGateCycle.enabled ? 'checked' : ''}> 启用左侧变量门与奖励阻挡</span></label>` + fields(select('左侧运算方式', 'leftGateCycle.operation', [['add', '加法 ＋'], ['subtract', '减法 −'], ['multiply', '乘法 ×'], ['divide', '除法 ÷']]) + field('左侧门运算数值', 'leftGateCycle.value', 1, 1, 60) + field('每次领取多少扇左侧门出新奖励', 'leftGateCycle.gatesPerReward', 1, 1, 100) + field('左侧门前进速度', 'leftGateCycle.gateSpeed', .1, .1, 30) + field('奖励固定位置 Z', 'leftGateCycle.rewardZ', .1, config.gateLayout.spawnZ + 2, config.playerZ - 1) + field('从地面升起时长（秒）', 'leftGateCycle.riseSeconds', .05, .1, 5))) : '')
        + (tab === 'obstacles' || !config.leftGateCycle.enabled ? section('默认移动速度', fields(field('奖励 / 障碍默认前进速度', 'rewardSpeed', .1, 0, 30))) : '')
        + (tab === 'rewards' ? help('每份奖励可独立选择上方图片和大小；换顺序时图片跟随奖励。新图片先导入 Creator，在数字门玩法组件的“奖励可选图片”列表中添加并保存场景，再刷新此页选择。领取任意奖励后，队伍容量上限 +3。') + stonePanel() : '') + routePanel() + wavePanel(tab);
    if (tab === 'enemies') {
        const a = config.enemyArea, columns = Math.min(a.count, a.columns), rows = Math.ceil(a.count / a.columns);
        const centerX = (a.minX + a.maxX) / 2;
        const maxSpacingX = columns > 1 ? Math.min(200, 2 * (100 - Math.abs(centerX)) / (columns - 1)) : 0;
        const maxSpacingZ = rows > 1 ? (a.maxZ + 20000) / (rows - 1) : 0;
        html = help('丧尸在开场已经全部站进区域。游戏开始后向我方移动，不再按时间无限刷出。绿色矩形是出生区域。')
            + section('开场丧尸', fields(field('总数量', 'enemyArea.count', 1, 0, 500) + field('每排最多', 'enemyArea.columns', 1, 1, 30)
                + field('左右间距', 'enemySpacingX', .01, 0, maxSpacingX, columns > 1 ? '同一整排相邻丧尸的中心距离' : '至少同排 2 只才能设置', columns < 2)
                + field('前后排间距', 'enemySpacingZ', .01, 0, maxSpacingZ, rows > 1 ? '相邻两排的中心距离' : '至少 2 排才能设置', rows < 2)
                + field('区域左边 X', 'enemyArea.minX', .1, -100, 100) + field('区域右边 X', 'enemyArea.maxX', .1, -100, 100)
                + field('区域远端 Z', 'enemyArea.minZ', .1, -20000, 100) + field('区域近端 Z', 'enemyArea.maxZ', .1, -100, 100)
                + field('单只血量', 'enemyHp', 1, 1) + field('前进速度', 'enemySpeed', .05, 0, 30))
                + help('调小间距让丧尸群更集中，调大更分散。左右固定区域中心，前后固定最前排。修改人数、每排数量或区域边界会重新计算间距；不足一整排时，末排仍在区域内均分。'));
    }
    if (tab === 'squad') html = help('开场容量 4 人，每领取一份奖励容量 +3，重开恢复初始容量。奖励扩容不会自动增加士兵，通过增兵门才能补充新空位。新增小兵从中心人物移动到固定槽位。死亡后保持倒地，到配置的停留时间再移除、补位。')
        + '<button data-goto="death" class="full">设置友军死亡动作与停留时间</button>'
        + section('人数与站位', fields(field('初始人数上限', 'maxSoldiers', 1, 1, 60) + field('开场人数', 'startSoldiers', 1, 1, 60) + field('横向间距', 'soldierSpacing', .01, .05, 3) + field('纵向比例', 'formationDepthRatio', .05, .1, 4) + field('队伍位置 Z', 'playerZ', .1, -40, 40) + field('左右活动范围', 'moveLimit', .1, 0, 30)))
        + section('射击', fields(field('子弹速度', 'bulletSpeed', 1, 1) + field('子弹存活时间（秒）', 'bulletLifetime', .01, .05, 30) + field('基础伤害', 'baseDamage', .1, .01))
            + '<p class="tip">每名小兵只有首次开枪时间错开，之后按固定间隔射击，不随机改变攻速；火力增强或换兵种保留错开进度。未命中时，到达存活时间自动回池；命中立即回池。参考开场约 1.17 秒。</p>')
        + [0, 1, 2].map(i => section(`${i + 1} 级兵种`, fields(field('射击间隔（秒）', `levelFireIntervals.${i}`, .01, .05, 30) + field('伤害倍率', `levelDamage.${i}`, .1, .01, 100) + field('模型缩放', `levelScale.${i}`, .01, .01, 100))
            + (sceneMap ? `<label class="field">角色预制体<select data-prefab-level="${i}">${sceneMap.prefabAssets.map(a => `<option value="${esc(a.uuid)}" ${(prefabDraft ?? sceneMap.prefabs.map(p => p.uuid))[i] === a.uuid ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : '<p class="tip">连接 Creator 后可选择角色预制体。</p>'))).join('')
        + help('这里设置兵种默认间隔；火力奖励只通过“增加火力倍率”加快攻速。实际射击间隔＝当前兵种默认间隔 ÷ 累计火力倍率；单发伤害＝基础伤害 × 当前等级伤害倍率。友方士兵使用正常骨骼预制体。')
        + help('角色预制体和射击数值统一点击右上角“应用到游戏”，不需要单独应用。')
        + '<button id="referenceFormation" class="full">恢复初始 4 人容量与参考间距</button>';
    if (tab === 'enemies') html += section('模型大小', fields(field('丧尸模型缩放', 'enemyScale', .05, .05, 10))
        + help('参考校准值 1.55；保留本项目丧尸外形，按画面中的身体高度换算。碰撞与血条同步缩放。默认 430 只、每排 5 只，包含参考的后续 60 只，按本项目规则全部开场生成。')) + combatPanel('enemyCombat');
    if (tab === 'enemies') html += '<button data-goto="death" class="full">设置丧尸死亡动作与播放速度</button>';
    if (tab === 'bosses') html = help('列表里的 Boss 在开场就全部生成，尚未操作时停在初始位置；开始游戏后向前走，靠近友军再追击和攻击。不再按时间突然刷出。Z 越小越远，到达队伍越晚。') + bossDeathPanel() + combatPanel('bossCombat') + wavePanel('bosses');
    if (tab === 'squad' || tab === 'rewards') html += upgradeColorPanel();
    if (tab === 'death') html = deathPanel();
    if (tab === 'models') html = modelImportPanel();
    if (tab === 'scenery') {
        const n = sceneObjects[selectedScene];
        html = help('地图请在 Creator 拼接、移动和旋转。这里每 3 秒读取当前编辑场景的真实静态网格（包括未保存的变换、嵌套节点和预制体实例）。不包括海面、角色、隐藏物体和编辑器辅助节点。颜色为材质底色，非贴图渲染。')
            + '<button id="refreshScene" class="full">立即刷新真实场景</button>'
            + (n ? `<label class="field">查看场景物体<select id="sceneSelect">${sceneObjects.map((v, i) => `<option value="${i}" ${i === selectedScene ? 'selected' : ''}>${esc(v.path)}</option>`).join('')}</select></label><p class="small">世界位置：X ${n.position.x.toFixed(2)} · Y ${n.position.y.toFixed(2)} · Z ${n.position.z.toFixed(2)}</p>` : '<p class="tip">等待 Creator 场景连接…</p>');
        if (sceneMap?.warnings.length) html += help(sceneMap.warnings.map(esc).join('<br>'));
    }
    $('panel').innerHTML = html;
    document.querySelectorAll('.death-card').forEach(el=>{if(detailsState.has(el.dataset.role))el.open=detailsState.get(el.dataset.role);});
}
const scrub = installNumberScrub($('panel'), {
    begin: checkpoint,
    bounds(key, el) {
        let min = el.min === '' ? -100000 : Number(el.min), max = el.max === '' ? 100000 : Number(el.max);
        if (/^paths\..*\.z$/.test(key)) { const [, route, index] = key.split('.'), points = config.paths[route], i = Number(index);
            min = i > 0 ? points[i - 1].z + .1 : -100; max = i + 1 < points.length ? points[i + 1].z - .1 : 100;
        }
        if (/^paths\..*\.x$/.test(key)) { min = -100; max = 100; }
        if (key === 'startSoldiers') max = config.maxSoldiers;
        if (key === 'maxSoldiers') min = config.startSoldiers;
        return [min, max];
    },
    change(key, value) { set(key, value); changed(); },
    end(key, cancel) {
        if (cancel) restoreUndo();
        else if (/^(rewards|obstacles)\.\d+\.time$/.test(key)) config[key.split('.')[0]].sort((a, b) => a.time - b.time);
        renderPanel(); changed();
    },
});
const picturePreview=installRewardPicturePreview({config:()=>config,pictures:()=>sceneMap?.rewardIcons??[],sceneUuid:()=>sceneUuid,api,checkpoint,restoreUndo,changed,renderPanel});
$('panel').addEventListener('change', event => {
    const el = event.target;
    if (el.id === 'sceneSelect') { selectedScene = Number(el.value); renderPanel(); draw(); return; }
    if (el.dataset.prefabLevel !== undefined && sceneMap) {
        checkpoint(); prefabExpected ??= sceneMap.prefabs.map(p => p.uuid); prefabDraft ??= [...prefabExpected];
        const index=Number(el.dataset.prefabLevel);prefabDraft[index]=el.value;
        config.death['soldier'+(index+1)].clip='';
        changed();status('预制体选择未应用；该等级死亡动作已改为自动识别，倍速与停留设置保留。点击“应用到游戏”。');return;
    }
    const key = el.dataset.key; if (!key) return;
    checkpoint();
    if (el.type === 'checkbox') set(key, el.checked);
    else if (el.type === 'color') set(key, el.value.toLowerCase());
    else if (el.type === 'url') {
        let url; try { url = new URL(el.value.trim()); } catch {}
        if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) { undo.pop(); renderPanel(); status('请填写有效的 http/https 商店网址。'); return; }
        set(key, el.value.trim());
    }
    else if (el.tagName === 'SELECT') {
        set(key, key.endsWith('.style') ? Number(el.value) : el.value);
        if (/^rewards\.\d+\.kind$/.test(key) && el.value !== 'weapon') delete config.rewards[Number(key.split('.')[1])].power;
    }
    else if (el.value === '' && (/^(rewards|obstacles)\.\d+\.(startZ|speed|width|depth|power|iconScale)$/.test(key) || key === 'planePosition.x' || key === 'planeIconScale')) { const keys = key.split('.'), last = keys.pop(); delete get(keys.join('.'))[last]; }
    else { const value = Number(el.value);
        if (!Number.isFinite(value) || (el.min !== '' && value < Number(el.min)) || (el.max !== '' && value > Number(el.max))) {
            undo.pop(); renderPanel(); status('输入超出允许范围，请按输入框的范围调整。'); return;
        }
        if (/^(maxSoldiers|startSoldiers|enemyArea\.(count|columns)|gateLayout\.value|leftGateCycle\.(gatesPerReward|value)|planeLayers|rewards\.\d+\.layers)$/.test(key) && !Number.isInteger(value)) {
            undo.pop(); renderPanel(); status('人数、数量和门数值请填整数。'); return;
        }
        set(key, value);
    }
    if (key.startsWith('paths.')) {
        const points = config.paths[key.split('.')[1]];
        if (points.some((p, i) => i && p.z < points[i - 1].z + .09999)) { restoreUndo(); notice('控制点顺序', '纵向 Z 要从远到近排列，且至少相隔 0.1。'); }
    }
    if (/^(rewards|obstacles)\.\d+\.time$/.test(key)) config[key.split('.')[0]].sort((a, b) => a.time - b.time);
    renderPanel(); changed();
});
$('panel').addEventListener('click', event => {
    const el = event.target.closest('button'); if (!el) return;
    if(el.dataset.picturePreview!==undefined){picturePreview.open(el.dataset.picturePreview==='plane'?null:Number(el.dataset.picturePreview));return;}
    if (el.dataset.goto) { endDrag(); tab=el.dataset.goto;selectedPoint=-1;renderPanel();draw();return; }
    if (el.id === 'previewGame') {
        const preview = window.open('about:blank', '_blank');
        run(async () => {
            try { const result = await api('/api/preview-url'); if (preview) { preview.opener = null; preview.location.href = result.url; } }
            catch (error) { preview?.close(); throw error; }
        });
        return;
    }
    if (el.id === 'refreshScene') { refreshScene(); return; }
    checkpoint();
    if (el.dataset.removePoint !== undefined) config.paths[tab].splice(Number(el.dataset.removePoint), 1);
    else if (el.id === 'addPoint') {
        const p = config.paths[tab]; let longest = 0;
        for (let i = 1; i < p.length - 1; i++) if (p[i + 1].z - p[i].z > p[longest + 1].z - p[longest].z) longest = i;
        const a = p[longest], b = p[longest + 1]; p.splice(longest + 1, 0, { x: +(a.x + (b.x - a.x) / 2).toFixed(2), z: +(a.z + (b.z - a.z) / 2).toFixed(2) }); selectedPoint = longest + 1;
    } else if (el.dataset.removeWave) { const [key, i] = el.dataset.removeWave.split(':'); config[key].splice(Number(i), 1); }
    else if (el.dataset.addWave) {
        const key = el.dataset.addWave, t = (config[key].at(-1)?.time ?? 0) + 5;
        config[key].push(key === 'bosses' ? { startZ: Math.max(-20000, Math.min(-3, ...config.bosses.map(b => b.startZ)) - 10), hp: 180, speed: .95, style: 1, scale: 1.1 } : { time: t, kind: key === 'obstacles' ? 'obstacle' : 'weapon', hp: 30, startZ: -13, ...(key === 'rewards' ? { power: .35, layers: 3 } : {}) });
    } else if (el.id === 'referenceFormation') Object.assign(config, { maxSoldiers: 4, startSoldiers: 1, soldierSpacing: .38, formationDepthRatio: 50 / 30 });
    else { undo.pop(); return; }
    renderPanel(); changed();
});
$('tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; endDrag(); tab = b.dataset.tab; selectedPoint = -1; renderPanel(); draw(); };
$('deathTab').onclick = $('tabs').onclick;
$('modelsTab').onclick = $('tabs').onclick;
installModelImport({token:()=>token,render:()=>{if(tab==='models')renderPanel();},status,error:message=>notice('模型操作未完成',message),dirty:()=>!config||JSON.stringify(config)!==JSON.stringify(base)||hasPrefabChanges(),complete:async()=>{if(JSON.stringify(config)===JSON.stringify(base)&&!hasPrefabChanges())await load();else await refreshScene();status('角色引用已更新，请重新运行游戏查看。');}});
$('undo').onclick = () => { if (busy || !undo.length) return; restoreUndo(); renderPanel(); changed(); status('已撤销上一步调整。'); };
$('reload').onclick = () => run(async () => { if ((JSON.stringify(config) !== JSON.stringify(base) || hasPrefabChanges()) && !confirm('放弃尚未应用的调整，重新读取游戏配置？')) return; await load(); status('已读取当前游戏配置。'); });
$('apply').onclick = () => run(async () => {
    if (hasPrefabChanges() && !sceneMap) throw Error('预制体尚未应用，请先连接 Creator 场景。');
    const savedConfig = clone(config);
    const prefabs = hasPrefabChanges() ? { sceneUuid: sceneMap.sceneUuid, gameComponent: sceneMap.gameComponent, expected: [...prefabExpected], uuids: [...prefabDraft] } : null;
    status('正在检查并应用…');
    const r = await api('/api/apply', { config: savedConfig, revision });
    revision = r.revision; base = savedConfig; changed();
    if (prefabs) {
        try {
            await api('/api/soldier-prefabs', prefabs);
            // 请求期间的新选择仍保留为草稿，不被已经完成的保存吞掉。
            if (JSON.stringify(prefabDraft) === JSON.stringify(prefabs.uuids)) prefabDraft = null;
            prefabExpected = prefabDraft ? prefabs.uuids : null;
            undo = []; await refreshScene(); renderPanel(); changed();
        } catch (e) { throw Error('数值已保存，但预制体未保存，选择草稿仍保留。' + e.message); }
    }
    status(r.refreshWarning || '已应用并刷新 Creator 配置；重新打开游戏预览即可。');
    notice('已应用到游戏', `数值${prefabs ? '和三级角色预制体' : ''}已保存。\n${r.refreshWarning || 'Creator 配置已刷新，重新运行 scene-1 查看效果。'}\n自动备份：${r.backup}`);
});
$('savePreset').onclick = () => run(async () => { const name = $('presetName').value.trim(); if (!name) throw Error('先给方案起个名字。'); const r = await api('/api/presets', { name, config }); presetOptions(r.presets); $('presets').value = r.id; status(`方案“${name}”已保存。游戏配置尚未改变。`); });
$('loadPreset').onclick = () => run(async () => { const id = $('presets').value; if (!id) throw Error('先选择一个方案。'); const r = await api('/api/preset/' + id); checkpoint(); config = clone(r.config); renderPanel(); changed(); status(`已载入“${r.name}”，检查后点击应用到游戏。`); });
$('export').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = '数字门关卡方案.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
$('import').onchange = () => run(async () => { const f = $('import').files[0]; if (!f) return; const value = JSON.parse(await f.text()); const checked = await api('/api/validate', { config: value }); checkpoint(); config = checked.config; renderPanel(); changed(); status('已导入配置草稿；地图以 Creator 为准，检查后点击应用到游戏。'); $('import').value = ''; });
function metrics() { $('time').max = timelineEnd(); $('metrics').innerHTML = [[config.enemyArea.count, '开场丧尸'], [`${config.startSoldiers} / ${config.maxSoldiers}`, '开场人数 / 初始容量'], [config.rewards.length, '奖励波次'], [config.obstacles.length, '障碍物波次']].map(([v, s]) => `<div class="metric"><b>${v}</b><span>${s}</span></div>`).join(''); }
function timelineEnd() { return Math.max(100, ...[...config.rewards, ...config.obstacles].map(w => w.time + 60), ...config.bosses.map(b => b.speed > 0 ? (config.playerZ - b.startZ) / b.speed + 10 : 0)); }
function setTime(t) { time = Math.max(0, Math.min(timelineEnd(), t)); $('time').value = time; $('timeText').textContent = time.toFixed(1) + ' s'; draw(); }
$('time').oninput = () => setTime(Number($('time').value));
$('play').onclick = () => { playing = !playing; if (time >= timelineEnd()) setTime(0); $('play').textContent = playing ? 'Ⅱ 暂停' : '▶ 预览'; };
$('resetTime').onclick = () => { playing = false; $('play').textContent = '▶ 预览'; setTime(0); };
$('fullSquad').onchange = draw;
function updateViewControls() {
    const editing = viewMode === 'edit';
    $('panView').setAttribute('aria-pressed', String(!editing));
    $('editLayout').setAttribute('aria-pressed', String(editing));
    canvas.style.cursor = editing && tab in colors ? 'crosshair' : 'grab';
    $('viewHint').textContent = !editing ? '左键拖拽平移俯视图 · 滚轮围绕鼠标缩放 · 适配回到全图'
        : tab in colors ? '左键拖动编号点修改路线 · 空白处拖拽平移 · 滚轮聚焦缩放'
        : tab === 'scenery' ? '真实场景只读 · 请在 Creator 拼接地图 · 左键平移、滚轮聚焦缩放'
        : '左键拖拽平移 · 滚轮聚焦缩放 · 选择路线面板可编辑布局';
}
function setViewMode(mode) { endDrag(); viewMode = mode; updateViewControls(); }
$('panView').onclick = () => setViewMode('pan');
$('editLayout').onclick = () => setViewMode('edit');
function zoomAt(x, y, factor) {
    if (!config || drag) return;
    view = transform();
    const anchor = world(x, y);
    zoom = Math.max(.2, Math.min(12, zoom * factor));
    view = transform();
    const after = world(x, y);
    camera.x += anchor.x - after.x; camera.z += anchor.z - after.z;
    draw();
}
$('zoomIn').onclick = () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.3);
$('zoomOut').onclick = () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.3);
$('fit').onclick = () => { endDrag(); zoom = 1; camera = null; draw(); };
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.max(-500, Math.min(500, pixels)) * .002));
}, { passive: false });
function transform() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!camera) {
        const points = [...Object.values(config.paths).flat(), ...mapTriangles.flatMap(t => [0, 2, 4].map(i => ({ x: t.points[i], z: t.points[i + 1] })))];
        const far = Math.min(-32, config.enemyArea.minZ, ...points.map(p => p.z), ...config.bosses.map(b => b.startZ - b.scale));
        const near = Math.max(config.playerZ + 4, ...points.map(p => p.z));
        const spanX = Math.max(6, ...points.map(p => Math.abs(p.x))) * 2 + 5;
        camera = { x: 0, z: (far + near) / 2, baseScale: Math.max(.01, Math.min((w - 64) / spanX, (h - 60) / (near - far))) };
    }
    const scale = camera.baseScale * zoom;
    return { w, h, scale, cx: w / 2 - camera.x * scale, cz: camera.z };
}
function screen(x, z) { return { x: view.cx + x * view.scale, y: view.h / 2 + (z - view.cz) * view.scale }; }
function world(x, y) { return { x: (x - view.cx) / view.scale, z: (y - view.h / 2) / view.scale + view.cz }; }
function line(points, color, width = 2, dashed = false) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dashed ? [5, 7] : []); ctx.beginPath(); points.forEach((p, i) => { const q = screen(p.x, p.z); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke(); ctx.setLineDash([]); }
function circle(x, z, radius, color) { const p = screen(x, z); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); }
function label(text, x, z, color = '#dce9f6') { const p = screen(x, z); ctx.font = '11px Microsoft YaHei'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, p.x, p.y - 10); }
function box(x, z, width, depth, color, yaw = 0) {
    const a = yaw * Math.PI / 180;
    const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([dx,dz]) => screen(x + dx * width/2 * Math.cos(a) + dz * depth/2 * Math.sin(a), z - dx * width/2 * Math.sin(a) + dz * depth/2 * Math.cos(a)));
    ctx.beginPath(); corners.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function draw() {
    if (!config) return;
    const ratio = devicePixelRatio || 1; const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h); view = transform();
    $('zoomText').textContent = Math.round(zoom * 100) + '%';
    const topLeft = world(0, 0), bottomRight = world(w, h);
    const grid = 2 * 2 ** Math.max(0, Math.ceil(Math.log2(16 / (2 * view.scale))));
    for (let x = Math.ceil(topLeft.x / grid) * grid; x <= bottomRight.x; x += grid) line([{ x, z: topLeft.z }, { x, z: bottomRight.z }], '#193043', 1);
    for (let z = Math.ceil(topLeft.z / grid) * grid; z <= bottomRight.z; z += grid) line([{ x: topLeft.x, z }, { x: bottomRight.x, z }], '#193043', 1);
    // 顶点已经过 Creator 完整世界矩阵变换，不再按物体名或固定尺寸猜地图。
    for (const t of mapTriangles) {
        ctx.beginPath();
        for (let i = 0; i < 6; i += 2) { const p = screen(t.points[i], t.points[i + 1]); i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y); }
        ctx.closePath(); ctx.fillStyle = `rgb(${t.color.join(',')})`; ctx.fill();
    }
    line([{ x: -config.moveLimit - 1, z: config.playerZ }, { x: config.moveLimit + 1, z: config.playerZ }], '#637990', 2, true);
    label('我方活动位置', 0, config.playerZ + 4, '#9ab1c6');
    for (const [key, points] of Object.entries(config.paths)) {
        line(points, tab === key ? colors[key] : colors[key] + '66', tab === key ? 4 : 2);
        if (tab === key) points.forEach((p, i) => { const q = screen(p.x, p.z); circle(p.x, p.z, i === selectedPoint ? 12 : 10, colors[key]); ctx.font = 'bold 11px system-ui'; ctx.fillStyle = '#0d2033'; ctx.textAlign = 'center'; ctx.fillText(i + 1, q.x, q.y + 4); });
    }
    const a = config.enemyArea;
    if (tab === 'enemies' || tab === 'overview') { const p = screen(a.minX, a.minZ), q = screen(a.maxX, a.maxZ); ctx.fillStyle = '#6bda8815'; ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y); ctx.strokeStyle = '#6bda8855'; ctx.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y); }
    for (const p of enemyPositions(a)) {
        const path = config.paths.obstacles, z = routeZ(path, routeDistance(path, p.z) + time * config.enemySpeed);
        const position = routePosition(path, z, p.x);
        if (z < config.playerZ + 2) circle(position.x, position.z, Math.max(2, view.scale * config.enemyScale * .16), '#77d799');
    }
    const planeZ = config.planePosition.z;
    const stoneFootprint = (x, z, yaw, width = 1.35, depth = .9) => {
        const s = config.rewardStone, angle = yaw * Math.PI / 180;
        return { x: x + s.offset.x * Math.cos(angle) + s.offset.z * Math.sin(angle),
            z: z - s.offset.x * Math.sin(angle) + s.offset.z * Math.cos(angle),
            width: s.size.x * width / 1.35, depth: s.size.z * depth / .9, yaw };
    };
    const plane = stoneFootprint(config.planePosition.x ?? routeX(config.paths.gates, planeZ), planeZ, 0);
    const gate = (z, side, barrier = null) => {
        const path = side < 0 ? config.paths.rewards : config.paths.gates;
        const rule = gateRule(config, side);
        let x = routeX(path, z), yaw = routeYaw(path, z);
        if (barrier && (z >= barrier.z || footprintsOverlap({ x, z, width: 1.19, depth: .09, yaw }, barrier))) {
            z = routeZ(path, routeDistance(path, z) + time * (side < 0 ? config.leftGateCycle.gateSpeed : config.gateSpeed));
            x = routeX(path, z); yaw = routeYaw(path, z);
        }
        if (z > config.playerZ + 2 + 1e-8) return;
        box(x, z, 1.19, .09, colors.gates, yaw);
        if (tab === (side < 0 ? 'rewards' : 'gates')) label(gateLabel(rule.operation, rule.value), x, z);
    };
    gatePositions(config, $('showPlane').checked ? 0 : time * config.gateSpeed).forEach(z => gate(z, 1, $('showPlane').checked ? plane : null));
    if (config.leftGateCycle.enabled) {
        const r = config.rewards[0], path = config.paths.rewards, z = config.leftGateCycle.rewardZ;
        const reward = r && stoneFootprint(routeX(path, z), z, routeYaw(path, z), r.width, r.depth);
        // 时间轴不模拟玩家射击或收门，显示开场被首份奖励挡住的真实布局。
        for (const gz of gatePositions(config, 0, path)) gate(gz, -1, reward);
        if (reward) {
            box(reward.x, reward.z, reward.width, reward.depth, colors.rewards, reward.yaw);
            label(`${r.kind === 'weapon' ? '火力' : '升级'} ${r.hp} · ${r.layers} 层`, reward.x, reward.z, colors.rewards);
        }
    }
    for (const key of ['rewards', 'obstacles']) for (const r of config[key]) {
        if (key === 'rewards' && config.leftGateCycle.enabled) continue;
        if (r.time > time) continue; const z = (r.startZ ?? -13) + (time - r.time) * (r.speed ?? config.rewardSpeed);
        if (z > config.playerZ + 3) continue; const x = routeX(config.paths[key], z);
        const shape = key === 'rewards' ? stoneFootprint(x, z, routeYaw(config.paths[key], z), r.width, r.depth)
            : { x, z, width: r.width ?? 1.35, depth: r.depth ?? .9, yaw: routeYaw(config.paths[key], z) };
        box(shape.x, shape.z, shape.width, shape.depth, colors[key], shape.yaw); label(`${r.kind === 'weapon' ? '火力' : r.kind === 'soldier' ? '升级' : '障碍'} ${r.hp}`, shape.x, shape.z, colors[key]);
    }
    for (const b of config.bosses) {
        const path = config.paths.obstacles, z = Math.min(config.playerZ - 1.3, routeZ(path, routeDistance(path, b.startZ) + time * b.speed));
        const x = routeX(path, z);
        circle(x, z, b.scale * (b.style === 2 ? .625 : .73) * view.scale, '#f49667'); label(b.final ? '屠夫 Boss 类型 2' : 'Boss', x, z);
    }
    const count = $('fullSquad').checked ? config.maxSoldiers : config.startSoldiers;
    for (let i = 0; i < count; i++) { const p = formationPosition(i, config.soldierSpacing, config.formationDepthRatio); circle(p.x, config.playerZ + p.z, Math.max(3, .2 * view.scale), i ? '#d7e9fc' : '#62e3c7'); }
    if ($('showPlane').checked) { box(plane.x, plane.z, plane.width, plane.depth, colors.rewards); label('右侧障碍物占地', plane.x, plane.z); }
    if (tab === 'scenery' && sceneObjects[selectedScene]) { const n = sceneObjects[selectedScene]; circle(n.position.x, n.position.z, 6, '#fff'); label(n.name, n.position.x, n.position.z); }
}
canvas.addEventListener('pointerdown', e => {
    if (!config || drag || e.button !== 0 || e.isPrimary === false) return;
    e.preventDefault(); view = transform();
    const rect = canvas.getBoundingClientRect(), p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const candidates = viewMode === 'edit' && tab in colors ? config.paths[tab].map((p, i) => ({ p, i })) : [];
    const nearest = candidates.map(v => ({ ...v, d: Math.hypot(screen(v.p.x, v.p.z).x - p.x, screen(v.p.x, v.p.z).y - p.y) })).sort((a, b) => a.d - b.d)[0];
    drag = { id: e.pointerId, kind: 'pan', start: p, camera: { ...camera }, scale: view.scale, moved: false };
    if (nearest && nearest.d <= 20) {
        selectedPoint = nearest.i; if (tab === 'scenery') selectedScene = nearest.i;
        Object.assign(drag, { kind: 'edit', point: { x: nearest.p.x, z: nearest.p.z } });
        renderPanel();
    }
    canvas.setPointerCapture(e.pointerId); canvas.style.cursor = drag.kind === 'pan' ? 'grabbing' : 'move'; draw();
});
canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = canvas.getBoundingClientRect(), dx = e.clientX - r.left - drag.start.x, dy = e.clientY - r.top - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (drag.kind === 'pan') {
        drag.moved = true; camera.x = drag.camera.x - dx / drag.scale; camera.z = drag.camera.z - dy / drag.scale;
        draw(); return;
    }
    if (!drag.moved) { checkpoint(); drag.moved = true; }
    const p = { x: drag.point.x + dx / drag.scale, z: drag.point.z + dy / drag.scale };
    p.x = +Math.max(-100, Math.min(100, p.x)).toFixed(2);
    { const points = config.paths[tab], i = selectedPoint;
        const lower = i > 0 ? points[i - 1].z + .1 : -100, upper = i + 1 < points.length ? points[i + 1].z - .1 : 100;
        p.z = +Math.max(lower, Math.min(upper, p.z)).toFixed(2); points[i] = p; }
    renderPanel(); canvas.style.cursor = 'move'; changed();
});
function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const completed = drag; drag = null;
    if (canvas.hasPointerCapture(completed.id)) canvas.releasePointerCapture(completed.id);
    updateViewControls(); draw();
}
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag); canvas.addEventListener('lostpointercapture', endDrag);
new ResizeObserver(draw).observe(canvas.parentElement);
let previous = performance.now();
function frame(now) { if (playing) { setTime(time + Math.min(.1, (now - previous) / 1000)); if (time >= timelineEnd()) { playing = false; $('play').textContent = '▶ 预览'; } } previous = now; requestAnimationFrame(frame); }
requestAnimationFrame(frame);
await run(() => load(true));
$('showPlane').onchange = draw;
$('refreshMap').onclick = refreshScene;
setInterval(() => { if (!document.hidden) refreshScene(); }, 3000);
