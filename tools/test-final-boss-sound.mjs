import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';

const id = await editorCall('execute_javascript', { context: 'editor', code: `
    const address=await Editor.Message.request('preview','query-preview-url');
    const url=new URL(typeof address==='string'?address:address.url);url.hostname='127.0.0.1';
    const w=new(require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false}});
    w.audioTestErrors=[];w.webContents.on('console-message',(_e,l,m)=>{if(l>=3)w.audioTestErrors.push(m);});
    try{await w.loadURL(url.href);return w.id;}catch(e){w.destroy();throw e;}` });
const evaluate = code => editorCall('execute_javascript', { context: 'editor', code: `
    return await require('electron').BrowserWindow.fromId(${id}).webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});` }, 60000);
try {
    await evaluate((await fs.readFile('tools/prepare-bake-preview.js','utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c')));
    console.log(JSON.stringify(await evaluate(`
        const cc=await System.import('cc'),g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));
        cc.game.pause();g.music.stop();g.begin();
        const passed=[],check=(ok,label)=>{if(!ok)throw Error(label);passed.push(label);};
        check(g.finalBossDeathSound?.uuid==='61dde659-0b9c-49bd-b8ef-3a4a2ded4ddb','场景绑定工程内爆炸音效');
        const calls=[],audio=g.effectsAudio,play=audio.playOneShot;
        audio.playOneShot=function(clip,volume){calls.push({clip,volume});return play.call(this,clip,volume);};
        const explosions=()=>calls.filter(c=>c.clip===g.finalBossDeathSound).length;
        const kill=actor=>g.removeEnemy(g.enemies.indexOf(actor),true);
        const bosses=g.enemies.filter(a=>a.boss);
        check(bosses.length>1,'关卡存在多个 Boss');
        kill(g.enemies.find(a=>!a.boss));
        check(explosions()===0,'普通敌人死亡不播放爆炸音效');
        bosses.slice(0,-1).forEach(kill);
        check(explosions()===0&&calls.some(c=>c.clip===g.sounds[2]),'前面的 Boss 保持原音效');
        const last=bosses.at(-1);kill(last);
        check(explosions()===1&&g.enemies.some(a=>!a.boss),'最后一个 Boss 死亡立即播放爆炸，不等待普通敌人清空');
        kill(last);g.enemies.slice().forEach(kill);g.checkBattleEnd();
        check(explosions()===1&&g.phase==='won','重复伤害和胜利结算不重复播放爆炸');
        g.restart();g.begin();g.enemies.filter(a=>a.boss).forEach(kill);
        check(explosions()===2,'重开后最后一个 Boss 可再次播放一次');
        for(const volume of [0.25,0,1]) {
            g.finalBossDeathVolume=volume;g.restart();g.begin();g.enemies.filter(a=>a.boss).forEach(kill);
            check(calls.filter(c=>c.clip===g.finalBossDeathSound).at(-1)?.volume===volume,'组件独立音量 '+volume+' 生效');
        }
        return {passed};
    `),null,2));
    const errors=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).audioTestErrors;`});
    if(errors.length)throw Error(errors.join('\n'));
} finally {
    await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});
}
