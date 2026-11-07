"""大肥鱼环游世界 · AstrBot 插件。

薄壳：AstrBot 的命令/工具/提示词/主动消息在这里；旅行逻辑全在 raw/ 上游引擎，
通过 engine/sidecar.mjs 的回环 HTTP 调用。上游更新时通常只重建 sidecar，不改这个文件。
"""
from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import os
import random
import re
import shutil
import subprocess
import time
import urllib.parse
from pathlib import Path
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import aiohttp
from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, StarTools
from astrbot.core.agent.tool import FunctionTool
from astrbot.core.config.astrbot_config import AstrBotConfig
from astrbot.core.message.components import Image, Plain
from astrbot.core.message.message_event_result import MessageChain
from astrbot.core.provider.entities import ProviderRequest

try:  # AstrBot 推荐的“仅本轮可见”内容块
    from astrbot.core.agent.message import TextPart
except Exception:  # pragma: no cover - 老版本兜底
    TextPart = None  # type: ignore[assignment]

from .access import access_allowed
from .bridge import BridgeError, RAW_DIR, SidecarBridge, UPDATER
from .config_map import write_engine_config
from .defaults import DEFAULT_IMAGE_PROMPT, DEFAULT_SCENE_PROMPT, LEGACY_SELFIE_PROMPT
from .diary_view import clock_minutes, parse_write_time, plain_text, read_diary_entries
from .event_pump import EventPump
from .reset import clear_memory_dir
from .upstream_version import downgrade_hint, newest_version, read_pkg_version, version_key

PLUGIN_NAME = "astrbot_plugin_world_journey"

# 功能 → 上游 raw 最低版本（对应 raw/CHANGELOG 的「功能引入」条目）。
# 「壳新 raw 旧」时的典型错法：命令在壳里有、raw 里没这功能 —— 旧 raw 找不到
# 方法/参数会**静默给错行为**（点头答不上、题材拍成普通风景）。命中指令先按
# 这张表比对版本，不足就不去调引擎，直接回升级指引。
_FEATURE_MIN_RAW: dict[str, tuple[str, str]] = {
    # 0.7.9：待批卡片进快照 + 面板「好/不好」即 answerAsk
    "ask": ("点头卡片答复（/journey_yes、/journey_no）", "0.7.9"),
    # 0.5.19：「叫她回来」面板按钮与 returnHome
    "back": ("叫她回来（/journey_back）", "0.5.19"),
    # 0.8.5：journey_photo 的 subject 六题材
    "photo_subject": ("带题材的拍照（/journey_photo …）", "0.8.5"),
}

# 功能 → sidecar /api/health 里 capabilities() 的实测键名（adapter/bridge.ts）。
# 版本表只是文案素材与离线兜底；**判定以实测为准**，上游改名/新增时自动跟上。
# 新增面板方法类指令时：bridge.ts capabilities() 加一行、这张表和上面那张各加一条。
_FEATURE_CAP_KEY: dict[str, str] = {
    "ask": "answerAsk",
    "back": "returnHome",
    "photo_subject": "photoSubject",
}


class WorldJourneyPlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.context = context
        self._config_obj = config
        self.cfg: dict[str, Any] = config
        self._normalize_image_prompt()
        self._normalize_image_model()
        self.plugin_dir = Path(__file__).resolve().parent
        try:
            self.data_dir = Path(StarTools.get_data_dir(PLUGIN_NAME))
        except Exception:
            self.data_dir = self.plugin_dir / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.engine_dir = self.data_dir / "engine"
        self.engine_dir.mkdir(parents=True, exist_ok=True)
        self.state = self._load_state()
        self.bridge = SidecarBridge(data_dir=self.data_dir, config=self.cfg, log=logger)
        self.pump: EventPump | None = None
        self._tools: list[FunctionTool] = []
        self._ready_lock = asyncio.Lock()
        self._photo_task: asyncio.Task[None] | None = None
        self._diary_task: asyncio.Task[None] | None = None
        self._diary_lock = asyncio.Lock()
        self._diary_next_attempt = 0.0
        self._recent_reports: list[str] = []
        self._report_target = ""
        # 上游源码被装回旧版时的提示（/journey_debug 里也显示）。
        self._upstream_hint = ""

    def _normalize_image_prompt(self) -> None:
        """把提示词模板迁到「生图提示词模板」，并给空镜模板回填默认值。

        旧的 `selfie_prompt` 有三种来历，处理不一样，**不能一律覆盖**：

        - 空的：新字段直接回填内置默认；
        - 填的正好是旧版默认模板：等于用户从没改过，换成新的画风跟随模板，并清空旧字段；
        - 用户自己改过：新字段留空，运行期回退读旧字段，一个字都不动他的内容。

        旧字段里那句「真实手机自拍质感」是「画面风格」失效的直接原因之一，
        但它是用户写的，只能由他自己改 —— 所以这里识别并原样保留，不冒充用户意图。
        """
        changed = False
        fresh = str(self.cfg.get("image_prompt_template") or "").strip()
        legacy = str(self.cfg.get("selfie_prompt") or "").strip()
        if not fresh and (not legacy or legacy == LEGACY_SELFIE_PROMPT.strip()):
            self.cfg["image_prompt_template"] = DEFAULT_IMAGE_PROMPT
            if legacy:
                self.cfg["selfie_prompt"] = ""
            changed = True
        if not str(self.cfg.get("image_prompt_scene_template") or "").strip():
            self.cfg["image_prompt_scene_template"] = DEFAULT_SCENE_PROMPT
            changed = True
        if changed:
            with contextlib.suppress(Exception):
                self._config_obj.save_config()

    def _template_source(self) -> str:
        """当前出镜模板实际取自哪一处 —— 给 /journey_debug 用，画风不对时先看到这行。"""
        if str(self.cfg.get("image_prompt_template") or "").strip():
            return "生图提示词模板"
        if str(self.cfg.get("selfie_prompt") or "").strip():
            return "自拍提示词模板（旧字段）"
        return "内置默认"

    def _normalize_image_model(self) -> None:
        """老版本把「生图模型名」存成单个字符串；列表控件要数组，迁移一次并写回。

        不迁移的话设置页会把这个字符串当成「只有一个字符」的列表来显示，
        用户点开看到的模型名是残缺的。
        """
        current = self.cfg.get("image_model")
        if not isinstance(current, str):
            return
        models = [part.strip() for part in re.split(r"[\n,，;；]+", current) if part.strip()]
        self.cfg["image_model"] = models
        with contextlib.suppress(Exception):
            self._config_obj.save_config()

    # ---------------- 生命周期 ----------------
    async def initialize(self) -> None:
        if not self._enabled:
            logger.info("[world-journey] 插件在配置里关闭，不启动 sidecar。")
            return
        try:
            self._write_engine_config()
        except Exception as exc:
            logger.error("[world-journey] 配置写不出来：%s", exc)
            return
        try:
            await self._ensure_ready()
        except Exception as exc:
            logger.error("[world-journey] sidecar 启动失败：%s", exc)
            return
        self._start_pump()
        self._start_diary_task()
        self._check_upstream_versions()
        try:
            health = await self.bridge.health()
            logger.info(
                "[world-journey] 就绪：上游 %s，地址 %s，工具 %s 个",
                health.get("upstreamVersion"), self.bridge.base_url or "?", len(self._tools),
            )
        except Exception:
            logger.info("[world-journey] 就绪。")

    async def terminate(self) -> None:
        await self._stop_diary_task()
        await self._cancel_photo_task()
        if self.pump is not None:
            await self.pump.stop()
            self.pump = None
        self._unregister_tools()
        with contextlib.suppress(Exception):
            await self.bridge.stop()
        self._save_state()
        logger.info("[world-journey] 已停止。")

    @property
    def _enabled(self) -> bool:
        return bool(self.cfg.get("enabled", True))

    async def _ensure_ready(self) -> None:
        if not self._enabled:
            raise BridgeError("插件在配置里关闭了")
        async with self._ready_lock:
            if self.bridge.ready:
                return
            self.bridge.config = self.cfg
            self._write_engine_config()
            await self.bridge.start()
            if not self._tools:
                await self._register_tools()

    # ---------------- 工具 ----------------
    async def _register_tools(self) -> None:
        decls = await self.bridge.tools()
        tools: list[FunctionTool] = []
        for decl in decls:
            name = str(decl.get("name") or "").strip()
            if not name:
                continue
            parameters = decl.get("parameters")
            if not isinstance(parameters, dict):
                parameters = {"type": "object", "properties": {}}
            handler = self._make_tool_handler(name)
            try:
                tools.append(FunctionTool(
                    name=name,
                    description=str(decl.get("description") or ""),
                    parameters=parameters,
                    handler=handler,
                ))
            except Exception as exc:
                logger.warning("[world-journey] 工具 %s 注册构造失败：%s", name, exc)
        if not tools:
            logger.warning("[world-journey] 上游没有返回任何工具。")
            return
        try:
            self.context.add_llm_tools(*tools)
        except AttributeError:
            # 旧版 AstrBot 兼容
            self.context.provider_manager.llm_tools.func_list.extend(tools)
        self._tools = tools
        logger.info("[world-journey] 注册工具：%s", "、".join(t.name for t in tools))

    def _make_tool_handler(self, name: str):
        plugin = self

        async def handler(event: AstrMessageEvent, **kwargs: Any) -> str:
            if not plugin._access_ok(event):
                return "这个旅行工具只在指定会话可用。"
            plugin._note_umo(event)
            try:
                await plugin._ensure_ready()
                result = await plugin.bridge.call_tool(name, kwargs)
            except Exception as exc:
                return f"旅行工具暂时不可用：{exc}"
            text = str(result.get("text") or "")
            return ("⚠ " + text) if result.get("isError") else text

        return handler

    def _unregister_tools(self) -> None:
        for tool in self._tools:
            with contextlib.suppress(Exception):
                self.context.unregister_llm_tool(tool.name)
        self._tools = []

    # ---------------- 提示词 ----------------
    @filter.on_llm_request()
    async def inject_prompt(self, event: AstrMessageEvent, req: ProviderRequest) -> None:
        if not self._access_ok(event):
            self._drop_journey_tools(req)
            return
        if not self._enabled or not bool(self.cfg.get("inject_prompt", True)):
            return
        self._note_umo(event)
        if not self.bridge.ready:
            return
        try:
            text = await self.bridge.prompt()
        except Exception as exc:
            logger.debug("[world-journey] 提示词拉取失败：%s", exc)
            text = ""
        parts: list[str] = []
        if text.strip():
            parts.append(text.strip())
        recent = self._recent_reports_block(event)
        if recent:
            parts.append(recent)
        if parts:
            self._append_extra_user_content(req, "\n\n".join(parts))

    @staticmethod
    def _append_extra_user_content(req: ProviderRequest, text: str) -> bool:
        """用临时内容块注入，不改 system prompt，避免破坏 prompt cache。"""
        if not text.strip():
            return False
        if TextPart is None:
            logger.warning("[world-journey] 当前 AstrBot 不支持 TextPart，跳过提示词注入")
            return False
        parts = getattr(req, "extra_user_content_parts", None)
        if not isinstance(parts, list):
            logger.warning("[world-journey] 当前 AstrBot 不支持 extra_user_content_parts，跳过提示词注入")
            return False
        try:
            part = TextPart(text=text)
            mark = getattr(part, "mark_as_temp", None) or getattr(part, "make_as_temp", None)
            if not callable(mark):
                logger.warning("[world-journey] 当前 AstrBot 不支持临时内容块，跳过提示词注入")
                return False
            parts.append(mark())
            return True
        except Exception as exc:  # pragma: no cover - 防御
            logger.warning("[world-journey] 提示词注入失败：%s", exc)
            return False

    def _recent_report_limit(self) -> int:
        """保留/注入几条汇报；0 = 关闭。

        旧「inject_recent_reports」开关已并进「recent_report_count」（0 = 关）。
        老配置里显式把旧开关选成关的仍然优先 —— schema 删掉后 AstrBot 不会清除
        配置文件里的旧值，`cfg.get` 照样读得到，行为不翻转。
        """
        if self.cfg.get("inject_recent_reports") is False:
            return 0
        raw = self.cfg.get("recent_report_count", 5)
        try:
            value = int(raw)
        except (TypeError, ValueError):
            value = 5
        return max(0, min(20, value))

    def _recent_reports_block(self, event: AstrMessageEvent) -> str:
        count = self._recent_report_limit()
        if count <= 0:
            return ""
        if not self._recent_reports or not self._report_target:
            return ""
        umo = str(getattr(event, "unified_msg_origin", "") or "").strip()
        if umo != self._report_target:
            return ""
        reports = self._recent_reports[-count:]
        return "最近发给这个会话的旅行汇报（从旧到新）：\n" + "\n".join(f"- {r}" for r in reports)

    # ---------------- 主动消息 ----------------
    def _start_pump(self) -> None:
        if self.pump is not None:
            return
        mode = str(self.cfg.get("report_image_mode") or "off").lower()
        self.pump = EventPump(
            bridge=self.bridge,
            state=self.state,
            save_state=self._save_state,
            deliver=self._deliver,
            log=logger,
            enabled=bool(self.cfg.get("proactive_enabled", False)),
            debounce_seconds=int(self.cfg.get("debounce_seconds", 60) or 60),
            target=str(self.cfg.get("event_target") or ""),
            fallback_umo=lambda: "" if self._access_scope() == "target" else str(self.state.get("last_umo") or ""),
            image_factory=self._maybe_report_image if mode in {"always", "probability"} else None,
        )
        self.pump.start()

    async def _maybe_report_image(self, event: dict[str, Any]) -> bytes | None:
        """主动汇报的配图。

        提示词由 sidecar 用**和 /journey_photo 同一套**场景描述生成（含「画面风格」），
        这里只决定要不要配、以及概率。`journey.photo` 事件本身已经带照片，
        不再叠一张；没开自拍时也不配图 —— 保持原来的成本上限。
        """
        if str(event.get("type") or "") == "journey.photo":
            return None
        if not self.cfg.get("selfie_enabled"):
            return None
        mode = str(self.cfg.get("report_image_mode") or "off").lower()
        if mode == "off":
            return None
        if mode == "probability":
            try:
                probability = max(0.0, min(1.0, float(self.cfg.get("report_image_probability", 0.3))))
            except (TypeError, ValueError):
                probability = 0.3
            if random.random() >= probability:
                return None
        try:
            return await self.bridge.reportImage(str(event.get("text") or ""))
        except Exception as exc:
            logger.warning("[world-journey] 汇报配图异常：%s", exc)
            return None

    # ---------------- 自动日记 ----------------
    def _diary_dirs(self, snap: dict[str, Any] | None = None) -> list[Path]:
        """读日记的目录：本机兜底 + raw 当前实际写入的目录（去重）。"""
        dirs: list[Path] = []

        def add(path: Path | None) -> None:
            if path is None:
                return
            try:
                resolved = path.expanduser().resolve()
            except (OSError, RuntimeError):
                resolved = path
            if resolved not in dirs:
                dirs.append(resolved)

        add(self.engine_dir / "diary")
        value = ""
        if snap:
            diary = snap.get("diary") if isinstance(snap.get("diary"), dict) else {}
            value = str(diary.get("dir") or "").strip()
        if not value:
            effective = self._effective_memory_dir()
            if effective is not None:
                value = str(effective)
        if value:
            path = Path(value)
            if not path.is_absolute():
                path = self.plugin_dir / path
            add(path)
        return dirs

    def _diary_write_time(self) -> tuple[int, int] | None:
        """她当地时间的写日记时刻；留空或格式不对 = 关闭。"""
        return parse_write_time(str(self.cfg.get("diary_write_time") or ""))

    def _start_diary_task(self) -> None:
        target = self._diary_write_time()
        if target is not None:
            logger.info("[world-journey] 自动写日记已启用：她当地 %02d:%02d。", target[0], target[1])
        if self._diary_task is None or self._diary_task.done():
            self._diary_task = asyncio.create_task(self._diary_loop())

    async def _stop_diary_task(self) -> None:
        task = self._diary_task
        self._diary_task = None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _diary_loop(self) -> None:
        while True:
            try:
                await self._maybe_auto_diary()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning("[world-journey] 自动日记巡检失败：%s", exc)
            await asyncio.sleep(30)

    async def _maybe_auto_diary(self) -> None:
        """到她当地的目标时刻后，若当天还没写，就生成并写一篇。"""
        target = self._diary_write_time()
        if target is None:
            return
        if time.monotonic() < self._diary_next_attempt:
            return
        async with self._diary_lock:
            if time.monotonic() < self._diary_next_attempt:
                return
            try:
                snap = await self.bridge.status()
            except Exception as exc:
                self._diary_next_attempt = time.monotonic() + 300
                logger.debug("[world-journey] 自动日记：暂时读不到她的时钟（%s）", exc)
                return
            date_key = str(snap.get("dateKey") or "").strip()
            clock = str(snap.get("clock") or "").strip()
            minutes = clock_minutes(clock)
            if not date_key or minutes is None:
                return
            if minutes < target[0] * 60 + target[1]:
                return
            if str(self.state.get("diary_written_date") or "") == date_key:
                return
            if any(entry.date_key == date_key for entry in read_diary_entries(self._diary_dirs(snap))):
                self.state["diary_written_date"] = date_key
                self._save_state()
                return
            try:
                await self._write_auto_diary(snap, date_key)
            except Exception as exc:
                self._diary_next_attempt = time.monotonic() + 600
                logger.warning("[world-journey] 自动日记失败：%s（10 分钟后重试）", exc)

    async def _write_auto_diary(self, snap: dict[str, Any], date_key: str) -> None:
        provider = await self._get_provider()
        if provider is None:
            raise RuntimeError("AstrBot 没有可用的 LLM provider")
        system_prompt = await self.bridge.prompt()
        instruction = self._diary_instruction(snap)
        response = await asyncio.wait_for(
            provider.text_chat(
                prompt=instruction,
                system_prompt=(
                    f"{system_prompt}\n\n"
                    "现在只输出这篇日记的正文：不要标题、不要日期、不要 Markdown、"
                    "不要列表、不要工具调用或任何解释。"
                ),
                session_id=f"world_journey_diary_{date_key}",
            ),
            timeout=180,
        )
        body = self._clean_diary_body(str(getattr(response, "completion_text", "") or ""))
        if not body:
            raise RuntimeError("模型返回了空日记")
        # 生成要几十秒，期间用户可能手动写了：再确认一次，别覆盖。
        if any(entry.date_key == date_key for entry in read_diary_entries(self._diary_dirs(snap))):
            self.state["diary_written_date"] = date_key
            self._save_state()
            return
        result = await self.bridge.call_tool(
            "journey_diary_write",
            {"body": body, "dateKey": date_key},
        )
        message = str(result.get("text") or "")
        if result.get("isError") and "只存到本机" not in message:
            raise RuntimeError(message or "日记写入失败")
        if result.get("isError"):
            # 同步盘写不进去但本机兜底成功了：算写成功，只在日志里说一声。
            logger.warning("[world-journey] 自动日记写入回落：%s", message)
        self.state["diary_written_date"] = date_key
        self._save_state()
        self._diary_next_attempt = 0.0
        logger.info("[world-journey] 自动日记已写：%s（%d 字）", date_key, len(body))
        await self._notify_diary_written(snap, date_key, body)

    def _diary_notify_target(self) -> str:
        """日记推送对象：主要通知人 → event_target → 最近会话（target 控制范围时不兜底）。"""
        target = str(self.cfg.get("diary_notify_target") or "").strip()
        if target:
            return target
        target = str(self.cfg.get("event_target") or "").strip()
        if target:
            return target
        if self._access_scope() == "target":
            return ""
        return str(self.state.get("last_umo") or "").strip()

    async def _notify_diary_written(self, snap: dict[str, Any], date_key: str, body: str) -> None:
        """把刚写完的日记推给主要通知人；发不出去只记日志，日记已经落盘了。"""
        if not bool(self.cfg.get("diary_notify", True)):
            return
        target = self._diary_notify_target()
        if not target:
            logger.info(
                "[world-journey] 日记没处推送：diary_notify_target / event_target / 最近会话都是空的。"
            )
            return
        place = snap.get("place") if isinstance(snap.get("place"), dict) else {}
        city = str((place or {}).get("name") or "").strip()
        header = f"📖 {date_key} 的日记写好了" + (f"（{city}）" if city else "") + "："
        try:
            for chunk in self._split_text(f"{header}\n\n{body}"):
                ok = await self.context.send_message(target, MessageChain([Plain(chunk)]))
                if ok is False:
                    raise RuntimeError(f"没有找到匹配的平台/会话：{target}")
            logger.info("[world-journey] 日记已推送给主要通知人：%s", target)
        except Exception as exc:
            logger.warning("[world-journey] 日记推送失败（%s）：%s", date_key, exc)

    def _diary_instruction(self, snap: dict[str, Any]) -> str:
        lines = [
            f"现在是当地 {snap.get('dateKey')} {snap.get('clock')}，一天结束了。",
            "用第一人称写今天的旅行日记，2 到 3 段。",
            "只写今天真实发生的事：去了哪儿、看到什么、吃了什么、住哪儿、身体什么感觉。",
            "不要写成攻略，不要总结这个扩展；不要标题、日期、Markdown、列表。",
            "直接给正文。",
            "",
            self._diary_context(snap),
        ]
        return "\n".join(line for line in lines if line is not None).strip()

    def _diary_context(self, snap: dict[str, Any]) -> str:
        lines: list[str] = []
        place = snap.get("place") or {}
        if isinstance(place, dict) and place.get("name"):
            lines.append(f"所在城市：{place['name']}")
        lodging = snap.get("lodging") or {}
        if isinstance(lodging, dict) and lodging.get("name"):
            kind = str(lodging.get("kind") or "").strip()
            lines.append(f"今晚住处：{lodging['name']}{f'（{kind}）' if kind else ''}")
        trip = snap.get("trip") or {}
        if isinstance(trip, dict):
            if trip.get("days"):
                lines.append(f"这一趟第 {int(trip['days'])} 天")
            if trip.get("visited"):
                lines.append(f"这一趟去过 {int(trip['visited'])} 个地方")
        events = self._today_events(snap)
        if events:
            lines.append("今天发生的事：")
            lines.extend(events)
        return "\n".join(lines)

    def _today_events(self, snap: dict[str, Any]) -> list[str]:
        """从事件日志里取她当地「今天」的事，给自动日记当事实依据。"""
        path = self.engine_dir / "events.jsonl"
        try:
            raw_lines = path.read_text(encoding="utf-8").splitlines()[-600:]
        except OSError:
            return []
        events: list[dict[str, Any]] = []
        for line in raw_lines:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and item.get("text"):
                events.append(item)
        if not events:
            return []

        today = str(snap.get("dateKey") or "").strip()
        start_seq = 0
        if today:
            for item in events:
                if item.get("type") == "journey.day" and today in str(item.get("text") or ""):
                    start_seq = int(item.get("seq") or 0)
        selected: list[dict[str, Any]]
        if start_seq:
            selected = [item for item in events if int(item.get("seq") or 0) >= start_seq]
        else:
            zone = self._diary_zone(snap)
            selected = []
            for item in events:
                try:
                    stamp = datetime.fromisoformat(str(item.get("ts") or "").replace("Z", "+00:00"))
                    local = stamp.astimezone(zone)
                except (TypeError, ValueError, OSError):
                    continue
                if local.date().isoformat() == today:
                    selected.append(item)
        if not selected:
            selected = events[-12:]

        out: list[str] = []
        for item in selected[-40:]:
            text = " ".join(str(item.get("text") or "").split())
            if text:
                out.append(text[:300])
        return out

    @staticmethod
    def _diary_zone(snap: dict[str, Any]) -> ZoneInfo:
        place = snap.get("place") or {}
        name = str(place.get("tz") or "").strip() if isinstance(place, dict) else ""
        try:
            return ZoneInfo(name) if name else ZoneInfo("UTC")
        except Exception:
            return ZoneInfo("UTC")

    @staticmethod
    def _clean_diary_body(text: str) -> str:
        body = plain_text(text)
        body = re.sub(r"^```[\w-]*\s*", "", body)
        body = re.sub(r"\s*```$", "", body)
        body = re.sub(r"^(旅行)?日记(正文)?[:：]\s*", "", body)
        body = body.strip()
        if len(body) > 4000:
            body = body[:4000].rstrip() + "…"
        return body

    async def _get_provider(self):
        getter = getattr(self.context, "get_using_provider_async", None)
        if callable(getter):
            provider = getter()
        else:
            getter = getattr(self.context, "get_using_provider", None)
            if not callable(getter):
                return None
            provider = getter()
        if inspect.isawaitable(provider):
            provider = await provider
        return provider


    async def _deliver(self, target: str, text: str, photo_bytes: bytes | None) -> None:
        sent = False
        for chunk in self._split_text(text):
            ok = await self.context.send_message(target, MessageChain([Plain(chunk)]))
            sent = sent or bool(ok)
            if ok is False:
                raise RuntimeError(f"没有找到匹配的平台/会话：{target}")
        if photo_bytes:
            ok = await self.context.send_message(target, MessageChain([Image.fromBytes(photo_bytes)]))
            sent = sent or bool(ok)
            if ok is False:
                raise RuntimeError(f"没有找到匹配的平台/会话：{target}")
        if not sent and not text and not photo_bytes:
            return
        if text.strip():
            snippet = text.strip()
            if len(snippet) > 1200:
                snippet = snippet[:1200] + "…"
            limit = self._recent_report_limit()
            if limit > 0:
                if not self._recent_reports or self._recent_reports[-1] != snippet:
                    self._recent_reports.append(snippet)
                self._recent_reports = self._recent_reports[-limit:]
            self._report_target = target

    @staticmethod
    def _split_text(text: str, size: int = 1500) -> list[str]:
        text = text.strip()
        if not text:
            return []
        return [text[i:i + size] for i in range(0, len(text), size)]

    # ---------------- 命令 ----------------
    _HELP_TOKENS = {"help", "h", "?", "？", "帮助", "用法", "怎么用"}

    @filter.command("journey", alias={"旅行", "她在哪", "今日计划", "行程"})
    async def journey(self, event: AstrMessageEvent):
        """她此刻在哪、那边几点、今天剩下怎么过、今晚住哪、这一趟花了多少；/journey help 看全部指令。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        arg = self._command_arg(event)
        if arg.lower() in self._HELP_TOKENS:
            yield event.plain_result(self._render_help())
            return
        try:
            await self._ensure_ready()
            # `/api/now` 是她此刻那一段话；`/api/status` 是面板快照（时间轴 / 住宿 / 账目）。
            # 两个都要：前者有身体感觉和「下一个点」，后者才排得出整天的表。
            now_text = await self.bridge.now()
            snap = await self.bridge.status()
        except Exception as exc:
            yield event.plain_result(f"旅行引擎没启动：{exc}")
            return
        self._note_umo(event)
        entries = read_diary_entries(self._diary_dirs(snap))
        today = str(snap.get("dateKey") or "")
        today_written = any(entry.date_key == today for entry in entries)
        diary_days = len(entries)
        if diary_days == 0:
            # 文件暂时读不到时，至少用上游统计里的天数兜底。
            diary = snap.get("diary") if isinstance(snap.get("diary"), dict) else {}
            diary_days = int(diary.get("days") or 0)
        for chunk in self._split_text(self._render_journey(now_text, snap, diary_days, today_written)):
            yield event.plain_result(chunk)

    @staticmethod
    def _render_journey(now_text: str, snap: dict[str, Any], diary_days: int, today_written: bool) -> str:
        """`/journey` 的正文：上游那段「此刻」，加上计划与账目。

        **只补 now 里没有的。** 上游的「此刻」已经说了今晚住什么档次、下一个点是什么，
        再原样贴一遍就成了两段重复的话；这里补的是真店名、地址、完整时间轴和花费。
        """
        lines = [now_text.strip()]
        mode = str(snap.get("mode") or "")
        trip = snap.get("trip") or {}

        if mode == "staying":
            lodging = snap.get("lodging") or {}
            label = str(lodging.get("name") or "").strip()
            kind = str(lodging.get("kind") or "").strip()
            if label:
                room = f"{label}（{kind}）" if kind else label
                price = lodging.get("price")
                if isinstance(price, (int, float)) and price:
                    room += f"，约 {int(price)} 元一晚"
                lines.append(f"住处：{room}")
                address = str(lodging.get("address") or "").strip()
                if address:
                    lines.append(f"　{address}")

        # 时间轴对两种状态都成立：在路上时上游只给「到站」这一条，
        # 到站后才有当天的作息表（plan 是在 `arrive()` 里才排的，不是结算出来的）。
        timeline = [t for t in (snap.get("timeline") or []) if isinstance(t, dict)]
        if timeline:
            past = [t for t in timeline if t.get("past")]
            future = [t for t in timeline if not t.get("past")]
            lines.append("")
            # 先摆刚过去的，再摆接下来的 —— 读起来是「走到这儿了，然后是这些」。
            for item in past:
                lines.append(f"  {item.get('at', '')}  {item.get('what', '')}（刚过去）")
            if future:
                lines.append("今天剩下的安排：" if mode == "staying" else "接下来：")
                for item in future:
                    lines.append(f"  {item.get('at', '')}  {item.get('what', '')}")
            else:
                lines.append("今天的安排都过完了。")

        spend = WorldJourneyPlugin._spend_line(trip)
        if spend:
            lines.append(spend)
        bits = []
        if trip.get("days"):
            bits.append(f"这一趟第 {int(trip['days'])} 天")
        if trip.get("visited"):
            bits.append(f"去过 {int(trip['visited'])} 个地方")
        if bits:
            lines.append("，".join(bits))
        lines.append(f"日记 {diary_days} 天，今天{'已经写了' if today_written else '还没写'}。")

        return "\n".join(lines).strip()

    @staticmethod
    def _spend_line(trip: dict[str, Any]) -> str:
        """账目单独一行：记账关着时说清楚为什么没有数字，而不是静默省略。"""
        if not trip:
            return ""
        if not trip.get("moneyOn"):
            return "记账没开：想看花费，在插件配置里打开 money_enabled，并按需填 budget。"
        spent = int(trip.get("spent") or 0)
        budget = int(trip.get("budget") or 0)
        if budget > 0:
            left = budget - spent
            tail = f"还剩 {left} 元" if left >= 0 else f"已经超了 {-left} 元"
            return f"这一趟花了 {spent} 元 / 预算 {budget} 元，{tail}"
        return f"这一趟花了 {spent} 元（没设预算上限）"

    # ---------------- /jy 简写与指令帮助 ----------------
    #: `/jy <子命令>` → 挂在这个类上的方法名。参数原样转给对应 /journey_* 命令。
    _JY_SUBS = {
        "diary": "journey_diary",
        "note": "journey_note",
        "stats": "journey_stats",
        "draw": "journey_draw",
        "depart": "journey_depart",
        "yes": "journey_yes",
        "no": "journey_no",
        "back": "journey_back",
        "photo": "journey_photo",
        "sync": "journey_sync",
        "debug": "journey_debug",
        "reset": "journey_reset",
        "update": "journey_update",
    }

    @filter.command("jy")
    async def jy(self, event: AstrMessageEvent):
        """简写指令：/jy 等同 /journey；/jy diary 7 等同 /journey_diary 7；/jy help 看全部指令。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        arg = self._command_arg(event)
        if not arg:
            event.set_extra("world_journey_arg_override", "")
            async for out in self.journey(event):
                yield out
            return
        head, _, rest = arg.partition(" ")
        head = head.strip().lower()
        if head in self._HELP_TOKENS:
            yield event.plain_result(self._render_help())
            return
        attr = self._JY_SUBS.get(head)
        if attr is None:
            yield event.plain_result(
                f"没有这个子命令：{head}。"
                "可以用 /jy diary、/jy note、/jy photo 等；完整列表发 /jy help。"
            )
            return
        handler = getattr(self, attr)
        # 子命令内部用 _command_arg 取参；把「<子命令>」剥掉后按覆盖值传入。
        event.set_extra("world_journey_arg_override", rest.strip())
        async for out in handler(event):
            yield out

    @staticmethod
    def _render_help() -> str:
        """/journey help 与 /jy help 的输出；和 README 的命令表保持一致。"""
        return "\n".join([
            "大肥鱼环游世界 · 可用指令：",
            "",
            "/journey（别名 /旅行 /她在哪 /今日计划 /行程；简写 /jy）",
            "　她此刻在哪、那边几点、今天剩下怎么过、今晚住哪、这一趟花了多少",
            "/journey help（或 /jy help）　本指令列表",
            "/journey_depart（别名 /让她出发；/jy depart）　手动让她出发 [管理员]",
            "/journey_yes（别名 /点头；/jy yes）　答应她正在等的那张卡片（出门/接邀约）[管理员]",
            "/journey_no（别名 /摇头；/jy no）　这次先不 [管理员]",
            "/journey_back（别名 /叫她回来；/jy back）　这一趟不等了，让她回家 [管理员]",
            "/journey_photo [题材]（别名 /旅行照片；/jy photo …）　现在拍一张，出图后自动发；题材如 晚饭/街景/星空/节日/特写",
            "/journey_diary [7|2026-11|2026-11-02]（/jy diary …）　读最近几天 / 某个月 / 某一天日记",
            "/journey_note [all|N]（别名 /旅行笔记；/jy note …）　读全部或最近 N 篇日记（默认 1）",
            "/journey_stats（别名 /旅行统计；/jy stats）　走了多少天、去过多少城、日记存在哪",
            "/journey_draw 成都 [理由]（/jy draw …）　记下想去的地方",
            "/journey_sync（/jy sync）　把她的钟拉回真实时间",
            "/journey_debug（/jy debug）　诊断：版本、sidecar、数据目录 [管理员]",
            "/journey_reset confirm（/jy reset confirm）　重置旅行数据 [管理员]",
            "/journey_update [latest|版本]（/jy update …）　从 npm 更新上游源码 [管理员，需在配置打开 allow_upstream_update；更新日志默认不输出，由 update_show_changelog 控制]",
            "",
            "[管理员] 的命令默认只限管理员（admin_only_controls 可关）；",
            "控制范围 access_scope=target 时，只有「主动消息发给谁」的会话能用以上指令。",
        ])

    @filter.command("journey_depart", alias={"让她出发"})
    async def journey_depart(self, event: AstrMessageEvent):
        """手动让她出发（需要控制权限）。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员；可以在插件配置里关掉 admin_only_controls。")
            return
        try:
            await self._ensure_ready()
            result = await self.bridge.depart()
        except Exception as exc:
            yield event.plain_result(f"没走成：{exc}")
            return
        yield event.plain_result(result.get("text") or result.get("reason") or "出发了。")

    @filter.command("journey_yes", alias={"点头"})
    async def journey_yes(self, event: AstrMessageEvent):
        """答应她正在等的那张卡片：出门或接邀约（需要控制权限）。"""
        async for out in self._answer_ask(event, True):
            yield out

    @filter.command("journey_no", alias={"摇头"})
    async def journey_no(self, event: AstrMessageEvent):
        """这次先不（需要控制权限）。"""
        async for out in self._answer_ask(event, False):
            yield out

    async def _answer_ask(self, event: AstrMessageEvent, ok: bool):
        """`journey_yes`/`journey_no` 的共同实现：面板那两个按钮在聊天里的替身。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员；可以在插件配置里关掉 admin_only_controls。")
            return
        block: str | None
        try:
            await self._ensure_ready()
            block = await self._require_raw("ask")
        except Exception as exc:
            yield event.plain_result(f"没答上：{exc}")
            return
        if block:
            yield event.plain_result(block)
            return
        try:
            result = await self.bridge.ask(ok)
        except Exception as exc:
            yield event.plain_result(f"没答上：{exc}")
            return
        yield event.plain_result(
            str(result.get("text") or result.get("reason")
                or ("他点了头。" if ok else "他答了「先不」。"))
        )

    @filter.command("journey_back", alias={"叫她回来"})
    async def journey_back(self, event: AstrMessageEvent):
        """不等了，让她结束这一趟回家（需要控制权限）。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员；可以在插件配置里关掉 admin_only_controls。")
            return
        block: str | None
        try:
            await self._ensure_ready()
            block = await self._require_raw("back")
        except Exception as exc:
            yield event.plain_result(f"没叫回来：{exc}")
            return
        if block:
            yield event.plain_result(block)
            return
        try:
            result = await self.bridge.return_home()
        except Exception as exc:
            yield event.plain_result(f"没叫回来：{exc}")
            return
        yield event.plain_result(str(result.get("text") or result.get("reason") or "叫她回来了。"))

    # 上游 0.8.5 的六档拍照题材（subject）。顺序即优先级：越具体越靠前 ——
    # 「菜单」含「菜」、必须先归 detail，不能被 food 抢走；「地面」的「面」同理。
    _PHOTO_SUBJECTS: tuple[tuple[str, str], ...] = (
        ("菜单", "detail"), ("车票", "detail"), ("钥匙", "detail"), ("茶碗", "detail"),
        ("茶盏", "detail"), ("特写", "detail"), ("细节", "detail"), ("近景", "detail"),
        ("星空", "sky"), ("天空", "sky"), ("星星", "sky"), ("月亮", "sky"), ("日出", "sky"),
        ("日落", "sky"), ("晚霞", "sky"), ("朝霞", "sky"), ("云海", "sky"), ("云层", "sky"),
        ("看云", "sky"), ("sky", "sky"),
        ("过年", "festival"), ("春节", "festival"), ("中秋", "festival"), ("端午", "festival"),
        ("清明", "festival"), ("圣诞", "festival"), ("元旦", "festival"), ("灯会", "festival"),
        ("节日", "festival"), ("季节", "festival"), ("秋天", "festival"), ("冬天", "festival"),
        ("春天", "festival"), ("夏天", "festival"), ("下雪", "festival"), ("雪景", "festival"),
        ("festival", "festival"),
        ("街景", "street"), ("这条街", "street"), ("街上", "street"), ("夜市", "street"),
        ("巷子", "street"), ("招牌", "street"), ("店铺", "street"), ("立面", "street"),
        ("street", "street"),
        ("地面", "ground"), ("脚下", "ground"), ("这片", "ground"), ("风景", "ground"),
        ("ground", "ground"),
        ("晚饭", "food"), ("早饭", "food"), ("午饭", "food"), ("夜宵", "food"),
        ("美食", "food"), ("小吃", "food"), ("吃的", "food"), ("这碗", "food"),
        ("菜", "food"), ("饭", "food"), ("面", "food"), ("餐", "food"), ("food", "food"),
    )

    @classmethod
    def _photo_subject(cls, arg: str) -> str | None:
        text = arg.strip().lower()
        if not text:
            return None
        for word, subject in cls._PHOTO_SUBJECTS:
            if word in text:
                return subject
        return ""  # 空串 = 没认出来；None 是没传参数，两者行为不同

    @filter.command("journey_photo", alias={"旅行照片"})
    async def journey_photo(self, event: AstrMessageEvent):
        """让她现在拍一张；可带题材（晚饭/街景/星空/节日/特写）。需要控制权限。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员；可以在插件配置里关掉 admin_only_controls。")
            return
        arg = self._command_arg(event).strip()
        tool_args: dict[str, str] | None = None
        if arg:
            subject = self._photo_subject(arg)
            if not subject:
                yield event.plain_result(
                    f"认不出「{arg}」是哪种题材。可以试：/journey_photo 晚饭（吃的）、"
                    "街景、星空 / 日出、节日 / 雪景、特写 / 车票，或不带参数拍脚下。"
                )
                return
            tool_args = {"subject": subject}
            # 拍照走后台任务，这里不为探测强起引擎：sidecar 没就绪时
            # _require_raw 自动退回版本表兜底。
            block = await self._require_raw("photo_subject")
            if block:
                yield event.plain_result(block)
                return
        if self._photo_task is not None and not self._photo_task.done():
            yield event.plain_result("上一张还在拍，等出图或超时后再试。")
            return
        self._note_umo(event)
        umo = str(getattr(event, "unified_msg_origin", "") or "").strip()
        self._photo_task = asyncio.create_task(self._photo_background(umo, tool_args))
        yield event.plain_result("开始拍了；出图后自动发过来，不用再发 /journey_photo。")

    async def _photo_background(self, umo: str, tool_args: dict[str, str] | None = None) -> None:
        try:
            await self._ensure_ready()
            if tool_args is None:
                result = await self.bridge.photo()
            else:
                # 带题材只能走 `journey_photo` 工具（面板那颗「补一张」按钮不分题材）。
                # 工具内部同样等出图完成才返回，所以后面的取图/发图和按钮路径一致。
                tool = await self.bridge.call_tool(
                    "journey_photo", tool_args, timeout=self.bridge.photo_timeout
                )
                if tool.get("isError"):
                    await self._send_plain(umo, f"没拍成：{tool.get('text') or '工具报错'}")
                    return
                snap = await self.bridge.status()
                photos = snap.get("photos") if isinstance(snap.get("photos"), list) else []
                first = photos[0] if photos and isinstance(photos[0], dict) else None
                result = {
                    "ok": True,
                    "text": str(tool.get("text") or "拍了一张。"),
                    "photo": first,
                }
            if not result.get("ok"):
                await self._send_plain(umo, f"没拍成：{result.get('reason') or '没拍成。'}")
                return
            text = str(result.get("text") or "拍了一张。")
            photo = result.get("photo") if isinstance(result.get("photo"), dict) else {}
            file = str(photo.get("file") or "")
            proactive = bool(self.cfg.get("proactive_enabled", False))
            event_target = str(self.cfg.get("event_target") or "").strip()
            # 主动消息开着且目标就是当前会话：让事件泵发，避免重复。
            if proactive and (not event_target or event_target == umo):
                return
            if not file:
                await self._send_plain(umo, text)
                return
            try:
                data = await self.bridge.media(file)
                await self.context.send_message(
                    umo, MessageChain([Plain(text), Image.fromBytes(data)])
                )
            except Exception as exc:
                await self._send_plain(umo, f"照片拿到了但发不出去：{exc}")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._send_plain(umo, f"没拍成：{exc}")
        finally:
            self._photo_task = None

    async def _send_plain(self, target: str, text: str) -> None:
        if not target:
            return
        with contextlib.suppress(Exception):
            await self.context.send_message(target, MessageChain([Plain(text)]))

    async def _cancel_photo_task(self) -> None:
        task = self._photo_task
        self._photo_task = None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    @filter.command("journey_diary", alias={"旅行日记"})
    async def journey_diary(self, event: AstrMessageEvent):
        """读日记：/journey_diary 7、/journey_diary 2026-11、/journey_diary 2026-11-02。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        try:
            await self._ensure_ready()
            arg = self._command_arg(event)
            args: dict[str, Any]
            if re.fullmatch(r"\d{4}-\d{2}", arg):
                args = {"month": arg}
            elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", arg):
                args = {"dateKey": arg}
            elif arg.isdigit():
                args = {"days": max(1, min(60, int(arg)))}
            else:
                args = {"days": 7}
            result = await self.bridge.call_tool("journey_diary_read", args)
        except Exception as exc:
            yield event.plain_result(f"日记读不出来：{exc}")
            return
        text = str(result.get("text") or "日记还是空的。")
        for chunk in self._split_text(text):
            yield event.plain_result(chunk)

    @filter.command("journey_note", alias={"旅行笔记"})
    async def journey_note(self, event: AstrMessageEvent):
        """读全部或最近 N 篇日记：/journey_note all、/journey_note 3；默认 1。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        try:
            await self._ensure_ready()
            snap = await self.bridge.status()
        except Exception as exc:
            # 引擎没起来也尽量把已经落盘的日记读出来。
            logger.warning("[world-journey] 读日记时引擎不可用：%s", exc)
            snap = {}
        arg = self._command_arg(event).strip().lower()
        if arg in {"", "1"}:
            limit: int | None = 1
        elif arg in {"all", "全部"}:
            limit = None
        elif arg.isdigit():
            limit = max(1, int(arg))
        else:
            yield event.plain_result("用法：/journey_note all 或 /journey_note N（默认 1）")
            return

        entries = read_diary_entries(self._diary_dirs(snap))
        total = len(entries)
        selected = entries if limit is None else entries[:limit]
        lines = [f"一共有 {total} 篇日记可读。"]
        if not selected:
            lines.append("还没有日记。")
        else:
            for entry in selected:
                body = plain_text(entry.body) or "（这篇没有正文）"
                lines.append(f"{entry.date_key} · {entry.city}\n{body}")
        self._note_umo(event)
        for chunk in self._split_text("\n\n".join(lines)):
            yield event.plain_result(chunk)

    @filter.command("journey_stats", alias={"旅行统计"})
    async def journey_stats(self, event: AstrMessageEvent):
        """走了多少天、去过多少城、日记存在哪。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        try:
            await self._ensure_ready()
            result = await self.bridge.call_tool("journey_stats", {})
        except Exception as exc:
            yield event.plain_result(f"统计读不出来：{exc}")
            return
        yield event.plain_result(str(result.get("text") or "没有统计。"))

    @filter.command("journey_draw", alias={"旅行想去"})
    async def journey_draw(self, event: AstrMessageEvent):
        """记下想去的地方：/journey_draw 成都 一首歌。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        arg = self._command_arg(event)
        if not arg:
            yield event.plain_result("用法：/journey_draw 成都 一首歌")
            return
        parts = arg.split(maxsplit=1)
        city = parts[0]
        why = parts[1] if len(parts) > 1 else ""
        try:
            await self._ensure_ready()
            result = await self.bridge.call_tool("journey_draw_to", {"city": city, "why": why})
        except Exception as exc:
            yield event.plain_result(f"没记下来：{exc}")
            return
        yield event.plain_result(str(result.get("text") or "记下了。"))

    @filter.command("journey_sync")
    async def journey_sync(self, event: AstrMessageEvent):
        """把她的钟拉回真实时间（需要控制权限）。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员；可以在插件配置里关掉 admin_only_controls。")
            return
        try:
            await self._ensure_ready()
            result = await self.bridge.sync()
        except Exception as exc:
            yield event.plain_result(f"同步失败：{exc}")
            return
        yield event.plain_result(result.get("text") or "同步好了。")

    @filter.command("journey_debug")
    async def journey_debug(self, event: AstrMessageEvent):
        """诊断：上游版本、管道、数据目录、最后 seq。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员。")
            return
        lines = [
            f"插件：{PLUGIN_NAME}",
            f"数据目录：{self.data_dir}",
            f"引擎目录：{self.engine_dir}",
            f"上游源码：{RAW_DIR}",
            f"配置：{self.data_dir / 'engine-config.json'}",
            f"sidecar：{self.bridge.base_url or '未启动'}",
            f"最后 seq：{self.state.get('last_seq', 0)}",
            f"最后会话：{self.state.get('last_umo') or '（无）'}",
            f"主动消息：{'开' if self.cfg.get('proactive_enabled') else '关'}",
            f"生图画风：{self.cfg.get('image_style') or '（留空=真实旅行照片）'}",
            f"提示词模板：{self._template_source()}",
            f"空镜套模板：{'开' if self.cfg.get('image_prompt_for_scene', True) else '关'}",
            f"汇报配图：{self.cfg.get('report_image_mode') or 'off'}",
        ]
        with contextlib.suppress(Exception):
            health = await self.bridge.health()
            lines.insert(1, f"上游版本：{health.get('upstreamVersion')}")
            lines.insert(2, f"sidecar 版本：{health.get('version')}")
        raw_version = read_pkg_version(RAW_DIR / "package.json")
        recorded = self._load_upstream_state()["newestVersion"]
        if raw_version:
            lines.append(f"上游源码：{raw_version}")
        if recorded and recorded != raw_version:
            lines.append(f"记录的最新上游：{recorded}")
        if self._upstream_hint:
            lines.append(f"提示：{self._upstream_hint}")
        if self.bridge.diagnostics:
            lines.append("sidecar 最近输出：")
            lines.append(self.bridge.diagnostics[-1500:])
        yield event.plain_result("\n".join(lines))

    @filter.command("journey_reset", alias={"重置旅行"})
    async def journey_reset(self, event: AstrMessageEvent):
        """重置旅行：/journey_reset confirm。清空行程、事件、照片、日记和旅行记忆。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._is_admin(event):
            yield event.plain_result("重置旅行只有管理员能执行。")
            return
        if not bool(self.cfg.get("allow_reset", True)):
            yield event.plain_result("配置里关闭了 allow_reset。")
            return
        arg = self._command_arg(event).strip().lower()
        if arg not in {"confirm", "yes", "确认", "确定"}:
            yield event.plain_result(
                "这会清空：当前位置/路线/事件、照片、日记、去过/想去/花销，以及同步盘里的旅行记忆。\n"
                "配置（home_city、倍速、API key、参考图）会保留。\n"
                "确定要重新开始，请发：/journey_reset confirm"
            )
            return
        yield event.plain_result("正在重置旅行数据；sidecar 会短暂停止。")
        try:
            await self._reset_journey()
        except Exception as exc:
            yield event.plain_result(f"重置失败：{exc}")
            return
        yield event.plain_result("已重置。她回到出发地，日记、照片和旅行记忆都清空了。")

    @filter.command("journey_update")
    async def journey_update(self, event: AstrMessageEvent):
        """从 npm 更新上游源码：/journey_update [latest|版本]（需要控制权限）。"""
        if not self._access_ok(event):
            self._deny_access(event)
            return
        if not self._can_control(event):
            yield event.plain_result("这个操作需要管理员。")
            return
        if not bool(self.cfg.get("allow_upstream_update", False)):
            yield event.plain_result(
                "配置里关闭了 allow_upstream_update（默认关闭）。"
                "确认信任 npm 上的上游包后，可在插件配置里打开它再试。"
            )
            return
        version = self._command_arg(event) or "latest"
        yield event.plain_result(
            f"正在从 npm 更新上游源码（{version}）；会短暂停掉 sidecar，完成后自动恢复。"
        )
        try:
            result = await self._update_upstream(version)
        except Exception as exc:
            yield event.plain_result(f"更新失败：{exc}")
            return
        if result.get("upToDate"):
            yield event.plain_result(f"已经是最新：{result.get('version')}，没有重启。")
            return
        show_changelog = bool(self.cfg.get("update_show_changelog", False))
        note = self._changelog_slice(
            str(result.get("oldVersion") or ""), str(result.get("version") or "")
        ) if show_changelog else ""
        head = (
            f"已更新到上游 {result.get('version')}（旧版 {result.get('oldVersion') or '无'}），"
            "工具已重新注册。"
        )
        if note:
            old_v = str(result.get("oldVersion") or "")
            span = f"{old_v} → {result.get('version')}" if old_v and old_v != "无" else str(result.get("version"))
            head += f"\n\n更新内容（{span}）：\n{note}"
        elif show_changelog:
            head += "\n（新版 raw/CHANGELOG.md 里没有这一段（未收录或读不到），全文见 raw/CHANGELOG.md。）"
        else:
            head += "\n（默认不附更新日志；想看在插件配置里打开 update_show_changelog。）"
        for chunk in self._split_text(head):
            yield event.plain_result(chunk)

    _CHANGELOG_MAX = 2500

    def _changelog_slice(self, old_version: str, new_version: str) -> str:
        """从上游 CHANGELOG.md 截取「旧版 → 新版」的更新段落；读不到或没收录就返回空串。

        CHANGELOG 从新到旧排列，每节以 `## <版本号>` 开头：取新版那一节起、到旧版那一节前。
        旧版没收录在日志里（跨度太长或首次记录）时保守只截新版一节，不瞎猜范围。
        """
        new_version = (new_version or "").lstrip("vV").strip()
        old_version = (old_version or "").lstrip("vV").strip()
        if not new_version:
            return ""
        try:
            text = (RAW_DIR / "CHANGELOG.md").read_text(encoding="utf-8-sig")
        except OSError:
            return ""
        hits = [
            (m.start(), m.group(1))
            for m in re.finditer(r"^##\s*\[?v?(\d+\.\d+\.\d+)[^\n]*$", text, re.M)
        ]
        new_idx = next((i for i, (_, ver) in enumerate(hits) if ver == new_version), None)
        if new_idx is None:
            return ""
        old_idx = next(
            (i for i in range(new_idx + 1, len(hits)) if hits[i][1] == old_version), None
        )
        if old_idx is not None:
            end = hits[old_idx][0]
        else:
            end = hits[new_idx + 1][0] if new_idx + 1 < len(hits) else len(text)
        chunk = text[hits[new_idx][0]:end].strip()
        if len(chunk) > self._CHANGELOG_MAX:
            chunk = chunk[: self._CHANGELOG_MAX].rstrip() + "\n…（中间省略；全文见 raw/CHANGELOG.md）"
        return chunk

    # ---------------- 上游更新 ----------------
    async def _update_upstream(self, version: str) -> dict[str, Any]:
        node = await self.bridge.node_executable()
        updater = str(UPDATER)
        if not Path(updater).exists():
            raise BridgeError(f"缺少更新器：{updater}；先跑 npm run build")
        args = [
            node,
            "--no-warnings",
            updater,
            "--target", str(RAW_DIR),
            "--version", version,
            "--package", str(self.cfg.get("upstream_package") or "coopani-world-journey"),
            "--registry", str(self.cfg.get("upstream_registry") or "https://registry.npmjs.org"),
            "--json",
        ]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if os.name == "nt" else 0
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=flags,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=180)
        except asyncio.TimeoutError:
            with contextlib.suppress(Exception):
                proc.kill()
            raise BridgeError("更新下载超时（180s）") from None
        stdout = (out or b"").decode("utf-8", "replace").strip()
        stderr = (err or b"").decode("utf-8", "replace").strip()
        if not stdout:
            raise BridgeError(f"更新器没有输出：{stderr[-500:]}")
        try:
            data = json.loads(stdout.splitlines()[-1])
        except json.JSONDecodeError:
            raise BridgeError(f"更新器输出看不懂：{stdout[-500:]}")
        if proc.returncode != 0 or not data.get("ok"):
            raise BridgeError(str(data.get("error") or stderr[-500:] or "更新器失败"))
        if data.get("upToDate"):
            return data
        old_version = data.get("oldVersion") or "none"
        stage = Path(str(data.get("stage") or ""))
        if not stage.exists():
            raise BridgeError(f"更新器没有留下 staging：{stage}")
        workdir = stage.parent
        backup = self.plugin_dir / f".raw.bak-{old_version}"

        # 先停泵/停 sidecar，再换源码；失败则回滚并恢复旧引擎。
        await self._cancel_photo_task()
        if self.pump is not None:
            await self.pump.stop()
            self.pump = None
        await self.bridge.stop()
        self._unregister_tools()
        if backup.exists():
            _force_rmtree(backup)
        try:
            if RAW_DIR.exists():
                RAW_DIR.rename(backup)
            stage.rename(RAW_DIR)
        except Exception:
            if backup.exists() and not RAW_DIR.exists():
                backup.rename(RAW_DIR)
            raise
        try:
            await self.bridge.start()
            await self._register_tools()
            self._start_pump()
            # 记下这次真正装上的上游版本，供以后判断「插件重装有没有把 raw 换回旧版」。
            self._check_upstream_versions()
        except Exception as exc:
            with contextlib.suppress(Exception):
                await self.bridge.stop()
            _force_rmtree(RAW_DIR)
            if backup.exists():
                backup.rename(RAW_DIR)
            try:
                await self.bridge.start()
                await self._register_tools()
                self._start_pump()
            except Exception as restore_exc:
                raise BridgeError(
                    f"新上游启动失败（{exc}），回滚后仍失败：{restore_exc}"
                ) from exc
            raise BridgeError(f"新上游启动失败，已回滚：{exc}") from exc
        with contextlib.suppress(Exception):
            _force_rmtree(backup)
        with contextlib.suppress(Exception):
            _force_rmtree(workdir)
        return data

    # ---------------- 重置旅行 ----------------
    async def _reset_journey(self) -> None:
        memory_dir = self._effective_memory_dir()
        await self._stop_diary_task()
        await self._cancel_photo_task()
        if self.pump is not None:
            await self.pump.stop()
            self.pump = None
        self._unregister_tools()
        await self.bridge.stop()

        if self.engine_dir.exists():
            _force_rmtree(self.engine_dir)
        self.engine_dir.mkdir(parents=True, exist_ok=True)
        if memory_dir is not None:
            clear_memory_dir(memory_dir, self.engine_dir)

        # 保留 last_umo（主动消息还发同一个会话），只重置事件游标。
        self.state["last_seq"] = 0
        self.state["event_log_id"] = ""
        self.state.pop("diary_written_date", None)
        self._diary_next_attempt = 0.0
        self._recent_reports = []
        self._report_target = ""
        self._save_state()

        # 旧 bridge 的 EventLog/MediaStore 缓存了旧目录内容，必须换新实例。
        self.bridge = SidecarBridge(data_dir=self.data_dir, config=self.cfg, log=logger)
        await self.bridge.start()
        await self._register_tools()
        self._start_pump()
        self._start_diary_task()

    def _effective_memory_dir(self) -> Path | None:
        raw = ""
        try:
            payload = json.loads((self.data_dir / "engine-config.json").read_text(encoding="utf-8"))
            raw = str((payload.get("engine") or {}).get("memoryDir") or "")
        except Exception:
            raw = str(self.cfg.get("memory_dir") or "")
        if not raw.strip():
            return None
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = (self.plugin_dir / path).resolve()
        return path

    # ---------------- 工具 ----------------
    def _access_scope(self) -> str:
        return "target" if str(self.cfg.get("access_scope") or "all").lower() == "target" else "all"

    def _access_ok(self, event: AstrMessageEvent) -> bool:
        return access_allowed(
            self.cfg.get("access_scope"),
            self.cfg.get("event_target"),
            getattr(event, "unified_msg_origin", ""),
        )

    @staticmethod
    def _deny_access(event: AstrMessageEvent) -> None:
        # 非目标会话连通用 LLM 回复都不给，避免“插件没响应但模型接话”。
        with contextlib.suppress(Exception):
            event.stop_event()

    def _is_admin(self, event: AstrMessageEvent) -> bool:
        try:
            return bool(event.is_admin())
        except Exception:
            return False

    @staticmethod
    def _drop_journey_tools(req: ProviderRequest) -> None:
        """非目标会话连工具 schema 都不给，避免模型看到再尝试。"""
        toolset = getattr(req, "func_tool", None)
        tools = getattr(toolset, "tools", None)
        if isinstance(tools, list):
            kept = [t for t in tools if not str(getattr(t, "name", "")).startswith("journey_")]
            if len(kept) != len(tools):
                toolset.tools = kept

    def _can_control(self, event: AstrMessageEvent) -> bool:
        if not bool(self.cfg.get("admin_only_controls", True)):
            return True
        try:
            return bool(event.is_admin())
        except Exception:
            return False

    def _command_arg(self, event: AstrMessageEvent) -> str:
        override = event.get_extra("world_journey_arg_override")
        if isinstance(override, str):
            return override.strip()
        text = str(getattr(event, "message_str", "") or "").strip()
        parts = text.split(maxsplit=1)
        return parts[1].strip() if len(parts) > 1 else ""

    def _note_umo(self, event: AstrMessageEvent) -> None:
        umo = str(getattr(event, "unified_msg_origin", "") or "").strip()
        if umo and umo != self.state.get("last_umo"):
            self.state["last_umo"] = umo
            self._save_state()

    # ---------------- 状态 ----------------
    def _write_engine_config(self) -> None:
        path = self.data_dir / "engine-config.json"
        try:
            write_engine_config(path, self.cfg, log=logger)
        except Exception as exc:
            # extra_config 是最可能写坏的；退一步用其余字段，不要整个插件起不来。
            logger.warning("[world-journey] 配置解析失败，忽略 extra_config 重试：%s", exc)
            fallback = dict(self.cfg)
            fallback["extra_config"] = ""
            write_engine_config(path, fallback)

    # ---------------- 上游版本记录 ----------------
    def _upstream_state_path(self) -> Path:
        return self.data_dir / "upstream-state.json"

    def _load_upstream_state(self) -> dict[str, str]:
        try:
            raw = json.loads(self._upstream_state_path().read_text(encoding="utf-8-sig"))
        except Exception:
            return {"rawVersion": "", "newestVersion": "", "updatedAt": ""}
        if not isinstance(raw, dict):
            return {"rawVersion": "", "newestVersion": "", "updatedAt": ""}
        return {key: str(raw.get(key) or "") for key in ("rawVersion", "newestVersion", "updatedAt")}

    def _save_upstream_state(self, raw_version: str, newest: str) -> None:
        payload = {
            "rawVersion": raw_version,
            "newestVersion": newest,
            "updatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        }
        try:
            path = self._upstream_state_path()
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(tmp, path)
        except Exception as exc:
            logger.warning("[world-journey] 上游版本记录写不进去：%s", exc)

    def _check_upstream_versions(self) -> str:
        """对比 raw 实际版本与历史记录；插件重装把 raw 换回旧版时给出可操作的提示。

        raw/ 属于发布包，插件升级会整目录替换，于是跑过 /journey_update 的成果会被覆盖：
        这里把「见过的最新上游版本」记在 plugin_data（不受插件目录替换影响），下次启动就能发现降级。
        """
        raw_version = read_pkg_version(RAW_DIR / "package.json")
        if not raw_version:
            return ""
        state = self._load_upstream_state()
        recorded = state["newestVersion"]
        newest = newest_version(raw_version, recorded)
        hint = downgrade_hint(raw_version, recorded)
        if hint:
            logger.warning("[world-journey] %s", hint)
        if raw_version != state["rawVersion"] or newest != recorded or not state["updatedAt"]:
            self._save_upstream_state(raw_version, newest)
        self._upstream_hint = hint
        return hint

    # ---------------- 指令命中时的上游版本闸 ----------------
    _UPSTREAM_LATEST_TTL = 6 * 3600.0

    def _raw_version(self) -> str:
        return read_pkg_version(RAW_DIR / "package.json")

    async def _npm_latest_version(self) -> str:
        """「npm 上最新上游版本」：读 plugin_data 缓存，过期才联网（5 秒超时）。

        查询失败不报错——沿用旧缓存值；这条路径只在「功能缺失」时走，
        给用户一句「npm 已有 x.y.z」的可操作提示，仅此而已。
        用 aiohttp 异步请求（同 bridge.py）——审核指出的阻塞点：这里曾被
        同步 urllib 调用卡住 AstrBot 事件循环最长 5 秒，绝不允许。
        """
        cache = self.data_dir / "upstream-latest.json"
        version = ""
        checked = 0.0
        try:
            data = json.loads(cache.read_text(encoding="utf-8-sig"))
            version = str(data.get("version") or "")
            checked = float(data.get("checkedAt") or 0)
        except Exception:
            pass
        if version and time.time() - checked < self._UPSTREAM_LATEST_TTL:
            return version
        package = str(self.cfg.get("upstream_package") or "coopani-world-journey")
        registry = str(self.cfg.get("upstream_registry") or "https://registry.npmjs.org").rstrip("/")
        url = f"{registry}/{urllib.parse.quote(package, safe='')}"
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
                async with session.get(url, headers={"Accept": "application/json"}) as response:
                    meta = await response.json(content_type=None)
            latest = str((meta.get("dist-tags") or {}).get("latest") or "")
        except Exception as exc:
            logger.debug("[world-journey] 查询 npm 最新版本失败：%s", exc)
            return version
        if latest:
            version = latest
            with contextlib.suppress(Exception):
                cache.write_text(
                    json.dumps({"version": latest, "checkedAt": time.time()}, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
        return version

    async def _require_raw(self, feature: str) -> str | None:
        """上游真有这功能返回 None；否则返回可直接回复用户的指引文案。

        判定优先用 sidecar 的**能力实测**（health.capabilities，由真加载进来的 raw
        算出）——上游更新后自动跟上，不依赖手工表的版本记对没有；sidecar 没起来、
        或旧引擎根本不报 capabilities 时，退回「raw 版本号 vs 表里最低版本」兜底。
        """
        name, min_ver = _FEATURE_MIN_RAW[feature]
        cap = _FEATURE_CAP_KEY[feature]
        supported: bool | None = None
        if self.bridge is not None:
            try:
                caps = (await self.bridge.health()).get("capabilities")
                if isinstance(caps, dict) and cap in caps:
                    supported = bool(caps[cap])
            except Exception:
                supported = None
        current = self._raw_version()
        if supported is True:
            return None
        if supported is None and current and version_key(current) >= version_key(min_ver):
            return None
        if supported is False:
            head = f"「{name}」用不了：当前上游源码（{current or '版本未知'}）没有暴露这个功能。"
        else:
            head = f"「{name}」用不了：需要上游源码 ≥{min_ver}，当前是 {current or '读不到（raw/ 不见了）'}。"
        parts = [head]
        latest = await self._npm_latest_version()
        if latest and version_key(latest) >= version_key(min_ver):
            parts.append(f"npm 上已有 {latest}。")
        if bool(self.cfg.get("allow_upstream_update")):
            parts.append("管理员发 /journey_update 升级上游即可。")
        else:
            parts.append(
                "管理员先在插件配置里打开「允许从 npm 更新上游源码」再发 /journey_update；"
                "或把插件升级到随包带新上游的版本。"
            )
        return "".join(parts)

    def _state_path(self) -> Path:
        return self.data_dir / "plugin_state.json"
    def _load_state(self) -> dict[str, Any]:
        path = self._state_path()
        try:
            if path.exists():
                raw = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    return {
                        "last_seq": int(raw.get("last_seq", 0) or 0),
                        "last_umo": str(raw.get("last_umo") or ""),
                        "event_log_id": str(raw.get("event_log_id") or ""),
                    }
        except Exception:
            pass
        return {"last_seq": 0, "last_umo": "", "event_log_id": ""}

    def _save_state(self) -> None:
        try:
            path = self._state_path()
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(tmp, path)
        except Exception:
            pass


def _force_rmtree(path: Path) -> None:
    """删除可能带只读属性的目录（Windows 更新/回滚用）。"""
    def on_error(func, target, _exc):
        with contextlib.suppress(Exception):
            os.chmod(target, 0o666)
            func(target)

    shutil.rmtree(path, onerror=on_error)
