# 来源、会话、权限与自动化

入口与固定源码证据见[索引](source-map.md)。这里描述组合关系，不保证快照没有缺陷。

## 来源是可用能力的配置与状态

**事实（S1-S3）：** SourceType为mcp/api/local。连接目录包含config.json与guide.md；SourceCredentialManager负责来源认证相关操作，SourceServerBuilder构建MCP与API服务器配置；SourceManager跟踪active/inactive/intended状态、格式化上下文及来源激活相关状态。

**原因解释：** 将“配置在哪/是否有凭证/是否可用/如何暴露工具/模型看到什么”集中管理，让UI与SDK都不必各写一套连接逻辑。

**边界：** buildAll的可见分支构建mcp和api；不能仅因有local枚举就宣称本地来源也统一创建MCP服务器。已读取guide是工具使用前置条件，不能授予超出用户允许的权限。source激活可能触发重新调度，须检查执行次数与原请求是否重送。

**迁移建议：** 观澜先保留ConnectorConfig/运行可用状态与ResearchSource证据分离。公开网页读取工具不必为了统一外观而包装成MCP；真正需要发现/认证/启停外部工具时再扩展连接层。

## 会话保存、运行恢复与记忆

**事实（P1/P2/A4）：** shared/sessions有持久化SessionConfig、StoredSession和SessionHeader，JSONL第一行是元信息，后续为消息。SessionPersistenceQueue默认500ms合并写；SessionManager控制会话实例、后端、消息队列、取消与事件。业务session id与sdkSessionId有不同用途。

**原因解释：** 产品会话负责用户可见的消息与归属；SDK会话标识负责提供方上下文连续性；存储格式服务历史加载与迁移。职责相关但不等价。

**需要重新验证的保证：**

- persistence-queue.write把头部和消息重建为JSONL，不能因文件格式叫JSONL就认作追加式事件日志。
- 实现存在writeFile(tmp)→unlink(target)→rename(tmp,target)顺序。删除与替换之间存在窗口；不能沿用注释“atomic”就承诺崩溃安全。
- write捕获异常后日志记录；flush等待并不自动证明异常能传播给调用方。因此“flush后onAck”的调用顺序应与“失败时不得确认”的实际保证分开，迁移时测试I/O失败和确认路径。
- header、消息历史、SDK恢复、正在执行的工具及其回执、长期事实记忆是五种不同状态。没有看到完整故障恢复证据时，不宣称任意工具可以恰好一次续跑。

**迁移建议：** 为观澜分别设计task/run、事件记录、工具尝试/回执、可恢复边界与证据记忆。恢复首先处理“已经执行但尚未保存”的未知结果。跨任务记忆还需来源、适用时间、版本、过期和删除语义；不能从Craft的会话历史推导它已经提供了独立事实记忆系统。

## 权限是执行侧的共同规则

**事实（T1/B3/B4）：** runPreToolUseChecks接收归一化工具输入，依次处理权限模式、来源可用状态/激活、前置guide、特定工具拦截和输入转换等。模式管理从会话的规范状态读取，不单纯信任传入模式字符串。Claude/Pi调用同一管线，再将allow/block/prompt等结果翻译成各自执行语义。

Pi的来源激活分支会重新执行检查，随后处理完整结果。不能把“激活成功”直接等价成“无需再询问或检查，允许执行”。Claude代码在SDK配置中使用bypassPermissions，并通过自身PreToolUse实现权限；这证明执行检查必须看实际hook，而非只看SDK选项名。它不构成迁移时默认启用bypass的建议。

**原因解释：** 相同权限决定不随供应商改变，UI只承担展示和用户交互。权限、参数结构校验、调用预算分别解决可否执行、输入是否合法、还能执行多少次，不能互相替代。

**迁移建议：** 观澜现有只读read/search/submit先保留严格工具准入和硬预算；有实际写入/外部动作需求时再增加权限决定/等待/回执契约。入口参数校验一次，策略检查在实际执行前按最新状态进行；这不是重复判空。

## 自动化复用会话运行路径

**事实（U1-U3/A4）：** AutomationSystem按workspace建立event bus，装配Prompt/Script/Webhook/EventLog handlers，可启用scheduler。PromptHandler匹配事件、展开prompt并通过onPromptsReady交付待执行项。SessionManager接回runReadyPrompts，经守卫后调用executePromptAutomation创建会话并sendMessage；该路径permissionMode未设置时使用safe。快照有自动化链深度上限3及来源激活重送逻辑。

**原因解释：** 定时/事件负责“何时触发什么任务”，会话服务继续负责“任务如何执行、归属、展示与追踪”。无需让UI另建一套后台Agent。

**边界：** 自动化不全是prompt，还有脚本与webhook动作；不能把后两者的外部副作用假设为普通会话聊天。事件总线、cron匹配或历史文件也不自动证明重启补偿、分布式锁、持久化队列和恰好一次投递。重试/来源激活/自动化链都要纳入本项目调用预算；不要无条件复制上游自动重送。

**迁移建议：** 调查任务触发器先调用同一个应用服务，记录trigger与权限/预算快照，限制重复触发和链式放大；是否采用定时器、队列或工作流，由停机补偿与并发需求决定。
