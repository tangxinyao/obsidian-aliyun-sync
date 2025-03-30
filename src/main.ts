import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';
import OSS from 'ali-oss';

interface AliyunSyncSettings {
	accessKeyId: string;
	accessKeySecret: string;
	region: string;
	bucket: string;
	endpoint?: string;
	prefix?: string;
}

const DEFAULT_SETTINGS: AliyunSyncSettings = {
	accessKeyId: '',
	accessKeySecret: '',
	region: '',
	bucket: '',
};

export default class AliyunSyncPlugin extends Plugin {
	settings: AliyunSyncSettings;
	private lastModifiedCache: Record<string, number> = {};

	async onload() {
		await this.loadSettings();

		// Add restore command
		this.addCommand({
			id: 'restore',
			name: 'Restore from Aliyun OSS',
			callback: () => this.restore(),
		});

		// Add store command
		this.addCommand({
			id: 'store',
			name: 'Store to Aliyun OSS',
			callback: () => this.store(),
		});

		// Add settings tab
		this.addSettingTab(new AliyunSyncSettingTab(this.app, this));

		// Auto sync on startup
		if (
			this.settings.accessKeyId &&
			this.settings.accessKeySecret &&
			this.settings.region &&
			this.settings.bucket
		) {
			this.restore();

			// Auto save to OSS on file save
			this.registerEvent(
				this.app.vault.on('modify', async (file: TFile) => {
					await this.store();
				}),
			);
		}
	}

	async restore() {
		new Notice('Starting restore from Aliyun OSS...');
		try {
			const client = new OSS({
				region: this.settings.region,
				accessKeyId: this.settings.accessKeyId,
				accessKeySecret: this.settings.accessKeySecret,
				bucket: this.settings.bucket,
				endpoint: this.settings.endpoint,
			});

			// List all objects in OSS bucket
			let objects: OSS.ObjectMeta[] = [];
			let result = await client.list(
				{
					prefix: this.settings.prefix,
					'max-keys': 100,
				},
				{},
			);

			if (result.objects) {
				objects = objects.concat(result.objects);
			}

			while (result.isTruncated && result.nextMarker) {
				result = await client.list(
					{
						prefix: this.settings.prefix,
						'max-keys': 100,
						marker: result.nextMarker,
					},
					{},
				);

				if (result.objects) {
					objects = objects.concat(result.objects);
				}
			}

			// Download and save each file
			for (const obj of objects) {
				if (obj.name.endsWith('/')) continue; // Skip directories

				const remotePath = obj.name;
				const localPath = this.settings.prefix
					? remotePath.substring(this.settings.prefix.length + 1)
					: remotePath;

				const result = await client.get(remotePath);
				await this.app.vault.adapter.write(localPath, result.content);
				new Notice(`Restored ${localPath} from OSS`);
			}

			new Notice('All files restored successfully!');
		} catch (err) {
			new Notice(`Restore failed: ${err.message}`);
			console.error('Restore error:', err);
		}
	}

	async store() {
		new Notice('Starting store to Aliyun OSS...');
		try {
			const client = new OSS({
				region: this.settings.region,
				accessKeyId: this.settings.accessKeyId,
				accessKeySecret: this.settings.accessKeySecret,
				bucket: this.settings.bucket,
				endpoint: this.settings.endpoint,
			});

			// Get all markdown files in vault
			const files = this.app.vault.getMarkdownFiles();
			let changedCount = 0;

			for (const file of files) {
				const stat = await this.app.vault.adapter.stat(file.path);
				if (!stat) {
					console.error(`Failed to get stats for file: ${file.path}`);
					continue;
				}
				const lastModified = stat.mtime;

				if (this.lastModifiedCache[file.path] === lastModified) {
					continue; // Skip unchanged files
				}

				const content = await this.app.vault.read(file);
				const remotePath = this.settings.prefix
					? `${this.settings.prefix}/${file.path}`
					: file.path;

				await client.put(remotePath, Buffer.from(content));
				this.lastModifiedCache[file.path] = lastModified;
				changedCount++;
				new Notice(`Stored ${file.path} to OSS`);
			}

			new Notice(`Stored ${changedCount} changed files successfully!`);
		} catch (err) {
			new Notice(`Store failed: ${err.message}`);
			console.error('Store error:', err);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AliyunSyncSettingTab extends PluginSettingTab {
	plugin: AliyunSyncPlugin;

	constructor(app: App, plugin: AliyunSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Access Key ID').addText((text) =>
			text
				.setPlaceholder('Enter your Access Key ID')
				.setValue(this.plugin.settings.accessKeyId)
				.onChange(async (value) => {
					this.plugin.settings.accessKeyId = value;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl).setName('Access Key Secret').addText((text) =>
			text
				.setPlaceholder('Enter your Access Key Secret')
				.setValue(this.plugin.settings.accessKeySecret)
				.onChange(async (value) => {
					this.plugin.settings.accessKeySecret = value;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl).setName('Region').addText((text) =>
			text
				.setPlaceholder('e.g. oss-cn-hangzhou')
				.setValue(this.plugin.settings.region)
				.onChange(async (value) => {
					this.plugin.settings.region = value;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl).setName('Bucket').addText((text) =>
			text
				.setPlaceholder('Enter your bucket name')
				.setValue(this.plugin.settings.bucket)
				.onChange(async (value) => {
					this.plugin.settings.bucket = value;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl).setName('Endpoint (Optional)').addText((text) =>
			text
				.setPlaceholder('Enter custom endpoint if needed')
				.setValue(this.plugin.settings.endpoint || '')
				.onChange(async (value) => {
					this.plugin.settings.endpoint = value || undefined;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl).setName('Prefix (Optional)').addText((text) =>
			text
				.setPlaceholder('Enter prefix if needed')
				.setValue(this.plugin.settings.prefix || '')
				.onChange(async (value) => {
					this.plugin.settings.prefix = value || undefined;
					await this.plugin.saveSettings();
				}),
		);
	}
}
