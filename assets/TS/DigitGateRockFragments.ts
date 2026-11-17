import { _decorator, Color, Component, Material, Mesh, MeshRenderer, Node, Vec3, Vec4, utils } from 'cc';
import { ROCK_CHUNKS } from './RockFractureGeometry';
const { ccclass } = _decorator;
interface Fragment { node: Node; velocity: Vec3; spin: Vec3; size: Vec3; half: Vec3; bounces: number; }
const chunkMeshes: Mesh[] = [];
function prepareMeshes() {
    if (chunkMeshes.length) return;
    for (const chunk of ROCK_CHUNKS) {
        const positions: number[] = [], normals: number[] = [], indices: number[] = [];
        for (const face of chunk.f) {
            const vertices = face.map(i => new Vec3(chunk.p[i * 3], chunk.p[i * 3 + 1], chunk.p[i * 3 + 2]));
            const normal = Vec3.cross(new Vec3(), Vec3.subtract(new Vec3(), vertices[1], vertices[0]), Vec3.subtract(new Vec3(), vertices[2], vertices[0])).normalize();
            const start = positions.length / 3;
            for (const p of vertices) { positions.push(p.x, p.y, p.z); normals.push(normal.x, normal.y, normal.z); }
            for (let i = 1; i < vertices.length - 1; i++) indices.push(start, start + i, start + i + 1);
        }
        chunkMeshes.push(utils.createMesh({ positions, normals, indices }));
    }
}

/** 20 个原模型切割碎块；共用网格与材质，无贴图、物理引擎或逐帧资源。 */
@ccclass('奖励石头碎片')
export class DigitGateRockFragments extends Component {
    private pieces: Fragment[] = [];
    private material: Material | null = null;
    private age = 0;
    private floor = 0;

    setup(_mesh: Mesh, source: Material, color: Color, width: number, height: number, depth: number, floor: number) {
        prepareMeshes(); this.floor = floor;
        this.material = new Material(); this.material.copy(source);
        this.material.setProperty('tint', color); this.material.setProperty('feedback', new Vec4(0, 0, 0, 0));
        ROCK_CHUNKS.forEach((chunk, i) => {
            const node = new Node('原石断裂碎块'); this.node.addChild(node);
            const renderer = node.addComponent(MeshRenderer); renderer.mesh = chunkMeshes[i]; renderer.setSharedMaterial(this.material, 0);
            node.setScale(width, height, depth);
            const x = chunk.c[0] * width, y = chunk.c[1] * height, z = chunk.c[2] * depth;
            node.setPosition(x, y, z);
            const half = new Vec3();
            for (let p = 0; p < chunk.p.length; p += 3) {
                half.x = Math.max(half.x, Math.abs(chunk.p[p]) * width);
                half.y = Math.max(half.y, Math.abs(chunk.p[p + 1]) * height);
                half.z = Math.max(half.z, Math.abs(chunk.p[p + 2]) * depth);
            }
            this.pieces.push({ node, velocity: new Vec3(x * 2.2 + (Math.random() - .5) * .35, .65 + Math.random() * .7, z * 2.2 + (Math.random() - .5) * .35),
                spin: new Vec3((Math.random() - .5) * 280, (Math.random() - .5) * 220, (Math.random() - .5) * 280),
                size: node.scale.clone(), half, bounces: 0 });
        });
    }

    tick(dt: number) {
        this.age += dt;
        if (this.age >= .55) return true;
        const fade = Math.max(0, 1 - Math.max(0, this.age - .28) / .27);
        // 固定小步长避免卡顿时穿地；不引入物理引擎。
        const steps = Math.max(1, Math.ceil(dt / (1 / 60))), step = dt / steps;
        for (const p of this.pieces) {
            for (let i = 0; i < steps; i++) {
                p.velocity.y -= 8.5 * step;
                const e = p.node.eulerAngles;
                p.node.setRotationFromEuler(e.x + p.spin.x * step, e.y + p.spin.y * step, e.z + p.spin.z * step);
                const q = p.node.rotation, h = p.half;
                const extent = (Math.abs(2 * (q.x * q.y + q.z * q.w)) * h.x + Math.abs(1 - 2 * (q.x * q.x + q.z * q.z)) * h.y + Math.abs(2 * (q.y * q.z - q.x * q.w)) * h.z) * fade;
                const pos = Vec3.scaleAndAdd(new Vec3(), p.node.position, p.velocity, step), ground = this.floor + extent;
                if (pos.y < ground && p.velocity.y < 0) {
                    pos.y = ground; p.velocity.y = p.bounces++ === 0 ? -p.velocity.y * .22 : 0;
                    p.velocity.x *= .6; p.velocity.z *= .6; p.spin.multiplyScalar(.35);
                }
                p.node.setPosition(pos);
            }
            p.node.setScale(p.size.x * fade, p.size.y * fade, p.size.z * fade);
        }
        return false;
    }

    onDestroy() { this.material?.destroy(); }
}
