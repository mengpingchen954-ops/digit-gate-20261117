import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';
const id=await editorCall('execute_javascript',{context:'editor',code:`const a=await Editor.Message.request('preview','query-preview-url'),u=new URL(typeof a==='string'?a:a.url);u.hostname='127.0.0.1';const w=new(require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false}});await w.loadURL(u.href);return w.id;`});
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`return await require('electron').BrowserWindow.fromId(${id}).webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});`},60000);
try{
    await evaluate((await fs.readFile('tools/prepare-bake-preview.js','utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c')));
    const result=await evaluate(`
        const cc=await System.import('cc'),g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));cc.game.pause();g.music.stop();g.sound=()=>{};
        const results=[];
        for(const uuid of ['0880d8b6-72e9-4aee-8082-c204a6c67012','d9309074-e7db-4cf5-aba4-fddf3403bc0d','76b94488-2a96-4e7b-84c0-4d073d12a92c']){
            const p=await new Promise((r,j)=>cc.assetManager.loadAny({uuid},(e,a)=>e?j(e):r(a))),n=cc.instantiate(p);g.world.addChild(n);n.setPosition(0,0,0);n.setScale(1,1,1);
            const binder=n.getComponent(cc.js.getClassByName('角色动画绑定'));binder.autoPlay=false;const anim=binder.bind(),clip=anim.clips.find(c=>/Move|Walk|Run/.test(c.name));
            anim.play(clip.name);const s=anim.getState(clip.name);s.setTime(.4);s.sample();s.pause();cc.game.step();cc.game.pause();
            results.push({uuid,name:n.name,scale:n.getChildByName('屠夫模型与动画')?.scale,renderers:n.getComponentsInChildren(cc.SkinnedMeshRenderer).map(r=>({name:r.node.name,bounds:r.model?.worldBounds,modelBounds:r.model?.modelBounds}))});n.destroy();
        }return results;
    `);
    console.log(JSON.stringify(result,null,2));
    await fs.writeFile('tools/backups/boss-import/size-comparison.json',JSON.stringify(result,null,2));
}finally{await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});}
