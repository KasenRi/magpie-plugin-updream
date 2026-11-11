import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Magpie 供应商多账号池：直接读取宿主持久化的 plugin-auth.json / logins.json / providers.json
 * 严格遵循宿主「模型 -> 供应商」页的账号启用状态、置顶默认顺序及用户自定义别名。
 */
export class MagpieAccountPool {
  /**
   * @param {object} opts
   * @param {string} opts.providerId           如 "xiaoyunque" | "updream"
   * @param {string} [opts.dataDir]            _input.directory 兜底路径
   * @param {object} [opts.clientAuth]         _input.client?.auth（用于 token 刷新后写回对应槽位）
   * @param {(slotEntry: object, persist: (nextSaved: object) => Promise<void>) => any} opts.buildClient
   * @param {() => any} opts.buildFallbackClient 当页面无任何启用账号时，回退到旧版 options/env 单账号
   */
  constructor({ providerId, dataDir, clientAuth, buildClient, buildFallbackClient }) {
    this.providerId = providerId;
    this.dataDir = dataDir || "";
    this.clientAuth = clientAuth || null;
    this.buildClient = buildClient;
    this.buildFallbackClient = buildFallbackClient;
    /** @type {Map<string, { fingerprint: string, client: any }>} */
    this._clientCache = new Map();
    /** @type {Map<string, string>} taskId -> slotKey，保证轮询任务回到提交时的同一账号 */
    this._taskSlotMap = new Map();
  }

  _resolveDataDir(runtimeDir) {
    if (runtimeDir) {
      if (!this.dataDir) this.dataDir = runtimeDir;
      return runtimeDir;
    }
    return this.dataDir;
  }

