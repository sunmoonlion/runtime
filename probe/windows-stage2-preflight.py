"""Run via stdin in the investment API Pod. Read-only, explicit safe projection.

No credential values, commands, conversation text or config are printed.
This is integration preparation, not an alternative application write path.
"""
import asyncio
import json

from sqlalchemy import text

from app.infrastructure.storage.postgres import get_postgres
from app.infrastructure.workbench.relay_admin import WsRelayAdmin
from app.infrastructure.workbench.repository import WorkbenchRepository
from core.config import get_settings


async def main():
    settings = get_settings()
    agents = await WsRelayAdmin(
        settings.workbench_relay_admin_url, settings.workbench_relay_admin_token
    ).agents()
    print(json.dumps({"agents": {key: {
        "codex": value.get("codex"), "software": value.get("software"),
        "machine": value.get("machine"),
        "pending_permission_reports": len(value.get("permission_reports", [])),
    } for key, value in agents.items()}}, default=str))
    db = get_postgres()
    await db.init()
    try:
        async with db.session_factory() as session:
            await session.execute(text("SET TRANSACTION READ ONLY"))
            repo = WorkbenchRepository(session)
            for sid in ["6e0bc2cf-7c86-4784-9156-5b4d3c7a6e5e", "52511429-3a68-4bb3-a102-55db1e6b4c3f"]:
                row = await repo.get_session(sid)
                fields = ["id", "owner_actor_id", "environment_id", "sandbox_id", "thread_id", "project_root", "wheel_holder", "status", "kind"]
                events = await repo.list_record_events(session_id=sid, types=("agent/localPermission",))
                safe_events = [{"id": event["id"], "cursor": event["cursor"], "created_at": event["created_at"], "payload": {
                    k: event["payload"].get(k) for k in ("id", "conn", "threadId", "requestDigest", "permissionDigest", "decision", "scope", "expiresAt")
                }} for event in events]
                print(json.dumps({"session": {k: row[k] for k in fields if k in row}, "permission_events": safe_events}, default=str))
            await session.rollback()
    finally:
        await db.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(json.dumps({"error_type": type(exc).__name__}))
        raise SystemExit(1) from None
