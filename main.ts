import {
	Plugin,
	PluginSettingTab,
	Setting,
	TextFileView,
	WorkspaceLeaf,
} from "obsidian";
import { execFile, execSync } from "child_process";

// Not in Obsidian's public type definitions but used by community plugins
// for proper cleanup when unregistering file extensions.
declare module "obsidian" {
	interface App {
		viewRegistry: {
			unregisterExtensions(extensions: string[]): void;
		};
	}
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface NushellSettings {
	datetimeFormat: string;
	datetimeColor: string;
	filesizeUnit: string;
	filesizeColor: string;
	trueColor: string;
	falseColor: string;
}

const DEFAULT_SETTINGS: NushellSettings = {
	datetimeFormat: "%Y-%m-%d %H:%M:%S",
	datetimeColor: "purple",
	filesizeUnit: "metric",
	filesizeColor: "cyan",
	trueColor: "green",
	falseColor: "light_red",
};

// Reject values containing characters that could enable shell injection
const SAFE_SETTING = /^[a-zA-Z0-9%_\-\/., :]*$/;

function sanitize(value: string): string {
	return SAFE_SETTING.test(value) ? value : "";
}

// ---------------------------------------------------------------------------
// Nushell binary resolution
// ---------------------------------------------------------------------------

const IS_WIN = process.platform === "win32";

let nuStatus: { path: string; available: boolean } | null = null;

function getNuStatus(): { path: string; available: boolean } {
	if (nuStatus) return nuStatus;
	try {
		let path: string;
		if (IS_WIN) {
			path = execSync("where nu")
				.toString()
				.trim()
				.split(/\r?\n/)[0]
				.trim();
		} else {
			const shell = process.env.SHELL || "/bin/zsh";
			path = execSync(`${shell} -lic "which nu"`).toString().trim();
		}
		execSync(`"${path}" --version`);
		nuStatus = { path, available: true };
	} catch {
		nuStatus = { path: "nu", available: false };
	}
	return nuStatus;
}

// ---------------------------------------------------------------------------
// ANSI-to-HTML conversion
// ---------------------------------------------------------------------------

const ANSI_4BIT: Record<number, string> = {
	30: "#45475a", 31: "#f38ba8", 32: "#a6e3a1", 33: "#f9e2af",
	34: "#89b4fa", 35: "#cba6f7", 36: "#89dceb", 37: "#bac2de",
	39: "#cdd6f4",
	90: "#585b70", 91: "#f38ba8", 92: "#a6e3a1", 93: "#f9e2af",
	94: "#89b4fa", 95: "#cba6f7", 96: "#89dceb", 97: "#cdd6f4",
};

const DEFAULT_FG = "#cdd6f4";

function toHex(n: number): string {
	return n.toString(16).padStart(2, "0");
}

function rgbHex(r: number, g: number, b: number): string {
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function ansi256ToHex(n: number): string {
	if (n < 8) return ANSI_4BIT[n + 30] || DEFAULT_FG;
	if (n < 16) return ANSI_4BIT[n - 8 + 90] || DEFAULT_FG;
	if (n >= 232) {
		const v = (n - 232) * 10 + 8;
		return rgbHex(v, v, v);
	}
	const i = n - 16;
	return rgbHex(
		Math.floor(i / 36) * 51,
		Math.floor((i % 36) / 6) * 51,
		(i % 6) * 51,
	);
}

function parseAnsiCodes(codes: number[]): string {
	const styles: string[] = [];
	let i = 0;

	while (i < codes.length) {
		const c = codes[i];

		if (c === 0) return "";
		else if (c === 1) styles.push("font-weight:bold");
		else if (c === 2) styles.push("opacity:0.7");
		else if (c === 3) styles.push("font-style:italic");
		else if (c === 4) styles.push("text-decoration:underline");
		else if (c === 7) styles.push("filter:invert(1)");
		else if (c === 9) styles.push("text-decoration:line-through");
		else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97) || c === 39) {
			styles.push(`color:${ANSI_4BIT[c] || DEFAULT_FG}`);
		} else if (c === 38 && codes[i + 1] === 5) {
			styles.push(`color:${ansi256ToHex(codes[i + 2])}`);
			i += 2;
		} else if (c === 38 && codes[i + 1] === 2) {
			styles.push(`color:${rgbHex(codes[i + 2], codes[i + 3], codes[i + 4])}`);
			i += 4;
		} else if (c >= 40 && c <= 47) {
			styles.push(`background:${ANSI_4BIT[c - 10] || "transparent"}`);
		} else if (c === 48 && codes[i + 1] === 5) {
			styles.push(`background:${ansi256ToHex(codes[i + 2])}`);
			i += 2;
		} else if (c === 48 && codes[i + 1] === 2) {
			styles.push(`background:${rgbHex(codes[i + 2], codes[i + 3], codes[i + 4])}`);
			i += 4;
		}

		i++;
	}

