"""插件侧默认值（与 adapter/selfie.ts 的 DEFAULT_PROMPT / DEFAULT_SCENE_PROMPT 保持同步）。

两个模板分工，别混成一个：

- ``DEFAULT_IMAGE_PROMPT``：出镜的自拍模板。用于「生图必须含自拍」打开时的所有出图
  （相册照片、``/journey_photo``、主动汇报配图）。
- ``DEFAULT_SCENE_PROMPT``：空镜模板。自拍关着时用，末尾守住「画面里没有人物」。

画风一律走 ``{style}``（= 配置里的「画面风格」），模板里**不再写死**照片质感 ——
以前写着「真实手机自拍质感」，用户填了「动漫画风」也只能在背景里冒半句，出图照样真人。
"""
from __future__ import annotations

DEFAULT_IMAGE_PROMPT = (
    "一张自拍照片：{subject}在画面里，手机前置镜头近距离自拍，脸和上半身清晰，眼睛看着镜头，表情自然。\n"
    "画风：{style}\n"
    "时间：{time}（{clock}）。\n"
    "背景：{scene}\n"
    "参考图是{subject}的长相参考：保持五官、脸型、发型、肤色、年龄和气质一致；"
    "不要换脸，不要变成陌生人，不要照搬参考图的背景和衣服；按上面的画风绘制，不要自行改成真人照片。\n"
    "画面里只有{subject}一个人，没有文字、水印、边框。"
)

DEFAULT_SCENE_PROMPT = (
    "画风：{style}\n"
    "{scene}\n"
    "时间：{time}（{clock}）。\n"
    "画面里没有人物，没有文字，没有水印，没有边框。"
)

# 旧名字：老代码和历史测试还在用，指向同一份自拍模板。
DEFAULT_SELFIE_PROMPT = DEFAULT_IMAGE_PROMPT

# 升级前的旧默认模板。识别「用户其实没改过」时要用它，才能安全地把配置迁到新字段。
LEGACY_SELFIE_PROMPT = (
    "一张自拍照片：{subject}在画面里，手机前置镜头近距离自拍，脸和上半身清晰，眼睛看着镜头，表情自然。\n"
    "时间：{time}（{clock}）。\n"
    "背景：{scene}\n"
    "参考图是{subject}的长相参考：保持五官、脸型、发型、肤色、年龄和气质一致；"
    "不要换脸，不要变成陌生人，不要照搬参考图的背景和衣服。\n"
    "真实手机自拍质感，自然光，轻微手持感；画面里只有{subject}一个人，没有文字、水印、边框。"
)
