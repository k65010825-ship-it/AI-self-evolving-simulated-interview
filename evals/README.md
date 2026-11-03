# 评测工作区

当前有确定性工程测试、Pi离线fixture、合成策略实验和回答草案参考集。真实模型评分/语音/真人及人工金标准仍未收集，不能把合成结果称为真实效果。

- `datasets/manifest.json`：记录待收集的开发/内部验证/最终验收数据集，当前 observedCount 均为 0。
- `../tests/foundation.test.ts`：本地工具边界与规划优先级测试。
- `../experiments/pi-sdk/offline-spike.ts`：真实 SDK＋本地确定性 provider 的集成验证。
- `answers/`：18条原创合成回答和单独参考，均为synthetic-proposed/draft；开发/验证/预留最终按题族隔离。`bun run agent:answers:eval`运行离线描述性对照，详见[口径](../docs/answer-benchmark.md)。不计入真人manifest。
- 真实评测输入、配对和报告按 `../docs/evaluation-plan.md` 实现，保留模型、策略、数据集与评估器版本；不能在最终集上反复挑策略。
