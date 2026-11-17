import { _decorator, Color, Component, Material, MeshRenderer, Vec4 } from 'cc';

const { ccclass, property } = _decorator;

/** 一次性 Shader 播放器：命中闪爆和 Boss 地面爆炸各用独立材质。 */
@ccclass('受击爆炸光效')
export class DigitGateHitEffect extends Component {
    @property({ type: [MeshRenderer], displayName: 'Shader 渲染层' }) layers: MeshRenderer[] = [];
    @property({ displayName: '持续时间（秒）', min: .12 }) duration = .28;
    @property({ displayName: '爆炸范围', min: .05 }) radius = .46;
    @property({ displayName: '爆炸高度', min: .05 }) height = .82;
    @property({ displayName: '亮度', min: 0 }) brightness = 1.5;

    private age = 0;
    private playing = false;
    private playbackDuration = .28;
    private playbackBrightness = 1.5;
    private materials: Material[] = [];
    private readonly phase = new Vec4();
    private readonly shape = new Vec4();

    play(color: Color, scale = 1, strength = 1, duration = this.duration) {
        if (!this.materials.length) this.materials = this.layers.map(r => r.getMaterialInstance(0)!);
        this.age = 0;
        this.playing = true;
        this.playbackDuration = duration;
        this.playbackBrightness = this.brightness * strength;
        this.node.setScale(scale, scale, scale);
        this.node.active = true;
        for (const material of this.materials) material.setProperty('tint', color);
        this.sample(0);
    }

    update(dt: number) {
        if (!this.playing) return;
        this.age += dt;
        const progress = Math.min(1, this.age / Math.max(.12, this.playbackDuration));
        this.sample(progress);
        if (progress >= 1) this.recycle();
    }

    sample(progress: number) {
        this.shape.set(this.radius, this.height, 0, 0);
        for (let i = 0; i < this.materials.length; i++) {
            this.phase.set(progress, i, this.playbackBrightness, 0);
            this.materials[i].setProperty('phase', this.phase);
            this.materials[i].setProperty('shape', this.shape);
        }
    }

    recycle() { this.playing = false; this.node.active = false; }
}
