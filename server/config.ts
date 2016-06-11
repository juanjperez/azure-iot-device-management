/* Copyright (c) Microsoft Corporation. All Rights Reserved. */

import * as fs from 'fs';
import * as path from 'path';
import * as request from 'request';
import {Hal} from '@azure-iot/hal/types';

export class Config {
    constructor(
        /** 
         * {string} connStr Connection string to the IoTHub.
         */
        public IotHubConnectionString: string,
        
        /**
         * {string} Console reporting source ("server", "client", or "both").
         */
        public ConsoleReporting: string,
        
        /**
         * {string} The Log Level. See https://github.com/trentm/node-bunyan#levels 
         * for acceptable values.
         */
        public LogLevel: string,
        
        /**
         * {string} The port to listen on.
         */
        public Port: string,
        
        /**
         * (Optional) Settings for the Authentication module.
         */
        public Auth?: {
            loginUrl: string,
            mongoUri: string,
            sessionSecret: string
        }) {}
    
    private static instance: Config = null;
    
    /**
     * Returns the Config singleton instance. This method should only 
     * be called after Config.initialize() has been run.
     */
    public static get(): Config {
        if (!Config.instance) {
            throw new Error('Config has not yet been initialized');
        }
        
        return Config.instance;
    }
    
    /**
     * Initializes configuration from either the Config Service or user-config.json.
     * If process.env.CONFIG_URL is specified, this function waits till the settings 
     * are available in the Config Service.
     * Otherwise, the configuration is initialized from user-config.json.   
     */
    public static async initialize(): Promise<Config> {
        const configUrl: string = process.env.CONFIG_URL;
        const port: string = process.env.PORT;
        if (!configUrl && !port) {
            return Config.initializeFromFile();
        } else if (!configUrl) {
            return Config.initializeFromEnvironment();
        } else {
            return await Config.initializeFromConfigService(configUrl, port);
        }
    }
    
    public static async initializeFromConfigService(configUrl: string, port: string) {
        const delayBeforeRetrySeconds = 5;
        let numRetries = 60; // retry max 60 times (5 minutes)
        while (true) {
            try {
                const discovery = await getHal<void>(configUrl + '/api/discovery');
                
                const settingsLink = <Hal.Link>discovery._links['settings:list'];
                if (!settingsLink) throw new Error('Config service does not provide settings:list');
        
                const configSettings = await getHal<ConfigSettings>(configUrl + settingsLink.href);
                if (!configSettings.iotHubConnStr) throw new Error('Config service does not provide setting "iotHubConnStr"');
                if (!configSettings.loginUrl) throw new Error('Config service does not provide setting "loginUrl"');
                if (!configSettings.mongoUri) throw new Error('Config service does not provide setting "mongoUri"');
                if (!configSettings.sessionSecret) throw new Error('Config service does not provide setting "sessionSecret"');
                
                const dmSettings = configSettings['device-management'];
                if (!dmSettings || !dmSettings.consoleReporting || !dmSettings.logLevel) {
                    throw new Error('Config service does not provide setting "device-management"');  
                } 
                                
                // set the static singleton and return:
                return Config.instance = new Config(
                    configSettings.iotHubConnStr,
                    dmSettings.consoleReporting,
                    dmSettings.logLevel,
                    port,
                    {
                        loginUrl: configSettings.loginUrl,
                        mongoUri: configSettings.mongoUri,
                        sessionSecret: configSettings.sessionSecret,
                    });
            } catch (err) {
                --numRetries;
                if (numRetries === 0) {
                    throw new Error('Could not initialize from Config Service: ' + err);                                            
                } else {                    
                    // wait for 5 seconds before retrying:
                    console.error(`WARNING: Could not initialize from Config Service: ${err}; Retrying...`);
                    await new Promise((resolve, reject) => setTimeout(resolve, delayBeforeRetrySeconds * 1000));
                }  
            }
        }
    }
    
    public static initializeFromFile() {
        const userConfigFile = path.join(__dirname, '../../user-config.json');
        if (!fs.existsSync(userConfigFile)) {
            throw new Error('Unable to find the user configuration: please fill out the information in ' + userConfigFile);
        }

        let userConfig: {
            IOTHUB_CONNECTION_STRING: string;
            CONSOLE_REPORTING: string;
            LOG_LEVEL: string;
            PORT?: string;
        } = require(userConfigFile);

        if (!/(^|;)HostName=/i.test(userConfig.IOTHUB_CONNECTION_STRING)) {
            throw new Error('IOTHUB_CONNECTION_STRING was not filled out correctly; please fill out the information in ' + userConfigFile);
        }
        
        // set the static singleton and return:
        return Config.instance = new Config(
            userConfig.IOTHUB_CONNECTION_STRING,
            userConfig.CONSOLE_REPORTING || 'both',
            userConfig.LOG_LEVEL || 'trace',
            userConfig.PORT || '3003');
    }
    
    public static initializeFromEnvironment() {
        return Config.instance = new Config(
            process.env.IOTHUB_CONNECTION_STRING,
            'both',
            'trace',
            process.env.PORT || '3003');
    }
}

interface ConfigSettings {
    iotHubConnStr: string;
    loginUrl: string;
    mongoUri: string;
    sessionSecret: string;
    'device-management': {
        logLevel: string;
        consoleReporting: string;
    };
}

async function getHal<T>(uri: string) {
    return new Promise<T & Hal.Resource>((resolve, reject) => {        
        request.get(uri, {json: true}, (err, response, body) => {
            err ? reject(err) : resolve(body);
        });
    });
}
