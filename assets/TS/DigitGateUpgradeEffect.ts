import { _decorator, Color, Component, Material, MeshRenderer, Vec4 } from 'cc';

const { ccclass, property } = _decorator;

/** 四层程序化光效：地面冲击环、上升光束、螺旋光带、闪光粒子。 */
@ccclass('升级能量光效')
export class DigitGateUpgradeEffect extends Component {
    @property({ type: [MeshRenderer], displayName: '光环、光束、光带、粒子' }) layers: MeshRenderer[] = [];
    @property({ displayName: '持续时间（秒）', min: .2 }) duration = 1.15;
    @property({ displayName: '扩散范围', min: .1 }) radius = 1.15;
    @property({ displayName: '光效高度', min: .1 }) height = 2.1;
    @property({ displayName: '亮度', min: 0 }) brightness = 1.25;

    private age = 0;
    private playing = false;
    private materials: Material[] = [];
    private readonly phase = new Vec4();
    private readonly shape = new Vec4();

    play(color: Color, scale = 1) {
        if (!this.materials.length) this.materials = this.layers.map(r => r.getMaterialInstance(0)!);
        this.age = 0;
        this.playing = true;
        this.node.setScale(scale, scale, scale);
        this.node.active = true;
        for (const material of this.materials) material.setProperty('tint', color);
        this.sample(0);
    }

    update(dt: number) {
        if (!this.playing) return;
        this.age += dt;
        const progress = Math.min(1, this.age / Math.max(.2, this.duration));
        this.sample(progress);
        if (progress >= 1) this.recycle();
    }

    private sample(progress: number) {
        this.shape.set(this.radius, this.height, 0, 0);
        for (let i = 0; i < this.materials.length; i++) {
            this.phase.set(progress, i, this.brightness, 0);
            this.materials[i].setProperty('phase', this.phase);
            this.materials[i].setProperty('shape', this.shape);
        }
    }

    recycle() {
        this.playing = false;
        this.node.active = false;
    }
}
