"""Cấu hình đọc từ biến môi trường / file .env."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _path(env_value: str) -> Path:
    p = Path(env_value)
    return p if p.is_absolute() else (BASE_DIR / p).resolve()


class Settings:
    def __init__(self) -> None:
        # LLM — Groq
        self.groq_api_key: str = os.getenv("GROQ_API_KEY", "").strip()
        self.groq_model: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
        self.ai_enabled: bool = os.getenv("AGORA_AI_ENABLED", "1").strip() not in ("0", "false", "False", "")

        # Ứng dụng
        self.jwt_secret: str = os.getenv("AGORA_JWT_SECRET", "dev-secret-doi-truoc-khi-trien-khai")
        self.jwt_hours: int = int(os.getenv("AGORA_JWT_HOURS", "72"))
        self.database_url: str = os.getenv("AGORA_DATABASE_URL", f"sqlite:///{BASE_DIR / 'agora.db'}")
        self.upload_dir: Path = _path(os.getenv("AGORA_UPLOAD_DIR", "./uploads"))
        self.trace_dir: Path = BASE_DIR / "traces"
        self.slide_sync_timeout_seconds: int = max(
            1, int(os.getenv("AGORA_SLIDE_SYNC_TIMEOUT_SECONDS", "300"))
        )

        # Ngưỡng dữ liệu
        self.min_responses: int = int(os.getenv("AGORA_MIN_RESPONSES", "5"))
        self.min_participation: float = float(os.getenv("AGORA_MIN_PARTICIPATION", "0.30"))

    @property
    def ai_available(self) -> bool:
        return self.ai_enabled and bool(self.groq_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    s.trace_dir.mkdir(parents=True, exist_ok=True)
    s.upload_dir.mkdir(parents=True, exist_ok=True)
    return s
