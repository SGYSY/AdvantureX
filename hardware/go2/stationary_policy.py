SAFE_SPORT_COMMANDS = {
    "Hello": 1016,
    "Sit": 1009,
}


def require_safe_gesture(name: str) -> int:
    try:
        return SAFE_SPORT_COMMANDS[name]
    except KeyError as exc:
        raise ValueError(f"Gesture '{name}' is unsafe in stationary mode") from exc


def require_safe_opener(text: str) -> str:
    value = text.strip()
    if not value or len(value) > 80:
        raise ValueError("Opener must contain 1-80 characters")
    return value