	return styles.join(";");
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function ansiToHtml(raw: string): string {
	let html = escapeHtml(raw);

	html = html.replace(/\x1b\[0m/g, "</span>");
	html = html.replace(/\x1b\[(\d+(?:;\d+)*)m/g, (_, seq: string) => {
		const style = parseAnsiCodes(seq.split(";").map(Number));
		return style === "" ? "</span>" : `<span style="${style}">`;
	});

	return html;
}

// ---------------------------------------------------------------------------
// Nushell execution
// ---------------------------------------------------------------------------

function buildPreamble(settings: NushellSettings): string {
	const parts: string[] = [];

	const t = sanitize(settings.trueColor);
	const f = sanitize(settings.falseColor);
	if (t || f) {
		parts.push(
			`$env.config.color_config.bool = {|x| if $x { "${t || "light_cyan"}" } else { "${f || "light_cyan"}" } }`,
		);
	}

	const fmt = sanitize(settings.datetimeFormat);
	if (fmt) {
		parts.push(
			`$env.config.datetime_format = {normal: "${fmt}", table: "${fmt}"}`,
		);
	}

	const dtc = sanitize(settings.datetimeColor);
	if (dtc) {
		parts.push(`$env.config.color_config.datetime = "${dtc}"`);
	}

	const unit = sanitize(settings.filesizeUnit);
	if (unit) {
		parts.push(`$env.config.filesize.unit = "${unit}"`);
	}

	const fsc = sanitize(settings.filesizeColor);
	if (fsc) {
		parts.push(`$env.config.color_config.filesize = "${fsc}"`);
	}

	return parts.length > 0 ? parts.join("; ") + "; " : "";
}

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

function runNu(
	cmd: string,
	env?: Record<string, string>,
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			getNuStatus().path,
			["-c", cmd],
			{
				env: { ...process.env, FORCE_COLOR: "1", COLUMNS: "2000", ...env },
				maxBuffer: MAX_BUFFER,
			},
			(err, stdout, stderr) => {
				if (err) reject(new Error(stderr || err.message));
				else resolve(stdout);
			},
		);
	});
}

function renderFallback(data: string): string {
	return `<span class="nushell-unavailable">Nushell is not installed \u2014 showing raw content</span>\n${escapeHtml(data)}`;
}

async function renderNuon(data: string, settings: NushellSettings): Promise<string> {
	if (!getNuStatus().available) return renderFallback(data);
	const preamble = buildPreamble(settings);
	const raw = await runNu(
		`${preamble}$env._NU_INPUT | from nuon | table -e`,
		{ _NU_INPUT: data.trim() },
	);
	return ansiToHtml(raw);
}

async function renderNuHighlight(data: string): Promise<string> {
	if (!getNuStatus().available) return renderFallback(data);
	const raw = await runNu(
		"$env._NU_INPUT | nu-highlight",
		{ _NU_INPUT: data },
	);
	return ansiToHtml(raw);
}

// ---------------------------------------------------------------------------
// File views
// ---------------------------------------------------------------------------

const NUON_VIEW = "nuon-view";
const NU_VIEW = "nu-view";

class NuonFileView extends TextFileView {
	private plugin: NushellPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: NushellPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return NUON_VIEW; }
	getViewData(): string { return this.data; }

	setViewData(data: string): void {
		this.data = data;
		this.render();
	}

	clear(): void {
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		this.contentEl.empty();
		try {
			const html = await renderNuon(this.data, this.plugin.settings);
			const pre = this.contentEl.createEl("pre", { cls: "nushell-output" });
			pre.innerHTML = html;
		} catch (e) {
			this.contentEl.createEl("pre", {
				text: `Error: ${e instanceof Error ? e.message : e}`,
				cls: "nushell-error",
			});
		}
	}
}

