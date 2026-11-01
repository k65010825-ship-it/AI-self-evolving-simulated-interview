# 评测工作区

本轮只有确定性基础测试和 Pi 离线 fixture。真实评分/追问/语音/真人数据尚未收集，不能据空目录宣称已有 RSI 实验。

- `datasets/manifest.json`：记录待收集的开发/内部验证/最终验收数据集，当前 observedCount 均为 0。
- `../tests/foundation.test.ts`：本地工具边界与规划优先级测试。
- `../experiments/pi-sdk/offline-spike.ts`：真实 SDK＋本地确定性 provider 的集成验证。
- 真实评测输入、配对和报告按 `../docs/evaluation-plan.md` 实现，保留模型、策略、数据集与评估器版本；不能在最终集上反复挑策略。
