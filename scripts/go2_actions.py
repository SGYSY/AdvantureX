#!/usr/bin/env python3
"""Shared Go2 sport-action catalog (Chinese labels) for the CLI + web console.

Single source of truth for the actions exposed by ``trigger_dance.py`` and the
``go2_web`` control panel. Action IDs are pulled from DimOS'
``UNITREE_WEBRTC_CONTROLS`` so they stay in sync with the robot skill container;
here we only add Chinese labels, grouping and a danger flag for the UI.
"""

from __future__ import annotations

from dimos.robot.unitree.unitree_skill_container import UNITREE_WEBRTC_CONTROLS

# name -> (中文标签, 分类, 是否危险动作)
# 分类: posture=姿态 / fun=趣味 / dance=舞蹈 / gait=步态 / stunt=特技(高风险)
_META: dict[str, tuple[str, str, bool]] = {
    "BalanceStand": ("平衡站立", "posture", False),
    "StandUp": ("站起", "posture", False),
    "StandDown": ("趴下", "posture", False),
    "RecoveryStand": ("恢复站立", "posture", False),
    "Sit": ("坐下", "posture", False),
    "RiseSit": ("起身", "posture", False),
    "Pose": ("摆姿势", "posture", False),
    "Hello": ("打招呼", "fun", False),
    "Stretch": ("伸懒腰", "fun", False),
    "Content": ("卖萌", "fun", False),
    "Wallow": ("打滚", "fun", False),
    "Scrape": ("刨地", "fun", False),
    "WiggleHips": ("扭屁股", "fun", False),
    "FingerHeart": ("比心", "fun", False),
    "Dance1": ("跳舞 1", "dance", False),
    "Dance2": ("跳舞 2", "dance", False),
    "MoonWalk": ("太空步", "gait", False),
    "CrossStep": ("交叉步", "gait", False),
    "OnesidedStep": ("单侧步", "gait", False),
    "Bound": ("弹跳步", "gait", False),
    "Handstand": ("倒立", "stunt", True),
    "FrontFlip": ("前空翻", "stunt", True),
    "FrontJump": ("前跳", "stunt", True),
    "FrontPounce": ("前扑", "stunt", True),
    "LeftFlip": ("左翻", "stunt", True),
    "RightFlip": ("右翻", "stunt", True),
    "Backflip": ("后空翻", "stunt", True),
}

CATEGORY_LABELS: dict[str, str] = {
    "posture": "姿态",
    "fun": "趣味 / 打招呼",
    "dance": "舞蹈",
    "gait": "步态",
    "stunt": "特技（高风险）",
}

# Display order for categories in the UI.
CATEGORY_ORDER = ["fun", "dance", "gait", "posture", "stunt"]

# name -> (id, english description) straight from DimOS.
_DIMOS = {name: (id_, desc) for name, id_, desc in UNITREE_WEBRTC_CONTROLS}


def action_catalog() -> list[dict[str, object]]:
    """Return the ordered list of playable actions with Chinese metadata."""
    catalog: list[dict[str, object]] = []
    for name, (cn, category, danger) in _META.items():
        if name not in _DIMOS:  # defensive: skip if DimOS dropped the command
            continue
        api_id, desc = _DIMOS[name]
        catalog.append(
            {
                "name": name,
                "id": api_id,
                "label": cn,
                "category": category,
                "category_label": CATEGORY_LABELS[category],
                "danger": danger,
                "desc": desc,
            }
        )
    # Sort by category order, then keep insertion order within a category.
    order = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    catalog.sort(key=lambda a: order.get(a["category"], 99))  # type: ignore[arg-type]
    return catalog


def resolve_action(token: str) -> tuple[str, int] | None:
    """Resolve a user token (action name or numeric api id) to ``(name, id)``.

    Name matching is case-insensitive. Returns ``None`` if unknown.
    """
    token = token.strip()
    if not token:
        return None

    # Numeric api id.
    if token.isdigit():
        wanted = int(token)
        for name, (api_id, _desc) in _DIMOS.items():
            if api_id == wanted and name in _META:
                return (name, api_id)
        return None

    # Action name (case-insensitive).
    lowered = token.lower()
    for name, (api_id, _desc) in _DIMOS.items():
        if name.lower() == lowered and name in _META:
            return (name, api_id)
    return None


def format_catalog() -> str:
    """Human-readable catalog for CLI ``--list`` output."""
    lines: list[str] = []
    current: str | None = None
    for a in action_catalog():
        if a["category"] != current:
            current = str(a["category"])
            lines.append(f"\n[{a['category_label']}]")
        flag = "  ⚠危险" if a["danger"] else ""
        lines.append(f"  {a['id']:>4}  {a['name']:<12} {a['label']}{flag}")
    return "\n".join(lines)


if __name__ == "__main__":
    print("Go2 可用动作：")
    print(format_catalog())
