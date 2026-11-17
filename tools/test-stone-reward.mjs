import fs from 'node:fs/promises';
import path from 'node:path';
import { editorCall } from './editor-bridge-client.mjs';

const out = process.env.DIGIT_GATE_STONE_CAPTURE;
const id = await editorCall('execute_javascript', { context: 'editor', code: `
    const address=await Editor.Message.request('preview','query-preview-url');
    const url=new URL(typeof address==='string'?address:address.url);url.hostname='127.0.0.1';
    const win=new(require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false}});
    win.stoneLogs=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)win.stoneLogs.push(message);});
    try{await win.loadURL(url.href);return win.id;}catch(e){win.destroy();throw e;}` });
const evaluate = code => editorCall('execute_javascript', { context: 'editor', code: `
    const win=require('electron').BrowserWindow.fromId(${id});
    try{return await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});}
    catch(e){throw Error(e.message+' '+win.stoneLogs.slice(-6).join(' | '));}` }, 45000);
async function capture(name) {
    if (!out) return;
    await fs.mkdir(out, { recursive: true });
    await evaluate('cc.game.step();cc.game.pause();return true;');
    const png=await editorCall('execute_javascript',{context:'editor',code:`return (await require('electron').BrowserWindow.fromId(${id}).webContents.capturePage()).toPNG().toString('base64');`});
    await fs.writeFile(path.join(out,name+'.png'),Buffer.from(png,'base64'));
}
try {
    const ready=(await fs.readFile(new URL('./prepare-bake-preview.js',import.meta.url),'utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c'));
    await evaluate(ready);
    await evaluate(`
        window.cc=await System.import('cc');window.g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));
        cc.game.pause();g.music.stop();g.sound=()=>{};g.cfg=structuredClone(g.cfg);
        g.cfg.rewards[0].layers=3;g.cfg.planeLayers=3;g.cfg.rewards[0].hp=120;g.restart();
        window.r=g.rewards.find(v=>v.leftBarrier);window.rock=r.rock;
        if(!rock||rock.remainingLayers!==3)throw Error('石头未替换奖励木桶 '+JSON.stringify({prefab:g.rewardBoxPrefab?.name,components:r.node.components.map(c=>cc.js.getClassName(c)),layers:rock?.remainingLayers}));
        cc.profiler.hideStats();return true;`);
    await capture('stone-opening');
    console.log(JSON.stringify(await evaluate(`
        const passed=[],check=(ok,label)=>{if(!ok)throw Error(label);passed.push(label);};
        check(!r.barrel&&rock.layers.length===3,'奖励物使用桌面石头模型，无木桶滚动');
        check(g.rewards.find(v=>v.kind==='plane').rock.remainingLayers===3,'左右奖励均替换成分层石头');
        check(Math.abs(r.badge.node.position.y-.475)<1e-6,'数字初始位于整堆石头的中间高度');
        g.hitReward(g.rewards.indexOf(r),10);rock.tick(g.cfg.rewardStone.hitSeconds/2);
        check(rock.layers[0].node.scale.x>1&&rock.layers[0].material.getProperty('feedback').x>.9,'受击底层轻微放大并开启白色描边');
        check(rock.layers.slice(1).every(v=>v.node.scale.x===1&&v.material.getProperty('feedback').x===0),'上层不跟随放大或出现白边');
        check(r.node.scale.x===1,'受击不缩放整个奖励物或图标数字');
        check(r.badge.node.position.z>rock.depth*(1+g.cfg.rewardStone.hitScale)/2,'数字位于最大放大范围之外');
        check(r.badge.label.customMaterial.passes[0].depthStencilState.depthTest===false,'数字不被受击放大的石头遮挡');
        window.stoneChecks=passed;return passed;`)));
    await capture('stone-hit');
    await evaluate(`g.hitReward(g.rewards.indexOf(r),30);rock.tick(.1);g.updateEffects(.1);return true;`);
    await capture('stone-breaking');
    console.log(JSON.stringify(await evaluate(`
        const passed=window.stoneChecks,check=(ok,label)=>{if(!ok)throw Error(label);passed.push(label);};
        check(r.hp===80&&rock.remainingLayers===2&&g.stoneBursts.length>0,'3 层损失三分之一血量时底层破碎并产生石块碎片');
        const burst=g.stoneBursts[0];
        check(burst.pieces.length===20&&burst.pieces.every(p=>p.node.getComponent(cc.MeshRenderer).mesh!==rock.stoneMesh),'破碎使用 20 个独立切割的原石碎块');
        check(Math.abs(r.badge.node.position.y-(rock.layers[0].node.position.y+rock.layers[1].node.position.y)/2)<1e-6,'下落中的数字同步保持石头堆中间高度');
        check(rock.layers[0].node.position.y>g.cfg.rewardStone.size.y/2,'上方石头正在下落而非瞬移');
        rock.tick(1);check(Math.abs(rock.layers[0].node.position.y-g.cfg.rewardStone.size.y/2)<1e-6,'上层落到新的底部');
        check(Math.abs(r.badge.node.position.y-.3125)<1e-6,'剩余两层时数字下移到两层中间');
        g.updateEffects(.3);check(burst.pieces.some(p=>p.bounces>0),'石头碎块落地后会回弹');
        check(burst.pieces.every(p=>p.node.scale.x>0&&p.node.scale.x<p.size.x),'碎块在 0.4 秒时已缩小消失');
        g.hitReward(g.rewards.indexOf(r),40);rock.tick(1);check(rock.remainingLayers===1&&Math.abs(r.badge.node.position.y-.15)<1e-6,'再损失三分之一时再次碎一层，数字移到单层中间');
        g.hitReward(g.rewards.indexOf(r),40);check(!g.rewards.includes(r)&&g.stoneBursts.length===3,'最后一层碎掉后奖励领取，碎片保留');
        g.updateEffects(.16);check(g.stoneBursts.length===2,'首批碎块在 0.55 秒后清理');
        g.updateEffects(1);check(g.stoneBursts.length===0,'所有石头碎片按时清理');
        for(const count of [1,2,4,5,7,12]) {
            g.cfg.rewards[0].layers=count;g.cfg.rewards[0].hp=120;g.restart();
            const r=g.rewards.find(v=>v.leftBarrier),rock=r.rock;check(rock.remainingLayers===count,'可配置 '+count+' 层');
            for(let i=1;i<=count;i++) {
                g.hitReward(g.rewards.indexOf(r),120/count);
                check(rock.remainingLayers===count-i,count+' 层第 '+i+' 个等比例血量阈值正确');
                rock.tick(1);
            }
        }
        g.cfg.rewards[0].layers=4;g.cfg.rewards[0].hp=120;g.restart();
        r=g.rewards.find(v=>v.leftBarrier);g.hitReward(g.rewards.indexOf(r),90);
        check(r.rock.remainingLayers===1&&g.stoneBursts.length===3,'单次跨过 3 个四分之一阈值会破碎 3 层');
        g.restart();check(g.stoneBursts.length===0&&g.rewards.find(v=>v.leftBarrier).rock.remainingLayers===4,'重开清理碎片并恢复全部层数');
        g.cfg.rewardStone.offset={x:.2,y:.1,z:.15};g.cfg.rewardStone.size={x:1.8,y:.4,z:1.2};g.restart();
        r=g.rewards.find(v=>v.leftBarrier);
        check(r.width===1.8&&r.depth===1.2,'修改石头尺寸同步更新碰撞宽度和深度');
        check(Math.abs(r.rock.body.position.x-.2)<1e-6&&r.badge.node.position.z>.15+1.2/2,'石头相对位置和数字随设置调整，数字避让受击放大的石头');
        check(r.rock.buriedY<-(.1+4*.4+3*g.cfg.rewardStone.gap),'高层数石头也从地面以下完整升起');
        const counts=[2,4,1,5];
        g.cfg.rewards.forEach((w,i)=>{w.layers=counts[i%counts.length];w.hp=120;});
        g.cfg.planeLayers=6;g.restart();
        check(g.rewards.find(v=>v.kind==='plane').rock.remainingLayers===6,'右侧飞机奖励单独设置 6 层');
        for(let i=0;i<g.cfg.rewards.length;i++) {
            const item=g.rewards.find(v=>v.leftBarrier),count=counts[i%counts.length];
            check(item.rock.remainingLayers===count,'奖励 '+(i+1)+' 独立使用 '+count+' 层');
            g.hitReward(g.rewards.indexOf(item),120/count-.01);
            check(item.rock.remainingLayers===count,'奖励 '+(i+1)+' 达到自己的阈值前不破碎');
            g.hitReward(g.rewards.indexOf(item),.01);
            check(item.rock.remainingLayers===count-1,'奖励 '+(i+1)+' 按自己的血量比例破碎');
            check(g.rewards.find(v=>v.kind==='plane').rock.remainingLayers===6,'左侧奖励的层数和破碎不影响右侧');
            if(g.rewards.includes(item))g.hitReward(g.rewards.indexOf(item),item.hp);
            if(i+1<g.cfg.rewards.length){g.spawnLeftReward(true);g.tickRise(g.rewards.find(v=>v.leftBarrier),g.cfg.leftGateCycle.riseSeconds);}
        }
        g.cfg.rewards[0].hp=120;
        g.cfg.rewardStone.offset={x:0,y:0,z:0};g.cfg.rewardStone.size={x:1.35,y:.3,z:.9};g.cfg.rewards[0].layers=3;g.restart();
        return {passed,count:passed.length};`),null,2));
    await evaluate(`g.cfg.rewards[0].layers=4;g.restart();return true;`);
    await capture('stone-four-layers');
    await evaluate(`r=g.rewards.find(v=>v.leftBarrier);g.hitReward(g.rewards.indexOf(r),30);r.rock.tick(.25);g.updateEffects(.25);return true;`);
    await capture('stone-four-to-three');
    const errors=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).stoneLogs;`});
    if(errors.length)throw Error('渲染错误：'+errors.join(' | '));
} finally {
    await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});
}
