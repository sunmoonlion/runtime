"""Run through stdin in investment-runner; public app-server HTTP MCP integration.

The API role intentionally has no sandbox egress. Use the existing runner role.
Uses an ephemeral, read-only thread (no model turn). No database writes, no
automatic approvals, no real MCP tools: calls only the fixed echo fixture.
"""
import asyncio
import json
import logging

from sqlalchemy import text

from app.infrastructure.storage.postgres import get_postgres
from app.infrastructure.workbench.app_server_client import WsAppServerConnector
from app.infrastructure.workbench.repository import WorkbenchRepository
from core.config import get_settings

logging.disable(logging.CRITICAL)


async def main():
    db = get_postgres()
    await db.init()
    client = None
    tid = None
    try:
        async with db.session_factory() as session:
            await session.execute(text('SET TRANSACTION READ ONLY'))
            repo = WorkbenchRepository(session)
            row = await repo.get_session('52511429-3a68-4bb3-a102-55db1e6b4c3f')
            sandbox = await repo.get_sandbox(str(row['sandbox_id']), owner_actor_id=str(row['owner_actor_id']))
            await session.rollback()

        async def notification(method, params):
            pass

        async def approval(rid, method, params):
            # This probe never grants a model tool or permissions request.
            await client.respond_error(rid, -32001, 'Integration probe does not approve requests')

        client = WsAppServerConnector().open(sandbox, on_notification=notification, on_server_request=approval)
        print(json.dumps({'event': 'connecting-public-app-server'}), flush=True)
        await client.connect()
        print(json.dumps({'event': 'starting-ephemeral-thread'}), flush=True)
        result = await client.request('thread/start', {
            'environments': [{'environmentId': get_settings().workbench_environment_key, 'cwd': row['project_root']}],
            'sandbox': 'read-only', 'ephemeral': True,
        }, timeout=45)
        tid = result['thread']['id']
        print(json.dumps({'event': 'ephemeral-thread', 'threadId': tid}), flush=True)
        found = False
        for _ in range(8):
            inventory = await client.request('mcpServerStatus/list', {'threadId': tid, 'detail': 'toolsAndAuthOnly'}, timeout=15)
            entries = inventory.get('data', [])
            fixture = next((s for s in entries if s.get('name') == 'sunmoon_stage2_fixture'), None)
            if fixture and 'stage2_echo' in fixture.get('tools', {}):
                found = True
                break
            await asyncio.sleep(1)
        print(json.dumps({'event': 'mcp-inventory', 'fixtureListed': found}), flush=True)
        if not found:
            print(json.dumps({'event': 'mcp-diagnostic', 'serverNames': [s.get('name') for s in entries], 'fixtureRuntimeStatus': fixture.get('runtimeStatus') if fixture else None, 'fixtureToolsError': fixture.get('toolsError') if fixture else None}), flush=True)
            raise RuntimeError('fixture not listed')
        result = await client.request('mcpServer/tool/call', {'threadId': tid, 'server': 'sunmoon_stage2_fixture', 'tool': 'stage2_echo', 'arguments': {'marker': 'SUNMOON_STAGE2_HTTP_MCP_20261008'}}, timeout=20)
        # Result schema is pinned to 0.155.1; only the public fixture marker is output.
        print(json.dumps({'event': 'mcp-call', 'result': result}), flush=True)
        if 'SUNMOON_STAGE2_HTTP_MCP_20261008' not in json.dumps(result) or result.get('isError'):
            raise RuntimeError('fixture call failed')
    finally:
        if client:
            if tid:
                try:
                    await client.request('thread/unsubscribe', {'threadId': tid}, timeout=10)
                except Exception:
                    pass
            await client.close()
        await db.shutdown()


try:
    asyncio.run(main())
except Exception as error:
    print(json.dumps({'error_type': type(error).__name__}), flush=True)
    raise SystemExit(1) from None
