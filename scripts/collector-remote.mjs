import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const key = "D:/UserFiles/Desktop/rising path项目/正式发布服务器密钥.pem";
const creds = readFileSync("D:/UserFiles/Desktop/rising path项目/上游采集器的服务器账号密码.txt", "utf8");
const password = /密码[:：]\s*(\S+)/.exec(creds)[1];
const mode = process.argv[2];
const timeoutArg = process.argv.find((item) => item.startsWith("--timeout="));
const timeoutMs = timeoutArg ? Number(timeoutArg.slice("--timeout=".length)) : 180000;
const sshBase = ["-i", key, "-o", "BatchMode=yes", "ubuntu@43.172.117.125"];

function run(args, stdin, timeoutMs = 180000, inherit = false) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...sshBase, ...args], {
      stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    });
    if (inherit) {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve("");
        else reject(new Error(`exit ${code}`));
      });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout after ${timeoutMs}ms\n${out}\n${err}`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      err += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exit ${code}\n${err}\n${out}`));
    });
    if (stdin != null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function ensurePass() {
  await run(["cat > /tmp/.cj && chmod 600 /tmp/.cj"], password, 30000);
}

const inner = "sshpass -f /tmp/.cj ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no root@47.83.172.45";

async function main() {
  await ensurePass();
  if (mode === "run") {
    const script = readFileSync(process.argv[3], "utf8").replace(/\r\n/g, "\n");
    await run([`${inner} bash -s`], script, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000);
    return;
  }
  if (mode === "put") {
    const localPath = process.argv[3];
    const remotePath = process.argv[4];
    const tmpName = `/tmp/collector-put-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await new Promise((resolve, reject) => {
      const child = spawn("scp", ["-i", key, "-o", "BatchMode=yes", localPath, `ubuntu@43.172.117.125:${tmpName}`], {
        stdio: "inherit",
      });
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`scp to jump exit ${code}`))));
    });
    await run([`sshpass -f /tmp/.cj scp -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no ${tmpName} root@47.83.172.45:${remotePath}`], null);
    console.log(`uploaded ${localPath} -> ${remotePath}`);
    return;
  }
  if (mode === "pull") {
    const remotePath = process.argv[3];
    const localPath = process.argv[4];
    const child = spawn("ssh", [...sshBase, `${inner} cat ${JSON.stringify(remotePath)}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let err = "";
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => {
      err += d.toString();
      process.stderr.write(d);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("pull timeout"));
      }, 180000);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`pull exit ${code}\n${err}`));
      });
    });
    writeFileSync(localPath, Buffer.concat(chunks));
    console.log(`saved ${localPath} (${Buffer.concat(chunks).length} bytes)`);
    return;
  }
  throw new Error("usage: collector-remote.mjs run <script> | put <local> <remote> | pull <remote> <local>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
