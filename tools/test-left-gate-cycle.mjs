// 在 Creator 的独立离屏预览中运行，不改编辑场景和磁盘关卡数值。
import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';

await editorCall('execute_javascript', { context: 'editor', code: `
    for (const url of ['db://assets/TS/DigitGateRules.ts','db://assets/TS/DigitGateLayout.ts','db://assets/TS/DigitGateGame.ts','db://assets/配置/数字门配置.json'])
        await Editor.Message.request('asset-db','refresh-asset',url);
    return true;` });
const id = await editorCall('execute_javascript', { context: 'editor', code: `
    const address=await Editor.Message.request('preview','query-preview-url');
    const url=new URL(typeof address==='string'?address:address.url); url.hostname='127.0.0.1';
    const win=new (require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false}});
    win.testLogs=[]; win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)win.testLogs.push(message);});
    try { await win.loadURL(url.href); return win.id; } catch(e) { win.destroy(); throw e; }` });
const evaluate = code => editorCall('execute_javascript', { context: 'editor', code: `
    const win=require('electron').BrowserWindow.fromId(${id});
    try { return await win.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)}); }
    catch(e) { throw Error(e.message+' '+win.testLogs.slice(-5).join(' | ')); }` }, 45000);
try {
    const ready = (await fs.readFile(new URL('./prepare-bake-preview.js', import.meta.url), 'utf8')).replace('EXPECTED_SCENE', JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c'));
    await evaluate(ready);
    if (process.env.DIGIT_GATE_TEST_CAPTURE) {
        await evaluate(`const cc=await System.import('cc');cc.game.step();cc.game.pause();return true;`);
        const png = await editorCall('execute_javascript', { context: 'editor', code: `
            const win=require('electron').BrowserWindow.fromId(${id});
            return (await win.webContents.capturePage()).toPNG().toString('base64');` });
        await fs.writeFile(process.env.DIGIT_GATE_TEST_CAPTURE, Buffer.from(png, 'base64'));
    }
    const checks = await evaluate(`
        const cc=await System.import('cc'), g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法')); g.cfg.coinBuild.enabled=false;
        cc.game.pause(); g.music.stop(); g.sound=()=>{};
        g.cfg=structuredClone(g.cfg);
        g.restart();
        g.cfg.leftGateCycle.value=5;g.cfg.planePosition={z:7.8};
        const passed=[], assert=(condition,label)=>{if(!condition)throw Error(label);passed.push(label);};
        const left=()=>g.gates.filter(v=>v.side===-1), right=()=>g.gates.filter(v=>v.side===1);
        const waiting=()=>left().filter(v=>!v.released);
        const zs=items=>JSON.stringify(items.map(v=>v.z));
        const reward=()=>g.rewards.find(v=>v.leftBarrier);
        const rightObstacle=()=>g.rewards.find(v=>v.kind==='plane');
        const removeRightObstacle=()=>{const r=rightObstacle();if(r){r.node.destroy();g.rewards.splice(g.rewards.indexOf(r),1);}};
        const maxToasts=()=>g.hud.toasts.filter(v=>v.node.getComponentInChildren(cc.Label)?.string.includes('MAX'));
        const align=side=>{g.squadX=g.laneX(g.cfg.playerZ,side);g.squad.setPosition(g.squadX,0,g.cfg.playerZ);};
        const redeem=()=>{
            const r=reward(), before=zs(waiting());
            g.hitReward(g.rewards.indexOf(r),r.hp);
            assert(g.leftGatePhase==='collecting'&&!reward(),'打破后进入领奖飞行阶段');
            g.updateGateLane(.05,-1);
            assert(zs(waiting())===before,'奖励图标抵达前后方门仍静止');
            g.hud.tick(g.cfg.effects.rewardFlightSeconds+.01);
            assert(g.leftGatePhase==='moving','奖励实际领取后放行');
        };
        const collectUntilBlocked=()=>{
            align(-1); let actual=0;
            for(let i=0;i<2000&&g.leftGatePhase==='moving';i++) {
                const before=new Set(left());g.updateGateLane(.01,-1);
                actual+=[...before].filter(v=>!left().includes(v)&&v.z>=g.cfg.playerZ-.35&&v.z<=g.cfg.playerZ+1.5).length;
                if(g.leftGatesCollected===5)assert(!reward(),'第 5 扇左侧门尚不出奖励');
            }
            assert(g.leftGatePhase==='blocked'&&actual===6,'实际通过第 6 扇左侧门才升起下一奖励');
            const distance=z=>{
                const path=g.cfg.paths.rewards;let total=0;
                if(z<=path[0].z)return z-path[0].z;
                for(let i=1;i<path.length;i++){
                    const a=path[i-1],b=path[i],length=Math.hypot(b.x-a.x,b.z-a.z);
                    if(z<=b.z)return total+length*(z-a.z)/(b.z-a.z);
                    total+=length;
                }
                return total+z-path[path.length-1].z;
            };
            const positions=waiting().map(v=>distance(v.z)).sort((a,b)=>a-b);
            assert(positions.slice(1).every((v,i)=>Math.abs(v-positions[i]-g.cfg.gateLayout.spacing)<1e-5),'每次阻挡后沿实际路线保留队列的等距排列');
        };
        g.restart();
        assert(left().length>0&&right().length>0,'开场左右各有独立门队列');
        const opening=rightObstacle();
        assert(opening&&Math.abs(opening.node.position.y-.02)<1e-6&&opening.dropAge===undefined&&opening.badge.node.active&&opening.badge.icon.active,'右侧障碍开场已在地面出现，数字和飞机图标可见');
        assert(maxToasts().length===0,'未满员时不播放 MAX');
        const rightStart=zs(right());g.cfg.gateSpeed=2;g.updateGateLane(.05,1);
        assert(zs(right())===rightStart,'右侧障碍开场即阻挡后方门');
        removeRightObstacle(); // 后续独立路线用例在清除右侧障碍后检查移动。
        assert(g.rewardIndex===1&&reward()&&reward().speed===0&&reward().riseAge===undefined,'开场立即显示一份静止奖励');
        assert(left().every(v=>v.z<reward().z-.45),'左侧门全部位于奖励后方');
        g.begin();
        const initial=zs(left());g.cfg.gateSpeed=2;g.updateGates(.05);
        assert(zs(left())===initial,'开场奖励阻挡左侧队列');
        assert(right()[0].z>g.cfg.gateLayout.firstZ,'右侧移动不受左侧阻挡影响');
        g.elapsed=100;g.update(.01);
        assert(g.rewardIndex===1&&g.rewards.filter(v=>v.leftBarrier).length===1,'原定时波次不会额外生成左侧奖励');
        redeem();
        const missed=g.leftGatesCollected;align(1);
        for(let i=0;i<160;i++)g.updateGateLane(.01,-1);
        assert(g.leftGatesCollected===missed,'漏过左侧门不计数');
        // 右侧即使实际收门，也不触发左侧奖励。
        const extra=g.gates.length;g.spawnGate(g.cfg.playerZ,1);g.updateGateLane(0,1);
        assert(g.gates.length===extra&&g.leftGatesCollected===0,'右侧收门不计入左侧 6 扇');
        for(let index=1;index<g.cfg.rewards.length;index++) {
            collectUntilBlocked();
            const r=reward();
            assert(r.hp===g.cfg.rewards[index].hp&&r.kind===g.cfg.rewards[index].kind,'奖励按原列表顺序生成 '+(index+1));
            assert(r.riseAge===0&&r.node.position.y<0&&!r.badge.node.active,'新奖励从地面下开始升起');
            const before=zs(waiting()),released=left().filter(v=>v.released).map(v=>({gate:v,z:v.z})),hp=r.hp;g.hitReward(g.rewards.indexOf(r),hp);
            assert(r.hp===hp,'升起期间不能提前击碎');
            g.tickRise(r,g.cfg.leftGateCycle.riseSeconds/2);
            assert(r.node.position.y> -1.4&&r.node.position.y<.02,'升起具有中间动画位置');
            g.updateGateLane(.05,-1);assert(zs(waiting())===before,'升起过程中后方门静止');
            assert(released.length>0&&released.every(v=>g.gates.includes(v.gate)&&v.gate.z>v.z),'升起时已放行的门不消失并继续移动');
            g.tickRise(r,g.cfg.leftGateCycle.riseSeconds);
            assert(r.riseAge===undefined&&Math.abs(r.node.position.y-.02)<1e-6&&r.badge.node.active,'升起完成后显示血量');
            redeem();
        }
        align(-1);for(let i=0;i<1000;i++)g.updateGateLane(.01,-1);
        assert(g.rewardIndex===g.cfg.rewards.length&&!reward()&&g.leftGatePhase==='moving','最后一份后不循环、不再阻挡门');
        g.restart();
        assert(g.leftGatePhase==='blocked'&&g.leftGatesCollected===0&&g.rewardIndex===1&&reward(),'重开复位为首份奖励和零计数');
        // 从主 update 驱动实际移动、射击、子弹命中、图标飞行和收门。
        g.begin();g.targetX=g.controlX=g.laneX(g.cfg.playerZ,-1);
        for(let i=0;i<600&&g.rewardIndex<2;i++)g.update(.05);
        assert(g.rewardIndex===2&&g.leftGatePhase==='blocked'&&g.power===1+g.cfg.rewards[0].power,'真实射击和移动可完成首份奖励到第 6 扇门的闭环');
        const emerging=reward();
        for(let i=0;i<30;i++)g.update(.05);
        assert(emerging.riseAge===undefined,'主更新驱动升起动画完成');
        g.restart();g.begin();
        g.hitReward(g.rewards.indexOf(reward()),reward().hp);g.restart();
        g.hud.tick(g.cfg.effects.rewardFlightSeconds+1);
        assert(g.leftGatePhase==='blocked'&&g.power===1,'领奖飞行中重开不会被旧回调放行');
        g.cfg.rewards=g.cfg.rewards.slice(0,1);g.restart();g.begin();redeem();align(-1);
        for(let i=0;i<700;i++)g.updateGateLane(.01,-1);
        assert(g.rewardIndex===1&&!reward()&&g.leftGatePhase==='moving','只有一份奖励时也会正确结束');
        g.cfg.leftGateCycle.enabled=false;g.restart();
        assert(left().length===0&&g.rewardIndex===0,'关闭新模式可恢复旧的定时奖励机制');
        g.cfg.leftGateCycle.enabled=true;g.cfg.leftGateCycle.operation='add';g.cfg.leftGateCycle.value=2;
        g.cfg.gateLayout.operation='add';g.cfg.gateLayout.value=5;g.restart();g.begin();
        removeRightObstacle();
        assert(left().every(v=>v.badge.label.string==='+2')&&right().every(v=>v.badge.label.string==='+5'),'左右门分别显示独立数字');
        redeem();align(-1);g.spawnGate(g.cfg.playerZ,-1);g.updateGateLane(0,-1);
        assert(g.liveSoldiers.length===3,'左侧数字 +2 实际增加 2 名士兵');
        align(1);g.spawnGate(g.cfg.playerZ,1);g.updateGateLane(0,1);
        assert(g.liveSoldiers.length===Math.min(8,g.squadCapacity),'右侧数字 +5 不受左侧设置影响，人数受当前容量限制');
        // 满员只显示原有 MAX 提示，不创建或替换右侧障碍物。
        g.restart();g.begin();const beforeMax=rightObstacle();
        while(g.liveSoldiers.length<g.cfg.maxSoldiers)g.addSoldier();
        assert(maxToasts().length===1&&g.reachedMax,'达到人数上限时播放已有 MAX 提示');
        assert(rightObstacle()===beforeMax&&g.rewards.filter(v=>v.kind==='plane').length===1,'满员不会额外生成或替换右侧障碍物');
        g.addSoldier();assert(maxToasts().length===1,'已满员时不会重复叠加 MAX 提示');
        const passGate=side=>{align(side);g.spawnGate(g.cfg.playerZ,side);g.gates.at(-1).released=true;g.updateGateLane(0,side);};
        passGate(-1);
        assert(maxToasts().length===1,'满员后吸收第一扇增兵门不提示 MAX');
        passGate(-1);
        assert(maxToasts().length===2&&g.liveSoldiers.length===g.cfg.maxSoldiers,'满员后吸收第二扇增兵门显示一次 MAX');
        passGate(1);
        assert(maxToasts().length===2,'下一组第一扇右侧增兵门不提示 MAX');
        g.cfg.leftGateCycle.operation='multiply';g.cfg.leftGateCycle.value=2;passGate(-1);
        assert(maxToasts().length===3,'左右增兵门共同计数，乘法门作为第二扇显示 MAX');
        passGate(-1);
        assert(maxToasts().length===3,'重复一轮后第一扇仍不提示 MAX');
        g.cfg.leftGateCycle.value=1;passGate(-1);
        assert(maxToasts().length===3&&g.fullGateCount===1,'乘以 1 的门不提示且不计入两扇增兵门');
        g.cfg.leftGateCycle.operation='subtract';g.cfg.leftGateCycle.value=2;passGate(-1);
        assert(maxToasts().length===3&&g.liveSoldiers.length===g.cfg.maxSoldiers-2&&g.fullGateCount===0,'减员门不显示 MAX 并清空满员收门计数');
        g.cfg.leftGateCycle.operation='add';g.cfg.leftGateCycle.value=2;passGate(-1);
        assert(maxToasts().length===4&&g.liveSoldiers.length===g.cfg.maxSoldiers,'减员后再次补满也显示一次 MAX');
        passGate(-1);assert(maxToasts().length===4&&g.fullGateCount===1,'重新补满后按新的两扇增兵门计数');
        assert(rightObstacle()===beforeMax,'重复 MAX 提示不影响开场障碍物');
        g.hitReward(g.rewards.indexOf(beforeMax),beforeMax.hp);
        assert(g.fullGateCount===0,'奖励扩容清空满员收门计数');
        g.addSoldier();assert(!rightObstacle(),'已打破的右侧障碍不会因满员重新出现');
        const initialCount=g.cfg.startSoldiers;g.cfg.startSoldiers=g.cfg.maxSoldiers;g.restart();
        assert(maxToasts().length===1&&g.rewards.filter(v=>v.kind==='plane').length===1,'开场满员时同时显示一份障碍和一次 MAX');
        passGate(-1);g.restart();passGate(-1);
        assert(maxToasts().length===1&&g.fullGateCount===1,'重开清空满员收门计数，第一扇不触发旧计数');
        g.cfg.startSoldiers=initialCount;
        // 用确定位置覆盖前方、占位区、后方三种门，检查右侧落地阻挡。
        g.restart();g.begin();g.cfg.planePosition={x:3.1,z:5.5};g.cfg.gateSpeed=2;
        removeRightObstacle();
        g.gates.forEach(v=>v.node.destroy());g.gates=[];
        for(const z of [6.5,5.3,3.5])g.spawnGate(z,1);
        const [front,overlap,behind]=right();
        const plane=g.spawnReward({kind:'plane',hp:50,time:0});
        assert(plane.z===5.5&&Math.abs(plane.node.position.x-3.1)<1e-5,'右侧障碍物使用可配置 X、Z');
        g.tickDrop(plane,2);
        assert(right().length===3&&front.released&&overlap.released&&!behind.released,'右侧障碍落地保留前方及占位区的门');
        g.updateGateLane(.1,1);
        assert(front.z>6.5&&overlap.z>5.3&&behind.z===3.5,'右侧只阻挡后方门，已放行门继续运行');
        g.hitReward(g.rewards.indexOf(plane),50);g.updateGateLane(.1,1);
        assert(behind.z>3.5,'右侧障碍物打破后后方门恢复移动');
        g.cfg.planePosition={z:5.5};
        const follows=g.spawnReward({kind:'plane',hp:50,time:0});
        assert(Math.abs(follows.node.position.x-g.laneX(5.5,1))<1e-5,'右侧障碍 X 留空时跟随路线');
        return {passed:passed.filter((v,i,a)=>a.indexOf(v)===i),count:passed.length};
    `);
    console.log(JSON.stringify(checks, null, 2));
} finally {
    await editorCall('execute_javascript', { context: 'editor', code: `require('electron').BrowserWindow.fromId(${id})?.destroy(); return true;` });
}