class NuFileView extends TextFileView {
	getViewType(): string { return NU_VIEW; }
	getViewData(): string { return this.data; }

	setViewData(data: string): void {
		this.data = data;
		this.render();
	}

	clear(): void {
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		this.contentEl.empty();
		try {
			const html = await renderNuHighlight(this.data);
			const pre = this.contentEl.createEl("pre", { cls: "nushell-output" });
			pre.innerHTML = html;
		} catch (e) {
			this.contentEl.createEl("pre", {
				text: `Error: ${e instanceof Error ? e.message : e}`,
				cls: "nushell-error",
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

const NU_COLORS: Record<string, string> = {
	"": "Default",
	green: "Green",
	light_green: "Light green",
	red: "Red",
	light_red: "Light red",
	blue: "Blue",
	light_blue: "Light blue",
	cyan: "Cyan",
	light_cyan: "Light cyan",
	yellow: "Yellow",
	light_yellow: "Light yellow",
	purple: "Purple",
	light_purple: "Light purple",
	magenta: "Magenta",
	light_magenta: "Light magenta",
	white: "White",
	dark_gray: "Dark gray",
};

const DATE_PRESETS: Record<string, string> = {
	"": "Natural (2 days ago)",
	"%Y-%m-%d %H:%M:%S": "2026-04-12 19:30:00",
	"%Y-%m-%d %H:%M": "2026-04-12 19:30",
	"%Y-%m-%d": "2026-04-12",
	"%d/%m/%Y %H:%M:%S": "12/04/2026 19:30:00",
	"%d/%m/%Y %H:%M": "12/04/2026 19:30",
	"%d/%m/%Y": "12/04/2026",
	"%m/%d/%Y %I:%M %p": "04/12/2026 07:30 PM",
	"%m/%d/%Y": "04/12/2026",
	"%b %d, %Y": "Apr 12, 2026",
	"%B %d, %Y": "April 12, 2026",
	"%d %b %Y %H:%M": "12 Apr 2026 19:30",
	"%d %B %Y": "12 April 2026",
	"%A, %B %d, %Y": "Saturday, April 12, 2026",
	"%a, %b %d, %Y": "Sat, Apr 12, 2026",
	"%A %d %B %Y %H:%M": "Saturday 12 April 2026 19:30",
	"%a %d/%m/%Y %H:%M": "Sat 12/04/2026 19:30",
	"%d-%b-%Y": "12-Apr-2026",
	"%Y%m%d": "20260412",
};

class NushellSettingTab extends PluginSettingTab {
	private plugin: NushellPlugin;

	constructor(app: NushellPlugin["app"], plugin: NushellPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("nushell-settings");

		// -- Nushell status -----------------------------------------------------

		const status = getNuStatus();
		const statusDesc = createFragment((el) => {
			if (status.available) {
				el.appendText(status.path);
			} else {
				el.appendText("Not found \u2014 rendering will show raw content. ");
				el.createEl("a", {
					text: "Install Nushell",
					href: "https://www.nushell.sh/book/installation.html",
				});
			}
		});

		new Setting(containerEl)
			.setName("Nushell")
			.setDesc(statusDesc)
			.then((s) => {
				const led = s.controlEl.createEl("span", {
					cls: status.available ? "nushell-led nushell-led-on" : "nushell-led nushell-led-off",
				});
				led.ariaLabel = status.available ? "Connected" : "Not found";
			});

		// -- Date/time ----------------------------------------------------------

		const dateDesc = createFragment((el) => {
			el.appendText(
				"strftime format string. Leave empty for natural format (\u201c2 days ago\u201d). ",
			);
			el.createEl("a", {
				text: "Format reference",
				href: "https://docs.rs/chrono/latest/chrono/format/strftime/index.html",
			});
		});

		new Setting(containerEl)
			.setName("Date/time format")
			.setDesc("How to display dates in tables.")
			.addDropdown((d) => {
				for (const [val, label] of Object.entries(DATE_PRESETS)) {
					d.addOption(val, label);
				}
				const current = this.plugin.settings.datetimeFormat;
				d.setValue(current in DATE_PRESETS ? current : "").onChange(async (v) => {
					this.plugin.settings.datetimeFormat = v;
					await this.plugin.saveSettings();
					this.display();
				});
			})
			.addExtraButton((btn) =>
				btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
					this.plugin.settings.datetimeFormat = DEFAULT_SETTINGS.datetimeFormat;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Custom format")
			.setDesc(dateDesc)
			.addText((text) =>
				text
					.setPlaceholder("empty = natural")
					.setValue(this.plugin.settings.datetimeFormat)
					.onChange(async (v) => {
						this.plugin.settings.datetimeFormat = v;
						await this.plugin.saveSettings();
					}),
			)
			.addExtraButton((btn) =>
				btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
					this.plugin.settings.datetimeFormat = DEFAULT_SETTINGS.datetimeFormat;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		this.addColorSetting(containerEl, "Date/time color", "datetimeColor");

		// -- Filesize ------------------------------------------------------------

		new Setting(containerEl)
			.setName("Filesize unit")
			.setDesc("How to display file sizes.")
			.addDropdown((d) =>
				d
					.addOption("metric", "Metric (kB, MB)")
					.addOption("binary", "Binary (KiB, MiB)")
					.setValue(this.plugin.settings.filesizeUnit)
					.onChange(async (v) => {
						this.plugin.settings.filesizeUnit = v;
						await this.plugin.saveSettings();
					}),
			)
			.addExtraButton((btn) =>
				btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
					this.plugin.settings.filesizeUnit = DEFAULT_SETTINGS.filesizeUnit;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		this.addColorSetting(containerEl, "Filesize color", "filesizeColor");

		// -- Booleans -----------------------------------------------------------

		this.addColorSetting(containerEl, "True color", "trueColor");
		this.addColorSetting(containerEl, "False color", "falseColor");

		// -- Footer -------------------------------------------------------------

		const footer = containerEl.createEl("div", { cls: "nushell-settings-footer" });
		footer.createEl("p", { text: "Switch file to apply changes.", cls: "nushell-settings-hint" });
		footer.createEl("p", { text: "Built with Nushell and curiosity.", cls: "nushell-settings-quote" });
		const links = footer.createEl("p");
		links.createEl("a", {
			text: "Report an issue",
			href: "https://github.com/ChristianLemer/obsidian-nushell/issues",
		});
		links.appendText(" \u00b7 ");
		links.createEl("a", {
			text: "Nushell",
			href: "https://www.nushell.sh",
		});
	}

	private addColorSetting(
		containerEl: HTMLElement,
		name: string,
		key: keyof NushellSettings,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(`Nushell color for ${name.toLowerCase().replace(" color", "")} values.`)
			.addDropdown((d) => {
				for (const [val, label] of Object.entries(NU_COLORS)) {
					d.addOption(val, label);
				}
				d.setValue(this.plugin.settings[key]).onChange(async (v) => {
					this.plugin.settings[key] = v;
					await this.plugin.saveSettings();
				});
			})
			.addExtraButton((btn) =>
				btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
					this.plugin.settings[key] = DEFAULT_SETTINGS[key];
					await this.plugin.saveSettings();
					this.display();
				}),
			);
	}
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class NushellPlugin extends Plugin {
	settings: NushellSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new NushellSettingTab(this.app, this));

		this.registerView(NUON_VIEW, (leaf) => new NuonFileView(leaf, this));
		this.registerView(NU_VIEW, (leaf) => new NuFileView(leaf));
		this.registerExtensions(["nuon"], NUON_VIEW);
		this.registerExtensions(["nu"], NU_VIEW);

		this.registerMarkdownCodeBlockProcessor("nuon", async (source, el) => {
			try {
				const html = await renderNuon(source, this.settings);
				const pre = el.createEl("pre", { cls: "nushell-output" });
				pre.innerHTML = html;
			} catch (e) {
				el.createEl("pre", {
					text: `Error: ${e instanceof Error ? e.message : e}`,
					cls: "nushell-error",
				});
			}
		});

		this.registerMarkdownCodeBlockProcessor("nu", async (source, el) => {
			try {
				const html = await renderNuHighlight(source);
				const pre = el.createEl("pre", { cls: "nushell-output" });
				pre.innerHTML = html;
			} catch (e) {
				el.createEl("pre", {
					text: `Error: ${e instanceof Error ? e.message : e}`,
					cls: "nushell-error",
				});
			}
		});
	}

	onunload(): void {
		this.app.viewRegistry.unregisterExtensions(["nuon", "nu"]);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
