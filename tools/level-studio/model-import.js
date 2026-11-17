// 只负责导入面板，战斗数值仍由工作台原配置管理。
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const supported=/\.(fbx|glb|gltf|bin|png|jpe?g|webp|tga|bmp|anim)$/i;
let job=null,selection=null,localBusy=false,polling=false,options;
async function api(suffix='',input){
    const r=await fetch('/api/model-import'+suffix+(suffix&&job?'?id='+encodeURIComponent(job.id):''),input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':options.token()},body:JSON.stringify(input)});
    const value=await r.json();if(!r.ok)throw Error(value.error);return value;
}
const isWorking=()=>localBusy||['importing','binding','baking','committing'].includes(job?.state);
export function modelImportPanel(){
    const busy=isWorking();
    const pick=(label,key,items,empty)=>`<label class="field">${label}<select data-model-field="${key}" ${busy?'disabled':''}><option value="">${empty}</option>${items.map(x=>`<option value="${esc(x.uuid)}" ${get(key)===x.uuid?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`;
    return `<div class="help">只更换普通丧尸，不改变 Boss、数量或伤害。<br>选入模型、配套动画和贴图 → 检查识别结果 → 生成并替换。</div>
    <section class="section"><h2>① 放入模型文件</h2><div id="modelDrop" class="model-drop" tabindex="0">拖入文件到这里<br><small>FBX / GLB / glTF + 动画 + 贴图</small></div>
    <label class="model-pick">选择文件（可多选）<input id="modelFiles" type="file" multiple accept=".fbx,.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.tga,.bmp,.anim" ${busy?'disabled':''}></label>
    <label class="model-pick">选择整个文件夹<input id="modelFolder" type="file" multiple webkitdirectory ${busy?'disabled':''}></label>
    <p class="tip">模型需要骨骼和行走、攻击、死亡动作，可分别放在多个文件中。glTF 的 BIN 和贴图请一起选择，文件夹导入会保留相对路径。单文件 ≤64 MB，一批 ≤256 MB。</p></section>
    ${job?`<div class="model-progress ${job.state==='error'?'model-error':''}" role="status">${busy?'<progress aria-label="模型处理进度"></progress>':''}<strong>${esc(job.message)}</strong>${job.warning?`<p>${esc(job.warning)}</p>`:''}<p class="small">本批 ${job.files.length} 个文件 · 已接收 ${job.uploaded.length} 个</p></div>`:''}
    ${job?.catalog&&selection?`<section class="section"><h2>② 检查模型与动作</h2>${pick('身体模型','model',job.catalog.models,'请选择身体模型')}${pick('行走 / 跑步动作','Run',job.catalog.clips,'未识别，请选择')}${pick('攻击动作','Attack',job.catalog.clips,'未识别，请选择')}${pick('死亡动作','Death',job.catalog.clips,'未识别，请选择')}${pick('底色贴图（可选覆盖）','texture',job.catalog.textures,'保留模型原材质')}
    <p class="tip">自动选择按文件名和动作名识别，请核对。贴图覆盖适用于单底色角色；多材质角色请选择“保留模型原材质”，并带齐材质引用的图片。</p>
    <label class="field">攻击命中位置：<output id="hitPercentValue">${selection.hitPercent}%</output><input data-model-field="hitPercent" type="range" min="1" max="99" value="${selection.hitPercent}" ${busy?'disabled':''}><small>拖动滑块；45% 表示攻击播到 45% 时造成伤害。</small></label>
    <label class="field">朝向修正（度）<select data-model-field="yaw" ${busy?'disabled':''}>${[0,90,-90,180].map(n=>`<option value="${n}" ${selection.yaw===n?'selected':''}>${n}°${n===0?'（保持原模型）':''}</option>`).join('')}</select></label>
    <p class="tip">不会自动猜测正面方向或跨骨架重定向。动画不兼容会停止；新模型大小可在“丧尸生成区域”调整。</p>
    <button id="modelBuild" class="full primary" ${busy||job.state!=='ready'?'disabled':''}>③ 生成并替换丧尸</button></section>`:''}
    ${job?.state==='done'?'<button id="modelRestore" class="full">恢复替换前丧尸</button><p class="tip">重新运行游戏检查外观、朝向与三个动作。恢复只改角色引用，保留其他关卡调整。</p>':''}
    <p class="tip">请保持 Creator 打开并先保存修改。工具会打开游戏关卡并短暂运行预览来生成图片。新源资源保存在“预制体 / 制作源资源”；原资源不会被删除。</p>`;
}
function get(key){return selection?.actions?.[key]??selection?.[key]??'';}
async function refresh(){
    if(polling)return;polling=true;
    try{
        const value=await api();const before=job?.state,oldId=job?.id,oldMessage=job?.message;
        job=value.job;if(job?.selection&&(!selection||oldId!==job.id||before!==job.state&&job.state==='ready'))selection=structuredClone(job.selection);
        if(before!==job?.state||oldMessage!==job?.message||oldId!==job?.id)options.render();
        if(before&&before!==job?.state&&['done','restored'].includes(job?.state))await options.complete();
    }catch(e){options.status(e.message);}finally{polling=false;}
}
async function upload(list){
    if(isWorking())return;
    const all=[...list],files=all.filter(f=>supported.test(f.name));
    if(!files.length)throw Error('没有受支持的模型、动画或贴图文件');
    if(files.length!==all.length&&!confirm(`将导入 ${files.length} 个模型与配套文件，忽略 ${all.length-files.length} 个不支持的文件（如 .meta、文档）。继续？`))return;
    localBusy=true;selection=null;
    try{
        const result=await api('/start',{files:files.map(f=>({name:f.webkitRelativePath||f.name,size:f.size}))});job=result.job;options.render();
        for(const f of files){
            const r=await fetch('/api/model-import/file?id='+job.id+'&name='+encodeURIComponent(f.webkitRelativePath||f.name),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Studio-Token':options.token()},body:f});
            const data=await r.json();if(!r.ok)throw Error(data.error);job.uploaded.push(f.name);options.render();
        }
        await api('/analyze',{});
    }finally{localBusy=false;await refresh();}
}
export function installModelImport(config){
    options=config;
    const panel=document.getElementById('panel'),safe=fn=>Promise.resolve().then(fn).catch(e=>options.error(e.message));
    panel.addEventListener('input',e=>{if(e.target.dataset.modelField==='hitPercent'){selection.hitPercent=Number(e.target.value);document.getElementById('hitPercentValue').textContent=e.target.value+'%';}});
    panel.addEventListener('change',e=>{
        if(['modelFiles','modelFolder'].includes(e.target.id))void safe(()=>upload(e.target.files));
        const key=e.target.dataset.modelField;if(!key||!selection)return;
        if(['Run','Attack','Death'].includes(key))selection.actions[key]=e.target.value;
        else selection[key]=['hitPercent','yaw'].includes(key)?Number(e.target.value):e.target.value;
    });
    panel.addEventListener('dragover',e=>{if(e.target.closest('#modelDrop')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
    panel.addEventListener('drop',e=>{if(e.target.closest('#modelDrop')){e.preventDefault();void safe(()=>upload(e.dataTransfer.files));}});
    panel.addEventListener('click',e=>{const id=e.target.closest('button')?.id;if(!['modelBuild','modelRestore'].includes(id))return;
        void safe(async()=>{
            if(options.dirty())throw Error('请先应用或重新读取尚未保存的数值调整，再替换角色');
            if(id==='modelRestore'&&!confirm('恢复本次替换前的丧尸？其他关卡设置保持不变。'))return;
            await api(id==='modelBuild'?'/build':'/restore',id==='modelBuild'?selection:{});await refresh();
        });
    });
    void refresh();setInterval(()=>{if(!localBusy)void refresh();},2000);
}
