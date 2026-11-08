import * as Network from 'expo-network';
import * as Crypto from 'expo-crypto';
// @ts-ignore - buffer polyfill used by react-native-tcp-socket
import { Buffer } from 'buffer';

const PORT = 8975;
const UDP_PORT = 8976;

export interface LanImportSession {
  url: string;
  token: string;
  port: number;
  stop: () => Promise<void>;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pageHtml(token: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>课序 · 电脑导入</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#F3F4F0;color:#23282A;margin:0;padding:24px}
main{max-width:720px;margin:0 auto}h1{font-size:22px}
.card{background:#FCFCFA;border:1px solid #E1E4DC;border-radius:16px;padding:18px;margin-top:14px}
p{color:#7C8382;font-size:13px;line-height:1.6;white-space:pre-wrap}
button{background:#6B8A78;color:white;border:0;border-radius:10px;padding:10px 16px;font-size:14px;cursor:pointer}
textarea{width:100%;height:180px;box-sizing:border-box;border:1px solid #E1E4DC;border-radius:10px;padding:10px;font-family:ui-monospace,monospace;font-size:12px}
#msg{margin-top:10px;font-size:13px}
</style></head><body><main>
<h1>课序 · 电脑导入</h1>
<p>把桌面端导出的 state.json 粘贴到下面，或选择文件，然后发送到手机。</p>
<div class="card">
<textarea id="json" placeholder="在此粘贴课表 JSON…"></textarea>
<div style="display:flex;gap:10px;align-items:center;margin-top:10px">
<input id="file" type="file" accept="application/json,.json,text/plain"/>
<button id="send">发送到手机</button>
</div>
<div id="msg"></div>
</div>
<script>
const token=${JSON.stringify(token)};
const json=document.getElementById('json');const file=document.getElementById('file');const msg=document.getElementById('msg');
file.onchange=async()=>{const f=file.files[0];if(f)json.value=await f.text();};
document.getElementById('send').onclick=async()=>{
  if(!json.value.trim()){msg.textContent='请先选择或粘贴 JSON';return;}
  msg.textContent='发送中…';
  try{
    const r=await fetch('/import?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:json.value});
    const j=await r.json();
    msg.textContent=j.ok?'导入成功：'+j.courseCount+' 门课 / '+j.slotCount+' 个时间片':'导入失败：'+(j.error||'未知错误');
  }catch(e){msg.textContent='发送失败：'+e.message;}
};
</script></main></body></html>`;
}

function readBody(socket: any, initial: Uint8Array, onDone: (text: string) => void) {
  const chunks: Uint8Array[] = [initial];
  let length = initial.byteLength;
  const onData = (data: any) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    chunks.push(bytes);
    length += bytes.byteLength;
    if (length > 2 * 1024 * 1024) {
      socket.removeListener('data', onData);
      socket.end(httpResponse(413, 'application/json', JSON.stringify({ ok: false, error: 'JSON 太大' })));
      return;
    }
    const text = Buffer.from(concat(chunks)).toString('utf8');
    if (text.includes('\r\n\r\n')) {
      const headerEnd = text.indexOf('\r\n\r\n') + 4;
      const headers = text.slice(0, headerEnd);
      const m = /content-length:\s*(\d+)/i.exec(headers);
      const expected = m ? Number(m[1]) : 0;
      const bodyBytes = Buffer.byteLength(text.slice(headerEnd), 'utf8');
      if (bodyBytes >= expected) {
        socket.removeListener('data', onData);
        onDone(text.slice(headerEnd));
      }
    }
  };
  socket.on('data', onData);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function httpResponse(status: number, contentType: string, body: string): any {
  const reason = status === 200 ? 'OK' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Error';
  return Buffer.from(
    `HTTP/1.1 ${status} ${reason}\r\nContent-Type: ${contentType}; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type,X-CB-Token\r\nConnection: close\r\n\r\n${body}`,
    'utf8',
  );
}

export async function startLanImport(onImported: (text: string) => void): Promise<LanImportSession> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const TcpSocket = require('react-native-tcp-socket');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const UdpSockets = require('react-native-udp');

  let ip = '127.0.0.1';
  try {
    ip = await Network.getIpAddressAsync();
  } catch {
    // ignore
  }
  const token = hex(await Crypto.getRandomBytesAsync(16));
  const server = TcpSocket.createServer((socket: any) => {
    let first = true;
    const onFirstData = (data: any) => {
      if (!first) return;
      first = false;
      socket.removeListener('data', onFirstData);
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const text = Buffer.from(bytes).toString('utf8');
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        socket.end(httpResponse(400, 'text/plain', 'bad request'));
        return;
      }
      const headers = text.slice(0, headerEnd);
      const firstLine = headers.split('\r\n')[0] || '';
      const [method, path = '/'] = firstLine.split(' ');
      if (method === 'GET' && (path === '/' || path.startsWith('/index.html'))) {
        socket.end(httpResponse(200, 'text/html', pageHtml(token)));
        return;
      }
      if (method === 'GET' && path.startsWith('/ping')) {
        socket.end(httpResponse(200, 'application/json', JSON.stringify({
          ok: true,
          service: 'classboard-watch',
          app: 'top.classboard.ios',
          port: currentPort,
          token,
        })));
        return;
      }
      if (method === 'POST' && path.startsWith('/import')) {
        const urlToken = /[?&]token=([^&]+)/.exec(path)?.[1];
        const provided = decodeURIComponent(urlToken || '') || headers.match(/x-cb-token:\s*([^\r\n]+)/i)?.[1]?.trim();
        if (provided !== token) {
          socket.end(httpResponse(403, 'application/json', JSON.stringify({ ok: false, error: '导入码校验失败，请重新扫码' })));
          return;
        }
        const raw = Buffer.from(bytes);
        const headerBytes = Buffer.byteLength(headers + '\r\n\r\n', 'utf8');
        const body = raw.subarray(headerBytes);
        const lengthHeader = headers.match(/content-length:\s*(\d+)/i)?.[1];
        const expected = Number(lengthHeader || body.length);
        const finish = (bodyBuffer: any) => {
          try {
            const parsed = JSON.parse(bodyBuffer.toString('utf8'));
            onImported(JSON.stringify(parsed));
            socket.end(httpResponse(200, 'application/json', JSON.stringify({ ok: true })));
          } catch {
            socket.end(httpResponse(400, 'application/json', JSON.stringify({ ok: false, error: 'JSON 格式不正确' })));
          }
        };
        const collect = (initial: any) => {
          const chunks = [initial];
          let length = initial.length;
          if (length >= expected) { finish(Buffer.concat(chunks, expected)); return; }
          const onData = (chunk: any) => {
            const b = Buffer.from(chunk);
            chunks.push(b);
            length += b.length;
            if (length >= expected) {
              socket.removeListener('data', onData);
              finish(Buffer.concat(chunks, expected));
            }
          };
          socket.on('data', onData);
        };
        collect(body);
        return;
      }
      socket.end(httpResponse(404, 'application/json', JSON.stringify({ ok: false, error: 'not found' })));
    };
    socket.on('data', onFirstData);
  });

  let currentPort = PORT;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: PORT, host: '0.0.0.0' }, () => {
      currentPort = server.address()?.port || PORT;
      resolve();
    });
  }).catch(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port: 0, host: '0.0.0.0' }, () => {
        currentPort = server.address()?.port || PORT;
        resolve();
      });
    });
  });

  let udp: any = null;
  try {
    udp = UdpSockets.createSocket({ type: 'udp4', reusePort: true });
    udp.bind(UDP_PORT);
    udp.on('message', (msg: any, rinfo: any) => {
      try {
        const text = Buffer.from(msg).toString('utf8');
        if (!text.includes('CLASSBOARD_DISCOVER')) return;
        const payload = JSON.stringify({
          ok: true,
          service: 'classboard-watch',
          app: 'top.classboard.ios',
          port: currentPort,
          token,
        });
        udp.send(payload, rinfo.port, rinfo.address);
      } catch {
        // ignore
      }
    });
  } catch {
    udp = null;
  }

  return {
    url: `http://${ip}:${currentPort}/`,
    token,
    port: currentPort,
    stop: async () => {
      try { udp?.close(); } catch { /* ignore */ }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
