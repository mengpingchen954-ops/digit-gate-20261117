import { _decorator, Animation, AnimationClip, Component, JsonAsset, Mesh, MeshRenderer, RealInterpolationMode, Vec3, animation, utils } from 'cc';

const { ccclass, property } = _decorator;
interface FrameAction { name: string; duration: number; start: number; frames: number; sourceDirections?: number[]; events: { frame: number; func: string; params: string[] }[]; }
interface FrameData { size: number; padding: number; tile: number; columns: number; rows: number; directions: number; span: number; centerY: number; actions: FrameAction[]; }

/** 普通角色只绘制共享四边形；每个实例仅更新帧索引、方向和闪白。 */
@ccclass('角色序列帧')
export class DigitGateFrameRenderer extends Component {
    @property({ type: JsonAsset, displayName: '烘焙动作数据' }) atlasData: JsonAsset = null!;
    frame = 0;
    private renderer: MeshRenderer = null!;
    private data: FrameData = null!;
    private lastFrame = -1;
    private uv = [0, 0, 0, 0];
    private static mesh: Mesh;
    private static clips = new WeakMap<JsonAsset, AnimationClip[]>();
    private static forward = new Vec3();

    bind(): Animation {
        const player = this.getComponent(Animation)!;
        if (this.data) return player;
        this.data = this.atlasData.json as FrameData;
        this.renderer = this.node.getChildByName('序列帧画面')!.getComponent(MeshRenderer)!;
        DigitGateFrameRenderer.mesh ??= utils.createMesh({
            positions: [-.5,-.5,0, .5,-.5,0, -.5,.5,0, .5,.5,0],
            uvs: [0,1, 1,1, 0,0, 1,0], indices: [0,1,2, 2,1,3],
            minPos: new Vec3(-3,-3,-3), maxPos: new Vec3(3,3,3),
        });
        this.renderer.mesh = DigitGateFrameRenderer.mesh;
        this.node.getChildByName('脚底阴影')!.getComponent(MeshRenderer)!.mesh = DigitGateFrameRenderer.mesh;
        let clips = DigitGateFrameRenderer.clips.get(this.atlasData);
        if (!clips) {
            clips = this.data.actions.map(action => {
                const clip = new AnimationClip(); clip.name = action.name; clip.duration = action.duration; clip.sample = 24;
                clip.events = action.events; clip.wrapMode = AnimationClip.WrapMode.Normal;
                const track = new animation.RealTrack();
                track.path = new animation.TrackPath().toComponent('角色序列帧').toProperty('frame');
                const times = Array.from({length: action.frames}, (_, i) => i * action.duration / action.frames);
                track.channels()[0].curve.assignSorted(times, times.map((_,i) => ({value: action.start+i, interpolationMode: RealInterpolationMode.CONSTANT})));
                clip.addTrack(track); return clip;
            });
            DigitGateFrameRenderer.clips.set(this.atlasData, clips);
        }
        player.clips = clips;
        this.renderer.setInstancedAttribute('a_frameFlash', [0,0,0,0]);
        this.lateUpdate();
        return player;
    }

    onLoad() { this.bind(); }
    onEnable() { this.lastFrame = -1; }
    start() { this.lastFrame = -1; this.lateUpdate(); }

    setFlash(value: number) {
        this.renderer.setInstancedAttribute('a_frameFlash', [value,0,0,0]);
    }

    lateUpdate() {
        if (!this.data) return;
        const d = this.data;
        const base = Math.floor(this.frame + .0001);
        const action = d.actions.find(a => base >= a.start && base < a.start + a.frames)!;
        let direction = 0;
        if (d.directions > 1) {
            Vec3.transformQuat(DigitGateFrameRenderer.forward, Vec3.UNIT_Z, this.node.worldRotation);
            const yaw = Math.atan2(DigitGateFrameRenderer.forward.x, DigitGateFrameRenderer.forward.z);
            direction = (Math.round(yaw / (Math.PI * 2) * d.directions) + d.directions) % d.directions;
        }
        // 每个动作可保留不同方向；旧图集仍按完整方向表取帧，不逐帧分配数组。
        if (action.sourceDirections) {
            let nearest = 0, bestDistance = Infinity;
            for (let i = 0; i < action.sourceDirections.length; i++) {
                const delta = Math.abs(action.sourceDirections[i] - direction);
                const distance = Math.min(delta, d.directions - delta);
                if (distance < bestDistance) { bestDistance = distance; nearest = i; }
            }
            direction = nearest;
        }
        const index = base + direction * action.frames;
        if (this.lastFrame === index) return;
        this.lastFrame = index;
        this.uv[0] = d.size / (d.columns*d.tile); this.uv[1] = d.size / (d.rows*d.tile);
        this.uv[2] = ((index % d.columns)*d.tile+d.padding)/(d.columns*d.tile);
        this.uv[3] = (Math.floor(index/d.columns)*d.tile+d.padding)/(d.rows*d.tile);
        this.renderer.setInstancedAttribute('a_frameUV', this.uv);
    }
}
