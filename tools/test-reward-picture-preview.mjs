import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { editorCall } from './editor-bridge-client.mjs';
const session=JSON.parse(await fs.readFile('tools/level-studio/data/app-session.json','utf8'));
const base='http://127.0.0.1:'+session.port;
const configFile='assets/配置/数字门配置.json';
const before=crypto.createHash('sha256').update(await fs.readFile(configFile)).digest('hex');
const sceneBefore=await editorCall('execute_javascript',{context:'editor',code:"return await Editor.Message.request('scene','query-dirty');"});
const id=await editorCall('execute_javascript',{context:'editor',code:`
    const w=new(require('electron').BrowserWindow)({show:false,width:1440,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false,partition:'picture-ui-qa-'+Date.now()}});
    w.pictureTestErrors=[];w.webContents.on('console-message',(_e,l,m)=>{if(l>=3)w.pictureTestErrors.push(m);});
    await w.loadURL(${JSON.stringify(base+'/#rewards')});return w.id;`},45000);
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`
    const w=require('electron').BrowserWindow.fromId(${id});
    try{return await w.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});}catch(e){throw Error(e.message+' '+w.pictureTestErrors.join(' | '));}`},45000);
async function capture(name){
    const png=await editorCall('execute_javascript',{context:'editor',code:`return(await require('electron').BrowserWindow.fromId(${id}).webContents.capturePage()).toPNG().toString('base64');`});
    await fs.mkdir('temp/reward-picture-preview',{recursive:true});await fs.writeFile('temp/reward-picture-preview/'+name+'.png',Buffer.from(png,'base64'));
}
try{
    await evaluate(`
        for(let i=0;i<120;i++){
            if(document.querySelector('select[data-key="rewards.0.icon"]')?.options.length>1){document.querySelector('[data-picture-preview="1"]').click();return true;}
            await new Promise(r=>setTimeout(r,100));
        }throw Error('工作台图片控件未就绪');`);
    await evaluate(`
        for(let i=0;i<200;i++){
            if(document.querySelector('#rewardPictureDialog .picture-state').textContent.startsWith('实时画面'))return true;
            await new Promise(r=>setTimeout(r,100));
        }throw Error(document.querySelector('#rewardPictureDialog .picture-state').textContent);`);
    console.log(JSON.stringify(await evaluate(`
        window.pictureChecks=[];window.check=(ok,s)=>{if(!ok)throw Error(s);pictureChecks.push(s);};
        window.dialog=document.querySelector('#rewardPictureDialog');window.image=dialog.querySelector('img');window.initialImage=image.src;
        check(dialog.open&&!image.hidden&&image.naturalWidth===600,'工作台显示真实游戏图片');
        check(dialog.querySelectorAll('input[data-key]').length===9,'位置三轴、旋转三轴、整体大小和宽高独立可调');
        const input=dialog.querySelector('[data-key="offset.x"]');input.value='.45';input.dispatchEvent(new Event('input',{bubbles:true}));
        return pictureChecks;`),null,2));
    await evaluate(`for(let i=0;i<100;i++){if(image.src!==initialImage&&dialog.querySelector('.picture-state').textContent.startsWith('实时画面'))return true;await new Promise(r=>setTimeout(r,100));}throw Error('修改后预览未更新');`);
    await evaluate(`
        check(image.src!==initialImage,'修改位置后画面即时更新');
        window.fullImage=image.src;
        const layers=dialog.querySelector('[data-picture-layers]');layers.value='1';layers.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
    await evaluate(`for(let i=0;i<100;i++){if(image.src!==fullImage&&dialog.querySelector('.picture-state').textContent==='实时画面 · 1 层')return true;await new Promise(r=>setTimeout(r,100));}throw Error('减层预览未更新');`);
    await capture('dialog-one-layer');
    await evaluate(`
        check(dialog.querySelector('.picture-state').textContent==='实时画面 · 1 层','可预览石头减少层数后的图片位置');
        const select=dialog.querySelector('[data-picture-selection]');select.value='plane';select.dispatchEvent(new Event('change',{bubbles:true}));
        check(dialog.querySelector('[data-key="offset.x"]').value==='0','切换右侧奖励时不沿用左侧位置');
        const y=dialog.querySelector('[data-key="rotation.z"]');y.value='25';y.dispatchEvent(new Event('input',{bubbles:true}));
        const left=dialog.querySelector('[data-picture-selection]');left.value='1';left.dispatchEvent(new Event('change',{bubbles:true}));
        check(dialog.querySelector('[data-key="offset.x"]').value==='0.45'&&dialog.querySelector('[data-key="rotation.z"]').value==='0','切换回来保留本份奖励设置，各份互不影响');
        dialog.querySelector('[data-picture-reset]').click();
        check(dialog.querySelector('[data-key="offset.x"]').value==='0'&&dialog.querySelector('[data-key="scale.x"]').value==='1','可一键恢复当前图片的默认变换');
        const right=dialog.querySelector('[data-picture-selection]');right.value='plane';right.dispatchEvent(new Event('change',{bubbles:true}));
        check(dialog.querySelector('[data-key="rotation.z"]').value==='25','重置左侧图片不影响右侧');
        return true;`);
    await evaluate(`for(let i=0;i<100;i++){if(dialog.querySelector('.picture-state').textContent.startsWith('实时画面'))return true;await new Promise(r=>setTimeout(r,100));}throw Error('右侧预览未完成');`);
    await capture('dialog-right-reward');
    console.log(JSON.stringify(await evaluate(`dialog.querySelector('[data-picture-close]').click();check(!dialog.open,'完成后关闭预览并保留草稿');return pictureChecks;`),null,2));
    const after=crypto.createHash('sha256').update(await fs.readFile(configFile)).digest('hex');
    const dirty=await editorCall('execute_javascript',{context:'editor',code:"return await Editor.Message.request('scene','query-dirty');"});
    if(before!==after||dirty!==sceneBefore)throw Error('预览修改了关卡文件或编辑场景');
    console.log('预览期间配置文件和编辑场景均未改变');
}finally{
    const state=await fetch(base+'/api/state').then(r=>r.json());
    await fetch(base+'/api/reward-picture-preview',{method:'POST',headers:{'content-type':'application/json','x-studio-token':state.token},body:JSON.stringify({close:true})});
    await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});
}
