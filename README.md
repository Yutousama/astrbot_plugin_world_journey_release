# 大肥鱼环游世界 · AstrBot 插件

让她真的出门旅行：自己挑目的地和交通方式，路上耗真实时间；到了按当地时间吃饭、看日出、写日记。

- 发布仓库：<https://github.com/Yutousama/astrbot_plugin_world_journey_release>
- 开发仓库：<https://github.com/Yutousama/astrbot_plugin_world_journey>
- 插件作者：**yutou**
- 版本：**v1.0.5**

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
| `/journey` `/旅行` `/她在哪` `/今日计划` `/行程` `/jy` | 她此刻在哪、今天剩下怎么过、今晚住哪、这一趟花了多少；末尾带日记天数和今天是否已写 |
| `/journey help` `/jy help` | 列出全部可用指令（别名 `/旅行 帮助` 等也可） |
| `/journey_depart` `/让她出发` `/jy depart` | 手动让她出发（默认需要管理员） |
| `/journey_yes` `/点头` `/jy yes` | 答应她正在等的那张卡片：出门 / 接邀约（默认需要管理员） |
| `/journey_no` `/摇头` `/jy no` | 这次先不（默认需要管理员） |
| `/journey_back` `/叫她回来` `/jy back` | 这一趟不等了，让她回家（默认需要管理员） |
| `/journey_photo [题材]` `/旅行照片` `/jy photo …` | 开始拍一张；出图后自动发，不阻塞命令。题材：`晚饭`（吃的）、`街景`、`星空`/`日出`、`节日`/`雪景`、`特写`/`车票`；不带参数拍脚下 |
| `/journey_note [all\|N]` `/旅行笔记` `/jy note …` | 读全部 / 最近 N 篇日记（默认 1），最新在前，并显示总篇数 |
| `/journey_diary [7\|2026-11\|2026-11-02]` `/jy diary …` | 读最近几天 / 某个月目录 / 某一天全文 |
| `/journey_stats` `/旅行统计` `/jy stats` | 走了多少天、去过多少城、日记在哪 |
| `/journey_draw 成都 一首歌` `/jy draw …` | 记下想去的地方 |
| `/journey_sync` `/jy sync` | 把她的钟拉回真实时间 |
| `/journey_debug` `/jy debug` | 诊断：上游版本、sidecar、数据目录、最后 seq |
| `/journey_reset confirm` `/jy reset confirm` | 重置旅行：清空行程、事件、照片、日记和旅行记忆（管理员） |
| `/journey_update [latest\|0.5.25]` `/jy update …` | 从 npm 更新上游源码（管理员；失败自动回滚；更新日志默认不输出，由 `update_show_changelog` 控制） |

`/jy` 是通用简写：`/jy` 单独使用等同 `/journey`，`/jy <子命令> [参数]` 等同对应的
`/journey_<子命令>`（diary / note / stats / draw / depart / yes / no / back / photo / sync / debug / reset / update），
权限和参数行为与完整命令一致。

**「出门等你点头」（`ask_before_depart`）在聊天里的用法**：开了之后她不会自己走；她会发一条
`journey.ask` 事件问「能不能去××」（接别人的邀约也是这张卡片），事件末尾会带上回答方式。
发 `/journey_yes` 点头（她立刻动身 / 应约），`/journey_no` 这次先不。没有正在等批的事时，
这两个命令会明确告诉你「她现在没有在等你点头」，不会静默。

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

## 生图提示词与自拍参考图

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
`selfie_model` 留空时自拍也走这条降级链。

### 提示词模板

模板是**全局**的，不再只属于自拍这一条路径：

| 配置 | 什么时候用它 | 留空时 |
| --- | --- | --- |
| `image_prompt_template` | 开着自拍的所有出图：相册照片、`/journey_photo`、主动汇报配图 | 回退旧 `selfie_prompt`，再空用内置默认 |
| `image_prompt_scene_template` | 关着自拍的纯空镜（不带参考图） | 用内置默认（守住「画面里没有人物」） |
| `image_prompt_for_scene` | 空镜要不要套模板，默认开 | 关掉 = 空镜只用上游原话 |
| `selfie_prompt` | 旧字段，兼容保留 | 新字段填了就以此为准 |

占位符：

- `{scene}`：上游的场景描述（城市/景点/光线/天气/体感）；
- `{subject}`：主体称呼（默认「她本人」）；
- `{style}`：**画面风格**，取自 `image_style`；留空或填 `none` 时整行自动删掉，不留「画风：」残骸；
- `{time}`：**时段描述词**，如「清晨」「正午」「黄昏」「暮色」「入夜」「午夜前」；
- `{clock}`：**她所在城市的当地时间**，`HH:MM`，如 `18:12`。

