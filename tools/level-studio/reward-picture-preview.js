import { installNumberScrub } from '/number-scrub.js';

export function installRewardPicturePreview(context){
    const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const dialog=document.createElement('dialog');dialog.className='picture-dialog';dialog.id='rewardPictureDialog';
    dialog.innerHTML=`<div class="picture-heading"><div><h2>奖励图片 · 实时预览</h2><p>按住数字左右拖动，或直接输入；Shift 精调。预览使用真实游戏画面。</p></div><button data-picture-close>完成调整</button></div>
        <div class="picture-workspace"><div class="picture-view"><img alt="奖励物真实游戏预览" hidden><p class="picture-state" role="status">准备预览…</p>
        <div class="picture-view-controls"><label>预览镜头远近<input data-picture-zoom type="range" min="0.25" max="2" step="0.05" value="1"></label><label>剩余石头层数<select data-picture-layers></select></label></div></div>
        <div class="picture-controls"></div></div><p class="picture-footer">修改会保留为草稿。完成调整后，点击工作台右上角“应用到游戏”保存。</p>`;
    document.body.append(dialog);
    const controls=dialog.querySelector('.picture-controls'),image=dialog.querySelector('img'),message=dialog.querySelector('.picture-state'),layerSelect=dialog.querySelector('[data-picture-layers]');
    let index=null,remaining=1,zoom=1,timer,requesting=false,pending=false,version=0,gesture=false;
    const item=()=>index===null?context.config():context.config().rewards[index];
    const value=key=>key==='icon'?item()[index===null?'planeIcon':'icon']??'':key==='iconScale'?item()[index===null?'planeIconScale':'iconScale']??1:
        key.split('.').reduce((v,k)=>v?.[k],item()[index===null?'planeIconTransform':'iconTransform'])??(key.startsWith('scale.')?1:0);
    function write(key,v){
        const w=item();
        if(key==='icon'||key==='iconScale')w[index===null?(key==='icon'?'planeIcon':'planeIconScale'):key]=v;
        else{
            const name=index===null?'planeIconTransform':'iconTransform',transform=w[name]??={};
            const [group,axis]=key.split('.');transform[group]??=group==='scale'?{x:1,y:1}:{x:0,y:0,z:0};transform[group][axis]=v;
        }
        context.changed();schedule();
    }
    function renderControls(){
        const pictures=context.pictures(),selected=value('icon');
        const opts=[['','默认（跟随奖励种类）'],...pictures.map(p=>[p.uuid,p.name])];
        if(selected&&!pictures.some(p=>p.uuid===selected))opts.push([selected,'当前图片（请确认仍在场景中）']);
        const number=(label,key,step,min,max)=>`<label class="field">${label}<input type="number" data-key="${key}" value="${value(key)}" step="${step}" min="${min}" max="${max}"></label>`;
        controls.innerHTML=`<label class="field">正在调整<select data-picture-selection>${context.config().rewards.map((_,i)=>`<option value="${i}" ${index===i?'selected':''}>左侧奖励 ${i+1}</option>`).join('')}<option value="plane" ${index===null?'selected':''}>右侧奖励</option></select></label>
            <label class="field">此奖励的图片<select data-key="icon">${opts.map(([id,name])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(name)}</option>`).join('')}</select></label>
            <h3>位置偏移</h3><div class="fields">${number('左右 X','offset.x',.05,-10,10)}${number('上下 Y','offset.y',.05,-10,10)}${number('前后 Z','offset.z',.05,-10,10)}</div>
            <p class="tip">以石头顶部默认图标位置为起点；石头减少层数时仍保持此偏移。</p>
            <h3>旋转角度</h3><div class="fields">${number('上下倾斜 X','rotation.x',1,-360,360)}${number('左右转向 Y','rotation.y',1,-360,360)}${number('平面旋转 Z','rotation.z',1,-360,360)}</div>
            <h3>图片缩放</h3><div class="fields">${number('整体大小','iconScale',.05,.1,4)}${number('宽度倍率 X','scale.x',.05,.1,4)}${number('高度倍率 Y','scale.y',.05,.1,4)}</div>
            <button data-picture-reset class="full">重置此图的位置、旋转和大小</button>`;
        const full=index===null?context.config().planeLayers:item().layers;
        remaining=Math.min(remaining,full);
        layerSelect.innerHTML=Array.from({length:full},(_,i)=>full-i).map(n=>`<option value="${n}" ${n===remaining?'selected':''}>${n} 层${n===full?'（完整）':''}</option>`).join('');
    }
    function schedule(){version++;pending=true;clearTimeout(timer);timer=setTimeout(refresh,160);message.textContent=image.hidden?'正在启动真实游戏预览…':'正在更新…';}
    async function refresh(){
        if(requesting||!dialog.open)return;
        requesting=true;pending=false;const current=version;
        try{
            const sceneUuid=context.sceneUuid();if(!sceneUuid)throw Error('请先连接 Creator 并刷新场景');
            const result=await context.api('/api/reward-picture-preview',{config:structuredClone(context.config()),index,remaining,zoom,sceneUuid});
            if(dialog.open&&current===version){image.src=result.image;image.hidden=false;message.textContent='实时画面 · '+result.layers+' 层';}
        }catch(e){if(dialog.open)message.textContent=e.message+'；调整任一参数可重试。';}
        finally{requesting=false;if(pending&&dialog.open)refresh();}
    }
    const scrub=installNumberScrub(controls,{
        begin:context.checkpoint,bounds:(_key,el)=>[Number(el.min),Number(el.max)],change:write,
        end(_key,cancel){if(cancel)context.restoreUndo();renderControls();context.changed();schedule();},
    });
    controls.addEventListener('focusin',()=>{gesture=false;});
    controls.addEventListener('input',event=>{
        const el=event.target,key=el.dataset.key;if(!key||scrub.active())return;
        const v=el.tagName==='SELECT'?el.value:Number(el.value);
        if(el.tagName!=='SELECT'&&(el.value===''||!Number.isFinite(v)||v<Number(el.min)||v>Number(el.max)))return;
        if(!gesture){context.checkpoint();gesture=true;}write(key,v);
    });
    controls.addEventListener('change',event=>{
        if(event.target.hasAttribute('data-picture-selection'))open(event.target.value==='plane'?null:Number(event.target.value));
        gesture=false;
    });
    controls.addEventListener('click',event=>{
        if(!event.target.closest('[data-picture-reset]'))return;
        context.checkpoint();const w=item();delete w[index===null?'planeIconTransform':'iconTransform'];delete w[index===null?'planeIconScale':'iconScale'];
        renderControls();context.changed();schedule();
    });
    dialog.querySelector('[data-picture-close]').onclick=()=>dialog.close();
    dialog.querySelector('[data-picture-zoom]').oninput=e=>{zoom=Number(e.target.value);schedule();};
    layerSelect.onchange=()=>{remaining=Number(layerSelect.value);schedule();};
    dialog.addEventListener('close',()=>{clearTimeout(timer);version++;pending=false;context.renderPanel();context.api('/api/reward-picture-preview',{close:true}).catch(()=>{});});
    function open(selected){
        index=selected;gesture=false;remaining=index===null?context.config().planeLayers:item().layers;
        renderControls();if(!dialog.open){image.hidden=true;dialog.showModal();}schedule();
    }
    return {open};
}
