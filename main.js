/* Scan Card Box —— 灵感卡盒（通用化版）
 * 素材卡 = 一篇带 frontmatter 的笔记。字段完全可配置（设置里 JSON 定义），
 * 默认是网文扫榜字段（题材/钩子/结尾梗/来源/一句话梗概），改成任意领域只需改字段：
 *   视频选题: {key:"topic",label:"选题"}, {key:"format",label:"形式"}, {key:"hook",label:"开头钩子"}
 * 「抽卡组合」从标记 combo:true 的字段里各随机抽一个，生成组合笔记 —— 立项/选题/选题灵感。
 */
const { Plugin, ItemView, Modal, Notice, PluginSettingTab, Setting, MarkdownView } = require("obsidian");

const VIEW_TYPE = "scan-card-box-view";

const DEFAULT_FIELDS = [
  { key: "genre", label: "题材", combo: true },
  { key: "hook", label: "钩子类型", combo: true },
  { key: "ending", label: "结尾梗", combo: true },
  { key: "source", label: "来源", combo: false },
  { key: "logline", label: "一句话梗概", combo: false },
];

const DEFAULT_SETTINGS = {
  cardsFolder: "素材卡盒",
  fieldsJson: JSON.stringify(DEFAULT_FIELDS, null, 2),
};

module.exports = class ScanCardBox extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addRibbonIcon("layers", "灵感卡盒", () => this.openView());
    this.addCommand({ id: "open-box", name: "打开卡盒面板", callback: () => this.openView() });
    this.addCommand({ id: "new-card", name: "新建素材卡", callback: () => new NewCardModal(this).open() });
    this.addCommand({ id: "draw-combo", name: "抽卡组合（随机组合各维度）", callback: () => this.drawCombo() });
    this.addSettingTab(new CardSettingTab(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => new CardBoxView(leaf, this));
  }

  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }

  async saveSettings() { await this.saveData(this.settings); }

  /** 字段定义（JSON，坏配置回退默认） */
  fields() {
    try {
      const arr = JSON.parse(this.settings.fieldsJson);
      if (Array.isArray(arr) && arr.length && arr.every((f) => f && f.key)) return arr;
    } catch (e) {}
    return DEFAULT_FIELDS;
  }
  comboFields() {
    const c = this.fields().filter((f) => f.combo);
    return c.length ? c : this.fields().slice(0, 3);
  }

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
    const fields = this.fields();
    const firstCombo = this.comboFields()[0];
    const name = `${data[firstCombo.key] || firstCombo.label}-${Date.now() % 100000}`;
    const safe = name.replace(/[\\/:*?"<>|]/g, "_");
    const fm = ["---", "tags: [素材卡]"];
    for (const f of fields) fm.push(`${f.key}: ${data[f.key] || ""}`);
    fm.push("---", "", data.__body || "");
    const file = await this.app.vault.create(`${this.settings.cardsFolder}/${safe}.md`, fm.join("\n") + "\n");
    new Notice(`素材卡已创建：${file.basename}`);
    return file;
  }

  /** 读取卡盒里所有卡（frontmatter 动态解析） */
  allCards() {
    const folder = this.settings.cardsFolder;
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder))
      .map((f) => {
        const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
        return { file: f, data: fm };
      });
  }

  /** 抽卡：每个 combo 维度随机抽一个值，弹窗展示并可生成组合笔记 */
  drawCombo() {
    const cards = this.allCards();
    const cFields = this.comboFields();
    if (cards.length < 3) {
      new Notice("卡盒里素材不足 3 张，先建卡。");
      return;
    }
    const combo = {};
    for (const f of cFields) {
      const vals = cards.map((c) => c.data[f.key]).filter(Boolean);
      combo[f.key] = vals.length ? vals[Math.floor(Math.random() * vals.length)] : "";
    }

    const m = new Modal(this.app);
    m.contentEl.createEl("h3", { text: "🎲 抽卡组合" });
    const ul = m.contentEl.createEl("ul");
    for (const f of cFields) ul.createEl("li", { text: `${f.label}：${combo[f.key] || "（空）"}` });
    const btns = m.contentEl.createDiv();
    btns.style.cssText = "display:flex; gap:8px; justify-content:flex-end;";
    const reroll = btns.createEl("button", { text: "再抽一次" });
    reroll.onclick = () => { m.close(); this.drawCombo(); };
    const ok = btns.createEl("button", { text: "生成组合笔记", cls: "mod-cta" });
    ok.onclick = async () => {
      await this.ensureFolder();
      const body = [
        "---",
        "tags: [组合]",
        ...cFields.map((f) => `${f.key}: ${combo[f.key]}`),
        "---",
        "",
        "## 组合",
        ...cFields.map((f) => `- ${f.label}：${combo[f.key]}`),
      ].join("\n") + "\n";
      const f = await this.app.vault.create(
        `${this.settings.cardsFolder}/组合-${Date.now() % 100000}.md`, body);
      m.close();
      new Notice("组合笔记已生成");
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
    const fields = this.plugin.fields();
    const inputs = {};
    for (const f of fields) {
      const row = contentEl.createDiv();
      row.style.marginBottom = "6px";
      row.createEl("label", { text: f.label + "：", attr: { style: "display:block; font-size:12px; color:var(--text-muted);" } });
      const input = row.createEl("textarea");
      input.style.width = "100%";
      input.rows = 1;
      inputs[f.key] = input;
    }
    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex; gap:8px; justify-content:flex-end; margin-top:8px;";
    const cancel = btns.createEl("button", { text: "取消" });
    cancel.onclick = () => this.close();
    const ok = btns.createEl("button", { text: "创建", cls: "mod-cta" });
    ok.onclick = async () => {
      const data = {};
      for (const f of fields) data[f.key] = inputs[f.key].value.trim();
      const cFields = this.plugin.comboFields();
      if (!cFields.some((f) => data[f.key])) {
        new Notice(`至少填一个组合维度（${cFields.map((f) => f.label).join("/")}）`);
        return;
      }
      this.close();
      await this.plugin.createCard(data);
      this.plugin.openView();
    };
    if (fields.length) inputs[fields[0].key].focus();
  }
}

class CardSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("卡盒文件夹")
      .setDesc("相对 vault 根目录，不存在会自动创建").addText((t) =>
      t.setValue(this.plugin.settings.cardsFolder).onChange(async (v) => {
        this.plugin.settings.cardsFolder = v.trim() || "素材卡盒";
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("字段定义（JSON）")
      .setDesc('数组，每项 {key, label, combo}。combo:true 的字段参与抽卡组合。例：视频选题 {"key":"topic","label":"选题","combo":true}')
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.fieldsJson);
        t.inputEl.style.minHeight = "120px";
        t.inputEl.style.fontFamily = "monospace";
        t.onChange(async (v) => {
          this.plugin.settings.fieldsJson = v;
          await this.plugin.saveSettings();
        });
      });
  }
}

// ---------- 面板视图 ----------
class CardBoxView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.filter = ""; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "灵感卡盒"; }
  getIcon() { return "layers"; }

  onOpen() { this.render(); this.registerEvent(this.app.metadataCache.on("resolved", () => this.render())); }
  onClose() { this.contentEl.empty(); }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h4", { text: "灵感卡盒" });

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
    const cFields = this.plugin.comboFields();
    const otherFields = this.plugin.fields().filter((f) => !cFields.includes(f));
    const listEl = contentEl.createDiv();
    const kw = this.filter.trim().toLowerCase();

    for (const c of cards) {
      const hay = `${Object.values(c.data).join(" ")} ${c.file.basename}`.toLowerCase();
      if (kw && !hay.includes(kw)) continue;
      const item = listEl.createDiv("card-box-item");
      item.style.cssText = "padding:6px 8px; margin-bottom:4px; border:1px solid var(--background-modifier-border); border-radius:6px; cursor:pointer;";
      item.createEl("div", {
        text: cFields.map((f) => c.data[f.key] || "?").join(" · "),
        attr: { style: "font-weight:600;" },
      });
      const extras = otherFields.map((f) => c.data[f.key]).filter(Boolean).join(" ｜ ");
      item.createEl("div", {
        text: extras || c.file.basename,
        attr: { style: "font-size:12px; color:var(--text-muted);" },
      });
      item.onclick = () => this.app.workspace.getLeaf("tab").openFile(c.file);
    }
    if (!cards.length) contentEl.createEl("div", { text: "卡盒为空，点「+卡」开始建卡。" });

    search.oninput = () => { this.filter = search.value; this.render(); };
    if (kw || this.filter) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }
}
