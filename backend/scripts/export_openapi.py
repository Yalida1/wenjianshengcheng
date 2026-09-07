from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.app.main import app


def rendered_openapi() -> str:
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True)


def export_openapi(*, check: bool = False) -> None:
    target = Path("docs/openapi.json")
    rendered = rendered_openapi()
    if check:
        if not target.is_file() or target.read_text(encoding="utf-8") != rendered:
            raise SystemExit("docs/openapi.json is stale; run python -m backend.scripts.export_openapi")
        print(f"OpenAPI contract is current: {target}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(rendered, encoding="utf-8")
    print(f"Wrote {target}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    export_openapi(check=args.check)
