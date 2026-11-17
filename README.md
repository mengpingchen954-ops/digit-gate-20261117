# 数字门 · 角色替换版

Cocos Creator 3.8.8 浏览器游戏工程。

- 主角：初级士兵（射击、左右移动、死亡）。
- 普通丧尸：矿工丧尸（八方向序列帧，行走、攻击、死亡）。
- 大丧尸：屠夫（行走、攻击、死亡）；身体保留参考资源灰色。
- 二、三级友军及原有最终 Boss 保留；血量、攻击规则、道路与经济配置保留。

打开 assets/Map/scene-1.scene 运行。拖动或按住画面左右移动，经过数字门增加队伍，收集金币建造炮塔。

## 构建与部署

用 Cocos Creator 3.8.8 打开工程并完成资源导入。可在 Creator 构建面板选择 Web Mobile 和 scene-1，或使用 CLI：

    CocosCreator --project <工程目录> --build configPath=<工程目录>/pages-build.json

构建输出 build/web-mobile；将其内容复制至 docs 后提交。GitHub Actions 自动将 docs 发布到 GitHub Pages。

源码和预制体在 assets，正式网页在 docs。缓存、账户信息、编辑器连接信息与测试截图不入库。

验证：三类角色动作绑定、攻击每次只命中一次、死亡、血条、左右移动，以及金币/扩容/炮塔建造原有回归测试。
