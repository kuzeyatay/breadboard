import { AsyncService } from 'civkit/async-service';
import { GlobalLogger } from './logger';
import { HTTPService } from 'civkit/http';
import { EnvConfig } from './envconfig';
import { singleton } from 'tsyringe';

type IntegrityEnvelopeWrapped<T> = {
    code: number;
    status: number;
    data: T;
    meta: { [k: string]: any; };
};

export class BogoSiteClient extends HTTPService {
    async listHandlerRegExps() {
        const r = await this.get<IntegrityEnvelopeWrapped<{
            handlers: string[];
        }>>('/listHandlers');

        return r.data.data.handlers.map((h) => new RegExp(h, 'i'));
    }

    async access(url: string) {
        const r = await this.postJson<Blob>('/access', { url }, { responseType: 'blob' });

        return r;
    }
}

@singleton()
export class BogoSitesControl extends AsyncService {
    logger = this.globalLogger.child({ service: this.constructor.name });

    clients: BogoSiteClient[] = [];

    regExpMap: Map<RegExp, BogoSiteClient> = new Map();

    protected __manifestSyncInterval?: ReturnType<typeof setInterval>;

    constructor(
        protected globalLogger: GlobalLogger,
        protected envConfig: EnvConfig,
    ) {
        super(...arguments);
    }

    override async init() {
        await this.dependencyReady();

        if (process.env.JINA_BOGO_SITES_RESORT_ORIGIN) {
            this.clients.push(new BogoSiteClient(process.env.JINA_BOGO_SITES_RESORT_ORIGIN));
        }

        if (this.clients.length) {
            await this.synchronizeHandlers().catch((err) => {
                this.logger.warn(`Failed to synchronize bogus site handlers on startup`, { error: err });
            });
        }

        if (this.__manifestSyncInterval) {
            clearInterval(this.__manifestSyncInterval);
            delete this.__manifestSyncInterval;
        }

        if (this.clients.length) {
            this.__manifestSyncInterval = setInterval(
                () => this.synchronizeHandlers().catch((err) => {
                    this.logger.warn(`Failed to synchronize bogus site handlers`, { error: err });
                }),
                5 * 60 * 1000 + Math.random() * 60 * 1000
            ).unref();
        }

        this.emit('ready');
    }

    async synchronizeHandlers() {
        for (const client of this.clients) {
            const handlers = await client.listHandlerRegExps();
            for (const handler of handlers) {
                this.regExpMap.set(handler, client);
            }
        }
    }


    async attempt(url: string) {
        for (const [regExp, client] of this.regExpMap.entries()) {
            if (regExp.test(url)) {
                try {
                    this.logger.debug(`Accessing URL with bogo site client: ${url}`);
                    const r = await client.access(url);
                    return r;
                } catch (e) {
                    this.logger.warn('Error accessing URL with bogo site client', { url, error: e });
                }

                break;
            }
        }

        return;
    }

}
