from dataclasses import dataclass
import os
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AdapterConfig:
    base_url: str
    token_file: Path

    def read_token(self) -> str:
        if self.token_file.is_symlink():
            raise ValueError("Token file must not be a symbolic link")
        if not self.token_file.is_file():
            raise ValueError("Token file is unavailable")
        if os.name != "nt" and self.token_file.stat().st_mode & 0o077:
            raise ValueError("Token file permissions must be private")
        token = self.token_file.read_text(encoding="utf-8").strip()
        if not token or "\n" in token or "\r" in token or len(token) > 512:
            raise ValueError("Token file has an invalid value")
        return token


def load_config(env: Mapping[str, str], *, test_mode: bool = False) -> AdapterConfig:
    base_url = env.get("UMIEM_BASE_URL", "").strip()
    token_path = env.get("UMIEM_READ_TOKEN_FILE", "").strip()
    if not base_url or not token_path:
        raise ValueError("UMIEM_BASE_URL and UMIEM_READ_TOKEN_FILE are required")
    parsed = urlsplit(base_url)
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (test_mode and parsed.scheme == "http" and loopback):
        raise ValueError("UMIEM_BASE_URL must use HTTPS")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("UMIEM_BASE_URL contains disallowed URL components")
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("UMIEM_BASE_URL has an invalid port")
    path = Path(token_path)
    if not path.is_absolute():
        raise ValueError("UMIEM_READ_TOKEN_FILE must be an absolute path")
    return AdapterConfig(base_url=base_url.rstrip("/"), token_file=path)
