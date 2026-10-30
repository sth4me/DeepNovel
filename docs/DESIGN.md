# 写作台设计说明

## 方向

把写作台当成**编辑的案头**，而不是一组设置表单：

- **编辑感**：项目名、步骤标题、章节标题用衬线体；正文用无衬线 UI 字体，控件退后。
- **安静**：深色/浅色只用主题 token 的层级色；高饱和色只用于主操作和状态。
- **主面板**：写作台是全局主面板（侧栏入口 + `main` key），不是会话侧栏。三栏：流程 rail / 工作区 / 流程与 AI inspector。
- **专注**：顶部可一键隐藏左右栏（Esc 退出），正文区域成为唯一焦点。

## 布局

- 左栏 222px：六步流程（项目 → 构思 → 文风 → 设定 → 大纲 → 章节），带状态、说明、完成勾。
- 中间：`max-width 1120px` 的工作区；章纲/章节采用 master-detail（左列表 + 右阅读/编辑，各自滚动）。
- 右栏 336px：流程状态 / AI；窄屏可收起或作为抽屉打开。
- 底部「下一步」栏：显示当前阻塞项并直达下一步。
- 章节页：标题 + 质检/AI 徽标 → 修订要求 → 写作动作 → 质检摘要 → 修订历史 → 局部重写栏 → 正文。质检详情默认折叠。
- 章节操作分组：写作类（按意见修订/重新生成/采纳定稿）与质检类（检测/多轮修复/单轮修复）分开。

## 设计系统

- 颜色：`--dsw-alias-bg-layer-1/2` 画布/卡片，`--dsw-alias-border-l1/l2` 分隔，`--dsw-alias-label-primary/secondary` 文本层级，`--dsw-alias-brand-primary` 主操作/选中；状态色只用于徽标与 dot。
- 字体：
  - UI：系统无衬线，11–12.5px，行高 1.6–1.7。
  - Display：`Iowan Old Style / Palatino / Songti SC / STSong / Georgia`，用于项目名、步骤标题、章节标题、AI 分数。
- 间距：4 / 8 / 12 / 16 / 20 / 24；卡片圆角 14px，输入框 8px，按钮 9px。
- 组件：rail、step intro、panel、candidate card、template card、chapter list、QA summary、issue list、selection bar、diff、toast、error panel、empty state。
- 交互：hover 轻背景；focus 品牌色柔光环；生成中显示秒数 + 取消；未保存显示提示；破坏性操作二次确认。

## 数据层

采用混合数据层：结构化数据进 SQLite，正文留在 Markdown 文件。

- **结构化数据**：项目、构思、文风、设定、关系、能力、卷与章纲、章节状态/质检/摘要、统计、运行记录、System 模板覆盖、备注，统一存 `story/project.db`（内置 `node:sqlite`，WAL）。这些数据需要事务、跨表一致和检索，散成几十个 JSON 文件时每次操作都要多次读写、互相校验成本高。
- **正文**：`draft.md`、`final.md`、`revisions/` 保持 Markdown。手稿要保持可读、可用编辑器直接改、可进 git diff，不能因为换了存储方式而变得不可读。
- 边界：正文可版本化，结构化数据可事务化与索引化；两者通过章节号关联。旧项目首次打开自动迁移，旧 JSON 留作只读存档。
- 实现细节（表结构、迁移、快照、检索、排错）见 [DATA-LAYER.md](DATA-LAYER.md)。

## 技能库

内置技法不再单独做「技法库」，而是作为**内置技能**与项目导入技能平级出现在同一技能目录。

- **内置技能（14 个）**：9 张项目无关的通用技法卡片以 `craft-*` 随插件提供，另有 5 个参考库以 `ref-*`——`ref-hooks` 钩子库（章首 7 类 / 章尾 10 类）、`ref-openings` 开篇库（7 种建立方式）、`ref-reversals` 反转工具箱（7 类反转的铺垫/回收/失败）、`ref-emotional-arc` 情绪弧线（单章曲线/跨章节奏/外化清单）、`ref-quality` 章节质检清单（结构/信息/场景/语言/连载）。全部 provider `deepnovel-craft`、rank 600、source builtin；不能删除，只能按项目开关（项目 `craftDisabled`）；只在写作项目里出现（有 `story/project.db` 或 `project.json`），非写作会话不出现。内容自写（参考 MuMuAINovel / DeepWrite 思路，未大段复制），项目无关。
- **项目导入技能**：`<projectRoot>/.dsh/skills`（rank 100）、`<projectRoot>/.agents/skills`（rank 200）下的 `SKILL.md`，可删除；只对当前项目生效。
- **全局 / 插件级导入技能**：`DSH_HOME/novel-writer/library/skills/`（rank 300）下的 `SKILL.md`，可删除；所有写作项目都能用。
- **优先级**：同名冲突时 **项目 > 全局 > 内置**（rank 小者胜）；覆盖前备份——项目覆盖备份到 `.dsh-writing/backups/skills-<时间>/`，全局覆盖备份到 `DSH_HOME/novel-writer/library/backups/skills-<时间>/`。
- **范围**：助手技能只来自内置 `craft-*` + 项目导入 + 全局导入；不扫描 DSH 公共 / 系统 / 用户级技能（`<dshHome>/skills`、`<agentsHome>/skills`、`$DSH_BUNDLED_SKILL_DIR`、custom 根）；非写作项目返回空。加载入口只保留 `tool-skill`（`skill-filesystem` 已移除，项目根由 provider 按 cwd 动态提供）。
- **路由**：模型路由——AI 用 skill 工具按需加载全文，读后判断是否适合本章（题材 / 文风契约 / 节奏 / 指令），不适合不套用；技法不是本书设定、不是硬性规则。旧的「程序按任务 / 指令打分注入全文」已废弃（模型读全文判断比程序触发词更准）。
- **内容**：出处为通用写作 / 编剧理论 + 网文实践整理，自写摘要非复制（检查清单思路参考 MuMuAINovel / DeepWrite）；每张卡统一五节【适用】【通用原则】【按场景调节】【常见反例（不要这样写）】【自检】，数字多为参考值。
- **管理**：项目页「提示词与技能」卡的技能库 tab（scope 徽标 / 内置开关 / 导入（项目或全局）/ 删除 / 预览分节渲染 / 导入弹窗）；project-action `skills-list`（每项带 scope/path）/ `skill-toggle`（仅内置）/ `skill-import`（`{ path, scope? }`）/ `skill-delete`（`{ name, scope }`）/ `skill-read`（`{ name, scope? }`）。

