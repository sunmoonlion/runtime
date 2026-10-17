// 测试电脑初始化时用：核对解开的 Linux 包与清单逐字节一致（SDD 0027 §3.4）。
// 用法：node installer/verify-linux.mjs <包目录> <清单 SHA256>。只读，不启动、不安装。
import { verifyBundle } from './bundle.mjs';

const [directory, manifestSha256] = process.argv.slice(2);
try {
  if (!directory || !manifestSha256) throw new Error('Usage: verify-linux.mjs <directory> <manifest sha256>');
  const manifest = verifyBundle(directory, manifestSha256, { platform: 'linux' });
  console.log(JSON.stringify({ verified: true, agentVersion: manifest.agentVersion,
    codexVersion: manifest.codexVersion, sourceRevision: manifest.sourceRevision, files: manifest.files.length }));
} catch (error) {
  console.error(`Verification stopped: ${error.message}`);
  process.exitCode = 1;
}
