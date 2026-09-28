/* Scan Card Box —— 扫榜素材卡盒
 * 素材卡 = 一篇带 frontmatter 的笔记：
 *   ---\ngenre: 题材\nhook: 钩子类型\nending: 结尾梗\nsource: 来源榜单\ntags: [素材卡]\n---
 * 命令：新建素材卡 / 打开素材卡盒面板；面板内可筛选、抽卡组合、一键生成组合笔记。
 */
const { Plugin, ItemView, Modal, Notice, PluginSettingTab, Setting, MarkdownView } = require("obsidian");

const VIEW_TYPE = "scan-card-box-view";
const FIELDS = [
  { key: "genre", label: "题材" },
  { key: "hook", label: "钩子类型" },
  { key: "ending", label: "结尾梗" },
  { key: "source", label: "来源（榜单/书名）" },
  { key: "logline", label: "一句话梗概" },
];

const DEFAULT_SETTINGS = { cardsFolder: "素材卡盒" };

module.exports = class ScanCardBox extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addRibbonIcon("layers", "素材卡盒", () => this.openView());
    this.addCommand({ id: "open-box", name: "打开素材卡盒面板", callback: () => this.openView() });
    this.addCommand({ id: "new-card", name: "新建素材卡", callback: () => new NewCardModal(this).open() });
    this.addCommand({ id: "draw-combo", name: "抽卡组合（随机三元素）", callback: () => this.drawCombo() });
    this.addSettingTab(new CardSettingTab(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => new CardBoxView(leaf, this));
  }

  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }

  async saveSettings() { await this.saveData(this.settings); }

  async openView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async ensureFolder() {
    const f = this.app.vault.getAbstractFileByPath(this.settings.cardsFolder);
    if (!f) await this.app.vault.createFolder(this.settings.cardsFolder);
  }

  async createCard(data) {
    await this.ensureFolder();
    const name = `${data.genre || "未分类"}-${data.hook || "无钩"}-${Date.now() % 10000}`;
    const safe = name.replace(/[\\/:*?"<>|]/g, "_");
    const fm = [
      "---",
      "tags: [素材卡]",
      `genre: ${data.genre || ""}`,
      `hook: ${data.hook || ""}`,
      `ending: ${data.ending || ""}`,
      `source: ${data.source || ""}`,
      "---",
      "",
      data.logline || "",
    ].join("\n");
    const file = await this.app.vault.create(`${this.settings.cardsFolder}/${safe}.md`, fm + "\n");
    new Notice(`素材卡已创建：${file.basename}`);
    return file;
  }

  /** 读取卡盒里所有卡（从 metadataCache 解析 frontmatter） */
  allCards() {
    const folder = this.settings.cardsFolder;
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder))
      .map((f) => {
        const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
        return { file: f, genre: fm.genre || "", hook: fm.hook || "", ending: fm.ending || "", source: fm.source || "" };
      });
  }

  /** 随机抽三元素，弹窗展示并可一键生成组合笔记 */
  drawCombo() {
    const cards = this.allCards();
    if (cards.length < 3) {
      new Notice("卡盒里素材不足 3 张，先扫榜建卡。");
      return;
    }
    const pick = (key) => {
      const vals = cards.map((c) => c[key]).filter(Boolean);
      return vals.length ? vals[Math.floor(Math.random() * vals.length)] : "";
    };
    const combo = { genre: pick("genre"), hook: pick("hook"), ending: pick("ending") };

    const m = new Modal(this.app);
    m.contentEl.createEl("h3", { text: "🎲 抽卡组合" });
    const ul = m.contentEl.createEl("ul");
    ul.createEl("li", { text: `题材：${combo.genre || "（空）"}` });
    ul.createEl("li", { text: `钩子：${combo.hook || "（空）"}` });
    ul.createEl("li", { text: `结尾梗：${combo.ending || "（空）"}` });
    const btns = m.contentEl.createDiv();
    btns.style.cssText = "display:flex; gap:8px; justify-content:flex-end;";
    const reroll = btns.createEl("button", { text: "再抽一次" });
    reroll.onclick = () => { m.close(); this.drawCombo(); };
    const ok = btns.createEl("button", { text: "生成立项笔记", cls: "mod-cta" });
    ok.onclick = async () => {
      await this.ensureFolder();
      const body = [
        "---",
        "tags: [立项]",
        `genre: ${combo.genre}`,
        `hook: ${combo.hook}`,
        `ending: ${combo.ending}`,
        "---",
        "",
        `## 组合`,
        `- 题材：${combo.genre}`,
        `- 钩子：${combo.hook}`,
        `- 结尾梗：${combo.ending}`,
      ].join("\n") + "\n";
      const f = await this.app.vault.create(
        `${this.settings.cardsFolder}/立项-${Date.now() % 100000}.md`, body);
      m.close();
      new Notice("立项笔记已生成");
      this.app.workspace.getLeaf("tab").openFile(f);
    };
    m.open();
  }
};

class NewCardModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "新建素材卡" });
    const inputs = {};
    for (const f of FIELDS) {
      const row = contentEl.createDiv();
      row.style.marginBottom = "6px";
      row.createEl("label", { text: f.label + "：", attr: { style: "display:block; font-size:12px; color:var(--text-muted);" } });
      const input = row.createEl("input", { type: "text" });
      input.style.width = "100%";
      inputs[f.key] = input;
    }
    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex; gap:8px; justify-content:flex-end; margin-top:8px;";
    const cancel = btns.createEl("button", { text: "取消" });
    cancel.onclick = () => this.close();
    const ok = btns.createEl("button", { text: "创建", cls: "mod-cta" });
    ok.onclick = async () => {
      const data = {};
      for (const f of FIELDS) data[f.key] = inputs[f.key].value.trim();
      if (!data.genre && !data.hook && !data.ending) {
        new Notice("题材/钩子/结尾梗至少填一个");
        return;
      }
      this.close();
      await this.plugin.createCard(data);
      this.plugin.openView();
    };
    inputs.genre.focus();
  }
}

class CardSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("素材卡文件夹")
      .setDesc("相对 vault 根目录，不存在会自动创建").addText((t) =>
      t.setValue(this.plugin.settings.cardsFolder).onChange(async (v) => {
        this.plugin.settings.cardsFolder = v.trim() || "素材卡盒";
        await this.plugin.saveSettings();
      }));
  }
}

// ---------- 面板视图 ----------
class CardBoxView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.filter = ""; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "素材卡盒"; }
  getIcon() { return "layers"; }

  onOpen() { this.render(); this.registerEvent(this.app.metadataCache.on("resolved", () => this.render())); }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h4", { text: "素材卡盒" });

    const toolbar = contentEl.createDiv();
    toolbar.style.cssText = "display:flex; gap:6px; margin-bottom:8px;";
    const search = toolbar.createEl("input", { type: "text", placeholder: "筛选…" });
    search.value = this.filter;
    search.style.flex = "1";
    const addBtn = toolbar.createEl("button", { text: "+卡" });
    addBtn.onclick = () => new NewCardModal(this.plugin).open();
    const drawBtn = toolbar.createEl("button", { text: "🎲 抽卡", cls: "mod-cta" });
    drawBtn.onclick = () => this.plugin.drawCombo();

    const cards = this.plugin.allCards();
    const listEl = contentEl.createDiv();
    const kw = this.filter.trim().toLowerCase();

    for (const c of cards) {
      const hay = `${c.genre} ${c.hook} ${c.ending} ${c.source} ${c.file.basename}`.toLowerCase();
      if (kw && !hay.includes(kw)) continue;
      const item = listEl.createDiv("card-box-item");
      item.style.cssText = "padding:6px 8px; margin-bottom:4px; border:1px solid var(--background-modifier-border); border-radius:6px; cursor:pointer;";
      item.createEl("div", { text: `${c.genre || "?"} · ${c.hook || "?"}`, attr: { style: "font-weight:600;" } });
      item.createEl("div", {
        text: [c.ending && `结尾:${c.ending}`, c.source && `来源:${c.source}`].filter(Boolean).join(" ｜ ") || c.file.basename,
        attr: { style: "font-size:12px; color:var(--text-muted);" },
      });
      item.onclick = () => this.app.workspace.getLeaf("tab").openFile(c.file);
    }
    if (!cards.length) contentEl.createEl("div", { text: "卡盒为空，点「+卡」开始扫榜建卡。" });

    search.oninput = () => { this.filter = search.value; this.render(); };
    // 让筛选框重渲染后保持焦点
    if (kw || this.filter) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }

  onClose() { this.contentEl.empty(); }
}