  _readJsonIfExists(filename, fallback, runtimeDir) {
    const dir = this._resolveDataDir(runtimeDir);
    if (!dir) return fallback;
    const p = join(dir, filename);
    if (!existsSync(p)) return fallback;
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return fallback;
    }
  }

  /** 读取当前所有槽位及排序后的已启用槽位 */
  listAccounts(runtimeDir) {
    const authMap = this._readJsonIfExists("plugin-auth.json", {}, runtimeDir);
    const logins = this._readJsonIfExists("logins.json", [], runtimeDir);
    const provCfg = this._readJsonIfExists("providers.json", {}, runtimeDir);

    // 检查用户在页面是否把整个供应商卡片关掉了 (Off)
    const pRow = Array.isArray(provCfg?.providers)
      ? provCfg.providers.find((p) => p?.id === this.providerId || p?.id === `${this.providerId}-plugin`)
      : null;
    const providerOff = Boolean(pRow?.off);
    const accountNames = pRow?.accountNames && typeof pRow.accountNames === "object" ? pRow.accountNames : {};

    const rawSlots = [];
    for (const [slot, saved] of Object.entries(authMap || {})) {
      if (slot !== this.providerId && !slot.startsWith(`${this.providerId}#`)) continue;
      if (!saved || typeof saved !== "object") continue;
      const secret =
        typeof saved.key === "string" && saved.key
          ? saved.key
          : typeof saved.access === "string"
          ? saved.access
          : "";
      const baseUser =
        saved.accountId ||
        saved.metadata?.email ||
        saved.email ||
        (secret.length >= 12 ? `····${secret.slice(-4)}` : slot);
      const alias = accountNames[String(baseUser).toLowerCase()] || "";
      rawSlots.push({
        slot,
        saved,
        user: String(baseUser),
        alias: String(alias),
        hint: secret.length >= 4 ? secret.slice(-4) : "",
      });
    }

    const agentKey = `plugin:${this.providerId}`;
    const loginRows = Array.isArray(logins) ? logins.filter((l) => l?.agent === agentKey) : [];
    const byHome = new Map(loginRows.map((l, idx) => [l.home, { ...l, idx }]));

    const all = rawSlots.map((item) => {
      const rec = byHome.get(item.slot);
      const enabled = !providerOff && (!rec || rec.first === true || rec.on !== false);
      return { ...item, first: Boolean(rec?.first), enabled, order: rec?.idx ?? 9999 };
    });

    all.sort((a, b) => {
      if (a.first !== b.first) return a.first ? -1 : 1;
      if (a.order !== b.order) return a.order - b.order;
      if (a.slot === this.providerId) return -1;
      if (b.slot === this.providerId) return 1;
      return a.slot.localeCompare(b.slot);
    });

    return {
      providerOff,
      all,
      enabled: all.filter((x) => x.enabled),
    };
  }

  _getOrCreateSlotClient(entry) {
    const fp = JSON.stringify(entry.saved);
    const cached = this._clientCache.get(entry.slot);
    if (cached && cached.fingerprint === fp) return cached.client;
    let clientRef = null;
    const client = this.buildClient(entry, async (updatedSaved) => {
      if (clientRef) {
        this._clientCache.set(entry.slot, {
          fingerprint: JSON.stringify(updatedSaved),
          client: clientRef,
        });
      }
      if (typeof this.clientAuth?.set === "function") {
        await this.clientAuth.set({ path: { id: entry.slot }, body: updatedSaved });
      }
    });
    clientRef = client;
    this._clientCache.set(entry.slot, { fingerprint: fp, client });
    return client;
  }

  rememberTask(taskId, slot) {
    if (!taskId || !slot) return;
    if (this._taskSlotMap.size >= 500) {
      const oldest = this._taskSlotMap.keys().next().value;
      this._taskSlotMap.delete(oldest);
    }
    this._taskSlotMap.set(String(taskId), slot);
  }

  hasBoundTask(taskId) {
    if (!taskId) return false;
    return this._taskSlotMap.has(String(taskId));
  }

  /**
   * 当未显式指定 account 且默认账号返回「任务不存在」时，返回其余已启用账号供兜底查询（不轮换默认账号）。
   */
  listFallbackEnabledAccounts({ excludeSlot, directory } = {}) {
    const { enabled } = this.listAccounts(directory);
    return enabled
      .filter((e) => e.slot !== excludeSlot)
      .map((e) => ({
        slot: e.slot,
        label: e.alias || e.user,
        client: this._getOrCreateSlotClient(e),
      }));
  }

  /**
   * 按优先级解析本次工具调用应使用的 Client：
   * 1. 显式 args.account -> 2. task_id 历史绑定槽位 -> 3. 页面置顶启用账号 -> 4. options/env 旧配置兜底
   */
  resolve({ account, taskId, directory } = {}) {
    const { all, enabled } = this.listAccounts(directory);
    const selector = typeof account === "string" ? account.trim() : "";

    if (selector) {
      if (selector === "options" || selector === "legacy") {
        return { slot: "options", label: "options", client: this.buildFallbackClient() };
      }
      const q = selector.toLowerCase();
      // 显式点名时允许匹配任意已保存槽位（含临时关闭的槽位），匹配顺序：slot -> user -> alias -> 末4位
      const hit = all.find(
        (e) =>
          e.slot.toLowerCase() === q ||
          e.user.toLowerCase() === q ||
          (e.alias && e.alias.toLowerCase() === q) ||
          (e.hint && (`····${e.hint}`.toLowerCase() === q || e.hint.toLowerCase() === q)),
      );
      if (!hit) {
        const available = all.map((e) => (e.alias ? `${e.alias}(${e.user})` : e.user)).join(", ") || "无";
        throw new Error(`未找到匹配的 ${this.providerId} 账号 "${selector}"。当前已保存账号: ${available}`);
      }
      return { slot: hit.slot, label: hit.alias || hit.user, client: this._getOrCreateSlotClient(hit) };
    }

    if (taskId) {
      const boundSlot = this._taskSlotMap.get(String(taskId));
      if (boundSlot) {
        if (boundSlot === "options") {
          return { slot: "options", label: "options", client: this.buildFallbackClient() };
        }
        const hit = all.find((e) => e.slot === boundSlot);
        if (hit) {
          return { slot: hit.slot, label: hit.alias || hit.user, client: this._getOrCreateSlotClient(hit) };
        }
      }
    }

    if (enabled.length > 0) {
      const top = enabled[0];
      return { slot: top.slot, label: top.alias || top.user, client: this._getOrCreateSlotClient(top) };
    }

    // 页面未添加任何启用账号时，无缝回退到 plugins.json options / 环境变量
    return { slot: "options", label: "options", client: this.buildFallbackClient() };
  }
}