时段按她当地的分钟数分段，从午夜到午夜前共 23 档（凌晨、黎明前、拂晓、黎明、破晓、晨光初现、
清晨、早晨、上午、上午将尽、临近正午、正午、午后、下午、下午将尽、傍晚、黄昏、暮色、
入夜、夜晚、深夜、午夜前等），比「早/中/晚」细，专门给光线用。
老模板没写 `{style}` / `{time}` / `{clock}` 的，升级后自动补在末尾，不用改配置。

画风就填 `image_style`（例如「动漫画风」）。内置模板里**没有**写死照片质感，出图是动漫还是真人
由这一个配置决定；一旦自己在模板里写「真实手机自拍质感」「胶片颗粒」这类句子，就会盖掉 `image_style`。

`/journey_debug` 会显示当前画风、模板实际取自哪一处、空镜套模板开没开。sidecar 日志
（`engine/logs/sidecar.log`）里每次生图都会记一行 `生图提示词（…）：…`，那是真正发给接口的原文。

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
- `/journey` 末尾会显示「日记 N 天，今天已经写了/还没写」。

### 写完日记的推送

自动日记落盘成功后，插件会把当天正文（带日期和所在城市）推送给**主要通知人**：

| 配置 | 默认 | 行为 |
|---|---|---|
| `diary_notify` | 开 | 关掉就完全不推送 |
| `diary_notify_target` | 空 | 主要通知人（会话）；留空依次沿用 `event_target`、最近会话 |

- 目标解析顺序：`diary_notify_target` → `event_target` → 最近和机器人说话的会话
  （`access_scope=target` 时不用最近会话兜底）；三者都没有就只写日志跳过。
- 推送失败（如找不到会话）只写日志，不影响日记落盘，也不会重试推送。
- 只针对自动日记；模型通过 `journey_diary_write` 工具写的、以及历史日记不做推送。

## 工具

LLM 工具由引擎自动注册（上游 0.8.6 提供 15 个，以实际 `tools()` 为准）：

- `journey_now` / `journey_stats` / `journey_draw_to` / `journey_return_home`
- `journey_diary_write` / `journey_diary_read`
- `journey_photo`（0.8.5 起支持 `subject`：`ground` / `sky` / `food` / `street` / `festival` / `detail`，模型按用户的话选）
- `journey_go_to` / `journey_lodging` / `journey_taste` / `journey_pet`
- `journey_monthly` / `journey_yearly`（月报、年报）
- `journey_invite` / `journey_accept`（碰面联机：发邀约、接邀约）

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
6. 新版本起不来则**自动回滚**到旧 `raw/` 并重启；
7. 成功后的输出**默认只有版本和结果**，不附更新日志。

`update_show_changelog` **默认关闭**；打开后更新成功时附上从新版 `raw/CHANGELOG.md` 截取来的
「旧版 → 新版」段落（旧版没收录时只截新版一节；超过 2500 字截断并提示看全文；
日志读不到或没收录就在回复里说明，不影响更新本身）。「已经是最新」时不输出日志。

`allow_upstream_update` **默认关闭**，要用时才在配置里打开（理由见「安全说明」）；
`upstream_package`、`upstream_registry` 可换源。
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

另外，插件会在内存里保留最近几条**主动汇报**（`recent_report_count`，默认 5 条，**0 = 关闭**；
原独立开关 `inject_recent_reports` 已并进这个数——旧配置里选过「关」的仍以旧开关为准），
只注入给实际收到汇报的那个会话，和旅行状态合并在同一个临时内容块里。这样用户接着
「刚刚到哪了」聊时，主 agent 知道在说哪条汇报。重启插件后
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

- 提示词和 `/journey_photo` **同一套来源**：先由上游生成场景描述（城市/景点/光线/天气/
  体感 + `image_style` 画风），末尾附一行「她此刻：这条汇报的文字」（截到 120 字），
  再套 `image_prompt_template`；需要打开 `selfie_enabled`（配图走自拍那条链路）；
- 不经过上游 `journey.photo`，所以不会和相册照片重复；
- 事件本身已有照片时跳过；
- 生图失败只发文字，并写 `sidecar.log`；
- `always` 会增加费用和发送延迟，建议先用 `probability=0.2~0.3`。
- 只影响主动汇报，`/journey` 查询命令不加图。

## 配置

大部分字段和上游一致：`home_city`、`speed`、`beat_gap`、`rest_days`、`ask_before_depart`、
`max_trip_weeks`、`with_user`、`money_enabled`、`budget`、`has_license`、`meet_url`、
`memory_dir`、`amap_key`、`image_api/key/style`。

