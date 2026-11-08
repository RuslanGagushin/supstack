/* =========================================================
   Native app (Tauri on Windows, macOS and Android): file access through the app's "vault" plugin
   instead of the browser's File System Access API, and opening links outside the app.
   ui/native-shell.js does the parts on screen.
   ========================================================= */
import { lsGet } from "./storage.js";
import { emit } from "./events.js";

export const TAURI = window.__TAURI__?.core || null;
export const IS_NATIVE = !!TAURI;
export const IS_ANDROID = IS_NATIVE && /Android/i.test(navigator.userAgent);
export const vinvoke = (cmd, args) => TAURI.invoke("plugin:vault|" + cmd, args);

function b64ToBytes(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
function bytesToB64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }

/** Same interface as HandleFS, backed by the native plugin. `root` is a folder path (desktop) or a content:// tree URI (Android). */
export class NativeFS {
  constructor(root, name) { this.root = root; this.name = name; this.kind = "disk"; this.native = true; }
  async list() {
    const items = await vinvoke("list", { root: this.root });
    return items.map((it) => ({ path: it.path, mtime: it.mtime, size: it.size, handle: { getFile: async () => this.lazyFile(it) } }));
  }
  /** Metadata now, contents only when asked — polling compares mtimes without reading every note. */
  lazyFile(it) {
    return { name: it.path.split("/").pop(), lastModified: it.mtime, size: it.size, text: () => this.read(it.path), arrayBuffer: async () => (await this.readFile(it.path)).arrayBuffer() };
  }
  async readFile(path) {
    const r = await vinvoke("read", { root: this.root, path, binary: true });
    return new File([b64ToBytes(r.data)], path.split("/").pop(), { lastModified: r.mtime });
  }
  async read(path) { return (await vinvoke("read", { root: this.root, path, binary: false })).data; }
  async exists(path) { return vinvoke("exists", { root: this.root, path }); }
  async dir(path) { if (!(await this.exists(path))) throw new Error("not found: " + path); return path; }
  async write(path, data) {
    if (typeof data === "string") return vinvoke("write", { root: this.root, path, text: data, base64: null });
    let bytes;
    if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
    else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else bytes = new TextEncoder().encode(String(data));
    return vinvoke("write", { root: this.root, path, text: null, base64: bytesToB64(bytes) });
  }
  async remove(path) { await vinvoke("remove", { root: this.root, path }); }
  async listDir(path) { return vinvoke("list_dir", { root: this.root, path }); }
  async removeDir(path) { await vinvoke("remove_dir", { root: this.root, path }); }
}

export const lastNative = () => lsGet("sn-native-last", null);
/** Open links outside the app (the system browser, mail). */
export function openExternal(url) {
  if (IS_NATIVE) TAURI.invoke("plugin:opener|open_url", { url }).catch((e) => emit("notice", String(e?.message || e)));
  else location.href = url;
}
