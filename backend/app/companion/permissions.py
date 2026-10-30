import re
from enum import StrEnum


class ToolPermission(StrEnum):
    READ = "READ"
    WRITE_CONFIRMATION_REQUIRED = "WRITE_CONFIRMATION_REQUIRED"


def may_propose_write(message: str) -> bool:
    """Only a proposal gate. This never grants permission to execute a mutation."""
    if re.match(r"\s*(yes|ok|okay|confirm|sure)[.!\s]*$", message, re.I):
        return False
    if re.match(r"\s*(what|which|how|why|will|show|explain|tell)\b", message, re.I):
        return False
    return bool(re.search(r"\b(move|replace|change|switch|select|save|add|record|regenerate|adapt|create)\b", message, re.I))


def unsupported_transaction(message: str) -> bool:
    return bool(re.search(r"\b(book|reserve|purchase|buy|pay)\b|cancel (?:my |the )?booking", message, re.I))
