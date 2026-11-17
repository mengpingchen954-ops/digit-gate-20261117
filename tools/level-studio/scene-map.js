// 当前编辑场景的真实网格（包括嵌套节点、预制体实例及父级变换），不保存、不改节点。
return (async () => {
    const scene = cc.director.getScene();
    const g = scene.getComponentsInChildren(cc.Component).find(c => c.settingsAsset && c.soldierPrefabs);
    if (!g) throw Error('当前场景没有数字门玩法，请打开对应游戏场景。');
    const objects = [], warnings = [], point = new cc.Vec3();
    const nodePath = n => { const names = []; for (let p = n; p && p !== scene; p = p.parent) names.unshift(p.name); return names.join(' › '); };
    function excluded(n) {
        for (let p = n; p && p !== scene; p = p.parent) {
            if (!p.active || p === g.node || p.getComponent(cc.Canvas) || p.name.startsWith('Editor Scene ') || p.name === '__关卡预览（不保存）__') return true;
        }
        return false;
    }
    for (const r of scene.getComponentsInChildren(cc.MeshRenderer)) {
        if (!r.enabled || excluded(r.node) || r === g.seaRenderer || r instanceof cc.SkinnedMeshRenderer) continue;
        if (!r.mesh) { warnings.push(nodePath(r.node) + '：未设置网格'); continue; }
        const triangles = [];
        for (let sub = 0; sub < r.mesh.struct.primitives.length; sub++) {
            const primitive = r.mesh.struct.primitives[sub];
            if (primitive.primitiveMode !== cc.gfx.PrimitiveMode.TRIANGLE_LIST) { warnings.push(nodePath(r.node) + '：非三角形网格'); continue; }
            const vertices = r.mesh.readAttribute(sub, cc.gfx.AttributeName.ATTR_POSITION);
            const indices = r.mesh.readIndices(sub);
            if (!vertices) { warnings.push(nodePath(r.node) + '：无法读取网格顶点'); continue; }
            const world = [];
            for (let v = 0; v < vertices.length; v += 3) {
                point.set(vertices[v], vertices[v + 1], vertices[v + 2]); cc.Vec3.transformMat4(point, point, r.node.worldMatrix);
                world.push([point.x, point.y, point.z]);
            }
            const material = r.sharedMaterials[sub] ?? r.sharedMaterials[0];
            const color = material?.getProperty('mainColor');
            const rgb = color && 'r' in color ? [color.r, color.g, color.b] : [128, 148, 164];
            const count = indices?.length ?? world.length;
            for (let i = 0; i + 2 < count; i += 3) {
                const a = world[indices ? indices[i] : i], b = world[indices ? indices[i + 1] : i + 1], c = world[indices ? indices[i + 2] : i + 2];
                if (!a || !b || !c) continue;
                const area = (b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
                if (Math.abs(area) < 1e-7) continue;
                triangles.push({ points: [a[0], a[2], b[0], b[2], c[0], c[2]], height: (a[1]+b[1]+c[1])/3, color: rgb });
            }
        }
        objects.push({ id: r.node.uuid, name: r.node.name, path: nodePath(r.node), position: { x: r.node.worldPosition.x, y: r.node.worldPosition.y, z: r.node.worldPosition.z }, triangles });
    }
    // MCP 的对象摘要会截断深层数组；返回 JSON 文本保留完整顶点。
    const actorAnimations = [...g.soldierPrefabs.map((p,i)=>({key:'soldier'+(i+1),prefab:p})),
        {key:'enemy',prefab:g.enemyPrefab}, ...g.bossPrefabs.map((p,i)=>({key:'boss'+(i+1),prefab:p}))].map(({key,prefab})=>{
        const frames=prefab.data.getComponent(cc.js.getClassByName('角色序列帧'));
        const binder=prefab.data.getComponent(cc.js.getClassByName('角色动画绑定'));
        const clips=frames ? frames.atlasData.json.actions.map(a=>({name:a.name,duration:a.duration}))
            : prefab.data.getComponentInChildren(cc.SkeletalAnimation).clips.filter(Boolean).map((c,i)=>({name:binder.actionNames[i]||c.name,duration:c.duration}));
        return {key,name:prefab.name,uuid:prefab.uuid,format:frames?'序列帧':'骨骼动画',clips};
    });
    const pictures = [...new Map([...(g.rewardIconTextures ?? []), ...g.textures].filter(Boolean).map(t => [t.uuid, t])).values()];
    const rewardIcons = await Promise.all(pictures.map(async (t,i) => {
        const url = await Editor.Message.request('asset-db', 'query-url', t.uuid.split('@')[0]);
        return { uuid: t.uuid, name: typeof url === 'string' ? url.slice(url.lastIndexOf('/') + 1) : t.name || `图片 ${i + 1}` };
    }));
    return JSON.stringify({ sceneUuid: scene.uuid, sceneName: scene.name, objects, warnings, actorAnimations, rewardIcons,
        prefabs: g.soldierPrefabs.map(p => ({ uuid: p.uuid, name: p.name })), gameNode: g.node.uuid, gameComponent: g.uuid });
})();
