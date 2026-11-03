"""读取她写过的日记（只读）。

上游把日记存成月文件（`2026-11.md`）和旧的日文件；这里只负责把它们读成
「日期 → 条目」，按日期从新到旧排好。写日记仍然走上游的
`journey_diary_write` 工具，不在这一层做任何迁移/写入。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# 与上游 diary.ts 的格式保持一致：`---` + 含 date 的 frontmatter + `---`。
ENTRY_RE = re.compile(r"^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)", re.M)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# 月文件、旧日文件、同步盘冲突副本（`2026-11-电脑名.md`）。
DIARY_FILE_RE = re.compile(r"^\d{4}-\d{2}(?:-\d{2})?(?:[-_ ].*)?\.md$")
CLOCK_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::\d{2})?$")


@dataclass(frozen=True)
class DiaryEntry:
    """一篇日记。`mtime` 只用来解决同一天出现在多份文件里的冲突。"""

    date_key: str
    city: str
    body: str
    mtime: float


def _frontmatter(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in raw.splitlines():
        index = line.find(":")
        if index > 0:
            out[line[:index].strip()] = line[index + 1:].strip()
    return out


def parse_entries(text: str, mtime: float) -> list[DiaryEntry]:
    """从一个文件里解析出全部条目；正文里的 `---` 靠 date 校验排除。"""
    hits: list[tuple[int, int, dict[str, str]]] = []
    pos = 0
    while True:
        match = ENTRY_RE.search(text, pos)
        if match is None:
            break
        meta = _frontmatter(match.group(1))
        if not DATE_RE.match(meta.get("date", "")):
            # 形状像元信息但没有 date：从下一行继续找，别吞掉后面的真条目。
            pos = match.start() + 1
            continue
        hits.append((match.start(), match.end(), meta))
        pos = match.end()

    out: list[DiaryEntry] = []
    for index, (_, end, meta) in enumerate(hits):
        stop = hits[index + 1][0] if index + 1 < len(hits) else len(text)
        out.append(DiaryEntry(
            date_key=meta.get("date", ""),
            city=meta.get("city") or "不知道在哪",
            body=text[end:stop].strip(),
            mtime=mtime,
        ))
    return out


def read_diary_entries(directories: list[Path]) -> list[DiaryEntry]:
    """读多个目录（同步盘 + 本机兜底），同一天取文件更新的那份。

    与上游的读取规则一致：目录里的月文件、旧日文件、冲突副本都读；
    顶层目录之外（例如 `_bak/` 备份）不读。
    """
    best: dict[str, DiaryEntry] = {}
    for directory in directories:
        try:
            if not directory.is_dir():
                continue
            paths = list(directory.iterdir())
        except OSError:
            continue
        for path in paths:
            try:
                if not path.is_file() or not DIARY_FILE_RE.match(path.name):
                    continue
                mtime = path.stat().st_mtime
                text = path.read_text(encoding="utf-8-sig")
            except (OSError, UnicodeError):
                continue
            for entry in parse_entries(text, mtime):
                current = best.get(entry.date_key)
                if current is None or entry.mtime > current.mtime:
                    best[entry.date_key] = entry
    return sorted(best.values(), key=lambda entry: entry.date_key, reverse=True)


def plain_text(text: str) -> str:
    """把可能带 Markdown 的正文压成纯文本，命令行输出不出现 MD 记号。"""
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"^\s*>\s?", "", text, flags=re.M)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.M)
    text = re.sub(r"^\s*---+\s*$", "", text, flags=re.M)
    text = text.replace("**", "").replace("__", "").replace("~~", "").replace("`", "")
    text = re.sub(r"(?<!\*)\*(?!\*)", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_write_time(value: str) -> tuple[int, int] | None:
    """`23:00` → (23, 0)；空串或格式不对返回 None（= 关闭自动写）。"""
    match = CLOCK_RE.match((value or "").strip())
    if match is None:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def clock_minutes(clock: str) -> int | None:
    """`HH:MM` → 从 0 点起的分钟数；格式不对返回 None。"""
    match = CLOCK_RE.match((clock or "").strip())
    if match is None:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour * 60 + minute