> **`max_trip_months` 没了**：上游 0.8 起「一次最多在外」按**周**算（`max_trip_weeks`，1–52，默认 26）。
> 插件会自动把旧配置换算过来（1 个月 ≈ 4.345 周，日志里会写明换算结果）；
> 之后请直接配 `max_trip_weeks`。

上游 0.6–0.8.6 新增、插件表单已接上的字段：

| 项 | 默认 | 说明 |
|---|---|---|
| `max_trip_weeks` | 26 | 一次最多在外几周，到点强制回家 |
| `has_license` | 开 | 关掉后她永远不自驾、不租车 |
| `meet_url` | 空 | 碰面服务器；见「碰面联机」 |
| `image_protocol` | `openai` | `openai` 云端 / `comfyui` 本地；见「ComfyUI 接入」 |
| `image_workflow` | 空 | ComfyUI 的 API 格式 workflow（协议选 comfyui 时必填） |
| `image_prompt_node` | 空 | ComfyUI 提示词节点 id；留空自动找 |
| `comfy_negative` | 空 | 负向提示词（仅 ComfyUI，主拍照和海报都传） |
| `comfy_negative_node` | 空 | 负向节点 id；留空自动找 |
| `image_timeout_sec` | 0 | 出图最多等几秒；0 = 默认（本地 180、云端 90）。`/journey_photo` 的等待上限自动跟随 |
| `image_cast` | 空 | 照片里出不出人（留空无人；填一段外貌描述） |
| `image_size` | 空 | 出图尺寸 `宽x高`（如 `1664x928`）；留空 1024x1024；自拍尺寸留空时跟随这里 |
| `image_watermark` | `auto` | 「AI生成」水印：`auto` 云端裁/本地不裁、`off` 不裁、`crop` 都裁 |
| `photo_dir` | 空 | 照片额外归档目录；留空用插件数据目录 |

`image_model` 是**列表**（`生图模型名`）：按填写顺序尝试，第一个模型报错就自动换下一个，
全部失败才抛出错误。留空按 `gpt-image-1` 试。仅云端协议生效。

### ComfyUI 接入

`image_protocol=comfyui` 时她直接对着本地 ComfyUI 出图（`POST /prompt`，用你的 workflow）：

1. `image_api` 填 ComfyUI 服务地址（如 `http://127.0.0.1:8188`），`image_key` 通常留空；
2. `image_workflow` 粘贴「Save (API Format)」导出的 JSON；提示词节点、负向节点留空即自动找；
3. 想排除季节不对的景观，填 `comfy_negative`；画幅用 `image_size`（自动吸附 8 的倍数）。

套壳的**自拍参考图、提示词模板、模型列表降级只在 OpenAI 协议生效**（ComfyUI 的请求形状不同，
拦不到也不该拦）；`image_protocol=comfyui` 且没单独配 `selfie_api` 时，自拍套壳与主动汇报配图
自动停用并写日志。想「ComfyUI 画风景 + 云端画自拍」，把 `selfie_api/key` 单独指向云端即可。
`image_watermark=auto` 也不会对本地出图动刀 —— 水印是云端服务商盖的，本地图没有。

### 碰面联机

`meet_url` 填一个「碰面服务器」地址（作者公共池 `https://cooppetsjourney.top`，也可自建），
她就进入同城池：到站能看到这一带还有谁、`journey_invite` 发邀约、`journey_accept` 接邀约，
接了会**真的**走过去待约定的那几天。只开一半没有意义（只能看别人或只能被看都是占便宜），
所以是一个开关管两头。留空＝照常旅行，永远一个人，其它功能不受影响。
被看见的只有宠物名、城市、时段（24 小时过期），不能聊天。
开了 `ask_before_depart` 时，接邀约也会走「点头卡片」：`/journey_yes` 才算应约。

套壳自己的（配置页按【分组】顺序显示：基本 / 旅行 / 日记 / 数据 / 生图 / 生图·ComfyUI /
模板 / 自拍 / 主动消息 / 聊天注入 / 权限 / 上游更新 / 高级。下表同序）：

