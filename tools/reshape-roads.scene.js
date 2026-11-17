const input = ROAD_INPUT;
const scene = cc.director.getScene(), terrain = scene.getChildByName('地形');
if (scene.uuid !== 'e26a1c6f-fd17-4e70-85c0-1a6dd541906c' || terrain.getChildByName('连续S弯道路')) throw Error('场景不匹配或道路已经搭建');
const cameras = scene.getComponentsInChildren(cc.Camera).filter(c => !c.node.name.includes('Editor')).map(c => ({ id: c.node.uuid, p: c.node.position.clone(), r: c.node.rotation.clone() }));
const middle = terrain.getChildByName('Plane'), left = terrain.getChildByName('Plane-004'), right = terrain.getChildByName('Plane-002');
const fence = terrain.children.find(n => n.name.startsWith('围栏'));
if (!middle?.getComponent(cc.MeshRenderer)?.mesh || !fence) throw Error('缺少原有路面或围栏');
const oldChildren = [...terrain.children];
const root = new cc.Node('连续S弯道路'); root.parent = terrain;
const group = name => { const n = new cc.Node(name); n.parent = root; return n; };
const len = (a,b) => Math.hypot(b.x-a.x,b.z-a.z);
const yaw = (a,b) => Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI;
let roads = 0, fences = 0;
for (let lane = 0; lane < 2; lane++) {
    const parent = group(lane ? '左路-S弯-宽2.8' : '中路-S弯-宽3.79'), points = input.curves[lane];
    for (let i = 1; i < points.length; i++) {
        const a = points[i-1], b = points[i], n = cc.instantiate(lane ? left : middle);
        n.name = `原路面-${String(i).padStart(3,'0')}`; n.parent = parent;
        n.setPosition((a.x+b.x)/2, 0, (a.z+b.z)/2); n.setRotationFromEuler(0,yaw(a,b),0);
        // Small overlap covers the wedge between neighboring rigid road pieces.
        const prev = points[Math.max(0,i-2)], next = points[Math.min(points.length-1,i+1)];
        const angle = Math.atan2(b.x-a.x,b.z-a.z), before = Math.atan2(a.x-prev.x,a.z-prev.z), after = Math.atan2(next.x-b.x,next.z-b.z);
        const delta = v => Math.atan2(Math.sin(v),Math.cos(v));
        const overlap = input.widths[lane] * Math.max(i>1?Math.abs(Math.tan(delta(angle-before)/2)):0,i<points.length-1?Math.abs(Math.tan(delta(after-angle)/2)):0);
        n.setScale(input.widths[lane]/10, 1, (len(a,b)+overlap+.006)/10); roads++;
    }
}
// Original prefab: one post and two rails extending 2.54 units in local +Z.
function railLine(points, parent) {
    let a = points[0], carry = 0;
    for (let i=1;i<points.length;i++) {
        carry += len(points[i-1],points[i]);
        if (carry<1.25 && i<points.length-1) continue;
        const b=points[i], n=cc.instantiate(fence);
        n.name=`原围栏-${++fences}`; n.parent=parent;
        n.setPosition(a.x,.278,a.z); n.setRotationFromEuler(0,yaw(a,b),0); n.setScale(1,1,len(a,b)/2.54);
        a=b; carry=0;
    }
    const n=cc.instantiate(fence); n.name='末端立柱'; n.parent=parent;
    n.setPosition(a.x,.278,a.z); n.setScale(1,1,.001);
}
input.fences.forEach((points,i)=>railLine(points,group(['左路外栏','左右道路分隔栏','中路右栏'][i])));
// Keep the original short road width and original entrance platform.
right.setPosition(2.777,0,1.809); right.setScale(.28,1,.3);
const stub = group('右路-短段-宽2.8');
railLine([{x:4.075,z:3.309},{x:4.075,z:.309}],stub);
railLine([{x:4.075,z:.309},{x:1.785,z:.309}],stub);
// Replace only the old road pieces and their old edge barriers. Lobby and sea stay in place.
for (const n of oldChildren) {
    if (n===middle || n===left || ['Cube-001','Cube-002','Cube-005','Cube-006'].includes(n.name)
        || (n.name.startsWith('围栏') && n.position.z<3.309)) n.destroy();
}
await Editor.Message.request('scene','save-scene');
return { roads, fences, widths: input.widths, rightLength:3, cameras };
