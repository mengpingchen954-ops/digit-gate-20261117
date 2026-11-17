import { _decorator, Component, Material, MeshRenderer, Node, Vec4 } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('过门增益特效')
export class DigitGatePassEffect extends Component {
    @property({ type: Node, displayName: '地面光环' }) ring: Node = null!;
    @property({ type: Node, displayName: '上升光束' }) beams: Node = null!;
    @property({ displayName: '持续时间（秒）', min: 0.1 }) duration = 0.7;
    private age = 0;
    private materials: Material[] = [];
    private readonly phases = [new Vec4(0, 0, 0, 0), new Vec4(0, 1, 0, 0)];

    play() {
        if (!this.materials.length) this.materials = [this.ring, this.beams]
            .map(n => n.getComponentInChildren(MeshRenderer)!.getMaterialInstance(0)!);
        this.age = 0;
        this.node.active = true;
        this.update(0);
    }

    update(dt: number) {
        if (!this.materials.length) return;
        this.age += dt;
        const t = Math.min(1, this.age / this.duration);
        const radius = 0.55 + 0.65 * (1 - Math.pow(1 - t, 3));
        this.ring.setScale(radius, 1, radius);
        this.beams.setScale(0.65 + t * 0.25, 0.8 + t * 0.6, 0.65 + t * 0.25);
        this.materials.forEach((m, index) => { this.phases[index].x = t; m.setProperty('phase', this.phases[index]); });
        if (t >= 1) this.node.active = false;
    }
}
