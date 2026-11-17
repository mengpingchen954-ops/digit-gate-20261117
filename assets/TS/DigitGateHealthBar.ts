import { _decorator, Color, Component, Graphics, UITransform } from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, executeInEditMode, property } = _decorator;

@ccclass('角色圆角血条')
@executeInEditMode
export class DigitGateHealthBar extends Component {
    @property({ displayName: '血量颜色' }) fillColor = new Color(244, 58, 51);
    @property({ displayName: '底条颜色' }) backgroundColor = new Color(15, 23, 50);
    @property({ displayName: '内边距', min: 0 }) padding = 3;
    private ratio = 1;
    private signature = '';

    onEnable() { this.draw(); }

    update() {
        // Graphics 路径不序列化；编辑预制体时按原生 UITransform 尺寸预览。
        if (EDITOR) this.draw();
    }

    setRatio(value: number) {
        this.ratio = Math.max(0, Math.min(1, value));
        this.draw();
    }

    private draw() {
        const g = this.getComponentInChildren(Graphics)!;
        const size = g.node.getComponent(UITransform)!;
        const key = `${size.width},${size.height},${this.ratio},${this.padding},${this.fillColor.toHEX('#rrggbbaa')},${this.backgroundColor.toHEX('#rrggbbaa')}`;
        if (key === this.signature) return;
        this.signature = key;
        const w = size.width, h = size.height;
        const pad = Math.min(this.padding, h / 2, w / 2);
        g.clear();
        g.fillColor = this.backgroundColor;
        g.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2); g.fill();
        const fillWidth = (w - pad * 2) * this.ratio, fillHeight = h - pad * 2;
        if (fillWidth > 0 && fillHeight > 0) {
            g.fillColor = this.fillColor;
            g.roundRect(-w / 2 + pad, -h / 2 + pad, fillWidth, fillHeight, Math.min(fillWidth, fillHeight) / 2); g.fill();
        }
    }
}
