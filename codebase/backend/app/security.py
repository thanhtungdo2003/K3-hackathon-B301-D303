"""Băm mật khẩu + JWT cho tài khoản chủ phòng / giảng viên."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session as DbSession

from .config import get_settings
from .db import get_db
from .models import User

settings = get_settings()
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


def hash_password(raw: str) -> str:
    # bcrypt chỉ dùng 72 byte đầu; cắt trước để mật khẩu dài không gây lỗi.
    return pwd.hash(raw[:72])


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return pwd.verify(raw[:72], hashed)
    except ValueError:
        return False


def create_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: DbSession = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cần đăng nhập.")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn.") from None
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token không hợp lệ.") from None

    user = db.get(User, int(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="Tài khoản không tồn tại.")
    return user
