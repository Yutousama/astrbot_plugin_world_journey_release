# 大肥鱼环游世界 · AstrBot 插件

让她真的出门旅行：自己挑目的地和交通方式，路上耗真实时间；到了按当地时间吃饭、看日出、写日记。

- 发布仓库：<https://github.com/Yutousama/astrbot_plugin_world_journey_release>
- 开发仓库：<https://github.com/Yutousama/astrbot_plugin_world_journey>
- 插件作者：**yutou**
- 版本：**v1.0.4**

旅行引擎来自上游 [`coopani-world-journey`](https://www.npmjs.com/package/coopani-world-journey)
（原作者 Mr.Q，MIT），感谢原项目；本插件只做 AstrBot 接入，上游源码可在插件内从 npm 更新
（`/journey_update`），不需要重装插件。

本仓库根目录就是插件根目录，已经包含运行所需的 `engine/` 和 `raw/`，安装时不需要再构建。

## 安装

1. 需要 AstrBot **4.16+** 和 Node.js **22.7+**。Node 22.7–25.x 用自带的
   `--experimental-transform-types` 跑上游 TS；**Node 26+ 同样支持**——该版本移除了这个 flag，
   插件会自动改用随包发布的 `engine/amaro` 转换器。推荐 24 LTS。
2. AstrBot WebUI → 插件 → 从 GitHub 安装，填：

   ```text
   https://github.com/Yutousama/astrbot_plugin_world_journey_release
   ```

   或把整个仓库/目录复制到：

   ```text
   <AstrBot>/data/plugins/astrbot_plugin_world_journey/
   ```

3. AstrBot WebUI → 插件 → 重载。
4. 插件配置里确认：
   - `node_path`：留空自动找；找不到时填 `C:\Program Files\nodejs\node.exe` 或 Node 安装目录。
   - `home_city`：从哪儿出发（兰州/西安…）；留空按日记最近城市/兰州兜底。
   - `event_target`：主动消息发给谁（可选）。

## 图标

插件根目录的 `logo.png` 会被 AstrBot 自动识别，不需要在 `metadata.yaml` 里配置：

```text
astrbot_plugin_world_journey/
  logo.png      512x512 PNG，和 main.py 同级
  main.py
  metadata.yaml
```

必须是全小写 `logo.png`，不要用 `icon.png` 或 `logo.jpg`；打包 zip 时放在 zip 根目录，
重载插件后生效。当前图标为 512×512 PNG。

## 命令

| 命令 | 说明 |
|---|---|
| `/journey` `/旅行` `/她在哪` `/今日计划` `/行程` | 她此刻在哪、今天剩下怎么过、今晚住哪、这一趟花了多少；末尾带日记天数和今天是否已写 |
| `/journey_depart` `/让她出发` | 手动让她出发（默认需要管理员） |
| `/journey_photo` `/旅行照片` | 开始拍一张；出图后自动发，不阻塞命令 |
| `/journey_note [all\|N]` `/旅行笔记` | 读全部 / 最近 N 篇日记（默认 1），最新在前，并显示总篇数 |
| `/journey_diary [7\|2026-11\|2026-11-02]` | 读最近几天 / 某个月目录 / 某一天全文 |
| `/journey_stats` `/旅行统计` | 走了多少天、去过多少城、日记在哪 |
| `/journey_draw 成都 一首歌` | 记下想去的地方 |
| `/journey_sync` | 把她的钟拉回真实时间 |
| `/journey_debug` | 诊断：上游版本、sidecar、数据目录、最后 seq |
| `/journey_reset confirm` | 重置旅行：清空行程、事件、照片、日记和旅行记忆（管理员） |
| `/journey_update [latest\|0.5.25]` | 从 npm 更新上游源码（管理员；失败自动回滚） |

## 控制范围

`access_scope` 决定插件对谁开放：

| 值 | 行为 |
|---|---|
| `all`（默认） | 所有好友/群组都能用命令、工具和旅行提示词 |
| `target` | **只有** `event_target` 选中的个人/群组能用 |

`target` 模式会同时限制：

- 所有 `/journey*` 命令（包括管理员的重置/更新）；
- LLM 工具：非目标会话的 `req.func_tool` 里会移除 `journey_*`，模型看不到也调用不了；
- 旅行提示词注入；
- 主动消息（`event_target` 本身）。

注意：

- `target` 但 `event_target` 为空时，**所有会话都会被拒绝**。
- `target` 模式不再用 `last_umo` 兜底；主动消息只发 `event_target`。
- 管理员命令也受控制范围限制；如果把自己锁在外面，去 WebUI 改 `access_scope` 或 `event_target`。

## 重置旅行

```text
/journey_reset            # 只显示警告，不删
/journey_reset confirm    # 真正重置
```

会清空：

- `engine/` 里的位置、路线、时钟、事件、照片、`photos.json`、日记、caches；
- 同步盘 `memory_dir` 里的月文件日记、`travel-memory*.json`、`_bak/legacy/`；
- 事件游标（last_seq / event_log_id）。

会保留：

- 插件配置（`home_city`、倍速、API key、自拍参考图等）；
- `engine-config.json`；
- 最近会话 `last_umo`（主动消息还发同一个地方）。

重置只有管理员能执行，且必须带 `confirm`；`allow_reset=false` 可完全关闭。

## 自拍参考图

上游原本只拍空镜。开启 `selfie_enabled` 后，插件会在 sidecar 里套一层生图代理：

1. 拦截上游的 `POST /images/generations`；
2. 把「没有人物」的空镜提示词换成自拍提示词；
3. 用 WebUI 上传的 `selfie_reference` 作为参考图，走图生图；
4. 把结果包回上游认识的结果。

配置步骤：

1. `image_api` / `image_key` / `image_model` 先配好（用于兜底）。
2. 在 `selfie_reference` 上传一张正脸清晰的角色参考图（png/jpg/jpeg/webp）。
3. 打开 `selfie_enabled`。
4. 先发 `/journey_photo` 试一张；失败原因会直接回在命令里。

接口模式：

- `selfie_mode=edit`（默认）：`POST {api}/images/edits`，multipart 上传参考图；
- `selfie_mode=generation`：`POST {api}/images/generations`，参考图放
  `selfie_image_field`（默认 `image_url`，也支持 `image`）；
- `selfie_mode=native`：阿里百炼万相原生
  `/api/v1/services/aigc/multimodal-generation/generation`，`input.messages` 里传
  `data:image/...` 参考图；适合 `wan2.7-image`。`selfie_native_url` 可覆盖完整端点。

`selfie_api` / `selfie_key` / `selfie_model` 留空则沿用 `image_api` / `image_key` /
`image_model`。`image_model` 是**列表**：按顺序尝试，前一个报错就换下一个，全都失败才放弃；
`selfie_model` 留空时自拍也走这条降级链。`selfie_prompt` 可自定义，支持：

- `{scene}`：上游风景提示词；
- `{subject}`：主体称呼（默认「她本人」）；
- `{time}`：**时段描述词**，如「清晨」「正午」「黄昏」「暮色」「入夜」「午夜前」；
- `{clock}`：**她所在城市的当地时间**，`HH:MM`，如 `18:12`。

时段按她当地的分钟数分段，从午夜到午夜前共 23 档（凌晨、黎明前、拂晓、黎明、破晓、晨光初现、
清晨、早晨、上午、上午将尽、临近正午、正午、午后、下午、下午将尽、傍晚、黄昏、暮色、
入夜、夜晚、深夜、午夜前等），比「早/中/晚」细，专门给光线用。
模板里没写 `{time}` / `{clock}` 的老模板，升级后会自动把时间补在末尾，不用改配置。
默认显示完整内置模板，留空保存会自动回填。

注意：

- 参考图只保证“长相接近”，不保证 100% 一致；底模/中转站必须支持图生图。
- 开启后没有参考图，照片会失败，**不会退回空镜**。
- 自动拍照和 `/journey_photo` 都走这套；失败只写日志/回命令，不阻塞旅行。

## 日记

上游的日记是**文件记忆**，不是单独的页面：一个月一个 Markdown 文件，每天一段
frontmatter + 正文。插件侧有两条读法：

- `/journey_note [all|N]`：直接读日记文件，**最新的一篇在前**，默认 `N=1`；
  输出第一行是「一共有多少篇日记可读」，正文按纯文本输出，不用 Markdown 分隔线。
- `/journey_diary [7|2026-11|2026-11-02]`：走上游的 `journey_diary_read`，
  看最近几天、某个月目录或某一天全文。

### 自动写日记

`diary_write_time` 控制自动写，默认 **`23:00`**，按**她所在城市的当地时间**算（不是服务器时间）。
到点后如果当天还没写，插件会用当前 AstrBot LLM provider 生成一篇第一人称日记，再通过
`journey_diary_write` 落盘。

- 一天只自动写一次；如果当天已经有日记（手动写过也算），不会覆盖。
- 生成失败/写入失败会隔 10 分钟重试；留空 `diary_write_time` 可关闭自动写。
- 只会写「当天」：如果到点时插件不在线，错过就等第二天，不做补写。
- 自动日记的正文要求不带标题、日期、Markdown 和列表；`/journey_note` 输出前还会再清一遍。
- 写完后不会主动发消息；`/journey` 末尾会显示「日记 N 天，今天已经写了/还没写」。

## 工具

LLM 工具由引擎自动注册（0.5.25 是 6 个，0.5.16 是 5 个，以实际 `tools()` 为准）：

- `journey_now`
- `journey_diary_write`
- `journey_diary_read`
- `journey_stats`
- `journey_draw_to`
- `journey_return_home`

上游新增工具会自动出现；不需要改插件代码。

## 内置更新上游源码

默认源：[`coopani-world-journey`](https://www.npmjs.com/package/coopani-world-journey)。

```text
/journey_update            # 最新
/journey_update 0.5.25     # 指定版本
```

更新流程：

1. 从 `https://registry.npmjs.org/coopani-world-journey` 取元数据；
2. 下载 tarball，校验 `dist.integrity` 的 sha512；
3. 解压到插件目录的 staging；
4. 停事件泵 → 停 sidecar → 备份旧 `raw/` → 换新 `raw/`；
5. 重启 sidecar、重新注册工具、恢复事件泵；
6. 新版本起不来则**自动回滚**到旧 `raw/` 并重启。

`allow_upstream_update` **默认关闭**，要用时才在配置里打开（理由见「安全说明」）；
`upstream_package`、`upstream_registry` 可换源；`upstream_source` 只是展示页面。
运行时更新只换上游源码，本插件/Python 代码仍随插件版本更新。
Node 26+ 也一样：`engine/amaro` 只在启动 sidecar 时参与，替换 `raw/` 不碰它。

注意：**重装/升级插件会把 `raw/` 换回发布包里的基线版本**。如果你之前用 `/journey_update`
升到过更高版本，重装后看起来会「又升级了一次」——插件启动时会对比
`plugin_data/upstream-state.json` 里记录的历史版本，发现被换回旧版就在日志里 warn，
`/journey_debug` 也会显示当前源码版本与记录的最新版本两行。

## 提示词

开启 `inject_prompt` 后，每次 LLM 请求会追加一段旅行状态（她所在城市、当地时刻、今晚住哪、接下来做什么）。
这段来自上游 `ENV_PROMPT.md`，已剥掉桌面立绘的动作段、清洗了 AstrBot 不存在的 `music_pick` 工具。

注入方式是 `req.extra_user_content_parts` + `TextPart.mark_as_temp()`：内容作为**仅本轮可见**的临时
user 内容块，不修改 `system_prompt`、不写入会话历史，避免系统提示之后的历史无法命中 prompt cache。
如果 AstrBot 版本不支持临时内容块，插件会跳过注入并写日志，不会退回拼接 system prompt。

另外，插件会在内存里保留最近几条**主动汇报**（`inject_recent_reports`，默认 5 条），
只注入给实际收到汇报的那个会话，和旅行状态合并在同一个临时内容块里。这样用户接着
「刚刚到哪了」聊时，主 agent 知道在说哪条汇报。`recent_report_count` 控制条数；重启插件后
缓冲清空，重置旅行也会清空。

## 主动消息

默认关闭。建议：

1. 先和机器人说一句话（让它记住会话），或直接在配置里选 `event_target`。
2. 打开 `proactive_enabled`。
3. `speed` 调到 24 可以更快看到出发/到站；日常建议 1 或 4。

`flush` 事件（出发/到达/跨天/回家/麻烦）立即发；`debounce` 事件（作息/路上/照片）在
`debounce_seconds` 内合并，只发最新一条。照片以图片段发送。

### 主动汇报配图

| `report_image_mode` | 行为 |
|---|---|
| `off`（默认） | 不加图 |
| `always` | 每条主动汇报都生成一张自拍附在文字后 |
| `probability` | 按 `report_image_probability` 概率生成 |

- 用当前 `selfie_*` 配置出图（当前是 `native` 万相），提示词基于**这条汇报的文本** + 当前状态；
- 不经过上游 `journey.photo`，所以不会和相册照片重复；
- 事件本身已有照片时跳过；
- 生图失败只发文字，并写 `sidecar.log`；
- `always` 会增加费用和发送延迟，建议先用 `probability=0.2~0.3`。
- 只影响主动汇报，`/journey` 查询命令不加图。

## 配置

大部分字段和上游一致：`home_city`、`speed`、`beat_gap`、`rest_days`、`ask_before_depart`、
`max_trip_months`、`with_user`、`money_enabled`、`budget`、`memory_dir`、`amap_key`、
`image_api/key/style`。

`image_model` 是**列表**（`生图模型名`）：按填写顺序尝试，第一个模型报错就自动换下一个，
全部失败才抛出错误。留空按 `gpt-image-1` 试。

套壳自己的：

| 项 | 默认 | 说明 |
|---|---|---|
| `node_path` | 空 | Node 22.7+ 路径 |
| `diary_write_time` | `23:00` | 她当地时间自动写日记；`HH:MM`，留空关闭 |
| `inject_prompt` | 开 | 注入旅行状态 |
| `inject_recent_reports` | 开 | 把最近汇报注入汇报会话 |
| `recent_report_count` | 5 | 保留几条汇报 |
| `proactive_enabled` | 关 | 主动发事件 |
| `event_target` | 空 | 主动消息目标会话；`target` 模式下也是唯一允许使用的会话 |
| `access_scope` | `all` | `all` 所有会话；`target` 仅 `event_target` |
| `debounce_seconds` | 60 | 路上事件合并窗口 |
| `report_image_mode` | `off` | `off` / `always` / `probability` |
| `report_image_probability` | 0.3 | 汇报配图概率 |
| `admin_only_controls` | 开 | 出发/拍照/同步/更新仅管理员 |
| `allow_reset` | 开 | 允许 `/journey_reset`（始终仅管理员） |
| `allow_upstream_update` | 关 | 允许 `/journey_update`（默认关闭，见下方说明） |
| `upstream_package` | `coopani-world-journey` | 上游 npm 包名 |
| `upstream_registry` | `https://registry.npmjs.org` | npm registry |
| `upstream_source` | npm 页面 | 展示用源地址 |
| `selfie_enabled` | 关 | 所有照片必须是自拍 |
| `selfie_reference` | 空 | 自拍参考图（WebUI 上传） |
| `selfie_reference_path` | 空 | 参考图绝对路径/URL（可选） |
| `selfie_subject` | `她本人` | 提示词主体 |
| `selfie_prompt` | 内置模板 | 自拍模板，可用 `{scene}`/`{subject}`/`{time}`/`{clock}`；留空保存回填 |
| `selfie_mode` | `edit` | `edit` / `generation` / `native` |
| `selfie_native_url` | 空 | native 完整端点，留空自动拼 |
| `selfie_api/key/model` | 空 | 留空沿用生图配置（`image_model` 列表按顺序降级） |
| `selfie_image_field` | `image_url` | generation 模式图片字段 |
| `selfie_size` | `1024x1024` | 自拍尺寸 |
| `offline` | 关 | 不查天气/酒店/生图 |
| `extra_config` | 空 | 上游新增字段的 JSON 兜底 |

`extra_config` 示例：`{"someNewField": 123}`，会覆盖同名引擎字段。

⚠️ `extra_config` 会**原样写进 `engine-config.json` 并覆盖插件表单里的映射**：只填你确认过含义的
上游字段，别把密钥/接口地址放进来（上面有专门的 `amap_key`、`image_key` 等字段），字段写错可能让
引擎行为异常。插件启动时会用 warn 日志列出被覆盖的**键名**（不打印值），方便核对。

## 安全说明

- **运行时代码替换默认关闭**：`/journey_update` 会从 npm 下载上游 tarball 并整体替换 `raw/`，
  虽然有 sha512 校验、失败自动回滚、仅管理员可触发，但它等于允许「运行时换代码」，所以
  `allow_upstream_update` 默认是 **关**。确认信任 `coopani-world-journey` 这个 npm 包后再打开。
- **网络边界**：sidecar 只监听 `127.0.0.1`，每次启动带随机 token；对外请求只到高德 / Open-Meteo /
  Nominatim 和用户自己配的生图接口。
- **密钥**：只写在本地 `engine-config.json`，不进日志、不进提示词。

## 数据

`<AstrBot data>/plugin_data/astrbot_plugin_world_journey/`：

- `engine/state.json`：位置/路线/时钟（只在本机）
- `engine/diary/2026-11.md`：月文件日记
- `engine/diary/travel-memory.json`：去过/想去/花销（可跟同步盘）
- `engine/photos.json` + `engine/media/`：照片
- `engine/events.jsonl`：事件流
- `engine-config.json`：配置映射
- `plugin_state.json`：last_seq / last_umo / 自动日记写到哪一天
- `upstream-state.json`：见过的上游源码版本（重装插件被换回基线时用来提示）
- `logs/sidecar.log`：sidecar 日志

`memory_dir` 留空时日记和旅行记忆在 `engine/diary`；填同步盘则跟人走。
`/journey_note` / `/journey` 读日记时会同时看同步盘和本机兜底目录，同一天取文件更新的那份。

从旧版迁移：把旧数据目录的 `state.json`、`diary/`、`photos.json`、`media/` 复制进 `engine/`。
上游会把旧的一天一篇日记自动并进月文件，旧文件挪进 `_bak/legacy/`，不删。

## 故障排查

- **插件加载失败**：看 `data/logs/astrbot.log` 里 `astrbot_plugin_world_journey` 的报错。
- **提示 Node 不可用**：装 Node 22.7+，或配置 `node_path` 指向 `node.exe`。
- **`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` / `parameter property`**：Node 26+ 移除了
  `--experimental-transform-types`，说明这份插件还没有随包的 `engine/amaro`；把插件更新到
  v1.0.3+（或临时改用 Node 24 LTS）。
- **sidecar 启动超时**：看 `plugin_data/.../logs/sidecar.log`；确认 22.7+ 和端口。
- **重载后没有孤儿进程**：插件用真实 `node.exe` + 心跳 + terminate；如果还有，查 `journey_debug`。
- **主动消息没来**：确认 `proactive_enabled`、`event_target`（或先和机器人说话）、以及 sidecar 已就绪。
- **照片没拍**：配 `image_api`/`image_key`/`image_model`；失败原因会回在 `/journey_photo`。
- **拍照报 `Server disconnected`**：sidecar 在拍照途中被重载/重启（改配置、更新插件、重载插件）。
  等几秒重试；v0.6.5 起客户端最多等 150s，不会用 10s 默认超时误杀慢图。
- **拍照很慢**：v0.6.6 起 `/journey_photo` 立刻返回“开始拍了”，后台等图；出图后自动发。
  如果主动消息关着，后台任务会直接发到发命令的会话；失败也会主动回原因。
- **更新失败**：看回复里的原因；插件会回滚旧 `raw/`。确认能访问 npm，且 Node 22.7+。

## 许可

上游引擎 `coopani-world-journey` 作者 Mr.Q，MIT。本插件只做套壳与 AstrBot 接入；
详见随包的 `THIRD_PARTY_NOTICES.md`。