| 项 | 默认 | 说明 |
|---|---|---|
| `diary_write_time` | `23:00` | 她当地时间自动写日记；`HH:MM`，留空关闭 |
| `diary_notify` | 开 | 自动日记写完后推送给主要通知人 |
| `diary_notify_target` | 空 | 日记主要通知人（会话）；留空沿用 `event_target`，再空用最近会话 |
| `inject_prompt` | 开 | 注入旅行状态 |
| `recent_report_count` | 5 | 保留并注入几条汇报；**0 = 关**（原 `inject_recent_reports` 开关已并入；旧配置选过「关」的仍以旧开关为准） |
| `proactive_enabled` | 关 | 主动发事件 |
| `event_target` | 空 | 主动消息目标会话；`target` 模式下也是唯一允许使用的会话 |
| `access_scope` | `all` | `all` 所有会话；`target` 仅 `event_target` |
| `debounce_seconds` | 60 | 路上事件合并窗口（壳层发送频率；和 `beat_gap` 是两回事） |
| `report_image_mode` | `off` | `off` / `always` / `probability` |
| `report_image_probability` | 0.3 | 汇报配图概率 |
| `admin_only_controls` | 开 | 出发/点头/拍照/同步/更新仅管理员 |
| `allow_reset` | 开 | 允许 `/journey_reset`（始终仅管理员） |
| `allow_upstream_update` | 关 | 允许 `/journey_update`（默认关闭，见下方说明） |
| `upstream_package` | `coopani-world-journey` | 上游 npm 包名 |
| `upstream_registry` | `https://registry.npmjs.org` | npm registry |
| `update_show_changelog` | 关 | `/journey_update` 成功时是否附上上游更新日志 |
| `selfie_enabled` | 关 | 所有照片必须是自拍 |
| `selfie_reference` | 空 | 自拍参考图（WebUI 上传） |
| `selfie_reference_path` | 空 | 参考图绝对路径/URL（可选） |
| `selfie_subject` | `她本人` | 提示词主体 |
| `image_prompt_template` | 内置模板 | 出镜生图模板（含汇报配图），可用 `{scene}`/`{subject}`/`{style}`/`{time}`/`{clock}` |
| `image_prompt_scene_template` | 内置模板 | 空镜模板（没开自拍时用），守住「画面里没有人物」 |
| `image_prompt_for_scene` | 开 | 关掉后空镜只用上游原话，不套模板 |
| `selfie_prompt` | 空 | 旧字段：`image_prompt_template` 留空时才生效 |
| `selfie_api/key/model` | 空 | 留空沿用生图配置（`image_model` 列表按顺序降级）；生图协议是 ComfyUI 时要自拍就得单独指云端 |
| `selfie_mode` | `edit` | `edit` / `generation` / `native` |
| `selfie_native_url` | 空 | native 完整端点，留空自动拼 |
| `selfie_image_field` | `image_url` | generation 模式图片字段 |
| `selfie_size` | 空 | 自拍尺寸；**留空跟随 `image_size`**，再空＝不发尺寸（云端默认方形）；旧配置里存的 `1024x1024` 照旧生效 |
| `offline` | 关 | 不查天气/酒店/生图 |
| `node_path` | 空 | Node 22.7+ 路径 |
| `sidecar_port` | 0 | 0 = 自动选空闲端口 |
| `request_timeout` | 10 | 普通命令的 sidecar 超时（秒）；出图等待跟 `image_timeout_sec` 走，不等这里 |
| `log_level` | `info` | `info` / `debug` |
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
  用 ComfyUI 时先核对 `image_protocol=comfyui` + `image_workflow` —— 协议选错**不报错**，只是一直拍不出来。
- **照片永远是同一处风景**：那是默认题材 `ground`。在对话里说「拍晚饭/拍街景/拍特写」（模型会选
  `subject`），或直接 `/journey_photo 晚饭`。
- **开了「出门等你点头」她一直不走**：她发的是 `journey.ask` 事件，要回 `/journey_yes`（或 `/jy yes`）；
  `/journey_depart` 是无条件放行。没有待批的事时 `/journey_yes` 会直说「她现在没有在等你点头」。
- **拍照报 `Server disconnected`**：sidecar 在拍照途中被重载/重启（改配置、更新插件、重载插件）。
  等几秒重试；客户端等待上限跟 `image_timeout_sec` 走（至少 150s），不会用 10s 默认超时误杀慢图。
- **出图画风和 `image_style` 不一致**：先跑 `/journey_debug` 看「生图画风 / 提示词模板 / 空镜套模板」
  三行，再到 `logs/sidecar.log` 找 `生图提示词（…）：…`，那行就是发给接口的原文。
  原文里没有你的画风，说明模板被自定义文本盖住了（例如旧 `selfie_prompt` 里写死了「真实手机自拍质感」）；
  原文里有画风还是出真人，那就是底模不听指令，换 `image_model`。
- **拍照很慢**：v0.6.6 起 `/journey_photo` 立刻返回“开始拍了”，后台等图；出图后自动发。
  如果主动消息关着，后台任务会直接发到发命令的会话；失败也会主动回原因。
- **更新失败**：看回复里的原因；插件会回滚旧 `raw/`。确认能访问 npm，且 Node 22.7+。

## 许可

上游引擎 `coopani-world-journey` 作者 Mr.Q，MIT。本插件只做套壳与 AstrBot 接入；
详见随包的 `THIRD_PARTY_NOTICES.md`。
