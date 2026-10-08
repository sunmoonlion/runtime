// Disposable real HTTP MCP endpoint on Windows, loopback only (exec-server performs MCP HTTP locally).
// No filesystem, credentials, model calls or external network access.
import http from 'node:http';
const marker = 'SUNMOON_STAGE2_HTTP_MCP_20261008';
const tools = [{ name: 'stage2_echo', description: 'Return the fixed public integration marker.', inputSchema: { type: 'object', properties: { marker: { type: 'string', const: marker } }, required: ['marker'], additionalProperties: false } }];
const server = http.createServer(async (req, res) => {
  if (req.url !== '/mcp' || req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  let bytes = 0, chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) { res.writeHead(413); res.end(); return; }
    chunks.push(chunk);
  }
  let frame;
  try { frame = JSON.parse(Buffer.concat(chunks).toString()); } catch { res.writeHead(400); res.end(); return; }
  if (!['initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call'].includes(frame.method)) {
    res.writeHead(400); res.end(); return;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), method: frame.method }));
  if (frame.id === undefined) { res.writeHead(202); res.end(); return; }
  let result;
  if (frame.method === 'initialize') result = { protocolVersion: frame.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'sunmoon-stage2-fixture', version: '1.0.0' } };
  else if (frame.method === 'tools/list') result = { tools };
  else if (frame.method === 'tools/call') {
    const ok = frame.params?.name === 'stage2_echo' && frame.params.arguments?.marker === marker && Object.keys(frame.params.arguments).length === 1;
    result = { content: [{ type: 'text', text: ok ? marker : 'Invalid fixture arguments' }], isError: !ok };
  } else result = {};
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }));
});
server.listen(48291, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, pid: process.pid, port: 48291, deadlineMinutes: 30 })));
const stop = () => { server.closeAllConnections(); server.close(() => process.exit(0)); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
setTimeout(stop, 30 * 60 * 1000).unref();
