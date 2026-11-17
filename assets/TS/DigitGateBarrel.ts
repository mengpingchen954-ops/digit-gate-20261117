import { _decorator, Component, Material, Node } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('奖励木桶滚动')
export class DigitGateBarrel extends Component {
    @property({ type: Node, displayName: '桶身滚动轴' }) rollPivot: Node = null!;
    @property({ type: Material, displayName: '飞机图标流光材质', tooltip: '仅右侧飞机奖励使用，其他奖励图标保留自身材质。' }) planeIconMaterial: Material = null!;
    private angle = 0;

    roll(distance: number, radius: number) {
        this.angle = (this.angle + distance / radius * 180 / Math.PI) % 360;
        this.rollPivot.setRotationFromEuler(this.angle, 0, 0);
    }
}
