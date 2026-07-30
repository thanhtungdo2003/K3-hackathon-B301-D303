"""AGORA backend — FastAPI + Socket.IO. Không có dữ liệu mô phỏng."""
from __future__ import annotations

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import realtime
from .config import get_settings
from .db import Base, engine
from .routers import assistant, auth, courses, insights, rooms, student, teaching

settings = get_settings()

api = FastAPI(
    title="AGORA API",
    version="1.0.0",
    description="Hỗ trợ giảng dạy theo thời gian thực: phòng học, checkpoint, Teaching Advisor.",
)
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

api.include_router(auth.router)
api.include_router(courses.router)
api.include_router(rooms.router)
api.include_router(teaching.router)
api.include_router(insights.router)
api.include_router(student.router)
api.include_router(assistant.router)


@api.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(engine)


@api.on_event("shutdown")
async def on_shutdown() -> None:
    await realtime.shutdown()


@api.get("/health", tags=["meta"])
def health() -> dict:
    return {
        "ok": True,
        "llm_provider": "groq",
        "ai_enabled": settings.ai_enabled,
        "ai_available": settings.ai_available,
        "model": settings.groq_model if settings.ai_available else None,
    }


app = socketio.ASGIApp(realtime.sio, other_asgi_app=api, socketio_path="socket.io")
