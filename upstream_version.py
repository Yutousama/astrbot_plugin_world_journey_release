"""上游版本比较。

刻意只用标准库：这里要能脱离 AstrBot 单独跑（`main.py` 依赖 astrbot API）。
raw/ 属于发布包，插件升级会整目录替换，于是「跑过 /journey_update 的成果」会被
发布包里的基线覆盖；这个模块负责判断有没有发生降级，以及要不要提示用户。
"""
from __future__ import annotations

import json
import re
from pathlib import Path


def read_pkg_version(path: Path) -> str:
    """读 `package.json` 的 version；读不出来返回空串。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return ""
    version = data.get("version") if isinstance(data, dict) else None
    return version if isinstance(version, str) else ""


def version_key(text: str) -> tuple[int, ...]:
    """把 0.5.26 变成可比较的元组；解析不出就当 0。"""
    nums = re.findall(r"\d+", text or "")
    return tuple(int(n) for n in nums[:3]) if nums else (0,)


def newest_version(current: str, recorded: str) -> str:
    """取「历史见过的最新版本」：两边都空返回空串。"""
    if not current:
        return recorded
    if not recorded:
        return current
    return current if version_key(current) >= version_key(recorded) else recorded


def downgrade_hint(raw_version: str, recorded: str) -> str:
    """raw 比历史记录旧时返回一句可操作的提示；没降级返回空串。"""
    if not raw_version or not recorded:
        return ""
    if version_key(raw_version) >= version_key(recorded):
        return ""
    return (
        f"上游源码被重置回 {raw_version}（之前到过 {recorded}）。"
        "插件安装/升级会带上发布包里的 raw 基线；要恢复到新版：确认信任来源后打开 "
        "allow_upstream_update，再执行 /journey_update。"
    )
