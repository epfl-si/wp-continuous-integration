import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {error} from "./logger";

export interface Config {
	REPOSITORIES: string[];
	DEBUG: boolean;
	NAMESPACE: string;
}

export function loadConfig(configFilePath: any): Config | undefined {
	const configFile = fs.readFileSync(configFilePath, 'utf8');
	const parsedConfig = yaml.load(configFile) as Config;
	if (parsedConfig) {
		return parsedConfig;
	} else {
		error('Invalid or missing data section in the config', { url: configFilePath });
	}
}
