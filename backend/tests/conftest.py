import os
import pytest
import requests
from pathlib import Path

# Load EXPO_PUBLIC_BACKEND_URL from frontend/.env
_FRONTEND_ENV = Path("/app/frontend/.env")
if _FRONTEND_ENV.exists():
    for line in _FRONTEND_ENV.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            os.environ.setdefault("EXPO_PUBLIC_BACKEND_URL", line.split("=", 1)[1].strip().strip('"'))

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def shared_state():
    """Shared dict between tests for tokens/ids."""
    return {}


@pytest.fixture(scope="module")
def shared():
    """Module-scoped shared dict for cross-test data (ids etc.)."""
    return {}
