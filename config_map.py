"""AstrBot 插件配置 → 引擎配置。

上游新增字段时，优先走 `extra_config`（一段 JSON 文本）覆盖；不需要改这里。
注意 `extra_config` 会原样覆盖引擎字段，属于「用户显式填什么就生效什么」的兜底口，
所以只记键名不记值（值里可能有 URL/密钥），文档里也提示了谨慎使用。
secrets（高德/生图 key）只写文件，不打印。
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

FIELD_MAP: dict[str, str] = {
    "home_city": "homeCity",
    "speed": "speed",
    "beat_gap": "beatGap",
    "rest_days": "restDays",
    "ask_before_depart": "askBeforeDepart",
    "max_trip_months": "maxTripMonths",
    "with_user": "withUser",
    "money_enabled": "moneyEnabled",
    "budget": "budget",
    "memory_dir": "memoryDir",
    "amap_key": "amapKey",
    "image_api": "imageApi",
    "image_style": "imageStyle",
    "image_key": "imageKey",
    # 生图提示词模板：新字段（出镜自拍 / 空镜各一套）+ 是否让模板也接管空镜。
    # 「新字段留空时回退旧 selfie_prompt」只在 adapter/bridge.ts 一处实现，这里不重复。
    "image_prompt_template": "imagePromptTemplate",
    "image_prompt_scene_template": "imagePromptSceneTemplate",
    "image_prompt_for_scene": "imagePromptForScene",
    # image_model 是列表，单靠 FIELD_MAP 传不过去；在下面统一拆成 imageModels/imageModel。
    "selfie_enabled": "selfieEnabled",
    "selfie_reference": "selfieReference",
    "selfie_reference_path": "selfieReferencePath",
    "selfie_subject": "selfieSubject",
    "selfie_prompt": "selfiePrompt",
    "selfie_api": "selfieApi",
    "selfie_key": "selfieKey",
    "selfie_model": "selfieModel",
    "selfie_mode": "selfieMode",
    "selfie_native_url": "selfieNativeUrl",
    "selfie_image_field": "selfieImageField",
    "selfie_size": "selfieSize",
}

PLUGIN_DIR = Path(__file__).resolve().parent


def build_engine_config(
    config: dict[str, Any],
    base_dir: Path | None = None,
    log: Any = None,
) -> dict[str, Any]:
    """返回写入 `engine-config.json` 的完整对象。`log` 只用来提示 extra_config 覆盖了哪些键。"""
    engine: dict[str, Any] = {}
    for plugin_key, engine_key in FIELD_MAP.items():
        if plugin_key in config and config[plugin_key] is not None:
            engine[engine_key] = config[plugin_key]

    extra = config.get("extra_config") or ""
    if isinstance(extra, dict):
        extra_obj: Any = extra
    else:
        text = str(extra).strip()
        extra_obj = {}
        if text:
            try:
                extra_obj = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"extra_config 不是合法 JSON（{exc.msg}，位置 {exc.pos}）；"
                    '只能填 JSON 对象，例如 {"someNewField": 123}'
                ) from exc
    if extra_obj:
        if not isinstance(extra_obj, dict):
            raise ValueError("extra_config 必须是 JSON 对象")
        # 只记键名：值里可能是 URL 或密钥，不写日志。
        if callable(getattr(log, "warning", None)):
            log.warning(
                "[world-journey] extra_config 覆盖了引擎字段：%s；请确认这些字段的含义",
                "、".join(sorted(str(key) for key in extra_obj)),
            )
        engine.update(extra_obj)

    # AstrBot 的 file 类型给的是插件根相对路径（files/<字段>/<文件>）；
    # sidecar 在插件根下运行，但显式转绝对路径更稳。
    if "selfieReference" in engine or "selfieReferencePath" in engine:
        refs = engine.get("selfieReference")
        items = refs if isinstance(refs, list) else [refs] if isinstance(refs, str) else []
        manual = engine.pop("selfieReferencePath", "")
        if isinstance(manual, str) and manual.strip():
            items.append(manual.strip())
        engine["selfieReference"] = _resolve_references(items, base_dir or PLUGIN_DIR)

    # 上游的拍照门槛看 imageApi；只配了 selfieApi 时也让它过闸。
    if not str(engine.get("imageApi") or "").strip() and str(engine.get("selfieApi") or "").strip():
        engine["imageApi"] = engine["selfieApi"]
    if not str(engine.get("imageKey") or "").strip() and str(engine.get("selfieKey") or "").strip():
        engine["imageKey"] = engine["selfieKey"]
    # 生图模型名是**列表**（按顺序降级）。上游 raw 只认一个字符串，所以拆成两份：
    # - imageModels：给套壳的 fetch 代理按顺序重试；
    # - imageModel：只放第一个，作为上游请求的起点。
    # extra_config 里显式写了 imageModel/imageModels 时优先（保持原来的覆盖语义）。
    image_models = _model_list(engine.get("imageModels"))
    if not image_models:
        image_models = _model_list(engine.get("imageModel"))
    if not image_models:
        image_models = _model_list(config.get("image_model"))
    if not image_models:
        image_models = _model_list(engine.get("selfieModel"))
    engine["imageModels"] = image_models
    engine["imageModel"] = image_models[0] if image_models else ""

    return {
        "engine": engine,
        "wrapper": {"offline": bool(config.get("offline", False))},
    }


def write_engine_config(path: Path, config: dict[str, Any], log: Any = None) -> None:
    """原子写；sidecar 自己按 mtime 热重载。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    # AstrBot 的 file 类型把上传文件放在插件数据目录（与 engine-config.json 同级）；
    # 所以这里用 path.parent 作为相对路径基准。
    payload = build_engine_config(config, path.parent, log)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _resolve_references(value: Any, base_dir: Path) -> list[str]:
    items = value if isinstance(value, list) else [value] if isinstance(value, str) else []
    out: list[str] = []
    for item in items:
        if not isinstance(item, str) or not item.strip():
            continue
        text = item.strip()
        if text.startswith(("http://", "https://", "data:")) or Path(text).is_absolute():
            out.append(text)
        else:
            out.append(str((base_dir / text).resolve()))
    return out


def _model_list(value: Any) -> list[str]:
    """模型名统一成数组：兼容老配置的单个字符串，去空白、丢空项、去重、保持顺序。"""
    if isinstance(value, str):
        # 从文档里整段粘过来的，换行/逗号/分号分隔都认。
        text = value.replace("，", ",").replace("；", ";").replace(";", ",")
        raw: list[Any] = [line for chunk in text.split(",") for line in chunk.splitlines()]
    elif isinstance(value, list):
        raw = value
    else:
        raw = []
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        model = item.strip()
        if model and model not in out:
            out.append(model)
    return out
