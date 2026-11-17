import { _decorator, Component, game, Layout, UITransform, view, Widget } from 'cc';
import { EDITOR } from 'cc/env';
const { ccclass, property } = _decorator;

/** 首次按完整设计画布等比容纳 UI，之后窗口变化保持首次的屏幕尺寸。 */
@ccclass('固定像素界面')
export class DigitGateFixedUi extends Component {
    @property({ type: Layout, displayName: '结算按钮换行布局' }) resultLayout: Layout = null!;
    private width = 0;
    private height = 0;
    private scale = 0;
    private pixelsPerUnit = 0;

    lateUpdate() {
        const rect = game.canvas!.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        // 不能把设计单位直接当成 CSS 像素，否则 390 宽窗口会把 UI 放大约 1.92 倍。
        const unitsPerPixel = view.getVisibleSize().width / rect.width;
        if (!this.pixelsPerUnit) {
            const design = view.getDesignResolutionSize();
            this.pixelsPerUnit = Math.min(rect.width / design.width, rect.height / design.height);
        }
        const scale = unitsPerPixel * this.pixelsPerUnit;
        if (this.width === rect.width && this.height === rect.height && this.scale === scale) return;
        this.width = rect.width; this.height = rect.height; this.scale = scale;
        this.node.setScale(scale, scale, 1);
        const width = rect.width / this.pixelsPerUnit;
        this.node.getComponent(UITransform)!.setContentSize(width, rect.height / this.pixelsPerUnit);
        this.refreshResultLayout();
        for (const widget of this.getComponentsInChildren(Widget)) widget.updateAlignment();
    }

    refreshResultLayout() {
        const layout = this.resultLayout;
        if (!layout) return;
        const buttons = layout.node.children.filter(node => node.active);
        if (!buttons.length) return;
        const width = this.node.getComponent(UITransform)!.width;
        const buttonWidth = buttons[0].getComponent(UITransform)!.width;
        const anchor = layout.node.getComponent(Widget);
        const anchorEnabled = anchor?.enabled;
        // 编辑视图中改容器尺寸时，暂时停用 Widget，避免被当成人工拖动而改写边距。
        if (EDITOR && anchor) anchor.enabled = false;
        // 胜利只有一个按钮时，容器也收成一列，避免空位将 Play Now 推到右边。
        layout.constraintNum = Math.min(buttons.length, width < buttonWidth * 2 + layout.spacingX + 32 ? 1 : 2);
        layout.node.getComponent(UITransform)!.width = buttonWidth * layout.constraintNum
            + layout.spacingX * (layout.constraintNum - 1);
        layout.updateLayout(true);
        if (EDITOR && anchor) anchor.enabled = !!anchorEnabled;
        if (!EDITOR) {
            anchor?.updateAlignment();
            for (const widget of layout.getComponentsInChildren(Widget)) widget.updateAlignment();
        }
    }
}