## 提示词模板

提示词模板能力整合在项目页「提示词与技能」卡的流程提示词 tab，不单独做工作台页面。

- **目录**：`PROMPT_CATALOG` 23 条，每条带 `group`（premise / bible / outline / chapter / review / craft / data / other）与 `tags`，用于分类筛选。
- **预览**：只读 `prompt-preview { key }` 返回 `defaultText` / `currentText` / `customized` / `baseRevision` / `revision` / `variables`（从 `{{name}}` / `${name}` 提取，去重、最多 20 个）；由代码拼装的模板不执行，返回 `variablesHint`。预览不调用 LLM。
- **编辑**：覆盖仍写 `prompt_overrides` 表，编辑 / 覆盖 / 恢复默认逻辑不变；「默认已更新」判断沿用 baseHash + baseRevision。

## 提示词与技能（两层模型）

写作台把「流程提示词」与「技能」分成两层，**数据模型不合并**，但共享同一套写作规则。

- **流程提示词**（System 模板，`PROMPT_CATALOG` 23 条）：任务必用——每个生成动作按任务取对应 system；可在项目页覆盖、有版本号、可预览默认/当前与占位符；覆盖存 `prompt_overrides` 表。
- **技能**（`craft-*` / `ref-*` / 导入技能）：可选参考——模型按需用 skill 工具读取全文，读后自行判断是否适合本章；可逐项开关、导入、删除；不是硬性规则、不是本书设定。
- **为什么不合并**：流程提示词决定「这个任务怎么执行」（必须稳定、可覆盖、可审计版本）；技能是「可参考的写作方法库」（可增长、可导入、由模型判断）。合并会让必用规则与可选参考混在一起，难以保证行为稳定。
- **共享规则**：禁用词（35 个）、AI 句式、真人基准、章节质检清单（5 组）集中在 `writing-rules.js`；提示词模板、流程动作（aiFlavor 估算 / deslop）与技能卡（craft / ref）都从这里引用，避免多处手写字面量漂移。
- **管理入口**：项目页「提示词与技能」卡，双 tab——「流程提示词」与「技能库」；素材库卡独立。

## 修订学习

从「草稿 → 定稿」的差异里提炼作者自己的稳定写作偏好，整合进项目「写作要求（共享）」卡，不新增系统或数据表。

- **范围**：只分析同时存在 `draft.md` 与 `final.md` 且内容不同的章节；指定章号时只分析该章，否则按 diff 大小取最近 N 章（`count` 默认 3、上限 6）。
- **只读**：`revision-learn` 只返回 `{ summary, preferences, stats, chapters }`，不写文件 / DB；走 `runWithProgress`，可取消。
- **提示词**：`revisionLearn` 在 `PROMPT_CATALOG`（group craft）中，可覆盖；要求偏好稳定（同类修改 ≥2 次）、rule 可执行、最多 8 条、证据不足返回空。
- **写入**：结果在弹窗里勾选后，才用 `project-update` 追加到 `writingNotes`；不自动改写正文。
- **助手**：`novel_chapter action=revision-learn` 只返回建议，不写入。

## 参考

`docs/RESEARCH.md` 汇总 novelWriter、Manuskript 等开源工具的结构视图、专注模式、导出、写作统计等做法。项目已吸收专注模式、导出、统计/目标、质检摘要与自动化配置。

## 收尾视觉与适配（v1.8）

- 阅读优先：章节正文使用 14px / 1.95 行高、740px 阅读列，卡片内居中；上一章/下一章可直接切换。
- 段落：点第一段再点另一段选范围；选中后底部固定浮动条「已选 X–Y 段 / 重写选中段落 / 取消」，长距离选择不需要滚回顶部。
- 手动编辑：章节页「编辑正文」进入整章 textarea，保存按钮在编辑区顶部；Ctrl/Cmd+S 保存，旧稿归档，旧质检清空。
- 密度：卡片 16/18px 内边距、14px 间距、16px 圆角；按钮 30px 高、统一 hover 位移；输入 34px 高。
- 层级：顶部栏更轻，步骤标题 24px，正文与辅助文字分开；状态徽标保持小尺寸。
- 响应式：
  - >1180px：三栏完整；
  - ≤1180px：右侧面板默认收起，可用「面板」打开为抽屉；
  - ≤1000px：隐藏“下一步”长文案；
  - ≤900px：显示移动步骤下拉；≤860px 隐藏左侧 rail，工作区改为单列。
- 交互：切换步骤平滑回顶、切换章节重置阅读滚动、专注模式（Esc 退出）、大纲卡片/表格/编辑切换、全局搜索、HTML 导出。
- 仍需注意：窄屏下编辑表单的字段密度、模型分配表格的横向空间、长章节的滚动锚点。
